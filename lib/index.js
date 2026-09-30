/**
 * dsh-deskpet · 宿主半插件
 *
 * 职责：
 *   1. 订阅 DSH 的低频结构事件，归一化成桌宠信号；
 *   2. 用 `ctx.subprocess` 拉起独立 Electron 助手进程，通过 stdio JSON Lines 下发状态；
 *   3. 注册 `/deskpet` RPC 通道，供设置卡读写设置与下发命令。
 *
 * 为什么桌宠窗口在独立进程里：DSH 的插件运行在 `ELECTRON_RUN_AS_NODE=1` 的
 * Host 子进程中，拿不到任何窗口 API（`BrowserWindow` 在官方 `packages/**` 中零出现）。
 * 因此窗口必须由我们自己 spawn 的进程创建 —— 这条路径不在官方文档的承诺范围内，
 * 但完全在规则内（不违反任何约束，走的都是公开的 Service Definition）。
 *
 * @module dsh-deskpet
 */

import { join } from 'node:path';

import { createStatusTracker } from './activity.js';
import { PetBridge } from './bridge.js';
import { probeElectron, pluginRoot } from './electron-runtime.js';
import { migrateLegacyHome } from './migrate.js';
import { sweepOrphanHelpers } from './orphans.js';
import { DEFAULT_SETTINGS, LIMITS, loadSettings, normalizeSettings, saveSettings } from './settings.js';
import { createPetState } from './state.js';

/** 插件标识（同时也是 RPC 通道名与设置卡的 key）。 */
export const name = 'deskpet';

/**
 * 需要的宿主服务。
 * `subprocess` 起窗口进程，`agents` 过滤子代理会话，`connection` 提供设置卡 RPC。
 */
export const inject = ['subprocess', 'agents', 'connection', 'webServer'];

/** RPC 通道（客户端 `connection.rpc.call` 的第一参数）。 */
const RPC_CHANNEL = '/deskpet';

/** 定义面板的固定间隔：把连续状态变化合并成低频下发。 */
const STATE_FLUSH_MS = 120;

export function apply(ctx) {
  const assetsDir = join(pluginRoot, 'assets');
  const helperDir = join(pluginRoot, 'helper');

  const pet = createPetState();
  let settings = normalizeSettings(DEFAULT_SETTINGS);
  let bridge = null;
  let flushTimer = null;
  let flushAt = 0;
  let lastSent = null;
  let lastError = null;
  let lastExit = null;
  let readyInfo = null;

  const logger = ctx.logger ?? console;

  /** 归一化后的信号 → 应用 + 惰性下发。 */
  function signal(kind) {
    if (!pet.apply(kind)) return;
    scheduleFlush();
  }

  /**
   * 安排一次状态下发。
   *
   * 关键：允许「更早的」重新排期。空闲超时会在 90 秒后安排一次回落，如果
   * 简单地「已有定时器就不再排期」，那么这 90 秒内发生的任何真实状态变化
   * 都发不出去 —— 窗口会一直停在旧姿态上。
   */
  function scheduleFlush(delayMs = STATE_FLUSH_MS) {
    const at = Date.now() + delayMs;
    if (flushTimer !== null) {
      if (at >= flushAt) return; // 已有一个更早的待发，保持不动
      clearTimeout(flushTimer);
    }
    flushAt = at;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushAt = 0;
      flush();
    }, delayMs);
    flushTimer.unref?.();
  }

  function flush() {
    if (bridge === null || !bridge.running) return;
    const current = pet.current();
    if (current !== lastSent) {
      lastSent = current;
      bridge.send({ t: 'state', v: current });
    }
    // 瞬态结束后要主动回落成基态；等下一次 DSH 事件可能永远不会来。
    const next = pet.nextTransitionIn();
    if (next !== null) scheduleFlush(next);
  }

  // ── 气泡：任务状态（两行）──────────────────────────────────────────────
  //
  // 显示的不是「模型在想什么」，而是「它现在在干什么」—— 复现 DSH 聊天区那行灰字：
  //
  //   第 1 行  会话标题
  //   第 2 行  正在运行命令 · npm test
  //
  // 状态来源全是宿主已有的订阅（见 lib/activity.js 的说明），不需要读前端。
  //
  // 状态变化是**离散事件**（工具开始/结束），不是逐 token 的文本流，
  // 所以不需要原来那种「最小间隔队列」—— 排队反而会显示过期状态。
  // 这里只要「变了才发」+ 一个很短的合并窗口，避免工具接连切换时来回闪。
  const status = createStatusTracker();

  /** 合并窗口：工具接连切换时把中间态合掉。 */
  const BUBBLE_SETTLE_MS = 90;

  let bubbleTimer = null;
  let bubbleSent = null;
  let lastPrepared = null;

  function bubblePayload() {
    const current = status.snapshot();
    if (!current.active) return { title: '', status: '' };
    return { title: current.title, status: current.status };
  }

  function flushBubble() {
    bubbleTimer = null;
    if (settings.bubbles === false) return;
    const payload = bubblePayload();
    const key = `${payload.title}\u0000${payload.status}`;
    if (key === bubbleSent) return;
    bubbleSent = key;
    if (bridge === null || !bridge.running) return;
    bridge.send({ t: 'bubble', title: payload.title, status: payload.status });
  }

  /** 安排一次气泡下发；`0` 表示立刻（换轮与清空用）。 */
  function scheduleBubble(delayMs = BUBBLE_SETTLE_MS) {
    if (bubbleTimer !== null) {
      if (delayMs !== 0) return; // 已有待发就够了
      clearTimeout(bubbleTimer);
    }
    bubbleTimer = setTimeout(flushBubble, delayMs);
    bubbleTimer.unref?.();
  }

  /**
   * 立刻清空实时层，让气泡回落到待机碎碎念。
   *
   * 不看 `settings.bubbles`：关掉气泡时恰恰需要把已经显示的那条收掉。
   */
  function clearBubble() {
    if (bubbleTimer !== null) {
      clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
    lastPrepared = null;
    if (bubbleSent === '\u0000') return;
    bubbleSent = '\u0000';
    if (bridge === null || !bridge.running) return;
    bridge.send({ t: 'bubble', title: '', status: '' });
  }

  /**
   * 主动读一次当前会话的标题。
   *
   * 为什么不能只靠 `session/title` 事件：那个事件**只在标题被设置的那一刻发一次**
   * （会话开头由模型生成，或用户手动改名）。插件要是启动得比它晚 ——
   * 比如用户中途重启 DSH —— 就永远收不到，标题会一直是空的。
   * 这个坑真踩过：用户重启后气泡只显示状态行，第一行永远是空的。
   *
   * 所以每次开新一轮都主动问一次服务。服务不存在或读取失败时返回空串，
   * 调用方据此保留已有的标题，不要把它冲掉。
   */
  function readTitle(session) {
    try {
      const titles = ctx.get('sessionTitle');
      const snapshot = titles?.get?.(session);
      return typeof snapshot?.title === 'string' ? snapshot.title : '';
    } catch {
      return '';
    }
  }

  /** 判断是否顶级会话（不看子代理）。 */
  function isTopLevel(sessionId) {
    if (sessionId === undefined || sessionId === null) return false;
    try {
      const roots = ctx.agents?.roots?.() ?? [];
      if (roots.length === 0) return true; // 拿不到名册时不误伤
      return roots.some((agent) => String(agent?.id) === String(sessionId));
    } catch {
      return true;
    }
  }

  // ── 事件订阅 ────────────────────────────────────────────────────────────

  ctx.on(
    'session/event',
    (session, event) => {
      if (!isTopLevel(session?.id)) return;
      const type = event?.type;
      const data = event?.data ?? event;

      switch (type) {
        case 'session/title':
          // 会话标题：气泡第一行。改了标题也要立刻反映出来。
          status.setTitle(data?.title);
          scheduleBubble();
          break;
        case 'turn/start': {
          lastPrepared = null;
          status.beginTurn();
          // 主动补一次标题：事件可能在我们启动之前就发过了（见 readTitle 的说明）。
          const fresh = readTitle(session);
          if (fresh !== '') status.setTitle(fresh);
          scheduleBubble(0);
          signal('turn-start');
          break;
        }
        case 'tool/call':
          // name → 类别，arguments → 「· npm test」那截细节
          status.run(data?.name, data?.arguments);
          scheduleBubble();
          signal('tool-call');
          break;
        case 'tool/result':
          status.finishTool();
          scheduleBubble();
          signal('tool-result');
          break;
        case 'approval/asked':
          signal('waiting');
          break;
        case 'turn/end': {
          status.endTurn();
          scheduleBubble(0);
          const kind = data?.reason?.kind ?? data?.kind;
          if (kind === 'completed') signal('turn-completed');
          else if (kind === 'error' || kind === 'max-tokens') signal('error');
          else signal('turn-aborted');
          break;
        }
        default:
          break;
      }
    },
    { global: true },
  );

  /**
   * 实时助手流 → 气泡的「准备…」阶段。
   *
   * 只关心 `tool-call-delta`：模型刚开始吐工具名时参数还没传完，DSH 这时显示
   * 「准备运行命令」，等 `tool/call` 到了才变成「正在运行命令」。
   *
   * chunk 帧是**瞬态**的（官方明确要求不得持久化、不得直接转发），
   * 所以这里只读一个字段就返回，不做任何重活。
   */
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (settings.bubbles === false) return;
    if (!isTopLevel(agent?.id)) return; // 子代理的状态不该占用主气泡
    if (frame?.type !== 'chunk') return;

    const chunk = frame.chunk;
    if (chunk?.type !== 'tool-call-delta') return;
    if (typeof chunk.name !== 'string' || chunk.name === '') return;
    // 同一个工具名会在整段 delta 里重复出现，只在换工具时更新一次
    if (chunk.name === lastPrepared) return;
    lastPrepared = chunk.name;
    status.prepare(chunk.name);
    scheduleBubble();
  });

  // `agent/error` 是实时 emit，可能没有对应的持久 `turn/end`，两处都听并去重。
  ctx.on('agent/error', () => signal('error'));

  // `user-questions/request` 是 waterfall，必须原样把 next() 传下去。
  ctx.on('user-questions/request', (...args) => {
    const next = args[args.length - 1];
    try {
      signal('waiting');
    } catch {
      // 观察者失败绝不能影响提问流程
    }
    return typeof next === 'function' ? next() : undefined;
  });

  // ── 助手进程 ────────────────────────────────────────────────────────────

  async function startBridge() {
    if (bridge !== null || !settings.enabled) return;

    // 只解析一次运行时：解析可能包含从本地缓存解包（上百 MB），
    // 重复调用会让启动时间翻倍。
    const runtime = await probeElectron();
    if (!runtime.ok) {
      lastError = runtime.error;
      logger.warn?.('桌宠暂时不可用：%s', runtime.error);
      return;
    }
    lastError = null;

    bridge = new PetBridge({
      ctx,
      electron: runtime.binary,
      helperDir,
      assetsDir,
      settings: () => settings,
      onStatus: (info) => {
        if (info.kind === 'ready') {
          readyInfo = { pid: info.pid ?? null, at: Date.now() };
          lastExit = null;
          return;
        }
        if (info.kind === 'exit') {
          readyInfo = null;
          lastExit = {
            at: Date.now(),
            exitCode: info.outcome?.exitCode ?? null,
            signal: info.outcome?.signal ?? null,
          };
          return;
        }
        if (info.kind === 'spawn-failed' || info.kind === 'error') {
          readyInfo = null;
          lastExit = { at: Date.now(), error: String(info.error ?? info.kind) };
        }
      },
      onMessage: (message) => {
        if (message === null || typeof message !== 'object') return;
        // 助手回报的位置变更 —— 只在「记住位置」开启时持久化。
        if (message.t === 'moved' && settings.rememberPosition) {
          settings = { ...settings, position: { x: Number(message.x), y: Number(message.y) } };
          void saveSettings(settings).catch(() => {});
          return;
        }
        // 右键菜单等发起的命令。
        if (message.t === 'command' && typeof message.action === 'string') {
          void handleCommand(message.action).catch((error) => {
            logger.warn?.('桌宠命令 %s 失败：%s', message.action, error instanceof Error ? error.message : String(error));
          });
        }
      },
    });
    bridge.start();
    lastSent = null;
    // 助手刚起来时窗口里什么都没有，去重键要清掉，否则当前状态发不出去。
    bubbleSent = null;
    scheduleFlush();
    scheduleBubble(0);
  }

  async function stopBridge() {
    const current = bridge;
    bridge = null;
    lastSent = null;
    readyInfo = null;
    if (current !== null) await current.dispose();
  }

  /**
   * 应用一份新设置（归一化 + 落盘 + 按需起停或热下发）。
   *
   * 只有 `enabled` 会动到进程生命周期。缩放走「窗口就地改尺寸」而不是重启进程：
   * 既不闪烁，也不可能产生多余进程 —— 重启进程那条路径只在「重启窗口」命令里保留。
   */
  async function updateSettings(patch) {
    const next = normalizeSettings({ ...settings, ...patch });
    settings = next;
    await saveSettings(settings);

    // 关掉气泡时把在放的内容一起收掉，否则会留一句停在屏幕上。
    if (!settings.bubbles) clearBubble();

    if (!settings.enabled) {
      await stopBridge();
    } else if (bridge === null) {
      await startBridge();
    } else {
      bridge.send({
        t: 'config',
        scale: settings.scale,
        lookAtCursor: settings.lookAtCursor,
        bubbles: settings.bubbles,
      });
    }
    return settings;
  }

  /** 执行一条桌宠命令；RPC 与右键菜单共用。 */
  async function handleCommand(action) {
    switch (action) {
      case 'greeting':
        signal('greeting');
        return;
      case 'reset-position':
        settings = { ...settings, position: null };
        await saveSettings(settings);
        bridge?.send({ t: 'reset-position' });
        return;
      case 'reload':
        bridge?.send({ t: 'reload' });
        return;
      case 'restart':
        await stopBridge();
        await startBridge();
        return;
      case 'disable':
        settings = await updateSettings({ enabled: false });
        return;
      case 'open-settings':
        // 打开设置页的通用分区，用户可以直接看到这张卡。
        try {
          ctx.get('commands')?.execute?.('settings');
        } catch {
          logger.info?.('桌宠设置位于 设置 → 通用 → 桌宠');
        }
        return;
      default:
        throw new Error(`未知命令：${action}`);
    }
  }

  // ── RPC：设置卡 ─────────────────────────────────────────────────────────
  //
  // 这里用 `ctx.webServer.register` 自己注册路由，而不是 `ctx.connection.rpc.handle`。
  //
  // 原因：`rpc.handle()` 内部执行 `owner.webServer.register(...)`，而 owner 是
  // connection 服务自己的上下文（该插件只 inject 了 `credentials`），
  // 在第三方插件里这条路径注册不上 —— 请求会落到静态兜底处理器并返回 HTTP 405。
  //
  // 因此按官方给插件自注册路由的模板来：自己注册、自己问鉴权、自己组装
  // connection 的 RPC 信封。客户端仍可用 `connection.rpc.call`，协议不变。
  // 信封形状来自 dsh-client-connection 的共享契约：
  //   请求  { type: 'client-request', rpcId, method, payload }
  //   响应  { type: 'server-response', rpcId, result: { ok: true, value } | { ok: false, error } }

  /** 读取请求体，带容量上限。 */
  function readBody(req, limit = 64 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error('请求体过大'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /** 端点分发（RPC 与右键菜单共用同一套命令）。 */
  async function dispatch(endpoint, payload) {
    try {
      switch (endpoint) {
        case 'getState':
          return {
            ok: true,
            value: {
              settings,
              limits: LIMITS,
              runtime: {
                running: bridge !== null && bridge.running,
                ready: readyInfo !== null,
                pid: readyInfo?.pid ?? null,
                error: lastError,
                lastExit,
              },
              animation: pet.current(),
            },
          };
        case 'updateSettings':
          return { ok: true, value: { settings: await updateSettings(payload ?? {}) } };
        case 'command': {
          const action = String(payload?.action ?? '');
          try {
            await handleCommand(action);
          } catch (error) {
            return {
              ok: false,
              error: {
                code: 'pet/unknown-command',
                message: error instanceof Error ? error.message : String(error),
                details: {},
              },
            };
          }
          return { ok: true, value: { animation: pet.current(), settings } };
        }
        default:
          return {
            ok: false,
            error: { code: 'pet/unknown-endpoint', message: `未知端点：${endpoint}`, details: {} },
          };
      }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'pet/internal',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      };
    }
  }

  let routeDisposer = null;
  try {
    routeDisposer = ctx.webServer.register({
      kind: 'prefix',
      path: RPC_CHANNEL,
      handler: async (req, res) => {
        // 1) 鉴权。官方要求插件自注册的每条路由都先问一次 connection：
        //    它的 Host/Origin 栅栏挡 DNS rebinding 与跨站调用，
        //    浏览器会话 cookie 才是真正的通行证。
        const rejection = ctx.connection?.requestRejection?.(req);
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }

        // 2) 只接受 POST。
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' });
          res.end();
          return;
        }

        const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
        const prefix = `${RPC_CHANNEL}/`;
        if (!pathname.startsWith(prefix)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const endpoint = pathname.slice(prefix.length);

        // 3) 解析信封并回包。无论业务成功与否都返回 HTTP 200 ——
        //    错误通过信封里的 `result.ok === false` 传递。
        let rpcId = '';
        let result;
        try {
          const body = JSON.parse(await readBody(req));
          rpcId = typeof body?.rpcId === 'string' ? body.rpcId : '';
          result = await dispatch(endpoint, body?.payload);
        } catch (error) {
          result = {
            ok: false,
            error: {
              code: 'pet/bad-request',
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
          };
        }

        const json = JSON.stringify({ type: 'server-response', rpcId, result });
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(json);
      },
    });
  } catch (error) {
    logger.warn?.('桌宠设置卡 RPC 注册失败：%s', error instanceof Error ? error.message : String(error));
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────

  ctx.effect(() => () => {
    if (routeDisposer !== null) routeDisposer();
    if (flushTimer !== null) clearTimeout(flushTimer);
    void stopBridge();
  }, 'deskpet: lifecycle');

  // 启动：迁移旧目录 → 读设置 → 清扫遗留进程 → 起窗口。
  // 全链路异步且失败不影响 DSH 启动。
  void (async () => {
    // 先迁移：旧项目名留下的设置与 Electron 运行时都在同一个目录里。
    await migrateLegacyHome({ logger });
    settings = await loadSettings();
    if (!settings.enabled) return;
    // 先收拾上一次运行可能留下的无主窗口，再起新的。
    await sweepOrphanHelpers({ helperDir, logger });
    await startBridge();
  })().catch((error) => {
    logger.warn?.('桌宠启动失败：%s', error instanceof Error ? error.message : String(error));
  });
}

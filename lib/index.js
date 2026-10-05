/**
 * dsh-cyberwhale · 宿主半插件
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
 * @module dsh-cyberwhale
 */

import { join } from 'node:path';

import { createStatusTracker } from './activity.js';
import { PetBridge } from './bridge.js';
import { probeElectron, pluginRoot } from './electron-runtime.js';
import { provisionElectron } from './electron-provision.js';
import { sweepOrphanHelpers } from './orphans.js';
import { DEFAULT_SETTINGS, LIMITS, loadSettings, normalizeSettings, saveSettings } from './settings.js';
import { createPetState } from './state.js';
import { createAppearanceStore } from './appearance.js';

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
  const appearance = createAppearanceStore();
  const assetsDir = join(pluginRoot, 'assets');
  const helperDir = join(pluginRoot, 'helper');

  const pet = createPetState();
  let settings = normalizeSettings(DEFAULT_SETTINGS);
  let bridge = null;
  let flushTimer = null;
  let flushAt = 0;
  let lastSent = null;
  let restartAnimation = false;
  let lastError = null;
  let lastExit = null;
  let readyInfo = null;
  let bubbleGlassInfo = null;
  // 上一次运行时探测的错误码：设置页据此判断「该不该引导用户准备运行时」。
  let lastRuntimeCode = null;
  let disposed = false;
  let startTask = null;
  let startRevision = 0;
  let orphanSweep = null;
  const settingsLoaded = loadSettings().then((loaded) => {
    if (!disposed) settings = loaded;
  });

  const logger = ctx.logger ?? console;

  /** 归一化后的信号 → 应用 + 惰性下发。 */
  function signal(kind) {
    if (!pet.apply(kind)) return;
    if (kind === 'greeting') restartAnimation = true;
    scheduleFlush();
  }

  /**
   * 安排一次状态下发。
   *
   * 允许真实状态变化提前替换瞬态回落的定时器，避免等待动画播完才更新。
   */
  function scheduleFlush(delayMs = STATE_FLUSH_MS) {
    if (disposed) return;
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
    if (disposed || bridge === null || !bridge.ready) return;
    const current = pet.current();
    if (current !== lastSent || restartAnimation) {
      if (bridge.send({ t: 'state', v: current, ...(restartAnimation ? { restart: true } : {}) })) {
        lastSent = current;
        restartAnimation = false;
      }
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
    if (bubbleTimer !== null) clearTimeout(bubbleTimer);
    bubbleTimer = null;
    if (settings.bubbles === false) return;
    const payload = bubblePayload();
    const key = `${payload.title}\u0000${payload.status}`;
    if (key === bubbleSent) return;
    if (disposed || bridge === null || !bridge.ready) return;
    if (bridge.send({ t: 'bubble', title: payload.title, status: payload.status })) bubbleSent = key;
  }

  /** 安排一次气泡下发；`0` 表示立刻（换轮与清空用）。 */
  function scheduleBubble(delayMs = BUBBLE_SETTLE_MS) {
    if (disposed) return;
    if (bubbleTimer !== null) {
      if (delayMs !== 0) return; // 已有待发就够了
      clearTimeout(bubbleTimer);
    }
    bubbleTimer = setTimeout(flushBubble, delayMs);
    bubbleTimer.unref?.();
  }

  /**
   * 立刻清空实时层，待机时隐藏气泡。
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
    if (disposed || bridge === null || !bridge.ready) return;
    if (bridge.send({ t: 'bubble', title: '', status: '' })) bubbleSent = '\u0000';
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

  /**
   * 运行时准备任务的进度快照（设置页直接读它）。
   *
   * 为什么是一个被就地改写的对象而不是每次新建：`getState` 每次序列化一份
   * 副本发出去，进度只有几个数字，没必要做不可变结构。
   */
  const runtimePrepare = {
    status: 'idle', // idle | running | done | failed
    phase: null,
    received: 0,
    total: 0,
    source: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    /**
     * 步骤流水：每一步在它第一次出现时追加，上一步自动收尾。
     *
     * 形状对齐官方（语音输入）的准备模型 —— 下载步报字节，其他步报耗时，
     * 界面据此画「当前步骤摘要 + 可展开的完整步骤列表」。
     * 只记真实发生过的步骤：缓存命中时根本不会下载，预置固定步骤表会留下
     * 一堆永远「未开始」的假步骤。
     */
    steps: [],
  };

  /** 正在跑的准备工作（含取消用的 controller）；没有任务时为 null。 */
  let runtimeTask = null;
  let runtimeAbort = null;

  /** 进度 phase → 步骤 kind。同一 phase 的连续上报属于同一步。 */
  const STEP_OF_PHASE = {
    checking: 'check',
    cached: 'check',
    downloading: 'download',
    verifying: 'verify',
    extracting: 'extract',
  };

  /** 收尾当前步骤（已经是终态就什么都不做）。 */
  function finishCurrentStep(status = 'done', error = null) {
    const current = runtimePrepare.steps[runtimePrepare.steps.length - 1];
    if (current === undefined || current.status !== 'running') return;
    current.status = status;
    current.error = error;
    current.finishedAt = Date.now();
  }

  /** 把一次进度上报推进成步骤流水。 */
  function advancePrepareSteps(progress) {
    if (progress.phase === 'ready') {
      finishCurrentStep();
      return;
    }
    const kind = STEP_OF_PHASE[progress.phase];
    if (kind === undefined) return;

    const current = runtimePrepare.steps[runtimePrepare.steps.length - 1];
    if (current !== undefined && current.kind === kind) {
      // 同一步的进度更新
      if (Number.isFinite(progress.received)) current.received = progress.received;
      if (Number.isFinite(progress.total)) current.total = progress.total;
      return;
    }
    finishCurrentStep();
    runtimePrepare.steps.push({
      kind,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      received: Number.isFinite(progress.received) ? progress.received : 0,
      total: Number.isFinite(progress.total) ? progress.total : 0,
      error: null,
    });
  }

  /**
   * 在后台准备运行时，立刻返回。
   *
   * 为什么不 await 完成：要下 100+MB，几分钟起步。若让 RPC 等它跑完，
   * 设置页会一直转圈，中途刷新页面就再也看不到进度了 —— 所以端点只负责
   * 起任务，进度由设置页轮询 `getState` 读取。
   */
  function startRuntimePrepare(payload) {
    if (runtimeTask !== null) return; // 已在跑：沿用当前任务，别起第二个下载

    const controller = new AbortController();
    runtimeAbort = controller;
    Object.assign(runtimePrepare, {
      status: 'running',
      phase: 'checking',
      received: 0,
      total: 0,
      source: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
      steps: [],
    });

    runtimeTask = (async () => {
      try {
        const result = await provisionElectron({
          version: payload?.version,
          mirror: payload?.mirror,
          // 下载源来自设置页；settings 已在启动时加载，这里读的是最新值。
          source: settings.runtimeSource,
          force: payload?.force === true,
          signal: controller.signal,
          onProgress: (progress) => {
            // 取消/卸载后迟到的进度不该再改状态 —— 那时任务已经落定成 idle 了。
            if (runtimePrepare.status !== 'running') return;
            runtimePrepare.phase = progress.phase;
            if (Number.isFinite(progress.received)) runtimePrepare.received = progress.received;
            if (Number.isFinite(progress.total)) runtimePrepare.total = progress.total;
            if (progress.source !== undefined) runtimePrepare.source = progress.source;
            advancePrepareSteps(progress);
          },
        });

        runtimePrepare.status = 'done';
        runtimePrepare.phase = 'ready';
        runtimePrepare.source = result.source;
        runtimePrepare.error = null;
        runtimePrepare.finishedAt = Date.now();
        finishCurrentStep();
        lastError = null;
        lastRuntimeCode = null;
        logger.info?.('桌宠运行时已就绪：%s', result.binary);

        // 之前因为缺运行时没起来的窗口在这里补上 —— 用户点一次就该看到鲸鱼，
        // 不需要重启 DSH。窗口起不来不该把「准备成功」改写成失败。
        if (settings.enabled) {
          try {
            await stopBridge();
            await startBridge();
          } catch (error) {
            logger.warn?.(
              '运行时已就绪，但重启桌宠窗口失败：%s',
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      } catch (error) {
        // 用户取消不算失败：状态回到 idle，设置页的按钮也回到「准备运行时」。
        const aborted = controller.signal.aborted === true || error?.code === 'provision-aborted';
        runtimePrepare.status = aborted ? 'idle' : 'failed';
        runtimePrepare.phase = aborted ? null : runtimePrepare.phase;
        runtimePrepare.error = aborted ? null : error instanceof Error ? error.message : String(error);
        runtimePrepare.finishedAt = Date.now();
        // 步骤也要落定：失败停在失败那一步（带原因），取消标成已取消 ——
        // 否则步骤列表会永远停在「进行中」，看起来像还在跑。
        finishCurrentStep(aborted ? 'cancelled' : 'failed', aborted ? null : runtimePrepare.error);
        if (!aborted) logger.warn?.('桌宠运行时准备失败：%s', runtimePrepare.error);
      } finally {
        runtimeTask = null;
        runtimeAbort = null;
      }
    })();
  }

  /** 取消在跑的准备任务；真正的清理（临时目录、状态落定）在那个任务里完成。 */
  function cancelRuntimePrepare() {
    runtimeAbort?.abort();
    return runtimePrepare;
  }

  function startBridge() {
    if (disposed || bridge !== null || !settings.enabled) return Promise.resolve();
    if (startTask !== null) return startTask;
    const revision = startRevision;
    const task = launchBridge(revision);
    startTask = task;
    const settled = () => { if (startTask === task) startTask = null; };
    task.then(settled, settled);
    return task;
  }

  async function launchBridge(revision) {
    // 清扫也纳入启动锁，避免设置卡提前开启时被启动清扫误杀。
    orphanSweep ??= sweepOrphanHelpers({ helperDir, logger });
    await orphanSweep;
    if (disposed || !settings.enabled || revision !== startRevision) return;

    // 只解析一次运行时：解析可能包含从本地缓存解包（上百 MB），
    // 重复调用会让启动时间翻倍。
    const runtime = await probeElectron();
    if (disposed || !settings.enabled || revision !== startRevision) return;
    if (!runtime.ok) {
      // 记录错误码：`missing-runtime` 才代表「本机没装」，也就是设置页该
      // 显示「准备运行时」的那种情况。
      lastRuntimeCode = typeof runtime.code === 'string' ? runtime.code : 'runtime-error';
      lastError = runtime.error;
      logger.warn?.('桌宠暂时不可用：%s', runtime.error);
      return;
    }
    lastError = null;
    lastRuntimeCode = null;

    const candidate = new PetBridge({
      ctx,
      electron: runtime.binary,
      helperDir,
      assetsDir,
      settings: () => settings,
      onStatus: (info) => {
        if (disposed || bridge !== candidate) return;
        if (info.kind === 'ready') {
          readyInfo = { pid: info.pid ?? null, at: Date.now() };
          lastExit = null;
          lastSent = null;
          bubbleSent = null;
          candidate.send({ t: 'config', scale: settings.scale, lookAtCursor: settings.lookAtCursor, bubbles: settings.bubbles, bubbleGlass: settings.bubbleGlass });
          flush();
          flushBubble();
          return;
        }
        if (info.kind === 'exit') {
          readyInfo = null;
          bubbleGlassInfo = null;
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
        if (message.t === 'bubble-glass') {
          bubbleGlassInfo = { supported: message.supported === true, active: message.active === true,
            reason: typeof message.reason === 'string' ? message.reason : null };
          return;
        }
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
    bridge = candidate;
    bridge.start();
    lastSent = null;
    // 助手刚起来时窗口里什么都没有，去重键要清掉，否则当前状态发不出去。
    bubbleSent = null;
    scheduleFlush();
    scheduleBubble(0);
  }

  async function stopBridge() {
    startRevision += 1;
    startTask = null;
    const current = bridge;
    bridge = null;
    lastSent = null;
    readyInfo = null;
    bubbleGlassInfo = null;
    if (current !== null) await current.dispose();
  }

  /**
   * 应用一份新设置（归一化 + 落盘 + 按需起停或热下发）。
   *
   * 只有 `enabled` 会动到进程生命周期。缩放走「窗口就地改尺寸」而不是重启进程：
   * 既不闪烁，也不可能产生多余进程 —— 重启进程那条路径只在「重启窗口」命令里保留。
   */
  async function updateSettings(patch) {
    await settingsLoaded;
    if (disposed) throw new Error('桌宠插件已卸载');
    const bubblesWereEnabled = settings.bubbles;
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
      if (bridge.ready) bridge.send({
        t: 'config',
        scale: settings.scale,
        lookAtCursor: settings.lookAtCursor,
        bubbles: settings.bubbles,
        bubbleGlass: settings.bubbleGlass,
      });
    }
    if (!bubblesWereEnabled && settings.bubbles) {
      bubbleSent = null;
      scheduleBubble(0);
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
        case 'getAppearance':
          return { ok: true, value: await appearance.get() };
        case 'updateAppearance':
          return { ok: true, value: await appearance.update(payload) };
        case 'uploadWallpaper':
          return { ok: true, value: await appearance.upload(payload) };
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
                bubbleGlass: bubbleGlassInfo,
                error: lastError,
                lastExit,
                // 只有「本机确实没有运行时」才引导用户去准备（下 100+MB）；
                // 路径写错之类的失败应该显示原因，而不是给一个没用的按钮。
                provisionable: lastRuntimeCode === 'missing-runtime',
                prepare: { ...runtimePrepare },
              },
              animation: pet.current(),
            },
          };
        case 'updateSettings':
          return { ok: true, value: { settings: await updateSettings(payload ?? {}) } };
        case 'prepareRuntime':
          // 立即返回当前快照（可能刚起任务，也可能已在跑）；下载在后台继续。
          startRuntimePrepare(payload ?? {});
          return { ok: true, value: { prepare: { ...runtimePrepare } } };
        case 'cancelRuntime':
          cancelRuntimePrepare();
          return { ok: true, value: { prepare: { ...runtimePrepare } } };
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

        const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
        if (req.method === 'GET' && pathname.startsWith(`${RPC_CHANNEL}/appearance/wallpaper/`)) {
          try {
            const image = await appearance.image(pathname.slice(`${RPC_CHANNEL}/appearance/wallpaper/`.length));
            if (!image) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'content-type': image.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
            res.end(image.bytes);
          } catch { res.writeHead(500); res.end(); }
          return;
        }

        // 2) RPC 只接受 POST；图片资源同样先通过上面的鉴权。
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' });
          res.end();
          return;
        }

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
          const body = JSON.parse(await readBody(req, endpoint === 'uploadWallpaper' ? 3 * 1024 * 1024 : 64 * 1024));
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
    disposed = true;
    // 先取消在跑的运行时准备：否则下载会在卸载后继续，还可能把运行时装进
    // 一个已经被用户卸掉的插件目录。任务自己会删掉临时文件，这里等它收尾。
    const pending = runtimeTask;
    runtimeAbort?.abort();
    if (bubbleTimer !== null) clearTimeout(bubbleTimer);
    if (routeDisposer !== null) routeDisposer();
    if (flushTimer !== null) clearTimeout(flushTimer);
    return Promise.all([
      stopBridge(),
      pending === null ? undefined : pending.then(() => {}, () => {}),
    ]);
  }, 'deskpet: lifecycle');

  // 启动：读设置 → 清扫遗留进程 → 起窗口。
  // 全链路异步且失败不影响 DSH 启动。
  void (async () => {
    await settingsLoaded;
    if (disposed || !settings.enabled) return;
    await startBridge();
  })().catch((error) => {
    logger.warn?.('桌宠启动失败：%s', error instanceof Error ? error.message : String(error));
  });
}

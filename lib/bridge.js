/**
 * 助手进程桥：用 `ctx.subprocess` 拉起 Electron 桌宠窗口，并维护一条
 * stdin/stdout 的 JSON Lines 协议。
 *
 * 为什么走 stdio 而不是 HTTP/WS：
 * - 零端口、零鉴权、无 macOS ATS 问题；
 * - DSH 宿主退出、插件卸载时 `ctx.subprocess` 会回收受管子进程，
 *   宠物因此天然随应用退出；
 * - 宿主异常死亡时子进程的 stdin 会 EOF，助手据此自退，不会留下孤儿窗口。
 *
 * Windows 的下行通道（宿主 → 助手）不用 stdin：
 *   Chromium 在 GUI 进程启动阶段会重置/关闭继承来的 fd 0 —— 真机实测
 *   `process.stdin` 在 helper 里立刻 EOF（宿主写多少都到不了）。
 *   因此 Windows 上改走 subprocess seam 官方提供的 control pipe（fd 7）：
 *   spec 里声明 `stdio.control = 'pipe'`，宿主侧拿到 `handle.control` Duplex，
 *   助手侧按官方 `openInheritedControlChannel()` 的同一实现打开 fd 7。
 *   上行（助手 → 宿主）继续用 stdout —— 真机实测可用，渲染日志也走它。
 *   生命周期语义不变：宿主消失 → control 端点被销毁 → 助手读到 EOF → 自退。
 *
 * @module dsh-cyberwhale/bridge
 */

import { createInterface } from 'node:readline';

/** 一条消息的最大长度，防御性上限。 */
const MAX_LINE_BYTES = 64 * 1024;

/** 重启退避（毫秒）。 */
const RESTART_BACKOFF_MS = [0, 1000, 3000, 8000, 20000];

/** 是否使用控制管道作为下行通道（见文件头）。 */
const USE_CONTROL_CHANNEL = process.platform === 'win32';

/**
 * @typedef {object} BridgeOptions
 * @property {object} ctx            cordis 上下文
 * @property {string} electron       Electron 可执行文件绝对路径
 * @property {string} helperDir      助手应用目录
 * @property {string} assetsDir      素材目录（pet.json + spritesheet）
 * @property {() => object} settings 读取当前设置
 * @property {(event: object) => void} [onMessage] 助手主动上报的消息
 * @property {(info: object) => void} [onStatus]   状态变化回调（ready/exit/error）
 */

/**
 * 管理助手进程的生命周期与协议。
 */
export class PetBridge {
  #ctx;
  #electron;
  #helperDir;
  #assetsDir;
  #settings;
  #onMessage;
  #onStatus;
  #handle = null;
  #reader = null;
  /** 所有已 spawn 且尚未确认退出的 handle —— dispose 的兜底依据。 */
  #live = new Set();
  #disposed = false;
  #restarts = 0;
  #restartTimer = null;
  #ready = false;

  constructor(options) {
    this.#ctx = options.ctx;
    this.#electron = options.electron;
    this.#helperDir = options.helperDir;
    this.#assetsDir = options.assetsDir;
    this.#settings = options.settings;
    this.#onMessage = options.onMessage ?? (() => {});
    this.#onStatus = options.onStatus ?? (() => {});
  }

  get running() {
    return this.#handle !== null;
  }

  get ready() {
    return this.#ready;
  }

  /** 拉起助手进程。重复调用是安全的。 */
  start() {
    if (this.#disposed || this.#handle !== null) return;
    const settings = this.#settings();

    let handle;
    try {
      handle = this.#ctx.subprocess.spawn({
        argv: [
          this.#electron,
          this.#helperDir,
          `--assets=${this.#assetsDir}`,
          `--scale=${settings.scale}`,
          `--look-at-cursor=${settings.lookAtCursor ? '1' : '0'}`,
          `--bubbles=${settings.bubbles ? '1' : '0'}`,
          `--bubble-glass=${settings.bubbleGlass ? '1' : '0'}`,
          ...(settings.rememberPosition && settings.position !== null
            ? [`--x=${settings.position.x}`, `--y=${settings.position.y}`]
            : []),
        ],
        cwd: this.#helperDir,
        stdio: {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          ...(USE_CONTROL_CHANNEL ? { control: 'pipe' } : {}),
        },
        // 助手是 GUI 进程：给足优雅退出的时间，避免窗口残留。
        graceMs: 4000,
        env: {
          // ── 关键 ────────────────────────────────────────────────────────
          // 宿主自己是以 `ELECTRON_RUN_AS_NODE=1` 启动的（Desktop Host 跑在
          // Electron 的 Node 模式里），这个变量会被子进程原样继承 —— 结果是我们的
          // Electron 也进了 Node 模式，`require('electron')` 直接失败，窗口根本不会出现。
          // 在 dsh-subprocess-local 的 childEnv() 里，`undefined` 是「墓碑」语义，
          // 会把继承来的那一项真正删掉。
          ELECTRON_RUN_AS_NODE: undefined,
          // 同一个坑的其它变体，一并清掉。
          ELECTRON_NO_ATTACH_CONSOLE: undefined,
          ELECTRON_FORCE_IS_PACKAGED: undefined,
          ELECTRON_ENABLE_LOGGING: undefined,
          // 标记这个 Electron 实例是桌宠助手。
          DSH_DESKPET_HELPER: '1',
        },
      });
    } catch (error) {
      this.#report({ kind: 'spawn-failed', error: String(error) });
      return;
    }

    this.#handle = handle;
    this.#ready = false;
    this.#attach(handle);
  }

  /**
   * 接管一个刚 spawn 出来的子进程。
   *
   * 关键：退出回调必须绑定到「这一个」handle。
   * `restart()` 是先杀旧、再起新，而旧进程的 `done` 要到之后才 resolve ——
   * 如果回调无条件地清 `#handle` 并安排重启，就会把**新**进程的引用清掉、
   * 再额外起一个，于是每改一次设置就多一只桌宠，且旧引用丢失后再也杀不掉。
   */
  #attach(handle) {
    this.#live.add(handle);
    const isCurrent = () => this.#handle === handle;

    const stdout = createInterface({ input: handle.stdout, crlfDelay: Infinity });
    stdout.on('line', (line) => {
      if (!isCurrent()) return; // 已被替换的旧进程：它的输出一律丢弃
      if (line.length === 0 || line.length > MAX_LINE_BYTES) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return; // 助手可能把库的杂项日志混进 stdout，忽略即可
      }
      if (message?.t === 'log') {
        const level = message.level === 'error' ? 'warn' : 'debug';
        this.#ctx.logger?.[level]?.('[deskpet/renderer] %s', String(message.msg ?? ''));
        return;
      }
      if (message?.t === 'ready') {
        this.#ready = true;
        this.#restarts = 0;
        this.#report({ kind: 'ready', pid: message.pid });
        return;
      }
      this.#onMessage(message);
    });

    const stderr = createInterface({ input: handle.stderr, crlfDelay: Infinity });
    stderr.on('line', (line) => {
      if (line.trim() !== '') this.#ctx.logger?.debug?.('[deskpet/helper] %s', line);
    });

    /** 收尾。只有「当前进程」才报告状态并触发自动重启。 */
    const settle = (info) => {
      this.#live.delete(handle);
      stdout.close();
      stderr.close();
      if (!isCurrent()) return; // 被主动换掉的旧进程：不报告、不重启
      this.#handle = null;
      this.#ready = false;
      this.#report(info);
      this.#scheduleRestart();
    };

    handle.done.then(
      (outcome) => settle({ kind: 'exit', outcome }),
      (error) => settle({ kind: 'error', error: String(error) }),
    );
  }

  #scheduleRestart() {
    if (this.#disposed || this.#restartTimer !== null) return;
    if (!this.#settings().enabled) return;
    const delay = RESTART_BACKOFF_MS[Math.min(this.#restarts, RESTART_BACKOFF_MS.length - 1)];
    this.#restarts += 1;
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      this.start();
    }, delay);
    this.#restartTimer.unref?.();
  }

  #report(info) {
    this.#onStatus(info);
    if (info.kind === 'ready') {
      this.#ctx.logger?.info?.('桌宠窗口已就绪 (pid=%s, source=%s)', info.pid, this.#electron);
    } else if (info.kind === 'exit') {
      this.#ctx.logger?.debug?.('桌宠窗口退出：%o', info.outcome);
    } else {
      this.#ctx.logger?.warn?.('桌宠助手异常：%s', info.error ?? info.kind);
    }
  }

  /**
   * 宿主 → 助手的下行流。
   *
   * Windows 用 `handle.control`（控制管道），其余平台用 stdin —— 原因见文件头。
   * 控制管道在两种受管模式下都可用（Windows Job runner 与 fallback 的 Node spawn
   * 都会在请求 `stdio.control === 'pipe'` 时分配 fd 7）。
   */
  #outbound(handle = this.#handle) {
    if (handle === null) return null;
    if (USE_CONTROL_CHANNEL && handle.control !== undefined && handle.control !== null) return handle.control;
    return handle.stdin ?? null;
  }

  /** 发送一条消息给助手。进程不在时静默丢弃。 */
  send(message) {
    const stream = this.#outbound();
    if (stream === null || stream.destroyed === true) return false;
    try {
      stream.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  /** 重启助手：先停掉当前进程，再起一个新的。 */
  restart() {
    this.#restarts = 0;
    this.#stopChild();
    this.start();
  }

  /** 礼貌结束一个子进程：先请它自退，再交给受管终止。 */
  #terminate(handle, { graceful = true } = {}) {
    if (graceful) {
      const stream = this.#outbound(handle);
      try {
        stream?.write?.(`${JSON.stringify({ t: 'quit' })}\n`);
      } catch {
        // 管道已关闭
      }
    }
    try {
      handle.stdin?.end?.();
    } catch {
      // 已关闭
    }
    try {
      handle.terminate();
    } catch {
      // 已经退出
    }
  }

  #stopChild() {
    const handle = this.#handle;
    this.#handle = null;
    this.#ready = false;
    if (handle === null) return;
    this.#terminate(handle);
  }

  /**
   * 释放：停子进程、清定时器。
   *
   * 除了优雅地请当前进程退出，还会**兜底扫掉所有仍活着的受管进程** ——
   * 即便前面哪一步漏了，也不会在桌面上留下无主的桌宠窗口。
   */
  async dispose() {
    this.#disposed = true;
    if (this.#restartTimer !== null) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }

    const handle = this.#handle;
    this.#handle = null;
    this.#ready = false;

    if (handle !== null) {
      try {
        this.#outbound(handle)?.write?.(`${JSON.stringify({ t: 'quit' })}\n`);
      } catch {
        // 管道已关闭
      }
      try {
        await handle.waitForExit(AbortSignal.timeout(4000));
      } catch {
        // 超时：交给下面的兜底
      }
    }

    for (const leftover of [...this.#live]) {
      this.#terminate(leftover, { graceful: false });
    }
    this.#live.clear();
  }
}

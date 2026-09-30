'use strict';

// 几何计算全部来自纯模块 `geometry.js`，可被单元测试覆盖。
// 位置限制这类逻辑埋在 main.js 里时只能靠肉眼看，"拖不上去"的 bug 就一直没被发现。
//
// 必须放在文件最前面：这是 `const` 解构，有 TDZ —— 一旦写在任何使用之后，
// 整个助手进程会启动即崩（`Cannot access 'clamp' before initialization`）。
// 纯单元测试抓不到这种问题，只有真机启动能发现。
const {
  CELL,
  MARGIN,
  BUBBLE_SPACE,
  ENVELOPE_SCALE,
  clamp,
  computeMetrics,
  clampToArea,
  petRectInWindow,
} = require('./geometry.js');


/**
 * dsh-deskpet 助手进程（Electron 主进程）。
 *
 * 这个进程由 DSH 的宿主插件通过 `ctx.subprocess.spawn` 拉起，唯一职责是
 * 创建一个「透明 / 无边框 / 永远置顶 / 可点击穿透 / 跨所有 Space」的窗口，
 * 并把宿主下发的 JSON Lines 状态转给渲染进程。
 *
 * 窗口参数参考了 Codex Desktop 与 dsh-pet(MIT) 的公开实现：
 *   - macOS 用 `type: 'panel'` 拿到 NSPanel（点它不抢走编辑器焦点）
 *   - `setAlwaysOnTop(true, 'floating')` + `setVisibleOnAllWorkspaces`
 *   - 点击穿透用三态策略，默认整窗穿透，只有宠物身体上才接管
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, nativeTheme, screen } = require('electron');

// ── 进程外观：不进 Dock、不进 Cmd+Tab ──────────────────────────────────────
// 这两步是整个方案里唯一能解决「Electron 进程会在 Dock 留图标」的地方。
try {
  if (typeof app.setActivationPolicy === 'function') app.setActivationPolicy('accessory');
} catch {
  /* 旧版本 Electron 没有这个 API */
}
try {
  app.dock?.hide?.();
} catch {
  /* 非 macOS */
}

// ── 参数解析 ──────────────────────────────────────────────────────────────
function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit === undefined ? fallback : hit.slice(prefix.length);
}

const assetsDir = readArg('assets', path.join(__dirname, '..', 'assets'));
/** 当前缩放。可以运行期改变（设置页调整大小时就地改窗口尺寸，不重启进程）。 */
let scale = clamp(Number(readArg('scale', '1')) || 1, 0.45, 1.6);
const lookAtCursor = readArg('look-at-cursor', '1') === '1';
const bubbles = readArg('bubbles', '1') === '1';
const startX = Number(readArg('x', 'NaN'));
const startY = Number(readArg('y', 'NaN'));


let metrics = computeMetrics(ENVELOPE_SCALE);

/**
 * 改变缩放。
 *
 * 窗口尺寸**保持不变** —— 只把新的缩放值告诉渲染进程，由它把宠物画大/画小，
 * 并用缓动做成「长大」而不是「跳一下」。
 *
 * 为什么不改窗口尺寸：透明窗口每次改尺寸，macOS 都要重新分配绘制表面，
 * 重建期间的那一帧会以不透明方式合成，压在下面的窗口会暗一下。
 * 不再改尺寸，这个现象就没有了。
 */
function applyScale(next) {
  const clamped = clamp(Number(next) || 1, 0.45, ENVELOPE_SCALE);
  if (Math.abs(clamped - scale) < 0.001) return;

  scale = clamped;
  emitLayout();
  // 窗口几何没变，但把当前缩放回报给宿主，设置页与调试都用得上。
  // 转发给渲染进程由 dispatch 的 config 分支统一负责（只发一次）。
  toHost({ t: 'metrics', scale, ...metrics });
}

/** @type {BrowserWindow | null} */
let win = null;
/** 当前是否已把窗口切成「可交互」。 */
let interactive = false;
/** 拖拽状态。 */
let drag = null;
/** 最近一次上报给宿主的位置，避免刷屏。 */
let lastReported = null;

// ── 与宿主的 stdio JSON Lines 协议 ─────────────────────────────────────────
function toHost(message) {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch {
    /* stdout 已关闭：宿主没了，进程即将自退 */
  }
}

// ── 窗口 ──────────────────────────────────────────────────────────────────
function defaultPosition() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;
  return {
    x: area.x + area.width - metrics.width - 24,
    y: area.y + area.height - metrics.height - 24,
  };
}

/**
 * 就地把窗口位置限制到「宠物完整落在工作区内」。
 *
 * 找哪块屏幕与具体几何限制分别由 `screen` 与 `geometry.clampToArea` 负责 ——
 * 后者是纯函数，所以限制逻辑本身有单元测试盯着（这个 bug 当初就是这么漏掉的）。
 */
function clampToDisplay(x, y) {
  const area = screen.getDisplayNearestPoint({ x, y }).workArea;
  return clampToArea(x, y, metrics, scale, area);
}

function createWindow() {
  const initial =
    Number.isFinite(startX) && Number.isFinite(startY) ? clampToDisplay(startX, startY) : defaultPosition();

  win = new BrowserWindow({
    width: metrics.width,
    height: metrics.height,
    x: initial.x,
    y: initial.y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // macOS：NSPanel，点它不会把我们的应用激活到前台，也不会抢编辑器焦点。
    ...(process.platform === 'darwin' ? { type: 'panel', enableLargerThanScreen: true } : {}),
    // 允许第一下点击就落到窗口里（非激活状态下也能拖）。
    ...(process.platform === 'darwin' ? { acceptFirstMouse: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    win.setVisibleOnAllWorkspaces(true);
  }
  win.setMenuBarVisibility(false);
  // 默认整窗点击穿透；只有宠物身体上才接管鼠标。
  win.setIgnoreMouseEvents(true, { forward: true });
  interactive = false;

  win.once('ready-to-show', () => {
    win.showInactive();
    startCursorTracking();
    emitLayout();
    // 带上窗口的**实际**位置：`clampToDisplay` 之后系统可能不完全照办，
    // 排「拖不上去」这类问题时，有这个值才能分清是限制算错了还是系统不认。
    const [actualX, actualY] = win.getPosition();
    toHost({
      t: 'ready',
      pid: process.pid,
      scale,
      metrics,
      x: actualX,
      y: actualY,
      platform: process.platform,
      electron: process.versions.electron,
    });
  });

  win.on('closed', () => {
    win = null;
  });

  win.on('moved', reportPosition);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/** 位置上报（防抖：拖动时窗口会连续 move，不能每次都写 stdout）。 */
let reportTimer = null;

/**
 * 把「工作区在窗口坐标系里的矩形」发给渲染层。
 *
 * 气泡靠它决定：头顶放不下就翻到脚底；贴屏幕左边就往右让。
 * 只发屏幕几何，不发像素 —— 气泡的实际摆放由渲染层算（它才知道气泡多大）。
 *
 * 节流 120ms：拖动时每帧都发没必要，但也不能太慢，否则气泡会让位不及时。
 */
let layoutTimer = null;

function emitLayout() {
  if (layoutTimer !== null) return;
  layoutTimer = setTimeout(() => {
    layoutTimer = null;
    if (win === null || win.isDestroyed()) return;
    const [wx, wy] = win.getPosition();
    const center = { x: wx + Math.round(metrics.width / 2), y: wy + Math.round(metrics.height / 2) };
    const area = screen.getDisplayNearestPoint(center).workArea;
    // 宠物在窗口里的底边位置由**主进程**决定并下发。
    // 为什么不让渲染层自己算：窗口是按最大档位预留的，宠物不在窗口底部，
    // 两处各算一遍是重复事实来源 —— 曾经就是这里对不上，导致主进程以为宠物
    // 在 y=132、渲染层实际画在 y=375，位置限制和气泡锚点全错。
    const pet = petRectInWindow(metrics, scale);
    win.webContents.send('pet:layout', {
      left: area.x - wx,
      top: area.y - wy,
      right: area.x + area.width - wx,
      bottom: area.y + area.height - wy,
      width: metrics.width,
      height: metrics.height,
      // 宠物底边距窗口顶边的距离（CSS 像素）
      petBottom: pet.top + pet.height,
      scale,
    });
  }, 120);
  layoutTimer.unref?.();
}

function reportPosition() {
  if (reportTimer !== null) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    if (win === null || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    if (lastReported !== null && lastReported.x === x && lastReported.y === y) return;
    lastReported = { x, y };
    toHost({ t: 'moved', x, y });
    emitLayout();
  }, 400);
  reportTimer.unref?.();
}

// ── 点击穿透 ──────────────────────────────────────────────────────────────
function setInteractive(next) {
  if (win === null || win.isDestroyed() || interactive === next) return;
  interactive = next;
  if (next) {
    // 取回鼠标事件：现在起窗口会吃掉落在它范围内的点击。
    win.setIgnoreMouseEvents(false);
  } else {
    // 穿透，但仍然把 mousemove 转发给渲染进程，宠物才能继续追踪光标。
    win.setIgnoreMouseEvents(true, { forward: true });
  }
}

// ── 拖拽 ──────────────────────────────────────────────────────────────────
function beginDrag(payload) {
  if (win === null || win.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  drag = {
    offsetX: cursor.x - wx,
    offsetY: cursor.y - wy,
    lastX: cursor.x,
    direction: null,
    timer: setInterval(tickDrag, 16),
  };
  drag.timer.unref?.();
  void payload;
}

function tickDrag() {
  if (drag === null || win === null || win.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();

  const deltaX = cursor.x - drag.lastX;
  if (Math.abs(deltaX) >= 3) {
    const direction = deltaX > 0 ? 'right' : 'left';
    if (direction !== drag.direction) {
      drag.direction = direction;
      win.webContents.send('pet:drag-direction', direction);
    }
    drag.lastX = cursor.x;
  }

  const target = clampToDisplay(cursor.x - drag.offsetX, cursor.y - drag.offsetY);
  win.setPosition(target.x, target.y);
  emitLayout();
}

function endDrag() {
  if (drag === null) return;
  clearInterval(drag.timer);
  drag = null;
  win?.webContents.send('pet:drag-direction', null);
  reportPosition();
}

// ── 光标追踪 ──────────────────────────────────────────────────────────────
// 用主进程的全局光标位置（而不是窗口内的 mousemove），宠物才能"看着"
// 屏幕任意位置的光标，而不只是看着窗口里那一小块。
let cursorTimer = null;

function startCursorTracking() {
  if (cursorTimer !== null || !lookAtCursor) return;
  cursorTimer = setInterval(() => {
    if (win === null || win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    win.webContents.send('pet:cursor', { x: cursor.x - wx, y: cursor.y - wy });
  }, 80);
  cursorTimer.unref?.();
}

function stopCursorTracking() {
  if (cursorTimer === null) return;
  clearInterval(cursorTimer);
  cursorTimer = null;
}

// ── 原生右键菜单 ──────────────────────────────────────────────────────────
function showContextMenu() {
  const menu = Menu.buildFromTemplate([
    { label: '打个招呼', click: () => toHost({ t: 'command', action: 'greeting' }) },
    { type: 'separator' },
    { label: '重置位置', click: () => resetPosition() },
    { label: '重新加载素材', click: () => win?.webContents.send('pet:reload') },
    { label: '重新启动窗口', click: () => toHost({ t: 'command', action: 'restart' }) },
    { type: 'separator' },
    { label: '在设置里隐藏桌宠', click: () => toHost({ t: 'command', action: 'disable' }) },
    { label: '查看设置文件', click: () => toHost({ t: 'command', action: 'open-settings' }) },
  ]);
  menu.popup({ window: win ?? undefined });
}

function resetPosition() {
  if (win === null || win.isDestroyed()) return;
  const target = defaultPosition();
  win.setPosition(target.x, target.y);
  reportPosition();
}

// ── IPC：渲染进程 → 主进程 ────────────────────────────────────────────────
ipcMain.handle('pet:load-assets', async () => {
  try {
    const manifestRaw = await fs.readFile(path.join(assetsDir, 'pet.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    const relative = typeof manifest.spritesheetPath === 'string' ? manifest.spritesheetPath : 'spritesheet.webp';
    const file = path.isAbsolute(relative) ? relative : path.join(assetsDir, relative);
    const bytes = await fs.readFile(file);
    return {
      manifest,
      bytes,
      mime: file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/webp',
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.on('pet:set-interactive', (_event, next) => setInteractive(next === true));
ipcMain.on('pet:drag-start', (_event, payload) => beginDrag(payload));
ipcMain.on('pet:drag-end', () => endDrag());
ipcMain.on('pet:context-menu', () => showContextMenu());
// 渲染层的异常没有别的出口，转发给宿主日志，免得窗口白屏却查不到原因。
ipcMain.on('pet:renderer-error', (_event, message) => {
  toHost({ t: 'log', level: 'error', msg: String(message) });
});
ipcMain.on('pet:moved-by-user', () => reportPosition());
// 渲染层对 pet:probe 的回答，转给宿主
ipcMain.on('pet:probe-result', (_event, data) => {
  toHost({ t: 'probe', ...(data ?? {}) });
});

// ── IPC：主进程 → 渲染进程（由 stdin 驱动）─────────────────────────────────
function dispatch(message) {
  if (win === null || win.isDestroyed()) return;
  switch (message.t) {
    case 'bubble':
      // 两行气泡：`title` 会话标题、`status` 任务状态。都由宿主算好后下发，这里只转发。
      // 两者都为空串表示清空实时层，让气泡回落到待机碎碎念。
      if (win !== null && !win.isDestroyed()) {
        win.webContents.send('pet:bubble', {
          title: typeof message.title === 'string' ? message.title : '',
          status: typeof message.status === 'string' ? message.status : '',
        });
      }
      break;
    case 'state':
      win.webContents.send('pet:state', message.v);
      break;
    case 'config':
      // 窗口尺寸固定，缩放只是把内容画大/画小（渲染层做缓动）。
      if (message.scale !== undefined && message.scale !== null) applyScale(message.scale);
      win.webContents.send('pet:config', {
        scale,
        lookAtCursor: message.lookAtCursor,
        bubbles: message.bubbles,
      });
      break;
    case 'reset-position':
      resetPosition();
      break;
    case 'reload':
      win.webContents.send('pet:reload');
      break;
    case 'theme': {
      // 调试用：强制深/浅色外观，用来验证两种配色下气泡都读得清。
      // 只接受固定取值，避免从上游塞进任意字符串。
      const value = message.value;
      if (value === 'dark' || value === 'light' || value === 'system') {
        nativeTheme.themeSource = value;
      }
      break;
    }
    case 'probe': {
      // 调试用：让渲染层回报气泡与宠物的实际位置。
      //
      // 为什么不靠 executeJavaScript：实测它的 Promise 既不 resolve 也不 reject（静默卡住）。
      // 为什么不靠 capturePage：窗口伸到屏幕外时合成器报 UnknownVizError 抓不到帧。
      // 走自家 IPC 最稳，而且和其余消息同一条通路。
      win.webContents.send('pet:probe');
      break;
    }
    case 'capture': {
      // 调试用：把窗口内容截一张 PNG 出来。
      // 外部 screencapture 需要屏幕录制权限，这条路不需要，而且抓到的正是
      // 合成器最终呈现的内容 —— 验证"某一帧有没有闪"最直接。
      const file = typeof message.path === 'string' ? message.path : '';
      if (file === '') break;
      win.webContents
        .capturePage()
        .then((image) => fs.writeFile(file, image.toPNG()))
        .catch((error) => toHost({ t: 'log', level: 'error', msg: `capture failed: ${String(error)}` }));
      break;
    }
    case 'quit':
      quit();
      break;
    default:
      break;
  }
}

// ── stdin：来自宿主的 JSON Lines ──────────────────────────────────────────
//
// 注意：只有在「确实收到过宿主数据」之后，stdin 关闭才意味着宿主消失。
// 独立运行（stdin 是 /dev/null 或直接关闭）时不能自退，否则窗口会在启动
// 过程中被自己杀掉。
let stdinBuffer = '';
let sawHostData = false;

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  sawHostData = true;
  stdinBuffer += chunk;
  let index = stdinBuffer.indexOf('\n');
  while (index >= 0) {
    const line = stdinBuffer.slice(0, index).trim();
    stdinBuffer = stdinBuffer.slice(index + 1);
    if (line !== '') {
      try {
        dispatch(JSON.parse(line));
      } catch {
        /* 忽略非法行 */
      }
    }
    index = stdinBuffer.indexOf('\n');
  }
});

function hostGone() {
  if (!sawHostData) return; // 从来没有宿主，说明是独立运行
  quit();
}

process.stdin.on('end', hostGone);
process.stdin.on('close', hostGone);
process.on('disconnect', hostGone);

let quitting = false;
function quit() {
  if (quitting) return;
  quitting = true;
  stopCursorTracking();
  try {
    win?.destroy();
  } catch {
    /* ignore */
  }
  app.quit();
}

// ── 启动 ──────────────────────────────────────────────────────────────────
// 桌宠窗口不需要 GPU 合成也能跑得很好；关掉硬件加速可以规避部分透明窗口的
// 撕裂 / 黑底问题。如果发现动画掉帧，把这行去掉再试。
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(() => {
  // 素材目录通过环境变量传给渲染进程（preload 读取）。
  process.env.DSH_DESKPET_ASSETS = assetsDir;
  process.env.DSH_DESKPET_SCALE = String(scale);
  process.env.DSH_DESKPET_LOOK = lookAtCursor ? '1' : '0';
  process.env.DSH_DESKPET_BUBBLES = bubbles ? '1' : '0';
  createWindow();
});

app.on('window-all-closed', () => quit());

'use strict';

/**
 * 桌宠渲染层。
 *
 * 只做三件事：
 *   1. 按宿主下发的状态播放 8×11 图集里对应的那一行动画；
 *   2. 鼠标在屏幕任何位置时，用第 9/10 行的 16 个注视方向让宠物"看着"光标；
 *   3. 上报命中区，让主进程决定窗口该不该接管鼠标。
 *
 * 图集契约（与 Codex v2 Pet 一致）：8 列 × 11 行，单元格 192×208。
 *   行 0 idle           列 0-5
 *   行 1 running-right  列 0-7
 *   行 2 running-left   列 0-7
 *   行 3 waving         列 0-3
 *   行 4 jumping        列 0-4
 *   行 5 failed         列 0-7
 *   行 6 waiting        列 0-5
 *   行 7 running        列 0-5
 *   行 8 review         列 0-5
 *   行 9 注视 A         列 0-7   000° → 157.5°
 *   行 10 注视 B        列 0-7   180° → 337.5°
 */

const host = window.petHost;

const CELL = { width: 192, height: 208 };
const COLS = 8;
const ROWS = 11;
const MARGIN = 14;
const BUBBLE_SPACE = 74;

/** 行内帧数 + 每帧时长（末帧单独给定，来自官方 animation-rows 规范）。 */
function rowAnimation(row, count, frameMs, lastMs) {
  const cols = Array.from({ length: count }, (_, index) => index);
  return {
    row,
    cols,
    durations: cols.map((_, index) => (index === count - 1 ? lastMs : frameMs)),
  };
}

const ANIMATIONS = {
  idle: { row: 0, cols: [0, 1, 2, 3, 4, 5], durations: [280, 110, 110, 140, 140, 320] },
  'running-right': rowAnimation(1, 8, 120, 220),
  'running-left': rowAnimation(2, 8, 120, 220),
  waving: rowAnimation(3, 4, 140, 280),
  jumping: rowAnimation(4, 5, 140, 280),
  failed: rowAnimation(5, 8, 140, 240),
  waiting: rowAnimation(6, 6, 150, 260),
  running: rowAnimation(7, 6, 120, 220),
  review: rowAnimation(8, 6, 150, 280),
};

/** 状态 → 气泡文案。 */
const BUBBLES = {
  idle: ['在这儿呢', '慢慢来', '陪你'],
  running: ['正在处理…', '交给我', '盯着呢'],
  waiting: ['需要你确认', '等你一下', '看一眼这里'],
  review: ['检查一下', '我看看'],
  jumping: ['搞定啦！', '完成了', '棒'],
  failed: ['出问题了…', '这里不太对'],
  waving: ['嘿～', '你好呀'],
};

const LOOK_IDLE_MS = 1600; // 光标静止多久后放弃注视
const LOOK_ROWS = [9, 10];
/** 每行注视方向的帧数。两行共 16 个方向，覆盖顺时针一整圈。 */
const LOOK_FRAMES_PER_ROW = 8;

// ── DOM ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('pet');
const bubble = document.getElementById('bubble');
const fallback = document.getElementById('fallback');
const ctx = canvas.getContext('2d');

// ── 运行时状态 ─────────────────────────────────────────────────────────────
const state = {
  animation: 'idle',
  animationStartedAt: performance.now(),
  spritesheet: null,
  manifest: null,
  /** 命中区（相对单元格的百分比内缩）。 */
  hitInset: { left: 0.06, top: 0.04, right: 0.06, bottom: 0.04 },
  interactive: false,
  dragging: false,
  dragDirection: null,
  lookAtCursor: host?.config?.lookAtCursor !== false,
  bubbles: host?.config?.bubbles !== false,
  cursor: null,
  cursorMovedAt: 0,
  /** 目标缩放（来自设置）。 */
  targetScale: host?.config?.scale ?? 1,
  /** 当前实际绘制的缩放，朝 targetScale 缓动。 */
  visualScale: host?.config?.scale ?? 1,
  bubbleKey: null,
  bubbleUntil: 0,
};

// ── 素材加载 ───────────────────────────────────────────────────────────────
async function loadAssets() {
  try {
    const payload = await host.loadAssets();
    if (payload?.error) throw new Error(payload.error);

    const blob = new Blob([new Uint8Array(payload.bytes)], { type: payload.mime ?? 'image/webp' });
    const bitmap = await createImageBitmap(blob);

    state.spritesheet = bitmap;
    state.manifest = payload.manifest ?? null;
    state.hitInset = computeAlphaInset(bitmap);
    fallback.dataset.visible = '0';
    syncCanvas();
  } catch (error) {
    fallback.textContent = `素材未就绪：${String(error?.message ?? error)}`;
    fallback.dataset.visible = '1';
    state.spritesheet = null;
  }
}

/**
 * 从 idle 首帧算一次「不透明像素」的包围盒，用它当命中区。
 * 这样透明边缘不会误吃点击。
 */
function computeAlphaInset(bitmap) {
  const target = document.createElement('canvas');
  target.width = CELL.width;
  target.height = CELL.height;
  const tctx = target.getContext('2d', { willReadFrequently: true });
  tctx.drawImage(bitmap, 0, 0, CELL.width, CELL.height, 0, 0, CELL.width, CELL.height);

  let data;
  try {
    data = tctx.getImageData(0, 0, CELL.width, CELL.height).data;
  } catch {
    return state.hitInset;
  }

  let minX = CELL.width;
  let minY = CELL.height;
  let maxX = -1;
  let maxY = -1;
  const threshold = 16;
  for (let y = 0; y < CELL.height; y += 1) {
    for (let x = 0; x < CELL.width; x += 1) {
      if (data[(y * CELL.width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return state.hitInset;

  return {
    left: minX / CELL.width,
    top: minY / CELL.height,
    right: 1 - (maxX + 1) / CELL.width,
    bottom: 1 - (maxY + 1) / CELL.height,
  };
}

// ── 布局 ──────────────────────────────────────────────────────────────────
/** 缩放缓动的时间常数（毫秒）；约 4τ 收敛，手感的甜点区在 60–90。 */
const SCALE_EASE_TAU_MS = 70;

/** 视觉缩放朝目标值指数缓动（与帧率无关）。 */
function easeScale(dt) {
  const target = state.targetScale;
  if (Math.abs(state.visualScale - target) < 0.001) {
    state.visualScale = target;
    return;
  }
  const k = 1 - Math.exp(-dt / SCALE_EASE_TAU_MS);
  state.visualScale += (target - state.visualScale) * k;
}

/**
 * 同步画布。
 *
 * 两条缩放分开走，这是消除「闪现一帧」的关键：
 *
 * - **位图**只跟「目标缩放」重建 —— 每次用户操作一次。位图坐标空间固定为
 *   `0..CELL.width × 0..CELL.height`，绘制代码不必关心实际像素尺寸。
 * - **CSS 尺寸**跟「视觉缩放」走 —— 动画期间由合成器缩放位图。
 *
 * 于是窗口尺寸变化的瞬间，画布自身的大小和位置**都没变**，不会出现旧位图被
 * 拉伸到新窗口的那一帧；只有内容在原地平滑长大。静止时两者相等，是 1:1 渲染。
 */
function syncCanvas() {
  const dpr = window.devicePixelRatio || 1;

  const bitmapWidth = Math.max(1, Math.round(CELL.width * state.targetScale * dpr));
  const bitmapHeight = Math.max(1, Math.round(CELL.height * state.targetScale * dpr));
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
    // 绘制坐标 = 图集单元格坐标，与像素密度、缩放全部解耦。
    ctx.setTransform(bitmapWidth / CELL.width, 0, 0, bitmapHeight / CELL.height, 0, 0);
  }

  canvas.style.width = `${CELL.width * state.visualScale}px`;
  canvas.style.height = `${CELL.height * state.visualScale}px`;
  canvas.style.bottom = `${MARGIN}px`;
}

/** 宠物在窗口里的矩形（CSS 像素）：由当前视觉缩放推导，底边居中锚定，与 CSS 一致。 */
function petRect() {
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;
  const petWidth = CELL.width * state.visualScale;
  const petHeight = CELL.height * state.visualScale;
  return {
    petLeft: (cssWidth - petWidth) / 2,
    petTop: cssHeight - MARGIN - petHeight,
    petWidth,
    petHeight,
  };
}

/** 气泡跟着宠物顶部走；只在位置真的变了时才写样式。 */
let bubbleTopCache = null;

function positionBubble() {
  const rect = petRect();
  const top = Math.max(2, rect.petTop - BUBBLE_SPACE * state.visualScale + 6);
  if (bubbleTopCache === top) return;
  bubbleTopCache = top;
  bubble.style.top = `${top}px`;
}

/** 命中矩形（已按 alpha 包围盒内缩）。 */
function hitRect() {
  const rect = petRect();
  return {
    left: rect.petLeft + rect.petWidth * state.hitInset.left,
    top: rect.petTop + rect.petHeight * state.hitInset.top,
    width: rect.petWidth * (1 - state.hitInset.left - state.hitInset.right),
    height: rect.petHeight * (1 - state.hitInset.top - state.hitInset.bottom),
  };
}

// ── 绘制 ──────────────────────────────────────────────────────────────────
function currentLookFrame() {
  if (!state.lookAtCursor || state.dragging) return null;
  if (state.cursor === null) return null;
  if (performance.now() - state.cursorMovedAt > LOOK_IDLE_MS) return null;

  const rect = petRect();
  const centerX = rect.petLeft + rect.petWidth / 2;
  const centerY = rect.petTop + rect.petHeight * 0.45;
  const dx = state.cursor.x - centerX;
  const dy = state.cursor.y - centerY;
  if (Math.hypot(dx, dy) < 12) return null; // 死区：回落到普通动画

  // 0° = 正上，顺时针增长。
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const normalized = (degrees + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return {
    row: LOOK_ROWS[Math.floor(index / LOOK_FRAMES_PER_ROW)],
    col: index % LOOK_FRAMES_PER_ROW,
  };
}

function currentAnimationFrame(now) {
  const look = currentLookFrame();
  if (look !== null) return { row: look.row, col: look.col };

  const animation = ANIMATIONS[state.animation] ?? ANIMATIONS.idle;
  const total = animation.durations.reduce((sum, value) => sum + value, 0);
  let elapsed = (now - state.animationStartedAt) % total;

  for (let index = 0; index < animation.durations.length; index += 1) {
    const duration = animation.durations[index];
    if (elapsed < duration) return { row: animation.row, col: animation.cols[index] };
    elapsed -= duration;
  }
  return { row: animation.row, col: animation.cols[animation.cols.length - 1] };
}

function draw(now) {
  // 绘制坐标系就是图集单元格（0..192 × 0..208），铺满整块画布。
  ctx.clearRect(0, 0, CELL.width, CELL.height);
  if (state.spritesheet === null) return;

  const { row, col } = currentAnimationFrame(now);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    state.spritesheet,
    col * CELL.width,
    row * CELL.height,
    CELL.width,
    CELL.height,
    0,
    0,
    CELL.width,
    CELL.height,
  );
}

// ── 气泡 ──────────────────────────────────────────────────────────────────
function updateBubble(now) {
  if (!state.bubbles) {
    bubble.dataset.visible = '0';
    return;
  }

  const transient = state.animation === 'jumping' || state.animation === 'failed' || state.animation === 'waving';
  const key = `${state.animation}:${Math.floor(now / 6000)}`;

  if (transient && performance.now() < state.bubbleUntil) {
    bubble.dataset.visible = '1';
    return;
  }
  if (!transient && state.bubbleKey === key) {
    bubble.dataset.visible = '0';
    return;
  }
  if (!transient && state.bubbleKey !== key && state.bubbleUntil === 0) {
    // 基态只在切换时冒一次泡，不常驻。
    const pool = BUBBLES[state.animation];
    if (Array.isArray(pool) && pool.length > 0 && state.bubbleKey !== key) {
      bubble.textContent = pool[Math.floor(Math.random() * pool.length)];
      state.bubbleKey = key;
      state.bubbleUntil = performance.now() + 2600;
      bubble.dataset.visible = '1';
      return;
    }
  }

  bubble.dataset.visible = '0';
}

/** 进入瞬态状态时立刻冒泡。 */
function announceTransient(animation) {
  const pool = BUBBLES[animation];
  if (!Array.isArray(pool) || pool.length === 0) return;
  bubble.textContent = pool[Math.floor(Math.random() * pool.length)];
  state.bubbleUntil = performance.now() + 2600;
  bubble.dataset.visible = '1';
}

// ── 主循环 ────────────────────────────────────────────────────────────────
let lastFrameAt = 0;

function frame(now) {
  const dt = lastFrameAt === 0 ? 16 : Math.min(100, now - lastFrameAt);
  lastFrameAt = now;

  // 顺序很重要：先把缩放推到新值，再同步画布（含必要时的位图重建），最后画。
  // 位图被清空与重画落在同一帧里，不会闪。
  easeScale(dt);
  syncCanvas();

  if (state.bubbleUntil !== 0 && performance.now() > state.bubbleUntil) {
    state.bubbleUntil = 0;
    bubble.dataset.visible = '0';
  }
  draw(now);
  positionBubble();
  updateBubble(now);
  requestAnimationFrame(frame);
}

// ── 命中区 / 交互 ─────────────────────────────────────────────────────────
function updateInteractivity(point) {
  const rect = hitRect();
  const inside =
    point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;

  // 拖拽中必须保持可交互，否则鼠标一离开身体就断线。
  const next = inside || state.dragging;
  if (next !== state.interactive) {
    state.interactive = next;
    host.setInteractive(next);
  }
}

// ── 事件 ──────────────────────────────────────────────────────────────────
window.addEventListener('mousemove', (event) => {
  state.cursor = { x: event.clientX, y: event.clientY };
  state.cursorMovedAt = performance.now();
  updateInteractivity(state.cursor);
});

window.addEventListener('mouseleave', () => {
  if (state.dragging) return;
  updateInteractivity({ x: -1, y: -1 });
});

window.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  const rect = hitRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.left + rect.width &&
    event.clientY >= rect.top &&
    event.clientY <= rect.top + rect.height;
  if (!inside) return;

  state.dragging = true;
  state.dragDirection = null;
  host.dragStart({});
  event.preventDefault();
});

window.addEventListener('mouseup', (event) => {
  if (event.button !== 0 || !state.dragging) return;
  state.dragging = false;
  state.dragDirection = null;
  host.dragEnd();
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  host.contextMenu();
});

// 不再监听 resize 事件：画布已按底边中点锚定，窗口尺寸变化不会影响它的
// 位置与大小；尺寸同步发生在 rAF 里（见 syncCanvas），事件里插一脚只会
// 把位图重建和重画拆到两帧。

// ── 与主进程的通路 ────────────────────────────────────────────────────────
host.onState((animation) => {
  if (typeof animation !== 'string' || animation === state.animation) return;
  state.animation = animation;
  state.animationStartedAt = performance.now();
  announceTransient(animation);
});

host.onConfig((config) => {
  if (config === null || typeof config !== 'object') return;
  if (typeof config.lookAtCursor === 'boolean') state.lookAtCursor = config.lookAtCursor;
  if (typeof config.bubbles === 'boolean') state.bubbles = config.bubbles;
  // 缩放只改目标值；视觉缩放由主循环缓动过去，所以看起来是平滑长大/缩小。
  if (Number.isFinite(Number(config.scale))) state.targetScale = Number(config.scale);
});

host.onDragDirection((direction) => {
  state.dragDirection = direction;
  if (direction === 'left' || direction === 'right') {
    state.animation = direction === 'left' ? 'running-left' : 'running-right';
    state.animationStartedAt = performance.now();
  }
});

host.onReload(() => {
  void loadAssets();
});

// 主进程会推送光标在窗口内的坐标（即使光标在窗口外），这样眼睛能跟着满屏跑。
if (typeof host.onCursor === 'function') {
  host.onCursor((point) => {
    if (point === null || typeof point !== 'object') return;
    const moved = state.cursor === null || Math.hypot(point.x - state.cursor.x, point.y - state.cursor.y) > 2;
    state.cursor = point;
    if (moved) state.cursorMovedAt = performance.now();
  });
}

// ── 全局错误上报 ──────────────────────────────────────────────────────────
// 渲染进程一抛错就可能整片空白，而窗口本身还是「活着」的，宿主查不到原因。
// 这里把异常交给主进程转发给宿主日志。
function reportFailure(where, detail) {
  try {
    host?.reportError?.(`[renderer] ${where}: ${detail}`);
  } catch {
    /* 上报失败也不能再抛 */
  }
}

window.addEventListener('error', (event) => {
  reportFailure('error', `${event.message} @ ${event.filename}:${event.lineno}`);
});
window.addEventListener('unhandledrejection', (event) => {
  reportFailure('unhandledrejection', String(event.reason?.stack ?? event.reason));
});

// ── 启动 ──────────────────────────────────────────────────────────────────
void loadAssets();
requestAnimationFrame(frame);

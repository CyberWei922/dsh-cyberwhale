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

/**
 * Windows 上点击穿透与光标位置由主进程按全局光标判定（见 helper/main.js 的
 * 「点击穿透」一节）：Electron 在 Windows 上的 mousemove 转发走低级鼠标钩子，
 * 真机实测时灵时不灵，而且转发来的坐标会过期/出错。
 * 渲染层据此不再自己驱动交互，也不再采纳 DOM mousemove 的光标值。
 */
const MAIN_HIT_TEST = host?.config?.platform === 'win32';

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
  // 每 6 秒眨眼一次；延长睁眼停留，闭眼/睁开的过渡速度保持自然。
  idle: { row: 0, cols: [0, 1, 2, 3, 4, 5], durations: [4400, 110, 110, 140, 140, 1100] },
  'running-right': rowAnimation(1, 8, 120, 220),
  'running-left': rowAnimation(2, 8, 120, 220),
  // 起手 → 两次来回挥动 → 收手；一次性播放，结束后保持末帧等宿主回落。
  waving: {
    row: 3,
    cols: [0, 1, 2, 1, 2, 1, 0, 3],
    durations: [260, 340, 320, 320, 320, 340, 300, 400],
    once: true,
  },
  jumping: rowAnimation(4, 5, 140, 280),
  failed: rowAnimation(5, 8, 140, 240),
  waiting: rowAnimation(6, 6, 150, 260),
  // 4 帧（原 6 帧）：端碗扒饭。单帧 200ms、收尾 400ms —— 比原来的
  // 120/220 慢一些，扒饭的节奏看着不慌。
  running: rowAnimation(7, 4, 200, 400),
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

/**
 * 指针停在身上多久之后自动停止注视（毫秒）。
 *
 * 对齐 Codex：它的计时器是 `setTimeout(cancel, 1e4)` —— 指针一进入宠物身上就开始计时，
 * 10 秒后取消注视，回到正常的待机动画。指针不离开也不会重新开始，
 * 要离开再进来才会再触发一轮。
 */
const LOOK_HOLD_MS = 10_000;
const LOOK_ROWS = [9, 10];
/** 每行注视方向的帧数。两行共 16 个方向，覆盖顺时针一整圈。 */
const LOOK_FRAMES_PER_ROW = 8;

// ── DOM ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('pet');
const bubble = document.getElementById('bubble');
const bubbleTitle = document.getElementById('bubble-title');
const bubbleStatus = document.getElementById('bubble-status');
const fallback = document.getElementById('fallback');
const ctx = canvas.getContext('2d');

// ── 运行时状态 ─────────────────────────────────────────────────────────────
const state = {
  animation: 'idle',
  hostAnimation: 'idle',
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
  /** 指针此刻是否停在宠物身上（决定要不要注视）。 */
  cursorOverPet: false,
  /** 指针进入宠物身上的时刻；0 表示不在身上。用于 10 秒上限。 */
  cursorEnteredAt: 0,
  /** 目标缩放（来自设置）。 */
  targetScale: host?.config?.scale ?? 1,
  /** 当前实际绘制的缩放，朝 targetScale 缓动。 */
  visualScale: host?.config?.scale ?? 1,
  bubbleKey: null,
  bubbleUntil: 0,
  /** 实时层的两行：会话标题 + 任务状态。status 为空表示没有，回落到碎碎念。 */
  liveTitle: '',
  liveStatus: '',
  /** 兜底回落时间。正常由宿主在 turn 结束时明确清空，这个只是防上游异常消失。 */
  liveUntil: 0,
  /** 工作区在窗口坐标系里的矩形；由主进程下发，气泡靠它避让屏幕边缘。 */
  layout: null,
};

// ── 素材加载 ───────────────────────────────────────────────────────────────
async function loadAssets() {
  try {
    const payload = await host.loadAssets();
    if (payload?.error) throw new Error(payload.error);

    const blob = new Blob([new Uint8Array(payload.bytes)], { type: payload.mime ?? 'image/webp' });
    const bitmap = await createImageBitmap(blob);

    if (bitmap.width !== COLS * CELL.width || ![9, ROWS].includes(bitmap.height / CELL.height)) {
      bitmap.close();
      throw new Error('图集尺寸必须为 1536×2288（或兼容的 1536×1872）');
    }
    state.spritesheet?.close?.();
    state.spritesheet = bitmap;
    state.manifest = payload.manifest ?? null;
    state.hitInset = computeAlphaInset(bitmap);
    // Windows：主进程需要这份内缩比例来做命中判定（macOS 不需要，但上报无害）。
    host?.reportHitInset?.(state.hitInset);
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
  // 画布底边对齐「宠物底边」——位置来自主进程，不再假定宠物贴着窗口底部
  const petBottom = state.layout?.petBottom ?? window.innerHeight - MARGIN;
  canvas.style.bottom = `${window.innerHeight - petBottom}px`;
}

/**
 * 宠物在窗口里的矩形（CSS 像素）。
 *
 * **垂直位置由主进程下发**（`layout.petBottom`），不再自己按窗口底部算：
 * 窗口是按最大档位预留的，宠物并不在窗口底部 —— 上下各留了一块气泡空间。
 * 两边各算一遍就是两份事实来源，一旦漂移，位置限制和气泡锚点会同时错。
 *
 * 尺寸仍用 `visualScale`，因为缩放动画期间绘制尺寸是缓动的。
 */
function petRect() {
  const cssWidth = window.innerWidth;
  const petWidth = CELL.width * state.visualScale;
  const petHeight = CELL.height * state.visualScale;
  const petBottom = state.layout?.petBottom ?? window.innerHeight - MARGIN;
  return {
    petLeft: (cssWidth - petWidth) / 2,
    petTop: petBottom - petHeight,
    petWidth,
    petHeight,
  };
}

/** 气泡跟着宠物顶部走；只在位置真的变了时才写样式。 */
/** 气泡与宠物之间的间隙（CSS 像素）。 */
const BUBBLE_GAP = 8;
/** 气泡与屏幕边缘的最小留白。 */
const BUBBLE_EDGE = 6;
/** 尾巴离气泡两端的最近距离，别让它指到气泡外面。 */
const BUBBLE_TAIL_INSET = 18;

let bubbleFrameCache = null;
let bubbleSizeCache = null;

/** 量气泡尺寸。文本变了才重量 —— 每帧读 offsetWidth 会触发布局抖动。 */
function measureBubble() {
  if (bubbleSizeCache === null) {
    bubbleSizeCache = { width: bubble.offsetWidth, height: bubble.offsetHeight };
  }
  return bubbleSizeCache;
}

/**
 * 摆放气泡。
 *
 * 两处避让（借鉴 ChatGPT 桌宠）：
 *   1. **垂直翻转**：头顶放不下就翻到脚底
 *   2. **水平让位**：贴近屏幕左右边缘时整体平移，不让气泡溢出
 *
 * 窗口是按最大档位预留的，上下各留了一块气泡空间（见 helper/geometry.js），
 * 所以翻到下方有地方去。屏幕可视区由主进程下发（窗口本身可以伸到屏幕外）。
 */
function positionBubble() {
  const rect = petRect();
  const layout = state.layout;
  // 还没收到 layout 时退化成窗口自身，至少不会跑出窗口
  const viewLeft = layout === null ? 0 : layout.left;
  const viewTop = layout === null ? 0 : layout.top;
  const viewRight = layout === null ? window.innerWidth : layout.right;
  const viewBottom = layout === null ? window.innerHeight : layout.bottom;

  const size = measureBubble();

  // ── 垂直：优先头顶，放不下就翻到脚底 ────────────────────────────────
  const aboveTop = rect.petTop - BUBBLE_GAP - size.height;
  const belowTop = rect.petTop + rect.petHeight + BUBBLE_GAP;
  const aboveFits = aboveTop >= viewTop + BUBBLE_EDGE;
  const belowFits = belowTop + size.height <= viewBottom - BUBBLE_EDGE;

  let side = 'above';
  let top = aboveTop;
  if (!aboveFits && belowFits) {
    side = 'below';
    top = belowTop;
  } else if (!aboveFits && !belowFits) {
    // 上下都放不下（极窄的可视区）：挑空间更大的一侧
    const roomAbove = rect.petTop - viewTop;
    const roomBelow = viewBottom - (rect.petTop + rect.petHeight);
    if (roomBelow > roomAbove) {
      side = 'below';
      top = belowTop;
    }
  }
  top = Math.min(Math.max(top, viewTop + BUBBLE_EDGE), viewBottom - BUBBLE_EDGE - size.height);

  // ── 水平：以宠物中轴为中心，再夹进可视区 ────────────────────────────
  const petCenter = rect.petLeft + rect.petWidth / 2;
  let left = petCenter - size.width / 2;
  left = Math.min(Math.max(left, viewLeft + BUBBLE_EDGE), viewRight - BUBBLE_EDGE - size.width);

  // 尾巴指向宠物中轴，但夹在气泡内部
  const tailX = Math.min(Math.max(petCenter - left, BUBBLE_TAIL_INSET), size.width - BUBBLE_TAIL_INSET);

  const frame = { top: Math.round(top), left: Math.round(left), side, tailX: Math.round(tailX) };
  const cached = bubbleFrameCache;
  if (
    cached !== null &&
    cached.top === frame.top &&
    cached.left === frame.left &&
    cached.side === frame.side &&
    cached.tailX === frame.tailX
  ) {
    return;
  }

  bubbleFrameCache = frame;
  bubble.style.top = `${frame.top}px`;
  bubble.style.left = `${frame.left}px`;
  bubble.dataset.side = frame.side;
  bubble.style.setProperty('--bubble-tail-x', `${frame.tailX}px`);
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
/**
 * 当前该不该注视鼠标，该看哪个方向。返回 null 表示不注视。
 *
 * 规则完全对齐 Codex 的桌宠（`app-initial-*.js` 里那个组件）：
 *
 *   1. **只有待机时注视** —— 一旦进了干活中/抬头等你/低头检查/挥手/跳跃/出错，
 *      眼睛就定住。原实现让注视无条件插队，结果打招呼都会被它顶掉。
 *   2. **鼠标必须停在它身上** —— Codex 监听的是指针在宠物元素上的移动，
 *      鼠标在屏幕别处晃它完全不理会。原实现是全屏跟随。
 *   3. **最多看 10 秒** —— 从指针进入身上开始计时，到点自动回到待机动画。
 *   4. **指针一移开立刻停**。
 *
 * 方向按「指针相对宠物中心的角度」算，22.5° 一档共 16 个方向（图集第 9、10 行），
 * 这一点与 Codex 一致（它也是 22.5°/16 方向/第 9、10 行）。
 *
 * @param now - 当前时间（rAF 时间戳，与 performance.now() 同一时基）。
 */
function currentLookFrame(now) {
  // 指针在不在身上：用和点击命中共用的那块矩形，透明边缘不算「身上」
  const rect = hitRect();
  const cursor = state.cursor;
  const over =
    cursor !== null &&
    cursor.x >= rect.left &&
    cursor.x <= rect.left + rect.width &&
    cursor.y >= rect.top &&
    cursor.y <= rect.top + rect.height;

  if (over !== state.cursorOverPet) {
    state.cursorOverPet = over;
    // 只在「刚进来」的那一次记时间 —— 不然一直待在上面会无限续期，
    // Codex 的计时器也是这个语义。
    state.cursorEnteredAt = over ? now : 0;
  }

  if (!state.lookAtCursor || state.dragging) return null;
  if (state.spritesheet !== null && state.spritesheet.height < ROWS * CELL.height) return null;
  if (state.animation !== 'idle') return null; // 规则 1：只有待机才注视
  if (!over) return null;                      // 规则 2：鼠标必须在身上
  if (now - state.cursorEnteredAt > LOOK_HOLD_MS) return null; // 规则 3：最多 10 秒

  const pet = petRect();
  const centerX = pet.petLeft + pet.petWidth / 2;
  const centerY = pet.petTop + pet.petHeight * 0.45;
  const dx = cursor.x - centerX;
  const dy = cursor.y - centerY;
  // 死区：正好停在身体中心时不妨硬选一个方向，落回待机动画更自然。
  // （Codex 这里是 1px，几乎等于没有；我们放宽到 12px。）
  if (Math.hypot(dx, dy) < 12) return null;

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
  const look = currentLookFrame(now);
  if (look !== null) return { row: look.row, col: look.col };

  const animation = ANIMATIONS[state.animation] ?? ANIMATIONS.idle;
  const total = animation.durations.reduce((sum, value) => sum + value, 0);
  const age = Math.max(0, now - state.animationStartedAt);
  let elapsed = animation.once ? Math.min(age, total - 1) : age % total;

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
// 由宿主明确清空；长任务不能因为没有新事件而被误判结束。
const LIVE_HOLD_MS = Number.POSITIVE_INFINITY;

let bubbleLinesKey = null;

/**
 * 写气泡的两行内容。只在内容真的变了时碰 DOM —— 这个函数每帧都会跑。
 *
 * @param title - 第一行：会话标题。空串时整行收掉，不留空白。
 * @param status - 第二行：任务状态。
 */
function setBubbleLines(title, status) {
  const key = `${title}\u0000${status}`;
  if (key === bubbleLinesKey) return;
  bubbleLinesKey = key;
  bubbleTitle.textContent = title;
  bubbleTitle.hidden = title === '';
  bubbleStatus.textContent = status;
  bubbleSizeCache = null; // 行数或文本变了，气泡尺寸要重新量
}

function hideBubble() {
  if (bubble.dataset.visible !== '0') bubble.dataset.visible = '0';
}

/**
 * 气泡分两层：
 *   1. **实时层** —— 宿主从推理流里提炼的进度句（压过碎碎念）
 *   2. **碎碎念层** —— 原有的固定短语池，空闲/回落时用
 */
function updateBubble(now) {
  if (!state.bubbles) {
    hideBubble();
    return;
  }

  // ── 实时层：两行任务状态 ──────────────────────────────────────────────
  if (state.liveStatus !== '' && now < state.liveUntil) {
    setBubbleLines(state.liveTitle, state.liveStatus);
    bubble.dataset.live = '1';
    bubble.dataset.visible = '1';
    return;
  }
  if (state.liveStatus !== '') {
    // 上游不再更新了，回落
    state.liveStatus = '';
    state.liveTitle = '';
    bubble.dataset.live = '0';
  }

  // ── 碎碎念层 ──────────────────────────────────────────────────────────
  const transient = state.animation === 'jumping' || state.animation === 'failed' || state.animation === 'waving';
  const key = `${state.animation}:${Math.floor(now / 6000)}`;

  if (transient && now < state.bubbleUntil) {
    bubble.dataset.visible = '1';
    return;
  }
  if (!transient && state.bubbleKey === key) {
    hideBubble();
    return;
  }
  if (!transient && state.bubbleKey !== key && state.bubbleUntil === 0) {
    // 基态只在切换时冒一次泡，不常驻。
    const pool = BUBBLES[state.animation];
    if (Array.isArray(pool) && pool.length > 0) {
      setBubbleLines('', pool[Math.floor(Math.random() * pool.length)]);
      state.bubbleKey = key;
      state.bubbleUntil = now + 2600;
      bubble.dataset.visible = '1';
      return;
    }
  }

  hideBubble();
}

/** 进入瞬态状态时立刻冒泡。 */
function announceTransient(animation) {
  const pool = BUBBLES[animation];
  if (!Array.isArray(pool) || pool.length === 0) return;
  setBubbleLines('', pool[Math.floor(Math.random() * pool.length)]);
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
  // Windows：主进程全权负责（轮询全局光标），渲染层不参与，避免两套判定打架。
  if (MAIN_HIT_TEST) return;
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
  // Windows：光标位置只认主进程的全局轮询（见 MAIN_HIT_TEST 的说明）。
  // 真机实测：Windows 上经低级鼠标钩子转发的 mousemove 会给出过期/错误的坐标
  // （窗口内时尤其明显），用它反而会让注视方向乱跳。
  if (MAIN_HIT_TEST) return;
  state.cursor = { x: event.clientX, y: event.clientY };
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
  syncAnimation();
  host.dragEnd();
  if (state.cursor !== null) updateInteractivity(state.cursor);
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  host.contextMenu();
});

// 不再监听 resize 事件：画布已按底边中点锚定，窗口尺寸变化不会影响它的
// 位置与大小；尺寸同步发生在 rAF 里（见 syncCanvas），事件里插一脚只会
// 把位图重建和重画拆到两帧。

// ── 与主进程的通路 ────────────────────────────────────────────────────────
function syncAnimation() {
  const animation = state.dragDirection === 'left' ? 'running-left'
    : state.dragDirection === 'right' ? 'running-right' : state.hostAnimation;
  if (animation === state.animation) return;
  state.animation = animation;
  state.animationStartedAt = performance.now();
  announceTransient(animation);
}

host.onState((animation, options) => {
  if (typeof animation !== 'string' || !(animation in ANIMATIONS)) return;
  state.hostAnimation = animation;
  syncAnimation();
  if (options?.restart === true && state.dragDirection === null) {
    state.animationStartedAt = performance.now();
    announceTransient(animation);
  }
});

host.onProbe(() => {
  // 调试用：回报气泡与宠物的实际位置。量的是 getBoundingClientRect（视口坐标），
  // 与窗口坐标系一致，比从截图里数像素可靠。
  const rectOf = (element) => {
    if (element === null) return null;
    const r = element.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  };
  host.reportProbe({
    bubble: rectOf(bubble),
    bubbleSide: bubble.dataset.side ?? null,
    bubbleVisible: bubble.dataset.visible ?? null,
    pet: rectOf(canvas),
    window: { width: window.innerWidth, height: window.innerHeight },
    // 注视相关的状态，真机验证靠它判断规则有没有生效
    hitRect: hitRect(),
    animation: state.animation,
    lookAtCursor: state.lookAtCursor,
    cursorOverPet: state.cursorOverPet,
    looking: currentLookFrame(performance.now()) !== null,
  });
});

host.onLayout((value) => {
  if (value === null || typeof value !== 'object') return;
  state.layout = value;
  bubbleFrameCache = null; // 屏幕位置变了，重新摆一次
  syncCanvas();            // 宠物底边可能变了，画布要跟着挪
});

host.onBubble((payload) => {
  // 宿主发来的两行任务状态：第一行会话标题，第二行「正在运行命令 · npm test」。
  // status 为空串表示清空，回落到碎碎念。
  state.liveTitle = typeof payload?.title === 'string' ? payload.title : '';
  state.liveStatus = typeof payload?.status === 'string' ? payload.status : '';
  state.liveUntil = state.liveStatus === '' ? 0 : performance.now() + LIVE_HOLD_MS;
  if (state.liveStatus === '') bubble.dataset.live = '0';
});

host.onConfig((config) => {
  if (config === null || typeof config !== 'object') return;
  if (typeof config.lookAtCursor === 'boolean') state.lookAtCursor = config.lookAtCursor;
  if (typeof config.bubbles === 'boolean') {
    state.bubbles = config.bubbles;
    if (!config.bubbles) {
      state.liveTitle = '';
      state.liveStatus = '';
      state.liveUntil = 0;
    }
  }
  // 缩放只改目标值；视觉缩放由主循环缓动过去，所以看起来是平滑长大/缩小。
  if (Number.isFinite(Number(config.scale))) state.targetScale = Number(config.scale);
});

host.onDragDirection((direction) => {
  state.dragDirection = direction === 'left' || direction === 'right' ? direction : null;
  syncAnimation();
});

host.onReload(() => {
  void loadAssets();
});

// 主进程会推送光标在窗口内的坐标（即使光标在窗口外），这样眼睛能跟着满屏跑。
if (typeof host.onCursor === 'function') {
  host.onCursor((point) => {
    if (point === null || typeof point !== 'object') return;
    // 只记位置，不再记「动了多久」—— 注视的开关是「指针在不在身上」，
    // 由 currentLookFrame 每帧判定。
    state.cursor = point;
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

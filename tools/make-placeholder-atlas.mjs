#!/usr/bin/env node
/**
 * 生成占位图集：1536×2288 PNG，8 列 × 11 行，单元格 192×208。
 *
 * 目的：在正式美术素材到位之前，让整条流水线（宿主 → 助手 → 渲染 → 状态机）
 * 可以端到端跑通并被肉眼验证。素材到位后直接替换 assets/spritesheet.* 即可。
 *
 * 不依赖任何图像库：内置一个最小 PNG 编码器 + 解析式图形绘制。
 *
 * 用法：node tools/make-placeholder-atlas.mjs [--out assets/spritesheet.png]
 */

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

const CELL = { width: 192, height: 208 };
const COLS = 8;
const ROWS = 11;
const WIDTH = CELL.width * COLS; // 1536
const HEIGHT = CELL.height * ROWS; // 2288

// ── 最小 PNG 编码器 ────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(rgba, width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 画布 ──────────────────────────────────────────────────────────────────
function createCanvas(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function blendPixel(canvas, x, y, [r, g, b], alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const a = Math.min(1, alpha);
  const index = (y * canvas.width + x) * 4;
  const dstA = canvas.data[index + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const src = [r, g, b][channel];
    const dst = canvas.data[index + channel];
    canvas.data[index + channel] = Math.round((src * a + dst * dstA * (1 - a)) / outA);
  }
  canvas.data[index + 3] = Math.round(outA * 255);
}

/** 抗锯齿椭圆填充。 */
function fillEllipse(canvas, cx, cy, rx, ry, color, alpha = 1) {
  const minX = Math.max(0, Math.floor(cx - rx - 1));
  const maxX = Math.min(canvas.width - 1, Math.ceil(cx + rx + 1));
  const minY = Math.max(0, Math.floor(cy - ry - 1));
  const maxY = Math.min(canvas.height - 1, Math.ceil(cy + ry + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // 用像素尺度估算边缘宽度，得到 1px 左右的抗锯齿。
      const edge = 1 / Math.min(rx, ry);
      const coverage = 1 - smoothstep(1 - edge, 1 + edge, distance);
      if (coverage > 0) blendPixel(canvas, x, y, color, coverage * alpha);
    }
  }
}

/** 抗锯齿圆角矩形填充。 */
function fillRoundRect(canvas, x0, y0, w, h, radius, color, alpha = 1) {
  const minX = Math.max(0, Math.floor(x0 - 1));
  const maxX = Math.min(canvas.width - 1, Math.ceil(x0 + w + 1));
  const minY = Math.max(0, Math.floor(y0 - 1));
  const maxY = Math.min(canvas.height - 1, Math.ceil(y0 + h + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const qx = Math.max(x0 + radius - px, px - (x0 + w - radius), 0);
      const qy = Math.max(y0 + radius - py, py - (y0 + h - radius), 0);
      const distance = Math.hypot(qx, qy) - radius;
      const coverage = 1 - smoothstep(-0.5, 0.5, distance);
      if (coverage > 0) blendPixel(canvas, x, y, color, coverage * alpha);
    }
  }
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── 角色绘制 ──────────────────────────────────────────────────────────────
const PALETTE = {
  body: [91, 141, 239],
  bodyDark: [47, 92, 190],
  belly: [214, 231, 255],
  ink: [22, 35, 61],
  blush: [255, 157, 184],
  highlight: [168, 204, 255],
};

/**
 * 在一个单元格里画一帧占位鲸鱼。
 * @param {object} canvas 目标画布
 * @param {{x:number,y:number}} origin 单元格左上角
 * @param {object} pose 帧参数
 */
function drawWhale(canvas, origin, pose) {
  const { x: ox, y: oy } = origin;
  const cx = ox + CELL.width / 2 + (pose.shiftX ?? 0);
  const cy = oy + CELL.height / 2 + (pose.shiftY ?? 0);

  const bodyRx = 62;
  const bodyRy = 46;
  const tilt = pose.tilt ?? 0;

  const rotated = (dx, dy) => ({
    x: cx + dx * Math.cos(tilt) - dy * Math.sin(tilt),
    y: cy + dx * Math.sin(tilt) + dy * Math.cos(tilt),
  });

  // 尾巴
  const tail = rotated(-bodyRx + 6, -6 + (pose.tail ?? 0));
  fillEllipse(canvas, tail.x, tail.y - 10, 20, 16, PALETTE.bodyDark);
  fillEllipse(canvas, tail.x + 4, tail.y + 12, 18, 13, PALETTE.body);

  // 身体
  fillEllipse(canvas, cx, cy, bodyRx, bodyRy, PALETTE.body);
  // 背部高光
  const top = rotated(-6, -bodyRy + 14);
  fillEllipse(canvas, top.x, top.y, bodyRx * 0.72, 12, PALETTE.highlight, 0.5);
  // 肚皮
  const belly = rotated(4, 16);
  fillEllipse(canvas, belly.x, belly.y, bodyRx * 0.68, bodyRy * 0.56, PALETTE.belly, 0.94);

  // 侧鳍
  const fin = rotated(-4, bodyRy - 6 + (pose.fin ?? 0));
  fillEllipse(canvas, fin.x, fin.y, 15, 11, PALETTE.bodyDark);

  // 眼睛
  const eyeLeft = rotated(20, -6);
  const eyeRight = rotated(48, -6);
  const eyeShiftX = (pose.lookX ?? 0) * 3.2;
  const eyeShiftY = (pose.lookY ?? 0) * 2.4;

  if (pose.eyeStyle === 'closed' || pose.eyeStyle === 'happy') {
    // 闭眼：一条弧
    drawArc(canvas, eyeLeft.x + eyeShiftX, eyeLeft.y + eyeShiftY, 7, PALETTE.ink);
    drawArc(canvas, eyeRight.x + eyeShiftX, eyeRight.y + eyeShiftY, 7, PALETTE.ink);
  } else if (pose.eyeStyle === 'cross') {
    drawCross(canvas, eyeLeft.x, eyeLeft.y, 6, PALETTE.ink);
    drawCross(canvas, eyeRight.x, eyeRight.y, 6, PALETTE.ink);
  } else {
    const eyeRy = pose.eyeStyle === 'wide' ? 9 : 12;
    fillEllipse(canvas, eyeLeft.x, eyeLeft.y, 7.5, eyeRy, PALETTE.ink);
    fillEllipse(canvas, eyeRight.x, eyeRight.y, 7.5, eyeRy, PALETTE.ink);
    fillEllipse(canvas, eyeLeft.x + 2.2 + eyeShiftX, eyeLeft.y - 3 + eyeShiftY, 2.6, 3.0, [255, 255, 255]);
    fillEllipse(canvas, eyeRight.x + 2.2 + eyeShiftX, eyeRight.y - 3 + eyeShiftY, 2.6, 3.0, [255, 255, 255]);
  }

  // 腮红
  if (pose.blush !== false) {
    const blush = rotated(14, 16);
    fillEllipse(canvas, blush.x, blush.y, 8, 5, PALETTE.blush, 0.5);
  }
}

/** 一小段弧（当作闭眼）。 */
function drawArc(canvas, cx, cy, radius, color) {
  for (let i = 0; i <= 40; i += 1) {
    const angle = Math.PI * (0.15 + (0.7 * i) / 40);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius * 0.7;
    fillEllipse(canvas, x, y, 1.6, 1.6, color);
  }
}

/** 叉眼（失败态）。 */
function drawCross(canvas, cx, cy, radius, color) {
  for (let t = -1; t <= 1; t += 0.05) {
    fillEllipse(canvas, cx + t * radius, cy + t * radius, 1.5, 1.5, color);
    fillEllipse(canvas, cx + t * radius, cy - t * radius, 1.5, 1.5, color);
  }
}

// ── 每一行的姿态 ──────────────────────────────────────────────────────────
/** 行定义：[行号, 用到的列数, 名称] —— 与官方 animation-rows 规范一致。 */
const ROW_SPEC = [
  [0, 6, 'idle'],
  [1, 8, 'running-right'],
  [2, 8, 'running-left'],
  [3, 4, 'waving'],
  [4, 5, 'jumping'],
  [5, 8, 'failed'],
  [6, 6, 'waiting'],
  [7, 6, 'running'],
  [8, 6, 'review'],
  [9, 8, 'look-A'],
  [10, 8, 'look-B'],
];

/** 给一帧生成姿态参数（占位用，只要每行肉眼可区分即可）。 */
function poseFor(row, col) {
  const phase = (col / 8) * Math.PI * 2;
  switch (row) {
    case 0: // idle：轻微呼吸 + 一次眨眼
      return {
        shiftY: Math.sin(phase) * 2.2,
        tail: Math.sin(phase) * 2,
        eyeStyle: col === 3 ? 'closed' : 'open',
      };
    case 1: // running-right：向右倾，尾鳍交替
      return {
        shiftX: 6,
        shiftY: Math.sin(phase) * 3,
        tilt: 0.10 + Math.sin(phase) * 0.05,
        tail: Math.cos(phase) * 8,
        fin: Math.sin(phase) * 5,
      };
    case 2: // running-left
      return {
        shiftX: -6,
        shiftY: Math.sin(phase) * 3,
        tilt: -0.10 - Math.sin(phase) * 0.05,
        tail: Math.cos(phase) * 8,
        fin: Math.sin(phase) * 5,
      };
    case 3: // waving：侧鳍抬起
      return {
        shiftY: col === 1 || col === 2 ? -4 : 0,
        fin: col === 0 ? 0 : col === 3 ? 2 : -26,
        tilt: col === 1 ? 0.08 : col === 2 ? -0.05 : 0,
        eyeStyle: 'happy',
      };
    case 4: // jumping：整体上下
      return {
        shiftY: [6, -6, -22, -6, 4][col] ?? 0,
        fin: [4, -6, -14, -6, 2][col] ?? 0,
        eyeStyle: 'happy',
      };
    case 5: // failed：下沉 + 叉眼
      return {
        shiftY: [0, 5, 10, 13, 12, 8, 4, 1][col] ?? 0,
        tilt: col >= 2 && col <= 4 ? -0.06 : 0,
        eyeStyle: col >= 2 && col <= 5 ? 'cross' : 'closed',
        blush: false,
      };
    case 6: // waiting：抬头
      return {
        shiftY: [0, -3, -4, -3, -2, -1][col] ?? 0,
        tilt: col === 3 ? 0.09 : 0,
        eyeStyle: 'wide',
        lookY: -0.8,
      };
    case 7: // running：专注，小幅点头
      return {
        shiftY: Math.sin(phase * 2) * 1.6,
        tilt: Math.sin(phase * 2) * 0.03,
        lookY: 0.4,
        eyeStyle: col === 3 ? 'closed' : 'open',
      };
    case 8: // review：低头审视
      return {
        shiftY: 3,
        tilt: [0, 0.05, 0.05, 0.12, 0.06, 0][col] ?? 0,
        lookY: 0.9,
        eyeStyle: col === 2 ? 'closed' : 'open',
      };
    case 9:
    case 10: {
      // 注视方向：按角度移动瞳孔
      const index = (row - 9) * 8 + col;
      const degrees = index * 22.5;
      const radians = (degrees * Math.PI) / 180;
      return {
        lookX: Math.sin(radians),
        lookY: -Math.cos(radians),
        eyeStyle: 'open',
        blush: false,
      };
    }
    default:
      return {};
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────
const outputArgIndex = process.argv.indexOf('--out');
const output =
  outputArgIndex >= 0 && process.argv[outputArgIndex + 1] !== undefined
    ? resolve(process.argv[outputArgIndex + 1])
    : join(pluginRoot, 'assets', 'spritesheet.png');

const canvas = createCanvas(WIDTH, HEIGHT);

for (const [row, usedCols] of ROW_SPEC) {
  for (let col = 0; col < COLS; col += 1) {
    if (col >= usedCols) continue; // 未使用的格子保持全透明
    drawWhale(canvas, { x: col * CELL.width, y: row * CELL.height }, poseFor(row, col));
  }
}

const png = encodePng(canvas.data, WIDTH, HEIGHT);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, png);

console.log(`占位图集已生成：${output}`);
console.log(`  ${WIDTH} × ${HEIGHT}（${COLS} 列 × ${ROWS} 行，单元格 ${CELL.width}×${CELL.height}）`);
console.log(`  ${(png.length / 1024).toFixed(0)} KB`);

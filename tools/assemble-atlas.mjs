#!/usr/bin/env node
/**
 * 把「散帧」拼成运行时需要的 8×11 图集。
 *
 * 为什么需要它：绘图模型每次只画几张，而且每张的构图是独立的 —— 它不知道
 * 角色必须落在 192×208 的格子里。直接按格子切，超出格子的部分就被切掉了。
 *
 * 这个工具把「对齐网格」这件事从绘图模型手里拿走：
 *
 *   1. 每帧按 alpha **自动裁剪**到角色实际范围
 *   2. 算一个**全局统一缩放** —— 所有帧用同一个比例，保证最大的那帧也放得下
 *      （逐帧各自缩放会让各帧大小不一致，动画会抖）
 *   3. 按**底边居中**放进各自的格子
 *   4. 顺手报告「源图可能已经被裁」和「用了实色背景」这两类问题
 *
 * 所以绘制端只要给出「透明背景的单帧」，不需要关心尺寸和位置。
 *
 * 用法：
 *   node tools/assemble-atlas.mjs <帧目录> [选项]
 *
 * 帧目录两种组织方式，任选：
 *   A. 每个动作一个子目录（推荐，最不容易出错）
 *        frames/idle/0.png 1.png 2.png ...
 *        frames/running-right/0.png ... 7.png
 *   B. 平铺，文件名带动作名与序号
 *        frames/idle-0.png  frames/idle-1.png  frames/running-right-0.png ...
 *
 * 选项：
 *   --out <path>        图集输出路径（默认 assets/spritesheet.png）
 *   --safe <w>x<h>      单元格内的安全区（默认 168x184）
 *   --margin <px>       内容底边距格子底部的距离（默认 12）
 *   --scale <n>         强制统一缩放（默认自动推算）
 *   --anchor <mode>     auto（默认）/ canvas / bottom
 *                       auto：会离地的行（jumping）按整张画布锚定以保留腾空高度，
 *                             其余行按包围盒底边对齐地面线
 *   --key <rrggbb>      把该背景色抠成透明（用于没有 alpha 通道的图）
 *   --tolerance <n>     抠色容差 0-255（默认 48）
 *   --allow-upscale     允许放大（默认只缩小，避免糊掉）
 *   --strict            帧数不符时以失败退出
 *   --dry-run           只报告，不写文件
 *
 * @module tools/assemble-atlas
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { alphaBounds, createCanvas, decodePng, drawScaled, encodePng } from './lib/png.mjs';

// ── 图集契约（必须与 helper/renderer/pet.js 的 ANIMATIONS 一致）─────────────
export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const COLUMNS = 8;
export const ROWS = 11;

/**
 * 每一行的动作、期望帧数与可接受的别名。
 * 别名统一小写、把空格与下划线换成连字符后比较。
 */
export const ROW_SPECS = [
  { row: 0, name: 'idle', expected: 6, aliases: ['idle', 'stand', '待机', '静止', '呼吸'] },
  { row: 1, name: 'running-right', expected: 8, aliases: ['running-right', 'run-right', 'right', '向右', '右走', '右跑'] },
  { row: 2, name: 'running-left', expected: 8, aliases: ['running-left', 'run-left', 'left', '向左', '左走', '左跑'] },
  { row: 3, name: 'waving', expected: 4, aliases: ['waving', 'wave', '挥手', '打招呼'] },
  { row: 4, name: 'jumping', expected: 5, aliases: ['jumping', 'jump', '跳跃', '跳'] },
  { row: 5, name: 'failed', expected: 8, aliases: ['failed', 'fail', 'error', 'sad', '出错', '失败', '沮丧'] },
  { row: 6, name: 'waiting', expected: 6, aliases: ['waiting', 'wait', '等待', '等你确认'] },
  { row: 7, name: 'running', expected: 6, aliases: ['running', 'working', 'work', '干活', '思考'] },
  { row: 8, name: 'review', expected: 6, aliases: ['review', '检查', '检查结果'] },
  { row: 9, name: 'look-a', expected: 8, aliases: ['look-a', 'looka', 'direction-a', 'look-up', '注视a', '注视上'] },
  { row: 10, name: 'look-b', expected: 8, aliases: ['look-b', 'lookb', 'direction-b', 'look-down', '注视b', '注视下'] },
];

/**
 * 这些行动作本身会「离开地面」，必须保留角色在画布里的**高低位置**。
 *
 * 其余行都是踩在地面上的，按包围盒底边对齐到地面线即可 —— 这样更省空间，
 * 也不会因为尾巴/光影多出一点像素就整体偏移。
 */
const CANVAS_ANCHORED_ROWS = new Set([4]); // jumping

const ALIAS_TO_ROW = new Map();
for (const spec of ROW_SPECS) {
  for (const alias of spec.aliases) ALIAS_TO_ROW.set(normalizeName(alias), spec.row);
}

/** 动作名归一化：小写、空格与下划线转连字符。 */
export function normalizeName(value) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/**
 * 别名按长度从长到短排。
 *
 * 必须长的优先：`running-right` 要先于 `right` 和 `running` 被匹配到，
 * 否则 `running-right-3.png` 会被误判成 `right` 行。
 */
const ALIASES_LONGEST_FIRST = (() => {
  const entries = [];
  for (const spec of ROW_SPECS) {
    for (const alias of spec.aliases) {
      entries.push({ row: spec.row, tokens: normalizeName(alias).split('-').filter(Boolean), length: normalizeName(alias).length });
    }
  }
  return entries.sort((a, b) => b.length - a.length);
})();

/** tokens 里是否按顺序出现过 needle（允许中间夹别的词）。 */
function containsTokens(tokens, needle) {
  if (needle.length === 0 || needle.length > tokens.length) return false;
  for (let start = 0; start + needle.length <= tokens.length; start += 1) {
    let ok = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (tokens[start + offset] !== needle[offset]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * 从文件名（去掉扩展名、去掉末尾序号）里认出动作行号。
 *
 * 宽松匹配：`idle-0`、`whale-idle-0`、`鲸鱼_待机_3` 都能认出来。
 * 只要归一化后的词序列里按顺序出现过某个别名即可。
 */
export function matchRowFromStem(stem) {
  const tokens = normalizeName(stem).split('-').filter(Boolean);
  // 去掉末尾的纯数字（帧号）
  while (tokens.length > 0 && /^\d+$/.test(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length === 0) return undefined;
  for (const entry of ALIASES_LONGEST_FIRST) {
    if (containsTokens(tokens, entry.tokens)) return entry.row;
  }
  return undefined;
}

// ── 参数 ──────────────────────────────────────────────────────────────────
export const DEFAULT_OPTIONS = {
  framesDir: null,
  out: 'assets/spritesheet.png',
  safeWidth: 168,
  safeHeight: 184,
  margin: 12,
  scale: null,
  anchor: 'auto',
  key: null,
  tolerance: 48,
  allowUpscale: false,
  strict: false,
  dryRun: false,
};

export function parseArguments(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} 缺少值`);
      return argv[i];
    };

    if (arg === '--out') options.out = next();
    else if (arg === '--safe') {
      const match = /^(\d+)x(\d+)$/.exec(next());
      if (match === null) throw new Error('--safe 的格式应为 宽x高，例如 168x184');
      options.safeWidth = Number(match[1]);
      options.safeHeight = Number(match[2]);
    } else if (arg === '--margin') options.margin = Number(next());
    else if (arg === '--scale') options.scale = Number(next());
    else if (arg === '--anchor') {
      const value = next();
      if (!['auto', 'canvas', 'bottom'].includes(value)) {
        throw new Error('--anchor 只能是 auto / canvas / bottom');
      }
      options.anchor = value;
    }
    else if (arg === '--key') options.key = next();
    else if (arg === '--tolerance') options.tolerance = Number(next());
    else if (arg === '--allow-upscale') options.allowUpscale = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--')) throw new Error(`未知选项 ${arg}`);
    else if (options.framesDir === null) options.framesDir = arg;
    else throw new Error(`多余的参数 ${arg}`);
  }

  if (options.framesDir === null) throw new Error('缺少帧目录参数');
  if (options.safeWidth > CELL_WIDTH || options.safeHeight > CELL_HEIGHT - options.margin) {
    throw new Error(`安全区 ${options.safeWidth}x${options.safeHeight} 配合 margin ${options.margin} 会超出单元格`);
  }
  return options;
}

// ── 帧发现 ────────────────────────────────────────────────────────────────
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** 从文件名里取序号用于排序；取不到就排到最后。 */
function frameIndex(name) {
  const matches = name.match(/\d+/g);
  return matches === null ? Number.MAX_SAFE_INTEGER : Number(matches[matches.length - 1]);
}

/**
 * 扫描目录。
 * @returns {Promise<{ rows: Map<number, string[]>, unknown: string[] }>}
 */
export async function discoverFrames(framesDir) {
  const rows = new Map();
  const unknown = [];
  const push = (row, file) => {
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(file);
  };

  const entries = await readdir(framesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      const row = ALIAS_TO_ROW.get(normalizeName(entry.name)) ?? matchRowFromStem(entry.name);
      if (row === undefined) {
        unknown.push(`${entry.name}/（目录名不是已知动作）`);
        continue;
      }
      const inner = await readdir(join(framesDir, entry.name));
      for (const file of inner) {
        if (extname(file).toLowerCase() !== '.png') continue;
        push(row, join(framesDir, entry.name, file));
      }
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (extension !== '.png') {
      if (['.webp', '.jpg', '.jpeg', '.gif'].includes(extension)) {
        unknown.push(`${entry.name}（格式 ${extension} 不支持，请先转成 PNG）`);
      }
      continue;
    }

    // 平铺命名：支持 `idle-0.png`、`whale-idle-0.png`、`鲸鱼_待机_3.png` 等
    const stem = entry.name.slice(0, -extension.length);
    const row = matchRowFromStem(stem);
    if (row === undefined) {
      unknown.push(`${entry.name}（文件名里认不出动作）—— 请把动作名写进文件名，或按动作分目录`);
      continue;
    }
    push(row, join(framesDir, entry.name));
  }

  for (const list of rows.values()) {
    list.sort((a, b) => frameIndex(a) - frameIndex(b) || a.localeCompare(b));
  }
  return { rows, unknown };
}

// ── 抠色 ──────────────────────────────────────────────────────────────────
export function parseKeyColor(value) {
  const hex = value.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`--key 需要 6 位十六进制颜色，例如 FF00FF（收到 ${value}）`);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

const CHANNEL_INDEX = { r: 0, g: 1, b: 2 };

/**
 * 把接近背景色的像素抠成透明，并做去溢色。
 * 边缘用一段软过渡，免得留下硬锯齿。
 * @returns {number} 被处理到的像素数
 */
export function chromaKey(image, color, tolerance) {
  const inner = tolerance * 0.55;
  let touched = 0;

  // 背景色里最突出的通道，用于去溢色
  const strongest = ['r', 'g', 'b'].reduce((best, channel) => (color[channel] > color[best] ? channel : best), 'r');
  const strongIndex = CHANNEL_INDEX[strongest];
  const otherIndexes = [0, 1, 2].filter((index) => index !== strongIndex);

  for (let i = 0; i < image.width * image.height; i += 1) {
    const index = i * 4;
    const r = image.data[index];
    const g = image.data[index + 1];
    const b = image.data[index + 2];
    const distance = Math.sqrt((r - color.r) ** 2 + (g - color.g) ** 2 + (b - color.b) ** 2);

    if (distance >= tolerance) continue;
    const factor = distance <= inner ? 0 : (distance - inner) / (tolerance - inner);
    image.data[index + 3] = Math.round(image.data[index + 3] * factor);
    touched += 1;

    // 去溢色：把背景色最突出的通道压到其余两个通道的水平，
    // 否则边缘会残留一圈背景色的描边。
    if (image.data[index + 3] > 0) {
      const limit = Math.max(image.data[index + otherIndexes[0]], image.data[index + otherIndexes[1]]);
      if (image.data[index + strongIndex] > limit) image.data[index + strongIndex] = limit;
    }
  }

  return touched;
}

/** 画布最外一圈是否完全不透明 —— 用来区分「实色背景」与「角色刚好填满」。 */
export function hasOpaqueBorder(image) {
  const at = (x, y) => image.data[(y * image.width + x) * 4 + 3];
  for (let x = 0; x < image.width; x += 1) {
    if (at(x, 0) !== 255 || at(x, image.height - 1) !== 255) return false;
  }
  for (let y = 0; y < image.height; y += 1) {
    if (at(0, y) !== 255 || at(image.width - 1, y) !== 255) return false;
  }
  return true;
}

// ── 主流程 ────────────────────────────────────────────────────────────────

/**
 * 执行拼装。
 * @param {ReturnType<typeof parseArguments>} options
 * @returns {Promise<{ atlas: object, report: object }>}
 */
export async function assemble(options) {
  const framesDir = resolve(options.framesDir);
  if (!(await exists(framesDir))) throw new Error(`帧目录不存在：${framesDir}`);

  const { rows, unknown } = await discoverFrames(framesDir);
  if (rows.size === 0) {
    throw new Error('没有发现任何可识别的帧。目录名或文件名需要能对应到动作（如 idle / 待机）。');
  }

  const keyColor = options.key === null ? null : parseKeyColor(options.key);

  // ① 解码 → 可选抠色 → 自动裁剪
  const problems = [];
  const frames = [];

  for (const spec of ROW_SPECS) {
    for (const file of rows.get(spec.row) ?? []) {
      const image = decodePng(await readFile(file));
      const label = file.slice(framesDir.length + 1);

      if (keyColor !== null) chromaKey(image, keyColor, options.tolerance);

      const bounds = alphaBounds(image);
      if (bounds === null) {
        problems.push(`${label}：整张图全透明，已跳过`);
        continue;
      }

      const touchesBorder =
        bounds.left === 0 || bounds.top === 0 || bounds.right === image.width - 1 || bounds.bottom === image.height - 1;

      // 裁剪到角色实际范围
      const cropped = createCanvas(bounds.width, bounds.height);
      for (let y = 0; y < bounds.height; y += 1) {
        const from = ((bounds.top + y) * image.width + bounds.left) * 4;
        image.data.copy(cropped.data, y * bounds.width * 4, from, from + bounds.width * 4);
      }

      if (keyColor === null && !image.hasAlpha) {
        // 源文件根本没有 alpha 通道 —— 不是"贴边"，是实色背景。
        problems.push(`${label}：源文件没有 alpha 通道（实色背景）。请输出透明底，或用 --key <背景色> 抠掉`);
      } else if (keyColor === null && touchesBorder && hasOpaqueBorder(image)) {
        // 有 alpha 但整圈边框都不透明：几乎可以断定是实色背景。
        problems.push(
          `${label}：整圈边框都不透明 —— 大概率是实色背景而非透明底（角色刚好填满画布的情况很少见）。请确认，或用 --key 抠色`,
        );
      } else if (keyColor === null && touchesBorder) {
        problems.push(`${label}：角色贴到了画布边缘，源图里可能已经被裁掉了。这一帧建议重画（四周留些余量）`);
      }

      // 跳跃这类会离地的动作必须保留角色在画布里的高低位置，
      // 否则把包围盒底边对齐到地面线会把腾空高度压平。
      const useCanvas = options.anchor === 'canvas' || (options.anchor === 'auto' && CANVAS_ANCHORED_ROWS.has(spec.row));

      frames.push({
        row: spec.row,
        file: label,
        mode: useCanvas ? 'canvas' : 'bottom',
        // canvas 模式保留整张画布（含角色在画布内的位置）；bottom 模式用裁剪后的图
        placement: useCanvas ? image : cropped,
        // 角色在源画布里的最低点，用来推算该行自己的地面线
        contentBottom: bounds.bottom,
      });
    }
  }

  if (frames.length === 0) throw new Error('所有帧都是空的，检查一下图片是不是真的没有内容');

  // ② 全局统一缩放（所有帧同一比例，动画才不会忽大忽小）
  const required = frames.map((frame) =>
    Math.min(options.safeWidth / frame.placement.width, options.safeHeight / frame.placement.height),
  );
  const limitingIndex = required.indexOf(Math.min(...required));
  let scale = options.scale ?? Math.min(...required);
  if (options.scale === null && !options.allowUpscale) scale = Math.min(scale, 1);

  const sorted = [...required].sort((a, b) => a - b);

  // 画布模式下，把「该行角色的最低点」对齐到格子的地面线。
  // 这样它和按包围盒锚定的行落在同一条线上，跨行播放不会整体上下跳。
  // 跳跃行里落地的那几帧决定了这条线（它们的最低点最大）。
  const groundLines = new Map();
  for (const spec of ROW_SPECS) {
    const rowFrames = frames.filter((frame) => frame.row === spec.row && frame.mode === 'canvas');
    if (rowFrames.length === 0) continue;
    groundLines.set(spec.row, Math.max(...rowFrames.map((frame) => frame.contentBottom)));
  }

  // ③ 合成：底边居中
  const atlas = createCanvas(CELL_WIDTH * COLUMNS, CELL_HEIGHT * ROWS);

  for (const spec of ROW_SPECS) {
    frames
      .filter((frame) => frame.row === spec.row)
      .forEach((frame, column) => {
        const width = frame.placement.width * scale;
        const height = frame.placement.height * scale;
        const x = column * CELL_WIDTH + (CELL_WIDTH - width) / 2;
        // 底边对齐：摆放对象的底边距格子底部恰好 margin 像素
        let y = spec.row * CELL_HEIGHT + CELL_HEIGHT - options.margin - height;
        if (frame.mode === 'canvas') {
          // 画布模式：让该行的地面线落在格子地面线上，而不是让画布底边贴底。
          // 画布底部那圈留白（脚线以下的部分）因此会溢出到 margin 里 ——
          // 那部分本来就是透明的，不会越出格子。
          y = spec.row * CELL_HEIGHT + CELL_HEIGHT - options.margin - groundLines.get(spec.row) * scale;
        }
        drawScaled(frame.placement, atlas, Math.round(x), Math.round(y), scale);
      });
  }

  // canvas 模式下，同一批帧必须来自同样大小的画布，否则对齐会错。
  const canvasFrames = frames.filter((frame) => frame.mode === 'canvas');
  if (canvasFrames.length > 1) {
    const sizes = new Set(canvasFrames.map((frame) => `${frame.placement.width}×${frame.placement.height}`));
    if (sizes.size > 1) {
      problems.push(
        `按画布锚定的帧尺寸不一致（${[...sizes].join('、')}）—— 这些帧放进去会高低不齐。` +
          '请让绘制端对这些帧使用同一尺寸的画布，或改用 --anchor bottom。',
      );
    }
  }

  const rowCounts = ROW_SPECS.map((spec) => ({
    row: spec.row,
    name: spec.name,
    expected: spec.expected,
    count: frames.filter((frame) => frame.row === spec.row).length,
  }));

  return {
    atlas,
    report: {
      framesDir,
      unknown,
      problems,
      rowCounts,
      scale,
      forcedScale: options.scale !== null,
      limitingFile: frames[limitingIndex].file,
      limitingSize: `${frames[limitingIndex].placement.width}×${frames[limitingIndex].placement.height}`,
      anchorModes: [...new Set(frames.map((frame) => frame.mode))],
      requiredStats: {
        min: sorted[0],
        median: sorted[Math.floor(sorted.length / 2)],
        max: sorted[sorted.length - 1],
      },
      frameCount: frames.length,
      atlasWidth: atlas.width,
      atlasHeight: atlas.height,
      margin: options.margin,
      // strict 的语义是「必须完全符合契约」—— 包括某一行整行缺失。
      complete: rowCounts.every((row) => row.count === row.expected),
      hasProblems: problems.length > 0,
    },
  };
}

/** 把报告渲染成给人看的文本。 */
export function formatReport(report, { dryRun }) {
  const lines = [];
  lines.push(`帧目录：${report.framesDir}`);
  lines.push(`模式：${dryRun ? '预演（不写文件）' : '实际写入'}`);

  if (report.unknown.length > 0) {
    lines.push('', '⚠️  以下几项被忽略：');
    for (const item of report.unknown) lines.push(`     ${item}`);
  }

  lines.push('', '各行动作：');
  for (const row of report.rowCounts) {
    const ok = row.count === row.expected;
    const mark = row.count === 0 ? '·' : ok ? '✓' : '⚠';
    const suffix =
      row.count === 0
        ? '（缺失，运行时会回落到待机）'
        : ok
          ? ''
          : row.count < row.expected
            ? `（少 ${row.expected - row.count} 帧，缺失的格子会空白）`
            : `（多 ${row.count - row.expected} 帧，多余的会被忽略）`;
    lines.push(`  ${mark} 第 ${String(row.row).padStart(2)} 行  ${row.name.padEnd(14)} ${row.count}/${row.expected} ${suffix}`);
  }

  const anchorText = report.anchorModes
    .map((mode) => (mode === 'canvas' ? '整张画布（保留离地高度）' : '包围盒底边（对齐地面线）'))
    .join(' ＋ ');
  lines.push('', `锚定方式：${anchorText}`);
  lines.push(`缩放：统一 ${report.scale.toFixed(4)}${report.forcedScale ? '（手动指定）' : ''}`);
  if (!report.forcedScale) {
    lines.push(`  受限帧：${report.limitingFile}（裁剪后 ${report.limitingSize}）`);
    const { min, median, max } = report.requiredStats;
    lines.push(`  各帧所需缩放的分布：最小 ${min.toFixed(3)} / 中位 ${median.toFixed(3)} / 最大 ${max.toFixed(3)}`);
    if (report.scale < 0.05) {
      lines.push('  ⚠️  缩放非常小 —— 可能有某几帧画布特别大（比如整张 1024×1024 只有一个角色）。');
      lines.push('      用 --scale 手动指定一个更大的值，再检查会不会被裁。');
    }
    if (report.scale === 1 && min > 1) {
      lines.push(`  ·  图片本身小于安全区。加 --allow-upscale 可放大到 ${min.toFixed(2)}×（会有重采样损失）。`);
    }
  }

  if (report.hasProblems) {
    lines.push('', `⚠️  发现 ${report.problems.length} 处可能的问题：`);
    for (const problem of report.problems.slice(0, 20)) lines.push(`     ${problem}`);
    if (report.problems.length > 20) lines.push(`     …还有 ${report.problems.length - 20} 处`);
  } else {
    lines.push('', '✓ 没有发现贴边、缺帧或背景不透明的问题');
  }

  return lines.join('\n');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { atlas, report } = await assemble(options);

  console.log(`\n${formatReport(report, options)}\n`);

  if (options.dryRun) {
    console.log('预演结束，未写入文件。');
  } else {
    const outPath = resolve(options.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, encodePng(atlas.data, atlas.width, atlas.height));
    console.log(`图集：${outPath}（${atlas.width}×${atlas.height}）`);
  }

  if (options.strict && (!report.complete || report.hasProblems)) {
    console.log('--strict 已开启且存在问题，以失败退出。');
    process.exitCode = 1;
  }
}

// 只有被直接执行时才跑 CLI；被 import 时只暴露上面的函数，方便测试。
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\n失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

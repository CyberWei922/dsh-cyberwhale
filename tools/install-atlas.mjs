#!/usr/bin/env node
/**
 * 安装正式图集：校验几何 → 复制进 assets/ → 更新 pet.json。
 *
 * 只认官方契约的几何：8 列 × 11 行，单元格 192×208，总计 1536×2288。
 * 不满足就直接拒绝，避免把错尺寸的图塞进项目后才发现播放错位。
 *
 * 不依赖任何图像库：PNG 读 IHDR，WebP 读 VP8X/VP8/VP8L 头。
 *
 * 用法：
 *   node tools/install-atlas.mjs <图集文件> [--name whale] [--display "大肥鲸"] [--dry-run]
 */

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

const EXPECTED = { width: 1536, height: 2288, cols: 8, rows: 11, cellWidth: 192, cellHeight: 208 };
/** 也接受 9 行的中间产物，但会提示这不是最终形态。 */
const INTERMEDIATE = { width: 1536, height: 1872, cols: 8, rows: 9 };

function readPngSize(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readWebpSize(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);

  if (chunk === 'VP8X') {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  if (chunk === 'VP8 ') {
    // 关键帧头：找 0x9d 0x01 0x2a 同步码后面的 14 位宽高。
    const start = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 12);
    if (start < 0 || start + 7 > buffer.length) return null;
    return {
      width: buffer.readUInt16LE(start + 3) & 0x3fff,
      height: buffer.readUInt16LE(start + 5) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function readSize(buffer) {
  return readPngSize(buffer) ?? readWebpSize(buffer);
}

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const input = process.argv.find((value, index) => index >= 2 && !value.startsWith('--') && process.argv[index - 1]?.startsWith('--') !== true);
const dryRun = process.argv.includes('--dry-run');

if (input === undefined) {
  console.error('用法：node tools/install-atlas.mjs <图集文件> [--name whale] [--display "大肥鲸"] [--dry-run]');
  process.exitCode = 1;
  process.exit();
}

const sourcePath = resolve(input);
const buffer = await readFile(sourcePath);
const size = readSize(buffer);

console.log(`读取：${sourcePath}`);
console.log(`  大小：${(buffer.length / 1024).toFixed(0)} KB`);

if (size === null) {
  console.error('  ✗ 无法识别为 PNG 或 WebP（是否用了 JPEG？契约要求带 alpha 的 PNG/WebP）');
  process.exitCode = 1;
  process.exit();
}

console.log(`  尺寸：${size.width} × ${size.height}`);

const isFinal = size.width === EXPECTED.width && size.height === EXPECTED.height;
const isIntermediate = size.width === INTERMEDIATE.width && size.height === INTERMEDIATE.height;

if (!isFinal && !isIntermediate) {
  console.error(`  ✗ 尺寸不符合契约`);
  console.error(`    期望 ${EXPECTED.width} × ${EXPECTED.height}（${EXPECTED.cols} 列 × ${EXPECTED.rows} 行）`);
  console.error(`    实际 ${size.width} × ${size.height}`);
  console.error(`    提示：每格应为 ${EXPECTED.cellWidth}×${EXPECTED.cellHeight}，` +
    `列宽 ${size.width / EXPECTED.cols} 行高 ${size.height / EXPECTED.rows}`);
  process.exitCode = 1;
  process.exit();
}

if (isIntermediate) {
  console.warn('  ⚠ 这是 8×9 的中间产物（缺少第 9/10 行的 16 个注视方向）');
  console.warn('    可以安装，但"眼睛跟随鼠标"会退化为一直播放当前动画。');
}

const extension = extname(sourcePath).toLowerCase();
if (!['.png', '.webp'].includes(extension)) {
  console.error(`  ✗ 扩展名必须是 .png 或 .webp，实际 ${extension}`);
  process.exitCode = 1;
  process.exit();
}

const id = flag('name', 'whale');
const displayName = flag('display', '大肥鲸');
const destination = join(pluginRoot, 'assets', `spritesheet${extension}`);

console.log(`\n安装计划：`);
console.log(`  图集 → assets/spritesheet${extension}`);
console.log(`  清单 → assets/pet.json（id=${id}，displayName=${displayName}）`);

if (dryRun) {
  console.log('\n--dry-run：未写入任何文件。');
  process.exit(0);
}

await copyFile(sourcePath, destination);
await writeFile(
  join(pluginRoot, 'assets', 'pet.json'),
  `${JSON.stringify(
    {
      id,
      displayName,
      description: '一只陪你在桌面上写代码的蓝色鲸鱼。',
      spriteVersionNumber: 2,
      spritesheetPath: basename(destination),
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log('\n✓ 已安装。');
console.log('  下一步：在 DSH 里打开「设置 → 通用 → 桌宠」，点「重载素材」即可看到新形象。');

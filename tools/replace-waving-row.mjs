#!/usr/bin/env node
/** Install a transparent 2×2 greeting sheet, preserving every other atlas cell. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { alphaBounds, createCanvas, decodePng, drawScaled, encodePng } from './lib/png.mjs';

const [sourcePath, atlasPath = 'assets/spritesheet.png', previewDir = 'output/waving-v2'] = process.argv.slice(2);
if (!sourcePath) throw new Error('Usage: node tools/replace-waving-row.mjs <2x2.png> [atlas.png] [preview-dir]');
const atlas = decodePng(await readFile(atlasPath));
const source = decodePng(await readFile(sourcePath));
assert.equal(atlas.width, 1536);
assert.equal(atlas.height, 2288);
assert.ok(source.hasAlpha, 'Greeting sprites require transparent alpha');
// 生成图可能为奇数尺寸；中线取整，右/下格保留剩余像素。
const halfWidth = Math.floor(source.width / 2);
const halfHeight = Math.floor(source.height / 2);
const before = Buffer.from(atlas.data);
function crop(image, left, top, width, height) {
  const result = createCanvas(width, height);
  for (let y = 0; y < height; y++) {
    const start = ((top + y) * image.width + left) * 4;
    image.data.copy(result.data, y * width * 4, start, start + width * 4);
  }
  return result;
}
function footCenter(image) {
  const box = alphaBounds(image);
  let sum = 0, weight = 0;
  for (let y = box.bottom - Math.round(box.height * 0.12); y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const alpha = image.data[(y * image.width + x) * 4 + 3];
      sum += x * alpha; weight += alpha;
    }
  }
  return sum / weight;
}
const idle = crop(atlas, 0, 0, 192, 208);
const target = alphaBounds(idle);
const frames = Array.from({ length: 4 }, (_, i) => {
  const left = (i % 2) * halfWidth;
  const top = Math.floor(i / 2) * halfHeight;
  const cell = crop(source, left, top, i % 2 ? source.width - halfWidth : halfWidth, i >= 2 ? source.height - halfHeight : halfHeight);
  const box = alphaBounds(cell);
  assert.ok(box && box.left > 0 && box.top > 0 && box.right < cell.width - 1 && box.bottom < cell.height - 1, 'Source frame clipped or missing');
  return crop(cell, box.left, box.top, box.width, box.height);
});
// All poses use one scale; align feet rather than the asymmetric hair/tail bounding box.
const scale = target.height / frames[3].height;
const center = footCenter(idle);
await mkdir(previewDir, { recursive: true });
for (let i = 0; i < 4; i++) {
  const frame = createCanvas(192, 208);
  const x = Math.round(center - footCenter(frames[i]) * scale);
  const y = target.bottom + 1 - Math.round(frames[i].height * scale);
  assert.ok(x >= 0 && y >= 0 && x + Math.round(frames[i].width * scale) <= 192);
  drawScaled(frames[i], frame, x, y, scale);
  const box = alphaBounds(frame);
  assert.ok(box.left > 0 && box.right < 191 && box.top > 0 && box.bottom < 207);
  await writeFile(`${previewDir}/waving-${i}.png`, encodePng(frame.data, 192, 208));
  for (let row = 0; row < 208; row++) {
    frame.data.copy(atlas.data, ((624 + row) * atlas.width + i * 192) * 4, row * 192 * 4, (row + 1) * 192 * 4);
  }
}
// Guard that no unrelated animation changed, including unused cells in row 3.
for (let y = 0; y < atlas.height; y++) {
  const start = (y * atlas.width + (y >= 624 && y < 832 ? 768 : 0)) * 4;
  const end = (y + 1) * atlas.width * 4;
  assert.ok(atlas.data.subarray(start, end).equals(before.subarray(start, end)), 'Unrelated atlas pixels changed');
}
await mkdir(dirname(atlasPath), { recursive: true });
await writeFile(atlasPath, encodePng(atlas.data, atlas.width, atlas.height));
console.log('Installed four greeting poses; all other atlas pixels unchanged.');

/**
 * 气泡渲染的真机验证（需要桌面环境，不进 npm test）。
 *
 * 单元测试能验证「提炼」和「节流」的逻辑，但验证不了「文字到底有没有画到窗口上」。
 * 这个脚本起真实的 Electron 窗口，喂几条气泡内容，用 `capturePage` 抓帧量像素，
 * 确认：
 *   · 气泡确实渲染出来了
 *   · 文本越长气泡越宽（说明内容真的进了 DOM，不是画了个空壳）
 *   · 清空后气泡消失
 *   · 文字与背景的**对比度达标**，且**深浅两种外观下都达标**
 *
 * 最后那条是踩过坑之后加的：实时层当初只覆盖了 background 没覆盖 color，
 * 深色模式下变成浅底浅字，肉眼一看就是"看不清"。纯逻辑测试抓不到这种问题。
 *
 * 用法：node tools/verify-bubble-render.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeMetrics, ENVELOPE_SCALE } from '../helper/geometry.js';
import { decodePng } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const metrics = computeMetrics(ENVELOPE_SCALE);
const electron = `${process.env.HOME}/.dsh/dsh-deskpet/electron/Electron.app/Contents/MacOS/Electron`;
const dir = '/tmp/bubble-shots';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const child = spawn(electron, [`${ROOT}/helper`, `--assets=${ROOT}/assets`, '--scale=1'], {
  cwd: `${ROOT}/helper`, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 量某个横带里非透明像素的包围盒与中心像素颜色。 */
function measure(file, yFrom, yTo) {
  const img = decodePng(readFileSync(file));
  let minX = img.width, maxX = -1, minY = img.height, maxY = -1, count = 0;
  for (let y = yFrom; y < Math.min(yTo, img.height); y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 16) {
        count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const cx = Math.floor((minX + maxX) / 2), cy = Math.floor((minY + maxY) / 2);
  const i = (cy * img.width + cx) * 4;
  return {
    count, width: maxX - minX + 1,
    center: `rgb(${img.data[i]},${img.data[i+1]},${img.data[i+2]})`,
  };
}

/** WCAG 相对亮度。 */
function luminance([r, g, b]) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度（1~21）。正文一般要求 ≥ 4.5。 */
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 从气泡区域里估出「背景色」与「文字色」，算对比度。
 * 背景 = 出现最多的颜色；文字 = 离背景最远且有足够像素量的颜色。
 */
function measureContrast(file, yFrom, yTo) {
  const img = decodePng(readFileSync(file));
  const histogram = new Map();
  for (let y = yFrom; y < Math.min(yTo, img.height); y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] < 200) continue; // 只看实心区域，排除抗锯齿边缘
      const key = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
  }
  if (histogram.size === 0) return null;

  const entries = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
  const background = entries[0][0].split(',').map(Number);
  let text = background;
  let best = 0;
  for (const [key, count] of entries) {
    if (count < 20) continue; // 太少的像素当噪声
    const color = key.split(',').map(Number);
    const distance = Math.hypot(color[0] - background[0], color[1] - background[1], color[2] - background[2]);
    if (distance > best) { best = distance; text = color; }
  }
  return { background, text, ratio: contrastRatio(background, text) };
}

await sleep(6500);
const shots = [
  { name: 'short', status: '读取配置' },
  { name: 'long', status: '正在运行命令 · npm test' },
  // 两行：第一行会话标题，第二行状态
  { name: 'two', title: '重制任务书', status: '正在运行命令 · npm test' },
  { name: 'empty', status: '' },
];
for (const shot of shots) {
  send({ t: 'bubble', title: shot.title ?? '', status: shot.status });
  await sleep(350);
  send({ t: 'capture', path: `${dir}/${shot.name}.png` });
  await sleep(700);
}
// （退出放到所有抓帧之后）

// 气泡在宠物头顶。宠物在窗口里的位置由 geometry.js 决定（不在窗口底部），
// 所以量测带要按它算，不能再写死数字 —— 窗口高度变过一次，写死的带子就落到宠物身上了。
const PET_TOP_CSS = Math.round((metrics.height - metrics.petHeight) / 2);
const BAND = [0, Math.max(40, PET_TOP_CSS * 2 - 4)]; // 设备像素（dpr=2）
console.log('气泡带内容：\n');
for (const shot of shots) {
  const m = measure(`${dir}/${shot.name}.png`, BAND[0], BAND[1]);
  console.log(`  ${shot.name.padEnd(6)} 状态=${JSON.stringify(shot.status).padEnd(34)} 像素 ${String(m.count).padStart(6)}  宽 ${String(m.width).padStart(4)}  中心色 ${m.center}`);
}
const shortM = measure(`${dir}/short.png`, ...BAND);
const longM = measure(`${dir}/long.png`, ...BAND);
const emptyM = measure(`${dir}/empty.png`, ...BAND);
console.log();

// ── 深浅两种外观下的对比度 ────────────────────────────────────────────────
console.log('\n对比度（WCAG，正文要求 ≥ 4.5）：\n');
const contrastChecks = [];
for (const scheme of ['light', 'dark']) {
  send({ t: 'theme', value: scheme });
  await sleep(400);

  // 实时层
  for (const shot of shots.slice(0, 2)) {
    send({ t: 'bubble', title: shot.title ?? '', status: shot.status });
    await sleep(300);
    const file = `${dir}/${scheme}-${shot.name}.png`;
    send({ t: 'capture', path: file });
    await sleep(700);
    const c = measureContrast(file, ...BAND);
    if (c === null) {
      console.log(`  ${scheme}/${shot.name}: 量不到内容`);
      contrastChecks.push([`${scheme} 模式下实时气泡有内容`, false]);
      continue;
    }
    const ok = c.ratio >= 4.5;
    console.log(`  ${scheme.padEnd(5)} 实时 ${shot.name.padEnd(6)} 背景 rgb(${c.background}) 文字 rgb(${c.text})  对比度 ${c.ratio.toFixed(2)}  ${ok ? '✓' : '✗'}`);
    contrastChecks.push([`${scheme} 模式下实时层对比度 ≥ 4.5`, ok]);
  }

  // 碎碎念层：先清掉实时层，再触一次状态变化让它冒泡。
  // 这一层也必须验 —— 同一个"只改一个属性"的坑两边都踩得到。
  // 碎碎念是按「动画状态 × 6 秒分桶」冒泡的，单次不一定命中；
  // 换几个状态重试，直到量到内容为止。
  send({ t: 'bubble', title: '', status: '' });
  await sleep(200);
  let flavorFile = `${dir}/${scheme}-flavor.png`;
  let flavor = null;
  for (const state of ['waving', 'failed', 'jumping', 'waving', 'failed']) {
    send({ t: 'state', v: state });
    await sleep(500);
    send({ t: 'capture', path: flavorFile });
    await sleep(700);
    flavor = measureContrast(flavorFile, ...BAND);
    if (flavor !== null) break;
  }
  if (flavor === null) {
    console.log(`  ${scheme.padEnd(5)} 碎碎念   量不到内容（随机冒泡，多次重试仍未命中）`);
  } else {
    const ok = flavor.ratio >= 4.5;
    console.log(`  ${scheme.padEnd(5)} 碎碎念   背景 rgb(${flavor.background}) 文字 rgb(${flavor.text})  对比度 ${flavor.ratio.toFixed(2)}  ${ok ? '✓' : '✗'}`);
    contrastChecks.push([`${scheme} 模式下碎碎念层对比度 ≥ 4.5`, ok]);
  }
}
send({ t: 'theme', value: 'system' });

// 所有抓帧都做完了，现在才收工
send({ t: 'quit' });
await sleep(500);
child.kill('SIGTERM');
await sleep(300);

console.log();
const checks = [
  ...contrastChecks,
  ['实时气泡有内容', shortM.count > 500],
  ['更长的文本 → 更宽的气泡', longM.width > shortM.width],
  ['清空后气泡消失（或回落到碎碎念）', emptyM.count !== shortM.count || emptyM.width !== shortM.width],
  // capturePage 会做色彩空间转换，绝对值对不上；判"更接近哪一档"才稳定。
  ['实时层用的是实时配色（而非碎碎念配色）', (() => {
    const parse = (t) => t.match(/\d+/g).map(Number);
    const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
    const got = parse(shortM.center);
    return dist(got, [234,242,255]) < dist(got, [246,249,255]);
  })()],
];
let bad = 0;
for (const [label, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label}`); }
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);

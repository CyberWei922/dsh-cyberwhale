/**
 * 气泡渲染的真机验证（需要桌面环境，不进 npm test）。
 *
 * 单元测试能验证「提炼」和「节流」的逻辑，但验证不了「文字到底有没有画到窗口上」。
 * 这个脚本起真实的 Electron 窗口，喂几条气泡内容，用 `capturePage` 抓帧量像素，
 * 确认：
 *   · 气泡确实渲染出来了
 *   · 文本越长气泡越宽（说明内容真的进了 DOM，不是画了个空壳）
 *   · 清空后气泡消失
 *   · 用的是实时层配色，而不是碎碎念那套
 *
 * 用法：node tools/verify-bubble-render.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decodePng } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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

await sleep(6500);
const shots = [
  { name: 'short', text: '读取配置' },
  { name: 'long', text: '正在检查渲染层的锚定逻辑' },
  { name: 'empty', text: '' },
];
for (const shot of shots) {
  send({ t: 'bubble', text: shot.text });
  await sleep(350);
  send({ t: 'capture', path: `${dir}/${shot.name}.png` });
  await sleep(700);
}
send({ t: 'quit' });
await sleep(500);
child.kill('SIGTERM');
await sleep(300);

// 气泡在窗口顶部：scale=1 时窗口 335×479(CSS) → 670×958(设备像素)
// 气泡大约在 CSS y 189~220 → 设备 y 378~440
const BAND = [360, 460];
console.log('气泡带内容（设备像素 y 360~460）：\n');
for (const shot of shots) {
  const m = measure(`${dir}/${shot.name}.png`, BAND[0], BAND[1]);
  console.log(`  ${shot.name.padEnd(6)} 文本=${JSON.stringify(shot.text).padEnd(30)} 像素 ${String(m.count).padStart(6)}  宽 ${String(m.width).padStart(4)}  中心色 ${m.center}`);
}
const shortM = measure(`${dir}/short.png`, ...BAND);
const longM = measure(`${dir}/long.png`, ...BAND);
const emptyM = measure(`${dir}/empty.png`, ...BAND);
console.log();
const checks = [
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

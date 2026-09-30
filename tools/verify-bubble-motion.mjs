#!/usr/bin/env node
/** 连续移动和翻转的桌面验证；不移动用户光标。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUBBLE_WIDTH, computeMetrics, ENVELOPE_SCALE, petRectInWindow } from '../helper/geometry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = join(process.env.HOME, '.dsh/dsh-cyberwhale/electron/Electron.app/Contents/MacOS/Electron');
const metrics = computeMetrics(ENVELOPE_SCALE);
const pet = petRectInWindow(metrics, 1);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const child = spawn(ELECTRON, [join(ROOT, 'helper'), `--assets=${join(ROOT, 'assets')}`, '--scale=1', '--x=-99999', '--y=300'], {
  cwd: join(ROOT, 'helper'), stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
let buffer = '';
let errors = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    try {
      const message = JSON.parse(line);
      pending.get(message.t)?.(message);
    } catch { /* Electron 的诊断输出可能不是 JSON。 */ }
  }
});
child.stderr.on('data', (chunk) => { errors += chunk; });
const receive = (type) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { pending.delete(type); reject(new Error(`等待 ${type} 超时：${errors.slice(-600)}`)); }, 5000);
  pending.set(type, (message) => { clearTimeout(timer); pending.delete(type); resolve(message); });
});
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
const probe = async () => { const response = receive('probe'); send({ t: 'probe' }); return response; };
const move = (x, y) => send({ t: 'probe-position', x, y });

function checkVisible(sample) {
  const { bubble, window, windowPosition, workArea } = sample;
  assert.equal(sample.bubbleVisible, '1');
  assert.ok(sample.bubbleOpacity >= 0.99, '运动过程中气泡不淡出或消失');
  assert.ok(Math.abs(bubble.width - BUBBLE_WIDTH) < 0.01, '气泡宽度保持固定');
  assert.ok(bubble.left >= 5.9 && bubble.left + bubble.width <= window.width - 5.9, '气泡不得越出原生窗口');
  assert.ok(bubble.top >= 5.9 && bubble.top + bubble.height <= window.height - 5.9, '翻转不得越出原生窗口');
  assert.ok(windowPosition.x + bubble.left >= workArea.x + 5.9, '左侧不得被屏幕裁剪');
  assert.ok(windowPosition.x + bubble.left + bubble.width <= workArea.x + workArea.width - 5.9, '右侧不得被屏幕裁剪');
  assert.ok(windowPosition.y + bubble.top >= workArea.y + 5.9, '顶部不得被屏幕裁剪');
  assert.ok(windowPosition.y + bubble.top + bubble.height <= workArea.y + workArea.height - 5.9, '底部不得被屏幕裁剪');
}

async function samples(count = 18) {
  const result = [];
  for (let i = 0; i < count; i++) {
    await delay(20);
    const sample = await probe();
    checkVisible(sample);
    result.push(sample);
  }
  return result;
}

try {
  await receive('ready');
  send({ t: 'bubble', title: '气泡连续动画验证', status: '左右移动、上下翻转时始终完整可见' });
  await delay(800);
  const initial = await probe();
  checkVisible(initial);
  const { workArea: area } = initial;
  const edgeX = area.x - pet.left;
  const safeY = area.y + 220;

  move(edgeX + 180, safeY);
  const horizontal = await samples();
  assert.ok(horizontal.some((s) => s.bubble.left > s.bubbleTarget.left + 1 && s.bubble.left < initial.bubble.left - 1), '水平滑动应经过中间位置');
  assert.ok(new Set(horizontal.map((s) => s.bubble.left.toFixed(2))).size >= 6, '水平滑动应连续更新');
  console.log('✓ 离开左边缘时平滑回到中间，过程中保持完整可见');

  move(edgeX, safeY);
  await delay(500);
  const dragSamples = [];
  for (let i = 1; i <= 24; i++) {
    move(edgeX + i * 3, safeY);
    await delay(16);
    const sample = await probe();
    checkVisible(sample);
    dragSamples.push(sample);
  }
  assert.ok(new Set(dragSamples.map((s) => s.bubble.left.toFixed(2))).size >= 14, '窗口移动不能仍以 120ms 为一档跳动');
  console.log('✓ 连续拖动时高频同步气泡位置，左右让位不再按 120ms 跳动');

  const centerX = area.x + 600 - metrics.width / 2;
  move(centerX, -99999);
  const down = await samples();
  assert.ok(down.some((s) => s.bubbleSide === 'below' && s.bubble.top < s.bubbleTarget.top - 4), '向下翻转应经过中间位置');
  assert.ok(new Set(down.map((s) => s.bubble.top.toFixed(2))).size >= 3, `向下翻转应经过多个中间帧：${down.map((s) => s.bubble.top.toFixed(2)).join(', ')}`);
  assert.equal(down.at(-1).bubbleSide, 'below');
  console.log('✓ 贴顶部时以动画翻到下方，整段运动中没有消失');

  move(centerX, safeY);
  const up = await samples();
  assert.ok(up.some((s) => s.bubbleSide === 'above' && s.bubble.top > s.bubbleTarget.top + 4), '向上翻转应经过中间位置');
  assert.equal(up.at(-1).bubbleSide, 'above');
  console.log('✓ 离开顶部时以动画回到上方，整段运动中没有消失');

  move(area.x + area.width - pet.left - pet.width, safeY);
  await samples();
  console.log('✓ 右边缘的气泡及两行内容完整留在窗口和屏幕内');
  console.log('全部通过');
} finally {
  send({ t: 'quit' });
  await delay(300);
  child.kill('SIGTERM');
}

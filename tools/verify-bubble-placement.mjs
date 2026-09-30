#!/usr/bin/env node
/**
 * 气泡避让的真机验证（需要桌面环境，不进 npm test）。
 *
 * 验证两件事（借鉴 ChatGPT 桌宠的行为）：
 *   1. 角色贴屏幕顶边 → 气泡翻到脚底
 *   2. 角色贴屏幕左右边 → 气泡让位，不溢出屏幕
 *
 * 为什么必须真机跑：这些行为依赖真实的窗口位置与屏幕工作区，纯单元测试测不到。
 * 为什么要用 DOM 探针而不是截图：窗口伸到屏幕外时合成器会报 UnknownVizError
 * 抓不到帧；从像素里量位置还要处理阴影和抗锯齿。直接问渲染层更准、更稳。
 *
 * 用法：node tools/verify-bubble-placement.mjs
 *
 * @module tools/verify-bubble-placement
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUBBLE_WIDTH, CELL, ENVELOPE_SCALE, computeMetrics, petRectInWindow } from '../helper/geometry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = join(
  process.env.HOME,
  '.dsh',
  'dsh-cyberwhale',
  'electron',
  'Electron.app',
  'Contents',
  'MacOS',
  'Electron',
);
const SCALE = 1.0;
const BUBBLE_TEXT = '正在检查渲染层的锚定逻辑';

/** 气泡与屏幕边缘的最小留白，必须与渲染层一致。 */
const BUBBLE_EDGE = 6;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 取全部屏幕的工作区。
 *
 * 必须取全部而不是只取主屏：这台机器有 2 块屏，把角色拖到最右边时
 * 它会落到**副屏**上，只按主屏算边界会得出"窗口跑出屏幕"的错误结论。
 */
async function getWorkAreas() {
  const dir = '/tmp/deskpet-area-probe';
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"probe","main":"main.js"}');
  writeFileSync(
    join(dir, 'main.js'),
    "const {app,screen}=require('electron');app.whenReady().then(()=>{console.log(JSON.stringify(screen.getAllDisplays().map(d=>d.workArea)));app.quit()});",
  );
  const child = spawn(ELECTRON, [dir], { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  await sleep(4000);
  child.kill('SIGTERM');
  const match = /\[\{"x":-?\d+[\s\S]*?\}\]/.exec(out);
  if (match === null) throw new Error('取不到工作区：' + out.slice(0, 200));
  return JSON.parse(match[0]);
}

/** 找出窗口中心落在（或最接近）哪块屏上。 */
function displayFor(areas, windowX, windowY) {
  const pet = petRectInWindow(computeMetrics(ENVELOPE_SCALE), SCALE);
  const center = { x: windowX + pet.left + pet.width / 2, y: windowY + pet.top + pet.height / 2 };
  let best = areas[0];
  let bestDistance = Infinity;
  for (const area of areas) {
    const dx = Math.max(area.x - center.x, 0, center.x - (area.x + area.width));
    const dy = Math.max(area.y - center.y, 0, center.y - (area.y + area.height));
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = area;
    }
  }
  return best;
}

/** 起一个窗口、发气泡文本、读回气泡与宠物的实际位置。 */
async function probe(name, { x, y }) {
  const child = spawn(
    ELECTRON,
    [join(ROOT, 'helper'), '--assets=' + join(ROOT, 'assets'), '--scale=' + SCALE, '--x=' + x, '--y=' + y],
    {
      cwd: join(ROOT, 'helper'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    },
  );
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');

  const messages = () =>
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);

  await sleep(6500);
  const ready = messages().find((message) => message.t === 'ready');

  send({ t: 'bubble', status: BUBBLE_TEXT });
  await sleep(500);

  let probed = null;
  for (let attempt = 0; attempt < 3 && probed === null; attempt += 1) {
    send({ t: 'probe' });
    await sleep(700);
    probed = messages().filter((message) => message.t === 'probe').pop() ?? null;
  }

  send({ t: 'quit' });
  await sleep(400);
  child.kill('SIGTERM');
  if (probed === null) throw new Error('探针失败（' + name + '）：\n' + out.slice(0, 400));
  return { probed, ready: { ...ready, ...probed.windowPosition } };
}

async function main() {
  const areas = await getWorkAreas();
  const metrics = computeMetrics(ENVELOPE_SCALE);
  const results = [];
  const add = (label, ok, detail) => {
    results.push([label, ok]);
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + label);
    if (detail !== undefined) console.log('      ' + detail);
  };
  const checkWindow = (probed) => {
    const { bubble, window } = probed;
    add('整个气泡都在原生窗口的绘图区内', bubble.left >= BUBBLE_EDGE - 1 && bubble.left + bubble.width <= window.width - BUBBLE_EDGE + 1 && bubble.top >= 0 && bubble.top + bubble.height <= window.height);
    add('贴边后气泡仍保持固定宽度', Math.abs(bubble.width - BUBBLE_WIDTH) < 1);
  };

  console.log('\n共 ' + areas.length + ' 块屏幕：');
  for (const a of areas) console.log('  workArea ' + JSON.stringify(a));
  console.log('窗口 ' + metrics.width + '×' + metrics.height + '（CSS）  宠物 ' + CELL.width * SCALE + '×' + CELL.height * SCALE + '\n');

  // ── 场景 1：角色贴屏幕顶边 → 气泡应翻到脚底 ──────────────────────────
  {
    const { probed, ready } = await probe('top', { x: areas[0].x + 600, y: -99999 });
    const { bubble, pet } = probed;
    console.log('场景 1 · 角色贴屏幕顶边');
    console.log(
      '  窗口 y=' + ready.y + '  宠物 y ' + pet.top.toFixed(0) + '~' + (pet.top + pet.height).toFixed(0) +
        '  气泡 y ' + bubble.top.toFixed(0) + '~' + (bubble.top + bubble.height).toFixed(0) + '  side=' + probed.bubbleSide,
    );
    add('气泡翻到了脚底', probed.bubbleSide === 'below' && bubble.top >= pet.top + pet.height - 1);
    checkWindow(probed);
    console.log();
  }

  // ── 场景 2：角色贴屏幕左边 → 气泡应向右让位 ──────────────────────────
  {
    const { probed, ready } = await probe('left', { x: -99999, y: areas[0].y + 300 });
    const { bubble } = probed;
    const area = displayFor(areas, ready.x, ready.y);
    const viewLeftLocal = area.x - ready.x;
    console.log('场景 2 · 角色贴屏幕左边');
    console.log('  窗口 x=' + ready.x + '  工作区左边界在窗口坐标 x=' + viewLeftLocal + '  气泡 left=' + bubble.left.toFixed(1));
    add(
      '气泡没有溢出屏幕左边',
      bubble.left >= viewLeftLocal + BUBBLE_EDGE - 1,
      '气泡 left ' + bubble.left.toFixed(1) + ' ≥ 边界 ' + viewLeftLocal + ' + 留白 ' + BUBBLE_EDGE,
    );
    checkWindow(probed);
    console.log();
  }

  // ── 场景 3：角色贴屏幕右边 → 气泡应向左让位 ──────────────────────────
  {
    const { probed, ready } = await probe('right', { x: 99999, y: areas[0].y + 300 });
    const { bubble } = probed;
    // 拖到最右边时窗口会落到**副屏**上，边界要用那块屏算
    const area = displayFor(areas, ready.x, ready.y);
    const viewRightLocal = area.x + area.width - ready.x;
    console.log('场景 3 · 角色贴屏幕右边（会落到副屏）');
    console.log(
      '  窗口 x=' + ready.x + '  所在屏右边界在窗口坐标 x=' + viewRightLocal +
        '  气泡 right=' + (bubble.left + bubble.width).toFixed(1),
    );
    add(
      '气泡没有溢出屏幕右边',
      bubble.left + bubble.width <= viewRightLocal - BUBBLE_EDGE + 1,
      '气泡 right ' + (bubble.left + bubble.width).toFixed(1) + ' ≤ 边界 ' + viewRightLocal + ' - 留白 ' + BUBBLE_EDGE,
    );
    checkWindow(probed);
    console.log();
  }

  // ── 场景 4：屏幕中央（对照，气泡应在头顶）────────────────────────────
  {
    const { probed } = await probe('center', { x: areas[0].x + 600, y: areas[0].y + 300 });
    const { bubble, pet } = probed;
    console.log('场景 4 · 屏幕中央（对照）');
    console.log(
      '  宠物 y ' + pet.top.toFixed(0) + '~' + (pet.top + pet.height).toFixed(0) +
        '  气泡 y ' + bubble.top.toFixed(0) + '~' + (bubble.top + bubble.height).toFixed(0) + '  side=' + probed.bubbleSide,
    );
    add('气泡在头顶（默认行为）', probed.bubbleSide === 'above' && bubble.top + bubble.height <= pet.top + 1);
    console.log();
  }

  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed === 0 ? '全部通过' : failed + ' 项未通过');
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('失败：' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});

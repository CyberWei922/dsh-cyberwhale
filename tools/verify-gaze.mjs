#!/usr/bin/env node
/**
 * 注视规则的真机验证（需要桌面环境，不进 npm test）。
 *
 * 验证的是从 Codex 桌宠抄来的四条规则：
 *   1. **只有待机时注视** —— 干活中/等你/挥手等状态一律不注视
 *   2. **鼠标必须停在它身上** —— 鼠标在屏幕别处不算
 *   3. **最多看 10 秒** —— 到点自动回到待机动画
 *   4. **指针一移开立刻停**
 *
 * 为什么要真机跑：这些规则依赖真实窗口里的命中区、缩放与光标投喂，
 * 纯单元测试测不到。为什么要注入光标而不是去移动系统鼠标：
 * 后者不可靠，而且会真的把用户的鼠标拽走。
 *
 * 用法：node tools/verify-gaze.mjs
 *
 * @module tools/verify-gaze
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  if (Object.is(actual, expected)) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  }
}

/** 起一个窗口，返回操作它的若干方法。 */
async function launch() {
  const child = spawn(
    ELECTRON,
    [join(ROOT, 'helper'), `--assets=${join(ROOT, 'assets')}`, `--scale=${SCALE}`],
    {
      cwd: join(ROOT, 'helper'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    },
  );
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const messages = () =>
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);

  await sleep(6500);

  /** 注入光标到窗口坐标 (x, y)。 */
  const moveCursor = (x, y) => send({ t: 'probe-cursor', x, y });

  /** 问一次当前状态。 */
  const probe = async () => {
    const before = messages().filter((m) => m.t === 'probe').length;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      send({ t: 'probe' });
      await sleep(300);
      const found = messages().filter((m) => m.t === 'probe');
      if (found.length > before) return found[found.length - 1];
    }
    throw new Error(`探针无响应：\n${out.slice(0, 400)}`);
  };

  return {
    send,
    probe,
    moveCursor,
    close: () => {
      send({ t: 'probe-cursor', clear: true });
      send({ t: 'quit' });
      child.kill('SIGTERM');
    },
  };
}

async function main() {
  const app = await launch();
  const first = await app.probe();
  const hit = first.hitRect;
  const centerX = Math.round(hit.left + hit.width / 2);
  const centerY = Math.round(hit.top + hit.height / 2);
  // 故意偏离中心，避开 12px 死区
  const onPetX = Math.round(hit.left + hit.width - 12);
  const onPetY = Math.round(hit.top + 14);
  const offPetX = Math.round(hit.left - 60);
  const offPetY = centerY;

  console.log(`\n窗口 ${first.window.width}×${first.window.height}  命中区 x[${hit.left.toFixed(0)},${(hit.left + hit.width).toFixed(0)}] y[${hit.top.toFixed(0)},${(hit.top + hit.height).toFixed(0)}]`);
  console.log(`  身上的取样点 (${onPetX}, ${onPetY})   身边外 (${offPetX}, ${offPetY})   中心 (${centerX}, ${centerY})\n`);

  // ── 规则 2：鼠标不在身上 → 不注视 ────────────────────────────────────
  console.log('[规则 2] 鼠标必须停在它身上');
  app.send({ t: 'state', v: 'idle' });
  app.moveCursor(offPetX, offPetY);
  await sleep(500);
  let p = await app.probe();
  check('待机 + 鼠标在别处 → 不注视', p.looking, false);
  check('  （内部状态也认为不在身上）', p.cursorOverPet, false);

  app.moveCursor(onPetX, onPetY);
  await sleep(500);
  p = await app.probe();
  check('待机 + 鼠标移到身上 → 注视', p.looking, true);
  check('  （内部状态认为在身上）', p.cursorOverPet, true);

  // ── 规则 4：移开立刻停 ───────────────────────────────────────────────
  console.log('\n[规则 4] 指针一移开立刻停');
  app.moveCursor(offPetX, offPetY);
  await sleep(500);
  p = await app.probe();
  check('移开之后 → 立即停止注视', p.looking, false);

  // ── 规则 1：非待机状态不注视 ─────────────────────────────────────────
  console.log('\n[规则 1] 只有待机时注视');
  for (const [state, label] of [
    ['running', '干活中'],
    ['waiting', '抬头等你'],
    ['review', '低头检查'],
    ['waving', '挥手打招呼'],
    ['jumping', '跳跃'],
    ['failed', '出错'],
    ['running-left', '向左拖'],
  ]) {
    app.moveCursor(offPetX, offPetY);
    await sleep(200);
    app.send({ t: 'state', v: state });
    await sleep(300);
    app.moveCursor(onPetX, onPetY);
    await sleep(400);
    p = await app.probe();
    check(`${label}（${state}）+ 鼠标在身上 → 不注视`, p.looking, false);
  }

  // 回到待机应该又能注视
  app.send({ t: 'state', v: 'idle' });
  await sleep(900);
  p = await app.probe();
  check('切回待机 → 恢复注视', p.looking, true);

  // ── 规则 3：最多看 10 秒 ─────────────────────────────────────────────
  console.log('\n[规则 3] 最多看 10 秒（这段要等 11 秒）');
  // 先离开再进来，开一轮新的计时
  app.moveCursor(offPetX, offPetY);
  await sleep(400);
  app.moveCursor(onPetX, onPetY);
  await sleep(400);
  p = await app.probe();
  check('刚进入时正在注视', p.looking, true);

  console.log('  …等 11 秒…');
  await sleep(11_000);
  // 保持指针不动（仍在身上）
  p = await app.probe();
  check('10 秒后自动停止（指针没动过）', p.looking, false);
  check('  （指针仍在身上，是计时到点了）', p.cursorOverPet, true);

  // 离开再进来应该能重新开始一轮
  app.moveCursor(offPetX, offPetY);
  await sleep(400);
  app.moveCursor(onPetX, onPetY);
  await sleep(400);
  p = await app.probe();
  check('离开再进入 → 重新开始注视', p.looking, true);

  app.close();
  await sleep(400);

  console.log(failures.length === 0 ? `\n全部通过（${passed} 项）` : `\n${failures.length} 项未通过`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

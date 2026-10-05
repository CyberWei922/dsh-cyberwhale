/** Exercise the real Electron/AppKit boundary. No user cursor or preferences change. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolveElectron } from '../lib/electron-runtime.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const electron = (await resolveElectron({})).binary;
const child = spawn(electron, [`${root}helper`, `--assets=${root}assets`, '--scale=1'], {
  cwd: `${root}helper`, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
let buffer = '', errors = '';
const pending = new Map();
child.stdout.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    try { const message = JSON.parse(line); pending.get(message.t)?.(message); } catch { /* Electron diagnostics */ }
  }
});
child.stderr.on('data', chunk => { errors += chunk; });
const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
const receive = type => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { pending.delete(type); reject(new Error(`${type} timeout: ${errors.slice(-1000)}`)); }, 8000);
  pending.set(type, message => { clearTimeout(timer); pending.delete(type); resolve(message); });
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const probe = async () => { const next = receive('probe'); send({ t: 'probe' }); return next; };
function sameFrame(sample) {
  assert.equal(sample.bubbleGlassActive, true);
  const actual = sample.nativeBubbleGlass.frame;
  assert.equal(actual.material, 'NSGlassEffectView');
  assert.equal(actual.visible, sample.bubbleVisible === '1');
  for (const key of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(actual[key] - sample.bubble[key]) < 1, `${key} follows the text surface`);
}
try {
  await receive('ready');
  const initial = await probe();
  assert.equal(initial.nativeBubbleGlass.active, false, 'default-off');
  if (!initial.nativeBubbleGlass.supported) {
    console.log(`原生气泡验证跳过：${initial.nativeBubbleGlass.reason}`);
  } else {
    send({ t: 'bubble', title: '原生气泡验证', status: '玻璃与文字保持同一位置' });
    send({ t: 'config', bubbleGlass: true });
    await delay(250); sameFrame(await probe());
    console.log('✓ Electron 加载 Node-API 组件，原生 NSGlassEffectView 位于气泡下方');
    for (const value of ['dark', 'light']) {
      send({ t: 'theme', value }); await delay(100); sameFrame(await probe());
    }
    send({ t: 'config', scale: 0.6 }); await delay(350); sameFrame(await probe());
    send({ t: 'config', scale: 1.2 }); await delay(350); sameFrame(await probe());
    console.log('✓ 深浅外观、尺寸变化后原生材质与文字仍对齐');
    send({ t: 'config', bubbleGlass: false }); await delay(80);
    const off = await probe(); assert.equal(off.bubbleGlassActive, false); assert.equal(off.nativeBubbleGlass.active, false);
    send({ t: 'config', bubbleGlass: true }); await delay(100); sameFrame(await probe());
    send({ t: 'config', bubbles: false }); await delay(100);
    const hidden = await probe(); assert.equal(hidden.bubbleVisible, '0'); assert.equal(hidden.nativeBubbleGlass.active, false);
    console.log('✓ 关闭恢复普通气泡，重新开启生效，隐藏气泡也移除原生材质');
  }
} finally {
  if (child.exitCode === null) {
    const exit = once(child, 'exit'); send({ t: 'quit' });
    const timeout = setTimeout(() => child.kill(), 2000);
    await exit; clearTimeout(timeout);
  }
}
assert.equal(child.exitCode, 0, `helper exits cleanly: ${errors.slice(-1000)}`);

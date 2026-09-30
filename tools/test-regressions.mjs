import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { PassThrough } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPetState } from '../lib/state.js';
import { saveSettings, loadSettings } from '../lib/settings.js';
import { BUBBLE_WIDTH, computeMetrics, ENVELOPE_SCALE } from '../helper/geometry.js';

let now = 0;
const pet = createPetState({ now: () => now });
pet.apply('turn-start');
now = 900_000;
assert.equal(pet.current(), 'running');
assert.equal(pet.nextTransitionIn(), null);
pet.apply('waiting');
now += 900_000;
assert.equal(pet.current(), 'waiting');
pet.apply('tool-result');
assert.equal(pet.current(), 'review');
now += 2000;
assert.equal(pet.current(), 'running');
pet.apply('turn-completed');
now += 3000;
assert.equal(pet.current(), 'idle');
console.log('✓ 长任务、等待确认及瞬态回落');

const home = await mkdtemp(join(tmpdir(), 'deskpet-regression-'));
try {
  const env = { DSH_HOME: home };
  await Promise.all(Array.from({ length: 20 }, (_, i) => saveSettings({ scale: 0.5 + i * 0.05 }, env)));
  assert.ok(Math.abs((await loadSettings(env)).scale - 1.45) < 1e-10);
  const invalidHome = join(home, 'blocked');
  await writeFile(invalidHome, 'blocked');
  await assert.rejects(saveSettings({}, { DSH_HOME: invalidHome }));
  await rm(invalidHome);
  await saveSettings({ enabled: false }, { DSH_HOME: invalidHome });
  assert.equal((await loadSettings({ DSH_HOME: invalidHome })).enabled, false);
  console.log('✓ 并发设置保存保持调用顺序，失败后可恢复');

  const callbacks = {};
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      dataset: {}, style: { setProperty(name, value) { this[name] = value; } },
      offsetWidth: BUBBLE_WIDTH, offsetHeight: 32,
      getContext: () => ({ setTransform() {} }), getBoundingClientRect: () => ({}),
    });
    return elements.get(id);
  };
  const host = { config: {}, loadAssets: async () => ({ error: 'test fallback' }) };
  for (const name of ['State', 'Probe', 'Layout', 'Bubble', 'Config', 'DragDirection', 'Reload', 'Cursor']) {
    host[`on${name}`] = (callback) => { callbacks[name] = callback; };
  }
  host.setInteractive = () => {};
  host.dragEnd = () => {};
  const events = {};
  const sandbox = {
    window: { petHost: host, innerWidth: computeMetrics(ENVELOPE_SCALE).width, innerHeight: computeMetrics(ENVELOPE_SCALE).height, addEventListener: (name, callback) => { events[name] = callback; } },
    document: { getElementById: element },
    performance: { now: () => now },
    requestAnimationFrame: () => {},
    console,
  };
  vm.createContext(sandbox);
  const source = await readFile(new URL('../helper/renderer/pet.js', import.meta.url), 'utf8');
  vm.runInContext(`${source}\nglobalThis.testState = state; globalThis.testFrame = currentAnimationFrame; globalThis.testAnimations = ANIMATIONS;`, sandbox);
  const idleStart = now;
  assert.equal(sandbox.testAnimations.idle.durations.reduce((sum, ms) => sum + ms, 0), 6000);
  assert.equal(sandbox.testFrame(idleStart + 4000).col, 0);
  assert.equal(sandbox.testFrame(idleStart + 4670).col, 3);
  assert.equal(sandbox.testFrame(idleStart + 6000).col, 0);
  assert.equal(sandbox.testFrame(idleStart + 10_000).col, 0);
  console.log('✓ 待机眨眼间隔为 6 秒，闭眼过渡保持短促');
  callbacks.State('waving');
  const waveStart = now;
  assert.equal(sandbox.testAnimations.waving.durations.reduce((sum, ms) => sum + ms, 0), 2600);
  assert.equal(sandbox.testFrame(waveStart + 100).col, 0);
  assert.equal(sandbox.testFrame(waveStart + 350).col, 1);
  assert.equal(sandbox.testFrame(waveStart + 700).col, 2);
  assert.equal(sandbox.testFrame(waveStart + 2400).col, 3);
  assert.equal(sandbox.testFrame(waveStart + 6000).col, 3);
  now += 1000;
  callbacks.State('waving', { restart: true });
  assert.equal(sandbox.testState.animationStartedAt, now);
  assert.equal(sandbox.testFrame(now).col, 0);
  const greetingState = createPetState({ now: () => now });
  greetingState.apply('greeting');
  now += 2700;
  assert.equal(greetingState.current(), 'waving');
  now += 200;
  assert.equal(greetingState.current(), 'idle');
  console.log('✓ 挥手按节奏单次播放，末帧不循环，宿主保留完整收手时间');
  callbacks.State('running');
  callbacks.DragDirection('left');
  assert.equal(sandbox.testState.animation, 'running-left');
  callbacks.DragDirection(null);
  assert.equal(sandbox.testState.animation, 'running');
  callbacks.DragDirection('right');
  callbacks.State('waiting');
  assert.equal(sandbox.testState.animation, 'running-right');
  sandbox.testState.dragging = true;
  events.mouseup({ button: 0 });
  assert.equal(sandbox.testState.animation, 'waiting');
  callbacks.Bubble({ title: '任务', status: '执行中' });
  now += 3_600_000;
  assert.ok(sandbox.testState.liveUntil > now);
  console.log('✓ 拖动结束恢复最新任务动画，长任务气泡持续显示');

  vm.runInContext('globalThis.testBubblePosition = positionBubble; globalThis.testBubbleStep = stepBubbleAxis; globalThis.testBubbleMotion = () => ({ motion: bubbleMotion, target: bubbleFrameCache });', sandbox);
  const metrics = computeMetrics(ENVELOPE_SCALE);
  const layout = { left: 0, top: 0, right: metrics.width, bottom: metrics.height, petBottom: 340, bubbleWidth: BUBBLE_WIDTH };
  const bubbleElement = elements.get('bubble');
  bubbleElement.dataset.visible = '0';
  callbacks.Layout(layout);
  sandbox.testBubblePosition();
  bubbleElement.dataset.visible = '1';
  const aboveY = sandbox.testBubbleMotion().motion.y.value;
  callbacks.Layout({ ...layout, top: 100 });
  sandbox.testBubblePosition(16);
  const flipped = sandbox.testBubbleMotion();
  assert.equal(flipped.target.side, 'below');
  assert.ok(flipped.motion.y.value > aboveY && flipped.motion.y.value < flipped.target.top);
  assert.equal(bubbleElement.dataset.visible, '1');
  for (let frame = 0; frame < 60; frame++) sandbox.testBubblePosition(16);
  assert.ok(Math.abs(sandbox.testBubbleMotion().motion.y.value - flipped.target.top) < 0.1);
  callbacks.Layout({ ...layout, top: 80 });
  sandbox.testBubblePosition(16);
  assert.equal(sandbox.testBubbleMotion().target.side, 'below');
  callbacks.Layout(layout);
  sandbox.testBubblePosition(16);
  const returning = sandbox.testBubbleMotion();
  assert.equal(returning.target.side, 'above');
  assert.ok(returning.motion.y.value > returning.target.top);
  console.log('✓ 上下翻转保持可见、经过中间帧，并在边界阈值附近保持稳定');

  callbacks.Layout({ ...layout, left: 241 });
  sandbox.testBubblePosition(16);
  assert.ok(sandbox.testBubbleMotion().motion.x.value >= 247);
  callbacks.Layout(layout);
  sandbox.testBubblePosition(16);
  const sliding = sandbox.testBubbleMotion();
  assert.ok(sliding.motion.x.value > sliding.target.left && sliding.motion.x.value < 247);
  const at60Hz = { value: 0, velocity: 0 };
  const at30Hz = { value: 0, velocity: 0 };
  for (let frame = 0; frame < 60; frame++) sandbox.testBubbleStep(at60Hz, 100, 1000 / 60);
  for (let frame = 0; frame < 30; frame++) sandbox.testBubbleStep(at30Hz, 100, 1000 / 30);
  assert.ok(Math.abs(at60Hz.value - at30Hz.value) < 0.01);
  console.log('✓ 水平让位后平滑回到中间，不同帧率下的动画一致');

  // 在内存中延迟运行时探测，复现关闭/卸载与异步启动交错；不启动真实窗口。
  const hostSource = (await readFile(new URL('../lib/index.js', import.meta.url), 'utf8'))
    .replace("import { probeElectron, pluginRoot } from './electron-runtime.js';", "import { pluginRoot } from './electron-runtime.js'; const probeElectron = globalThis.deskpetTestProbe;")
    .replace("import { sweepOrphanHelpers } from './orphans.js';", "const sweepOrphanHelpers = async () => 0;")
    .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(path, new URL('../lib/index.js', import.meta.url)).href}'`);
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    for (const action of ['disable', 'dispose']) {
      await saveSettings({ enabled: true });
      let resolveProbe;
      let probeStarted;
      const started = new Promise((resolve) => { probeStarted = resolve; });
      globalThis.deskpetTestProbe = () => { probeStarted(); return new Promise((resolve) => { resolveProbe = resolve; }); };
      let route;
      let dispose;
      let spawns = 0;
      const ctx = {
        logger: { warn() {} }, on() {},
        effect(fn) { dispose = fn(); },
        connection: { requestRejection: () => undefined },
        webServer: { register(spec) { route = spec.handler; return () => {}; } },
        subprocess: { spawn() { spawns++; throw new Error('must not spawn'); } },
      };
      const { apply } = await import(`data:text/javascript;base64,${Buffer.from(hostSource + `\n// ${action}`).toString('base64')}`);
      apply(ctx);
      await started;
      if (action === 'dispose') await dispose();
      else {
        const req = new PassThrough();
        req.method = 'POST'; req.url = '/deskpet/updateSettings'; req.headers = {};
        const reply = new Promise((resolve) => {
          void route(req, { writeHead() {}, end(body) { resolve(JSON.parse(body)); } });
        });
        req.end(JSON.stringify({ payload: { enabled: false } }));
        assert.equal((await reply).result.ok, true);
      }
      resolveProbe({ ok: true, binary: process.execPath });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(spawns, 0);
      await dispose();
    }
    console.log('✓ 探测运行时期间关闭或卸载不会迟到启动窗口');
  } finally {
    delete globalThis.deskpetTestProbe;
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }

  const result = await promisify(execFile)(process.execPath, ['tools/ensure-electron.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DSH_HOME: home, DSH_DESKPET_ELECTRON: process.execPath },
  });
  assert.match(result.stdout, /已就绪/);
  assert.doesNotMatch(result.stdout, /准备下载/);
  console.log('✓ 已有运行时正确退出准备脚本');
} finally {
  await rm(home, { recursive: true, force: true });
}

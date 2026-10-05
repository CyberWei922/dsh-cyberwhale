import assert from 'node:assert/strict';
import model from '../lib/appearance-model.cjs';
import runtime from '../client/appearance-runtime.js';

const originals = Object.fromEntries(['document', 'window', 'MutationObserver', 'setInterval', 'clearInterval'].map(key => [key, globalThis[key]]));
const intervals = new Map();
let intervalId = 0;
globalThis.document = {
  body: { toggleAttribute() {}, removeAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
  querySelectorAll: () => [], visibilityState: 'visible',
};
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.setInterval = callback => { intervals.set(++intervalId, callback); return intervalId; };
globalThis.clearInterval = id => intervals.delete(id);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(setImmediate); }
  assert.fail('controller did not settle');
}
function fixture() {
  let remote = { config: model.normalizeAppearance(), revision: 'initial', persisted: true };
  let revision = 0, inFlight = 0, maxInFlight = 0, paintCount = 0, writeHook = null, readHook = null;
  const writes = [];
  const call = async (method, payload) => {
    if (method === 'getAppearance') return readHook ? readHook() : structuredClone(remote);
    assert.equal(method, 'updateAppearance');
    writes.push(structuredClone(payload)); maxInFlight = Math.max(maxInFlight, ++inFlight);
    try {
      await writeHook?.();
      if (payload.revision !== remote.revision) throw new Error('主题已在另一窗口更新，请重新选择');
      remote = { config: model.normalizeAppearance(payload.config), revision: `saved-${++revision}`, persisted: true };
      return structuredClone(remote);
    } finally { inFlight--; }
  };
  const controller = runtime.createAppearanceController({
    theme: { getTheme: () => ({ active: { colorScheme: 'light' } }), overrideTokens: () => { paintCount++; return () => {}; } },
    on() {}, effect() {},
  }, call);
  const tick = intervals.get(intervalId);
  return { controller, writes, tick, get remote() { return remote; }, set remote(value) { remote = value; },
    get maxInFlight() { return maxInFlight; }, get paintCount() { return paintCount; },
    set writeHook(value) { writeHook = value; }, set readHook(value) { readHook = value; } };
}
const fixtures = [];
const create = async () => { const f = fixture(); fixtures.push(f); await until(() => !f.controller.getState().loading); return f; };
const idle = f => until(() => !f.controller.getState().busy);
try {
  const rapid = await create(), gate = deferred();
  rapid.writeHook = () => gate.promise;
  rapid.controller.edit({ light: { ...rapid.remote.config.light, preset: 'custom', accent: '#663399' } });
  const off = rapid.controller.subscribe(() => {});
  rapid.controller.edit({ mask: 80 });
  rapid.controller.edit({ uiFont: 'PingFang SC', mask: 90 });
  assert.equal(rapid.controller.getState().config.mask, 90, 'changes apply before their writes finish');
  assert.equal(rapid.writes.length, 1, 'rapid changes wait for the in-flight write');
  off(); // Closing the settings page must not cancel controller-owned writes.
  gate.resolve(); await idle(rapid);
  assert.equal(rapid.maxInFlight, 1);
  assert.equal(rapid.writes.length, 2, 'intermediate edits are coalesced');
  assert.equal(rapid.writes[1].revision, 'saved-1', 'the next write uses the acknowledged revision');
  assert.equal(rapid.remote.config.light.accent, '#663399');
  assert.equal(rapid.remote.config.mask, 90);
  assert.equal(rapid.remote.config.uiFont, 'PingFang SC');
  assert.equal(rapid.controller.getState().dirty, false);

  const polling = await create(), poll = deferred(), oldSnapshot = structuredClone(polling.remote);
  polling.readHook = () => poll.promise; polling.tick();
  polling.controller.edit({ mask: 85 }); await idle(polling);
  poll.resolve(oldSnapshot); await new Promise(setImmediate);
  assert.equal(polling.controller.getState().config.mask, 85, 'a late poll cannot undo an acknowledged edit');
  polling.readHook = null;
  polling.controller.edit({ blur: 4 }); await idle(polling);
  assert.equal(polling.remote.config.mask, 85, 'late polling cannot restore a stale write revision');

  const failed = await create(), original = structuredClone(failed.remote.config);
  failed.writeHook = () => { throw new Error('disk unavailable'); };
  failed.controller.edit({ mask: 95 }); await idle(failed);
  assert.deepEqual(failed.controller.getState().config, original, 'a failed write rolls back its optimistic change');
  assert.match(failed.controller.getState().error, /disk unavailable/);
  failed.writeHook = null; failed.controller.edit({ mask: 75 }); await idle(failed);
  assert.equal(failed.remote.config.mask, 75); assert.equal(failed.controller.getState().error, null);

  const conflict = await create();
  conflict.remote = { ...conflict.remote, revision: 'other-window', config: model.normalizeAppearance({ codeFont: 'Menlo' }) };
  conflict.controller.edit({ mask: 95 }); await idle(conflict);
  assert.equal(conflict.remote.config.mask, model.normalizeAppearance().mask, 'a stale edit never overwrites another window');
  assert.equal(conflict.controller.getState().config.codeFont, 'Menlo', 'conflicts reload the committed configuration');
  assert.match(conflict.controller.getState().error, /另一窗口/);
  conflict.controller.edit({ mask: 80 }); await idle(conflict);
  assert.equal(conflict.remote.config.mask, 80); assert.equal(conflict.remote.config.codeFont, 'Menlo');

  const disposed = await create(), late = deferred();
  disposed.writeHook = () => late.promise;
  disposed.controller.edit({ uiFont: 'Menlo' });
  disposed.controller.dispose(); const paints = disposed.paintCount;
  disposed.controller.edit({ uiFont: 'Arial' }); late.resolve(); await idle(disposed);
  assert.equal(disposed.paintCount, paints, 'a late acknowledgement never reapplies a disposed theme');
  assert.equal(disposed.remote.config.uiFont, 'Menlo');
  console.log('主题自动保存验证通过：立即生效、连续操作、关页保存、轮询竞态、写入失败及多窗口冲突。');
} finally {
  for (const { controller } of fixtures) controller.dispose();
  for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
}

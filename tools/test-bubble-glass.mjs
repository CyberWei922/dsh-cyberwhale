import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeSettings } from '../lib/settings.js';
const require = createRequire(import.meta.url);
const { createBubbleGlass, loadNativeGlass } = require('../helper/bubble-glass.js');
const { mix, contrast } = require('../lib/appearance-model.cjs');
for (const [background, foreground, worst] of [
  ['#2B3242', '#E8EEFC', '#FFFFFF'], ['#333D55', '#F0F5FF', '#FFFFFF'],
  ['#F6F9FF', '#23314F', '#000000'], ['#EAF2FF', '#23314F', '#000000'],
]) assert(contrast(foreground, mix(background, worst, 0.26)) >= 4.5, 'glass captions remain readable over the brightest/darkest backdrop');

assert.equal(normalizeSettings({}).bubbleGlass, false);
assert.equal(normalizeSettings({ bubbleGlass: 'yes' }).bubbleGlass, false);
assert.equal(normalizeSettings({ bubbleGlass: true }).bubbleGlass, true);
for (const platform of ['win32', 'linux']) assert.equal(loadNativeGlass(platform).addon, undefined);
const frames = [], events = [];
let attached = 0, detached = 0, reduced = false, dark = false, fail = false;
const addon = {
  attach: () => { attached++; return true; },
  detach: () => { detached++; },
  update: (...args) => { frames.push(args); return !fail; },
  reducedTransparency: () => reduced,
};
const win = { getNativeWindowHandle: () => Buffer.alloc(8), getContentSize: () => [800, 600] };
const controller = createBubbleGlass(win, { native: { addon }, isDark: () => dark, publish: v => events.push(v) });
controller.configure(false);
assert.equal(attached, 0, 'default-off never inserts a native view');
controller.configure(true);
assert.equal(controller.snapshot().active, true);
controller.update({ left: 40, top: 60, width: 323, height: 54, visible: true });
assert.deepEqual(frames.at(-1), [40, 60, 323, 54, true, false]);
controller.update({ left: 40, top: 60, width: 323, height: 54, visible: false });
assert.equal(frames.at(-1)[4], false, 'native seat disappears with the bubble');
const calls = frames.length;
for (const left of [-1, NaN, 900]) controller.update({ left, top: 60, width: 323, height: 54, visible: true });
assert.equal(frames.length, calls, 'invalid/out-of-window rectangles cannot change a native view');
dark = true; controller.configure();
assert.equal(frames.at(-1)[5], true, 'system appearance changes reach the native seat');
reduced = true; controller.configure();
assert.equal(controller.snapshot().active, false);
assert.equal(detached, 1, 'system accessibility preference restores ordinary bubble');
reduced = false; controller.configure();
assert.equal(controller.snapshot().active, true);
controller.configure(true, false);
assert.equal(controller.snapshot().active, false, 'turning off all bubbles also removes native glass');
controller.configure(true, true);
fail = true; controller.update({ left: 40, top: 60, width: 323, height: 54, visible: true });
assert.equal(controller.snapshot().active, false);
assert.match(events.at(-1).reason, /恢复普通气泡/);
controller.configure(false); controller.dispose();
const before = attached; controller.configure(true);
assert.equal(attached, before, 'disposed controller cannot resurrect native views');
const unsupported = createBubbleGlass(win, { native: loadNativeGlass('win32'), isDark: () => false, publish: () => {} });
unsupported.configure(true);
assert.equal(unsupported.snapshot().active, false);
assert.equal(unsupported.snapshot().supported, false);
unsupported.dispose();
console.log('气泡玻璃验证通过：开关、隐藏、矩形校验、系统外观、无障碍回退、错误回退与释放。');

import assert from 'node:assert/strict';
import platform from '../client/settings-platform.js';
import windows from '../client/settings-windows-css.js';

const { getSettingsPlatform, applySettingsPlatform, clearSettingsPlatform } = platform;
function documentFor(value) {
  const attributes = new Map();
  return {
    documentElement: { getAttribute: name => name === 'data-platform' ? value : null },
    body: {
      attributes,
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      toggleAttribute(name, value) { if (value) attributes.set(name, ''); else attributes.delete(name); },
    },
  };
}
const selected = doc => Object.fromEntries(doc.body.attributes);
for (const [marker, expected] of [['darwin', 'macos'], ['win32', 'windows'], ['linux', 'default'], [null, 'default'], ['windows', 'default']]) {
  const doc = documentFor(marker);
  assert.equal(getSettingsPlatform(doc), expected);
  assert.equal(applySettingsPlatform(doc, { enabled: true, reduced: false }), expected);
  assert.deepEqual(selected(doc), expected === 'default' ? {} : expected === 'windows'
    ? { 'data-whale-settings-platform': 'windows' }
    : { 'data-whale-settings-platform': 'macos', 'data-whale-mac-settings': '' });
  applySettingsPlatform(doc, { enabled: true, reduced: true });
  assert.equal(doc.body.attributes.has('data-whale-mac-settings-reduced'), expected === 'macos');
  assert.equal(doc.body.attributes.has('data-whale-settings-reduced'), expected !== 'default');
  applySettingsPlatform(doc, { enabled: false, reduced: true });
  assert.deepEqual(selected(doc), {}, 'disabling appearance removes all platform styles');
}
const doc = documentFor('darwin');
applySettingsPlatform(doc, { enabled: true, reduced: true });
doc.documentElement = documentFor('win32').documentElement;
applySettingsPlatform(doc, { enabled: true, reduced: true });
assert.deepEqual(selected(doc), { 'data-whale-settings-platform': 'windows', 'data-whale-settings-reduced': '' }, 'switching to Windows removes macOS gates while preserving the shared material preference');
clearSettingsPlatform(doc);
assert.deepEqual(selected(doc), {}, 'unload removes the Windows extension gate');
applySettingsPlatform(doc, { enabled: true });
doc.documentElement = null;
assert.equal(applySettingsPlatform(doc, { enabled: true }), 'default');
assert.deepEqual(selected(doc), {}, 'missing client platform restores official settings');
assert.equal(applySettingsPlatform({ body: null }, { enabled: true }), 'default');
assert.equal(windows.CSS, '', 'the reserved Windows entry must leave official Harness settings unchanged');
console.log('Settings platform: client OS routing, unknown fallback, reduced transparency, transitions and cleanup passed.');

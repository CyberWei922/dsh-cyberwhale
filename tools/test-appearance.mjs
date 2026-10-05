import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import model from '../lib/appearance-model.cjs';
import { build } from 'esbuild';
import runtime from '../client/appearance-runtime.js';
import { createAppearanceStore, decodeWallpaper } from '../lib/appearance.js';

// These are the semantic tokens consumed by Harness's AppearanceRow,
// FontSizeRow, selector, picker, Button and Switch controls. Test their actual
// foreground/background pairs rather than just labels on the page background.
function checkControls(config, scheme, name) {
  const tokens = model.tokensFor(config);
  const value = key => {
    assert.match(tokens[key]?.[scheme] ?? '', /^#[\dA-F]{6}$/, `${name}: ${key} follows the theme`);
    return tokens[key][scheme];
  };
  const surfaces = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-3',
    '--dsw-alias-bg-module-platform', '--dsw-alias-bg-multi-select', '--dsw-alias-button-tool-bar-fill', '--dsw-alias-button-tool-bar-hover', '--dsw-alias-button-floating-fill',
    '--dsw-alias-button-floating-hover', '--dsw-alias-button-ghost-active-fill', '--dsw-alias-button-ghost-active-hover',
    '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active'];
  for (const fill of surfaces) for (const text of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary']) {
    assert(model.contrast(value(text), value(fill)) >= 4.5, `${name}: ${text} is readable on ${fill}`);
  }
  for (const fill of ['--dsw-alias-brand-primary', '--dsw-alias-button-primary-hover']) {
    assert(model.contrast(value('--dsw-alias-label-primary-foreground'), value(fill)) >= 4.5,
      `${name}: primary-button label stays readable in both normal and hover states`);
  }
  assert(model.contrast(value('--dsw-alias-switch-thumb'), value('--dsw-alias-border-l3')) >= 3,
    `${name}: the unchecked switch thumb remains visible`);
  assert(model.contrast(value('--dsw-alias-button-ghost-active-border'), value('--dsw-alias-button-ghost-active-fill')) >= 3,
    `${name}: selected picker border remains visible`);
}

const home = await mkdtemp(join(tmpdir(), 'whale-appearance-'));
try {
  const frame = { hasAttribute: () => false, querySelector: () => ({}) };
  const editor = { hasAttribute: name => name === 'contenteditable', querySelector: () => ({}) };
  const unrelated = { hasAttribute: () => false, querySelector: () => null };
  assert.deepEqual([...runtime.findWallpaperFrames({ querySelectorAll: () => [frame, editor, unrelated].map(parentElement => ({ parentElement })) })], [frame], 'wallpaper only mounts in a shell frame, never inside an editor');
  // Test the same browser bundle used in Harness. MCU 0.4.0 includes
  // bundler-resolved extensionless imports, so native Node import is unsuitable.
  const algorithm = await build({ entryPoints: [new URL('../client/appearance-image.mjs', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', write: false });
  const { colorFromImage } = await import(`data:text/javascript;base64,${Buffer.from(algorithm.outputFiles[0].text).toString('base64')}`);
  const config = model.normalizeAppearance({ uiFont: 'a; color:red', background: 'image', wallpaper: { id: '../../private' }, mask: -1 });
  assert.equal(config.uiFont, ''); assert.equal(config.wallpaper, null); assert.equal(config.background, 'image', 'image mode accepts an empty upload state while rejecting invalid resource IDs'); assert.equal(config.mask, 55);
  for (const name of ['Noto Sans CJK SC', '宋体', 'Example, Serif (UI)', 'A "Quoted" Font', 'A\\Font']) {
    const value = JSON.stringify(name), selected = model.normalizeAppearance({ uiFont: value, codeFont: value });
    assert.equal(selected.uiFont, value, 'system families round-trip through persisted settings');
    assert.equal(selected.codeFont, value);
    assert.ok(model.tokensFor(selected)['--dsw-font-family'].light.startsWith(value + ','), 'one quoted family precedes the fallback stack');
  }
  assert.equal(model.normalizeAppearance({ uiFont: 'PingFang SC, sans-serif' }).uiFont, 'PingFang SC, sans-serif', 'legacy manually entered stacks remain supported');
  assert.equal(model.normalizeAppearance({ uiFont: JSON.stringify('bad\nfont') }).uiFont, '', 'control characters cannot enter a font token');
  for (const scheme of ['light', 'dark']) for (const preset of model.PRESETS[scheme]) {
    const p = model.palette(preset);
    assert(model.contrast(p.fg, p.bg) >= 4.5); assert(model.contrast(p.muted, p.bg) >= 4.5);
    assert(model.contrast(p.accent, p.bg) >= 4.5); assert(model.contrast(p.onAccent, p.accentFill) >= 4.5);
    const config = model.normalizeAppearance({ [scheme]: { preset: preset.id } });
    assert.equal(config[scheme].preset, preset.id, `${scheme}/${preset.id}: preset selection is accepted by the host`);
    for (const key of ['background', 'foreground', 'accent']) assert.equal(config[scheme][key], preset[key],
      `${scheme}/${preset.id}: selecting a preset applies its complete color combination`);
    const control = model.tokensFor(config);
    assert(model.contrast(control['--dsw-alias-label-primary-foreground'][scheme], control['--dsw-alias-brand-primary'][scheme]) >= 4.5,
      `${preset.name}: checked switch thumb and primary-button text contrast with their track/fill`);
    checkControls(config, scheme, `${scheme}/${preset.id}`);
    assert.notEqual(control['--dsw-alias-interactive-bg-hover'][scheme], control['--dsw-alias-interactive-bg-active'][scheme],
      `${preset.name}: hover and pressed states are distinguishable`);
  }
  for (const source of ['#000000', '#FFFFFF', '#543488', '#26707A']) {
    const generated = colorFromImage(source);
    for (const scheme of ['light', 'dark']) {
      const p = model.palette(generated[scheme]);
      assert(model.contrast(p.fg, p.bg) >= 4.5);
      assert(model.contrast(p.accent, p.bg) >= 4.5);
      checkControls(model.normalizeAppearance(generated), scheme, `image/${source}/${scheme}`);
    }
  }
  const corrected = model.palette({ background: '#FFFFFF', foreground: '#EEEEEE', accent: '#FFFFFF' });
  assert(model.contrast(corrected.fg, corrected.bg) >= 4.5);
  for (const background of ['#FFFFFF', '#000000', '#808080', '#767676', '#777777']) {
    const config = model.normalizeAppearance({ light: { preset: 'custom', background, foreground: background, accent: background } });
    checkControls(config, 'light', `custom/${background}`);
  }
  const tokens = model.tokensFor(model.normalizeAppearance());
  assert(!('--dsw-specific-sidebar-fill' in tokens), 'native sidebar surface is preserved');
  assert(!Object.keys(tokens).some(k => k.includes('state-error') || k.includes('state-warn') || k.includes('file-diff')), 'semantic colors stay with Harness');
  assert.throws(() => decodeWallpaper('data:image/svg+xml;base64,PHN2Zz4='));
  assert.throws(() => decodeWallpaper('data:image/jpeg;base64,QUJDRA=='));
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZkAAAAASUVORK5CYII=';
  const store = createAppearanceStore({ home });
  const initial = await store.get();
  const wallpaper = await store.upload({ dataURL: image, name: 'local.png' });
  assert.equal(await store.image('../../private'), null);
  const bytes = await store.image(wallpaper.id); assert.equal(bytes.type, 'image/png');
  assert.equal(bytes.bytes.length, decodeWallpaper(image).bytes.length);
  const changed = { ...initial.config, wallpaper, background: 'image', glassInput: true, light: { ...initial.config.light, accent: '#8839EF' } };
  const saved = await store.update({ revision: initial.revision, config: changed });
  assert.notEqual(saved.revision, initial.revision);
  await assert.rejects(store.update({ revision: initial.revision, config: initial.config }), /另一窗口/);
  assert.deepEqual((await createAppearanceStore({ home }).get()).config, model.normalizeAppearance(changed));
  const disk = JSON.parse(await readFile(join(home, 'dsh-cyberwhale/appearance.json')));
  assert.equal(disk.revision, saved.revision);
  assert.equal(disk.config.wallpaper.id, wallpaper.id);
  assert(!JSON.stringify(disk).includes(home), 'only resource id persisted');
  const pair = await Promise.allSettled([
    store.update({ revision: saved.revision, config: { ...saved.config, gradient: 'sea' } }),
    store.update({ revision: saved.revision, config: { ...saved.config, gradient: 'dusk' } }),
  ]);
  assert.equal(pair.filter(p => p.status === 'fulfilled').length, 1, 'concurrent stale write cannot win');
  const latest = await store.get();
  const selected = await store.update({ revision: latest.revision, config: { ...latest.config,
    light: { preset: 'solarized' }, dark: { preset: 'tokyo-night' } } });
  const restored = await createAppearanceStore({ home }).get();
  assert.deepEqual(restored.config, selected.config, 'new preset choices and their colors survive a host restart');
  assert.equal(restored.config.light.preset, 'solarized');
  assert.equal(restored.config.dark.preset, 'tokyo-night');
  assert.equal(restored.config.wallpaper.id, wallpaper.id, 'changing presets keeps the existing wallpaper');
  let backgroundState = restored;
  for (const background of ['none', 'gradient', 'image']) {
    backgroundState = await store.update({ revision: backgroundState.revision, config: { ...backgroundState.config, background, gradient: 'sea', imageFit: 'contain', imagePosition: 'top' } });
    const reopened = await createAppearanceStore({ home }).get();
    assert.equal(reopened.config.background, background);
    assert.equal(reopened.config.wallpaper.id, wallpaper.id, 'switching background types retains the uploaded picture');
    assert.equal(reopened.config.gradient, 'sea', 'switching background types retains the gradient choice');
    assert.equal(reopened.config.imageFit, 'contain'); assert.equal(reopened.config.imagePosition, 'top');
  }
  const empty = await store.update({ revision: backgroundState.revision, config: { ...backgroundState.config, wallpaper: null } });
  assert.equal(empty.config.background, 'image', 'removing the picture keeps image mode selected');
  const reopenedEmpty = await createAppearanceStore({ home }).get();
  assert.equal(reopenedEmpty.config.background, 'image', 'the empty upload state survives reopening');
  assert.equal(reopenedEmpty.config.wallpaper, null);
  console.log('主题验证通过：27 个预设与自定义配色的控件/选中/悬停可读性、独立配置、壁纸校验、持久化与并发保护。');
} finally { await rm(home, { recursive: true, force: true }); }

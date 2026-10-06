import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import model from '../lib/appearance-model.cjs';
import { CSS as APPEARANCE_CSS } from '../client/appearance-css.js';
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
  const algorithm = await build({ entryPoints: [fileURLToPath(new URL('../client/appearance-image.mjs', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', write: false });
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

// Windows 专属回归：官方会话列表底部有一条 24px 渐隐条，渐隐到不透明的
// --dsw-specific-sidebar-fill。主题把侧栏改半透明后它会在用户名上方露白。
// 修法必须限定在「Windows + 主题生效 + 侧栏子树」内，darwin 一行不改。
{
  const stripped = APPEARANCE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokenRules = stripped.split('}').filter(rule => rule.includes('--dsw-specific-sidebar-fill'));
  assert.equal(tokenRules.length, 1, '官方侧栏底色只在一处、且是我们已知的 Windows 规则里被改写');
  assert.match(tokenRules[0].trim(), /^html\[data-windows-titlebar\] \[data-whale-wallpaper-frame\] \[data-slot="sidebar"\]\s*\{--dsw-specific-sidebar-fill:transparent$/, 'Windows 侧栏子树把该 token 归零；darwin 与主内容区不在作用域内');
  assert.ok(!/data-platform=darwin/.test(tokenRules[0]), 'macOS 行为不受影响');
  console.log('✓ Windows 侧栏渐隐条留白修复只作用于 Windows + 主题生效时的侧栏子树');

  // backdrop-filter 若挂在侧栏列本身，会成为 fixed 后代的包含块：
  // 官方固定在标题栏的收起/新会话按钮会被下拉一个标题栏高度，折叠时还会被
  // overflow:hidden 裁掉（"展开后按钮出现在下一行"）。磨砂必须在 ::before 上。
  const columnRules = stripped.split('}').filter(rule => /:has\(> \[data-slot="sidebar"\]\)/.test(rule));
  const columnRule = columnRules.find(rule => /position:relative/.test(rule));
  const beforeRule = columnRules.find(rule => /::before/.test(rule));
  assert.ok(columnRule, '侧栏列规则存在且提供 position:relative 作为 ::before 的包含块');
  assert.ok(!/backdrop-filter/.test(columnRule), '磨砂不挂在侧栏列上（否则 fixed 按钮被下拉）');
  assert.ok(/background:color-mix\(in srgb,var\(--dsw-alias-bg-base\) 24%,transparent\) !important/.test(columnRule), '深色/浅色主题的半透明底色保留在侧栏列上');
  assert.ok(beforeRule && /backdrop-filter:blur\(28px\)/.test(beforeRule), '磨砂改挂 ::before，视觉效果不变');
  console.log('✓ 磨砂挂在 ::before 上，官方标题栏按钮不会因包含块改变而下移');
}

// Windows 原生窗口按钮覆盖层：官方 preload 从 body 上解析 --dsw-specific-sidebar-fill
// 并 IPC 给 Electron（页面样式改不到原生层）。背景生效时必须置为 transparent，
// 让按钮区透出网页顶栏；关闭主题或非 Windows 时还原官方值。
{
  const style = () => {
    const props = new Map();
    return { props, setProperty(k, v) { props.set(k, String(v)); }, removeProperty(k) { props.delete(k); }, getPropertyValue(k) { return props.get(k) ?? ''; } };
  };
  const body = { style: style(), toggleAttribute() {}, setAttribute() {}, removeAttribute() {} };
  let windowsMarker = true;
  globalThis.document = {
    body,
    documentElement: {
      hasAttribute: (name) => windowsMarker && name === 'data-windows-titlebar',
      getAttribute: (name) => (windowsMarker && name === 'data-platform' ? 'win32' : null),
    },
    querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, remove() {} }),
    visibilityState: 'visible',
  };
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  const themeListeners = [];
  let config = { enabled: true, background: 'gradient', gradient: 'sea' };
  let revision = 1;
  const ctx = {
    theme: {
      overrideTokens: () => () => {},
      getTheme: () => ({ active: { colorScheme: 'light' } }),
    },
    on: (name, fn) => { themeListeners.push(fn); },
    effect: () => {},
  };
  const call = async (method, payload) => {
    if (method === 'getAppearance') return { revision: `r${revision}`, config };
    if (method === 'updateAppearance') { revision++; config = payload.config; return { revision: `r${revision}`, config }; }
    throw new Error(`unexpected call ${method}`);
  };
  const controller = runtime.createAppearanceController(ctx, call);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  assert.equal(body.style.getPropertyValue('--dsw-specific-sidebar-fill'), 'transparent', 'Windows + 背景生效时原生按钮覆盖层透明');
  windowsMarker = false;
  themeListeners.forEach(fn => fn());
  assert.equal(body.style.getPropertyValue('--dsw-specific-sidebar-fill'), '', '非 Windows 不写该 token（macOS 一行不动）');
  windowsMarker = true;
  themeListeners.forEach(fn => fn());
  assert.equal(body.style.getPropertyValue('--dsw-specific-sidebar-fill'), 'transparent', '恢复条件后重新置透明');
  controller.edit({ enabled: false });
  await flush();
  assert.equal(body.style.getPropertyValue('--dsw-specific-sidebar-fill'), '', '关闭美化后还原官方值');
  controller.dispose();
  assert.equal(body.style.getPropertyValue('--dsw-specific-sidebar-fill'), '', '卸载后不留残留');
  delete globalThis.document; delete globalThis.window; delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame; delete globalThis.MutationObserver;
  console.log('✓ Windows 原生窗口按钮覆盖层跟随主题透明化，关闭/卸载/非 Windows 均还原');
}

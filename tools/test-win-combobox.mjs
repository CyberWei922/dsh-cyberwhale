// Isolated browser regression using the installed Harness React, primitives,
// and settings CSS. Never connects to or operates the user's running app.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import model from '../lib/appearance-model.cjs';
import settings from '../client/settings-css.js';
import appearance from '../client/appearance-css.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DSH_TEST_BROWSER_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.env.DSH_TEST_OUTPUT || join(root, 'output/win-settings-preview'));
await mkdir(output, { recursive: true });
const archivePath = process.env.DSH_TEST_ASAR || (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'Programs/DeepSeek Harness/resources/app.asar')
  : '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar');
const archive = await readFile(archivePath);
const tree = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const base = 8 + archive.readUInt32LE(4);
function source(path) {
  let node = tree;
  for (const part of path.split('/')) node = node.files[part];
  assert(node && !node.unpacked, `installed source available: ${path}`);
  return archive.subarray(base + Number(node.offset), base + Number(node.offset) + Number(node.size)).toString();
}
function literal(code, name) {
  const marker = `${name} = `, start = code.indexOf(marker) + marker.length;
  assert(start >= marker.length, `installed CSS literal: ${name}`);
  return JSON.parse(code.slice(start, code.indexOf(';\n', start)));
}
const assetsPath = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets';
let assets = tree;
for (const part of assetsPath.split('/')) assets = assets.files[part];
const entryName = Object.keys(assets.files).find(name => /^index-.*\.js$/.test(name));
const entry = source(`${assetsPath}/${entryName}`);
const moduleFactory = /function (\w+)\(\)\{return\{react:[^}]+"react-dom\/client":/.exec(entry)?.[1];
const bootStart = entry.indexOf('const fo=globalThis.dshDesktopBoot');
assert(moduleFactory && bootStart > 0, 'installed React/primitives export map and boot boundary are known');
// Remove the application boot entirely. Keep only the actual bundled libraries.
const isolatedRuntime = `${entry.slice(0, bootStart)}\nwindow.__FixtureModules=${moduleFactory}();`;
const general = source('dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js');
const theme = source('dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js');
const shell = literal(general, 'var SettingsRoot_module_css_default');
const css = Object.keys(assets.files).filter(name => name.endsWith('.css')).map(name => source(`${assetsPath}/${name}`)).join('\n')
  + '\n' + literal(general, 'const css$6') + '\n' + literal(theme, 'const css$1');
const plugin = await readFile(join(root, 'client/index.js'), 'utf8');
const pluginCSS = /const CSS = `([\s\S]*?)`;/m.exec(plugin)[1];
const config = model.normalizeAppearance({ enabled: true });
const report = { archivePath, source: 'installed Harness React, primitives and CSS; current plugin components', checks: [], screenshots: [] };
function pass(name, detail) { report.checks.push({ name, passed: true, ...(detail ? { detail } : {}) }); console.log(`PASS ${name}`); }
const icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';
function html(platform, scheme, baselineCSS) {
  const platformAttrs = platform === 'win32' ? 'data-whale-settings-platform="windows"' : 'data-whale-settings-platform="macos" data-whale-mac-settings';
  return `<!doctype html><html data-platform="${platform}"><head><meta charset="utf-8"><style>
    body{margin:0;font-family:"Segoe UI", "Microsoft YaHei",sans-serif;--dsw-font-family:"Segoe UI", "Microsoft YaHei",sans-serif;--dsw-radius-panel:8px;--dsw-radius-md:8px;--dsw-radius-sm:4px;--dsw-radius-xl:12px;--dsw-focus-ring-width:2px;background:#f3f3f3}button,select{font:inherit}
    ${css}\n${pluginCSS}\n${appearance.CSS}\n${baselineCSS || settings.CSS}
    </style></head><body ${platformAttrs} ${scheme === 'dark' ? 'data-ds-dark-theme' : ''}>
    <div class="${shell.overlay}"><div class="${shell.mask}"></div><div class="${shell.panel}" data-shortcut-modal="settings" role="dialog" aria-modal="true" aria-label="设置">
    <nav class="${shell.nav}"><div class="${shell.navTitle}">设置</div><div class="${shell.navList}">${['账号与余额','通用设置','模型','内置插件','Agent 预设','桌宠','主题'].map(label => `<button class="${shell.navCell} ${label === '主题' ? shell.active : ''}" ${label === '主题' ? 'aria-current="true"' : ''}>${icon}<span class="${shell.navLabel}">${label}</span></button>`).join('')}</div></nav>
    <div class="${shell.content}"><div class="${shell.header}" data-whale-settings-title="主题"><div class="${shell.actions}"></div><button class="${shell.close}" aria-label="关闭设置">×</button></div><div id="settings-scroll" class="${shell.options}"><div id="fixture-root"></div></div></div>
    </div></div></body></html>`;
}
async function bundle(baseline) {
  return (await build({ stdin: { contents: `module.exports={AppearancePage:require('./client/appearance-page.js').AppearancePage,WinComboBox:require('./client/win-combobox.js').WinComboBox};`, resolveDir: root },
    bundle: true, write: false, format: 'iife', globalName: 'FixtureComponents', platform: 'browser', target: ['chrome134'],
    external: ['react', '@deepseek-ai/*'],
    plugins: baseline ? [{ name: 'baseline-component', setup(builder) { builder.onLoad({ filter: /[\\/]win-combobox\.js$/ }, async () => ({ contents: await readFile(join(baseline, 'client/win-combobox.js'), 'utf8'), loader: 'js' })); } }] : [],
  })).outputFiles[0].text;
}
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const errors = [];
async function pageFor(scale = 1, viewport = { width: Math.round(1280 / scale), height: Math.round(900 / scale) }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://fixture.test/**', route => {
    const url = new URL(route.request().url());
    const name = url.pathname.slice('/assets/'.length);
    if (url.pathname === '/fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    if (url.pathname.startsWith('/assets/') && assets.files[name] && name.endsWith('.js')) return route.fulfill({ contentType: 'application/javascript', body: name === entryName ? isolatedRuntime : source(`${assetsPath}/${name}`) });
    return route.abort();
  });
  await page.goto('http://fixture.test/fixture');
  await page.addScriptTag({ type: 'module', url: `http://fixture.test/assets/${entryName}` });
  await page.waitForFunction(() => window.__FixtureModules);
  return page;
}
async function mount(page, scheme = 'light', platform = 'win32', baseline) {
  const baselineCSS = baseline ? (await import('node:vm')).default.runInNewContext(await readFile(join(baseline, 'client/settings-windows-css.js'), 'utf8') + ';module.exports.CSS', { module: { exports: {} } }) : null;
  const markup = html(platform, scheme, baselineCSS);
  await page.evaluate(markup => {
    window.fixtureRoot?.unmount();
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.replaceWith(parsed.body);
    document.documentElement.setAttribute('data-platform', parsed.documentElement.getAttribute('data-platform'));
  }, markup);
  await page.addScriptTag({ content: `((require)=>{${await bundle(baseline)}\nwindow.__FixtureComponents=FixtureComponents;})(id=>{if(!(id in window.__FixtureModules))throw new Error('Missing fixture module '+id);return window.__FixtureModules[id];});` });
  await page.evaluate(({ config, tokens, scheme }) => {
    const modules = window.__FixtureModules, React = modules.react;
    window.queryLocalFonts = async () => ['Segoe UI','Microsoft YaHei','Cascadia Code','Consolas'].map(family => ({ family }));
    for (const [key, pair] of Object.entries(tokens)) document.body.style.setProperty(key, pair[scheme]);
    let state = { config, loading: false, available: true, theme: { preference: scheme, fontSize: 14, active: { colorScheme: scheme } } };
    const subscribers = new Set();
    const publish = () => { for (const callback of subscribers) callback(); };
    window.fixtureChanges = [];
    window.fixtureController = {
      getState: () => state,
      subscribe: callback => { subscribers.add(callback); return () => subscribers.delete(callback); },
      edit: patch => { window.fixtureChanges.push(patch); state = { ...state, config: { ...state.config, ...patch } }; publish(); },
      setMode: async preference => { state = { ...state, theme: { ...state.theme, preference } }; publish(); },
      setFontSize: async fontSize => { state = { ...state, theme: { ...state.theme, fontSize } }; publish(); },
    };
    window.fixtureRoot = modules['react-dom/client'].createRoot(document.getElementById('fixture-root'));
    window.fixtureRoot.render(React.createElement(window.__FixtureComponents.AppearancePage, { controller: window.fixtureController }));
    window.showSolo = props => { window.fixtureRoot.render(React.createElement(window.__FixtureComponents.WinComboBox, props)); };
  }, { config, tokens: model.tokensFor(config), scheme });
  await page.getByRole('combobox', { name: '浅色主题预设', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="界面字体"]')?.getAttribute('aria-busy') !== 'true');
}
async function listMetrics(page) {
  return page.getByRole('listbox').evaluate(list => {
    const rect = list.getBoundingClientRect(), card = list.closest('.dsh-appearance-card')?.getBoundingClientRect();
    const last = list.lastElementChild.getBoundingClientRect();
    return { scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
      scrollbarWidth: list.offsetWidth - list.clientWidth - 2,
      pageScroll: document.getElementById('settings-scroll').scrollTop, topLayer: list.matches(':popover-open'),
      rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      cardBottom: card?.bottom, placement: list.dataset.placement,
      lastVisible: last.top >= rect.top && last.bottom <= rect.bottom,
      lastHit: document.elementFromPoint(Math.min(last.left + 20, innerWidth - 8), Math.min(last.bottom - 5, innerHeight - 8)) === list.lastElementChild,
    };
  });
}
async function capture(page, name) {
  const path = join(output, name);
  await page.screenshot({ path });
  report.screenshots.push(path);
}
try {
  const page = await pageFor();
  report.reactVersion = await page.evaluate(() => window.__FixtureModules.react.version);
  if (process.env.DSH_TEST_BASELINE_ROOT) {
    await mount(page, 'light', 'win32', process.env.DSH_TEST_BASELINE_ROOT);
    await page.getByRole('combobox', { name: '浅色主题预设', exact: true }).click();
    const baseline = await listMetrics(page);
    assert.equal(baseline.scrollHeight, baseline.clientHeight, 'old light list has no internal overflow');
    assert(baseline.rect.bottom > baseline.cardBottom, 'old popup extends outside clipping card');
    await page.mouse.move(baseline.rect.x + 30, baseline.rect.y + 20);
    await page.mouse.wheel(0, 600);
    assert.equal((await listMetrics(page)).scrollTop, 0, 'old list cannot be scrolled');
    await capture(page, 'before-clipped-dropdown.png');
    report.baseline = baseline;
    pass('baseline reproduces clipped light-theme list with no internal scrolling', baseline);
  }
  await mount(page);
  const light = page.getByRole('combobox', { name: '浅色主题预设', exact: true });
  const dark = page.getByRole('combobox', { name: '深色主题预设', exact: true });
  const ids = await page.locator('[role="combobox"]').evaluateAll(elements => elements.map(element => element.id));
  assert.equal(ids.length, new Set(ids).size);
  pass('multiple selectors have unique accessible IDs');
  await light.click();
  let measured = await listMetrics(page);
  await capture(page, 'after-light-dropdown.png');
  report.firstPopup = measured;
  assert(measured.topLayer && measured.scrollHeight > measured.clientHeight, JSON.stringify(measured));
  assert(measured.scrollbarWidth >= 6, 'visible scrollbar reserves space in list');
  pass('popup escapes clipping card and provides an independently scrollable viewport', measured);
  await page.mouse.move(measured.rect.x + 40, measured.rect.y + 70);
  await page.mouse.wheel(0, 800);
  await page.waitForFunction(() => { const list = document.querySelector('[role="listbox"]'); return list.scrollTop + list.clientHeight >= list.scrollHeight - 2; });
  const scrolled = await listMetrics(page);
  assert(scrolled.lastVisible && scrolled.lastHit);
  assert.equal(scrolled.pageScroll, measured.pageScroll);
  await page.mouse.wheel(0, 800);
  assert.equal((await listMetrics(page)).pageScroll, measured.pageScroll);
  await page.getByRole('option', { name: '蓝鲸 · 晨雾', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="listbox"]'));
  assert.equal(await light.innerText(), '蓝鲸 · 晨雾');
  assert.equal(await page.evaluate(() => fixtureController.getState().config.light.preset), 'whale');
  assert.equal(await light.evaluate(element => document.activeElement === element), true);
  pass('wheel reaches and selects last light preset without moving settings page or reopening popup');
  await light.click();
  assert((await listMetrics(page)).lastVisible, 'reopening reveals current selection');
  await light.press('Home');
  await light.press('End');
  assert((await listMetrics(page)).lastVisible);
  assert.equal(await page.evaluate(() => document.getElementById(document.activeElement.getAttribute('aria-activedescendant')).textContent), '蓝鲸 · 晨雾');
  await light.press('Home');
  await light.press('ArrowDown');
  await light.press('Enter');
  assert.equal(await light.innerText(), 'Catppuccin Latte');
  pass('reopen, Home/End and arrow navigation keep active item visible and Enter commits');
  await light.click();
  await light.press('Escape');
  assert.equal(await light.getAttribute('aria-expanded'), 'false');
  await light.click();
  await light.press('Tab');
  assert.equal(await light.getAttribute('aria-expanded'), 'false');
  assert.equal(await light.evaluate(element => document.activeElement === element), false);
  await light.click();
  await page.getByRole('button', { name: '主题', exact: true }).click();
  assert.equal(await light.getAttribute('aria-expanded'), 'false');
  pass('Escape, natural Tab focus and outside pointer dismiss correctly');
  await light.focus();
  await light.press('g');
  await light.press('r');
  await light.press('Enter');
  assert.equal(await light.innerText(), 'Gruvbox Medium');
  pass('typed prefix locates and commits a preset');
  await light.click();
  await dark.click();
  assert.equal(await page.getByRole('listbox').count(), 1);
  assert.equal(await light.getAttribute('aria-expanded'), 'false');
  await dark.press('End');
  assert((await listMetrics(page)).lastVisible);
  await dark.press('Enter');
  assert.equal(await dark.innerText(), '蓝鲸 · 深海');
  pass('opening another selector dismisses old popup; all 17 dark presets remain reachable');
  const fonts = page.getByRole('combobox', { name: '界面字体', exact: true });
  await fonts.scrollIntoViewIfNeeded();
  await fonts.evaluate(button => {
    const scroll = document.getElementById('settings-scroll');
    scroll.scrollTop += button.getBoundingClientRect().bottom - (scroll.getBoundingClientRect().bottom - 12);
  });
  await fonts.click();
  measured = await listMetrics(page);
  assert.equal(measured.placement, 'above');
  assert(measured.rect.y >= 8 && measured.rect.bottom <= 900 - 8);
  await fonts.press('Escape');
  pass('font selector near lower boundary opens upward within settings panel');
  await mount(page, 'dark');
  await page.getByRole('combobox', { name: '浅色主题预设', exact: true }).click();
  assert.equal(await page.getByRole('listbox').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(44, 44, 44)');
  await capture(page, 'after-dark-dropdown.png');
  pass('dark-mode popup inherits readable Windows surface and theme colors');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  assert(await page.getByRole('option').first().evaluate(element => getComputedStyle(element).color !== getComputedStyle(element).backgroundColor));
  pass('forced colors keep selected text distinguishable from background');
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
  await page.close();
  for (const scale of [1.25, 1.5]) {
    const scaled = await pageFor(scale);
    await mount(scaled);
    await scaled.getByRole('combobox', { name: '浅色主题预设', exact: true }).click();
    const bounds = await listMetrics(scaled), size = scaled.viewportSize();
    assert(bounds.rect.x >= 8 && bounds.rect.right <= size.width - 8 && bounds.rect.y >= 8 && bounds.rect.bottom <= size.height - 8);
    await scaled.getByRole('combobox', { name: '浅色主题预设', exact: true }).press('End');
    assert((await listMetrics(scaled)).lastVisible);
    if (scale === 1.5) await capture(scaled, 'after-150-percent.png');
    pass(`${scale * 100}% display density and reduced viewport: popup bounds and last-item visibility`);
    await scaled.close();
  }
  const narrow = await pageFor(1, { width: 560, height: 440 });
  await mount(narrow);
  await narrow.getByRole('combobox', { name: '浅色主题预设', exact: true }).click();
  const narrowBounds = await listMetrics(narrow);
  assert(narrowBounds.rect.right <= 552 && narrowBounds.rect.bottom <= 432 && narrowBounds.rect.x >= 8 && narrowBounds.rect.y >= 8);
  await narrow.setViewportSize({ width: 620, height: 480 });
  assert((await listMetrics(narrow)).rect.right <= 612);
  await narrow.getByRole('combobox', { name: '浅色主题预设', exact: true }).press('End');
  await narrow.setViewportSize({ width: 560, height: 410 });
  assert((await listMetrics(narrow)).lastVisible, 'resize keeps keyboard-highlighted last item visible');
  await capture(narrow, 'after-narrow-window.png');
  pass('narrow window and resize preserve popup placement inside visible bounds');
  await mount(narrow, 'light', 'darwin');
  assert.equal(await narrow.getByRole('combobox', { name: '浅色主题预设', exact: true }).evaluate(element => element.tagName), 'SELECT');
  assert.equal(await narrow.getByRole('tablist', { name: '外观模式', exact: true }).count(), 1);
  assert.equal(await narrow.locator('.dsh-appearance-palette-heading').evaluate(element => getComputedStyle(element).display), 'none');
  pass('macOS retains native select, original segmented mode and existing page structure');
  await mount(narrow);
  await narrow.evaluate(() => { window.showSolo({ label: '测试选择', value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], onChange() {} }); });
  await narrow.getByRole('combobox', { name: '测试选择' }).click();
  await narrow.evaluate(() => { window.showSolo({ label: '测试选择', value: 'a', disabled: true, options: [{ value: 'a', label: 'A' }], onChange() {} }); });
  await narrow.waitForFunction(() => !document.querySelector('[role="listbox"]'));
  assert.equal(await narrow.getByRole('combobox', { name: '测试选择' }).isDisabled(), true);
  await narrow.evaluate(() => { window.showSolo({ label: '空列表', value: '', options: [], onChange() {} }); });
  assert.equal(await narrow.getByRole('combobox', { name: '空列表' }).isDisabled(), true);
  await narrow.evaluate(() => fixtureRoot.unmount());
  pass('disabling, empty options and unmount remove popup without dangling interactions');
  await narrow.close();
  const fallback = await pageFor();
  await fallback.evaluate(() => { HTMLElement.prototype.showPopover = undefined; });
  await mount(fallback);
  assert.equal(await fallback.getByRole('combobox', { name: '浅色主题预设', exact: true }).evaluate(element => element.tagName), 'SELECT');
  await fallback.getByRole('combobox', { name: '浅色主题预设', exact: true }).selectOption('whale');
  assert.equal(await fallback.evaluate(() => fixtureController.getState().config.light.preset), 'whale');
  pass('clients without Popover API retain a working system select');
  await fallback.close();
  assert.deepEqual(errors, []);
  pass('no browser runtime errors across all fixtures');
  report.passed = true;
  console.log(`Windows ComboBox: ${report.checks.length} interaction checks passed; report: ${join(output, 'report.json')}`);
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  throw error;
} finally {
  report.browserErrors = errors;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

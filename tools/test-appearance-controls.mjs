// Headless check using the installed Harness styles. Never opens or operates
// the user's app. Like test-appearance-wallpaper.mjs, requires Playwright.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import model from '../lib/appearance-model.cjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DSH_TEST_BROWSER_MODULE || 'playwright');
const archive = await readFile(process.env.DSH_TEST_ASAR || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar');
const tree = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const base = 8 + archive.readUInt32LE(4);
function source(path) {
  let node = tree;
  for (const part of path.split('/')) node = node.files[part];
  return archive.subarray(base + Number(node.offset), base + Number(node.offset) + Number(node.size)).toString();
}
function literal(code, name) {
  const marker = `${name} = `, index = code.indexOf(marker);
  assert(index >= 0, `official ${name} is available`);
  const start = index + marker.length;
  return JSON.parse(code.slice(start, code.indexOf(';\n', start)));
}
const themeSource = source('dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js');
const permissionSource = source('dsh/node_modules/@deepseek-ai/dsh-client-ui-permission-presets/lib/client.js');
const appearanceCSS = literal(themeSource, 'const css$1');
const fontCSS = literal(themeSource, 'const css');
const designCSS = literal(themeSource, 'var design_platform_css_default');
const appearance = literal(themeSource, 'var AppearanceRow_module_css_default');
const font = literal(themeSource, 'var FontSizeRow_module_css_default');
const permissionStrings = [...permissionSource.matchAll(/const (css[\w$]*) = ("[^\n]+?");\n/g)].map(m => JSON.parse(m[2]));
const permissionCSS = permissionStrings.find(css => css.includes('--dsw-alias-bg-module-platform'));
assert(permissionCSS, 'official permissions selector CSS is available');
const selectorClass = permissionCSS.match(/\.([\w-]+_selector)\{/)[1];
const primitive = name => source(`dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/${name}.module.css`);
const hex = css => '#' + css.match(/[\d.]+/g).slice(0, 3).map(v => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setContent(`<html><head><style>${designCSS}\n${appearanceCSS}\n${fontCSS}\n${permissionCSS}\n${primitive('Button')}\n${primitive('Switch')}
body{background:var(--dsw-alias-bg-base);padding:20px} #cards{display:flex;width:500px;gap:20px} #cards button{width:200px} #primary{margin:30px}
</style></head><body>
<div id="cards"><button id="unselected" class="${appearance.themeCube}" aria-pressed="false">浅色</button><button id="selected" class="${appearance.themeCube} ${appearance.selected}" aria-pressed="true">深色</button></div>
<div id="font" class="${font.stepper}"><span class="${font.value}">14</span></div>
<button id="selector" class="${selectorClass}">工作区内修改</button>
<button id="primary" class="button primary md">确定</button>
<button id="off" class="switch" aria-checked="false"><span class="thumb"></span></button>
<button id="on" class="switch" aria-checked="true"><span class="thumb"></span></button>
</body></html>`);
  const styles = id => page.locator(`#${id}`).evaluate(el => {
    const s = getComputedStyle(el);
    // The official font-size label owns its color; the stepper only owns fill.
    const text = el.id === 'font' ? el.firstElementChild : el;
    return { bg: s.backgroundColor, fg: getComputedStyle(text).color,
      thumb: el.querySelector('.thumb') ? getComputedStyle(el.querySelector('.thumb')).backgroundColor : null };
  });
  let checked = 0;
  for (const scheme of ['light', 'dark']) for (const preset of model.PRESETS[scheme]) {
    const tokens = model.tokensFor(model.normalizeAppearance({ [scheme]: { preset: preset.id } }));
    await page.evaluate(({ scheme, tokens }) => {
      document.body.toggleAttribute('data-ds-dark-theme', scheme === 'dark');
      for (const [key, pair] of Object.entries(tokens)) document.body.style.setProperty(key, pair[scheme]);
    }, { scheme, tokens });
    await page.mouse.move(0, 0);
    for (const id of ['selected', 'font', 'selector']) {
      const s = await styles(id);
      assert.equal(hex(s.bg), tokens['--dsw-alias-bg-module-platform'][scheme], `${scheme}/${preset.id}/${id}: theme surface`);
      assert(model.contrast(hex(s.fg), hex(s.bg)) >= 4.5, `${scheme}/${preset.id}/${id}: readable label`);
    }
    const unselected = await styles('unselected');
    assert.equal(unselected.bg, 'rgba(0, 0, 0, 0)', 'unselected appearance cards remain unfilled');
    const normal = await styles('primary');
    assert.equal(hex(normal.bg), tokens['--dsw-alias-brand-primary'][scheme]);
    assert(model.contrast(hex(normal.fg), hex(normal.bg)) >= 4.5);
    await page.locator('#primary').hover();
    const hover = await styles('primary');
    assert.equal(hex(hover.bg), tokens['--dsw-alias-button-primary-hover'][scheme]);
    assert(model.contrast(hex(hover.fg), hex(hover.bg)) >= 4.5);
    for (const id of ['off', 'on']) {
      const s = await styles(id);
      assert(model.contrast(hex(s.thumb), hex(s.bg)) >= 3, `${scheme}/${preset.id}/${id}: visible thumb`);
    }
    checked++;
  }
  assert.deepEqual(errors, []);
  console.log(`官方控件无界面检查通过：${checked} 套配色的选中卡片、权限选择器、字号、按钮悬停和开关。`);
} finally { await browser.close(); }

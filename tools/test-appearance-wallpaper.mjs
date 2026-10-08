// Headless fixture check: never opens, inspects or changes the user's desktop.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import model from '../lib/appearance-model.cjs';
import appearanceCSS from '../client/appearance-css.js';
import { encodePng, decodePng } from './lib/png.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.DSH_TEST_BROWSER_MODULE || 'playwright')); }
catch { throw new Error('此专项检查需要 Playwright；可用 DSH_TEST_BROWSER_MODULE 指定已安装模块的位置。'); }
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../client/appearance-runtime.js', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'WhaleRuntime', platform: 'browser' });
const rgba = Buffer.alloc(256 * 128 * 4);
for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) rgba.set([x, y * 2, x % 32 < 16 ? 30 : 230, 255], (y * 256 + x) * 4);
const image = encodePng(rgba, 256, 128).toString('base64');
// Published slot anchors use display:contents. Opaque column/root fills model
// the official shell's multiple surfaces, with unrelated CSS class names.
const frameHTML = `<div class="frame" style="grid-template-columns:280px minmax(0,1fr) 0px">
  <div class="side"><div data-slot="sidebar"><div class="sidebar-root"><button id="new-chat">New chat</button></div></div></div>
  <div class="main"><div data-slot="main"><div class="session-wrapper"><div class="conversation" data-phase="idle"><div data-conversation-content>
    <div data-chat-flow><pre id="code">const hello = 1;</pre></div></div>
    <div data-composer-seat><div data-composer-card><textarea id="draft" contenteditable data-phase="idle"></textarea></div></div>
  </div></div></div></div>
  <div data-rightbar-col></div>
  <div data-shell-overlay><button id="probe" onclick="this.dataset.clicked='1'">Overlay</button></div>
</div>`;
const fixtureCSS = `html,body{margin:0;height:100%;background:#eef0f6} [data-slot]{display:contents}
.frame{height:100%;display:grid;position:relative;overflow:hidden;background:var(--dsw-alias-bg-base)}
.side,.main,[data-rightbar-col]{min-width:0;overflow:hidden;background:var(--dsw-alias-bg-base)}
.sidebar-root{height:100%;background:var(--dsw-specific-sidebar-fill)}
.conversation{height:100%;background:var(--dsw-alias-bg-base);position:relative}
[data-chat-flow]{height:100%;background:var(--dsw-alias-bg-base)}
[data-composer-seat]{position:absolute;bottom:40px;left:20px;right:20px;background:var(--dsw-alias-bg-base)}
[data-composer-card]{background:#d7d9e0;padding:10px} textarea{background:white}
#code{position:absolute;top:150px;left:40px;background:#43454a;color:white;padding:16px}
#new-chat{margin:80px 24px;background:#818c9f;color:white}
[data-shell-overlay]{position:absolute;inset:0;pointer-events:none;z-index:20}
[data-shell-overlay]>*{pointer-events:auto;position:absolute;top:60px;left:450px}
html[data-windows-titlebar] .frame{box-sizing:border-box;padding-top:32px}
html[data-windows-titlebar] .frame:before{content:'';position:absolute;inset:0 0 auto;height:32px;background:#818c9f;-webkit-app-region:drag}`;
const transparent = 'rgba(0, 0, 0, 0)';
const pixel = (png, x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
const browser = await chromium.launch({ headless: true });
try {
  for (const systemReduced of [false, true]) for (const platform of ['darwin', 'win32']) for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    // Exercise both OS preferences explicitly, independent of the machine that
    // runs the test. This drives real matchMedia and CSS media query behavior.
    const cdp = await page.context().newCDPSession(page);
    const setSystemReduced = value => cdp.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-reduced-transparency', value: value ? 'reduce' : 'no-preference' },
    ] });
    await setSystemReduced(systemReduced);
    await page.setContent(`<html data-platform="${platform}" ${platform === 'win32' ? 'data-windows-titlebar' : ''}><head><style>${fixtureCSS}${appearanceCSS.CSS}</style></head><body ${scheme === 'dark' ? 'data-ds-dark-theme' : ''}><div data-slot="root">${frameHTML}</div></body></html>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ config, scheme, image }) => {
      let revision = 0, saved = { config, revision: 'initial', persisted: true };
      window.fetch = async () => new Response(Uint8Array.from(atob(image), c => c.charCodeAt(0)), { headers: { 'content-type': 'image/png' } });
      window.revokedImages = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = value => { window.revokedImages.push(value); revoke(value); };
      window.whale = WhaleRuntime.createAppearanceController({
        theme: {
          getTheme: () => ({ active: { colorScheme: scheme } }),
          overrideTokens: (owner, tokens) => {
            const tag = document.createElement('style');
            tag.textContent = `:root { ${Object.entries(tokens).map(([key, value]) => `${key}:${value[scheme]}`).join(';')} }`;
            document.head.append(tag); return () => tag.remove();
          },
        }, on() {}, effect() {},
      }, async (method, payload) => {
        if (method === 'getAppearance') return structuredClone(saved);
        if (method !== 'updateAppearance') throw new Error('unexpected RPC');
        saved = { config: payload.config, revision: `saved-${++revision}`, persisted: true }; return structuredClone(saved);
      });
    }, { config: model.normalizeAppearance({ background: 'gradient', gradient: 'dusk', blur: 12, imageFit: 'contain', imagePosition: 'top' }), scheme, image });
    await page.waitForSelector('.dsh-whale-wallpaper');
    for (const [id, gradient] of Object.entries(model.GRADIENTS)) {
      await page.evaluate(gradient => window.whale.edit({ background: 'gradient', gradient }), id);
      await page.waitForFunction(() => !window.whale.getState().busy);
      const rendered = await page.locator('.dsh-whale-wallpaper').evaluate(el => {
        const style = getComputedStyle(el);
        return { image: style.backgroundImage, color: style.backgroundColor, fit: style.backgroundSize,
          position: style.backgroundPosition, repeat: style.backgroundRepeat, filter: style.filter };
      });
      assert.match(rendered.image, /radial-gradient\(/, `${platform}/${scheme}/${id}: browser actually accepts the gradient layers`);
      const baseColor = gradient[scheme].match(/#[\da-f]{6}$/i)[0];
      assert.equal(rendered.color, `rgb(${model.rgb(baseColor).join(', ')})`, 'the full-window gradient retains its preset base color');
      assert(rendered.fit.split(', ').every(value => value === 'auto'), 'image fitting does not affect gradient layers');
      assert(rendered.position.split(', ').every(value => value === '50% 50%'), 'image positioning does not affect gradient layers');
      assert(rendered.repeat.split(', ').every(value => value === 'no-repeat'), 'background shorthand must not re-enable image tiling');
      assert.equal(rendered.filter, 'none', 'image blur does not affect gradients');
      const gradientPixels = decodePng(await page.screenshot());
      assert.notDeepEqual(pixel(gradientPixels, 640, 80), pixel(gradientPixels, 1180, 620), `${id}: visible gradient varies across the window`);
    }
    await page.evaluate(() => window.whale.edit({ background: 'image', wallpaper: { id: 'a'.repeat(64), name: 'fixture.png' }, blur: 0, imageFit: 'cover', imagePosition: 'center' }));
    await page.waitForFunction(() => document.querySelector('.dsh-whale-wallpaper')?.style.backgroundImage.includes('url('));
    await page.waitForFunction(() => !window.whale.getState().busy);
    // Let shell reconciliation finish before temporarily replacing its image
    // for a pixel probe; a queued paint would restore the image mid-capture.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const inspect = () => page.evaluate(() => {
      const layer = document.querySelector('.dsh-whale-wallpaper'), box = layer.getBoundingClientRect(), side = document.querySelector('.side');
      return { box: { x: box.x, y: box.y, width: box.width, height: box.height },
        position: getComputedStyle(layer).position, z: getComputedStyle(layer).zIndex,
        image: layer.style.backgroundImage, fit: layer.style.backgroundSize,
        filter: getComputedStyle(side).backdropFilter, frost: getComputedStyle(side, '::before').backdropFilter,
        sidebarRoot: getComputedStyle(document.querySelector('.sidebar-root')).backgroundColor,
        main: getComputedStyle(document.querySelector('.main')).backgroundColor, conversation: getComputedStyle(document.querySelector('.conversation')).backgroundColor,
        flow: getComputedStyle(document.querySelector('[data-chat-flow]')).backgroundColor,
        code: getComputedStyle(document.querySelector('#code')).backgroundColor, composer: getComputedStyle(document.querySelector('[data-composer-card]')).backgroundColor,
        button: getComputedStyle(document.querySelector('#new-chat')).backgroundColor,
        editorLayers: document.querySelectorAll('[contenteditable] .dsh-whale-wallpaper').length,
        overlays: document.querySelectorAll('[data-shell-overlay] .dsh-whale-wallpaper').length,
      };
    });
    const original = await inspect();
    assert.deepEqual(original.box, { x: 0, y: 0, width: 1280, height: 800 });
    assert.equal(original.position, 'fixed'); assert.equal(original.z, '-1');
    assert.equal(original.sidebarRoot, transparent, 'sidebar content inherits its opaque or translucent column surface');
    assert.equal(original.main, transparent); assert.equal(original.conversation, transparent); assert.equal(original.flow, transparent);
    assert.equal(original.filter, 'none', 'the sidebar column must not move fixed titlebar buttons');
    if (systemReduced) {
      assert.equal(original.frost, 'none', 'the OS preference disables sidebar frost without hiding the wallpaper');
      assert.equal(await page.locator('.side').evaluate(el => getComputedStyle(el).backgroundColor), `rgb(${model.rgb(model.DEFAULTS[scheme].background).join(', ')})`);
    } else assert.match(original.frost, /blur\(28px\)/, 'the independent material layer retains the sidebar frost');
    if (platform === 'win32') {
      assert.equal(await page.locator('[data-slot="sidebar"]').evaluate(el => getComputedStyle(el).getPropertyValue('--dsw-specific-sidebar-fill').trim()), systemReduced ? model.DEFAULTS[scheme].background : 'transparent', 'the sidebar footer fade matches its column surface');
      assert.equal(await page.evaluate(() => document.body.style.getPropertyValue('--dsw-specific-sidebar-fill')), systemReduced ? '' : 'transparent', 'native titlebar follows the material preference');
      assert.equal(await page.locator('.frame').evaluate(el => getComputedStyle(el, '::before').backdropFilter), systemReduced ? 'none' : 'blur(28px) saturate(1.4)');
    }
    assert.equal(original.code, 'rgb(67, 69, 74)'); assert.equal(original.composer, 'rgb(215, 217, 224)');
    assert.equal(original.button, 'rgb(129, 140, 159)');
    assert.equal(original.editorLayers, 0); assert.equal(original.overlays, 0);
    const wallpaperStyle = await page.locator('.dsh-whale-wallpaper').getAttribute('style');
    await page.locator('.dsh-whale-wallpaper').evaluate(el => { el.style.background = 'repeating-linear-gradient(90deg,#e06060 0 14px,#4060e0 14px 28px)'; });
    const blurred = decodePng(await page.screenshot());
    const distance = (a, b) => Math.max(...a.slice(0, 3).map((v, i) => Math.abs(v - b[i])));
    const blurDelta = distance(pixel(blurred, 140, 400), pixel(blurred, 154, 400));
    assert(blurDelta <= 6, `${platform}/${scheme}: the sidebar material must suppress sharp wallpaper stripes`);
    assert(distance(pixel(blurred, 800, 400), pixel(blurred, 814, 400)) >= 100, 'the wallpaper probe must stay sharp outside the sidebar');
    await page.addStyleTag({ content: '[data-whale-wallpaper-frame] > .side::before {backdrop-filter:none;-webkit-backdrop-filter:none}' });
    const sharp = decodePng(await page.screenshot());
    const sharpDelta = distance(pixel(sharp, 140, 400), pixel(sharp, 154, 400));
    if (systemReduced) assert(sharpDelta <= 6, 'the opaque sidebar must not reveal wallpaper when the system reduces transparency');
    else assert(sharpDelta >= 100, 'the sidebar probe must distinguish actual blur from tint alone');
    await page.evaluate(() => document.head.lastElementChild.remove());
    await page.locator('.dsh-whale-wallpaper').evaluate((el, style) => el.setAttribute('style', style), wallpaperStyle);
    const before = decodePng(await page.screenshot());
    await page.evaluate(() => { const frame = document.querySelector('.frame'); frame.setAttribute('data-sidebar-collapsed', ''); frame.style.gridTemplateColumns = '0px minmax(0,1fr) 0px'; });
    const collapsed = await inspect(), after = decodePng(await page.screenshot());
    assert.deepEqual(collapsed.box, original.box, 'sidebar collapse never changes wallpaper geometry');
    assert.equal(collapsed.image, original.image, 'sidebar collapse retains the same loaded image');
    assert.deepEqual(pixel(after, 800, 500), pixel(before, 800, 500), 'visible wallpaper pixels do not shift or rescale');
    await page.evaluate(() => { const frame = document.querySelector('.frame'); frame.removeAttribute('data-sidebar-collapsed'); frame.style.gridTemplateColumns = '420px minmax(0,1fr) 0px'; });
    assert.deepEqual((await inspect()).box, original.box, 'expanding or dragging the sidebar never changes wallpaper geometry');
    assert.equal(await page.locator('.dsh-whale-wallpaper').count(), 1);
    await page.locator('#probe').click(); assert.equal(await page.locator('#probe').getAttribute('data-clicked'), '1');
    await page.locator('#draft').fill('input remains editable'); assert.equal(await page.locator('#draft').inputValue(), 'input remains editable');
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.deepEqual((await inspect()).box, { x: 0, y: 0, width: 1440, height: 900 }, 'only resizing the actual viewport resizes the wallpaper');
    await page.evaluate(() => window.whale.edit({ reduceTransparency: true }));
    assert.equal(await page.locator('.dsh-whale-wallpaper').count(), 0); assert.equal(await page.locator('[data-whale-wallpaper-frame]').count(), 0);
    assert.equal(await page.locator('.side').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
    assert.equal(await page.locator('.side').evaluate(el => getComputedStyle(el, '::before').backdropFilter), 'none');
    await page.waitForFunction(() => !window.whale.getState().busy);
    await page.evaluate(() => window.whale.edit({ reduceTransparency: false }));
    await page.waitForSelector('.dsh-whale-wallpaper');
    await page.evaluate(html => { document.querySelector('[data-slot="root"]').innerHTML = html; }, frameHTML);
    await page.waitForSelector('[data-whale-wallpaper-frame] > .dsh-whale-wallpaper');
    assert.equal(await page.locator('.dsh-whale-wallpaper').count(), 1, 'shell remount never duplicates wallpapers');
    await page.evaluate(() => window.whale.edit({ background: 'image', wallpaper: null }));
    await page.waitForFunction(() => !window.whale.getState().busy);
    assert.equal(await page.evaluate(() => window.whale.getState().config.background), 'image', 'removing an image keeps the upload mode selected');
    assert.equal(await page.locator('.dsh-whale-wallpaper').count(), 0, 'empty image mode removes the old wallpaper');
    assert.equal(await page.locator('[data-whale-wallpaper-frame]').count(), 0, 'empty image mode restores solid shell surfaces');
    assert.equal(await page.locator('.side').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
    assert.equal(await page.evaluate(() => window.revokedImages.length), 1, 'removing an image releases its URL');
    await page.evaluate(() => window.whale.edit({ wallpaper: { id: 'a'.repeat(64), name: 'fixture.png' } }));
    await page.waitForSelector('.dsh-whale-wallpaper');
    await page.waitForFunction(() => !window.whale.getState().busy);
    await page.evaluate(() => window.whale.edit({ glassInput: true }));
    await page.waitForFunction(() => !window.whale.getState().busy);
    for (const reduced of [!systemReduced, systemReduced]) {
      await setSystemReduced(reduced);
      await page.waitForFunction(reduced => document.body.hasAttribute('data-whale-settings-reduced') === reduced &&
        document.body.hasAttribute('data-whale-glass-input') === !reduced, reduced);
      assert.equal(await page.locator('.dsh-whale-wallpaper').count(), 1, 'changing the OS transparency preference retains the selected wallpaper');
      assert.equal(await page.locator('.side').evaluate(el => getComputedStyle(el, '::before').backdropFilter), reduced ? 'none' : 'blur(28px) saturate(1.4)');
    }
    await page.evaluate(() => window.whale.edit({ enabled: false }));
    await page.waitForFunction(() => !window.whale.getState().busy);
    assert.equal(await page.locator('.dsh-whale-wallpaper').count(), 0, 'the plugin appearance switch still hides backgrounds');
    await page.evaluate(() => window.whale.edit({ enabled: true }));
    await page.waitForSelector('.dsh-whale-wallpaper');
    await page.evaluate(() => window.whale.dispose());
    assert.equal(await page.locator('.dsh-whale-wallpaper').count(), 0); assert.equal(await page.locator('[data-whale-wallpaper-frame]').count(), 0);
    assert.equal(await page.evaluate(() => window.revokedImages.length), 2, 'unload releases the replacement image');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${platform}/${scheme}/系统减少透明=${systemReduced}：三种渐变实际绘制、全窗图片、材料回退、系统偏好实时切换、收放不缩放、输入/点击、空图片模式、外观开关、减少透明与卸载检查通过。`);
  }
} finally { await browser.close(); }

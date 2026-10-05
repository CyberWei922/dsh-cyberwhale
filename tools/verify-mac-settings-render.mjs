// Render a standalone fixture with the installed Harness CSS and DOM structure.
// This never opens or operates the user's running Harness application.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import model from '../lib/appearance-model.cjs';
import settings from '../client/settings-css.js';
import appearance from '../client/appearance-css.js';
import { decodePng } from './lib/png.mjs';

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
const pkg = name => source(`dsh/node_modules/@deepseek-ai/${name}/lib/client.js`);
const generalSource = pkg('dsh-client-ui-settings-general');
const themeSource = pkg('dsh-client-ui-theme');
const root = literal(generalSource, 'var SettingsRoot_module_css_default');
const officialAppearance = literal(themeSource, 'var AppearanceRow_module_css_default');
const font = literal(themeSource, 'var FontSizeRow_module_css_default');
const developer = literal(generalSource, 'var DeveloperToolsRow_module_css_default');
const general = literal(generalSource, 'var GeneralSection_module_css_default');
const primitive = name => source(`dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/${name}.module.css`);
const officialCSS = [literal(themeSource, 'var design_platform_css_default'), literal(generalSource, 'const css$6'),
  literal(generalSource, 'const css$3'), literal(generalSource, 'const css$1'), literal(themeSource, 'const css$1'),
  literal(themeSource, 'const css'), primitive('Switch'), primitive('Button'), primitive('SegmentedControl')].join('\n');
const pluginSource = await readFile(new URL('../client/index.js', import.meta.url), 'utf8');
const whaleCSS = /const CSS = `([\s\S]*?)`;/m.exec(pluginSource)[1];
const runtime = await build({ entryPoints: [fileURLToPath(new URL('../client/appearance-runtime.js', import.meta.url))],
  bundle:true, write:false, format:'iife', globalName:'WhaleRuntime', platform:'browser' });
const output = fileURLToPath(new URL('../output/mac-settings-preview/', import.meta.url));
await mkdir(output, { recursive:true });
const switchHTML = (label, checked, disabled = false) => `<button type="button" class="switch" role="switch" aria-label="${label}" aria-checked="${checked}" ${disabled ? 'disabled' : ''}><span class="thumb"></span></button>`;
const icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8M12 8v8"/></svg>';
const segment = (id, labels) => `<div id="${id}" class="control" role="tablist" aria-label="${id}" style="--dsh-segment-count:${labels.length};--dsh-segment-index:0"><span class="indicator" aria-hidden="true"></span>${labels.map((text, i) => `<button type="button" class="tab" role="tab" aria-selected="${i === 0}">${text}</button>`).join('')}</div>`;
const row = (title, description, control, prefix='dsh-appearance') => `<div class="${prefix}-row"><div class="${prefix === 'dsh-whale' ? 'dsh-whale-text' : ''}"><div class="${prefix === 'dsh-whale' ? 'dsh-whale-title' : 'dsh-appearance-label'}">${title}</div>${description ? `<div class="${prefix}-description">${description}</div>` : ''}</div><div class="${prefix}-control">${control}</div></div>`;
const themeCard = (name, scheme) => `<section class="dsh-appearance-card" aria-label="${name}主题"><div class="dsh-appearance-card-heading">${name}主题<span class="dsh-appearance-card-badge">预设</span></div><div class="dsh-appearance-mini" style="background:${model.DEFAULTS[scheme].background};color:${model.DEFAULTS[scheme].foreground};--mini-accent:${model.DEFAULTS[scheme].accent};--mini-line:#88888830;--mini-muted:#999"><div class="dsh-appearance-mini-sidebar"><span></span><i></i><i></i><i></i></div><div class="dsh-appearance-mini-chat"><strong>让灵感自然发生</strong><p>背景、文字与强调色，协调搭配。</p><code>const hello = "Harness";</code><div class="dsh-appearance-mini-composer"><span>有什么想法？</span><b>↑</b></div></div></div><label class="dsh-appearance-select-label">主题预设<select aria-label="${name}主题预设"><option>Codex</option><option>蓝鲸</option></select></label><div class="dsh-appearance-colors">${['强调色','背景色','文字色'].map((text, i) => `<label class="dsh-appearance-color">${text}<span class="dsh-appearance-color-input"><input aria-label="${name}${text}" type="color" value="${model.DEFAULTS[scheme][['accent','background','foreground'][i]]}"></span></label>`).join('')}</div></section>`;
const pages = {
  '主题': `<div class="dsh-appearance-page"><p class="dsh-appearance-intro">选择喜欢的配色，修改后立即生效并自动保存。</p>${row('启用外观美化','配色、字体、背景与特效一起生效，桌宠独立控制。',switchHTML('启用外观美化',true))}${row('外观模式','使用 Harness 的模式设置，立即保存。',segment('mode',['浅色','深色','跟随系统']))}<div class="dsh-appearance-cards">${themeCard('浅色','light')}${themeCard('深色','dark')}</div><section class="dsh-appearance-section"><h3>字体</h3><div class="dsh-appearance-fonts">${row('界面字体','', '<select class="dsh-appearance-input" aria-label="界面字体"><option>系统默认</option></select>')}${row('代码字体','','<select class="dsh-appearance-input" aria-label="代码字体"><option>系统默认</option></select>')}</div>${row('正文字号','使用 Harness 原有字号设置，立即保存。','<div class="dsh-appearance-size"><button class="button secondary sm">−</button><span>14 px</span><button class="button secondary sm">+</button></div>')}</section><section class="dsh-appearance-section"><h3>磨砂玻璃</h3>${row('输入框磨砂玻璃','页面内的磨砂透光效果。',switchHTML('输入框磨砂玻璃',false))}${row('减少透明效果','使用实色表面，隐藏聊天背景和磨砂效果。',switchHTML('减少透明效果',false))}</section></div>`,
  '桌宠': `<div class="dsh-whale-page">${row('启用桌宠','一只随 Harness 工作状态变化的蓝色大肥鱼。',switchHTML('启用桌宠',true),'dsh-whale')}${row('运行状态','','<span class="dsh-whale-status">● 窗口运行中</span>','dsh-whale')}${row('显示大小','影响桌面鲸鱼的显示比例。',segment('scale',['小','中','大','特大']),'dsh-whale')}${row('眼睛跟随鼠标','鼠标移到它身上时，它会转过来看你。',switchHTML('看向鼠标',true),'dsh-whale')}${row('气泡提示','显示当前任务状态。',switchHTML('气泡提示',true),'dsh-whale')}${row('气泡液态玻璃','Apple 原生 Liquid Glass，仅支持 macOS 26 及以上。',switchHTML('气泡液态玻璃',false),'dsh-whale')}${row('禁用状态','当前系统不支持时保留清晰的关闭状态。',switchHTML('禁用状态',false,true),'dsh-whale')}</div>`,
  '通用': `<div class="${general.section}"><div class="${officialAppearance.group}"><div class="${officialAppearance.title}">外观</div><div class="${officialAppearance.cubeRow}">${['浅色','深色','跟随系统'].map((label,i)=>`<button class="${officialAppearance.themeCube} ${i===0?officialAppearance.selected:''}" aria-pressed="${i===0}">${label}</button>`).join('')}</div></div><div class="${font.row}"><div class="${font.rowText}"><div class="${font.title}">正文字号</div><div class="${font.desc}">调整界面中的文字大小</div></div><div class="${font.control}"><div class="${font.stepper}"><span class="${font.value}">14</span></div><span class="${font.unit}">px</span></div></div><div class="${developer.row}"><div><div class="${developer.title}">开发者工具</div><div class="${developer.description}">显示开发者工具及预览</div></div>${switchHTML('开发者工具',false)}</div><div>当前版本 0.2.0-rc.2</div></div>`,
};
const shell = title => `<div class="${root.overlay}"><div class="${root.mask}" aria-hidden="true"></div><div class="${root.panel}" data-shortcut-modal="settings" role="dialog" aria-modal="true" aria-labelledby="settings-label"><nav class="${root.nav}"><div id="settings-label" class="${root.navTitle}">设置</div><div class="${root.navList}">${['账号','通用','模型','插件','Agent 预设','主题','桌宠'].map(label=>`<button type="button" class="${root.navCell} ${label===title?root.active:''}" ${label===title?'aria-current="true"':''}>${icon}<span class="${root.navLabel}">${label}</span></button>`).join('')}</div></nav><div class="${root.content}"><div class="${root.header}"><div class="${root.actions}"></div><button class="${root.close}" type="button" aria-label="关闭设置">✕</button></div><div class="${root.options}">${pages[title]}</div></div></div></div>`;
const fixture = (title, platform = 'darwin') => `<html data-platform="${platform}"><head><meta charset="utf-8"><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;--dsw-font-family:-apple-system,BlinkMacSystemFont,sans-serif;--dsw-radius-panel:16px;--dsw-radius-md:8px;--dsw-radius-sm:6px;--dsw-radius-xl:12px;--dsw-mask-blur:none;--dsw-focus-ring-width:2px;background:var(--dsw-alias-bg-base)}button,select{font:inherit}p{margin:0}${officialCSS}\n${whaleCSS}\n${appearance.CSS}\n${settings.CSS}</style></head><body>${shell(title)}<div id="outside"><button role="switch" aria-checked="false" class="switch"><span class="thumb"></span></button></div></body></html>`;
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1000,height:760},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function mount(title,scheme='dark',platform='darwin') {
    await page.evaluate(()=>window.whale?.dispose());
    await page.setContent(fixture(title,platform));
    await page.addScriptTag({content:runtime.outputFiles[0].text});
    await page.evaluate(({scheme,tokens,initialConfig})=>{
      document.body.toggleAttribute('data-ds-dark-theme',scheme==='dark');
      const apply=t=>{for(const[key,pair]of Object.entries(t))document.body.style.setProperty(key,pair[scheme]);};
      apply(tokens);
      let revision=0,config=initialConfig;
      window.whale=WhaleRuntime.createAppearanceController({theme:{getTheme:()=>({active:{colorScheme:scheme}}),overrideTokens:(_id,t)=>{apply(t);return()=>{};}},on(){},effect(){}},async(method,payload)=>{if(method==='updateAppearance')config=payload.config;return {config,revision:String(++revision),persisted:true};});
    },{scheme,tokens:model.tokensFor(model.normalizeAppearance()),initialConfig:model.normalizeAppearance()});
    await page.waitForFunction(()=>!whale.getState().loading);
    if(platform!=='darwin')return;
    await page.waitForSelector('body[data-whale-mac-settings]');
    await page.waitForFunction(()=>document.querySelector('[data-whale-settings-title]'));
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-shortcut-modal] [role="switch"]')].every(el=>{
      const transform=getComputedStyle(el.firstElementChild).transform;
      return new DOMMatrix(transform==='none'?undefined:transform).m41===(el.getAttribute('aria-checked')==='true'?12:0);
    }));
  }
  for(const scheme of ['light','dark'])for(const title of Object.keys(pages)) {
    await mount(title,scheme);
    const switches=page.locator('[data-shortcut-modal] [role="switch"]');
    for(let i=0;i<await switches.count();i++) {
      const measured=await switches.nth(i).evaluate(el=>{const s=getComputedStyle(el),thumb=el.firstElementChild,t=getComputedStyle(thumb),b=el.getBoundingClientRect(),r=thumb.getBoundingClientRect();return {width:b.width,height:b.height,thumbWidth:r.width,thumbHeight:r.height,inset:r.x-b.x,thumbColor:t.backgroundColor,checked:el.getAttribute('aria-checked'),radius:t.borderRadius};});
      assert.deepEqual([measured.width,measured.height,measured.thumbWidth,measured.thumbHeight],[36,16,21,13]);
      assert.equal(measured.inset,measured.checked==='true'?13.5:1.5,'thumb travels to the correct edge without clipping');
      assert.equal(measured.thumbColor,scheme==='dark'?'rgb(233, 233, 233)':'rgb(245, 245, 245)','neutral thumb survives official unchecked-state CSS');
    }
    assert.equal(await page.locator('#outside [role="switch"]').evaluate(el=>el.getBoundingClientRect().height),20,'settings CSS does not leak to other switches');
    assert.equal(await page.locator('[data-whale-settings-title]').getAttribute('data-whale-settings-title'),title);
    await page.locator('[data-shortcut-modal]').screenshot({path:`${output}${title==='主题'?'theme':title==='桌宠'?'pet':'general'}-${scheme}.png`});
    console.log(`${title}/${scheme}: grouped rows, host cascade, switch geometry and scope verified`);
  }
  // Test the resulting pixels, rather than merely checking for a blur rule:
  // changing the backdrop must tint only the sidebar, and fine stripes must
  // blend away. The right-hand content stays completely opaque.
  const pixel=(png,point)=>{
    const x=Math.round(point.x*2),y=Math.round(point.y*2),offset=(y*png.width+x)*4;
    return [...png.data.subarray(offset,offset+3)];
  };
  const distance=(a,b)=>Math.max(...a.map((value,i)=>Math.abs(value-b[i])));
  for(const scheme of ['light','dark']) {
    await mount('桌宠',scheme);
    const nav=page.locator('[data-shortcut-modal] > nav');
    const content=page.locator('[data-shortcut-modal] > nav + div');
    const sideBox=await nav.boundingBox(),contentBox=await content.boundingBox();
    const sidePoint={x:sideBox.x+sideBox.width/2-2,y:sideBox.y+sideBox.height-64};
    const rightPoint={x:contentBox.x+contentBox.width-30,y:contentBox.y+contentBox.height-64};
    const backdrop=async(background)=>{
      await page.evaluate(background=>{
        let probe=document.getElementById('glass-probe');
        if(!probe){probe=document.createElement('div');probe.id='glass-probe';probe.style.cssText='position:fixed;inset:0;pointer-events:none';document.body.prepend(probe);}
        probe.style.background=background;
      },background);
      return decodePng(await page.screenshot());
    };
    const red=await backdrop('#e06060'),blue=await backdrop('#4060e0');
    assert(distance(pixel(red,sidePoint),pixel(blue,sidePoint))>=16,`${scheme}: the sidebar must transmit visible backdrop color`);
    assert.deepEqual(pixel(red,rightPoint),pixel(blue,rightPoint),`${scheme}: backdrop colors must not bleed into opaque content`);
    const stripes=await backdrop('repeating-linear-gradient(90deg,#e06060 0 14px,#4060e0 14px 28px)');
    const nextPoint={...sidePoint,x:sidePoint.x+14};
    assert(distance(pixel(stripes,sidePoint),pixel(stripes,nextPoint))<=6,`${scheme}: frosted blur must suppress sharp backdrop stripes`);
    await nav.evaluate(el=>{el.style.backdropFilter='none';el.style.webkitBackdropFilter='none';});
    const sharp=decodePng(await page.screenshot());
    assert(distance(pixel(sharp,sidePoint),pixel(sharp,nextPoint))>=16,`${scheme}: the stripe probe must distinguish actual blur from tint alone`);
    await nav.evaluate(el=>{el.style.removeProperty('backdrop-filter');el.style.removeProperty('-webkit-backdrop-filter');});
    await page.evaluate(()=>whale.edit({reduceTransparency:true}));
    await page.waitForSelector('body[data-whale-mac-settings-reduced]');
    const reducedRed=await backdrop('#e06060'),reducedBlue=await backdrop('#4060e0');
    assert.deepEqual(pixel(reducedRed,sidePoint),pixel(reducedBlue,sidePoint),`${scheme}: reduced transparency must remove backdrop transmission`);
    await page.evaluate(()=>{document.getElementById('glass-probe').remove();whale.edit({reduceTransparency:false});});
    const solid=decodePng(await page.screenshot());
    assert(distance(pixel(solid,sidePoint),pixel(solid,rightPoint))>=6,`${scheme}: a flat backdrop must still show a distinct sidebar material`);
    console.log(`${scheme}: visible backdrop transmission, blurred detail, opaque content and solid fallback verified in rendered pixels`);
  }
  await mount('桌宠');
  const first=page.getByRole('switch',{name:'启用桌宠',exact:true});
  await first.evaluate(el=>el.addEventListener('click',()=>el.setAttribute('aria-checked',String(el.getAttribute('aria-checked')!=='true'))));
  await first.focus();await page.keyboard.press('Space');assert.equal(await first.getAttribute('aria-checked'),'false');
  await page.keyboard.press('Enter');assert.equal(await first.getAttribute('aria-checked'),'true');
  assert.equal(await first.evaluate(el=>getComputedStyle(el).outlineStyle),'solid','keyboard focus remains visible');
  const hitBox=await first.boundingBox();await page.mouse.click(hitBox.x+8,hitBox.y-4);
  assert.equal(await first.getAttribute('aria-checked'),'false','expanded hit area activates the switch');
  await first.press('Space');
  const disabled=page.getByRole('switch',{name:'禁用状态',exact:true});assert(await disabled.isDisabled());
  const rowBoxes=await page.locator('.dsh-whale-row').evaluateAll(rows=>rows.map(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {top:b.y,bottom:b.bottom,topRadius:s.borderTopLeftRadius,bottomRadius:s.borderBottomLeftRadius};}));
  for(let i=1;i<rowBoxes.length;i++)assert.equal(rowBoxes[i].top,rowBoxes[i-1].bottom,'adjacent rows form a continuous card');
  assert.equal(rowBoxes[0].topRadius,'12px');assert.equal(rowBoxes.at(-1).bottomRadius,'12px');assert.equal(rowBoxes[1].topRadius,'0px');
  await page.evaluate(()=>whale.edit({reduceTransparency:true}));
  await page.waitForSelector('body[data-whale-mac-settings-reduced]');
  assert.equal(await page.locator('[data-shortcut-modal] > nav').evaluate(el=>getComputedStyle(el).backdropFilter),'none');
  assert.equal(await first.evaluate(el=>el.getBoundingClientRect().height),16,'reducing transparency does not undo switch styling');
  await page.evaluate(()=>whale.edit({reduceTransparency:false}));
  const media=await page.context().newCDPSession(page);
  await media.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
  await page.waitForSelector('body[data-whale-mac-settings-reduced]');
  assert.equal(await page.locator('[data-shortcut-modal] > nav').evaluate(el=>getComputedStyle(el).backdropFilter),'none','system transparency preference also selects an opaque sidebar');
  await media.send('Emulation.setEmulatedMedia',{features:[]});
  await page.waitForFunction(()=>!document.body.hasAttribute('data-whale-mac-settings-reduced'));
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await first.evaluate(el=>getComputedStyle(el.firstElementChild).transitionDuration),'0s');
  await page.evaluate(()=>{const active=document.querySelector('nav [aria-current]');active.removeAttribute('aria-current');const next=[...document.querySelectorAll('nav button')].find(el=>el.textContent==='主题');next.setAttribute('aria-current','true');});
  await page.waitForFunction(()=>document.querySelector('[data-whale-settings-title]')?.getAttribute('data-whale-settings-title')==='主题');
  // Check all theme fills remain intact even when their on-accent text is dark.
  for(const scheme of ['light','dark']) {
    await mount('桌宠',scheme);
    for(const preset of model.PRESETS[scheme]) {
      await page.evaluate(({scheme,preset})=>whale.edit({[scheme]:{...preset,preset:preset.id}}),{scheme,preset});
      await page.waitForFunction(()=>!whale.getState().busy);
      assert.equal(await first.evaluate(el=>getComputedStyle(el).backgroundColor),`rgb(${model.rgb(model.palette(preset).accentFill).join(', ')})`);
      const selection=await page.locator('nav [aria-current="true"]').evaluate(el=>{const s=getComputedStyle(el);return {fill:s.backgroundColor,text:s.color};});
      const hex=css=>'#'+css.match(/[\d.]+/g).slice(0,3).map(v=>Number(v).toString(16).padStart(2,'0')).join('');
      assert.equal(selection.text,'rgb(255, 255, 255)');
      assert(model.contrast(hex(selection.fill),'#FFFFFF')>=4.5,`${scheme}/${preset.id}: readable white sidebar selection`);
    }
  }
  await page.evaluate(()=>whale.edit({enabled:false}));
  await page.waitForFunction(()=>!whale.getState().busy);
  assert.equal(await first.evaluate(el=>el.getBoundingClientRect().height),20,'disabling appearance restores the host switch');
  assert.equal(await page.locator('[data-whale-settings-title]').count(),0,'disabling appearance restores headings');
  await page.evaluate(()=>whale.edit({enabled:true,reduceTransparency:true}));
  await page.waitForSelector('body[data-whale-mac-settings-reduced]');
  await page.evaluate(()=>whale.dispose());
  assert.equal(await page.locator('[data-whale-settings-title]').count(),0,'unload restores headings');
  assert.equal(await page.locator('body[data-whale-mac-settings-reduced]').count(),0);
  assert.equal(await page.evaluate(()=>document.body.style.getPropertyValue('--whale-mac-selection-fill')),'','unload removes the selection fill');
  // The empty Windows extension must produce exactly the host settings styles,
  // even while shared appearance tokens are enabled. Compare computed styles to
  // the same official fixture with platform appearance disabled.
  const hostStyles=()=>page.evaluate(()=>{
    const selectors=['[data-shortcut-modal="settings"]','[data-shortcut-modal] > nav','[data-shortcut-modal] nav button[aria-current="true"]','[data-shortcut-modal] > nav + div','[data-shortcut-modal] > nav + div > div:first-child','[data-shortcut-modal] [role="switch"]','[data-shortcut-modal] [role="switch"] > span'];
    const properties=['width','height','padding','borderRadius','backgroundColor','color','fontSize','fontWeight','backdropFilter','boxShadow'];
    return selectors.map(selector=>{const style=getComputedStyle(document.querySelector(selector));return Object.fromEntries(properties.map(key=>[key,style[key]]));});
  });
  for(const scheme of ['light','dark']) {
    await mount('通用',scheme,'win32');
    assert.equal(await page.locator('body').getAttribute('data-whale-settings-platform'),'windows');
    assert.equal(await page.locator('body[data-whale-mac-settings],body[data-whale-mac-settings-reduced],[data-whale-settings-title]').count(),0);
    assert.equal(await page.evaluate(()=>document.body.style.getPropertyValue('--whale-mac-selection-fill')),'');
    const windowsStyles=await hostStyles();
    assert.equal(windowsStyles[5].height,'20px','Windows keeps the official switch height');
    assert.equal(windowsStyles[6].width,windowsStyles[6].height,'Windows keeps the official round thumb');
    await page.locator('[data-shortcut-modal]').screenshot({path:`${output}windows-general-${scheme}.png`});
    await page.evaluate(()=>whale.edit({enabled:false}));
    await page.waitForFunction(()=>!whale.getState().busy);
    assert.equal(await page.locator('body').getAttribute('data-whale-settings-platform'),null);
    assert.deepEqual(await hostStyles(),windowsStyles,'empty Windows CSS preserves all measured official settings styles');
    await page.evaluate(()=>whale.edit({enabled:true,reduceTransparency:true}));
    await page.waitForSelector('body[data-whale-settings-platform="windows"]');
    assert.equal(await page.locator('body[data-whale-settings-reduced]').count(),1,'the Windows extension receives the shared transparency preference');
    assert.equal(await page.locator('body[data-whale-mac-settings-reduced]').count(),0);
    await page.evaluate(()=>whale.dispose());
    assert.equal(await page.locator('body').getAttribute('data-whale-settings-platform'),null,'unload removes the Windows gate');
    assert.equal(await page.locator('body[data-whale-settings-reduced]').count(),0,'unload removes the shared material preference');
    console.log(`Windows/${scheme}: official settings appearance, no macOS leakage, disabling and unload verified`);
  }
  await mount('通用','dark','unknown');
  assert.equal(await page.locator('body').getAttribute('data-whale-settings-platform'),null,'unknown clients retain official settings');
  await page.evaluate(()=>document.documentElement.setAttribute('data-platform','darwin'));
  await page.waitForSelector('body[data-whale-mac-settings]');
  await page.waitForSelector('[data-whale-settings-title]');
  assert.equal(await page.locator('[data-shortcut-modal] [role="switch"]').evaluate(el=>el.getBoundingClientRect().height),16,'a late macOS marker activates the accepted style');
  await page.evaluate(()=>document.documentElement.setAttribute('data-platform','win32'));
  await page.waitForSelector('body[data-whale-settings-platform="windows"]');
  assert.equal(await page.locator('body[data-whale-mac-settings],body[data-whale-mac-settings-reduced],[data-whale-settings-title]').count(),0,'platform transitions restore original host headings and remove macOS gates');
  assert.equal(await page.locator('[data-shortcut-modal] [role="switch"]').evaluate(el=>el.getBoundingClientRect().height),20);
  await page.evaluate(()=>document.documentElement.removeAttribute('data-platform'));
  await page.waitForFunction(()=>!document.body.hasAttribute('data-whale-settings-platform'));
  console.log('Late client markers and macOS → Windows → official fallback transitions verified.');
  for(const width of [700,560,390]) {
    await page.setViewportSize({width,height:760});await mount('主题');
    const overflow=await page.locator(`.${root.options}`).evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
    assert(overflow.scroll<=overflow.client+1,`${width}px: settings content must not overflow horizontally (${JSON.stringify(overflow)})`);
    await page.locator('[data-shortcut-modal]').screenshot({path:`${output}theme-${width}.png`});
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${output}theme-dark.html`,fixture('主题').replace('<body>','<body data-ds-dark-theme data-whale-mac-settings>').replace(`class="${root.header}"`,`class="${root.header}" data-whale-settings-title="主题"`).replace('</style>',`body{--whale-mac-selection-fill:${model.readable(model.palette(model.DEFAULTS.dark).accentFill,'#FFFFFF')};${Object.entries(model.tokensFor(model.normalizeAppearance())).map(([key,pair])=>`${key}:${pair.dark}`).join(';')}}</style>`));
  console.log('Keyboard, disabled controls, reduced transparency/motion, 27 theme fills, headings, cleanup and narrow layouts verified.');
  console.log(`Preview images: ${output}`);
} finally {await browser.close();}

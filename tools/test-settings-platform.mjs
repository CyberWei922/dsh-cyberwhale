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

// ── Windows WinUI 3 样式契约 ──────────────────────────────────────────
// 只看声明：注释里会举官方类名当反例，不该被当成「用了哈希类名」。
const css = windows.CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const win = (label, condition, detail = '') => assert.ok(condition, `${label}${detail ? ` —— ${detail}` : ''}`);
win('Windows 样式不是空占位', css.trim().length > 0);
for (const [label, anchor] of [
  ['面板作用域门', 'body[data-whale-settings-platform="windows"] [data-shortcut-modal="settings"]'],
  ['深色作用域', 'body[data-ds-dark-theme][data-whale-settings-platform="windows"]'],
  ['减少透明作用域', 'body[data-whale-settings-platform="windows"][data-whale-settings-reduced]'],
  ['左侧导航列', '> nav'],
  ['选中的导航项', 'nav button[aria-current="true"]'],
  ['导航悬停/按下态', 'nav button:hover'],
  ['开关基元', '[role="switch"]'],
  ['开关状态写在 aria-checked 上', '[aria-checked="true"]'],
  ['页面标题锚点', '[data-whale-settings-title]'],
  ['右侧顶栏', '> nav + div > div:first-child'],
  ['内容滚动区域', '> nav + div > div + div'],
  ['插件设置行', '.dsh-appearance-row'],
  ['桌宠设置行', '.dsh-whale-row'],
  ['主题卡片', '.dsh-appearance-card'],
  ['官方通用页分组', ':has(> div > [role="switch"])'],
]) win(`CSS 含锚点：${label}`, css.includes(anchor), anchor);
win('不依赖 CSS Module 哈希类名', !/\.[A-Za-z0-9_-]{6,}_[A-Za-z][A-Za-z0-9]*/.test(css));
win('不含 macOS 门控（互不影响）', !css.includes('data-whale-mac-settings') && !css.includes('data-platform=darwin'));
win('每条规则都带作用域门', css.split('\n').filter(line => /^\s*\[data-shortcut-modal=/.test(line)).length === 0);
win('不依赖 Web 模糊（Mica 为不透明近似）', !css.includes('backdrop-filter'));
win('含系统/插件的透明回退', css.includes('prefers-reduced-transparency:reduce'));
win('含减少动态效果适配', css.includes('prefers-reduced-motion:reduce'));
win('含高对比适配', css.includes('prefers-contrast:more'));
win('含强制颜色适配', css.includes('forced-colors:active'));

// 开关几何按 WinUI：40×20 轨道、12px 圆滑块、4px 内缩、20px 行程。
const switchBlock = /\[role="switch"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
const width = Number(/width:([\d.]+)px/.exec(switchBlock)?.[1]);
const height = Number(/height:([\d.]+)px/.exec(switchBlock)?.[1]);
const padding = Number(/padding:([\d.]+)px/.exec(switchBlock)?.[1]);
const thumb = Number(/\[role="switch"\]\s*>\s*span\s*\{[^}]*width:([\d.]+)px/.exec(css)?.[1]);
const thumbHeight = Number(/\[role="switch"\]\s*>\s*span\s*\{[^}]*height:([\d.]+)px/.exec(css)?.[1]);
const travel = Number(/\[aria-checked="true"\]\s*>\s*span\s*\{[^}]*translateX\(([\d.]+)px\)/.exec(css)?.[1]);
win('开关几何取到了值', [width, height, padding, thumb, thumbHeight, travel].every(Number.isFinite), `${width}/${height}/${padding}/${thumb}/${travel}`);
win('开关几何为 WinUI 规格（40×20）', width === 40 && height === 20 && padding === 4, `${width}×${height} 内缩 ${padding}`);
win('滑块为 12px 圆形', thumb === 12 && thumbHeight === 12, `${thumb}×${thumbHeight}`);
win('开关行程与几何一致', width - 2 * padding - thumb === travel, `${width} - ${padding}*2 - ${thumb} = ${width - 2 * padding - thumb}，translateX ${travel}`);
win('开启态填充主题强调色', /\[role="switch"\]\[aria-checked="true"\]\s*\{[^}]*background:var\(--dsw-alias-brand-primary\)/.test(css));
win('开启态滑块用主题反色文字', /\[aria-checked="true"\]\s*>\s*span\s*\{[^}]*background:var\(--dsw-alias-label-primary-foreground\)/.test(css));
win('选中导航项用柔和中性底色 + 强调色短竖条',
  /nav button\[aria-current="true"\]\s*\{[^}]*color-mix\(in srgb,var\(--dsw-alias-label-primary\)/.test(css) &&
  /nav button\[aria-current="true"\]::before\s*\{[^}]*width:3px[^}]*height:16px[^}]*background:var\(--dsw-alias-brand-primary\)/.test(css));
win('页面标题用 WinUI 标题字号阶梯', /\[data-whale-settings-title\]::before\s*\{[^}]*font-size:20px[^}]*font-weight:600/.test(css));
win('面板圆角 8px、控件圆角 4px', /\{[^}]*border-radius:8px/.test(css) && /border-radius:4px/.test(css));
win('主题相关变量统一 --whale-win-* 前缀', css.includes('--whale-win-mica') && !/--whale-(?!win-)[a-z]/.test(css));
console.log('Settings platform: client OS routing, unknown fallback, reduced transparency, transitions, cleanup and the WinUI 3 style contract passed.');

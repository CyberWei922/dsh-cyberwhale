'use strict';

// Shared by the host validator and the browser bundle. Only theme-owned tokens
// are overridden; the native sidebar material and semantic status colors stay
// with Harness. Public theme seeds match Codex's appearance variants; source
// versions and licenses are recorded in docs/theme-presets.md and LICENSES.
const PRESETS = {
  light: [
    { id: 'codex', name: 'Codex', background: '#FFFFFF', foreground: '#0D0D0D', accent: '#0285FF' },
    { id: 'latte', name: 'Catppuccin Latte', background: '#EFF1F5', foreground: '#4C4F69', accent: '#8839EF' },
    { id: 'github', name: 'GitHub', background: '#FFFFFF', foreground: '#1F2328', accent: '#0969DA' },
    { id: 'everforest', name: 'Everforest', background: '#FDF6E3', foreground: '#5C6A72', accent: '#93B259' },
    { id: 'gruvbox', name: 'Gruvbox Medium', background: '#FBF1C7', foreground: '#3C3836', accent: '#458588' },
    { id: 'one', name: 'One Light', background: '#FAFAFA', foreground: '#383A42', accent: '#526FFF' },
    { id: 'rose-pine', name: 'Rose Pine Dawn', background: '#FAF4ED', foreground: '#575279', accent: '#D7827E' },
    { id: 'solarized', name: 'Solarized', background: '#FDF6E3', foreground: '#657B83', accent: '#B58900' },
    { id: 'vscode-plus', name: 'VS Code Plus', background: '#FFFFFF', foreground: '#000000', accent: '#007ACC' },
    { id: 'whale', name: '蓝鲸 · 晨雾', background: '#F2F8FC', foreground: '#183348', accent: '#087EA4' },
  ],
  dark: [
    { id: 'codex', name: 'Codex', background: '#181818', foreground: '#FFFFFF', accent: '#339CFF' },
    { id: 'mocha', name: 'Catppuccin Mocha', background: '#1E1E2E', foreground: '#CDD6F4', accent: '#CBA6F7' },
    { id: 'dracula', name: 'Dracula', background: '#282A36', foreground: '#F8F8F2', accent: '#FF79C6' },
    { id: 'ayu', name: 'Ayu', background: '#10141C', foreground: '#BFBDB6', accent: '#E6B450' },
    { id: 'everforest', name: 'Everforest', background: '#2D353B', foreground: '#D3C6AA', accent: '#A7C080' },
    { id: 'github', name: 'GitHub', background: '#0D1117', foreground: '#E6EDF3', accent: '#1F6FEB' },
    { id: 'gruvbox', name: 'Gruvbox Medium', background: '#282828', foreground: '#EBDBB2', accent: '#458588' },
    { id: 'material', name: 'Material Darker', background: '#212121', foreground: '#EEFFFF', accent: '#80CBC4' },
    { id: 'monokai', name: 'Monokai', background: '#272822', foreground: '#F8F8F2', accent: '#99947C' },
    { id: 'night-owl', name: 'Night Owl', background: '#011627', foreground: '#D6DEEB', accent: '#44596B' },
    { id: 'nord', name: 'Nord', background: '#2E3440', foreground: '#D8DEE9', accent: '#88C0D0' },
    { id: 'one', name: 'One Dark Pro', background: '#282C34', foreground: '#ABB2BF', accent: '#4D78CC' },
    { id: 'rose-pine', name: 'Rose Pine Moon', background: '#232136', foreground: '#E0DEF4', accent: '#EA9A97' },
    { id: 'solarized', name: 'Solarized', background: '#002B36', foreground: '#839496', accent: '#D30102' },
    { id: 'tokyo-night', name: 'Tokyo Night', background: '#1A1B26', foreground: '#A9B1D6', accent: '#3D59A1' },
    { id: 'vscode-plus', name: 'VS Code Plus', background: '#1E1E1E', foreground: '#D4D4D4', accent: '#007ACC' },
    { id: 'whale', name: '蓝鲸 · 深海', background: '#102332', foreground: '#DBEEF7', accent: '#6ECFFF' },
  ],
};
const GRADIENTS = {
  aurora: { name: '极光', light: 'radial-gradient(ellipse at 10% 15%, #92D6E8, transparent 65%), radial-gradient(ellipse at 85% 75%, #C2ACED, transparent 65%), #F0EDF8', dark: 'radial-gradient(ellipse at 10% 15%, #15415D, transparent 65%), radial-gradient(ellipse at 85% 75%, #493357, transparent 65%), #172131' },
  sea: { name: '海岸', light: 'radial-gradient(ellipse at 20% 80%, #92CECC, transparent 65%), radial-gradient(ellipse at 90% 10%, #EDCFAB, transparent 65%), #EAF4F4', dark: 'radial-gradient(ellipse at 20% 80%, #12585C, transparent 65%), radial-gradient(ellipse at 90% 10%, #57412E, transparent 65%), #142829' },
  dusk: { name: '暮色', light: 'radial-gradient(ellipse at 15% 20%, #D5BDEB, transparent 65%), radial-gradient(ellipse at 85% 80%, #F0BDAC, transparent 65%), #F7EFF4', dark: 'radial-gradient(ellipse at 15% 20%, #493A66, transparent 65%), radial-gradient(ellipse at 85% 80%, #5F3940, transparent 65%), #252034' },
};
const DEFAULTS = {
  schemaVersion: 1, enabled: true,
  light: { preset: 'codex', ...PRESETS.light[0] },
  dark: { preset: 'codex', ...PRESETS.dark[0] },
  uiFont: '', codeFont: '',
  background: 'none', gradient: 'aurora', wallpaper: null,
  imageFit: 'cover', imagePosition: 'center', mask: 72, blur: 0,
  glassInput: false, reduceTransparency: false,
};
const color = (v, fallback) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v.toUpperCase() : fallback;
const font = v => {
  if (typeof v !== 'string' || v.length > 180) return '';
  // System font names may contain punctuation. Accept one JSON-quoted family
  // as a CSS string, keeping punctuation inside the escaped string literal.
  if (v.startsWith('"')) {
    try {
      const name = JSON.parse(v);
      if (typeof name === 'string' && name.trim() && !/[\x00-\x1f\x7f]/.test(name)) return JSON.stringify(name.trim());
    } catch { /* Existing hand-entered CSS fallback stacks use the rule below. */ }
  }
  return /^[\p{L}\p{N}\s,.'"_-]*$/u.test(v) ? v.trim() : '';
};
const clamp = (v, min, max, fallback) => typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : fallback;
function normalizeAppearance(value = {}) {
  const result = { ...DEFAULTS };
  for (const scheme of ['light', 'dark']) {
    const input = value?.[scheme] ?? {};
    const preset = PRESETS[scheme].find(p => p.id === input.preset) ?? PRESETS[scheme][0];
    result[scheme] = { preset: input.preset === 'custom' ? 'custom' : preset.id,
      background: color(input.background, preset.background), foreground: color(input.foreground, preset.foreground), accent: color(input.accent, preset.accent) };
  }
  for (const key of ['enabled', 'glassInput', 'reduceTransparency']) result[key] = typeof value?.[key] === 'boolean' ? value[key] : DEFAULTS[key];
  result.uiFont = font(value?.uiFont); result.codeFont = font(value?.codeFont);
  result.background = ['none', 'gradient', 'image'].includes(value?.background) ? value.background : 'none';
  result.gradient = Object.hasOwn(GRADIENTS, value?.gradient) ? value.gradient : 'aurora';
  result.imageFit = value?.imageFit === 'contain' ? 'contain' : 'cover';
  result.imagePosition = ['center', 'top', 'bottom'].includes(value?.imagePosition) ? value.imagePosition : 'center';
  result.mask = clamp(value?.mask, 55, 95, DEFAULTS.mask);
  result.blur = clamp(value?.blur, 0, 24, 0);
  if (typeof value?.wallpaper?.id === 'string' && /^[a-f0-9]{64}$/.test(value.wallpaper.id)) {
    result.wallpaper = { id: value.wallpaper.id, name: String(value.wallpaper.name ?? '背景图片').replace(/[\x00-\x1F]/g, '').slice(0, 100) };
  }
  // Image mode may be selected before upload, or remain selected after removal.
  // The renderer uses the theme's solid background until an image is available.
  return result;
}
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function mix(a, b, weight) {
  const first = rgb(a), second = rgb(b);
  return '#' + first.map((v, i) => Math.round(v * (1 - weight) + second[i] * weight).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function luminance(hex) {
  return rgb(hex).map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function readable(fg, bg, minimum = 4.5) {
  if (contrast(fg, bg) >= minimum) return fg;
  const target = contrast('#FFFFFF', bg) > contrast('#000000', bg) ? '#FFFFFF' : '#000000';
  for (let i = 1; i <= 100; i++) { const c = mix(fg, target, i / 100); if (contrast(c, bg) >= minimum) return c; }
  return target;
}
function readableOn(fg, backgrounds, minimum = 4.5) {
  const score = color => Math.min(...backgrounds.map(bg => contrast(color, bg)));
  if (score(fg) >= minimum) return fg;
  const target = score('#FFFFFF') > score('#000000') ? '#FFFFFF' : '#000000';
  for (let i = 1; i <= 100; i++) { const c = mix(fg, target, i / 100); if (score(c) >= minimum) return c; }
  return target;
}
function palette(input) {
  const bg = input.background;
  const baseText = readable(input.foreground, bg);
  const textPole = contrast('#FFFFFF', bg) > contrast('#000000', bg) ? '#FFFFFF' : '#000000';
  // Mid-gray custom backgrounds need their derived surfaces kept on the same
  // readable side; otherwise no single label color can work across all states.
  const surface = fill => readable(fill, textPole);
  const layer = surface(mix(bg, baseText, 0.035)), card = surface(mix(bg, baseText, 0.065));
  const hover = surface(mix(bg, baseText, 0.08)), active = surface(mix(bg, baseText, 0.12));
  // Very dark accent seeds (e.g. Tokyo Night) barely change the base surface.
  // Use the readable accent for a soft selection tint; keep labels independent.
  const selectionAccent = readable(input.accent, bg);
  const selected = surface(mix(bg, selectionAccent, 0.16)), selectedHover = surface(mix(bg, selectionAccent, 0.22));
  const surfaces = [bg, layer, card, hover, active, selected, selectedHover];
  const fg = readableOn(baseText, surfaces), border = mix(bg, baseText, 0.16);
  const accentFill = readable(input.accent, bg, 3);
  const onAccent = readable('#FFFFFF', accentFill);
  // Harness normally inverts its neutral primary button on hover. An accent
  // button needs a related fill which still contrasts with its unchanged label.
  const hoverTarget = contrast(onAccent, '#FFFFFF') > contrast(onAccent, '#000000') ? '#FFFFFF' : '#000000';
  const accentHover = mix(accentFill, hoverTarget, 0.12);
  return { bg, fg, layer, card, muted: readableOn(mix(fg, bg, 0.38), surfaces), faint: readableOn(mix(fg, bg, 0.5), surfaces),
    accent: readableOn(input.accent, surfaces), accentFill, accentHover, onAccent,
    border, hover, active, selected, selectedHover, switchThumb: readable(fg, border, 3) };
}
function tokensFor(config) {
  const tokens = {};
  function put(key, light, dark) { tokens[key] = { light, dark }; }
  const a = palette(config.light), b = palette(config.dark);
  const groups = {
    bg: ['--dsw-alias-bg-base'], layer: ['--dsw-alias-bg-layer-1', '--dsw-specific-menu', '--dsw-menu-surface-fill'],
    // General settings uses module-platform for the selected appearance card,
    // font-size stepper and selectors, separately from the usual layer tokens.
    card: ['--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-alias-bg-module-platform', '--dsw-alias-bg-overlay', '--dsw-alias-button-floating-fill', '--dsw-alias-button-elevated-fill', '--dsw-alias-button-tool-bar-fill', '--dsw-alias-button-primary-dimmed', '--dsw-specific-input-major', '--dsw-specific-selector', '--dsw-specific-bubble', '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner', '--dsw-alias-markdown-inline-code'],
    fg: ['--dsw-alias-label-primary', '--dsw-alias-label-primary-bluish', '--dsw-alias-label-primary-dimmed'],
    accentFill: ['--dsw-alias-brand-primary'], onAccent: ['--dsw-alias-label-primary-foreground'],
    accentHover: ['--dsw-alias-button-primary-hover'], switchThumb: ['--dsw-alias-switch-thumb'],
    muted: ['--dsw-alias-label-secondary', '--dsw-alias-label-caption'], faint: ['--dsw-alias-label-tertiary', '--dsw-alias-label-dimmed'],
    accent: ['--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary', '--dsw-focus-ring-color', '--dsw-alias-button-ghost-active-border'],
    border: ['--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-border-l3', '--dsw-alias-border-l4'],
    hover: ['--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-solid', '--dsw-alias-button-floating-hover', '--dsw-alias-button-tool-bar-hover', '--dsw-specific-sidebar-nav-item-hover'],
    active: ['--dsw-alias-interactive-bg-active'],
    selected: ['--dsw-alias-interactive-bg-hover-accent', '--dsw-alias-bg-multi-select', '--dsw-alias-button-ghost-active-fill', '--dsw-specific-sidebar-nav-item-active', '--dsw-specific-sidebar-nav-item-active-accent', '--dsw-alias-bg-document-selection'],
    selectedHover: ['--dsw-alias-button-ghost-active-hover'],
  };
  for (const [role, keys] of Object.entries(groups)) for (const key of keys) put(key, a[role], b[role]);
  if (config.uiFont) put('--dsw-font-family', `${config.uiFont}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`, `${config.uiFont}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`);
  if (config.codeFont) put('--ds-font-family-code', `${config.codeFont}, ui-monospace, "SFMono-Regular", Consolas, monospace`, `${config.codeFont}, ui-monospace, "SFMono-Regular", Consolas, monospace`);
  return tokens;
}
module.exports = { PRESETS, GRADIENTS, DEFAULTS, normalizeAppearance, rgb, mix, contrast, readable, palette, tokensFor };

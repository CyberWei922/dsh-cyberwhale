'use strict';
const React = require('react');
const { Button, DisclosureRow, IconChevronDownOutlineRegular, Switch, SegmentedControl } = require('@deepseek-ai/dsh-client-ui-primitives');
const { PRESETS, GRADIENTS, normalizeAppearance, palette, contrast } = require('../lib/appearance-model.cjs');
const { readImage, colorFromImage } = require('./appearance-image.mjs');
const { FontSettings } = require('./appearance-fonts.js');
const h = React.createElement;
function useAppearance(controller) {
  const [snapshot, setSnapshot] = React.useState(() => controller.getState());
  React.useEffect(() => { const off = controller.subscribe(() => setSnapshot(controller.getState())); setSnapshot(controller.getState()); return off; }, [controller]);
  return snapshot;
}
function Row({ title, description, children }) {
  return h('div', { className: 'dsh-appearance-row' }, h('div', null, h('div', { className: 'dsh-appearance-label' }, title), description && h('div', { className: 'dsh-appearance-description' }, description)), h('div', { className: 'dsh-appearance-control' }, children));
}
function ColorField({ title, value, onChange, disabled }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  return h('label', { className: 'dsh-appearance-color' }, h('span', null, title), h('span', { className: 'dsh-appearance-color-input' },
    h('input', { type: 'color', value, disabled, 'aria-label': title, onChange: e => onChange(e.target.value.toUpperCase()) }),
    h('input', { type: 'text', value: text, maxLength: 7, disabled, spellCheck: false, 'aria-label': `${title}十六进制颜色`, onChange: e => { setText(e.target.value); if (/^#[\da-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toUpperCase()); }, onBlur: () => setText(value) })));
}
function ThemeCard({ scheme, config, edit, disabled }) {
  const input = config[scheme], p = palette(input), name = scheme === 'light' ? '浅色' : '深色';
  const choose = id => { const preset = PRESETS[scheme].find(x => x.id === id); if (preset) edit({ [scheme]: { preset: id, background: preset.background, foreground: preset.foreground, accent: preset.accent } }); };
  return h('section', { className: 'dsh-appearance-card', 'aria-label': `${name}主题` },
    h('div', { className: 'dsh-appearance-card-heading' }, `${scheme === 'light' ? '☀︎' : '☾'}　${name}主题`, h('span', { className: 'dsh-appearance-card-badge' }, input.preset === 'custom' ? '自定义' : '预设')),
    h('div', { className: 'dsh-appearance-mini', style: { background: p.bg, color: p.fg, '--mini-accent': p.accent, '--mini-line': p.border, '--mini-muted': p.muted } },
      h('div', { className: 'dsh-appearance-mini-sidebar', style: { background: p.layer } }, h('span'), h('i'), h('i'), h('i')),
      h('div', { className: 'dsh-appearance-mini-chat' }, h('strong', null, '让灵感自然发生'), h('p', null, '背景、文字与强调色，协调搭配。'), h('code', null, 'const hello = "Harness";'), h('div', { className: 'dsh-appearance-mini-composer', style: { background: p.card } }, h('span', null, '有什么想法？'), h('b', { style: { background: p.accentFill, color: p.onAccent } }, '↑')))),
    h('label', { className: 'dsh-appearance-select-label' }, '主题预设', h('select', { value: input.preset, disabled, 'aria-label': `${name}主题预设`, onChange: e => choose(e.target.value) }, ...PRESETS[scheme].map(p => h('option', { key: p.id, value: p.id }, p.name)), input.preset === 'custom' && h('option', { value: 'custom' }, '自定义'))),
    h('div', { className: 'dsh-appearance-colors' }, ...[['accent', '强调色'], ['background', '背景色'], ['foreground', '文字色']].map(([key, label]) => h(ColorField, { key, title: `${name}${label}`, value: input[key], disabled, onChange: value => edit({ [scheme]: { ...input, preset: 'custom', [key]: value } }) }))),
    contrast(input.foreground, input.background) < 4.5 && h('p', { className: 'dsh-appearance-description' }, '文字与背景接近，已自动提高显示对比度。'));
}
function BackgroundSettings({ config, theme, disabled, uploading, fileError, sources, sourceImage, fileInput, upload, extract, edit, remove, changeBackground }) {
  const [effectsOpen, setEffectsOpen] = React.useState(false), [colorsOpen, setColorsOpen] = React.useState(false);
  const row = (key, title, description, control) => h(Row, { key, title, description }, control);
  const select = (label, value, options, onChange) => h('select', { className: 'dsh-appearance-input', 'aria-label': label, value, disabled, onChange: e => onChange(e.target.value) }, ...options.map(([value, text]) => h('option', { key: value, value }, text)));
  const range = (key, title, description, min, max, unit) => row(key, title, description, h('label', { className: 'dsh-appearance-range' }, h('input', { type: 'range', min, max, value: config[key], disabled, 'aria-label': title, onChange: e => edit({ [key]: Number(e.target.value) }) }), h('span', null, `${config[key]}${unit}`)));
  const mask = () => range('mask', '背景遮罩', '越高越清晰，越低越能看到背景。', 55, 95, '%');
  const disclosure = (key, title, open, onToggle, children) => h(DisclosureRow, {
    key, title, open, onToggle, expandable: true, expandOnRowClick: true, previewChevron: false,
    icon: h(IconChevronDownOutlineRegular), className: 'dsh-appearance-disclosure', rowClassName: 'dsh-appearance-disclosure-heading',
  }, open && h('div', { className: 'dsh-appearance-disclosure-body' }, children));
  const hasSources = sourceImage === config.wallpaper?.id && sources.length > 0;
  const toggleColors = () => {
    const open = !colorsOpen; setColorsOpen(open);
    if (open && !hasSources && !disabled) void extract();
  };
  let panel;
  if (config.background === 'none') {
    panel = h('p', { className: 'dsh-appearance-background-note' }, '使用当前主题的背景色，可在上方浅色／深色主题中调整。');
  } else if (config.background === 'gradient') {
    panel = h('div', { role: 'group', 'aria-label': '渐变背景设置' },
      h('div', { className: 'dsh-appearance-gradients' }, ...Object.entries(GRADIENTS).map(([id, g]) => h('button', { key: id, type: 'button', disabled, className: 'dsh-appearance-gradient', 'aria-label': `${g.name}渐变`, 'aria-pressed': config.gradient === id, onClick: () => edit({ gradient: id }) }, h('span', { style: { background: g[theme?.active.colorScheme ?? 'light'] } }), g.name))),
      mask());
  } else {
    panel = h('div', { role: 'group', 'aria-label': '图片背景设置' },
      h('input', { ref: fileInput, type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, disabled, 'aria-label': '上传背景图片', onChange: upload }),
      config.wallpaper ? h('div', null,
        h('div', { className: 'dsh-appearance-wallpaper-preview' }, h('img', { src: `deskpet/appearance/wallpaper/${config.wallpaper.id}`, alt: '当前背景图片', style: { objectFit: config.imageFit, objectPosition: config.imagePosition } })),
        row('upload', '背景图片', config.wallpaper.name, h('div', { className: 'dsh-appearance-actions' }, h(Button, { disabled, onClick: () => fileInput.current?.click() }, uploading ? '处理图片…' : '更换图片'), h(Button, { disabled, variant: 'ghost', onClick: remove }, '移除'))),
        row('fit', '图片布局', null, h('div', { className: 'dsh-appearance-actions' }, select('图片缩放', config.imageFit, [['cover', '填充'], ['contain', '适应']], v => edit({ imageFit: v })), select('图片位置', config.imagePosition, [['center', '居中'], ['top', '顶部'], ['bottom', '底部']], v => edit({ imagePosition: v })))),
        disclosure('effects', '效果调整', effectsOpen, () => setEffectsOpen(v => !v), [mask(), range('blur', '背景模糊', null, 0, 24, ' px')]),
        disclosure('sources', '从图片生成配色', colorsOpen, toggleColors,
          row('sources', '图片主色', '选择主色后才应用配套的浅色和深色方案。', hasSources ? h('div', { className: 'dsh-appearance-swatches' }, ...sources.map(source => h('button', { key: source, type: 'button', disabled, style: { background: source }, 'aria-label': `应用图片主色 ${source}`, title: source, onClick: () => edit(colorFromImage(source)) }))) : h(Button, { disabled, onClick: () => void extract() }, uploading ? '提取颜色…' : '提取图片颜色'))))
        : h('div', { className: 'dsh-appearance-upload-empty' },
          h('div', { className: 'dsh-appearance-label' }, '选择一张背景图片'),
          h('p', { className: 'dsh-appearance-description' }, '支持 PNG、JPEG、WebP，图片只保存在本机。'),
          h(Button, { disabled, variant: 'outline', onClick: () => fileInput.current?.click() }, uploading ? '处理图片…' : '选择图片')),
      fileError && h('p', { role: 'alert', className: 'dsh-appearance-error' }, fileError));
  }
  return h('div', { className: 'dsh-appearance-background-settings' },
    row('type', '背景样式', null, h(SegmentedControl, { id: 'dsh-whale-background', label: '背景样式', value: config.background, disabled, options: [{ value: 'none', label: '纯色' }, { value: 'gradient', label: '渐变' }, { value: 'image', label: '图片' }], onChange: changeBackground })),
    panel);
}
function AppearancePage({ controller }) {
  const snapshot = useAppearance(controller), { config, recovering, loading, available, theme } = snapshot;
  const [uploading, setUploading] = React.useState(false), [fileError, setFileError] = React.useState(null), [sources, setSources] = React.useState([]);
  const [sourceImage, setSourceImage] = React.useState(null);
  const fileInput = React.useRef(null), imageRevision = React.useRef(0);
  React.useEffect(() => () => { imageRevision.current++; }, []);
  const disabled = recovering || loading || uploading || !available;
  const edit = patch => controller.edit(patch);
  const changeBackground = background => { setFileError(null); edit({ background }); };
  const remove = () => { imageRevision.current++; edit({ wallpaper: null, background: 'image' }); setSources([]); setSourceImage(null); setFileError(null); };
  async function upload(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const revision = ++imageRevision.current; setUploading(true); setFileError(null);
    try {
      const result = await readImage(file); if (revision !== imageRevision.current) return;
      const wallpaper = await controller.upload(result.dataURL, file.name); if (revision !== imageRevision.current) return;
      edit({ wallpaper, background: 'image' }); setSources(result.sources); setSourceImage(wallpaper.id);
    } catch (e) { if (revision === imageRevision.current) setFileError(e.message); }
    finally { if (revision === imageRevision.current) setUploading(false); }
  }
  async function extract() {
    if (!config.wallpaper) return;
    const id = config.wallpaper.id, revision = ++imageRevision.current;
    setUploading(true); setFileError(null);
    try {
      const response = await fetch(`deskpet/appearance/wallpaper/${id}`);
      if (!response.ok) throw new Error('背景图片读取失败，请重新上传');
      const blob = await response.blob();
      const result = await readImage(new File([blob], config.wallpaper.name, { type: blob.type }));
      if (revision === imageRevision.current) { setSources(result.sources); setSourceImage(id); }
    } catch (e) { if (revision === imageRevision.current) setFileError(e.message); }
    finally { if (revision === imageRevision.current) setUploading(false); }
  }
  const section = (title, description, children) => h('section', { className: 'dsh-appearance-section' }, h('h3', null, title), description && h('p', { className: 'dsh-appearance-description' }, description), children);
  const row = (key, title, description, control) => h(Row, { key, title, description }, control);
  const toggle = (key, title, description, extraDisabled = false) => row(key, title, description, h(Switch, { label: title, checked: config[key], disabled: disabled || extraDisabled, onChange: v => edit({ [key]: v }) }));
  return h('div', { className: 'dsh-appearance-page' },
    h('p', { className: 'dsh-appearance-intro' }, '选择喜欢的配色，修改后立即生效并自动保存。'),
    !available && h('p', { role: 'alert', className: 'dsh-appearance-error' }, '当前 Harness 未提供主题接口，请使用 0.2.0-rc.2 或更新版本。'),
    toggle('enabled', '启用外观美化', '配色、字体、背景与特效一起生效，桌宠独立控制。'),
    row('mode', '外观模式', '使用 Harness 的模式设置，立即保存。', h(SegmentedControl, { id: 'dsh-whale-mode', label: '外观模式', value: theme?.preference ?? 'system', disabled, options: [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }], onChange: v => void controller.setMode(v) })),
    h('div', { className: 'dsh-appearance-cards' }, h(ThemeCard, { scheme: 'light', config, edit, disabled }), h(ThemeCard, { scheme: 'dark', config, edit, disabled })),
    section('字体', null, [
      h(FontSettings, { key: 'fonts', config, edit, disabled }),
      row('size', '正文字号', '使用 Harness 原有字号设置，立即保存。', h('div', { className: 'dsh-appearance-size' }, h(Button, { 'aria-label': '缩小正文字号', disabled: disabled || theme?.fontSize <= 10, onClick: () => void controller.setFontSize((theme?.fontSize ?? 14) - 1) }, '−'), h('span', null, `${theme?.fontSize ?? 14} px`), h(Button, { 'aria-label': '增大正文字号', disabled: disabled || theme?.fontSize >= 22, onClick: () => void controller.setFontSize((theme?.fontSize ?? 14) + 1) }, '+'))),
    ]),
    section('背景', '背景铺满整个窗口，左侧面板叠加磨砂；收起侧栏时图片大小与位置不变。',
      h(BackgroundSettings, { key: `${config.background}:${config.wallpaper?.id ?? ''}`, config, theme, disabled, uploading, fileError, sources, sourceImage, fileInput, upload, extract, edit, remove, changeBackground })),
    section('磨砂玻璃', null, [
      toggle('glassInput', '输入框磨砂玻璃', '页面内的磨砂透光效果，保留较高遮罩以看清输入文字。', config.reduceTransparency),
      toggle('reduceTransparency', '减少透明效果', '使用实色表面，隐藏聊天背景和磨砂效果以提高可读性。'),
    ]),
    (snapshot.error || snapshot.warning) && h('p', { role: 'alert', className: 'dsh-appearance-error' }, snapshot.error ?? snapshot.warning),
    h('div', { className: 'dsh-appearance-footer' }, h(Button, { variant: 'ghost', disabled, onClick: () => { edit(normalizeAppearance()); setSources([]); } }, '恢复默认配色')));
}
module.exports = { AppearancePage };

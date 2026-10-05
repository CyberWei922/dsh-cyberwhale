'use strict';
const React = require('react');
const { Button } = require('@deepseek-ai/dsh-client-ui-primitives');
const { normalizeAppearance } = require('../lib/appearance-model.cjs');
const h = React.createElement;

// Keep family names, not one duplicate entry for every weight/style. Quoting
// preserves spaces, commas and CSS keywords as one literal installed family.
function fontOptions(faces) {
  const families = new Set();
  for (const face of faces) {
    if (typeof face?.family !== 'string') continue;
    const name = face.family.trim();
    const value = JSON.stringify(name);
    if (name && normalizeAppearance({ uiFont: value }).uiFont === value) families.add(name);
  }
  return [...families].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(name => ({ name, value: JSON.stringify(name) }));
}
function fontLabel(value) {
  try { const name = JSON.parse(value); if (typeof name === 'string') return name; } catch {}
  return value;
}
function fontError(error) {
  if (error?.name === 'NotAllowedError') return '未获得读取字体的权限，可重试或手动输入。';
  if (error?.name === 'SecurityError') return '当前窗口暂不允许读取字体，可重试或手动输入。';
  return '读取系统字体失败，可重试或手动输入。';
}
function FontSettings({ config, edit, disabled }) {
  const [catalog, setCatalog] = React.useState(null), [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const revision = React.useRef(0), pending = React.useRef(false), attempted = React.useRef(false);
  React.useEffect(() => () => { revision.current++; pending.current = false; attempted.current = false; }, []);
  React.useEffect(() => {
    if (disabled || attempted.current) return;
    attempted.current = true;
    void readFonts();
  }, [disabled]);
  async function readFonts() {
    if (disabled || pending.current) return;
    const request = ++revision.current;
    pending.current = true; setBusy(true); setError(null);
    try {
      if (typeof globalThis.queryLocalFonts !== 'function') throw new Error('unsupported');
      // Harness grants local-font access in its main window. Other environments
      // may require a user gesture; expose retry only after an automatic failure.
      // Never read fonts from a remote Harness host instead of this computer.
      const faces = await globalThis.queryLocalFonts();
      const options = fontOptions(faces);
      if (request !== revision.current) return;
      if (!options.length) throw new Error('empty');
      setCatalog(options);
    } catch (e) {
      if (request === revision.current) setError(e?.message === 'unsupported'
        ? '当前环境不支持读取系统字体，可手动输入已安装字体的名称。' : fontError(e));
    } finally {
      if (request === revision.current) { pending.current = false; setBusy(false); }
    }
  }
  const options = catalog ?? [];
  return h('div', { className: 'dsh-appearance-fonts' },
    ...[['uiFont', '界面字体'], ['codeFont', '代码字体']].map(([key, title]) => {
      const current = config[key], match = options.find(font => font.value === current || font.name === current);
      return h('div', { key, className: 'dsh-appearance-row' },
        h('div', { className: 'dsh-appearance-label' }, title),
        h('div', { className: 'dsh-appearance-control dsh-appearance-font-control' },
          h('select', { className: 'dsh-appearance-input', 'aria-label': title, 'aria-busy': busy, value: match?.value ?? current, disabled,
            onChange: e => edit({ [key]: e.target.value }) },
          h('option', { value: '' }, '系统默认'),
          current && !match && h('option', { value: current }, `${fontLabel(current)}（当前）`),
          ...options.map(font => h('option', { key: font.value, value: font.value }, font.name))),
          error && h('input', { className: 'dsh-appearance-input', 'aria-label': `手动输入${title}`, placeholder: '输入已安装字体名称', value: current, disabled,
            onChange: e => edit({ [key]: e.target.value }) })));
    }),
    error && h('div', null, h('p', { className: 'dsh-appearance-error', role: 'alert' }, error),
      h(Button, { disabled: disabled || busy, onClick: readFonts }, '重新读取')));
}
module.exports = { FontSettings, fontOptions, fontLabel, fontError };

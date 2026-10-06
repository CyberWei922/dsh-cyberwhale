'use strict';
const React = require('react');
const h = React.createElement;

/**
 * WinUI 3 风格的 ComboBox（自绘，仅用于 Windows 面板）。
 *
 * 原生 <select> 的字段与弹层无法做出 Windows 11 设置里的观感：点开后是
 * 圆角弹层、当前项带主题强调色短竖条、悬停/键盘高亮只加极淡底色。这里用
 * 按钮 + listbox 实现，保留 combobox/listbox ARIA 语义与键盘操作：
 * Enter/Space/ArrowDown 打开；ArrowUp/Down/Home/End 移动；Enter/Space 选中；
 * Esc 关闭；Tab 关闭但不拦截；外部指针按下自动收起。焦点始终留在触发按钮上，
 * 通过 aria-activedescendant 指向高亮项。
 */
function clampIndex(index, length) {
  return Math.max(0, Math.min(length - 1, index));
}

function WinComboBox({ id, label, value, disabled, busy, options, onChange }) {
  const [open, setOpen] = React.useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [active, setActive] = React.useState(selectedIndex);
  const root = React.useRef(null);
  const trigger = React.useRef(null);
  React.useEffect(() => { if (open) setActive(selectedIndex); }, [open, selectedIndex]);
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => { if (root.current && !root.current.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);
  const listId = `${id ?? 'dsh-win-combo'}-listbox`;
  const optionId = (index) => `${listId}-option-${index}`;
  const commit = (index) => {
    setOpen(false);
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    trigger.current?.focus();
  };
  const onKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((index) => clampIndex(index + (event.key === 'ArrowDown' ? 1 : -1), options.length));
    } else if ((event.key === 'Home' || event.key === 'End') && open) {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (open) commit(active);
      else setOpen(true);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab') setOpen(false);
  };
  const selected = options[selectedIndex];
  return h('span', { className: 'dsh-win-combo', ref: root },
    h('button', {
      type: 'button', id, ref: trigger, className: 'dsh-win-combo-trigger', role: 'combobox',
      'aria-label': label, 'aria-expanded': open, 'aria-controls': listId,
      'aria-activedescendant': open ? optionId(active) : undefined,
      'aria-busy': busy === true ? true : undefined,
      disabled,
      onClick: () => setOpen((value2) => !value2),
      onKeyDown,
    },
      h('span', { className: 'dsh-win-combo-value' }, selected?.label ?? ''),
      h('svg', { className: 'dsh-win-combo-chevron', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
        h('path', { d: 'M1.5 4L6 8.5L10.5 4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2 }))),
    open && h('div', { className: 'dsh-win-combo-popup', role: 'listbox', id: listId, 'aria-label': label },
      options.map((option, index) => h('div', {
        key: option.value,
        id: optionId(index),
        role: 'option',
        'aria-selected': index === selectedIndex,
        'data-active': index === active ? '' : undefined,
        className: 'dsh-win-combo-option',
        onMouseMove: () => setActive(index),
        onMouseDown: (event) => event.preventDefault(),
        onClick: () => commit(index),
      }, option.label))));
}

module.exports = { WinComboBox };

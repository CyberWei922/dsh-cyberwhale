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
 * 通过 aria-activedescendant 指向高亮项。Popover 的 top layer 绕过卡片裁剪，
 * 仍保留 DOM 祖先和平台 CSS 作用域；不依赖宿主额外提供 react-dom。
 */
function clampIndex(index, length) {
  return Math.max(0, Math.min(length - 1, index));
}
function revealOption(list, index) {
  const item = list?.children[index];
  if (!item) return;
  // Scroll only the list: scrollIntoView can also move the settings page.
  if (item.offsetTop < list.scrollTop + 4) list.scrollTop = item.offsetTop - 4;
  else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight - 4) {
    list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight + 4;
  }
}

function WinComboBox({ id, label, value, disabled, busy, options, onChange }) {
  const generatedId = React.useId();
  const [open, setOpen] = React.useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [active, setActive] = React.useState(selectedIndex);
  const activeIndex = React.useRef(active);
  activeIndex.current = active;
  const root = React.useRef(null);
  const trigger = React.useRef(null);
  const popup = React.useRef(null);
  const scrollActive = React.useRef(true);
  const search = React.useRef({ text: '', time: 0 });
  const supportsPopover = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
  React.useEffect(() => { if (open) { scrollActive.current = true; setActive(selectedIndex); } }, [selectedIndex]);
  React.useEffect(() => { setActive(index => clampIndex(index, options.length)); }, [options.length]);
  React.useLayoutEffect(() => {
    if (!open || !supportsPopover) return undefined;
    if (disabled || !options.length) { setOpen(false); return undefined; }
    const list = popup.current, button = trigger.current;
    if (!list || !button) return undefined;
    const panel = button.closest('[data-shortcut-modal="settings"]');
    const position = () => {
      const anchor = button.getBoundingClientRect();
      const frame = panel?.getBoundingClientRect();
      const left = Math.max(8, (frame?.left ?? 0) + 8);
      const right = Math.min(window.innerWidth - 8, (frame?.right ?? window.innerWidth) - 8);
      const top = Math.max(8, (frame?.top ?? 0) + 8);
      const bottom = Math.min(window.innerHeight - 8, (frame?.bottom ?? window.innerHeight) - 8);
      if (anchor.bottom < top || anchor.top > bottom || right <= left) { setOpen(false); return; }
      const desired = Math.min(226, options.length * 36 + 10);
      const below = Math.max(0, bottom - anchor.bottom - 4);
      const above = Math.max(0, anchor.top - top - 4);
      const down = below >= desired || below >= above;
      const available = down ? below : above;
      const height = Math.min(desired, 10 + Math.floor(Math.max(0, available - 10) / 36) * 36);
      if (height < 46) { setOpen(false); return; }
      const width = Math.min(Math.max(anchor.width, 220), right - left);
      Object.assign(list.style, {
        width: `${width}px`, maxHeight: `${height}px`,
        left: `${Math.max(left, Math.min(anchor.left, right - width))}px`,
        top: `${down ? anchor.bottom + 4 : anchor.top - height - 4}px`,
      });
      list.dataset.placement = down ? 'below' : 'above';
      if (scrollActive.current) revealOption(list, activeIndex.current);
    };
    list.showPopover();
    position();
    button.focus({ preventScroll: true });
    const onScroll = (event) => { if (!list.contains(event.target)) position(); };
    window.addEventListener('resize', position);
    document.addEventListener('scroll', onScroll, true);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(position) : null;
    observer?.observe(button);
    if (panel) observer?.observe(panel);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', onScroll, true);
      observer?.disconnect();
      if (list.isConnected && list.matches(':popover-open')) list.hidePopover();
    };
  }, [open, disabled, options.length, supportsPopover]);
  React.useLayoutEffect(() => {
    if (!open || !scrollActive.current) return;
    revealOption(popup.current, active);
  }, [open, active]);
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => { if (root.current && !root.current.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);
  const triggerId = id ?? `dsh-win-combo-${generatedId}`;
  const listId = `${triggerId}-listbox`;
  const optionId = (index) => `${listId}-option-${index}`;
  const commit = (index) => {
    setOpen(false);
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    trigger.current?.focus({ preventScroll: true });
  };
  const toggle = () => {
    scrollActive.current = true;
    search.current = { text: '', time: 0 };
    if (!open) setActive(selectedIndex);
    setOpen(!open);
  };
  const onKeyDown = (event) => {
    if (disabled || !options.length) return;
    scrollActive.current = true;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!open) toggle();
      else setActive((index) => clampIndex(index + (event.key === 'ArrowDown' ? 1 : -1), options.length));
    } else if ((event.key === 'Home' || event.key === 'End') && open) {
      event.preventDefault();
      event.stopPropagation();
      setActive(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      event.stopPropagation();
      if (open) commit(active);
      else toggle();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') setOpen(false);
    else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const time = Date.now(), key = event.key.toLocaleLowerCase();
      const text = time - search.current.time < 700 ? search.current.text + key : key;
      search.current = { text, time };
      const prefix = [...text].every(char => char === key) ? key : text;
      const start = open ? active + 1 : selectedIndex;
      const index = options.findIndex((_, offset) => options[(start + offset) % options.length].label.toLocaleLowerCase().startsWith(prefix));
      if (index >= 0) {
        event.preventDefault();
        event.stopPropagation();
        setActive((start + index) % options.length);
        setOpen(true);
      }
    }
  };
  const selected = options[selectedIndex];
  // Older web clients keep a usable system select instead of a clipped flyout.
  if (!supportsPopover) return h('select', {
    id: triggerId, className: 'dsh-appearance-input', 'aria-label': label,
    'aria-busy': busy === true ? true : undefined, value, disabled: disabled || !options.length,
    onChange: (event) => onChange(event.target.value),
  }, options.map(option => h('option', { key: option.value, value: option.value }, option.label)));
  return h('span', { className: 'dsh-win-combo', ref: root },
    h('button', {
      type: 'button', id: triggerId, ref: trigger, className: 'dsh-win-combo-trigger', role: 'combobox',
      'aria-label': label, 'aria-expanded': open, 'aria-controls': listId,
      'aria-haspopup': 'listbox',
      'aria-activedescendant': open ? optionId(active) : undefined,
      'aria-busy': busy === true ? true : undefined,
      disabled: disabled || !options.length,
      onClick: toggle,
      onKeyDown,
    },
      h('span', { className: 'dsh-win-combo-value' }, selected?.label ?? ''),
      h('svg', { className: 'dsh-win-combo-chevron', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
        h('path', { d: 'M1.5 4L6 8.5L10.5 4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2 }))),
    open && h('div', { ref: popup, popover: 'manual', className: 'dsh-win-combo-popup', role: 'listbox', id: listId, 'aria-label': label,
      onWheel: (event) => event.stopPropagation(),
    },
      options.map((option, index) => h('div', {
        key: option.value,
        id: optionId(index),
        role: 'option',
        'aria-selected': index === selectedIndex,
        'data-active': index === active ? '' : undefined,
        className: 'dsh-win-combo-option',
        onMouseMove: () => { scrollActive.current = false; setActive(index); },
        onMouseDown: (event) => event.preventDefault(),
        onClick: (event) => { event.preventDefault(); event.stopPropagation(); commit(index); },
      }, option.label))));
}

module.exports = { WinComboBox };

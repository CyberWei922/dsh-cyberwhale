'use strict';
const React = require('react');
const { SegmentedControl } = require('@deepseek-ai/dsh-client-ui-primitives');
const { WinComboBox } = require('./win-combobox.js');
const h = React.createElement;

/**
 * 平台分发的选择控件。
 *
 * Windows 上「美化」生效时（body 带 data-whale-settings-platform="windows"）
 * 用自绘的 WinUI 3 ComboBox：点开是圆角弹层、当前项带强调色短竖条；其余情况
 * （macOS、未启用美化、未知平台）保持原有控件 —— 下拉框仍是插件原样的
 * <select class="dsh-appearance-input">，分段选择仍是官方 SegmentedControl，
 * macOS 的既定视觉不变。
 */
function windowsClient() {
  return typeof document !== 'undefined'
    && document.body?.getAttribute('data-whale-settings-platform') === 'windows';
}

function PlatformSelect(props) {
  if (windowsClient()) {
    return h(WinComboBox, {
      id: props.id, label: props.label, value: props.value, disabled: props.disabled,
      busy: props.busy, options: props.options, onChange: props.onChange,
    });
  }
  return h('select', {
    id: props.id,
    className: props.className ?? 'dsh-appearance-input',
    'aria-label': props.label,
    'aria-busy': props.busy,
    value: props.value,
    disabled: props.disabled,
    onChange: (event) => props.onChange(event.target.value),
  }, (props.options ?? []).map((option) => h('option', { key: option.value, value: option.value }, option.label)));
}

function PlatformSegmentedChoice(props) {
  if (windowsClient()) {
    return h(WinComboBox, {
      id: props.id, label: props.label, value: props.value, disabled: props.disabled,
      busy: props.busy, options: props.options, onChange: props.onChange,
    });
  }
  return h(SegmentedControl, props);
}

module.exports = { PlatformSelect, PlatformSegmentedChoice, PlatformScaleChoice: PlatformSegmentedChoice };

'use strict';
const path = require('node:path');

function loadNativeGlass(platform = process.platform, arch = process.arch) {
  if (platform !== 'darwin') return { reason: 'Apple 原生液态玻璃仅支持 macOS 26 及以上，当前使用普通气泡。' };
  try {
    const addon = require(path.join(__dirname, 'native/prebuilds', `darwin-${arch}.node`));
    if (!addon.supported()) return { reason: '需要 macOS 26 或更新版本，当前使用普通气泡。' };
    return { addon };
  } catch { return { reason: '原生玻璃组件不可用，当前使用普通气泡。' }; }
}

function createBubbleGlass(win, { native = loadNativeGlass(), isDark, publish }) {
  const { addon } = native;
  let requested = false, bubbles = true, active = false, disposed = false, frame = null, lastStatus = '';
  let failure = null;
  function status() {
    const reduced = !!addon?.reducedTransparency();
    return { supported: !!addon, active, reason: native.reason ?? failure
      ?? (reduced ? '系统已降低透明度或增强对比度，当前使用普通气泡。' : null) };
  }
  function emit(force = false) {
    const next = status(), key = JSON.stringify(next);
    if (force || key !== lastStatus) { lastStatus = key; publish(next); }
  }
  function paint() {
    if (active && frame) {
      try {
        if (addon.update(frame.left, frame.top, frame.width, frame.height, frame.visible, isDark())) return;
      } catch { /* optional material must not stop the pet */ }
      try { addon.detach(); } catch { /* already unavailable */ }
      active = false; failure = '原生玻璃绘制失败，已恢复普通气泡。'; emit();
    }
  }
  const api = {
    configure(nextRequested = requested, nextBubbles = bubbles, force = false) {
      if (disposed) return;
      requested = nextRequested === true; bubbles = nextBubbles !== false;
      const next = !!(addon && requested && bubbles && !addon.reducedTransparency());
      try {
        if (next && !active) {
          active = addon.attach(win.getNativeWindowHandle());
          frame = null; // Wait for the renderer's current rectangle before revealing a new seat.
          failure = active ? null : '原生玻璃初始化失败，当前使用普通气泡。';
        } else if (!next) { if (active) addon.detach(); active = false; failure = null; }
        paint(); emit(force);
      } catch { addon?.detach(); active = false; failure = '原生玻璃不可用，已恢复普通气泡。'; emit(force); }
    },
    update(value) {
      if (disposed || !value || typeof value !== 'object') return;
      const { left, top, width, height } = value;
      if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
      const [maxWidth, maxHeight] = win.getContentSize();
      // Only the helper's bubble rectangle is accepted, never arbitrary native handles.
      if (left < 0 || top < 0 || left + width > maxWidth + 1 || top + height > maxHeight + 1) return;
      frame = { left, top, width, height, visible: value.visible === true };
      paint();
    },
    snapshot: () => ({ ...status(), frame: active ? addon.snapshot?.() ?? null : null }),
    dispose() { if (disposed) return; disposed = true; try { addon?.detach(); } catch { /* shutting down */ } active = false; frame = null; },
  };
  return api;
}
module.exports = { loadNativeGlass, createBubbleGlass };

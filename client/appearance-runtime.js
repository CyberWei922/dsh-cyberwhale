'use strict';
const { normalizeAppearance, tokensFor, GRADIENTS, palette, mix, readable, contrast } = require('../lib/appearance-model.cjs');

function findWallpaperFrames(doc) {
  // The published root outlet contains the three-column frame. Its overlay seat
  // identifies that frame without relying on hashed classes or replacing slots.
  // Never attach anything to a conversation, editor, or the shared overlay seat.
  return new Set([...doc.querySelectorAll('[data-slot="root"] > * > [data-shell-overlay]')]
    .map(seat => seat.parentElement)
    .filter(frame => !frame.hasAttribute('contenteditable') && frame.querySelector('[data-slot="main"]')));
}

function createAppearanceController(ctx, call) {
  let saved = null, draft = null, disposed = false, busy = false, recovering = false, loading = true, error = null;
  let tokenDisposer = null, tokenKey = '', imageId = null, imageURL = null, imageTask = 0;
  const layers = new Map();
  let timer = null, observer = null, raf = null;
  const listeners = new Set();
  const hasTheme = typeof ctx.theme?.overrideTokens === 'function';
  const state = () => ({ config: draft ?? saved?.config ?? normalizeAppearance(), dirty: draft !== null, busy, recovering, loading, error,
    warning: saved?.warning, persisted: saved?.persisted === true, available: hasTheme, theme: hasTheme ? ctx.theme.getTheme() : null });
  const emit = () => { if (!disposed) for (const fn of listeners) fn(); };
  const current = () => draft ?? saved?.config;
  function removeLayers() {
    for (const [frame, layer] of layers) { layer.remove(); frame.removeAttribute('data-whale-wallpaper-frame'); }
    layers.clear();
  }
  function paintBackground() {
    if (disposed || !document.body) return;
    const config = current();
    const reduced = config?.reduceTransparency || window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches;
    document.body.toggleAttribute('data-whale-glass-input', !!(config?.enabled && config.glassInput && !reduced));
    // macOS 观感的设置面板同样跟随「美化」总开关，并在用户要求降低透明度时回落到官方原样。
    document.body.toggleAttribute('data-whale-mac-settings', !!(config?.enabled && !reduced));
    const scheme = ctx.theme?.getTheme().active.colorScheme ?? 'light';
    const p = palette(config?.[scheme] ?? normalizeAppearance()[scheme]);
    const worst = mix(p.bg, contrast(p.fg, '#000000') > contrast(p.bg, '#000000') ? '#FFFFFF' : '#000000', 0.16);
    document.body.style.setProperty('--whale-glass-text', readable(p.fg, worst));
    const active = config?.enabled && config.background !== 'none' && !reduced
      && (config.background !== 'image' || imageURL !== null);
    if (!active) { removeLayers(); return; }
    const next = findWallpaperFrames(document);
    for (const [frame, layer] of layers) if (!next.has(frame)) {
      layer.remove(); frame.removeAttribute('data-whale-wallpaper-frame'); layers.delete(frame);
    }
    for (const frame of next) {
      let layer = layers.get(frame);
      if (!layer) {
        layer = document.createElement('div'); layer.className = 'dsh-whale-wallpaper'; layer.setAttribute('aria-hidden', 'true');
        layers.set(frame, layer);
      }
      if (layer.parentElement !== frame) frame.prepend(layer);
      frame.setAttribute('data-whale-wallpaper-frame', '');
      const isImage = config.background === 'image';
      const background = isImage ? `url("${imageURL}") ${p.bg}` : GRADIENTS[config.gradient][scheme];
      // Mask is a separate layer in the same background; blur never touches text.
      const maskColor = `${p.bg}${Math.round(config.mask * 2.55).toString(16).padStart(2, '0')}`;
      // Presets include a solid base color. Only the background shorthand can
      // accept both that color and the gradients; background-image rejects it.
      layer.style.background = `linear-gradient(${maskColor}, ${maskColor}), ${background}`;
      layer.style.backgroundRepeat = 'no-repeat';
      layer.style.backgroundSize = isImage ? config.imageFit : 'auto';
      layer.style.backgroundPosition = isImage ? config.imagePosition : 'center';
      layer.style.filter = isImage && config.blur ? `blur(${config.blur}px)` : 'none';
    }
  }
  function schedulePaint() {
    if (disposed || raf !== null) return;
    raf = requestAnimationFrame(() => { raf = null; paintBackground(); });
  }
  function applyConfig() {
    const config = current();
    if (!config || !hasTheme || disposed) return;
    const key = JSON.stringify([config.enabled, config.light, config.dark, config.uiFont, config.codeFont]);
    if (key !== tokenKey) {
      tokenKey = key;
      if (config.enabled) {
        const previous = tokenDisposer;
        tokenDisposer = ctx.theme.overrideTokens('dsh-cyberwhale.appearance', tokensFor(config));
        previous?.();
      } else { tokenDisposer?.(); tokenDisposer = null; }
    }
    const nextImage = config.background === 'image' ? config.wallpaper?.id ?? null : null;
    if (nextImage !== imageId) {
      imageId = nextImage;
      const task = ++imageTask;
      if (imageURL) URL.revokeObjectURL(imageURL);
      imageURL = null;
      if (nextImage) void (async () => {
        const response = await fetch(`deskpet/appearance/wallpaper/${nextImage}`);
        if (!response.ok) throw new Error('背景图片读取失败，请重新上传');
        const blob = await response.blob();
        if (disposed || task !== imageTask) return;
        imageURL = URL.createObjectURL(blob); paintBackground();
      })().catch(e => { if (!disposed && task === imageTask) { error = e.message; emit(); } });
    }
    paintBackground(); emit();
  }
  async function refresh() {
    if (disposed || busy) return;
    const revision = saved?.revision;
    try {
      const next = await call('getAppearance');
      // A poll started before an edit must not replace its pending write or ack.
      if (disposed || busy || draft || saved?.revision !== revision) return;
      if (!next?.config || typeof next.revision !== 'string') throw new Error('主题配置响应无效');
      if (saved?.revision !== next.revision) {
        saved = { ...next, config: normalizeAppearance(next.config) }; error = null; applyConfig();
      }
      loading = false; emit();
    } catch (e) { if (!disposed && !busy && !draft && saved?.revision === revision) { error = e.message; loading = false; emit(); } }
  }
  async function persist() {
    if (disposed || busy || !draft || !saved) return;
    busy = true; emit();
    try {
      // Keep controls responsive. Coalesce edits made during each write and use
      // its acknowledged revision for the next one, never discarding newer edits.
      while (draft && !disposed) {
        const writing = draft;
        const next = await call('updateAppearance', { config: writing, revision: saved.revision });
        if (disposed) return;
        if (!next?.config || typeof next.revision !== 'string') throw new Error('主题配置响应无效');
        saved = { ...next, config: normalizeAppearance(next.config) };
        if (draft === writing) draft = null;
        applyConfig();
      }
    } catch (e) {
      if (!disposed) {
        recovering = true; draft = null; error = `未能保存此次修改：${e.message}`; applyConfig();
        // Roll back failed changes and read the current committed configuration,
        // including another window's changes. Never retry a stale full snapshot.
        try {
          const next = await call('getAppearance');
          if (!disposed && next?.config && typeof next.revision === 'string') {
            saved = { ...next, config: normalizeAppearance(next.config) }; applyConfig();
          }
        } catch { /* Keep the last confirmed configuration and the save error. */ }
      }
    } finally { busy = false; recovering = false; emit(); }
  }
  const controller = {
    getState: state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    edit(patch) {
      if (disposed || loading || recovering || !saved) return;
      draft = normalizeAppearance({ ...current(), ...patch }); error = null; applyConfig(); void persist();
    },
    async upload(dataURL, name) { return call('uploadWallpaper', { dataURL, name }); },
    async setMode(value) { try { await ctx.theme.setTheme(value); } catch (e) { error = e.message; emit(); } },
    async setFontSize(value) { try { await ctx.theme.setFontSize(value); } catch (e) { error = e.message; emit(); } },
    dispose() {
      disposed = true; clearInterval(timer); if (raf !== null) cancelAnimationFrame(raf);
      observer?.disconnect(); tokenDisposer?.(); removeLayers(); ++imageTask;
      if (imageURL) URL.revokeObjectURL(imageURL);
      document.body?.removeAttribute('data-whale-glass-input'); document.body?.removeAttribute('data-whale-mac-settings'); document.body?.style.removeProperty('--whale-glass-text'); listeners.clear();
    },
  };
  if (hasTheme && document.body) {
    observer = new MutationObserver(records => {
      // Viewport CSS owns geometry: sidebar width/animation never changes it.
      // Reconcile only when shell outlets or our decorative node change.
      const selector = '[data-slot="root"], [data-slot="main"], [data-slot="sidebar"], [data-shell-overlay], .dsh-whale-wallpaper';
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))))) schedulePaint();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.on('theme/change', () => { paintBackground(); emit(); });
    const media = window.matchMedia?.('(prefers-reduced-transparency: reduce)');
    media?.addEventListener('change', schedulePaint);
    ctx.effect(() => () => media?.removeEventListener('change', schedulePaint));
    timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 10000);
    void refresh();
  }
  return controller;
}
module.exports = { createAppearanceController, findWallpaperFrames };

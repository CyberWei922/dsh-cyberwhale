'use strict';

/**
 * Windows settings layer, written against Microsoft's own Fluent tokens.
 *
 * The fill/stroke/focus numbers are the exact WinUI 3 semantic values
 * transcribed from `microsoft-ui-xaml`'s Common_themeresources_any.xaml
 * (cross-checked against the FluentKit CSS token layer and fluent-svelte's
 * control ports): light uses black/white alphas, dark uses white alphas, and
 * the two are switched by data-ds-dark-theme, the same way WinUI swaps its
 * Light/Default theme dictionaries. Text colors and accents keep the plugin's
 * shared --dsw-* tokens so all 27 theme presets stay readable.
 *
 * Key sources:
 *   - microsoft-ui-xaml Common_themeresources_any.xaml (Text/Control/Subtle/
 *     ControlAlt/ControlStrong fills, strokes, focus, dividers, layer/card)
 *   - fluent-svelte / FluentKit ports (ComboBox trigger + item anatomy,
 *     ToggleSwitch geometry, NavigationView item + selection indicator)
 *   - WinUI-Gallery spacing/geometry pages (4px grid, 4/8/999 corner radii)
 *
 * Scope every rule to the Windows gate; never match a macOS document.
 * No CSS Module hash names, no React node replacement, keyboard/ARIA intact.
 */
const PANEL = 'body[data-whale-settings-platform="windows"] [data-shortcut-modal="settings"]';
const DARK = `body[data-ds-dark-theme][data-whale-settings-platform="windows"] [data-shortcut-modal="settings"]`;
const REDUCED = `body[data-whale-settings-platform="windows"][data-whale-settings-reduced] [data-shortcut-modal="settings"]`;
// The official General page renders one switch row per preference; its section
// wrapper is the only direct child of the options column that contains one.
const GENERAL = `${PANEL} > nav + div > div + div > div:has(> div > [role="switch"])`;
const ROWS = [
  [`${PANEL} :is(.dsh-appearance-row, .dsh-whale-row)`, 'div:is(.dsh-appearance-row, .dsh-whale-row)'],
  [`${GENERAL} > div`, 'div'],
];
// Flat list rows (the Windows 11 Sound-page pattern): transparent fill, one
// divider between rows, hover/press only wash the row with the official
// SubtleFillColor alphas. Nothing lifts, no card fill, no border.
const rowRules = ROWS.map(([row, next]) => `
${row} {
  box-sizing:border-box;
  position:relative;
  min-height:64px;
  padding:12px 16px;
  gap:24px;
  margin:0;
  border:0;
  border-radius:0;
  background-color:transparent;
  transition:background-color 150ms cubic-bezier(.33,0,.67,1);
}
${row}:hover {
  background-color:var(--whale-win-subtle-secondary);
}
${row}:active {
  background-color:var(--whale-win-subtle-tertiary);
}
${row}:has(+ ${next}) {
  background-image:linear-gradient(var(--whale-win-divider),var(--whale-win-divider));
  background-position:left bottom;
  background-size:100% 1px;
  background-repeat:no-repeat;
}
`).join('\n');

const CSS = `
${PANEL} {
  /* WinUI 3 Light theme dictionary (exact alphas from Common_themeresources_any.xaml). */
  --whale-win-text-secondary:rgba(0,0,0,.6196);
  --whale-win-text-tertiary:rgba(0,0,0,.4471);
  --whale-win-text-disabled:rgba(0,0,0,.3608);
  --whale-win-control-fill:rgba(255,255,255,.702);
  --whale-win-control-fill-hover:rgba(249,249,249,.502);
  --whale-win-control-fill-pressed:rgba(249,249,249,.302);
  --whale-win-control-stroke:rgba(0,0,0,.0588);
  --whale-win-control-stroke-bottom:rgba(0,0,0,.1608);
  --whale-win-subtle-secondary:rgba(0,0,0,.0353);
  --whale-win-subtle-tertiary:rgba(0,0,0,.0235);
  --whale-win-divider:rgba(0,0,0,.0588);
  --whale-win-alt-off:rgba(0,0,0,.0241);
  --whale-win-alt-off-hover:rgba(0,0,0,.0578);
  --whale-win-alt-off-pressed:rgba(0,0,0,.0924);
  --whale-win-strong-stroke:rgba(0,0,0,.4458);
  --whale-win-strong-stroke-disabled:rgba(0,0,0,.2169);
  --whale-win-accent-disabled:rgba(0,0,0,.2157);
  --whale-win-layer:rgba(255,255,255,.5);
  --whale-win-card:rgba(255,255,255,.7);
  --whale-win-acrylic:#fafafa;
  --whale-win-flyout-border:rgba(0,0,0,.0578);
  --whale-win-surface-stroke:rgba(0,0,0,.0578);
  --whale-win-focus-outer:rgba(0,0,0,.8941);
  --whale-win-focus-inner:rgba(255,255,255,.702);
  --whale-win-shadow:0 32px 64px rgba(0,0,0,.24);
  --whale-win-popup-shadow:0 2px 4px rgba(0,0,0,.12),0 8px 16px rgba(0,0,0,.14);
  /* Mica approximation: CSS cannot sample the desktop, so the panel keeps a
   * flat themed base with a whisper of the theme accent (documented deviation). */
  --whale-win-mica:color-mix(in srgb,var(--dsw-alias-brand-primary) 3%,var(--dsw-alias-bg-base));
  width:960px;
  max-width:calc(100vw - 48px);
  height:min(700px,calc(100dvh - 48px));
  border:1px solid var(--whale-win-surface-stroke);
  border-radius:8px;
  corner-shape:round;
  background:var(--whale-win-mica);
  color:var(--dsw-alias-label-primary);
  font-family:var(--dsw-font-family);
  font-size:14px;
  line-height:20px;
  box-shadow:var(--whale-win-shadow);
}
${DARK} {
  /* WinUI 3 dark is the "Default" theme dictionary: white alphas over dark Mica. */
  --whale-win-text-secondary:rgba(255,255,255,.7725);
  --whale-win-text-tertiary:rgba(255,255,255,.5294);
  --whale-win-text-disabled:rgba(255,255,255,.3647);
  --whale-win-control-fill:rgba(255,255,255,.0588);
  --whale-win-control-fill-hover:rgba(255,255,255,.0824);
  --whale-win-control-fill-pressed:rgba(255,255,255,.0314);
  --whale-win-control-stroke:rgba(255,255,255,.0706);
  --whale-win-control-stroke-bottom:rgba(255,255,255,.0941);
  --whale-win-subtle-secondary:rgba(255,255,255,.0588);
  --whale-win-subtle-tertiary:rgba(255,255,255,.0392);
  --whale-win-divider:rgba(255,255,255,.0824);
  --whale-win-alt-off:rgba(0,0,0,.1);
  --whale-win-alt-off-hover:rgba(255,255,255,.042);
  --whale-win-alt-off-pressed:rgba(255,255,255,.07);
  --whale-win-strong-stroke:rgba(255,255,255,.5442);
  --whale-win-strong-stroke-disabled:rgba(255,255,255,.1581);
  --whale-win-accent-disabled:rgba(255,255,255,.1569);
  --whale-win-layer:rgba(255,255,255,.0538);
  --whale-win-card:rgba(255,255,255,.0538);
  --whale-win-acrylic:#2c2c2c;
  --whale-win-flyout-border:rgba(0,0,0,.2);
  --whale-win-surface-stroke:rgba(255,255,255,.0578);
  --whale-win-focus-outer:#ffffff;
  --whale-win-focus-inner:rgba(0,0,0,.702);
  --whale-win-shadow:0 32px 64px rgba(0,0,0,.4);
  --whale-win-popup-shadow:0 8px 16px rgba(0,0,0,.44);
}

/* ── NavigationView ───────────────────────────────────────────────────────
 * FluentKit NavigationViewItem port: 36px rows on a 4px corner radius, hover
 * and selection both SubtleFillColorSecondary, press Tertiary, selection text
 * semibold, 3×16px accent indicator at the leading edge.  The pane keeps the
 * Mica base; the content column takes LayerFillColorDefault, exactly like
 * NavigationViewContentBackground. */
${PANEL} > nav {
  width:200px;
  min-width:0;
  padding:20px 10px 12px;
  gap:18px;
  background:transparent;
  border-right:1px solid var(--whale-win-divider);
}
${PANEL} > nav > div:first-child {
  padding:0 8px;
  font-size:16px;
  line-height:22px;
  font-weight:600;
}
${PANEL} > nav > div + div {gap:2px;min-height:0}
${PANEL} nav button {
  box-sizing:border-box;
  position:relative;
  height:36px;
  min-height:36px;
  padding:0 8px;
  gap:8px;
  border-radius:4px;
  font-size:14px;
  line-height:20px;
  font-weight:400;
  transition:background-color 150ms cubic-bezier(.33,0,.67,1);
}
${PANEL} nav button:hover {background:var(--whale-win-subtle-secondary)}
${PANEL} nav button:active {background:var(--whale-win-subtle-tertiary)}
${PANEL} nav button[aria-current="true"] {
  background:var(--whale-win-subtle-secondary);
  font-weight:600;
}
${PANEL} nav button[aria-current="true"]:hover {background:var(--whale-win-subtle-tertiary)}
${PANEL} nav button[aria-current="true"]::before {
  content:"";
  position:absolute;
  left:0;
  top:50%;
  width:3px;
  height:16px;
  margin-top:-8px;
  border-radius:999px;
  background:var(--dsw-alias-brand-primary);
}
${PANEL} nav button > svg {color:var(--whale-win-text-secondary)}
${PANEL} nav button[aria-current="true"] > svg {color:var(--dsw-alias-label-primary)}

/* ── Page chrome ──────────────────────────────────────────────────────────
 * Content sits on LayerFillColorDefault; the heading uses the WinUI subtitle
 * ramp (20/28 semibold) and copies the active navigation label. */
${PANEL} > nav + div {background:var(--whale-win-layer)}
${PANEL} > nav + div > div:first-child {
  height:64px;
  align-items:center;
  padding:16px 20px;
}
${PANEL} [data-whale-settings-title]::before {
  content:attr(data-whale-settings-title);
  color:var(--dsw-alias-label-primary);
  font-size:20px;
  line-height:28px;
  font-weight:600;
}
${PANEL} > nav + div > div:first-child > button {
  border-radius:4px;
  background:transparent;
  color:var(--whale-win-text-secondary);
}
${PANEL} > nav + div > div:first-child > button:hover {background:var(--whale-win-subtle-secondary)}
${PANEL} > nav + div > div + div {padding:0 20px 24px;scrollbar-gutter:stable}

${rowRules}
/* Typography: Body 14/20, Caption 12/16, subtitle already on the heading. */
${PANEL} :is(.dsh-whale-title,.dsh-appearance-label),
${GENERAL} > div > div:first-child > div:first-child {font-size:14px;line-height:20px;font-weight:400}
${PANEL} :is(.dsh-whale-description,.dsh-appearance-description) {font-size:12px;line-height:16px;margin-top:2px;color:var(--whale-win-text-secondary)}
${PANEL} :is(.dsh-whale-text,.dsh-appearance-row > div:first-child) {min-width:0}
${PANEL} label[for] {font-size:14px;font-weight:400}
${PANEL} .dsh-appearance-intro {margin:0 0 8px;font-size:12px;line-height:16px;color:var(--whale-win-text-secondary)}
${PANEL} .dsh-appearance-section {margin-top:24px}
${PANEL} .dsh-appearance-section > h3 {margin:0 4px 8px;font-size:14px;line-height:20px;font-weight:600}
${PANEL} .dsh-appearance-section > p {margin:0 4px 8px}
${PANEL} .dsh-appearance-section > .dsh-appearance-row:first-of-type,
${PANEL} .dsh-appearance-fonts > .dsh-appearance-row:first-child,
${PANEL} .dsh-appearance-background-settings > .dsh-appearance-row:first-child {margin-top:0}
${PANEL} .dsh-appearance-cards {gap:12px;margin:24px 0 0}
/* The approved theme page groups preferences like Windows Settings. Other
 * settings pages retain their existing flat-row structure. */
${PANEL} .dsh-appearance-general-group {
  display:block;
  margin-top:12px;
  border:1px solid var(--whale-win-surface-stroke);
  border-radius:8px;
  background:var(--whale-win-card);
  overflow:hidden;
}
${PANEL} .dsh-appearance-palette-heading {display:block;margin:24px 0 12px;font-size:14px;line-height:20px;font-weight:600}
${PANEL} .dsh-appearance-palette-heading + .dsh-appearance-cards {margin-top:0}
${PANEL} .dsh-appearance-card {padding:16px;border-radius:8px;background:var(--whale-win-card);border:1px solid var(--whale-win-surface-stroke)}
${PANEL} .dsh-appearance-card-heading {font-size:14px}
${PANEL} .dsh-appearance-mini {height:140px;border-radius:4px}
${PANEL} .dsh-appearance-select-label .dsh-win-combo {width:100%}
${PANEL} .dsh-appearance-select-label .dsh-win-combo-trigger {max-width:none}
${PANEL} .dsh-appearance-control > .dsh-win-combo {width:220px;max-width:100%}
${PANEL} .dsh-appearance-font-control .dsh-win-combo {width:240px;max-width:100%}
${PANEL} .dsh-appearance-section > :is(.dsh-appearance-fonts,.dsh-appearance-background-settings) {
  border:1px solid var(--whale-win-surface-stroke);
  border-radius:8px;
  background:var(--whale-win-card);
}
${PANEL} .dsh-appearance-background-note {margin:12px 4px 0;font-size:12px;line-height:16px;color:var(--whale-win-text-secondary)}
/* Inputs and selects take the WinUI control radius; hover/pressed/focus and
 * disabled states stay owned by the official primitives. */
${PANEL} :is(.dsh-appearance-input,.dsh-appearance-select-label select) {min-height:32px;border-radius:4px}
${PANEL} .dsh-appearance-wallpaper-preview {border-radius:4px}
${PANEL} .dsh-appearance-gradient {border-radius:4px}
${PANEL} .dsh-appearance-unavailable {border-radius:4px}

/* ── WinUI ComboBox ───────────────────────────────────────────────────────
 * ComboBox trigger: 32px, 4px radius, ControlFillColorDefault with the
 * ControlElevationBorderBrush edge (default stroke + stronger bottom stroke),
 * hover/press are the Secondary/Tertiary fills.  The dropdown is the Acrylic
 * in-app surface (OverlayCornerRadius 8, SurfaceStrokeColorFlyout) and each
 * ComboBoxItem is a 36px row with the official 3×16px accent pill on the
 * selected entry; hover and selection share SubtleFillColorSecondary. */
${PANEL} .dsh-win-combo {position:relative;display:inline-flex;min-width:0}
${PANEL} .dsh-win-combo-trigger {
  box-sizing:border-box;
  display:inline-flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  min-width:96px;
  width:100%;
  max-width:280px;
  min-height:32px;
  padding:0 8px 0 12px;
  border:1px solid var(--whale-win-control-stroke);
  border-bottom-color:var(--whale-win-control-stroke-bottom);
  border-radius:4px;
  background:var(--whale-win-control-fill);
  color:var(--dsw-alias-label-primary);
  font:inherit;
  font-size:14px;
  line-height:20px;
  cursor:pointer;
  transition:background-color 150ms cubic-bezier(.33,0,.67,1),border-color 150ms cubic-bezier(.33,0,.67,1);
}
${PANEL} .dsh-win-combo-trigger:hover {background:var(--whale-win-control-fill-hover)}
${PANEL} .dsh-win-combo-trigger:active {background:var(--whale-win-control-fill-pressed)}
${PANEL} .dsh-win-combo-trigger:focus-visible {
  outline:2px solid var(--whale-win-focus-outer);
  outline-offset:1px;
}
${PANEL} .dsh-win-combo-trigger:disabled {
  background:var(--whale-win-control-fill);
  color:var(--whale-win-text-disabled);
  cursor:default;
}
${PANEL} .dsh-win-combo-value {min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
${PANEL} .dsh-win-combo-chevron {flex:none;color:var(--whale-win-text-secondary)}
${PANEL} .dsh-win-combo-popup {
  box-sizing:border-box;
  position:fixed;
  inset:auto;
  margin:0;
  z-index:30;
  min-width:0;
  max-height:226px;
  overflow-y:auto;
  overflow-x:hidden;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  scrollbar-width:auto;
  padding:4px;
  border:1px solid var(--whale-win-flyout-border);
  border-radius:8px;
  background:var(--whale-win-acrylic);
  box-shadow:var(--whale-win-popup-shadow);
}
${PANEL} .dsh-win-combo-popup::backdrop {background:transparent;pointer-events:none}
${PANEL} .dsh-win-combo-popup::-webkit-scrollbar {display:block;width:10px}
${PANEL} .dsh-win-combo-popup::-webkit-scrollbar-track {background:transparent}
${PANEL} .dsh-win-combo-popup::-webkit-scrollbar-thumb {border:3px solid var(--whale-win-acrylic);border-radius:999px;background:var(--whale-win-strong-stroke);background-clip:padding-box}
${PANEL} .dsh-win-combo-option {
  position:relative;
  box-sizing:border-box;
  display:block;
  height:36px;
  padding:0 12px;
  border-radius:4px;
  color:var(--dsw-alias-label-primary);
  font-size:14px;
  line-height:36px;
  font-weight:400;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  cursor:pointer;
  transition:background-color 150ms cubic-bezier(.33,0,.67,1);
}
${PANEL} .dsh-win-combo-option:hover,
${PANEL} .dsh-win-combo-option[data-active] {background:var(--whale-win-subtle-secondary)}
${PANEL} .dsh-win-combo-option:active {
  background:var(--whale-win-subtle-tertiary);
  color:var(--whale-win-text-secondary);
}
${PANEL} .dsh-win-combo-option[aria-selected="true"] {background:var(--whale-win-subtle-secondary);padding-left:21px}
${PANEL} .dsh-win-combo-option[aria-selected="true"]::before {
  content:"";
  position:absolute;
  left:8px;
  top:50%;
  width:3px;
  height:16px;
  margin-top:-8px;
  border-radius:999px;
  background:var(--dsw-alias-brand-primary);
}

/* ── Selection controls ───────────────────────────────────────────────────
 * WinUI marks a single choice with a radio circle (RadioButton): a 20px ring
 * using ControlStrongStroke, filled with a 2px accent ring plus a 10px accent
 * dot when checked. The host segmented control keeps its tab semantics and
 * keyboard behavior; the sliding white indicator is hidden and each tab
 * paints the radio. Round color wells follow the same language. */
${PANEL} .dsh-appearance-color-input input[type=color] {border-radius:50%}
${PANEL} .dsh-appearance-colors input[type=color] {border-radius:4px}
${PANEL} [role="tablist"] {
  position:static;
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:4px 20px;
  padding:0;
  border-radius:0;
  background:transparent;
}
${PANEL} [role="tablist"] > span {display:none}
${PANEL} [role="tab"] {
  box-sizing:border-box;
  display:inline-flex;
  align-items:center;
  gap:8px;
  height:32px;
  padding:0;
  border-radius:4px;
  background:transparent;
  color:var(--dsw-alias-label-primary);
  font-size:14px;
  line-height:20px;
  font-weight:400;
}
${PANEL} [role="tab"]::before {
  content:"";
  box-sizing:border-box;
  flex:none;
  width:20px;
  height:20px;
  border-radius:50%;
  corner-shape:round;
  border:1px solid var(--whale-win-strong-stroke);
  background:transparent;
  transition:border-color 150ms cubic-bezier(.33,0,.67,1),background-color 150ms cubic-bezier(.33,0,.67,1);
}
${PANEL} [role="tab"]:hover::before {border-color:var(--dsw-alias-label-primary)}
${PANEL} [role="tab"][aria-selected="true"]::before {
  border:2px solid var(--dsw-alias-brand-primary);
  background:radial-gradient(circle at center,var(--dsw-alias-brand-primary) 0 5px,transparent 5px);
}
${PANEL} [role="tab"]:disabled {cursor:default;color:var(--whale-win-text-disabled)}
${PANEL} [role="tab"]:disabled::before {border-color:var(--whale-win-strong-stroke-disabled)}
${PANEL} [role="tab"]:focus-visible {
  outline:2px solid var(--whale-win-focus-outer);
  outline-offset:2px;
}

/* ── ToggleSwitch ─────────────────────────────────────────────────────────
 * FluentKit / WinUI geometry: 40×20 track, 1px ControlStrongStroke border,
 * 12px thumb at a 4px inset that stretches to 14 (hover) and 17 (pressed),
 * 20px travel.  Off uses ControlAltFillColor alphas; on fills the theme
 * accent with the theme's on-accent label as the thumb. */
${PANEL} [role="switch"] {
  box-sizing:border-box;
  position:relative;
  display:block;
  flex:0 0 auto;
  width:40px;
  min-width:40px;
  height:20px;
  min-height:20px;
  padding:0;
  border:0;
  border-radius:999px;
  corner-shape:round;
  background:var(--whale-win-alt-off);
  box-shadow:inset 0 0 0 1px var(--whale-win-strong-stroke);
  cursor:pointer;
  transition:background-color 150ms cubic-bezier(.33,0,.67,1),box-shadow 150ms cubic-bezier(.33,0,.67,1);
}
${PANEL} [role="switch"]::before {content:"";position:absolute;inset:-8px 0;border-radius:999px}
${PANEL} [role="switch"] > span {
  position:absolute;
  display:block;
  top:50%;
  left:4px;
  width:12px;
  height:12px;
  margin:0;
  border:0;
  border-radius:999px;
  corner-shape:round;
  background:var(--dsw-alias-label-primary);
  transform:translateY(-50%);
  pointer-events:none;
  transition:transform 150ms cubic-bezier(.33,0,.67,1),width 150ms cubic-bezier(.33,0,.67,1),height 150ms cubic-bezier(.33,0,.67,1),background-color 150ms cubic-bezier(.33,0,.67,1);
}
${PANEL} [role="switch"]:hover:not(:disabled) {background:var(--whale-win-alt-off-hover)}
${PANEL} [role="switch"]:hover:not(:disabled) > span {width:14px;height:14px}
${PANEL} [role="switch"]:active:not(:disabled) {background:var(--whale-win-alt-off-pressed)}
${PANEL} [role="switch"]:active:not(:disabled) > span {width:17px;height:14px}
${PANEL} [role="switch"][aria-checked="true"] {
  background:var(--dsw-alias-brand-primary);
  box-shadow:none;
}
${PANEL} [role="switch"][aria-checked="true"]:hover:not(:disabled) {
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 90%,transparent);
}
${PANEL} [role="switch"][aria-checked="true"]:active:not(:disabled) {
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 80%,transparent);
}
${PANEL} [role="switch"][aria-checked="true"] > span {
  transform:translateY(-50%) translateX(20px);
  background:var(--dsw-alias-label-primary-foreground);
}
${PANEL} [role="switch"]:disabled {
  cursor:default;
  background:transparent;
  box-shadow:inset 0 0 0 1px var(--whale-win-strong-stroke-disabled);
}
${PANEL} [role="switch"]:disabled > span {background:var(--whale-win-text-disabled)}
${PANEL} [role="switch"][aria-checked="true"]:disabled {
  background:var(--whale-win-accent-disabled);
  box-shadow:none;
}
${PANEL} [role="switch"][aria-checked="true"]:disabled > span {background:var(--whale-win-text-disabled)}
${PANEL} :is(nav button,[role="switch"]):focus-visible {
  outline:2px solid var(--whale-win-focus-outer);
  outline-offset:2px;
}

/* ── Preferences ──────────────────────────────────────────────────────────
 * Reduced transparency flattens the material (it is already opaque) and the
 * OS preference selects the same solid base. No rule here needs backdrop
 * blur, so no @supports fallback is required. */
${REDUCED} {background:var(--dsw-alias-bg-base)}
@media (prefers-reduced-transparency:reduce) {
  ${PANEL} {background:var(--dsw-alias-bg-base)}
}
@media (prefers-reduced-motion:reduce) {
  ${PANEL} *,${PANEL} *::before {transition:none!important;animation:none!important}
}
@media (prefers-contrast:more) {
  ${PANEL} {
    --whale-win-divider:rgba(0,0,0,.4);
    --whale-win-surface-stroke:rgba(0,0,0,.4);
    --whale-win-strong-stroke:rgba(0,0,0,.7);
  }
  ${DARK} {
    --whale-win-divider:rgba(255,255,255,.4);
    --whale-win-surface-stroke:rgba(255,255,255,.4);
    --whale-win-strong-stroke:rgba(255,255,255,.8);
  }
}
@media (forced-colors:active) {
  ${PANEL} {border-color:WindowText}
  ${PANEL} [role="switch"] {background:ButtonFace;outline:1px solid ButtonText;forced-color-adjust:none}
  ${PANEL} [role="switch"][aria-checked="true"] {background:Highlight}
  ${PANEL} [role="switch"] > span {background:ButtonText}
  ${PANEL} [role="switch"][aria-checked="true"] > span {background:HighlightText}
  ${PANEL} .dsh-win-combo-trigger {border-color:ButtonText;background:ButtonFace;color:ButtonText}
  ${PANEL} .dsh-win-combo-popup {border-color:ButtonText;background:Canvas;color:CanvasText;scrollbar-color:auto}
  ${PANEL} .dsh-win-combo-option {color:CanvasText}
  ${PANEL} .dsh-win-combo-option:is([data-active],[aria-selected="true"]) {background:Highlight;color:HighlightText;forced-color-adjust:none}
  ${PANEL} .dsh-win-combo-option[aria-selected="true"]::before {background:HighlightText}
}
@media (max-width:760px) {
  ${PANEL} > nav {width:170px}
  ${PANEL} .dsh-appearance-row {gap:12px;flex-wrap:wrap}
  ${PANEL} .dsh-appearance-control {max-width:100%}
}
@media (max-width:700px) {
  ${PANEL} > nav {width:168px}
  ${PANEL} > nav + div > div + div {padding:0 14px 20px}
  ${PANEL} :is(.dsh-appearance-row,.dsh-whale-row) {gap:12px;flex-wrap:wrap}
}
@media (max-width:480px) {
  ${PANEL} {max-width:calc(100vw - 24px);height:calc(100dvh - 24px)}
  ${PANEL} > nav {width:120px;padding:16px 6px 10px}
  ${PANEL} nav button {padding:0 6px;gap:6px}
  ${PANEL} nav button[aria-current="true"]::before {left:0}
  ${PANEL} > nav + div > div + div {padding:0 10px 16px}
  ${PANEL} :is(.dsh-appearance-row,.dsh-whale-row) {padding:10px;gap:8px}
  ${PANEL} .dsh-appearance-row:has([role="switch"]) {flex-wrap:nowrap}
  ${PANEL} :is(.dsh-appearance-control,.dsh-whale-control) {max-width:100%}
  ${PANEL} [role="tablist"] {max-width:100%;gap:2px 12px}
  ${PANEL} .dsh-appearance-font-control {max-width:100%}
  ${PANEL} .dsh-appearance-input {max-width:100%}
}
`;

module.exports = { CSS };

'use strict';

/**
 * Windows / WinUI 3 visual layer for the settings dialog.
 *
 * Reference: WinUI 3 Gallery (NavigationView, ToggleSwitch, Button, ComboBox,
 * TextBox) and the Windows design guides for typography, rounded corners and
 * Mica. This is a Web approximation: a flat, opaque Mica-like base with a
 * restrained accent tint, thin strokes and 4px control radii (8px panel).
 *
 * Scope every rule to the Windows gate the appearance controller sets on the
 * client document. Use shared --dsw-* tokens so all 27 theme presets keep
 * working, and keep host DOM, ARIA and keyboard behavior untouched.
 * Do not use official CSS Module hash names: they change on every build.
 *
 * macOS keeps its own stylesheet: nothing here may match a macOS document.
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
// Adjacent rows read as one settings card. The shared edge is a single 1px
// line: the upper row drops its bottom border and the lower row keeps its top
// border; inner corners stay square. No React nodes are moved or replaced.
const rowRules = ROWS.map(([row, next]) => `
${row} {
  box-sizing:border-box;
  position:relative;
  min-height:44px;
  padding:12px 16px;
  gap:24px;
  margin:8px 0 0;
  border:1px solid var(--dsw-alias-border-l2);
  border-radius:4px;
  background-color:var(--whale-win-card);
}
${row}:has(+ ${next}) {
  border-bottom-width:0;
  border-bottom-left-radius:0;
  border-bottom-right-radius:0;
}
${row} + ${next} {
  margin-top:0;
  border-top-left-radius:0;
  border-top-right-radius:0;
}
`).join('\n');

const CSS = `
${PANEL} {
  /* Mica approximation: an opaque base with a whisper of the theme accent.
   * CSS cannot sample the desktop wallpaper, so this stays a flat material. */
  --whale-win-mica:color-mix(in srgb,var(--dsw-alias-brand-primary) 3%,var(--dsw-alias-bg-base));
  --whale-win-content:var(--dsw-alias-bg-layer-1);
  --whale-win-card:color-mix(in srgb,var(--dsw-alias-bg-base) 94%,var(--dsw-alias-label-primary));
  --whale-win-hairline:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);
  --whale-win-stroke:color-mix(in srgb,var(--dsw-alias-label-primary) 45%,transparent);
  width:860px;
  max-width:calc(100vw - 48px);
  height:min(700px,calc(100dvh - 48px));
  border:1px solid var(--whale-win-hairline);
  border-radius:8px;
  corner-shape:round;
  background:var(--whale-win-mica);
  color:var(--dsw-alias-label-primary);
  font-family:var(--dsw-font-family);
  font-size:14px;
  line-height:20px;
  box-shadow:0 16px 40px #0000002e,0 2px 8px #0000001a;
}
${DARK} {
  box-shadow:0 16px 40px #00000073,0 2px 8px #0000004d;
}

/* ── NavigationView ───────────────────────────────────────────────────────
 * The pane keeps the Mica base and only a hairline splits it from content;
 * the selected item is a soft neutral fill with a short accent bar. */
${PANEL} > nav {
  width:200px;
  min-width:0;
  padding:20px 10px 12px;
  gap:18px;
  background:transparent;
  border-right:1px solid var(--whale-win-hairline);
}
${PANEL} > nav > div:first-child {
  padding:0 10px;
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
  padding:0 10px 0 14px;
  gap:10px;
  border-radius:4px;
  font-size:14px;
  line-height:20px;
  font-weight:400;
  transition:background-color 100ms ease;
}
${PANEL} nav button:hover {background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
${PANEL} nav button:active {background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}
${PANEL} nav button[aria-current="true"] {
  background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);
  font-weight:600;
}
${PANEL} nav button[aria-current="true"]::before {
  content:"";
  position:absolute;
  left:3px;
  top:50%;
  width:3px;
  height:16px;
  margin-top:-8px;
  border-radius:2px;
  background:var(--dsw-alias-brand-primary);
}

/* ── Page chrome ──────────────────────────────────────────────────────────
 * Grouped content sits on a solid layer; the heading uses the WinUI title
 * ramp (20/28 semibold) and copies the active navigation label. */
${PANEL} > nav + div {background:var(--whale-win-content)}
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
  color:var(--dsw-alias-label-secondary);
}
${PANEL} > nav + div > div:first-child > button:hover {background:var(--dsw-alias-interactive-bg-hover)}
${PANEL} > nav + div > div + div {padding:0 20px 24px;scrollbar-gutter:stable}

${rowRules}
/* Typography: body 14/20, captions 12/16, group headers 14/20 semibold. */
${PANEL} :is(.dsh-whale-title,.dsh-appearance-label),
${GENERAL} > div > div:first-child > div:first-child {font-size:14px;line-height:20px;font-weight:400}
${PANEL} :is(.dsh-whale-description,.dsh-appearance-description) {font-size:12px;line-height:16px;margin-top:2px}
${PANEL} :is(.dsh-whale-text,.dsh-appearance-row > div:first-child) {min-width:0}
${PANEL} label[for] {font-size:14px;font-weight:400}
${PANEL} .dsh-appearance-intro {margin:0 0 8px;font-size:12px;line-height:16px}
${PANEL} .dsh-appearance-section {margin-top:20px}
${PANEL} .dsh-appearance-section > h3 {margin:0 4px 8px;font-size:14px;line-height:20px;font-weight:600}
${PANEL} .dsh-appearance-section > p {margin:0 4px 8px}
${PANEL} .dsh-appearance-section > .dsh-appearance-row:first-of-type,
${PANEL} .dsh-appearance-fonts > .dsh-appearance-row:first-child,
${PANEL} .dsh-appearance-background-settings > .dsh-appearance-row:first-child {margin-top:0}
${PANEL} .dsh-appearance-cards {gap:12px;margin:20px 0 0}
${PANEL} .dsh-appearance-card {padding:14px;border-radius:4px;background:var(--whale-win-card);border-color:var(--dsw-alias-border-l2)}
${PANEL} .dsh-appearance-card-heading {font-size:14px}
${PANEL} .dsh-appearance-background-note {margin:12px 4px 0;font-size:12px;line-height:16px}
/* Inputs and selects take the WinUI control radius; hover/pressed/focus and
 * disabled states stay owned by the official primitives. */
${PANEL} :is(.dsh-appearance-input,.dsh-appearance-select-label select) {min-height:32px;border-radius:4px}
${PANEL} .dsh-appearance-wallpaper-preview {border-radius:4px}
${PANEL} .dsh-appearance-gradient {border-radius:4px}
${PANEL} .dsh-appearance-color-input input[type=color] {border-radius:4px}
${PANEL} .dsh-appearance-unavailable {border-radius:4px}

/* ── ToggleSwitch ─────────────────────────────────────────────────────────
 * WinUI geometry: 40×20 track, 12px round thumb, 4px inset and a 20px travel.
 * Off state is a stroked empty track; on state fills with the theme accent.
 * The thumb uses the theme's on-accent label, so all presets stay readable. */
${PANEL} [role="switch"] {
  box-sizing:border-box;
  position:relative;
  display:block;
  flex:0 0 auto;
  width:40px;
  min-width:40px;
  height:20px;
  min-height:20px;
  padding:4px;
  border:0;
  border-radius:999px;
  corner-shape:round;
  background:transparent;
  box-shadow:inset 0 0 0 1px var(--whale-win-stroke);
  cursor:pointer;
  transition:background-color 140ms ease,box-shadow 140ms ease;
}
${PANEL} [role="switch"]::before {content:"";position:absolute;inset:-8px 0;border-radius:999px}
${PANEL} [role="switch"] > span {
  position:absolute;
  display:block;
  top:4px;
  left:4px;
  width:12px;
  height:12px;
  margin:0;
  border:0;
  border-radius:50%;
  corner-shape:round;
  background:var(--whale-win-stroke);
  transform:translateX(0);
  pointer-events:none;
  transition:transform 160ms cubic-bezier(.2,.8,.2,1),background-color 140ms ease;
}
${PANEL} [role="switch"][aria-checked="true"] {
  background:var(--dsw-alias-brand-primary);
  box-shadow:inset 0 0 0 1px transparent;
}
${PANEL} [role="switch"][aria-checked="true"] > span {
  transform:translateX(20px);
  background:var(--dsw-alias-label-primary-foreground);
}
${PANEL} [role="switch"]:active:not(:disabled) > span {box-shadow:0 0 0 2px #ffffff30}
${PANEL} [role="switch"]:disabled {cursor:default;opacity:.4}
${PANEL} :is(nav button,[role="switch"]):focus-visible {
  outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
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
    --whale-win-hairline:var(--dsw-alias-border-l4);
    --whale-win-stroke:var(--dsw-alias-label-secondary);
  }
}
@media (forced-colors:active) {
  ${PANEL} {border-color:WindowText}
  ${PANEL} [role="switch"] {background:ButtonFace;box-shadow:none;outline:1px solid ButtonText;forced-color-adjust:none}
  ${PANEL} [role="switch"][aria-checked="true"] {background:Highlight}
  ${PANEL} [role="switch"] > span {background:ButtonText}
  ${PANEL} [role="switch"][aria-checked="true"] > span {background:HighlightText}
}
@media (max-width:700px) {
  ${PANEL} > nav {width:168px}
  ${PANEL} > nav + div > div + div {padding:0 14px 20px}
  ${PANEL} :is(.dsh-appearance-row,.dsh-whale-row) {gap:12px;flex-wrap:wrap}
}
@media (max-width:480px) {
  ${PANEL} {max-width:calc(100vw - 24px);height:calc(100dvh - 24px);border-radius:8px}
  ${PANEL} > nav {width:120px;padding:16px 6px 10px}
  ${PANEL} nav button {padding:0 6px 0 10px;gap:6px}
  ${PANEL} nav button[aria-current="true"]::before {left:2px}
  ${PANEL} > nav + div > div + div {padding:0 10px 16px}
  ${PANEL} :is(.dsh-appearance-row,.dsh-whale-row) {padding:10px;gap:8px}
  ${PANEL} .dsh-appearance-row:has([role="switch"]) {flex-wrap:nowrap}
  ${PANEL} :is(.dsh-appearance-control,.dsh-whale-control) {max-width:100%}
  ${PANEL} [role="tablist"] {max-width:100%}
  ${PANEL} [role="tab"] {padding-inline:6px}
  ${PANEL} .dsh-appearance-font-control {max-width:100%}
  ${PANEL} .dsh-appearance-input {max-width:100%}
}
`;

module.exports = { CSS };

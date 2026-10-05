'use strict';

/**
 * CSS approximation of the supplied macOS 27 settings reference.
 * Apple HIG: /design/human-interface-guidelines/{materials,toggles}.
 * Solid grouped content, a restrained translucent sidebar, and mini switches.
 * This is Web styling, not an AppKit / native Liquid Glass material.
 *
 * Keep host controls and their keyboard / ARIA behavior. Select the published
 * modal, navigation and switch hooks; never depend on generated class hashes.
 * The general page is recognized by its direct switch rows. If that structure
 * changes, only its grouped-row treatment falls back to Harness styling.
 */
const PANEL = 'body[data-whale-mac-settings] [data-shortcut-modal="settings"]';
const GENERAL = `${PANEL} > nav + div > div + div > div:has(> div > [role="switch"])`;
const ROWS = [
  [`${PANEL} :is(.dsh-appearance-row, .dsh-whale-row)`, 'div:is(.dsh-appearance-row, .dsh-whale-row)'],
  [`${GENERAL} > div`, 'div'],
];
// Adjacent rows paint one continuous card without reparenting React elements.
const rowRules = ROWS.map(([row, next]) => `
${row} {
  box-sizing:border-box;
  position:relative;
  min-height:42px;
  padding:12px 16px;
  gap:20px;
  margin:12px 0 0;
  border:0;
  border-radius:12px;
  background-color:var(--whale-mac-group);
}
${row}:has(+ ${next}) {
  border-bottom-left-radius:0;
  border-bottom-right-radius:0;
  background-image:linear-gradient(var(--whale-mac-hairline),var(--whale-mac-hairline));
  background-position:center bottom;
  background-size:calc(100% - 32px) 1px;
  background-repeat:no-repeat;
}
${row} + ${next} {
  margin-top:0;
  border-top-left-radius:0;
  border-top-right-radius:0;
}
`).join('\n');

const CSS = `
${PANEL} {
  --whale-mac-content:var(--dsw-alias-bg-layer-1);
  --whale-mac-group:var(--dsw-alias-bg-base);
  /* Give the material its own neutral tint, so even a flat backdrop reads
   * differently from the opaque content column. Keep enough transmission for
   * actual in-window colors to remain visible through the blur. */
  --whale-mac-sidebar-solid:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,var(--dsw-alias-label-primary));
  --whale-mac-frost:color-mix(in srgb,var(--whale-mac-sidebar-solid) 68%,transparent);
  --whale-mac-sheen:linear-gradient(180deg,#ffffff12,#ffffff03 65%,transparent);
  --whale-mac-hairline:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);
  --whale-mac-thumb:#f5f5f5;
  width:860px;
  max-width:calc(100vw - 48px);
  height:min(680px,calc(100dvh - 48px));
  border:1px solid var(--whale-mac-hairline);
  border-radius:18px;
  corner-shape:round;
  background:transparent;
  color:var(--dsw-alias-label-primary);
  font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
  font-size:13px;
  line-height:1.5;
  box-shadow:0 24px 70px #00000038,0 0 0 .5px #00000014;
}
body[data-ds-dark-theme][data-whale-mac-settings] [data-shortcut-modal="settings"] {
  --whale-mac-group:var(--dsw-alias-bg-layer-2);
  --whale-mac-sidebar-solid:color-mix(in srgb,var(--dsw-alias-bg-base) 84%,var(--dsw-alias-label-primary));
  --whale-mac-frost:color-mix(in srgb,var(--whale-mac-sidebar-solid) 56%,transparent);
  --whale-mac-sheen:linear-gradient(180deg,#ffffff0c,#ffffff02 65%,transparent);
  --whale-mac-thumb:#e9e9e9;
  box-shadow:0 24px 70px #00000066,0 0 0 .5px #00000066,inset 0 1px 0 #ffffff12;
}
${PANEL} > nav {
  width:208px;
  min-width:0;
  padding:24px 10px 12px;
  gap:22px;
  background:var(--whale-mac-sheen),var(--whale-mac-frost);
  backdrop-filter:blur(36px) saturate(145%);
  -webkit-backdrop-filter:blur(36px) saturate(145%);
  box-shadow:inset 0 1px 0 #ffffff12;
  border-right:1px solid var(--whale-mac-hairline);
}
${PANEL} > nav > div:first-child {
  padding:0 12px;
  font-size:15px;
  font-weight:600;
  line-height:24px;
  letter-spacing:-.015em;
}
${PANEL} > nav > div + div {gap:2px;min-height:0}
${PANEL} nav button {
  flex-shrink:0;
  height:32px;
  min-height:32px;
  padding:0 10px;
  gap:9px;
  border-radius:8px;
  corner-shape:round;
  font-size:13px;
  line-height:20px;
  font-weight:400;
  transition:background-color 120ms ease,color 120ms ease;
}
${PANEL} nav button > svg {width:18px;height:18px;color:var(--dsw-alias-state-business-primary)}
${PANEL} nav button[aria-current="true"] {
  background:var(--whale-mac-selection-fill,var(--dsw-alias-brand-primary));
  color:#fff;
  font-weight:600;
}
${PANEL} nav button[aria-current="true"] > svg {color:inherit}
${PANEL} > nav + div {background:var(--whale-mac-content)}
${PANEL} > nav + div > div:first-child {
  height:62px;
  align-items:center;
  padding:16px 20px;
}
${PANEL} [data-whale-settings-title]::before {
  content:attr(data-whale-settings-title);
  color:var(--dsw-alias-label-primary);
  font-size:17px;
  line-height:24px;
  font-weight:600;
  letter-spacing:-.02em;
}
${PANEL} > nav + div > div:first-child > button {
  border-radius:50%;
  corner-shape:round;
  background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-secondary);
}
${PANEL} > nav + div > div + div {padding:0 20px 24px;scrollbar-gutter:stable}

${rowRules}
/* Row text stays readable; previews, badges and color editors keep their sizes. */
${PANEL} :is(.dsh-whale-title,.dsh-appearance-label),
${GENERAL} > div > div:first-child > div:first-child {font-size:13px;line-height:20px;font-weight:400}
${PANEL} :is(.dsh-whale-description,.dsh-appearance-description) {margin-top:3px;line-height:18px}
${PANEL} :is(.dsh-whale-text,.dsh-appearance-row > div:first-child) {min-width:0}
${PANEL} label[for] {font-size:13px;font-weight:400;letter-spacing:-.005em}
${PANEL} .dsh-appearance-intro {margin:0 0 4px;font-size:12px;line-height:18px}
${PANEL} .dsh-appearance-section {margin-top:24px}
${PANEL} .dsh-appearance-section > h3 {margin:0 16px 8px;font-size:13px;line-height:20px;font-weight:600}
${PANEL} .dsh-appearance-section > p {margin:0 16px 8px}
${PANEL} .dsh-appearance-section > .dsh-appearance-row:first-of-type,
${PANEL} .dsh-appearance-fonts > .dsh-appearance-row:first-child,
${PANEL} .dsh-appearance-background-settings > .dsh-appearance-row:first-child {margin-top:0}
${PANEL} .dsh-appearance-cards {gap:12px;margin:20px 0 0}
${PANEL} .dsh-appearance-card {padding:14px;border-radius:12px;background:var(--whale-mac-group);border-color:var(--whale-mac-hairline)}
${PANEL} .dsh-appearance-card-heading {font-size:13px}
${PANEL} .dsh-appearance-background-note {margin:10px 16px 0;font-size:12px}
${PANEL} :is(.dsh-appearance-input,.dsh-appearance-select-label select) {min-height:28px;border-radius:7px}

/* Reference track 72×32 / thumb 42×26, approximately 2× the CSS dimensions.
 * The thumb is a horizontal capsule, not the host's 16px circle. Keep its
 * neutral light fill in both states, including themes with dark on-accent text.
 * The pseudo-element enlarges the hit area without changing row alignment. */
${PANEL} [role="switch"] {
  box-sizing:border-box;
  position:relative;
  display:block;
  flex:0 0 auto;
  width:36px;
  min-width:36px;
  height:16px;
  min-height:16px;
  padding:1.5px;
  border:0;
  border-radius:999px;
  corner-shape:round;
  background:color-mix(in srgb,var(--dsw-alias-label-primary) 20%,var(--whale-mac-content));
  box-shadow:inset 0 0 0 .5px #0000000d;
  cursor:pointer;
  transition:background-color 180ms ease;
}
${PANEL} [role="switch"]::before {content:"";position:absolute;inset:-6px 0;border-radius:999px}
${PANEL} [role="switch"] > span {
  position:absolute;
  display:block;
  top:1.5px;
  left:1.5px;
  width:21px;
  height:13px;
  margin:0;
  border:0;
  border-radius:999px;
  corner-shape:round;
  background:var(--whale-mac-thumb);
  box-shadow:0 .5px 1.5px #00000026,0 0 0 .5px #00000012;
  transform:translateX(0);
  pointer-events:none;
  transition:transform 180ms cubic-bezier(.2,.8,.2,1),box-shadow 180ms ease;
}
${PANEL} [role="switch"][aria-checked="true"] {background:var(--dsw-alias-brand-primary)}
${PANEL} [role="switch"][aria-checked="true"] > span {transform:translateX(12px)}
${PANEL} [role="switch"]:active:not(:disabled) > span {box-shadow:0 0 0 2px #ffffff26,0 1px 3px #00000026}
${PANEL} [role="switch"]:disabled {cursor:default;opacity:.45}
${PANEL} :is(nav button,[role="switch"]):focus-visible {
  outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
  outline-offset:3px;
}

/* Reduced transparency retains layout and controls, using a solid sidebar. */
body[data-whale-mac-settings-reduced] [data-shortcut-modal="settings"] > nav {
  background:var(--whale-mac-sidebar-solid);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:none;
}
@media (prefers-reduced-transparency:reduce) {
  ${PANEL} > nav {background:var(--whale-mac-sidebar-solid);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:none}
}
@supports not (backdrop-filter:blur(1px)) {
  ${PANEL} > nav {background:var(--whale-mac-sidebar-solid);box-shadow:none}
}
@media (prefers-reduced-motion:reduce) {
  ${PANEL} *,${PANEL} *::before {transition:none!important;animation:none!important}
}
@media (prefers-contrast:more) {
  ${PANEL} {--whale-mac-hairline:var(--dsw-alias-border-l4)}
  ${PANEL} > nav {background:var(--whale-mac-content);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:none}
  ${PANEL} [role="switch"] {outline:1px solid var(--dsw-alias-label-secondary)}
}
@media (forced-colors:active) {
  ${PANEL} [role="switch"] {background:ButtonFace;outline:1px solid ButtonText;forced-color-adjust:none}
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
  ${PANEL} {max-width:calc(100vw - 24px);height:calc(100dvh - 24px);border-radius:14px}
  ${PANEL} > nav {width:120px;padding:18px 6px 10px}
  ${PANEL} nav button {padding:0 6px;gap:6px}
  ${PANEL} nav button > svg {width:16px;height:16px}
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

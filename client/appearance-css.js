'use strict';
const CSS = `
.dsh-appearance-page {display:flex;flex-direction:column;width:100%;color:var(--dsw-alias-label-primary)}
.dsh-appearance-intro {color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:0 0 8px}
.dsh-appearance-row {display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-appearance-row:last-child {border-bottom:0}
.dsh-appearance-label {font-size:14px;line-height:20px}
.dsh-appearance-description {font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:4px 0 0}
.dsh-appearance-control {flex-shrink:0;display:flex;align-items:center}
.dsh-appearance-cards {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:24px 0 8px}
.dsh-appearance-card {border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:16px;overflow:hidden}
.dsh-appearance-card-heading {display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:600;margin-bottom:14px}
.dsh-appearance-card-badge {font-size:10px;font-weight:400;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px}
.dsh-appearance-mini {height:162px;display:flex;border:1px solid var(--mini-line);border-radius:10px;overflow:hidden;font-family:var(--dsw-font-family);margin-bottom:16px}
.dsh-appearance-mini-sidebar {width:18%;flex-shrink:0;padding:14px 9px;border-right:1px solid var(--mini-line)}
.dsh-appearance-mini-sidebar i {display:block;height:4px;border-radius:2px;background:var(--mini-muted);opacity:.35;margin-top:12px}
.dsh-appearance-mini-sidebar i:nth-child(3) {width:65%}
.dsh-appearance-mini-sidebar span {display:block;width:10px;height:10px;border-radius:50%;background:var(--mini-accent)}
.dsh-appearance-mini-chat {display:flex;flex:1;min-width:0;flex-direction:column;padding:20px 12px 12px}
.dsh-appearance-mini-chat strong {font-size:12px;font-weight:600}
.dsh-appearance-mini-chat p {font-size:9px;color:var(--mini-muted);margin:5px 0 10px;line-height:14px}
.dsh-appearance-mini-chat code {font-size:9px;color:var(--mini-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-appearance-mini-composer {display:flex;justify-content:space-between;align-items:center;border:1px solid var(--mini-line);border-radius:9px;padding:7px 8px;margin-top:auto;color:var(--mini-muted);font-size:9px}
.dsh-appearance-mini-composer b {font-size:11px;border-radius:50%;height:18px;width:18px;display:grid;place-items:center}
.dsh-appearance-select-label {display:flex;flex-direction:column;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-appearance-select-label select,.dsh-appearance-input {appearance:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);min-height:32px;font:inherit;font-size:12px;padding:6px 9px;box-sizing:border-box}
.dsh-appearance-input {width:170px}
.dsh-appearance-actions .dsh-appearance-input {width:auto}
.dsh-appearance-colors {display:flex;flex-direction:column;gap:10px;margin-top:14px}
.dsh-appearance-color {display:flex;align-items:center;justify-content:space-between;font-size:11px;gap:10px;color:var(--dsw-alias-label-secondary)}
.dsh-appearance-color-input {display:flex;align-items:center;gap:7px}
.dsh-appearance-color-input input[type=color] {appearance:none;width:24px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;overflow:hidden;cursor:pointer}
.dsh-appearance-color-input input[type=color]::-webkit-color-swatch-wrapper {padding:0}
.dsh-appearance-color-input input[type=color]::-webkit-color-swatch {border:0;border-radius:4px}
.dsh-appearance-color-input input[type=text] {width:68px;padding:4px 0;background:transparent;border:0;border-bottom:1px solid transparent;color:var(--dsw-alias-label-primary);font:11px ui-monospace,monospace}
.dsh-appearance-page input:focus-visible,.dsh-appearance-page select:focus-visible,.dsh-appearance-page button:focus-visible {outline:2px solid var(--dsw-focus-ring-color);outline-offset:3px}
.dsh-appearance-section {margin-top:24px}
.dsh-appearance-section h3 {font-size:13px;line-height:20px;font-weight:600;margin:0 0 2px}
.dsh-appearance-actions,.dsh-appearance-size {display:flex;align-items:center;gap:8px}
.dsh-appearance-font-control {flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:60%}
.dsh-appearance-font-control .dsh-appearance-input {width:240px;max-width:100%}
.dsh-appearance-size span {min-width:40px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}
.dsh-appearance-range {display:flex;align-items:center;gap:10px;font-size:12px}
.dsh-appearance-range input {width:110px;accent-color:var(--dsw-alias-state-business-primary)}
.dsh-appearance-range span {min-width:38px;text-align:right;font-variant-numeric:tabular-nums}
.dsh-appearance-gradients {display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:14px 0}
.dsh-appearance-gradient {display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px;color:var(--dsw-alias-label-primary);background:transparent;font:12px var(--dsw-font-family);cursor:pointer}
.dsh-appearance-gradient[aria-pressed=true] {border-color:var(--dsw-focus-ring-color);box-shadow:0 0 0 1px var(--dsw-focus-ring-color)}
.dsh-appearance-gradient span {display:block;border-radius:6px;width:100%;height:54px}
.dsh-appearance-swatches {display:flex;gap:8px}
.dsh-appearance-swatches button {width:28px;height:28px;border-radius:50%;border:2px solid var(--dsw-alias-bg-base);outline:1px solid var(--dsw-alias-border-l2);cursor:pointer}
.dsh-appearance-wallpaper-preview {height:128px;overflow:hidden;border-radius:10px;background:var(--dsw-alias-bg-layer-1);margin:12px 0}
.dsh-appearance-wallpaper-preview img {width:100%;height:100%;display:block}
.dsh-appearance-background-note {font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);margin:14px 0 0}
.dsh-appearance-upload-empty {display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:28px 16px;margin-top:14px}
.dsh-appearance-upload-empty .dsh-appearance-description {margin:0}
.dsh-appearance-disclosure {margin-top:8px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-appearance-disclosure-heading {min-height:36px;color:var(--dsw-alias-label-primary)}
.dsh-appearance-disclosure-body {padding:0 0 8px}
.dsh-appearance-unavailable {font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);padding:4px 8px;border-radius:6px}
.dsh-appearance-error {font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);margin:10px 0}
.dsh-appearance-footer {display:flex;align-items:center;justify-content:flex-end;margin-top:16px;color:var(--dsw-alias-label-secondary);font-size:11px}
[data-whale-wallpaper-frame] {isolation:isolate;background:transparent !important}
/* One viewport-sized image, outside the grid tracks and their width animation. */
[data-whale-wallpaper-frame] > .dsh-whale-wallpaper {position:fixed;inset:0;z-index:-1;pointer-events:none;clip-path:inset(0);background-repeat:no-repeat;background-position:center;background-size:cover}
/* Only shell surfaces become transparent; cards, menus, code and inputs keep their fills. */
[data-whale-wallpaper-frame] > :has(> [data-slot="main"]),
[data-whale-wallpaper-frame] > [data-rightbar-col],
[data-whale-wallpaper-frame] [data-slot="main"] > *,
[data-whale-wallpaper-frame] [data-slot="main"] [data-phase]:not([contenteditable]):has([data-conversation-content]),
[data-whale-wallpaper-frame] [data-slot="sidebar"] > *,
[data-whale-wallpaper-frame] [data-composer-seat],
[data-whale-wallpaper-frame] [data-chat-flow] {background:transparent !important}
/* Sample the in-window wallpaper. Harness's native vibrancy stays behind the Web view.
   backdrop-filter 不能挂在侧栏列本身：它会成为列内 position:fixed 后代的包含块，
   把官方固定在标题栏的收起按钮和新会话按钮下拉一个标题栏高度（折叠时还会被
   overflow:hidden 裁掉）。磨砂放到 ::before 上，两个 fixed 按钮留在标题栏。 */
[data-whale-wallpaper-frame] > :has(> [data-slot="sidebar"]) {position:relative;background:color-mix(in srgb,var(--dsw-alias-bg-base) 24%,transparent) !important}
[data-whale-wallpaper-frame] > :has(> [data-slot="sidebar"])::before {content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;backdrop-filter:blur(28px) saturate(140%);-webkit-backdrop-filter:blur(28px) saturate(140%)}
/* Windows owns its drag strip with ::before; keep its geometry and mouse handling. */
html[data-windows-titlebar] [data-whale-wallpaper-frame]::before {background:color-mix(in srgb,var(--dsw-alias-bg-base) 36%,transparent) !important;backdrop-filter:blur(28px) saturate(140%);-webkit-backdrop-filter:blur(28px) saturate(140%)}
/* Windows 的会话列表底部有一条 24px 渐隐条，渐隐到官方不透明的侧栏底色
   （macOS 官方直接隐藏它）。主题把侧栏改成半透明后，这层底色会在用户名上方
   露成一条白带；只在 Windows 的侧栏子树上把该 token 归零让渐隐条随主题消失，
   主内容区与 macOS 一行不动。 */
html[data-windows-titlebar] [data-whale-wallpaper-frame] [data-slot="sidebar"] {--dsw-specific-sidebar-fill:transparent}
@supports not (backdrop-filter:blur(1px)) {[data-whale-wallpaper-frame] > :has(> [data-slot="sidebar"]) {background:var(--dsw-alias-bg-base) !important}}
body[data-whale-glass-input] [data-composer-card] {background:color-mix(in srgb,var(--dsw-alias-bg-base) 84%,transparent);backdrop-filter:blur(26px) saturate(150%);-webkit-backdrop-filter:blur(26px) saturate(150%);border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 13%,transparent);box-shadow:inset 0 1px 0 #ffffff2e,0 10px 32px #00000014;--dsw-alias-label-primary:var(--whale-glass-text)}
@supports not (backdrop-filter:blur(1px)) {body[data-whale-glass-input] [data-composer-card] {background:var(--dsw-specific-input-major)}}
@media (prefers-reduced-transparency:reduce) {body[data-whale-glass-input] [data-composer-card] {background:var(--dsw-specific-input-major);backdrop-filter:none}}
@media (max-width:700px) {.dsh-appearance-cards {grid-template-columns:1fr}.dsh-appearance-row {gap:12px;flex-wrap:wrap}.dsh-appearance-input {width:155px}}
`;
module.exports = { CSS };

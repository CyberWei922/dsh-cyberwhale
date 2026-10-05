'use strict';

/**
 * dsh-cyberwhale · macOS 风格设置面板样式
 *
 * 锚点策略：只用官方**语义**钩子，不用任何 CSS Module 哈希类名。
 * 官方类名形如 `Dws9Sa_nav`（哈希前缀 + 局部名），前缀每次构建都会变；
 * 下面这些不会：
 *
 *   [data-shortcut-modal="settings"]   设置面板本体（`.Dws9Sa_panel`）
 *   > nav                              左侧导航列（原生 <nav> 元素）
 *   > nav + div                        右侧内容列
 *   [role="presentation"]              模态遮罩层
 *   [aria-hidden="true"]               遮罩
 *   [role="switch"][aria-checked]      官方开关基元（状态写在 aria-checked 上）
 *   label                              字段标签（官方 fields 用 <label for>）
 *
 * 失效模式是**静默降级**：官方改结构后这些选择器匹配不到，面板回到官方原样，
 * 不报错、不影响功能。`tools/test-mac-settings.mjs` 守住这些锚点还在不在。
 * 核对基线：Harness `0.2.0-rc.2`（本机安装包 app.asar 实测）。
 *
 * 材质说明：左侧用的是 **Web 磨砂**（`backdrop-filter` 模糊面板背后的应用内容），
 * **不是** Apple 原生材质。设置面板是居中模态框，背后是应用自己的不透明中间栏，
 * 不是桌面；主窗口的原生 vibrancy 由官方用在主侧栏（`vibrancy: "sidebar"`）。
 * 按 docs/phase-2-appearance-roadmap.md §7 的约定，这里不得标注成「原生 Liquid Glass」。
 */

const CSS = `
/* ── 面板拆成左右两块 ──────────────────────────────────────────────
 * 官方把整块面板的底色写在面板本体上（background: var(--dsw-alias-bg-layer-2)），
 * 导航列和内容列都没有各自的背景 —— 所以 token 只能整块一起变，做不出左右分界。
 * 这里让面板本体让出背景，由左右两列各自负责，圆角与投影保持官方值。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] {
  --whale-mac-switch-on:#34c759;
  --whale-mac-frost:color-mix(in srgb,var(--dsw-alias-bg-base) 52%,transparent);
  --whale-mac-hairline:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);
  background:transparent;
}
body[data-ds-dark-theme][data-whale-mac-settings] [data-shortcut-modal="settings"] {
  --whale-mac-switch-on:#30d158;
  --whale-mac-frost:color-mix(in srgb,var(--dsw-alias-bg-base) 46%,transparent);
  --whale-mac-hairline:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);
}

/* 左侧导航列：磨砂玻璃。面板已透明，所以 backdrop-filter 采样的是面板背后的内容。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] > nav {
  background:var(--whale-mac-frost);
  backdrop-filter:blur(30px) saturate(180%);
  -webkit-backdrop-filter:blur(30px) saturate(180%);
  border-right:.5px solid var(--whale-mac-hairline);
}

/* 右侧内容列：保持不透明，阅读、输入和滚动不受背景影响。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] > nav + div {
  background:var(--dsw-alias-bg-layer-2);
}

/* 模态遮罩：官方把 --dsw-mask-blur 定为 none（不模糊）。只为这个模态框开启，
 * 用 :has() 从面板反查同一层里的遮罩，避免改全局 token 波及其他浮层。 */
body[data-whale-mac-settings] [role="presentation"]:has(> [data-shortcut-modal="settings"]) > [aria-hidden="true"] {
  backdrop-filter:blur(26px) saturate(150%);
  -webkit-backdrop-filter:blur(26px) saturate(150%);
}

/* ── 左侧导航项：贴近 macOS 侧栏的行高与圆角 ───────────────────────
 * 只调几何，选中/悬停底色仍由官方 token 决定（这里不写 background）。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] nav button {
  height:34px;
  padding:0 10px;
  border-radius:7px;
  font-size:13px;
  transition:background-color 120ms ease;
}

/* ── macOS 风格开关 ────────────────────────────────────────────────
 * 官方基元是 <button role="switch" aria-checked><span/></button>，
 * 尺寸 36×20、滑块 16px、行程 16px。改成 macOS 的 40×24 与 20px 滑块后，
 * 行程仍然是 40-2*2-20 = 16px，所以官方那条 translateX(16px) 不用覆盖。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] [role="switch"] {
  width:40px;
  height:24px;
  /* 关闭态轨道用官方 border-l4（浅色 rgba(0,0,0,.16) / 深色 rgba(255,255,255,.2)）。
     不能用 label-primary 派生：它在深色下接近纯白，轨道会跟着变亮，白滑块就看不见了。 */
  background:var(--dsw-alias-border-l4);
  transition:background-color 200ms cubic-bezier(.22,.61,.36,1);
}
body[data-whale-mac-settings] [data-shortcut-modal="settings"] [role="switch"][aria-checked="true"] {
  background:var(--whale-mac-switch-on);
}
body[data-whale-mac-settings] [data-shortcut-modal="settings"] [role="switch"] > span {
  width:20px;
  height:20px;
  background:#fff;
  box-shadow:0 1px 2.5px #00000038,0 0 0 .5px #0000000f;
  transition:transform 200ms cubic-bezier(.22,.61,.36,1);
}

/* ── 标签：贴近 macOS 设置行的字重 ─────────────────────────────────
 * 官方是 13px/500，macOS 系统设置的行标签是 13px 常规字重。
 * 排除本插件自己的主题页：那里的 label 是 12px 的次要文字，按自己的规格来。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] label:not([class*="dsh-appearance"]) {
  font-size:13px;
  font-weight:400;
  letter-spacing:-.002em;
}

/* ── 降级规则 ──────────────────────────────────────────────────────
 * 运行时会因为「降低透明度」而不加这个属性；这里再兜一层，防止属性被别处加上
 * 却出现「半透明但没模糊」的脏玻璃。引擎不支持 backdrop-filter 时同样回退实色。 */
@media (prefers-reduced-transparency:reduce) {
  body[data-whale-mac-settings] [data-shortcut-modal="settings"] > nav {background:var(--dsw-alias-bg-layer-1);backdrop-filter:none;-webkit-backdrop-filter:none}
  body[data-whale-mac-settings] [role="presentation"]:has(> [data-shortcut-modal="settings"]) > [aria-hidden="true"] {backdrop-filter:none;-webkit-backdrop-filter:none}
}
@supports not (backdrop-filter:blur(1px)) {
  body[data-whale-mac-settings] [data-shortcut-modal="settings"] > nav {background:var(--dsw-alias-bg-layer-1)}
}
`;

module.exports = { CSS };

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
 *   nav button[aria-current="true"]    当前选中的导航项
 *   [role="switch"][aria-checked]      官方开关基元（状态写在 aria-checked 上）
 *   label                              字段标签（官方 fields 用 <label for>）
 *
 * 失效模式是**静默降级**：官方改结构后这些选择器匹配不到，面板回到官方原样，
 * 不报错、不影响功能。`tools/test-mac-settings.mjs` 守住这些锚点还在不在。
 * 核对基线：Harness `0.2.0-rc.2`（本机安装包 app.asar 实测）。
 *
 * 开关尺寸来源：以 macOS 窗口红绿灯（直径 12pt、圆心间距 20pt）标定参考截图，
 * 实测开关 72×32 px、滑块 26 px，换算得轨道 31×14 pt、滑块 11 pt、内缩 1.5 pt。
 * 这与 iOS 开关的 51×31（1.65:1）不是一回事 —— 新版 macOS 是 2.25:1 的扁长比例。
 *
 * 材质说明：左侧用的是 **Web 磨砂**（`backdrop-filter` 模糊面板背后的应用内容），
 * **不是** Apple 原生材质。设置面板是居中模态框，背后是应用自己的不透明中间栏，
 * 不是桌面；主窗口的原生 vibrancy 由官方用在主侧栏（`vibrancy: "sidebar"`）。
 * 按 docs/phase-2-appearance-roadmap.md §7 的约定，这里不得标注成「原生 Liquid Glass」。
 *
 * 已知做不到的一项：官方设置分区里没有 `<section>`、没有标题元素、也没有 data 属性，
 * 每行都是各插件包自己渲染出来的哈希类名 div，所以「把几行包成一张圆角卡片」这种
 * 分组卡片外观无法用语义锚点表达，本文件没有实现（行间发丝线仍由官方样式负责）。
 */

const CSS = `
/* ── 面板拆成左右两块 ──────────────────────────────────────────────
 * 官方把整块面板的底色写在面板本体上（background: var(--dsw-alias-bg-layer-2)），
 * 导航列和内容列都没有各自的背景 —— 所以 token 只能整块一起变，做不出左右分界。
 * 这里让面板本体让出背景，由左右两列各自负责，圆角与投影保持官方值。
 * 遮罩层保持官方原样：不做全屏模糊，面板直接浮现在应用内容之上。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] {
  --whale-mac-frost:color-mix(in srgb,var(--dsw-alias-bg-base) 52%,transparent);
  --whale-mac-hairline:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);
  background:transparent;
}
body[data-ds-dark-theme][data-whale-mac-settings] [data-shortcut-modal="settings"] {
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

/* 右侧内容列：保持不透明，阅读、输入和滚动不受影响。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] > nav + div {
  background:var(--dsw-alias-bg-layer-2);
}

/* ── 左侧导航项：macOS 侧栏的行高与圆角 ─────────────────────────────
 * 参考截图实测：行高 28pt、圆角约 6.5pt。这里只调几何，未选中项的悬停底色
 * 仍由官方 token 决定。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] nav button {
  height:28px;
  padding:0 8px;
  border-radius:6px;
  font-size:13px;
  transition:background-color 120ms ease;
}

/* 选中项：主题强调色实色填充 + 反色文字与图标。
 * --dsw-alias-brand-primary 是本插件主题派生的 accentFill（对底色对比度不低于 3），
 * --dsw-alias-label-primary-foreground 是同一套派生算出的 onAccent（在 accentFill 上
 * 可读的前景色）。两者都由 ctx.theme.overrideTokens 写入，所以 27 套主题各自成立。
 * 图标走 currentColor，改 color 即可一并反色；选中项按 macOS 惯例加粗。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] nav button[aria-current="true"] {
  background:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-foreground);
  font-weight:600;
}

/* ── macOS 风格开关：只改形状，颜色全交给主题 ────────────────────────
 * 官方基元是 <button role="switch" aria-checked><span/></button>。
 * 官方几何：36×20、内缩 2px、滑块 16px、开启态 translateX(16px)。它的开启态底色是
 * --dsw-alias-brand-primary，也就是本插件主题的 accentFill —— 所以「开启态跟主题色」
 * 本来就是官方行为，这里一个颜色声明都不写。
 * 只把几何换成 macOS 参考值：31×14、内缩 1.5px、滑块 11px。
 * 行程随之变成 31-1.5*2-11 = 17px，因此必须同步覆盖官方那条 translateX(16px)。 */
body[data-whale-mac-settings] [data-shortcut-modal="settings"] [role="switch"] {
  width:31px;
  height:14px;
  padding:1.5px;
  transition:background-color 200ms cubic-bezier(.22,.61,.36,1);
}
body[data-whale-mac-settings] [data-shortcut-modal="settings"] [role="switch"] > span {
  width:11px;
  height:11px;
  box-shadow:0 1px 2px #00000033,0 0 0 .5px #00000012;
  transition:transform 200ms cubic-bezier(.22,.61,.36,1);
}
body[data-whale-mac-settings] [data-shortcut-modal="settings"] [role="switch"][aria-checked="true"] > span {
  transform:translateX(17px);
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
}
@supports not (backdrop-filter:blur(1px)) {
  body[data-whale-mac-settings] [data-shortcut-modal="settings"] > nav {background:var(--dsw-alias-bg-layer-1)}
}
`;

module.exports = { CSS };

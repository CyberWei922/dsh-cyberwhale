# Windows 设置界面开发说明

为 dsh-cyberwhale 开发一套模仿 WinUI 3 的 Windows 设置界面，用 CSS 实现视觉效果，继续使用 Harness 的控件和设置逻辑。macOS 版本的视觉已经确定，请保留现有效果。

## 当前入口

客户端已自动读取 Harness 在 `<html>` 上提供的 `data-platform`，按当前客户端系统选择设置样式。它与插件服务端所在系统无关，远程连接也以客户端标记为准。

| 客户端标记 | 启用外观美化时的入口 | 当前效果 |
| --- | --- | --- |
| `darwin` | `body[data-whale-settings-platform="macos"]`，同时保留 `data-whale-mac-settings` | 已完成的 macOS 界面 |
| `win32` | `body[data-whale-settings-platform="windows"]` | Windows 样式文件为空，保留 Harness 官方设置布局和控件 |
| 未提供或其他值 | 不添加平台样式属性 | Harness 官方设置界面 |

关闭「启用外观美化」或卸载插件会移除平台样式属性；系统标记延迟出现或变化时会重新选择入口。Windows 当前仍使用已有的共享配色、字体和背景功能；“官方界面”指没有额外的 Windows 设置布局和控件外形覆盖。

| 文件 | 职责 |
| --- | --- |
| `client/settings-windows-css.js` | Windows CSS 扩展入口，目前导出空字符串；主要开发位置 |
| `client/settings-macos-css.js` | 已确认的 macOS 样式 |
| `client/settings-css.js` | 汇总两套 CSS，由客户端统一注入 |
| `client/settings-platform.js` | 客户端系统识别、样式属性和清理 |
| `client/appearance-runtime.js` | 应用主题、监听系统标记及资源清理 |
| `client/appearance-css.js` 与 `client/index.js` | 跨平台共享的插件页面和控件布局 |
| `lib/client.js` | 构建产物，由构建脚本生成 |

两套 CSS 会一起打包，但只有符合平台作用域的规则生效。开发者无需另写安装时的系统判断，也无需增加用户手动切换选项。

## 样式作用域

所有 Windows 设置规则都必须以这个范围开头：

```css
body[data-whale-settings-platform="windows"] [data-shortcut-modal="settings"]
```

`settings-windows-css.js` 使用 CommonJS，示例入口如下；实际声明填写在 `CSS` 内：

```js
'use strict';
const PANEL = 'body[data-whale-settings-platform="windows"] [data-shortcut-modal="settings"]';
const CSS = `
/* 在这里写入带有 PANEL 作用域的 Windows 样式。 */
`;
module.exports = { CSS };
```

深色选择器应同时限定平台和主题：

```css
body[data-ds-dark-theme][data-whale-settings-platform="windows"] [data-shortcut-modal="settings"]
```

系统或插件要求减少透明效果时，运行时会添加 `body[data-whale-settings-reduced]`。Windows 实色回退可直接使用 `body[data-whale-settings-platform="windows"][data-whale-settings-reduced]` 作为作用域，无需新增配置或监听器。

可使用的现有锚点：

| 元素 | 在 `PANEL` 下追加的选择器 |
| --- | --- |
| 左侧导航 | `> nav` |
| 当前导航项 | `nav button[aria-current="true"]` |
| 右侧内容 | `> nav + div` |
| 右侧顶栏 | `> nav + div > div:first-child` |
| 内容滚动区域 | `> nav + div > div + div` |
| 开关与滑块 | `[role="switch"]`、`[role="switch"] > span` |
| 开关状态 | `[aria-checked="true"]`、`[aria-checked="false"]` |
| 插件设置行 | `.dsh-appearance-row`、`.dsh-whale-row` |
| 主题卡片 | `.dsh-appearance-card` |

优先使用语义属性和插件自己的类名。Harness 生成的 CSS Module 类名会随构建变化，不应写入样式；不要移动或替换官方 React 节点。当前右侧标题复制仅用于 macOS，Windows 若需要添加当前分区标题，应单独实现 Windows 标题处理，并在关闭美化和卸载时恢复。

## WinUI 3 视觉要求

以微软官方 WinUI 3 Gallery 的 NavigationView、ToggleSwitch、Button、ComboBox、TextBox 等控件为参照。Gallery 提供实际交互示例，可用于比对浅深主题和各状态。[微软 NavigationView 文档](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/navigationview)

1. **导航和层次**：保留左导航、右内容的结构。建议用柔和的中性色背景标示选中项，并以主题强调色绘制短竖条；悬停与按下分别有轻微变化。内容使用清晰的页面标题、分组标题和设置卡片，避免文字或控件与导航混为一体。这是本项目建议的视觉方向，具体间距以 Gallery 和页面内容调整。
2. **字体**：系统默认模式参考 Segoe UI Variable，回退 Segoe UI 与中文系统字体；用户已选择的自定义字体继续生效。正文可参考 14/20、说明 12/16、分区标题 20/28 的字号和行高，标题使用 600 字重。采用 CSS 逻辑像素，不手动乘 Windows 缩放比例。[微软字体规范](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography)
3. **圆角和边界**：普通按钮、输入框和导航背景参考 4px 圆角，设置弹窗参考 8px；保留相接区域的直边。卡片圆角与间距可按视觉层级调整。边界细而清晰，阴影克制。[微软几何规范](https://learn.microsoft.com/en-us/windows/apps/design/style/rounded-corner)
4. **开关**：参考 WinUI ToggleSwitch 的圆形滑块、关闭态边框和开启态强调色；维持现有修改后立即生效的行为。保留可访问名称、`aria-checked`、禁用态和键盘操作，状态不能只靠颜色区分。具体尺寸和滑块行程以 Gallery 比对，扩大点击范围时避免覆盖相邻控件。[微软开关规范](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/toggles)
5. **材质**：参考 Mica 的柔和底色与内容层次。Mica 本身是不透明的窗口背景材质，带主题和壁纸色调；本次 CSS 可用低对比底色、细描边和轻微色调变化模拟。普通 CSS 无法获得原生 Mica 的桌面壁纸采样能力，不要求修改 Harness 原生窗口。若增加 Web 模糊，必须提供减少透明和不支持模糊时的实色回退。[微软 Mica 规范](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)

强调色和表面色继续使用共享主题变量，例如 `--dsw-alias-brand-primary`、`--dsw-alias-state-business-primary`、`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-border-l2`。Windows 专用变量建议用 `--whale-win-*` 前缀。不要强制全页面使用固定蓝色或黑白配色；自定义主题也应保持可读性。

按钮、输入框、选择器、开关均需覆盖普通、悬停、按下、选中、键盘焦点和禁用状态。保留 `:focus-visible`、`prefers-reduced-motion`、`forced-colors` 的适配；如添加透明效果，同时尊重插件减少透明开关和系统偏好。窄窗口允许设置行换行或调整列宽，所有导航项和控件仍须可达。

## 开发和验收

建议先实现 Windows 设置弹窗、导航和通用控件，再完成主题页、桌宠页和通用页的卡片与间距。将新增的 Windows 覆盖集中在 Windows 文件；必须变更共享文件时，补充 macOS 回归验证。保留原有自动保存、主题切换、字体设置和桌宠逻辑。

```sh
npm run build:client
npm test
npm run verify:mac-settings-anchors
npm run verify:mac-settings-render
```

渲染检查需要可用的 Playwright 模块和 Harness 安装包，可通过 `DSH_TEST_BROWSER_MODULE`、`DSH_TEST_ASAR` 指定路径。官方锚点检查可使用 `DSH_APP_ASAR`；没有安装包时会跳过该项。刷新或重启 Harness 后加载新的 `lib/client.js`，不要直接手改构建产物。

当前平台测试包含“Windows CSS 为空”和“Windows 渲染与官方样式一致”的占位断言。正式加入 WinUI 样式后，请将这两类断言改成 Windows 样式验收；继续保留平台互不影响、禁用和卸载清理、未知系统回退的检查。相关文件是 `tools/test-settings-platform.mjs` 和 `tools/verify-mac-settings-render.mjs`。macOS 的视觉与行为检查应继续通过。

交付时提供 Windows 实机浅色、深色截图，至少覆盖通用、主题、桌宠三个分区，以及开关关闭／开启／禁用和键盘焦点。检查 100%、125%、150%、200% 系统缩放与窄窗口，确认无裁切或横向溢出。验证修改会保存、重开仍保留、关闭美化恢复官方样式、macOS 外观不受影响。浏览器模拟 `win32` 可以验证路由和 CSS，Windows 字体、系统缩放和真实桌面材质仍以实机验收为准。

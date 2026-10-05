# 主题预设来源

当前有 **27 个选项：浅色 10 个、深色 17 个**。其中 25 个对应 Codex 的 16 组主题，另有两个蓝鲸原创配色。浅色和深色分别选择，选择后整套应用并自动保存；只有深色版本的主题不会出现在浅色列表中。

## 配色与版本

Codex 默认浅深配色使用 [官方 Appearance 文档](https://learn.chatgpt.com/docs/reference/settings#appearance) 公开的背景、正文和强调色。

其余开源主题使用 `@shikijs/themes 4.5.0` 的公开数据。23 个变体的背景、正文和强调色已对照本机 Codex `26.928.31416` **外观设置使用的主题变体**核对；没有复制 Codex Desktop 的设置页面或主题引擎。颜色为静态数据，插件运行时不会下载主题或依赖 Shiki。

| 主题 | 浅色变体 | 深色变体 | 原始许可 |
|---|---|---|---|
| Codex | 官方默认 | 官方默认 | 官方文档公开色值参考 |
| Ayu | — | `ayu-dark` | MIT |
| Catppuccin | `catppuccin-latte` | `catppuccin-mocha` | MIT |
| Dracula | — | `dracula` | MIT |
| Everforest | `everforest-light` | `everforest-dark` | MIT |
| GitHub | `github-light-default` | `github-dark-default` | MIT |
| Gruvbox | `gruvbox-light-medium` | `gruvbox-dark-medium` | MIT |
| Material | — | `material-theme-darker` | Apache-2.0 |
| Monokai | — | `monokai` | MIT |
| Night Owl | — | `night-owl` | MIT |
| Nord | — | `nord` | MIT |
| One | `one-light` | `one-dark-pro` | MIT，两个作者分别声明 |
| Rose Pine | `rose-pine-dawn` | `rose-pine-moon` | MIT |
| Solarized | `solarized-light` | `solarized-dark` | MIT |
| Tokyo Night | — | `tokyo-night` | MIT |
| VS Code Plus | `light-plus` | `dark-plus` | MIT |
| 蓝鲸 | 晨雾 | 深海 | 本项目 MIT |

基础色值在 [appearance-model.cjs](../lib/appearance-model.cjs) 中维护。现有 `codex`、`latte`、`mocha`、`github`、`dracula`、`whale` 标识与色值保持兼容；新增主题不会改写用户已经保存的颜色、字体或壁纸。

Harness 的控件、卡片、菜单和边框由本项目根据三种基础色派生，并自动修正低对比度的文字及开关颜色。因此“同款”指基础配色和对应变体，不表示两款软件的所有控件、语法高亮或布局完全相同。语义状态色继续由 Harness 提供。

## 许可与本批范围

[Shiki 官方说明](https://shiki.style/themes) 明确要求按主题各自的原始许可处理。完整原作者声明保存在 [theme-palettes.txt](../LICENSES/theme-palettes.txt)，来源为 [tm-themes NOTICE 的固定提交](https://github.com/shikijs/textmate-grammars-themes/blob/37edd1b26f18838050661d912334aba0ca7f4931/packages/tm-themes/NOTICE)。Material 的 Apache-2.0 许可与其余 MIT 主题分别保留。

本批未加入 Absolutely、Linear、Lobster、Matrix、Notion、OG、Oscurange、Proof、Raycast、Sentry、Temple、Vercel、Xcode。它们在本机 Codex 中存在，但本次尚未确认对应配色数据的独立公开许可；其他同名项目或 Raycast `ray-so` 的许可不自动覆盖 Codex 安装包里的主题资源。后续找到明确的公开来源后可继续补充。

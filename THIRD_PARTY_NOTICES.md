# 第三方声明

本项目的代码以 MIT 发布（见 `LICENSE`）。以下列出开发过程中参考过的外部成果，
以及它们的许可与使用方式。

> **关于美术资产**：`assets/spritesheet.*`、`assets/portrait.png`、`assets/icon.png`
> 都是本项目自制的角色素材，随代码以**同一 MIT 许可**发布。本项目**不包含任何
> 第三方的美术资产**。这一说明原先附在 `LICENSE` 末尾，后来移到本文件 ——
> 在标准 MIT 正文后追加内容会让 GitHub 的许可证识别退化成 `NOASSERTION`。

---

## 1. 规格来源：OpenAI `hatch-pet` skill

**许可：Apache License 2.0**

本项目的**图集规格**（8 列 × 11 行、单元格 192×208、`spriteVersionNumber: 2`、
16 个注视方向的行号与角度定义、每行用到的列数与逐帧时长）转述自 OpenAI 随
ChatGPT/Codex Desktop 分发的 `hatch-pet` skill：

- `references/codex-pet-contract.md`
- `references/animation-rows.md`
- `references/qa-rubric.md`
- `SKILL.md`

该 skill 目录下附有 Apache-2.0 许可证全文。

**使用方式**：本项目**只转述了规格与事实性参数**，未复制其脚本或文档原文；
`docs/pet-sprite-task-brief.md` 与 `docs/pet-asset-spec.md` 是面向本项目素材生产的
改编任务书。

---

## 2. 逻辑参考：`openai/codex` 的宠物引擎

**许可：Apache License 2.0**（仓库根 `LICENSE`，`codex-rs` 各 crate 声明
`license.workspace = true` → Apache-2.0）

参考文件：

- `codex-rs/tui/src/pets/model.rs` —— 动画状态机、行内帧数与时长、瞬态回落语义
- `codex-rs/tui/src/pets/asset_pack.rs` —— 素材获取/校验/原子安装流程
- `codex-rs/tui/src/pets/catalog.rs` —— 帧几何常量

**使用方式**：本项目的 `lib/state.js` 与 `helper/renderer/pet.js` 中的动画表是
**按上述规范用 JavaScript 重写**的，不是逐行翻译；未复制任何 Rust 源码文本。
内置宠物美术（`codex-spritesheet-v4.webp` 等）**未使用**，它们不属于 Apache-2.0 覆盖范围。

---

## 3. 窗口行为参考：`PC2005-cloud/dsh-pet`

**许可：MIT**

参考内容：宿主插件通过子进程拉起独立 Electron 助手、stdio JSON 行协议、
`setAlwaysOnTop(true, 'screen-saver')` 与 `setVisibleOnAllWorkspaces` 组合、
默认整窗穿透后按命中区翻转 `setIgnoreMouseEvents` 的做法。

**使用方式**：仅参考架构与公开的 Electron API 用法，代码为独立实现。
未复制其源码文本，也未使用其透明视频素材。

---

## 4. 其他被调研过的项目（均未使用其代码或素材）

| 项目 | 许可 | 备注 |
|---|---|---|
| `ntd4996/agentpet` | MIT | 原生 Swift `NSPanel` 做法参考 |
| `BinaryFroggy/Hopet` | MIT | 双档置顶、Codex 图集解析思路参考 |
| `fredruss/agent-paperclip` | MIT | 未使用 |
| `HaneulOscarLee/claude-pet` | MIT | 图集几何常量交叉验证 |
| `yigefw245/codex-live2d` | **无 LICENSE** | **未参考、未使用** |

---

## 5. 明确未使用的资产

- **OpenAI 的内置宠物美术**（`persistent.oaistatic.com` 上的 spritesheet）：
  属 OpenAI 专有资产，本项目不打包、不分发。
- **ChatGPT/Codex Desktop 的应用代码**：闭源专有。本项目仅通过观察其公开行为
  （窗口层级、穿透策略、拖拽联动）来设计自己的实现，未复制任何源码文本。
- **"Codex" / "ChatGPT" 名称与标识**：商标。本项目不使用官方图标；文档及预设名称
  中的引用仅用于说明参考来源，不表示官方关联。

---

## 6. Electron

本项目的助手窗口运行在 Electron 上。Electron 由用户本机已有的运行时提供
（`@electron/get` 缓存、本地安装，或 `DSH_DESKPET_ELECTRON` 指定的可执行文件），
本项目**不再分发** Electron 二进制。

Electron 许可：MIT。

## 7. 第二阶段主题预览

- **Material Color Utilities 0.4.0**，Copyright 2021 Google LLC，Apache-2.0。
  图像量化、主色评分和浅深配色算法打包进 `lib/client.js`，保留上游版权注释；
  完整许可见 `LICENSES/material-color-utilities.txt`。
  来源：https://github.com/material-foundation/material-color-utilities 。
- **Codex 配色参考**：仅使用官方 Appearance 文档公开的强调、背景、正文色值和布局参考，
  没有复制 Codex Desktop 源码。公开的 `openai/codex` 仓库为 Apache-2.0，主要为 CLI。
  来源：https://learn.chatgpt.com/docs/reference/settings#appearance 。
- **开源主题配色**：Ayu、Catppuccin、Dracula、Everforest、GitHub、Gruvbox、Monokai、
  Night Owl、Nord、One、Rose Pine、Solarized、Tokyo Night、VS Code Plus（MIT），
  Material Darker（Apache-2.0）。使用 `@shikijs/themes 4.5.0` 公开数据中的背景、正文
  和强调色，与本机 Codex `26.928.31416` 的对应外观预设核对。Harness 的角色映射和
  对比度修正为本项目实现，不包含完整编辑器主题、语法高亮表或 Codex 主题引擎。
  完整上游版权与许可见 `LICENSES/theme-palettes.txt`；版本、具体变体和来源见
  [主题预设来源](docs/theme-presets.md)。主题各自的许可按原作者声明保留，
  不将 Shiki 的 MIT 许可笼统套用到所有主题。
  来源：https://github.com/shikijs/shiki ，https://github.com/shikijs/textmate-grammars-themes 。
- **esbuild 0.28.2**（MIT）：仅开发构建工具，不包含运行时二进制。

蓝鲸配色和渐变为本项目自行设计。上述预设不是对 Codex 内置全部主题的兼容承诺。

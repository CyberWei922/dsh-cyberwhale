# 第三方声明

本项目的代码以 MIT 发布（见 `LICENSE`）。以下列出开发过程中参考过的外部成果，
以及它们的许可与使用方式。

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
- **"Codex" / "ChatGPT" 名称与标识**：商标。本项目不使用；文档中仅在描述格式
  兼容性时做事实性提及。

---

## 6. Electron

本项目的助手窗口运行在 Electron 上。Electron 由用户本机已有的运行时提供
（`@electron/get` 缓存、本地安装，或 `DSH_DESKPET_ELECTRON` 指定的可执行文件），
本项目**不再分发** Electron 二进制。

Electron 许可：MIT。

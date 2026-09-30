# 开发与贡献

用户安装与操作见 [README](../README.md)。本文件面向修改代码、制作素材和验证跨平台行为的贡献者。

## 开始开发

需要 Node.js 22 或更新版本。仓库已提交 `lib/client.js` 和正式图集；安装和运行插件不需要先构建。

```bash
npm run build            # 从 client/index.js 生成 lib/client.js
npm test                 # 宿主、客户端、素材契约、状态、几何、平台和回归测试
```

`npm run build` 只构建客户端，不生成或覆盖正式图集。`npm run build:placeholder-atlas` 会生成占位素材并覆盖图集，仅适合明确需要占位素材的开发场景。

测试中的宿主服务使用 mock；部分词典对照依赖本机安装的 Harness，未找到时会跳过。平台分支测试能检查路径和命令，不等于另一操作系统的真机验证。

## 项目结构

| 路径 | 职责 |
|---|---|
| `lib/index.js` | 订阅 Harness 事件、管理状态同步、提供设置接口 |
| `lib/state.js` / `lib/activity.js` | 动画状态机、任务气泡文案 |
| `lib/bridge.js` | 受管子进程和消息传输 |
| `lib/settings.js` | 设置归一化及串行原子保存 |
| `lib/electron-runtime.js` / `lib/electron-provision.js` / `lib/orphans.js` | 运行时查找与解包、运行时下载校验、遗留进程清理 |
| `client/index.js` | 「设置 → 桌宠」界面源码 |
| `helper/main.js` / `helper/preload.js` | Electron 窗口、拖拽、IPC 和原生菜单 |
| `helper/renderer/` | 动画、注视、气泡和命中区 |
| `assets/` | 正式角色素材和图集 |
| `tools/` | 构建、素材处理和验证工具 |

## 工作原理

插件通过 Harness 的公开服务订阅任务事件，再通过 `ctx.subprocess` 启动独立 Electron 助手窗口。设置页通过插件自注册的 `/deskpet` 路由读写偏好；路由先调用官方连接服务完成请求鉴权。

Electron 运行时不在安装包里。`lib/electron-provision.js` 负责把它准备好：先复用本机已有运行时或 `@electron/get` 缓存，否则从官方源下载 `electron-v<版本>-<平台>.zip`、用同源 `SHASUMS256.txt` 校验 SHA-256，再经 staging 解包后替换目标目录。官方源失败时自动改用国内镜像重试。宿主半区把它包成 `prepareRuntime` / `cancelRuntime` 两个 RPC 端点，设置页据此显示进度与取消按钮；`tools/ensure-electron.mjs` 是同一模块的命令行外壳。

macOS 使用 stdin 下发消息，Windows 使用 subprocess 的 control pipe（fd 7），上行都使用 stdout JSON Lines。助手就绪或自动重启后重新同步配置、任务状态和气泡。卸载时结束受管进程，启动时清扫遗留助手。

气泡显示会话标题和当前任务状态，数据来自回合及工具事件；不收集或展示 reasoning token 原文。任务结束会清空实时气泡，长任务不会仅因没有新事件而被判断为空闲。

进一步的官方接口核对见 [技术核实记录](tech-verification.md)，Windows 实现依据与真机证据见 [Windows 适配说明](windows-adaptation.md)。

## 跨平台协作

macOS 和 Windows 已合入同一 `main`，不维护两套插件包。新增改动请使用功能分支，通过 PR 合入。

- 通用状态、文案和素材可共用；涉及路径、窗口、输入、显示器、通信和进程生命周期时，需要检查平台差异。
- 修复 Windows 时保留 macOS 行为，反之亦然；确实需要修改公共代码时，补充两端的验证依据。
- 图集是二进制文件，修改前协调素材版本，避免并行改动产生无法自动合并的冲突。
- 仓库通过 `.gitattributes` 统一 LF，不提交系统临时文件和生成过程目录。
- 在 PR 中说明验证系统、Harness 和 Electron 版本，以及尚未覆盖的场景。

`binaryRelativePath`、`artifactSuffix`、`electronCacheRoot` 和 `extractionPlan` 等接受平台参数，便于在本机检查各平台的路径与命令。Windows 额外使用主进程命中轮询、控制管道和进程树清理。

## 桌面验证

以下脚本目前使用 macOS 的 Electron 路径，需要图形桌面环境；它们不属于跨平台通用测试：

```bash
npm run verify:gaze
npm run verify:bubble-placement
npm run verify:bubble-render
npm run verify:bubble-motion
```

脚本会启动测试窗口。注视验证注入测试光标，不移动用户真实鼠标；气泡验证覆盖边缘避让、深浅外观、原生窗口裁剪和移动过程中的连续动画。

Windows 的真机验证与未覆盖场景见 [windows-adaptation.md](windows-adaptation.md)，安装和调试方式见 [windows-install.md](windows-install.md)。

## 修改素材与动画

正式图集为 `assets/spritesheet.png`，8 列 × 11 行、每格 192 × 208，总计 71 个素材帧。其中「干活中」使用 4 帧端碗扒饭动画。

```bash
node tools/assemble-atlas.mjs <帧目录> --dry-run
node tools/assemble-atlas.mjs <帧目录> --out assets/spritesheet.png
node tools/check-consistency.mjs <帧目录>
```

请保留透明通道，统一角色大小和落脚位置，避免把每帧单独缩放。规格见 [图集规范](pet-asset-spec.md)，动作表见 [素材任务书](pet-sprite-task-brief.md)；历史重制要求中已经标注新版覆盖的部分。

当前招手为自然屈肘、小幅左右摆动，播放约 2.6 秒后停在收手帧；待机眨眼约每 6 秒一次。素材生成记录见 [自然招手说明](waving-v5.md)。修改播放时序后，请同步状态机、渲染层、规格和相应测试。

气泡的文字、背景及尾巴通过 CSS 变量统一配色，修改后检查深浅外观，避免背景变了而字色未跟随。

气泡固定宽度为 323px，透明窗口左右各预留让位空间。屏幕避让同时检查窗口的实际绘图区；位置随窗口移动同步，渲染层用临界阻尼弹簧连续移动和翻转。保存的位置继续沿用原来窄窗口的坐标，以保持已有桌宠位置。

## 提交改动

提交前运行适合本次改动的检查。代码修改通常需要 `npm test`；窗口或渲染变化还需要对应系统的真机验证。纯文档修改检查命令、链接和表述即可。

请让 PR 描述围绕最终行为展开，写清问题、改动和验证结果。不要把仅在一台机器上验证的结果写成所有系统都已验证。

# dsh-cyberwhale 🐋

一只随 Harness 工作状态变化、陪你使用 [DeepSeek Harness 官方 Desktop](https://github.com/deepseek-ai/deepseek-harness) 的蓝色大肥鱼桌宠。

- 随任务切换动作，气泡显示会话标题和当前进度。
- 支持拖动、打招呼、调整大小和记住位置。
- 待机时眼睛跟随鼠标；气泡和眼睛跟随均可关闭。

![招手动画预览](docs/images/greeting.gif)

*招手动作预览，桌面窗口为透明背景。*

支持 **macOS、Windows 11 x64**，已验证 Harness Desktop `0.2.0-rc.2`。其他 Windows 版本及 Linux 尚未验证。

## 安装

需要 [Harness Desktop](https://github.com/deepseek-ai/deepseek-harness)。先启动一次 Harness 完成初始化。

> 只有用下面的**命令行安装**才需要额外的 Node.js 22+ 和 `git`；应用内安装不需要它们 —— 安装、下载运行时都由 Harness 自己完成。

**1. 在 Harness 里安装插件**

侧栏 → **插件** → **添加插件**，下面三选一填进输入框：

| 填什么 | 内容 |
|---|---|
| npm 包名（最省事） | `dsh-cyberwhale` |
| 仓库地址 | `https://github.com/CyberWei922/dsh-cyberwhale` |
| 压缩包 | [Releases](https://github.com/CyberWei922/dsh-cyberwhale/releases) 里 `.tgz` 的直链或本地路径 |

点**安装**，装完点**立即启用**。安装源保持默认即可。

`git` 不可用或访问不了 GitHub 时用 npm 包名；npm 也不方便时（比如纯粹离线），到 Releases 下 `.tgz` 再粘本地路径。都装不上就改用命令行从本地目录安装，见下方折叠块。

**2. 准备运行环境**

桌宠需要一个独立的 Electron 运行时（100–150 MB，随平台而定），安装包里不含它。首次启动会**自动复用本机已有的 Electron 缓存**，缓存命中就什么都不用做；缓存里没有时，到 **设置 → 桌宠** 点 **准备运行时** —— 它会从官方源下载并校验，官方源不通时自动改用国内镜像，进度就在同一张卡上。

**3. 启用桌宠**

同一个设置页里打开**启用桌宠**，大肥鱼就会出现。

如果设置里没有「桌宠」，完全退出 Harness 再重新打开 —— 只关主窗口可能没有结束后台进程。

<details>
<summary>命令行安装（不常用，排障或离线时用）</summary>

```bash
git clone https://github.com/CyberWei922/dsh-cyberwhale.git
cd dsh-cyberwhale

node tools/ensure-electron.mjs        # 提前准备运行时，也可以之后在设置页点按钮

"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$PWD"
```

Windows 11 把最后一行换成：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "$($PWD.Path)"
```

这种方式用 `link:` 指向你的工作目录，适合改代码；改完重启 Harness 即可看到效果。命令使用 Harness 的默认安装位置，自定义安装请替换路径。

</details>

## 使用

| 操作 | 效果 |
|---|---|
| 按住身体拖动 | 移动桌宠 |
| 右键 → 打个招呼 | 播放招手动画 |
| 设置 → 桌宠 | 调整大小、开关气泡和眼睛跟随、隐藏桌宠 |
| 设置 → 桌宠 → 重置位置 | 找回移到边缘的桌宠 |

眼睛跟随只在待机、鼠标停在身体上时生效，最多持续 10 秒。退出 Harness 时桌宠一起退出。

## 常见问题

- **没有设置页？** 确认安装成功，完全退出并重开 Harness。
- **桌宠没出现？** 看设置页的运行状态和错误提示；提示缺少运行环境时点**准备运行时**，位置异常时点**重置位置**。
- **插件页说安装失败？** 见 [使用与排障](docs/usage.md)。
- **更新怎么做？** 插件目前不支持自动升级：在插件页卸载后重新安装新版，再完全重开 Harness。

[更多排障与卸载说明](docs/usage.md) · [Windows 安装指南](docs/windows-install.md) · [分发与发布](docs/distribution.md) · [反馈问题](https://github.com/CyberWei922/dsh-cyberwhale/issues)

目前多会话共用桌宠状态；Windows 混合 DPI 拖拽、热插拔等场景尚未充分验证。详见 [验证范围](docs/windows-adaptation.md#5-明确未验证的部分)。

## 贡献与许可

[开发指南](docs/development.md) · [MIT License](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)

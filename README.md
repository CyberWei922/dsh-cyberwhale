# dsh-deskpet 🐋

一只陪你使用 [DeepSeek Harness 官方 Desktop](https://github.com/deepseek-ai/deepseek-harness) 的鲸鱼少女桌宠。

- 随任务切换动作，气泡显示会话标题和当前进度。
- 支持拖动、打招呼、调整大小和记住位置。
- 待机时眼睛跟随鼠标；气泡和眼睛跟随均可关闭。

![招手动画预览](docs/images/greeting.gif)

*招手动作预览，桌面窗口为透明背景。*

支持 **macOS、Windows 11 x64**，已验证 Harness Desktop `0.2.0-rc.2`。其他 Windows 版本及 Linux 尚未验证。

## 安装

需要先安装 Harness Desktop 和 [Node.js 22+](https://nodejs.org/)。启动一次 Harness 完成初始化，然后**完全退出应用**。

**1. 下载项目**

```bash
git clone https://github.com/CyberWei922/dsh-deskpet.git
cd dsh-deskpet
```

也可用 **Code → Download ZIP** 下载，解压后进入该文件夹。安装后请保留目录位置，无需构建或生成素材。

**2. 按系统执行安装命令**

<details>
<summary>macOS：在终端运行</summary>

```bash
node tools/ensure-electron.mjs

"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$PWD"
```

</details>

<details>
<summary>Windows 11 x64：在 PowerShell 运行</summary>

```powershell
node tools/ensure-electron.mjs --version 40.10.2

& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "$($PWD.Path)"
```

</details>

命令使用 Harness 的默认安装位置；自定义安装请替换路径。Electron 准备脚本会优先复用本机运行时或缓存，没有时才下载。

**3. 重新打开 Harness → 设置 → 桌宠 → 启用桌宠。**

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
- **桌宠没出现？** 检查启用开关和设置页错误提示；位置异常时尝试「重置位置」。
- **更新怎么做？** 退出 Harness，在插件目录运行 `git pull --ff-only`，再重新打开。

[更多排障与卸载说明](docs/usage.md) · [Windows 安装指南](docs/windows-install.md) · [反馈问题](https://github.com/CyberWei922/dsh-deskpet/issues)

目前多会话共用桌宠状态；Windows 混合 DPI 拖拽、热插拔等场景尚未充分验证。详见 [验证范围](docs/windows-adaptation.md#5-明确未验证的部分)。

## 贡献与许可

[开发指南](docs/development.md) · [MIT License](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)

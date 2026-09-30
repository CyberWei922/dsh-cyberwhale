# 使用与排障

基础安装见 [README](../README.md)。

## 更新与卸载

**更新：**插件目前不支持自动升级。在 Harness 的插件页卸载后重新安装新版，再完全退出、重新打开应用。

用命令行 `link:` 安装的开发用户，直接在插件文件夹执行 `git pull --ff-only` 即可，改完重启 Harness 生效。

**卸载：**在 Harness 的插件管理页面移除 `dsh-cyberwhale`，并完全退出、重新打开应用。只想暂时隐藏时，关闭桌宠开关即可。

## 常见问题

### 设置里没有「桌宠」

确认插件已安装并启用（插件页里该组合包处于开启状态）。安装后需要**完全退出再打开** Harness，只关闭主窗口可能没有结束后台进程。

### 有设置页，但桌宠没有出现

先检查「启用桌宠」开关和设置页里的运行状态、错误提示。若提示缺少运行环境，点这一行的**准备运行时**即可，失败时可以再点一次重试。若位置异常，尝试「重置位置」。

### 准备运行时下载失败或很慢

设置页的**准备运行时**会先从 Electron 官方源下载，官方源不通时会自动改用国内镜像，所以大多数情况下再点一次就好。

仍然失败时，可以在插件目录用命令行指定镜像：

```bash
node tools/ensure-electron.mjs --mirror https://registry.npmmirror.com/-/binary/electron
```

Windows 可追加 `--version 40.10.2`。准备完成后完全重启 Harness。代理、网络和 Windows 安装问题还可查看 [Windows 排障指南](windows-install.md#6-排障)。

### 鼠标移过去，眼睛为什么没有跟随？

确认「眼睛跟随」已开启、桌宠正在待机，并把鼠标移到她的身体上。任务进行中、打招呼时，或连续悬停超过 10 秒后，不会保持注视。

### 设置存在哪里？

默认位置：

- macOS：`~/.dsh/dsh-cyberwhale/settings.json`
- Windows：`%USERPROFILE%\.dsh\dsh-cyberwhale\settings.json`

如果配置了 `DSH_HOME`，则位于该目录下的 `dsh-cyberwhale/settings.json`。

## 当前限制与问题反馈

- 官方 Desktop 仍为预览版，本项目基于上述版本验证，后续 Harness 更新可能需要跟进。
- 多个会话同时运行时，桌宠共享同一状态，可能无法准确对应某一个会话。
- Windows 的混合 DPI 跨屏拖拽、显示器热插拔等场景尚未充分验证，详见 [Windows 验证范围](windows-adaptation.md#5-明确未验证的部分)。
- 点击区域按身体的矩形范围判断，透明边缘可能接管少量点击。

遇到问题请到 [GitHub Issues](https://github.com/CyberWei922/dsh-cyberwhale/issues) 反馈，并附上系统版本、Harness 版本、复现步骤和设置页中的错误信息；有截图会更容易定位。


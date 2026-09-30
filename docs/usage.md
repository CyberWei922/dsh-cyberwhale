# 使用与排障

基础安装见 [README](../README.md)。

## 更新与卸载

**更新：**完全退出 Harness，在插件文件夹执行：

```bash
git pull --ff-only
```

然后重新打开 Harness。使用 ZIP 安装的用户，请将新版文件覆盖到原来的插件目录。更新后保留相同路径；修改了路径则需要重新安装。

**卸载：**在 Harness 的插件管理页面移除 `dsh-deskpet`，并完全退出、重新打开应用。只想暂时隐藏时，关闭桌宠开关即可。

## 常见问题

### 设置里没有「桌宠」

确认安装命令已成功完成，并且使用了 `--profile desktop`。安装后需要**完全退出再打开** Harness，只关闭主窗口可能没有结束后台进程。

### 有设置页，但桌宠没有出现

先检查「启用桌宠」开关和设置页里的运行状态、错误提示。若提示找不到 Electron，请回到插件文件夹重新运行对应系统的准备命令，再重启 Harness。若位置异常，尝试「重置位置」。

### Electron 下载失败或很慢

可以换用镜像下载：

```bash
node tools/ensure-electron.mjs --mirror https://registry.npmmirror.com/-/binary/electron
```

Windows 可追加 `--version 40.10.2`。准备运行时后完全重启 Harness。代理、网络和 Windows 安装问题还可查看 [Windows 排障指南](windows-install.md#6-排障)。

### 鼠标移过去，眼睛为什么没有跟随？

确认「眼睛跟随」已开启、桌宠正在待机，并把鼠标移到她的身体上。任务进行中、打招呼时，或连续悬停超过 10 秒后，不会保持注视。

### 设置存在哪里？

默认位置：

- macOS：`~/.dsh/dsh-deskpet/settings.json`
- Windows：`%USERPROFILE%\.dsh\dsh-deskpet\settings.json`

如果配置了 `DSH_HOME`，则位于该目录下的 `dsh-deskpet/settings.json`。

## 当前限制与问题反馈

- 官方 Desktop 仍为预览版，本项目基于上述版本验证，后续 Harness 更新可能需要跟进。
- 多个会话同时运行时，桌宠共享同一状态，可能无法准确对应某一个会话。
- Windows 的混合 DPI 跨屏拖拽、显示器热插拔等场景尚未充分验证，详见 [Windows 验证范围](windows-adaptation.md#5-明确未验证的部分)。
- 点击区域按身体的矩形范围判断，透明边缘可能接管少量点击。

遇到问题请到 [GitHub Issues](https://github.com/CyberWei922/dsh-deskpet/issues) 反馈，并附上系统版本、Harness 版本、复现步骤和设置页中的错误信息；有截图会更容易定位。


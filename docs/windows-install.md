# Windows 安装与排障

面向 Windows 11 x64 + DeepSeek Harness **Desktop**。不需要外部 `unzip`，也不需要 Linux 工具链。

> 适配实现与真机验证证据见 [windows-adaptation.md](windows-adaptation.md)。

---

## 1. 前置

- DeepSeek Harness Desktop 已**启动过一次**（初始化 `%USERPROFILE%\.dsh\profiles\desktop`）。
- Node.js ≥ 22（只用于准备运行时/跑测试；DSH 自己不需要你的 Node）。
- 磁盘：Electron 运行时解包后约 350 MB。

## 2. 安装插件

推荐直接在应用内装：侧栏 → **插件** → **添加插件**，粘仓库地址或 `.tgz` 直链，装完点**立即启用**。
命令行方式（等价，排障或离线时用）：

```powershell
# 1) 完全退出 DSH Desktop（从托盘退出）

# 2) 用 Desktop 自带 CLI 装本地路径
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
    plugin --profile desktop add "D:\path\to\dsh-cyberwhale"
```

成功时 CLI 会：
- 在 `%USERPROFILE%\.dsh\profiles\desktop\package.json` 写入 `"dsh-cyberwhale": "link:D:/path/to/dsh-cyberwhale"`（依赖 key 是**包名**，本地目录叫什么不影响）；
- 把 `dsh-cyberwhale` 追加进 `dsh.profile.bundles`；
- 在 `profiles\desktop\node_modules\` 建一个指向仓库的 Junction。

## 3. 准备 Electron 运行时

**优先在设置页点**：重启 DSH Desktop → **设置 → 桌宠** → **准备运行时**。它会下载、校验 SHA-256、
staging 解包后替换，官方源不通时自动改用国内镜像。

**多数情况下不用手动做**：插件启动时按 ① `DSH_DESKPET_ELECTRON` ② `<插件>/runtime/electron`
③ `%USERPROFILE%\.dsh\dsh-cyberwhale\electron` ④ **`@electron/get` 本地缓存**
（`%LOCALAPPDATA%\electron\Cache`，命中即离线解包）⑤ `<插件>/node_modules/electron/dist` 顺序找。

设置页按钮失败、或想指定版本时再用命令行：

```powershell
cd D:\path\to\dsh-cyberwhale
node tools\ensure-electron.mjs                       # 默认 43.4.1
node tools\ensure-electron.mjs --version 40.10.2     # 指定版本
node tools\ensure-electron.mjs --force               # 强制重下（会替换已有运行时）
```

- 解包用 **Windows 自带 `tar.exe`**（Win10 1803+；失败自动退到 PowerShell `Expand-Archive`）。
- 下载后用官方 `SHASUMS256.txt` 校验 SHA-256；解包先完成 staging，再替换；安装失败时回滚，
  **解包失败不会破坏已有可用运行时**。
- 直连 GitHub 慢或被拦时换源：
  ```powershell
  node tools\ensure-electron.mjs --mirror https://registry.npmmirror.com/-/binary/electron
  # 或设 DSH_DESKPET_ELECTRON_MIRROR
  ```
- 复用本机已有 Electron：
  ```powershell
  $env:DSH_DESKPET_ELECTRON = 'D:\myapp\node_modules\electron\dist\electron.exe'
  ```

## 4. 打开桌宠

完全重启 DSH Desktop → **设置 → 桌宠** → 打开开关。

窗口出现在**光标所在那块屏幕**的右下角：透明、无边框、置顶、不进任务栏；
鼠标移到鲸鱼身上才接管点击，透明区域点击穿透，显示时不抢编辑器焦点。

设置存在 `%USERPROFILE%\.dsh\dsh-cyberwhale\settings.json`。

## 5. 验证清单

| 检查 | 方法 | 期望 |
|---|---|---|
| 窗口可见 | 眼睛看 | 鲸鱼浮在所有窗口之上 |
| 穿透 | 点鲸鱼旁边的透明区域 | 点到下面的窗口 |
| 可交互 | 移到鲸鱼身上再点 | 鲸鱼接管（拖动/右键有反应） |
| 拖拽 | 按住鲸鱼拖 | 窗口跟着走；松手后位置被记住 |
| 右键 | 在鲸鱼上点右键 | 原生菜单 |
| 缩放 | 设置页拖「显示大小」 | 就地缩放、不闪、不重启进程 |
| 注视 | 待机时把鼠标停到鲸鱼身上 | 眼睛跟着转（16 方向；离开或超 10 秒回待机） |
| 退出清理 | 退出 Desktop | 任务管理器里没有 `electron.exe` 残留 |

## 6. 排障

### 桌宠完全不出现
```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json"   # bundles 里要有 dsh-cyberwhale
Get-Item    "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-cyberwhale"
Test-Path   "$env:USERPROFILE\.dsh\dsh-cyberwhale\electron\electron.exe"
```

### 窗口出现但不显示鲸鱼
- 运行时损坏：删掉 `%USERPROFILE%\.dsh\dsh-cyberwhale\electron` 重新准备。
- 渲染层错误会经助手 stdout 转发到 DSH 日志（搜 `[deskpet/renderer]`）。

### 鼠标点不到鲸鱼
命中判定由**主进程**按全局光标轮询（40ms）负责（见 windows-adaptation.md 第 2.3 节）。

### 退出 DSH 后还有 electron.exe
```powershell
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*dsh-cyberwhale*' } |
  ForEach-Object { taskkill /PID $_.ProcessId /T /F }
```
（插件下次启动也会自动清扫。）

### 自己写脚本验证时结果诡异
Windows 上 DPI-unaware 进程会拿到**虚拟化坐标**（混合 DPI 下更乱）。
脚本开头加 `SetProcessDPIAware()`，或用仓库 `docs/windows-adaptation.md` 4.4 的说明排查。

### 单独调试助手窗口
```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& D:\electron-40.10.2\electron.exe D:\path\to\dsh-cyberwhale\helper `
    --assets=D:\path\to\dsh-cyberwhale\assets --scale=1 --look-at-cursor=1 --bubbles=1
```

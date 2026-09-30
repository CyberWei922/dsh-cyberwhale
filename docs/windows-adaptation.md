# Windows 11 x64 适配实现说明

> 本文件记录 dsh-cyberwhale 在 Windows 上的适配：官方 Harness 依据、每一处改动的位置与动机、
> 真机验证证据，以及**明确未验证**的部分。
>
> **状态**：Windows 适配已通过 PR #1 合入 `main`。本文保留 Windows 分支的实现与验证记录；合并时 macOS 的注视、气泡布局和渲染验证已通过。
> 遵守[跨平台协作约定](development.md#跨平台协作)：
> 只**新增** `win32` 分支、不动 darwin 路径、不碰 `assets/`。
>
> 验证环境（真机）：
> - Windows 11 x64；DeepSeek Harness Desktop `0.2.0-rc.2`（Electron 44.0.0，Host 端口 19387）
> - 双屏：主屏 1920×1080 @100%，副屏 2560×1600 @150%（DIP 1707×1067，原点 y=−45）
> - 助手运行时：Electron `40.10.2` win32-x64
> - 图集：`assets/spritesheet.png` = 1536×2288、**71 帧重制版**

---

## 1. 查到的官方源码位置

官方代码以 asar 打包在 Desktop 安装目录：

```
C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar
```

本文引用的文件都在 `app.asar` 内的 `dsh/node_modules/@deepseek-ai/` 下（读 asar 头即可解出：
8 字节头 + JSON 目录 + 偏移；参考实现见仓库外的 `asar-extract.cjs`）。

| 文件 | 作用 | 用到的结论 |
|---|---|---|
| `dsh-subprocess/lib/index.js` | `ctx.subprocess` 的 **Service Definition**（SubprocessSpawnSpec） | `scrubbedParentEnv()` 剔除 `KEY/PASSWORD/SECRET/TOKEN` 与 `DSH_*`；显式 `env` 在清除后合并 |
| `dsh-subprocess/lib/control.js` | 控制管道（fd 7）官方实现 | `SUBPROCESS_CONTROL_FD = 7`；`openInheritedControlChannel()` = `new Socket({ fd: 7, readable: true, writable: true, allowHalfOpen: true })` |
| `dsh-subprocess/README.zh.md` | seam 文档 | 「设置 `stdio.control: 'pipe'` 后，`handle.control` 会返回独立的原始 Duplex」 |
| `dsh-subprocess-local/lib/index.js` | 本地 subprocess 提供方 | `selectContainmentMode()`：Windows 普通进程走 `windows-job`（`probeWindowsJob()` 成功时），否则 `fallback`；`launchWindowsJob()` 用私有 runner 持有 Job |
| `dsh-subprocess-local/lib/runner-launch-*.js` | runner 启动 / 子进程环境 | `childEnv()`：Windows 下显式 `undefined` 是**墓碑**，会删掉继承来的同名项；`spawnRunnerInvocation()` = `[process.execPath, <runner.js>]`；`runnerStdio(spec, true, …)` 把目标 stdio 放 fd 4/5/6、IPC 在 fd 3、**控制管道在 fd 7** |
| `dsh-subprocess-local/lib/runner.js` | Windows Job runner | `CreateProcessW` 建目标、挂 kill-on-close Job，Job 清空才结算受管范围 |
| `dsh-win32-process/lib/index.js` | Win32 原语（koffi） | `spawnCurrentTokenJobProcess()` 里 `dwFlags: 257` = `STARTF_USESHOWWINDOW \| STARTF_USESTDHANDLES`、**`wShowWindow: 0` = SW_HIDE**；CreateFlags `1028 = CREATE_SUSPENDED \| CREATE_UNICODE_ENVIRONMENT`（不带 `CREATE_NO_WINDOW`） |
| `dsh-win32-process/README.zh.md` | 维护者文档 | 「进程创建在目标代码运行前设置 `STARTF_USESHOWWINDOW` 和 `SW_HIDE`」「已有的父进程控制台窗口不会被隐藏」 |
| `dsh-desktop-host/lib/index.js` | Desktop Host 入口 | Host 用 `loadProfileDirectory` + `runProfile` 起 desktop profile，Web 端口写死 `19387` |

---

## 2. 真机结论（决定了怎么改）

### 2.1 现有受管启动方式在 Windows 上**可用** —— 不另起启动方式

最小启动实验（真实 Desktop 自带 Harness 服务：cordis + 真实 `dsh-subprocess-local`）：

- 实走 **Windows Job runner** 路径（进程链：宿主 → `runner.js` → `electron.exe`），不是 fallback；
- 目标被 `SW_HIDE` 创建，但 **Electron 自己显式 show，窗口照常可见**：
  - `isVisible()`：`ready-to-show` 时 false → `showInactive()` 后 **true**；
  - `isFocused()` 在 `showInactive()` 后保持 **false**（不抢编辑器焦点）；
  - Win32 侧 `IsWindowVisible=true`、`cloaked=0`、rect 与 DIP 报告一致；
  - 截屏像素检查：测试块在屏幕上可数到 **6304** 个像素（真·可见，不只是 isVisible）。

**结论：沿用 `ctx.subprocess`，不引入第二种启动方式。**

### 2.2 Chromium 会丢掉 GUI 子进程的 stdin（Windows 专有）

- GUI 模式的 Electron 作为子进程启动时，`process.stdin` **立刻 EOF/close**，父进程之后写的数据永远到不了；
- 同一启动方式下 **fd 3 的额外管道可读**（说明不是所有句柄都被关，而是 fd 0 被重置）；
- 官方 seam 的**控制管道 fd 7 在 GUI 模式下可读可写**；宿主销毁端点时助手侧收到 END
  —— 与 stdin EOF 同义（"宿主没了就自退"）。

**改动**：Windows 上宿主→助手的下行消息改走 `stdio.control`（fd 7）；上行（助手→宿主）继续用 stdout。
macOS 继续用 stdin，一行没动。

### 2.3 Electron 的 `setIgnoreMouseEvents(true, {forward:true})` 在 Windows 上不可靠

同一份代码**有时**能把 mousemove 转发到渲染层、**有时完全收不到**（与 electron/electron#33281 一致；
转发实现是 `WH_MOUSE_LL` 低级鼠标钩子）。而且转发来的坐标会**过期/错误**（窗口内尤其明显），
用它做命中判定或注视方向都会乱。

**改动**：Windows 上穿透判定与光标位置改由**主进程**负责 —— 每 40ms 用
`screen.getCursorScreenPoint()`（与「眼睛跟随」同一条可靠路径）在命中区内判定，
再调同一个 `setInteractive()` 切穿透；渲染层不再驱动交互、也不再采纳 DOM mousemove 的光标值，
只在素材加载后上报一次 alpha 命中内缩比例。

---

## 3. 改动清单（13 个文件）

| 文件 | 改了什么 |
|---|---|
| `lib/bridge.js` | Windows：`stdio.control='pipe'`，下行消息走 `handle.control`；`#outbound()` 统一取通道；终止/释放走同一通道 |
| `helper/main.js` | Windows：主进程命中区轮询（40ms，`insetRect`+`rectContains`）、`pet:hit-inset` IPC、从 fd 7 读宿主消息、不调 `setVisibleOnAllWorkspaces`；新增 `display-removed/added/metrics-changed` → 重新夹回工作区 |
| `helper/preload.js` | 暴露 `config.platform` 与 `reportHitInset()` |
| `helper/renderer/pet.js` | Windows：不驱动 `setInteractive`、不采纳 DOM mousemove 光标；素材加载后上报 `hitInset` |
| `helper/geometry.js` | 新增纯函数 `insetRect()` / `rectContains()`（主进程与渲染层共用同一份命中区算术） |
| `lib/orphans.js` | Windows 孤儿清扫：CIM 查 `electron.exe` + `taskkill /T /F`（连 GPU/渲染子进程一起收）；命令行识别支持带引号形式；抽出可测的 `selectMatches()` / `isElectronCommand()` |
| `lib/electron-runtime.js` | 新增 `extractElectronZip()`（先解到 staging，确认可执行文件存在再原子替换 —— 损坏的包不会毁掉已有运行时）、`readRuntimeVersion()`；PowerShell 兜底加 `$ErrorActionPreference='Stop'` 与单引号转义（否则失败也会退出 0）；`resolveElectron()` 返回 `version` 且缓存路径不再覆盖已有运行时时 |
| `tools/ensure-electron.mjs` | SHASUMS256 解析修掉官方文件的 `*` 前缀；`--mirror` / `DSH_DESKPET_ELECTRON_MIRROR` 换源；`--version` 版本感知；改用 `extractElectronZip` |
| `tools/test-orphans.mjs`（新） | 命令行识别 / CIM 筛选 / 运行时解析契约 / 损坏包不覆盖，共 32 项 |
| `tools/test-host.mjs` | 跨平台化（伪 Electron 兜底、argv 断言、control 管道断言、启动条件轮询、Windows 版孤儿清扫实跑） |
| `tools/test-geometry.mjs` | 命中区算术（`insetRect`/`rectContains`）与包络尺寸断言 |
| `tools/test-platform.mjs` | Windows 主机上 win32 探针会成功 —— 按主机平台分支断言（其余仍验「报错按请求平台组织」） |
| `tools/test-regressions.mjs` | `new URL(...).pathname` → `fileURLToPath()`（Windows 上会给出 `/D:/...` 导致 spawn ENOENT） |

**没动的**：`helper/renderer/index.html`、`helper/renderer/pet.css`、`lib/settings.js`、`lib/state.js`、
`lib/activity.js`、`lib/index.js`、`client/`、`assets/`（图集）、`cordis.patch.yml`。

---

## 4. 真机验证证据

### 4.1 解析/环境（`test-platform.mjs`，Windows 主机）

- 三平台分支互不相同、未知平台抛错 ✓
- Windows 上 `tar` + PowerShell 兜底计划 ✓
- 真解包冒烟（当前平台真的打 zip 再解）✓

### 4.2 交互（真实 helper + 真实服务，外部 Win32 观测）

| 步骤 | 观测 | 结果 |
|---|---|---|
| 静止 | `exStyle=0x280028`（LAYERED+TRANSPARENT+TOPMOST）、`visible=true`、`cloaked=0`、rect=335×597（新包络） | ✓ |
| 悬停透明区 | `WS_EX_TRANSPARENT` 保持 → 点击穿透 | ✓ |
| 悬停人物 | `WS_EX_TRANSPARENT` 清除 → 接管鼠标 | ✓ |
| 移开 | `WS_EX_TRANSPARENT` 恢复 | ✓ |
| 拖拽 | 窗口 1561,411 → 1656,351（与 `clampToArea` 预测一致），宿主收到 `moved` | ✓ |
| 右键 | 出现新的可见菜单窗口（184×274），点击后消失 | ✓ |
| 退出 | `{"t":"quit"}` → exitCode 0 | ✓ |

### 4.3 新图集 / 动作 / 注视

- 图集 1536×2288（8×11，71 帧重制版）；运行中 helper 加载的文件哈希与上游一致 ✓
- 状态→行映射（`capturePage` 全分辨率 alpha 加权比对）：

| 状态 | 观测到的最优格 | 期望行 |
|---|---|---|
| running | r7c1 | 7 ✓ |
| waiting | r6c2 | 6 ✓ |
| review | r8c2 | 8 ✓ |
| failed | r5c2 | 5 ✓ |
| jumping | r4c2 | 4 ✓ |
| waving | r3c2 | 3 ✓ |
| idle | r0c0 | 0 ✓ |

- **注视 17/17**（`gaze16.mjs`）：按新版规则（仅待机 + 光标在命中区内 + 进入后 10 秒内）
  在命中区内取 16 条射线，逐方向与图集比对：
  远离身体 → 回待机 ✓；16 个方向全部命中 `r9/r10` 对应列 ✓

### 4.4 DIP / 多屏

| 场景 | 结果 |
|---|---|
| 真实 150% 副屏 | 窗口 DIP 仍是 335×597；`GetWindowRect` 给物理 512×908（≈×1.52） |
| 主屏 100% | 物理 = DIP；底部锚点 `479→597` 换算后宠物画在同一逻辑位置 |
| 负坐标副屏（y=−45） | `--x/--y` 落点正确、夹取正常 |
| 拔屏/任务栏变化 | 代码路径有（`display-*` → 重新夹回），**未真机拔过屏** |

> ⚠️ **踩到的坑（写给后续维护者）**：Windows 上所有探查工具（`GetWindowRect`、
> `Cursor.Position`、`SetCursorPos`、`CopyFromScreen`）在 **DPI-unaware 进程**里都会拿到
> **虚拟化坐标**；混合 DPI（100% + 150%）时连窗口跨屏边界都会得到自相矛盾的矩形。
> 验证脚本必须先 `SetProcessDPIAware()`（本仓库真机脚本都这么做了）。
> 这不是产品 bug，但会让"看起来坏了"。

### 4.5 真实 Desktop 端到端

- 官方 CLI 安装：`dsh.cmd plugin --profile desktop add <仓库路径>` → profile 写入
  `link:` 依赖 + `dsh.profile.bundles` 追加 `dsh-cyberwhale` + node_modules Junction ✓
- 启动后运行时**自动从 `%LOCALAPPDATA%\electron\Cache` 解出**到 `$DSH_HOME/dsh-cyberwhale/electron/` ✓
- 进程链：`DeepSeek Harness.exe`(shell) → `dsh-desktop-host`(Host) → `dsh-subprocess-local/lib/runner.js`
  → `electron.exe <repo>\helper`（+ gpu/utility/renderer 子进程）✓
- 窗口可见、置顶、默认穿透；真机网格扫描证明**命中区内会切成可交互**（`.`→`#`）✓
- 设置页缩放热生效、拖动位置被写入 `settings.json`、**重启后按记忆位置恢复** ✓
- 关闭清理（最严苛场景）：强杀 shell 主进程后 **3 秒内 4 个桌宠助手进程全部退出**，
  无 `DeepSeek Harness.exe`（Host/runner）残留 ✓

### 4.6 测试

`npm test`（Windows 真机，**418 条断言全过，exit 0**）：

```
test-host.mjs        72 通过 / 0 失败
test-client.mjs      42 通过 / 0 失败
test-atlas.mjs       74 通过 / 0 失败
test-activity.mjs    78 通过 / 0 失败
test-geometry.mjs    54 通过 / 0 失败
test-platform.mjs    66 通过 / 0 失败
test-orphans.mjs     32 通过 / 0 失败（新增）
（test-regressions.mjs 只打印 ✓，exit 0）
```

---

## 5. 明确**未验证**的部分

1. Windows 分支开发时未实测 macOS；合并前已在 Mac 上完成 `npm test`、注视、气泡布局和渲染验证。该记录不表示 Windows 的未覆盖场景已得到补验。
2. **真实 125% 缩放**未实测（150% 真屏已测；100% 已测）。
3. **显示器热插拔 / 任务栏位置变化**：代码路径存在，未真机操作过。
4. **窗口跨不同 DPI 显示器边界时的拖拽手感**未逐点实测（见 4.4 的坑）。
5. **Electron 43.x**（`ensure-electron.mjs` 默认下载版本）未在 Windows 上实测；真机用的是 40.10.2。
6. **Linux** 未适配（`electron-runtime` 有 linux 分支，窗口/孤儿清扫等没有）。
7. 真机验证用的 `assets/` 是**上游新版**（未改动）；`prototype/` 与 `docs/*brief*.md` 未复核。

---

## 6. 排障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 设置页开了桌宠但没窗口 | 没有可用 Electron 运行时 | `node tools/ensure-electron.mjs`（或设 `DSH_DESKPET_ELECTRON`） |
| 窗口出现但看不见鲸鱼 | 运行时损坏 / 素材没加载 | 换运行时重试；渲染层报错会经助手 stdout 转到 DSH 日志（搜 `[deskpet/renderer]`） |
| 鼠标点不到鲸鱼 | 命中内缩未上报 / 光标没进命中区 | 悬停身体时窗口 `WS_EX_TRANSPARENT` 应清除；否则看渲染层是否报了错 |
| 退出 DSH 后仍有 electron.exe | 历史遗留/异常退出 | 下次插件启动会自动清扫；也可 `taskkill /PID <pid> /T /F` |
| 直连 GitHub 下载失败 | 网络受限 | `node tools/ensure-electron.mjs --mirror https://registry.npmmirror.com/-/binary/electron` |
| 自己写的验证脚本结果诡异 | 脚本是 DPI-unaware（坐标被虚拟化） | 脚本开头 `SetProcessDPIAware()` |

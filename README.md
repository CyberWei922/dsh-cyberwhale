<img src="assets/portrait.png" alt="大肥鲸" width="180" align="right">

# dsh-deskpet 🐋

一只常驻桌面、随 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
工作状态变化的蓝色大肥鲸桌宠。

> 仓库：<https://github.com/CyberWei922/dsh-deskpet>

- **桌面常驻**：透明、无边框、永远置顶、跨所有 Space，不抢编辑器焦点
- **点击穿透**：默认整窗穿透，只有鲸鱼身体上才接管鼠标
- **状态联动**：待机 / 干活中 / 等你确认 / 检查结果 / 完成 / 出错 / 挥手 / 左右移动 /
  16 个注视方向，跟着 Harness 的事件走
- **两行气泡**：第一行**会话标题**，第二行**当前在干什么**
  （`正在运行命令 · npm test`）—— 直接复现聊天区那行灰字，见[气泡内容](#气泡内容任务状态两行)
- **眼睛跟随**：16 个注视方向。**只在待机时、且鼠标停在它身上**才生效，
  最多看 10 秒，鼠标一移开立刻停 —— 规则对齐 Codex 桌宠，见[注视规则](#注视规则对齐-codex-桌宠)
- **气泡避让**：贴近屏幕边缘时自动翻转 / 让位，不溢出，见[气泡避让](#气泡避让借鉴-chatgpt-桌宠)
- **独立设置页**：DSH 左侧设置里的「桌宠」页（最下方），开关 / 大小 / 状态一目了然
- **随应用退出**：窗口是宿主插件的受管子进程，Harness 一退它就走

> **平台**：macOS 已实机验证（arm64 / x64）。**Windows 适配进行中**，
> 代码里的平台分支已经就位并可测（见[跨平台](#跨平台)）。
> **实测环境**：DeepSeek Harness Desktop `0.2.0-rc.2`，macOS 15。

---

## 它长什么样

图集是标准的 8 列 × 11 行（单元格 192×208，总计 1536×2288），
与 Codex v2 Pet 契约兼容：

| 行 | 状态 | 用到的列 |
|---|---|---|
| 0 | 待机 | 0–5 |
| 1 | 向右移动 | 0–7 |
| 2 | 向左移动 | 0–7 |
| 3 | 挥手 | 0–3 |
| 4 | 跳跃（完成） | 0–4 |
| 5 | 出错 | 0–7 |
| 6 | 等待确认 | 0–5 |
| 7 | 干活中 | 0–5 |
| 8 | 检查结果 | 0–5 |
| 9–10 | 16 个注视方向 | 0–7 |

`assets/spritesheet.png` 是**正式图集**：73 帧、由散帧拼装而成（见下面「把散帧拼成图集」）。

> **正在进行：形象重制。** 为了让帧与帧之间不再"穿帮"，正在按
> [重制任务书](docs/pet-regeneration-brief.md) 重新生成整批素材 —— 数量会变成 71 帧
> （干活中从 6 帧改成 4 帧"端碗扒饭"，左右移动沿用现有素材）。
> 新素材到位前，这一节描述的是**当前图集**。

仓库还自带一个 `tools/make-placeholder-atlas.mjs`，可以在没有素材时生成一张纯几何的
占位图集，方便先跑通功能。

---

## 安装

### 1. 装进 DSH Desktop 的 profile

```bash
# 先把插件放到一个固定位置
cd /path/to/dsh-deskpet

# 用 Desktop 自带的 CLI 安装（需要先启动过一次 Desktop 以初始化 profile）
"$HOME/.dsh/profiles/desktop/../../Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$PWD"
```

或者更简单：打开 DSH → **设置 → 插件** → 选「从本地路径安装」，填入本目录的**绝对路径**。

> 安装/升级插件包之后**必须完全退出并重开 DSH**（Host 需要重新加载 JS 模块代）。

### 2. 准备 Electron 运行时

助手窗口需要一个 Electron 运行时。按以下顺序自动查找：

1. 环境变量 `DSH_DESKPET_ELECTRON`（指向 `Electron.app` 或可执行文件）
2. `<插件目录>/runtime/electron/`
3. `$DSH_HOME/dsh-deskpet/electron/`
4. `@electron/get` 的本地缓存（`~/Library/Caches/electron`）—— **命中就直接解包，不联网**
5. `<插件目录>/node_modules/electron/dist/`

都没有的话跑一次：

```bash
node tools/ensure-electron.mjs          # 从 electron 官方 Release 下载 + SHA256 校验
node tools/ensure-electron.mjs --version 43.4.1
```

想省掉下载，也可以直接复用本机已有的：

```bash
export DSH_DESKPET_ELECTRON="$HOME/Projects/MyApp/node_modules/electron/dist/Electron.app"
```

### 3. 打开桌宠

**设置 → 桌宠**（左侧设置列表最下方）→ 打开开关。

---

## 使用

| 操作 | 效果 |
|---|---|
| 拖动鲸鱼 | 移动窗口；左右拖动会播对应的走路动画 |
| 右键 | 原生菜单：打个招呼 / 重置位置 / 重新加载素材 / 重新启动窗口 / 在设置里隐藏 / 查看设置文件 |
| 鼠标移到它身上 | 鲸鱼转过来看你（**只在待机时**，最多 10 秒）|
| 模型推理时 | 气泡显示会话标题 + 当前在干什么（如「正在运行命令 · npm test」）|
| 设置 → 桌宠 | 开关、显示大小、眼睛跟随、气泡、状态、四个操作按钮 |

设置存在 `$DSH_HOME/dsh-deskpet/settings.json`。

---

## 气泡

气泡分两层：

| 层 | 内容 | 什么时候 |
|---|---|---|
| **实时层** | 从推理流提炼的进度句 | 模型正在思考时 |
| **碎碎念层** | 固定短语池（「在这儿呢」「交给我」…） | 空闲 / 实时层回落之后 |

实时层的链路：

```
agent/assistant-stream 的 reasoning-delta（逐 token 的瞬态帧）
        │
        │  lib/progress.js —— 提炼
        │    · 按句边界切，取最后一个完整句子
        │    · 去掉句首元叙述（「让我」「好的」「首先」…）
        │    · 按显示宽度截断（CJK 算 2、拉丁算 1）
        │    · 只有结果变化时才产出
        ▼
    lib/bubble.js —— 节流
        │    · 最小间隔 3 秒（照搬 Codex 桌面端）
        │    · 间隔内排队，到点只放最后一条
        │    · 重要事件可插队立即刷新
        ▼
    Electron 助手 → 渲染层气泡（实时层配色与碎碎念区分）
```

**为什么需要「提炼」这一层**：Codex 桌面端直接消费一个**结构化进度事件流**
（`cot-v5-progress`，每条已经是归纳好的短句）。DSH 没有这种东西，只暴露**原始推理
token 流** —— 又长又碎还夹着大量内心独白，直接显示会既泄露过多又观感很乱。

**为什么需要「节流」**：推理流来得比人眼能读的快得多。相关逻辑照搬 Codex，
详见 [lib/bubble.js](lib/bubble.js) 顶部注释（含两处有意与 Codex 不同的地方）。

### 配色的注意事项

气泡的前景/背景/尾巴**全部走 CSS 变量**，不要在规则里单独写 `background` 或 `color`：

```css
#bubble            { --bubble-bg: …; --bubble-fg: …; }
#bubble[data-live='1'] { --bubble-bg: …; }          /* 只换变量 */
@media (prefers-color-scheme: dark) { #bubble { … } }
```

**踩过的坑**：实时层当初只覆盖了 `background` 没覆盖 `color`，而
`#bubble[data-live='1']` 的优先级高于 `#bubble` —— 于是深色模式下背景被换成浅色、
字色仍留着深色模式的浅色，**浅底浅字完全看不清**，小尾巴也没跟着变。

[真机验证脚本](#)里有 WCAG 对比度检查，深浅两种外观 × 实时/碎碎念两层共 6 项，
正文阈值 4.5。带 bug 时深色模式量到的是 **1.16**。

---

## 工作原理

```
DSH.app
 └── Desktop Host（ELECTRON_RUN_AS_NODE=1，插件跑在这里）
      └── 【本插件的宿主半】 lib/index.js
           • 订阅 session/event · agent/error · user-questions/request
           • 把事件归一化成 6 档宠物状态
           • ctx.subprocess.spawn ──── stdin/stdout JSON Lines ────┐
           • 注册 /deskpet RPC 通道（给设置卡用）                  │
                                                                  ▼
                                                    【Electron 助手】 helper/
                                                     • 透明 / 置顶 / 穿透窗口
                                                     • 8×11 图集渲染 + 注视方向
                                                     • 拖拽 + 原生右键菜单
```

**为什么设置页用 `settings.section`**：DSH 官方对这两个槽位的分工很明确 ——
`settings.general.item` 是"单条偏好"的位置，"一整页则是 `settings.section`"。
整页还有一个附带好处：外壳只挂载当前激活的分区，所以状态轮询只在用户打开这一页时运行。

**为什么窗口要单起一个进程**：DSH 的插件运行在 `ELECTRON_RUN_AS_NODE=1` 的
Host 子进程里，拿不到任何窗口 API（官方 `packages/**` 中 `BrowserWindow` 零出现）。
所以窗口只能由插件自己 spawn 的进程创建。

**生命周期**：宿主退出或插件卸载时，`ctx.subprocess` 会回收受管子进程；
宿主异常死亡时助手进程的 stdin 会 EOF，助手据此自退。
此外 `PetBridge` 用「当前 handle 比对」保证被替换掉的旧进程不会误清引用或触发多余重启，
`dispose()` 还会兜底扫掉所有仍活着的受管进程；插件启动时再做一次
[按命令行匹配的孤儿清扫](lib/orphans.js)。四层保险，不留无主窗口。

**缩放是热生效的**：调整「显示大小」不会重启窗口进程，而是让它就地改尺寸
（保持底边中点不动）。只有开关桌宠才会动到进程生命周期。

**通信为什么不走 HTTP**：stdio 零端口、零鉴权、无 ATS 问题，
也不需要担心自注册路由默认没有 cookie 鉴权。

---

## 跨平台

### 一个包，跑所有平台

DSH 的插件清单里**没有"操作系统"这个字段** —— `dsh.client.platform` 指的是
**渲染平台**（`web`），不是 OS。所以一个 bundle 就是一份代码，
macOS / Windows / Linux 装的是同一个包，平台差异靠**运行时分支**处理。

> 别为不同系统建两个包：官方没有平台分支机制，两个包反而要维护两套安装流程。

### 关键是「同一份代码不要写死平台」

`lib/electron-runtime.js` 里所有分支函数的 `platform` 都**可以注入**：

```js
binaryRelativePath(platform)          // darwin → .app 里的 Electron；win32 → electron.exe
artifactSuffix(platform, arch)        // darwin-arm64 / win32-x64 / linux-arm64
electronCacheRoot(env, platform)      // 三平台各自的 @electron/get 缓存位置
extractionPlan(platform, zip, dest)   // darwin 用 ditto、win32 用 tar、linux 用 unzip
```

**为什么非要可注入**：如果把 `if (osPlatform() === 'win32')` 直接写进函数体，
在 macOS 上就永远走不到 Windows 那条路 —— 而**"改好 Windows 弄坏 macOS"
恰恰发生在这种测不到的地方**。

### 验证：在任意平台上测所有平台

```bash
node tools/test-platform.mjs     # 66 项，覆盖 darwin / win32 / linux
```

它做三件事：

1. **断言三条平台路径的具体结果**（二进制位置、产物名、缓存目录、解包命令）
2. **检查平台覆盖完整性** —— 三个平台的结果必须互不相同，
   否则说明有分支被写重了；未知平台必须**抛错**而不是静默兜底
3. **真解包冒烟测试** —— 当前平台真的打一个 zip 再解开，验证内容一致

> 在 macOS 上跑就能验出 Windows 那条路算得对不对。**改平台分支之前先跑它。**

### 双端协作的约定

| 约定 | 原因 |
|---|---|
| **Windows 适配开 `feat/windows` 分支**，别直接推 `main` | 避免和 macOS 侧的改动互相冲掉 |
| **只新增 `win32` 分支，不要改 darwin 分支** | 平台分支是互斥的代码路径，"适配"应该只做加法 |
| **别碰 `assets/`** | 图集是 3.4MB 二进制，冲突了**没法合并** |
| `.gitattributes` 已强制 LF | Windows 的 git 默认转 CRLF，会把每个文件都变成"改过了" |

拉取别人的改动之后，跑一遍就能知道有没有影响本机：

```bash
git pull
npm test                       # 含平台测试
pnpm verify:bubble-render      # 气泡配色 + 渲染（真机）
pnpm verify:bubble-placement   # 气泡避让四个场景（真机）
pnpm verify:gaze               # 注视规则 17 项（真机）
```

### 各平台现状

| 项 | macOS | Windows | Linux |
|---|---|---|---|
| Electron 运行时定位 / 解包 | ✅ 实机验证 | ✅ 分支就位（未实机） | ✅ 分支就位（未实机） |
| 窗口（透明 / 置顶 / 穿透） | ✅ 实机验证 | ⚠️ **待实机调** | ⚠️ 未验证 |
| 孤儿进程清扫 | ✅ | ❌ **待实现**（现在直接返回空） | ✅ |
| 注视 / 气泡 / 图集渲染 | ✅ | 平台无关 | 平台无关 |

**Windows 上已知要补的**：

1. `lib/orphans.js` —— `findMatchingProcesses` 在 win32 直接返回 `[]`，
   残留窗口不会被自动清理。需要接 `tasklist` 或 `Get-CimInstance Win32_Process`。
2. **窗口行为必须实机试**：`transparent + alwaysOnTop + setIgnoreMouseEvents(forward)`
   在 Windows 上有已知差异（点击穿透时的事件转发不如 macOS 可靠；
   透明窗口 + 硬件加速在某些显卡驱动下会出黑底）。
3. `tools/verify-*.mjs` 里写死了 macOS 的应用路径，验证前需要抽成可配置。

---

## 开发

```bash
node client/build.mjs                   # 构建设置卡的客户端包
node tools/ensure-electron.mjs          # 准备 Electron 运行时
node tools/check-consistency.mjs        # 检查各帧画得有多不一致（见下）
node tools/make-placeholder-atlas.mjs   # 生成纯几何占位图集（无素材时用）

npm test                                # 离线测试（392 项，一次跑完）
```

`npm test` 包含五套离线测试：

| 测试 | 覆盖 |
|---|---|
| `test-host.mjs` | 宿主半的离线集成（事件 → 状态机 → 下发） |
| `test-client.mjs` | 设置页 |
| `test-atlas.mjs` | 图集拼装 + 帧数契约 |
| `test-activity.mjs` | 任务状态文案（含与 DSH 词典逐字对照）|
| `test-geometry.mjs` | 窗口 / 宠物几何与位置限制 |
| `test-platform.mjs` | **跨平台分支**（darwin / win32 / linux）|

另有三个**真机验证**（需要桌面环境，不进 `npm test`）：

```bash
pnpm verify:bubble-render      # 气泡配色对比度 + 渲染
pnpm verify:bubble-placement   # 气泡避让四个场景
pnpm verify:gaze               # 注视规则 17 项
```

### 把散帧拼成图集

绘图端只要给出「透明底的单帧」，对齐网格、统一缩放、统一重心都由工具完成：

```bash
node tools/assemble-atlas.mjs <帧目录> --out assets/spritesheet.png
node tools/assemble-atlas.mjs <帧目录> --dry-run      # 只看报告，不写文件
node tools/assemble-atlas.mjs <帧目录> --key FF00FF   # 源图是实色底时抠色
```

它还会指出**哪一帧需要重画**（角色贴到画布边缘）以及**哪些图没有透明通道**。

规格见 [图集规格](docs/pet-asset-spec.md) 第 2 节（角色尺寸与安全区）
与第 7 节（生产工具）；给绘图端的任务书是 [逐格动作与视线表](docs/pet-sprite-task-brief.md)。

### 注视规则（对齐 Codex 桌宠）

早期实现是「鼠标在屏幕任何地方动，它就盯着看」，而且**优先级最高、能顶掉一切动画** ——
结果是跟它打招呼时它还在看鼠标。

现在完全照 Codex 桌宠的规则来（`app-initial-*.js` 里那个渲染组件）：

| 规则 | 说明 |
|---|---|
| **只有待机时注视** | 干活中 / 抬头等你 / 低头检查 / 挥手 / 跳跃 / 出错一律不注视 |
| **鼠标必须停在它身上** | 屏幕别处移动不理会 |
| **最多看 10 秒** | 从指针进入身上开始计时，到点自动回到待机动画 |
| **移开立刻停** | 指针离开（或窗口被切走）立即停止 |

方向按指针相对宠物中心的角度算，22.5° 一档共 16 个方向（图集第 9、10 行）——
这部分原本就与 Codex 一致。

真机验证：

```bash
pnpm verify:gaze    # 四条规则共 17 项断言
```

### 气泡内容：任务状态（两行）

气泡显示的不是「模型在想什么」，而是「它现在在干什么」—— 复现 DSH 聊天区那行灰字：

```
┌────────────────────────────────────┐
│ 重制任务书                          │  ← 第一行：会话标题
│ 正在运行命令 · npm test             │  ← 第二行：任务状态
└────────────────────────────────────┘
```

那行灰字是 DSH 的 i18n 词典（`message.stepProcess.*`）。**这里不读词典、也不爬前端** ——
状态可以从宿主已经收到的事件完整重算：

| 事件 | 用途 |
|---|---|
| `session/title` | 第一行的会话标题 |
| `agent/assistant-stream` 的 `tool-call-delta`（带 `name`）| 「准备运行命令」阶段 |
| `tool/call` 的 `name` | 类别（命令 / 读文件 / 搜索 / 网页 / 子智能体…）|
| `tool/call` 的 `arguments` | 「· npm test」那截细节 |
| `tool/result` | 回落到「正在分析请求」|
| `turn/end` | 清空，回落到待机碎碎念 |

词表与工具名映射是逐条核对 DSH 实现抄来的，测试会**直接读 DSH 的 app.asar 词典做逐字对照**
（读不到时自动跳过，换机器不会误报）。见 `lib/activity.js` 与 `tools/test-activity.mjs`。

### 气泡避让（借鉴 ChatGPT 桌宠）

气泡不会傻待在宠物头顶：

- **角色贴屏幕顶边** → 气泡自动翻到脚底
- **角色贴近屏幕左右边缘** → 气泡整体平移，不溢出屏幕
- 气泡的小尾巴始终指回宠物中轴

实现上，窗口在宠物**上下各留了一块气泡空间**（见 `helper/geometry.js` 的
`computeMetrics`），否则翻到下方没地方去。屏幕可视区由主进程下发
（窗口本身可以伸到屏幕外），摆放计算在渲染层做 —— 只有它知道气泡实际多大。

真机验证（需要桌面环境，不进 `npm test`）：

```bash
pnpm verify:bubble-placement   # 四个场景：贴顶翻转、贴左右让位、居中对照
pnpm verify:bubble-render      # 配色对比度 + 气泡渲染
```

> 这台机器有 **2 块屏幕**，把角色拖到最右边会落到副屏上 ——
> 验证脚本会按「窗口所在的那块屏」算边界，而不是只看主屏。

### 帧间一致性检查

动画看着不舒服，往往**不是位置没对齐，而是每一帧的角色细节都不一样**
（裙摆褶皱数量、刘海走向、表情结构…）。这种差异肉眼看得见但很难争论，所以做成数字：

```bash
node tools/check-consistency.mjs individual-draft
node tools/check-consistency.mjs individual-draft --json   # 机器可读
```

做法是先把同行各帧按互相关对齐（否则量到的是位置漂移而不是画得不一致），
再逐像素取中位数当「共识图」，最后量每帧与共识图的平均色差（0~255）。

`jumping` 这类**姿态本来就该大幅变化**的动作会被豁免绝对阈值，
只检查「有没有哪一帧特别离群」。

返工方法与逐帧清单见 [形象一致性返工清单](docs/pet-consistency-rework-brief.md)。

### 抓窗口截图（验证渲染问题很有用）

外部的 `screencapture` 需要屏幕录制权限；助手内置了一条不用权限的通道 ——
向它的 stdin 发一条消息即可把**合成器最终呈现的内容**写成 PNG：

```bash
# 助手运行时，往它的 stdin 里写：
{"t":"capture","path":"/tmp/pet.png"}
```

`webContents.capturePage()` 抓的就是最终合成结果，所以「某一帧有没有闪」
可以直接靠连续抓帧来判定，而不用靠肉眼。

单独跑助手窗口（调试用）：

```bash
env -u ELECTRON_RUN_AS_NODE \
  "$HOME/.dsh/dsh-deskpet/electron/Electron.app/Contents/MacOS/Electron" \
  "$PWD/helper" --assets="$PWD/assets" --scale=1 --look-at-cursor=1 --bubbles=1
```

> ⚠️ 如果从 DSH 内部的终端启动，记得 `env -u ELECTRON_RUN_AS_NODE` ——
> 那个变量会让 Electron 以 Node 模式启动，窗口起不来。

### 目录结构

```
package.json            dsh.bundle.patch / dsh.client 声明
cordis.patch.yml        插件行注册
lib/
  index.js              宿主半插件（事件订阅 + RPC + 路由）
  state.js              纯状态机（可单独测试）
  bridge.js             子进程管理 + JSON Lines 协议
  settings.js           设置读写
  electron-runtime.js   Electron 运行时定位
  orphans.js            启动时的孤儿窗口清扫
  migrate.js            旧目录名的一次性迁移
  client.js             客户端包（由 client/build.mjs 生成）
client/
  index.js              设置页源码（用官方 UI 基元）
  build.mjs             包装成官方 lazy-CJS 外壳
helper/
  main.js               Electron 主进程（窗口 / 穿透 / 拖拽 / 菜单）
  preload.js            最小 IPC 面
  renderer/             图集渲染 + 注视方向 + 命中区
assets/                 pet.json + 图集
tools/                  图集生成 / Electron 准备 / 测试
docs/                   规格书与技术核实报告
```

---

## 已知限制

- **Windows 还在适配中。** 运行时定位 / 解包的分支已经就位并有测试，
  但窗口行为（透明 / 置顶 / 点击穿透）和孤儿进程清扫还没在 Windows 上做实机调。
  详见[跨平台](#跨平台)那一节。
- 桌面常驻窗口由插件自行 spawn，**不是 DSH 官方承诺的能力**。它走的是公开的
  `ctx.subprocess` 服务契约、不违反任何约束，但未来若该 seam 收紧需要跟进适配。
- 设置页的导航图标由 DSH 外壳**按分区 id 硬编码**（见 `SettingsRoot.tsx` 的
  `navIcon()`），未知 id 一律回落到通用齿轮。所以「桌宠」页拿不到自己的图标。
- 形象素材为 AI 生成的二次元鲸鱼，版权归本仓库作者所有。
- **窗口尺寸固定**（按最大档位 1.6 预留，335×597 —— 上下各留一块气泡空间，
  让角色贴屏幕顶边时气泡能翻到脚底），缩放只改内容不窗口。
  这么做是为了避开 macOS 在透明窗口改尺寸时重分配绘制表面所导致的闪帧
  （表现为压在下面的窗口暗一下）。代价是小档位下窗口比宠物大 —— 但穿透按命中区
  翻转，指针一离开身体就恢复穿透，实际影响可忽略。
- 窗口是矩形的：穿透按命中区翻转，所以「可交互」时鲸鱼周围的透明边缘也会吃点击。
  这是 `setIgnoreMouseEvents` 方案的固有精度上限
  （Electron 的 `setInputShape` 在 macOS 上不可用）。

---

## 许可与致谢

本项目以 **MIT** 发布，见 [LICENSE](LICENSE)。

图集规格转述自 OpenAI 的 `hatch-pet` skill（Apache-2.0）；
动画状态机参考 `openai/codex` 的宠物引擎（Apache-2.0）；
窗口行为参考 `PC2005-cloud/dsh-pet` 等 MIT 项目。
本项目**不包含**任何第三方美术资产，也**未使用** OpenAI 的内置宠物图或
ChatGPT/Codex Desktop 的闭源代码。

详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

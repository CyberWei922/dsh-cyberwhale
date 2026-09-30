# dsh-deskpet 🐋

一只常驻 macOS 桌面、随 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 工作状态变化的蓝色大肥鲸桌宠。

> 仓库：<https://github.com/CyberWei922/dsh-deskpet>
> 本项目早期叫 `dsh-pet-whale`，已按仓库名统一改为 **`dsh-deskpet`**。
> 从旧版本升级请看下面的[升级说明](#从旧名字升级)。

- **桌面常驻**：透明、无边框、永远置顶、跨所有 Space，不抢编辑器焦点
- **点击穿透**：默认整窗穿透，只有鲸鱼身体上才接管鼠标
- **状态联动**：思考 / 干活 / 等你确认 / 检查结果 / 完成 / 出错，六个状态跟着 Harness 走
- **实时气泡**：把模型的推理流提炼成一句「当前在做什么」，按最小 3 秒的节奏显示
- **眼睛跟随**：16 个注视方向，看着你屏幕任意位置的光标
- **独立设置页**：DSH 左侧设置里的「桌宠」页（最下方），开关 / 大小 / 状态一目了然
- **随应用退出**：窗口是宿主插件的受管子进程，Harness 一退它就走

> **平台**：仅 macOS（arm64 / x64）。Windows 与 Linux 未验证。
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

仓库还自带一个 `tools/make-placeholder-atlas.mjs`，可以在没有素材时生成一张纯几何的
占位图集，方便先跑通功能。

---

## 从旧名字升级

包名从 `dsh-pet-whale` 改成了 `dsh-deskpet`。**profile 里的旧记录必须先改掉**，
否则重启后 DSH 找不到旧 bundle，桌宠会静默不加载。

**推荐做法 —— 一条命令：**

```bash
# 1. 完全退出 DSH（⌘Q，不是关窗口）

# 2. 进到项目目录（重要：脚本用的是项目内相对路径）
cd /path/to/dsh-deskpet

# 3. 预演，确认要改什么
node tools/migrate-profile.mjs

# 4. 确认无误后写入
node tools/migrate-profile.mjs --apply

# 5. 重新打开 DSH
```

> 不想 `cd` 的话，用绝对路径也可以（脚本内部按自身位置解析依赖，与当前目录无关）：
> `node /path/to/dsh-deskpet/tools/migrate-profile.mjs`

脚本会一次性修好四处：`package.json` 的 bundle 列表与依赖、`node_modules` 软链、`pnpm-lock.yaml`。
它会先检查 DSH 是否已退出，运行期不会写入。

<details>
<summary>不想用脚本？手动等价操作</summary>

官方 CLI 路径：

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop remove dsh-pet-whale
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add /path/to/dsh-deskpet
```

或者直接编辑 `~/.dsh/profiles/desktop/package.json`，把 `dsh-pet-whale` 换成
`dsh-deskpet`（`dependencies` 与 `dsh.profile.bundles` 两处），再把
`node_modules/dsh-pet-whale` 软链改名为 `dsh-deskpet`。

</details>

**你的设置不会丢**：插件启动时会自动把 `$DSH_HOME/dsh-pet-whale/` 整个目录
改名为 `$DSH_HOME/dsh-deskpet/`，设置文件与已解包的 Electron 运行时都会一起接过来。

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
| 鼠标在屏幕上移动 | 鲸鱼的眼睛跟着你转 |
| 模型推理时 | 气泡显示当前进度（如「正在检查渲染层的锚定逻辑」）|
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

## 开发

```bash
node client/build.mjs                   # 构建设置卡的客户端包
node tools/test-host.mjs                # 宿主半的离线集成测试
node tools/test-client.mjs              # 设置页的测试
node tools/test-atlas.mjs               # 图集拼装的测试
node tools/ensure-electron.mjs          # 准备 Electron 运行时
node tools/check-consistency.mjs        # 检查各帧画得有多不一致（见下）
node tools/make-placeholder-atlas.mjs   # 生成纯几何占位图集（无素材时用）

npm test                                # 上面三个测试一次跑完
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

- **仅 macOS**。Windows 侧 DSH 的 `subprocess-local` 会隐藏 GUI 子进程窗口，
  需要另做方案。
- 桌面常驻窗口由插件自行 spawn，**不是 DSH 官方承诺的能力**。它走的是公开的
  `ctx.subprocess` 服务契约、不违反任何约束，但未来若该 seam 收紧需要跟进适配。
- 设置页的导航图标由 DSH 外壳**按分区 id 硬编码**（见 `SettingsRoot.tsx` 的
  `navIcon()`），未知 id 一律回落到通用齿轮。所以「桌宠」页拿不到自己的图标。
- 形象素材为 AI 生成的二次元鲸鱼，版权归本仓库作者所有。
- **窗口尺寸固定**（按最大档位 1.6 预留，335×479），缩放只改内容不窗口。
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

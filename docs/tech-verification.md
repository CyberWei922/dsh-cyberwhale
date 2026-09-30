# DSH 桌宠插件 · 技术路线核实报告

> 目标：为 **DeepSeek Harness 桌面预览版 · macOS** 开发一个蓝色大肥鲸桌宠插件
> 形态：参照 Codex Pet —— 随应用运行、桌面常驻置顶、透明的独立窗口
> 核实日期：2026-09-29 ｜ 状态：**待确认后开工**

---

# 0. 目标环境（已实测确认）

| 项 | 值 | 来源 |
|---|---|---|
| 应用 | `/Applications/DeepSeek Harness.app` | 本机 |
| Bundle ID | `com.deepseek.dsh` | `codesign -dvvv` |
| 应用版本 | `0.2.0-rc.2` | `Contents/Info.plist` |
| 运行时版本 | `0.2.0-rc.2`（内置 290 个包） | `app.asar/dsh/desktop-runtime.json` |
| hostProtocolVersion | `4` | 同上 |
| 内置 Node | `24.18.1` ｜ pnpm `11.7.0` | `Resources/runtime/versions.json` |
| 架构 | `arm64` ｜ Electron runtime v26.5.0 | 二进制 |
| 代码签名 | 已签名，Team `NAN929V4UM`，**hardened runtime**（`flags=0x10000`） | `codesign` |
| **App Sandbox** | ❌ **未启用**（无 `com.apple.security.app-sandbox`） | `codesign -d --entitlements` |
| 已有 entitlements | `allow-jit`、`allow-unsigned-executable-memory`、**`disable-library-validation`**、`device.audio-input` | 同上 |
| 打包内含 | **`Electron Framework.framework`**（完整 Electron 运行时） | `Contents/Frameworks/` |

**关键结论**：没有 App Sandbox ⇒ 插件 spawn 外部 GUI 进程**不会被系统沙箱阻止**；
`disable-library-validation` ⇒ 加载非同签名的库/框架不会被拦。

> ⚠️ 版本澄清：`~/.dsh/profiles/node_modules/@deepseek-ai/*` 下是 `0.1.0-rc.6`，
> 那是旧 `dsh web` profile 的残留，**桌面版不使用它**。桌面版加载 `app.asar/dsh` 里自带的 0.2.0-rc.2。

---

# 1. 官方文档阅读清单

官方仓库 `github.com/deepseek-ai/deepseek-harness`（公开，MIT，master），
已完整拉取到 `/tmp/dsh-docs/deepseek-harness-master/`（611 个 docs 条目）。

| 文档 | 用途 |
|---|---|
| `docs/architecture.md` | 整体架构、profile/bundle、Desktop 启动链、扩展点总表 |
| `docs/user/develop/basic/{index,config,tool,publish}.zh.md` | **官方用户向插件开发教程** |
| `docs/user/develop/framework/{index,events,service}.zh.md` | Cordis 框架用法 |
| `docs/user/develop/practice/*.zh.md` | 实践（含 dynamic-cordis） |
| `docs/cordis-tutorial/01–07` | 从零写插件的分步教程 |
| `docs/cordis-api/{context,service,events,registry,fiber}.zh.md` | API 精确签名 |
| `docs/subsystems/subprocess.md` | `ctx.subprocess` 完整契约 |
| `docs/subsystems/web-server.md` | `ctx.webServer` 路由/WS 与鉴权边界 |
| `docs/subsystems/sandbox.md` | 沙箱到底约束什么 |
| `docs/subsystems/session.zh.md` | `session/event` 与 `SessionEventMap` |
| `docs/subsystems/core.zh.md` | `agent/*` 事件与 `AgentStatus` |
| `docs/subsystems/approval.zh.md`、`user-questions.zh.md` | 两种"等待"态的事件 |
| `docs/agent-lifecycle.md`、`event-producer-consumer.md` | 事件时序与总表 |
| `docs/subsystems/client-modules.md` | 客户端插件加载契约（boot 图、bundle 路由） |
| `packages/client/tsdown.client.ts` | **官方客户端 bundle 构建预设（含 banner/footer 格式）** |
| `apps/desktop/README.md`（114KB） | 桌面版打包、profile、插件激活、Host 环境、已知限制 |
| `packages/boot/plugin-manager/README.md` | 插件安装/兼容/豁免流程 |

---

# 2. 接口核对表

## 2.1 我们要用的接口（逐条已核实）

| # | 接口 | 官方出处 | 签名/要点 | 状态 |
|---|---|---|---|---|
| 1 | `ctx.subprocess.spawn` | `docs/subsystems/subprocess.md` L17-321 | `spawn(spec): SubprocessHandle`；spec = `{argv, cwd, stdio, graceMs, signal?, env?}` | ✅ 可用 |
| 2 | stdio 模式 | 同上 L44-89 | `stdin: 'ignore'\|'pipe'\|{data}`；stdout/stderr: `'pipe'\|'inherit'\|Collect` | ✅ `pipe` 支持长驻协议 |
| 3 | `SubprocessHandle` | 同上 L148-166 | `stdin/stdout/stderr/control/collected/done/terminate()/waitForExit()` | ⚠️ **无 `pid`**，无 `kill()` |
| 4 | 长驻进程支持 | 同上 L118-123 | spec 无超时；"The caller owns deadlines" | ✅ |
| 5 | 服务 dispose 行为 | 同上 L277 | "Disposal of the service terminates all still-running managed processes" | ⚠️ 见 §5 障碍 3 |
| 6 | `ctx.on('session/event')` | `docs/subsystems/session.zh.md` L1258-1276 | `(this: Scoped<Session>, session: Session, event: SessionEvent): void`，post-commit emit | ✅ |
| 7 | `turn/end` 原因 | 同上 L698-731 | `completed` / `aborted` / `blocked` / `error` / `max-tokens` / `interrupted` / `forked` | ✅ |
| 8 | `tool/call` / `tool/result` | `docs/persistence-catalog.md` | 会话事件，`log 在 execution 之前` | ✅ 最适合 UI |
| 9 | `agent/status` | `packages/core/agent/src/runtime-types.ts:109` | **只有 `'idle' \| 'running'`** | ⚠️ 粒度不够，需配 session 事件 |
| 10 | `approval/asked` | `packages/interaction/user-approval/src/types.ts:31-62` | 会话审计事件，配对 `approval/decided` | ✅ |
| 11 | `user-questions/request` | `docs/subsystems/user-questions.zh.md` L283-302 | **waterfall**，必须调 `next()` | ✅ |
| 12 | `agent/error` | `docs/subsystems/core.zh.md` L842 | 实时 emit，**可能无持久记录** | ⚠️ 需与 `turn/end` 去重 |
| 13 | `ctx.agents.roots()` / `isOwnedBy()` | `docs/subsystems/core.zh.md` L735-759 | 运行时所有权，区别于持久 lineage | ✅ 用于过滤子代理 |
| 14 | `ctx.timer` / `throttle` / `debounce` | `docs/cordis-api/inherited.md` L19 | "Disposable timer helpers… mixed onto ctx" | ✅ 降噪原语 |
| 15 | `ctx.provide(name, value)` | `docs/cordis-api/context.zh.md` L288-304 | 返回 disposer | ✅ |
| 16 | `ctx.effect(fn)` | `docs/cordis-tutorial/02` L84-94 | fn 加载期运行，返回 disposer 卸载期运行 | ✅ |
| 17 | `ctx.webServer.register/registerUpgrade` | `docs/subsystems/web-server.md` L117-178 | 裸 `node:http` handler | ✅ 但**默认无鉴权** |
| 18 | `ctx.connection.requestRejection` | `packages/host/open-in-app/src/index.ts:7-13` | 自注册路由要自己接鉴权 | ⚠️ 若用 HTTP 才需要 |

## 2.2 明确**不存在**的能力（硬边界）

| 想要的 | 事实 | 证据 |
|---|---|---|
| 插件创建/控制 OS 窗口 | **完全没有** | `BrowserWindow` 在 `packages/**` 中 **0 处**；只在 `apps/desktop/src/**` 与测试/notes |
| `alwaysOnTop` / `transparent` / 点击穿透 | **全库文档零提及** | 全 docs grep |
| 插件访问 Electron 主进程 API | 插件跑在 `ELECTRON_RUN_AS_NODE=1` 的 Host 子进程里 | `apps/desktop/src/main.ts:153`、`architecture.md:55` |
| renderer 拿 raw Electron IPC | 明确禁止 | `apps/desktop/README.md:99` "No renderer receives filesystem access, raw Electron IPC, a shell…" |
| 外部程序接入 Host IPC | 无对外 attach 协议 | `apps/desktop-host/src/index.ts` 仅 4 类消息：`ready`/`fatal`/`shutdown-complete`/`platform-session` |

> 桌面版文档**没有一句**写"插件不能创建窗口"—— 但也没有任何窗口 API。
> 结论：**窗口必须由插件自己 spawn 的独立进程创建**。

---

# 3. 插件框架结构（第一版）

## 3.1 总体形态

```
┌─────────────────────────────────────────────────────────────┐
│ DeepSeek Harness.app  (Electron 主进程, 我们碰不到)          │
│   └── Desktop Host  (ELECTRON_RUN_AS_NODE=1, 同进程跑插件)   │
│         └── 【我们的 host 半插件】                            │
│               • 订阅 session/event / approval / questions    │
│               • ctx.subprocess.spawn ──┐                     │
│               • stdin/stdout JSON 行协议│                     │
└────────────────────────────────────────┼─────────────────────┘
                                         ▼
                              ┌──────────────────────────┐
                              │ 【我们的 pet 助手进程】   │
                              │  Electron（独立 .app）    │
                              │  • 透明无边框置顶窗口      │
                              │  • 8×11 图集渲染           │
                              │  • 拖拽 + 三态点击穿透     │
                              │  • 右键菜单（隐藏/退出）   │
                              └──────────────────────────┘
```

**第一版不需要 client 半插件**（不需要 `dsh.client`）——
因为宠物窗口完全在我们自己的进程里。client 半只在后续要做"DSH 设置页里加一张桌宠设置卡"时才需要。

## 3.2 仓库结构

```
dsh-cyberwhale/
├── package.json                 # name / version / dsh.bundle.patch / peerDependencies
├── cordis.patch.yml             # 插件行注册
├── lib/
│   ├── index.js                 # host 半插件入口（apply(ctx, config)）
│   ├── state.js                 # 事件 → 6 档状态映射
│   ├── bridge.js                # 子进程管理 + JSON 行协议
│   └── helper-locator.js        # 助手进程定位/首次准备
├── helper/                      # Electron 助手应用
│   ├── main.js                  # 主进程：窗口创建 + 协议
│   ├── preload.js
│   └── renderer/
│       ├── index.html
│       ├── pet.js               # 图集渲染 + 状态机 + 拖拽
│       └── pet.css
├── assets/
│   ├── pet.json                 # spriteVersionNumber: 2
│   └── spritesheet.webp         # 1536 × 2288
├── LICENSE                      # MIT
├── THIRD_PARTY_NOTICES.md       # Apache-2.0 出处声明
└── README.md
```

## 3.3 host 半插件骨架

```js
// lib/index.js
export const name = 'deskpet'
export const inject = ['subprocess', 'agents']

export function apply(ctx, config) {
  const pet = new PetBridge(ctx, config)   // 起子进程
  ctx.effect(() => () => pet.dispose())

  ctx.on('session/event', (session, event) => {
    if (!ctx.agents.roots().includes(session.id)) return   // 只驱动主会话
    pet.feed(mapSessionEvent(event))
  }, { global: true })

  ctx.on('agent/error', ({ agent }) => pet.feed({ state: 'error' }))
  ctx.on('approval/asked', () => pet.feed({ state: 'waiting' }))
  ctx.on('user-questions/request', (req, next) => {        // waterfall，必须 next()
    pet.feed({ state: 'waiting' })
    return next()
  })
}
```

## 3.4 状态映射（官方事件核实版）

| 宠物状态 | 图集行 | 触发 |
|---|---|---|
| `thinking` | row 6 `waiting`? / row 7 | `session/event` → `turn/start` |
| `working` | row 7 `running` | `session/event` → `tool/call` |
| `result` | row 8 `review` | `session/event` → `tool/result` |
| `waiting` | row 6 `waiting` | `approval/asked` 或 `user-questions/request` |
| `success` | row 3/4 庆祝 | `turn/end` && `reason.kind === 'completed'` |
| `error` | row 5 `failed` | `turn/end{kind:'error'}` ｜ `agent/error`（去重） |
| `idle` | row 0 | `turn/end{kind:'aborted'}` 或无活动超时 |

> 节流：只消费 `turn/*`、`step/*`、`tool/*`、`approval/*` 等**低频结构事件**；
> **不转发 `agent/assistant-stream`**（逐 text-delta 高频）。需要"打字"动画时用 `ctx.throttle`。

## 3.5 进程间协议（stdin/stdout JSON Lines）

```
host → pet   {"t":"state","v":"working"}
             {"t":"mood","v":"celebrate","ms":3000}
             {"t":"config","scale":1.0,"lang":"zh"}
pet  → host  {"t":"ready","pid":1234}
             {"t":"log","level":"warn","msg":"..."}
             {"t":"quit"}
```

- 零端口、零鉴权、无 ATS 问题、DSH 重启不受影响
- **宿主死亡自动回收**：host 退出 → 子进程 stdin EOF → 宠物自退（对应 `ctx.subprocess` dispose 语义）
- 额外保险：宠物侧定期 `kill(hostPid, 0)` 探测（参考 dsh-pet 的 issue #56 处理）

## 3.6 窗口配置（照 Codex 实测参数 + dsh-pet MIT 参考）

```js
new BrowserWindow({
  frame: false, transparent: true, hasShadow: false,
  resizable: false, minimizable: false, maximizable: false,
  fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
  ...(process.platform === 'darwin'
    ? { type: 'panel', enableLargerThanScreen: true }   // NSPanel：不抢焦点
    : {}),
})
win.setAlwaysOnTop(true, 'floating')                     // 或 'screen-saver'
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
// 三态穿透
//   'disabled'          → setIgnoreMouseEvents(false)
//   'forwarding'        → setIgnoreMouseEvents(true, { forward: true })
//   'without-forwarding'→ setIgnoreMouseEvents(true, { forward: false })
```

---

# 4. 技术路径判定

## 4.1 可行 —— 但必须理解这是"绕过"而非"官方支持"

| 环节 | 判定 | 说明 |
|---|---|---|
| 插件能否 spawn 长驻子进程 | ✅ 支持 | `ctx.subprocess` 就是为此设计的（LSP、ACP、PTY 都这么用） |
| 插件代码能否绕过 agent 沙箱 | ✅ 可以 | `sandbox.md:11` 「`SandboxMode` governs **filesystem effects only**」；消费者只有 bash/pwsh；插件不在沙箱内 |
| macOS 系统层会否阻止 | ✅ 不会 | DSH.app 无 App Sandbox（已实测） |
| 官方是否会承诺这个用法 | ⚠️ **不会** | 文档没有把"插件拉起 GUI 自建窗口"写作受支持能力 |
| 未来版本会否破坏 | ⚠️ 中风险 | 依赖 `ctx.subprocess` 的稳定契约；该 seam 是公开 Service Definition，破坏性变更概率低 |

## 4.2 Electron 运行时获取：三种方案

| 方案 | 体积 | 首次成本 | 风险 |
|---|---|---|---|
| **A. 复用 DSH 自带的 Electron Framework** | 0 下载 | 从 `DSH.app/Contents/Frameworks/` 复制/引用 | 耦合 DSH 安装路径与 Electron 版本；DSH 更新后需重新适配 |
| **B. `@electron/get` 运行时下载**（dsh-pet 做法） | ~100–200MB | 首次下载 | 网络依赖；默认镜像 `npmmirror` 属第三方，需换成官方源 + SHA256 校验 |
| **C. 自备预编译助手** | 随包分发 | 无 | 包体积大；且 Electron 二进制进 npm 包不现实 |

**倾向**：第一版用 **B（官方源 + 哈希校验 + 进度提示 + 可配置镜像）**，
因为它与 DSH 版本解耦、行为可预期；同时**把 A 作为可选加速路径**做探测
（检测到兼容的 Electron Framework 就本地准备，省掉下载）。

> 待验证：A 方案是否真能构造出一个可运行的独立 .app（spike 1）。

## 4.3 备选/降级路线：窗口内浮层（官方完全支持）

这不是主路线，但值得记录，因为它是**唯一的官方受支持 UI 路径**，可作降级或过渡：

| 项 | 事实 | 证据 |
|---|---|---|
| 槽位 | `shell.overlay`（`list` / `scope: root` / `replaceRisk: none`） | `packages/client/ui-layout/src/client/index.ts:94-100` |
| DOM | `position:absolute; inset:0; z-index:20`，锚在 `.frame` | `AppFrame.module.css:277-286` |
| 穿透 | 层 `pointer-events:none`，但 `.overlayLayer > *` 强制 `auto` ⇒ **插件根元素要自己写回 `none`**，宠物本体 `auto` | 同上 |
| 官方原话 | "Frame-wide floating layer… The layer itself is click-through — entries opt back into pointer events… This is the additive seat for a frame-wide surface of your own" | `ui-layout/src/client/index.ts:94-100` |
| 层叠 | 20（低于 Menu 100 / Modal 1000 / Toast 1100，会被弹窗盖住，符合预期） | primitives |
| 主题 | 只消费 `--dsw-alias-*` 语义 token，禁写字面颜色；`body[data-ds-dark-theme]` 自动切换 | `docs/web-styling.md:17-19` |
| 明确禁令 | 不得注册 `root` slot；不得替换 app root 或往 `document.body` 追加第二个应用 | `slot-catalog.ts:2203`、`ui-plugin.md:13` |

**局限**：宠物只能在 DSH 窗口内活动，窗口被遮挡或最小化就看不见，跨不出窗口边界。
**用途**：① 未来加"DSH 设置页里的桌宠设置卡"；② 若外部进程方案在某版本受阻，可快速降级出一个可用版本。

## 4.4 设置页：独立成页的官方做法

需求方要求把设置做成左侧独立一页（而非「通用」里的一行）。官方支持，且分工明确
（`packages/client/ui-settings/src/client/contract/slots.ts`）：

> `settings.general.item` —— *"the additive seat for a single setting that needs no page
> of its own (**a whole page is `settings.section`**)"*

| 事项 | 结论 |
|---|---|
| 槽位 | `settings.section`（`kind: 'list'`、`scope: 'root'`） |
| 注册选项 | `name` / `id`（分区 key）/ `order`（导航位置）/ `label`（`string` 或 `() => string`） |
| 组件 props | `{ close: () => void }`（`SettingsSectionOwnerProps`） |
| 官方现有 order | 账号 -10 ｜ 通用 0 ｜ 模型 10 ｜ 插件 15 ｜ Agent 预设 20 |
| 挂载策略 | `renderSlot('settings.section', {close}, {only: active})` —— **只挂载当前激活的分区** |
| `label` 函数 | 外壳用 `resolveSlotLabel()` 求值，并订阅语言变化重读，**切换语言自动跟随** |
| ⚠️ 图标 | **无法自定义**。`SettingsRoot.tsx` 的 `navIcon(id)` 按 id 硬编码，未知 id 回落到通用齿轮 |
| UI 基元 | `@deepseek-ai/dsh-client-ui-primitives` 在 `PLATFORM_MODULES` 基线里，可直接 `require` |

官方**没有 slider 组件**（全仓库 `type="range"` 零命中），因此「显示大小」改用官方的
`SegmentedControl` 表达离散档位（小/中/大/特大）。

本项目设置页即按此实现：`id: 'dsh-cyberwhale'`、`order: 90`（最下方）。

## 4.5 Dock 图标：**已实测可隐藏**（原判断有误，特此更正）

本节原先写的是「Electron 独立进程会在 Dock 留图标、纯 Electron 做不掉」。
**这个判断是错的**，实测结论：

```js
app.setActivationPolicy('accessory')   // Electron 暴露的 macOS API
app.dock.hide()
```

在窗口创建**之前**调用这两句，助手进程就不会出现在 Dock，也不会进 Cmd+Tab。
需求方实机确认：「Dock 根本没有图标，隐藏的非常好。」

因此**不需要**额外的 Swift `LSUIElement` 启动器 —— Codex 用原生壳并不是为了这个。

---

# 5. 障碍清单与应对

| # | 障碍 | 影响 | 应对 |
|---|---|---|---|
| 1 | 无窗口 API | 必须自建进程 | 已在方案内 |
| 2 | 插件在 RunAsNode 进程，拿不到 `electron` | 同上 | 已在方案内 |
| 3 | **`ctx.subprocess` 服务 dispose 会杀死所有受管子进程** | 插件卸载/Host 关闭 → 宠物退出 | 这**正是想要的**（宠物随 DSH 退出）；若需宠物存活则改用 `node:child_process` 自行管理（不推荐） |
| 4 | `SubprocessHandle` 无 `pid`、无 `kill()` | 无法做精细信号控制 | 只需 `terminate()`/`waitForExit()`；`pid` 可由子进程自己上报 |
| 5 | `graceMs` 必填 | 需给终止宽限期 | 取 3000ms，配合子进程侧优雅退出 |
| 6 | `SubprocessCollect` 有输出上限 | 日志被截断 | 用 `stdin/stdout: 'pipe'` 原始流，不用 collect |
| 7 | 自注册 webServer 路由**无鉴权** | 若开 HTTP 端口会被同机任意进程访问 | 第一版**完全不用 HTTP**，走 stdio |
| 8 | `agent/status` 只有 `idle\|running` | 状态粒度不够 | 以 `session/event` 为主，`agent/status` 仅作兜底 |
| 9 | `agent/error` 可能无持久记录 | 状态卡死或重复 | error 档两处都听 + 去重 + 超时回落 |
| 10 | Electron 独立进程 Dock 图标 | 视觉噪音 | v1 接受；v2 用 Swift `LSUIElement` 启动器 |
| 11 | Windows 侧 `subprocess-local` 会隐藏 GUI 窗口 | **Windows 版受阻** | 本题只做 macOS；Windows 另案（已有 `hide GUI windows` 文档线索） |
| 12 | 插件版本兼容校验（peer 范围必须匹配 runtime） | 装不上 | `peerDependencies` 与 `devDependencies` 同范围声明；必要时用 `compatibility.json` 豁免 |

**目前没有发现"无法实现"级别的阻塞。**

---

# 6. 未验证项（开工前应做 3 个 spike 消解）

| # | Spike | 目的 | 成本 |
|---|---|---|---|
| S1 | 手写一个最小 Electron 透明置顶穿透窗口，从终端启动 | 验证 macOS 上窗口行为（透明、置顶、跨 Space、穿透、NSPanel 不抢焦点） | 极小 |
| S2 | 从 DSH 的 Host 进程 spawn 一个 GUI 子进程 | 验证**非 GUI 父子进程链**能否正常弹出 GUI 窗口、是否受 App Nap/激活策略影响 | 小 |
| S3 | 评估方案 A（复用 DSH 的 Electron Framework） | 能否省掉 200MB 下载 | 中 |

> 这 3 个 spike 都属于"验证性代码"，不是产品代码。是否允许先做，请确认。

---

# 7. 里程碑建议

| 阶段 | 内容 | 产出 |
|---|---|---|
| M0 | 3 个 spike | 技术路径确认报告 |
| M1 | 助手进程：窗口 + 图集渲染 + 状态动画（用占位图） | 可手动运行的桌宠 |
| M2 | host 插件：`ctx.subprocess` 拉起 + JSON 协议 + `session/event` 映射 | 宠物随 DSH 启动、随状态变化 |
| M3 | 打包与安装：`dsh plugin --profile desktop add ./pkg` | 可在用户机器上安装 |
| M4 | 换正式素材（1536×2288 图集）+ 打磨 | 第一版发布候选 |

---

# 8. 法律与合规

| 对象 | 许可 | 用法 |
|---|---|---|
| `codex-rs/tui/src/pets/*` | Apache-2.0 | 可参考/翻译，需保留许可证与 NOTICE |
| `hatch-pet` skill（契约/脚本） | Apache-2.0 | 可直接用于图集生产，需署名 |
| **ChatGPT.app 主进程 JS** | ❌ 闭源专有 | **只能看行为，一行都不能抄** |
| **Codex 内置宠物美术** | ❌ 专有 | 不可打包分发 |
| `dsh-pet` | MIT | 可参考架构与窗口参数，需署名 |
| `agentpet` / `Hopet` / `agent-paperclip` | MIT | 可参考 |
| `codex-live2d` | ❌ 无 LICENSE | 不可用 |
| "Codex" / "ChatGPT" 名称与 logo | 商标 | 不可使用；仅可描述性提及"兼容 Codex v2 pet 格式" |

**本项目自身许可建议**：MIT（与 DSH 生态一致）。

---

# 9. 待确认事项

1. 是否批准开工（并允许先做 M0 的 3 个 spike）
2. Electron 运行时方案：倾向 B（下载，解耦）还是 A（复用 DSH 自带，省流量）
3. 第一版是否需要"DSH 设置页里的桌宠设置卡"（需要额外做 client 半插件，成本 +1）

# 分发与安装

面向维护者：把插件交到用户手里的几种方式，各自需要满足的条件，以及发布前要改什么。用户侧的操作见 [README](../README.md)，排障见 [使用与排障](usage.md)。

## 用户看到的那一步

Harness Desktop 侧栏 → **插件** → **添加插件**。输入框接受四类 spec：

| 形式 | 例子 | 是否需要先发布 |
|---|---|---|
| npm 包名（可带版本） | `dsh-cyberwhale`、`dsh-cyberwhale@0.1.0` | 需要发到 npm |
| Git 地址 | `https://github.com/CyberWei922/dsh-cyberwhale` | 不需要，仓库公开即可 |
| 压缩包 | Release 里 `.tgz` 的直链，或本机 `.tgz` 路径 | 需要挂到 Release |
| 本地绝对路径 | `/Users/me/dsh-cyberwhale` | 不需要，但只对本机有效（并且是用 `link:` 安装） |

Harness 用 pnpm 在 `desktop` profile 里解析并安装这个 spec，成功后提供**立即启用**：把包名写进 profile 的 `dsh.profile.bundles`。装完不等于一定能加载，加载失败的插件行会在插件页显示为 failed。

已确认的环境事实（本仓库据此对齐）：

- 桌面版 DSH runtime 版本是 `0.2.0-rc.2`（`@deepseek-ai/dsh-desktop-runtime`），插件兼容性按这个版本判定。
- 安装前 Harness 会先 `inspect` spec，**没有组合包 patch 的包直接被拒**（`not-a-bundle`）。
- 兼容性检查只认 `package.json` 里 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 开头的 `peerDependencies`；本地路径与 npm 包名在 pnpm 运行**之前**判定，Git 地址与压缩包只能抓下来**之后**判定（不兼容会回滚）。
- profile 的 `pnpm-workspace.yaml` 设了 `autoInstallPeers: false`，因此声明 peer 不会顺带安装它们。

## 本仓库已经满足的条件

- `dsh.bundle.patch` → `cordis.patch.yml`：少了它插件管理器会直接拒绝安装。
- `lib/client.js` 是已提交的构建产物：安装过程不需要构建。
- 没有任何 `prepare` / `postinstall` 脚本：pnpm 默认拦下依赖安装脚本，有脚本反而会让安装停在「等待授权」。
- `files` 覆盖 `lib` / `helper` / `assets` / `locale` / `tools` / `cordis.patch.yml`。
- `locale/en.json`、`locale/zh.json` 提供插件卡片的中英文标题与描述；`package.json.icon` 指向 `assets/icon.png`（128×128，26 KB，限制是 256 KiB）。
- `peerDependencies` 声明为 `>=0.2.0-rc.2 <1.0.0` 并标为 optional：既让 1.0 之后的运行时在安装前就报出不兼容，又不会让 pnpm 打印缺失 peer 的告警。
- 客户端半插件注册了插件页的两个公开扩展点，让「准备运行时」出现在安装流程里（见下节）。

## 安装流程里的「准备运行时」

桌面版把 Electron 运行时排除在安装包外（100–150 MB），所以装完还要准备一次。官方语音输入插件是同一套做法，我们用它的两个公开 slot：

| slot | 作用 | 我们的实现 |
|---|---|---|
| `plugins.bundle.activation` | 用户**显式启用**组合包（或安装后点「立即启用」）时弹一次引导 | 弹窗「使用桌宠前需要准备运行环境」+「稍后」/「前往安装」 |
| `plugins.bundle.config` | 组合包详情页里的一块配置/操作区 | 「运行环境」面板：估算 + 「下载并准备」+ 可展开的步骤列表 + 取消/重试 |

两条关键约定（都从插件管理器源码里核对过）：

- 两个 slot 都是 `kind: keyed`，`key` **必须精确等于包名**（这里是 `dsh-cyberwhale`）。`官方` 与 `已安装` 两个分组用的是同一个卡片组件，所以第三方 npm 插件一样能触发引导。
- 引导弹窗**只负责导航**，真正开始下载必须由用户在详情页再点一次 —— 不能「点一下启用」就悄悄下载上百 MB。
- 引导弹窗必须自己会在「不需要准备」时关闭（运行时已就绪、或已经在准备中），否则会一直挂在插件页上。

宿主侧把准备建模成**步骤流水**（`getState().runtime.prepare.steps`）：每一步在它第一次出现时追加，上一步自动收尾。只记真实发生过的步骤 —— 缓存命中时根本不会下载，预置固定步骤表会留下一堆永远「未开始」的假步骤。下载步报真实字节，校验/解包报已等待时间（对齐官方：没有可靠进度的步骤不硬凑百分比）。

## 路线一：Git 地址（现在就能用，零发布）

把改动推到 `main`，用户在插件页粘贴仓库地址即可。要求：

- 仓库公开；包在仓库根目录（`package.json` 与 `cordis.patch.yml` 都在根）。
- 用户机器上要有 `git`。
- 更新需要卸载后重装 —— 插件目前不支持自动升级。

这条路线不需要 npm 账号，代价是每个用户都要能访问 GitHub。

## 路线二：Release 里的压缩包

```bash
npm pack                     # 产出 dsh-cyberwhale-<version>.tgz
```

把 tgz 传到 GitHub Release，用户粘贴**指向文件本身**的下载直链。适合想把版本钉死、或不希望用户直接跟 `main` 走的场景。仍需按版本手动上传。

## 双端发布（推荐）

三条路线**可以同时用**，它们共用同一个 tag 和同一份 tarball，只是取货通道不同：

| 通道 | 用户怎么装 | 维护者需要什么 |
|---|---|---|
| GitHub 仓库 | 插件页粘仓库地址 | 无（仓库公开即可） |
| GitHub Release | 插件页粘 `.tgz` 直链，或本地下载后选文件 | 无 |
| npm | 插件页输包名 | **npm 账号** |

**没有 npm 账号时**：GitHub 两条路已经完整可用，什么都不会缺。npm 那条只是「用户少打几个字」的体验升级，可以以后再补。

仓库里的 [`.github/workflows/release.yml`](../.github/workflows/release.yml) 已经把两条通道接好了 ——
**推一个 tag 就自动双端发布，`NPM_TOKEN` 也已配在仓库 secret 里，不需要任何手动步骤。**

```bash
# 1) 改版本号（tag 必须和 package.json 的 version 一致，workflow 会校验）
# 2) 提交后打 tag 并推
git tag -a v0.1.4 -m "v0.1.4：改了什么"
git push origin main --tags
```

workflow 会依次：校验 tag 与版本一致 → 重建 `lib/client.js` 并检查产物已提交 →
跑与平台无关的测试 → `npm pack` → 建 GitHub Release 并附上 `.tgz` → 发布到 npm。

**逐条命令和踩过的坑见下面的[「发布：推 tag 就完事」](#发布推-tag-就完事全自动)。**

> 早期没有 npm 账号时，这一步会在缺少 `NPM_TOKEN` 的情况下**自动跳过**（只留一条 notice），
> 所以打 tag 也能正常产出 GitHub Release。现在 secret 已配好，不会再跳过。

npm 那一步排在创建 Release **之后**，所以即使 npm 发布失败（版本号重复、token 失效、2FA 没配好等），GitHub Release 和 `.tgz` 附件也已经产出了 —— 不会因为一条通道挂掉就什么都拿不到。

> workflow 里的测试步骤是我在 macOS 上验证过的那几支（不含依赖本机进程扫描的 `test-host`）。Linux runner 上若有个别测试行为不同，把对应那一行删掉即可，不影响发布主线。

## npm 账号与自动发布的配置记录

1. <https://www.npmjs.com/signup> 注册：用户名、邮箱、密码，然后点邮件里的验证链接。
2. 开启 2FA：npm 近年在分批**强制发布者启用双重验证**（[官方说明](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)）。用 Authenticator App（TOTP）最省事；建议同时存好恢复码。
3. 交互式发布（本机手动）：

   ```bash
   npm login          # 浏览器或账号密码 + 邮箱一次性验证码
   npm publish        # 会要你输 Authenticator 里的 6 位码
   ```

4. **让 CI 自动发布**需要 token，因为 GitHub Actions 没法输 OTP：
   - 到 <https://www.npmjs.com/settings/cyberwei/tokens> 建一个 **Granular Access Token**，勾上 **Bypass 2FA**，权限给 Read and write，范围限定到这个包。
   - 复制 token，在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 里建 `NPM_TOKEN`。
   - 之后打 tag 就会自动发布；没配这个 secret 时那一步只是一条 notice。

> ⚠️ **token 等同于你的账号密码，永远不要贴进聊天窗口、issue、commit、截图或任何文档。**
> 它只能粘进 GitHub 那个 Secret 输入框（往里贴不会回显）。一旦贴到别处就当已泄露：
> 立刻去 <https://www.npmjs.com/settings/cyberwei/tokens> 撤销，再建一个新的。
> 本机的对话记录会落盘（`$DSH_HOME/storages/…`），撤销比事后删文件可靠得多。

> 上面 2FA 强制范围的具体批次/时间表请以 npm 页面为准（我这边网络抓不到官方文档，未能逐条核对）。

## 路线三：发布到 npm（体验最好）

包名已定为 **`dsh-cyberwhale`**，GitHub 仓库也已同名：`CyberWei922/dsh-cyberwhale`。

**当前状态：v0.1.3 已双端发布** —— <https://www.npmjs.com/package/dsh-cyberwhale> 与
<https://github.com/CyberWei922/dsh-cyberwhale/releases/tag/v0.1.3>（带 provenance 证明）。

**发布是全自动的：推一个 `v*` tag 就够了。** 详见下面的「发布」。

### v0.1.3 改了什么

**档位区间整体缩小 + 图集分辨率翻倍，修掉「调到大/特大以后图会糊」。**

根因：图集格只有 192px，而 1.6 档 + Retina 下屏幕要 614px —— 等于放大 3.2 倍。

- 档位以 Codex 桌宠的显示尺寸（112.6 CSS px）为锚点重排：
  `0.45 / 0.60 / 0.85 / 1.20`（原 `0.70 / 1.00 / 1.30 / 1.60`）
- 图集格 `192×208` → **`352×385`**（图集 1536×2288 → 2816×4235）
- 各档位放大倍率：缩小 0.49× / 缩小 0.65× / 缩小 0.93× / **放大 1.31×**
  （改动前特大档是放大 3.20×，糊的程度减少 59%）
- 窗口包络随之从 1.6 降到 1.2，窗口高度 597 → 456

> **注意**：设置里存过 `> 1.2` 的缩放值会被夹紧到 1.2。
两条通道都实测可用：从 npm 按包名安装、从 Release 的 `.tgz` 安装都能装进 profile 并正常组合。

> 升级老版本时要**先卸载再装**：profile 的 `pnpm-lock.yaml` 会把版本锁死，
> 例如 `^0.1.0` 锁在 `0.1.0` 时，直接重装不会升到新版。

> **命名历史**（新用户不用管）：最初叫 `dsh-deskpet`，但那个 npm 包名属于 `trk23` 的另一个
> DSH 桌宠插件（<https://github.com/udbwhdjwbdj/dsh-deskpet>，v0.1.1，**151 次/月下载**），
> 无法发布；更麻烦的是只要包名还叫那个名字，任何人在插件页输入它，装到的都是**别人那个插件**。
> 同一赛道还有 `dsh-whale-pet`（885 次/月）和 `dsh-whale-girl`（244 次/月），所以换了能区分开的名字。

### 这次改名动了哪些地方

包名、GitHub 地址、客户端分区 id、`$DSH_HOME` 数据目录、`helper/`、`tools/`、`docs/` 全部统一为 `dsh-cyberwhale`。仓库里已经搜不到旧名字 —— 唯一例外是下面这条迁移命令里必须写出来的旧目录名，那是用户数据目录，不是标识。

| 位置 | 说明 |
|---|---|
| `package.json` → `name` | 包名 |
| `cordis.patch.yml` → `insert[].id` / `.name` | `name` 必须与包名完全一致，Loader 用它解析模块，不一致就 `MODULE_NOT_FOUND` |
| `client/index.js` → `SECTION_ID` 与样式标签的 `dataset.plugin` | 设置页分区 id；测试断言它等于包名 |
| `lib/client.js` | 由 `node client/build.mjs` 重建，产物里的 `id` 直接取 `package.json` 的 name |
| `lib/settings.js` | `$DSH_HOME/dsh-cyberwhale/settings.json` |
| `lib/electron-runtime.js`、`lib/electron-provision.js` | `$DSH_HOME/dsh-cyberwhale/electron/` |
| `helper/`、`tools/`、`docs/` | 注释、窗口标题、验证脚本路径与文案 |

> ⚠️ **数据目录也跟着改名了**，旧的 `~/.dsh/dsh-deskpet/` 不再被读取。升级前把旧目录挪过去，
> 否则设置会回到默认值、已解包的 Electron 运行时会被判为不存在（后者会退回
> `@electron/get` 缓存重新解包，通常不需要重新下载）：
>
> ```bash
> mv ~/.dsh/dsh-deskpet ~/.dsh/dsh-cyberwhale            # macOS / Linux
> ```
>
> ```powershell
> Move-Item "$env:USERPROFILE\.dsh\dsh-deskpet" "$env:USERPROFILE\.dsh\dsh-cyberwhale"   # Windows
> ```

改名后本机原来的 `link:` 安装会失效（profile 里记的依赖 key 还是旧包名），需要在插件页重新安装一次。

### 发布：推 tag 就完事（全自动）

仓库已配置 **`.github/workflows/release.yml`**，触发条件是**推 `v*` tag**。
`NPM_TOKEN` 已经配在仓库 secret 里（Settings → Secrets and variables → Actions），
所以一次 tag 推送会同时走完两条通道：

| 通道 | 产出 |
|---|---|
| **npm** | `npm publish --provenance`（带来源证明）|
| **GitHub Release** | 自动建 Release + 附上 `npm pack` 的 `.tgz` |

**日常发版就四步**：

```bash
# 1. 改版本号（三处：package.json 和文档里的当前状态）
npm version patch --no-git-tag-version     # 或手动改 package.json

# 2. 本地跑一遍完整测试（workflow 也会跑，但本地更快发现）
npm test

# 3. 提交
git add package.json docs/distribution.md && git commit -m "chore: 发布 0.1.4（改了什么）"

# 4. 打 tag 并推 —— 这一步就是发布
git tag -a v0.1.4 -m "v0.1.4：改了什么"
git push origin main --tags
```

推完用 `gh run watch` 看进度，约 30 秒。

### workflow 会替你挡掉这些坑

推送之后、真正发布之前，workflow 按顺序检查 —— 任何一条不过就**不会发布**：

| 检查 | 挡掉的问题 |
|---|---|
| **tag 与 `package.json` 版本一致** | 打错 tag、忘了改版本号 |
| **重建 `lib/client.js` 后 git diff 必须干净** | 改了 `client/index.js` 却忘了 `node client/build.mjs` |
| **跑 8 个与平台无关的测试** | 回归（`test-host` 不跑 —— 它依赖本机进程扫描，CI 上不稳定）|

> **发布前一定本地跑一次 `npm test`** —— CI 少了 `test-host`，本地才是全套。

### 手动发布（只在排障时用）

`NPM_TOKEN` 失效、或 workflow 本身出问题时：

```bash
npm login
npm pack --dry-run           # 先看清单，确认 assets/locale/lib 都在
npm publish
```

`prepublishOnly` 会先跑 `node client/build.mjs`，保证发出去的是当前产物。

> 报 `You cannot publish over the previously published versions: <版本号>` 说明
> 「包名 + 版本号」已存在，改版本号再发。

### 历史：这些坑已经踩过并解决了

- **仓库必须先改名再打第一个 tag** —— `--provenance` 会拿实际仓库地址和
  `package.json` 的 `repository.url` 对照，不一致就失败。现在仓库已经是
  `dsh-cyberwhale`，这条不再有问题。
- **`npm version patch` 会顺手打 tag** —— 用 workflow 时加 `--no-git-tag-version`，
  否则你会打出两个 tag。
- **registry 有延迟** —— 发布成功后 `npm view` 可能还要几十秒才看得到新版本
  （日志里会写「may take a few minutes to become available」）。别以为发失败了。

## 发布前的验证

不需要真机点一遍插件页，也能验证「装得上、认得出来」：

```bash
cd <插件仓库>
npm pack
export DSH_HOME=/tmp/scratch-home npm_config_store_dir=/tmp/scratch-store
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DSH" plugin --profile web add "$PWD"/*.tgz    # web profile 会自动初始化
node -e "const p=require('/tmp/scratch-home/profiles/web/package.json');console.log(p.dsh.profile.bundles)"
"$DSH" --profile web --dump-config | grep -A2 'dsh-cyberwhale'   # 组合后的配置树里应有这一行
```

`--dump-config` 退出码为 0、且能 grep 到插件行，说明组合包 patch 解析成功、兼容性检查通过。`desktop` profile 不能这样启动（它由 Electron 应用独占管理），只能靠上面的 `web` profile 走同一条代码路径。

## 已知缺口

- 走 Git 地址或压缩包时，兼容性只能等抓下来之后判定；不兼容会回滚 profile 文件，用户看到的是安装失败。
- 插件没有自动升级：升级要先卸载再装新版。
- Electron 运行时（100–150 MB，随平台而定）不在安装包里。首次启动会自动复用 `@electron/get` 缓存（命中缓存就不用下载），缓存里没有时才需要在设置页点一次「准备运行时」，见 [README](../README.md#安装)。
- **刚发布不足 24 小时的版本会被 pnpm 的供应链策略拦一下**。pnpm 11 默认有 `minimumReleaseAge`（避免装到刚被抢注/投毒的版本）：实测刚发布几分钟的 `dsh-cyberwhale@0.1.0` 会被 pnpm 打印提示，并自动把 `dsh-cyberwhale@0.1.0` 写进 profile 的 `pnpm-workspace.yaml` → `minimumReleaseAgeExclude`。
  - 默认（`minimumReleaseAgeStrict` 未开）只是提示，安装照常成功。
  - 若用户把 `minimumReleaseAgeStrict` 设为 `true`，安装会被拦下要求确认；这种情况让用户等发布满 24 小时，或手动把包名加进 `minimumReleaseAgeExclude`。

### 升级时会被这个策略「静默降级」

`minimumReleaseAge` 只放行**发布满 24 小时**的版本。所以在新版本发布后一天内做「卸载再装」时，pnpm 会在 `^0.1.0` 这个范围里挑**唯一被允许的那个** —— 也就是已经进白名单的旧版本，看起来就像升级没生效。

实测（0.1.2 发布 8 小时后）：

| 版本 | 发布时间 | 相对于重装时刻 | pnpm 是否允许 |
|---|---|---|---|
| 0.1.0 | 25 小时前 | 已满 24h | ✅（且已在 `minimumReleaseAgeExclude`） |
| 0.1.1 | 17 小时前 | 不足 24h | ❌ |
| 0.1.2 | 8 小时前 | 不足 24h | ❌ |

结果：`add dsh-cyberwhale` 仍然装回 0.1.0，`pnpm-lock.yaml` 里还是 `0.1.0`。

**升级到刚发布的版本要「先卸载、再显式写版本号装」**：

```bash
dsh plugin --profile desktop remove dsh-cyberwhale
dsh plugin --profile desktop add dsh-cyberwhale@0.1.2
# → + dsh-cyberwhale 0.1.2
# → Added 1 entry to minimumReleaseAgeExclude: dsh-cyberwhale@0.1.2
```

⚠️ **`remove` 这一步不能省。** 旧版本号留在 `pnpm-lock.yaml` 里时，`add <新版本>` 会先写进一条新的锁文件条目，紧接着**锁文件策略校验**判定它「发布不足 24 小时」而失败 —— pnpm 会回滚，把依赖整个删掉，profile 就停在一个更坏的状态：

```
dependencies: {"dsh-cyberwhale":"^0.1.2"}   ← 声明还在
bundles:      没有 dsh-cyberwhale            ← 被回滚删了
node_modules: 空的                            ← 被回滚删了
```

更坑的是**命令行输出看起来像成功**（能看到 `Packages: +1` 和 `Done in …`），真正的失败只写在 `.plugin-manager/logs/<operation>/pnpm.log` 里：

```
✗ Lockfile failed supply-chain policy check (1 entry in 841ms)
[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] dsh-cyberwhale@0.1.2 was published at
  2026-10-01T04:05:16.000Z, within the minimumReleaseAge cutoff
```

先 `remove` 清掉旧条目后，`add <新版本>` 走的是全新解析，可以正常安装（已在 desktop profile 的真实副本上验证）。

另一个容易被误会的现象：**安装对话框显示的版本和装完后的版本不一致**。对话框里的版本来自 `pluginManager.inspect`（对注册表的 `pnpm view`，拿到的是 latest），而实际安装跑的是范围解析 —— 受策略和锁文件约束。所以会出现「对话框写 0.1.2、插件页显示 0.1.0」，那不是有残留，是策略把安装降级了。装完以插件页显示、或 `node_modules/<包名>/package.json` 的 `version` 为准。

### ⚠️ 不要在 Harness 运行中改 desktop profile

上面这条命令**必须在 Harness 完全退出后**跑。桌面版 CLI 自己会拿 profile 文件锁，但运行中的应用还会用它**内存里**的状态做一次 reconcile —— 两边撞上就会把外部写入覆盖掉，实测会把包从 `dsh.profile.bundles` 里删掉、`node_modules` 清空，最终插件根本不加载。

这个坑很隐蔽：命令输出全是成功，只有事后检查 `node_modules` 才会发现包没了。所以改完一定要确认这三件事：

```bash
P="$HOME/.dsh/profiles/desktop"
node -p "require('$P/node_modules/dsh-cyberwhale/package.json').version"   # 包在不在
grep -c plugins.bundle.activation "$P/node_modules/dsh-cyberwhale/lib/client.js"  # 产物对不对
node -p "require('$P/package.json').dsh.profile.bundles.includes('dsh-cyberwhale')"  # bundles 里有没有它
```
  - 这个副作用会写进用户的 profile，属于 pnpm 的正常行为，不是插件的问题。
- macOS 上的 Electron 首次解包（122 MB 的 zip）需要几十秒，期间设置页的「运行状态」是「窗口启动中…」，属正常现象。

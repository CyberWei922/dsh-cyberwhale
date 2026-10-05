#!/usr/bin/env node
/**
 * 宿主半插件的离线测试：用 mock ctx 跑一遍事件 → 状态 → RPC 的完整链路，
 * 不依赖 DSH，也不需要重启应用。
 *
 * 用法：node tools/test-host.mjs
 */

import { PassThrough, Readable } from 'node:stream';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 用临时 DSH_HOME，别污染真实设置。
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-pet-test-'));

// 测试里显式指定 Electron，避免走「从缓存解包 120MB」那条慢路径，
// 让断言有确定的时序。优先用本机真实运行时；没有就复制一个 node 顶替 ——
// 本测试用的是假的 subprocess 服务，不会真的执行它。
if (process.env.DSH_DESKPET_ELECTRON === undefined || process.env.DSH_DESKPET_ELECTRON === '') {
  const { existsSync } = await import('node:fs');
  const { mkdir, copyFile, chmod } = await import('node:fs/promises');
  const isWin = process.platform === 'win32';
  const localAppData = process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '', 'AppData', 'Local');
  const candidates = isWin
    ? []
    : [`${process.env.HOME}/.dsh/dsh-cyberwhale/electron/Electron.app`, `${process.env.HOME}/Projects/LocalVideo/node_modules/electron/dist/Electron.app`];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found !== undefined) {
    process.env.DSH_DESKPET_ELECTRON = found;
  } else {
    // 兜底：复制一份 node 当假 Electron（Windows 上要叫 electron.exe）。
    const fakeDir = join(process.env.DSH_HOME, 'fake-electron');
    const fakeBinary = join(fakeDir, isWin ? 'electron.exe' : 'Electron');
    if (!existsSync(fakeBinary)) {
      await mkdir(fakeDir, { recursive: true });
      await copyFile(process.execPath, fakeBinary);
      if (!isWin) await chmod(fakeBinary, 0o755);
    }
    process.env.DSH_DESKPET_ELECTRON = fakeBinary;
    void localAppData;
  }
}

const { apply } = await import('../lib/index.js');
const { loadSettings } = await import('../lib/settings.js');

// ── 断言小工具 ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  }
}

// ── mock ctx ──────────────────────────────────────────────────────────────
const sent = [];
const disposers = [];
const listeners = new Map();
const rpcHandlers = new Map();
const registeredRoutes = [];

const spawnedHandles = [];

function makeHandle() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  stdin.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() !== '') sent.push(JSON.parse(line));
    }
  });
  let resolveDone;
  const handle = {
    stdin,
    stdout,
    stderr,
    control: undefined,
    collected: {},
    done: new Promise((resolve) => { resolveDone = resolve; }),
    terminated: false,
    terminate() { handle.terminated = true; },
    waitForExit: async () => true,
    /** 测试专用：模拟这个子进程「稍后」真正退出。 */
    _finish(outcome = { exitCode: 0, signal: null }) { resolveDone(outcome); },
  };
  spawnedHandles.push(handle);
  return handle;
}

let currentHandle = null;
let autoReady = true;

// cordis 会把注入的服务挂成 ctx 上的属性（`ctx.agents`），同时也支持 ctx.get()。
const agentsService = {
  roots: () => [{ id: 'session-main' }],
  list: () => [{ id: 'session-main' }],
};

/**
 * sessionTitle 服务桩。
 *
 * `get(session)` 是 DSH 上真实存在的方法（`SessionTitleService.get`），
 * 用来「从会话日志里折叠出最新标题」。插件必须用它主动读标题 ——
 * 只靠 `session/title` 事件在重启后会拿不到（见 lib/index.js 的 readTitle）。
 */
const sessionTitleService = {
  get: () => ({ title: '测试会话标题', messageSeqs: [], source: { kind: 'fallback' } }),
};

const ctx = {
  logger: { info() {}, debug() {}, warn() {}, error() {} },
  agents: agentsService,
  effect(fn) {
    const disposer = fn();
    if (typeof disposer === 'function') disposers.push(disposer);
    return disposer;
  },
  on(name, handler) {
    const list = listeners.get(name) ?? [];
    list.push(handler);
    listeners.set(name, list);
    return () => {};
  },
  get(name) {
    if (name === 'agents') return agentsService;
    if (name === 'sessionTitle') return sessionTitleService;
    return undefined;
  },
  subprocess: {
    spawn(spec) {
      currentHandle = makeHandle();
      currentHandle.spec = spec;
      const handle = currentHandle;
      if (autoReady) queueMicrotask(() => handle.stdout.write(`${JSON.stringify({ t: 'ready', pid: 123 })}\n`));
      return currentHandle;
    },
  },
  connection: {
    // 自注册路由的鉴权入口：返回 undefined 表示放行。
    requestRejection: () => undefined,
  },
  webServer: {
    register(route) {
      registeredRoutes.push(route.path);
      rpcHandlers.set(route.path, route.handler);
      return () => rpcHandlers.delete(route.path);
    },
  },
};

function emit(name, ...args) {
  for (const handler of listeners.get(name) ?? []) handler(...args);
}

/**
 * 以 HTTP 形态调用插件自注册的路由，等价于浏览器端 connection.rpc.call。
 * 返回解析后的信封 result（{ok:true,value} 或 {ok:false,error}）。
 */
function rpc(endpoint, payload) {
  const handler = rpcHandlers.get('/deskpet');
  if (handler === undefined) return Promise.resolve({ ok: false, error: { code: 'test/no-route', message: '路由未注册', details: {} } });

  return new Promise((resolve) => {
    const req = new PassThrough();
    req.method = 'POST';
    req.url = `/deskpet/${endpoint}`;
    req.headers = { host: '127.0.0.1:19387' };

    let status = 0;
    const chunks = [];
    const res = {
      writeHead(code) { status = code; return this; },
      end(data) {
        if (data !== undefined) chunks.push(String(data));
        let parsed;
        try { parsed = JSON.parse(chunks.join('')); } catch { parsed = null; }
        resolve(parsed?.result ?? { ok: false, error: { code: 'test/bad-envelope', message: `HTTP ${status}`, details: {} } });
      },
    };

    void handler(req, res);
    process.nextTick(() => {
      req.end(JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method: endpoint, payload: payload ?? {} }));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询等待条件成立：启动链路里有异步的设置读取与孤儿清扫（Windows 上要起 PowerShell）。 */
async function waitFor(predicate, timeoutMs = 8000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return false;
}

// ── 开跑 ──────────────────────────────────────────────────────────────────
console.log('\n[1] 插件加载');
apply(ctx);
await waitFor(() => currentHandle !== null);

check('注册了 /deskpet 路由', registeredRoutes.includes('/deskpet'), true);
check('订阅了 session/event', listeners.has('session/event'), true);
check('订阅了 agent/error', listeners.has('agent/error'), true);
check('订阅了 user-questions/request', listeners.has('user-questions/request'), true);
check('拉起了助手进程', currentHandle !== null, true);
if (currentHandle !== null) {
  const argv = currentHandle.spec.argv;
  check('可执行文件是 Electron', /(?:^|[\\/])(?:Electron|electron(?:\.exe)?)$/.test(argv[0]), true);
  check('第一个参数是 helper 目录', /[\\/]helper$/.test(argv[1]), true);
  if (process.platform === 'win32') {
    check('Windows 请求了 control 管道', currentHandle.spec.stdio.control, 'pipe');
  }
  check('传了 assets 参数', argv.some((a) => a.startsWith('--assets=')), true);
  check('stdio 用的是 pipe', currentHandle.spec.stdio.stdin, 'pipe');
  check('给了 graceMs', typeof currentHandle.spec.graceMs, 'number');
  // 清掉启动时的 state 下发
  sent.length = 0;
}

console.log('\n[2] 事件 → 状态映射');
// 注意：宿主对相同状态做了去重（同一状态不会重复下发），所以这里断言的是
// 逻辑状态（通过 getState 读），而不是「每次都发了一条消息」。
const cases = [
  [{ type: 'turn/start' }, 'running', 'turn/start → running'],
  [{ type: 'tool/call' }, 'running', 'tool/call → running'],
  [{ type: 'tool/result' }, 'review', 'tool/result → review（瞬态）'],
  [{ type: 'approval/asked' }, 'waiting', 'approval/asked → waiting'],
  [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }, 'jumping', '正常完成 → jumping'],
  [{ type: 'turn/end', data: { reason: { kind: 'error' } } }, 'failed', '出错 → failed'],
  [{ type: 'turn/end', data: { reason: { kind: 'aborted' } } }, 'idle', '取消 → idle'],
];

for (const [event, expected, label] of cases) {
  emit('session/event', { id: 'session-main' }, event);
  await sleep(60);
  const reply = await rpc('getState');
  check(label, reply.value.animation, expected);
}

console.log('\n[3] 子代理会话必须被忽略');
const beforeSub = (await rpc('getState')).value.animation;
emit('session/event', { id: 'session-sub' }, { type: 'turn/start' });
await sleep(60);
check('非顶级会话不改变状态', (await rpc('getState')).value.animation, beforeSub);

console.log('\n[3b] 气泡两行：会话标题（回归 —— 插件启动晚于标题事件）');
{
  // 真实场景：`session/title` 事件只在标题被设置的那一刻发一次（会话开头，
  // 或用户改名）。用户中途重启 DSH 之后，插件内存里没有标题，
  // 如果只被动等事件，气泡第一行会永远是空的 —— 这个 bug 真出现过。
  // 正确做法是每次开新一轮都主动向 sessionTitle 服务读一次。
  sent.length = 0;
  emit('session/event', { id: 'session-main' }, { type: 'turn/start' });
  await sleep(80);

  const bubble = sent.filter((m) => m.t === 'bubble').at(-1);
  check('重启后第一行仍有标题（主动读取生效）', bubble?.title, '测试会话标题');
  check('第二行是任务状态', bubble?.status, '正在分析请求');

  // 反过来：事件真的来了要能覆盖服务读到的值
  sent.length = 0;
  emit('session/event', { id: 'session-main' }, { type: 'session/title', data: { title: '改名之后' } });
  await sleep(120);
  check('收到 session/title 事件后立刻更新', sent.filter((m) => m.t === 'bubble').at(-1)?.title, '改名之后');
}

console.log('\n[4] 瞬态到期后自动回落');
sent.length = 0;
emit('session/event', { id: 'session-main' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
await sleep(220);
check('先播 jumping', (await rpc('getState')).value.animation, 'jumping');
await sleep(3000); // 超过 jumping 的 2600ms
check('随后回落 idle', (await rpc('getState')).value.animation, 'idle');
check('回落时确实向窗口下发了新状态', sent.filter((m) => m.t === 'state').at(-1)?.v, 'idle');

console.log('\n[5] RPC 通道');
const stateReply = await rpc('getState');
check('getState 返回 ok', stateReply.ok, true);
check('getState 带 settings', typeof stateReply.value.settings.scale, 'number');
check('getState 带 limits（上限与窗口包络一致）', stateReply.value.limits.scale.max, 1.2);
check('getState 带 runtime', typeof stateReply.value.runtime.running, 'boolean');

const before = currentHandle;
const spawnsBeforeScale = spawnedHandles.length;
sent.length = 0;
const updateReply = await rpc('updateSettings', { scale: 1.15 });
check('updateSettings 返回新值', updateReply.value.settings.scale, 1.15);
check('缩放变化【不】重启进程（改为就地改窗口尺寸）', spawnedHandles.length, spawnsBeforeScale);
check('缩放通过 config 热下发给窗口', sent.filter((m) => m.t === 'config').at(-1)?.scale, 1.15);

const disabled = await rpc('updateSettings', { enabled: false });
check('可以关闭桌宠', disabled.value.settings.enabled, false);
const persisted = await loadSettings();
check('设置已落盘', persisted.scale, 1.15);

const greeting = await rpc('command', { action: 'greeting' });
check('greeting 命令成功', greeting.ok, true);
const unknown = await rpc('command', { action: 'nope' });
check('未知命令返回错误', unknown.ok, false);
check('错误码正确', unknown.error.code, 'pet/unknown-command');
const badEndpoint = await rpc('nope');
check('未知端点返回错误', badEndpoint.error.code, 'pet/unknown-endpoint');

console.log('\n[5b] 进程生命周期：换进程不会泄漏（回归测试）');
// 复现此前的 bug 时序：restart() 先杀旧、起新，而【旧进程的 done 稍后才 resolve】。
// 之前的实现会在旧进程退出回调里把新进程的引用清空、并再安排一次启动，
// 结果是每操作一次就多一只桌宠，且丢失引用后再也杀不掉。
await rpc('updateSettings', { enabled: true });
await sleep(60);

const spawnsBeforeRestart = spawnedHandles.length;
const stale = currentHandle;
await rpc('command', { action: 'restart' });
await sleep(60);

check('重启产生了且仅产生一个新进程', spawnedHandles.length, spawnsBeforeRestart + 1);
const fresh = currentHandle;
check('新进程与旧进程不同', fresh !== stale, true);
check('旧进程已被要求终止', stale.terminated, true);

// 关键一步：让旧进程【延后】报告退出
stale._finish({ exitCode: 0, signal: null });
await sleep(300);

check('旧进程的退出回调没有清掉新进程的引用', currentHandle, fresh);
check('旧进程的退出回调没有再多起一个进程', spawnedHandles.length, spawnsBeforeRestart + 1);
check('窗口仍在运行状态', (await rpc('getState')).value.runtime.running, true);

// 关闭 → 停进程；再打开 → 起一个
await rpc('updateSettings', { enabled: false });
await sleep(60);
check('关闭开关后没有活动窗口', (await rpc('getState')).value.runtime.running, false);
const spawnsBeforeReopen = spawnedHandles.length;
await rpc('updateSettings', { enabled: true });
await sleep(60);
check('重新打开只起一个窗口', spawnedHandles.length, spawnsBeforeReopen + 1);
check('重新打开后恢复运行', (await rpc('getState')).value.runtime.running, true);

console.log('\n[5b-extra] 助手就绪前状态不得丢失');
autoReady = false;
await rpc('command', { action: 'restart' });
sent.length = 0;
emit('session/event', { id: 'session-main' }, { type: 'turn/start' });
await sleep(120);
check('就绪前不发送状态', sent.filter((m) => m.t === 'state').length, 0);
await rpc('updateSettings', { scale: 1.2 });
currentHandle.stdout.write(`${JSON.stringify({ t: 'ready', pid: 456 })}\n`);
await sleep(30);
check('就绪后补发当前状态', sent.filter((m) => m.t === 'state').at(-1)?.v, 'running');
check('就绪后补发当前气泡', sent.filter((m) => m.t === 'bubble').at(-1)?.status, '正在分析请求');
check('就绪后使用最新配置', sent.filter((m) => m.t === 'config').at(-1)?.scale, 1.2);
await rpc('updateSettings', { bubbles: false });
sent.length = 0;
await rpc('updateSettings', { bubbles: true });
await sleep(30);
check('重新打开气泡恢复当前任务', sent.filter((m) => m.t === 'bubble').at(-1)?.status, '正在分析请求');
sent.length = 0;
await rpc('command', { action: 'greeting' });
await sleep(160);
check('首次招呼请求重播动画', sent.filter((m) => m.t === 'state').at(-1)?.restart, true);
sent.length = 0;
await rpc('command', { action: 'greeting' });
await sleep(160);
check('连续招呼不会被相同状态去重吞掉', sent.filter((m) => m.t === 'state').at(-1)?.restart, true);
autoReady = true;

console.log('\n[5c] 孤儿进程清扫');
{
  const { spawn } = await import('node:child_process');
  const { mkdtemp, symlink, copyFile, writeFile } = await import('node:fs/promises');
  const { findMatchingProcesses, sweepOrphanHelpers } = await import('../lib/orphans.js');
  const isWin = process.platform === 'win32';
  // 用绝对路径当标记：Windows 的 CIM 查询按可执行文件名筛，且命令行里必须出现它。
  const fakeHome = await mkdtemp(join(tmpdir(), 'deskpet-orphan-'));
  const marker = join(fakeHome, 'dsh-cyberwhale-orphan-marker');
  await writeFile(marker, 'marker');

  // 起一个「看起来像 Electron 助手」的进程。
  //   - macOS/Linux：可执行文件名字必须是 Electron（做符号链接）。
  //   - Windows：清扫只查 electron.exe，所以复制 node 为 electron.exe。
  const fakeElectron = join(fakeHome, isWin ? 'electron.exe' : 'Electron');
  if (isWin) await copyFile(process.execPath, fakeElectron);
  else await symlink(process.execPath, fakeElectron);
  const idleScript = join(fakeHome, 'idle.js');
  await writeFile(idleScript, 'setTimeout(() => {}, 60000);\n', 'utf8');
  const victim = isWin
    ? spawn(fakeElectron, [idleScript, marker], { stdio: 'ignore' })
    : spawn(fakeElectron, ['-e', 'setTimeout(() => {}, 60000)', marker], { stdio: 'ignore' });
  await sleep(600);
  check('能找到带标记的 Electron 进程', (await findMatchingProcesses(marker, { electronOnly: true })).length, 1);

  // 反向用例：名字不是 Electron 的进程（哪怕命令行里有同样路径）不该被误伤
  const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', marker], { stdio: 'ignore' });
  await sleep(600);
  check('不加限制时两个进程都能看到', (await findMatchingProcesses(marker)).length, isWin ? 1 : 2);
  check('只认 Electron 时普通进程被排除', (await findMatchingProcesses(marker, { electronOnly: true })).length, 1);
  try { process.kill(bystander.pid, 'SIGKILL'); } catch { /* 已退出 */ }

  const killed = await sweepOrphanHelpers({ helperDir: marker, logger: { info() {} } });
  await sleep(600);
  let alive = true;
  try {
    process.kill(victim.pid, 0);
  } catch {
    alive = false;
  }
  check('清扫掉了 1 个', killed, 1);
  check('目标已不再存活', alive, false);

  // 不该误伤自己
  check('没有把当前进程算进去', (await findMatchingProcesses(process.argv[1] ?? 'x')).includes(process.pid), false);
}

console.log('\n[5d] 运行环境：getState 新字段与准备端点');
{
  const idle = await rpc('getState');
  check('getState 带 runtime.provisionable', typeof idle.value.runtime.provisionable, 'boolean');
  // 本测试显式指定了可用的 DSH_DESKPET_ELECTRON，所以不是「缺运行时」。
  check('运行时可用的前提下 provisionable=false', idle.value.runtime.provisionable, false);
  check('getState 带 runtime.prepare.status', idle.value.runtime.prepare.status, 'idle');
  check(
    'prepare 的字段齐全（插件页按它渲染进度）',
    Object.keys(idle.value.runtime.prepare).sort(),
    ['error', 'finishedAt', 'phase', 'received', 'source', 'startedAt', 'status', 'steps', 'total'],
  );
  check('初始没有步骤', Array.isArray(idle.value.runtime.prepare.steps) && idle.value.runtime.prepare.steps.length, 0);

  const beforeSpawns = spawnedHandles.length;
  const started = await rpc('prepareRuntime', {});
  check('prepareRuntime 返回 ok', started.ok, true);
  // 端点必须【立即】返回：下载要几分钟，若等它完成，设置页就没法显示进度了。
  check('prepareRuntime 立即返回 running', started.value.prepare.status, 'running');
  check('prepareRuntime 立即返回 phase=checking', started.value.prepare.phase, 'checking');
  check('启动后立刻记下第一步', started.value.prepare.steps[0]?.kind, 'check');
  check('第一步是进行中', started.value.prepare.steps[0]?.status, 'running');

  await sleep(400);
  const after = (await rpc('getState')).value.runtime;
  check('本机已有运行时时准备立即完成', after.prepare.status, 'done');
  check('完成后 phase 是 ready', after.prepare.phase, 'ready');
  check('完成后清掉错误', after.prepare.error, null);
  // 步骤流水只记真实发生过的事：本机已有运行时时不会下载，
  // 所以不该凭空多出 download / verify / extract 三个永远「未开始」的步骤。
  check(
    '已有运行时只记「检查」这一步',
    after.prepare.steps.map((step) => `${step.kind}:${step.status}`),
    ['check:done'],
  );
  check('步骤带开始与结束时间', typeof after.prepare.steps[0].startedAt === 'number' && typeof after.prepare.steps[0].finishedAt === 'number', true);
  // 成功后要自动把「缺运行时没起来」的窗口拉起来，用户不必重启 DSH。
  check('准备完成后桌宠窗口被重新拉起', spawnedHandles.length > beforeSpawns, true);

  const cancelled = await rpc('cancelRuntime');
  check('任务已结束时 cancelRuntime 仍返回 ok', cancelled.ok, true);
  check('取消不会把已完成的状态改回 idle', cancelled.value.prepare.status, 'done');
}

console.log('\n[6] user-questions waterfall 必须放行 next()');
let nextCalled = false;
const waterfallResult = emit('user-questions/request', { question: 'x' }, () => {
  nextCalled = true;
  return Promise.resolve({ answered: true });
});
check('调用了 next()', nextCalled, true);

console.log('\n[7] 路由的 HTTP 层');
/** 直接按任意方法/路径打一次路由，返回 {status, body}。 */
function rawRequest({ method, url, rejection, body }) {
  const handler = rpcHandlers.get('/deskpet');
  return new Promise((resolve) => {
    const req = new PassThrough();
    req.method = method;
    req.url = url;
    req.headers = {};
    let status = 0;
    let headers = {};
    const chunks = [];
    const res = {
      writeHead(code, values) { status = code; headers = values ?? {}; return this; },
      end(data) { if (data !== undefined) chunks.push(String(data)); resolve({ status, body: chunks.join(''), headers }); },
    };
    if (rejection !== undefined) {
      const original = ctx.connection.requestRejection;
      ctx.connection.requestRejection = () => rejection;
      void handler(req, res).finally(() => { ctx.connection.requestRejection = original; });
    } else {
      void handler(req, res);
    }
    process.nextTick(() => req.end(body ?? ''));
  });
}

check('GET 返回 405', (await rawRequest({ method: 'GET', url: '/deskpet/getState' })).status, 405);
check('未鉴权时返回 401', (await rawRequest({ method: 'POST', url: '/deskpet/getState', rejection: 401 })).status, 401);
check('跨站被拒时返回 403', (await rawRequest({ method: 'POST', url: '/deskpet/getState', rejection: 403 })).status, 403);
check('非法 JSON 返回 200 + 错误信封', (await rawRequest({ method: 'POST', url: '/deskpet/getState', body: '{oops' })).status, 200);
const badJson = await rawRequest({ method: 'POST', url: '/deskpet/getState', body: '{oops' });
check('非法 JSON 的信封是失败', JSON.parse(badJson.body).result.ok, false);
check('错误码是 bad-request', JSON.parse(badJson.body).result.error.code, 'pet/bad-request');
const okBody = await rawRequest({
  method: 'POST',
  url: '/deskpet/getState',
  body: JSON.stringify({ type: 'client-request', rpcId: 'abc', method: 'getState', payload: {} }),
});
check('正常请求返回 200', okBody.status, 200);
check('信封形状正确', JSON.parse(okBody.body).type, 'server-response');
check('回显 rpcId', JSON.parse(okBody.body).rpcId, 'abc');

console.log('\n[7b] 主题与鉴权壁纸');
const beforeAppearance = (await rpc('getState')).value.settings;
const appearanceInitial = (await rpc('getAppearance')).value;
check('主题有独立配置', typeof appearanceInitial.revision, 'string');
const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZkAAAAASUVORK5CYII=';
const uploaded = await rpc('uploadWallpaper', { dataURL: imageData, name: 'test.png' });
check('图片上传成功', uploaded.ok, true);
const imageRoute = `/deskpet/appearance/wallpaper/${uploaded.value.id}`;
check('未登录不能读取壁纸', (await rawRequest({ method: 'GET', url: imageRoute, rejection: 401 })).status, 401);
check('跨站不能读取壁纸', (await rawRequest({ method: 'GET', url: imageRoute, rejection: 403 })).status, 403);
const imageResponse = await rawRequest({ method: 'GET', url: imageRoute });
check('本机能读取壁纸', imageResponse.status, 200);
check('图片类型正确', imageResponse.headers['content-type'], 'image/png');
check('拒绝非法资源路径', (await rawRequest({ method: 'GET', url: '/deskpet/appearance/wallpaper/not-an-id' })).status, 404);
const appearanceUpdate = await rpc('updateAppearance', { revision: appearanceInitial.revision, config: { ...appearanceInitial.config, enabled: false, wallpaper: uploaded.value, background: 'image' } });
check('主题能单独关闭', appearanceUpdate.value.config.enabled, false);
check('关闭主题不更改桌宠设置', (await rpc('getState')).value.settings, beforeAppearance);
check('过期主题草稿被拒绝', (await rpc('updateAppearance', { revision: appearanceInitial.revision, config: appearanceInitial.config })).ok, false);
check('拒绝可执行图片格式', (await rpc('uploadWallpaper', { dataURL: 'data:image/svg+xml;base64,PHN2Zz4=' })).ok, false);

console.log('\n[8] 释放');
const liveBeforeDispose = spawnedHandles.filter((h) => h.terminated !== true).length;
check('释放前确实有活着的进程（前提成立）', liveBeforeDispose > 0, true);

for (const disposer of disposers) await disposer();
await sleep(60);

check('释放后没有遗留未终止的进程', spawnedHandles.filter((h) => h.terminated !== true).length, 0);
check('释放后清空路由注册', rpcHandlers.has('/deskpet'), false);
for (const disposer of disposers) await disposer();
check('重复释放是幂等的', true, true);

console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
process.exitCode = failed === 0 ? 0 : 1;

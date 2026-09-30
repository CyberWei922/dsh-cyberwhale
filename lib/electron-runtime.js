/**
 * 定位（必要时准备）助手进程要用的 Electron 运行时。
 *
 * 查找顺序（第一个命中即用）：
 *   1. `DSH_DESKPET_ELECTRON`            —— 显式指定二进制或 .app
 *   2. `<plugin>/runtime/electron/`  —— 已准备好的运行时
 *   3. `$DSH_HOME/dsh-cyberwhale/electron/` —— 已解包到 DSH home 的运行时
 *   4. `@electron/get` 的下载缓存    —— 本机已有缓存时直接解包，无需联网
 *   5. `<plugin>/node_modules/electron/dist/` —— 开发期本地安装
 *
 * 第 4 步只读缓存、不发起下载：桌宠不希望在用户毫无察觉时拉 100+MB。
 * 缓存未命中时返回可执行的修复指引，由调用方决定怎么提示用户。
 *
 * @module dsh-cyberwhale/electron-runtime
 */

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, platform as osPlatform, arch as osArch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { resolveDshHome } from './settings.js';

const run = promisify(execFile);

/** 本包根目录。 */
export const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

/** 运行时目录名。 */
const RUNTIME_DIR = 'electron';

/**
 * 各平台可执行文件相对于解包目录的位置。
 *
 * 三个平台都**显式列出**，不靠 `else` 兜底 —— 兜底会让"漏了一个平台"
 * 变成静默走错路径，而不是立刻报错。
 *
 * @param platform - `process.platform` 的值。
 */
export function binaryRelativePath(platform) {
  if (platform === 'darwin') return join('Electron.app', 'Contents', 'MacOS', 'Electron');
  if (platform === 'win32') return 'electron.exe';
  if (platform === 'linux') return 'electron';
  throw new Error(`未知平台：${platform}（目前支持 darwin / win32 / linux）`);
}

/** 各平台的 @electron/get 产物名后缀。 */
export function artifactSuffix(platform = osPlatform(), arch = osArch()) {
  if (platform === 'darwin') return `darwin-${arch === 'x64' ? 'x64' : 'arm64'}`;
  if (platform === 'win32') return `win32-${arch === 'x64' ? 'x64' : 'arm64'}`;
  return `linux-${arch === 'x64' ? 'x64' : 'arm64'}`;
}

/**
 * Electron 缓存根目录（@electron/get 的默认位置）。
 *
 * `platform` 可注入 —— 否则在 macOS 上就永远测不了 Windows 那条分支，
 * 而"改好一端弄坏另一端"正是发生在这种没法测的地方。
 *
 * @param env - 环境变量（默认 `process.env`）。
 * @param platform - `process.platform` 的值。
 */
export function electronCacheRoot(env = process.env, platform = osPlatform()) {
  if (env.ELECTRON_CACHE) return env.ELECTRON_CACHE;
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'electron');
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(local, 'electron', 'Cache');
  }
  if (platform === 'linux') return join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'electron');
  throw new Error(`未知平台：${platform}（目前支持 darwin / win32 / linux）`);
}

async function exists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function existsAny(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把用户给的路径归一化成可直接 spawn 的可执行文件。
 *
 * 只有 macOS 的 `.app` 需要展开；其他平台用户直接给二进制路径（或 `.exe`）。
 *
 * @param candidate - `DSH_DESKPET_ELECTRON` 的值。
 * @param platform - `process.platform` 的值。
 */
export function toBinary(candidate, platform = osPlatform()) {
  if (platform === 'darwin' && candidate.endsWith('.app')) {
    return join(candidate, 'Contents', 'MacOS', 'Electron');
  }
  return candidate;
}

/**
 * 在 @electron/get 的缓存里找现成的 Electron 压缩包。
 * @param {object} [options]
 * @returns {Promise<{ zip: string, version: string } | null>}
 */
export async function findCachedZip({ env = process.env, platform = osPlatform(), arch = osArch() } = {}) {
  // 注意要把 platform 传下去：漏掉的话会去**当前机器**的缓存目录里找
  // 另一个平台的产物名，永远找不到。
  const root = electronCacheRoot(env, platform);
  if (!(await existsAny(root))) return null;

  const suffix = artifactSuffix(platform, arch);
  const wanted = env.DSH_DESKPET_ELECTRON_VERSION?.trim();
  const pattern = /^electron-v(.+?)-(.+?)\.zip$/;

  const hits = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    for (const file of await readdir(dir).catch(() => [])) {
      const match = pattern.exec(file);
      if (match === null) continue;
      const [, version, foundSuffix] = match;
      if (foundSuffix !== suffix) continue;
      if (wanted !== undefined && wanted !== '' && version !== wanted) continue;
      hits.push({ zip: join(dir, file), version });
    }
  }
  if (hits.length === 0) return null;

  // 取版本号最大的一个。
  hits.sort((a, b) => compareVersions(b.version, a.version));
  return hits[0];
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * PowerShell 单引号字符串里的转义（路径可能带空格 / 中文 / 单引号）。
 * @param value - 要嵌入 PowerShell 单引号字符串的值。
 */
function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * 解包一个 zip 要跑哪些命令（按顺序尝试，前一个失败就用下一个）。
 *
 * **抽成纯函数是为了能在任意平台上测所有平台的分支。**
 * 如果把 `if (osPlatform() === 'win32')` 直接写在 extractZip 里，
 * 在 macOS 上就永远走不到 Windows 那条路 —— 而"改好 Windows 弄坏 macOS"
 * 恰恰发生在这种测不到的地方。
 *
 * @param platform - `process.platform` 的值。
 * @param zip - 源 zip 路径。
 * @param destination - 目标目录。
 * @returns 依次尝试的命令列表。
 */
export function extractionPlan(platform, zip, destination) {
  if (platform === 'darwin') {
    return [
      // ditto 保留符号链接与权限，比 unzip 更适合 .app 包。
      { command: 'ditto', args: ['-x', '-k', zip, destination] },
      { command: 'unzip', args: ['-q', '-o', zip, '-d', destination] },
    ];
  }
  if (platform === 'win32') {
    return [
      // Windows 10+ 自带 bsdtar（tar.exe），能直接解 zip 且比 Expand-Archive 快很多。
      { command: 'tar', args: ['-xf', zip, '-C', destination] },
      // 兜底：老系统没有 tar 时用 PowerShell。
      // 两处细节都是真机踩过的：
      //   - 路径可能含单引号 → 必须转义，否则命令被截断；
      //   - 默认的 Expand-Archive 失败是**非终止错误**，powershell.exe 仍然退出 0 ——
      //     不设 ErrorActionPreference=Stop 的话，「解包失败」会被当成成功。
      {
        command: 'powershell',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quotePowerShell(zip)} -DestinationPath ${quotePowerShell(destination)} -Force`,
        ],
      },
    ];
  }
  if (platform === 'linux') {
    return [{ command: 'unzip', args: ['-q', '-o', zip, '-d', destination] }];
  }
  throw new Error(`未知平台：${platform}（目前支持 darwin / win32 / linux）`);
}

/**
 * 解包一个 zip 到目标目录（覆盖式）。
 *
 * @param zip - 源 zip。
 * @param destination - 目标目录。
 * @param platform - 可注入，便于测试。
 */
export async function extractZip(zip, destination, platform = osPlatform()) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  let lastError = null;
  for (const step of extractionPlan(platform, zip, destination)) {
    try {
      await run(step.command, step.args, { maxBuffer: 64 * 1024 * 1024 });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `解包失败（${platform}）：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * 带安全替换的解包：先把 zip 解到同级 staging 目录，确认里面真的出现了可执行文件，
 * 再用可回滚的同卷 rename 替换目标目录。
 *
 * 两条硬性保证：
 *   1. **绝不覆盖已有可用运行时** —— 中途失败时目标目录原样保留
 *      （`extractZip` 是「先 rm -rf 再解」，一旦 zip 损坏就会把好的运行时也删掉）；
 *   2. 只安装已解完的目录（同卷 rename）；安装失败时恢复旧目录。
 *
 * @param zip - 源 zip。
 * @param destination - 目标运行时目录。
 * @param platform - 可注入，便于测试。
 * @returns 解包后可执行文件的路径。
 */
export async function extractElectronZip(zip, destination, platform = osPlatform()) {
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(`${destination}.staging-`);
  try {
    let lastError = null;
    let ok = false;
    for (const step of extractionPlan(platform, zip, staging)) {
      try {
        await run(step.command, step.args, { maxBuffer: 64 * 1024 * 1024 });
        ok = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!ok) {
      throw new Error(
        `解包失败（${platform}）：${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    }
    const binary = join(staging, binaryRelativePath(platform));
    if (!(await exists(binary))) {
      // 解包器没报错但没有产物，通常是压缩包本身损坏。
      throw new Error(`解包后未找到可执行文件（压缩包可能已损坏）：${binary}`);
    }
    // 保留旧目录直到新目录安装成功；Windows 文件锁或 rename 失败时回滚。
    const backup = `${staging}.previous`;
    let hadPrevious = false;
    try {
      await rename(destination, backup);
      hadPrevious = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (hadPrevious) await rename(backup, destination);
      throw error;
    }
    if (hadPrevious) await rm(backup, { recursive: true, force: true }).catch(() => {});
    return join(destination, binaryRelativePath(platform));
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * 读取解包目录里的 Electron 版本号。
 *
 * 官方发行包会在根目录放一个 `version` 文件（例如 `43.4.1`）。
 * @param dir - 运行时目录。
 * @returns 版本号，读不到时 undefined。
 */
export async function readRuntimeVersion(dir) {
  for (const name of ['version', 'VERSION']) {
    try {
      const text = (await readFile(join(dir, name), 'utf8')).trim();
      if (text !== '') return text;
    } catch {
      // 文件不存在就试下一个名字
    }
  }
  return undefined;
}

/**
 * 「本机没有可用的 Electron 运行时」。
 *
 * 为什么要一个专用错误而不是普通 Error：设置页要靠它决定**要不要**显示
 * 「准备运行时」按钮 —— 只有「确实没装」才值得引导用户去下 100+MB；
 * 路径写错、解包损坏之类的失败不该被同一个按钮糊过去。带稳定 `code`
 * 是为了让调用方按码判断，而不是去 match 中文文案。
 */
export class MissingRuntimeError extends Error {
  /** 稳定错误码。 */
  code = 'missing-runtime';

  constructor(message) {
    super(message);
    this.name = 'MissingRuntimeError';
  }
}

/**
 * 解析出可直接 spawn 的 Electron 可执行文件。
 * @param {object} [options]
 * @returns {Promise<{ binary: string, version?: string, source: string }>}
 * @throws {MissingRuntimeError} 本机没有任何可用运行时（`message` 内含修复指引）
 * @throws {Error} 其他失败（例如 `DSH_DESKPET_ELECTRON` 指向的不是可执行文件）
 */
export async function resolveElectron({ env = process.env, platform = osPlatform(), arch = osArch() } = {}) {
  const explicit = env.DSH_DESKPET_ELECTRON?.trim();
  if (explicit !== undefined && explicit !== '') {
    const binary = toBinary(explicit, platform);
    if (await exists(binary)) {
      return { binary, version: await readRuntimeVersion(dirname(binary)), source: 'DSH_DESKPET_ELECTRON' };
    }
    throw new Error(`DSH_DESKPET_ELECTRON 指向的路径不是可执行文件：${binary}`);
  }

  const prepared = [
    { dir: join(pluginRoot, 'runtime', RUNTIME_DIR), source: 'plugin/runtime' },
    { dir: join(resolveDshHome(env), 'dsh-cyberwhale', RUNTIME_DIR), source: 'dsh-home' },
  ];
  for (const { dir, source } of prepared) {
    const binary = join(dir, binaryRelativePath(platform));
    if (await exists(binary)) return { binary, version: await readRuntimeVersion(dir), source };
  }

  // 开发期：本地 node_modules 里装了 electron
  const devBinary = join(pluginRoot, 'node_modules', 'electron', 'dist', binaryRelativePath(platform));
  if (await exists(devBinary)) return { binary: devBinary, source: 'node_modules/electron' };

  const cached = await findCachedZip({ env, platform, arch });
  if (cached !== null) {
    const destination = join(resolveDshHome(env), 'dsh-cyberwhale', RUNTIME_DIR);
    // 已有可用运行时就直接用 —— 绝不用缓存包把它覆盖掉。
    const binary = join(destination, binaryRelativePath(platform));
    if (await exists(binary)) return { binary, version: cached.version, source: 'dsh-home' };
    await extractElectronZip(cached.zip, destination, platform);
    if (await exists(binary)) return { binary, version: cached.version, source: 'electron-cache' };
    throw new Error(`从缓存解包后仍未找到可执行文件：${binary}`);
  }

  const explicitExample = platform === 'win32' ? '<...>\\electron.exe' : '/path/to/Electron';
  throw new MissingRuntimeError(
    [
      '找不到可用的 Electron 运行时。请任选一种方式：',
      `  1) 设置环境变量 DSH_DESKPET_ELECTRON=${explicitExample}`,
      '  2) 运行 `node tools/ensure-electron.mjs` 从官方源下载并校验',
      `  3) 把 electron-v<version>-${artifactSuffix(platform, arch)}.zip 放进 ${electronCacheRoot(env, platform)}`,
    ].join('\n'),
  );
}

/**
 * 判断运行时是否已就绪（不抛错）。
 *
 * 失败时带上 `code`：`missing-runtime` 表示「本机没有运行时」（可以引导用户
 * 一键准备），其余失败（路径写错、解包损坏…）用 `runtime-error`。
 * 成功时的形状保持不变。
 *
 * @returns {Promise<{ ok: true, binary: string, version?: string, source: string }
 *   | { ok: false, code: string, error: string }>}
 */
export async function probeElectron(options) {
  try {
    return { ok: true, ...(await resolveElectron(options)) };
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === 'string' && error.code !== '' ? error.code : 'runtime-error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

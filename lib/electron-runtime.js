/**
 * 定位（必要时准备）助手进程要用的 Electron 运行时。
 *
 * 查找顺序（第一个命中即用）：
 *   1. `DSH_DESKPET_ELECTRON`            —— 显式指定二进制或 .app
 *   2. `<plugin>/runtime/electron/`  —— 已准备好的运行时
 *   3. `$DSH_HOME/dsh-deskpet/electron/` —— 已解包到 DSH home 的运行时
 *   4. `@electron/get` 的下载缓存    —— 本机已有缓存时直接解包，无需联网
 *   5. `<plugin>/node_modules/electron/dist/` —— 开发期本地安装
 *
 * 第 4 步只读缓存、不发起下载：桌宠不希望在用户毫无察觉时拉 100+MB。
 * 缓存未命中时返回可执行的修复指引，由调用方决定怎么提示用户。
 *
 * @module dsh-deskpet/electron-runtime
 */

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { homedir, platform as osPlatform, arch as osArch } from 'node:os';
import { join } from 'node:path';
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
      // 注意路径里的单引号会破坏这条命令 —— 正常安装路径不会碰到。
      {
        command: 'powershell',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destination}' -Force`,
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
 * 解析出可直接 spawn 的 Electron 可执行文件。
 * @param {object} [options]
 * @returns {Promise<{ binary: string, version?: string, source: string }>}
 * @throws {Error} 找不到可用运行时，`message` 内含修复指引
 */
export async function resolveElectron({ env = process.env, platform = osPlatform(), arch = osArch() } = {}) {
  const explicit = env.DSH_DESKPET_ELECTRON?.trim();
  if (explicit !== undefined && explicit !== '') {
    const binary = toBinary(explicit, platform);
    if (await exists(binary)) return { binary, source: 'DSH_DESKPET_ELECTRON' };
    throw new Error(`DSH_DESKPET_ELECTRON 指向的路径不是可执行文件：${binary}`);
  }

  const prepared = [
    { dir: join(pluginRoot, 'runtime', RUNTIME_DIR), source: 'plugin/runtime' },
    { dir: join(resolveDshHome(env), 'dsh-deskpet', RUNTIME_DIR), source: 'dsh-home' },
  ];
  for (const { dir, source } of prepared) {
    const binary = join(dir, binaryRelativePath(platform));
    if (await exists(binary)) return { binary, source };
  }

  // 开发期：本地 node_modules 里装了 electron
  const devBinary = join(pluginRoot, 'node_modules', 'electron', 'dist', binaryRelativePath(platform));
  if (await exists(devBinary)) return { binary: devBinary, source: 'node_modules/electron' };

  const cached = await findCachedZip({ env, platform, arch });
  if (cached !== null) {
    const destination = join(resolveDshHome(env), 'dsh-deskpet', RUNTIME_DIR);
    await extractZip(cached.zip, destination, platform);
    const binary = join(destination, binaryRelativePath(platform));
    if (await exists(binary)) return { binary, version: cached.version, source: 'electron-cache' };
    throw new Error(`从缓存解包后仍未找到可执行文件：${binary}`);
  }

  throw new Error(
    [
      '找不到可用的 Electron 运行时。请任选一种方式：',
      '  1) 设置环境变量 DSH_DESKPET_ELECTRON=/path/to/Electron',
      '  2) 运行 `node tools/ensure-electron.mjs` 从官方源下载并校验',
      `  3) 把 electron-v<version>-${artifactSuffix(platform, arch)}.zip 放进 ${electronCacheRoot(env, platform)}`,
    ].join('\n'),
  );
}

/** 判断运行时是否已就绪（不抛错）。 */
export async function probeElectron(options) {
  try {
    return { ok: true, ...(await resolveElectron(options)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

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

/** 各平台可执行文件相对于解包目录的位置。 */
function binaryRelativePath(platform) {
  if (platform === 'darwin') return join('Electron.app', 'Contents', 'MacOS', 'Electron');
  if (platform === 'win32') return 'electron.exe';
  return 'electron';
}

/** 各平台的 @electron/get 产物名后缀。 */
export function artifactSuffix(platform = osPlatform(), arch = osArch()) {
  if (platform === 'darwin') return `darwin-${arch === 'x64' ? 'x64' : 'arm64'}`;
  if (platform === 'win32') return `win32-${arch === 'x64' ? 'x64' : 'arm64'}`;
  return `linux-${arch === 'x64' ? 'x64' : 'arm64'}`;
}

/** Electron 缓存根目录。 */
export function electronCacheRoot(env = process.env) {
  if (env.ELECTRON_CACHE) return env.ELECTRON_CACHE;
  if (osPlatform() === 'darwin') return join(homedir(), 'Library', 'Caches', 'electron');
  if (osPlatform() === 'win32') {
    const local = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(local, 'electron', 'Cache');
  }
  return join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'electron');
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

/** 把 `.app` 或目录归一化成可执行文件路径。 */
function toBinary(candidate, platform = osPlatform()) {
  if (candidate.endsWith('.app')) return join(candidate, 'Contents', 'MacOS', 'Electron');
  return candidate;
}

/**
 * 在 @electron/get 的缓存里找现成的 Electron 压缩包。
 * @param {object} [options]
 * @returns {Promise<{ zip: string, version: string } | null>}
 */
export async function findCachedZip({ env = process.env, platform = osPlatform(), arch = osArch() } = {}) {
  const root = electronCacheRoot(env);
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

/** 解包一个 zip 到目标目录（覆盖式）。 */
async function extractZip(zip, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  if (osPlatform() === 'darwin') {
    // ditto 保留符号链接与权限，比 unzip 更适合 .app 包。
    await run('ditto', ['-x', '-k', zip, destination]).catch(async () => {
      await run('unzip', ['-q', '-o', zip, '-d', destination]);
    });
  } else {
    await run('unzip', ['-q', '-o', zip, '-d', destination]);
  }
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
  const devBinary = join(
    pluginRoot,
    'node_modules',
    'electron',
    'dist',
    platform === 'darwin' ? join('Electron.app', 'Contents', 'MacOS', 'Electron') : binaryRelativePath(platform),
  );
  if (await exists(devBinary)) return { binary: devBinary, source: 'node_modules/electron' };

  const cached = await findCachedZip({ env, platform, arch });
  if (cached !== null) {
    const destination = join(resolveDshHome(env), 'dsh-deskpet', RUNTIME_DIR);
    await extractZip(cached.zip, destination);
    const binary = join(destination, binaryRelativePath(platform));
    if (await exists(binary)) return { binary, version: cached.version, source: 'electron-cache' };
    throw new Error(`从缓存解包后仍未找到可执行文件：${binary}`);
  }

  throw new Error(
    [
      '找不到可用的 Electron 运行时。请任选一种方式：',
      '  1) 设置环境变量 DSH_DESKPET_ELECTRON=/path/to/Electron',
      '  2) 运行 `node tools/ensure-electron.mjs` 从官方源下载并校验',
      `  3) 把 electron-v<version>-${artifactSuffix(platform, arch)}.zip 放进 ${electronCacheRoot(env)}`,
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

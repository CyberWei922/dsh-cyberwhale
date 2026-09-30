/**
 * 一键准备 Electron 运行时：探测本机 → 本地缓存 → 下载（官方源失败自动改用镜像）。
 *
 * 为什么要有这个模块：桌宠窗口跑在独立 Electron 进程里（DSH 的插件宿主只有
 * `ELECTRON_RUN_AS_NODE=1` 的 node，拿不到窗口 API）。用户装完插件后必须有一份
 * electron 二进制 —— 让他去开终端跑脚本是最后一步的体验断崖，所以「准备运行时」
 * 要做成设置页上的一次点击。
 *
 * 为什么官方源失败要自动改用镜像：中国大陆直连 GitHub Release 常被拦或极慢。
 * 用户点「准备运行时」要的是**一次成功**，而不是先失败一次再回来查文档换源。
 *
 * 与 `tools/ensure-electron.mjs` 的关系：那边只是这套逻辑的 CLI 外壳，
 * 流程本身只在这里实现一次（设置页按钮与命令行走的是同一份代码）。
 *
 * @module dsh-cyberwhale/electron-provision
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { arch as osArch, platform as osPlatform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  artifactSuffix,
  electronCacheRoot,
  extractElectronZip,
  findCachedZip,
  probeElectron,
} from './electron-runtime.js';
import { resolveDshHome } from './settings.js';

/** 默认下载的 Electron 版本。 */
export const DEFAULT_ELECTRON_VERSION = '43.4.1';

/** 国内镜像基址；官方源失败时自动改用它重试一次。 */
export const ELECTRON_MIRROR_BASE = 'https://registry.npmmirror.com/-/binary/electron';

/** 官方发行包基址：每个版本一个 tag，所以多一层 `download/`。 */
const OFFICIAL_RELEASE_BASE = 'https://github.com/electron/electron/releases/download';

/** 运行时目录名（必须与 electron-runtime.js 的查找顺序一致）。 */
const RUNTIME_DIR = 'electron';

/** 下载进度最小上报间隔：约每秒 4 次。 */
const PROGRESS_INTERVAL_MS = 250;

/**
 * 发行包基址。
 *
 * 为什么抽成纯函数：两种源的路径形状本来就不同（GitHub Release tag 用
 * `download/v<ver>/`，npmmirror 的二进制目录用 `v<ver>/`）。把差异收在一处，
 * 测试就能在任意平台上断言两边的地址算得对不对。
 *
 * @param {object} options
 * @param {string} options.version 版本号（不带 `v`）。
 * @param {string} [options.mirror] 镜像基址；空或未给时用官方源。
 * @returns {string} 可直接拼 `<基址>/<文件名>` 的基址（无结尾斜杠）。
 */
export function releaseBaseFor({ version, mirror }) {
  const base = typeof mirror === 'string' ? mirror.trim().replace(/\/+$/, '') : '';
  if (base !== '') return `${base}/v${version}`;
  return `${OFFICIAL_RELEASE_BASE}/v${version}`;
}

/**
 * 发行包文件名，例如 `electron-v43.4.1-darwin-arm64.zip`。
 *
 * 后缀复用 electron-runtime 的 `artifactSuffix`：缓存查找、报错文案与下载
 * 必须用同一个产物名，否则会出现「下载了这个名字、却去缓存里找另一个名字」。
 *
 * @param {string} version 版本号（不带 `v`）。
 * @param {string} [platform] `process.platform` 的值。
 * @param {string} [arch] `process.arch` 的值。
 */
export function artifactFileName(version, platform = osPlatform(), arch = osArch()) {
  return `electron-v${version}-${artifactSuffix(platform, arch)}.zip`;
}

/**
 * 用户主动取消（`signal` 被 abort）时抛出的错误。
 *
 * 为什么要带稳定 `code`：宿主后台任务要区分「用户取消」和「真的失败」——
 * 取消不该在设置页里显示成一条红色报错。调用方按码判断，不要解析文案。
 */
export class ProvisionAbortedError extends Error {
  /** 稳定错误码。 */
  code = 'provision-aborted';

  constructor(message = '已取消准备运行时') {
    super(message);
    this.name = 'ProvisionAbortedError';
  }
}

/**
 * 所有源都失败时抛出的错误。
 *
 * `attempts` 把「问过哪些源、各自为什么失败」结构化带出来，
 * 宿主与 CLI 都不必再去解析文案。
 */
export class ProvisionError extends Error {
  /** 稳定错误码。 */
  code = 'provision-failed';

  constructor(message, { attempts = [] } = {}) {
    super(message);
    this.name = 'ProvisionError';
    this.attempts = attempts;
  }
}

/**
 * 进度节流器：保证两次上报之间至少间隔 `intervalMs`。
 *
 * 为什么需要：下载 100+MB 时逐块上报会把设置页刷爆，而且前端本来就是轮询
 * （几秒一次），上报再密也看不见 —— 反而让宿主白忙。
 *
 * `now` 可注入：这是纯逻辑，注入时间源后测试不依赖真实时钟，不会偶发。
 *
 * @param {number} [intervalMs] 最小间隔（毫秒）。
 * @param {() => number} [now] 时间源。
 * @returns {() => boolean} 返回 true 表示「这一帧可以上报」。
 */
export function createProgressThrottle(intervalMs = PROGRESS_INTERVAL_MS, now = Date.now) {
  let lastAt = Number.NEGATIVE_INFINITY;
  return function shouldReport() {
    const at = now();
    if (at - lastAt < intervalMs) return false;
    lastAt = at;
    return true;
  };
}

/** 错误 → 文案（`throw` 的东西不一定是 Error）。 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** `signal` 已取消就抛可识别的取消错误。 */
function throwIfAborted(signal) {
  if (signal?.aborted === true) throw new ProvisionAbortedError();
}

/** 判断一次失败是不是「取消」引起的（fetch 被 abort 时抛 AbortError）。 */
function isAbort(error, signal) {
  if (signal?.aborted === true) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
}

/**
 * 已就绪的运行时算不算「版本匹配」。
 *
 * 版本号读不到时算匹配：`DSH_DESKPET_ELECTRON` 可以指向裸二进制（旁边没有
 * `version` 文件），用户显式指定的东西优先 —— 没必要因为读不到版本就重下 100MB。
 * 只有**显式钉了版本**且本机版本明确不同才继续准备。
 *
 * @param {string|undefined} prepared 本机读到的版本。
 * @param {string} wanted 目标版本。
 * @param {boolean} pinned 调用方是否显式指定了版本。
 */
function versionMatches(prepared, wanted, pinned) {
  if (!pinned) return true;
  if (prepared === undefined || prepared === null || prepared === '') return true;
  return prepared === wanted;
}

/**
 * 流式计算文件 sha256。
 * 运行时 zip 上百 MB，绝不能整份读进内存。
 */
async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * 从同源的 `SHASUMS256.txt` 里查出目标文件的 sha256。
 *
 * 必须与 zip 同源：混用两个源等于没校验（镜像可以先给你一份改过的
 * SHASUMS256.txt，再给你一份匹配的 zip）。
 *
 * @returns {Promise<string|null>} 期望的十六进制摘要；清单里没有该文件时 null。
 */
async function fetchExpectedHash(fileName, base, { fetch: fetchImpl, signal }) {
  const url = `${base}/SHASUMS256.txt`;
  const response = await fetchImpl(url, { redirect: 'follow', signal });
  if (!response.ok) throw new Error(`无法获取 SHASUMS256.txt（${response.status}）：${url}`);
  const text = await response.text();
  for (const line of text.split('\n')) {
    // 官方文件是 `<sha256> *<文件名>`（二进制模式的星号），也兼容无星号的形式。
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match !== null && match[2] === fileName) return match[1].toLowerCase();
  }
  return null;
}

/**
 * 下载到本地文件，并按节流上报进度。
 *
 * @returns {Promise<{ received: number, total: number }>} `total` 为 0 表示服务端没给 content-length。
 */
async function downloadTo(url, destination, { fetch: fetchImpl, signal, intervalMs, onProgress }) {
  const response = await fetchImpl(url, { redirect: 'follow', signal });
  if (!response.ok || response.body === null) {
    throw new Error(`下载失败 ${response.status} ${response.statusText ?? ''}：${url}`.trim());
  }
  const total = Number(response.headers.get('content-length') ?? '0') || 0;
  const throttle = createProgressThrottle(intervalMs);
  let received = 0;

  const stream = Readable.fromWeb(response.body);
  stream.on('data', (chunk) => {
    received += chunk.length;
    if (throttle()) onProgress({ received, total });
  });

  await pipeline(stream, createWriteStream(destination), { signal });
  // 最后一定补报一次：节流器可能刚好把最后一块吞掉，进度条就会停在半路。
  onProgress({ received, total });
  return { received, total };
}

/**
 * 准备 Electron 运行时。
 *
 * 顺序（第一个成功即返回）：
 *   1. 本机已有可用运行时（版本匹配时）；`force` 时跳过
 *   2. `@electron/get` 下载缓存里的现成 zip（解包，不联网）
 *   3. 下载 zip → 同源 `SHASUMS256.txt` 校验 → 安全解包；
 *      **未显式指定 mirror** 时，官方源失败（网络或校验）会自动改用
 *      `ELECTRON_MIRROR_BASE` 重试一次
 *
 * 已经解包好的运行时永远不会被覆盖：替换由 `extractElectronZip` 用
 * 「staging → 校验 → 同卷 rename」完成，失败会回滚。
 *
 * @param {object} [options]
 * @param {Record<string, string>} [options.env] 环境变量（读 `DSH_HOME` / `ELECTRON_CACHE` / `DSH_DESKPET_ELECTRON*`）。
 * @param {string} [options.version] 目标版本；默认取 `DSH_DESKPET_ELECTRON_VERSION`，再退到 `DEFAULT_ELECTRON_VERSION`。
 * @param {string} [options.mirror] 镜像基址；默认取 `DSH_DESKPET_ELECTRON_MIRROR`。显式给了就不再用官方源。
 * @param {boolean} [options.force] 忽略已有运行时与本地缓存，强制走下载。
 * @param {string} [options.platform] 可注入（默认当前平台），便于测试另一端的路径。
 * @param {string} [options.arch] 可注入，便于测试。
 * @param {AbortSignal} [options.signal] 取消信号：会中止 fetch，并清掉临时文件/目录。
 * @param {(progress: { phase: string, version: string, received?: number, total?: number, url?: string, source?: string }) => void} [options.onProgress] 进度回调（抛错会被忽略）。
 * @param {number} [options.progressIntervalMs] 下载进度最小上报间隔（默认 250ms）。
 * @param {Function} [options.fetch] 注入点（测试用；默认全局 `fetch`）。
 * @param {Function} [options.probe] 注入点（测试用；默认 `probeElectron`）。
 * @param {Function} [options.findZip] 注入点（测试用；默认 `findCachedZip`）。
 * @param {Function} [options.extract] 注入点（测试用；默认 `extractElectronZip`）。
 * @returns {Promise<{ ok: true, phase: 'cached'|'ready', binary: string, version?: string, source: string, url?: string }>}
 *   `source` 为命中的本机来源（如 `dsh-home` / `electron-cache`）或下载源（`official` / `mirror`）；
 *   `url` 只在走了下载时才有。
 * @throws {ProvisionAbortedError} 调用方取消。
 * @throws {ProvisionError} 所有源都失败（`error.attempts` 列出每个源与失败原因）。
 */
export async function provisionElectron(options = {}) {
  const {
    env = process.env,
    version,
    mirror,
    force = false,
    platform = osPlatform(),
    arch = osArch(),
    signal,
    onProgress,
    progressIntervalMs = PROGRESS_INTERVAL_MS,
    fetch: fetchImpl = globalThis.fetch,
    probe = probeElectron,
    findZip = findCachedZip,
    extract = extractElectronZip,
  } = options;

  const wantedVersion =
    String(version ?? env.DSH_DESKPET_ELECTRON_VERSION ?? DEFAULT_ELECTRON_VERSION).trim()
    || DEFAULT_ELECTRON_VERSION;
  // 「钉了版本」= 显式传参或显式设了环境变量。没钉时本机是什么版本就用什么版本。
  const versionPinned =
    version !== undefined || String(env.DSH_DESKPET_ELECTRON_VERSION ?? '').trim() !== '';
  const pinnedMirror = String(mirror ?? env.DSH_DESKPET_ELECTRON_MIRROR ?? '')
    .trim()
    .replace(/\/+$/, '');

  /**
   * 上报一次进度。
   *
   * 回调是显示层：它自己抛错绝不能把准备任务带崩（设置页卸载的瞬间很容易发生）。
   */
  const report = (phase, extra = {}) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ phase, version: wantedVersion, ...extra });
    } catch {
      // 忽略显示层异常
    }
  };

  throwIfAborted(signal);

  // ── 1. 本机已经有可用的运行时 ────────────────────────────────────────────
  if (!force) {
    report('checking');
    const ready = await probe({ env, platform, arch });
    if (ready?.ok === true && versionMatches(ready.version, wantedVersion, versionPinned)) {
      report('cached', { source: ready.source });
      report('ready', { source: ready.source });
      return {
        ok: true,
        phase: 'cached',
        binary: ready.binary,
        version: ready.version,
        source: ready.source,
      };
    }
  }

  // ── 2. @electron/get 的本地缓存（不联网）────────────────────────────────
  let cacheFailure = null;
  if (!force) {
    const cached = await findZip({ env, platform, arch });
    if (cached !== null && (!versionPinned || cached.version === wantedVersion)) {
      report('extracting', { source: 'electron-cache' });
      try {
        const binary = await extract(
          cached.zip,
          join(resolveDshHome(env), 'dsh-cyberwhale', RUNTIME_DIR),
          platform,
        );
        report('ready', { source: 'electron-cache' });
        return { ok: true, phase: 'cached', binary, version: cached.version, source: 'electron-cache' };
      } catch (error) {
        if (isAbort(error, signal)) throw new ProvisionAbortedError();
        // 缓存包可能损坏；把它当成「没命中」继续走下载，而不是直接失败。
        cacheFailure = messageOf(error);
      }
    }
  }

  // ── 3. 下载 + 校验 + 解包 ───────────────────────────────────────────────
  //
  // 未显式指定 mirror 时按 [官方源, 国内镜像] 顺序各试一次 —— 这就是
  // 「一键」的关键：用户点一下，国内网络下也能直接成功。
  const sources =
    pinnedMirror !== ''
      ? [{ source: 'mirror', base: releaseBaseFor({ version: wantedVersion, mirror: pinnedMirror }) }]
      : [
          { source: 'official', base: releaseBaseFor({ version: wantedVersion }) },
          { source: 'mirror', base: releaseBaseFor({ version: wantedVersion, mirror: ELECTRON_MIRROR_BASE }) },
        ];

  const fileName = artifactFileName(wantedVersion, platform, arch);
  const targetDir = join(resolveDshHome(env), 'dsh-cyberwhale', RUNTIME_DIR);
  const attempts = [];
  const staging = await mkdtemp(join(tmpdir(), 'dsh-pet-electron-'));
  try {
    for (const candidate of sources) {
      throwIfAborted(signal);
      const url = `${candidate.base}/${fileName}`;
      const zipPath = join(staging, `${candidate.source}-${fileName}`);
      report('downloading', { received: 0, total: 0, url, source: candidate.source });
      try {
        const finalProgress = await downloadTo(url, zipPath, {
          fetch: fetchImpl,
          signal,
          intervalMs: progressIntervalMs,
          onProgress: (progress) => report('downloading', { url, source: candidate.source, ...progress }),
        });

        report('verifying', { ...finalProgress, url, source: candidate.source });
        const expected = await fetchExpectedHash(fileName, candidate.base, {
          fetch: fetchImpl,
          signal,
        });
        if (expected === null) throw new Error(`SHASUMS256.txt 里没有 ${fileName}`);
        const actual = await sha256File(zipPath);
        if (actual !== expected) throw new Error(`校验失败：期望 ${expected}，实际 ${actual}`);

        report('extracting', { ...finalProgress, url, source: candidate.source });
        const binary = await extract(zipPath, targetDir, platform);
        report('ready', { ...finalProgress, url, source: candidate.source });
        return {
          ok: true,
          phase: 'ready',
          binary,
          version: wantedVersion,
          source: candidate.source,
          url,
        };
      } catch (error) {
        if (isAbort(error, signal)) throw new ProvisionAbortedError();
        attempts.push({ source: candidate.source, url, error: messageOf(error) });
        // 换源前把坏包删掉，避免下一个源复用到同一个路径上的残留。
        await rm(zipPath, { force: true }).catch(() => {});
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }

  // ── 全部失败：说清「问过哪些源、为什么失败」，并保留换源指引 ────────────
  const lines = [
    `准备 Electron 运行时失败（v${wantedVersion} ${artifactSuffix(platform, arch)}）。`,
    `  问过 ${attempts.length} 个源，都没成功：`,
  ];
  for (const [index, attempt] of attempts.entries()) {
    const label = attempt.source === 'mirror' ? '国内镜像' : '官方源';
    lines.push(`    ${index + 1}) ${label} ${attempt.url}`);
    lines.push(`       原因：${attempt.error}`);
  }
  if (cacheFailure !== null) lines.push(`  （本地缓存解包也失败过：${cacheFailure}）`);
  lines.push(`  也可以：手动把 ${fileName} 放进 ${electronCacheRoot(env, platform)}；`);
  lines.push('  或设置 DSH_DESKPET_ELECTRON_MIRROR 指向可达的镜像基址（形如 https://…/electron）。');
  throw new ProvisionError(lines.join('\n'), { attempts });
}

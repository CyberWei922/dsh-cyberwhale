#!/usr/bin/env node
/**
 * 「一键准备运行时」的离线测试。
 *
 * 为什么必须离线：这条链路真的会下 100+MB 的 Electron。测试一旦联网就会变成
 * 又慢又不确定的测试 —— 而那种测试最后一定会被人跳过。所以这里只验纯逻辑，
 * 以及两条不联网的短路路径：
 *
 *   1. 发行源地址、产物文件名（官方 / 镜像两套形状）
 *   2. 进度节流
 *   3. 错误分类（MissingRuntimeError / 用户取消）
 *   4. `provisionElectron` 的「本机已就绪」与「缓存命中」两条路径
 *   5. 下载链路：官方源失败自动改用镜像（fetch 与解包都是注入的假对象）
 *
 * 所有会碰网络的地方都注入假 `fetch`；解包注入假 `extract`；因此**不会**真的
 * 下载、也不会真的解包。临时目录用 `mkdtemp`，跑完就删。
 *
 * 运行：node tools/test-provision.mjs
 *
 * @module tools/test-provision
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { arch as osArch, platform as osPlatform, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_ELECTRON_VERSION,
  ELECTRON_MIRROR_BASE,
  ProvisionAbortedError,
  artifactFileName,
  createProgressThrottle,
  provisionElectron,
  releaseBaseFor,
} from '../lib/electron-provision.js';
import { MissingRuntimeError, artifactSuffix, probeElectron } from '../lib/electron-runtime.js';

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const same =
    Object.is(actual, expected)
    || (actual !== null
      && expected !== null
      && typeof actual === 'object'
      && typeof expected === 'object'
      && JSON.stringify(actual) === JSON.stringify(expected));
  if (same) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  }
}

/** 断言文案里出现了某个关键词（错误信息必须说清楚问题在哪）。 */
function checkIncludes(label, text, needle) {
  check(label, typeof text === 'string' && text.includes(needle), true);
}

/** 跑一个异步调用，把结果或错误都收成可断言的值（避免一处失败炸掉整个测试）。 */
async function caught(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** 一个已经准备好的运行时目录（临时 DSH_HOME）。 */
async function withHome(label, fn) {
  const home = await mkdtemp(join(tmpdir(), 'deskpet-provision-'));
  try {
    return await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/** 造一个多块的响应体，用来验证下载进度上报。 */
function streamBody(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

/** 记录「我们的模块有没有在临时目录里留下 staging」。 */
const stagingBefore = new Set(
  (await readdir(tmpdir())).filter((name) => name.startsWith('dsh-pet-electron-')),
);

// ── [1] 发行源基址 ────────────────────────────────────────────────────────
console.log('\n[1] 发行源基址（官方用 download/v<ver>，镜像用 v<ver>）');
{
  check('默认版本是 43.4.1', DEFAULT_ELECTRON_VERSION, '43.4.1');
  check('默认镜像基址是 npmmirror', ELECTRON_MIRROR_BASE, 'https://registry.npmmirror.com/-/binary/electron');
  check(
    '官方源：download/v<ver>',
    releaseBaseFor({ version: '43.4.1' }),
    'https://github.com/electron/electron/releases/download/v43.4.1',
  );
  check(
    '镜像：<mirror>/v<ver>',
    releaseBaseFor({ version: '43.4.1', mirror: ELECTRON_MIRROR_BASE }),
    `${ELECTRON_MIRROR_BASE}/v43.4.1`,
  );
  check(
    '镜像基址结尾的斜杠会被去掉（不然会拼出双斜杠）',
    releaseBaseFor({ version: '1.2.3', mirror: 'https://mirror.example.com/electron/' }),
    'https://mirror.example.com/electron/v1.2.3',
  );
  check('空白 mirror 回落官方源', releaseBaseFor({ version: '1.2.3', mirror: '   ' }), 'https://github.com/electron/electron/releases/download/v1.2.3');
  check('没给 mirror 也用官方源', releaseBaseFor({ version: '9.9.9' }), 'https://github.com/electron/electron/releases/download/v9.9.9');
}

// ── [2] 产物文件名 ────────────────────────────────────────────────────────
console.log('\n[2] 产物文件名与平台后缀');
{
  check('darwin arm64', artifactFileName('43.4.1', 'darwin', 'arm64'), 'electron-v43.4.1-darwin-arm64.zip');
  check('darwin x64', artifactFileName('43.4.1', 'darwin', 'x64'), 'electron-v43.4.1-darwin-x64.zip');
  check('win32 x64', artifactFileName('43.4.1', 'win32', 'x64'), 'electron-v43.4.1-win32-x64.zip');
  check('linux arm64', artifactFileName('43.4.1', 'linux', 'arm64'), 'electron-v43.4.1-linux-arm64.zip');
  // 后缀必须复用 electron-runtime 的那一份，否则会出现「下了这个名、却去缓存里找另一个名」。
  for (const platform of ['darwin', 'win32', 'linux']) {
    check(
      `${platform} 的后缀与 artifactSuffix 一致`,
      artifactFileName('1.0.0', platform, 'x64').endsWith(`-${artifactSuffix(platform, 'x64')}.zip`),
      true,
    );
  }
  // 注意：artifactSuffix 对未知平台会兜底成 linux 形态（electron-runtime.js 的既有
  // 行为），所以这里不断言它抛错 —— 真要加平台，先改那边再用 [2] 的断言锁住。
}

// ── [3] 进度节流 ──────────────────────────────────────────────────────────
console.log('\n[3] 进度节流（默认约每秒 4 次）');
{
  let now = 0;
  const shouldReport = createProgressThrottle(250, () => now);
  check('第一帧一定上报', shouldReport(), true);
  check('间隔不足时不上报', shouldReport(), false);
  now = 249;
  check('249ms 时仍不上报', shouldReport(), false);
  now = 250;
  check('满 250ms 上报', shouldReport(), true);
  now = 499;
  check('再等 249ms 不上报', shouldReport(), false);
  now = 500;
  check('再满 250ms 上报', shouldReport(), true);

  // 默认间隔就是 250ms：用假时钟验一下「1 秒最多 4 次」这条口径。
  let ticks = 0;
  const byDefault = createProgressThrottle(undefined, () => now);
  now = 0;
  for (let ms = 0; ms < 1000; ms += 10) {
    now = ms;
    if (byDefault()) ticks += 1;
  }
  check('1 秒内最多 4 次（含 t=0）', ticks, 4);
}

// ── [4] 错误分类 ──────────────────────────────────────────────────────────
console.log('\n[4] 错误分类（设置页据此决定要不要给「准备运行时」按钮）');
{
  const missing = new MissingRuntimeError('没有运行时');
  check('MissingRuntimeError 是 Error 子类', missing instanceof Error, true);
  check('code 稳定为 missing-runtime', missing.code, 'missing-runtime');
  check('name 便于日志辨认', missing.name, 'MissingRuntimeError');

  await withHome('error-classification', async (home) => {
    // 本机什么都没有（隔离的 DSH_HOME + 空缓存）时必须是 missing-runtime，
    // 而不是笼统的 runtime-error —— 否则设置页不会给出准备按钮。
    const probe = await probeElectron({
      env: { DSH_HOME: home, ELECTRON_CACHE: join(home, 'cache') },
      platform: 'linux',
      arch: 'arm64',
    });
    check('没有运行时时 ok=false', probe.ok, false);
    check('没有运行时时 code=missing-runtime', probe.code, 'missing-runtime');
    checkIncludes('错误文案仍带修复指引', probe.error, '找不到可用的 Electron 运行时');

    // 另一类失败：显式指定的路径不可执行。这不是"缺运行时"，不该引导下载。
    const bad = await probeElectron({ env: { DSH_DESKPET_ELECTRON: join(home, 'nope') } });
    check('坏路径的 code 是 runtime-error', bad.code, 'runtime-error');
  });
}

// ── [5] 本机已就绪：短路，不联网 ─────────────────────────────────────────
console.log('\n[5] provisionElectron：本机已就绪');
{
  await withHome('already-ready', async (home) => {
    const progress = [];
    let findZipCalled = false;
    let fetched = 0;
    const result = await provisionElectron({
      env: { DSH_HOME: home },
      version: '43.4.1',
      platform: 'darwin',
      arch: 'arm64',
      probe: async () => ({
        ok: true,
        binary: '/fake/Electron.app/Contents/MacOS/Electron',
        version: '43.4.1',
        source: 'dsh-home',
      }),
      findZip: async () => {
        findZipCalled = true;
        return null;
      },
      fetch: () => {
        fetched += 1;
        throw new Error('已就绪时不该联网');
      },
      onProgress: (entry) => progress.push(entry.phase),
    });
    check('phase 是 cached', result.phase, 'cached');
    check('返回可执行文件路径', result.binary, '/fake/Electron.app/Contents/MacOS/Electron');
    check('来源透传探针结果', result.source, 'dsh-home');
    check('没有查缓存', findZipCalled, false);
    check('没有联网', fetched, 0);
    check('进度阶段是 checking → cached → ready', progress, ['checking', 'cached', 'ready']);
  });

  // 显式钉了版本且本机版本不同时不能短路 —— 否则「指定 43.4.1」会被无视。
  await withHome('version-mismatch', async (home) => {
    const outcome = await caught(() =>
      provisionElectron({
        env: { DSH_HOME: home },
        version: '43.4.1',
        platform: 'linux',
        arch: 'arm64',
        probe: async () => ({ ok: true, binary: '/fake/old', version: '42.0.0', source: 'dsh-home' }),
        findZip: async () => null,
        fetch: async () => new Response('nope', { status: 404, statusText: 'Not Found' }),
        extract: async () => {
          throw new Error('不该走到解包');
        },
      }),
    );
    check('版本不匹配时不短路', outcome.ok, false);
    check('失败按 ProvisionError 归类', outcome.error?.name, 'ProvisionError');
    check('attempts 记录了问过的两个源', outcome.error?.attempts?.map((a) => a.source), ['official', 'mirror']);
  });
}

// ── [6] 缓存命中：解包，不联网 ───────────────────────────────────────────
console.log('\n[6] provisionElectron：命中 @electron/get 缓存');
{
  await withHome('cache-hit', async (home) => {
    const zip = join(home, artifactFileName('43.4.1', 'darwin', 'arm64'));
    await writeFile(zip, 'fake zip');
    const progress = [];
    const extracted = [];
    let findOptions = null;
    let fetched = 0;
    const result = await provisionElectron({
      env: { DSH_HOME: home },
      version: '43.4.1',
      platform: 'darwin',
      arch: 'arm64',
      probe: async () => ({ ok: false, code: 'missing-runtime', error: '没有运行时' }),
      findZip: async (options) => {
        findOptions = options;
        return { zip, version: '43.4.1' };
      },
      fetch: () => {
        fetched += 1;
        throw new Error('命中缓存时不该联网');
      },
      extract: async (source, destination, platform) => {
        extracted.push({ source, destination, platform });
        return join(destination, 'Electron.app', 'Contents', 'MacOS', 'Electron');
      },
      onProgress: (entry) => progress.push(entry.phase),
    });
    check('phase 是 cached', result.phase, 'cached');
    check('来源是 electron-cache', result.source, 'electron-cache');
    check('解包的就是命中的那个 zip', extracted[0]?.source, zip);
    check(
      '解包目标是 DSH home 下的运行时目录',
      extracted[0]?.destination,
      join(home, 'dsh-cyberwhale', 'electron'),
    );
    check(
      '把请求的平台/架构透给了缓存查找（漏传会去当前机器的缓存里找）',
      findOptions,
      { env: { DSH_HOME: home }, platform: 'darwin', arch: 'arm64' },
    );
    check('没有联网', fetched, 0);
    check('进度阶段是 checking → extracting → ready', progress, ['checking', 'extracting', 'ready']);
  });
}

// ── [7] 下载链路：换源与进度 ─────────────────────────────────────────────
console.log('\n[7] 下载链路：官方源失败自动改用镜像（fetch 与解包都是假的）');
{
  const platform = osPlatform();
  const arch = osArch();
  const version = '43.4.1';
  const fileName = artifactFileName(version, platform, arch);
  const payload = Buffer.from('deskpet-fake-electron-zip');
  const digest = createHash('sha256').update(payload).digest('hex');
  const officialBase = releaseBaseFor({ version });
  const mirrorBase = releaseBaseFor({ version, mirror: ELECTRON_MIRROR_BASE });

  await withHome('mirror-fallback', async (home) => {
    // 官方源 404、镜像源正常 —— 这是国内用户点「准备运行时」最常见的一次。
    const downloads = [];
    const progress = [];
    const extracted = [];
    const result = await provisionElectron({
      env: { DSH_HOME: home },
      version,
      platform,
      arch,
      probe: async () => ({ ok: false, code: 'missing-runtime', error: '没有运行时' }),
      findZip: async () => null,
      extract: async (source, destination) => {
        extracted.push(source);
        return join(destination, 'Electron');
      },
      fetch: async (url) => {
        downloads.push(String(url));
        if (String(url) === `${officialBase}/${fileName}` || String(url) === `${officialBase}/SHASUMS256.txt`) {
          return new Response('not found', { status: 404, statusText: 'Not Found' });
        }
        if (String(url) === `${mirrorBase}/${fileName}`) {
          return new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } });
        }
        if (String(url) === `${mirrorBase}/SHASUMS256.txt`) {
          return new Response(`${digest} *${fileName}\n`, { status: 200 });
        }
        return new Response('unexpected', { status: 500, statusText: 'Server Error' });
      },
      onProgress: (entry) => progress.push(entry),
    });

    check('官方源失败后仍然成功（一键的关键）', result.ok, true);
    check('phase 是 ready', result.phase, 'ready');
    check('返回值说明实际成功的是镜像', result.source, 'mirror');
    check('url 指向镜像地址', result.url, `${mirrorBase}/${fileName}`);
    check('确实先问了官方源、再问了镜像', downloads.includes(`${officialBase}/${fileName}`) && downloads.includes(`${mirrorBase}/${fileName}`), true);
    check('解包用的是下载下来的临时 zip', typeof extracted[0] === 'string' && extracted[0].endsWith(fileName), true);
    check(
      '进度阶段齐全',
      [...new Set(progress.map((entry) => entry.phase))],
      ['checking', 'downloading', 'verifying', 'extracting', 'ready'],
    );
    check('下载进度带 content-length 作为 total', progress.some((entry) => entry.phase === 'downloading' && entry.total === payload.length), true);
    check('进度里带来源，UI 才能说清在用哪个源', progress.some((entry) => entry.source === 'mirror'), true);
    check('进度里带版本', progress.every((entry) => entry.version === version), true);
  });

  // 显式指定 mirror 时只走它 —— 用户明确要求的源不该被"偷偷"换回官方。
  await withHome('explicit-mirror', async (home) => {
    const explicit = 'https://mirror.example.com/electron';
    const asked = [];
    const result = await provisionElectron({
      env: { DSH_HOME: home },
      version,
      platform,
      arch,
      mirror: explicit,
      probe: async () => ({ ok: false, code: 'missing-runtime', error: '没有运行时' }),
      findZip: async () => null,
      extract: async (source, destination) => join(destination, 'Electron'),
      fetch: async (url) => {
        asked.push(String(url));
        if (String(url) === `${explicit}/v${version}/${fileName}`) {
          return new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } });
        }
        if (String(url) === `${explicit}/v${version}/SHASUMS256.txt`) {
          return new Response(`${digest} *${fileName}\n`, { status: 200 });
        }
        return new Response('nope', { status: 404, statusText: 'Not Found' });
      },
    });
    check('显式 mirror 用 v<ver>/ 形状', result.url, `${explicit}/v${version}/${fileName}`);
    check('显式 mirror 时不会去问 GitHub', asked.some((url) => url.includes('github.com')), false);
  });

  // 两个源都失败：错误信息要说清「问过哪些源、为什么失败」，并保留换源指引。
  await withHome('all-fail', async (home) => {
    const outcome = await caught(() =>
      provisionElectron({
        env: { DSH_HOME: home },
        version,
        platform,
        arch,
        probe: async () => ({ ok: false, code: 'missing-runtime', error: '没有运行时' }),
        findZip: async () => null,
        extract: async () => '/fake/Electron',
        fetch: async (url) => new Response('down', { status: 500, statusText: 'Server Error' }),
      }),
    );
    check('全部失败时抛错', outcome.ok, false);
    check('错误里有结构化的 attempts', outcome.error?.attempts?.length, 2);
    checkIncludes('文案列出官方源', outcome.error?.message, '官方源');
    checkIncludes('文案列出国内镜像', outcome.error?.message, '国内镜像');
    checkIncludes('文案保留改用镜像的指引', outcome.error?.message, 'DSH_DESKPET_ELECTRON_MIRROR');
  });

  // 进度节流：注入不同间隔，观察上报次数。
  //
  // 注意「每块一次」依赖底层流的块边界；这里只断言节流确实在起作用
  // （不节流 ≥ 节流，且节流后只剩首尾两次），精确口径由 [3] 的纯逻辑断言锁住。
  await withHome('throttle', async (home) => {
    const chunks = Array.from({ length: 8 }, (_, index) => Buffer.alloc(64 * 1024, index + 1));
    const body = Buffer.concat(chunks);
    const bodyDigest = createHash('sha256').update(body).digest('hex');

    const collect = async (progressIntervalMs) => {
      const seen = [];
      const result = await provisionElectron({
        env: { DSH_HOME: home },
        version,
        platform,
        arch,
        progressIntervalMs,
        probe: async () => ({ ok: false, code: 'missing-runtime', error: '没有运行时' }),
        findZip: async () => null,
        extract: async (source, destination) => join(destination, 'Electron'),
        fetch: async (url) => {
          if (String(url) === `${officialBase}/${fileName}`) {
            return new Response(streamBody(chunks), {
              status: 200,
              headers: { 'content-length': String(body.length) },
            });
          }
          if (String(url) === `${officialBase}/SHASUMS256.txt`) {
            return new Response(`${bodyDigest} *${fileName}\n`, { status: 200 });
          }
          return new Response('nope', { status: 404, statusText: 'Not Found' });
        },
        onProgress: (entry) => {
          if (entry.phase === 'downloading' && entry.total > 0) seen.push(entry.received);
        },
      });
      return { seen, result };
    };

    const unthrottled = await collect(0);
    check('不节流时可以走到 ready', unthrottled.result.phase, 'ready');
    check('不节流时最后一块就是完整总量', unthrottled.seen.at(-1), body.length);
    check('不节流时上报次数大于 2', unthrottled.seen.length > 2, true);

    const throttled = await collect(60_000);
    check('节流后只剩首尾两次上报', throttled.seen.length, 2);
    check('节流后的首报是完整总量（补报不会被吞）', throttled.seen.at(-1), body.length);
  });
}

// ── [8] 取消 ─────────────────────────────────────────────────────────────
console.log('\n[8] 取消：可识别的中止错误 + 不留临时文件');
{
  await withHome('abort', async (home) => {
    // 已经取消的 signal：一开始就停，连探测都不该跑。
    const preAborted = new AbortController();
    preAborted.abort();
    let probed = false;
    const early = await caught(() =>
      provisionElectron({
        env: { DSH_HOME: home },
        signal: preAborted.signal,
        probe: async () => {
          probed = true;
          return { ok: true, binary: '/fake' };
        },
      }),
    );
    check('已取消的 signal 立刻中止', early.ok, false);
    check('抛的是可识别的取消错误', early.error instanceof ProvisionAbortedError, true);
    check('取消错误有稳定 code', early.error?.code, 'provision-aborted');
    check('没有开始探测', probed, false);

    // 下载中途取消：fetch 收到 abort，任务要收敛成取消而不是"失败"。
    const mid = new AbortController();
    const controllerHasSignal = [];
    const cancelled = await caught(() =>
      provisionElectron({
        env: { DSH_HOME: home },
        version: '43.4.1',
        platform: osPlatform(),
        arch: osArch(),
        signal: mid.signal,
        probe: async () => ({ ok: false, code: 'missing-runtime', error: '没有运行时' }),
        findZip: async () => null,
        extract: async () => {
          throw new Error('取消后不该解包');
        },
        fetch: (url, init) => {
          controllerHasSignal.push(init?.signal === mid.signal);
          return new Promise((resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
            setTimeout(() => mid.abort(), 5);
          });
        },
      }),
    );
    check('下载中途取消会中止', cancelled.ok, false);
    check('抛的仍是取消错误', cancelled.error instanceof ProvisionAbortedError, true);
    check('signal 确实传给了 fetch', controllerHasSignal, [true]);
  });
}

// ── [9] 临时目录 ─────────────────────────────────────────────────────────
console.log('\n[9] 临时 staging 目录不会残留');
{
  const stagingAfter = (await readdir(tmpdir())).filter(
    (name) => name.startsWith('dsh-pet-electron-') && !stagingBefore.has(name),
  );
  check('成功、换源、失败、取消各条路径都清掉了临时目录', stagingAfter, []);
}

console.log(`\n结果：${passed} 通过 / ${failures.length} 失败`);
if (failures.length > 0) process.exitCode = 1;

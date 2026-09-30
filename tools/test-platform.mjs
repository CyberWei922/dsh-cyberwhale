#!/usr/bin/env node
/**
 * 跨平台分支的测试。
 *
 * 为什么需要它：这个插件要在 macOS 和 Windows 上跑同一份代码，靠 `platform`
 * 分支区分。**"改好一端弄坏另一端"正是发生在平台分支上** —— 而且这类 bug
 * 在另一台机器上才暴露，本地全绿也没用。
 *
 * 关键设计：`electron-runtime.js` 里所有分支函数的 `platform` 都可以注入，
 * 所以**在 macOS 上就能验证 Windows 那条路算得对不对**。
 * 如果你要加新平台，先让这里的断言通过。
 *
 * 运行：node tools/test-platform.mjs
 *
 * @module tools/test-platform
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, platform as osPlatform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  artifactSuffix,
  binaryRelativePath,
  electronCacheRoot,
  extractZip,
  extractionPlan,
  probeElectron,
  resolveElectron,
  toBinary,
} from '../lib/electron-runtime.js';

const run = promisify(execFile);

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  if (Object.is(actual, expected)) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  }
}

/** 断言一个函数对未知平台会**响亮地失败**，而不是静默返回错的东西。 */
function checkThrows(label, fn) {
  try {
    const value = fn();
    failures.push(label);
    console.log(`  ✗ ${label}\n      期望抛错，实际返回 ${JSON.stringify(value)}`);
  } catch {
    passed += 1;
    console.log(`  ✓ ${label}`);
  }
}

const PLATFORMS = ['darwin', 'win32', 'linux'];

/**
 * 调一个「可能因为缺平台分支而抛错」的函数，把结果或错误转成可断言的值。
 *
 * 为什么要这层：如果有人把某个平台的分支删了，直接调用会抛错并**中断整个测试**，
 * 前面已经跑过的断言就看不到了。先在最前面用这个扫一遍，能给出干净的报告。
 */
function outcome(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// ── 先扫一遍平台覆盖：漏一个平台会让后面的断言直接崩 ──────────────────────
console.log('\n[0] 平台覆盖（最先跑，漏分支要立刻看得见）');
{
  for (const platform of PLATFORMS) {
    const binary = outcome(() => binaryRelativePath(platform));
    check(`${platform} 的二进制路径已定义`, binary.ok, true);
    const root = outcome(() => electronCacheRoot({}, platform));
    check(`${platform} 的缓存目录已定义`, root.ok, true);
    const plan = outcome(() => extractionPlan(platform, 'z', 'd'));
    check(`${platform} 的解包计划已定义`, plan.ok, true);
    const suffix = outcome(() => artifactSuffix(platform, 'x64'));
    check(`${platform} 的产物名已定义`, suffix.ok, true);
  }
}

// ── 二进制相对路径 ────────────────────────────────────────────────────────
console.log('\n[1] 各平台可执行文件相对于解包目录的位置');
{
  check('darwin 走 .app 包', binaryRelativePath('darwin'), join('Electron.app', 'Contents', 'MacOS', 'Electron'));
  check('win32 是 electron.exe', binaryRelativePath('win32'), 'electron.exe');
  check('linux 是 electron', binaryRelativePath('linux'), 'electron');
  checkThrows('未知平台要抛错（不能静默兜底）', () => binaryRelativePath('freebsd'));
}

// ── @electron/get 产物名 ──────────────────────────────────────────────────
console.log('\n[2] @electron/get 的产物名后缀');
{
  check('darwin arm64', artifactSuffix('darwin', 'arm64'), 'darwin-arm64');
  check('darwin x64', artifactSuffix('darwin', 'x64'), 'darwin-x64');
  check('win32 x64', artifactSuffix('win32', 'x64'), 'win32-x64');
  check('win32 arm64', artifactSuffix('win32', 'arm64'), 'win32-arm64');
  check('linux x64', artifactSuffix('linux', 'x64'), 'linux-x64');
  check('linux arm64', artifactSuffix('linux', 'arm64'), 'linux-arm64');
}

// ── 缓存目录 ──────────────────────────────────────────────────────────────
console.log('\n[3] Electron 缓存根目录');
{
  check(
    'darwin → ~/Library/Caches/electron',
    electronCacheRoot({}, 'darwin'),
    join(homedir(), 'Library', 'Caches', 'electron'),
  );
  check(
    'win32 → %LOCALAPPDATA%\\electron\\Cache',
    electronCacheRoot({ LOCALAPPDATA: '/fake/Local' }, 'win32'),
    join('/fake/Local', 'electron', 'Cache'),
  );
  check(
    'win32 没有 LOCALAPPDATA 时退到 ~/AppData/Local',
    electronCacheRoot({}, 'win32'),
    join(homedir(), 'AppData', 'Local', 'electron', 'Cache'),
  );
  check(
    'linux → $XDG_CACHE_HOME/electron',
    electronCacheRoot({ XDG_CACHE_HOME: '/fake/cache' }, 'linux'),
    join('/fake/cache', 'electron'),
  );
  check(
    'linux 没有 XDG_CACHE_HOME 时退到 ~/.cache',
    electronCacheRoot({}, 'linux'),
    join(homedir(), '.cache', 'electron'),
  );
  check(
    'ELECTRON_CACHE 覆盖一切平台',
    electronCacheRoot({ ELECTRON_CACHE: '/explicit' }, 'win32'),
    '/explicit',
  );
  checkThrows('未知平台要抛错', () => electronCacheRoot({}, 'freebsd'));
}

// ── 可执行文件归一化 ──────────────────────────────────────────────────────
console.log('\n[4] DSH_DESKPET_ELECTRON 的路径归一化');
{
  check(
    'darwin 的 .app 会展开',
    toBinary('/Applications/X.app', 'darwin'),
    join('/Applications/X.app', 'Contents', 'MacOS', 'Electron'),
  );
  check('darwin 的普通路径原样用', toBinary('/opt/x/Electron', 'darwin'), '/opt/x/Electron');
  check('win32 的 .exe 原样用', toBinary('C:\\\\x\\\\electron.exe', 'win32'), 'C:\\\\x\\\\electron.exe');
  // 非 darwin 平台上 .app 后缀没有意义，不该被展开成 macOS 的路径
  check('win32 上的 .app 不展开', toBinary('/x/Y.app', 'win32'), '/x/Y.app');
}

// ── 解包命令 ──────────────────────────────────────────────────────────────
console.log('\n[5] 解包命令（每个平台都要有非空计划）');
{
  for (const platform of PLATFORMS) {
    const plan = extractionPlan(platform, 'a.zip', '/dest');
    check(`${platform} 有解包计划`, plan.length > 0, true);
    check(`${platform} 计划里每步都有 command 和 args`, plan.every((s) => typeof s.command === 'string' && Array.isArray(s.args)), true);
    check(`${platform} 计划里包含源 zip 路径`, plan.some((s) => s.args.includes('a.zip')), true);
    check(`${platform} 计划里包含目标目录`, plan.some((s) => s.args.some((a) => a.includes('/dest'))), true);
  }
  check('darwin 首选 ditto（要保留符号链接）', extractionPlan('darwin', 'z', 'd')[0].command, 'ditto');
  check('darwin 有 unzip 兜底', extractionPlan('darwin', 'z', 'd')[1].command, 'unzip');
  check('win32 首选 tar（Windows 10+ 自带 bsdtar）', extractionPlan('win32', 'z', 'd')[0].command, 'tar');
  check('win32 有 PowerShell 兜底', extractionPlan('win32', 'z', 'd')[1].command, 'powershell');
  check(
    'win32 的 tar 用了 -xf（解 zip）',
    extractionPlan('win32', 'z', 'd')[0].args[0],
    '-xf',
  );
  check('linux 用 unzip', extractionPlan('linux', 'z', 'd')[0].command, 'unzip');
  checkThrows('未知平台要抛错', () => extractionPlan('freebsd', 'z', 'd'));
}

// ── 每个平台都必须被显式处理 ──────────────────────────────────────────────
console.log('\n[6] 平台覆盖完整性（漏一个平台要能被发现）');
{
  // 这一组是"防止改好一端弄坏另一端"的核心：
  // 三条平台路径都必须产出**互不相同**的结果，否则说明有分支被写重了。
  const binaries = PLATFORMS.map((p) => binaryRelativePath(p));
  check('三平台的二进制路径互不相同', new Set(binaries).size, 3);

  const roots = PLATFORMS.map((p) => electronCacheRoot({}, p));
  check('三平台的缓存目录互不相同', new Set(roots).size, 3);

  const firstCommands = PLATFORMS.map((p) => extractionPlan(p, 'z', 'd')[0].command);
  check('三平台的首选解包命令互不相同', new Set(firstCommands).size, 3);

  const suffixes = PLATFORMS.map((p) => artifactSuffix(p, 'x64'));
  check('三平台的产物名互不相同', new Set(suffixes).size, 3);
  check('产物名前缀就是平台名', suffixes.every((s, i) => s.startsWith(PLATFORMS[i])), true);
}

// ── 修复指引要对应当前请求的平台 ──────────────────────────────────────────
console.log('\n[7] findCachedZip / resolveElectron 要用「请求的」平台，不是当前机器的');
{
  // 这里踩过坑：findCachedZip 原本调 electronCacheRoot(env) 时没把 platform 传下去，
  // 于是在 macOS 上请求 win32 时会去 macOS 的缓存目录里找 win32 的产物名 —— 永远找不到。
  const { findCachedZip } = await import('../lib/electron-runtime.js');
  // 必须用一个**隔离的空缓存目录**。直接用真实的 ~/Library/Caches/electron 会
  // 在这台已经装过 Electron 的机器上找到真 zip —— 测试就不是确定的了。
  const isolated = await mkdtemp(join(tmpdir(), 'deskpet-cache-'));
  const emptyEnv = { ELECTRON_CACHE: isolated };
  try {
    check('当前平台查空缓存返回 null', await findCachedZip({ env: emptyEnv, platform: osPlatform() }), null);
    check('win32 查空缓存也返回 null（不该抛错）', await findCachedZip({ env: emptyEnv, platform: 'win32' }), null);
    check('linux 查空缓存也返回 null', await findCachedZip({ env: emptyEnv, platform: 'linux' }), null);
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }

  // 报错信息里给出的产物名和缓存路径必须是**请求的那个平台**的。
  // 注意这里不能用 emptyEnv —— 它设了 ELECTRON_CACHE，会把平台专属的
  // 缓存路径覆盖掉，就验不出"Windows 形状"了。
  const winProbe = await probeElectron({ env: { HOME: homedir() }, platform: 'win32', arch: 'x64' });
  const linuxProbe = await probeElectron({ env: { HOME: homedir() }, platform: 'linux', arch: 'arm64' });

  if (osPlatform() === 'win32') {
    // 在 Windows 上跑这套测试时，本机**就是** win32 且有运行时 —— win32 探针会成功。
    // 「报错按请求平台组织」这件事改用 linux 探针验（Windows 上必然没有 linux 运行时）。
    check('Windows 主机上 win32 探针成功', winProbe.ok, true);
    check('linux 探针在本机失败', linuxProbe.ok, false);
    check('  linux 报错里提到 linux-arm64', linuxProbe.error.includes('linux-arm64'), true);
    check('  linux 报错里的缓存路径是 Linux 形状', linuxProbe.error.includes('.cache'), true);
  } else {
    check('win32 探针失败（本机没有 Windows 运行时是正常的）', winProbe.ok, false);
    check('  报错里提到 win32-x64 的产物名', winProbe.error.includes('win32-x64'), true);
    check('  报错里的缓存路径是 Windows 形状', winProbe.error.includes(join('AppData', 'Local', 'electron', 'Cache')), true);
    check('linux 报错里提到 linux-arm64', linuxProbe.error.includes('linux-arm64'), true);
  }
}

// ── 真解包冒烟测试（当前平台）────────────────────────────────────────────
console.log(`\n[8] 真解包冒烟测试（当前平台 ${osPlatform()}）`);
{
  const work = await mkdtemp(join(tmpdir(), 'deskpet-zip-'));
  const source = join(work, 'src');
  const zip = join(work, 'payload.zip');
  const destination = join(work, 'out');
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'probe.txt'), 'deskpet-platform-probe');

    const zipped = await makeZip(source, zip);
    if (!zipped) {
      console.log('  · 本机没有可用的打 zip 工具，跳过（不影响其它断言）');
    } else {
      await extractZip(zip, destination);
      const text = await readFile(join(destination, 'src', 'probe.txt'), 'utf8').catch(() => null)
        ?? await readFile(join(destination, 'probe.txt'), 'utf8').catch(() => null);
      check('解包出来的内容一致', text, 'deskpet-platform-probe');
      check('解包命令列非空', extractionPlan(osPlatform(), zip, destination).length > 0, true);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** 用当前平台可用的工具打一个 zip；都没有就返回 false。 */
async function makeZip(source, zip) {
  const attempts =
    osPlatform() === 'darwin'
      ? [['ditto', ['-c', '-k', '--keepParent', source, zip]]]
      : osPlatform() === 'win32'
        ? [['tar', ['-a', '-cf', zip, '-C', source, '.']]]
        : [
            ['zip', ['-q', '-r', zip, '.']],
            ['tar', ['-a', '-cf', zip, '-C', source, '.']],
          ];
  for (const [command, args] of attempts) {
    try {
      await run(command, args, { cwd: source });
      return true;
    } catch {
      /* 换下一个 */
    }
  }
  return false;
}

console.log(`\n结果：${passed} 通过 / ${failures.length} 失败`);
if (failures.length > 0) process.exitCode = 1;

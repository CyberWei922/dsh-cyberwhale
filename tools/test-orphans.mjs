#!/usr/bin/env node
/**
 * 孤儿清扫与 Electron 运行时定位的平台行为测试。
 *
 * 打的是纯函数与文件系统契约（不真的杀进程、不真的解 100MB 包）：
 *   - 清理匹配：只认「以 Electron 可执行文件开头 + 命令行含助手目录」的进程；
 *   - Windows 带引号命令行、POSIX 不带头引号两种形态都要能认出来；
 *   - 运行时的挑选顺序、版本读取、错误信息、不覆盖已有运行时。
 *
 * 用法：node tools/test-orphans.mjs
 */

import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { findMatchingProcesses, isElectronCommand, selectMatches } from '../lib/orphans.js';
import {
  artifactSuffix,
  binaryRelativePath,
  electronCacheRoot,
  findCachedZip,
  probeElectron,
  readRuntimeVersion,
  resolveElectron,
} from '../lib/electron-runtime.js';

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

const workspace = join(tmpdir(), `dsh-deskpet-orphans-${process.pid}`);
const isWin = process.platform === 'win32';
const HELPER = isWin
  ? 'D:\\dsh\\profiles\\desktop\\node_modules\\dsh-deskpet\\helper'
  : '/Users/me/.dsh/profiles/desktop/node_modules/dsh-deskpet/helper';

console.log('\n[1] Electron 命令行识别');
{
  const cases = [
    [`"C:\\Users\\me\\AppData\\Local\\dsh-deskpet\\electron\\electron.exe" "${HELPER}" --assets=x`, true],
    [`"D:\\probe\\electron-40.10.2\\electron.exe" "D:\\dsh\\helper" --evidence=y`, true],
    [`"C:\\tools\\my-electron-helper\\runner.exe" "${HELPER}"`, false],
    [`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/electron/Electron "${HELPER}" --assets=x`, true],
    [`/usr/bin/python3 /tmp/script.py "${HELPER}"`, false],
    [`bash -c "echo ${HELPER}"`, false],
    [`"C:\\Windows\\explorer.exe" "${HELPER}"`, false],
    ['C:\\tools\\electron.exe', true],
    ['/bin/sh /tmp/Electron /tmp/dsh-deskpet/helper', false],
    ['/usr/bin/python /tmp/Electron /tmp/dsh-deskpet/helper', false],
  ];
  for (const [command, expected] of cases) {
    check(`isElectronCommand(${JSON.stringify(command.slice(0, 58))}...)`, isElectronCommand(command), expected);
  }
}

console.log('\n[2] 进程筛选：needle + electronOnly + 排除自身');
{
  const self = 4242;
  const entries = [
    { pid: 100, command: `"C:\\App\\electron.exe" "${HELPER}" --assets=x` },
    { pid: 101, command: `bash -c "grep ${HELPER} log"` },
    { pid: 102, command: '"C:\\App\\electron.exe" "D:\\other\\helper"' },
    { pid: self, command: `"C:\\App\\electron.exe" "${HELPER}"` },
    { pid: 103, command: `"C:\\App\\electron.exe" "${HELPER}" --scale=2` },
    { pid: 104, command: null },
    { pid: 0, command: `"C:\\App\\electron.exe" "${HELPER}"` },
  ];
  check(
    'electronOnly=true 只杀真正的助手',
    JSON.stringify(selectMatches(entries, HELPER, { electronOnly: true, selfPid: self })),
    JSON.stringify([100, 103]),
  );
  check(
    'electronOnly=false 也认普通命中',
    JSON.stringify(selectMatches(entries, HELPER, { electronOnly: false, selfPid: self })),
    JSON.stringify([100, 101, 103]),
  );
  check('needle 太短直接空（入口有长度闸）', JSON.stringify(await findMatchingProcesses('x')), JSON.stringify([]));
}

console.log('\n[3] 运行时候选与版本');
{
  check('artifactSuffix(win32,x64)', artifactSuffix('win32', 'x64'), 'win32-x64');
  check('artifactSuffix(win32,arm64)', artifactSuffix('win32', 'arm64'), 'win32-arm64');
  check('artifactSuffix(darwin,arm64)', artifactSuffix('darwin', 'arm64'), 'darwin-arm64');
  check('binaryRelativePath(win32)', binaryRelativePath('win32'), 'electron.exe');
  check(
    'binaryRelativePath(darwin)',
    binaryRelativePath('darwin').split(/[\\/]/).join('/'),
    'Electron.app/Contents/MacOS/Electron',
  );
  const cacheRoot = electronCacheRoot(isWin ? { LOCALAPPDATA: 'C:\\Local' } : { XDG_CACHE_HOME: '/xdg' });
  check('electronCacheRoot 各平台默认值', isWin ? cacheRoot === 'C:\\Local\\electron\\Cache' : cacheRoot === (process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'electron') : '/xdg/electron'), true);
}

console.log('\n[4] findCachedZip 扫描缓存目录');
{
  const cache = join(workspace, 'cache');
  await mkdir(join(cache, 'aa11'), { recursive: true });
  await mkdir(join(cache, 'bb22'), { recursive: true });
  const suffix = artifactSuffix();
  await writeFile(join(cache, 'aa11', `electron-v40.10.2-${suffix}.zip`), 'x');
  await writeFile(join(cache, 'aa11', `electron-v40.10.2-${suffix}-symbols.zip`), 'x');
  await writeFile(join(cache, 'bb22', `electron-v43.4.1-${suffix}.zip`), 'x');
  const hit = await findCachedZip({ env: { ELECTRON_CACHE: cache } });
  check('取版本号最大的一个', hit !== null && hit.version === '43.4.1', true);
  const pinned = await findCachedZip({ env: { ELECTRON_CACHE: cache, DSH_DESKPET_ELECTRON_VERSION: '40.10.2' } });
  check('DSH_DESKPET_ELECTRON_VERSION 可固定版本', pinned !== null && pinned.version === '40.10.2', true);
  const empty = await findCachedZip({ env: { ELECTRON_CACHE: join(workspace, 'none') } });
  check('无缓存返回 null', empty, null);
}

console.log('\n[5] resolveElectron / probeElectron 契约');
{
  const home = join(workspace, 'home');
  const runtimeDir = join(home, 'dsh-deskpet', 'electron');
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(dirname(join(runtimeDir, binaryRelativePath(process.platform))), { recursive: true });
  await writeFile(join(runtimeDir, binaryRelativePath(process.platform)), 'placeholder');
  if (!isWin) await chmod(join(runtimeDir, binaryRelativePath(process.platform)), 0o755);
  await writeFile(join(runtimeDir, 'version'), '40.10.2\n');
  await writeFile(join(runtimeDir, 'DO-NOT-DELETE'), 'marker');

  const bare = { DSH_HOME: home, DSH_DESKPET_ELECTRON: '', LOCALAPPDATA: join(workspace, 'nolocal'), ELECTRON_CACHE: join(workspace, 'nocache') };
  const resolved = await resolveElectron({ env: bare });
  check('从 dsh-home 目录解析', resolved.source, 'dsh-home');
  check('读取 version 文件', resolved.version, '40.10.2');
  check('readRuntimeVersion 直读', await readRuntimeVersion(runtimeDir), '40.10.2');

  const again = await resolveElectron({ env: bare });
  check('重复解析仍指向同一运行时', again.binary, resolved.binary);
  check('已有运行时没有被覆盖（marker 还在）', await stat(join(runtimeDir, 'DO-NOT-DELETE')).then(() => true, () => false), true);

  let threw = false;
  try {
    await resolveElectron({ env: { ...bare, DSH_HOME: join(workspace, 'empty') } });
  } catch {
    threw = true;
  }
  check('resolveElectron 找不到时抛异常', threw, true);

  const probe = await probeElectron({ env: { ...bare, DSH_HOME: join(workspace, 'empty') } });
  check('probeElectron 返回 { ok: false, error }', probe.ok === false && typeof probe.error === 'string', true);
  const probeOk = await probeElectron({ env: bare });
  check('probeElectron 成功时带 binary', probeOk.ok === true && typeof probeOk.binary === 'string', true);

  let badExplicit = '';
  try {
    await resolveElectron({ env: { DSH_DESKPET_ELECTRON: join(workspace, 'missing-binary') } });
  } catch (error) {
    badExplicit = error.message;
  }
  check('DSH_DESKPET_ELECTRON 指向不存在文件时报错清晰', badExplicit.includes('不是可执行文件'), true);
}

console.log('\n[6] 解包失败不破坏已有运行时（损坏包）');
{
  const { extractElectronZip } = await import('../lib/electron-runtime.js');
  const home = join(workspace, 'home2');
  const runtimeDir = join(home, 'dsh-deskpet', 'electron');
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(dirname(join(runtimeDir, binaryRelativePath(process.platform))), { recursive: true });
  await writeFile(join(runtimeDir, binaryRelativePath(process.platform)), 'placeholder');
  if (!isWin) await chmod(join(runtimeDir, binaryRelativePath(process.platform)), 0o755);
  await writeFile(join(runtimeDir, 'KEEP-ME'), 'marker');
  const badZip = join(workspace, 'broken.zip');
  await writeFile(badZip, 'this is not a zip file');
  let failed = false;
  try {
    await extractElectronZip(badZip, runtimeDir, process.platform);
  } catch {
    failed = true;
  }
  check('损坏包解包失败', failed, true);
  check('失败后目标目录原样保留', await stat(join(runtimeDir, 'KEEP-ME')).then(() => true, () => false), true);
  const leftovers = (await readdir(join(home, 'dsh-deskpet'))).filter((n) => n.includes('.staging-'));
  check('没有留下 staging 目录', leftovers.length, 0);
}

// 真正打包并安装，验证替换旧目录成功且无残留。
console.log('\n[7] 有效运行时替换旧目录');
{
  const { extractElectronZip } = await import('../lib/electron-runtime.js');
  const source = join(workspace, 'valid-source');
  const binary = join(source, binaryRelativePath(process.platform));
  await mkdir(dirname(binary), { recursive: true });
  await writeFile(binary, 'new-runtime');
  if (!isWin) await chmod(binary, 0o755);
  const zip = join(workspace, 'valid.zip');
  const run = promisify(execFile);
  if (isWin) {
    const q = (value) => "'" + value.replaceAll("'", "''") + "'";
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; Compress-Archive -Path ${q(join(source, '*'))} -DestinationPath ${q(zip)}`]);
  } else {
    await run('zip', ['-qr', zip, '.'], { cwd: source });
  }
  const destination = join(workspace, 'replacement');
  await mkdir(destination);
  await writeFile(join(destination, 'OLD'), 'old-runtime');
  await extractElectronZip(zip, destination);
  const { readFile } = await import('node:fs/promises');
  check('安装了完整新运行时', await readFile(join(destination, binaryRelativePath(process.platform)), 'utf8'), 'new-runtime');
  check('成功后删除旧目录', await stat(join(destination, 'OLD')).then(() => true, () => false), false);
  check('成功后无 staging 或 backup 残留', (await readdir(workspace)).filter((name) => name.includes('.staging-')).length, 0);
}

await rm(workspace, { recursive: true, force: true });

console.log(`\n结果：${passed} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const item of failures) console.log(`  - ${item}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;

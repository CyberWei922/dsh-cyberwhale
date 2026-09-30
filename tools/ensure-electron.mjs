#!/usr/bin/env node
/**
 * 准备 Electron 运行时（只在本地没有可用运行时时才需要跑）。
 *
 * 顺序：
 *   1. 已有准备好的运行时 → 直接退出
 *   2. @electron/get 的本地下载缓存 → 直接解包
 *   3. 从 electron 官方 GitHub Release 下载，并用同版本的 SHASUMS256.txt 校验
 *
 * 用法：
 *   node tools/ensure-electron.mjs [--version 43.4.1] [--force]
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  artifactSuffix,
  electronCacheRoot,
  findCachedZip,
  pluginRoot,
  probeElectron,
  extractZip,
} from '../lib/electron-runtime.js';
import { resolveDshHome } from '../lib/settings.js';

const DEFAULT_VERSION = '43.4.1';

function readFlag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const version = readFlag('version', process.env.DSH_DESKPET_ELECTRON_VERSION ?? DEFAULT_VERSION);
const force = process.argv.includes('--force');

const targetDir = join(resolveDshHome(), 'dsh-deskpet', 'electron');

async function alreadyPrepared() {
  if (force) return false;
  const probe = await probeElectron();
  if (probe.ok) {
    console.log(`已就绪：${probe.binary}  (来源：${probe.source})`);
    return true;
  }
  return false;
}

async function download(url, destination, label) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) {
    throw new Error(`下载失败 ${response.status} ${response.statusText}：${url}`);
  }
  const total = Number(response.headers.get('content-length') ?? '0');
  let received = 0;
  let lastLogged = 0;

  const stream = Readable.fromWeb(response.body);
  stream.on('data', (chunk) => {
    received += chunk.length;
    if (total > 0 && received - lastLogged > 8 * 1024 * 1024) {
      lastLogged = received;
      process.stdout.write(`\r  ${label} ${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
    }
  });

  await pipeline(stream, createWriteStream(destination));
  if (total > 0) process.stdout.write('\r');
  return destination;
}

async function sha256(file) {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
}

async function expectedHash(fileName, releaseBase) {
  const response = await fetch(`${releaseBase}/SHASUMS256.txt`, { redirect: 'follow' });
  if (!response.ok) throw new Error(`无法获取 SHASUMS256.txt（${response.status}）`);
  const text = await response.text();
  for (const line of text.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === fileName) return hash;
  }
  return null;
}

async function main() {
  if (await alreadyPrepared()) return;

  const suffix = artifactSuffix();
  const fileName = `electron-v${version}-${suffix}.zip`;

  // 1. 先看 @electron/get 缓存
  const cached = await findCachedZip({});
  if (cached !== null && !force) {
    console.log(`命中本地缓存：${cached.zip}`);
    await extractZip(cached.zip, targetDir);
    const probe = await probeElectron();
    if (probe.ok) {
      console.log(`已就绪：${probe.binary}  (来源：缓存)`);
      return;
    }
  }

  // 2. 官方源下载 + 校验
  const releaseBase = `https://github.com/electron/electron/releases/download/v${version}`;
  const url = `${releaseBase}/${fileName}`;
  console.log(`准备下载 ${fileName}`);
  console.log(`  源：${url}`);

  const staging = await mkdtemp(join(tmpdir(), 'dsh-pet-electron-'));
  const zipPath = join(staging, fileName);
  try {
    await download(url, zipPath, '下载中');
    const expected = await expectedHash(fileName, releaseBase);
    if (expected === null) throw new Error(`SHASUMS256.txt 里没有 ${fileName}`);
    const actual = await sha256(zipPath);
    if (actual !== expected) {
      throw new Error(`校验失败：期望 ${expected}，实际 ${actual}`);
    }
    console.log('  校验通过 (sha256)');
    await extractZip(zipPath, targetDir);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  const probe = await probeElectron();
  if (!probe.ok) throw new Error(`解包完成但仍不可用：${probe.error}`);
  console.log(`已就绪：${probe.binary}`);
  console.log(`  DSH home：${resolveDshHome()}`);
  console.log(`  插件根：${pluginRoot}`);
  console.log(`  （也可用 DSH_DESKPET_ELECTRON 环境变量覆盖）`);
}

main().catch((error) => {
  console.error(`\n准备 Electron 失败：${error instanceof Error ? error.message : String(error)}`);
  console.error(`提示：也可以手动把 ${artifactSuffix()} 的 electron zip 放进 ${electronCacheRoot()}`);
  process.exitCode = 1;
});

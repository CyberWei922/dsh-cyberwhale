#!/usr/bin/env node
/**
 * 准备 Electron 运行时（只在本地没有可用运行时时才需要跑）。
 *
 * 这里是 `lib/electron-provision.js` 的薄 CLI：流程本身只实现一次，
 * 设置页「设置 → 桌宠 → 准备运行时」走的是同一份代码。
 *
 * 顺序：
 *   1. 已有准备好的运行时 → 直接退出（除非 --force 或 --version 指定了别的版本）
 *   2. @electron/get 的本地下载缓存 → 直接解包
 *   3. 从 electron 官方 GitHub Release 下载，并用同版本的 SHASUMS256.txt 校验；
 *      官方源失败会自动改用国内镜像重试一次
 *
 * 用法：
 *   node tools/ensure-electron.mjs [--version 43.4.1] [--force] [--mirror <基址>]
 *
 * 镜像：
 *   --mirror https://registry.npmmirror.com/-/binary/electron
 *   DSH_DESKPET_ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron
 *   基址下应能取到 `v<version>/<文件名>` 与 `v<version>/SHASUMS256.txt`；
 *   官方 GitHub 源则使用 `download/v<version>/` 前缀。
 */

import { artifactSuffix, electronCacheRoot, pluginRoot } from '../lib/electron-runtime.js';
import { DEFAULT_ELECTRON_VERSION, provisionElectron } from '../lib/electron-provision.js';
import { resolveDshHome } from '../lib/settings.js';

function readFlag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const version = readFlag('version', process.env.DSH_DESKPET_ELECTRON_VERSION ?? DEFAULT_ELECTRON_VERSION);
const force = process.argv.includes('--force');
const mirror = readFlag('mirror', process.env.DSH_DESKPET_ELECTRON_MIRROR ?? '');

/** 上一次输出的进度行是否停在同一行（`\r` 覆盖式），换阶段前先换行。 */
let progressLine = false;
let lastUrl = null;

/** 确认进度行的收尾，避免和下一条日志叠在同一行。 */
function endProgressLine() {
  if (!progressLine) return;
  process.stdout.write('\n');
  progressLine = false;
}

/** 把宿主的进度回调翻译成原有的中文命令行输出。 */
function onProgress(progress) {
  if (progress.url !== undefined && progress.url !== lastUrl) {
    // 换源（官方 → 镜像）时重新报一次，用户才知道"它在重试"。
    endProgressLine();
    lastUrl = progress.url;
    console.log(`准备下载 ${progress.url.split('/').pop()}`);
    console.log(`  源：${progress.url}`);
    if (mirror === '') {
      console.log('  提示：直连 GitHub 慢或被拦时会自动改用国内镜像（也可用 --mirror 指定）');
    }
  }

  if (progress.phase === 'downloading') {
    const total = Number(progress.total) || 0;
    const received = Number(progress.received) || 0;
    if (total > 0) {
      process.stdout.write(`\r  下载中 ${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
      progressLine = true;
    }
    return;
  }
  if (progress.phase === 'verifying') {
    endProgressLine();
    console.log('  校验中…');
    return;
  }
  if (progress.phase === 'extracting') {
    endProgressLine();
    console.log('  校验通过，解包中…');
  }
}

/** 来源标识 → 用户看得懂的名字。本机来源保留原标识，便于排障。 */
function sourceLabel(source) {
  if (source === 'official') return '官方源';
  if (source === 'mirror') return '国内镜像';
  return String(source);
}

async function main() {
  const result = await provisionElectron({ version, mirror, force, onProgress });
  endProgressLine();

  const suffix = result.version === undefined || result.version === '' ? '' : `，v${result.version}`;
  console.log(`已就绪：${result.binary}  (来源：${sourceLabel(result.source)}${suffix})`);
  if (result.source === 'mirror') {
    console.log('  （官方源不可用，已自动改用国内镜像）');
  }
  console.log(`  DSH home：${resolveDshHome()}`);
  console.log(`  插件根：${pluginRoot}`);
  console.log('  （也可用 DSH_DESKPET_ELECTRON 环境变量覆盖）');
}

main().catch((error) => {
  console.error(`\n准备 Electron 失败：${error instanceof Error ? error.message : String(error)}`);
  console.error(`提示：也可以手动把 ${artifactSuffix()} 的 electron zip 放进 ${electronCacheRoot()}`);
  process.exitCode = 1;
});

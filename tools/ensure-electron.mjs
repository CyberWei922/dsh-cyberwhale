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
 *   3. 按**选定的下载源**下载，并用同版本的 SHASUMS256.txt 校验
 *
 * **不自动换源**：国内直连 GitHub Release 的表现通常是「连得上但极慢」而不是失败，
 * 基于失败的回退根本触发不了，用户只会看到一个不动的进度条。所以这里和设置页
 * 一样，让用户明确选一次；选错了换一个再跑一次即可。
 *
 * 用法：
 *   node tools/ensure-electron.mjs [--version 43.4.1] [--force]
 *                                  [--source mirror|official] [--mirror <自定义基址>]
 *
 * 下载源：
 *   --source mirror     国内镜像（npmmirror，默认）
 *   --source official   electron 官方 GitHub Release
 *   DSH_DESKPET_ELECTRON_SOURCE=mirror|official
 *
 * 自定义镜像基址（优先于 --source）：
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
const source = readFlag('source', process.env.DSH_DESKPET_ELECTRON_SOURCE ?? '');

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
    endProgressLine();
    lastUrl = progress.url;
    console.log(`准备下载 ${progress.url.split('/').pop()}`);
    console.log(`  源：${progress.url}`);
    // 慢或被拦时不要等它跑完 —— 明确告诉用户换一个源重跑。
    console.log('  提示：太慢或卡住就换个源重跑（--source official / --source mirror）');
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
function sourceLabel(value) {
  if (value === 'official') return '官方源';
  if (value === 'mirror') return '国内镜像';
  if (value === 'custom') return '自定义镜像';
  return String(value);
}

async function main() {
  const result = await provisionElectron({ version, mirror, source, force, onProgress });
  endProgressLine();

  const suffix = result.version === undefined || result.version === '' ? '' : `，v${result.version}`;
  console.log(`已就绪：${result.binary}  (来源：${sourceLabel(result.source)}${suffix})`);
  console.log(`  DSH home：${resolveDshHome()}`);
  console.log(`  插件根：${pluginRoot}`);
  console.log('  （也可用 DSH_DESKPET_ELECTRON 环境变量覆盖）');
}

main().catch((error) => {
  console.error(`\n准备 Electron 失败：${error instanceof Error ? error.message : String(error)}`);
  console.error(`提示：也可以手动把 ${artifactSuffix()} 的 electron zip 放进 ${electronCacheRoot()}`);
  process.exitCode = 1;
});

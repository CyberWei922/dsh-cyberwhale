/**
 * 孤儿助手清扫。
 *
 * 为什么需要：桌宠窗口是独立进程。正常情况下它由 `ctx.subprocess` 托管，
 * 插件卸载 / Host 退出时会被回收；但如果哪一步漏了（历史版本就出现过这类
 * 引用丢失），桌面上会留下无主的窗口进程 —— 而那时我们已经没有它的 handle 了。
 *
 * 于是在插件启动时做一次清扫：只收掉「确实是本插件的 Electron 助手」的进程
 * （命令行以 Electron 开头、且带着本插件助手目录）。DSH 有单实例锁，
 * 所以不会有第二个实例的桌宠被误伤。
 *
 * 整个过程是可失败即忽略的：清理不掉也不该影响插件启动。
 *
 * @module dsh-deskpet/orphans
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * 可执行文件必须是 Electron。
 *
 * 只按「命令行里出现过这个路径」来匹配是不安全的 —— 任何命令行里碰巧提到该路径的
 * 进程（比如一条恰好包含它的 shell 命令）都会被误杀。开发时就这么误伤过一次。
 * 因此额外要求命令行以 Electron 可执行文件开头。
 */
const ELECTRON_EXECUTABLE = /^\S*[\\/](?:Electron|electron|electron\.exe)(?:\s|$)/;

/**
 * 找出命令行里出现 `needle` 的进程。
 *
 * @param {string} needle 匹配片段（通常是某个绝对路径）
 * @param {object} [options]
 * @param {boolean} [options.electronOnly] 仅匹配 Electron 进程。
 *   清扫助手时必须开：只按「命令行里出现过这个路径」匹配是不安全的 ——
 *   任何命令行里碰巧提到该路径的进程（比如一条恰好包含它的 shell 命令）
 *   都会被误杀，开发时就这么误伤过一次。
 *   但「DSH 是否在运行」这类检查要关掉它，因为 DSH 的可执行文件并不叫 Electron。
 * @returns {Promise<number[]>} pid 列表（不含当前进程）
 */
export async function findMatchingProcesses(needle, { electronOnly = false } = {}) {
  if (process.platform === 'win32') return []; // Windows 走另一套（后续再做）
  if (typeof needle !== 'string' || needle.length < 8) return [];

  try {
    // 不用 `pgrep -f`：macOS 上它对较长或带空格的模式会漏匹配
    // （实测「同一批进程，ps 找到 4 个，pgrep 一个都没有」）。
    // `ps -axo pid=,command=` 给的是完整命令行，自己筛最稳。
    const { stdout } = await run('ps', ['-axo', 'pid=,command='], {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });

    const pids = [];
    for (const line of stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (match === null) continue;
      const pid = Number.parseInt(match[1], 10);
      if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) continue;
      const command = match[2];
      if (!command.includes(needle)) continue;
      if (electronOnly && !ELECTRON_EXECUTABLE.test(command)) continue;
      pids.push(pid);
    }
    return pids;
  } catch {
    // 拿不到进程表不是需要上报的问题：清扫本身是尽力而为。
    return [];
  }
}

/**
 * 清扫上一次运行遗留的助手进程。
 * @param {object} options
 * @param {string} options.helperDir 助手应用目录（用作命令行匹配片段）
 * @param {object} [options.logger]
 * @returns {Promise<number>} 被清理掉的进程数
 */
export async function sweepOrphanHelpers({ helperDir, logger }) {
  const pids = await findMatchingProcesses(helperDir, { electronOnly: true });
  if (pids.length === 0) return 0;

  let killed = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      killed += 1;
    } catch {
      // 已经退出，或没有权限：都不是需要上报的问题。
    }
  }

  if (killed > 0) {
    logger?.info?.('桌宠：清理了 %d 个上次遗留的窗口进程', killed);
  }
  return killed;
}

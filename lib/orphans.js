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
 * 平台差异：
 *   - POSIX：`ps -axo pid=,command=` 拿完整命令行，逐行筛。
 *   - Windows：`Get-CimInstance Win32_Process`（wmic 在新系统上已移除），
 *     只查 `electron.exe` 再按命令行筛；结束时用 `taskkill /T` 连子进程一起收，
 *     因为 Windows 上杀父进程不会自动带走它的 GPU/渲染子进程。
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
 * 因此额外要求命令行以 Electron 可执行文件开头（Windows 上允许带引号 ——
 * CIM 返回的命令行会保留创建时的引号形式）。
 */
// 带引号路径可包含空格；无引号路径的空格不能引入另一个绝对路径或选项。
const ELECTRON_EXECUTABLE = /^\s*(?:"[^"]*[\\/](?:Electron|electron)(?:\.exe)?"|[^\s"']+(?:[ \t]+(?![\\/\-'"])[^\s"']+)*[\\/](?:Electron|electron)(?:\.exe)?)(?:\s|$)/;

/**
 * 判断一条命令行是不是「以 Electron 可执行文件开头」。
 * @param {string} command
 * @returns {boolean}
 */
export function isElectronCommand(command) {
  return ELECTRON_EXECUTABLE.test(command);
}

/**
 * 从进程表里筛出命令行包含 `needle` 的进程。
 * @param {Array<{ pid: number, command: string }>} entries
 * @param {string} needle
 * @param {object} [options]
 * @param {boolean} [options.electronOnly]
 * @param {number} [options.selfPid]
 * @returns {number[]}
 */
export function selectMatches(entries, needle, { electronOnly = false, selfPid = process.pid } = {}) {
  const pids = [];
  for (const entry of entries) {
    const pid = Number(entry?.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === selfPid) continue;
    const command = typeof entry?.command === 'string' ? entry.command : '';
    if (!command.includes(needle)) continue;
    if (electronOnly && !isElectronCommand(command)) continue;
    pids.push(pid);
  }
  return pids;
}

/** POSIX：`ps -axo pid=,command=` 给完整命令行，自己筛最稳。 */
async function listPosixProcesses() {
  const { stdout } = await run('ps', ['-axo', 'pid=,command='], {
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const entries = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    entries.push({ pid: Number.parseInt(match[1], 10), command: match[2] });
  }
  return entries;
}

/**
 * Windows：用 CIM 拿 electron.exe 的进程表。
 *
 * 只查 `electron.exe`：桌宠助手的可执行文件必然叫这个名字，
 * 这样查询量小、也不必解析全部进程。CommandLine 可能为 null（权限不足），
 * 这种条目直接跳过。
 */
async function listWindowsElectronProcesses() {
  // 单行脚本：管道中间不能有分号（拼多行时容易踩到）。
  const script =
    '$ErrorActionPreference="Stop"; ' +
    'Get-CimInstance Win32_Process -Filter "Name=\'electron.exe\'" | ' +
    'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: 8000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  const text = stdout.trim();
  if (text === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((row) => row !== null && typeof row === 'object' && typeof row.CommandLine === 'string')
    .map((row) => ({ pid: Number(row.ProcessId), command: row.CommandLine }));
}

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
  if (typeof needle !== 'string' || needle.length < 8) return [];

  try {
    const entries = process.platform === 'win32' ? await listWindowsElectronProcesses() : await listPosixProcesses();
    return selectMatches(entries, needle, { electronOnly });
  } catch {
    // 拿不到进程表不是需要上报的问题：清扫本身是尽力而为。
    return [];
  }
}

/**
 * 结束一个进程（及其子进程）。
 *
 * Windows 上必须带走整棵树：Electron 的 GPU/渲染进程是子进程，
 * 只杀主子进程会留下它们；taskkill /T 才是等价于「关掉整个应用」的操作。
 * @param {number} pid
 * @returns {Promise<boolean>} 是否执行了结束动作
 */
async function killTree(pid) {
  if (process.platform === 'win32') {
    try {
      await run('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000, windowsHide: true });
      return true;
    } catch {
      return false; // 已经退出或没有权限：都不是需要上报的问题
    }
  }
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
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
    if (await killTree(pid)) killed += 1;
  }

  if (killed > 0) {
    logger?.info?.('桌宠：清理了 %d 个上次遗留的窗口进程', killed);
  }
  return killed;
}

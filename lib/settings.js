/**
 * 桌宠设置：读写 `$DSH_HOME/dsh-deskpet/settings.json`。
 *
 * 为什么不用 DSH 的 Config / config-editor：
 * 桌宠的设置是「用户偏好」而不是「插件组合配置」，写自己的文件可以避免
 * 触碰 profile patch，也让设置卡在 Host 未重载时也能立即生效。
 *
 * @module dsh-deskpet/settings
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** 默认设置。 */
export const DEFAULT_SETTINGS = Object.freeze({
  /** 宠物是否启用（关掉后 helper 进程会退出）。 */
  enabled: true,
  /** 显示缩放，1.0 对应图集单元格 192×208 的原始比例。 */
  scale: 1.0,
  /** 是否让宠物眼睛跟随鼠标（使用图集第 9–10 行）。 */
  lookAtCursor: true,
  /** 是否记住窗口位置。 */
  rememberPosition: true,
  /** 记住的窗口位置（macOS 屏幕坐标）。 */
  position: null,
  /** 气泡提示开关。 */
  bubbles: true,
});

/** 数值型设置的合法区间。 */
export const LIMITS = Object.freeze({
  // 上限必须 ≤ 助手窗口的固定包络（helper/main.js 的 ENVELOPE_SCALE），
  // 否则宠物会被窗口裁掉。
  scale: { min: 0.5, max: 1.6, step: 0.05 },
});

/** 解析 DSH home。 */
export function resolveDshHome(env = process.env) {
  const explicit = env.DSH_HOME?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  return join(homedir(), '.dsh');
}

/** 设置文件路径。 */
export function settingsPath(env = process.env) {
  return join(resolveDshHome(env), 'dsh-deskpet', 'settings.json');
}

/** 把任意输入夹紧成合法设置。 */
export function normalizeSettings(input) {
  const raw = input !== null && typeof input === 'object' ? input : {};
  const scaleNumber = Number(raw.scale);
  const scale = Number.isFinite(scaleNumber)
    ? Math.min(LIMITS.scale.max, Math.max(LIMITS.scale.min, scaleNumber))
    : DEFAULT_SETTINGS.scale;

  let position = null;
  if (
    raw.position !== null
    && typeof raw.position === 'object'
    && Number.isFinite(Number(raw.position.x))
    && Number.isFinite(Number(raw.position.y))
  ) {
    position = { x: Math.round(Number(raw.position.x)), y: Math.round(Number(raw.position.y)) };
  }

  return {
    enabled: raw.enabled === undefined ? DEFAULT_SETTINGS.enabled : raw.enabled !== false,
    scale,
    lookAtCursor: raw.lookAtCursor === undefined ? DEFAULT_SETTINGS.lookAtCursor : raw.lookAtCursor !== false,
    rememberPosition:
      raw.rememberPosition === undefined ? DEFAULT_SETTINGS.rememberPosition : raw.rememberPosition !== false,
    position,
    bubbles: raw.bubbles === undefined ? DEFAULT_SETTINGS.bubbles : raw.bubbles !== false,
  };
}

/**
 * 读取设置；文件不存在或损坏时回落到默认值。
 * @returns {Promise<ReturnType<typeof normalizeSettings>>}
 */
export async function loadSettings(env = process.env) {
  const file = settingsPath(env);
  try {
    return normalizeSettings(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

/**
 * 原子写入设置。
 * @param {object} settings 将被归一化后写入
 * @returns {Promise<ReturnType<typeof normalizeSettings>>} 实际写入的值
 */
// 同一路径的写入按调用顺序执行；一次失败不能阻断后续保存。
const pendingWrites = new Map();
let stagingSequence = 0;

export function saveSettings(settings, env = process.env) {
  const file = settingsPath(env);
  const normalized = normalizeSettings(settings);
  const previous = pendingWrites.get(file) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    await mkdir(dirname(file), { recursive: true });
    const staging = `${file}.${process.pid}.${++stagingSequence}.tmp`;
    try {
      await writeFile(staging, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      await rename(staging, file);
    } finally {
      await rm(staging, { force: true });
    }
    return normalized;
  });
  pendingWrites.set(file, task);
  const cleanup = () => {
    if (pendingWrites.get(file) === task) pendingWrites.delete(file);
  };
  task.then(cleanup, cleanup);
  return task;
}

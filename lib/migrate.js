/**
 * 一次性迁移：把旧项目名留下的 Harness home 目录搬到新名字下。
 *
 * 背景：本项目最初叫 `dsh-pet-whale`，后来按 GitHub 仓库名统一改成 `dsh-deskpet`。
 * 旧目录里有用户设置（`settings.json`）和已经解包好的 Electron 运行时（上百 MB）。
 * 直接改名整个目录可以两者一起接过来，而且是同卷 rename —— 瞬间完成、不复制。
 *
 * 只做一次，且只在「旧目录存在、新目录不存在」时动手：
 * 两个都在的情况宁可不动，也不要覆盖用户的新数据。
 *
 * @module dsh-deskpet/migrate
 */

import { access, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveDshHome } from './settings.js';

/** 旧项目名使用的目录名。 */
const LEGACY_DIR = 'dsh-pet-whale';
/** 当前使用的目录名。 */
const CURRENT_DIR = 'dsh-deskpet';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 迁移旧 home 目录。
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {object} [options.logger]
 * @returns {Promise<boolean>} 是否真的迁移了
 */
export async function migrateLegacyHome({ env = process.env, logger } = {}) {
  try {
    const root = resolveDshHome(env);
    const legacy = join(root, LEGACY_DIR);
    const current = join(root, CURRENT_DIR);

    if (!(await exists(legacy))) return false;
    if (await exists(current)) {
      logger?.debug?.('桌宠：新旧数据目录同时存在，保留现状不做迁移');
      return false;
    }

    await rename(legacy, current);
    logger?.info?.('桌宠：已把旧目录 %s 迁移到 %s', LEGACY_DIR, CURRENT_DIR);
    return true;
  } catch (error) {
    // 迁移失败不是致命问题：插件会用默认设置重新开始，Electron 也会从缓存重新解包。
    logger?.debug?.('桌宠：旧目录迁移失败（忽略）：%s', error instanceof Error ? error.message : String(error));
    return false;
  }
}

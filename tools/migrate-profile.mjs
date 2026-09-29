#!/usr/bin/env node
/**
 * 升级助手：把 Desktop profile 里的旧包名 `dsh-pet-whale` 就地改成 `dsh-deskpet`。
 *
 * 为什么需要它：包名变了，profile 里三处记录还指着旧名字 ——
 *   1. `package.json` 的 `dsh.profile.bundles`（bundle 加载列表）
 *   2. `package.json` 的 `dependencies`（link 依赖）
 *   3. `node_modules/dsh-pet-whale` 软链
 *   4. `pnpm-lock.yaml` 的 importer 条目
 * 不修的话，重启后 DSH 找不到 `dsh-pet-whale` 这个 bundle，桌宠会静默不加载。
 *
 * **必须在 DSH 完全退出后运行**（Desktop 独占 profile，运行期改会被覆盖）。
 *
 * 用法：
 *   node tools/migrate-profile.mjs            # 预演，只打印将要做的改动
 *   node tools/migrate-profile.mjs --apply    # 真正写入
 *   node tools/migrate-profile.mjs --apply --profile desktop
 */

import { access, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

import { resolveDshHome } from '../lib/settings.js';

const OLD_NAME = 'dsh-pet-whale';
const NEW_NAME = 'dsh-deskpet';

const apply = process.argv.includes('--apply');
const profileIndex = process.argv.indexOf('--profile');
const profileName =
  profileIndex >= 0 && process.argv[profileIndex + 1] !== undefined ? process.argv[profileIndex + 1] : 'desktop';

const profileDir = join(resolveDshHome(), 'profiles', profileName);

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** 检查 DSH 是否还在跑 —— 运行期改 profile 是无效的。 */
async function assertDesktopQuit() {
  const { findMatchingProcesses } = await import('../lib/orphans.js');
  // 主进程与它的 Desktop Host 子进程命令行都以这个路径开头。
  const running = await findMatchingProcesses('/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness');
  return running.length === 0;
}

function report(label) {
  console.log(`  ${apply ? '改' : '将改'}：${label}`);
}

async function main() {
  console.log(`\nprofile：${profileDir}`);
  console.log(`模式：${apply ? '★ 实际写入' : '预演（加 --apply 才写入）'}\n`);

  if (!(await exists(profileDir))) {
    console.error(`✗ profile 目录不存在：${profileDir}`);
    console.error('  先启动一次 DSH Desktop 以初始化 profile。');
    process.exitCode = 1;
    return;
  }

  const manifestPath = join(profileDir, 'package.json');
  const lockPath = join(profileDir, 'pnpm-lock.yaml');
  const linkPath = join(profileDir, 'node_modules', OLD_NAME);
  const newLinkPath = join(profileDir, 'node_modules', NEW_NAME);

  let changes = 0;

  // ── package.json ────────────────────────────────────────────────────────
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  let manifestTouched = false;

  const bundles = manifest?.dsh?.profile?.bundles;
  if (Array.isArray(bundles)) {
    const index = bundles.indexOf(OLD_NAME);
    if (index >= 0) {
      bundles[index] = NEW_NAME;
      manifestTouched = true;
      report(`package.json  bundles[${index}]  ${OLD_NAME} → ${NEW_NAME}`);
    }
  }

  if (manifest?.dependencies?.[OLD_NAME] !== undefined) {
    manifest.dependencies[NEW_NAME] = manifest.dependencies[OLD_NAME];
    delete manifest.dependencies[OLD_NAME];
    manifestTouched = true;
    report(`package.json  dependencies.${OLD_NAME} → ${NEW_NAME}`);
  }

  if (manifestTouched) {
    changes += 1;
    if (apply) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } else {
    console.log('  ·  package.json 无需改动');
  }

  // ── node_modules 软链 ───────────────────────────────────────────────────
  if (await exists(linkPath)) {
    const target = await readlink(linkPath).catch(() => '(非软链)');
    report(`node_modules/${OLD_NAME} → ${NEW_NAME}  (目标 ${target})`);
    changes += 1;
    if (apply) {
      await rm(newLinkPath, { force: true, recursive: false });
      await rename(linkPath, newLinkPath).catch(async () => {
        await rm(linkPath, { force: true });
        await symlink(target, newLinkPath);
      });
    }
  } else {
    console.log('  ·  node_modules 软链无需改动');
  }

  // ── pnpm-lock.yaml ──────────────────────────────────────────────────────
  if (await exists(lockPath)) {
    const lockRaw = await readFile(lockPath, 'utf8');
    if (lockRaw.includes(OLD_NAME)) {
      const lockNext = lockRaw.split(OLD_NAME).join(NEW_NAME);
      // 用字段级替换而不是整篇重写：保持 YAML 的原始排版。
      report(`pnpm-lock.yaml  出现 ${OLD_NAME} → ${NEW_NAME}`);
      changes += 1;
      if (apply) await writeFile(lockPath, lockNext, 'utf8');
    } else {
      console.log('  ·  pnpm-lock.yaml 无需改动');
    }
  }

  // ── DSH 是否已退出 ─────────────────────────────────────────────────────
  console.log('');
  if (await assertDesktopQuit()) {
    console.log('✓ DSH Desktop 未在运行');
  } else {
    console.log('⚠️  检测到 DSH Desktop 正在运行');
    console.log('   Desktop 独占 profile，运行期的改动会被覆盖 —— 请先完全退出再执行。');
    if (apply) process.exitCode = 1;
  }

  console.log('');
  if (changes === 0) {
    console.log('无需改动，profile 已经是新名字。');
  } else if (apply) {
    console.log(`完成，共 ${changes} 处改动。现在可以重新打开 DSH。`);
  } else {
    console.log(`预演结束，共 ${changes} 处待改动。加 --apply 实际写入。`);
  }
}

main().catch((error) => {
  console.error(`\n失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

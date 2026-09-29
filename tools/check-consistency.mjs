#!/usr/bin/env node
/**
 * 形象一致性检查：量化「同一动作的各帧画得有多不一样」。
 *
 * 为什么需要它：动画看着不舒服，很多时候不是位置漂移，而是**每一帧的角色细节
 * 都不一样**（裙摆褶皱数量、刘海走向、表情结构…）。这种差异肉眼看得出、
 * 但很难争论，所以把它变成一个数字。
 *
 * 做法：先把同行各帧按互相关对齐（否则测到的是位置漂移而不是画得不一致），
 * 再逐像素取中位数当「共识图」，最后量每帧与共识图的平均色差。
 *
 * 用法：
 *   node tools/check-consistency.mjs [帧目录] [--json]
 *
 * 退出码非 0 表示有行超过了阈值。
 *
 * @module tools/check-consistency
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { estimateRowShifts, ROW_SPECS } from './assemble-atlas.mjs';
import { decodePng } from './lib/png.mjs';

/** 平均偏差的目标上限。超过就说明帧间还有肉眼可见的差异。 */
const GOOD_AVERAGE = 10;
/** 单帧偏差的目标上限。 */
const GOOD_WORST = 16;
/** 「离群帧」判定：超过平均值的这个倍数。 */
const OUTLIER_RATIO = 1.35;

/**
 * 这些动作**本来就该大幅改变姿态**，帧间差异大是设计如此，不是不一致。
 *
 * 典型是 `jumping`：角色腾空、收腿、抬手，整个轮廓都在变。
 * 拿它和 `idle` 用同一把尺子量会得出"最差的一行"这种错误结论
 * （实测它的平均偏差 55.6，是 idle 的三倍，但看动画完全没有穿帮感）。
 *
 * 对这类行只做「帧内自比」——看有没有某一帧明显比其他帧更离群，
 * 而不用绝对阈值卡它。
 */
const POSE_CHANGING_ROWS = new Set(['jumping']);

function parseArguments(argv) {
  const options = { dir: 'individual-draft', json: false };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (!arg.startsWith('--')) options.dir = arg;
  }
  return options;
}

/** 与 estimateRowShifts 配套：算每帧相对「共识图」的平均色差。 */
function deviationFromConsensus(frames, shifts) {
  const width = frames[0].image.width;
  const height = frames[0].image.height;
  const count = frames.length;

  // 逐像素收集各帧样本（按对齐后的坐标）
  const samples = Array.from({ length: width * height }, () => []);
  frames.forEach((frame) => {
    const dx = Math.round(shifts.get(frame.file) ?? 0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sx = x - dx;
        if (sx < 0 || sx >= width) continue;
        const i = (y * width + sx) * 4;
        const k = y * width + x;
        samples[k].push(
          frame.image.data[i + 3] > 128
            ? [frame.image.data[i], frame.image.data[i + 1], frame.image.data[i + 2]]
            : null,
        );
      }
    }
  });

  // 共识图：逐像素中位数（抗离群），且要求绝大多数帧都实心
  const consensus = new Float32Array(width * height * 3);
  const solid = new Uint8Array(width * height);
  for (let k = 0; k < width * height; k += 1) {
    const pixels = samples[k].filter(Boolean);
    if (pixels.length < count * 0.9) continue;
    solid[k] = 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const sorted = pixels.map((pixel) => pixel[channel]).sort((a, b) => a - b);
      consensus[k * 3 + channel] = sorted[Math.floor(sorted.length / 2)];
    }
  }

  return frames.map((frame) => {
    const dx = Math.round(shifts.get(frame.file) ?? 0);
    let total = 0;
    let considered = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const k = y * width + x;
        if (solid[k] === 0) continue;
        const sx = x - dx;
        if (sx < 0 || sx >= width) continue;
        const i = (y * width + sx) * 4;
        considered += 1;
        // 该有内容却没画 → 按一个大偏差计，别让它被忽略
        if (frame.image.data[i + 3] <= 128) {
          total += 120;
          continue;
        }
        let sum = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          sum += (frame.image.data[i + channel] - consensus[k * 3 + channel]) ** 2;
        }
        total += Math.sqrt(sum / 3);
      }
    }
    return considered > 0 ? total / considered : 0;
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const dir = options.dir;
  const entries = await readdir(dir).catch(() => null);
  if (entries === null) {
    console.error(`帧目录不存在：${dir}`);
    process.exitCode = 1;
    return;
  }

  const report = [];
  for (const spec of ROW_SPECS) {
    const files = [];
    for (let index = 0; index < spec.expected; index += 1) {
      const padded = String(index).padStart(2, '0');
      const candidates = [`${spec.name}_${padded}.png`, `${spec.name}-${index}.png`];
      // 生成端用的是 gaze-a / gaze-b，规格里叫 look-a / look-b
      if (spec.name === 'look-a') candidates.unshift(`gaze-a_${padded}.png`);
      if (spec.name === 'look-b') candidates.unshift(`gaze-b_${padded}.png`);
      const hit = candidates.find((name) => entries.includes(name));
      if (hit !== undefined) files.push({ file: hit, image: decodePng(await readFile(join(dir, hit))) });
    }
    if (files.length < 2) continue;

    const shifts = estimateRowShifts(files);
    const devs = deviationFromConsensus(files, shifts);
    const average = devs.reduce((a, b) => a + b, 0) / devs.length;
    const worst = Math.max(...devs);
    const best = devs.indexOf(Math.min(...devs));
    const outliers = devs
      .map((value, index) => ({ index, value }))
      .filter((item) => item.value > average * OUTLIER_RATIO)
      .map((item) => item.index);

    report.push({
      name: spec.name,
      displayName: files[0].file.replace(/_\d+\.png$/, ''),
      average,
      worst,
      baselineIndex: best,
      outliers,
      devs,
      poseChanging: POSE_CHANGING_ROWS.has(spec.name),
      ok: POSE_CHANGING_ROWS.has(spec.name)
        // 姿态本就要变：只要求「没有哪一帧明显比别人更离群」
        ? worst <= average * OUTLIER_RATIO || outliers.length === 0
        : average <= GOOD_AVERAGE && worst <= GOOD_WORST,
    });
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n帧目录：${dir}`);
    console.log(`阈值：平均 ≤ ${GOOD_AVERAGE}，单帧 ≤ ${GOOD_WORST}（0~255 的逐像素平均色差）`);
    console.log(`标 * 的动作姿态本来就该大幅变化（${[...POSE_CHANGING_ROWS].join('、')}），只检查"有没有哪一帧特别离群"\n`);
    console.log('动作'.padEnd(15), '平均'.padStart(6), '最差'.padStart(6), ' 基准帧', ' 各帧偏差');
    for (const row of report) {
      const mark = row.ok ? '✓' : '✗';
      console.log(
        `${mark} ${row.displayName.padEnd(13)}${row.poseChanging ? '*' : ' '}`,
        row.average.toFixed(1).padStart(6),
        row.worst.toFixed(0).padStart(6),
        `#${row.baselineIndex}`.padStart(7),
        ' ' + row.devs.map((value) => value.toFixed(0)).join(' '),
      );
    }

    const failing = report.filter((row) => !row.ok);
    console.log();
    if (failing.length === 0) {
      console.log('✓ 所有动作的帧间一致性都达标');
    } else {
      console.log(`✗ ${failing.length} 个动作还没达标，建议重做的帧：`);
      for (const row of failing) {
        const targets = row.outliers.length > 0 ? row.outliers : [row.devs.indexOf(row.worst)];
        console.log(`     ${row.displayName}：${targets.map((index) => `#${index}`).join('、')}`);
      }
    }
  }

  if (report.some((row) => !row.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

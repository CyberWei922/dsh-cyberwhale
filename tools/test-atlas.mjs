#!/usr/bin/env node
/**
 * 散帧拼装工具的测试。
 *
 * 重点锁住两件事：
 *   1. 拼出来的几何必须满足「底边居中 + 不越界」—— 这正是用户遇到的"被截断"问题
 *   2. 源图的两类问题（没 alpha 通道 / 角色贴边）必须被区分开并报出来
 *
 * 运行：node tools/test-atlas.mjs
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CELL_HEIGHT,
  CELL_WIDTH,
  ROW_SPECS,
  chromaKey,
  assemble,
  discoverFrames,
  hasOpaqueBorder,
  matchRowFromStem,
  normalizeName,
  parseArguments,
  parseKeyColor,
} from './assemble-atlas.mjs';
import { alphaBounds, createCanvas, decodePng, encodePng } from './lib/png.mjs';

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

// ── 造图工具 ──────────────────────────────────────────────────────────────
function ellipse(canvas, cx, cy, rx, ry, [r, g, b], alpha = 255) {
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const i = (y * canvas.width + x) * 4;
      canvas.data[i] = r;
      canvas.data[i + 1] = g;
      canvas.data[i + 2] = b;
      canvas.data[i + 3] = alpha;
    }
  }
}

function fill(canvas, [r, g, b], alpha = 255) {
  for (let i = 0; i < canvas.width * canvas.height; i += 1) {
    canvas.data[i * 4] = r;
    canvas.data[i * 4 + 1] = g;
    canvas.data[i * 4 + 2] = b;
    canvas.data[i * 4 + 3] = alpha;
  }
}

async function save(dir, name, canvas) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), encodePng(canvas.data, canvas.width, canvas.height));
}

/** 读图集里某个格子的内容包围盒。 */
function cellBounds(atlas, row, column) {
  let minX = CELL_WIDTH;
  let minY = CELL_HEIGHT;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    for (let x = 0; x < CELL_WIDTH; x += 1) {
      const px = column * CELL_WIDTH + x;
      const py = row * CELL_HEIGHT + y;
      if (atlas.data[(py * atlas.width + px) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    bottomGap: CELL_HEIGHT - 1 - maxY,
    centerOffset: Math.abs((minX + maxX) / 2 - (CELL_WIDTH - 1) / 2),
  };
}

const workspace = await mkdtemp(join(tmpdir(), 'deskpet-atlas-test-'));

try {
  // ── PNG 编解码 ────────────────────────────────────────────────────────
  console.log('\n[1] PNG 编解码往返');
  {
    const original = createCanvas(37, 23);
    for (let i = 0; i < original.width * original.height; i += 1) {
      original.data[i * 4] = i % 256;
      original.data[i * 4 + 1] = (i * 7) % 256;
      original.data[i * 4 + 2] = (i * 13) % 256;
      original.data[i * 4 + 3] = (i * 29) % 256;
    }
    const decoded = decodePng(encodePng(original.data, original.width, original.height));
    check('宽度保持', decoded.width, 37);
    check('高度保持', decoded.height, 23);
    check('像素完全一致', Buffer.compare(decoded.data, original.data), 0);
    check('识别为带 alpha', decoded.hasAlpha, true);
  }

  // ── alpha 包围盒 ──────────────────────────────────────────────────────
  console.log('\n[2] alpha 包围盒');
  {
    const canvas = createCanvas(100, 80);
    ellipse(canvas, 50, 40, 20, 30, [10, 20, 30]);
    const bounds = alphaBounds(canvas);
    check('左右边界', `${bounds.left},${bounds.right}`, '30,70');
    check('上下边界', `${bounds.top},${bounds.bottom}`, '10,70');
    check('宽高', `${bounds.width}x${bounds.height}`, '41x61');
    check('全透明返回 null', alphaBounds(createCanvas(10, 10)), null);
  }

  // ── 参数解析 ──────────────────────────────────────────────────────────
  console.log('\n[3] 参数解析');
  {
    const parsed = parseArguments(['frames', '--safe', '160x180', '--margin', '8', '--key', 'FF00FF']);
    check('帧目录', parsed.framesDir, 'frames');
    check('安全区宽', parsed.safeWidth, 160);
    check('安全区高', parsed.safeHeight, 180);
    check('底边留白', parsed.margin, 8);
    check('抠色键', parsed.key, 'FF00FF');

    let threw = false;
    try {
      parseArguments(['frames', '--safe', '200x180']);
    } catch {
      threw = true;
    }
    check('安全区超出单元格时报错', threw, true);

    threw = false;
    try {
      parseArguments(['--safe', '160x180']);
    } catch {
      threw = true;
    }
    check('缺少帧目录时报错', threw, true);

    check('抠色颜色解析', JSON.stringify(parseKeyColor('#FF00FF')), '{"r":255,"g":0,"b":255}');
    threw = false;
    try {
      parseKeyColor('red');
    } catch {
      threw = true;
    }
    check('非法颜色报错', threw, true);
  }

  // ── 名称归一化 ────────────────────────────────────────────────────────
  console.log('\n[4] 动作名归一化');
  {
    check('空格转连字符', normalizeName('Running Right'), 'running-right');
    check('下划线转连字符', normalizeName('running_right'), 'running-right');
    check('去首尾空白', normalizeName('  idle  '), 'idle');
  }

  // ── 文件名匹配（一张一张交付时命名会很随意）────────────────────────────
  console.log('\n[4b] 文件名里的动作识别');
  {
    const cases = [
      ['idle-0', 0], ['idle_0', 0], ['whale-idle-0', 0], ['鲸鱼_待机_3', 0], ['待机-2', 0],
      ['running-right-3', 1], ['向右-5', 1], ['whale_running_right_2', 1],
      ['running-left-3', 2], ['向左-1', 2],
      // 关键消歧：running 行不能被 running-right / running-left 抢走
      ['running-4', 7], ['running_2', 7], ['干活-1', 7],
      ['waving-0', 3], ['挥手-2', 3],
      ['jumping-1', 4], ['jump_0', 4],
      ['failed-6', 5], ['出错-2', 5],
      ['waiting-4', 6], ['review-5', 8],
      ['look-a-3', 9], ['look-b-3', 10],
      ['bogus-0', undefined], ['frame-12', undefined],
    ];
    let wrong = [];
    for (const [stem, expected] of cases) {
      if (matchRowFromStem(stem) !== expected) wrong.push(stem);
    }
    check(`全部 ${cases.length} 个命名都能正确识别`, wrong.join(', '), '');
    check('长别名优先（running-right 不被 right 抢走）', matchRowFromStem('running-right-0'), 1);
    check('短别名仍可单独命中', matchRowFromStem('right-0'), 1);
  }

  // ── 帧发现 ────────────────────────────────────────────────────────────
  console.log('\n[5] 帧发现');
  {
    const dir = join(workspace, 'discover');
    await save(join(dir, 'idle'), '0.png', createCanvas(10, 10));
    await save(join(dir, 'idle'), '1.png', createCanvas(10, 10));
    await save(join(dir, '待机'), '2.png', createCanvas(10, 10)); // 别名归到同一行
    await save(dir, 'running-right-0.png', createCanvas(10, 10));
    await save(dir, 'running-right-10.png', createCanvas(10, 10));
    await save(dir, 'bogus-0.png', createCanvas(10, 10));
    await save(dir, 'noise.webp', createCanvas(10, 10));

    const { rows, unknown } = await discoverFrames(dir);
    check('idle 与「待机」合并到第 0 行', rows.get(0).length, 3);
    check('平铺命名进第 1 行', rows.get(1).length, 2);
    check('按序号排序（0 在 10 前）', rows.get(1)[0].endsWith('running-right-0.png'), true);
    check('无法识别的动作名被报告', unknown.some((item) => item.includes('bogus-0.png')), true);
    check('不支持的格式被报告', unknown.some((item) => item.includes('noise.webp')), true);
  }

  // ── 完整拼装：几何 ────────────────────────────────────────────────────
  console.log('\n[6] 拼装几何：底边居中且不越界');
  {
    const dir = join(workspace, 'geometry');
    // 尺寸各异，模拟"每张构图独立"
    for (let i = 0; i < 6; i += 1) {
      const canvas = createCanvas(300 + i * 40, 320 + i * 60);
      ellipse(canvas, canvas.width / 2, canvas.height / 2, 90, 110, [90, 150, 230]);
      await save(join(dir, 'idle'), `${i}.png`, canvas);
    }
    for (let i = 0; i < 8; i += 1) {
      const canvas = createCanvas(512, 512);
      ellipse(canvas, 256, 280, 120, 150, [90, 150, 230]);
      await save(join(dir, 'running-right'), `${i}.png`, canvas);
    }

    const { atlas, report } = await assemble(parseArguments([dir]));
    check('图集尺寸符合契约', `${atlas.width}x${atlas.height}`, '1536x2288');
    check('帧数统计', report.frameCount, 14);
    check('没有发现问题', report.hasProblems, false);

    // 每帧裁剪后尺寸一致 → 输出尺寸也应一致
    let bottomOk = true;
    let centerOk = true;
    let insideOk = true;
    for (const [row, count] of [[0, 6], [1, 8]]) {
      for (let column = 0; column < count; column += 1) {
        const bounds = cellBounds(atlas, row, column);
        if (bounds === null) {
          insideOk = false;
          continue;
        }
        if (bounds.bottomGap !== report.margin) bottomOk = false;
        if (bounds.centerOffset > 2) centerOk = false;
        if (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX >= CELL_WIDTH || bounds.maxY >= CELL_HEIGHT) insideOk = false;
      }
    }
    check('每格底边距恰好等于 margin', bottomOk, true);
    check('每格水平居中（误差 ≤2px）', centerOk, true);
    check('每格内容都不越界', insideOk, true);
  }

  // ── 横向漂移：身体不能随尾巴/鳍摆动而偏移 ────────────────────────────
  console.log('\n[6b] 横向漂移');
  {
    const dir = join(workspace, 'horizontal-drift');
    // 身体中轴固定在源画布 x=256，脚底固定在 y=544；尾巴逐帧伸出不同长度。
    // 按「包围盒中轴」对齐的话，尾巴一伸身体就会被推走。
    // 尾巴幅度要控制在「内容能完整放进格子」的范围内 ——
    // 尾巴过大时"身体居中"和"不出格"本身就矛盾，那是另一个取舍（见边界夹紧报告）。
    const tails = [0, 20, 0, 12];
    for (let i = 0; i < tails.length; i += 1) {
      const canvas = createCanvas(512, 560);
      if (tails[i] > 0) ellipse(canvas, 256 - 110 - tails[i] / 2, 420, tails[i] / 2, 40, [70, 120, 200]);
      ellipse(canvas, 256, 430, 90, 114, [90, 150, 230]);
      await save(join(dir, 'idle'), `${i}.png`, canvas);
    }

    const { atlas } = await assemble(parseArguments([dir]));

    // 只量「尾巴下方」的行，避开尾巴本身
    const bodyAxis = (column) => {
      let minX = CELL_WIDTH;
      let maxX = -1;
      for (let y = 170; y < 200; y += 1) {
        for (let x = 0; x < CELL_WIDTH; x += 1) {
          if (atlas.data[(y * atlas.width + column * CELL_WIDTH + x) * 4 + 3] > 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      return (minX + maxX) / 2;
    };

    const axes = tails.map((_, column) => bodyAxis(column));
    const spread = Math.max(...axes) - Math.min(...axes);
    check(`身体中轴不随尾巴摆动漂移（偏移 ${spread.toFixed(2)}px）`, spread <= 2, true);
    // 尾巴很大时，"身体精确居中"与"内容不出格"不可兼得：
    // 夹紧会**整行统一平移**（保住帧间一致性，代价是整行略偏）。
    // 所以这里只要求「还在格子中央附近」，不要求像素级居中。
    check(
      `身体中轴仍在格子中央附近（偏移 ${Math.abs(axes[0] - (CELL_WIDTH - 1) / 2).toFixed(1)}px）`,
      Math.abs(axes[0] - (CELL_WIDTH - 1) / 2) <= 10,
      true,
    );
  }

  // ── 全局统一缩放 ──────────────────────────────────────────────────────
  console.log('\n[7] 全局统一缩放');
  {
    const dir = join(workspace, 'scale');
    // 一帧 100x100（要求缩放到 1.68 才填满安全区），一帧 400x400（要求 0.42）
    const small = createCanvas(100, 100);
    ellipse(small, 50, 50, 40, 40, [1, 2, 3]);
    await save(join(dir, 'idle'), '0.png', small);

    const large = createCanvas(400, 400);
    ellipse(large, 200, 200, 160, 160, [1, 2, 3]);
    await save(join(dir, 'idle'), '1.png', large);

    // 期望值由实际包围盒推导，不写死像素算术 —— 写死过一次，错了三处。
    const requiredFor = (canvas) =>
      Math.min(168 / alphaBounds(canvas).width, 184 / alphaBounds(canvas).height);
    const expectedScale = Math.min(requiredFor(small), requiredFor(large));

    const { report } = await assemble(parseArguments([dir]));
    check('取所有帧里最严格的那个比例', Math.abs(report.scale - expectedScale) < 1e-9, true);
    check('受限帧是大的那张', report.limitingFile.endsWith('1.png'), true);

    const upscaled = await assemble(parseArguments([dir, '--allow-upscale']));
    check('允许放大也不会突破最严格的那一帧', Math.abs(upscaled.report.scale - expectedScale) < 1e-9, true);

    // 两帧都一样小时，允许放大才会真的放大
    const dir2 = join(workspace, 'scale-small');
    const tiny = createCanvas(80, 80);
    ellipse(tiny, 40, 40, 30, 30, [1, 2, 3]);
    await save(join(dir2, 'idle'), '0.png', tiny);
    const capped = await assemble(parseArguments([dir2]));
    check('默认不放大', capped.report.scale, 1);
    const allowed = await assemble(parseArguments([dir2, '--allow-upscale']));
    check('--allow-upscale 生效', Math.abs(allowed.report.scale - requiredFor(tiny)) < 1e-9, true);
  }

  // ── 跳跃的腾空高度必须保留 ────────────────────────────────────────────
  console.log('\n[7b] 跳跃腾空高度');
  {
    const dir = join(workspace, 'jump');
    // 固定画布 512×560，脚底线 544；角色逐帧升高
    const rises = [0, 60, 130, 190, 120];
    for (let i = 0; i < rises.length; i += 1) {
      const canvas = createCanvas(512, 560);
      const feet = 544 - rises[i];
      ellipse(canvas, 256, feet - 90, 70, 90, [90, 150, 230]);
      await save(join(dir, 'jumping'), `${i}.png`, canvas);
    }
    // 也放一张待机帧，确认两种锚定方式能共存
    const idle = createCanvas(300, 340);
    ellipse(idle, 150, 170, 70, 90, [90, 150, 230]);
    await save(join(dir, 'idle'), '0.png', idle);

    const { atlas, report } = await assemble(parseArguments([dir]));
    check('两种锚定方式都被用到', report.anchorModes.slice().sort().join(','), 'bottom,canvas');

    // 逐帧取包围盒底边：应当逐帧变高（腾空被保留），而不是全部贴地
    const bottoms = [];
    for (let column = 0; column < rises.length; column += 1) {
      const bounds = cellBounds(atlas, 4, column);
      bottoms.push(bounds === null ? null : bounds.maxY);
    }
    check('跳跃 5 帧都有内容', bottoms.every((value) => value !== null), true);
    check('腾空高度是递增再回落，而不是全被压平',
      bottoms[0] > bottoms[1] && bottoms[1] > bottoms[2] && bottoms[2] > bottoms[3] && bottoms[3] < bottoms[4],
      true);

    // 画布锚定的帧也必须水平居中。
    // 这里踩过坑：横向公式把 bboxLeft 算了两遍（画布锚定时它不该出现），
    // 整个 jumping 行被推到隔壁列，连上面的垂直测试都因此串了 ——
    // 所以这条直接量中轴，不再依赖"内容跑到别处导致别的测试失败"来间接发现。
    const jumpCenterOffsets = [];
    for (let column = 0; column < rises.length; column += 1) {
      const b = cellBounds(atlas, 4, column);
      if (b !== null) jumpCenterOffsets.push(Math.abs((b.minX + b.maxX) / 2 - (CELL_WIDTH - 1) / 2));
    }
    const worstJumpOffset = Math.max(...jumpCenterOffsets);
    check(`画布锚定的帧水平居中（最大偏移 ${worstJumpOffset.toFixed(1)}px）`, worstJumpOffset <= 2, true);

    // 待机帧（包围盒锚定）与跳跃落地帧（画布锚定）必须落在同一条地面线上。
    // 允许 ±2px：降采样会让最外一行只覆盖部分像素，alpha 落到阈值以下，
    // 量出来可能差 1px，这不是错位。
    const idleBounds = cellBounds(atlas, 0, 0);
    const jumpGroundBounds = cellBounds(atlas, 4, 0); // 第 0 帧是落地的
    check('待机帧底边贴地面线', Math.abs(idleBounds.bottomGap - report.margin) <= 2, true);
    check(
      '两种锚定方式的地面线一致（±2px）',
      Math.abs(idleBounds.bottomGap - jumpGroundBounds.bottomGap) <= 2,
      true,
    );
  }

  // ── 源图问题诊断 ──────────────────────────────────────────────────────
  console.log('\n[8] 源图问题诊断');
  {
    const dir = join(workspace, 'problems');

    // A. 没有 alpha 通道（RGB 实色底）
    const solid = createCanvas(256, 256);
    fill(solid, [255, 255, 255]);
    ellipse(solid, 128, 140, 70, 80, [90, 150, 230]);
    await save(join(dir, 'idle'), '0.png', solid);

    // B. 有 alpha，但角色大到贴边（源图可能已被裁）
    const clipped = createCanvas(240, 240);
    ellipse(clipped, 120, 120, 130, 130, [90, 150, 230]);
    await save(join(dir, 'idle'), '1.png', clipped);

    // C. 正常
    const normal = createCanvas(240, 240);
    ellipse(normal, 120, 130, 60, 70, [90, 150, 230]);
    await save(join(dir, 'idle'), '2.png', normal);

    const { report } = await assemble(parseArguments([dir]));
    check('报告了 2 处问题', report.problems.length, 2);
    check('识别出实色背景', report.problems.some((item) => item.includes('整圈边框都不透明')), true);
    check('识别出角色贴边', report.problems.some((item) => item.includes('贴到了画布边缘')), true);
    check('正常帧没有被误报', report.problems.some((item) => item.includes('2.png')), false);
  }

  // ── 抠色 ──────────────────────────────────────────────────────────────
  console.log('\n[9] 抠色');
  {
    const dir = join(workspace, 'keyed');
    for (let i = 0; i < 4; i += 1) {
      const canvas = createCanvas(300, 340);
      fill(canvas, [255, 0, 255]); // 洋红底
      ellipse(canvas, 150, 170, 70, 110, [90, 150, 230]);
      await save(join(dir, 'waving'), `${i}.png`, canvas);
    }

    const without = await assemble(parseArguments([dir]));
    check('不抠色时报实色背景问题', without.report.hasProblems, true);

    const { atlas, report } = await assemble(parseArguments([dir, '--key', 'FF00FF']));
    check('抠色后没有问题', report.hasProblems, false);
    // 裁剪到角色范围：rx=70 ry=110 → 约 141x221
    // 注意分隔符是 × 而不是 x
    check('裁剪到角色实际范围', report.limitingSize, '141×221');

    // 全图不应再有洋红残留
    let magenta = 0;
    for (let i = 0; i < atlas.width * atlas.height; i += 1) {
      const r = atlas.data[i * 4];
      const g = atlas.data[i * 4 + 1];
      const b = atlas.data[i * 4 + 2];
      if (atlas.data[i * 4 + 3] > 8 && r > 150 && b > 150 && g < 100) magenta += 1;
    }
    check('无洋红残留像素', magenta, 0);
  }

  // ── 边缘检测辅助 ──────────────────────────────────────────────────────
  console.log('\n[10] 边框不透明检测');
  {
    const solid = createCanvas(20, 20);
    fill(solid, [0, 0, 0]);
    check('纯实色 → true', hasOpaqueBorder(solid), true);

    const transparent = createCanvas(20, 20);
    ellipse(transparent, 10, 10, 5, 5, [0, 0, 0]);
    check('有透明边 → false', hasOpaqueBorder(transparent), false);

    const almost = createCanvas(20, 20);
    fill(almost, [0, 0, 0]);
    almost.data[(5 * 20 + 5) * 4 + 3] = 254; // 内部半透明不影响边框
    check('内部半透明不影响判定', hasOpaqueBorder(almost), true);
  }

  // ── 缺帧报告 ──────────────────────────────────────────────────────────
  console.log('\n[11] 缺帧报告');
  {
    const dir = join(workspace, 'partial');
    for (let i = 0; i < 3; i += 1) {
      const canvas = createCanvas(200, 200);
      ellipse(canvas, 100, 110, 50, 60, [1, 2, 3]);
      await save(join(dir, 'idle'), `${i}.png`, canvas);
    }
    const { report } = await assemble(parseArguments([dir]));
    const idle = report.rowCounts.find((row) => row.name === 'idle');
    check('idle 统计到 3 帧', idle.count, 3);
    check('idle 期望 6 帧', idle.expected, 6);
    check('整体标记为不完整', report.complete, false);
  }

  // ── 规格 vs 渲染器：必须完全一致 ──────────────────────────────────────
  console.log('\n[12] 帧数规格与渲染器一致');
  {
    const rendererSource = await readFile(new URL('../helper/renderer/pet.js', import.meta.url), 'utf8');

    const block = /const ANIMATIONS = \{([\s\S]*?)\n\};/.exec(rendererSource)[1];
    const rendererRows = new Map();

    // 多行显式帧序列也属于同一动作；重复播放的列不计为新素材帧。
    const compactBlock = block.replace(/\{\s*row:([\s\S]*?)\}/g, (value) => value.replace(/\s+/g, ' '));
    for (const rawLine of compactBlock.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      if (line === '' || line.startsWith('//')) continue;

      const keyed = /^'?([a-z-]+)'?:\s*\{(.*)\}$/.exec(line);
      if (keyed !== null) {
        const row = Number(/row:\s*(\d+)/.exec(keyed[2])[1]);
        const cols = /cols:\s*\[([^\]]*)\]/.exec(keyed[2])[1];
        rendererRows.set(row, {
          name: keyed[1],
          count: new Set(cols.split(',').map((value) => value.trim()).filter(Boolean)).size,
        });
        continue;
      }

      const animated = /^'?([a-z-]+)'?:\s*rowAnimation\((\d+),\s*(\d+),/.exec(line);
      if (animated !== null) {
        rendererRows.set(Number(animated[2]), { name: animated[1], count: Number(animated[3]) });
      }
    }

    // 注视方向的两行不在 ANIMATIONS 里，由 LOOK_ROWS + 每行帧数决定
    const lookRows = /const LOOK_ROWS = \[([^\]]*)\]/
      .exec(rendererSource)[1]
      .split(',')
      .map((value) => Number(value.trim()));
    const lookPerRow = Number(/const LOOK_FRAMES_PER_ROW = (\d+)/.exec(rendererSource)[1]);
    lookRows.forEach((row, index) => {
      rendererRows.set(row, { name: index === 0 ? 'look-a' : 'look-b', count: lookPerRow });
    });

    check('渲染器里解析出 11 行', rendererRows.size, 11);

    const mismatches = [];
    let total = 0;
    for (const spec of ROW_SPECS) {
      const actual = rendererRows.get(spec.row);
      if (actual === undefined) {
        mismatches.push(`第 ${spec.row} 行在渲染器里不存在`);
        continue;
      }
      if (actual.count !== spec.expected) {
        mismatches.push(`${spec.name} 帧数：规格 ${spec.expected} / 渲染器 ${actual.count}`);
      }
      if (actual.name !== spec.name) {
        mismatches.push(`第 ${spec.row} 行名字：规格 ${spec.name} / 渲染器 ${actual.name}`);
      }
      total += spec.expected;
    }
    check('每行的名字与帧数都一致', mismatches.join('；'), '');

    // 这一条是被实际踩过的坑：文档里手写总数，写错成 68（实际 73）。
    // 让文档和规格对不上时直接测试失败。
    // 71 = 73 - 2：干活中从 6 帧改成了 4 帧「端碗扒饭」。
    check('总帧数为 71', total, 71);
    const plan = await readFile(new URL('../docs/pet-atlas-repair-plan.md', import.meta.url), 'utf8');
    const stated = /共 11 个动作、(\d+) 帧/.exec(plan);
    check('返工方案里写的总帧数与规格一致', Number(stated?.[1]), total);
  }

  // ── 帧间对齐 ──────────────────────────────────────────────────────────
  console.log('\n[13] 帧间水平对齐');
  {
    const dir = join(workspace, 'align');
    // 身体固定在源画布 x=256，但每帧整体人为右移不同距离（模拟"生成端漂移"）。
    const offsets = [0, 20, 40, 20, 0];
    for (let i = 0; i < offsets.length; i += 1) {
      const canvas = createCanvas(512, 560);
      ellipse(canvas, 256 + offsets[i], 430, 70, 90, [90, 150, 230]);
      await save(join(dir, 'idle'), `${i}.png`, canvas);
    }

    const plain = await assemble(parseArguments([dir]));
    const aligned = await assemble(parseArguments([dir, '--align', 'row']));

    // 量「身体中轴」相对格中轴的最大偏离
    const axisSpread = (atlas) => {
      const centers = [];
      for (let column = 0; column < offsets.length; column += 1) {
        let minX = CELL_WIDTH;
        let maxX = -1;
        for (let y = 0; y < CELL_HEIGHT; y += 1) {
          for (let x = 0; x < CELL_WIDTH; x += 1) {
            if (atlas.data[(y * atlas.width + column * CELL_WIDTH + x) * 4 + 3] > 128) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
            }
          }
        }
        if (maxX >= 0) centers.push((minX + maxX) / 2);
      }
      return Math.max(...centers) - Math.min(...centers);
    };

    const before = axisSpread(plain.atlas);
    const after = axisSpread(aligned.atlas);
    check(`对齐前确实有漂移（${before.toFixed(0)}px）`, before > 8, true);
    check(`对齐后漂移显著变小（${before.toFixed(0)} → ${after.toFixed(0)}px）`, after < before / 2, true);
    check('报告里列出了每行的对齐情况', aligned.report.alignReport.length, 1);
    check('对齐后仍然居中', axisSpread(aligned.atlas) <= 12, true);
    check('对齐没有把内容挤出格子', aligned.report.geometryIssues.length, 0);
  }

  // ── 图集分辨率与清单契约 ──────────────────────────────────────────────
  console.log('\n[14] 成品图集的单元格尺寸必须与 pet.json 声明一致');
  {
    // 这一条是为了防「只重拼了图集、忘了改清单」或反过来 ——
    // 一旦对不上，渲染层裁格子的位置就全错，表现为宠物错位/花屏，很难查。
    // 注意用仓库根目录，不是测试用的临时 workspace
    const assetsDir = fileURLToPath(new URL('../assets', import.meta.url));
    const manifest = JSON.parse(await readFile(join(assetsDir, 'pet.json'), 'utf8'));
    const cell = manifest.spriteCell;
    check('pet.json 声明了 spriteCell', typeof cell?.width === 'number' && typeof cell?.height === 'number', true);

    const atlas = decodePng(await readFile(join(assetsDir, manifest.spritesheetPath)));
    check('图集宽度 = 单元格宽 × 8', atlas.width, cell.width * 8);
    check('图集高度 = 单元格高 × 11', atlas.height, cell.height * 11);

    // 逐格检查有没有内容，用声明的单元格尺寸切
    const expectedRows = new Map(ROW_SPECS.map((spec) => [spec.row, spec.expected]));
    let filled = 0;
    const empty = [];
    for (const [row, count] of expectedRows) {
      for (let column = 0; column < count; column += 1) {
        let solid = 0;
        for (let y = 0; y < cell.height; y += 2) {
          for (let x = 0; x < cell.width; x += 2) {
            const px = column * cell.width + x;
            const py = row * cell.height + y;
            if (atlas.data[(py * atlas.width + px) * 4 + 3] > 128) solid += 1;
          }
        }
        if (solid > 0) filled += 1;
        else empty.push(`第${row}行第${column}格`);
      }
    }
    check(`按声明的单元格切，每一格都有内容（${filled} 格）`, empty.join('、'), '');
    check('格子总数等于规格总帧数', filled, ROW_SPECS.reduce((sum, spec) => sum + spec.expected, 0));

    // 内容不能贴到格子边界（贴了就说明拼装时安全区算错了，会被邻格裁切）
    let worst = null;
    for (const [row, count] of expectedRows) {
      for (let column = 0; column < count; column += 1) {
        let minX = cell.width, maxX = -1, minY = cell.height, maxY = -1;
        for (let y = 0; y < cell.height; y += 1) {
          for (let x = 0; x < cell.width; x += 1) {
            const px = column * cell.width + x;
            const py = row * cell.height + y;
            if (atlas.data[(py * atlas.width + px) * 4 + 3] > 8) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) continue;
        const margin = Math.min(minX, maxX === -1 ? 0 : cell.width - 1 - maxX, minY, cell.height - 1 - maxY);
        if (worst === null || margin < worst.margin) worst = { margin, cell: `第${row}行第${column}格` };
      }
    }
    check(`内容离格子边缘最近也有余量（最小 ${worst?.margin}px @ ${worst?.cell}）`, worst !== null && worst.margin >= 2, true);
  }

  // ── 直接执行 vs 被导入 ────────────────────────────────────────────────
  console.log('\n[15] 被导入时不应执行 CLI');
  {
    // 能 import 到函数本身就说明没有在导入时跑 main()（跑了会 process.exit / 打印一堆东西）
    check('导出了 assemble', typeof assemble, 'function');
    check('导出了 discoverFrames', typeof discoverFrames, 'function');
    check('导出了 chromaKey', typeof chromaKey, 'function');
    check('导出了 formatReport', typeof (await import('./assemble-atlas.mjs')).formatReport, 'function');
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log(`\n结果：${passed} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}

void existsSync;
void readFile;

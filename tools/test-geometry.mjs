#!/usr/bin/env node
/**
 * 窗口/宠物几何与位置限制的测试。
 *
 * 这一层原本埋在 `helper/main.js` 里、没有任何测试 —— 于是"拖动向上会卡在
 * 一个高度"的 bug 一直没被发现。抽成纯模块之后就能这么测。
 *
 * 运行：node tools/test-geometry.mjs
 */

import { readFile } from 'node:fs/promises';

import {
  BUBBLE_SPACE,
  BUBBLE_WIDTH,
  CELL,
  ENVELOPE_SCALE,
  MARGIN,
  clamp,
  clampToArea,
  computeMetrics,
  petRectInWindow,
} from '../helper/geometry.js';

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

// 一块典型工作区：菜单栏 30px、1920×960
const AREA = { x: 0, y: 30, width: 1920, height: 960 };

const windowMetrics = computeMetrics(ENVELOPE_SCALE);

// ── 常量与渲染层一致 ──────────────────────────────────────────────────────
console.log('\n[1] 几何常量必须与渲染层一致');
{
  const geometrySource = await readFile(new URL('../helper/geometry.js', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../helper/main.js', import.meta.url), 'utf8');
  const petSource = await readFile(new URL('../helper/renderer/pet.js', import.meta.url), 'utf8');
  const cssSource = await readFile(new URL('../helper/renderer/pet.css', import.meta.url), 'utf8');

  const numberIn = (source, name) => {
    const found = new RegExp(`const ${name} = (\\d+)`).exec(source);
    return found === null ? undefined : Number(found[1]);
  };

  check('MARGIN 与渲染层一致', numberIn(geometrySource, 'MARGIN'), numberIn(petSource, 'MARGIN'));
  check('BUBBLE_SPACE 与渲染层一致', numberIn(geometrySource, 'BUBBLE_SPACE'), numberIn(petSource, 'BUBBLE_SPACE'));
  check('BUBBLE_WIDTH 与渲染层一致', BUBBLE_WIDTH, numberIn(petSource, 'BUBBLE_WIDTH'));

  const cellIn = (source) => {
    const found = /const CELL = \{ width: (\d+), height: (\d+) \}/.exec(source);
    return found === null ? undefined : `${found[1]}x${found[2]}`;
  };
  check('CELL 与渲染层一致', cellIn(geometrySource), cellIn(petSource));
  check('CELL 是契约尺寸 192x208', cellIn(geometrySource), '192x208');

  // pet.css 里的 bottom 是与 MARGIN 相同的兜底值（JS 会再写一次）
  check('pet.css 的 bottom 兜底值等于 MARGIN', Number(/bottom:\s*(\d+)px/.exec(cssSource)?.[1]), MARGIN);

  // main.js 必须**引用**这些常量，而不是自己再定义一份 ——
  // 两份定义正是这类漂移的温床。
  check(
    'main.js 没有自己重复定义这些常量',
    /const\s+(CELL|MARGIN|BUBBLE_SPACE|ENVELOPE_SCALE)\s*=/.test(mainSource),
    false,
  );

  // 解构出来的函数必须在**使用之前**声明：const 有 TDZ，写在后面会让
  // 整个助手进程启动即崩。这个坑真踩过 —— 纯单元测试抓不到（它们直接
  // import geometry.js，从不加载 main.js），只有真机启动才发现。
  const beforeRequire = mainSource.slice(0, mainSource.indexOf("require('./geometry.js')"));
  const earlyUses = ['clamp(', 'computeMetrics(', 'clampToArea(', 'petRectInWindow('].filter((name) =>
    beforeRequire.includes(name),
  );
  check('geometry 的解构在所有使用之前（否则启动即崩）', earlyUses.join(', '), '');

  // 反向检查：geometry 导出的名字如果在 main.js 里被调用，就必须解构进来。
  // 这个坑也真踩过 —— 用了 petRectInWindow 却忘了加进解构，
  // main.js 里一调用就 `is not defined`，而单元测试照样全绿。
  const geometryExportsSource = await readFile(new URL('../helper/geometry.js', import.meta.url), 'utf8');
  const destructured = new Set(
    (/const \{([\s\S]*?)\} = require\('\.\/geometry\.js'\)/.exec(mainSource)?.[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const exported = [...(/module\.exports = \{([\s\S]*?)\};/.exec(geometryExportsSource)?.[1] ?? '').matchAll(/([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map((match) => match[1])
    .filter((name) => !['module', 'exports'].includes(name));

  const usedButNotImported = exported.filter(
    (name) => !destructured.has(name) && new RegExp(`\\b${name}\\s*[(.]`, 'u').test(mainSource),
  );
  check('geometry 导出的名字若被 main.js 使用，就必须解构进来', usedButNotImported.join(', '), '');

  // 窗口包络必须 ≥ 允许的最大缩放，否则大档位下宠物会被固定尺寸的窗口裁掉。
  const { LIMITS } = await import('../lib/settings.js');
  check(`窗口包络（${ENVELOPE_SCALE}）≥ 允许的最大缩放（${LIMITS.scale.max}）`, ENVELOPE_SCALE >= LIMITS.scale.max, true);
}

// ── 尺寸公式 ──────────────────────────────────────────────────────────────
console.log('\n[2] 尺寸公式');
{
  check('1.0 档窗口预留左右让位空间', computeMetrics(1.0).width >= BUBBLE_WIDTH * 2 + MARGIN * 2, true);
  check('1.6 档窗口预留左右让位空间', computeMetrics(1.6).width >= BUBBLE_WIDTH * 2 + MARGIN * 2, true);
  // 高度 = 宠物 + 上下边距 + 上下各一块气泡空间
  check('1.6 档窗口高 597（含上下两块气泡空间）', computeMetrics(1.6).height, 597);
  check('扩大绘图区后气泡仍为原先的最大宽度', computeMetrics(1.0).bubbleWidth, 323);
  check(
    '窗口高 = 宠物高 + 2×MARGIN + 2×气泡空间',
    computeMetrics(1.0).height,
    computeMetrics(1.0).petHeight + MARGIN * 2 + Math.round(BUBBLE_SPACE * 1.0) * 2,
  );
}

console.log('\n[3c] 气泡左右让位不能被原生窗口截断');
{
  for (const scale of [0.45, 0.5, 0.7, 1.0, 1.2]) {
    const pet = petRectInWindow(windowMetrics, scale);
    // 左贴边时气泡向身体右侧移动，右贴边时反向移动。
    const leftBubbleRight = pet.left + BUBBLE_WIDTH + 6;
    const rightBubbleLeft = pet.left + pet.width - BUBBLE_WIDTH - 6;
    check(`档位 ${scale}：左贴边后气泡和阴影都在窗口内`, leftBubbleRight + MARGIN <= windowMetrics.width, true);
    check(`档位 ${scale}：右贴边后气泡和阴影都在窗口内`, rightBubbleLeft >= MARGIN, true);
  }
  const legacyWidth = Math.round(CELL.width * ENVELOPE_SCALE) + MARGIN * 2;
  check('旧位置坐标在扩大绘图区后保持宠物中心（误差 ≤0.5px）', Math.abs(windowMetrics.width / 2 - windowMetrics.positionOffsetX - legacyWidth / 2) <= 0.5, true);
}

// ── 宠物在窗口里的矩形 ────────────────────────────────────────────────────
console.log('\n[3] 宠物在窗口里的矩形（水平居中、垂直偏移恒定）');
{
  const tops = [];
  for (const scale of [0.45, 0.6, 1.2]) {
    const pet = petRectInWindow(windowMetrics, scale);
    tops.push(pet.top);
    // 窗口宽与宠物宽的差值可能是奇数，整像素定位下无法精确居中，
    // 允许 0.5px —— 这是算术上的必然，不是 bug。
    const centering = Math.abs(pet.left + pet.width / 2 - windowMetrics.width / 2);
    check(`档位 ${scale}：水平居中（偏差 ${centering}px）`, centering <= 0.5, true);
  }
  // 这个偏移必须是常数：如果它随缩放变，改缩放时宠物会在屏幕上跳一下。
  check('宠物相对窗口顶边的偏移不随缩放变', new Set(tops).size, 1);
  check('偏移等于上方那块气泡空间 + 边距', tops[0], MARGIN + Math.round(BUBBLE_SPACE * ENVELOPE_SCALE));
}

console.log('\n[3b] 每个档位下气泡都要放得下（上下都能放）');
{
  // 气泡实际高度约 30px（一行 12.5px 文字 + 内边距）。这里用 40px 留足余量。
  const BUBBLE_HEIGHT = 40;
  const GAP = 8;
  for (const scale of [0.45, 0.6, 1.2]) {
    const pet = petRectInWindow(windowMetrics, scale);
    const roomAbove = pet.top;
    const roomBelow = windowMetrics.height - pet.top - pet.height;
    const need = Math.round(BUBBLE_SPACE * scale) + GAP;
    check(
      `档位 ${scale}：头顶空间 ${roomAbove}px ≥ 需要 ${need}px`,
      roomAbove >= need,
      true,
    );
    check(
      `档位 ${scale}：脚底空间 ${roomBelow}px ≥ 需要 ${need}px`,
      roomBelow >= need,
      true,
    );
    // 也要放得下真实气泡（约 40px）
    check(`档位 ${scale}：能容纳实际气泡高度`, Math.min(roomAbove, roomBelow) >= BUBBLE_HEIGHT, true);
  }
}

// ── 位置限制（这是踩过坑的地方）──────────────────────────────────────────
console.log('\n[4] 位置限制：按宠物矩形，而不是窗口矩形');
{
  for (const scale of [0.45, 0.6, 1.2]) {
    const pet = petRectInWindow(windowMetrics, scale);

    const up = clampToArea(800, -99999, windowMetrics, scale, AREA);
    check(`档位 ${scale}：向上拖到底时宠物顶边贴住工作区顶边`, up.y + pet.top, AREA.y);

    const down = clampToArea(800, 99999, windowMetrics, scale, AREA);
    check(`档位 ${scale}：向下拖到底时宠物底边贴住工作区底边`, down.y + pet.top + pet.height, AREA.y + AREA.height);

    const left = clampToArea(-99999, 400, windowMetrics, scale, AREA);
    check(`档位 ${scale}：向左拖到底时宠物左边贴住工作区左边`, left.x + pet.left, AREA.x);

    const right = clampToArea(99999, 400, windowMetrics, scale, AREA);
    check(`档位 ${scale}：向右拖到底时宠物右边贴住工作区右边`, right.x + pet.left + pet.width, AREA.x + AREA.width);
  }
}

console.log('\n[5] 位置限制的回归（曾经"拖不上去"）');
{
  const petAt07 = petRectInWindow(windowMetrics, 0.7);
  const clamped = clampToArea(800, -99999, windowMetrics, 0.7, AREA);
  const petTopReachable = clamped.y + petAt07.top;

  check('0.7 档也能把宠物拖到工作区最上方', petTopReachable, AREA.y);

  // 旧公式是把窗口顶边限制在 area.y（`y >= area.y`），而不是限制宠物。
  // 窗口是按最大档位预留的，宠物相对窗口顶边有一个固定偏移
  //（现在是 132px；两版几何之前宠物贴窗口底，偏移是 319px，问题更严重）。
  // 于是宠物最高只能到 area.y + 偏移，看起来就是"卡在一个高度上不去"。
  const oldStylePetTop = Math.max(AREA.y, -99999) + petAt07.top;
  check('旧公式卡住的位置（宠物最高只能到这里）', oldStylePetTop, AREA.y + petAt07.top);
  check('旧公式确实比修复后低不少（说明 bug 真实存在）', oldStylePetTop - AREA.y > 100, true);

  // 窗口本身可以伸到屏幕外 —— 那是透明区域，看不见也不影响交互。
  check('窗口允许伸到工作区上方', clamped.y < AREA.y, true);
}

console.log('\n[6] 边界与异常输入');
{
  check('范围内的位置原样通过', `${clampToArea(500, 400, windowMetrics, 1.0, AREA).x},${clampToArea(500, 400, windowMetrics, 1.0, AREA).y}`, '500,400');

  const nan = clampToArea(Number.NaN, Number.NaN, windowMetrics, 1.0, AREA);
  check('NaN 不会产生 NaN 坐标', Number.isFinite(nan.x) && Number.isFinite(nan.y), true);

  check('clamp 下界', clamp(-100, 5, 10), 5);
  check('clamp 上界', clamp(100, 5, 10), 10);
  check('clamp 非有限值退回下界', clamp(Number.NaN, 5, 10), 5);

  // 宠物比工作区还大时（极小屏幕）不能让 min > max 反转
  const tiny = { x: 0, y: 0, width: 100, height: 100 };
  const squeezed = clampToArea(0, 0, windowMetrics, 1.6, tiny);
  check('工作区比宠物还小时坐标仍然有限', Number.isFinite(squeezed.x) && Number.isFinite(squeezed.y), true);
}

console.log('\n[7] 第二块屏幕（负坐标）');
{
  // 主屏左侧再挂一块屏：工作区从 x=-1920 开始
  const leftDisplay = { x: -1920, y: 0, width: 1920, height: 1080 };
  for (const scale of [0.7, 1.6]) {
    const pet = petRectInWindow(windowMetrics, scale);
    const left = clampToArea(-99999, 400, windowMetrics, scale, leftDisplay);
    check(`档位 ${scale}：负坐标屏上左边贴住`, left.x + pet.left, leftDisplay.x);
    const right = clampToArea(99999, 400, windowMetrics, scale, leftDisplay);
    check(`档位 ${scale}：负坐标屏上右边贴住`, right.x + pet.left + pet.width, leftDisplay.x + leftDisplay.width);
  }
}

console.log(`\n结果：${passed} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}

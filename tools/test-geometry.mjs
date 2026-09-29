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
  const earlyUses = ['clamp(', 'computeMetrics(', 'clampToArea('].filter((name) => beforeRequire.includes(name));
  check('geometry 的解构在所有使用之前（否则启动即崩）', earlyUses.join(', '), '');

  // 窗口包络必须 ≥ 允许的最大缩放，否则大档位下宠物会被固定尺寸的窗口裁掉。
  const { LIMITS } = await import('../lib/settings.js');
  check(`窗口包络（${ENVELOPE_SCALE}）≥ 允许的最大缩放（${LIMITS.scale.max}）`, ENVELOPE_SCALE >= LIMITS.scale.max, true);
}

// ── 尺寸公式 ──────────────────────────────────────────────────────────────
console.log('\n[2] 尺寸公式');
{
  check('1.0 档窗口宽 220', computeMetrics(1.0).width, 220);
  check('1.6 档窗口宽 335', computeMetrics(1.6).width, 335);
  check('1.6 档窗口高 479', computeMetrics(1.6).height, 479);
  check('窗口宽 = 宠物宽 + 2×MARGIN', computeMetrics(1.0).width, computeMetrics(1.0).petWidth + MARGIN * 2);
}

// ── 宠物在窗口里的矩形 ────────────────────────────────────────────────────
console.log('\n[3] 宠物在窗口里的矩形（底边居中）');
{
  for (const scale of [0.7, 1.0, 1.6]) {
    const pet = petRectInWindow(windowMetrics, scale);
    // 窗口宽与宠物宽的差值可能是奇数，整像素定位下无法精确居中，
    // 允许 0.5px —— 这是算术上的必然，不是 bug。
    const centering = Math.abs(pet.left + pet.width / 2 - windowMetrics.width / 2);
    check(`档位 ${scale}：水平居中（偏差 ${centering}px）`, centering <= 0.5, true);
    check(`档位 ${scale}：底边距窗口底 ${MARGIN}`, pet.top + pet.height, windowMetrics.height - MARGIN);
  }
}

// ── 位置限制（这是踩过坑的地方）──────────────────────────────────────────
console.log('\n[4] 位置限制：按宠物矩形，而不是窗口矩形');
{
  for (const scale of [0.7, 1.0, 1.6]) {
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

  // 旧公式是把窗口顶边限制在 area.y（`y >= area.y`）。
  // 窗口是按最大档位预留的，0.7 档下宠物顶边距窗口顶边 319px，
  // 于是宠物最高只到 area.y + 319 —— 那就是"卡在一个高度"的现象。
  const oldStylePetTop = Math.max(AREA.y, -99999) + petAt07.top;
  check('旧公式卡住的位置（宠物最高只能到这里）', oldStylePetTop, AREA.y + petAt07.top);
  check('旧公式确实比修复后低很多（说明 bug 真实存在）', oldStylePetTop - AREA.y > 300, true);

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

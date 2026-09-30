'use strict';

/**
 * 窗口与宠物的几何计算（纯函数，不碰任何 Electron API）。
 *
 * 单独拆出来是为了**可测试**：位置限制这类逻辑以前埋在 `main.js` 里，
 * 只能靠肉眼看，于是"拖不上去"这种 bug 一直没被发现。
 *
 * @module dsh-deskpet/helper-geometry
 */

/**
 * 图集单元格尺寸，必须与 `helper/renderer/pet.js` 的 `CELL` 一致。
 * @type {{ width: number, height: number }}
 */
const CELL = { width: 192, height: 208 };

/** 宠物四周的透明留白（CSS 像素）。必须与渲染层一致。 */
const MARGIN = 14;

/** 宠物头顶预留的气泡空间（按缩放换算）。必须与渲染层一致。 */
const BUBBLE_SPACE = 74;

/**
 * 窗口尺寸按「最大档位」固定，之后**永不改变**。
 *
 * 为什么不让窗口跟着缩放走：macOS 在透明窗口尺寸改变时会重新分配绘制表面，
 * 重建期间的那一帧可能被当作不透明合成 —— 压在窗口下面的东西（比如设置面板）
 * 就会暗一下。窗口尺寸固定后这件事根本不会发生。
 *
 * 代价是窗口远比小档位下的宠物大（0.7 档时窗口高 597、宠物只有 146），
 * 所以**任何和位置有关的计算都必须基于宠物矩形，而不是窗口矩形**。
 * 这也正是 Codex 的做法 —— 它的宠物窗口 384×400，而形象只有 112×121。
 */
const ENVELOPE_SCALE = 1.6;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 由缩放算窗口尺寸与该档位下的宠物尺寸。
 * @param {number} value 缩放
 */
function computeMetrics(value) {
  const petWidth = Math.round(CELL.width * value);
  const petHeight = Math.round(CELL.height * value);
  const bubble = Math.round(BUBBLE_SPACE * value);
  return {
    petWidth,
    petHeight,
    width: petWidth + MARGIN * 2,
    // 宠物上下**各留一块**气泡空间。
    //
    // 只留上方是不够的：角色被拖到屏幕顶部时，气泡在头顶就会跑到屏幕外。
    // 下面这块让气泡能翻到脚底。窗口尺寸本来就是固定的，多留一块不增加风险。
    height: petHeight + MARGIN * 2 + bubble * 2,
  };
}

/**
 * 宠物在窗口里的矩形（CSS 像素）。必须与渲染层的 `petRect()` 一致。
 *
 * 宠物是**底边居中**摆的：水平居中、底边距窗口底 `MARGIN`。
 * @param {{ width: number, height: number }} metrics 窗口尺寸
 * @param {number} scale 当前缩放
 */
function petRectInWindow(metrics, scale) {
  const petWidth = Math.round(CELL.width * scale);
  const petHeight = Math.round(CELL.height * scale);
  return {
    left: Math.round((metrics.width - petWidth) / 2),
    // 宠物相对窗口顶边的偏移按**包络**算，是常数，不随缩放变。
    // 如果让它随缩放变，改缩放时宠物会在屏幕上跳一下。
    // 这个偏移等于上方那块气泡空间 + 外边距。
    top: Math.round((metrics.height - metrics.petHeight) / 2),
    width: petWidth,
    height: petHeight,
  };
}

/**
 * 把**宠物**限制在工作区内 —— 注意不是把窗口限制在工作区内。
 *
 * 踩过的坑：原来按窗口算，条件 `y >= area.y` 的意思是"窗口顶边不能高过屏幕顶边"。
 * 但宠物相对窗口顶边有一个固定偏移，于是宠物顶边永远到不了 `area.y` 以上
 * —— 表现就是拖动向上"卡在一个高度"。
 *
 * 按宠物矩形算之后，窗口的透明部分可以伸到屏幕外（本来也看不见），
 * 宠物本身则始终完整停留在工作区内。
 *
 * @param {number} x 目标窗口 x
 * @param {number} y 目标窗口 y
 * @param {{ width: number, height: number }} metrics 窗口尺寸
 * @param {number} scale 当前缩放
 * @param {{ x: number, y: number, width: number, height: number }} area 工作区
 */
function clampToArea(x, y, metrics, scale, area) {
  const pet = petRectInWindow(metrics, scale);

  const minX = area.x - pet.left;
  const maxX = area.x + area.width - pet.left - pet.width;
  const minY = area.y - pet.top;
  const maxY = area.y + area.height - pet.top - pet.height;

  return {
    x: clamp(x, minX, Math.max(minX, maxX)),
    y: clamp(y, minY, Math.max(minY, maxY)),
  };
}

module.exports = {
  CELL,
  MARGIN,
  BUBBLE_SPACE,
  ENVELOPE_SCALE,
  clamp,
  computeMetrics,
  petRectInWindow,
  clampToArea,
};

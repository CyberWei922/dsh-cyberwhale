#!/usr/bin/env node
/**
 * 气泡链路测试：推理流 → 进度句 → 节流显示。
 *
 * 运行：node tools/test-bubble.mjs
 */

import { createBubbleScheduler, DEFAULT_MIN_INTERVAL_MS } from '../lib/bubble.js';
import { createProgressExtractor, displayWidth } from '../lib/progress.js';

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

/** 可控时钟：让"最小 3 秒间隔"能被确定性地测出来。 */
function createFakeClock() {
  let time = 0;
  let timers = [];
  return {
    now: () => time,
    setTimer(fn, delay) {
      const handle = { fn, at: time + delay };
      timers.push(handle);
      return handle;
    },
    clearTimer(handle) {
      timers = timers.filter((entry) => entry !== handle);
    },
    advance(ms) {
      const target = time + ms;
      // 一次推进里可能连续到期，逐个触发
      for (;;) {
        const due = timers.filter((entry) => entry.at <= target).sort((a, b) => a.at - b.at);
        if (due.length === 0) break;
        const next = due[0];
        timers = timers.filter((entry) => entry !== next);
        time = next.at;
        next.fn();
      }
      time = target;
    },
    get pending() {
      return timers.length;
    },
  };
}

// ── 显示宽度 ──────────────────────────────────────────────────────────────
console.log('\n[1] 显示宽度（CJK 算 2、拉丁算 1）');
{
  check('纯中文 4 字', displayWidth('读取配置'), 8);
  check('纯英文 4 字', displayWidth('read'), 4);
  check('中英混排（读=2 + 空格=1 + read=4）', displayWidth('读 read'), 7);
  check('空串', displayWidth(''), 0);
}

// ── 进度提取器 ────────────────────────────────────────────────────────────
console.log('\n[2] 从推理流提炼进度句');
{
  const extractor = createProgressExtractor();

  check('没有句末标点时不产出', extractor.push('让我先看看'), null);
  check('出现句号后产出最后一句', extractor.push('当前的实现。'), '看看当前的实现');

  check('同一句重复喂不会重复产出', extractor.push('。'), null);

  check('新句子会产出', extractor.push('这里调用了 setSize。'), '这里调用了 setSize');

  // 一次到达多句 → 取最后一句（最新的进展）
  check('一次多句取最后一句', extractor.push('第一步。第二步。第三步完成了。'), '第三步完成了');

  check('换行也算句边界', extractor.push('\n现在检查渲染层\n'), '检查渲染层');
}

console.log('\n[3] 清理与截断');
{
  const extractor = createProgressExtractor();
  check('去掉 markdown 记号', extractor.push('**读取** `state.js`。'), '读取 state.js');

  const long = createProgressExtractor();
  const line = long.push('这是一句非常长的推理内容需要被截断到气泡能放下的宽度为止。');
  check('超宽被截断并补省略号', line.endsWith('…'), true);
  check('截断后不超过上限', displayWidth(line) <= 44, true);

  const blank = createProgressExtractor();
  check('纯标点不产出', blank.push('。。。'), null);

  const meta = createProgressExtractor();
  check('去掉句首元叙述', meta.push('好的，我们来修改这个函数。'), '我们来修改这个函数');

  const keep = createProgressExtractor();
  // 去掉后不足 6 字时应保留原句，避免把内容削没
  check('元叙述后内容太短则保留原句', keep.push('嗯，好。'), '嗯，好');
}

console.log('\n[4] 不依赖标点的模型');
{
  const extractor = createProgressExtractor({ maxWidth: 10 });
  extractor.push('abcdefghijklmnopqrstuvwxyz'); // 26 > 10*2，应强制推进
  check('超长无标点时也会推进', typeof extractor.current, 'string');
  check('强制推进后也受宽度限制', displayWidth(extractor.current) <= 10, true);
}

console.log('\n[5] reset');
{
  const extractor = createProgressExtractor();
  extractor.push('第一轮的思考。');
  check('reset 前有内容', extractor.current, '第一轮的思考');
  extractor.reset();
  check('reset 后清空', extractor.current, null);
  check('reset 后重新开始', extractor.push('第二轮的想法。'), '第二轮的想法');
}

// ── 调度器 ────────────────────────────────────────────────────────────────
console.log('\n[6] 节流：最小间隔 + 排队');
{
  const clock = createFakeClock();
  const shown = [];
  const scheduler = createBubbleScheduler({
    onShow: (text) => shown.push(text),
    minIntervalMs: 3000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  scheduler.show('第一条');
  check('首次立即显示', shown.join('|'), '第一条');

  scheduler.show('第二条');
  scheduler.show('第三条');
  check('间隔内不立刻显示', shown.join('|'), '第一条');
  check('进了队列', scheduler.queued, 2);

  clock.advance(3000);
  check('间隔到点后只放最后一条', shown.join('|'), '第一条|第三条');
  check('队列已清空', scheduler.queued, 0);
  check('定时器已释放', clock.pending, 0);

  scheduler.show('第四条');
  // 刚 drain 过，lastShownAt 被刷新 → 还要再等一个完整间隔
  check('刚放完还要再等一个间隔', scheduler.queued, 1);
  clock.advance(3000);
  check('等满间隔后显示', shown.join('|'), '第一条|第三条|第四条');
}

console.log('\n[7] 插队与去重');
{
  const clock = createFakeClock();
  const shown = [];
  const scheduler = createBubbleScheduler({
    onShow: (text) => shown.push(text),
    minIntervalMs: 3000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  scheduler.show('普通');
  scheduler.show('排队中');
  scheduler.show('重要事件', { immediate: true });
  check('插队立即覆盖', shown.join('|'), '普通|重要事件');
  check('插队时丢弃了排队的旧内容', scheduler.queued, 0);

  scheduler.show('重要事件');
  check('内容没变不重复推', shown.join('|'), '普通|重要事件');

  scheduler.show('新内容');
  scheduler.show('新内容');
  clock.advance(3000);
  check('重复入队也只显示一次', shown.join('|'), '普通|重要事件|新内容');
}

console.log('\n[8] clear 与 dispose');
{
  const clock = createFakeClock();
  const shown = [];
  const scheduler = createBubbleScheduler({
    onShow: (text) => shown.push(text),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  scheduler.show('内容');
  scheduler.clear();
  check('clear 会回调空串', shown.join('|'), '内容|');
  check('clear 后队列为空', scheduler.queued, 0);

  scheduler.show('清空后');
  scheduler.dispose();
  scheduler.show('不该出现');
  clock.advance(10000);
  check('dispose 后不再回调', shown.join('|'), '内容||清空后');
}

console.log('\n[9] 防御超长文本');
{
  const clock = createFakeClock();
  const shown = [];
  const scheduler = createBubbleScheduler({
    onShow: (text) => shown.push(text),
    maxWidth: 20,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  scheduler.show('短句');
  scheduler.show('这是一句远超上限的长文本'.repeat(5));
  check('超长文本直接丢弃，不挤进气泡', shown.join('|'), '短句');
}

console.log('\n[10] 默认间隔与 Codex 一致');
{
  check('默认最小间隔 3 秒', DEFAULT_MIN_INTERVAL_MS, 3000);
}

// ── 端到端：真实形态的推理流 ──────────────────────────────────────────────
console.log('\n[11] 端到端：模拟一段真实推理流');
{
  const clock = createFakeClock();
  const shown = [];
  const scheduler = createBubbleScheduler({
    onShow: (text) => shown.push(text),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const extractor = createProgressExtractor();

  // 逐段喂（模拟 token 流），每段之间推进一点时间
  const stream = [
    '好的，用户想要修复缩放',
    '时的闪烁问题。让我先看看',
    '当前的实现。嗯，applyScale',
    ' 里调用了 setSize。',
  ];
  for (const piece of stream) {
    const line = extractor.push(piece);
    if (line !== null) scheduler.show(line);
    clock.advance(700); // token 流节奏：远快于 3 秒
  }
  clock.advance(3000);

  check('节流压掉了中间句子（3 秒最小间隔）', shown.length < 4, true);
  check('没有一句是空的', shown.every((text) => text.length > 0), true);
  check('第一句已去掉元叙述「好的」', shown[0].startsWith('用户想要'), true);
  console.log(`      实际显示：${shown.join('  /  ')}`);

  // 提取与节流分开验证：不接调度器时，四句话应该都被正确提炼出来
  const plain = createProgressExtractor();
  const extracted = [];
  for (const piece of stream) {
    const line = plain.push(piece);
    if (line !== null) extracted.push(line);
  }
  check('四段流提炼出 3 句话', extracted.length, 3);
  check('第 1 句去掉「好的，」', extracted[0], '用户想要修复缩放时的闪烁问题');
  check('第 2 句去掉「让我先」', extracted[1], '看看当前的实现');
  check('第 3 句去掉「嗯，」', extracted[2], 'applyScale 里调用了 setSize');
  console.log(`      全部提炼：${extracted.join('  /  ')}`);
}

console.log(`\n结果：${passed} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}

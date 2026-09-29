/**
 * 气泡的更新节奏。
 *
 * 逻辑照搬 Codex 桌面端（ChatGPT.app 的 `app-primary` 里那个 `RJ` 存储）：
 * 推理流来得比人眼能读的快得多，直接透传会变成一片乱闪。它的办法是
 * **最小间隔 + 排队**：
 *
 *   · 距上次显示不足 `minIntervalMs` → 排队，等够了再放
 *   · `immediate`（重要事件：等你确认、出错、回合结束）→ 丢弃队列，立即刷新
 *   · 内容没变 → 不重复推
 *
 * 与 Codex 有两处**有意不同**，都是因为我们的气泡只有一行（它是多行活动栈）：
 *
 *   1. 它 drain 时按顺序把队列里的事件全部提交；我们**只提交最后一条** ——
 *      中间过程用户根本来不及看，逐条播反而是在闪。
 *   2. 它 `update`/`cancel` 插队时先把队列 drain 一遍再提交；我们**直接丢弃队列** ——
 *      先播一条 0 毫秒就被盖掉的旧内容毫无意义。
 *
 * @module dsh-deskpet/bubble
 */

import { DEFAULT_MAX_WIDTH, displayWidth } from './progress.js';

export const DEFAULT_MIN_INTERVAL_MS = 3000;

/**
 * 建一个气泡调度器。
 *
 * @param {object} options
 * @param {(text: string) => void} options.onShow 真正显示时回调；`''` 表示清空
 * @param {number} [options.minIntervalMs] 两次显示之间的最小间隔
 * @param {number} [options.maxWidth] 超过这个显示宽度的文本直接丢弃（防上游塞长文）
 * @param {() => number} [options.now] 时钟（测试可注入）
 * @param {Function} [options.setTimer]
 * @param {Function} [options.clearTimer]
 */
export function createBubbleScheduler({
  onShow,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  maxWidth = DEFAULT_MAX_WIDTH,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let queue = [];
  let timer = null;
  let lastShownAt = null;
  let lastText = null;
  let disposed = false;

  function cancelTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function resetQueue() {
    queue = [];
    cancelTimer();
  }

  function commit(text) {
    if (text === lastText) return; // 内容没变就不重复推
    lastText = text;
    lastShownAt = now();
    onShow(text);
  }

  function drain() {
    const pending = queue;
    resetQueue();
    // 只放最后一条：中间过程攒着一次性播反而更闪。
    if (pending.length > 0) commit(pending[pending.length - 1]);
  }

  return {
    /**
     * 请求显示一条内容。
     * @param {string} text
     * @param {{ immediate?: boolean }} [options]
     */
    show(text, { immediate = false } = {}) {
      if (disposed) return;
      if (typeof text !== 'string' || text === '') return;
      // 上游万一塞了长文，直接丢掉：气泡放不下，硬塞只会被裁得莫名其妙。
      if (displayWidth(text) > maxWidth * 2) return;

      if (immediate) {
        // 丢弃排队中的旧内容：它们马上就要被盖掉，播出来只会白闪一下。
        resetQueue();
        commit(text);
        return;
      }

      if (timer !== null) {
        queue.push(text);
        return;
      }

      const remaining = lastShownAt === null ? 0 : minIntervalMs - (now() - lastShownAt);
      if (remaining <= 0) {
        commit(text);
        return;
      }

      queue.push(text);
      timer = setTimer(() => {
        timer = null;
        drain();
      }, remaining);
    },

    /** 清空气泡（换回合、关掉气泡功能时用）。 */
    clear() {
      if (disposed) return;
      resetQueue();
      lastText = null;
      lastShownAt = null;
      onShow('');
    },

    /** 停止调度。之后 `show()` / `clear()` 都是空操作，不会再触发回调。 */
    dispose() {
      resetQueue();
      lastShownAt = null;
      lastText = null;
      disposed = true;
    },

    /** 最近一次真正显示的内容（`null` 表示还没显示过）。 */
    get lastText() {
      return lastText;
    },

    /** 排队等待中的条数（调试/测试用）。 */
    get queued() {
      return queue.length;
    },
  };
}

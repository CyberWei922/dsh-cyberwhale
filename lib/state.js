/**
 * 桌宠状态机（纯逻辑，不依赖 DSH / Electron，便于单独测试）。
 *
 * 设计要点：
 * - 分「基态」和「瞬态」两层。基态是长期停留的姿态（idle / running / waiting…），
 *   瞬态是一次性播完就回落基态的姿态（jumping / failed / review…）。
 * - DSH 的事件频率可能很高，这里只接受已经归一化过的低频信号。
 *
 * @module dsh-deskpet/state
 */

/** 图集里可用的动画名（对应 8×11 图集的行；look-* 由渲染层按鼠标角度直接取帧）。 */
export const ANIMATIONS = Object.freeze({
  idle: 'idle',
  running: 'running',
  waiting: 'waiting',
  review: 'review',
  failed: 'failed',
  jumping: 'jumping',
  waving: 'waving',
  right: 'running-right',
  left: 'running-left',
});

/** 瞬态动画的默认停留时长（毫秒）。 */
export const TRANSIENT_MS = Object.freeze({
  jumping: 2600,
  failed: 3200,
  review: 1500,
  waving: 2800, // 2600ms 单次动作 + 宿主下发余量，确保收手完整
});

/**
 * 创建一个状态机。
 * @param {{ now?: () => number }} [options] 时间源（便于测试注入）
 */
export function createPetState(options = {}) {
  const now = options.now ?? (() => Date.now());

  let base = ANIMATIONS.idle;
  let transient = null;
  let transientUntil = 0;

  /** 当前应播放的动画。 */
  function current() {
    if (transient !== null && now() < transientUntil) return transient;
    if (transient !== null && now() >= transientUntil) {
      transient = null;
      transientUntil = 0;
    }
    return base;
  }

  /**
   * 设置基态。
   *
   * 同时取消正在播放的瞬态：新的基态意味着「情况变了」——例如工具刚返回时
   * 正在播 review，紧接着就来了一条审批请求，此时必须立刻切到 waiting，
   * 而不是等 review 播完。
   */
  function setBase(next) {
    base = next;
    transient = null;
    transientUntil = 0;
  }

  /** 播放一次瞬态动画。 */
  function play(next, ms = TRANSIENT_MS[next] ?? 2000) {
    transient = next;
    transientUntil = now() + ms;
  }

  /**
   * 应用一条归一化信号。
   * @param {string} signal 见 SIGNALS
   */
  function apply(signal) {
    switch (signal) {
      case 'turn-start':
        setBase(ANIMATIONS.running);
        break;
      case 'tool-call':
        setBase(ANIMATIONS.running);
        break;
      case 'tool-result':
        setBase(ANIMATIONS.running);
        play(ANIMATIONS.review);
        break;
      case 'waiting':
        setBase(ANIMATIONS.waiting);
        break;
      case 'turn-completed':
        setBase(ANIMATIONS.idle);
        play(ANIMATIONS.jumping);
        break;
      case 'turn-aborted':
        setBase(ANIMATIONS.idle);
        break;
      case 'error':
        setBase(ANIMATIONS.idle);
        play(ANIMATIONS.failed);
        break;
      case 'greeting':
        play(ANIMATIONS.waving);
        break;
      case 'busy':
        setBase(ANIMATIONS.running);
        break;
      case 'rest':
        setBase(ANIMATIONS.idle);
        break;
      default:
        return false;
    }
    return true;
  }

  /**
   * 距离下一次状态自然变化还有多少毫秒。
   * 宿主据此安排一次补发：瞬态播放结束后必须主动回落，否则窗口会一直停在
   * 「完成 / 出错」的姿态上。
   * @returns {number | null} 无待变化时返回 null
   */
  function nextTransitionIn() {
    if (transient === null) return null;
    return Math.max(0, transientUntil - now()) + 16;
  }

  return { apply, current, setBase, play, nextTransitionIn, snapshot: () => ({ base, transient }) };
}

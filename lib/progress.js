/**
 * 从原始推理流里提炼「当前在做什么」的一句话。
 *
 * 为什么需要这一层：Codex 桌面端的气泡直接消费一个**结构化进度事件流**
 * （`cot-v5-progress`，每条已经是一条归纳好的短句，形如「正在读取配置文件」）。
 * DSH 没有这种东西 —— 它只暴露**原始推理 token 流**（`reasoning-delta`），
 * 又长又碎还夹着大量内心独白。所以「推理流 → 进度句」这一层必须自己补上。
 *
 * 做法是纯启发式，不引入任何模型调用：
 *
 *   1. 累积 delta
 *   2. 按句边界切分，取**最后一个完整句子**（最新的进展）
 *   3. 清掉 markdown 记号与句首元叙述（「让我」「好的」「首先」…）
 *   4. 按**显示宽度**截断（CJK 算 2、拉丁算 1），保证中英混排都能放进气泡
 *   5. 只有结果**变化**时才返回 —— 这是 Codex 用 `fallbackText`/`progress.id`
 *      判断内容变化的等价物，避免同一句话被反复推
 *
 * @module dsh-deskpet/progress
 */

/** 句子终止符。中文标点与换行；英文句点要求跟空白，免得把文件名和小数切开。 */
const TERMINATOR_SOURCE = '[。！？；\\n]|\\.\\s';

const TERMINATOR = new RegExp(TERMINATOR_SOURCE, 'g');
const TERMINATOR_SPLIT = new RegExp(`(?:${TERMINATOR_SOURCE})`);

/** 句首的元叙述。去掉之后更像「进度」而不是「内心独白」。 */
const META_OPENERS = [
  '让我先', '让我来', '让我', '我来', '我先', '我需要先', '我需要', '我得', '我们要',
  '首先', '其次', '接下来', '然后', '现在', '那么', '所以', '因此',
  '不过', '但是', '另外', '总之', '其实', '等等', '好的', '好吧', '嗯',
  'let me first', 'let me', 'i need to', 'i should', 'i will',
  'first', 'next', 'then', 'now', 'so', 'okay', 'ok', 'wait', 'hmm', 'well',
]
  // 长的先试：否则「让我」会先命中，把「让我先」拆坏
  .sort((a, b) => b.length - a.length);

/**
 * 去掉元叙述后至少还要剩这么多字，否则宁可保留原句。
 * 定成 4 是因为中文里 4 个字已经能承载一个完整意思（「检查渲染层」），
 * 而 6 会把这类短句误判成"削没了"从而放弃清理。
 */
const MIN_REMAINDER = 4;

/** 全角/宽字符判定（CJK、假名、韩文、全角标点等）。 */
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/**
 * 粗略显示宽度：宽字符算 2，其余算 1。
 * 气泡宽度是固定的像素值，按字符数截断会让中文溢出、让英文过短。
 * @param {string} text
 * @returns {number}
 */
export function displayWidth(text) {
  let width = 0;
  for (const character of text) width += WIDE.test(character) ? 2 : 1;
  return width;
}

/** 按显示宽度截断，超长时补省略号（省略号本身也占宽度）。 */
function truncateToWidth(text, maxWidth) {
  if (displayWidth(text) <= maxWidth) return text;

  let width = 0;
  let out = '';
  for (const character of text) {
    const size = WIDE.test(character) ? 2 : 1;
    if (width + size > maxWidth - 1) break; // 留 1 个单位给省略号
    width += size;
    out += character;
  }
  return `${out}…`;
}

/** 去掉句首元叙述；去完太短就退回原句，免得把内容削没了。 */
function stripLeadingMeta(text) {
  for (const opener of META_OPENERS) {
    if (!text.toLowerCase().startsWith(opener)) continue;
    const rest = text.slice(opener.length).replace(/^[\s，,、：:.]+/u, '');
    if (rest.length >= MIN_REMAINDER) return rest;
  }
  return text;
}

/** 清掉 markdown 记号与首尾空白。 */
function cleanSentence(sentence) {
  return sentence
    .replace(/[*_`~]/g, '')
    .replace(/^[\s>#\-–—•·]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const DEFAULT_MAX_WIDTH = 44;

/**
 * 建一个进度提取器。
 *
 * @param {object} [options]
 * @param {number} [options.maxWidth] 最大显示宽度（默认 44，约等于 22 个汉字）
 * @param {boolean} [options.stripMeta] 是否去掉句首元叙述（默认开）
 */
export function createProgressExtractor({ maxWidth = DEFAULT_MAX_WIDTH, stripMeta = true } = {}) {
  let buffer = '';
  let current = null;

  /** 取出缓冲区里最后一个完整句子；没有则返回 null。 */
  function takeLastComplete() {
    let lastIndex = -1;
    let lastLength = 0;
    TERMINATOR.lastIndex = 0;
    let match;
    while ((match = TERMINATOR.exec(buffer)) !== null) {
      lastIndex = match.index;
      lastLength = match[0].length;
    }
    if (lastIndex < 0) return null;

    const head = buffer.slice(0, lastIndex + lastLength);
    buffer = buffer.slice(lastIndex + lastLength);

    const sentences = head.split(TERMINATOR_SPLIT).map((part) => part.trim()).filter(Boolean);
    return sentences.length > 0 ? sentences[sentences.length - 1] : null;
  }

  /** 规范化 + 截断；结果为空则返回 null。 */
  function finalize(sentence) {
    let text = cleanSentence(sentence);
    if (stripMeta) text = stripLeadingMeta(text);
    if (text === '') return null;
    return truncateToWidth(text, maxWidth);
  }

  return {
    /**
     * 喂一段推理 delta。
     * @param {string} delta
     * @returns {string | null} 产生了**新的**进度句时返回它，否则 null
     */
    push(delta) {
      if (typeof delta !== 'string' || delta === '') return null;
      buffer += delta;

      let candidate = takeLastComplete();

      // 有些模型不爱用标点。缓冲区涨到两倍上限还没句号时也要推进，
      // 否则气泡会一直卡在上一句。
      if (candidate === null && displayWidth(buffer) >= maxWidth * 2) {
        candidate = buffer.slice(-maxWidth);
        buffer = '';
      }
      if (candidate === null) return null;

      const line = finalize(candidate);
      if (line === null || line === current) return null;
      current = line;
      return line;
    },

    /** 换回合/换阶段时清空，避免上一轮的尾巴混进来。 */
    reset() {
      buffer = '';
      current = null;
    },

    /** 当前已展示的进度句。 */
    get current() {
      return current;
    },
  };
}

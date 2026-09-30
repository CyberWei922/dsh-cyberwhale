/**
 * 任务状态文案：把 DSH 的「步骤过程」状态复现出来给桌宠用。
 *
 * 为什么要有这个模块：桌宠气泡原来显示的是**模型在想什么**（reasoning 逐句摘出），
 * 但用户真正想一眼看到的是**它现在在干什么** —— 也就是聊天区里那行灰字：
 *
 *   正在分析请求 / 准备运行命令 / 正在运行命令 · npm test
 *
 * 这些文案是 DSH 前端的 i18n 词典（`message.stepProcess.*`）。**这里不读词典、
 * 也不爬前端** —— 状态本身可以从宿主已经收到的事件完整重算出来：
 *
 *   · `tool/call` 的 `data.name`            → 类别（activityKind）
 *   · `tool/call` 的 `data.arguments`       → 细节（extractDetail）
 *   · `tool/call` 到达                      → phase "running"
 *   · assistant 流的 `tool-call-delta` 带 name → phase "preparing"
 *   · `tool/result`                         → 回到 thinking
 *
 * 词表与映射表都是从 DSH 实现里逐个核对抄来的，不是猜的。
 *
 * @module dsh-cyberwhale/activity
 */

/**
 * 状态词表。键是 DSH 的 activity kind，值是三个阶段的文案。
 *
 * `preparing` 为 null 表示 DSH 词典里没有这一项（只有 thinking 没有 prepare）。
 */
export const STATUS_LABELS = Object.freeze({
  thinking: { running: '正在分析请求', preparing: null, done: '已完成分析' },
  read: { running: '正在读取文件', preparing: '准备读取文件', done: '已读取文件' },
  readImage: { running: '正在读取图片', preparing: '准备读取图片', done: '已读取图片' },
  write: { running: '正在写入文件', preparing: '准备写入文件', done: '已写入文件' },
  search: { running: '正在搜索代码', preparing: '准备搜索代码', done: '已搜索代码' },
  edit: { running: '正在编辑文件', preparing: '准备编辑文件', done: '修改了文件' },
  commands: { running: '正在运行命令', preparing: '准备运行命令', done: '执行了命令' },
  code: { running: '正在运行代码', preparing: '准备运行代码', done: '运行了代码' },
  webSearch: { running: '正在搜索网页', preparing: '准备搜索网页', done: '已搜索网页' },
  webFetch: { running: '正在访问网页', preparing: '准备访问网页', done: '已访问网页' },
  subagents: { running: '正在协调子智能体', preparing: '准备协调子智能体', done: '已协调子智能体' },
  plan: { running: '正在更新计划', preparing: '准备更新计划', done: '更新了计划' },
  questions: { running: '等待你的操作', preparing: '准备提问', done: '向用户提出了问题' },
  tools: { running: '正在调用工具', preparing: '准备调用工具', done: '已调用工具' },
});

/** 拿不到具体类别时的兜底。 */
export const DEFAULT_KIND = 'thinking';

/**
 * 把所有工具名映射到状态类别。
 *
 * 这份映射是逐条对照 DSH 的 `activity()` 抄的 —— 顺序有意义
 * （`read_image` 必须在 `read` 之类的前面判断，这里用精确匹配所以无妨，
 * 但 `*_inspect` / `terminal_*` / `subagent_*` 是前缀匹配）。
 *
 * @param name - 工具名，可能为空。
 * @returns 状态类别。
 */
export function activityKind(name) {
  if (typeof name !== 'string' || name === '') return DEFAULT_KIND;
  if (name === 'read') return 'read';
  if (name === 'read_image') return 'readImage';
  if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) return 'search';
  if (name === 'write') return 'write';
  if (name === 'edit' || name === 'apply_patch') return 'edit';
  if (['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(name) || name.startsWith('terminal_')) {
    return 'commands';
  }
  if (name === 'run_code') return 'code';
  if (name === 'web_search') return 'webSearch';
  if (name === 'web_fetch') return 'webFetch';
  if (name === 'subagent' || name.startsWith('subagent_')) return 'subagents';
  if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(name)) return 'plan';
  if (name === 'ask_user_question' || name === 'request_user_input') return 'questions';
  return 'tools';
}

/**
 * 从工具参数里挑一个能当「细节」的值。
 *
 * 键序抄自 DSH 的 `LIVE_TOOL_DETAIL_KEYS` —— 注意是**顺序敏感**的：
 * 先看 title，再看 command，最后才看 path。换个顺序显示的东西就不一样了。
 */
const DETAIL_KEYS = Object.freeze([
  'title',
  'description',
  'objective',
  'task',
  'task_name',
  'name',
  'question',
  'questions',
  'prompt',
  'message',
  'command',
  'cmd',
  'queries',
  'query',
  'pattern',
  'url',
  'uri',
  'file_path',
  'path',
  'target',
  'action',
  'status',
]);

/** 细节的最大显示宽度（CJK 算 2）。比 DSH 的 160 字符短，因为气泡窄。 */
export const DEFAULT_DETAIL_WIDTH = 40;

/** 按显示宽度量一个字符串：CJK 与全角算 2，其余算 1。 */
export function displayWidth(text) {
  let width = 0;
  for (const character of String(text)) {
    const code = character.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

/** 按显示宽度截断，超出时补省略号。 */
export function truncateToWidth(text, maxWidth) {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  let out = '';
  let width = 0;
  for (const character of String(text)) {
    const next = width + displayWidth(character);
    if (next > maxWidth - 1) break;
    out += character;
    width = next;
  }
  return `${out}…`;
}

/** 把任意值压成一行紧凑文本。 */
function normalize(value) {
  if (typeof value === 'string') return value.replace(/\s+/gu, ' ').trim();
  if (Array.isArray(value)) {
    // questions 这类是对象数组：取第一个问题
    for (const item of value) {
      if (item === null || typeof item !== 'object') continue;
      const inner = item.question ?? item.prompt ?? item.title;
      if (typeof inner === 'string' && inner.trim() !== '') return normalize(inner);
    }
    if (value.every((item) => typeof item === 'string')) return normalize(value.join(', '));
  }
  return '';
}

/**
 * 从工具参数的 JSON 原文里取细节。
 *
 * @param argumentsRaw - `tool/call` 的 `data.arguments`（JSON 字符串）。
 * @param maxWidth - 最大显示宽度。
 * @returns 细节文本；取不到时返回空串。
 */
export function extractDetail(argumentsRaw, maxWidth = DEFAULT_DETAIL_WIDTH) {
  if (typeof argumentsRaw !== 'string' || argumentsRaw === '') return '';
  let parsed;
  try {
    parsed = JSON.parse(argumentsRaw);
  } catch {
    return ''; // 参数被打断时不是合法 JSON，宁可留空也不要显示半截
  }
  if (parsed === null || typeof parsed !== 'object') return '';
  for (const key of DETAIL_KEYS) {
    if (!(key in parsed)) continue;
    const detail = normalize(Reflect.get(parsed, key));
    if (detail !== '') return truncateToWidth(detail, maxWidth);
  }
  return '';
}

/**
 * 拼出第 2 行的完整文案：`正在运行命令 · npm test`。
 *
 * @param kind - 状态类别。
 * @param preparing - 是否处于「准备」阶段。
 * @param detail - 细节，可空。
 */
export function statusLine(kind, preparing, detail = '') {
  const labels = STATUS_LABELS[kind] ?? STATUS_LABELS[DEFAULT_KIND];
  const label = (preparing && labels.preparing !== null ? labels.preparing : labels.running) ?? labels.running;
  return detail === '' ? label : `${label} · ${detail}`;
}

/**
 * 任务状态跟踪器。
 *
 * 存的是「当前应该显示什么」，不负责节流 —— 节流交给调用方，
 * 因为状态变化本身是离散事件（工具开始/结束），不是文本流。
 *
 * @param options - `maxDetailWidth` 控制细节截断宽度。
 */
export function createStatusTracker({ maxDetailWidth = DEFAULT_DETAIL_WIDTH } = {}) {
  let title = '';
  let kind = DEFAULT_KIND;
  let preparing = false;
  let detail = '';
  let active = false;

  /**
   * 当前快照。
   *
   * 不活跃时 `status` 直接是空串（而不是「正在分析请求」）—— 调用方据此把实时层
   * 留空、回落到待机碎碎念。让状态自己表达清楚，比让每个调用方都记得先看
   * `active` 更不容易出错。
   */
  function snapshot() {
    return {
      title,
      kind,
      preparing,
      detail,
      active,
      status: active ? statusLine(kind, preparing, detail) : '',
    };
  }

  return {
    snapshot,

    /** 会话标题（`session/title` 事件）。 */
    setTitle(value) {
      title = typeof value === 'string' ? value : '';
    },

    get title() {
      return title;
    },

    /** 一轮开始：进入「正在分析请求」。 */
    beginTurn() {
      active = true;
      kind = DEFAULT_KIND;
      preparing = false;
      detail = '';
    },

    /**
     * assistant 流里出现了带名字的 tool-call-delta —— 这是「准备…」阶段。
     *
     * 和 `tool/call` 的区别很重要：模型刚开始吐工具名时参数还没传完，
     * DSH 这时显示的是「准备运行命令」，等 `tool/call` 到了才变「正在运行命令」。
     */
    prepare(toolName) {
      active = true;
      kind = activityKind(toolName);
      preparing = true;
      detail = '';
    },

    /** `tool/call` 到达：进入「正在…」阶段，并取出细节。 */
    run(toolName, argumentsRaw) {
      active = true;
      kind = activityKind(toolName);
      preparing = false;
      detail = extractDetail(argumentsRaw, maxDetailWidth);
    },

    /**
     * `tool/result` 到达。
     *
     * 不显示 `done.*` 文案：DSH 的实时状态在工具结束后会回落到「正在分析请求」
     * （模型接着读结果），桌宠跟着回落才不会来回跳。
     */
    finishTool() {
      if (!active) return;
      kind = DEFAULT_KIND;
      preparing = false;
      detail = '';
    },

    /** 一轮结束：清空，让实时层空着回落到碎碎念。 */
    endTurn() {
      active = false;
      kind = DEFAULT_KIND;
      preparing = false;
      detail = '';
    },
  };
}

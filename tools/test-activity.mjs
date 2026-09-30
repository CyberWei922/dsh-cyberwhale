#!/usr/bin/env node
/**
 * 任务状态文案的测试（lib/activity.js）。
 *
 * 这一层替代了原来的「推理流 → 进度句」气泡。它显示的是 DSH 聊天区那行灰字
 * （正在分析请求 / 准备运行命令 / 正在运行命令 · npm test），
 * 词表与工具名映射都是从 DSH 实现里逐条核对抄来的。
 *
 * 所以这里的断言分两类：
 *   1. **契约**：词表必须与 DSH 的 i18n 词典逐字一致 —— 抄错一个字就穿帮；
 *   2. **行为**：状态机在事件序列下产出正确的两行。
 *
 * 运行：node tools/test-activity.mjs
 *
 * @module tools/test-activity
 */

import { readFile } from 'node:fs/promises';

import {
  DEFAULT_KIND,
  STATUS_LABELS,
  activityKind,
  createStatusTracker,
  displayWidth,
  extractDetail,
  statusLine,
  truncateToWidth,
} from '../lib/activity.js';

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

// ── 词表必须与 DSH 词典逐字一致 ───────────────────────────────────────────
console.log('\n[1] 词表与 DSH 的 message.stepProcess.* 词典一致');
{
  // 从 DSH 的 app.asar 里现读词典做对照 —— 这样"抄错字"会被直接抓到。
  // 读不到就跳过（换机器/换版本时不该让测试红掉）。
  const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
  let dictionary = null;
  try {
    // 必须按 Buffer 定位、再按 UTF-8 解码。
    // 用 latin1 把整个 asar 读成字符串会把中文全变成乱码，然后逐字对照就全是"不一致"。
    const buffer = await readFile(ASAR);
    const marker = Buffer.from('"message.stepProcess.prepare.read"', 'utf8');
    const at = buffer.indexOf(marker);
    if (at >= 0) {
      const segment = buffer.subarray(Math.max(0, at - 2000), at + 3000).toString('utf8');
      dictionary = new Map();
      for (const match of segment.matchAll(/"message\.stepProcess\.([A-Za-z.]+)":\s*"([^"]*)"/g)) {
        dictionary.set(match[1], match[2]);
      }
    }
  } catch {
    dictionary = null;
  }

  if (dictionary === null) {
    console.log('  · 读不到 DSH 词典（非本机或版本不同），跳过逐字对照');
  } else {
    let mismatches = 0;
    for (const [kind, labels] of Object.entries(STATUS_LABELS)) {
      const cases = [
        [kind, labels.running],
        [`prepare.${kind}`, labels.preparing],
        [`done.${kind}`, labels.done],
      ];
      for (const [key, value] of cases) {
        if (value === null) {
          // 模块里标 null 表示"DSH 也没有这一项"
          if (dictionary.has(key)) {
            mismatches += 1;
            console.log(`      词典里有 ${key}=${dictionary.get(key)}，模块却标成 null`);
          }
          continue;
        }
        if (dictionary.get(key) !== value) {
          mismatches += 1;
          console.log(`      ${key}：词典 ${JSON.stringify(dictionary.get(key))} vs 模块 ${JSON.stringify(value)}`);
        }
      }
    }
    check('全部 14 个类别 × 3 个阶段都与 DSH 词典逐字一致', mismatches, 0);
    check('词表覆盖 thinking（唯一没有 prepare 的类别）', STATUS_LABELS.thinking.preparing, null);
  }
}

// ── 工具名 → 类别 ─────────────────────────────────────────────────────────
console.log('\n[2] activityKind：工具名 → 状态类别（逐条对照 DSH 的 activity()）');
{
  const cases = [
    ['read', 'read'],
    ['read_image', 'readImage'],
    ['grep', 'search'],
    ['glob', 'search'],
    ['code_inspect', 'search'],
    ['write', 'write'],
    ['edit', 'edit'],
    ['apply_patch', 'edit'],
    ['bash', 'commands'],
    ['pwsh', 'commands'],
    ['exec_command', 'commands'],
    ['write_stdin', 'commands'],
    ['terminal_send', 'commands'],
    ['run_code', 'code'],
    ['web_search', 'webSearch'],
    ['web_fetch', 'webFetch'],
    ['subagent', 'subagents'],
    ['subagent_start', 'subagents'],
    ['todo_write', 'plan'],
    ['create_goal', 'plan'],
    ['update_goal', 'plan'],
    ['get_goal', 'plan'],
    ['ask_user_question', 'questions'],
    ['request_user_input', 'questions'],
    ['read_file_sync', 'tools'],
    ['', DEFAULT_KIND],
    [undefined, DEFAULT_KIND],
    [null, DEFAULT_KIND],
  ];
  for (const [name, expected] of cases) {
    check(`${JSON.stringify(name)} → ${expected}`, activityKind(name), expected);
  }
  check('每个映射结果都在词表里', cases.every(([, kind]) => kind in STATUS_LABELS), true);
}

// ── 细节提取 ──────────────────────────────────────────────────────────────
console.log('\n[3] extractDetail：从工具参数里取「· 后面那截」');
{
  check('command 优先于 path', extractDetail('{"path":"/a","command":"npm test"}'), 'npm test');
  check('title 优先于 command', extractDetail('{"command":"ls","title":"跑测试"}'), '跑测试');
  check('file_path 也能取到', extractDetail('{"file_path":"src/pet.js"}'), 'src/pet.js');
  check('query 取到', extractDetail('{"query":"clamp 用法"}'), 'clamp 用法');
  check('url 取到', extractDetail('{"url":"https://example.com"}'), 'https://example.com');
  check('空白折叠成单空格', extractDetail('{"command":"npm   test\\n--watch"}'), 'npm test --watch');
  check('非 JSON 时留空（不显示半截）', extractDetail('{"command":"npm te'), '');
  check('非字符串参数忽略', extractDetail('{"command":123}'), '');
  check('空对象留空', extractDetail('{}'), '');
  check('非对象留空', extractDetail('"npm test"'), '');
  check('questions 数组取第一个问题', extractDetail('{"questions":[{"question":"要用哪个方案？"}]}'), '要用哪个方案？');
  check('字符串数组拼接', extractDetail('{"queries":["a","b"]}'), 'a, b');
  check('超宽截断并补省略号', extractDetail('{"command":"abcdefghijklmnopqrstuvwxyz"}', 10), 'abcdefghi…');
  check('刚好等于上限时不截断', extractDetail('{"command":"abcde"}', 5), 'abcde');
}

console.log('\n[4] displayWidth / truncateToWidth（CJK 算 2）');
{
  check("displayWidth('abc') = 3", displayWidth('abc'), 3);
  check("displayWidth('读 read') = 7", displayWidth('读 read'), 7);
  check("displayWidth('正在运行命令') = 12", displayWidth('正在运行命令'), 12);
  check('truncate 到 4 宽度补省略号', truncateToWidth('正在运行命令', 4), '正…');
  check('未超宽原样返回', truncateToWidth('abc', 10), 'abc');
  check('宽度 0 返回空串', truncateToWidth('abc', 0), '');
}

// ── 第二行拼接 ────────────────────────────────────────────────────────────
console.log('\n[5] statusLine：第二行的文案');
{
  check('有细节时用「 · 」连接', statusLine('commands', false, 'npm test'), '正在运行命令 · npm test');
  check('无细节时不加分隔符', statusLine('commands', false, ''), '正在运行命令');
  check('preparing 用「准备…」', statusLine('commands', true, ''), '准备运行命令');
  check('preparing 时也带细节', statusLine('read', true, 'src/pet.js'), '准备读取文件 · src/pet.js');
  check('thinking 没有 preparing 变体，回落 running', statusLine('thinking', true, ''), '正在分析请求');
  check('未知类别兜底成 thinking', statusLine('nope', false, ''), '正在分析请求');
}

// ── 状态机 ────────────────────────────────────────────────────────────────
console.log('\n[6] createStatusTracker：事件序列下的两行');
{
  const tracker = createStatusTracker();

  check('初始不活跃（气泡该显示碎碎念）', tracker.snapshot().active, false);
  check('初始第二行为空', tracker.snapshot().status, '');

  tracker.setTitle('重制任务书');
  check('标题可单独设置', tracker.snapshot().title, '重制任务书');

  tracker.beginTurn();
  check('一轮开始 → 正在分析请求', tracker.snapshot().status, '正在分析请求');
  check('一轮开始 → 活跃', tracker.snapshot().active, true);
  check('标题保留', tracker.snapshot().title, '重制任务书');

  // 模型刚开始吐工具名：参数还没传完
  tracker.prepare('bash');
  check('tool-call-delta → 准备运行命令', tracker.snapshot().status, '准备运行命令');
  check('preparing 标志置上', tracker.snapshot().preparing, true);
  check('准备阶段还没细节', tracker.snapshot().detail, '');

  // tool/call 到了：参数完整
  tracker.run('bash', '{"command":"npm test"}');
  check('tool/call → 正在运行命令 · npm test', tracker.snapshot().status, '正在运行命令 · npm test');
  check('preparing 标志落下', tracker.snapshot().preparing, false);

  // 换个工具
  tracker.run('read', '{"file_path":"src/pet.js"}');
  check('换工具 → 正在读取文件 · src/pet.js', tracker.snapshot().status, '正在读取文件 · src/pet.js');

  tracker.finishTool();
  check('tool/result → 回落到正在分析请求', tracker.snapshot().status, '正在分析请求');
  check('细节被清掉', tracker.snapshot().detail, '');

  tracker.endTurn();
  check('一轮结束 → 不活跃', tracker.snapshot().active, false);
  check('一轮结束 → 第二行为空（回落碎碎念）', tracker.snapshot().status, '');
  check('一轮结束仍保留标题', tracker.snapshot().title, '重制任务书');
}

console.log('\n[7] 状态机的边界');
{
  const tracker = createStatusTracker({ maxDetailWidth: 12 });
  tracker.setTitle('x');
  tracker.run('grep', '{"pattern":"abcdefghijklmnop"}');
  check('细节按构造时的宽度截断', tracker.snapshot().detail, 'abcdefghijk…');

  const idle = createStatusTracker();
  idle.finishTool();
  check('未开始一轮时 finishTool 不应把状态变成活跃', idle.snapshot().active, false);

  const brokenJson = createStatusTracker();
  brokenJson.beginTurn();
  brokenJson.run('bash', '{"command":');
  check('参数不是合法 JSON 时细节留空', brokenJson.snapshot().detail, '');
  check('但状态类别仍然正确', brokenJson.snapshot().status, '正在运行命令');

  const noName = createStatusTracker();
  noName.beginTurn();
  noName.run(undefined, '{"command":"ls"}');
  check('工具名缺失时兜底成 thinking', noName.snapshot().kind, DEFAULT_KIND);

  const cleared = createStatusTracker();
  cleared.setTitle('标题');
  cleared.setTitle(undefined);
  check('标题被清成空串时不炸', cleared.snapshot().title, '');
}

console.log(`\n结果：${passed} 通过 / ${failures.length} 失败`);
if (failures.length > 0) process.exitCode = 1;

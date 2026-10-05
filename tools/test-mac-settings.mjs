import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * 设置面板 macOS 观感的锚点检查。
 *
 * 默认（快速）：检查我们自己的 CSS、运行时开关与构建产物 —— 防止锚点被误删、
 * 防止选择器漏掉作用域门而把样式泄漏到全应用。
 *
 * `--official`（慢）：扫描**已安装的官方客户端**，确认我们依赖的官方语义锚点还在。
 * 这是给「Harness 升级之后」用的：升级完跑一次，某个锚点被官方改掉就会报红，
 * 而不是等到几个月后发现面板变回原样。官方客户端不存在时跳过，不算失败。
 *
 *   node tools/test-mac-settings.mjs              # 快速契约检查
 *   node tools/test-mac-settings.mjs --official   # 追加官方锚点扫描
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { passed++; return; }
  failures.push(`${name}${detail ? ` —— ${detail}` : ''}`);
}

// 只看声明：注释里会举官方类名当反例，不该被当成「用了哈希类名」。
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(await readFile(join(root, 'client', 'settings-css.js'), 'utf8'));
const runtime = await readFile(join(root, 'client', 'appearance-runtime.js'), 'utf8');
const bundle = await readFile(join(root, 'lib', 'client.js'), 'utf8');

// ── 1. 语义锚点必须在，且都必须能用 ────────────────────────────────
const anchors = [
  ['面板根属性', 'data-shortcut-modal="settings"'],
  ['左侧导航列（原生 nav）', '> nav'],
  ['右侧内容列（nav 的相邻兄弟）', '> nav + div'],
  ['选中的导航项', 'nav button[aria-current="true"]'],
  ['开关基元', '[role="switch"]'],
  ['开关状态写在 aria-checked 上', '[aria-checked="true"]'],
  ['字段标签', 'label'],
];
for (const [label, anchor] of anchors) check(`CSS 含锚点：${label}`, css.includes(anchor), anchor);

// ── 2. 不得依赖 CSS Module 哈希类名 ────────────────────────────────
// 官方类名形如 `Dws9Sa_nav`：哈希前缀每次构建都变，一旦写进选择器就会当场失效。
const hashedClass = [...css.matchAll(/\.[A-Za-z0-9_-]{6,}_[A-Za-z][A-Za-z0-9]*/g)].map(m => m[0]);
check('CSS 不含官方哈希类名', hashedClass.length === 0, hashedClass.join(', '));

// ── 3. 作用域门：每条设置面板规则都必须挂在 body 属性下 ──────────────
// 否则样式会落到全应用的同类元素上，而不是只作用于这个模态框。
const ungated = css.split('\n').filter(line => /^\s*\[data-shortcut-modal=/.test(line));
check('每条面板规则都带作用域门', ungated.length === 0, ungated.join(' | ').slice(0, 160));

// ── 4. 左右分界确实是「面板让出背景 + 两列各自负责」 ──────────────────
check('面板本体让出背景', /\[data-shortcut-modal="settings"\][^{]*\{[^}]*background:transparent/.test(css));
check('左列用 backdrop-filter 磨砂', />\s*nav\s*\{[^}]*backdrop-filter:blur\(/.test(css));
check('右列保持不透明', />\s*nav\s*\+\s*div\s*\{[^}]*background:var\(--dsw-alias-bg-layer-2\)/.test(css));

// 遮罩不做全屏模糊：面板直接浮现在应用内容上，这是明确要求过的行为。
check('遮罩没有全屏模糊', !/:has\(>\s*\[data-shortcut-modal[^{]*\{[^}]*backdrop-filter/.test(css));

// 选中项必须是「主题强调色填充 + 反色前景」，两个颜色都取自主题派生的 token。
check('选中项用强调色填充', /nav button\[aria-current="true"\]\s*\{[^}]*background:var\(--dsw-alias-brand-primary\)/.test(css));
check('选中项用反色前景', /nav button\[aria-current="true"\]\s*\{[^}]*color:var\(--dsw-alias-label-primary-foreground\)/.test(css));

// ── 5. macOS 开关：只改形状，颜色一律交给主题 ─────────────────────────
// 官方 36×20 / 内缩 2 / 滑块 16 / 开启态 translateX(16)。我们改成
// 31×14 / 内缩 1.5 / 滑块 11，行程变成 17，所以必须同步覆盖 translateX。
// 这里连颜色一起守住：形状规则里出现任何颜色声明就说明主题色被写死了。
const switchBlock = /\[role="switch"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
const width = Number(/width:([\d.]+)px/.exec(switchBlock)?.[1]);
const height = Number(/height:([\d.]+)px/.exec(switchBlock)?.[1]);
const padding = Number(/padding:([\d.]+)px/.exec(switchBlock)?.[1]);
const thumb = Number(/\[role="switch"\]\s*>\s*span\s*\{[^}]*width:([\d.]+)px/.exec(css)?.[1]);
const travel = Number(/\[aria-checked="true"\]\s*>\s*span\s*\{[^}]*translateX\(([\d.]+)px\)/.exec(css)?.[1]);
check('开关几何取到了值', [width, height, padding, thumb, travel].every(Number.isFinite),
  `${width}/${height}/${padding}/${thumb}/${travel}`);
check('开关行程与覆盖的 translateX 一致', width - 2 * padding - thumb === travel,
  `轨道 ${width} - 内缩 ${padding}*2 - 滑块 ${thumb} = ${width - 2 * padding - thumb}，translateX ${travel}`);
check('开关比例贴近 macOS（宽高比约 2.25）', Math.abs(width / height - 2.25) < 0.1, `${(width / height).toFixed(2)}`);
check('开关形状规则里不写颜色（开启态主题色由官方 token 提供）',
  !/(?:^|;|\s)(?:background|background-color|color)\s*:/.test(switchBlock) && !/#[0-9a-fA-F]{3,8}/.test(switchBlock),
  switchBlock.trim().slice(0, 120));

// ── 6. 降级规则：降低透明度与不支持 backdrop-filter 时都要回落实色 ──────
check('含 prefers-reduced-transparency 回退', css.includes('prefers-reduced-transparency:reduce'));
check('含 backdrop-filter 不支持时的回退', css.includes('@supports not (backdrop-filter:blur(1px))'));

// ── 7. 运行时开关：跟随美化总开关，并在降低透明度时回落到官方原样 ───────
check('运行时切换 data-whale-mac-settings', runtime.includes("toggleAttribute('data-whale-mac-settings'"));
check('开关门控为 enabled 且非降低透明度', /toggleAttribute\('data-whale-mac-settings',\s*!!\(config\?\.enabled && !reduced\)\)/.test(runtime));
check('释放时移除该属性', /removeAttribute\('data-whale-mac-settings'\)/.test(runtime));

// ── 8. 构建产物确实带上了这份 CSS ─────────────────────────────────
check('产物含 data-whale-mac-settings', bundle.includes('data-whale-mac-settings'));
check('产物含面板锚点', bundle.includes('data-shortcut-modal='));
check('产物含开关锚点', bundle.includes('[role=&quot;switch&quot;]') || bundle.includes('[role="switch"]'));

// ── 9.（可选）官方客户端锚点扫描 ──────────────────────────────────
const officialCandidates = [
  process.env.DSH_APP_ASAR,
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar',
].filter(Boolean);

async function locateOfficial() {
  for (const candidate of officialCandidates) {
    try { await access(candidate); const info = await stat(candidate); if (info.isFile()) return candidate; } catch { /* 换下一个 */ }
  }
  return null;
}

async function scan(file, needles) {
  const size = (await stat(file)).size;
  const stream = createReadStream(file, { highWaterMark: 8 * 1024 * 1024 });
  const found = new Map(needles.map(needle => [needle, false]));
  let carry = '';
  for await (const chunk of stream) {
    const text = carry + chunk.toString('binary');
    for (const needle of needles) if (!found.get(needle) && text.includes(needle)) found.set(needle, true);
    carry = text.slice(-4096);
    if ([...found.values()].every(Boolean)) break;
  }
  return { found, size };
}

if (process.argv.includes('--official')) {
  const official = await locateOfficial();
  if (official === null) {
    console.log('（跳过官方锚点扫描：没有找到已安装的官方客户端，可用 DSH_APP_ASAR 指定 app.asar 路径）');
  } else {
    // 这些是设置面板 macOS 观感赖以成立的全部官方语义锚点。
    const needed = ['data-shortcut-modal', 'role: "switch"', 'aria-checked', 'aria-modal', 'data-platform=darwin'];
    const { found, size } = await scan(official, needed);
    console.log(`官方客户端：${official}（${(size / 1024 / 1024).toFixed(0)} MB）`);
    for (const needle of needed) {
      const ok = found.get(needle) === true;
      check(`官方仍提供锚点：${needle}`, ok, '官方可能改了结构，需要重新核对设置面板的选择器');
    }
  }
}

if (failures.length > 0) {
  console.error('\n失败项：');
  for (const line of failures) console.error('  ✗ ' + line);
}
console.log(`\n结果：${passed} 通过 / ${failures.length} 失败`);
process.exit(failures.length === 0 ? 0 : 1);

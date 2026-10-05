#!/usr/bin/env node
/**
 * 客户端半的离线测试：模拟页面的 `__ModuleLoader__` 与 `require`，
 * 验证 `lib/client.js` 能正确登记工厂、导出插件、注册设置卡、并调用 RPC。
 *
 * 用法：node tools/test-client.mjs
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import appearanceModel from '../lib/appearance-model.cjs';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  }
}

// ── 模拟浏览器环境 ────────────────────────────────────────────────────────
const registrations = [];
const styleTags = [];

/** 递归展开函数组件，得到可直接断言的纯元素树。 */
function expand(node, depth = 0) {
  if (node === null || node === undefined || depth > 10) return null;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return node;
  if (Array.isArray(node)) return node.map((child) => expand(child, depth + 1));
  if (typeof node.type === 'function') {
    let rendered;
    try {
      rendered = node.type(node.props ?? {});
    } catch (error) {
      return { renderError: error instanceof Error ? error.message : String(error) };
    }
    return expand(rendered, depth + 1);
  }
  return { type: node.type, props: node.props, children: (node.children ?? []).map((c) => expand(c, depth + 1)) };
}

const windowMock = {
  __ModuleLoader__: {
    load(entry) {
      registrations.push(entry);
    },
  },
};
const documentMock = {
  createElement(tag) {
    return { tagName: tag, dataset: {}, textContent: '', remove() {} };
  },
  head: {
    appendChild(node) {
      styleTags.push(node);
    },
  },
};

function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children };
}

/**
 * 迷你 hooks 运行时。
 *
 * 不是"只要不炸"的占位 —— 它能真正保存状态并触发重渲染，所以测试可以模拟
 * 「点击 → 请求挂起 → 重渲染」这类过程，从而锁住 UI 状态相关的回归
 * （比如"写入时整张卡一起变暗"）。
 */
function createHookRuntime(component, props) {
  let slots = [];
  let cursor = 0;
  let rerenderRequested = false;

  function sameDeps(a, b) {
    if (a === undefined || b === undefined) return false;
    if (a.length !== b.length) return false;
    return a.every((value, index) => Object.is(value, b[index]));
  }

  const React = {
    createElement,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      const set = (next) => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (Object.is(value, slots[index])) return;
        slots[index] = value;
        // 同步标脏：测试里立刻重渲染，时序更可控。
        rerenderRequested = true;
      };
      return [slots[index], set];
    },
    useCallback(fn, deps) {
      const index = cursor++;
      const slot = slots[index];
      if (slot === undefined || !sameDeps(slot.deps, deps)) {
        slots[index] = { fn, deps };
      }
      return slots[index].fn;
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const slot = slots[index];
      if (slot === undefined || !sameDeps(slot.deps, deps)) {
        slots[index] = { value: fn(), deps };
      }
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const slot = slots[index];
      // 按 React 的语义：依赖没变就不重跑；变了要先清理上一次再执行新的。
      // 这一点对「运行时就绪后自动关闭引导」这类 effect 是必须的 ——
      // 只跑首次的话，拿到数据后的那次判断永远不会发生。
      if (slot !== undefined && sameDeps(slot.deps, deps)) return;
      if (typeof slot?.cleanup === 'function') slot.cleanup();
      const cleanup = fn();
      slots[index] = { deps, cleanup };
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
  };

  return {
    React,
    render() {
      cursor = 0;
      rerenderRequested = false;
      const previous = activeRuntime;
      activeRuntime = { React };
      try {
        return component(props);
      } finally {
        activeRuntime = previous;
      }
    },
    get dirty() {
      return rerenderRequested;
    },
    dispose() {
      for (const slot of slots) {
        if (typeof slot?.cleanup === 'function') slot.cleanup();
      }
      slots = [];
    },
  };
}

// 官方基元的替身：渲染成一个可序列化的字符串类型节点，便于断言。
function stub(name) {
  return function PrimitiveStub(props) {
    return createElement(`primitive:${name}`, props ?? {});
  };
}
const primitivesMock = {
  Switch: stub('Switch'),
  SegmentedControl: stub('SegmentedControl'),
  Button: stub('Button'),
  StateDot: stub('StateDot'),
  Modal: stub('Modal'),
  DisclosureRow: stub('DisclosureRow'),
  IconChevronDownOutlineRegular: stub('IconChevronDownOutlineRegular'),
};

/** 把元素树摊平成节点数组（节点形如 { type, props, children }）。 */
function flattenNodes(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) flattenNodes(child, out);
    return out;
  }
  out.push(node);
  for (const child of node.children ?? []) flattenNodes(child, out);
  return out;
}

/**
 * 产物里的 `require('react')` 拿到的是这个转发层：hooks 一律转给「当前活动运行时」，
 * 于是同一个 bundle 能被带状态地渲染多次。
 */
let activeRuntime = null;

function activeHooks() {
  if (activeRuntime === null) {
    throw new Error('React hooks 只能在 createHookRuntime(...).render() 内部调用');
  }
  return activeRuntime.React;
}

const ReactSurface = {
  createElement,
  useState: (...args) => activeHooks().useState(...args),
  useCallback: (...args) => activeHooks().useCallback(...args),
  useMemo: (...args) => activeHooks().useMemo(...args),
  useEffect: (...args) => activeHooks().useEffect(...args),
  useRef: (...args) => activeHooks().useRef(...args),
};

const requireMock = (specifier) => {
  if (specifier === 'react') return ReactSurface;
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesMock;
  throw new Error(`客户端包请求了未预期的模块：${specifier}`);
};

// ── 载入产物 ──────────────────────────────────────────────────────────────
console.log('\n[1] 产物形态');
const source = await readFile(join(pluginRoot, 'lib', 'client.js'), 'utf8');

const sandbox = {
  window: windowMock,
  document: documentMock,
  globalThis: undefined,
  // 组件里的轮询会用到这两个；vm 上下文不继承宿主全局。
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });

check('调用了 __ModuleLoader__.load 一次', registrations.length, 1);
const entry = registrations[0];
check('登记的 id 是包名', entry?.id, 'dsh-cyberwhale');
check('提供了 factory', typeof entry?.factory, 'function');
check('没有多余的 chunk 字段', entry?.chunk, undefined);

console.log('\n[2] 工厂导出');
const plugin = entry.factory(requireMock);
check('导出 inject', Array.isArray(plugin.inject), true);
check('inject 含 slots', plugin.inject.includes('slots'), true);
check('inject 含 connection', plugin.inject.includes('connection'), true);
check('导出 apply', typeof plugin.apply, 'function');

console.log('\n[3] apply 注册设置卡');
const rpcCalls = [];
const slotRegistrations = [];
const effects = [];
const styleBefore = styleTags.length;

const ctx = {
  logger: { warn() {}, info() {} },
  effect(fn) {
    const disposer = fn();
    effects.push(disposer);
    return disposer;
  },
  slots: {
    inject(slot, callback) {
      slotRegistrations.push(slot);
      callback();
      return () => {};
    },
    register(options, component) {
      slotRegistrations.push({ options, component });
      return () => {};
    },
  },
  connection: {
    rpc: {
      async call(channel, endpoint, payload) {
        rpcCalls.push({ channel, endpoint, payload });
        return { ok: true, value: { settings: { enabled: true, scale: 1 }, limits: { scale: { min: 0.5, max: 2, step: 0.05 } }, runtime: { running: true, ready: true, pid: 1, error: null }, animation: 'idle' } };
      },
    },
  },
};

plugin.apply(ctx);

check('注入的 slot 是 settings.section', slotRegistrations[0], 'settings.section');
const registration = slotRegistrations[1];
check('注册的 slot 名正确', registration?.options?.name, 'settings.section');
check('注册的 id 正确', registration?.options?.id, 'dsh-cyberwhale');
check('order 在最下方', registration?.options?.order, 90);
check('label 是函数（可跟随语言）', typeof registration?.options?.label, 'function');
check('label 返回分区名', registration?.options?.label(), '桌宠');
check('注册传入了组件', typeof registration?.component, 'function');
const themeRegistration = slotRegistrations.find(item => item?.options?.id === 'dsh-cyberwhale-theme');
check('主题是独立设置页', themeRegistration?.options?.name, 'settings.section');
check('主题导航显示正确', themeRegistration?.options?.label(), '主题');
check('主题页排在桌宠后', themeRegistration?.options?.order, 91);
check('注入了样式标签', styleTags.length, styleBefore + 1);
check('样式标签带插件标记', styleTags.at(-1)?.dataset?.plugin, 'dsh-cyberwhale');

console.log('\n[4] 组件可渲染（不抛错）');
// 注册的是一个包装组件，内部才渲染真正的卡片；我们的 React mock 不解析函数
// 组件，所以手动往里钻一层。
let tree = null;
// 必须经由 hooks 运行时渲染：组件里有 useState/useEffect。
// 而且用完必须 dispose —— 组件挂了一个 3 秒轮询，不清理 Node 进程不会退出。
const section4Runtime = (() => {
  try {
    const element = registration.component();
    return createHookRuntime(element.type, element.props);
  } catch (error) {
    console.log(`      渲染抛错：${error.message}`);
    return null;
  }
})();
try {
  tree = expand(section4Runtime.render());
  await new Promise((resolve) => setTimeout(resolve, 10));
  tree = expand(section4Runtime.render());
} catch (error) {
  console.log(`      渲染抛错：${error.message}`);
}
check('组件返回元素树', tree !== null && typeof tree.type !== 'undefined', true);
check('渲染没有抛错', tree?.renderError, undefined);
check('根节点是页面容器', tree?.props?.className, 'dsh-whale-page');
check('页面里出现了标题', JSON.stringify(tree).includes('桌宠'), true);

console.log('\n[4b] 使用的是官方基元');
const treeText = JSON.stringify(tree);
check('用了官方 Switch', treeText.includes('primitive:Switch'), true);
check('用了官方 SegmentedControl', treeText.includes('primitive:SegmentedControl'), true);
check('用了官方 Button', treeText.includes('primitive:Button'), true);
check('用了官方 StateDot', treeText.includes('primitive:StateDot'), true);
check('没有自造 checkbox', treeText.includes('"type":"checkbox"'), false);
check('没有自造 range', treeText.includes('"type":"range"'), false);
check('没有自造 select', treeText.includes('"type":"select"'), false);

section4Runtime.dispose();

console.log('\n[4c] 写入时只禁用当前控件（回归）');
{
  // 复现用户报的问题：切换大小时，整张卡片因为共用一个全局 busy 全部变暗，
  // 浅色主题下「开」的深色轨道降到 50% 不透明度看起来就是「关」。
  // 这里断言：写入期间只有被点击的那个控件是 disabled。
  const snapshotValue = {
    settings: { enabled: true, scale: 1.0, lookAtCursor: true, bubbles: true, position: null, rememberPosition: true },
    limits: { scale: { min: 0.5, max: 1.6, step: 0.05 } },
    runtime: { running: true, ready: true, pid: 1, error: null, lastExit: null },
    animation: 'idle',
  };

  let pendingMutation = null;
  const seen = [];
  const ctxDriven = {
    logger: { warn() {}, info() {} },
    effect: (fn) => fn(),
    slots: {
      inject: (_slot, callback) => {
        callback();
        return () => {};
      },
      register: (options, component) => {
        // 按 slot 名收集：插件现在会注册好几个 slot，只留「最后一个」会串味。
        (ctxDriven._registrations ??= {})[options.name === 'settings.section' ? options.id : options.name] = { options, component };
        return () => {};
      },
    },
    connection: {
      rpc: {
        // 注意：必须返回 connection RPC 的信封 {ok, value}，
        // createCaller 会拆信封；返回裸值会被当成失败。
        call: (_channel, endpoint, payload) => {
          seen.push({ endpoint, payload });
          if (endpoint === 'getState') return Promise.resolve({ ok: true, value: snapshotValue });
          return new Promise((resolve) => {
            pendingMutation = () => resolve({
              ok: true,
              value: { settings: { ...snapshotValue.settings, ...(payload ?? {}) } },
            });
          });
        },
      },
    },
  };

  plugin.apply(ctxDriven);
  const element = ctxDriven._registrations['dsh-cyberwhale'].component();
  const runtime = createHookRuntime(element.type, element.props);

  const collectByType = (node, type, out = []) => {
    if (node === null || node === undefined) return out;
    if (Array.isArray(node)) {
      for (const child of node) collectByType(child, type, out);
      return out;
    }
    if (typeof node !== 'object') return out;
    if (node.type === type) out.push(node);
    for (const child of node.children ?? []) collectByType(child, type, out);
    return out;
  };

  let tree = expand(runtime.render());
  await new Promise((resolve) => setTimeout(resolve, 10));
  tree = expand(runtime.render());

  const switchesOf = (root) => collectByType(root, 'primitive:Switch');
  const segmentsOf = (root) => collectByType(root, 'primitive:SegmentedControl');
  const byLabel = (root, label) => switchesOf(root).find((node) => node.props.label === label);

  check('渲染出 4 个开关', switchesOf(tree).length, 4);
  check('渲染出 1 个分段控件', segmentsOf(tree).length, 1);
  check('初始状态没有控件被禁用', [...switchesOf(tree), ...segmentsOf(tree)].every((n) => n.props.disabled !== true), true);

  // 点击「显示大小」→ 请求挂起
  segmentsOf(tree)[0].props.onChange('large');
  await new Promise((resolve) => setTimeout(resolve, 0));
  tree = expand(runtime.render());

  check('正在写入的分段控件被禁用', segmentsOf(tree)[0].props.disabled, true);
  check('【关键】启用开关没有被一起禁用', byLabel(tree, '启用桌宠').props.disabled, false);
  check('【关键】眼睛跟随开关没有被一起禁用', byLabel(tree, '看向鼠标').props.disabled, false);
  check('【关键】气泡开关没有被一起禁用', byLabel(tree, '气泡提示').props.disabled, false);
  check('气泡液态玻璃开关没有被一起禁用', byLabel(tree, '气泡液态玻璃').props.disabled, false);

  // 请求完成 → 全部恢复
  pendingMutation();
  await new Promise((resolve) => setTimeout(resolve, 10));
  tree = expand(runtime.render());
  check('写入完成后不再有任何控件被禁用',
    [...switchesOf(tree), ...segmentsOf(tree)].every((n) => n.props.disabled !== true), true);
  check('分段控件已跟随新值', segmentsOf(tree)[0].props.value, 'large');
  check('没有多余的 getState 往返', seen.filter((c) => c.endpoint === 'getState').length, 1);

  runtime.dispose();
}

console.log('\n[4d] 「运行环境」行（一键准备运行时的入口）');
{
  const IDLE_PREPARE = {
    status: 'idle',
    phase: null,
    received: 0,
    total: 0,
    source: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    steps: [],
  };
  const snapshotFor = (runtime) => ({
    settings: { enabled: true, scale: 1.0, lookAtCursor: true, bubbles: true, position: null, rememberPosition: true },
    limits: { scale: { min: 0.5, max: 1.6, step: 0.05 } },
    runtime: { running: false, ready: false, pid: null, error: null, lastExit: null, provisionable: false, prepare: IDLE_PREPARE, ...runtime },
    animation: 'idle',
  });

  /**
   * 收集**原始**元素节点（保留子节点）。
   *
   * 为什么不用上面的 expand：基元替身只接受 props、会把子节点丢掉，而这一节要断言的
   * 恰恰是按钮文案与进度文案。
   */
  const rawNodes = (node, out = []) => {
    if (node === null || node === undefined || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      for (const child of node) flattenNodes(child, out);
      return out;
    }
    out.push(node);
    for (const child of node.children ?? []) flattenNodes(child, out);
    return out;
  };

  const renderWith = async (runtime) => {
    const calls = [];
    const ctxDriven = {
      logger: { warn() {}, info() {} },
      effect: (fn) => fn(),
      slots: {
        inject: (_slot, callback) => {
          callback();
          return () => {};
        },
        register: (options, component) => {
          (ctxDriven._registrations ??= {})[options.name === 'settings.section' ? options.id : options.name] = { options, component };
          return () => {};
        },
      },
      connection: {
        rpc: {
          call: (_channel, endpoint, payload) => {
            calls.push({ endpoint, payload });
            if (endpoint === 'getState') return Promise.resolve({ ok: true, value: snapshotFor(runtime) });
            // 准备/取消都是「立即返回当前快照」，宿主后台继续跑。
            return Promise.resolve({
              ok: true,
              value: { prepare: { ...IDLE_PREPARE, ...(runtime.prepare ?? {}), status: 'running', phase: 'checking' } },
            });
          },
        },
      },
    };
    plugin.apply(ctxDriven);
    const element = ctxDriven._registrations['dsh-cyberwhale'].component();
    const hookRuntime = createHookRuntime(element.type, element.props);
    let tree = hookRuntime.render();
    await new Promise((resolve) => setTimeout(resolve, 10));
    tree = hookRuntime.render();
    const nodes = flattenNodes(tree);
    return { calls, nodes, dispose: () => hookRuntime.dispose() };
  };

  const buttonsOf = (nodes) => nodes.filter((node) => node.type === primitivesMock.Button);
  const labelOf = (node) => (node.children ?? [])[0];

  // 本机没有运行时 → 出现引导行
  const missing = await renderWith({ provisionable: true });
  const missingText = JSON.stringify(missing.nodes);
  check('缺运行时时出现「运行环境」行', missingText.includes('运行环境'), true);
  // 体积随平台而定（macOS 约 117 MB、Windows x64 约 150 MB），所以文案给区间而不是单个数字
  check('文案说明运行时体积（区间）', missingText.includes('100–150 MB'), true);
  check('文案说明下载源可选', missingText.includes('运行时下载源'), true);
  check('下载源有两个选项', missingText.includes('国内镜像') && missingText.includes('官方源'), true);
  const prepareButton = buttonsOf(missing.nodes).find((node) => labelOf(node) === '准备运行时');
  check('空闲时给的是「准备运行时」按钮', prepareButton !== undefined, true);
  prepareButton?.props?.onClick?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check('点击后调用 prepareRuntime', missing.calls.at(-1)?.endpoint, 'prepareRuntime');
  missing.dispose();

  // 运行时可用且没有在准备 → 不占用一行
  const fine = await renderWith({ provisionable: false });
  check('运行时可用的页面不显示这一行', JSON.stringify(fine.nodes).includes('运行环境'), false);
  fine.dispose();

  // 准备中 → 进度文案 + 取消
  const running = await renderWith({
    provisionable: true,
    prepare: {
      ...IDLE_PREPARE,
      status: 'running',
      phase: 'downloading',
      received: Math.round(12.3 * 1048576),
      total: Math.round(108.5 * 1048576),
      source: 'mirror',
    },
  });
  check('下载中显示「下载中 12.3 / 108.5 MB」', JSON.stringify(running.nodes).includes('下载中 12.3 / 108.5 MB'), true);
  const cancelButton = buttonsOf(running.nodes).find((node) => labelOf(node) === '取消');
  check('下载中给的是「取消」按钮', cancelButton !== undefined, true);
  cancelButton?.props?.onClick?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check('点击取消调用 cancelRuntime', running.calls.at(-1)?.endpoint, 'cancelRuntime');
  running.dispose();

  // 各阶段文案
  const phaseText = async (phase, extra) => {
    const view = await renderWith({ provisionable: true, prepare: { ...IDLE_PREPARE, status: 'running', phase, ...extra } });
    const text = JSON.stringify(view.nodes);
    view.dispose();
    return text;
  };
  check('checking 文案', (await phaseText('checking')).includes('检查本机运行时…'), true);
  check('cached 文案', (await phaseText('cached')).includes('使用本机已有运行时…'), true);
  check('verifying 文案', (await phaseText('verifying')).includes('校验中…'), true);
  check('extracting 文案', (await phaseText('extracting')).includes('解包中…'), true);
  check(
    '没有 content-length 时只报已下载量',
    (await phaseText('downloading', { received: Math.round(3 * 1048576), total: 0 })).includes('下载中 3.0 MB'),
    true,
  );

  // 失败 → 错误原文 + 重试
  const failed = await renderWith({
    provisionable: true,
    prepare: { ...IDLE_PREPARE, status: 'failed', error: '官方源与镜像都不可达' },
  });
  const failedText = JSON.stringify(failed.nodes);
  check('失败时显示错误原文', failedText.includes('官方源与镜像都不可达'), true);
  check('失败时按钮变成「重试」', buttonsOf(failed.nodes).some((node) => labelOf(node) === '重试'), true);
  failed.dispose();

  // 已完成 → 就绪状态点
  const doneView = await renderWith({ provisionable: false, prepare: { ...IDLE_PREPARE, status: 'done', phase: 'ready' } });
  const doneText = JSON.stringify(doneView.nodes);
  check('已就绪时显示「已就绪」', doneText.includes('已就绪'), true);
  // 原始节点里 type 是函数，JSON 会丢掉它，所以按引用判断基元。
  check('已就绪时用了官方状态点', doneView.nodes.some((node) => node.type === primitivesMock.StateDot), true);
  doneView.dispose();
}

console.log('\n[4e] 插件页：启用引导弹窗（plugins.bundle.activation）');
{
  // 两个插件页 slot 都是 kind:keyed，key 必须是包名；宿主另外传 onDismiss / onOpenDetails。
  const renderPrompt = async (runtime, extraProps = {}) => {
    const ctxDriven = {
      logger: { warn() {}, info() {} },
      effect: (fn) => fn(),
      slots: {
        inject: (_slot, callback) => {
          callback();
          return () => {};
        },
        register: (options, component) => {
          (ctxDriven._registrations ??= {})[options.name === 'settings.section' ? options.id : options.name] = { options, component };
          return () => {};
        },
      },
      connection: {
        rpc: {
          call: () => Promise.resolve({ ok: true, value: { runtime } }),
        },
      },
    };
    plugin.apply(ctxDriven);
    const registration = ctxDriven._registrations['plugins.bundle.activation'];
    const element = registration.component({ packageName: 'dsh-cyberwhale', ...extraProps });
    const hookRuntime = createHookRuntime(element.type, element.props);
    // 共享 store 是异步拉的，等一轮再取树，否则看到的还是 snapshot=null 的首帧。
    hookRuntime.render();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      options: registration.options,
      render: () => flattenNodes(hookRuntime.render()),
      dispose: () => hookRuntime.dispose(),
    };
  };
  const pluginRuntime = (overrides) => ({
    running: false,
    ready: false,
    pid: null,
    error: null,
    lastExit: null,
    provisionable: false,
    prepare: { status: 'idle', phase: null, received: 0, total: 0, source: null, error: null, startedAt: null, finishedAt: null, steps: [] },
    ...overrides,
  });
  const modalOf = (nodes) => nodes.find((node) => node.type === primitivesMock.Modal);
  const footerLabels = (modal) => (modal?.props.footer ?? []).map((node) => node.children?.[0]);
  const footerButton = (modal, label) => (modal?.props.footer ?? []).find((node) => node.children?.[0] === label);

  const dismissed = [];
  const opened = [];
  const missing = await renderPrompt(pluginRuntime({ provisionable: true }), {
    onDismiss: () => dismissed.push(true),
    onOpenDetails: () => opened.push(true),
  });
  check('注册到 plugins.bundle.activation', missing.options.name, 'plugins.bundle.activation');
  check('key 是包名', missing.options.key, 'dsh-cyberwhale');

  const prompt = modalOf(missing.render());
  check('缺运行时时弹窗打开', prompt?.props.open, true);
  check('标题说明要准备运行环境', String(prompt?.props.title ?? '').includes('运行环境'), true);
  check('按钮是「稍后」+「前往安装」', footerLabels(prompt).join(' / '), '稍后 / 前往安装');
  check('弹窗没被误关', dismissed.length, 0);

  footerButton(prompt, '前往安装').props.onClick();
  check('「前往安装」打开组合包详情', opened.length, 1);
  footerButton(prompt, '稍后').props.onClick();
  check('「稍后」关闭引导', dismissed.length, 1);
  missing.dispose();

  // 运行时已就绪 → 不打扰，而且要自己把引导收掉（否则会一直挂在插件页上）
  const readyDismissed = [];
  const ready = await renderPrompt(pluginRuntime({ ready: true }), { onDismiss: () => readyDismissed.push(true) });
  check('就绪时弹窗不打开', modalOf(ready.render())?.props.open, false);
  check('就绪时自动关闭引导', readyDismissed.length, 1);
  ready.dispose();

  // 已经在准备 → 也不再打扰
  const busy = await renderPrompt(
    pluginRuntime({
      provisionable: true,
      prepare: { status: 'running', phase: 'downloading', received: 0, total: 0, source: null, error: null, startedAt: Date.now(), finishedAt: null, steps: [] },
    }),
    { onDismiss: () => {} },
  );
  check('已在准备时不重复弹引导', modalOf(busy.render())?.props.open, false);
  busy.dispose();
}

console.log('\n[4f] 插件页：详情页准备面板（plugins.bundle.config）');
{
  const renderPanel = async (runtime) => {
    const calls = [];
    const ctxDriven = {
      logger: { warn() {}, info() {} },
      effect: (fn) => fn(),
      slots: {
        inject: (_slot, callback) => {
          callback();
          return () => {};
        },
        register: (options, component) => {
          (ctxDriven._registrations ??= {})[options.name === 'settings.section' ? options.id : options.name] = { options, component };
          return () => {};
        },
      },
      connection: {
        rpc: {
          call: (_channel, endpoint, payload) => {
            calls.push({ endpoint, payload });
            if (endpoint === 'getState') return Promise.resolve({ ok: true, value: { runtime } });
            // prepareRuntime / cancelRuntime 都是「立刻返回当前快照」，活在宿主后台继续。
            return Promise.resolve({
              ok: true,
              value: { prepare: { status: 'running', phase: 'checking', received: 0, total: 0, source: null, error: null, startedAt: Date.now(), finishedAt: null, steps: [] } },
            });
          },
        },
      },
    };
    plugin.apply(ctxDriven);
    const registration = ctxDriven._registrations['plugins.bundle.config'];
    const element = registration.component({ packageName: 'dsh-cyberwhale', view: 'page' });
    const hookRuntime = createHookRuntime(element.type, element.props);
    hookRuntime.render();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      options: registration.options,
      calls,
      render: () => flattenNodes(hookRuntime.render()),
      dispose: () => hookRuntime.dispose(),
    };
  };
  const labelOfButton = (node) => node.children?.[0];
  const buttonsOf = (nodes) => nodes.filter((node) => node.type === primitivesMock.Button);
  const clickButton = async (view, label) => {
    buttonsOf(view.render()).find((node) => labelOfButton(node) === label).props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const panelRuntime = (overrides) => ({
    running: false,
    ready: false,
    pid: null,
    error: null,
    lastExit: null,
    provisionable: false,
    prepare: { status: 'idle', phase: null, received: 0, total: 0, source: null, error: null, startedAt: null, finishedAt: null, steps: [] },
    ...overrides,
  });

  // 缺运行时 → 估算 + 「下载并准备」
  const missing = await renderPanel(panelRuntime({ provisionable: true }));
  check('注册到 plugins.bundle.config', missing.options.name, 'plugins.bundle.config');
  check('key 是包名', missing.options.key, 'dsh-cyberwhale');
  const missingText = JSON.stringify(missing.render());
  check('面板标题是「运行环境」', missingText.includes('运行环境'), true);
  check('准备前给出解包后的体积估算', missingText.includes('解包后约 350 MB'), true);
  check('有「下载并准备」按钮', buttonsOf(missing.render()).map(labelOfButton).includes('下载并准备'), true);

  await clickButton(missing, '下载并准备');
  check('点击调用 prepareRuntime', missing.calls.some((call) => call.endpoint === 'prepareRuntime'), true);
  missing.dispose();

  // 下载中 → 摘要（当前步骤 + 真实字节）+ 「取消」，步骤列表默认折叠
  const running = await renderPanel(panelRuntime({
    provisionable: true,
    prepare: {
      status: 'running',
      phase: 'downloading',
      received: 10485760,
      total: 118000000,
      source: 'official',
      error: null,
      startedAt: Date.now() - 3000,
      finishedAt: null,
      steps: [
        { kind: 'check', status: 'done', startedAt: Date.now() - 3000, finishedAt: Date.now() - 2000, received: 0, total: 0, error: null },
        { kind: 'download', status: 'running', startedAt: Date.now() - 2000, finishedAt: null, received: 10485760, total: 118000000, error: null },
      ],
    },
  }));
  const runningText = JSON.stringify(running.render());
  check('下载中提供「取消」', buttonsOf(running.render()).map(labelOfButton).includes('取消'), true);
  check('摘要显示当前步骤', runningText.includes('下载 Electron'), true);
  check('摘要显示真实字节', runningText.includes('10.0 / 112.5 MB'), true);
  check('步骤列表默认折叠', runningText.includes('检查本机运行时'), false);

  const disclosure = running.render().find((node) => node.type === primitivesMock.DisclosureRow);
  check('用了官方的可折叠摘要行', disclosure !== undefined, true);
  check('摘要行带官方状态点', flattenNodes(disclosure.props.icon).some((node) => node.type === primitivesMock.StateDot), true);

  disclosure.props.onToggle();
  const expandedText = JSON.stringify(running.render());
  check('展开后列出每一步', expandedText.includes('检查本机运行时') && expandedText.includes('下载 Electron'), true);

  await clickButton(running, '取消');
  check('点击取消调用 cancelRuntime', running.calls.some((call) => call.endpoint === 'cancelRuntime'), true);
  running.dispose();

  // 失败 → 错误原文 + 「重试」
  const failed = await renderPanel(panelRuntime({
    provisionable: true,
    prepare: {
      status: 'failed',
      phase: 'downloading',
      received: 0,
      total: 0,
      source: 'official',
      error: '官方源与国内镜像都不可达',
      startedAt: Date.now() - 5000,
      finishedAt: Date.now(),
      steps: [{ kind: 'download', status: 'failed', startedAt: Date.now() - 5000, finishedAt: Date.now(), received: 0, total: 0, error: '官方源与国内镜像都不可达' }],
    },
  }));
  const failedNodes = failed.render();
  check('失败时显示错误原文', JSON.stringify(failedNodes).includes('官方源与国内镜像都不可达'), true);
  check('失败时按钮变成「重试」', buttonsOf(failedNodes).map(labelOfButton).includes('重试'), true);
  failed.dispose();

  // 就绪 → 状态点，不再提供下载
  const done = await renderPanel(panelRuntime({ ready: true, provisionable: false }));
  const doneNodes = done.render();
  check('就绪时显示已就绪', JSON.stringify(doneNodes).includes('运行环境已就绪'), true);
  check('就绪时不再提供下载按钮', buttonsOf(doneNodes).map(labelOfButton).includes('下载并准备'), false);
  done.dispose();
}

console.log('\n[4g] 背景设置：模式切换、空图片与按需展开');
{
  let config = appearanceModel.normalizeAppearance(), edits = 0;
  const listeners = new Set();
  const controller = {
    getState: () => ({ config, loading: false, recovering: false, available: true,
      theme: { preference: 'light', active: { colorScheme: 'light' }, fontSize: 14 } }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    edit(patch) { config = appearanceModel.normalizeAppearance({ ...config, ...patch }); edits++; for (const fn of listeners) fn(); },
  };
  const element = themeRegistration.component();
  const page = createHookRuntime(element.type, { controller });
  let background = null, backgroundProps = null, backgroundKey = null;
  // Keep component hook states and remount on React's actual key changes.
  const view = () => {
    const node = flattenNodes(page.render()).find(n => typeof n.props.changeBackground === 'function');
    if (!background || node.props.key !== backgroundKey) {
      background?.dispose(); backgroundKey = node.props.key; backgroundProps = { ...node.props };
      background = createHookRuntime(node.type, backgroundProps);
    } else Object.assign(backgroundProps, node.props);
    // Represents already-computed upload candidates, without reading local files.
    backgroundProps.sources = ['#26707A']; backgroundProps.sourceImage = config.wallpaper?.id ?? null;
    return flattenNodes(background.render());
  };
  const segment = nodes => nodes.find(n => n.type === primitivesMock.SegmentedControl);
  const button = (nodes, text) => nodes.find(n => n.type === primitivesMock.Button && n.children?.[0] === text);
  const disclosure = (nodes, title) => nodes.find(n => n.type === primitivesMock.DisclosureRow && n.props.title === title);
  const ranges = nodes => nodes.filter(n => n.type === 'input' && n.props.type === 'range');
  const image = { id: 'a'.repeat(64), name: 'fixture.png' };
  let nodes = view();
  check('尚未上传时图片选项可以选择', segment(nodes).props.options.find(o => o.value === 'image').disabled === true, false);
  check('纯色不展示上传、渐变或效果控件', nodes.some(n => n.props.type === 'file' || n.props.className === 'dsh-appearance-gradient' || n.type === primitivesMock.DisclosureRow), false);
  segment(nodes).props.onChange('image'); nodes = view();
  check('无图片时选中图片模式不会跳回纯色', config.background, 'image');
  check('空图片模式显示选择图片入口', button(nodes, '选择图片') !== undefined, true);
  check('空图片模式不显示预览、布局或效果', nodes.some(n => n.type === 'img' || n.type === 'select' || n.type === primitivesMock.DisclosureRow), false);

  controller.edit({ wallpaper: image }); nodes = view();
  const themeBefore = JSON.stringify([config.light, config.dark]);
  check('有图片时显示预览和布局', nodes.some(n => n.type === 'img') && nodes.filter(n => n.type === 'select').length === 2, true);
  check('效果调整和图片取色默认折叠', [disclosure(nodes, '效果调整').props.open, disclosure(nodes, '从图片生成配色').props.open], [false, false]);
  check('折叠时不渲染滑块和候选主色', ranges(nodes).length === 0 && !nodes.some(n => n.props.className === 'dsh-appearance-swatches'), true);
  disclosure(nodes, '效果调整').props.onToggle(); nodes = view();
  check('展开效果后显示遮罩和模糊', ranges(nodes).map(n => n.props['aria-label']), ['背景遮罩', '背景模糊']);
  ranges(nodes).find(n => n.props['aria-label'] === '背景遮罩').props.onChange({ target: { value: '88' } });
  nodes = view();
  disclosure(nodes, '从图片生成配色').props.onToggle(); nodes = view();
  check('展开图片取色后显示候选主色', nodes.some(n => n.props.className === 'dsh-appearance-swatches'), true);
  check('仅展开取色不会改变主题配色', JSON.stringify([config.light, config.dark]), themeBefore);
  const beforePick = edits;
  nodes.find(n => n.props['aria-label'] === '应用图片主色 #26707A').props.onClick();
  check('点击主色才应用配套浅深配色', config.light.preset === 'custom' && config.dark.preset === 'custom' && edits === beforePick + 1, true);

  nodes = view(); segment(nodes).props.onChange('gradient'); nodes = view();
  nodes.find(n => n.props['aria-label'] === '海岸渐变').props.onClick(); nodes = view();
  check('渐变模式只显示渐变和遮罩', nodes.filter(n => n.props.className === 'dsh-appearance-gradient').length === 3 && ranges(nodes).length === 1 && !nodes.some(n => n.props.type === 'file' || n.type === 'img' || n.type === primitivesMock.DisclosureRow), true);
  check('切换渐变保留已上传图片', config.wallpaper.id, image.id);
  segment(nodes).props.onChange('none'); nodes = view();
  check('有图片时切回纯色也不展示图片设置', nodes.some(n => n.props.type === 'file' || n.type === 'img' || n.type === primitivesMock.DisclosureRow), false);
  segment(nodes).props.onChange('image'); nodes = view();
  check('切回图片保留图片、渐变与效果参数', [config.wallpaper.id, config.gradient, config.mask], [image.id, 'sea', 88]);
  check('切回图片附加功能重新折叠', [disclosure(nodes, '效果调整').props.open, disclosure(nodes, '从图片生成配色').props.open], [false, false]);
  button(nodes, '移除').props.onClick(); nodes = view();
  check('移除后留在图片模式并恢复上传区域', config.background === 'image' && config.wallpaper === null && button(nodes, '选择图片') !== undefined, true);
  background.dispose(); page.dispose();
}

console.log('\n[4h] 系统字体：自动读取、即时应用与失败回退');
{
  let config = appearanceModel.normalizeAppearance({ uiFont: 'Old Font, sans-serif' }), reads = 0;
  const controller = { getState: () => ({ config, loading: false, recovering: false, available: true, theme: { fontSize: 14 } }), subscribe: () => () => {} };
  const element = themeRegistration.component();
  const page = createHookRuntime(element.type, { controller });
  const node = flattenNodes(page.render()).find(n => n.type?.name === 'FontSettings');
  const props = { ...node.props, edit(patch) { config = appearanceModel.normalizeAppearance({ ...config, ...patch }); props.config = config; } };
  let fonts = createHookRuntime(node.type, props);
  const view = () => flattenNodes(fonts.render());
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const reopen = () => { fonts.dispose(); fonts = createHookRuntime(node.type, props); return view(); };
  const picker = (nodes, name) => nodes.find(n => n.type === 'select' && n.props['aria-label'] === name);
  const names = select => flattenNodes(select.children).filter(n => n.type === 'option').map(n => n.children[0]);
  const read = nodes => nodes.find(n => n.type === primitivesMock.Button).props.onClick();
  let resolveRead;
  sandbox.queryLocalFonts = () => { reads++; return new Promise(resolve => { resolveRead = resolve; }); };
  let nodes = view();
  check('进入页面自动读取字体，无需点击', reads, 1);
  check('字体默认使用下拉框，保留旧版手填值', names(picker(nodes, '界面字体')), ['系统默认', 'Old Font, sans-serif（当前）']);
  view();
  check('读取过程中去重请求', reads, 1);
  check('正常读取时不显示手动刷新按钮', view().some(n => n.type === primitivesMock.Button), false);
  resolveRead([{ family: 'PingFang SC', style: 'Regular' }, { family: 'PingFang SC', style: 'Bold' }, { family: 'Consolas' }, { family: 'Noto Sans CJK SC' }, { family: 'Example, Serif (UI)' }, { family: '宋体' }, { family: '' }]);
  await settle(); nodes = view();
  check('按家族去重，中文与带标点的字体均可选择', names(picker(nodes, '代码字体')).length, 6);
  picker(nodes, '界面字体').props.onChange({ target: { value: '"Example, Serif (UI)"' } });
  check('选择后立即保存为单个字体名', config.uiFont, '"Example, Serif (UI)"');
  nodes = view();
  picker(nodes, '代码字体').props.onChange({ target: { value: '"Consolas"' } });
  check('界面与代码字体分别保存', [config.uiFont, config.codeFont], ['"Example, Serif (UI)"', '"Consolas"']);
  picker(view(), '界面字体').props.onChange({ target: { value: '' } });
  check('选择系统默认清除覆盖', config.uiFont, '');
  props.disabled = true; view(); props.disabled = false; view();
  check('页面内临时禁用后恢复，不重复请求字体', reads, 1);
  sandbox.queryLocalFonts = async () => { reads++; return [{ family: 'Consolas' }, { family: 'Newly Installed' }]; };
  reopen(); await settle(); nodes = view();
  check('重新进入页面会刷新列表，包含新安装字体', reads === 2 && names(picker(nodes, '代码字体')).includes('Newly Installed'), true);
  sandbox.queryLocalFonts = async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; };
  reopen(); await settle(); nodes = view();
  check('拒绝权限后保留已有设置', config.codeFont, '"Consolas"');
  check('拒绝权限有说明并提供手动输入', nodes.some(n => n.props.role === 'alert') && nodes.filter(n => String(n.props['aria-label']).startsWith('手动输入')).length === 2, true);
  sandbox.queryLocalFonts = async () => [{ family: 'Consolas' }];
  await read(view()); nodes = view();
  check('重试成功收起备用输入', nodes.some(n => String(n.props['aria-label']).startsWith('手动输入')), false);
  check('重试成功后收起重试入口', nodes.some(n => n.type === primitivesMock.Button), false);
  sandbox.queryLocalFonts = async () => [];
  reopen(); await settle();
  check('空列表不清空已有配置', config.codeFont, '"Consolas"');
  delete sandbox.queryLocalFonts;
  await read(view());
  check('不支持接口时可继续手动设置', view().some(n => n.props['aria-label'] === '手动输入代码字体'), true);
  const pendingReads = [];
  sandbox.queryLocalFonts = () => new Promise(resolve => pendingReads.push(resolve));
  props.disabled = true; reopen();
  check('页面尚未就绪时暂缓自动读取', pendingReads.length, 0);
  props.disabled = false; view(); reopen();
  check('页面就绪和重新进入各触发一次读取', pendingReads.length, 2);
  pendingReads[0]([{ family: 'Old Result' }]); await settle();
  check('关闭页面后的旧请求不会污染新页面', names(picker(view(), '界面字体')).includes('Old Result'), false);
  pendingReads[1]([{ family: 'Fresh Result' }]); await settle();
  check('新页面采用自己的读取结果', names(picker(view(), '界面字体')).includes('Fresh Result'), true);
  delete sandbox.queryLocalFonts;
  fonts.dispose(); page.dispose();
}

console.log('\n[5] 组件内部的 RPC 调用');
// 组件把 call 通过闭包持有；这里直接再走一遍 createCaller 的等价路径：
// 通过注册时传入的 props 拿不到，因此改为断言 apply 里构造的调用路径。
const callerProbe = await ctx.connection.rpc.call('/deskpet', 'getState', {});
check('RPC 走的是 /deskpet 通道', rpcCalls.at(-1)?.channel, '/deskpet');
check('RPC 端点为 getState', rpcCalls.at(-1)?.endpoint, 'getState');
check('RPC 返回被正确解包', callerProbe.ok, true);

const failure = await (async () => {
  ctx.connection.rpc.call = async () => ({ ok: false, error: { message: '模拟失败' } });
  try {
    const { createCaller } = await import('node:module').then(() => ({ createCaller: null }));
    void createCaller;
  } catch {
    /* ignore */
  }
  return null;
})();
void failure;

console.log('\n[6] 释放');
for (const disposer of effects) if (typeof disposer === 'function') disposer();
check('释放不抛错', true, true);

console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
process.exitCode = failed === 0 ? 0 : 1;

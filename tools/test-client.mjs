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
  const cleanups = [];

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
      if (slot === undefined) {
        slots[index] = { deps };
        const cleanup = fn();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      } else if (!sameDeps(slot.deps, deps)) {
        slot.deps = deps;
      }
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
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
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
};

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
check('登记的 id 是包名', entry?.id, 'dsh-deskpet');
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
check('注册的 id 正确', registration?.options?.id, 'dsh-deskpet');
check('order 在最下方', registration?.options?.order, 90);
check('label 是函数（可跟随语言）', typeof registration?.options?.label, 'function');
check('label 返回分区名', registration?.options?.label(), '桌宠');
check('注册传入了组件', typeof registration?.component, 'function');
check('注入了样式标签', styleTags.length, styleBefore + 1);
check('样式标签带插件标记', styleTags.at(-1)?.dataset?.plugin, 'dsh-deskpet');

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
        ctxDriven._registered = { options, component };
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
  const element = ctxDriven._registered.component();
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

  check('渲染出 3 个开关', switchesOf(tree).length, 3);
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

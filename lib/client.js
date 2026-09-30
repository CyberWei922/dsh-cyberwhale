// 由 client/build.mjs 生成 —— 请勿直接编辑；改 client/index.js 后重新构建。
window.__ModuleLoader__.load({ id: "dsh-cyberwhale", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
'use strict';

/**
 * dsh-cyberwhale · 客户端半插件（设置页）
 *
 * 本文件是「源」形态的 CJS 模块体：`client/build.mjs` 会把它包进官方要求的
 * lazy-CJS 工厂外壳（`window.__ModuleLoader__.load({ id, factory(require) {…} })`），
 * 产物写入 `lib/client.js`。
 *
 * 这是一整页而不是「通用」里的一行：注册进 `settings.section`。
 * 官方的分工写得很清楚 —— `settings.general.item` 是「单条偏好」的位置，
 * 「一整页则是 `settings.section`」。
 *
 * UI 一律使用官方基元（`@deepseek-ai/dsh-client-ui-primitives` 在客户端基线
 * 模块表里），因此开关、分段控件、按钮、状态点与官方设置页完全一致；
 * 行布局也照抄官方 `DeveloperToolsRow` 的尺寸与 token。
 */

// 由工厂注入的 require —— 解析来自页面的模块表，不打包任何 Harness Client 包。
const React = require('react');
const { Button, SegmentedControl, StateDot, Switch } = require('@deepseek-ai/dsh-client-ui-primitives');

/** 注册到哪个 slot。整页用 `settings.section`；单条偏好才用 `settings.general.item`。 */
const SLOT = 'settings.section';
/** 分区 key（导航选中标识，也用于 `openSection(id)`）。 */
const SECTION_ID = 'dsh-cyberwhale';
/** 导航位置：官方现有分区为 账号 -10 / 通用 0 / 模型 10 / 插件 15 / Agent 预设 20，取 90 放最下方。 */
const ORDER = 90;
/** 运行状态轮询间隔（只在这一页被挂载时运行）。 */
const POLL_MS = 3000;
/**
 * 准备运行时的轮询间隔。
 *
 * 下载进度是「每 250ms 一个数」的流；用 3 秒的常规间隔看就是一张张跳变的
 * 快照，完全不像在下载。只在这段时间调密，其余时候保持低频。
 */
const FAST_POLL_MS = 800;

/** 字节 → MB（保留一位小数，与官方进度文案一致）。 */
function megabytes(bytes) {
  return (Number(bytes) / 1048576).toFixed(1);
}

/**
 * 把宿主的准备进度翻成一行中文文案。
 *
 * 文案在这里而不是宿主：宿主只报 `phase` 与字节数，显示怎么写是客户端的事。
 * @param {{ phase?: string|null, received?: number, total?: number }|null} prepare
 */
function prepareText(prepare) {
  const phase = prepare?.phase ?? null;
  if (phase === 'checking') return '检查本机运行时…';
  if (phase === 'cached') return '使用本机已有运行时…';
  if (phase === 'downloading') {
    const total = Number(prepare?.total) || 0;
    const received = Number(prepare?.received) || 0;
    // 服务端没给 content-length 时只能报已下多少，别显示一个假的分母。
    return total > 0
      ? `下载中 ${megabytes(received)} / ${megabytes(total)} MB`
      : `下载中 ${megabytes(received)} MB`;
  }
  if (phase === 'verifying') return '校验中…';
  if (phase === 'extracting') return '解包中…';
  if (phase === 'ready') return '已就绪';
  return '准备中…';
}

/**
 * 显示大小档位。
 * 官方设计系统没有 slider（全仓库 `type="range"` 零命中），
 * 因此用官方的 `SegmentedControl` 表达离散档位 —— 既符合规范也更好点。
 */
const SCALE_PRESETS = [
  { value: 'small', label: '小', scale: 0.7 },
  { value: 'medium', label: '中', scale: 1.0 },
  { value: 'large', label: '大', scale: 1.3 },
  { value: 'huge', label: '特大', scale: 1.6 },
];

/** 把任意缩放值吸附到最近的档位。 */
function scaleToPreset(scale) {
  let best = SCALE_PRESETS[1];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const preset of SCALE_PRESETS) {
    const distance = Math.abs(preset.scale - scale);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = preset;
    }
  }
  return best.value;
}

/** 档位 → 缩放值。 */
function presetToScale(value) {
  return (SCALE_PRESETS.find((preset) => preset.value === value) ?? SCALE_PRESETS[1]).scale;
}

/**
 * 插件自有样式。
 *
 * 尺寸与 token 全部照抄官方设置页（`DeveloperToolsRow.module.css`）：
 * 行 = flex + space-between + gap 24 + padding 16/0 + 0.5px 分隔线；
 * 标题 14/20，描述 12/18 次级色。颜色一律走 `--dsw-alias-*`，不写字面值。
 */
const CSS = `
.dsh-whale-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  color: var(--dsw-alias-label-primary);
}
.dsh-whale-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-whale-row:last-child { border-bottom: none; }
.dsh-whale-text { min-width: 0; }
.dsh-whale-title { font-size: 14px; line-height: 20px; }
.dsh-whale-description {
  margin-top: 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dsh-whale-control { flex: 0 0 auto; display: flex; align-items: center; }
.dsh-whale-actions { display: flex; flex: 0 0 auto; gap: 8px; }
.dsh-whale-status {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.dsh-whale-alert {
  margin-top: 8px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-whale-page * { transition: none !important; animation: none !important; }
}
`;

/**
 * 调用宿主插件注册的 `/deskpet` RPC 通道。
 * @param {object} ctx 客户端根上下文
 * @returns {(endpoint: string, payload?: unknown) => Promise<any>}
 */
function createCaller(ctx) {
  return async function call(endpoint, payload) {
    const result = await ctx.connection.rpc.call('/deskpet', endpoint, payload ?? {});
    if (result === null || typeof result !== 'object' || result.ok !== true) {
      throw new Error(String(result?.error?.message ?? '桌宠 RPC 调用失败'));
    }
    return result.value;
  };
}

/**
 * 桌宠设置页。
 * @param {{ call: (endpoint: string, payload?: unknown) => Promise<any> }} props
 */
function WhalePetSection(props) {
  const { call } = props;
  const [snapshot, setSnapshot] = React.useState(null);
  const [error, setError] = React.useState(null);
  /**
   * 正在写入的控件 key（'enabled' / 'scale' / 'look' / 'bubbles' / 'action:xxx'）。
   *
   * 只禁用**当前这一个**控件。曾经用一个全局开关把所有控件一起置为 disabled，
   * 于是每次写入整张卡都会随 `:disabled { opacity: .5 }` 一起变暗 ——
   * 而浅色主题下「开」的深色轨道降到 50% 不透明度就是灰色，
   * 看起来正是一个「关」的开关。这就是"先闪成关、再变回开"的来源。
   */
  const [pending, setPending] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const value = await call('getState');
      setSnapshot(value);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [call]);

  /**
   * 准备任务是否在跑 —— 决定轮询用 800ms 还是 3000ms。
   * 必须在 effect 之前算出来：它要进依赖数组，进依赖数组就会在渲染时求值。
   */
  const preparingRuntime = snapshot?.runtime?.prepare?.status === 'running';

  React.useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      await refresh();
    };
    void tick();
    const timer = setInterval(() => void tick(), preparingRuntime ? FAST_POLL_MS : POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refresh, preparingRuntime]);

  const mutate = React.useCallback(
    async (key, endpoint, payload) => {
      setPending(key);
      try {
        const value = await call(endpoint, payload);
        // updateSettings 已经把归一化后的新设置带回来了，不必再拉一次 getState：
        // 少一次往返，可被看见的等待就少一半。
        if (value !== null && typeof value === 'object' && value.settings !== undefined) {
          setSnapshot((previous) => ({ ...(previous ?? {}), settings: value.settings }));
        } else {
          await refresh();
        }
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        // 失败时以宿主为准回读一次，避免本地状态和服务端不一致。
        await refresh();
      } finally {
        setPending(null);
      }
    },
    [call, refresh],
  );

  /**
   * 准备 / 取消运行时。
   *
   * 两个端点都是「立即返回当前快照、活儿在宿主后台干」，所以这里不等下载，
   * 把返回的 prepare 合并进来就行 —— 后续进度交给轮询。
   */
  const runtimeAction = React.useCallback(
    async (endpoint) => {
      setPending('runtime');
      try {
        const value = await call(endpoint, {});
        if (value !== null && typeof value === 'object' && value.prepare !== undefined) {
          setSnapshot((previous) =>
            previous === null
              ? previous
              : { ...previous, runtime: { ...(previous.runtime ?? {}), prepare: value.prepare } },
          );
        } else {
          await refresh();
        }
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        await refresh();
      } finally {
        setPending(null);
      }
    },
    [call, refresh],
  );

  const settings = snapshot?.settings ?? null;
  const runtime = snapshot?.runtime ?? null;

  const enabled = settings?.enabled ?? true;
  const scale = settings?.scale ?? 1;
  const lookAtCursor = settings?.lookAtCursor ?? true;
  const bubbles = settings?.bubbles ?? true;

  const prepare = runtime?.prepare ?? null;
  const prepareFailed = prepare?.status === 'failed';
  // 只在「本机确实缺运行时」或「正在处理这件事」时占用一行 —— 装好了就不再打扰。
  const showRuntimeRow = runtime?.provisionable === true || (prepare !== null && prepare.status !== 'idle');

  /** 运行状态 → 官方 StateDot 的语义 + 文案。 */
  const status = (() => {
    if (runtime?.error !== null && runtime?.error !== undefined) {
      return { state: 'error', text: '运行时不可用', detail: String(runtime.error) };
    }
    if (runtime?.ready === true) {
      return { state: 'done', text: `窗口运行中${runtime.pid === null ? '' : ` · pid ${runtime.pid}`}` };
    }
    if (runtime?.running === true) return { state: 'ongoing', text: '窗口启动中…' };
    if (runtime?.lastExit !== null && runtime?.lastExit !== undefined) {
      const exit = runtime.lastExit;
      const reason =
        exit.error !== undefined
          ? String(exit.error)
          : exit.signal !== null && exit.signal !== undefined
            ? `被信号 ${exit.signal} 终止`
            : `退出码 ${exit.exitCode}`;
      return { state: 'error', text: '窗口未能启动', detail: `上一次退出：${reason}` };
    }
    if (enabled === false) return { state: 'idle', text: '已关闭' };
    return { state: 'idle', text: '未运行' };
  })();

  const h = React.createElement;

  /** 一行：左侧标题 + 描述，右侧控件。与官方 DeveloperToolsRow 同构。 */
  const row = (key, title, description, control, alert) =>
    h(
      'div',
      { className: 'dsh-whale-row', key },
      h(
        'div',
        { className: 'dsh-whale-text' },
        h('div', { className: 'dsh-whale-title' }, title),
        description === null ? null : h('div', { className: 'dsh-whale-description' }, description),
        alert === null || alert === undefined
          ? null
          : h('div', { className: 'dsh-whale-alert', role: 'alert' }, alert),
      ),
      h('div', { className: 'dsh-whale-control' }, control),
    );

  /**
   * 「运行环境」行的右侧控件。
   *
   * 四个状态：失败 → 重试；进行中 → 进度文案 + 取消；已完成 → 状态点；其余 → 准备运行时。
   */
  const runtimeControl = (() => {
    if (prepareFailed) {
      return h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          disabled: pending === 'runtime',
          onClick: () => void runtimeAction('prepareRuntime'),
        },
        '重试',
      );
    }
    if (preparingRuntime) {
      return h(
        'div',
        { className: 'dsh-whale-actions' },
        h('div', { className: 'dsh-whale-status' }, h('span', null, prepareText(prepare))),
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            disabled: pending === 'runtime',
            onClick: () => void runtimeAction('cancelRuntime'),
          },
          '取消',
        ),
      );
    }
    if (prepare?.status === 'done') {
      return h(
        'div',
        { className: 'dsh-whale-status' },
        h(StateDot, { state: 'done' }),
        h('span', null, '已就绪'),
      );
    }
    return h(
      Button,
      {
        variant: 'outline',
        size: 'sm',
        disabled: pending === 'runtime',
        onClick: () => void runtimeAction('prepareRuntime'),
      },
      '准备运行时',
    );
  })();

  return h(
    'div',
    { className: 'dsh-whale-page' },

    row(
      'enabled',
      '启用桌宠',
      '一只随 Harness 工作状态变化的蓝色大肥鱼。',
      h(Switch, {
        checked: enabled,
        disabled: pending === 'enabled',
        label: '启用桌宠',
        onChange: (next) => void mutate('enabled', 'updateSettings', { enabled: next }),
      }),
    ),

    row(
      'status',
      '运行状态',
      null,
      h(
        'div',
        { className: 'dsh-whale-status' },
        h(StateDot, { state: status.state }),
        h('span', null, status.text),
        snapshot?.animation === undefined ? null : h('span', null, `· ${String(snapshot.animation)}`),
      ),
      status.detail,
    ),

    showRuntimeRow
      ? row(
          'runtime',
          '运行环境',
          '桌宠窗口需要 Electron 运行时（100–150 MB，随平台而定）。官方源不通时会自动改用国内镜像。',
          runtimeControl,
          prepareFailed ? prepare?.error ?? null : null,
        )
      : null,

    row(
      'scale',
      '显示大小',
      '影响桌面鲸鱼的显示比例。',
      h(SegmentedControl, {
        id: 'dsh-whale-scale',
        label: '显示大小',
        value: scaleToPreset(scale),
        disabled: pending === 'scale' || !enabled,
        options: SCALE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
        onChange: (next) => void mutate('scale', 'updateSettings', { scale: presetToScale(next) }),
      }),
    ),

    row(
      'look',
      '眼睛跟随鼠标',
      '鼠标移到它身上时，它会转过来看你（待机时才会，最多 10 秒）。',
      h(Switch, {
        checked: lookAtCursor,
        disabled: pending === 'look' || !enabled,
        label: '看向鼠标',
        onChange: (next) => void mutate('look', 'updateSettings', { lookAtCursor: next }),
      }),
    ),

    row(
      'bubbles',
      '气泡提示',
      '显示当前任务状态：第一行会话标题，第二行正在做什么。',
      h(Switch, {
        checked: bubbles,
        disabled: pending === 'bubbles' || !enabled,
        label: '气泡提示',
        onChange: (next) => void mutate('bubbles', 'updateSettings', { bubbles: next }),
      }),
    ),

    row(
      'actions',
      '操作',
      null,
      h(
        'div',
        { className: 'dsh-whale-actions' },
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            disabled: pending === 'action:greeting' || !enabled,
            onClick: () => void mutate('action:greeting', 'command', { action: 'greeting' }),
          },
          '打个招呼',
        ),
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            disabled: pending === 'action:reload' || !enabled,
            onClick: () => void mutate('action:reload', 'command', { action: 'reload' }),
          },
          '重载素材',
        ),
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            disabled: pending === 'action:reset-position' || !enabled,
            onClick: () => void mutate('action:reset-position', 'command', { action: 'reset-position' }),
          },
          '重置位置',
        ),
        h(
          Button,
          {
            variant: 'outline',
            size: 'sm',
            disabled: pending === 'action:restart',
            onClick: () => void mutate('action:restart', 'command', { action: 'restart' }),
          },
          '重启窗口',
        ),
      ),
    ),

    error === null ? null : h('div', { className: 'dsh-whale-alert', role: 'alert' }, error),
  );
}

/** 需要的客户端服务。 */
const inject = ['slots', 'connection'];

/**
 * 注册设置页与自有样式。
 * @param {object} ctx 客户端根上下文
 */
function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-cyberwhale';
    tag.textContent = CSS;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, 'deskpet: styles');

  const call = createCaller(ctx);

  try {
    ctx.slots.inject(SLOT, () =>
      ctx.slots.register(
        {
          name: SLOT,
          id: SECTION_ID,
          order: ORDER,
          // 标签用函数形式：切换语言时会重新求值，不需要重新注册。
          label: () => '桌宠',
        },
        () => React.createElement(WhalePetSection, { call }),
      ),
    );
  } catch (error) {
    // 目标 slot 未声明时只警告，绝不拖垮客户端启动。
    ctx.logger?.warn?.('桌宠设置页注册失败：%s', error instanceof Error ? error.message : String(error));
  }
}

module.exports = { inject, apply };

return module.exports; } });

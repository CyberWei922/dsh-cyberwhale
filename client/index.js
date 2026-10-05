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
 *
 * 例外：设置面板在「美化」开启时由 `client/settings-css.js` 按客户端系统选择样式。
 * macOS 使用 `settings-macos-css.js`（左导航磨砂、右侧不透明、小型开关）。
 * Windows 预留 `settings-windows-css.js`，暂用官方观感。这里只用官方语义锚点
 * （`data-shortcut-modal`、`role="switch"`、`aria-checked`、原生 `<nav>`），
 * 不依赖任何 CSS Module 哈希类名，官方升级后最坏也只是静默回落到官方原样。
 */

// 由工厂注入的 require —— 解析来自页面的模块表，不打包任何 Harness Client 包。
const React = require('react');
const { Button, DisclosureRow, Modal, SegmentedControl, StateDot, Switch } = require('@deepseek-ai/dsh-client-ui-primitives');
const { createAppearanceController } = require('./appearance-runtime.js');
const { AppearancePage } = require('./appearance-page.js');
const { CSS: APPEARANCE_CSS } = require('./appearance-css.js');
const { CSS: SETTINGS_CSS } = require('./settings-css.js');

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
/**
 * 档位预设。锚点是 Codex 桌宠的显示尺寸（112.6 CSS px）—— 它对应我们
 * 逻辑单元格 192 的 0.60 档，所以拿它当「中」，其余按接近等比铺开：
 *
 *   小 0.45（86 px，比 Codex 小 23%）
 *   中 0.60（115 px，= Codex）
 *   大 0.85（163 px）
 *   特大 1.20（230 px）
 *
 * 上限压在 1.2 而不是原来的 1.6：1.6 下图集要放大 3.2 倍（明显发糊），
 * 而且窗口会大占屏幕。1.2 时图集的放大只有 1.31 倍。
 */
const SCALE_PRESETS = [
  { value: 'small', label: '小', scale: 0.45 },
  { value: 'medium', label: '中', scale: 0.6 },
  { value: 'large', label: '大', scale: 0.85 },
  { value: 'huge', label: '特大', scale: 1.2 },
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

/* 组合包详情页里的准备面板（plugins.bundle.config）。
   这里是官方页面插进来的一块，所以只做纵向排布，不加外框和分隔线。 */
.dsh-whale-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0;
  color: var(--dsw-alias-label-primary);
}
.dsh-whale-panel-actions { display: flex; gap: 8px; }
.dsh-whale-estimate {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 20px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dsh-whale-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}
.dsh-whale-step {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.dsh-whale-step-name { color: var(--dsw-alias-label-primary); }
.dsh-whale-step-metric { margin-left: auto; }

@media (prefers-reduced-motion: reduce) {
  .dsh-whale-page * { transition: none !important; animation: none !important; }
  .dsh-whale-panel * { transition: none !important; animation: none !important; }
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
  const bubbleGlass = settings?.bubbleGlass ?? false;
  const bubbleGlassState = runtime?.bubbleGlass;
  const runtimeSource = settings?.runtimeSource ?? 'mirror';

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
          '桌宠窗口需要 Electron 运行时（100–150 MB，随平台而定）。下载源在下面选。',
          runtimeControl,
          prepareFailed ? prepare?.error ?? null : null,
        )
      : null,

    showRuntimeRow
      ? row(
          'runtime-source',
          '运行时下载源',
          '国内网络选「国内镜像」（npmmirror，实测 4.6 MB/s）；有加速器或国外网络选「官方源」。',
          h(SegmentedControl, {
            id: 'dsh-whale-runtime-source',
            label: '运行时下载源',
            value: runtimeSource,
            disabled: pending === 'runtimeSource',
            options: [
              { value: 'mirror', label: '国内镜像' },
              { value: 'official', label: '官方源' },
            ],
            onChange: (next) => void mutate('runtimeSource', 'updateSettings', { runtimeSource: next }),
          }),
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
      'bubbleGlass',
      '气泡液态玻璃',
      bubbleGlassState?.supported === false ? (bubbleGlassState.reason ?? '当前系统不支持，使用普通气泡。')
        : bubbleGlassState?.reason ?? 'Apple 原生 Liquid Glass，仅支持 macOS 26 及以上；关闭后恢复普通气泡。',
      h(Switch, {
        checked: bubbleGlass,
        disabled: pending === 'bubbleGlass' || !enabled || !bubbles || (bubbleGlassState?.supported === false && !bubbleGlass),
        label: '气泡液态玻璃',
        onChange: (next) => void mutate('bubbleGlass', 'updateSettings', { bubbleGlass: next }),
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

/**
 * 插件页那两个界面的共享状态订阅。
 *
 * 为什么单独做一个、而不复用设置页那套：启用引导弹窗与组合包详情面板会
 * **同时挂在插件页上**，各拉各的会把同一个 RPC 打成两倍；而它们和设置页
 * 不会同时出现，所以没必要合并成一个全局 store。无人订阅时自动停表。
 *
 * @param {(endpoint: string, payload?: unknown) => Promise<any>} call
 */
function createPluginPageStore(call) {
  const listeners = new Set();
  let state = { snapshot: null, error: null };
  let timer = null;
  let interval = POLL_MS;
  let inFlight = false;

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const put = (next) => {
    state = { ...state, ...next };
    emit();
  };

  /** 准备中要看得见进度，其余时候没必要那么勤。 */
  function retune() {
    const wanted = state.snapshot?.runtime?.prepare?.status === 'running' ? FAST_POLL_MS : POLL_MS;
    if (timer !== null && wanted === interval) return;
    interval = wanted;
    if (timer !== null) clearInterval(timer);
    timer = setInterval(() => void refresh(), interval);
  }

  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    try {
      put({ snapshot: await call('getState'), error: null });
    } catch (cause) {
      put({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      inFlight = false;
      retune();
    }
  }

  return {
    read: () => state,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        retune();
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    /**
     * 调用一个「立刻返回、活在后台」的端点，并把返回的快照合并进来。
     * 宿主已经把全部状态塞在 `prepare` 里了，不必再拉一次 getState。
     */
    async send(endpoint, payload) {
      try {
        const value = await call(endpoint, payload ?? {});
        const current = state.snapshot;
        if (value !== null && typeof value === 'object' && value.prepare !== undefined && current !== null) {
          put({
            snapshot: { ...current, runtime: { ...(current.runtime ?? {}), prepare: value.prepare } },
            error: null,
          });
        } else {
          put({ error: null });
        }
      } catch (cause) {
        put({ error: cause instanceof Error ? cause.message : String(cause) });
        await refresh();
      }
    },
  };
}

/**
 * 订阅 {@link createPluginPageStore} 的 hook。
 * @param {ReturnType<typeof createPluginPageStore>} store
 */
function usePluginPageState(store) {
  const [state, setState] = React.useState(store.read());
  React.useEffect(() => store.subscribe(() => setState(store.read())), [store]);
  return state;
}

/** 步骤 kind → 中文。宿主只报 kind，怎么显示留在客户端。 */
const STEP_TEXT = {
  check: '检查本机运行时',
  download: '下载 Electron',
  verify: '校验文件',
  extract: '解包运行时',
};

/** 步骤状态 → 官方 StateDot 的语义。 */
function stepTone(step) {
  if (step.status === 'done') return 'done';
  if (step.status === 'failed') return 'error';
  if (step.status === 'cancelled') return 'idle';
  return 'ongoing';
}

/** 毫秒 → 「N 秒」/「N 分 M 秒」。 */
function durationText(from, to) {
  const seconds = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/**
 * 一步的右侧度量。
 *
 * 对齐官方准备模型：**下载步报真实字节，其他步报已等待时间** —— 校验和解包
 * 没有可靠的进度，硬凑一个百分比只会骗人。
 */
function stepMetric(step, now) {
  if (step.kind === 'download') {
    if (step.total > 0) return `${megabytes(step.received)} / ${megabytes(step.total)} MB`;
    if (step.received > 0) return `${megabytes(step.received)} MB`;
  }
  return durationText(step.startedAt, step.finishedAt ?? (step.status === 'running' ? now : step.startedAt));
}

/**
 * 组合包详情页里的「运行环境」面板（slot `plugins.bundle.config`）。
 *
 * 官方约定：启用引导只负责把人带到详情页，**真正开始下载必须由用户在这里
 * 再点一次** —— 不能「点一下启用」就悄悄下载上百 MB。
 *
 * @param {{ store: ReturnType<typeof createPluginPageStore> }} props
 */
function BundlePreparePanel(props) {
  const { store } = props;
  const { snapshot, error } = usePluginPageState(store);
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  const runtime = snapshot?.runtime ?? null;
  const prepare = runtime?.prepare ?? null;
  const running = prepare?.status === 'running';
  const failed = prepare?.status === 'failed';
  const steps = Array.isArray(prepare?.steps) ? prepare.steps : [];
  const current = steps.find((step) => step.status === 'running') ?? steps[steps.length - 1] ?? null;
  // 「本机真的没有运行时」才需要下载；路径写错之类的失败理由不该被这个按钮糊过去。
  const missing = runtime?.provisionable === true;
  const ready = runtime !== null && !missing && runtime.error === null && !running;

  // 「已等待 N 秒」要一个秒级时钟；只在跑的时候开。
  React.useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const send = (endpoint) => {
    setBusy(true);
    void store.send(endpoint, {}).finally(() => setBusy(false));
  };

  const h = React.createElement;
  const summary = running && current !== null
    ? `${STEP_TEXT[current.kind] ?? current.kind} · ${stepMetric(current, now)}`
    : failed
      ? '准备失败'
      : '尚未准备';

  return h(
    'div',
    { className: 'dsh-whale-panel' },

    h(
      'div',
      { className: 'dsh-whale-text' },
      h('div', { className: 'dsh-whale-title' }, '运行环境'),
      h(
        'div',
        { className: 'dsh-whale-description' },
        '桌宠窗口跑在独立的 Electron 进程里，需要一份 Electron 运行时（100–150 MB，随平台而定）。'
          + '安装包不含它；本机已有 Electron 缓存时会直接复用，不必下载。',
      ),
    ),

    // 估算只在还没开始准备时给 —— 跑起来之后这些数字就没用了。
    missing && !running && steps.length === 0
      ? h(
          'div',
          { className: 'dsh-whale-estimate' },
          h('span', null, '下载 100–150 MB'),
          h('span', null, '解包后约 350 MB'),
          h('span', null, '约 1–5 分钟'),
        )
      : null,

    steps.length > 0
      ? h(
          'div',
          null,
          h(DisclosureRow, {
            icon: h(StateDot, { state: running ? 'ongoing' : failed ? 'error' : 'done' }),
            title: summary,
            open: expanded,
            expandable: true,
            expandOnRowClick: true,
            onToggle: () => setExpanded((value) => !value),
          }),
          expanded
            ? h(
                'ul',
                { className: 'dsh-whale-steps' },
                steps.map((step, index) =>
                  h(
                    'li',
                    { className: 'dsh-whale-step', key: `${step.kind}-${index}` },
                    h(StateDot, { state: stepTone(step) }),
                    h('span', { className: 'dsh-whale-step-name' }, STEP_TEXT[step.kind] ?? step.kind),
                    h('span', { className: 'dsh-whale-step-metric' }, stepMetric(step, now)),
                  ),
                ),
              )
            : null,
        )
      : null,

    ready
      ? h(
          'div',
          { className: 'dsh-whale-status' },
          h(StateDot, { state: 'done' }),
          h('span', null, '运行环境已就绪'),
        )
      : h(
          'div',
          { className: 'dsh-whale-panel-actions' },
          running
            ? h(
                Button,
                { variant: 'outline', size: 'sm', disabled: busy, onClick: () => send('cancelRuntime') },
                '取消',
              )
            : h(
                Button,
                { variant: 'primary', size: 'sm', disabled: busy, onClick: () => send('prepareRuntime') },
                failed ? '重试' : '下载并准备',
              ),
        ),

    prepare?.error === null || prepare?.error === undefined
      ? null
      : h('div', { className: 'dsh-whale-alert', role: 'alert' }, String(prepare.error)),
    error === null ? null : h('div', { className: 'dsh-whale-alert', role: 'alert' }, error),
  );
}

/**
 * 启用后的引导弹窗（slot `plugins.bundle.activation`）。
 *
 * 宿主只在用户**显式启用**组合包（或在安装完成界面点「立即启用」）之后渲染它，
 * 并且要求组合包确实 enabled、不在忙、且停在列表页。它只负责把人带到详情页，
 * **不在这里开始下载**。
 *
 * @param {{ store: ReturnType<typeof createPluginPageStore>, onDismiss?: () => void,
 *   onOpenDetails?: () => void }} props
 */
function RuntimeSetupPrompt(props) {
  const { store, onDismiss, onOpenDetails } = props;
  const { snapshot } = usePluginPageState(store);

  const runtime = snapshot?.runtime ?? null;
  const prepare = runtime?.prepare ?? null;
  // 探针还没回来（snapshot 为 null）时先不下判断；已经在准备的也不再打扰。
  const needsSetup = runtime?.provisionable === true && prepare?.status !== 'running';

  // 一旦确认不需要准备就自己关掉 —— 否则这个弹窗会一直挂在插件页上。
  React.useEffect(() => {
    if (snapshot !== null && !needsSetup) onDismiss?.();
  }, [snapshot, needsSetup, onDismiss]);

  const h = React.createElement;
  return h(
    Modal,
    {
      open: needsSetup,
      title: '使用桌宠前需要准备运行环境',
      closeLabel: '取消',
      onClose: onDismiss,
      // 不用 React.Fragment：官方模块表给的是 `react` 本身，但测试替身不导出它，
      // 数组形式的 children 在两边都成立。
      footer: [
        h(Button, { key: 'later', variant: 'ghost', onClick: onDismiss }, '稍后'),
        h(
          Button,
          { key: 'open', variant: 'primary', 'data-modal-autofocus': true, onClick: onOpenDetails },
          '前往安装',
        ),
      ],
    },
    h(
      'p',
      null,
      '桌宠插件已开启。它需要一个独立的 Electron 运行时（100–150 MB，随平台而定），'
        + '请前往插件详情页查看体积与预计耗时，再开始准备。',
    ),
  );
}

/** 需要的客户端服务。 */
const inject = ['slots', 'connection', 'theme'];

/**
 * 注册设置页与自有样式。
 * @param {object} ctx 客户端根上下文
 */
function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-cyberwhale';
    tag.textContent = CSS + APPEARANCE_CSS + SETTINGS_CSS;
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

  const appearance = createAppearanceController(ctx, call);
  ctx.effect(() => () => appearance.dispose(), 'deskpet: appearance');
  ctx.slots.inject(SLOT, () => ctx.slots.register(
    { name: SLOT, id: 'dsh-cyberwhale-theme', order: ORDER + 1, label: () => '主题' },
    () => React.createElement(AppearancePage, { controller: appearance }),
  ));

  // 插件页里的两个界面。两个 slot 都是 kind:keyed，**key 必须是包名**
  // （插件管理器按组合包名寻址），所以直接复用 SECTION_ID。
  const pageStore = createPluginPageStore(call);
  const pluginPageSlots = [
    ['plugins.bundle.activation', RuntimeSetupPrompt],
    ['plugins.bundle.config', BundlePreparePanel],
  ];
  for (const [name, Component] of pluginPageSlots) {
    try {
      ctx.slots.inject(name, () =>
        ctx.slots.register(
          { name, key: SECTION_ID },
          // 把 store 一起传进去：宿主给的是 packageName / onDismiss / onOpenDetails / view，
          // 我们额外提供共享状态。
          (slotProps) => React.createElement(Component, { ...slotProps, store: pageStore }),
        ),
      );
    } catch (error) {
      ctx.logger?.warn?.('桌宠插件页 %s 注册失败：%s', name, error instanceof Error ? error.message : String(error));
    }
  }
}

module.exports = { inject, apply };

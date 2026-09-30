'use strict';

/**
 * 助手窗口的 preload：只暴露一组最小、明确的能力给渲染进程。
 * 渲染进程没有 Node，也拿不到任意 IPC。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petHost', {
  /** 启动参数（主进程在 whenReady 里写入环境变量）。 */
  config: {
    scale: Number(process.env.DSH_DESKPET_SCALE ?? '1') || 1,
    lookAtCursor: process.env.DSH_DESKPET_LOOK !== '0',
    bubbles: process.env.DSH_DESKPET_BUBBLES !== '0',
  },

  /** 读取素材（pet.json + 图集字节）。返回结构化克隆对象。 */
  loadAssets: () => ipcRenderer.invoke('pet:load-assets'),

  /** 告诉主进程：现在鼠标是不是在宠物身体上（决定要不要接管点击）。 */
  setInteractive: (next) => ipcRenderer.send('pet:set-interactive', next === true),

  /** 拖拽窗口。 */
  dragStart: (payload) => ipcRenderer.send('pet:drag-start', payload ?? {}),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),

  /** 原生右键菜单。 */
  contextMenu: () => ipcRenderer.send('pet:context-menu'),

  /** 订阅宿主下发的状态。 */
  onState: (listener) => ipcRenderer.on('pet:state', (_event, value, options) => listener(value, options)),
  /** 订阅运行期配置变更。 */
  onConfig: (listener) => ipcRenderer.on('pet:config', (_event, value) => listener(value)),
  /** 订阅「重新加载素材」。 */
  onReload: (listener) => ipcRenderer.on('pet:reload', () => listener()),
  /** 订阅拖拽方向（拖窗口时主进程才知道真实位移方向）。 */
  onDragDirection: (listener) => ipcRenderer.on('pet:drag-direction', (_event, value) => listener(value)),

  /** 订阅光标在窗口坐标系里的位置（主进程用全局光标算，窗口外也能追踪）。 */
  onCursor: (listener) => ipcRenderer.on('pet:cursor', (_event, value) => listener(value)),

  /** 订阅「工作区在窗口坐标系里的矩形」——气泡靠它避让屏幕边缘。 */
  onLayout: (listener) => ipcRenderer.on('pet:layout', (_event, value) => listener(value)),

  /** 订阅宿主提炼好的气泡内容；空字符串表示清空，回到碎碎念。 */
  onBubble: (listener) => ipcRenderer.on('pet:bubble', (_event, value) => listener(value)),

  /** 主进程请求回报气泡/宠物的实际位置（调试用）。 */
  onProbe: (listener) => ipcRenderer.on('pet:probe', () => listener()),

  /** 把气泡/宠物的实际位置回报给主进程。 */
  reportProbe: (data) => ipcRenderer.send('pet:probe-result', data),

  /** 上报渲染层错误：否则渲染进程一挂，窗口就是一片空白且毫无提示。 */
  reportError: (message) => ipcRenderer.send('pet:renderer-error', String(message)),
});

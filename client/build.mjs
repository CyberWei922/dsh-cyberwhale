#!/usr/bin/env node
/**
 * 把 `client/index.js` 包进官方要求的 lazy-CJS 工厂外壳，产出 `lib/client.js`。
 *
 * 官方外壳格式来自 `packages/client/tsdown.client.ts` 的 clientBundle 预设：
 *   banner: window.__ModuleLoader__.load({ id, factory: (require) => {
 *   intro:  var module = { exports: {} }; var exports = module.exports;
 *   footer: return module.exports; } });
 *
 * 这里手写而不是引 tsdown/rolldown：本插件只用到模块表里已有的 `react`，
 * 没有任何需要打包的依赖，所以外壳本身就是全部构建。
 *
 * 用法：node client/build.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'));

const source = await readFile(join(pluginRoot, 'client', 'index.js'), 'utf8');

const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`;
const intro = 'var module = { exports: {} }; var exports = module.exports;';
const footer = 'return module.exports; } });';

const output = [
  '// 由 client/build.mjs 生成 —— 请勿直接编辑；改 client/index.js 后重新构建。',
  banner,
  intro,
  source,
  footer,
  '',
].join('\n');

const destination = join(pluginRoot, 'lib', 'client.js');
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, output, 'utf8');

const kb = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
console.log(`客户端插件已构建：${destination}`);
console.log(`  id=${pkg.name}  ${kb} KB`);

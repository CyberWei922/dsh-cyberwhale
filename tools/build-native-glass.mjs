// Prebuild both Mac architectures. Node-API keeps the addon independent of the
// Node / Electron V8 ABI; end users do not need a compiler or Node headers.
import { execFile } from 'node:child_process';
import { access, mkdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const run = promisify(execFile);
if (process.platform !== 'darwin') {
  console.log('原生气泡玻璃仅在 macOS 构建；其他平台使用普通气泡。');
  process.exit(0);
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeBinary = await realpath(process.execPath);
const headers = process.env.DSH_GLASS_NODE_HEADERS ?? join(dirname(nodeBinary), '../include/node');
try { await access(join(headers, 'node_api.h')); }
catch { throw new Error('未找到 Node 开发头文件，请用 DSH_GLASS_NODE_HEADERS 指定 include/node 目录。'); }
const out = join(root, 'helper/native/prebuilds');
await mkdir(out, { recursive: true });
for (const arch of ['arm64', 'x86_64']) {
  const file = join(out, `darwin-${arch === 'x86_64' ? 'x64' : arch}.node`);
  await run('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-bundle', '-undefined', 'dynamic_lookup',
    '-mmacosx-version-min=11.0', '-arch', arch, '-DNAPI_VERSION=3', '-DNODE_GYP_MODULE_NAME=whale_bubble_glass',
    '-I', headers, '-framework', 'AppKit', join(root, 'helper/native/bubble-glass.mm'), '-o', file]);
  await run('codesign', ['--force', '--sign', '-', file]);
  console.log(`原生气泡玻璃已构建：${file}`);
}

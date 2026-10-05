import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDshHome } from './settings.js';
import model from './appearance-model.cjs';

export const MAX_WALLPAPER_BYTES = 2 * 1024 * 1024;
export function decodeWallpaper(dataURL) {
  if (typeof dataURL !== 'string' || dataURL.length > MAX_WALLPAPER_BYTES * 4 / 3 + 100) throw new Error('背景图片过大，请压缩后重试');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataURL);
  if (!match) throw new Error('只支持 PNG、JPEG 和 WebP 静态图片');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid || bytes.length > MAX_WALLPAPER_BYTES || bytes.length < 16) throw new Error('背景图片内容无效');
  return { bytes, type: `image/${match[1]}`, id: createHash('sha256').update(bytes).digest('hex') };
}

// Serializes writes, rejects stale configurations from other windows, and commits to
// disk before publishing a snapshot. Pet settings are deliberately independent.
export function createAppearanceStore({ home = resolveDshHome() } = {}) {
  const directory = join(home, 'dsh-cyberwhale');
  const wallpapers = join(directory, 'wallpapers');
  const filename = join(directory, 'appearance.json');
  let config = model.normalizeAppearance();
  let revision = randomUUID();
  let loadError = null;
  let persisted = false;
  const ready = (async () => {
    try {
      const saved = JSON.parse(await readFile(filename, 'utf8'));
      config = model.normalizeAppearance(saved.config ?? saved);
      persisted = true;
      if (typeof saved.revision === 'string') revision = saved.revision;
    } catch (error) {
      if (error.code !== 'ENOENT') { loadError = '主题配置读取失败，当前使用默认值；保存将重建配置。'; config.enabled = false; }
    }
  })();
  let queue = ready;
  const snapshot = () => ({ config: structuredClone(config), revision, warning: loadError, persisted });
  const run = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
  return {
    async get() { await queue; return snapshot(); },
    update(payload) { return run(async () => {
      if (payload?.revision !== revision) throw new Error('主题已在另一窗口更新，请重新选择');
      const next = model.normalizeAppearance(payload.config);
      if (next.wallpaper) await readFile(join(wallpapers, `${next.wallpaper.id}.json`));
      const nextRevision = randomUUID();
      await mkdir(directory, { recursive: true });
      const temp = `${filename}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify({ revision: nextRevision, config: next }, null, 2) + '\n', { mode: 0o600 });
        await rename(temp, filename);
      } finally { await rm(temp, { force: true }); }
      config = next; revision = nextRevision; loadError = null; persisted = true;
      return snapshot();
    }); },
    upload(payload) { return run(async () => {
      const image = decodeWallpaper(payload?.dataURL);
      await mkdir(wallpapers, { recursive: true });
      await writeFile(join(wallpapers, `${image.id}.bin`), image.bytes, { mode: 0o600 });
      await writeFile(join(wallpapers, `${image.id}.json`), JSON.stringify({ type: image.type }), { mode: 0o600 });
      // Keep the selected image and recent drafts, bound abandoned-upload cache.
      const files = (await readdir(wallpapers)).filter(f => /^[a-f0-9]{64}\.bin$/.test(f));
      const records = await Promise.all(files.map(async f => ({ f, time: (await stat(join(wallpapers, f))).mtimeMs })));
      for (const { f } of records.sort((a, b) => b.time - a.time).slice(20)) {
        if (f === `${config.wallpaper?.id}.bin` || f === `${image.id}.bin`) continue;
        await rm(join(wallpapers, f), { force: true }); await rm(join(wallpapers, f.replace('.bin', '.json')), { force: true });
      }
      return { id: image.id, name: String(payload?.name ?? '背景图片').slice(0, 100) };
    }); },
    async image(id) {
      await queue;
      if (!/^[a-f0-9]{64}$/.test(id)) return null;
      try {
        const meta = JSON.parse(await readFile(join(wallpapers, `${id}.json`), 'utf8'));
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(meta.type)) return null;
        const bytes = await readFile(join(wallpapers, `${id}.bin`));
        return { bytes, type: meta.type };
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
  };
}

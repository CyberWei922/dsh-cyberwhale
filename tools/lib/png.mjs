/**
 * 最小 PNG 编解码（8 位，非隔行）。
 *
 * 只依赖 node:zlib。支持 color type 0/2/4/6（灰度、RGB、灰度+alpha、RGBA）。
 * 调色板与 16 位图暂不支持 —— 主流绘图模型输出的都是 8 位 RGB/RGBA。
 *
 * @module tools/lib/png
 */

import { inflateSync, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** 是否像一个 PNG。 */
export function isPng(buffer) {
  return buffer.length > 8 && buffer.subarray(0, 8).equals(SIGNATURE);
}

/**
 * 解码 PNG 为 RGBA。
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, data: Buffer, colorType: number, hasAlpha: boolean }}
 *   data 为 RGBA，长度 width*height*4
 */
export function decodePng(buffer) {
  if (!isPng(buffer)) throw new Error('不是 PNG 文件');

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`只支持 8 位色深的 PNG，实际 ${bitDepth}`);
  if (interlace !== 0) throw new Error('不支持隔行（Adam7）PNG');
  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (channels === undefined) throw new Error(`不支持的 PNG 颜色类型 ${colorType}（调色板图请先转成 RGBA）`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let read = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev === null ? 0 : prev[x];
      const c = prev !== null && x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
  }

  // 统一转成 RGBA
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const source = i * channels;
    const target = i * 4;
    if (colorType === 6) {
      rgba[target] = pixels[source];
      rgba[target + 1] = pixels[source + 1];
      rgba[target + 2] = pixels[source + 2];
      rgba[target + 3] = pixels[source + 3];
    } else if (colorType === 2) {
      rgba[target] = pixels[source];
      rgba[target + 1] = pixels[source + 1];
      rgba[target + 2] = pixels[source + 2];
      rgba[target + 3] = 255;
    } else if (colorType === 4) {
      rgba[target] = pixels[source];
      rgba[target + 1] = pixels[source];
      rgba[target + 2] = pixels[source];
      rgba[target + 3] = pixels[source + 1];
    } else {
      rgba[target] = pixels[source];
      rgba[target + 1] = pixels[source];
      rgba[target + 2] = pixels[source];
      rgba[target + 3] = 255;
    }
  }

  return {
    width,
    height,
    data: rgba,
    colorType,
    /** 源文件是否本来就带 alpha 通道（0 与 2 是灰度/RGB，没有透明度信息）。 */
    hasAlpha: colorType === 4 || colorType === 6,
  };
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * 把 RGBA 缓冲编码成 PNG。
 * @param {Buffer} rgba 长度 width*height*4
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 新建一块透明 RGBA 画布。 */
export function createCanvas(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

/**
 * 计算非透明像素的包围盒。
 * @param {{ width: number, height: number, data: Buffer }} image
 * @param {number} [threshold] alpha 阈值
 * @returns {{ left: number, top: number, right: number, bottom: number, width: number, height: number } | null}
 */
export function alphaBounds(image, threshold = 8) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > threshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (right < 0) return null;
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * 用最近邻 + alpha 加权的方式把源图缩放并合成到目标画布。
 *
 * 这里刻意用「面积平均」而不是简单最近邻：缩小时能保住细节，
 * 边缘也不会出现锯齿硬边。
 *
 * @param {{ width: number, height: number, data: Buffer }} source
 * @param {{ width: number, height: number, data: Buffer }} target
 * @param {number} destinationX
 * @param {number} destinationY
 * @param {number} scale
 */
export function drawScaled(source, target, destinationX, destinationY, scale) {
  const outWidth = Math.max(1, Math.round(source.width * scale));
  const outHeight = Math.max(1, Math.round(source.height * scale));

  for (let oy = 0; oy < outHeight; oy += 1) {
    const ty = Math.round(destinationY) + oy;
    if (ty < 0 || ty >= target.height) continue;

    // 该输出行覆盖的源行区间
    const sy0 = (oy / outHeight) * source.height;
    const sy1 = ((oy + 1) / outHeight) * source.height;

    for (let ox = 0; ox < outWidth; ox += 1) {
      const tx = Math.round(destinationX) + ox;
      if (tx < 0 || tx >= target.width) continue;

      const sx0 = (ox / outWidth) * source.width;
      const sx1 = ((ox + 1) / outWidth) * source.width;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;

      const yStart = Math.floor(sy0);
      const yEnd = Math.min(source.height - 1, Math.ceil(sy1) - 1);
      const xStart = Math.floor(sx0);
      const xEnd = Math.min(source.width - 1, Math.ceil(sx1) - 1);

      for (let sy = yStart; sy <= yEnd; sy += 1) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = xStart; sx <= xEnd; sx += 1) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const index = (sy * source.width + sx) * 4;
          const alpha = source.data[index + 3] / 255;
          r += source.data[index] * w * alpha;
          g += source.data[index + 1] * w * alpha;
          b += source.data[index + 2] * w * alpha;
          a += alpha * w;
          weight += w;
        }
      }

      if (weight === 0 || a === 0) continue;

      const coverage = a / weight; // 该输出像素的平均不透明度
      const targetIndex = (ty * target.width + tx) * 4;
      const sourceR = r / a;
      const sourceG = g / a;
      const sourceB = b / a;

      // 与已有内容做 source-over 合成
      const destinationAlpha = target.data[targetIndex + 3] / 255;
      const outAlpha = coverage + destinationAlpha * (1 - coverage);
      if (outAlpha <= 0) continue;

      target.data[targetIndex] = Math.round(
        (sourceR * coverage + target.data[targetIndex] * destinationAlpha * (1 - coverage)) / outAlpha,
      );
      target.data[targetIndex + 1] = Math.round(
        (sourceG * coverage + target.data[targetIndex + 1] * destinationAlpha * (1 - coverage)) / outAlpha,
      );
      target.data[targetIndex + 2] = Math.round(
        (sourceB * coverage + target.data[targetIndex + 2] * destinationAlpha * (1 - coverage)) / outAlpha,
      );
      target.data[targetIndex + 3] = Math.round(outAlpha * 255);
    }
  }
}

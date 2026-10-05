'use strict';
import { QuantizerCelebi, Score, argbFromRgb, hexFromArgb, argbFromHex, themeFromSourceColor } from '@material/material-color-utilities';

async function readImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
  if (file.size > 25 * 1024 * 1024) throw new Error('原图不能超过 25 MB');
  const image = await createImageBitmap(file);
  if (image.width * image.height > 50_000_000) { image.close(); throw new Error('图片像素过大，请先缩小'); }
  try {
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataURL = canvas.toDataURL('image/jpeg', 0.85);
    if (dataURL.length > 2 * 1024 * 1024 * 4 / 3) throw new Error('压缩后图片仍超过 2 MB，请选择更小的图片');
    const sample = document.createElement('canvas'); sample.width = 64; sample.height = 64;
    const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
    sampleCtx.drawImage(image, 0, 0, 64, 64);
    const pixels = sampleCtx.getImageData(0, 0, 64, 64).data;
    // Yield after decode. Quantization is limited to 4096 pixels (no full image).
    await new Promise(resolve => setTimeout(resolve, 0));
    const colors = [];
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] >= 128) colors.push(argbFromRgb(pixels[i], pixels[i + 1], pixels[i + 2]));
    const sources = Score.score(QuantizerCelebi.quantize(colors, 48), { desired: 4 }).map(hexFromArgb);
    return { dataURL, sources };
  } finally { image.close(); }
}
function colorFromImage(source) {
  const theme = themeFromSourceColor(argbFromHex(source));
  const convert = scheme => ({ preset: 'custom', background: hexFromArgb(scheme.background).toUpperCase(), foreground: hexFromArgb(scheme.onBackground).toUpperCase(), accent: hexFromArgb(scheme.primary).toUpperCase() });
  return { light: convert(theme.schemes.light), dark: convert(theme.schemes.dark) };
}
export { readImage, colorFromImage };

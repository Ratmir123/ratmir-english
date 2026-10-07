/**
 * Screenshots for «Подготовка к созвону» (PASS-0.5.5 §2): only PNG, JPEG or WebP leave the device; a screenshot whose long side is over
 * PREP_IMAGE_LONG_SIDE, or that is heavy, is redrawn as a JPEG (0.86) at that size so chat text stays readable and the upload small.
 */
import { PREP_IMAGE_LONG_SIDE, PREP_IMAGE_TYPES, PREP_MAX_IMAGE_BYTES } from '@/lib/preps/types';

/** Untouched below this size when the long side already fits. */
const KEEP_BYTES = 3 * 1024 * 1024;
const QUALITY = 0.86;

export function isPrepImage(file: File): boolean {
  return file.type.startsWith('image/');
}

/** The scale that brings the long side down to `limit` (never up). */
export function prepScale(width: number, height: number, limit = PREP_IMAGE_LONG_SIDE): number {
  const long = Math.max(width, height);
  return long > limit ? limit / long : 1;
}

async function decode(file: File): Promise<{ width: number; height: number; draw: (context: CanvasRenderingContext2D, width: number, height: number) => void; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height), close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight, draw: (context, width, height) => context.drawImage(image, 0, 0, width, height), close: () => undefined };
  } finally { URL.revokeObjectURL(url); }
}

/** A file ready for upload, or an error message in Russian. */
export async function preparePrepImage(file: File): Promise<File> {
  if (!isPrepImage(file)) throw new Error('Это не картинка. Нужны скриншоты переписки.');
  let image;
  try { image = await decode(file); } catch { throw new Error(`Не получилось открыть «${file.name}». Сохрани скриншот как PNG или JPEG.`); }
  try {
    const scale = prepScale(image.width, image.height);
    const keep = scale === 1 && file.size <= KEEP_BYTES && (PREP_IMAGE_TYPES as readonly string[]).includes(file.type);
    if (keep) return file;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    image.draw(context, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size > PREP_MAX_IMAGE_BYTES) throw new Error('size');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { throw new Error(`Скриншот «${file.name}» слишком тяжёлый. Сделай его поменьше.`); }
  finally { image.close(); }
}

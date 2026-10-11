/** Blob, file and URL helpers. Images live as Blobs so history can go to IndexedDB. */

import type { OutputFormat, ReferenceImage, StudioImage } from './types';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const MIME: Record<OutputFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function mimeFor(format: OutputFormat | undefined): string {
  return MIME[format ?? 'png'] ?? 'image/png';
}

export function base64ToBlob(b64: string, format: OutputFormat): Blob {
  const binary = atob(b64.replace(/^data:[^,]+,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeFor(format) });
}

/** Natural pixel size, read without decoding the whole image twice. */
export async function probe(blob: Blob): Promise<{ width: number; height: number }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      /* fall through to the <img> decoder, which also covers formats without bitmap support */
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

export async function makeStudioImage(
  blob: Blob,
  format: OutputFormat,
  extra: Partial<StudioImage> = {},
): Promise<StudioImage> {
  const size = await probe(blob);
  return {
    id: uid(),
    src: URL.createObjectURL(blob),
    blob,
    upstreamUrl: null,
    format,
    bytes: blob.size,
    width: size.width,
    height: size.height,
    ...extra,
  };
}

export function fromUpstreamUrl(url: string, format: OutputFormat): StudioImage {
  return {
    id: uid(),
    src: url,
    blob: null,
    upstreamUrl: url,
    format,
    bytes: 0,
    width: 0,
    height: 0,
  };
}

export async function fileToReference(file: File): Promise<ReferenceImage> {
  const size = await probe(file);
  return {
    id: uid(),
    name: file.name || 'image.png',
    blob: file,
    previewUrl: URL.createObjectURL(file),
    width: size.width,
    height: size.height,
  };
}

export async function urlToReference(url: string, name: string): Promise<ReferenceImage> {
  const response = await fetch(`/api/media?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error(`could not load ${url}`);
  const blob = await response.blob();
  const size = await probe(blob);
  return { id: uid(), name, blob, previewUrl: URL.createObjectURL(blob), width: size.width, height: size.height };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function blobFromSrc(src: string): Promise<Blob> {
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    const response = await fetch(src);
    return response.blob();
  }
  const response = await fetch(`/api/media?url=${encodeURIComponent(src)}`);
  if (!response.ok) throw new Error('could not fetch image bytes');
  return response.blob();
}

export function timestampSlug(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
}

export function imageFilename(
  index: number,
  total: number,
  format: OutputFormat,
  prefix = 'llmimage',
  date = new Date(),
): string {
  const suffix = total > 1 ? `-${index + 1}` : '';
  return `${prefix}-${timestampSlug(date)}${suffix}.${format === 'jpeg' ? 'jpg' : format}`;
}

/** Canvas -> PNG with an alpha channel: painted pixels become transparent (the edit region). */
export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('could not encode the mask to PNG'));
    }, 'image/png');
  });
}

export function releaseImage(image: StudioImage): void {
  if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
}

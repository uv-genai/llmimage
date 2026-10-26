/** Structured-layout support: the capability constant and the pure emitters.

The engine advertises a dialect string (e.g. "moss") per model on GET /v1/models; this
module owns everything the studio does with it. Elements are stored as fractions of the
canvas (0..1, top-left origin) and converted to absolute pixels only at emit time, so
switching the Size param re-maps placements automatically.
*/
import type { ModelInfo } from './types';

/** The only dialect shipped so far: MOSS-Image layout documents sent as the prompt. */
export const MOSS_DIALECT = 'moss';

export interface LayoutElement {
  id: string;
  kind: 'image' | 'text';
  caption: string;
  /** Fractions of the canvas (0..1); pixels only inside the emitters. */
  x: number;
  y: number;
  w: number;
  h: number;
}

let nextElementId = 0;

export function newElement(kind: 'image' | 'text'): LayoutElement {
  nextElementId += 1;
  const step = (nextElementId * 0.17) % 0.5;
  return {
    id: `el-${nextElementId}`,
    kind,
    caption: kind === 'image' ? 'product photo' : 'headline',
    x: Number((0.08 + step).toFixed(3)),
    y: Number((0.1 + ((nextElementId * 0.23) % 0.4)).toFixed(3)),
    w: 0.3,
    h: 0.22,
  };
}

/** Pixels for a Size value like "1024x1536"; null for "auto" (no concrete canvas). */
export function parseCanvasSize(size: string): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function layoutDialectFor(models: ModelInfo[], id: string): string | undefined {
  return models.find((model) => model.id === id)?.layout;
}

/** MOSS-Image layout document: bbox order yxyx ([yMin, xMin, yMax, xMax]) in pixel
coordinates with the canvas centre as origin (the "abs_centralized" space — a 1024x1024
canvas spans -512..+512). It travels as an ordinary prompt string; nothing here is
validated server-side, by design.
*/
export function toMossJson(elements: LayoutElement[], width: number, height: number): string {
  const items = elements.map((element) => ({
    label: element.kind,
    caption: element.caption,
    bbox: [
      Math.round((element.y - 0.5) * height),
      Math.round((element.x - 0.5) * width),
      Math.round((element.y + element.h - 0.5) * height),
      Math.round((element.x + element.w - 0.5) * width),
    ],
  }));
  const doc = {
    summary: {
      caption: `Poster with ${items.length} placed element${items.length === 1 ? '' : 's'}: ${items
        .map((item) => `${item.label} "${item.caption}"`)
        .join('; ')}.`,
    },
    items,
    bbox_format: 'yxyx',
    bbox_coord_space: 'abs_centralized',
  };
  return JSON.stringify(doc, null, 2);
}

const VERTICAL = ['top', 'middle', 'bottom'];
const HORIZONTAL = ['left', 'centre', 'right'];

function region(element: LayoutElement): string {
  const vertical = VERTICAL[Math.min(2, Math.floor((element.y + element.h / 2) * 3))];
  const horizontal = HORIZONTAL[Math.min(2, Math.floor((element.x + element.w / 2) * 3))];
  return horizontal === 'centre' ? vertical : `${vertical}-${horizontal}`;
}

/** Best-effort fallback for models without a dialect: spatial words the text encoder may
or may not obey. Coarse by intent — these models read regions, not coordinates.
*/
export function toNaturalLanguage(elements: LayoutElement[]): string {
  if (!elements.length) return '';
  const parts = elements.map(
    (element) => `${element.kind === 'image' ? 'An image' : 'The text'} "${element.caption}" in the ${region(element)} region`,
  );
  return `Layout: ${parts.join('; ')}.`;
}

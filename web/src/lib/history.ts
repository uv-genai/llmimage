/** Run history in IndexedDB.

Images are kept as Blobs (not data URLs), which is what lets a session with hundreds of
1024×1024 PNGs fit — localStorage would blow its quota on the first one.
*/

import { createStore, del, entries, set } from 'idb-keyval';
import { downloadBlob } from './images';
import type { RunRecord } from './types';

const store = createStore('llmimage', 'runs');

export async function listRuns(): Promise<RunRecord[]> {
  const pairs = await entries(store);
  return pairs
    .map(([, value]) => value as RunRecord)
    .filter((run) => run && typeof run.id === 'string')
    .sort((left, right) => right.createdAt - left.createdAt);
}

export async function saveRun(run: RunRecord, limit: number): Promise<RunRecord[]> {
  await set(run.id, run, store);
  const all = await listRuns();
  for (const stale of all.slice(Math.max(1, limit))) {
    await del(stale.id, store);
  }
  return listRuns();
}

export async function deleteRun(id: string): Promise<void> {
  await del(id, store);
}

export async function clearRuns(): Promise<void> {
  for (const run of await listRuns()) await del(run.id, store);
}

/** Metadata only — the pixels stay in IndexedDB. */
export function exportHistoryJson(runs: RunRecord[]): void {
  const payload = runs.map((run) => ({
    id: run.id,
    created: new Date(run.createdAt).toISOString(),
    kind: run.kind,
    model: run.model,
    prompt: run.prompt,
    endpoint: run.baseUrl,
    duration_ms: Math.round(run.durationMs),
    usage: run.usage ?? null,
    revised_prompt: run.revisedPrompt ?? null,
    output_format: run.outputFormat ?? null,
    images: run.images.map((image) => ({
      format: image.format,
      width: image.width,
      height: image.height,
      bytes: image.blob.size,
    })),
    params: run.params,
  }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `llmimage-history-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function historySize(): Promise<number> {
  const runs = await listRuns();
  return runs.reduce((total, run) => total + run.images.reduce((sum, image) => sum + image.blob.size, 0), 0);
}

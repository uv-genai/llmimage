import { useEffect, useMemo, useState } from 'react';
import { Download, FileJson, Images, Search, Trash2, WandSparkles } from 'lucide-react';
import { Drawer, EmptyState, useToast } from './ui';
import { exportHistoryJson } from '../lib/history';
import { downloadBlob } from '../lib/images';
import { formatBytes, formatDuration, relativeTime } from '../lib/format';
import type { RunRecord } from '../lib/types';
import type { Studio } from '../lib/useStudio';

export function HistoryDrawer({ studio }: { studio: Studio }) {
  const { history } = studio;
  const [query, setQuery] = useState('');
  const toast = useToast();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return history;
    return history.filter(
      (run) =>
        run.prompt.toLowerCase().includes(needle) ||
        run.model.toLowerCase().includes(needle) ||
        run.kind.includes(needle),
    );
  }, [history, query]);

  // Thumbnails need object URLs; they are revoked when this drawer unmounts.
  const thumbs = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of filtered) if (run.images[0]) map.set(run.id, URL.createObjectURL(run.images[0].blob));
    return map;
  }, [filtered]);

  useEffect(() => {
    return () => thumbs.forEach((url) => URL.revokeObjectURL(url));
  }, [thumbs]);

  const totalBytes = history.reduce((sum, run) => sum + run.images.reduce((inner, image) => inner + image.blob.size, 0), 0);

  return (
    <Drawer
      open={studio.drawer === 'history'}
      title={`History · ${history.length} run${history.length === 1 ? '' : 's'}`}
      onClose={() => studio.setDrawer(null)}
      width={460}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="hint tabular">{formatBytes(totalBytes)} stored in this browser</span>
          <span className="flex gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => {
                exportHistoryJson(history);
                toast.push({ kind: 'ok', title: 'Exported metadata JSON' });
              }}
              disabled={!history.length}
            >
              <FileJson size={12} /> Export
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void studio.forgetAll()}
              disabled={!history.length}
            >
              <Trash2 size={12} /> Clear
            </button>
          </span>
        </div>
      }
    >
      <div className="relative mb-3">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
        <input
          className="input pl-8"
          placeholder="Search prompts, models…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {!filtered.length ? (
        <EmptyState icon={<Images size={18} />} title={history.length ? 'No match' : 'No runs yet'}>
          {history.length ? 'Nothing matches that search.' : 'Every generated result is stored here with its parameters.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {filtered.map((run) => (
            <HistoryItem key={run.id} run={run} studio={studio} thumb={thumbs.get(run.id)} />
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function HistoryItem({ run, studio, thumb }: { run: RunRecord; studio: Studio; thumb?: string }) {
  const toast = useToast();
  return (
    <li className="flex gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--sunken)] p-2">
      <button
        type="button"
        onClick={() => studio.showRun(run)}
        className="checker h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--border)]"
        title="Show this result"
      >
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="chip">{run.kind}</span>
          <span className="truncate text-[11px] text-[var(--faint)]">
            {relativeTime(run.createdAt)} · {formatDuration(run.durationMs)}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug">{run.prompt || <em className="text-[var(--faint)]">no prompt</em>}</p>
        <p className="mt-1 truncate text-[11px] text-[var(--faint)]">
          {run.model || 'no model'} · {run.images.length} img · {run.params.size}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <button type="button" className="btn btn-ghost" title="Show this result in the stage" onClick={() => studio.showRun(run)}>
            View
          </button>
          <button type="button" className="btn btn-ghost" title="Load these parameters" onClick={() => studio.reuseRun(run)}>
            <WandSparkles size={11} /> Reuse
          </button>
          {run.references?.length ? (
            <button
              type="button"
              className="btn btn-ghost"
              title={`Reload the ${run.references.length} input image(s)`}
              onClick={() => void studio.loadRunInputs(run)}
            >
              Inputs
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            title="Download every image from this run"
            onClick={() => {
              run.images.forEach((image, index) =>
                downloadBlob(image.blob, `llmimage-${run.id}-${index + 1}.${image.format === 'jpeg' ? 'jpg' : image.format}`),
              );
              toast.push({ kind: 'ok', title: `Downloaded ${run.images.length} image(s)` });
            }}
          >
            <Download size={11} />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            title="Delete this run"
            onClick={() => void studio.forgetRun(run.id)}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </li>
  );
}

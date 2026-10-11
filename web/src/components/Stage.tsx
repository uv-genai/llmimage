import {
  Braces,
  CircleAlert,
  Copy,
  Download,
  ImagePlus,
  Sparkles,
  Timer,
  WandSparkles,
  ZoomIn,
} from 'lucide-react';
import { EmptyState, useTicker, useToast } from './ui';
import { formatBytes, formatClock, formatDuration } from '../lib/format';
import type { StudioImage, Usage } from '../lib/types';
import type { Studio } from '../lib/useStudio';

export function Stage({ studio }: { studio: Studio }) {
  const { run, running, shownImages, params, resolvedBaseUrl } = studio;
  const toast = useToast();
  useTicker(running);
  const elapsed = running && run.startedAt ? (Date.now() - run.startedAt) / 1000 : 0;
  const partials = run.partials;

  return (
    <main className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-3 py-2">
        <span className="chip chip-accent">/v1/{studio.endpoint}</span>
        {params.model ? <span className="chip">{params.model}</span> : <span className="chip">no model set</span>}
        <span className="chip tabular">
          {params.size} · n={params.n}
        </span>
        {params.stream ? <span className="chip">stream · {params.partialImages} previews</span> : null}
        {running ? (
          <span className="chip tabular" style={{ color: 'var(--accent-2)' }}>
            <Timer size={11} /> {formatClock(elapsed)}
          </span>
        ) : null}
        {run.status === 'done' && run.result ? (
          <>
            <span className="chip tabular">{formatDuration(run.result.durationMs)}</span>
            {run.result.streamIgnored ? (
              <span
                className="chip"
                style={{ color: 'var(--warn)' }}
                title="stream: true was sent, but the endpoint replied with plain JSON. Partial previews need a real text/event-stream response, so this gateway rendered without streaming."
              >
                stream ignored
              </span>
            ) : null}
            {run.result.usage?.total_tokens ? (
              <span className="chip tabular" title={usageTitle(run.result.usage)}>
                {run.result.usage.total_tokens} tok
              </span>
            ) : null}
            {run.result.revisedPrompt ? <span className="chip">revised prompt</span> : null}
            {run.result.outputFormat ? <span className="chip uppercase">{run.result.outputFormat}</span> : null}
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {shownImages.length ? (
            <>
              <button
                type="button"
                className="btn"
                title="Copy the prompt"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(params.prompt)
                    .then(() => toast.push({ kind: 'ok', title: 'Prompt copied' }))
                    .catch((error: Error) => toast.push({ kind: 'error', title: 'Clipboard blocked', detail: error.message }));
                }}
              >
                <Copy size={12} /> Prompt
              </button>
              <button type="button" className="btn" onClick={() => studio.setDrawer('curl')} title="Show the curl request">
                <Braces size={12} />
              </button>
              <button type="button" className="btn" onClick={() => void studio.downloadAll(shownImages)} title="Download every image">
                <Download size={12} /> All
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="scroll min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {run.status === 'error' ? <ErrorCard studio={studio} /> : null}

        {running && !partials.length ? <WaitingCard studio={studio} /> : null}

        {partials.length ? (
          <Section label="Streaming previews">
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))' }}>
              {partials.map((image, index) => (
                <ImageCard
                  key={image.id}
                  studio={studio}
                  image={image}
                  list={partials}
                  index={index}
                  badge={`preview ${(image.partialIndex ?? index) + 1}`}
                  dim
                />
              ))}
            </div>
          </Section>
        ) : null}

        {shownImages.length ? (
          <Section label={{ generate: 'Generated images', edit: 'Edited images', vary: 'Variations' }[run.kind]}>
            {run.result?.revisedPrompt ? (
              <p className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--sunken)] px-3 py-2 text-[12px] leading-relaxed text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">Revised prompt · </span>
                {run.result.revisedPrompt}
              </p>
            ) : null}
            <div className="grid gap-3" style={gridFor(shownImages.length)}>
              {shownImages.map((image, index) => (
                <ImageCard key={image.id} studio={studio} image={image} list={shownImages} index={index} />
              ))}
            </div>
          </Section>
        ) : null}

        {run.status === 'idle' && !shownImages.length ? (
          <EmptyState icon={<Sparkles size={20} />} title="Nothing rendered yet">
            <p>
              {resolvedBaseUrl ? (
                <>
                  Requests go to <span className="kbd">{resolvedBaseUrl}</span>. Write a prompt, then{' '}
                  <span className="kbd">Ctrl</span> <span className="kbd">Enter</span>.
                </>
              ) : (
                <>
                  No endpoint configured — open Settings and point the studio at an OpenAI-compatible image API (for
                  example <span className="kbd">http://127.0.0.1:8080/v1</span>).
                </>
              )}
            </p>
            <ul className="mt-3 space-y-1 text-left text-[12px] text-[var(--faint)]">
              <li>· Generate — text to image, with streaming partial previews</li>
              <li>· Edit — up to 16 reference images plus a painted mask</li>
              <li>· Vary — the legacy single-image variations endpoint</li>
              <li>· Paste or drop an image anywhere to send it to Edit</li>
            </ul>
          </EmptyState>
        ) : null}
      </div>
    </main>
  );
}

/** One result fills the pane; four sit two-by-two; more become a dense grid. */
function gridFor(count: number): React.CSSProperties {
  const columns = count === 1 ? 1 : count <= 4 ? 2 : 3;
  return {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    maxWidth: columns === 1 ? 'min(100%, 74vh)' : columns === 2 ? 'min(100%, 1100px)' : undefined,
  };
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="section-title mb-2">{label}</h2>
      {children}
    </section>
  );
}

function WaitingCard({ studio }: { studio: Studio }) {
  useTicker(true, 500);
  const elapsed = studio.run.startedAt ? (Date.now() - studio.run.startedAt) / 1000 : 0;
  const stage = elapsed < 2 ? 'Sending the request' : elapsed < 8 ? 'Waiting for the first byte' : 'Model is working';
  return (
    <Section label={`${stage}…`}>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
          maxWidth: Math.min(4, Math.max(1, studio.params.n)) * 250,
        }}
      >
        {Array.from({ length: Math.max(1, studio.params.n) }).map((_, index) => (
          <div key={index} className="skeleton aspect-square rounded-2xl border border-[var(--border)]" />
        ))}
      </div>
      <p className="hint mt-3 flex items-center gap-2">
        <WandSparkles size={13} className="breathe" />
        Local engines take minutes, not seconds — a 40-step render on CPU-offloaded weights is normal.
      </p>
    </Section>
  );
}

function ErrorCard({ studio }: { studio: Studio }) {
  const error = studio.run.error;
  if (!error) return null;
  // OpenAI-style errors carry the kind in `type`; gateways that use `code` win when present.
  const kind = error.code || error.type || 'upstream_error';
  return (
    <div
      className="rise mb-5 rounded-2xl border p-4"
      style={{
        borderColor: 'color-mix(in oklab, var(--danger) 45%, transparent)',
        background: 'color-mix(in oklab, var(--danger) 10%, transparent)',
      }}
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert size={16} style={{ color: 'var(--danger)', marginTop: 2 }} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">Request failed · {kind}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[var(--muted)]">{error.message}</p>
          <p className="hint mt-2">{adviceFor(kind, error.message)}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn" onClick={() => void studio.runNow()}>
              <WandSparkles size={12} /> Try again
            </button>
            <button type="button" className="btn" onClick={() => studio.setDrawer('curl')}>
              <Braces size={12} /> Inspect request
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function adviceFor(code: string, message: string): string {
  const text = `${code} ${message}`.toLowerCase();
  // Checked first: gateways list every supported field when rejecting one, so later
  // keyword probes would match the enumeration instead of the actual problem.
  if (text.includes('unsupported parameter') || text.includes('unknown parameter')) {
    return 'Your endpoint does not accept that field. Local engines usually reject stream and partial_images — turn streaming off in Settings — or drop the field from Extra JSON.';
  }
  if (text.includes('connect')) return 'The endpoint refused the connection. Start the image service and re-check the base URL.';
  if (text.includes('invalid_api_key') || text.includes('401')) return 'The API key was rejected. Update it in Settings.';
  if (code === 'endpoint_not_found') {
    return 'Nothing answered at that address. The base URL must be the API root (http://host:port/v1), not an endpoint — clear the field to use the endpoint configured on the server. If the message above names a model, fix the model instead.';
  }
  if (text.includes('unsupported_path') || text.includes('404')) return 'Wrong path or base URL — this gateway may mount the image API elsewhere.';
  if (text.includes('429') || text.includes('queue')) return 'The endpoint is busy; single-backend gateways queue callers. Wait and retry.';
  if (text.includes('incomplete_stream')) return 'The upstream died mid-stream. Retry with streaming off to get a clean error body.';
  if (/(size|resolution|dimension|pixel)/.test(text) && /(must|exceed|outside|invalid|multiple|large|small|limit)/.test(text)) {
    return 'That size is outside the model limits (dimension multiples and pixel budget).';
  }
  if (text.includes('timeout')) return 'The request timed out. Raise LLMIMAGE_REQUEST_TIMEOUT or reduce the work per image.';
  if (code === 'invalid_request_error') {
    return 'The provider rejected the request body. If the field in that message is missing from the request preview, it came from Extra JSON.';
  }
  return 'Compare the request preview with your provider’s API — open the request preview to see exactly what was sent.';
}

function ImageCard({
  studio,
  image,
  list,
  index,
  badge,
  dim,
}: {
  studio: Studio;
  image: StudioImage;
  list: StudioImage[];
  index: number;
  badge?: string;
  dim?: boolean;
}) {
  return (
    <figure className="group rise relative overflow-hidden rounded-2xl border border-[var(--border)]" style={{ boxShadow: 'var(--shadow)' }}>
      <button type="button" className="checker flex w-full justify-center" onClick={() => studio.openLightbox(list, index)} title="Open full size">
        <img
          src={image.src}
          alt={studio.params.prompt.slice(0, 60) || 'generated image'}
          className="w-full object-contain transition-transform duration-500 group-hover:scale-[1.01]"
          style={{ maxHeight: '62vh', opacity: dim ? 0.88 : 1 }}
        />
      </button>

      {badge ? (
        <span
          className="chip absolute left-2 top-2"
          style={{ background: 'rgba(6,6,12,.66)', color: '#fff', backdropFilter: 'blur(6px)' }}
        >
          {badge}
        </span>
      ) : null}

      <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <IconAction title="Open full size" onClick={() => studio.openLightbox(list, index)}>
          <ZoomIn size={13} />
        </IconAction>
        <IconAction title="Download" onClick={() => void studio.downloadImage(image, index, list.length)}>
          <Download size={13} />
        </IconAction>
        <IconAction title="Use as edit input" onClick={() => void studio.useAsInput(image, false)}>
          <ImagePlus size={13} />
        </IconAction>
      </div>

      <figcaption className="flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--muted)]">
        <span className="tabular truncate">
          {image.width || '?'}×{image.height || '?'}
          {image.bytes ? ` · ${formatBytes(image.bytes)}` : ''}
        </span>
        <span className="uppercase tracking-wide">{image.format}</span>
      </figcaption>
    </figure>
  );
}

function IconAction({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-lg text-white transition-transform hover:scale-105"
      style={{ background: 'rgba(8,8,14,.72)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.16)' }}
    >
      {children}
    </button>
  );
}

function usageTitle(usage: Usage): string {
  return [
    usage.input_tokens !== undefined ? `input ${usage.input_tokens}` : '',
    usage.output_tokens !== undefined ? `output ${usage.output_tokens}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

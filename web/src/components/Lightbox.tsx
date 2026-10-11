import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, ImagePlus, Maximize2, X } from 'lucide-react';
import { formatBytes, formatDuration } from '../lib/format';
import { useToast } from './ui';
import type { Studio } from '../lib/useStudio';

/** Full-size viewer: wheel to zoom, drag to pan, arrows to page, d to download. */
export function Lightbox({ studio }: { studio: Studio }) {
  const { lightbox, closeLightbox } = studio;
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [metaOpen, setMetaOpen] = useState(true);

  const images = lightbox?.images ?? [];
  const image = images[index];

  useEffect(() => {
    if (lightbox) {
      setIndex(Math.min(lightbox.index, lightbox.images.length - 1));
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [lightbox]);

  const step = useCallback(
    (delta: number) => {
      if (!images.length) return;
      setIndex((current) => (current + delta + images.length) % images.length);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    },
    [images.length],
  );

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLightbox();
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'd' || event.key === 'D') void studio.downloadImage(images[index], index, images.length);
      else if (event.key === 'i' || event.key === 'I') setMetaOpen((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, closeLightbox, step, studio, images, index]);

  if (!lightbox || !image) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex"
      style={{ background: 'rgba(4,4,9,.88)', backdropFilter: 'blur(10px)' }}
      onWheel={(event) => {
        event.preventDefault();
        setZoom((current) => Math.min(8, Math.max(0.2, current * (event.deltaY < 0 ? 1.12 : 0.89))));
      }}
    >
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onPointerDown={(event) => {
          if (zoom === 1) return;
          const start = { x: event.clientX - pan.x, y: event.clientY - pan.y };
          const move = (moveEvent: PointerEvent) => setPan({ x: moveEvent.clientX - start.x, y: moveEvent.clientY - start.y });
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
        onDoubleClick={() => {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }}
      >
        <img
          src={image.src}
          alt={studio.params.prompt.slice(0, 80) || 'generated image'}
          draggable={false}
          className="checker select-none rounded-xl"
          style={{
            maxWidth: '92%',
            maxHeight: '90vh',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: zoom === 1 ? 'transform .2s ease' : 'none',
            cursor: zoom > 1 ? 'grab' : 'zoom-in',
          }}
        />

        {images.length > 1 ? (
          <>
            <NavButton side="left" onClick={() => step(-1)} />
            <NavButton side="right" onClick={() => step(1)} />
            <span className="tabular absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[11.5px] text-white/85" style={{ background: 'rgba(8,8,14,.7)' }}>
              {index + 1} / {images.length} · {Math.round(zoom * 100)}%
            </span>
          </>
        ) : null}

        <div className="absolute right-4 top-4 flex gap-1.5">
          <BarButton title="Copy prompt" onClick={() => void navigator.clipboard.writeText(studio.params.prompt).then(() => toast.push({ kind: 'ok', title: 'Prompt copied' }))}>
            <Copy size={14} />
          </BarButton>
          <BarButton title="Use as edit input" onClick={() => void studio.useAsInput(image, true)}>
            <ImagePlus size={14} />
          </BarButton>
          <BarButton title="Download (D)" onClick={() => void studio.downloadImage(image, index, images.length)}>
            <Download size={14} />
          </BarButton>
          <BarButton title={metaOpen ? 'Hide details (I)' : 'Show details (I)'} onClick={() => setMetaOpen((value) => !value)}>
            <Maximize2 size={14} />
          </BarButton>
          <BarButton title="Close (Esc)" onClick={closeLightbox}>
            <X size={14} />
          </BarButton>
        </div>
      </div>

      {metaOpen ? (
        <aside
          className="scroll w-[320px] shrink-0 overflow-auto border-l border-[var(--border)] p-4"
          style={{ background: 'var(--surface-solid)' }}
        >
          <h3 className="section-title mb-2">Request</h3>
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">{studio.params.prompt || '—'}</p>

          <div className="hairline my-3" />
          <h3 className="section-title mb-2">Result</h3>
          <dl className="space-y-1.5 text-[11.5px]">
            <Row label="Model" value={studio.params.model || '—'} />
            <Row label="Task" value={studio.run.kind} />
            <Row label="Requested" value={studio.params.size} />
            <Row label="Actual" value={`${image.width}×${image.height} · ${image.format.toUpperCase()}`} />
            <Row label="Bytes" value={formatBytes(image.bytes)} />
            {studio.run.result ? <Row label="Took" value={formatDuration(studio.run.result.durationMs)} /> : null}
            {studio.run.result?.usage?.total_tokens ? <Row label="Tokens" value={String(studio.run.result.usage.total_tokens)} /> : null}
            {studio.run.result?.background ? <Row label="Background" value={studio.run.result.background} /> : null}
          </dl>

          {studio.run.result?.revisedPrompt ? (
            <>
              <div className="hairline my-3" />
              <h3 className="section-title mb-2">Revised prompt</h3>
              <p className="text-[12px] leading-relaxed text-[var(--muted)]">{studio.run.result.revisedPrompt}</p>
            </>
          ) : null}

          <div className="hairline my-3" />
          <p className="hint">
            <span className="kbd">←</span> <span className="kbd">→</span> page · wheel zoom · drag pan ·{' '}
            <span className="kbd">D</span> download · <span className="kbd">Esc</span> close
          </p>
        </aside>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[var(--faint)]">{label}</dt>
      <dd className="tabular break-all text-right text-[var(--muted)]">{value}</dd>
    </div>
  );
}

function BarButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-white/90 transition-colors hover:bg-white/15"
      style={{ background: 'rgba(10,10,18,.6)', border: '1px solid rgba(255,255,255,.14)', backdropFilter: 'blur(8px)' }}
    >
      {children}
    </button>
  );
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous image' : 'Next image'}
      className={`absolute top-1/2 -translate-y-1/2 ${side === 'left' ? 'left-4' : 'right-4'} grid h-10 w-10 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/15`}
      style={{ background: 'rgba(10,10,18,.55)', border: '1px solid rgba(255,255,255,.14)', backdropFilter: 'blur(8px)' }}
    >
      {side === 'left' ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
  );
}

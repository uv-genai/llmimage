import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, FlipHorizontal2, Square, Trash2 } from 'lucide-react';
import { canvasToPng, downloadBlob } from '../lib/images';
import { Modal, Segmented, Slider, useToast } from './ui';
import type { Studio } from '../lib/useStudio';

type Tool = 'brush' | 'eraser' | 'rect';

const PAINT = 'rgba(255,64,140,1)';

/** Paint the region an edit may change.

Export follows OpenAI's documented mask format: a PNG whose fully transparent pixels
mark where the model should generate. Providers differ (A1111-style engines read
opaque-white as the edit region), so the Invert toggle flips which side of the alpha
channel the painted region lands on.
*/
export function MaskEditor({ studio }: { studio: Studio }) {
  const { maskTarget, attachMaskBlob, setDrawer, mask } = studio;
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stroke = useRef<{ x: number; y: number } | null>(null);
  const release = useRef<{ x: number; y: number } | null>(null);
  const snapshot = useRef<ImageData | null>(null);

  const [tool, setTool] = useState<Tool>('brush');
  const [brush, setBrush] = useState(64);
  const [invert, setInvert] = useState(false);
  const [marked, setMarked] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const open = Boolean(maskTarget) && studio.drawer === 'mask';

  // Size the paint surface to the image's natural resolution so the exported mask is
  // pixel-aligned with it, regardless of how it is displayed.
  useEffect(() => {
    if (!open || !maskTarget) return;
    const image = new Image();
    image.src = maskTarget.previewUrl;
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth || maskTarget.width || 1024;
      canvas.height = image.naturalHeight || maskTarget.height || 1024;
      imageRef.current = image;
      setReady(true);
      setMarked(null);
    };
  }, [open, maskTarget]);

  const context = () => canvasRef.current?.getContext('2d', { willReadFrequently: true }) ?? null;

  const toCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const recount = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] > 8) painted += 1;
    setMarked(painted / (canvas.width * canvas.height));
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toCanvasPoint(event);
    stroke.current = point;
    snapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = PAINT;
    ctx.fillStyle = PAINT;
    ctx.lineWidth = brush;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool !== 'rect') {
      ctx.beginPath();
      ctx.arc(point.x, point.y, brush / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!stroke.current) return;
    const ctx = context();
    if (!ctx) return;
    const point = toCanvasPoint(event);
    release.current = point;
    if (tool === 'rect') {
      // Preview the rectangle without committing it, so the drag can be resized freely.
      if (snapshot.current) ctx.putImageData(snapshot.current, 0, 0);
      ctx.strokeRect(stroke.current.x, stroke.current.y, point.x - stroke.current.x, point.y - stroke.current.y);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(stroke.current.x, stroke.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    stroke.current = point;
  };

  const onPointerUp = () => {
    const ctx = context();
    const start = stroke.current;
    const end = release.current;
    if (tool === 'rect' && ctx && start && end) {
      if (snapshot.current) ctx.putImageData(snapshot.current, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = PAINT;
      ctx.fillRect(
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.abs(end.x - start.x),
        Math.abs(end.y - start.y),
      );
    }
    stroke.current = null;
    release.current = null;
    snapshot.current = null;
    recount();
  };

  const clearAll = () => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setMarked(0);
  };

  /** Fill everything, then let the user erase what must stay. */
  const fillAll = () => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = PAINT;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setMarked(1);
  };

  const buildMask = useCallback(async (): Promise<Blob | null> => {
    const paint = canvasRef.current;
    const image = imageRef.current;
    if (!paint || !image) return null;
    const output = document.createElement('canvas');
    output.width = paint.width;
    output.height = paint.height;
    const octx = output.getContext('2d');
    const pctx = paint.getContext('2d', { willReadFrequently: true });
    if (!octx || !pctx) return null;
    octx.drawImage(image, 0, 0, output.width, output.height);
    const base = octx.getImageData(0, 0, output.width, output.height);
    const strokes = pctx.getImageData(0, 0, paint.width, paint.height);
    for (let index = 0; index < base.data.length; index += 4) {
      const painted = strokes.data[index + 3] > 8;
      const editable = invert ? !painted : painted;
      base.data[index + 3] = editable ? 0 : 255;
    }
    octx.putImageData(base, 0, 0);
    return canvasToPng(output);
  }, [invert]);

  const apply = async () => {
    const blob = await buildMask();
    if (!blob) return;
    attachMaskBlob(blob);
    setDrawer(null);
    toast.push({
      kind: 'ok',
      title: 'Mask attached',
      detail: `${Math.round((marked ?? 0) * 100)}% of the image marked as editable.`,
    });
  };

  return (
    <Modal
      open={open}
      width={820}
      onClose={() => setDrawer(null)}
      title={
        <span className="flex items-center gap-2">
          Mask · {maskTarget?.name ?? 'image'}
          {mask ? <span className="chip chip-accent">mask attached</span> : null}
        </span>
      }
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const blob = await buildMask();
              if (blob) downloadBlob(blob, 'mask.png');
            }}
            disabled={!ready}
          >
            <Download size={13} /> Download PNG
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={!ready}>
            <Check size={13} /> Use as mask
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            size="sm"
            value={tool}
            onChange={setTool}
            options={[
              { value: 'brush', label: 'Brush' },
              { value: 'eraser', label: 'Eraser' },
              { value: 'rect', label: 'Rectangle' },
            ]}
          />
          <div className="min-w-[160px] flex-1">
            <Slider value={brush} min={6} max={220} step={2} onChange={setBrush} format={(value) => `${value}px`} />
          </div>
          <button type="button" className="btn" onClick={fillAll} title="Mark the whole image">
            <Square size={12} /> Mark all
          </button>
          <button type="button" className="btn" onClick={clearAll} title="Clear the painting">
            <Trash2 size={12} /> Clear
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setInvert((value) => !value)}
            title="Flip which side of the alpha channel the painted region lands on"
            data-on={invert}
            style={invert ? { borderColor: 'var(--accent-2)', color: 'var(--accent-2)' } : undefined}
          >
            <FlipHorizontal2 size={12} /> Invert alpha
          </button>
        </div>

        <div className="checker flex max-h-[52vh] justify-center overflow-auto rounded-2xl border border-[var(--border)] p-2">
          {maskTarget ? (
            <div className="relative" style={{ lineHeight: 0 }}>
              <img
                src={maskTarget.previewUrl}
                alt="image to mask"
                className="pointer-events-none max-h-[48vh] max-w-full object-contain"
              />
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                style={{ opacity: 0.65, mixBlendMode: 'screen' }}
              />
            </div>
          ) : null}
        </div>

        <p className="hint">
          Paint over what the model may change.{' '}
          {invert
            ? 'With Invert alpha on, the painted region stays opaque and everything else becomes transparent.'
            : 'The exported PNG is fully transparent where you painted — that is the region OpenAI-style endpoints regenerate.'}
          {marked !== null ? ` Marked: ${Math.round(marked * 100)}%.` : ''}
        </p>
      </div>
    </Modal>
  );
}

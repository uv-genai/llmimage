import { useRef, useState } from 'react';
import { Braces, LayoutGrid, MessageSquareText, Plus, Trash2, WandSparkles } from 'lucide-react';
import { Collapse } from './ui';
import { MOSS_DIALECT, newElement, parseCanvasSize, toMossJson, toNaturalLanguage } from '../lib/layout';
import type { LayoutElement } from '../lib/layout';
import type { Studio } from '../lib/useStudio';

/** Structured layout: place image/text elements on a canvas matching the Size param.

Coordinates live as fractions and become absolute pixels only on emit, so changing size
re-maps automatically. When the selected model advertises the moss dialect the panel
emits a MOSS layout JSON document (yxyx, centre-origin pixels); for any other model it
renders the same placement as natural language — best effort, since the weights decide
how much they obey. Insert writes into the prompt; the request path never learned about
layout, and never will.
*/
export function LayoutPanel({ studio }: { studio: Studio }) {
  const { params, patch, models } = studio;
  const [elements, setElements] = useState<LayoutElement[]>([]);
  const [selected, setSelected] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvas = parseCanvasSize(params.size);
  const dialect = models.find((model) => model.id === params.model)?.layout;
  const moss = dialect === MOSS_DIALECT;
  const ratio = canvas ? canvas.width / canvas.height : 1;
  const active = elements.find((element) => element.id === selected);

  const update = (id: string, next: Partial<LayoutElement>) =>
    setElements((list) => list.map((element) => (element.id === id ? { ...element, ...next } : element)));

  const add = (kind: 'image' | 'text') => {
    const element = newElement(kind);
    setElements((list) => [...list, element]);
    setSelected(element.id);
  };

  const startGesture = (event: React.PointerEvent, element: LayoutElement, mode: 'move' | 'resize') => {
    event.preventDefault();
    event.stopPropagation();
    setSelected(element.id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const onMove = (moveEvent: PointerEvent) => {
      const x = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (moveEvent.clientY - rect.top) / rect.height));
      if (mode === 'move') {
        update(element.id, {
          x: Math.min(Math.max(0, x - element.w / 2), 1 - element.w),
          y: Math.min(Math.max(0, y - element.h / 2), 1 - element.h),
        });
      } else {
        update(element.id, {
          w: Math.min(Math.max(0.05, x - element.x), 1 - element.x),
          h: Math.min(Math.max(0.05, y - element.y), 1 - element.y),
        });
      }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const emitted = !canvas || !elements.length ? '' : moss ? toMossJson(elements, canvas.width, canvas.height) : toNaturalLanguage(elements);
  const badge = (
    <span className="flex items-center gap-1">
      {dialect ? <span className="chip chip-accent">{dialect}</span> : null}
      {elements.length ? <span className="chip">{elements.length}</span> : null}
    </span>
  );

  return (
    <Collapse title="Layout" badge={badge}>
      <div className="space-y-2.5">
        <div
          ref={canvasRef}
          className="relative overflow-hidden rounded-lg border bg-[var(--sunken)]"
          style={{ aspectRatio: `${ratio}` }}
        >
          {elements.map((element) => (
            <div
              key={element.id}
              role="button"
              tabIndex={0}
              onPointerDown={(event) => startGesture(event, element, 'move')}
              className={`absolute cursor-move rounded-sm border-2 px-1 py-0.5 text-[10px] leading-tight ${
                selected === element.id
                  ? 'border-[var(--accent-2)] bg-[var(--highlight)]'
                  : 'border-[var(--border-strong)] bg-[var(--surface-2)]'
              }`}
              style={{
                left: `${element.x * 100}%`,
                top: `${element.y * 100}%`,
                width: `${element.w * 100}%`,
                height: `${element.h * 100}%`,
              }}
            >
              <span className="pointer-events-none block truncate">
                {element.kind === 'image' ? (
                  <LayoutGrid size={10} className="inline align-middle" />
                ) : (
                  <MessageSquareText size={10} className="inline align-middle" />
                )}{' '}
                {element.caption || element.kind}
              </span>
              {selected === element.id ? (
                <span
                  onPointerDown={(event) => startGesture(event, element, 'resize')}
                  className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border bg-[var(--accent-2)]"
                />
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button type="button" className="btn btn-ghost btn-icon" title="Add an image element" onClick={() => add('image')}>
            <Plus size={13} />
          </button>
          {active ? (
            <>
              <input
                className="input flex-1"
                autoComplete="off"
                value={active.caption}
                placeholder="caption for the selected element"
                onChange={(event) => update(active.id, { caption: event.target.value })}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                title="Remove the selected element"
                onClick={() => {
                  setElements((list) => list.filter((element) => element.id !== selected));
                  setSelected('');
                }}
              >
                <Trash2 size={13} />
              </button>
            </>
          ) : (
            <span className="hint">tap a box to select, drag to move, corner to resize</span>
          )}
        </div>

        {!canvas ? (
          <p className="hint" style={{ color: 'var(--warn)' }}>
            Layout coordinates need a concrete size — nothing is emitted while Size is Auto.
          </p>
        ) : null}

        {emitted ? (
          <details>
            <summary className="cursor-pointer select-none text-[11.5px] text-[var(--muted)]">
              {moss
                ? 'MOSS layout JSON (this model advertises the dialect)'
                : 'Natural-language rendering (this model advertises no layout dialect)'}
            </summary>
            <pre className="scroll mt-1 max-h-40 overflow-auto rounded-lg border p-2 text-[10.5px]">{emitted}</pre>
          </details>
        ) : null}

        <div className="flex items-center justify-end gap-1.5">
          {moss && emitted ? (
            <button
              type="button"
              className="btn btn-ghost"
              title="Insert the natural-language rendering instead of the JSON document"
              onClick={() => patch({ prompt: toNaturalLanguage(elements) })}
            >
              Plain text
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={!emitted}
            title={moss ? 'Insert the layout JSON document into the prompt' : 'Insert the natural-language layout into the prompt'}
            onClick={() => emitted && patch({ prompt: emitted })}
          >
            <span className="flex items-center gap-1.5">
              {moss ? <Braces size={12} /> : <WandSparkles size={12} />} Insert into prompt
            </span>
          </button>
        </div>
      </div>
    </Collapse>
  );
}

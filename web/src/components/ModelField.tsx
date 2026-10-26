import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, RefreshCw, TriangleAlert } from 'lucide-react';
import { SUGGESTED_MODELS } from '../lib/presets';
import type { Studio } from '../lib/useStudio';

/** Model picker: a text field plus a real dropdown of whatever /v1/models returned.

A native <datalist> was unreliable — clicking an option fired no change in Chrome and
Firefox, so selection silently did nothing. A plain list does what the datalist promised:
click a suggestion to fill the field, or type any id the endpoint accepts (free text always
wins, so custom and future models are never blocked).
*/
export function ModelField({ studio }: { studio: Studio }) {
  const { models, modelsStatus, modelsError, params, setModel, refreshModels } = studio;
  const suggestions = models.length ? models.map((model) => model.id) : SUGGESTED_MODELS;
  const selected = models.find((model) => model.id === params.model);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef}>
      <div className="label">
        <span>Model</span>
        <span className="flex items-center gap-1.5">
          {modelsStatus === 'error' ? (
            <span title={modelsError} className="flex items-center gap-1 text-[10.5px] text-[var(--warn)]">
              <TriangleAlert size={11} /> suggestions
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            title="Reload from GET /v1/models"
            onClick={() => void refreshModels(true)}
          >
            <RefreshCw size={12} className={modelsStatus === 'loading' ? 'spin' : undefined} />
          </button>
        </span>
      </div>

      <div className="relative">
        <input
          className="input pr-9"
          // Not a credential field: password managers may otherwise try to autofill this.
          autoComplete="off"
          placeholder={modelsStatus === 'loading' ? 'loading models…' : 'model id, e.g. gpt-image-2'}
          value={params.model}
          onChange={(event) => setModel(event.target.value)}
          onFocus={() => setOpen(true)}
          role="combobox"
          aria-expanded={open}
          aria-controls="model-suggestions"
          aria-autocomplete="list"
        />
        <button
          type="button"
          className="btn btn-ghost btn-icon absolute right-1 top-1/2 -translate-y-1/2"
          title="Show model suggestions"
          aria-label="Show model suggestions"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>

        {open ? (
          <ul
            id="model-suggestions"
            role="listbox"
            className="panel absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-xl border p-1"
          >
            {suggestions.map((id) => {
              const active = id === params.model;
              const dialect = models.find((model) => model.id === id)?.layout;
              return (
                <li key={id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--highlight)]"
                    style={{ color: active ? 'var(--text)' : 'var(--muted)' }}
                    onClick={() => {
                      setModel(id);
                      setOpen(false);
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{id}</span>
                      {dialect ? (
                        <span className="chip chip-accent" title={`structured layout: ${dialect}`}>
                          {dialect}
                        </span>
                      ) : null}
                    </span>
                    {active ? <Check size={12} style={{ color: 'var(--accent-2)' }} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <p className="hint mt-1.5">
        {models.length
          ? `${models.length} model${models.length === 1 ? '' : 's'} reported by this endpoint${
              selected?.description ? ` · ${selected.description}` : ''
            }${selected?.layout ? ` · layout: ${selected.layout}` : ''}`
          : modelsStatus === 'error'
            ? `Models could not be listed (${modelsError}). Type an id or use the suggestions.`
            : 'Pick a suggestion or type any id the endpoint accepts.'}
      </p>
    </div>
  );
}

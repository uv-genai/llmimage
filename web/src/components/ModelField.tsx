import { RefreshCw, TriangleAlert } from 'lucide-react';
import { SUGGESTED_MODELS } from '../lib/presets';
import type { Studio } from '../lib/useStudio';

/** Free-text model field backed by a datalist of whatever /v1/models returned.

A datalist rather than a select because gateways add models constantly, and the list
is sometimes unreachable — typing the id has to stay possible.
*/
export function ModelField({ studio }: { studio: Studio }) {
  const { models, modelsStatus, modelsError, params, setModel, refreshModels } = studio;
  const suggestions = models.length ? models.map((model) => model.id) : SUGGESTED_MODELS;
  const selected = models.find((model) => model.id === params.model);

  return (
    <div>
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
      <input
        className="input"
        list="model-suggestions"
        // Not a credential field: password managers may otherwise try to autofill this.
        autoComplete="off"
        placeholder={modelsStatus === 'loading' ? 'loading models…' : 'model id, e.g. gpt-image-2'}
        value={params.model}
        onChange={(event) => setModel(event.target.value)}
      />
      <datalist id="model-suggestions">
        {suggestions.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <p className="hint mt-1.5">
        {models.length
          ? `${models.length} model${models.length === 1 ? '' : 's'} reported by this endpoint${
              selected?.description ? ` · ${selected.description}` : ''
            }`
          : modelsStatus === 'error'
            ? `Models could not be listed (${modelsError}). Type an id or use the suggestions.`
            : 'Common ids are suggested; type any other the endpoint accepts.'}
      </p>
    </div>
  );
}

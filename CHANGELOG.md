# Changelog

Notable changes per release. Dates are the tag dates.

## 0.1.5 — 2026-10-12

Model selection actually works, and Chrome stops interfering.

- the model field used a `<input list>` + `<datalist>`, which fires no change event when an
  option is clicked — so picking a model silently did nothing in Chrome and Firefox
  (confirmed broken on the original 0.1.0 build, not a recent regression). Replaced with a
  text field plus a real dropdown: a chevron or focusing the field lists `/v1/models`,
  clicking a suggestion fills the field, and typing any custom id still works
- Chrome's password manager paired the API-key input with the model field as an
  email/username and popped a confirm-password prompt. The key now uses
  `autocomplete="new-password"` and the model field `autocomplete="off"`
- the e2e suite asserts that clicking a suggestion selects it (32 checks with an endpoint,
  11 offline)

## 0.1.4 — 2026-10-12

- fixed `llmimage info` and a bare `llmimage` crashing with `AttributeError: 'Namespace'
  object has no attribute 'base_url'` — those flags belong to the `serve` subparser only, so
  every non-`serve` invocation died before doing any work
- documented the whole configuration surface: each `LLMIMAGE_*` variable with its default and
  effect, `serve` flag precedence, `llmimage info` output, the `settings.json` profile schema
  and where it lives per layout, and the fact that `.env` is **not** auto-loaded
- `.env.example` completed with the variables it was missing (`*_ALLOWED_HOSTS` notes,
  `*_MAX_BODY_BYTES`, `*_DATA_DIR`, `*_CONFIG_FILE`, `*_WEB_DIST`)
- four CLI tests (`tests/test_cli.py`); 30 backend tests, 32 browser checks with an endpoint

## 0.1.3 — 2026-10-11

Installable, not just cloneable. Until this, a `pip`/`uv tool` install gave you the API proxy
and **no studio**: the wheel carried only Python, and profiles were aimed at a directory next
to `site-packages`.

- the built SPA now ships inside the wheel at `llmimage/web/dist`, so `uv tool install` /
  `pipx install` needs no Node; `uv build` fails if `web/dist` has not been built rather than
  quietly producing a UI-less package
- connection profiles move to `$XDG_DATA_HOME/llmimage/settings.json` (normally
  `~/.local/share/llmimage`) when installed from a package; a source checkout keeps using
  `./data`, and `LLMIMAGE_DATA_DIR` overrides both
- verified end to end from a clean venv: `/api/health` reports `web_ready: true`, `/` serves
  the studio, and a generation through the installed copy returns an image from imagegen
- five new config tests for the path rules; 26 backend tests in total
- README gained an Install section (wheel URL, `uv tool install`, checkout)

## 0.1.2 — 2026-10-11

Readable text in the dark theme, and the checks that keep it that way.

- `--faint` `#6e6d88` → `#a8a7c2` (**3.79:1 → 8.08:1** on panels), `--muted`
  `#a0a0ba` → `#c5c5da` (7.42 → 11.14), `--text` → `#f4f4fb` (16.41 → 17.28); borders
  strengthened to 0.13/0.24 alpha because the edges were dimmer than the labels
- the browser suite now computes WCAG contrast ratios for both themes instead of trusting
  the palette — 30 checks with an endpoint, 11 offline
- README and AGENTS.md refreshed: coverage list, e2e counts, the 404-rewrite exception to
  verbatim relaying, and the "don't darken the tokens" rule

## 0.1.1 — 2026-10-11

Connecting reliably, and telling the truth about what an endpoint did.

- base URL normalisation collapses repeated endpoint segments, so a pasted or stale
  `…/v1/models/models` resolves to `/v1` instead of 404ing
- clients need only an API key when the server runs with `LLMIMAGE_BASE_URL`; Settings shows
  that endpoint and offers **Use the endpoint configured on the server** to drop a local
  override
- an upstream 404 on a validated image path becomes `endpoint_not_found` naming the URLs that
  were tried, rather than a bare `{"detail":"Not Found"}`
- `stream` that the endpoint silently ignores is reported as `stream ignored`; advice no
  longer misattributes `unsupported parameter` errors to image size
- **Reuse** jumps to the tab the run belonged to, so the restored prompt is visible
- added `scripts/mock_endpoint.py` (stdlib, streams SSE) so the studio can be exercised and
  tested without a provider; `npm run e2e` uses it
- README: pairing guide for `imagegen`, LAN instructions, "If Test connection fails" table

## 0.1.0 — 2026-10-11

First working studio.

- FastAPI relay for `/v1/images/generations|edits|variations|models` that forwards bodies
  verbatim (JSON and multipart) and streams SSE untouched; path allowlist, optional
  `LLMIMAGE_ALLOWED_HOSTS`, credential resolution header → profile → env
- React 19 + Vite + Tailwind v4 studio: Generate / Edit / Vary with shared parameters and
  per-task prompts, the full OpenAI parameter surface plus Extra JSON, a mask editor with
  brush/eraser/zoom/invert and an alpha-convention toggle, live `stream: true` partial
  previews, IndexedDB history, lightbox, masked `curl` preview, light and dark themes
- CLI `llmimage serve|profiles`, serving the built SPA
- 18 proxy tests on real sockets against a stub OpenAI server; scripted browser session for
  generation, mask editing and history

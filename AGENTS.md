# AGENTS.md

Guidance for agents working in this repository.

## Project

`llmimage` — a web studio for any OpenAI-compatible image API (`/v1/images/generations`,
`/edits`, `/variations`, `models`), including `stream: true` partial images. FastAPI proxy
(`src/llmimage/`) + React 19 / Vite / Tailwind v4 SPA (`web/`). The reference local
upstream is the sibling project `../imagegen` (Qwen-Image through an OpenAI-compatible
gateway, default `http://127.0.0.1:8080/v1`).

## Commands

```bash
uv sync                                   # python deps
uv run llmimage serve --port 8765         # backend + built SPA, binds 127.0.0.1
LLMIMAGE_ALLOWED_HOSTS=127.0.0.1,api.openai.com uv run llmimage serve --host 0.0.0.0   # LAN
uv run pytest                             # proxy tests (stub upstream, no GPU needed)

cd web && npm install
npm run dev                               # Vite on :5173, proxies /api and /v1 to :8765
npm run build                             # -> web/dist (the backend serves this)
npm run e2e                               # Playwright/Firefox; needs the app + an endpoint
./scripts/dev.sh                          # backend + Vite together
python3 scripts/mock_endpoint.py --port 8099   # offline upstream (streams partials)
```

`npm run e2e` env: `APP_URL` (default `http://127.0.0.1:8765`), `UPSTREAM_URL`,
`UPSTREAM_KEY`, `UPSTREAM_MODEL`, `E2E_KEEP=1` to leave the browser open. It starts
`scripts/mock_endpoint.py` itself for the streaming and error checks. Without
`UPSTREAM_KEY` the GPU half is skipped (11 offline checks, ~15 s); with it, 32 checks.

## Releasing

Bump `src/llmimage/__init__.py`, `pyproject.toml`, `web/package.json` and the two version
fields in `web/package-lock.json`, then `uv lock` so `uv.lock` agrees. Add a `CHANGELOG.md`
entry, commit, `git tag -a vX.Y.Z -m "…"`, `git push origin master vX.Y.Z`. `/api/health`
reports `__version__`, so restart the running server to match the tag.

Before publishing artifacts: `cd web && npm run build`, then `uv build`, then check the wheel
really contains the UI — `unzip -l dist/*.whl | grep web/dist/index.html`.

The release URL is quoted in the README install section, so a new release means editing that
link too — and it only resolves after `gh release create`.

Quote install commands with the **bare wheel URL**: `uv tool install <url>` and
`pipx install <url>` both work, but pipx rejects `name @ url` and `file://` specs, so the
PEP 508 direct-reference form is uv-only. A plain local path works for both.

## Configuration surface

All server configuration is environment variables — full table in the README: `LLMIMAGE_HOST`,
`LLMIMAGE_PORT`, `LLMIMAGE_BASE_URL`, `LLMIMAGE_API_KEY`, `LLMIMAGE_ALLOWED_HOSTS`,
`LLMIMAGE_REQUEST_TIMEOUT`, `LLMIMAGE_MAX_BODY_BYTES`, `LLMIMAGE_DATA_DIR`,
`LLMIMAGE_CONFIG_FILE`, `LLMIMAGE_WEB_DIST`. `serve` flags (`--host`, `--port`, `--base-url`,
`--api-key`, `--reload`) win over the environment. `llmimage info` prints the resolved values —
run it before debugging a "connection fails" report.

`.env` is **not** auto-loaded; `.env.example` is a template the operator sources
(`set -a; . ./.env; set +a`). Do not add dotenv loading unless it is decided on.

`settings.json` is the profile store: `version: 1`, `active_profile_id`, and a list of
`{id, name, base_url, api_key, headers}`, written `0600` and replaced atomically. The browser's
own state lives in `localStorage` under `llmimage.ui.v2` and never contains a key.

## Architecture rules that matter

- **The proxy relays bodies verbatim.** `web/src/lib/params.ts` builds the request body and
  `bodyShape()` decides JSON vs multipart; `src/llmimage/app.py` forwards it with a copied
  header set (minus hop-by-hop headers) and streams SSE through unchanged. Do not
  re-serialise bodies: provider-specific fields must survive. The one deliberate exception is
  an upstream **404** on a validated image path: `not_found_diagnostic()` replaces the bare
  `{"detail":"Not Found"}` with `endpoint_not_found` plus the URLs that were tried, because
  otherwise a wrong base URL is undiagnosable.
- **Defaults are omitted, non-defaults are sent whole.** Strict gateways reject unknown
  fields — `imagegen` answers 400 `unsupported parameter 'stream'` for the key even when it
  is `false`, so `params.ts` only adds `stream` when it is on. `imagegen` also has no
  `/v1/images/variations` (404) and no SSE; test streaming with `scripts/mock_endpoint.py`.
- **Base URL normalisation** lives in `src/llmimage/upstream.py`: a missing `/v1` is added,
  a pasted endpoint suffix (`…/v1/models`, `…/images/generations`) is cut back to the root
  first (`strip_endpoint_suffix`, otherwise it doubles to `/v1/models/models` -> 404), and on
  a 404 the form without `/v1` is tried once and cached. Keep all three behaviours working.
- **Target resolution** (`_credentials` in `app.py`) is header -> stored profile ->
  `LLMIMAGE_BASE_URL`/`LLMIMAGE_API_KEY`, and the SPA mirrors it (`resolvedBaseUrl` in
  `useStudio.ts` falls back to `/api/config` defaults). The client is never supposed to know
  the engine's address: with `LLMIMAGE_BASE_URL` set, a remote browser needs only the key.
- **A stream the endpoint ignores must stay visible.** `RunOutcome.streamIgnored` is set when
  `stream: true` was sent and the reply was plain JSON (tolerant multipart gateways do this);
  the run header chip and the toast report it. Never let a non-SSE reply pass as streamed.
- **Theme tokens are contrast-tested, not trusted.** The e2e measures `--text`, `--muted` and
  `--faint` against `--surface-solid` in both themes (AA: 4.5:1 for secondary text, 7:1 for
  primary). Darkening them in `globals.css` fails the suite.
- **The wheel ships the studio.** `pyproject.toml` force-includes `web/dist` as
  `llmimage/web/dist`; `config._resolve_web_dist()` prefers a repo checkout and falls back to
  that packaged copy (`LLMIMAGE_WEB_DIST` overrides). Building without a built SPA fails on
  purpose — a wheel without the UI serves an API and nothing else.
- **Profile storage depends on the layout**: `./data/settings.json` inside a checkout,
  otherwise `$XDG_DATA_HOME/llmimage` (`LLMIMAGE_DATA_DIR` wins outright). Never write next to
  `site-packages`.
- **Parameters are shared across the three tabs; prompts are per tab** (settings
  `version: 2`, `llmimage.ui.v2`, with migration from `llmimage.ui.v1`). Switching tabs
  must never change creative settings, and switching endpoints must never drop a typed
  model name (see `fillEmptyModels` — it only fills empty model fields).
- **Credentials:** the key lives in React state for the session and travels via the
  `X-Api-Key` header; the proxy resolves it in `resolve_credential` (header → stored
  profile → `LLMIMAGE_API_KEY`). Never persist a key in `localStorage`, never return one
  from `/api/profiles`, never log it.
- **Multipart edits** put the mask channel last (`image[]` parts then `mask`), matching
  sd.cpp's first-part-is-base assumption. Mask export uses OpenAI semantics (painted =
  transparent) with an in-UI invert toggle for engines that read it the other way.
- **Uploads are downscaled in the browser** (longest edge 2048) and re-encoded; PNG keeps
  alpha, other formats become JPEG.

## Testing discipline

- Backend changes: `uv run pytest` (it runs uvicorn on real sockets and asserts on relay
  fidelity, path normalisation, SSE timing, path allowlist).
- UI changes: rebuild (`npm run build`) and run `npm run e2e` against a running app. The
  e2e script is the only thing that proves streaming, mask painting, and history work in a
  real browser — extend it rather than trusting screenshots.
- Screenshots are written to `/tmp/llmimage-e2e` as JPEGs; keep them small, do not attach
  PNGs of full generations to model context.
- The local GPU path is slow: turbo at 512² is ~10 s, the base model ~90 s. Use
  `qwen-image-2.1-turbo` and `512x512` in tests, and remember an idle backend unload makes
  the first request pay the model load.

## Gotchas

- A stale `data/settings.json` can make the suite fail in ways that look like app bugs: a
  leftover profile with a bogus `base_url` becomes the `active_profile_id`, so `resolvedBaseUrl`
  silently prefers it and Test connection targets the wrong host. When "key alone is enough"
  or a saved-URL recovery check fails unexpectedly, inspect the profile store first — do not
  assume a code regression.
- Playwright `getByText` matches substrings; a strict-mode violation usually means a toast
  and an inline card say the same thing — scope to `main`.
- `pkill -f <pattern>` also matches the shell running it. Bracketing (`[m]ock_endpoint`) only
  helps when that exact literal string appears nowhere else on the same command line —
  killing a listener by PID from `ss -tlnp` is safer.
- A bare `data:` URI in a CSS gradient breaks Lightning CSS; use `rgb(0 0 0 / 0.28)`.
- A mock or stub that pre-renders its SSE payload before writing it does not test
  streaming — it must flush chunk by chunk.

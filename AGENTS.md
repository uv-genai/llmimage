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
`UPSTREAM_KEY` the GPU half is skipped (10 offline checks, ~15 s); with it, 22 checks.

## Architecture rules that matter

- **The proxy relays bodies verbatim.** `web/src/lib/params.ts` builds the request body and
  `bodyShape()` decides JSON vs multipart; `src/llmimage/app.py` forwards it with a copied
  header set (minus hop-by-hop headers) and streams SSE through unchanged. Do not
  re-serialise bodies: provider-specific fields must survive.
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

- Playwright `getByText` matches substrings; a strict-mode violation usually means a toast
  and an inline card say the same thing — scope to `main`.
- `pkill -f <pattern>` also matches the shell running it. Bracketing (`[m]ock_endpoint`) only
  helps when that exact literal string appears nowhere else on the same command line —
  killing a listener by PID from `ss -tlnp` is safer.
- A bare `data:` URI in a CSS gradient breaks Lightning CSS; use `rgb(0 0 0 / 0.28)`.
- A mock or stub that pre-renders its SSE payload before writing it does not test
  streaming — it must flush chunk by chunk.

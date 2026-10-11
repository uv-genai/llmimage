# llmimage

A web studio for **any OpenAI-compatible image API** — generation, multi-image edits with
mask painting, variations, and live `stream: true` partial previews. It exposes the full
parameter surface of the `/v1/images` endpoints (including the fields most UIs hide) and
works with hosted APIs and local gateways alike, such as the sibling
[`imagegen`](../imagegen) service.

Dark, glassy single-page studio. No accounts, no telemetry, no cloud dependency: the
browser talks to a small FastAPI proxy on your machine, which talks to the endpoint you
configure.

## Quick start

```bash
uv sync
cd web && npm install && npm run build && cd ..
uv run llmimage serve            # http://127.0.0.1:8765
```

Open the app, press the connection chip (top right), paste your **base URL** and **API
key**, hit *Test connection*. The health card tells you whether the image API answers and
lists the models it reports.

Try it without a real endpoint:

```bash
python3 scripts/mock_endpoint.py --port 8099      # stdlib only
# base URL: http://127.0.0.1:8099/v1 — any key, model: mock-image
```

The mock streams partial images, so the streaming UI, token usage and error paths can be
exercised offline.

## Pairing it with the local `imagegen` service

```bash
cd ../imagegen
export IMAGEGEN_API_KEYS="sk-studio-test"           # any token you like
uv run imagegen serve --config config/service.toml   # http://127.0.0.1:8080

cd ../llmimage
uv run llmimage serve                               # http://127.0.0.1:8765
```

Open http://127.0.0.1:8765, click the connection chip, set the base URL to
`http://127.0.0.1:8080/v1`, paste the key, press **Test connection** — the chip turns green
and the model field offers `qwen-image-2.1` and `qwen-image-2.1-turbo`.

What that pairing looks like in practice:

- `qwen-image-2.1-turbo` at `512x512` takes ~10–16 s on an RTX 2070; the base model at its
  default 40 steps takes ~90 s. An idle backend unload (5 min) makes the next request pay
  the model load, so the first one after a break is always slower.
- Generations and mask edits work end to end. `negative_prompt` and `strength` are sent when
  set; anything else that backend understands (`sd_cpp`, seeds) goes in Extra JSON and is
  relayed untouched.
- `stream` is rejected in JSON bodies (`unsupported parameter 'stream'`) and **ignored** in
  multipart edits, where the gateway answers with plain JSON. The studio says so — the run
  header shows **stream ignored** instead of pretending partial previews happened. Point it
  at `python3 scripts/mock_endpoint.py --port 8099` (base URL `http://127.0.0.1:8099/v1`,
  any key) to watch real streaming.
- `/v1/images/variations` is not implemented there, so the Vary tab returns a 404 with the
  path advice. The mock supports generations and edits only, so try Vary against a
  provider that implements it.

## What it does

**Generate** — prompt (up to 32 000 chars), negative prompt when the engine supports it,
`n` (1–10), sizes (`1024x1024`, `1536x1024`, `1024x1536`, `auto`, or custom `WxH`),
`quality` (low/medium/high/x-high/max), `background`, `input_fidelity`, `moderation`,
`output_format` (png/jpeg/webp), `output_compression`, `partial_images`, `user`, arbitrary
extra JSON, and `stream`.

**Edit** — attach several reference images in order (they are sent as repeat `image[]`
parts, one `image` part for single-image instructions), then paint a mask on any of them
with brush/eraser, variable sizes, zoom, invert, clear, and an **alpha convention** toggle.
Pixels painted = edit (alpha 0, per OpenAI); flip it for engines that read the opposite.
`strength` is sent only when set, since most servers take it and some strict ones do not.

**Vary** — one reference image, no prompt: the fastest way to sample a model.

**Streaming** — with `stream: true`, each `image_generation.partial_image` event becomes a
progressively refined preview while the request is open; `image_generation.completed`
brings the final image and token usage. Non-streaming calls just wait.

**Everything else** — history with thumbnails, parameters and images in IndexedDB (reuse a
past run with one click), lightbox with metadata and download, a copyable `curl` preview of
the exact request (with the token masked), light/dark themes, and keyboard `Enter` /
`Ctrl+Enter` to run.

## Endpoints and compatibility

| Endpoint | Notes |
| --- | --- |
| `GET /v1/models` | Model picker + connection test; failures are shown, never fatal |
| `POST /v1/images/generations` | JSON body, verbatim passthrough |
| `POST /v1/images/edits` | `multipart/form-data`, repeated `image[]` parts + optional `mask` |
| `POST /v1/images/variations` | `multipart/form-data` |

The body is relayed **verbatim** — provider-specific fields (`sd_cpp`, `negative_prompt`,
`strength`, and anything you add in Extra JSON) reach your engine untouched. Parameters at
their default value are omitted, so strict gateways never see a field they do not know.
Base URLs are normalised: a missing `/v1` is added, and if the first attempt 404s the proxy
retries the other form once and keeps the working variant.

## Security model

- The browser talks only to this proxy (`/api/*`); the proxy adds `Authorization`.
- API keys stay in the tab's memory for the session; the rest of the configuration
  (endpoint URL, parameters, prompts) persists in `localStorage`. Keys are **never**
  written to `localStorage` or sent back to the browser, so a shared machine does not leak
  them. `data/settings.json` (mode `0600`) holds server-side profiles for anyone who
  configures them through the API, and `/api/profiles` only reports masked keys.
- Set `LLMIMAGE_ALLOWED_HOSTS` (comma-separated globs) to stop the proxy being used as a
  general outbound proxy if you ever expose it beyond localhost.
- Serving a bindable address means anyone reachable can spend your image credits.

## Development

```bash
./scripts/dev.sh                     # backend on :8765 + Vite dev server with HMR on :5173
./scripts/build.sh                   # bundle the SPA into web/dist (served by the backend)
uv run pytest                        # proxy tests against a stub OpenAI server
cd web && npm run e2e                # browser test: real GPU endpoint + streaming mock
```

`npm run e2e` drives a real browser (Playwright + Firefox). It skips politely if the app is
not running, and covers: connection test and model list, a generation, the lightbox,
reusing a result as an edit input, parameters carrying across tabs, mask painting and mask
encoding, an edit round-trip, history, the `curl` preview, light theme, streaming partials
and token usage against the bundled mock, and readable upstream errors. Set
`UPSTREAM_URL`, `UPSTREAM_KEY` (and optionally `UPSTREAM_MODEL`) to point it at your engine.
With no `UPSTREAM_KEY` the live half is skipped and only the offline mock checks run.

Layout of the repo:

## License

MIT — see [LICENSE](LICENSE).

## Layout

```
src/llmimage/        FastAPI proxy, config, profiles, CLI
web/src/lib/         API client, parameter model, presets, store, IndexedDB history
web/src/components/  header, controls, stage, mask editor, drawers, lightbox
web/e2e/             scripted browser session
scripts/             dev.sh, build.sh, mock_endpoint.py
tests/               pytest suite for the proxy
```

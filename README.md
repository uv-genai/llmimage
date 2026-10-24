# llmimage

A web studio for **any OpenAI-compatible image API** — generation, multi-image edits with
mask painting, variations, and live `stream: true` partial previews. It exposes the full
parameter surface of the `/v1/images` endpoints (including the fields most UIs hide) and
works with hosted APIs and local gateways alike, such as the sibling
[`imagegen`](../imagegen) service.

Dark, glassy single-page studio. No accounts, no telemetry, no cloud dependency: the
browser talks to a small FastAPI proxy on your machine, which talks to the endpoint you
configure.

## Install

One Python package is the whole application: the backend serves the web UI, so Node.js is only
needed when you are changing the frontend. The built studio ships inside the wheel.

```bash
# Python 3.11+ and nothing else
uv tool install https://github.com/uv-genai/llmimage/releases/download/v0.1.5/llmimage-0.1.5-py3-none-any.whl
pipx install  https://github.com/uv-genai/llmimage/releases/download/v0.1.5/llmimage-0.1.5-py3-none-any.whl

llmimage serve                     # http://127.0.0.1:8765
```

Connection profiles are stored in `$XDG_DATA_HOME/llmimage/settings.json` (usually
`~/.local/share/llmimage/`); `LLMIMAGE_DATA_DIR` moves them. Not on PyPI yet — until it is, use
the release URL, or build locally with `./scripts/build.sh && uv build` (the wheel build fails
unless the SPA has been built first, so you can never ship a package without its UI).

## Quick start (from a checkout)

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

## Configuration

Server configuration is **environment variables only** — there is no config file to edit to
run the studio. Note that the app reads the process environment and does **not** open a `.env`
file itself, so use one of these:

```bash
set -a; . ./.env; set +a        # any POSIX shell
direnv exec . llmimage serve    # with direnv installed
# systemd unit: EnvironmentFile=/etc/llmimage/env
```

`.env.example` lists the same variables.

| Variable | Default | What it does |
| --- | --- | --- |
| `LLMIMAGE_HOST` | `127.0.0.1` | bind address; `0.0.0.0` to reach the studio from other devices |
| `LLMIMAGE_PORT` | `8765` | bind port |
| `LLMIMAGE_BASE_URL` | *(empty)* | default upstream API root, e.g. `http://127.0.0.1:8080/v1`. Set it and clients need only a key |
| `LLMIMAGE_API_KEY` | *(empty)* | bearer token used when the browser sends no `X-Api-Key` |
| `LLMIMAGE_ALLOWED_HOSTS` | *(empty = any)* | comma-separated hostname globs the proxy may contact, e.g. `127.0.0.1,api.openai.com`. Set this whenever you bind beyond loopback |
| `LLMIMAGE_REQUEST_TIMEOUT` | `1800` | seconds an upstream image request may run — local diffusion on CPU-offloaded weights is slow |
| `LLMIMAGE_MAX_BODY_BYTES` | `268435456` (256 MiB) | request body cap, sized for many reference images |
| `LLMIMAGE_DATA_DIR` | see below | directory holding `settings.json` |
| `LLMIMAGE_CONFIG_FILE` | `$LLMIMAGE_DATA_DIR/settings.json` | exact path of the profile store |
| `LLMIMAGE_WEB_DIST` | packaged copy, else `web/dist` | where the built SPA lives; if absent the backend runs API-only |

`serve` also takes flags that win over the environment: `--host`, `--port`, `--base-url`,
`--api-key`, `--reload`. To see what a configuration actually resolves to, run `info`:

```console
$ LLMIMAGE_BASE_URL=http://127.0.0.1:8080/v1 llmimage info
bind              http://127.0.0.1:8765
default base URL  http://127.0.0.1:8080/v1
default API key   (none)
allowed hosts     (any)
request timeout   1800s
max body          256 MiB
settings file     /home/you/.local/share/llmimage/settings.json
web build         /home/you/llmimage/web/dist
```

### Connection profiles: `settings.json`

The server writes this file when you save a profile in the Settings drawer, and seeds an
`Environment` profile from `LLMIMAGE_BASE_URL` on first run if nothing is stored. It is
created `0600` and replaced atomically.

```json
{
  "version": 1,
  "updated_at": "2026-10-12T02:20:00Z",
  "active_profile_id": "env",
  "profiles": [
    {
      "id": "env",
      "name": "Environment",
      "base_url": "http://127.0.0.1:8080/v1",
      "api_key": "sk-studio-test",
      "headers": {}
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `id` | short handle; `env` is the seeded profile |
| `name` | shown in the UI |
| `base_url` | upstream API root, normalised the same way as a typed one |
| `api_key` | the bearer token — **plaintext on disk**, owner-only permissions, so treat the file as a secret |
| `headers` | extra headers for providers that need more than `Authorization`, e.g. `{"api-version": "2025-04-01"}` |
| `active_profile_id` | which profile applies when the client does not name one |

Where the file lives:

| Layout | Path |
| --- | --- |
| source checkout | `./data/settings.json` |
| installed wheel | `$XDG_DATA_HOME/llmimage/settings.json`, normally `~/.local/share/llmimage/` |
| explicit | `LLMIMAGE_CONFIG_FILE`, or `LLMIMAGE_DATA_DIR` for the directory |

The API never returns a stored key: `/api/profiles` reports `has_api_key` and
`api_key_preview` (`sk-stu…test`) only.

### Precedence

For each request the proxy resolves its target in this order:

1. `X-Base-Url` / `X-Api-Key` / `X-Profile-Id` headers sent by the browser
2. the active stored profile
3. `LLMIMAGE_BASE_URL` / `LLMIMAGE_API_KEY`

A key can never come from the browser's `localStorage` — only the endpoint URL, parameters and
prompt drafts are stored there.

## Using it from another device

```bash
LLMIMAGE_BASE_URL="http://127.0.0.1:8080/v1" \
LLMIMAGE_ALLOWED_HOSTS="127.0.0.1,localhost,api.openai.com" \
  uv run llmimage serve --host 0.0.0.0 --port 8765
# then from any machine on the network: http://<host-ip>:8765 — key only, no address
```

Three things worth knowing before you do that:

- **There is no login.** Anyone who can reach the port can submit image requests with your
  credits and drive the UI, so bind `0.0.0.0` only on a network you trust.
- **Keep `LLMIMAGE_ALLOWED_HOSTS` set in this mode.** The browser tells the proxy which
  upstream to call, so without an allowlist a LAN peer could aim it at internal addresses.
  With one, anything outside the list is refused (`403 host_not_allowed`).
- **Addresses are resolved by the proxy, not the browser.** `127.0.0.1` in the base URL field
  is the *server's* loopback, which is how a laptop reaches an `imagegen` bound to loopback —
  and why `LLMIMAGE_BASE_URL` is the better answer: leave the field blank and every client
  inherits the endpoint the studio runs next to.

The API key is still typed per tab and kept in memory, so on a shared machine sign out of
the browser session when you are done.

## Pairing it with the local `imagegen` service

```bash
cd ../imagegen
export IMAGEGEN_API_KEYS="sk-studio-test"           # any token you like
uv run imagegen serve --config config/service.toml   # http://127.0.0.1:8080

cd ../llmimage
export LLMIMAGE_BASE_URL="http://127.0.0.1:8080/v1"  # the proxy resolves this locally
uv run llmimage serve                               # http://127.0.0.1:8765
```

Open http://127.0.0.1:8765, click the connection chip, paste the **key** (the same value as
`IMAGEGEN_API_KEYS`), press **Test connection** — the chip turns green and the model field
offers `qwen-image-2.1` and `qwen-image-2.1-turbo`. With `LLMIMAGE_BASE_URL` set you never
type an address, which also means every device that reaches the studio — laptop, phone, a
coworker's machine — only needs the key. Settings shows the server-configured endpoint under
the base URL field; anything you type there overrides it for that browser tab.

A base URL is normalised, so `http://127.0.0.1:8080`, `…/v1`, and a full endpoint URL copied
out of the docs (`…/v1/models`, `…/images/generations`) all resolve to the same API root.

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

### If "Test connection" fails

The chip shows the endpoint and status; the drawer spells out what was tried.

| Message | Meaning | Fix |
| --- | --- | --- |
| `invalid API key` | the key does not match `IMAGEGEN_API_KEYS` | retype the key |
| `Nothing answers at http://…` | the base URL is not the API root | press **Use the endpoint configured on the server**, or clear the field |
| `The endpoint refused the connection` | imagegen is not running, or the port is wrong | start imagegen, re-check `:8080` |
| `host 'x' is not in LLMIMAGE_ALLOWED_HOSTS` | that upstream host is not permitted | add it to the allowlist, or use the local address |
| `endpoint ignored stream` | the images are fine; the engine does not stream partials | nothing — or use a streaming provider |

Base URLs are normalised, so `http://host:8080`, `…/v1`, and a pasted endpoint URL (`…/v1/models`,
`…/images/generations`, even doubled up) all resolve to the same API root.

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
the exact request (with the token masked), light/dark themes that both clear WCAG AA, and
keyboard `Enter` / `Ctrl+Enter` to run.

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

`npm run e2e` drives a real browser (Playwright + Firefox): **32 checks** with an endpoint,
**11** offline in about 15 s. It skips politely if the app is not running. Coverage includes:
connecting with a key alone, recovering from a bad saved base URL, the model list, a
generation, the lightbox, reusing a result as an edit input, parameters carrying across tabs,
mask painting and mask encoding, an edit round-trip, history and `Reuse`, the `curl` preview,
streaming partials and token usage against the bundled mock, an endpoint that rejects or
silently ignores `stream`, readable advice for every upstream error, and the measured text
contrast of both themes (WCAG AA). Set `UPSTREAM_URL`, `UPSTREAM_KEY` (and optionally
`UPSTREAM_MODEL`) to point it at your engine; with no `UPSTREAM_KEY` the GPU half is skipped.

Layout of the repo:

## Releases

Tagged, semver-ish, with notes in [CHANGELOG.md](CHANGELOG.md). `/api/health` reports the
running version; a release commit bumps `src/llmimage/__init__.py`, `pyproject.toml`,
`web/package.json`, `web/package-lock.json` and `uv lock` together, then
`git tag -a vX.Y.Z && git push origin master vX.Y.Z`.

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

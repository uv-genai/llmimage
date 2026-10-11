"""HTTP surface of the studio: a credential-holding proxy plus the built SPA.

The browser never talks to the upstream endpoint directly — it would fight CORS and
leak the API key into client storage. Every call goes through `/api/*` here, which
resolves the target, attaches the token, and relays bytes (including server-sent
events for `stream: true`) back verbatim.
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from llmimage import __version__
from llmimage.config import Settings
from llmimage.profiles import ProfileStore
from llmimage.upstream import (
    ALLOWED_PATHS,
    UpstreamError,
    build_url,
    check_path,
    host_is_allowed,
    make_client,
    normalise_base,
    relay_headers,
    without_v1,
)

log = logging.getLogger("llmimage")

#: Extra response headers that keep server-sent events unbuffered through proxies.
STREAM_HEADERS = {"cache-control": "no-cache", "x-accel-buffering": "no", "connection": "keep-alive"}


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or Settings()
    store = ProfileStore(cfg.config_file)
    store.seed_defaults(cfg.base_url, cfg.api_key)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.client = make_client(cfg.request_timeout)
        if cfg.host not in ("127.0.0.1", "localhost", "::1") and not cfg.allowed_hosts:
            log.warning(
                "listening on %s with no LLMIMAGE_ALLOWED_HOSTS — the proxy will forward to any host", cfg.host
            )
        log.info("llmimage %s ready (config: %s)", __version__, cfg.config_file)
        try:
            yield
        finally:
            await app.state.client.aclose()

    app = FastAPI(
        title="llmimage",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = cfg
    app.state.profiles = store

    # Dev servers (vite) run on another origin; loopback only.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    @app.exception_handler(UpstreamError)
    async def _upstream_error(_: Request, exc: UpstreamError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=_error_body(exc.message, exc.code))

    # ------------------------------------------------------------------ meta
    @app.get("/api/health")
    async def health() -> JSONResponse:
        return JSONResponse(
            {
                "ok": True,
                "version": __version__,
                "web_dist": str(cfg.web_dist),
                "web_ready": (cfg.web_dist / "index.html").exists(),
                "endpoints": sorted(ALLOWED_PATHS),
                "allowed_hosts": cfg.allowed_hosts,
                "request_timeout_seconds": cfg.request_timeout,
            }
        )

    @app.get("/api/config")
    async def config_view() -> JSONResponse:
        return JSONResponse(
            {
                "version": __version__,
                "defaults": {
                    "base_url": cfg.base_url,
                    "has_api_key": bool(cfg.api_key),
                    "api_key_preview": "" if not cfg.api_key else f"{cfg.api_key[:6]}…{cfg.api_key[-4:]}",
                },
                "profiles": [item.masked() for item in store.list()],
                "active_profile_id": store.active_id,
            }
        )

    @app.post("/api/profiles")
    async def save_profile(request: Request) -> JSONResponse:
        patch = await _json_body(request)
        if not str(patch.get("name", "")).strip():
            patch["name"] = "Default"
        profile = store.upsert(patch)
        return JSONResponse({"profile": profile.masked(), "profiles": [i.masked() for i in store.list()]})

    @app.post("/api/profiles/{profile_id}/activate")
    async def activate_profile(profile_id: str) -> JSONResponse:
        if store.activate(profile_id) is None:
            raise UpstreamError(f"unknown profile {profile_id!r}", status=404, code="unknown_profile")
        return JSONResponse({"active_profile_id": store.active_id, "profiles": [i.masked() for i in store.list()]})

    @app.delete("/api/profiles/{profile_id}")
    async def delete_profile(profile_id: str) -> JSONResponse:
        if not store.delete(profile_id):
            raise UpstreamError(f"unknown profile {profile_id!r}", status=404, code="unknown_profile")
        return JSONResponse({"active_profile_id": store.active_id, "profiles": [i.masked() for i in store.list()]})

    # -------------------------------------------------------------- upstream
    @app.post("/api/models")
    async def list_models(request: Request) -> Response:
        return await _relay(request, "models", method="GET")

    @app.post("/api/images/generations")
    async def generations(request: Request) -> Response:
        return await _relay(request, "images/generations")

    @app.post("/api/images/edits")
    async def edits(request: Request) -> Response:
        return await _relay(request, "images/edits")

    @app.post("/api/images/variations")
    async def variations(request: Request) -> Response:
        return await _relay(request, "images/variations")

    @app.get("/api/media")
    async def media(request: Request, url: str = "") -> Response:
        """Fetch an upstream-hosted image (``response_format: url``) as bytes.

        Needed because saving a cross-origin image needs ``fetch``, and the upstream
        does not send CORS headers.
        """
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise UpstreamError("url must be an absolute http(s) URL", status=400, code="bad_url")
        root = f"{parsed.scheme}://{parsed.netloc}"
        if not host_is_allowed(root, cfg.allowed_hosts):
            raise UpstreamError(
                f"host {parsed.hostname!r} is not in LLMIMAGE_ALLOWED_HOSTS", status=403, code="host_not_allowed"
            )
        try:
            upstream = await app.state.client.get(url)
        except httpx.HTTPError as exc:
            raise UpstreamError(f"could not fetch {url}: {exc}", code="media_fetch_failed") from exc
        headers = relay_headers(upstream.headers)
        headers.setdefault("content-type", "image/png")
        return Response(content=upstream.content, status_code=upstream.status_code, headers=headers)

    # ------------------------------------------------------------------- web
    dist: Path = cfg.web_dist
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def unknown_api(rest: str) -> JSONResponse:
        """Anything under /api that is not a real route, answered in the error envelope."""
        return JSONResponse(
            status_code=404,
            content=_error_body(
                f"unknown API route /api/{rest}; supported: {', '.join(sorted('/api/' + p for p in ALLOWED_PATHS))}",
                "unsupported_path",
            ),
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> Response:
        index = dist / "index.html"
        if not index.exists():
            return _missing_build_page()
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
            return Response(content=candidate.read_bytes(), headers={"cache-control": "public, max-age=31536000"})
        return Response(content=index.read_bytes(), media_type="text/html", headers={"cache-control": "no-cache"})

    # ------------------------------------------------------------- internals
    async def _relay(request: Request, path: str, method: str = "POST") -> Response:
        """Forward this request to `<base>/<path>` and stream the answer back."""
        clean = check_path(path)
        base_url, api_key, extra_headers = _credentials(request, cfg, store)
        root = normalise_base(base_url)
        if not host_is_allowed(root, cfg.allowed_hosts):
            raise UpstreamError(
                f"host {urlparse(root).hostname!r} is not in LLMIMAGE_ALLOWED_HOSTS",
                status=403,
                code="host_not_allowed",
            )

        body = await _raw_body(request, cfg.max_body_bytes)
        if method == "GET":
            body = b""  # the UI POSTs its target config here; upstream models list takes none
        send_headers = {"content-type": request.headers.get("content-type", "application/json")}
        send_headers.update(extra_headers)
        if api_key:
            send_headers["Authorization"] = f"Bearer {api_key}"
        accept = request.headers.get("accept")
        if accept:
            send_headers["accept"] = accept

        urls = [build_url(root, clean)]
        fallback = without_v1(root)
        if fallback:
            urls.append(build_url(fallback, clean))

        response = await _send(app.state.client, method, urls, send_headers, body)
        if _is_streaming(response.headers.get("content-type", "")):
            return StreamingResponse(
                _pipe(response),
                status_code=response.status_code,
                headers={**relay_headers(response.headers), **STREAM_HEADERS},
                media_type=response.headers.get("content-type", "text/event-stream"),
            )
        payload = await response.aread()
        await response.aclose()
        headers = relay_headers(response.headers)
        headers.setdefault("content-type", "application/json")
        return Response(content=payload, status_code=response.status_code, headers=headers)

    async def _send(
        client: httpx.AsyncClient,
        method: str,
        urls: list[str],
        headers: dict[str, str],
        body: bytes,
    ) -> httpx.Response:
        """Try each candidate URL; a 404 on a *path* is retried against the other root.

        Some gateways mount the image API at the root instead of under /v1, and a
        wrong base URL is the single most common misconfiguration, so the ambiguity
        is resolved here rather than bounced to the user.
        """
        last: httpx.Response | None = None
        for index, url in enumerate(urls):
            try:
                request = client.build_request(method, url, headers=headers, content=body or None)
                response = await client.send(request, stream=True)
            except httpx.ConnectError as exc:
                raise UpstreamError(
                    f"could not connect to {url} — is the image service running? ({exc})",
                    code="connect_failed",
                ) from exc
            except httpx.TimeoutException as exc:
                raise UpstreamError(f"timed out talking to {url}: {exc}", code="timeout") from exc
            except httpx.HTTPError as exc:
                raise UpstreamError(f"upstream request failed: {exc}", code="http_error") from exc

            if response.status_code == 404 and index + 1 < len(urls):
                await response.aclose()
                continue
            if response.status_code == 404:
                last = response
                break
            return response
        assert last is not None
        return last

    async def _pipe(response: httpx.Response) -> AsyncIterator[bytes]:
        """Copy upstream bytes to the client as they arrive, cancelling upstream on exit."""
        try:
            async for chunk in response.aiter_raw():
                yield chunk
        finally:
            await response.aclose()

    return app


def _credentials(request: Request, cfg: Settings, store: ProfileStore) -> tuple[str, str, dict[str, str]]:
    """Resolve (base_url, api_key, extra headers): explicit header > stored profile > env."""
    profile = None
    profile_id = request.headers.get("x-profile-id", "")
    if profile_id:
        profile = store.get(profile_id)
        if profile is None:
            raise UpstreamError(f"unknown profile {profile_id!r}", status=404, code="unknown_profile")
    if profile is None and store.active_id:
        profile = store.get(store.active_id)

    base_url = request.headers.get("x-base-url", "").strip() or (profile.base_url if profile else "") or cfg.base_url
    api_key = request.headers.get("x-api-key", "").strip() or (profile.api_key if profile else "") or cfg.api_key
    extra = dict(profile.headers) if profile and profile.headers else {}
    if not base_url:
        raise UpstreamError(
            "no upstream base URL — set one in Settings, send X-Base-Url, or export LLMIMAGE_BASE_URL",
            status=400,
            code="missing_base_url",
        )
    return base_url, api_key, extra


async def _raw_body(request: Request, limit: int) -> bytes:
    body = await request.body()
    if len(body) > limit:
        raise UpstreamError(
            f"request body is {len(body)} bytes, above the {limit} byte limit", status=413, code="body_too_large"
        )
    return body


async def _json_body(request: Request) -> dict[str, object]:
    raw = await request.body()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise UpstreamError(f"invalid JSON body: {exc}", status=400, code="bad_json") from exc
    if not isinstance(parsed, dict):
        raise UpstreamError("JSON body must be an object", status=400, code="bad_json")
    return parsed


def _is_streaming(content_type: str) -> bool:
    return "text/event-stream" in content_type.lower()


def _error_body(message: str, code: str) -> dict[str, object]:
    """OpenAI-shaped error envelope, so clients and the UI read one format."""
    return {"error": {"message": message, "type": "proxy_error", "code": code, "param": None}}


def _missing_build_page() -> Response:
    html = """<!doctype html><html><head><meta charset="utf-8"><title>llmimage</title>
<style>body{background:#0a0a12;color:#e8e8f2;font:15px/1.6 ui-sans-serif,system-ui;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:34rem;padding:2rem}h1{font-size:1.3rem;margin:0 0 .5rem}code{background:#ffffff14;padding:.15rem .4rem;border-radius:.3rem}</style></head>
<body><main><h1>llmimage API is running</h1>
<p>The UI has not been built yet. From the repository root run:</p>
<pre><code>npm --prefix web install\nnpm --prefix web run build\n</code></pre>
<p>then reload this page. The API itself is live under <code>/api/</code>.</p></main></body></html>"""
    return Response(content=html, media_type="text/html", status_code=200)


__all__ = ["create_app"]

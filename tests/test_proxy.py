"""End-to-end proxy tests over real sockets.

Both the studio and a stub OpenAI image API run under uvicorn on loopback ports; the
tests drive them with a plain httpx client, so the code paths exercised are the ones
used in production — multipart encoding, chunked transfer, SSE framing and all. The
stub records what it received and serves it back at `/__seen`, so assertions check the
bytes that actually crossed the wire.
"""

from __future__ import annotations

import asyncio
import base64
import json
import socket
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import contextmanager
from typing import Any

import httpx
import pytest
import uvicorn
from fastapi import FastAPI, Form, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from llmimage.app import create_app
from llmimage.config import Settings

B64_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
PNG_1PX = base64.b64decode(B64_1PX)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@contextmanager
def serve(app: FastAPI) -> Iterator[str]:
    """Run an ASGI app on a free loopback port and yield its origin."""
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 20
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("server did not start")
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def build_stub() -> FastAPI:
    """A minimal OpenAI-compatible image API carrying the quirks the proxy must survive."""
    stub = FastAPI()
    seen: list[dict[str, Any]] = []

    @stub.post("/__seen")
    async def record() -> JSONResponse:
        snapshot = list(seen)
        seen.clear()
        return JSONResponse(snapshot)

    @stub.get("/v1/models")
    async def models(request: Request) -> dict[str, Any]:
        seen.append({"path": "/v1/models", "auth": request.headers.get("authorization")})
        return {"object": "list", "data": [{"id": "stub-image", "object": "model", "owned_by": "test"}]}

    @stub.post("/v1/images/generations")
    async def generations(request: Request):
        body = await request.json()
        seen.append({"path": "/v1/images/generations", "auth": request.headers.get("authorization"), "body": body})
        if body.get("prompt") == "boom":
            return JSONResponse(
                status_code=400,
                content={"error": {"message": "prompt rejected by moderation", "type": "invalid_request_error"}},
            )
        if body.get("stream"):
            partials = int(body.get("partial_images", 2))

            async def events() -> AsyncIterator[str]:
                for index in range(partials):
                    if index:
                        await asyncio.sleep(0.4)  # proves the relay does not buffer
                    payload = {
                        "type": "image_generation.partial_image",
                        "b64_json": B64_1PX,
                        "partial_image_index": index,
                    }
                    yield f"event: image_generation.partial_image\ndata: {json.dumps(payload)}\n\n"
                done = {
                    "type": "image_generation.completed",
                    "b64_json": B64_1PX,
                    "usage": {"total_tokens": 100, "input_tokens": 60, "output_tokens": 40},
                }
                yield f"event: image_generation.completed\ndata: {json.dumps(done)}\n\n"

            return StreamingResponse(events(), media_type="text/event-stream")

        if body.get("response_format") == "url":
            return JSONResponse({"created": 1, "data": [{"url": "http://127.0.0.1/img.png"}]})
        return JSONResponse({"created": 1, "output_format": "png", "data": [{"b64_json": B64_1PX}]})

    @stub.post("/v1/images/edits")
    async def edits(request: Request, prompt: str = Form(...), model: str | None = Form(None)):
        form = await request.form()
        uploads = {
            key: len(await value.read())  # type: ignore[attr-defined]
            for key, value in form.multi_items()
            if hasattr(value, "read")
        }
        seen.append(
            {
                "path": "/v1/images/edits",
                "auth": request.headers.get("authorization"),
                "prompt": prompt,
                "model": model,
                "uploads": uploads,
            }
        )
        return JSONResponse({"created": 2, "output_format": "png", "data": [{"b64_json": B64_1PX}]})

    @stub.post("/v1/images/variations")
    async def variations(n: str = Form("1")):
        seen.append({"path": "/v1/images/variations", "n": n})
        return JSONResponse({"created": 3, "data": [{"b64_json": B64_1PX}] * int(n)})

    # A gateway mounted at a prefix instead of under /v1.
    @stub.post("/gateway/images/generations")
    async def prefixed_generations(request: Request):
        body = await request.json()
        seen.append({"path": "/gateway/images/generations", "body": body})
        return JSONResponse({"created": 4, "data": [{"b64_json": B64_1PX}]})

    @stub.get("/v1/images/content/blob-1")
    async def blob() -> Response:
        return Response(PNG_1PX, media_type="image/png")

    return stub


@pytest.fixture(scope="module")
def stub_origin() -> Iterator[str]:
    with serve(build_stub()) as origin:
        yield origin


@pytest.fixture()
def studio_origin(stub_origin: str, tmp_path) -> Iterator[str]:
    settings = Settings()
    settings.host = "127.0.0.1"
    settings.config_file = tmp_path / "settings.json"
    settings.base_url = f"{stub_origin}/v1"
    with serve(create_app(settings)) as origin:
        yield origin


@pytest.fixture()
def seen(stub_origin: str) -> Callable[[], list[dict[str, Any]]]:
    """A callable returning the requests the stub recorded since it was last called."""

    def drain() -> list[dict[str, Any]]:
        return httpx.post(f"{stub_origin}/__seen", timeout=10).json()

    drain()  # discard anything recorded before the test ran
    return drain


def generate(origin: str, payload: dict[str, Any], headers: dict[str, str] | None = None):
    return httpx.post(f"{origin}/api/images/generations", json=payload, headers=headers or {}, timeout=30)


def test_health_reports_supported_endpoints(studio_origin: str) -> None:
    body = httpx.get(f"{studio_origin}/api/health").json()
    assert body["ok"] is True
    assert set(body["endpoints"]) == {"models", "images/generations", "images/edits", "images/variations"}


def test_generation_reaches_upstream_with_bearer_token(studio_origin: str, seen: Callable[[], list]) -> None:
    response = generate(
        studio_origin,
        {"model": "stub-image", "prompt": "a red square", "size": "1024x1024", "n": 2, "quality": "high"},
        {"X-Api-Key": "sk-test-1234567890"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"][0]["b64_json"] == B64_1PX

    record = next(item for item in seen() if item["path"] == "/v1/images/generations")
    assert record["auth"] == "Bearer sk-test-1234567890"
    assert record["body"] == {
        "model": "stub-image",
        "prompt": "a red square",
        "size": "1024x1024",
        "n": 2,
        "quality": "high",
    }


def test_provider_extension_fields_survive_the_proxy(studio_origin: str, seen: Callable[[], list]) -> None:
    payload = {
        "model": "qwen-image-2.1",
        "prompt": "p",
        "negative_prompt": "blurry",
        "sd_cpp": {"sample_params": {"eta": 0.5}},
        "strength": 0.4,
    }
    assert generate(studio_origin, payload).status_code == 200
    record = next(item for item in seen() if item["path"] == "/v1/images/generations")
    assert record["body"]["negative_prompt"] == "blurry"
    assert record["body"]["sd_cpp"] == {"sample_params": {"eta": 0.5}}
    assert record["body"]["strength"] == 0.4


def test_upstream_error_body_is_passed_through_unchanged(studio_origin: str) -> None:
    response = generate(studio_origin, {"model": "m", "prompt": "boom"})
    assert response.status_code == 400
    assert response.json()["error"]["message"] == "prompt rejected by moderation"


def test_streaming_is_relayed_event_by_event(studio_origin: str) -> None:
    arrival: list[tuple[float, str]] = []
    lines: list[str] = []
    with httpx.stream(
        "POST",
        f"{studio_origin}/api/images/generations",
        json={"model": "m", "prompt": "p", "stream": True, "partial_images": 2},
        timeout=30,
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["x-accel-buffering"] == "no"
        for line in response.iter_lines():
            lines.append(line)
            if line.startswith("event:"):
                arrival.append((time.monotonic(), line))

    text = "\n".join(lines)
    partials = [item for item in arrival if "partial_image" in item[1]]
    completed = [item for item in arrival if "completed" in item[1]]
    assert len(partials) == 2
    assert '"partial_image_index": 1' in text
    assert len(completed) == 1
    # The first partial is relayed while the stream is still open — measurably before
    # the completed event that closes it, which is what the UI renders against.
    assert completed[0][0] - partials[0][0] > 0.3


def test_model_listing_is_proxied(studio_origin: str, seen: Callable[[], list]) -> None:
    response = httpx.post(f"{studio_origin}/api/models", json={}, headers={"X-Api-Key": "sk-abc"}, timeout=20)
    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == "stub-image"
    assert next(item for item in seen() if item["path"] == "/v1/models")["auth"] == "Bearer sk-abc"


def test_multipart_edit_with_mask_is_forwarded_as_multipart(studio_origin: str, seen: Callable[[], list]) -> None:
    response = httpx.post(
        f"{studio_origin}/api/images/edits",
        files={"image[]": ("cat.png", PNG_1PX, "image/png"), "mask": ("mask.png", PNG_1PX, "image/png")},
        data={"prompt": "make it a dog", "model": "stub-image", "n": "1", "input_fidelity": "high"},
        headers={"X-Api-Key": "sk-test-1234567890"},
        timeout=30,
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"][0]["b64_json"] == B64_1PX

    record = next(item for item in seen() if item["path"] == "/v1/images/edits")
    assert record["prompt"] == "make it a dog"
    assert record["model"] == "stub-image"
    assert record["uploads"] == {"image[]": len(PNG_1PX), "mask": len(PNG_1PX)}
    assert record["auth"] == "Bearer sk-test-1234567890"


def test_variations_endpoint(studio_origin: str, seen: Callable[[], list]) -> None:
    response = httpx.post(
        f"{studio_origin}/api/images/variations",
        files={"image": ("a.png", PNG_1PX, "image/png")},
        data={"n": "3", "size": "512x512"},
        headers={"X-Api-Key": "sk"},
        timeout=30,
    )
    assert response.status_code == 200
    assert len(response.json()["data"]) == 3
    assert next(item for item in seen() if item["path"] == "/v1/images/variations")["n"] == "3"


def test_base_url_without_v1_suffix_is_normalised(
    studio_origin: str, stub_origin: str, seen: Callable[[], list]
) -> None:
    """`http://host:port` and `http://host:port/` must both reach `/v1/images/*`."""
    for base_url in (stub_origin, f"{stub_origin}/", f"{stub_origin}/v1"):
        response = generate(studio_origin, {"model": "m", "prompt": f"p {base_url}"}, {"X-Base-Url": base_url})
        assert response.status_code == 200, (base_url, response.text)
    prompts = [item["body"]["prompt"] for item in seen() if item["path"] == "/v1/images/generations"]
    assert prompts == [f"p {stub_origin}", f"p {stub_origin}/", f"p {stub_origin}/v1"]


def test_pasted_endpoint_url_is_reduced_to_the_api_root(
    studio_origin: str, stub_origin: str, seen: Callable[[], list]
) -> None:
    """People copy `…/v1/models` or `…/images/generations` out of docs and shell history.

    Appending the endpoint to that produced `…/v1/models/models` and a bare 404, which reads
    like a broken server rather than a doubled path.
    """
    for pasted in (
        f"{stub_origin}/v1/models",
        f"{stub_origin}/images/generations",
        f"{stub_origin}/v1/images/edits/",
        f"{stub_origin}/v1/models/models",  # a bad save on top of a bad paste
    ):
        response = httpx.post(
            f"{studio_origin}/api/models", headers={"X-Base-Url": pasted, "X-Api-Key": "k"}, timeout=15
        )
        assert response.status_code == 200, (pasted, response.text)
        assert response.json()["object"] == "list"
    assert [item["auth"] for item in seen() if item["path"] == "/v1/models"] == ["Bearer k"] * 4


def test_upstream_404_names_the_url_it_tried(studio_origin: str, stub_origin: str) -> None:
    """A path that is not an image endpoint must not come back as a bare `{"detail":...}`."""
    response = httpx.post(
        f"{studio_origin}/api/models",
        headers={"X-Base-Url": f"{stub_origin}/api/v1", "X-Api-Key": "k"},
        timeout=15,
    )
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "endpoint_not_found"
    assert error["detail"]["attempted"] == [f"{stub_origin}/api/v1/models", f"{stub_origin}/api/models"]


def test_server_default_endpoint_needs_no_client_configuration(studio_origin: str) -> None:
    """`LLMIMAGE_BASE_URL` is the whole point of running the proxy next to the engine: a
    laptop on the LAN supplies a key, never an address."""
    response = httpx.post(f"{studio_origin}/api/models", timeout=15)
    assert response.status_code == 200, response.text
    assert response.json()["data"][0]["id"] == "stub-image"


def test_prefixed_gateway_is_retried_without_v1(
    studio_origin: str, stub_origin: str, seen: Callable[[], list]
) -> None:
    """A server mounted at /gateway answers on the second candidate URL."""
    response = generate(studio_origin, {"model": "m", "prompt": "p"}, {"X-Base-Url": f"{stub_origin}/gateway"})
    assert response.status_code == 200, response.text
    assert next(item for item in seen() if item["path"] == "/gateway/images/generations")["body"]["prompt"] == "p"


def test_connection_failure_becomes_an_actionable_error(studio_origin: str) -> None:
    response = generate(studio_origin, {"model": "m", "prompt": "p"}, {"X-Base-Url": "http://127.0.0.1:1/v1"})
    assert response.status_code == 502
    assert "could not connect" in response.json()["error"]["message"]


def test_unsupported_path_is_rejected_with_a_helpful_body(studio_origin: str) -> None:
    response = httpx.post(f"{studio_origin}/api/images/deletions", json={})
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "unsupported_path"
    assert "images/generations" in body["error"]["message"]


def test_media_fetch_proxies_upstream_bytes(studio_origin: str, stub_origin: str) -> None:
    response = httpx.get(f"{studio_origin}/api/media", params={"url": f"{stub_origin}/v1/images/content/blob-1"})
    assert response.status_code == 200
    assert response.content == PNG_1PX
    assert response.headers["content-type"] == "image/png"


def test_media_fetch_refuses_hosts_outside_the_allowlist(tmp_path) -> None:
    settings = Settings()
    settings.config_file = tmp_path / "settings.json"
    settings.allowed_hosts = ["good.example"]
    with serve(create_app(settings)) as origin:
        response = httpx.get(f"{origin}/api/media", params={"url": "https://evil.example/x.png"})
    assert response.status_code == 403


def test_missing_base_url_is_reported_clearly(tmp_path) -> None:
    settings = Settings()
    settings.config_file = tmp_path / "settings.json"
    settings.base_url = ""
    with serve(create_app(settings)) as origin:
        response = generate(origin, {"model": "m", "prompt": "p"})
    assert response.status_code == 400
    assert "base URL" in response.json()["error"]["message"]


def test_profiles_round_trip_without_leaking_the_key(studio_origin: str) -> None:
    saved = httpx.post(
        f"{studio_origin}/api/profiles",
        json={"name": "Local", "base_url": "http://127.0.0.1:9/v1", "api_key": "sk-super-secret-value"},
    ).json()
    profile = saved["profile"]
    assert profile["has_api_key"] is True
    assert "secret" not in json.dumps(saved)

    listed = httpx.get(f"{studio_origin}/api/config").json()["profiles"]
    assert any(item["id"] == profile["id"] for item in listed)

    updated = httpx.post(
        f"{studio_origin}/api/profiles", json={"id": profile["id"], "name": "Renamed", "api_key": ""}
    ).json()
    assert updated["profile"]["api_key_preview"] == profile["api_key_preview"]

    assert httpx.delete(f"{studio_origin}/api/profiles/{profile['id']}").status_code == 200
    assert httpx.delete(f"{studio_origin}/api/profiles/{profile['id']}").status_code == 404


def test_profile_credentials_are_used_when_the_client_sends_none(
    studio_origin: str, stub_origin: str, seen: Callable[[], list]
) -> None:
    httpx.post(
        f"{studio_origin}/api/profiles",
        json={"name": "Stored", "base_url": f"{stub_origin}/v1", "api_key": "sk-stored-key"},
    )
    response = generate(studio_origin, {"model": "m", "prompt": "from profile"})
    assert response.status_code == 200, response.text
    record = next(item for item in seen() if item["path"] == "/v1/images/generations")
    assert record["auth"] == "Bearer sk-stored-key"


def test_explicit_headers_override_the_stored_profile(
    studio_origin: str, stub_origin: str, seen: Callable[[], list]
) -> None:
    httpx.post(
        f"{studio_origin}/api/profiles",
        json={"name": "Stored", "base_url": "http://127.0.0.1:1/v1", "api_key": "sk-stored-key"},
    )
    response = generate(
        studio_origin,
        {"model": "m", "prompt": "explicit"},
        {"X-Base-Url": f"{stub_origin}/v1", "X-Api-Key": "sk-explicit-key"},
    )
    assert response.status_code == 200, response.text
    record = next(item for item in seen() if item["path"] == "/v1/images/generations")
    assert record["auth"] == "Bearer sk-explicit-key"

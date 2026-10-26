#!/usr/bin/env python3
"""A mock OpenAI image endpoint, for trying the studio without a paid key.

Implements GET /v1/models plus POST /v1/images/generations (JSON and, when the request
asks for `stream`, server-sent events with partial images) and POST /v1/images/edits.
Images are generated locally with Pillow-free PNG encoding so the script has no
dependency beyond the standard library.

    uv run python scripts/mock_endpoint.py --port 8099
    # then point the studio at http://127.0.0.1:8099/v1 (any API key)
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import struct
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Iterator

MODEL_ID = "mock-image"
PARTIAL_DELAY = 0.4


def png_bytes(width: int, height: int, hue: float) -> bytes:
    """A deterministic gradient PNG, so a "generated" image is visible and cheap."""

    def channel(x: float, y: float) -> tuple[int, int, int]:
        red = int(255 * (0.5 + 0.5 * hue) * (0.4 + 0.6 * x))
        green = int(255 * (0.35 + 0.4 * (1 - hue)) * (0.3 + 0.7 * y))
        blue = int(255 * (0.55 + 0.35 * ((x + y) / 2)))
        return red % 256, green % 256, blue % 256

    rows = bytearray()
    for y in range(height):
        rows.append(0)  # filter type: none
        for x in range(width):
            rows.extend(channel(x / max(1, width - 1), y / max(1, height - 1)))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(rows), 6)) + chunk(b"IEND", b"")


def parse_size(raw: str) -> tuple[int, int]:
    try:
        width, height = raw.lower().split("x", 1)
        return max(64, min(2048, int(width))), max(64, min(2048, int(height)))
    except (ValueError, AttributeError):
        return 512, 512


def image_payload(size: str, hue: float, fmt: str = "png") -> dict[str, str]:
    width, height = parse_size(size)
    return {"b64_json": base64.b64encode(png_bytes(width, height, hue)).decode("ascii")}


def stream_events(size: str, partials: int) -> Iterator[str]:
    total = max(0, min(3, int(partials)))
    for index in range(total):
        time.sleep(PARTIAL_DELAY)
        body = {"type": "image_generation.partial_image", "partial_image_index": index, **image_payload(size, index / 4)}
        yield f"event: image_generation.partial_image\ndata: {json.dumps(body)}\n\n"
    time.sleep(PARTIAL_DELAY)
    done = {
        "type": "image_generation.completed",
        **image_payload(size, 0.75),
        "usage": {"total_tokens": 132, "input_tokens": 100, "output_tokens": 32},
    }
    yield f"event: image_generation.completed\ndata: {json.dumps(done)}\n\n"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:  # quieter than the default
        print(f"[mock] {self.command} {self.path} {args[-1] if args else ''}")

    def _json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, object]:
        length = int(self.headers.get("content-length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return {}

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        if self.path.rstrip("/") == "/v1/models":
            self._json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": MODEL_ID,
                            "object": "model",
                            "created": int(time.time()),
                            "owned_by": "llmimage-mock",
                            "description": "Local mock endpoint for exercising the studio, including streaming.",
                        },
                        {
                            "id": "moss-image",
                            "object": "model",
                            "created": int(time.time()),
                            "owned_by": "llmimage-mock",
                            "description": "Mock MOSS-style profile that advertises structured-layout support.",
                            "layout": "moss",
                        }
                    ],
                },
            )
            return
        self._json(404, {"error": {"message": f"no route {self.path}", "type": "invalid_request_error"}})

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        path = self.path.rstrip("/")
        # Edits arrive as multipart/form-data with binary image parts: read the raw
        # bytes before any JSON parsing, or json.loads chokes on the PNG magic (0x89).
        if path == "/v1/images/edits":
            length = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(length) if length else b""
            if b'name="mask"' not in raw:
                self._json(400, {"error": {"message": "the mock edit requires a mask part", "param": "mask"}})
                return
            match = re.search(rb'name="size"\r\n\r\n([0-9]+x[0-9]+)', raw)
            size = match.group(1).decode() if match else "1024x1024"
            self._json(200, {"created": int(time.time()), "output_format": "png", "data": [image_payload(size, 0.5)]})
            return
        body = self._read_json()
        if path == "/v1/images/generations":
            size = str(body.get("size") or "512x512")
            if body.get("prompt") == "boom":
                self._json(400, {"error": {"message": "the mock rejects this prompt", "type": "invalid_request_error"}})
                return
            if body.get("stream"):
                # Chunked, one event per chunk with a flush: the whole point is that the
                # client sees partials before the connection closes.
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.send_header("cache-control", "no-cache")
                self.send_header("transfer-encoding", "chunked")
                self.end_headers()
                for event in stream_events(size, int(body.get("partial_images", 2))):
                    payload = event.encode()
                    self.wfile.write(b"%x\r\n" % len(payload) + payload + b"\r\n")
                    self.wfile.flush()
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
                return
            count = max(1, min(4, int(body.get("n", 1))))
            self._json(
                200,
                {
                    "created": int(time.time()),
                    "output_format": str(body.get("output_format") or "png"),
                    "data": [image_payload(size, index / 4) for index in range(count)],
                    "usage": {"total_tokens": 100, "input_tokens": 70, "output_tokens": 30},
                },
            )
            return
        self._json(404, {"error": {"message": f"no route {path}", "type": "invalid_request_error"}})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8099)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"mock OpenAI image endpoint on http://{args.host}:{args.port}/v1 (model: {MODEL_ID})")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

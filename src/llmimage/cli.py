"""Command line entry point: `llmimage serve`."""

from __future__ import annotations

import argparse
import os
import sys

import uvicorn

from llmimage import __version__
from llmimage.app import create_app
from llmimage.config import Settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="llmimage", description="Web studio for OpenAI-compatible image endpoints")
    parser.add_argument("--version", action="version", version=f"llmimage {__version__}")
    sub = parser.add_subparsers(dest="command")

    serve = sub.add_parser("serve", help="run the studio (default)")
    serve.add_argument("--host", default=None, help="bind address (default: $LLMIMAGE_HOST or 127.0.0.1)")
    serve.add_argument("--port", type=int, default=None, help="bind port (default: $LLMIMAGE_PORT or 8765)")
    serve.add_argument("--base-url", default=None, help="default upstream API root, e.g. http://127.0.0.1:8080/v1")
    serve.add_argument("--api-key", default=None, help="default upstream bearer token")
    serve.add_argument("--reload", action="store_true", help="restart on backend source changes")

    sub.add_parser("info", help="show resolved configuration and exit")

    args = parser.parse_args(argv)
    command = args.command or "serve"

    # Only `serve` declares these flags, so read them defensively: `llmimage info` and a bare
    # `llmimage` have no such attributes.
    if getattr(args, "base_url", None):
        os.environ["LLMIMAGE_BASE_URL"] = args.base_url
    if getattr(args, "api_key", None):
        os.environ["LLMIMAGE_API_KEY"] = args.api_key
    settings = Settings()
    if getattr(args, "host", None):
        settings.host = args.host
    if getattr(args, "port", None):
        settings.port = args.port

    reload_flag = bool(getattr(args, "reload", False))

    if command == "info":
        _print_info(settings)
        return 0

    if not (settings.web_dist / "index.html").exists():
        print(f"note: no UI build at {settings.web_dist} — run `npm --prefix web run build`", file=sys.stderr)
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level="info",
        reload=reload_flag,
    )
    return 0


def _print_info(settings: Settings) -> None:
    rows = {
        "bind": f"http://{settings.host}:{settings.port}",
        "default base URL": settings.base_url or "(none)",
        "default API key": "set" if settings.api_key else "(none)",
        "allowed hosts": ", ".join(settings.allowed_hosts) or "(any)",
        "request timeout": f"{settings.request_timeout}s",
        "max body": f"{settings.max_body_bytes // (1024 * 1024)} MiB",
        "settings file": str(settings.config_file),
        "web build": str(settings.web_dist) if (settings.web_dist / "index.html").exists() else "(not built)",
    }
    width = max(len(key) for key in rows)
    for key, value in rows.items():
        print(f"{key:<{width}}  {value}")


if __name__ == "__main__":
    raise SystemExit(main())

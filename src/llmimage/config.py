"""Environment driven runtime configuration.

Everything here is a knob for *serving* the studio. Upstream connection details
(base URL, API key) are per-request data from the UI, with the values below as
the fallback so the tool can also run headless from the environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from None


def _csv(name: str) -> list[str]:
    return [item.strip() for item in _env(name).split(",") if item.strip()]


@dataclass(slots=True)
class Settings:
    """Process level settings, read once from the environment."""

    host: str = field(default_factory=lambda: _env("LLMIMAGE_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: _env_int("LLMIMAGE_PORT", 8765))
    #: Default upstream API root, e.g. http://127.0.0.1:8080/v1 or https://api.openai.com/v1
    base_url: str = field(default_factory=lambda: _env("LLMIMAGE_BASE_URL"))
    #: Default bearer token used when the client does not send X-Api-Key.
    api_key: str = field(default_factory=lambda: _env("LLMIMAGE_API_KEY"))
    #: Hostname patterns the proxy may talk to. Empty means "anything" (loopback
    #: binds make that reasonable; a non-loopback bind without it is warned about).
    allowed_hosts: list[str] = field(default_factory=lambda: _csv("LLMIMAGE_ALLOWED_HOSTS"))
    #: Seconds an upstream image request may take. Local diffusion on CPU-offloaded
    #: weights is measured in minutes, so this is deliberately generous.
    request_timeout: int = field(default_factory=lambda: _env_int("LLMIMAGE_REQUEST_TIMEOUT", 1800))
    #: Refuse request bodies above this size (16 reference images is roughly 64 MB).
    max_body_bytes: int = field(default_factory=lambda: _env_int("LLMIMAGE_MAX_BODY_BYTES", 256 * 1024 * 1024))
    #: Where server-side connection profiles are persisted.
    config_file: Path = field(default_factory=lambda: Path(_env("LLMIMAGE_CONFIG_FILE") or _data_dir() / "settings.json"))
    #: Directory holding the built SPA. Empty means API-only mode.
    web_dist: Path = field(default_factory=lambda: _resolve_web_dist())


def _data_dir() -> Path:
    """Where to persist profiles.

    A source checkout keeps using `./data` (that is what the docs and `.gitignore` refer
    to). An installed wheel must not write next to `site-packages`, so it falls back to the
    user's data directory.
    """
    override = _env("LLMIMAGE_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if (REPO_ROOT / "pyproject.toml").is_file():
        return REPO_ROOT / "data"
    base = Path(_env("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "llmimage"


def _resolve_web_dist() -> Path:
    """Locate the built SPA: repo checkout while developing, packaged copy when installed."""
    override = _env("LLMIMAGE_WEB_DIST")
    if override:
        return Path(override).expanduser().resolve()
    candidates = (REPO_ROOT / "web" / "dist", Path(__file__).resolve().parent / "web" / "dist")
    for candidate in candidates:
        if (candidate / "index.html").exists():
            return candidate
    return candidates[0]

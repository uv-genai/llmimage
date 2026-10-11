"""Target resolution and upstream forwarding.

This module is the only place that knows how a studio request becomes an upstream
OpenAI request. The rule is *verbatim passthrough*: the client builds a real OpenAI
payload, and the proxy only decides the URL, attaches credentials, and relays the
byte stream (which is what makes ``stream: true`` work without translation).
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass
from urllib.parse import urlparse, urlunparse

import httpx

#: Paths the proxy will forward. A whitelist, so the service can never be aimed at
#: arbitrary internal paths like ``/admin`` through a crafted request.
ALLOWED_PATHS = frozenset(
    {
        "models",
        "images/generations",
        "images/edits",
        "images/variations",
    }
)

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})

#: Hop-by-hop headers that must not be copied between connections.
HOP_BY_HOP = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
        "content-length",
    }
)


class UpstreamError(Exception):
    """A failure to reach or speak to the upstream endpoint."""

    def __init__(self, message: str, *, status: int = 502, code: str = "upstream_unreachable") -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


@dataclass(slots=True)
class Target:
    """A resolved upstream endpoint."""

    base_url: str
    path: str
    api_key: str = ""

    @property
    def url(self) -> str:
        return build_url(self.base_url, self.path)

    @property
    def auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}


def normalise_base(raw: str) -> str:
    """Turn whatever the user typed into an API root that includes ``/v1``.

    ``http://host:8080``, ``http://host:8080/`` and ``http://host:8080/v1`` all
    describe the same service, and gateways differ on whether the ``/v1`` prefix is
    required — so the canonical form keeps it and the caller can retry without.
    """
    value = (raw or "").strip()
    if not value:
        raise UpstreamError("no upstream base URL configured", status=400, code="missing_base_url")
    if "://" not in value:
        value = f"https://{value}"
    parsed = urlparse(value.rstrip("/"))
    if parsed.scheme not in ("http", "https"):
        raise UpstreamError(f"unsupported base URL scheme {parsed.scheme!r}", status=400, code="bad_base_url")
    if not parsed.netloc:
        raise UpstreamError("base URL has no host", status=400, code="bad_base_url")
    path = parsed.path.rstrip("/")
    if path.endswith("/v1"):
        return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))
    return urlunparse((parsed.scheme, parsed.netloc, f"{path}/v1", "", "", ""))


def without_v1(base_url: str) -> str | None:
    """Strip a trailing ``/v1`` so a gateway that mounts images at the root works."""
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        return base[: -len("/v1")] or base
    return None


def build_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def check_path(path: str) -> str:
    clean = (path or "").strip().lstrip("/")
    if clean not in ALLOWED_PATHS:
        raise UpstreamError(
            f"path {clean!r} is not a supported image endpoint",
            status=404,
            code="unsupported_path",
        )
    return clean


def host_is_allowed(base_url: str, allowed_patterns: list[str]) -> bool:
    """Loopback is always fine; anything else must match the configured patterns."""
    host = (urlparse(base_url).hostname or "").lower()
    if host in LOOPBACK_HOSTS:
        return True
    if not allowed_patterns:
        return True
    return any(fnmatch.fnmatch(host, pattern.lower()) for pattern in allowed_patterns)


def relay_headers(upstream_headers: httpx.Headers) -> dict[str, str]:
    """Response headers worth forwarding, minus hop-by-hop and encoding noise."""
    skip = HOP_BY_HOP | {"content-encoding", "date", "server"}
    return {key: value for key, value in upstream_headers.items() if key.lower() not in skip}


def make_client(timeout_seconds: int) -> httpx.AsyncClient:
    timeout = httpx.Timeout(connect=20.0, read=float(timeout_seconds), write=300.0, pool=20.0)
    return httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=32, max_keepalive_connections=8),
    )

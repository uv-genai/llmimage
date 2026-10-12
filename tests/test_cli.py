"""CLI entry points.

`base_url`/`api_key` only exist on the `serve` subparser, so `llmimage info` and a bare
`llmimage` used to raise AttributeError before reaching any work.
"""

from __future__ import annotations

import os
from typing import Any, Callable

import pytest

from llmimage import cli


@pytest.fixture()
def capture_run(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Replace uvicorn.run so `serve` resolves its settings without binding a socket."""
    seen: dict[str, Any] = {}
    monkeypatch.setattr(cli.uvicorn, "run", lambda app, **kwargs: seen.update(kwargs))
    return seen


def test_info_reports_resolved_configuration(capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLMIMAGE_BASE_URL", "http://127.0.0.1:8080/v1")
    monkeypatch.setenv("LLMIMAGE_PORT", "8901")
    monkeypatch.setenv("LLMIMAGE_ALLOWED_HOSTS", "127.0.0.1,api.openai.com")

    assert cli.main(["info"]) == 0
    out = capsys.readouterr().out
    assert "http://127.0.0.1:8901" in out
    assert "http://127.0.0.1:8080/v1" in out
    assert "api.openai.com" in out


def test_bare_invocation_defaults_to_serve(capture_run: dict[str, Any]) -> None:
    assert cli.main([]) == 0
    assert capture_run["host"] == "127.0.0.1"
    assert capture_run["port"] == 8765


def test_serve_flags_override_the_environment(capture_run: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLMIMAGE_BASE_URL", "")
    monkeypatch.setenv("LLMIMAGE_PORT", "1111")

    assert cli.main(["serve", "--base-url", "http://example.test/v1", "--api-key", "k", "--port", "9010"]) == 0
    assert os.environ["LLMIMAGE_BASE_URL"] == "http://example.test/v1"
    assert capture_run["port"] == 9010


def test_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["--version"])
    assert exit_info.value.code == 0
    assert "llmimage" in capsys.readouterr().out

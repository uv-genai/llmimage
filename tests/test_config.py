"""Where the tool keeps its files: source checkout vs installed wheel.

A wheel must not write into `site-packages`, and the built SPA has to be found in both
layouts, so these paths are contract rather than incidental.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import pytest

from llmimage import config as config_module

MANAGED_ENV = ("LLMIMAGE_DATA_DIR", "LLMIMAGE_CONFIG_FILE", "LLMIMAGE_WEB_DIST", "XDG_DATA_HOME", "HOME")


@pytest.fixture()
def settings_from(monkeypatch: pytest.MonkeyPatch) -> Callable[..., Any]:
    """Build Settings with only the given environment variables set."""

    def build(**overrides: object) -> Any:
        for name in MANAGED_ENV:
            monkeypatch.delenv(name, raising=False)
        for name, value in overrides.items():
            monkeypatch.setenv(name, str(value))
        return config_module.Settings()

    return build


def test_checkout_keeps_profiles_in_repo_data(settings_from: Callable[..., Any]) -> None:
    assert settings_from().config_file == config_module.REPO_ROOT / "data" / "settings.json"


def test_installed_layout_falls_back_to_the_user_data_dir(
    settings_from: Callable[..., Any], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Simulate site-packages: a REPO_ROOT with no pyproject.toml next to it.
    monkeypatch.setattr(config_module, "REPO_ROOT", tmp_path / "lib" / "python3.13" / "site-packages")
    settings = settings_from(HOME=tmp_path / "home")
    assert settings.config_file == tmp_path / "home" / ".local" / "share" / "llmimage" / "settings.json"


def test_xdg_data_home_is_honoured_when_not_in_a_checkout(
    settings_from: Callable[..., Any], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # A source checkout deliberately keeps ./data, even when XDG_DATA_HOME is set; only an
    # installed copy relocates.
    monkeypatch.setattr(config_module, "REPO_ROOT", tmp_path / "site-packages")
    assert settings_from(XDG_DATA_HOME=tmp_path / "xdg").config_file == tmp_path / "xdg" / "llmimage" / "settings.json"


def test_environment_overrides_win(settings_from: Callable[..., Any], tmp_path: Path) -> None:
    settings = settings_from(LLMIMAGE_DATA_DIR=tmp_path / "data", LLMIMAGE_WEB_DIST=tmp_path / "spa")
    assert settings.config_file == tmp_path / "data" / "settings.json"
    assert settings.web_dist == tmp_path / "spa"


def test_bundled_spa_is_found_next_to_the_package(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """`_resolve_web_dist` looks for `llmimage/web/dist` beside the module, which is where the
    wheel puts the built SPA."""
    packaged = tmp_path / "site-packages" / "llmimage"
    (packaged / "web" / "dist").mkdir(parents=True)
    (packaged / "web" / "dist" / "index.html").write_text("<html></html>")
    monkeypatch.setattr(config_module, "__file__", str(packaged / "config.py"))
    monkeypatch.setattr(config_module, "REPO_ROOT", tmp_path / "not-a-checkout")
    assert config_module._resolve_web_dist() == packaged.resolve() / "web" / "dist"

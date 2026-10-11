"""Server-side persistence for connection profiles.

The browser keeps its own copy in localStorage; this file exists so a deployment can
carry credentials (from env or file) across browsers and headless use. Keys are
written with owner-only permissions and never returned in full by the API.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from time import gmtime, strftime


@dataclass(slots=True)
class Profile:
    """One saved upstream connection."""

    id: str
    name: str
    base_url: str = ""
    api_key: str = ""
    headers: dict[str, str] = field(default_factory=dict)

    def masked(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "base_url": self.base_url,
            "headers": self.headers,
            "has_api_key": bool(self.api_key),
            "api_key_preview": preview_key(self.api_key),
        }

    def merged(self, patch: dict[str, object]) -> "Profile":
        """Apply a UI patch; an empty api_key means 'keep the stored one'."""
        api_key = str(patch.get("api_key") or "")
        return Profile(
            id=str(patch.get("id") or self.id),
            name=str(patch.get("name") or self.name),
            base_url=str(patch.get("base_url") if "base_url" in patch else self.base_url),
            api_key=api_key or self.api_key,
            headers=dict(patch.get("headers") or self.headers),  # type: ignore[arg-type]
        )


def preview_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 10:
        return f"{key[:2]}…"
    return f"{key[:6]}…{key[-4:]}"


class ProfileStore:
    """Small JSON-on-disk store guarded by a lock (uvicorn threads share it)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._profiles: list[Profile] = []
        self._active_id: str = ""
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        self._profiles = [Profile(**item) for item in raw.get("profiles", []) if isinstance(item, dict)]
        self._active_id = str(raw.get("active_profile_id") or "")

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "updated_at": strftime("%Y-%m-%dT%H:%M:%SZ", gmtime()),
            "active_profile_id": self._active_id,
            "profiles": [asdict(item) for item in self._profiles],
        }
        handle = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=self.path.parent, prefix=".settings-", suffix=".tmp", delete=False
        )
        try:
            json.dump(payload, handle, indent=2)
            handle.close()
            os.chmod(handle.name, 0o600)
            os.replace(handle.name, self.path)
        except OSError:
            try:
                os.unlink(handle.name)
            except OSError:
                pass
            raise

    def list(self) -> list[Profile]:
        with self._lock:
            return list(self._profiles)

    @property
    def active_id(self) -> str:
        with self._lock:
            return self._active_id

    def get(self, profile_id: str) -> Profile | None:
        with self._lock:
            return next((item for item in self._profiles if item.id == profile_id), None)

    def upsert(self, patch: dict[str, object]) -> Profile:
        with self._lock:
            existing = next((i for i, item in enumerate(self._profiles) if item.id == patch.get("id")), None)
            if existing is None:
                profile = Profile(
                    id=str(patch.get("id") or uuid.uuid4().hex[:8]),
                    name=str(patch.get("name") or "Default"),
                    base_url=str(patch.get("base_url") or ""),
                    api_key=str(patch.get("api_key") or ""),
                    headers=dict(patch.get("headers") or {}),  # type: ignore[arg-type]
                )
                self._profiles.append(profile)
            else:
                profile = self._profiles[existing].merged(patch)
                self._profiles[existing] = profile
            self._active_id = str(patch.get("id") or profile.id)
            self._save()
            return profile

    def activate(self, profile_id: str) -> Profile | None:
        with self._lock:
            profile = next((item for item in self._profiles if item.id == profile_id), None)
            if profile is None:
                return None
            self._active_id = profile.id
            self._save()
            return profile

    def delete(self, profile_id: str) -> bool:
        with self._lock:
            before = len(self._profiles)
            self._profiles = [item for item in self._profiles if item.id != profile_id]
            if len(self._profiles) == before:
                return False
            if self._active_id == profile_id:
                self._active_id = self._profiles[0].id if self._profiles else ""
            self._save()
            return True

    def seed_defaults(self, base_url: str, api_key: str) -> None:
        """Create an 'Environment' profile from env vars when nothing is stored yet."""
        if not base_url or self._profiles:
            return
        with self._lock:
            self._profiles.append(Profile(id="env", name="Environment", base_url=base_url, api_key=api_key))
            self._active_id = "env"
            self._save()

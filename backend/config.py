from __future__ import annotations

import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]


def _load_dotenv() -> None:
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        key, value = clean.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _resolve_path(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = ROOT_DIR / path
    return path.resolve()


MUSIC_DIR = _resolve_path(os.getenv("MUSIC_DIR", "./downloads"))
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
DEFAULT_SERVICES = [
    service.strip()
    for service in os.getenv("SPOTIFLAC_SERVICES", "tidal,spoti,qobuz,amazon").split(",")
    if service.strip()
]
LIVE_STREAM_SERVICES = [
    service.strip()
    for service in os.getenv("SPOTIFLAC_LIVE_STREAM_SERVICES", "youtube,spoti,deezer,tidal,qobuz").split(",")
    if service.strip()
]

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from time import time
from typing import Literal


JobStatus = Literal["queued", "running", "succeeded", "failed", "canceled"]
StreamStatus = Literal["waiting", "buffering", "ready", "ended", "unavailable"]
MIN_STREAM_BYTES = 512 * 1024


@dataclass
class DownloadJob:
    id: str
    spotify_url: str
    title: str = ""
    artist: str = ""
    album: str = ""
    cover_url: str = ""
    owner_user_id: str = ""
    owner_username: str = ""
    status: JobStatus = "queued"
    logs: list[str] = field(default_factory=list)
    error: str | None = None
    file_id: str | None = None
    progress: int = 0
    phase: str = "Queued"
    stream_path: Path | None = None
    live_stream: bool = False
    stream_provider: str = ""
    stream_quality: str = ""
    total_bytes: int = 0
    created_at: float = field(default_factory=time)
    updated_at: float = field(default_factory=time)
    _lock: RLock = field(default_factory=RLock, init=False, repr=False)

    @property
    def bytes_available(self) -> int:
        if not self.stream_path or not self.stream_path.exists():
            return 0
        try:
            return self.stream_path.stat().st_size
        except OSError:
            return 0

    @property
    def stream_status(self) -> StreamStatus:
        if self.status in ("failed", "canceled"):
            return "unavailable"
        if self.live_stream and self.status == "succeeded":
            return "ended"
        if self.live_stream and self.status in ("queued", "running"):
            return "ready"
        if self.status == "succeeded" and self.file_id:
            return "ended"
        if self.status == "queued":
            return "waiting"
        if not self.stream_path:
            return "buffering" if self.status == "running" else "unavailable"
        available = self.bytes_available
        if available >= MIN_STREAM_BYTES:
            return "ready"
        if self.status == "running":
            return "buffering"
        return "unavailable"

    def add_log(self, line: str) -> None:
        clean = line.strip()
        if not clean:
            return
        with self._lock:
            self.logs.append(clean)
            self.logs = self.logs[-300:]
            self.phase = clean[:180]
            self.updated_at = time()

    def set_progress(self, progress: int, phase: str | None = None) -> None:
        with self._lock:
            self.progress = max(0, min(100, progress))
            if phase:
                self.phase = phase
            self.updated_at = time()

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "id": self.id,
                "spotify_url": self.spotify_url,
                "title": self.title,
                "artist": self.artist,
                "album": self.album,
                "cover_url": self.cover_url,
                "owner_user_id": self.owner_user_id,
                "owner_username": self.owner_username,
                "status": self.status,
                "logs": self.logs[-200:],
                "error": self.error,
                "file_id": self.file_id,
                "progress": self.progress,
                "phase": self.phase,
                "stream_status": self.stream_status,
                "stream_url": f"/api/jobs/{self.id}/stream"
                if self.stream_status in ("waiting", "buffering", "ready", "ended")
                else None,
                "stream_provider": self.stream_provider,
                "stream_quality": self.stream_quality,
                "bytes_available": self.bytes_available,
                "total_bytes": self.total_bytes,
                "created_at": self.created_at,
                "updated_at": self.updated_at,
            }


@dataclass(frozen=True)
class LibraryItem:
    id: str
    path: Path
    title: str
    artist: str
    album: str
    size: int
    modified_at: float
    mime_type: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "artist": self.artist,
            "album": self.album,
            "size": self.size,
            "modified_at": self.modified_at,
            "mime_type": self.mime_type,
            "audio_url": f"/api/audio/{self.id}",
        }

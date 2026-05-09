from __future__ import annotations

import base64
import mimetypes
from pathlib import Path

from .models import LibraryItem


AUDIO_EXTENSIONS = {".flac", ".m4a", ".mp3"}


def ensure_music_dir(music_dir: Path) -> None:
    music_dir.mkdir(parents=True, exist_ok=True)


def is_within_directory(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def make_file_id(path: Path, music_dir: Path) -> str:
    relative = path.resolve().relative_to(music_dir.resolve()).as_posix()
    return base64.urlsafe_b64encode(relative.encode("utf-8")).decode("ascii").rstrip("=")


def path_from_file_id(file_id: str, music_dir: Path) -> Path:
    padding = "=" * (-len(file_id) % 4)
    try:
        relative = base64.urlsafe_b64decode(f"{file_id}{padding}").decode("utf-8")
    except Exception as exc:
        raise ValueError("Invalid file id") from exc

    path = (music_dir / relative).resolve()
    if not is_within_directory(path, music_dir):
        raise ValueError("File id escapes music directory")
    if path.suffix.lower() not in AUDIO_EXTENSIONS:
        raise ValueError("File is not a supported audio type")
    return path


def parse_name(path: Path) -> tuple[str, str]:
    stem = path.stem.strip()
    if " - " in stem:
        title, artist = stem.split(" - ", 1)
        return title.strip() or stem, artist.strip() or "Unknown Artist"
    return stem or path.name, "Unknown Artist"


def scan_library(music_dir: Path) -> list[LibraryItem]:
    ensure_music_dir(music_dir)
    items: list[LibraryItem] = []
    for path in sorted(music_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        stat = path.stat()
        title, artist = parse_name(path)
        mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        items.append(
            LibraryItem(
                id=make_file_id(path, music_dir),
                path=path,
                title=title,
                artist=artist,
                album=path.parent.name if path.parent != music_dir else "",
                size=stat.st_size,
                modified_at=stat.st_mtime,
                mime_type=mime_type,
            )
        )
    return sorted(items, key=lambda item: item.modified_at, reverse=True)


def find_newest_audio(music_dir: Path, since: float) -> LibraryItem | None:
    candidates = [item for item in scan_library(music_dir) if item.modified_at >= since]
    return candidates[0] if candidates else None


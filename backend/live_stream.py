from __future__ import annotations

import subprocess
from typing import Any

import requests

from .config import LIVE_STREAM_SERVICES, MUSIC_DIR
from .models import DownloadJob
from .spotiflac_adapter import (
    StreamSource,
    build_provider as _build_provider,
    create_download_options,
    ensure_isrc as _ensure_isrc,
    resolve_single_track_metadata as _resolve_metadata,
    stream_source_for_provider as _source_for_provider,
)

PREVIEW_DURATION_SECONDS = 35
SHORT_TRACK_GRACE_SECONDS = 45


def resolve_stream_source(job: DownloadJob) -> StreamSource:
    metadata = _resolve_metadata(job.spotify_url)
    metadata = _ensure_isrc(metadata)
    opts = create_download_options(MUSIC_DIR, LIVE_STREAM_SERVICES)

    errors: list[str] = []
    for service in LIVE_STREAM_SERVICES:
        provider = _build_provider(service, opts)
        if not provider:
            continue
        try:
            source = _source_for_provider(provider, metadata)
            if source:
                _assert_stream_source_openable(source)
                _reject_preview_source(source, metadata)
                job.add_log(f"Resolved stream source via {provider.name}: {source.quality_label}")
                return source
            errors.append(f"{provider.name}: no streamable direct URL")
        except (PreviewSourceError, StreamSourceUnavailable) as exc:
            job.add_log(f"Skipping {provider.name}: {exc}")
            errors.append(f"{provider.name}: {exc}")
        except Exception as exc:
            errors.append(f"{provider.name}: {exc}")

    detail = "; ".join(errors) or "no stream-capable provider configured"
    raise RuntimeError(f"No direct stream source available: {detail}")


class PreviewSourceError(RuntimeError):
    pass


class StreamSourceUnavailable(RuntimeError):
    pass


def _assert_stream_source_openable(source: StreamSource) -> None:
    headers = stream_request_headers(source, probe=True)
    try:
        with requests.get(
            source.url,
            headers=headers or None,
            stream=True,
            timeout=(8, 15),
            allow_redirects=True,
        ) as response:
            if response.status_code not in (200, 206):
                raise StreamSourceUnavailable(f"stream URL returned HTTP {response.status_code}")

            content_type = response.headers.get("Content-Type", "").lower()
            if "text/html" in content_type or "application/json" in content_type:
                raise StreamSourceUnavailable(f"stream URL returned {content_type or 'non-audio content'}")

            try:
                first_chunk = next(response.iter_content(chunk_size=2), b"")
            except StopIteration:
                first_chunk = b""
            if not first_chunk:
                raise StreamSourceUnavailable("stream URL did not return audio bytes")
    except StreamSourceUnavailable:
        raise
    except requests.RequestException as exc:
        raise StreamSourceUnavailable(str(exc)) from exc


def stream_request_headers(source: StreamSource, probe: bool = False) -> dict[str, str]:
    headers = dict(source.headers or {})
    headers.setdefault("User-Agent", "Mozilla/5.0")
    headers.setdefault("Accept", "*/*")
    if probe:
        headers.setdefault("Range", "bytes=0-1")
    return headers


def _reject_preview_source(source: StreamSource, metadata: Any) -> None:
    expected_seconds = int((getattr(metadata, "duration_ms", 0) or 0) / 1000)
    if expected_seconds <= SHORT_TRACK_GRACE_SECONDS:
        return

    actual_seconds = _probe_stream_duration(source)
    if actual_seconds is None:
        return
    if actual_seconds <= PREVIEW_DURATION_SECONDS:
        raise PreviewSourceError(
            f"source looks like a {actual_seconds:.0f}s preview for a {expected_seconds}s track"
        )


def _probe_stream_duration(source: StreamSource) -> float | None:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-rw_timeout",
        "8000000",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
    ]
    if source.headers:
        command.extend(["-headers", "".join(f"{key}: {value}\r\n" for key, value in source.headers.items())])
    command.append(source.url)

    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=12, check=False)
    except Exception:
        return None
    if result.returncode != 0:
        return None
    try:
        duration = float(result.stdout.strip().splitlines()[0])
    except (IndexError, ValueError):
        return None
    if duration <= 0:
        return None
    return duration

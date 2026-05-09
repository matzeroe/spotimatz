from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from typing import Any

from SpotiFLAC.downloader import DownloadOptions, _build_provider
from SpotiFLAC.providers.spotify_metadata import SpotifyMetadataClient

from .config import LIVE_STREAM_SERVICES, MUSIC_DIR
from .models import DownloadJob

PREVIEW_DURATION_SECONDS = 35
SHORT_TRACK_GRACE_SECONDS = 45


@dataclass(frozen=True)
class StreamSource:
    provider: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)
    media_type: str = "audio/flac"
    extension: str = ".flac"
    quality_label: str = "FLAC"


def resolve_stream_source(job: DownloadJob) -> StreamSource:
    metadata = _resolve_metadata(job.spotify_url)
    metadata = _ensure_isrc(metadata)
    opts = DownloadOptions(
        output_dir=str(MUSIC_DIR),
        services=LIVE_STREAM_SERVICES,
        filename_format="{title} - {artist}",
        use_track_numbers=False,
        use_artist_subfolders=False,
        use_album_subfolders=False,
    )

    errors: list[str] = []
    for service in LIVE_STREAM_SERVICES:
        provider = _build_provider(service, opts)
        if not provider:
            continue
        try:
            source = _source_for_provider(provider, metadata)
            if source:
                _reject_preview_source(source, metadata)
                job.add_log(f"Resolved stream source via {provider.name}: {source.quality_label}")
                return source
            errors.append(f"{provider.name}: no streamable direct URL")
        except PreviewSourceError as exc:
            job.add_log(f"Skipping {provider.name}: {exc}")
            errors.append(f"{provider.name}: {exc}")
        except Exception as exc:
            errors.append(f"{provider.name}: {exc}")

    detail = "; ".join(errors) or "no stream-capable provider configured"
    raise RuntimeError(f"No direct stream source available: {detail}")


def _resolve_metadata(spotify_url: str) -> Any:
    collection_name, tracks = SpotifyMetadataClient().get_url(spotify_url)
    if not tracks:
        raise RuntimeError(f"No tracks found in {collection_name or spotify_url}")
    if len(tracks) > 1:
        raise RuntimeError("Live streaming supports single tracks only")
    return tracks[0]


def _ensure_isrc(metadata: Any) -> Any:
    if getattr(metadata, "isrc", ""):
        return metadata
    try:
        from SpotiFLAC.core.http import HttpClient
        from SpotiFLAC.core.isrc_helper import IsrcHelper

        resolved = IsrcHelper(HttpClient("isrc")).get_isrc(metadata.id)
        if resolved:
            return metadata.model_copy(update={"isrc": resolved})
    except Exception:
        pass
    return metadata


def _source_for_provider(provider: Any, metadata: Any) -> StreamSource | None:
    name = provider.name
    if name == "tidal":
        tidal_url = provider.resolve_spotify_to_tidal(metadata.id, metadata.title, metadata.artists)
        track_id = provider._parse_track_id(tidal_url)
        url_or_manifest = provider._get_download_url_with_fallback(track_id, "LOSSLESS")
        if url_or_manifest.startswith("MANIFEST:"):
            from SpotiFLAC.providers.tidal import parse_manifest

            result = parse_manifest(url_or_manifest.removeprefix("MANIFEST:"))
            if result.direct_url and "flac" in result.mime_type.lower():
                return StreamSource(provider=name, url=result.direct_url, quality_label="Lossless FLAC")
            return None
        return StreamSource(provider=name, url=url_or_manifest, quality_label="Lossless FLAC")

    if name == "qobuz":
        if not metadata.isrc:
            return None
        track = provider._search_by_isrc(metadata.isrc)
        track_id = track.get("id")
        if not track_id:
            return None
        return StreamSource(provider=name, url=provider._get_stream_url(track_id, "27", True), quality_label="Hi-Res FLAC")

    if name == "spotidownloader":
        token = provider._get_token()
        return StreamSource(
            provider=name,
            url=provider._get_flac_url(metadata.id, token),
            headers={
                "Authorization": f"Bearer {token}",
                "Origin": "https://spotidownloader.com",
                "Referer": "https://spotidownloader.com/",
            },
            quality_label="FLAC",
        )

    return None


class PreviewSourceError(RuntimeError):
    pass


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

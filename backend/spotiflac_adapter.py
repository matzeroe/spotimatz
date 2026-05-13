from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


class SpotiFLACAdapterError(RuntimeError):
    pass


@dataclass(frozen=True)
class StreamSource:
    provider: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)
    media_type: str = "audio/flac"
    extension: str = ".flac"
    quality_label: str = "FLAC"
    bitrate_label: str = ""


_spotify_metadata_client: Any | None = None


def create_download_options(
    output_dir: Path,
    services: list[str],
    filename_format: str = "{title} - {artist}",
) -> Any:
    from SpotiFLAC.downloader import DownloadOptions

    return DownloadOptions(
        output_dir=str(output_dir),
        services=services,
        filename_format=filename_format,
        use_track_numbers=False,
        use_artist_subfolders=False,
        use_album_subfolders=False,
    )


def build_provider(service: str, options: Any) -> Any:
    from SpotiFLAC.downloader import _build_provider

    provider = _build_provider(service, options)
    _prefer_identity_encoding(provider)
    return provider


def spotify_access_token() -> str | None:
    try:
        from SpotiFLAC.getMetadata import get_access_token
    except Exception:
        return None

    token = get_access_token()
    if isinstance(token, dict):
        token = token.get("access_token")
    return token if isinstance(token, str) and token else None


def spotify_api_get(path: str, params: dict[str, Any] | None = None) -> dict | None:
    client = _metadata_client()
    if client is None:
        return None
    try:
        return client._get(path, params=params)
    except Exception:
        return None


def resolve_single_track_metadata(spotify_url: str) -> Any:
    client = _metadata_client()
    if client is None:
        raise SpotiFLACAdapterError("SpotiFLAC metadata client is unavailable")

    collection_name, tracks = client.get_url(spotify_url)
    if not tracks:
        raise RuntimeError(f"No tracks found in {collection_name or spotify_url}")
    if len(tracks) > 1:
        raise RuntimeError("Live streaming supports single tracks only")
    return tracks[0]


def ensure_isrc(metadata: Any) -> Any:
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


def stream_source_for_provider(provider: Any, metadata: Any) -> StreamSource | None:
    _prefer_identity_encoding(provider)
    name = provider.name
    if name == "tidal":
        tidal_url = provider.resolve_spotify_to_tidal(metadata.id, metadata.title, metadata.artists)
        track_id = provider._parse_track_id(tidal_url)
        url_or_manifest = provider._get_download_url_with_fallback(track_id, "LOSSLESS")
        if url_or_manifest.startswith("MANIFEST:"):
            from SpotiFLAC.providers.tidal import parse_manifest

            result = parse_manifest(url_or_manifest.removeprefix("MANIFEST:"))
            if result.direct_url and "flac" in result.mime_type.lower():
                return StreamSource(provider=name, url=result.direct_url, quality_label="Lossless FLAC", bitrate_label="1411+ kbps")
            return None
        return StreamSource(provider=name, url=url_or_manifest, quality_label="Lossless FLAC", bitrate_label="1411+ kbps")

    if name == "qobuz":
        if not metadata.isrc:
            return None
        track = provider._search_by_isrc(metadata.isrc)
        track_id = track.get("id")
        if not track_id:
            return None
        return StreamSource(
            provider=name,
            url=provider._get_stream_url(track_id, "27", True),
            quality_label="Hi-Res FLAC",
            bitrate_label="1411+ kbps",
        )

    if name == "deezer":
        if not metadata.isrc:
            return None
        track = provider._get_track_by_isrc(metadata.isrc)
        if not track:
            return None
        track_id = track.get("id")
        if not track_id:
            return None
        api_data = provider._get_json_cached(f"https://api.deezmate.com/dl/{track_id}")
        if not api_data.get("success"):
            return None
        flac_url = (api_data.get("links") or {}).get("flac")
        if not flac_url:
            return None
        return StreamSource(provider=name, url=flac_url, quality_label="FLAC", bitrate_label="1411 kbps")

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
            bitrate_label="1411 kbps",
        )

    if name == "youtube":
        try:
            youtube_url = provider._get_youtube_url(metadata)
        except TypeError:
            youtube_url = provider._get_youtube_url(metadata.id, metadata.title, metadata.artists)
        video_id = provider._extract_video_id(youtube_url)
        if not video_id:
            return None
        audio_url = None
        headers: dict[str, str] = {}
        if hasattr(provider, "_request_spotube_dl"):
            audio_url = provider._request_spotube_dl(video_id)
        if not audio_url and hasattr(provider, "_request_cobalt"):
            audio_url = provider._request_cobalt(youtube_url)
        if not audio_url and hasattr(provider, "_request_yt1d"):
            audio_url = provider._request_yt1d(youtube_url)
        if not audio_url and hasattr(provider, "_session"):
            ytdlp_source = _youtube_source_from_ytdlp(youtube_url)
            if ytdlp_source:
                return ytdlp_source
        if not audio_url and hasattr(provider, "_request_direct_innertube"):
            audio_url = provider._request_direct_innertube(video_id)
            if audio_url:
                headers["Range"] = "bytes=0-"
        if not audio_url:
            return None
        media_type, extension = _media_type_for_youtube_url(audio_url)
        return StreamSource(
            provider=name,
            url=audio_url,
            headers=headers,
            media_type=media_type,
            extension=extension,
            quality_label="MP3 320",
            bitrate_label="320 kbps",
        )

    return None


def run_download(
    spotify_url: str,
    output_dir: Path,
    output_path: Path,
    services: list[str],
) -> None:
    from SpotiFLAC import SpotiFLAC

    SpotiFLAC(
        spotify_url,
        str(output_dir),
        services=services,
        filename_format="{title} - {artist}",
        use_track_numbers=False,
        use_artist_subfolders=False,
        use_album_subfolders=False,
        loop=None,
        output_path=str(output_path),
    )


def _metadata_client() -> Any | None:
    global _spotify_metadata_client
    try:
        from SpotiFLAC.providers.spotify_metadata import SpotifyMetadataClient
    except Exception:
        return None

    if _spotify_metadata_client is None:
        _spotify_metadata_client = SpotifyMetadataClient()
    return _spotify_metadata_client


def _prefer_identity_encoding(provider: Any) -> None:
    session = getattr(provider, "_session", None)
    headers = getattr(session, "headers", None)
    if headers is not None:
        headers["Accept-Encoding"] = "identity"


def _media_type_for_youtube_url(url: str) -> tuple[str, str]:
    mime = parse_qs(urlparse(url).query).get("mime", [""])[0]
    if mime:
        if "webm" in mime:
            return "audio/webm", ".webm"
        if "mp4" in mime or "m4a" in mime:
            return "audio/mp4", ".m4a"
        if "mpeg" in mime or "mp3" in mime:
            return "audio/mpeg", ".mp3"
    if ".webm" in url:
        return "audio/webm", ".webm"
    if ".m4a" in url or ".mp4" in url:
        return "audio/mp4", ".m4a"
    return "audio/mpeg", ".mp3"


def _youtube_source_from_ytdlp(youtube_url: str) -> StreamSource | None:
    try:
        import yt_dlp
    except Exception:
        return None

    try:
        with yt_dlp.YoutubeDL(
            {
                "format": "bestaudio/best",
                "noplaylist": True,
                "quiet": True,
                "skip_download": True,
            }
        ) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
    except Exception:
        return None

    if not isinstance(info, dict):
        return None
    formats = info.get("formats") or []
    audio_formats = [
        item
        for item in formats
        if item.get("url") and item.get("vcodec") in (None, "none")
    ]
    if not audio_formats and info.get("url"):
        audio_formats = [info]
    if not audio_formats:
        return None

    def score(item: dict) -> tuple[int, int]:
        abr = int(item.get("abr") or item.get("tbr") or 0)
        filesize = int(item.get("filesize") or item.get("filesize_approx") or 0)
        return abr, filesize

    chosen = max(audio_formats, key=score)
    url = chosen.get("url")
    if not isinstance(url, str) or not url:
        return None

    headers = dict(info.get("http_headers") or {})
    headers.update(chosen.get("http_headers") or {})
    if "googlevideo.com" in url:
        headers.setdefault("Range", "bytes=0-")

    media_type, extension = _media_type_for_youtube_url(url)
    ext = chosen.get("ext")
    if ext == "webm":
        media_type, extension = "audio/webm", ".webm"
    elif ext in ("m4a", "mp4"):
        media_type, extension = "audio/mp4", ".m4a"
    elif ext == "mp3":
        media_type, extension = "audio/mpeg", ".mp3"
    bitrate_label = _bitrate_label(chosen)

    return StreamSource(
        provider="youtube",
        url=url,
        headers=headers,
        media_type=media_type,
        extension=extension,
        quality_label="YouTube Audio",
        bitrate_label=bitrate_label,
    )


def _bitrate_label(format_info: dict) -> str:
    bitrate = format_info.get("abr") or format_info.get("tbr")
    try:
        bitrate_number = int(round(float(bitrate)))
    except (TypeError, ValueError):
        return ""
    if bitrate_number <= 0:
        return ""
    return f"{bitrate_number} kbps"

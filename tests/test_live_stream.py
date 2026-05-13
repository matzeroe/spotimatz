from types import SimpleNamespace

import backend.live_stream as live_stream
from backend.spotiflac_adapter import stream_source_for_provider


def test_resolve_stream_source_skips_preview_length_provider(monkeypatch) -> None:
    metadata = SimpleNamespace(id="spotify-id", duration_ms=180_000)
    providers = {
        "spoti": SimpleNamespace(name="spotidownloader"),
        "qobuz": SimpleNamespace(name="qobuz"),
    }
    sources = {
        "spotidownloader": live_stream.StreamSource(provider="spotidownloader", url="https://example.test/preview.flac"),
        "qobuz": live_stream.StreamSource(provider="qobuz", url="https://example.test/full.flac"),
    }

    monkeypatch.setattr(live_stream, "LIVE_STREAM_SERVICES", ["spoti", "qobuz"])
    monkeypatch.setattr(live_stream, "_resolve_metadata", lambda spotify_url: metadata)
    monkeypatch.setattr(live_stream, "_ensure_isrc", lambda item: item)
    monkeypatch.setattr(live_stream, "_build_provider", lambda service, opts: providers[service])
    monkeypatch.setattr(live_stream, "_source_for_provider", lambda provider, metadata: sources[provider.name])
    monkeypatch.setattr(live_stream, "_assert_stream_source_openable", lambda source: None)
    monkeypatch.setattr(
        live_stream,
        "_probe_stream_duration",
        lambda source: 30 if source.provider == "spotidownloader" else 180,
    )

    job = SimpleNamespace(spotify_url="https://open.spotify.com/track/test", logs=[], add_log=lambda message: job.logs.append(message))

    source = live_stream.resolve_stream_source(job)

    assert source.provider == "qobuz"
    assert any("Skipping spotidownloader" in message for message in job.logs)


def test_resolve_stream_source_allows_real_short_tracks(monkeypatch) -> None:
    metadata = SimpleNamespace(id="spotify-id", duration_ms=30_000)
    provider = SimpleNamespace(name="spotidownloader")
    source = live_stream.StreamSource(provider="spotidownloader", url="https://example.test/short.flac")

    monkeypatch.setattr(live_stream, "LIVE_STREAM_SERVICES", ["spoti"])
    monkeypatch.setattr(live_stream, "_resolve_metadata", lambda spotify_url: metadata)
    monkeypatch.setattr(live_stream, "_ensure_isrc", lambda item: item)
    monkeypatch.setattr(live_stream, "_build_provider", lambda service, opts: provider)
    monkeypatch.setattr(live_stream, "_source_for_provider", lambda provider, metadata: source)
    monkeypatch.setattr(live_stream, "_assert_stream_source_openable", lambda source: None)
    monkeypatch.setattr(live_stream, "_probe_stream_duration", lambda source: 30)

    job = SimpleNamespace(spotify_url="https://open.spotify.com/track/test", logs=[], add_log=lambda message: job.logs.append(message))

    resolved = live_stream.resolve_stream_source(job)

    assert resolved is source


def test_resolve_stream_source_skips_unopenable_provider(monkeypatch) -> None:
    metadata = SimpleNamespace(id="spotify-id", duration_ms=180_000)
    providers = {
        "tidal": SimpleNamespace(name="tidal"),
        "youtube": SimpleNamespace(name="youtube"),
    }
    sources = {
        "tidal": live_stream.StreamSource(provider="tidal", url="https://example.test/broken.flac"),
        "youtube": live_stream.StreamSource(provider="youtube", url="https://example.test/audio.mp3"),
    }

    def assert_openable(source: live_stream.StreamSource) -> None:
        if source.provider == "tidal":
            raise live_stream.StreamSourceUnavailable("stream URL returned HTTP 502")

    monkeypatch.setattr(live_stream, "LIVE_STREAM_SERVICES", ["tidal", "youtube"])
    monkeypatch.setattr(live_stream, "_resolve_metadata", lambda spotify_url: metadata)
    monkeypatch.setattr(live_stream, "_ensure_isrc", lambda item: item)
    monkeypatch.setattr(live_stream, "_build_provider", lambda service, opts: providers[service])
    monkeypatch.setattr(live_stream, "_source_for_provider", lambda provider, metadata: sources[provider.name])
    monkeypatch.setattr(live_stream, "_assert_stream_source_openable", assert_openable)
    monkeypatch.setattr(live_stream, "_probe_stream_duration", lambda source: 180)

    job = SimpleNamespace(spotify_url="https://open.spotify.com/track/test", logs=[], add_log=lambda message: job.logs.append(message))

    source = live_stream.resolve_stream_source(job)

    assert source.provider == "youtube"
    assert any("Skipping tidal" in message for message in job.logs)


def test_deezer_adapter_resolves_flac_stream_url() -> None:
    provider = SimpleNamespace(
        name="deezer",
        _get_track_by_isrc=lambda isrc: {"id": "12345"},
        _get_json_cached=lambda url: {"success": True, "links": {"flac": "https://example.test/full.flac"}},
    )
    metadata = SimpleNamespace(isrc="USRC17607839")

    source = stream_source_for_provider(provider, metadata)

    assert source is not None
    assert source.provider == "deezer"
    assert source.url == "https://example.test/full.flac"
    assert source.bitrate_label == "1411 kbps"


def test_youtube_adapter_resolves_mp3_stream_url() -> None:
    provider = SimpleNamespace(
        name="youtube",
        _get_youtube_url=lambda track_id, title, artists: "https://music.youtube.com/watch?v=abcdefghijk",
        _extract_video_id=lambda url: "abcdefghijk",
        _request_spotube_dl=lambda video_id: "https://example.test/audio.mp3",
        _request_cobalt=lambda video_id: None,
    )
    metadata = SimpleNamespace(id="spotify-id", title="Song", artists="Artist")

    source = stream_source_for_provider(provider, metadata)

    assert source is not None
    assert source.provider == "youtube"
    assert source.media_type == "audio/mpeg"
    assert source.quality_label == "MP3 320"
    assert source.bitrate_label == "320 kbps"


def test_youtube_adapter_supports_spotiflac_046_methods() -> None:
    provider = SimpleNamespace(
        name="youtube",
        _get_youtube_url=lambda metadata: "https://music.youtube.com/watch?v=abcdefghijk",
        _extract_video_id=lambda url: "abcdefghijk",
        _request_direct_innertube=lambda video_id: "https://rr1---sn.example.test/videoplayback?mime=audio%2Fwebm&itag=251",
        _request_cobalt=lambda video_url: "https://example.test/audio.m4a",
        _request_yt1d=lambda video_url: None,
    )
    metadata = SimpleNamespace(id="spotify-id", title="Song", artists="Artist")

    source = stream_source_for_provider(provider, metadata)

    assert source is not None
    assert source.provider == "youtube"
    assert source.url == "https://example.test/audio.m4a"
    assert source.media_type == "audio/mp4"


def test_youtube_adapter_uses_range_for_direct_innertube_fallback() -> None:
    direct_url = "https://rr1---sn.example.test/videoplayback?mime=audio%2Fwebm&itag=251"
    provider = SimpleNamespace(
        name="youtube",
        _get_youtube_url=lambda metadata: "https://music.youtube.com/watch?v=abcdefghijk",
        _extract_video_id=lambda url: "abcdefghijk",
        _request_direct_innertube=lambda video_id: direct_url,
        _request_cobalt=lambda video_url: None,
        _request_yt1d=lambda video_url: None,
    )
    metadata = SimpleNamespace(id="spotify-id", title="Song", artists="Artist")

    source = stream_source_for_provider(provider, metadata)

    assert source is not None
    assert source.url == direct_url
    assert source.headers["Range"] == "bytes=0-"
    assert source.media_type == "audio/webm"

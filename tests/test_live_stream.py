from types import SimpleNamespace

import backend.live_stream as live_stream


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
    monkeypatch.setattr(live_stream, "_probe_stream_duration", lambda source: 30)

    job = SimpleNamespace(spotify_url="https://open.spotify.com/track/test", logs=[], add_log=lambda message: job.logs.append(message))

    resolved = live_stream.resolve_stream_source(job)

    assert resolved is source

from pathlib import Path

import pytest
from fastapi import HTTPException

import backend.app as app_module
from backend.models import DownloadJob


def test_audio_range_response_has_partial_content_headers(tmp_path: Path) -> None:
    audio = tmp_path / "sample.mp3"
    audio.write_bytes(b"0123456789")

    response = app_module._range_response(audio, "bytes=2-5")

    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 2-5/10"
    assert response.headers["content-length"] == "4"


def test_audio_range_rejects_invalid_range(tmp_path: Path) -> None:
    audio = tmp_path / "sample.mp3"
    audio.write_bytes(b"0123456789")

    with pytest.raises(Exception):
        app_module._range_response(audio, "bytes=99-100")


def test_stream_range_response_uses_unknown_total_for_active_file(tmp_path: Path) -> None:
    audio = tmp_path / "stream.flac"
    audio.write_bytes(b"0123456789")

    response = app_module._stream_range_response(audio, "bytes=2-5", active=True)

    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 2-5/*"
    assert response.headers["content-length"] == "4"


def test_job_stream_status_reports_ready_when_file_has_buffer(tmp_path: Path) -> None:
    audio = tmp_path / "stream.flac"
    audio.write_bytes(b"0" * (512 * 1024))
    job = DownloadJob(
        id="job",
        spotify_url="https://open.spotify.com/track/test",
        stream_path=audio,
        owner_user_id="user-1",
        owner_username="matze",
    )
    job.status = "running"

    data = job.to_dict()

    assert data["stream_status"] == "ready"
    assert data["stream_url"] == "/api/jobs/job/stream"
    assert data["bytes_available"] == 512 * 1024
    assert data["owner_user_id"] == "user-1"
    assert data["owner_username"] == "matze"


def test_running_job_exposes_stream_url_while_buffering(tmp_path: Path) -> None:
    audio = tmp_path / "stream.flac"
    job = DownloadJob(id="job", spotify_url="https://open.spotify.com/track/test", stream_path=audio)
    job.status = "running"

    data = job.to_dict()

    assert data["stream_status"] == "buffering"
    assert data["stream_url"] == "/api/jobs/job/stream"


def test_canceled_job_stream_is_unavailable(tmp_path: Path) -> None:
    audio = tmp_path / "stream.flac"
    audio.write_bytes(b"0" * (512 * 1024))
    job = DownloadJob(id="job", spotify_url="https://open.spotify.com/track/test", stream_path=audio)
    job.status = "canceled"

    data = job.to_dict()

    assert data["stream_status"] == "unavailable"
    assert data["stream_url"] is None


def test_non_live_stream_endpoint_is_disabled(tmp_path: Path, monkeypatch) -> None:
    outside = tmp_path / "outside.flac"
    outside.write_bytes(b"audio")
    job = DownloadJob(id="unsafe", spotify_url="https://open.spotify.com/track/test", stream_path=outside)
    monkeypatch.setattr(app_module.jobs, "get", lambda job_id: job)

    with pytest.raises(HTTPException) as exc:
        app_module.stream_job("unsafe", request=type("Request", (), {"headers": {}})())

    assert exc.value.status_code == 410


def test_debug_page_serves_debug_html() -> None:
    response = app_module.debug_page()

    assert response.status_code == 200

from pathlib import Path

import pytest

from backend.library import make_file_id, path_from_file_id, scan_library


def test_scan_library_finds_supported_audio(tmp_path: Path) -> None:
    (tmp_path / "Artist").mkdir()
    audio = tmp_path / "Artist" / "Song - Artist.flac"
    audio.write_bytes(b"flac")
    (tmp_path / "ignore.txt").write_text("nope")

    items = scan_library(tmp_path)

    assert len(items) == 1
    assert items[0].title == "Song"
    assert items[0].artist == "Artist"


def test_file_id_round_trip_stays_in_music_dir(tmp_path: Path) -> None:
    audio = tmp_path / "track.mp3"
    audio.write_bytes(b"mp3")

    file_id = make_file_id(audio, tmp_path)

    assert path_from_file_id(file_id, tmp_path) == audio.resolve()


def test_file_id_blocks_traversal(tmp_path: Path) -> None:
    import base64

    bad_id = base64.urlsafe_b64encode(b"../secret.mp3").decode("ascii").rstrip("=")

    with pytest.raises(ValueError):
        path_from_file_id(bad_id, tmp_path)


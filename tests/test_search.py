from backend.search import search_tracks


def test_empty_search_returns_empty_list() -> None:
    assert search_tracks("") == []


def test_germany_top_songs_endpoint_uses_spotify_playlist(monkeypatch) -> None:
    import backend.app as app_module

    expected = [{"id": "track-1", "title": "Song"}]

    def fake_playlist_tracks(playlist_id: str) -> list[dict]:
        assert playlist_id == app_module.GERMANY_TOP_SONGS_PLAYLIST_ID
        return expected

    monkeypatch.setattr(app_module, "playlist_tracks", fake_playlist_tracks)

    assert app_module.get_germany_top_songs() == {"tracks": expected}

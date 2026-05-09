from __future__ import annotations

import base64
import os

import requests


SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
_spotiflac_client = None


class SearchUnavailable(RuntimeError):
    pass


def _token_from_spotiflac() -> str | None:
    try:
        from SpotiFLAC.getMetadata import get_access_token
    except Exception:
        return None

    token = get_access_token()
    if isinstance(token, dict):
        token = token.get("access_token")
    return token if isinstance(token, str) and token else None


def _search_with_spotiflac_client(query: str, limit: int) -> dict | None:
    global _spotiflac_client
    try:
        from SpotiFLAC.providers.spotify_metadata import SpotifyMetadataClient
    except Exception:
        return None

    if _spotiflac_client is None:
        _spotiflac_client = SpotifyMetadataClient()

    data = _spotiflac_client._get(
        "/search",
        params={"q": query, "type": "track,album,playlist", "limit": max(1, min(limit, 25))},
    )
    tracks = data.get("tracks", {}).get("items", [])
    albums = data.get("albums", {}).get("items", [])
    playlists = data.get("playlists", {}).get("items", [])
    return {
        "tracks": [_shape_track(track) for track in tracks],
        "albums": [_shape_album(album) for album in albums],
        "playlists": [_shape_playlist(playlist) for playlist in playlists if playlist],
    }


def _token_from_env() -> str | None:
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None

    auth = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    response = requests.post(
        SPOTIFY_TOKEN_URL,
        headers={"Authorization": f"Basic {auth}"},
        data={"grant_type": "client_credentials"},
        timeout=12,
    )
    response.raise_for_status()
    return response.json().get("access_token")


def get_access_token() -> str:
    token = _token_from_spotiflac() or _token_from_env()
    if not token:
        raise SearchUnavailable(
            "Spotify search needs SpotiFLAC installed or SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET."
        )
    return token


def search_tracks(query: str, limit: int = 12) -> list[dict]:
    clean_query = query.strip()
    if not clean_query:
        return []

    spotiflac_results = _search_with_spotiflac_client(clean_query, limit)
    if spotiflac_results is not None:
        return spotiflac_results["tracks"]

    token = get_access_token()
    response = requests.get(
        SPOTIFY_SEARCH_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={"q": clean_query, "type": "track", "limit": max(1, min(limit, 25))},
        timeout=12,
    )
    response.raise_for_status()
    tracks = response.json().get("tracks", {}).get("items", [])
    return [_shape_track(track) for track in tracks]


def search_catalog(query: str, limit: int = 12) -> dict:
    clean_query = query.strip()
    if not clean_query:
        return {"tracks": [], "albums": [], "playlists": []}

    spotiflac_results = _search_with_spotiflac_client(clean_query, limit)
    if spotiflac_results is not None:
        return spotiflac_results

    token = get_access_token()
    response = requests.get(
        SPOTIFY_SEARCH_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={"q": clean_query, "type": "track,album,playlist", "limit": max(1, min(limit, 25))},
        timeout=12,
    )
    response.raise_for_status()
    data = response.json()
    return {
        "tracks": [_shape_track(track) for track in data.get("tracks", {}).get("items", [])],
        "albums": [_shape_album(album) for album in data.get("albums", {}).get("items", [])],
        "playlists": [_shape_playlist(playlist) for playlist in data.get("playlists", {}).get("items", []) if playlist],
    }


def album_tracks(album_id: str) -> list[dict]:
    clean_id = album_id.strip()
    if not clean_id:
        return []

    data = _album_tracks_with_spotiflac_client(clean_id)
    if data is None:
        token = get_access_token()
        response = requests.get(
            f"https://api.spotify.com/v1/albums/{clean_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=12,
        )
        response.raise_for_status()
        data = response.json()
        _append_playlist_pages(data, token)

    album = {
        "name": data.get("name", ""),
        "images": data.get("images") or [],
    }
    return [_shape_track_from_album_item(track, album) for track in (data.get("tracks", {}) or {}).get("items", [])]


def playlist_tracks(playlist_id: str) -> list[dict]:
    clean_id = playlist_id.strip()
    if not clean_id:
        return []

    data = _playlist_with_spotiflac_client(clean_id)
    if data is None:
        token = get_access_token()
        response = requests.get(
            f"https://api.spotify.com/v1/playlists/{clean_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"fields": "name,images,tracks.items(track(id,name,artists,album,duration_ms,external_urls)),tracks.next"},
            timeout=12,
        )
        response.raise_for_status()
        data = response.json()

    playlist = {
        "name": data.get("name", ""),
        "images": data.get("images") or [],
    }
    tracks = []
    for item in (data.get("tracks", {}) or {}).get("items", []):
        track = item.get("track") if isinstance(item, dict) else item
        if track and not track.get("is_local"):
            tracks.append(_shape_track_from_playlist_item(track, playlist))
    return tracks


def _append_playlist_pages(data: dict, token: str) -> None:
    tracks = data.get("tracks")
    if not isinstance(tracks, dict):
        return
    next_url = tracks.get("next")
    while next_url and len(tracks.get("items", [])) < 250:
        response = requests.get(
            next_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=12,
        )
        response.raise_for_status()
        page = response.json()
        tracks.setdefault("items", []).extend(page.get("items", []))
        next_url = page.get("next")


def _album_tracks_with_spotiflac_client(album_id: str) -> dict | None:
    global _spotiflac_client
    try:
        from SpotiFLAC.providers.spotify_metadata import SpotifyMetadataClient
    except Exception:
        return None

    if _spotiflac_client is None:
        _spotiflac_client = SpotifyMetadataClient()
    return _spotiflac_client._get(f"/albums/{album_id}")


def _playlist_with_spotiflac_client(playlist_id: str) -> dict | None:
    global _spotiflac_client
    try:
        from SpotiFLAC.providers.spotify_metadata import SpotifyMetadataClient
    except Exception:
        return None

    if _spotiflac_client is None:
        _spotiflac_client = SpotifyMetadataClient()
    return _spotiflac_client._get(f"/playlists/{playlist_id}")


def _shape_track(track: dict) -> dict:
    album = track.get("album") or {}
    images = album.get("images") or []
    artists = [artist.get("name", "Unknown Artist") for artist in track.get("artists", [])]
    spotify_url = (track.get("external_urls") or {}).get("spotify")
    return {
        "id": track.get("id"),
        "title": track.get("name", "Unknown Title"),
        "artist": ", ".join(artists) or "Unknown Artist",
        "album": album.get("name", ""),
        "duration_ms": track.get("duration_ms", 0),
        "cover_url": images[0].get("url") if images else "",
        "spotify_url": spotify_url or f"https://open.spotify.com/track/{track.get('id', '')}",
    }


def _shape_track_from_album_item(track: dict, album: dict) -> dict:
    images = album.get("images") or []
    artists = [artist.get("name", "Unknown Artist") for artist in track.get("artists", [])]
    spotify_url = (track.get("external_urls") or {}).get("spotify")
    return {
        "id": track.get("id"),
        "title": track.get("name", "Unknown Title"),
        "artist": ", ".join(artists) or "Unknown Artist",
        "album": album.get("name", ""),
        "duration_ms": track.get("duration_ms", 0),
        "cover_url": images[0].get("url") if images else "",
        "spotify_url": spotify_url or f"https://open.spotify.com/track/{track.get('id', '')}",
    }


def _shape_track_from_playlist_item(track: dict, playlist: dict) -> dict:
    shaped = _shape_track(track)
    if not shaped["cover_url"]:
        images = playlist.get("images") or []
        shaped["cover_url"] = images[0].get("url") if images else ""
    return shaped


def _shape_album(album: dict) -> dict:
    images = album.get("images") or []
    artists = [artist.get("name", "Unknown Artist") for artist in album.get("artists", [])]
    album_id = album.get("id", "")
    return {
        "id": album_id,
        "title": album.get("name", "Unknown Album"),
        "artist": ", ".join(artists) or "Unknown Artist",
        "cover_url": images[0].get("url") if images else "",
        "spotify_url": (album.get("external_urls") or {}).get("spotify") or f"https://open.spotify.com/album/{album_id}",
        "total_tracks": album.get("total_tracks", 0),
        "release_date": album.get("release_date", ""),
    }


def _shape_playlist(playlist: dict) -> dict:
    images = playlist.get("images") or []
    owner = playlist.get("owner") or {}
    playlist_id = playlist.get("id", "")
    tracks = playlist.get("tracks") or {}
    return {
        "id": playlist_id,
        "title": playlist.get("name", "Unknown Playlist"),
        "owner": owner.get("display_name") or owner.get("id") or "Spotify",
        "cover_url": images[0].get("url") if images else "",
        "spotify_url": (playlist.get("external_urls") or {}).get("spotify") or f"https://open.spotify.com/playlist/{playlist_id}",
        "total_tracks": tracks.get("total", 0),
    }

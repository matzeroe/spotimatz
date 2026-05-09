from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from time import sleep, time
from typing import Annotated

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from .auth import SESSION_COOKIE, AuthStore, AuthUser, public_user
from .config import FRONTEND_DIST, MUSIC_DIR
from .jobs import JobManager
from .search import SearchUnavailable, album_tracks, playlist_tracks, search_catalog


jobs = JobManager()
auth_store = AuthStore()
GERMANY_TOP_SONGS_PLAYLIST_ID = "37i9dQZEVXbJiZcmkrIHGU"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await jobs.start()
    yield


app = FastAPI(title="SpotiMatz Premium", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_login(request: Request, call_next):
    path = request.url.path
    public_prefixes = ("/assets/", "/api/auth/", "/api/health")
    public_paths = {"/favicon.ico"}
    if path in public_paths or path.startswith(public_prefixes):
        return await call_next(request)
    if path.startswith("/api/"):
        if not _current_user(request):
            return JSONResponse({"detail": "Login required."}, status_code=401)
    if path == "/debug":
        user = _current_user(request)
        if not user:
            return Response(status_code=307, headers={"Location": "/"})
        if user.role != "admin":
            return JSONResponse({"detail": "Admin access required."}, status_code=403)
    return await call_next(request)


class DownloadRequest(BaseModel):
    spotify_url: Annotated[str, Field(min_length=1)]
    title: str = ""
    artist: str = ""
    album: str = ""
    cover_url: str = ""
    cancel_active: bool = False
    stream: bool = False


class AuthRequest(BaseModel):
    username: Annotated[str, Field(min_length=1)]
    password: Annotated[str, Field(min_length=1)]


class InviteAcceptRequest(AuthRequest):
    token: Annotated[str, Field(min_length=1)]


class InviteGenerateRequest(BaseModel):
    token: Annotated[str, Field(min_length=1)]


class InviteCreateRequest(BaseModel):
    note: str = ""


def _current_user(request: Request) -> AuthUser | None:
    return auth_store.get_session_user(request.cookies.get(SESSION_COOKIE))


def _require_admin(request: Request) -> AuthUser:
    user = _current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Login required.")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=60 * 60 * 24 * 30,
        httponly=True,
        samesite="lax",
        secure=False,
    )


def _auth_response(user: AuthUser, token: str) -> Response:
    response = JSONResponse({"user": public_user(user)})
    _set_session_cookie(response, token)
    return response


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/auth/me")
def auth_me(request: Request) -> dict:
    user = _current_user(request)
    return {"user": public_user(user), "setup_required": not auth_store.has_users()}


@app.post("/api/auth/setup")
def auth_setup(payload: AuthRequest) -> Response:
    try:
        user, token = auth_store.setup_admin(payload.username, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _auth_response(user, token)


@app.post("/api/auth/login")
def auth_login(payload: AuthRequest) -> Response:
    try:
        user, token = auth_store.login(payload.username, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return _auth_response(user, token)


@app.post("/api/auth/logout")
def auth_logout(request: Request) -> Response:
    auth_store.logout(request.cookies.get(SESSION_COOKIE))
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE)
    return response


@app.post("/api/auth/invites")
def create_invite(request: Request, payload: InviteCreateRequest | None = None) -> dict:
    user = _require_admin(request)
    invite = auth_store.create_invite(user.id, note=payload.note if payload else "")
    return {
        "invite_url": f"{str(request.base_url).rstrip('/')}/invite/{invite['token']}",
        "token": invite["token"],
        "note": invite.get("note", ""),
        "expires_at": invite["expires_at"],
    }


@app.get("/api/auth/admin")
def admin_panel_data(request: Request) -> dict:
    _require_admin(request)
    base_url = str(request.base_url).rstrip("/")
    users = auth_store.list_users()
    user_names = {user["id"]: user["username"] for user in users}
    invites = []
    for invite in auth_store.list_invites():
        invites.append(
            {
                **invite,
                "invite_url": f"{base_url}/invite/{invite['token']}",
                "created_by_username": user_names.get(invite.get("created_by", ""), ""),
                "used_by_username": user_names.get(invite.get("used_by", ""), ""),
            }
        )
    return {
        "users": sorted(users, key=lambda item: item.get("created_at", 0), reverse=True),
        "invites": sorted(invites, key=lambda item: item.get("created_at", 0), reverse=True),
    }


@app.delete("/api/auth/admin/invites/{token}")
def revoke_invite(token: str, request: Request) -> dict:
    _require_admin(request)
    try:
        auth_store.revoke_invite(token)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@app.delete("/api/auth/admin/users/{user_id}")
def delete_user(user_id: str, request: Request) -> dict:
    user = _require_admin(request)
    try:
        auth_store.delete_user(user_id, requested_by=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/auth/invites/{token}")
def check_invite(token: str) -> dict:
    invite = auth_store.get_invite(token)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite link is invalid or expired.")
    return {"ok": True, "note": invite.get("note", ""), "expires_at": invite["expires_at"]}


@app.post("/api/auth/invites/accept")
def accept_invite(payload: InviteAcceptRequest) -> Response:
    try:
        user, token = auth_store.accept_invite(payload.token, payload.username, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _auth_response(user, token)


@app.post("/api/auth/invites/generate")
def generate_invite_account(payload: InviteGenerateRequest) -> dict:
    try:
        user, password = auth_store.generate_invite_account(payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"account_id": user.username, "password": password}


@app.get("/api/search")
def search(q: str = "") -> dict:
    try:
        return search_catalog(q)
    except SearchUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Spotify search failed: {exc}") from exc


@app.get("/api/albums/{album_id}/tracks")
def get_album_tracks(album_id: str) -> dict:
    try:
        return {"tracks": album_tracks(album_id)}
    except SearchUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Spotify album lookup failed: {exc}") from exc


@app.get("/api/playlists/{playlist_id}/tracks")
def get_playlist_tracks(playlist_id: str) -> dict:
    try:
        return {"tracks": playlist_tracks(playlist_id)}
    except SearchUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Spotify playlist lookup failed: {exc}") from exc


@app.get("/api/charts/de/top-songs")
def get_germany_top_songs() -> dict:
    try:
        return {"tracks": playlist_tracks(GERMANY_TOP_SONGS_PLAYLIST_ID)}
    except SearchUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Spotify chart lookup failed: {exc}") from exc


@app.post("/api/downloads", status_code=202)
async def create_download(payload: DownloadRequest, request: Request) -> dict:
    user = _current_user(request)
    if "/track/" not in payload.spotify_url and not payload.spotify_url.startswith("spotify:track:"):
        raise HTTPException(status_code=400, detail="Only Spotify track URLs are supported in v1.")
    if not payload.stream:
        raise HTTPException(status_code=410, detail="Local downloads are disabled. Use streaming playback.")
    job = await jobs.create_stream(
        payload.spotify_url,
        title=payload.title,
        artist=payload.artist,
        album=payload.album,
        cover_url=payload.cover_url,
        owner_user_id=user.id if user else "",
        owner_username=user.username if user else "",
        cancel_active=payload.cancel_active,
    )
    return job.to_dict()


@app.get("/api/jobs")
def list_jobs() -> dict:
    return {"jobs": [job.to_dict() for job in jobs.list_recent()]}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict()


@app.get("/api/jobs/{job_id}/stream")
def stream_job(job_id: str, request: Request) -> Response:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.live_stream:
        try:
            body, media_type, headers = jobs.open_live_stream(job_id)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return StreamingResponse(body, media_type=media_type, headers=headers)
    raise HTTPException(status_code=410, detail="Local download streaming is disabled.")


@app.get("/api/library")
def library() -> dict:
    raise HTTPException(status_code=410, detail="Local library is disabled.")


@app.get("/api/audio/{file_id}")
def audio(file_id: str, request: Request) -> Response:
    raise HTTPException(status_code=410, detail="Local audio playback is disabled.")


def _media_type(path: Path) -> str:
    return {
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg",
    }.get(path.suffix.lower(), "application/octet-stream")


def _range_response(path: Path, range_header: str) -> StreamingResponse:
    size = path.stat().st_size
    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="Invalid range")

    start_text, _, end_text = range_header.replace("bytes=", "", 1).partition("-")
    start = int(start_text) if start_text else 0
    end = int(end_text) if end_text else size - 1
    end = min(end, size - 1)

    if start < 0 or end < start or start >= size:
        raise HTTPException(status_code=416, detail="Range not satisfiable")

    length = end - start + 1

    def iter_file():
        with path.open("rb") as file:
            file.seek(start)
            remaining = length
            while remaining > 0:
                chunk = file.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return StreamingResponse(
        iter_file(),
        status_code=206,
        media_type=_media_type(path),
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Content-Length": str(length),
        },
    )


def _wait_for_stream_file(path: Path, active: bool, timeout_s: float = 60.0) -> Path | None:
    deadline = time() + timeout_s
    while True:
        if path.exists() and path.is_file() and path.stat().st_size > 0:
            return path
        if not active or time() >= deadline:
            return None
        sleep(0.25)


def _stream_range_response(path: Path, range_header: str, active: bool) -> StreamingResponse:
    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="Invalid range")

    start_text, _, end_text = range_header.replace("bytes=", "", 1).partition("-")
    start = int(start_text) if start_text else 0

    size = _wait_for_bytes(path, start + 1, active)
    if size <= start:
        raise HTTPException(status_code=416, detail="Range not satisfiable")

    requested_end = int(end_text) if end_text else size - 1
    end = min(requested_end, size - 1)
    length = end - start + 1
    total = "*" if active else str(size)

    return StreamingResponse(
        _iter_file_window(path, start, length),
        status_code=206,
        media_type=_media_type(path),
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "Content-Range": f"bytes {start}-{end}/{total}",
            "Content-Length": str(length),
        },
    )


def _stream_growing_response(path: Path, job_id: str) -> StreamingResponse:
    return StreamingResponse(
        _iter_growing_file(path, job_id),
        media_type=_media_type(path),
        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-store"},
    )


def _wait_for_bytes(path: Path, minimum_size: int, active: bool, timeout_s: float = 8.0) -> int:
    deadline = time() + timeout_s
    while True:
        size = path.stat().st_size if path.exists() else 0
        if size >= minimum_size or not active or time() >= deadline:
            return size
        sleep(0.25)


def _iter_file_window(path: Path, start: int, length: int):
    with path.open("rb") as file:
        file.seek(start)
        remaining = length
        while remaining > 0:
            chunk = file.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _iter_growing_file(path: Path, job_id: str):
    offset = 0
    idle_until = time() + 20
    with path.open("rb") as file:
        while True:
            file.seek(offset)
            chunk = file.read(256 * 1024)
            if chunk:
                offset += len(chunk)
                idle_until = time() + 20
                yield chunk
                continue

            job = jobs.get(job_id)
            if not job or job.status in ("succeeded", "failed"):
                break
            if time() > idle_until:
                break
            sleep(0.25)


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.get("/debug", include_in_schema=False)
def debug_page() -> Response:
    debug = FRONTEND_DIST / "debug.html"
    if debug.exists():
        return FileResponse(debug, headers={"Cache-Control": "no-store"})
    return Response(
        "Debug frontend has not been built yet.",
        media_type="text/plain",
        status_code=200,
    )


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str) -> Response:
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-store"})
    return Response(
        "Frontend has not been built yet. Run `cd frontend && npm install && npm run build`.",
        media_type="text/plain",
        status_code=200,
    )

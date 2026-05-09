from __future__ import annotations

import asyncio
import io
import os
import re
import subprocess
import sys
import threading
import uuid
from collections.abc import Iterator
from pathlib import Path
from time import time

import requests

from .config import DEFAULT_SERVICES, MUSIC_DIR, ROOT_DIR
from .live_stream import resolve_stream_source
from .library import ensure_music_dir, find_newest_audio
from .models import DownloadJob


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, DownloadJob] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker_started = False
        self._lock = asyncio.Lock()
        self._process_lock = threading.RLock()
        self._processes: dict[str, subprocess.Popen[str]] = {}
        self._stream_source_lock = threading.RLock()
        self._stream_sources: dict[str, object] = {}
        self._stream_source_errors: dict[str, Exception] = {}
        self._stream_source_events: dict[str, threading.Event] = {}

    async def start(self) -> None:
        if not self._worker_started:
            self._worker_started = True
            asyncio.create_task(self._worker_loop())

    async def create(
        self,
        spotify_url: str,
        title: str = "",
        artist: str = "",
        album: str = "",
        cover_url: str = "",
        owner_user_id: str = "",
        owner_username: str = "",
        cancel_active: bool = False,
    ) -> DownloadJob:
        if cancel_active:
            self.cancel_active_downloads()

        job_id = uuid.uuid4().hex
        job = DownloadJob(
            id=job_id,
            spotify_url=spotify_url,
            title=title,
            artist=artist,
            album=album,
            cover_url=cover_url,
            owner_user_id=owner_user_id,
            owner_username=owner_username,
            stream_path=_build_output_path(job_id, spotify_url, title, artist),
        )
        async with self._lock:
            self._jobs[job.id] = job
        await self._queue.put(job.id)
        return job

    async def create_stream(
        self,
        spotify_url: str,
        title: str = "",
        artist: str = "",
        album: str = "",
        cover_url: str = "",
        owner_user_id: str = "",
        owner_username: str = "",
        cancel_active: bool = True,
    ) -> DownloadJob:
        if cancel_active:
            self.cancel_active_downloads()

        job_id = uuid.uuid4().hex
        job = DownloadJob(
            id=job_id,
            spotify_url=spotify_url,
            title=title,
            artist=artist,
            album=album,
            cover_url=cover_url,
            owner_user_id=owner_user_id,
            owner_username=owner_username,
            stream_path=_build_output_path(job_id, spotify_url, title, artist),
            live_stream=True,
            status="running",
            progress=1,
            phase="Waiting for player",
        )
        async with self._lock:
            self._jobs[job.id] = job
        self._prepare_live_stream_source(job)
        return job

    def cancel_active_downloads(self) -> None:
        for job in self._jobs.values():
            if job.status in ("queued", "running"):
                job.status = "canceled"
                job.error = "Canceled by new stream"
                job.set_progress(job.progress, "Canceled")
                self._terminate_process(job.id)
                _cleanup_partial(job.stream_path)

    def get(self, job_id: str) -> DownloadJob | None:
        return self._jobs.get(job_id)

    def list_recent(self) -> list[DownloadJob]:
        return sorted(self._jobs.values(), key=lambda job: job.created_at, reverse=True)[:25]

    def open_live_stream(self, job_id: str) -> tuple[Iterator[bytes], str, dict[str, str]]:
        job = self.get(job_id)
        if not job or not job.live_stream:
            raise RuntimeError("Live stream job not found")
        if job.status == "canceled":
            raise RuntimeError("Live stream was canceled")

        source = self._wait_for_live_stream_source(job)
        job.add_log(f"Streaming via {source.provider}")
        job.set_progress(max(job.progress, 8), f"Streaming via {source.provider}")

        response = requests.get(
            source.url,
            headers=source.headers or None,
            stream=True,
            timeout=(20, 180),
        )
        response.raise_for_status()

        total = int(response.headers.get("Content-Length") or 0)
        job.total_bytes = total
        headers = {"Cache-Control": "no-store"}

        return self._iter_live_stream(job, response, total), source.media_type, headers

    def _prepare_live_stream_source(self, job: DownloadJob) -> None:
        event = threading.Event()
        with self._stream_source_lock:
            self._stream_source_events[job.id] = event

        def resolve() -> None:
            try:
                job.set_progress(max(job.progress, 2), "Resolving stream source")
                source = resolve_stream_source(job)
                with self._stream_source_lock:
                    self._stream_sources[job.id] = source
                job.stream_provider = source.provider
                job.stream_quality = source.quality_label
                job.set_progress(max(job.progress, 6), f"Resolved {source.provider}")
            except Exception as exc:
                with self._stream_source_lock:
                    self._stream_source_errors[job.id] = exc
                job.error = str(exc)
                job.set_progress(job.progress or 100, "Stream source failed")
            finally:
                event.set()

        threading.Thread(target=resolve, name=f"stream-source-{job.id[:8]}", daemon=True).start()

    def _wait_for_live_stream_source(self, job: DownloadJob):
        with self._stream_source_lock:
            event = self._stream_source_events.get(job.id)
        if not event:
            self._prepare_live_stream_source(job)
            with self._stream_source_lock:
                event = self._stream_source_events[job.id]

        event.wait(timeout=30)
        with self._stream_source_lock:
            if job.id in self._stream_sources:
                return self._stream_sources[job.id]
            error = self._stream_source_errors.get(job.id)
        if error:
            raise error
        raise RuntimeError("Timed out resolving stream source")

    def _iter_live_stream(
        self,
        job: DownloadJob,
        response: requests.Response,
        total: int,
    ) -> Iterator[bytes]:
        downloaded = 0
        try:
            with response:
                for chunk in response.iter_content(chunk_size=32 * 1024):
                    if job.status == "canceled":
                        break
                    if not chunk:
                        continue
                    downloaded += len(chunk)
                    if total:
                        job.set_progress(max(8, min(95, int(downloaded / total * 95))))
                    yield chunk

            if job.status == "canceled":
                return

            job.set_progress(100, "Stream ended")
            job.status = "succeeded"
        except Exception as exc:
            job.error = str(exc)
            job.set_progress(job.progress or 100, "Live stream failed")
            job.status = "failed"
            raise
        finally:
            job.updated_at = time()

    async def _worker_loop(self) -> None:
        while True:
            job_id = await self._queue.get()
            job = self._jobs.get(job_id)
            if job and job.status != "canceled":
                await asyncio.to_thread(self._run_job, job)
            self._queue.task_done()

    def _run_job(self, job: DownloadJob) -> None:
        if job.status == "canceled":
            return

        job.status = "running"
        job.set_progress(5, "Preparing download")
        started_at = time()
        ensure_music_dir(MUSIC_DIR)

        writer = _JobLogWriter(job)
        try:
            job.set_progress(10, "Resolving Spotify metadata")
            process = self._start_process(job)
            for line in process.stdout or []:
                if job.status == "canceled":
                    break
                writer.write(line)
            writer.flush()

            return_code = process.wait()
            if job.status == "canceled":
                _cleanup_partial(job.stream_path)
                return
            if return_code != 0:
                raise RuntimeError(f"SpotiFLAC exited with code {return_code}")

            item = _library_item_for_path(job) or find_newest_audio(MUSIC_DIR, started_at - 1)
            if item:
                job.file_id = item.id
            else:
                newest = find_newest_audio(MUSIC_DIR, 0)
                if newest:
                    job.file_id = newest.id
            job.set_progress(100, "Ready in library")
            job.status = "succeeded"
        except Exception as exc:
            writer.flush()
            job.error = str(exc)
            job.set_progress(job.progress or 100, "Download failed")
            job.status = "failed"
        finally:
            self._unregister_process(job.id)
            job.updated_at = time()

    def _start_process(self, job: DownloadJob) -> subprocess.Popen[str]:
        if not job.stream_path:
            raise RuntimeError("Missing stream output path")
        command = [
            sys.executable,
            "-m",
            "backend.spotiflac_runner",
            "--url",
            job.spotify_url,
            "--output-dir",
            str(MUSIC_DIR),
            "--output-path",
            str(job.stream_path),
            "--services",
            ",".join(DEFAULT_SERVICES),
        ]
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        process = subprocess.Popen(
            command,
            cwd=ROOT_DIR,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        with self._process_lock:
            self._processes[job.id] = process
        return process

    def _terminate_process(self, job_id: str) -> None:
        with self._process_lock:
            process = self._processes.get(job_id)
        if not process or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    def _unregister_process(self, job_id: str) -> None:
        with self._process_lock:
            self._processes.pop(job_id, None)


class _JobLogWriter(io.StringIO):
    def __init__(self, job: DownloadJob) -> None:
        super().__init__()
        self._job = job
        self._lock = threading.Lock()
        self._pending = ""

    def write(self, value: str) -> int:
        with self._lock:
            super().write(value)
            self._pending += value
            while "\n" in self._pending:
                line, self._pending = self._pending.split("\n", 1)
                self._publish(line)
            return len(value)

    def flush(self) -> None:
        with self._lock:
            if self._pending.strip():
                self._publish(self._pending)
            self._pending = ""

    def _publish(self, line: str) -> None:
        clean = line.strip()
        if not clean:
            return
        self._job.add_log(clean)
        self._job.set_progress(max(self._job.progress, _progress_from_log(clean)))


def _progress_from_log(line: str) -> int:
    lower = line.lower()
    percent = re.search(r"(\d{1,3})\s*%", line)
    if percent:
        return min(95, max(15, int(percent.group(1))))
    if "fetching metadata" in lower or "metadata fetched" in lower:
        return 15
    if "starting download" in lower:
        return 25
    if "trying service" in lower:
        return 35
    if "download" in lower and ("%" in lower or "progress" in lower):
        return 50
    if "successfully downloaded" in lower:
        return 90
    if "file already exists" in lower or "skipping download" in lower:
        return 90
    if "download completed" in lower:
        return 95
    if "failed" in lower:
        return 75
    return 20


def _build_output_path(job_id: str, spotify_url: str, title: str, artist: str) -> Path:
    if title:
        name = f"{title} - {artist}" if artist else title
    else:
        spotify_id = spotify_url.rstrip("/").split("/")[-1].split("?")[0].replace(":", "_")
        name = f"track-{spotify_id or job_id[:8]}"
    filename = f"{_sanitize_component(name)}--{job_id[:8]}.flac"
    return (MUSIC_DIR / filename).resolve()


def _sanitize_component(value: str) -> str:
    clean = re.sub(r'[<>:"/\\|?*]', "_", value)
    clean = re.sub(r"\s+", " ", clean).strip(" .")
    return clean[:140] or "track"


def _cleanup_partial(path: Path | None) -> None:
    if not path or not path.exists():
        return
    try:
        path.unlink()
    except OSError:
        pass


def _library_item_for_path(job: DownloadJob):
    if not job.stream_path or not job.stream_path.exists():
        return None
    stat = job.stream_path.stat()
    from .models import LibraryItem

    return LibraryItem(
        id=make_file_id(job.stream_path, MUSIC_DIR),
        path=job.stream_path,
        title=job.title or job.stream_path.stem,
        artist=job.artist or "Unknown Artist",
        album=job.album,
        size=stat.st_size,
        modified_at=stat.st_mtime,
        mime_type="audio/flac",
    )

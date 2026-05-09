import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Heart,
  Loader2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Volume2
} from "lucide-react";
import "./styles.css";

type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  cover_url: string;
  spotify_url: string;
};

type Album = {
  id: string;
  title: string;
  artist: string;
  cover_url: string;
  spotify_url: string;
  total_tracks: number;
  release_date: string;
};

type Playlist = {
  id: string;
  title: string;
  owner: string;
  cover_url: string;
  spotify_url: string;
  total_tracks: number;
};

type SearchResults = {
  tracks: Track[];
  albums: Album[];
  playlists: Playlist[];
};

type ListeningStats = {
  recent: Track[];
  favorites: Track[];
  songs: Record<string, { track: Track; count: number }>;
  albums: Record<string, { title: string; artist: string; cover_url: string; count: number }>;
  artists: Record<string, { name: string; cover_url: string; count: number }>;
};

type Job = {
  id: string;
  spotify_url: string;
  title: string;
  artist: string;
  album: string;
  cover_url: string;
  owner_user_id: string;
  owner_username: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  logs: string[];
  error: string | null;
  file_id: string | null;
  progress: number;
  phase: string;
  stream_status: "waiting" | "buffering" | "ready" | "ended" | "unavailable";
  stream_url: string | null;
  stream_provider: string;
  stream_quality: string;
  bytes_available: number;
  total_bytes: number;
};

type AuthUser = {
  id: string;
  username: string;
  role: string;
  is_admin: boolean;
};

type AdminInvite = {
  token: string;
  note: string;
  invite_url: string;
  used_by: string;
  used_by_username: string;
  expired: boolean;
};

type AdminData = {
  users: AuthUser[];
  invites: AdminInvite[];
};

const api = {
  async me(): Promise<{ user: AuthUser | null; setup_required: boolean }> {
    const response = await fetch("/api/auth/me");
    if (!response.ok) throw new Error(await readError(response));
    return response.json();
  },
  async setup(username: string, password: string): Promise<AuthUser> {
    const response = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()).user;
  },
  async login(username: string, password: string): Promise<AuthUser> {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()).user;
  },
  async acceptInvite(token: string, username: string, password: string): Promise<AuthUser> {
    const response = await fetch("/api/auth/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, username, password })
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()).user;
  },
  async generateInviteAccount(token: string): Promise<{ account_id: string; password: string }> {
    const response = await fetch("/api/auth/invites/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json();
  },
  async inviteInfo(token: string): Promise<{ note: string; expires_at: number }> {
    const response = await fetch(`/api/auth/invites/${encodeURIComponent(token)}`);
    if (!response.ok) throw new Error(await readError(response));
    return response.json();
  },
  async createInvite(note: string): Promise<string> {
    const response = await fetch("/api/auth/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note })
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()).invite_url;
  },
  async adminPanel(): Promise<AdminData> {
    const response = await fetch("/api/auth/admin");
    if (!response.ok) throw new Error(await readError(response));
    return response.json();
  },
  async revokeInvite(token: string): Promise<void> {
    const response = await fetch(`/api/auth/admin/invites/${encodeURIComponent(token)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await readError(response));
  },
  async deleteUser(userId: string): Promise<void> {
    const response = await fetch(`/api/auth/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await readError(response));
  },
  async logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
  },
  async search(query: string): Promise<SearchResults> {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(await readError(response));
    return response.json();
  },
  async albumTracks(albumId: string): Promise<Track[]> {
    const response = await fetch(`/api/albums/${encodeURIComponent(albumId)}/tracks`);
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()).tracks;
  },
  async playlistTracks(playlistId: string): Promise<Track[]> {
    const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`);
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()).tracks;
  },
  async germanyTopSongs(): Promise<Track[]> {
    const response = await fetch("/api/charts/de/top-songs");
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()).tracks;
  },
  async stream(track: Track): Promise<Job> {
    const response = await fetch("/api/downloads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spotify_url: track.spotify_url,
        title: track.title,
        artist: track.artist,
        album: track.album,
        cover_url: track.cover_url,
        cancel_active: true,
        stream: true
      })
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json();
  },
  async jobs(): Promise<Job[]> {
    const response = await fetch("/api/jobs");
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()).jobs;
  }
};

const STATS_KEY_PREFIX = "spotimatz:listening-stats";

function emptyStats(): ListeningStats {
  return { recent: [], favorites: [], songs: {}, albums: {}, artists: {} };
}

function statsKey(user: AuthUser): string {
  return `${STATS_KEY_PREFIX}:${user.id}`;
}

function loadStats(user: AuthUser): ListeningStats {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(statsKey(user)) || "");
    return { ...emptyStats(), ...parsed };
  } catch {
    return emptyStats();
  }
}

function saveStats(user: AuthUser, stats: ListeningStats) {
  window.localStorage.setItem(statsKey(user), JSON.stringify(stats));
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.detail || response.statusText;
  } catch {
    return response.statusText;
  }
}

function PlayerApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [view, setView] = useState<"home" | "search" | "admin">("home");
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [expandedAlbums, setExpandedAlbums] = useState<Record<string, Track[]>>({});
  const [expandedPlaylists, setExpandedPlaylists] = useState<Record<string, Track[]>>({});
  const [activeAlbum, setActiveAlbum] = useState<Album | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [loadingAlbums, setLoadingAlbums] = useState<Record<string, boolean>>({});
  const [loadingPlaylists, setLoadingPlaylists] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [streamJob, setStreamJob] = useState<Job | null>(null);
  const [autoPlayKey, setAutoPlayKey] = useState(0);
  const [playbackQueue, setPlaybackQueue] = useState<Track[]>([]);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [queueOpen, setQueueOpen] = useState(false);
  const [dragQueueIndex, setDragQueueIndex] = useState<number | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [message, setMessage] = useState("");
  const [listeningStats, setListeningStats] = useState<ListeningStats>(() => loadStats(user));
  const [germanyTopSongs, setGermanyTopSongs] = useState<Track[]>([]);
  const [loadingGermanyTopSongs, setLoadingGermanyTopSongs] = useState(false);
  const [germanyTopSongsError, setGermanyTopSongsError] = useState("");
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const streamJobRef = useRef<Job | null>(null);
  const playbackQueueRef = useRef<Track[]>([]);
  const playbackIndexRef = useRef(-1);
  const deferredQueueRef = useRef<{ tracks: Track[]; index: number } | null>(null);
  const advancedJobIdsRef = useRef<Set<string>>(new Set());
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    streamJobRef.current = streamJob;
  }, [streamJob]);

  useEffect(() => {
    refreshAll();
    loadGermanyTopSongs();
    const timer = window.setInterval(refreshAll, 2500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      searchRequestIdRef.current += 1;
      if (view === "search") {
        setTracks([]);
        setAlbums([]);
        setPlaylists([]);
        setExpandedAlbums({});
        setExpandedPlaylists({});
        setActiveAlbum(null);
        setActivePlaylist(null);
      }
      setLoadingSearch(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void executeSearch(trimmed);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function loadGermanyTopSongs() {
    setLoadingGermanyTopSongs(true);
    setGermanyTopSongsError("");
    try {
      setGermanyTopSongs(await api.germanyTopSongs());
    } catch (error) {
      setGermanyTopSongsError(error instanceof Error ? error.message : "Charts konnten nicht geladen werden");
    } finally {
      setLoadingGermanyTopSongs(false);
    }
  }

  async function refreshAll() {
    try {
      const nextJobs = await api.jobs();
      const activeStreamJob = streamJobRef.current;
      const refreshedStreamJob = activeStreamJob ? nextJobs.find((job) => job.id === activeStreamJob.id) ?? activeStreamJob : null;
      setJobs(nextJobs);
      if (refreshedStreamJob) {
        setStreamJob(refreshedStreamJob.status === "failed" ? null : refreshedStreamJob);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed");
    }
  }

  async function loadAdminPanel() {
    setAdminLoading(true);
    try {
      setAdminData(await api.adminPanel());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin panel failed");
    } finally {
      setAdminLoading(false);
    }
  }

  async function createInviteFromPanel(event: React.FormEvent) {
    event.preventDefault();
    try {
      const inviteUrl = await api.createInvite(adminNote);
      await navigator.clipboard?.writeText(inviteUrl);
      setAdminNote("");
      setMessage(`Einladungslink erstellt: ${inviteUrl}`);
      await loadAdminPanel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invite failed");
    }
  }

  async function openAdminPanel() {
    setView("admin");
    await loadAdminPanel();
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    await executeSearch(trimmed, true);
  }

  async function executeSearch(searchQuery: string, immediate = false) {
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setView("search");
    setLoadingSearch(true);
    setMessage("");
    try {
      const results = await api.search(searchQuery);
      if (requestId !== searchRequestIdRef.current) return;
      setTracks(results.tracks ?? []);
      setAlbums(results.albums ?? []);
      setPlaylists(results.playlists ?? []);
      setExpandedAlbums({});
      setExpandedPlaylists({});
      setActiveAlbum(null);
      setActivePlaylist(null);
    } catch (error) {
      if (requestId !== searchRequestIdRef.current) return;
      setTracks([]);
      setAlbums([]);
      setPlaylists([]);
      if (immediate) setMessage(error instanceof Error ? error.message : "Search failed");
    } finally {
      if (requestId === searchRequestIdRef.current) setLoadingSearch(false);
    }
  }

  async function startStream(
    track: Track,
    queue: Track[] = [track],
    index = 0,
    deferredQueue?: { tracks: Track[]; index: number },
    promoteQueue = false
  ) {
    setMessage("");
    recordPlay(track);
    const fromVisibleQueue = queue === playbackQueueRef.current || promoteQueue;
    const shouldDeferContext = !deferredQueue && !fromVisibleQueue && queue.length > 1;
    const nextQueue = shouldDeferContext ? [track] : queue;
    const nextIndex = shouldDeferContext ? 0 : index;
    playbackQueueRef.current = nextQueue;
    playbackIndexRef.current = nextIndex;
    deferredQueueRef.current = deferredQueue ?? (shouldDeferContext ? { tracks: queue, index } : null);
    setPlaybackQueue(nextQueue);
    setPlaybackIndex(nextIndex);
    try {
      const job = await api.stream(track);
      setJobs((existing) => [job, ...existing]);
      setStreamJob(job);
      setAutoPlayKey((key) => key + 1);
      setQueueOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stream failed");
    }
  }

  function addToQueue(track: Track) {
    deferredQueueRef.current = null;
    const nextQueue = [...playbackQueueRef.current, track];
    playbackQueueRef.current = nextQueue;
    setPlaybackQueue(nextQueue);
    setQueueOpen(true);
    setMessage(`Eingereiht: ${track.title}`);
  }

  function moveQueueItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const nextQueue = [...playbackQueueRef.current];
    if (from >= nextQueue.length || to >= nextQueue.length) return;
    const [item] = nextQueue.splice(from, 1);
    nextQueue.splice(to, 0, item);
    let nextIndex = playbackIndexRef.current;
    if (from === nextIndex) nextIndex = to;
    else if (from < nextIndex && to >= nextIndex) nextIndex -= 1;
    else if (from > nextIndex && to <= nextIndex) nextIndex += 1;
    playbackQueueRef.current = nextQueue;
    playbackIndexRef.current = nextIndex;
    setPlaybackQueue(nextQueue);
    setPlaybackIndex(nextIndex);
    setDragQueueIndex(to);
  }

  function removeQueueItem(index: number) {
    const nextQueue = playbackQueueRef.current.filter((_, itemIndex) => itemIndex !== index);
    let nextIndex = playbackIndexRef.current;
    if (index === nextIndex) return;
    if (index < nextIndex) nextIndex -= 1;
    playbackQueueRef.current = nextQueue;
    playbackIndexRef.current = nextIndex;
    setPlaybackQueue(nextQueue);
    setPlaybackIndex(nextIndex);
  }

  function clearQueue() {
    deferredQueueRef.current = null;
    playbackQueueRef.current = [];
    playbackIndexRef.current = -1;
    setPlaybackQueue([]);
    setPlaybackIndex(-1);
    setDragQueueIndex(null);
  }

  function recordPlay(track: Track) {
    setListeningStats((existing) => {
      const next: ListeningStats = {
        recent: [track, ...existing.recent.filter((item) => item.id !== track.id)].slice(0, 12),
        favorites: existing.favorites || [],
        songs: { ...existing.songs },
        albums: { ...existing.albums },
        artists: { ...existing.artists }
      };
      const songKey = track.id || track.spotify_url || `${track.artist}-${track.title}`;
      const previousSong = next.songs[songKey];
      next.songs[songKey] = { track, count: (previousSong?.count || 0) + 1 };

      if (track.album) {
        const albumKey = `${track.artist}-${track.album}`.toLowerCase();
        const previousAlbum = next.albums[albumKey];
        next.albums[albumKey] = {
          title: track.album,
          artist: track.artist,
          cover_url: track.cover_url,
          count: (previousAlbum?.count || 0) + 1
        };
      }

      for (const name of track.artist.split(",").map((item) => item.trim()).filter(Boolean)) {
        const artistKey = name.toLowerCase();
        const previousArtist = next.artists[artistKey];
        next.artists[artistKey] = {
          name,
          cover_url: previousArtist?.cover_url || track.cover_url,
          count: (previousArtist?.count || 0) + 1
        };
      }

      saveStats(user, next);
      return next;
    });
  }

  function sameTrack(left: Track, right: Track) {
    return left.id === right.id || Boolean(left.spotify_url && left.spotify_url === right.spotify_url);
  }

  function isFavorite(track: Track | null) {
    return Boolean(track && (listeningStats.favorites || []).some((item) => sameTrack(item, track)));
  }

  function toggleFavorite(track: Track | null) {
    if (!track) return;
    setListeningStats((existing) => {
      const favorites = existing.favorites || [];
      const exists = favorites.some((item) => sameTrack(item, track));
      const next = {
        ...existing,
        favorites: exists ? favorites.filter((item) => !sameTrack(item, track)) : [track, ...favorites.filter((item) => !sameTrack(item, track))]
      };
      saveStats(user, next);
      return next;
    });
  }

  async function searchFromHome(nextQuery: string) {
    setQuery(nextQuery);
    setView("search");
    setLoadingSearch(true);
    setMessage("");
    try {
      const results = await api.search(nextQuery);
      setTracks(results.tracks ?? []);
      setAlbums(results.albums ?? []);
      setPlaylists(results.playlists ?? []);
      setExpandedAlbums({});
      setExpandedPlaylists({});
      setActiveAlbum(null);
      setActivePlaylist(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Search failed");
    } finally {
      setLoadingSearch(false);
    }
  }

  async function playNextInQueue() {
    const currentJobId = streamJobRef.current?.id;
    if (currentJobId && advancedJobIdsRef.current.has(currentJobId)) return;
    const queue = playbackQueueRef.current;
    const nextIndex = playbackIndexRef.current + 1;
    if (nextIndex < 0 || nextIndex >= queue.length) {
      const deferred = deferredQueueRef.current;
      const deferredNextIndex = (deferred?.index ?? -1) + 1;
      if (!deferred || deferredNextIndex >= deferred.tracks.length) return;
      deferredQueueRef.current = null;
      await startStream(deferred.tracks[deferredNextIndex], deferred.tracks, deferredNextIndex, undefined, true);
      return;
    }
    if (currentJobId) advancedJobIdsRef.current.add(currentJobId);
    await startStream(queue[nextIndex], queue, nextIndex);
  }

  async function playPreviousInQueue() {
    const queue = playbackQueueRef.current;
    const previousIndex = playbackIndexRef.current - 1;
    if (previousIndex < 0 || previousIndex >= queue.length) return;
    await startStream(queue[previousIndex], queue, previousIndex);
  }

  async function openAlbum(album: Album) {
    setActiveAlbum(album);
    setActivePlaylist(null);
    if (expandedAlbums[album.id]) {
      return;
    }
    setLoadingAlbums((existing) => ({ ...existing, [album.id]: true }));
    setMessage("");
    try {
      const nextTracks = await api.albumTracks(album.id);
      setExpandedAlbums((existing) => ({ ...existing, [album.id]: nextTracks }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Album lookup failed");
    } finally {
      setLoadingAlbums((existing) => ({ ...existing, [album.id]: false }));
    }
  }

  async function openPlaylist(playlist: Playlist) {
    setActivePlaylist(playlist);
    setActiveAlbum(null);
    if (expandedPlaylists[playlist.id]) {
      return;
    }
    setLoadingPlaylists((existing) => ({ ...existing, [playlist.id]: true }));
    setMessage("");
    try {
      const nextTracks = await api.playlistTracks(playlist.id);
      setExpandedPlaylists((existing) => ({ ...existing, [playlist.id]: nextTracks }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Playlist lookup failed");
    } finally {
      setLoadingPlaylists((existing) => ({ ...existing, [playlist.id]: false }));
    }
  }

  return (
    <main>
      <section className="topbar">
        <div>
          <p className="eyebrow">SpotiMatz Premium</p>
          <h1>Premium streaming.</h1>
        </div>
        <div className="topActions">
          <span className="userBadge">{user.username}</span>
          {user.is_admin ? <button className="textButton" onClick={openAdminPanel}>Admin</button> : null}
          <button className="textButton" onClick={onLogout}>Logout</button>
          <button className="textButton" onClick={() => setView("home")}>Home</button>
          <button className="iconButton" onClick={refreshAll} title="Refresh">
            <RefreshCw size={19} />
          </button>
        </div>
      </section>

      <section className="shell">
        <div className="workspace">
          <form className="searchBar" onSubmit={runSearch}>
            <Search size={21} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tracks, albums, playlists"
            />
            <button disabled={loadingSearch || !query.trim()}>
              {loadingSearch ? <Loader2 className="spin" size={18} /> : "Search"}
            </button>
          </form>

          {message ? <p className="notice">{message}</p> : null}

          {view === "admin" ? (
            <AdminPanel
              currentUser={user}
              data={adminData}
              jobs={jobs}
              loading={adminLoading}
              note={adminNote}
              onNoteChange={setAdminNote}
              onCreateInvite={createInviteFromPanel}
              onRefresh={loadAdminPanel}
              onCopy={(value) => navigator.clipboard?.writeText(value)}
              onRevokeInvite={async (token) => {
                await api.revokeInvite(token);
                await loadAdminPanel();
              }}
              onDeleteUser={async (userId) => {
                await api.deleteUser(userId);
                await loadAdminPanel();
              }}
            />
          ) : view === "home" ? (
            <HomeDashboard
              stats={listeningStats}
              germanyTopSongs={germanyTopSongs}
              germanyTopSongsLoading={loadingGermanyTopSongs}
              germanyTopSongsError={germanyTopSongsError}
              isFavorite={isFavorite}
              onToggleFavorite={toggleFavorite}
              onAddToQueue={addToQueue}
              onStream={startStream}
              onSearch={searchFromHome}
              onReloadGermanyTopSongs={loadGermanyTopSongs}
            />
          ) : (
          <div className="resultGrid">
            {playlists.map((playlist) => (
                <div className="albumGroup" key={playlist.id}>
                  <button className="albumCard" onClick={() => openPlaylist(playlist)} title="Playlist öffnen">
                    <Cover src={playlist.cover_url} />
                    <div className="trackInfo">
                      <h2>{playlist.title}</h2>
                      <p>{playlist.owner}</p>
                      <span>Playlist · {playlist.total_tracks} tracks</span>
                    </div>
                    <span className="albumToggle">
                      {loadingPlaylists[playlist.id] ? <Loader2 className="spin" size={18} /> : <ChevronRight size={18} />}
                    </span>
                  </button>
                </div>
            ))}
            {albums.map((album) => (
                <div className="albumGroup" key={album.id}>
                  <button className="albumCard" onClick={() => openAlbum(album)} title="Album öffnen">
                    <Cover src={album.cover_url} />
                    <div className="trackInfo">
                      <h2>{album.title}</h2>
                      <p>{album.artist}</p>
                      <span>{album.total_tracks} tracks{album.release_date ? ` · ${album.release_date.slice(0, 4)}` : ""}</span>
                    </div>
                    <span className="albumToggle">
                      {loadingAlbums[album.id] ? <Loader2 className="spin" size={18} /> : <ChevronRight size={18} />}
                    </span>
                  </button>
                </div>
            ))}
            {tracks.map((track) => (
              <TrackRow key={track.id} track={track} onStream={startStream} isFavorite={isFavorite(track)} onToggleFavorite={toggleFavorite} onAddToQueue={addToQueue} />
            ))}
            {activeAlbum ? (
              <CollectionOverlay
                kind="Album"
                title={activeAlbum.title}
                subtitle={`${activeAlbum.artist} · ${activeAlbum.total_tracks} tracks${activeAlbum.release_date ? ` · ${activeAlbum.release_date.slice(0, 4)}` : ""}`}
                coverUrl={activeAlbum.cover_url}
                tracks={expandedAlbums[activeAlbum.id] ?? []}
                loading={Boolean(loadingAlbums[activeAlbum.id])}
                loadingText="Album wird geladen"
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
                onAddToQueue={addToQueue}
                onClose={() => setActiveAlbum(null)}
                onStream={(track, queue, index) => startStream(track, queue, index)}
              />
            ) : null}
            {activePlaylist ? (
              <CollectionOverlay
                kind="Playlist"
                title={activePlaylist.title}
                subtitle={`${activePlaylist.owner} · ${activePlaylist.total_tracks} tracks`}
                coverUrl={activePlaylist.cover_url}
                tracks={expandedPlaylists[activePlaylist.id] ?? []}
                loading={Boolean(loadingPlaylists[activePlaylist.id])}
                loadingText="Playlist wird geladen"
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
                onAddToQueue={addToQueue}
                onClose={() => setActivePlaylist(null)}
                onStream={(track, queue, index) => startStream(track, [track], 0, { tracks: queue, index })}
              />
            ) : null}
          </div>
          )}
        </div>

      </section>

      <Player
        streamJob={streamJob}
        autoPlayKey={autoPlayKey}
        isFavorite={isFavorite}
        onToggleFavorite={toggleFavorite}
        onPlaybackError={setMessage}
        onEnded={playNextInQueue}
        onPrevious={playPreviousInQueue}
      />
      <QueuePanel
        tracks={playbackQueue}
        currentIndex={playbackIndex}
        open={queueOpen}
        dragIndex={dragQueueIndex}
        onToggle={() => setQueueOpen((open) => !open)}
        onClose={() => setQueueOpen(false)}
        onPlay={(track, index) => startStream(track, playbackQueueRef.current, index)}
        onRemove={removeQueueItem}
        onClear={clearQueue}
        onDragStart={setDragQueueIndex}
        onDragOver={moveQueueItem}
        onDragEnd={() => setDragQueueIndex(null)}
      />
    </main>
  );
}

function AdminPanel({
  currentUser,
  data,
  jobs,
  loading,
  note,
  onNoteChange,
  onCreateInvite,
  onRefresh,
  onCopy,
  onRevokeInvite,
  onDeleteUser
}: {
  currentUser: AuthUser;
  data: AdminData | null;
  jobs: Job[];
  loading: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  onCreateInvite: (event: React.FormEvent) => void;
  onRefresh: () => void;
  onCopy: (value: string) => void;
  onRevokeInvite: (token: string) => void;
  onDeleteUser: (userId: string) => void;
}) {
  const users = data?.users || [];
  const invites = data?.invites || [];
  const activeInvites = invites.filter((invite) => !invite.used_by && !invite.expired).length;
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  return (
    <div className="adminPanel">
      <section className="adminHero">
        <div>
          <p className="eyebrow">Administration</p>
          <h2>Admin Panel</h2>
          <small>{activeInvites} aktive Invites · {users.length} User</small>
        </div>
        <button className="miniTextButton" onClick={onRefresh}>{loading ? "Lädt" : "Aktualisieren"}</button>
      </section>

      <section className="adminStats">
        <div><strong>{users.length}</strong><span>User</span></div>
        <div><strong>{invites.length}</strong><span>Invites gesamt</span></div>
        <div><strong>{activeInvites}</strong><span>Aktiv</span></div>
      </section>

      <section className="homeSection adminComposer">
        <div className="sectionHeader">
          <h2>Neuer Invite</h2>
        </div>
        <form className="adminInviteForm" onSubmit={onCreateInvite}>
          <label>
            Hinweis zum Invite-Link
            <textarea value={note} maxLength={500} onChange={(event) => onNoteChange(event.target.value)} placeholder="z. B. Für Wohnzimmer-Tablet, gültig für Familie" />
          </label>
          <button className="textButton">Invite-Link erstellen</button>
        </form>
      </section>

      <section className="homeSection">
        <div className="sectionHeader"><h2>Invite Links</h2></div>
        <div className="adminList">
          {invites.length === 0 ? <Empty text="Keine Invite-Links vorhanden" /> : null}
          {invites.map((invite) => {
            const status = invite.used_by ? `Verbraucht von ${invite.used_by_username || invite.used_by}` : invite.expired ? "Abgelaufen" : "Aktiv";
            const statusClass = invite.used_by ? "used" : invite.expired ? "expired" : "active";
            return (
              <div className={`adminRow invite ${statusClass}`} key={invite.token}>
                <span>
                  <strong><span className="statusDot"></span>{status}</strong>
                  <small>{invite.note || "Kein Hinweis hinterlegt"}</small>
                  <code>{invite.invite_url}</code>
                </span>
                <div className="adminActions">
                  <button className="textButton" onClick={() => onCopy(invite.invite_url)}>Kopieren</button>
                  <button className="textButton danger" onClick={() => onRevokeInvite(invite.token)}>Löschen</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="homeSection">
        <div className="sectionHeader"><h2>User</h2></div>
        <div className="adminList">
          {users.length === 0 ? <Empty text="Keine User vorhanden" /> : null}
          {users.map((item) => (
            <div className={`adminRow user ${item.is_admin ? "adminUser" : ""}`} key={item.id}>
              <span>
                <strong>{item.username} {item.is_admin ? <em>Admin</em> : null}</strong>
                <small>{item.role} · {item.id}</small>
              </span>
              <div className="adminActions">
                <button className="textButton danger" disabled={item.id === currentUser.id} onClick={() => onDeleteUser(item.id)}>Löschen</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="homeSection adminDebugSection">
        <div className="sectionHeader"><h2>Debugging</h2><span className="debugHint">Live aus /api/jobs</span></div>
        <div className="debugStatusGrid">
          <div><span>Poll</span><strong>ok</strong></div>
          <div><span>Jobs</span><strong>{jobs.length}</strong></div>
          <div><span>Aktiv</span><strong>{activeJobs}</strong></div>
          <div><span>Update</span><strong>{new Date().toLocaleTimeString()}</strong></div>
        </div>
        <div className="adminDebugLayout">
          <div>
            <h3>Jobs</h3>
            <div className="debugJobList">
              {jobs.length === 0 ? <Empty text="Noch keine Jobs" /> : null}
              {jobs.map((job) => {
                const progress = Math.max(0, Math.min(100, job.progress || 0));
                return (
                  <article className="debugJobCard" key={job.id}>
                    <div className="debugJobTop">
                      <strong>{job.title || "Untitled"}</strong>
                      <span className={`debugBadge ${job.status}`}>{job.status}</span>
                    </div>
                    <small>
                      {job.artist || "Unknown artist"} · {job.album || "Unknown album"}<br />
                      user={job.owner_username || "unknown"}{job.owner_user_id ? ` · ${job.owner_user_id}` : ""}<br />
                      stream={job.stream_status} · phase={job.phase || "-"}<br />
                      provider={job.stream_provider || "-"} · quality={job.stream_quality || "-"}<br />
                      bytes={Number(job.bytes_available || 0).toLocaleString()} / {Number(job.total_bytes || 0).toLocaleString()} · id={job.id}
                    </small>
                    <div className="jobProgress"><span style={{ width: `${progress}%` }} /></div>
                    {job.error ? <pre className="debugLogs">ERROR: {job.error}</pre> : null}
                    <pre className="debugLogs">{(job.logs || []).slice(-12).map((line) => `> ${line}`).join("\n") || "No logs yet"}</pre>
                  </article>
                );
              })}
            </div>
          </div>
          <div>
            <h3>Live Log</h3>
            <pre className="debugEventLog">{jobs.map((job) => `[${job.status}/${job.stream_status}] ${job.owner_username || "unknown"}: ${job.title || job.spotify_url}: ${job.phase || job.error || "updated"}`).join("\n") || "No events yet"}</pre>
          </div>
        </div>
      </section>
    </div>
  );
}

function HomeDashboard({
  stats,
  germanyTopSongs,
  germanyTopSongsLoading,
  germanyTopSongsError,
  isFavorite,
  onToggleFavorite,
  onAddToQueue,
  onStream,
  onSearch,
  onReloadGermanyTopSongs
}: {
  stats: ListeningStats;
  germanyTopSongs: Track[];
  germanyTopSongsLoading: boolean;
  germanyTopSongsError: string;
  isFavorite: (track: Track | null) => boolean;
  onToggleFavorite: (track: Track | null) => void;
  onAddToQueue: (track: Track) => void;
  onStream: (track: Track, queue?: Track[], index?: number) => void;
  onSearch: (query: string) => void;
  onReloadGermanyTopSongs: () => void;
}) {
  const topSongs = Object.values(stats.songs).sort((a, b) => b.count - a.count).slice(0, 8);
  const topAlbums = Object.values(stats.albums).sort((a, b) => b.count - a.count).slice(0, 6);
  const topArtists = Object.values(stats.artists).sort((a, b) => b.count - a.count).slice(0, 8);

  return (
    <div className="homeView">
      <section className="homeSection">
        <div className="sectionHeader">
          <h2>Top Songs Deutschland</h2>
          <button className="miniTextButton" onClick={onReloadGermanyTopSongs} disabled={germanyTopSongsLoading}>
            {germanyTopSongsLoading ? "Lädt" : "Aktualisieren"}
          </button>
        </div>
        {germanyTopSongsError ? <Empty text={`Charts nicht verfügbar: ${germanyTopSongsError}`} /> : null}
        {!germanyTopSongsError && germanyTopSongsLoading && germanyTopSongs.length === 0 ? <Empty text="Charts werden geladen" /> : null}
        {!germanyTopSongsError && !germanyTopSongsLoading && germanyTopSongs.length === 0 ? <Empty text="Keine Charts gefunden" /> : null}
        <div className="homeList">
          {germanyTopSongs.slice(0, 12).map((track, index) => (
            <TrackRow key={`${track.id}-${index}`} track={track} onStream={() => onStream(track, germanyTopSongs, index)} isFavorite={isFavorite(track)} onToggleFavorite={onToggleFavorite} onAddToQueue={onAddToQueue} compact />
          ))}
        </div>
      </section>

      <section className="homeSection">
        <div className="sectionHeader">
          <h2>Favoriten</h2>
        </div>
        {(stats.favorites || []).length === 0 ? <Empty text="Noch keine Favoriten" /> : null}
        <div className="homeList">
          {(stats.favorites || []).map((track, index) => (
            <TrackRow key={`${track.id}-${index}`} track={track} onStream={() => onStream(track, stats.favorites || [], index)} isFavorite={isFavorite(track)} onToggleFavorite={onToggleFavorite} onAddToQueue={onAddToQueue} compact />
          ))}
        </div>
      </section>

      <section className="homeSection">
        <div className="sectionHeader">
          <h2>Zuletzt gehört</h2>
        </div>
        {stats.recent.length === 0 ? <Empty text="Noch keine Titel gehört" /> : null}
        <div className="homeList">
          {stats.recent.map((track, index) => (
            <TrackRow key={`${track.id}-${index}`} track={track} onStream={() => onStream(track, stats.recent, index)} isFavorite={isFavorite(track)} onToggleFavorite={onToggleFavorite} onAddToQueue={onAddToQueue} compact />
          ))}
        </div>
      </section>

      <section className="homeSection">
        <div className="sectionHeader">
          <h2>Top Songs</h2>
        </div>
        <div className="homeList">
          {topSongs.map((entry, index) => (
            <TrackRow key={`${entry.track.id}-${index}`} track={entry.track} onStream={() => onStream(entry.track, topSongs.map((item) => item.track), index)} isFavorite={isFavorite(entry.track)} onToggleFavorite={onToggleFavorite} onAddToQueue={onAddToQueue} compact />
          ))}
        </div>
      </section>

      <section className="homeColumns">
        <div className="homeSection">
          <div className="sectionHeader">
            <h2>Top Alben</h2>
          </div>
          {topAlbums.map((album) => (
            <button className="statRow" key={`${album.artist}-${album.title}`} onClick={() => onSearch(`${album.artist} ${album.title}`)}>
              <Cover src={album.cover_url} />
              <span>
                <strong>{album.title}</strong>
                <small>{album.artist} · {album.count} Plays</small>
              </span>
            </button>
          ))}
        </div>

        <div className="homeSection">
          <div className="sectionHeader">
            <h2>Top Interpreten</h2>
          </div>
          {topArtists.map((artist) => (
            <button className="statRow" key={artist.name} onClick={() => onSearch(artist.name)}>
              <Cover src={artist.cover_url} />
              <span>
                <strong>{artist.name}</strong>
                <small>{artist.count} Plays</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function CollectionOverlay({
  kind,
  title,
  subtitle,
  coverUrl,
  tracks,
  loading,
  loadingText,
  isFavorite,
  onToggleFavorite,
  onAddToQueue,
  onClose,
  onStream
}: {
  kind: "Album" | "Playlist";
  title: string;
  subtitle: string;
  coverUrl: string;
  tracks: Track[];
  loading: boolean;
  loadingText: string;
  isFavorite: (track: Track | null) => boolean;
  onToggleFavorite: (track: Track | null) => void;
  onAddToQueue: (track: Track) => void;
  onClose: () => void;
  onStream: (track: Track, queue: Track[], index: number) => void;
}) {
  return (
    <div className="albumOverlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={onClose}>
      <section className="albumWindow" onMouseDown={(event) => event.stopPropagation()}>
        <button className="albumClose" onClick={onClose} title="Schließen">×</button>
        <div className="albumWindowHero">
          <Cover src={coverUrl} />
          <div>
            <p className="eyebrow">{kind}</p>
            <h2>{title}</h2>
            <span>{subtitle}</span>
          </div>
        </div>
        <div className="albumWindowTracks">
          {loading ? <Empty text={loadingText} /> : null}
          {!loading && tracks.length === 0 ? <Empty text="Keine Titel gefunden" /> : null}
          {tracks.map((track, index) => (
            <TrackRow
              key={`${track.id}-${index}`}
              track={track}
              onStream={() => onStream(track, tracks, index)}
              isFavorite={isFavorite(track)}
              onToggleFavorite={onToggleFavorite}
              onAddToQueue={onAddToQueue}
              compact
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function Cover({ src }: { src?: string }) {
  return src ? <img className="cover" src={src} alt="" /> : <div className="cover fallback"><Music2 /></div>;
}

function TrackRow({
  track,
  onStream,
  isFavorite = false,
  onToggleFavorite,
  onAddToQueue,
  compact = false
}: {
  track: Track;
  onStream: (track: Track) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (track: Track | null) => void;
  onAddToQueue?: (track: Track) => void;
  compact?: boolean;
}) {
  return (
    <article
      className={`trackCard ${compact ? "compact" : ""}`}
      role="button"
      tabIndex={0}
      title="Stream"
      onClick={() => onStream(track)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onStream(track);
        }
      }}
    >
      <Cover src={track.cover_url} />
      <div className="trackInfo">
        <h2>{track.title}</h2>
        <p>{track.artist}</p>
        <span>{track.album}</span>
      </div>
      <div className="trackActions">
        <button
          className={`iconButton favoriteButton ${isFavorite ? "active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite?.(track);
          }}
          title={isFavorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
        >
          <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
        </button>
        <button
          className="iconButton queueAddButton"
          onClick={(event) => {
            event.stopPropagation();
            onAddToQueue?.(track);
          }}
          title="In Wiedergabeliste einreihen"
        >
          +
        </button>
        <button
          className="iconButton green"
          onClick={(event) => {
            event.stopPropagation();
            onStream(track);
          }}
          title="Stream"
        >
          <Play size={18} />
        </button>
      </div>
    </article>
  );
}

function QueuePanel({
  tracks,
  currentIndex,
  open,
  dragIndex,
  onToggle,
  onClose,
  onPlay,
  onRemove,
  onClear,
  onDragStart,
  onDragOver,
  onDragEnd
}: {
  tracks: Track[];
  currentIndex: number;
  open: boolean;
  dragIndex: number | null;
  onToggle: () => void;
  onClose: () => void;
  onPlay: (track: Track, index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (from: number, to: number) => void;
  onDragEnd: () => void;
}) {
  return (
    <>
      <button className="queueToggle" onClick={onToggle} title="Wiedergabeliste">
        Liste <strong>{tracks.length}</strong>
      </button>
      {open ? (
        <aside className="queuePanel" aria-label="Wiedergabeliste">
          <div className="queueHeader">
            <div>
              <p className="eyebrow">Wiedergabeliste</p>
              <h2>{tracks.length} Titel</h2>
            </div>
            <div className="queueHeaderActions">
              <button className="queueClear" onClick={onClear} disabled={tracks.length === 0} title="Alle Titel löschen">Leeren</button>
              <button className="albumClose" onClick={onClose} title="Schließen">×</button>
            </div>
          </div>
          <div className="queueList">
            {tracks.length === 0 ? <Empty text="Noch keine Titel eingereiht" /> : null}
            {tracks.map((track, index) => (
              <div
                className={`queueItem ${index === currentIndex ? "current" : ""} ${dragIndex === index ? "dragging" : ""}`}
                data-queue-index={index}
                draggable
                key={`${track.id}-${index}`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(index));
                  onDragStart(index);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = Number(event.dataTransfer.getData("text/plain"));
                  if (Number.isInteger(from)) onDragOver(from, index);
                  onDragEnd();
                }}
                onDragEnd={onDragEnd}
                onPointerMove={(event) => {
                  if (dragIndex === null) return;
                  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-queue-index]") as HTMLElement | null;
                  const targetIndex = Number(target?.dataset.queueIndex);
                  if (Number.isInteger(targetIndex)) onDragOver(dragIndex, targetIndex);
                }}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
              >
                <button
                  className="queueGrip"
                  title="Verschieben"
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    onDragStart(index);
                  }}
                >
                  ≡
                </button>
                <Cover src={track.cover_url} />
                <button className="queueTrack" onClick={() => onPlay(track, index)}>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </button>
                <button className="queueRemove" onClick={() => onRemove(index)} disabled={index === currentIndex} title="Entfernen">×</button>
              </div>
            ))}
          </div>
        </aside>
      ) : null}
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}

function Player({
  streamJob,
  autoPlayKey,
  isFavorite,
  onToggleFavorite,
  onPlaybackError,
  onEnded,
  onPrevious
}: {
  streamJob: Job | null;
  autoPlayKey: number;
  isFavorite: (track: Track | null) => boolean;
  onToggleFavorite: (track: Track | null) => void;
  onPlaybackError: (message: string) => void;
  onEnded: () => void;
  onPrevious: () => void;
}) {
  const streamReady = (streamJob?.stream_status === "ready" || streamJob?.stream_status === "ended") && streamJob.stream_url;
  const sourceUrl = streamJob?.stream_url ?? undefined;
  const title = streamJob ? streamJob.title || "Buffering stream" : "Nothing playing";
  const artist = streamJob ? streamJob.artist || streamJob.phase : "Search a track to begin";
  const quality = streamJob?.stream_quality || "";
  const currentTrack = streamJob ? {
    id: streamJob.spotify_url || streamJob.id,
    title: streamJob.title || "Unknown title",
    artist: streamJob.artist || "",
    album: streamJob.album || "",
    duration_ms: 0,
    cover_url: streamJob.cover_url || "",
    spotify_url: streamJob.spotify_url || ""
  } : null;
  const favorite = isFavorite(currentTrack);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<HTMLElement | null>(null);
  const latestStreamJob = useRef<Job | null>(streamJob);
  const lastSourceUrl = useRef<string | undefined>(undefined);
  const lastAutoPlayKey = useRef(0);
  const statusEndedTimer = useRef<number | null>(null);
  const advancedCurrentSource = useRef(false);
  const onEndedRef = useRef(onEnded);
  const onPreviousRef = useRef(onPrevious);
  const userPaused = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    latestStreamJob.current = streamJob;
  }, [streamJob]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    onPreviousRef.current = onPrevious;
  }, [onPrevious]);

  useEffect(() => {
    const updatePlayerHeight = () => {
      const height = Math.ceil(playerRef.current?.getBoundingClientRect().height || 0);
      if (height > 0) {
        document.documentElement.style.setProperty("--player-current-height", `${height}px`);
      }
    };
    updatePlayerHeight();
    const observer = typeof ResizeObserver !== "undefined" && playerRef.current ? new ResizeObserver(updatePlayerHeight) : null;
    if (observer && playerRef.current) observer.observe(playerRef.current);
    window.addEventListener("resize", updatePlayerHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePlayerHeight);
    };
  }, [expanded, streamJob?.id, quality, sourceUrl]);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    advancedCurrentSource.current = false;
    if (statusEndedTimer.current) {
      window.clearTimeout(statusEndedTimer.current);
      statusEndedTimer.current = null;
    }
  }, [streamJob?.id]);

  useEffect(() => {
    if (streamJob?.stream_status !== "ended" || !sourceUrl || userPaused.current || advancedCurrentSource.current) return;
    statusEndedTimer.current = window.setTimeout(() => {
      if (userPaused.current || advancedCurrentSource.current) return;
      const audio = audioRef.current;
      const browserStillPlaying = audio && !audio.paused && !audio.ended;
      if (browserStillPlaying) return;
      advancedCurrentSource.current = true;
      onEndedRef.current();
    }, 1800);
    return () => {
      if (statusEndedTimer.current) {
        window.clearTimeout(statusEndedTimer.current);
        statusEndedTimer.current = null;
      }
    };
  }, [streamJob?.stream_status, streamJob?.id, sourceUrl]);

  useEffect(() => {
    if (!audioRef.current || !sourceUrl) return;
    if (lastSourceUrl.current !== sourceUrl) {
      audioRef.current.src = sourceUrl;
      audioRef.current.load();
      lastSourceUrl.current = sourceUrl;
    }
    if (autoPlayKey === 0 || lastAutoPlayKey.current === autoPlayKey) return;
    lastAutoPlayKey.current = autoPlayKey;
    userPaused.current = false;
    playCurrentSource();
  }, [sourceUrl, streamJob?.id, autoPlayKey]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }
    const setMediaAction = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Some browsers expose Media Session but not every action.
      }
    };
    const artwork = currentTrack.cover_url
      ? [{ src: currentTrack.cover_url, sizes: "512x512", type: "image/jpeg" }]
      : [];
    if ("MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album,
        artwork
      });
    }
    setMediaAction("play", () => {
      userPaused.current = false;
      playCurrentSource();
    });
    setMediaAction("pause", () => {
      userPaused.current = true;
      audioRef.current?.pause();
      setPlaying(false);
    });
    setMediaAction("stop", () => {
      userPaused.current = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlaying(false);
    });
    setMediaAction("previoustrack", () => {
      const audio = audioRef.current;
      if (audio && audio.currentTime > 5) {
        audio.currentTime = 0;
        setCurrentTime(0);
        return;
      }
      onPreviousRef.current();
    });
    setMediaAction("nexttrack", () => {
      if (advancedCurrentSource.current) return;
      advancedCurrentSource.current = true;
      onEndedRef.current();
    });
    setMediaAction("seekbackward", (details) => {
      if (!audioRef.current) return;
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - (details.seekOffset || 10));
    });
    setMediaAction("seekforward", (details) => {
      if (!audioRef.current) return;
      audioRef.current.currentTime = Math.min(audioRef.current.duration || audioRef.current.currentTime, audioRef.current.currentTime + (details.seekOffset || 10));
    });
    setMediaAction("seekto", (details) => {
      if (!audioRef.current || typeof details.seekTime !== "number") return;
      audioRef.current.currentTime = details.seekTime;
    });
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.cover_url]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : sourceUrl ? "paused" : "none";
    }
  }, [playing, sourceUrl]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !duration) return;
    navigator.mediaSession.setPositionState?.({
      duration,
      playbackRate: audioRef.current?.playbackRate || 1,
      position: Math.min(currentTime, duration)
    });
  }, [currentTime, duration]);

  const progress = useMemo(() => {
    if (!duration) return 0;
    return Math.min(100, (currentTime / duration) * 100);
  }, [currentTime, duration]);

  async function toggle() {
    if (!audioRef.current || !sourceUrl) return;
    if (audioRef.current.paused) {
      userPaused.current = false;
      await playCurrentSource();
    } else {
      userPaused.current = true;
      audioRef.current.pause();
      setPlaying(false);
    }
  }

  async function playCurrentSource() {
    if (!audioRef.current) return;
    try {
      onPlaybackError("");
      await audioRef.current.play();
      setPlaying(true);
    } catch (error) {
      setPlaying(false);
      onPlaybackError(error instanceof Error ? error.message : "Playback failed");
    }
  }

  function changeVolume(value: number) {
    const nextVolume = Math.max(0, Math.min(1, value));
    setVolume(nextVolume);
    if (audioRef.current) audioRef.current.volume = nextVolume;
  }

  return (
    <footer ref={playerRef} className={`player ${expanded ? "expanded" : ""}`}>
      <button
        className="playerHandle"
        onClick={() => setExpanded((value) => !value)}
        title={expanded ? "Hide artwork" : "Show artwork"}
      >
        {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </button>
      <div className="artworkPanel">
        {streamJob?.cover_url ? <img src={streamJob.cover_url} alt="" /> : <div className="artworkFallback"><Music2 size={52} /></div>}
        <div>
          <strong>{title}</strong>
          <small>{artist}</small>
          {streamJob?.album ? <span>{streamJob.album}</span> : null}
        </div>
      </div>
      <div className="now">
        <div className="miniCover">{streamJob?.cover_url ? <img src={streamJob.cover_url} alt="" /> : <Music2 size={20} />}</div>
        <span className="nowMeta">
          <strong>{title}</strong>
          <span className="nowSubline">
            <small>{streamJob && !streamReady ? `${streamJob.stream_status} · ${streamJob.progress}%` : artist}</small>
          </span>
        </span>
      </div>
      <button className="playButton" onClick={toggle} disabled={!sourceUrl} title={playing ? "Pause" : "Play"}>
        {streamJob && !streamReady ? <Loader2 className="spin" size={22} /> : playing ? <Pause size={22} /> : <Play size={22} />}
      </button>
      <button
        className={`iconButton favoriteButton ${favorite ? "active" : ""}`}
        onClick={() => onToggleFavorite(currentTrack)}
        disabled={!currentTrack}
        title={favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
      >
        <Heart size={18} fill={favorite ? "currentColor" : "none"} />
      </button>
      <div className="timeline">
        <span>{formatSeconds(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          value={currentTime}
          onChange={(event) => {
            const value = Number(event.target.value);
            setCurrentTime(value);
            if (audioRef.current) audioRef.current.currentTime = value;
          }}
          style={{ backgroundSize: `${progress}% 100%` }}
        />
        <span>{formatSeconds(duration)}</span>
        <span className="volumeIcon"><Volume2 size={15} /></span>
        <input
          className="volumeSlider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onInput={(event) => changeVolume(Number(event.currentTarget.value))}
          onChange={(event) => changeVolume(Number(event.currentTarget.value))}
          style={{ backgroundSize: `${volume * 100}% 100%` }}
          title={`Volume ${Math.round(volume * 100)}%`}
        />
        <span>{Math.round(volume * 100)}%</span>
      </div>
      {quality ? (
        <div className="playerQuality" title={`${quality}${streamJob?.stream_provider ? ` via ${streamJob.stream_provider}` : ""}`}>
          <span>HQ</span>
          <strong>{quality}</strong>
        </div>
      ) : null}
      <audio
          ref={audioRef}
          src={sourceUrl ?? ""}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onEnded={() => {
            if (advancedCurrentSource.current) return;
            advancedCurrentSource.current = true;
            onEndedRef.current();
          }}
          onError={() => {
            if (!audioRef.current || userPaused.current || !streamJob?.stream_url || streamJob.stream_status === "unavailable") return;
            window.setTimeout(() => {
              if (!audioRef.current || userPaused.current || !latestStreamJob.current) return;
              audioRef.current.load();
              playCurrentSource();
            }, 1200);
          }}
        />
    </footer>
  );
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState(() =>
    window.location.pathname.startsWith("/invite/") ? decodeURIComponent(window.location.pathname.split("/").pop() || "") : ""
  );
  const [inviteNote, setInviteNote] = useState("");
  const [generatedAccount, setGeneratedAccount] = useState<{ account_id: string; password: string } | null>(null);

  useEffect(() => {
    function blockContextMenu(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest(".authScreen")) return;
      event.preventDefault();
    }
    document.addEventListener("contextmenu", blockContextMenu);
    return () => document.removeEventListener("contextmenu", blockContextMenu);
  }, []);

  useEffect(() => {
    api.me()
      .then((data) => {
        setUser(data.user);
        setSetupRequired(data.setup_required);
      })
      .catch((error) => setAuthMessage(error instanceof Error ? error.message : "Login check failed"));
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    api.inviteInfo(inviteToken)
      .then((data) => setInviteNote(data.note || ""))
      .catch((error) => setAuthMessage(error instanceof Error ? error.message : "Invite konnte nicht geladen werden"));
  }, [inviteToken]);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    setAuthMessage("");
    try {
      if (inviteToken) {
        const account = await api.generateInviteAccount(inviteToken);
        setGeneratedAccount(account);
        setInviteToken("");
        window.history.replaceState({}, "", "/");
        return;
      }
      const nextUser = setupRequired
          ? await api.setup(username, password)
          : await api.login(username, password);
      setUser(nextUser);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Login failed");
    }
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  if (user) {
    return <PlayerApp user={user} onLogout={logout} />;
  }

  const inviteMode = Boolean(inviteToken);
  const generatedMode = Boolean(generatedAccount);
  return (
    <main>
      <section className="authScreen">
        <form className="authCard" onSubmit={submitAuth}>
          <p className="eyebrow">SpotiMatz Premium</p>
          <h1>{generatedMode ? "Account generiert" : inviteMode ? "Einladung annehmen" : setupRequired ? "Admin einrichten" : "Login"}</h1>
          <p>
            {generatedMode
              ? "Bitte bewahre diese Accountdaten sicher auf. Das Passwort wird nur jetzt angezeigt."
              : inviteMode
                ? "Klicke auf Account generieren, um deine Zugangsdaten zu erstellen."
                : setupRequired
                  ? "Lege den ersten Admin-Account an."
                  : "Melde dich an, um weiterzuhören."}
          </p>
          {inviteMode && inviteNote ? <p className="inviteNote">{inviteNote}</p> : null}
          {generatedAccount ? (
            <div className="generatedAccount">
              <label>Account ID <strong>{generatedAccount.account_id}</strong></label>
              <label>Passwort <strong>{generatedAccount.password}</strong></label>
              <button type="button" onClick={() => setGeneratedAccount(null)}>Zum Login</button>
            </div>
          ) : null}
          {!inviteMode && !generatedMode ? (
            <>
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Benutzername" autoComplete="username" />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Passwort"
                type="password"
                autoComplete={setupRequired ? "new-password" : "current-password"}
              />
            </>
          ) : null}
          {!generatedMode ? <button>{inviteMode ? "Account generieren" : setupRequired ? "Admin erstellen" : "Einloggen"}</button> : null}
          {authMessage ? <p className="notice">{authMessage}</p> : null}
        </form>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

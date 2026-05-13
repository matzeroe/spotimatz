const STATS_KEY_PREFIX = "spotimatz:listening-stats";

const state = {
  jobs: [],
  albums: [],
  playlists: [],
  tracks: [],
  expandedAlbums: {},
  expandedPlaylists: {},
  activeAlbum: null,
  activePlaylist: null,
  loadingAlbums: {},
  loadingPlaylists: {},
  streamJob: null,
  shouldAutoPlay: false,
  playbackQueue: [],
  playbackIndex: -1,
  deferredQueue: null,
  queueOpen: false,
  dragQueueIndex: null,
  playerExpanded: false,
  userPaused: false,
  lastSourceUrl: "",
  lastAutoPlayConsumed: false,
  advancedJobIds: new Set(),
  advancedCurrentSource: false,
  statusEndedTimer: null,
  view: "home",
  listeningStats: emptyStats(),
  germanyTopSongs: [],
  germanyTopSongsLoading: false,
  germanyTopSongsError: "",
  adminData: null,
  adminLoading: false,
  adminNote: "",
  debugSeen: new Map(),
  debugEvents: [],
  debugPollStatus: "waiting",
  debugLastUpdate: "never",
  searchTimer: null,
  searchRequestId: 0,
  user: null,
  setupRequired: false,
  inviteToken: location.pathname.startsWith("/invite/") ? decodeURIComponent(location.pathname.split("/").pop() || "") : "",
  inviteNote: "",
  generatedAccount: null
};

const $ = (id) => document.getElementById(id);
const notice = $("notice");
const results = $("results");
const audio = $("audio");
const play = $("play");
const seek = $("seek");
const volume = $("volume");
const favoriteButton = $("favoriteButton");
const authScreen = $("authScreen");
const authForm = $("authForm");

function emptyStats() {
  return { recent: [], favorites: [], songs: {}, albums: {}, artists: {} };
}

function statsKey() {
  return state.user?.id ? `${STATS_KEY_PREFIX}:${state.user.id}` : STATS_KEY_PREFIX;
}

function loadStats() {
  try {
    return { ...emptyStats(), ...JSON.parse(localStorage.getItem(statsKey()) || "") };
  } catch {
    return emptyStats();
  }
}

function saveStats(stats) {
  if (!state.user?.id) return;
  localStorage.setItem(statsKey(), JSON.stringify(stats));
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {}
    if (response.status === 401) showAuth();
    throw new Error(message);
  }
  return response.json();
}

function setAuthNotice(message) {
  $("authNotice").textContent = message;
  $("authNotice").classList.toggle("hidden", !message);
}

function showAuth() {
  authScreen.classList.remove("hidden");
  authScreen.hidden = false;
  document.querySelectorAll(".appOnly").forEach((node) => {
    node.classList.add("hidden");
    node.hidden = true;
  });
  const inviteMode = Boolean(state.inviteToken);
  const generatedMode = Boolean(state.generatedAccount);
  const setupMode = state.setupRequired && !inviteMode && !generatedMode;
  $("authTitle").textContent = generatedMode ? "Account generiert" : inviteMode ? "Einladung annehmen" : setupMode ? "Admin einrichten" : "Login";
  $("authHint").textContent = generatedMode
    ? "Bestätige, sobald du deine Zugangsdaten sicher aufbewahrt hast."
    : inviteMode
      ? "Klicke auf Account generieren, um deine Zugangsdaten zu erstellen."
      : setupMode
        ? "Lege den ersten Admin-Account an."
        : "Melde dich an, um weiterzuhören.";
  $("authSubmit").textContent = inviteMode ? "Account generieren" : setupMode ? "Admin erstellen" : "Einloggen";
  $("authSubmit").classList.toggle("hidden", generatedMode);
  $("authUsername").classList.toggle("hidden", inviteMode || generatedMode);
  $("authPassword").classList.toggle("hidden", inviteMode || generatedMode);
  $("inviteNote").textContent = state.inviteNote || "";
  $("inviteNote").classList.toggle("hidden", !(inviteMode && state.inviteNote));
  $("generatedAccount").classList.toggle("hidden", !generatedMode);
  if (state.generatedAccount) {
    $("generatedAccountId").textContent = state.generatedAccount.account_id;
    $("generatedPassword").textContent = state.generatedAccount.password;
  }
}

function showApp() {
  state.listeningStats = loadStats();
  authScreen.classList.add("hidden");
  authScreen.hidden = true;
  document.querySelectorAll(".appOnly").forEach((node) => {
    node.classList.remove("hidden");
    node.hidden = false;
  });
  $("userBadge").textContent = state.user ? state.user.username : "";
  $("userBadge").classList.toggle("hidden", !state.user);
  $("inviteButton").classList.toggle("hidden", !state.user?.is_admin);
  renderQueue();
}

async function loadAuth() {
  const data = await request("/api/auth/me");
  state.user = data.user;
  state.setupRequired = Boolean(data.setup_required);
  if (state.inviteToken) {
    await loadInviteInfo();
  }
  if (state.user) {
    showApp();
    renderHome();
    loadGermanyTopSongs();
    refresh();
    setInterval(refresh, 2500);
  } else {
    showAuth();
  }
}

async function loadInviteInfo() {
  try {
    const data = await request(`/api/auth/invites/${encodeURIComponent(state.inviteToken)}`);
    state.inviteNote = data.note || "";
  } catch (error) {
    state.inviteNote = "";
    setAuthNotice(error.message || "Invite konnte nicht geladen werden");
  }
}

async function submitAuth() {
  setAuthNotice("");
  const username = $("authUsername").value.trim();
  const password = $("authPassword").value;
  const body = state.inviteToken ? { token: state.inviteToken } : { username, password };
  const endpoint = state.inviteToken ? "/api/auth/invites/generate" : state.setupRequired ? "/api/auth/setup" : "/api/auth/login";
  const data = await request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (state.inviteToken) {
    state.generatedAccount = data;
    state.inviteToken = "";
    history.replaceState({}, "", "/");
    showAuth();
    return;
  }
  state.user = data.user;
  showApp();
  renderHome();
  loadGermanyTopSongs();
  refresh();
}

async function createInvite() {
  const note = state.adminNote || "";
  const data = await request("/api/auth/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note })
  });
  await navigator.clipboard?.writeText(data.invite_url).catch(() => {});
  state.adminNote = "";
  await loadAdminPanel();
  showNotice(`Einladungslink erstellt: ${data.invite_url}`);
}

async function loadAdminPanel() {
  state.adminLoading = true;
  renderAdminPanel();
  try {
    state.adminData = await request("/api/auth/admin");
  } finally {
    state.adminLoading = false;
    renderAdminPanel();
  }
}

async function revokeInvite(token) {
  await request(`/api/auth/admin/invites/${encodeURIComponent(token)}`, { method: "DELETE" });
  await loadAdminPanel();
}

async function deleteUser(userId) {
  await request(`/api/auth/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  await loadAdminPanel();
}

async function logout() {
  await request("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  state.listeningStats = emptyStats();
  state.setupRequired = false;
  audio.pause();
  document.querySelectorAll(".queueToggle,.queuePanel").forEach((node) => node.remove());
  showAuth();
}

function showNotice(message) {
  notice.textContent = message;
  notice.classList.toggle("hidden", !message);
}

async function search(query) {
  const requestId = ++state.searchRequestId;
  showNotice("");
  state.view = "search";
  const data = await request(`/api/search?q=${encodeURIComponent(query)}`);
  if (requestId !== state.searchRequestId) return;
  state.albums = data.albums || [];
  state.playlists = data.playlists || [];
  state.tracks = data.tracks || [];
  state.expandedAlbums = {};
  state.expandedPlaylists = {};
  state.activeAlbum = null;
  state.activePlaylist = null;
  renderResults();
}

async function loadGermanyTopSongs() {
  state.germanyTopSongsLoading = true;
  state.germanyTopSongsError = "";
  if (state.view === "home") renderHome();
  try {
    const data = await request("/api/charts/de/top-songs");
    state.germanyTopSongs = data.tracks || [];
  } catch (error) {
    state.germanyTopSongsError = error.message || "Charts konnten nicht geladen werden";
  } finally {
    state.germanyTopSongsLoading = false;
    if (state.view === "home") renderHome();
  }
}

async function loadAlbum(album) {
  state.activeAlbum = album;
  state.activePlaylist = null;
  renderResults();
  if (state.expandedAlbums[album.id]) {
    return;
  }
  showNotice("");
  state.loadingAlbums[album.id] = true;
  renderResults();
  try {
    const data = await request(`/api/albums/${encodeURIComponent(album.id)}/tracks`);
    state.expandedAlbums[album.id] = data.tracks || [];
  } catch (error) {
    showNotice(error.message || "Album lookup failed");
  } finally {
    state.loadingAlbums[album.id] = false;
    renderResults();
  }
}

async function loadPlaylist(playlist) {
  state.activePlaylist = playlist;
  state.activeAlbum = null;
  renderResults();
  if (state.expandedPlaylists[playlist.id]) {
    return;
  }
  showNotice("");
  state.loadingPlaylists[playlist.id] = true;
  renderResults();
  try {
    const data = await request(`/api/playlists/${encodeURIComponent(playlist.id)}/tracks`);
    state.expandedPlaylists[playlist.id] = data.tracks || [];
  } catch (error) {
    showNotice(error.message || "Playlist lookup failed");
  } finally {
    state.loadingPlaylists[playlist.id] = false;
    renderResults();
  }
}

async function streamTrack(track, queue = [track], index = 0, deferredQueue = null, promoteQueue = false) {
  showNotice("");
  recordPlay(track);
  const fromVisibleQueue = queue === state.playbackQueue || promoteQueue;
  const shouldDeferContext = !deferredQueue && !fromVisibleQueue && queue.length > 1;
  state.playbackQueue = shouldDeferContext ? [track] : queue;
  state.playbackIndex = shouldDeferContext ? 0 : index;
  state.deferredQueue = deferredQueue || (shouldDeferContext ? { tracks: queue, index } : null);
  state.advancedCurrentSource = false;
  if (state.statusEndedTimer) {
    clearTimeout(state.statusEndedTimer);
    state.statusEndedTimer = null;
  }
  const job = await request("/api/downloads", {
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
  state.jobs = [job, ...state.jobs.filter((existing) => existing.status !== "queued" && existing.status !== "running")];
  state.streamJob = job;
  state.shouldAutoPlay = true;
  state.lastAutoPlayConsumed = false;
  state.userPaused = false;
  audio.pause();
  audio.removeAttribute("src");
  state.lastSourceUrl = "";
  audio.load();
  renderJobs();
  renderPlayer();
  renderQueue();
  playCurrentSource();
}

function addToQueue(track) {
  state.deferredQueue = null;
  state.playbackQueue = [...state.playbackQueue, track];
  state.queueOpen = true;
  showNotice(`Eingereiht: ${track.title}`);
  renderQueue();
}

function moveQueueItem(from, to) {
  if (from === to || from < 0 || to < 0) return;
  if (from >= state.playbackQueue.length || to >= state.playbackQueue.length) return;
  const queue = [...state.playbackQueue];
  const [item] = queue.splice(from, 1);
  queue.splice(to, 0, item);
  let nextIndex = state.playbackIndex;
  if (from === nextIndex) nextIndex = to;
  else if (from < nextIndex && to >= nextIndex) nextIndex -= 1;
  else if (from > nextIndex && to <= nextIndex) nextIndex += 1;
  state.playbackQueue = queue;
  state.playbackIndex = nextIndex;
  state.dragQueueIndex = to;
  renderQueue();
}

function removeQueueItem(index) {
  if (index === state.playbackIndex) return;
  state.playbackQueue = state.playbackQueue.filter((_, itemIndex) => itemIndex !== index);
  if (index < state.playbackIndex) state.playbackIndex -= 1;
  renderQueue();
}

function clearQueue() {
  state.deferredQueue = null;
  state.playbackQueue = [];
  state.playbackIndex = -1;
  state.dragQueueIndex = null;
  renderQueue();
}

function recordPlay(track) {
  const stats = state.listeningStats || emptyStats();
  const next = {
    recent: [track, ...(stats.recent || []).filter((item) => item.id !== track.id)].slice(0, 12),
    favorites: stats.favorites || [],
    songs: { ...(stats.songs || {}) },
    albums: { ...(stats.albums || {}) },
    artists: { ...(stats.artists || {}) }
  };
  const songKey = track.id || track.spotify_url || `${track.artist}-${track.title}`;
  next.songs[songKey] = { track, count: (next.songs[songKey]?.count || 0) + 1 };
  if (track.album) {
    const albumKey = `${track.artist}-${track.album}`.toLowerCase();
    next.albums[albumKey] = {
      title: track.album,
      artist: track.artist,
      cover_url: track.cover_url,
      count: (next.albums[albumKey]?.count || 0) + 1
    };
  }
  String(track.artist || "").split(",").map((item) => item.trim()).filter(Boolean).forEach((name) => {
    const artistKey = name.toLowerCase();
    next.artists[artistKey] = {
      name,
      cover_url: next.artists[artistKey]?.cover_url || track.cover_url,
      count: (next.artists[artistKey]?.count || 0) + 1
    };
  });
  state.listeningStats = next;
  saveStats(next);
  if (state.view === "home") renderHome();
}

function trackFromJob(job) {
  if (!job) return null;
  return {
    id: job.spotify_url || job.id,
    title: job.title || "Unknown title",
    artist: job.artist || "",
    album: job.album || "",
    duration_ms: 0,
    cover_url: job.cover_url || "",
    spotify_url: job.spotify_url || ""
  };
}

function sameTrack(left, right) {
  return Boolean(left && right && (left.id === right.id || (left.spotify_url && left.spotify_url === right.spotify_url)));
}

function isFavoriteTrack(track) {
  return (state.listeningStats?.favorites || []).some((item) => sameTrack(item, track));
}

function toggleFavorite(track) {
  if (!track || !state.user?.id) return;
  const stats = state.listeningStats || emptyStats();
  const favorites = stats.favorites || [];
  const exists = isFavoriteTrack(track);
  const next = {
    ...stats,
    favorites: exists ? favorites.filter((item) => !sameTrack(item, track)) : [track, ...favorites.filter((item) => !sameTrack(item, track))]
  };
  state.listeningStats = next;
  saveStats(next);
  renderPlayer();
  if (state.view === "home") renderHome();
  if (state.view === "search") renderResults();
}

function addDebugEvent(message) {
  state.debugEvents.unshift(`[${new Date().toLocaleTimeString()}] ${message}`);
  state.debugEvents.splice(160);
}

function summarizeDebugJob(job) {
  return [
    job.status,
    job.stream_status,
    job.phase,
    job.progress,
    job.stream_provider,
    job.stream_quality,
    job.error,
    (job.logs || []).slice(-1)[0] || ""
  ].join("|");
}

function trackDebugJobs(jobs) {
  for (const job of jobs) {
    const summary = summarizeDebugJob(job);
    const previous = state.debugSeen.get(job.id);
    if (!previous) {
      addDebugEvent(`job ${job.id.slice(0, 8)} created: ${job.title || job.spotify_url}`);
    } else if (previous !== summary) {
      addDebugEvent(`job ${job.id.slice(0, 8)} ${job.status}/${job.stream_status}: ${job.phase || job.error || "updated"}`);
    }
    state.debugSeen.set(job.id, summary);
  }
}

function playNextInQueue() {
  const currentJobId = state.streamJob?.id;
  if (currentJobId && state.advancedJobIds.has(currentJobId)) return;
  const nextIndex = state.playbackIndex + 1;
  if (nextIndex < 0 || nextIndex >= state.playbackQueue.length) {
    const deferred = state.deferredQueue;
    const deferredNextIndex = (deferred?.index ?? -1) + 1;
    if (!deferred || deferredNextIndex >= deferred.tracks.length) return;
    state.deferredQueue = null;
    streamTrack(deferred.tracks[deferredNextIndex], deferred.tracks, deferredNextIndex, null, true).catch((error) => showNotice(error.message));
    return;
  }
  if (currentJobId) state.advancedJobIds.add(currentJobId);
  streamTrack(state.playbackQueue[nextIndex], state.playbackQueue, nextIndex).catch((error) => showNotice(error.message));
}

function playPreviousInQueue() {
  if (audio.currentTime > 5) {
    audio.currentTime = 0;
    return;
  }
  const previousIndex = state.playbackIndex - 1;
  if (previousIndex < 0 || previousIndex >= state.playbackQueue.length) return;
  streamTrack(state.playbackQueue[previousIndex], state.playbackQueue, previousIndex).catch((error) => showNotice(error.message));
}

async function refresh() {
  try {
    const jobs = await request("/api/jobs");
    state.jobs = jobs.jobs || [];
    state.debugPollStatus = "ok";
    state.debugLastUpdate = new Date().toLocaleTimeString();
    trackDebugJobs(state.jobs);
    if (state.streamJob) {
      const freshStreamJob = state.jobs.find((job) => job.id === state.streamJob.id);
      state.streamJob = freshStreamJob?.status === "failed" ? null : freshStreamJob || state.streamJob;
    }
    renderJobs();
    renderPlayer();
    if (state.view === "admin") renderAdminDebug();
  } catch (error) {
    state.debugPollStatus = "error";
    addDebugEvent(`poll failed: ${error.message || error}`);
    showNotice(error.message || "Refresh failed");
    if (state.view === "admin") renderAdminDebug();
  }
}

function renderResults() {
  if (state.view === "admin") {
    renderAdminPanel();
    return;
  }
  if (state.view === "home") {
    renderHome();
    return;
  }
  results.innerHTML = "";
  state.playlists.forEach((playlist) => {
    const group = document.createElement("div");
    group.className = "albumGroup";
    const loading = Boolean(state.loadingPlaylists[playlist.id]);
    group.innerHTML = `
      <button class="albumCard" title="Playlist öffnen">
        ${playlist.cover_url ? `<img class="cover" src="${escapeHtml(playlist.cover_url)}" alt="">` : `<div class="cover fallback">♪</div>`}
        <div class="trackInfo">
          <h2>${escapeHtml(playlist.title)}</h2>
          <p>${escapeHtml(playlist.owner)}</p>
          <span>Playlist · ${Number(playlist.total_tracks || 0)} tracks</span>
        </div>
        <span class="albumToggle">${loading ? "…" : "›"}</span>
      </button>
    `;
    group.querySelector(".albumCard").addEventListener("click", () => loadPlaylist(playlist));
    results.appendChild(group);
  });
  state.albums.forEach((album) => {
    const group = document.createElement("div");
    group.className = "albumGroup";
    const loading = Boolean(state.loadingAlbums[album.id]);
    group.innerHTML = `
      <button class="albumCard" title="Album öffnen">
        ${album.cover_url ? `<img class="cover" src="${escapeHtml(album.cover_url)}" alt="">` : `<div class="cover fallback">♪</div>`}
        <div class="trackInfo">
          <h2>${escapeHtml(album.title)}</h2>
          <p>${escapeHtml(album.artist)}</p>
          <span>${Number(album.total_tracks || 0)} tracks${album.release_date ? ` · ${escapeHtml(String(album.release_date).slice(0, 4))}` : ""}</span>
        </div>
        <span class="albumToggle">${loading ? "…" : "›"}</span>
      </button>
    `;
    group.querySelector(".albumCard").addEventListener("click", () => loadAlbum(album));
    results.appendChild(group);
  });
  state.tracks.forEach((track) => {
    results.appendChild(createTrackCard(track));
  });
  renderAlbumOverlay();
  renderPlaylistOverlay();
}

function renderAlbumOverlay() {
  const album = state.activeAlbum;
  if (!album) return;
  const tracks = state.expandedAlbums[album.id] || [];
  const loading = Boolean(state.loadingAlbums[album.id]);
  const overlay = document.createElement("div");
  overlay.className = "albumOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <section class="albumWindow">
      <button class="albumClose" title="Schließen">×</button>
      <div class="albumWindowHero">
        ${album.cover_url ? `<img class="cover" src="${escapeHtml(album.cover_url)}" alt="">` : `<div class="cover fallback">♪</div>`}
        <div>
          <p class="eyebrow">Album</p>
          <h2>${escapeHtml(album.title)}</h2>
          <span>${escapeHtml(album.artist)} · ${Number(album.total_tracks || 0)} tracks${album.release_date ? ` · ${escapeHtml(String(album.release_date).slice(0, 4))}` : ""}</span>
        </div>
      </div>
      <div class="albumWindowTracks"></div>
    </section>
  `;
  const close = () => {
    state.activeAlbum = null;
    renderResults();
  };
  overlay.addEventListener("mousedown", close);
  overlay.querySelector(".albumWindow").addEventListener("mousedown", (event) => event.stopPropagation());
  overlay.querySelector(".albumClose").addEventListener("click", close);
  const trackList = overlay.querySelector(".albumWindowTracks");
  if (loading) {
    trackList.innerHTML = `<p class="empty">Album wird geladen</p>`;
  } else if (!tracks.length) {
    trackList.innerHTML = `<p class="empty">Keine Titel gefunden</p>`;
  } else {
    tracks.forEach((track, index) => trackList.appendChild(createTrackCard(track, true, tracks, index)));
  }
  results.appendChild(overlay);
}

function renderPlaylistOverlay() {
  const playlist = state.activePlaylist;
  if (!playlist) return;
  const tracks = state.expandedPlaylists[playlist.id] || [];
  const loading = Boolean(state.loadingPlaylists[playlist.id]);
  const overlay = document.createElement("div");
  overlay.className = "albumOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <section class="albumWindow">
      <button class="albumClose" title="Schließen">×</button>
      <div class="albumWindowHero">
        ${playlist.cover_url ? `<img class="cover" src="${escapeHtml(playlist.cover_url)}" alt="">` : `<div class="cover fallback">♪</div>`}
        <div>
          <p class="eyebrow">Playlist</p>
          <h2>${escapeHtml(playlist.title)}</h2>
          <span>${escapeHtml(playlist.owner)} · ${Number(playlist.total_tracks || 0)} tracks</span>
        </div>
      </div>
      <div class="albumWindowTracks"></div>
    </section>
  `;
  const close = () => {
    state.activePlaylist = null;
    renderResults();
  };
  overlay.addEventListener("mousedown", close);
  overlay.querySelector(".albumWindow").addEventListener("mousedown", (event) => event.stopPropagation());
  overlay.querySelector(".albumClose").addEventListener("click", close);
  const trackList = overlay.querySelector(".albumWindowTracks");
  if (loading) {
    trackList.innerHTML = `<p class="empty">Playlist wird geladen</p>`;
  } else if (!tracks.length) {
    trackList.innerHTML = `<p class="empty">Keine Titel gefunden</p>`;
  } else {
    tracks.forEach((track, index) => trackList.appendChild(createTrackCard(track, true, [track], 0, { tracks, index })));
  }
  results.appendChild(overlay);
}

function renderAdminPanel() {
  const data = state.adminData || { users: [], invites: [] };
  const activeInvites = data.invites.filter((invite) => !invite.used_by && !invite.expired).length;
  results.innerHTML = `
    <div class="adminPanel">
      <section class="adminHero">
        <div>
          <p class="eyebrow">Administration</p>
          <h2>User & Invites</h2>
          <small>${activeInvites} aktive Invites · ${data.users.length} User</small>
        </div>
        <button class="miniTextButton" id="refreshAdmin">${state.adminLoading ? "Lädt" : "Aktualisieren"}</button>
      </section>
      <section class="adminStats">
        <div><strong>${data.users.length}</strong><span>User</span></div>
        <div><strong>${data.invites.length}</strong><span>Invites gesamt</span></div>
        <div><strong>${activeInvites}</strong><span>Aktiv</span></div>
      </section>
      <section class="homeSection adminComposer">
        <div class="sectionHeader">
          <h2>Neuer Invite</h2>
        </div>
        <form class="adminInviteForm" id="adminInviteForm">
          <label>
            Hinweis zum Invite-Link
            <textarea id="adminInviteNote" maxlength="500" placeholder="z. B. Für Wohnzimmer-Tablet, gültig für Familie"></textarea>
          </label>
          <button class="textButton">Invite-Link erstellen</button>
        </form>
      </section>
      <section class="homeSection">
        <div class="sectionHeader"><h2>Invite Links</h2></div>
        <div class="adminList" id="adminInviteList"></div>
      </section>
      <section class="homeSection">
        <div class="sectionHeader"><h2>User</h2></div>
        <div class="adminList" id="adminUserList"></div>
      </section>
      <section class="homeSection adminDebugSection">
        <div class="sectionHeader"><h2>Debugging</h2><span class="debugHint">Live aus /api/jobs</span></div>
        <div class="debugStatusGrid">
          <div><span>Poll</span><strong id="adminDebugPoll">waiting</strong></div>
          <div><span>Jobs</span><strong id="adminDebugJobCount">0</strong></div>
          <div><span>Aktiv</span><strong id="adminDebugActiveCount">0</strong></div>
          <div><span>Update</span><strong id="adminDebugLastUpdate">never</strong></div>
        </div>
        <div class="adminDebugLayout">
          <div>
            <h3>Jobs</h3>
            <div class="debugJobList" id="adminDebugJobs"></div>
          </div>
          <div>
            <h3>Live Log</h3>
            <pre class="debugEventLog" id="adminDebugEvents"></pre>
          </div>
        </div>
      </section>
    </div>
  `;
  $("refreshAdmin").addEventListener("click", () => loadAdminPanel().catch((error) => showNotice(error.message)));
  $("adminInviteNote").value = state.adminNote;
  $("adminInviteNote").addEventListener("input", (event) => {
    state.adminNote = event.currentTarget.value;
  });
  $("adminInviteForm").addEventListener("submit", (event) => {
    event.preventDefault();
    createInvite().catch((error) => showNotice(error.message));
  });

  const inviteList = $("adminInviteList");
  if (!data.invites.length) inviteList.innerHTML = `<p class="empty">Keine Invite-Links vorhanden</p>`;
  data.invites.forEach((invite) => {
    const status = invite.used_by ? `Verbraucht von ${invite.used_by_username || invite.used_by}` : invite.expired ? "Abgelaufen" : "Aktiv";
    const statusClass = invite.used_by ? "used" : invite.expired ? "expired" : "active";
    const row = document.createElement("div");
    row.className = `adminRow invite ${statusClass}`;
    row.innerHTML = `
      <span>
        <strong><span class="statusDot"></span>${escapeHtml(status)}</strong>
        <small>${escapeHtml(invite.note || "Kein Hinweis hinterlegt")}</small>
        <code>${escapeHtml(invite.invite_url)}</code>
      </span>
      <div class="adminActions">
        <button class="textButton copyInvite">Kopieren</button>
        <button class="textButton danger deleteInvite">Löschen</button>
      </div>
    `;
    row.querySelector(".copyInvite").addEventListener("click", () => {
      navigator.clipboard?.writeText(invite.invite_url).catch(() => {});
      showNotice("Invite-Link kopiert");
    });
    row.querySelector(".deleteInvite").addEventListener("click", () => revokeInvite(invite.token).catch((error) => showNotice(error.message)));
    inviteList.appendChild(row);
  });

  const userList = $("adminUserList");
  if (!data.users.length) userList.innerHTML = `<p class="empty">Keine User vorhanden</p>`;
  data.users.forEach((user) => {
    const row = document.createElement("div");
    row.className = `adminRow user ${user.is_admin ? "adminUser" : ""}`;
    row.innerHTML = `
      <span>
        <strong>${escapeHtml(user.username)} ${user.is_admin ? `<em>Admin</em>` : ""}</strong>
        <small>${escapeHtml(user.role)} · ${escapeHtml(user.id)}</small>
      </span>
      <div class="adminActions">
        <button class="textButton danger deleteUser" ${user.id === state.user?.id ? "disabled" : ""}>Löschen</button>
      </div>
    `;
    row.querySelector(".deleteUser").addEventListener("click", () => {
      if (!window.confirm(`User ${user.username} löschen?`)) return;
      deleteUser(user.id).catch((error) => showNotice(error.message));
    });
    userList.appendChild(row);
  });
  renderAdminDebug();
}

function renderAdminDebug() {
  const jobNode = $("adminDebugJobs");
  const eventNode = $("adminDebugEvents");
  if (!jobNode || !eventNode) return;
  const jobs = state.jobs || [];
  $("adminDebugPoll").textContent = state.debugPollStatus;
  $("adminDebugJobCount").textContent = String(jobs.length);
  $("adminDebugActiveCount").textContent = String(jobs.filter((job) => job.status === "queued" || job.status === "running").length);
  $("adminDebugLastUpdate").textContent = state.debugLastUpdate;
  eventNode.textContent = state.debugEvents.join("\n");
  jobNode.innerHTML = "";
  if (!jobs.length) {
    jobNode.innerHTML = `<p class="empty">Noch keine Jobs</p>`;
    return;
  }
  jobs.forEach((job) => {
    const progress = Math.max(0, Math.min(100, job.progress || 0));
    const logs = (job.logs || []).slice(-12).map((line) => `> ${line}`).join("\n");
    const card = document.createElement("article");
    card.className = "debugJobCard";
    card.innerHTML = `
      <div class="debugJobTop">
        <strong>${escapeHtml(job.title || "Untitled")}</strong>
        <span class="debugBadge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
      </div>
      <small>
        ${escapeHtml(job.artist || "Unknown artist")} · ${escapeHtml(job.album || "Unknown album")}<br>
        user=${escapeHtml(job.owner_username || "unknown")}${job.owner_user_id ? ` · ${escapeHtml(job.owner_user_id)}` : ""}<br>
        stream=${escapeHtml(job.stream_status)} · phase=${escapeHtml(job.phase || "-")}<br>
        provider=${escapeHtml(job.stream_provider || "-")} · quality=${escapeHtml(job.stream_quality || "-")}<br>
        bytes=${Number(job.bytes_available || 0).toLocaleString()} / ${Number(job.total_bytes || 0).toLocaleString()} · id=${escapeHtml(job.id)}
      </small>
      <div class="jobProgress"><span style="width: ${progress}%"></span></div>
      ${job.error ? `<pre class="debugLogs">ERROR: ${escapeHtml(job.error)}</pre>` : ""}
      <pre class="debugLogs">${escapeHtml(logs || "No logs yet")}</pre>
    `;
    jobNode.appendChild(card);
  });
}

function renderHome() {
  const stats = state.listeningStats || emptyStats();
  const topSongs = Object.values(stats.songs || {}).sort((a, b) => b.count - a.count).slice(0, 8);
  const topAlbums = Object.values(stats.albums || {}).sort((a, b) => b.count - a.count).slice(0, 6);
  const topArtists = Object.values(stats.artists || {}).sort((a, b) => b.count - a.count).slice(0, 8);
  results.innerHTML = `
    <div class="homeView">
      <section class="homeSection">
        <div class="sectionHeader">
          <h2>Top Songs Deutschland</h2>
          <button class="miniTextButton" id="reloadGermanyTopSongs">${state.germanyTopSongsLoading ? "Lädt" : "Aktualisieren"}</button>
        </div>
        ${state.germanyTopSongsError ? `<p class="empty">Charts nicht verfügbar: ${escapeHtml(state.germanyTopSongsError)}</p>` : ""}
        ${!state.germanyTopSongsError && state.germanyTopSongsLoading && !state.germanyTopSongs.length ? `<p class="empty">Charts werden geladen</p>` : ""}
        ${!state.germanyTopSongsError && !state.germanyTopSongsLoading && !state.germanyTopSongs.length ? `<p class="empty">Keine Charts gefunden</p>` : ""}
        <div class="homeList" id="germanyTopSongList"></div>
      </section>
      <section class="homeSection">
        <div class="sectionHeader"><h2>Favoriten</h2></div>
        <div class="homeList" id="favoriteList">${(stats.favorites || []).length ? "" : `<p class="empty">Noch keine Favoriten</p>`}</div>
      </section>
      <section class="homeSection">
        <div class="sectionHeader"><h2>Zuletzt gehört</h2></div>
        <div class="homeList" id="recentList">${(stats.recent || []).length ? "" : `<p class="empty">Noch keine Titel gehört</p>`}</div>
      </section>
      <section class="homeSection">
        <div class="sectionHeader"><h2>Top Songs</h2></div>
        <div class="homeList" id="topSongList"></div>
      </section>
      <section class="homeColumns">
        <div class="homeSection">
          <div class="sectionHeader"><h2>Top Alben</h2></div>
          <div class="homeList" id="topAlbumList"></div>
        </div>
        <div class="homeSection">
          <div class="sectionHeader"><h2>Top Interpreten</h2></div>
          <div class="homeList" id="topArtistList"></div>
        </div>
      </section>
    </div>
  `;
  $("reloadGermanyTopSongs").addEventListener("click", loadGermanyTopSongs);
  state.germanyTopSongs.slice(0, 12).forEach((track, index) => $("germanyTopSongList").appendChild(createTrackCard(track, true, state.germanyTopSongs, index)));
  const favorites = stats.favorites || [];
  favorites.forEach((track, index) => $("favoriteList").appendChild(createTrackCard(track, true, favorites, index)));
  const recentList = $("recentList");
  (stats.recent || []).forEach((track, index) => recentList.appendChild(createTrackCard(track, true, stats.recent, index)));
  const topSongTracks = topSongs.map((entry) => entry.track);
  topSongs.forEach((entry, index) => $("topSongList").appendChild(createTrackCard(entry.track, true, topSongTracks, index)));
  topAlbums.forEach((album) => $("topAlbumList").appendChild(createStatRow(album.cover_url, album.title, `${album.artist} · ${album.count} Plays`, () => search(`${album.artist} ${album.title}`).catch((error) => showNotice(error.message)))));
  topArtists.forEach((artist) => $("topArtistList").appendChild(createStatRow(artist.cover_url, artist.name, `${artist.count} Plays`, () => search(artist.name).catch((error) => showNotice(error.message)))));
}

function createStatRow(coverUrl, title, subtitle, onClick) {
  const row = document.createElement("button");
  row.className = "statRow";
  row.innerHTML = `
    ${coverUrl ? `<img class="cover" src="${escapeHtml(coverUrl)}" alt="">` : `<div class="cover fallback">♪</div>`}
    <span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(subtitle)}</small>
    </span>
  `;
  row.addEventListener("click", onClick);
  return row;
}

function createTrackCard(track, compact = false, queue = [track], index = 0, deferredQueue = null) {
    const card = document.createElement("article");
    const favorite = isFavoriteTrack(track);
    card.className = `trackCard ${compact ? "compact" : ""}`;
    card.title = "Stream";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.innerHTML = `
      ${track.cover_url ? `<img class="cover" src="${escapeHtml(track.cover_url)}" alt="">` : `<div class="cover fallback">♪</div>`}
      <div class="trackInfo">
        <h2>${escapeHtml(track.title)}</h2>
        <p>${escapeHtml(track.artist)}</p>
        <span>${escapeHtml(track.album || "")}</span>
      </div>
      <div class="trackActions">
        <button class="iconButton favoriteButton ${favorite ? "active" : ""}" title="${favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}">${favorite ? "♥" : "♡"}</button>
        <button class="iconButton queueAddButton" title="In Wiedergabeliste einreihen">+</button>
        <button class="iconButton green" title="Stream">▶</button>
      </div>
    `;
    const buttons = card.querySelectorAll("button");
    card.addEventListener("click", () => streamTrack(track, queue, index, deferredQueue).catch((error) => showNotice(error.message)));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        streamTrack(track, queue, index, deferredQueue).catch((error) => showNotice(error.message));
      }
    });
    buttons[0].addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(track);
    });
    buttons[1].addEventListener("click", (event) => {
      event.stopPropagation();
      addToQueue(track);
    });
    buttons[2].addEventListener("click", (event) => {
      event.stopPropagation();
      streamTrack(track, queue, index, deferredQueue).catch((error) => showNotice(error.message));
    });
    return card;
}

function renderJobs() {
  return;
}

function renderQueue() {
  updatePlayerHeightVar();
  document.querySelectorAll(".queueToggle,.queuePanel").forEach((node) => node.remove());
  const toggle = document.createElement("button");
  toggle.className = "queueToggle";
  toggle.title = "Wiedergabeliste";
  toggle.innerHTML = `Liste <strong>${state.playbackQueue.length}</strong>`;
  toggle.addEventListener("click", () => {
    state.queueOpen = !state.queueOpen;
    renderQueue();
  });
  document.body.appendChild(toggle);
  if (!state.queueOpen) return;

  const panel = document.createElement("aside");
  panel.className = "queuePanel";
  panel.setAttribute("aria-label", "Wiedergabeliste");
  panel.innerHTML = `
    <div class="queueHeader">
      <div>
        <p class="eyebrow">Wiedergabeliste</p>
        <h2>${state.playbackQueue.length} Titel</h2>
      </div>
      <div class="queueHeaderActions">
        <button class="queueClear" ${state.playbackQueue.length ? "" : "disabled"} title="Alle Titel löschen">Leeren</button>
        <button class="albumClose" title="Schließen">×</button>
      </div>
    </div>
    <div class="queueList"></div>
  `;
  panel.querySelector(".albumClose").addEventListener("click", () => {
    state.queueOpen = false;
    renderQueue();
  });
  panel.querySelector(".queueClear").addEventListener("click", clearQueue);
  const list = panel.querySelector(".queueList");
  if (!state.playbackQueue.length) {
    list.innerHTML = `<p class="empty">Noch keine Titel eingereiht</p>`;
  }
  state.playbackQueue.forEach((track, index) => {
    const item = document.createElement("div");
    item.className = `queueItem ${index === state.playbackIndex ? "current" : ""} ${state.dragQueueIndex === index ? "dragging" : ""}`;
    item.draggable = true;
    item.dataset.queueIndex = String(index);
    item.innerHTML = `
      <button class="queueGrip" title="Verschieben">≡</button>
      ${track.cover_url ? `<img class="cover" src="${escapeHtml(track.cover_url)}" alt="">` : `<div class="cover fallback">♪</div>`}
      <button class="queueTrack">
        <strong>${escapeHtml(track.title)}</strong>
        <small>${escapeHtml(track.artist)}</small>
      </button>
      <button class="queueRemove" ${index === state.playbackIndex ? "disabled" : ""} title="Entfernen">×</button>
    `;
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      state.dragQueueIndex = index;
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData("text/plain"));
      if (Number.isInteger(from)) moveQueueItem(from, index);
      state.dragQueueIndex = null;
      renderQueue();
    });
    item.addEventListener("dragend", () => {
      state.dragQueueIndex = null;
      renderQueue();
    });
    item.addEventListener("pointermove", (event) => {
      if (state.dragQueueIndex === null) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-queue-index]");
      const targetIndex = Number(target?.dataset.queueIndex);
      if (Number.isInteger(targetIndex)) moveQueueItem(state.dragQueueIndex, targetIndex);
    });
    item.addEventListener("pointerup", () => {
      state.dragQueueIndex = null;
      renderQueue();
    });
    item.addEventListener("pointercancel", () => {
      state.dragQueueIndex = null;
      renderQueue();
    });
    item.querySelector(".queueGrip").addEventListener("pointerdown", (event) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      state.dragQueueIndex = index;
    });
    item.querySelector(".queueTrack").addEventListener("click", () => {
      streamTrack(track, state.playbackQueue, index).catch((error) => showNotice(error.message));
    });
    item.querySelector(".queueRemove").addEventListener("click", () => removeQueueItem(index));
    list.appendChild(item);
  });
  document.body.appendChild(panel);
}

function updatePlayerHeightVar() {
  const playerNode = $("player");
  if (!playerNode) return;
  const height = Math.ceil(playerNode.getBoundingClientRect().height || 0);
  if (height > 0) {
    document.documentElement.style.setProperty("--player-current-height", `${height}px`);
  }
}

function updateMediaSessionPosition() {
  if (!("mediaSession" in navigator) || !Number.isFinite(audio.duration) || !audio.duration) return;
  navigator.mediaSession.setPositionState?.({
    duration: audio.duration,
    playbackRate: audio.playbackRate || 1,
    position: Math.min(audio.currentTime || 0, audio.duration)
  });
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const job = state.streamJob;
  const track = trackFromJob(job);
  if (!track) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
    return;
  }
  const setMediaAction = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Some browsers expose Media Session but not every action.
    }
  };
  if ("MediaMetadata" in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.cover_url ? [{ src: track.cover_url, sizes: "512x512", type: "image/jpeg" }] : []
    });
  }
  navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  setMediaAction("play", () => playCurrentSource());
  setMediaAction("pause", () => {
    state.userPaused = true;
    audio.pause();
    play.textContent = "▶";
    navigator.mediaSession.playbackState = "paused";
  });
  setMediaAction("stop", () => {
    state.userPaused = true;
    audio.pause();
    audio.currentTime = 0;
    play.textContent = "▶";
    navigator.mediaSession.playbackState = "none";
  });
  setMediaAction("previoustrack", playPreviousInQueue);
  setMediaAction("nexttrack", () => {
    if (state.advancedCurrentSource) return;
    state.advancedCurrentSource = true;
    playNextInQueue();
  });
  setMediaAction("seekbackward", (details) => {
    audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
    updateMediaSessionPosition();
  });
  setMediaAction("seekforward", (details) => {
    audio.currentTime = Math.min(audio.duration || audio.currentTime, audio.currentTime + (details.seekOffset || 10));
    updateMediaSessionPosition();
  });
  setMediaAction("seekto", (details) => {
    if (typeof details.seekTime !== "number") return;
    audio.currentTime = details.seekTime;
    updateMediaSessionPosition();
  });
}

function renderPlayer() {
  const job = state.streamJob;
  const ready = (job?.stream_status === "ready" || job?.stream_status === "ended") && job.stream_url;
  const source = job?.stream_url;
  $("nowTitle").textContent = job ? job.title || "Buffering stream" : "Nothing playing";
  $("nowArtist").textContent = job && !ready ? `${job.stream_status} · ${job.progress}%` : job?.artist || "Search a track to begin";
  $("player").classList.toggle("expanded", state.playerExpanded);
  $("artworkTitle").textContent = job ? job.title || "Buffering stream" : "Nothing playing";
  $("artworkArtist").textContent = job?.artist || "Search a track to begin";
  $("artworkAlbum").textContent = job?.album || "";
  $("artworkAlbum").classList.toggle("hidden", !job?.album);
  const cover = job?.cover_url || "";
  const quality = job?.stream_quality || "";
  const currentTrack = trackFromJob(job);
  const favorite = isFavoriteTrack(currentTrack);
  $("miniCover").innerHTML = cover ? `<img src="${escapeHtml(cover)}" alt="">` : "♪";
  $("artworkImage").innerHTML = cover ? `<img src="${escapeHtml(cover)}" alt="">` : `<div class="artworkFallback">♪</div>`;
  $("qualityBadge").classList.toggle("hidden", !quality);
  $("qualityLabel").textContent = quality;
  $("qualityBadge").title = quality ? `${quality}${job?.stream_provider ? ` via ${job.stream_provider}` : ""}` : "";
  favoriteButton.disabled = !currentTrack;
  favoriteButton.textContent = favorite ? "♥" : "♡";
  favoriteButton.classList.toggle("active", favorite);
  favoriteButton.title = favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen";
  play.disabled = !source;
  if (source) {
    const sourceHref = new URL(source, window.location.href).href;
    if (state.lastSourceUrl !== sourceHref) {
      audio.src = source;
      audio.load();
      state.lastSourceUrl = sourceHref;
    }
    if (state.shouldAutoPlay && !state.lastAutoPlayConsumed) {
      state.shouldAutoPlay = false;
      state.lastAutoPlayConsumed = true;
      playCurrentSource();
    }
  }
  scheduleEndedStatusFallback(job, source);
  updateMediaSession();
  window.requestAnimationFrame(updatePlayerHeightVar);
}

function scheduleEndedStatusFallback(job, source) {
  if (state.statusEndedTimer) {
    clearTimeout(state.statusEndedTimer);
    state.statusEndedTimer = null;
  }
  if (job?.stream_status !== "ended" || !source || state.userPaused || state.advancedCurrentSource) return;
  state.statusEndedTimer = setTimeout(() => {
    if (state.userPaused || state.advancedCurrentSource) return;
    if (!audio.paused && !audio.ended) return;
    state.advancedCurrentSource = true;
    playNextInQueue();
  }, 1800);
}

function playCurrentSource() {
  if (!audio.src) return;
  state.userPaused = false;
  audio.play().then(() => {
    play.textContent = "Ⅱ";
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  }).catch((error) => {
    play.textContent = "▶";
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    showNotice(error?.message || "Playback failed");
  });
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = String(Math.floor(value % 60)).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuth().catch((error) => setAuthNotice(error.message));
});

$("confirmGeneratedAccount").addEventListener("click", () => {
  state.generatedAccount = null;
  $("authUsername").value = "";
  $("authPassword").value = "";
  showAuth();
});

$("inviteButton").addEventListener("click", () => {
  state.view = "admin";
  loadAdminPanel().catch((error) => showNotice(error.message));
});

$("logoutButton").addEventListener("click", () => {
  logout().catch((error) => showNotice(error.message));
});

$("searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = $("query").value.trim();
  if (state.searchTimer) window.clearTimeout(state.searchTimer);
  if (query) search(query).catch((error) => showNotice(error.message));
});

$("query").addEventListener("input", (event) => {
  const query = event.target.value.trim();
  if (state.searchTimer) window.clearTimeout(state.searchTimer);
  if (query.length < 2) {
    state.searchRequestId += 1;
    if (state.view === "search") {
      state.albums = [];
      state.playlists = [];
      state.tracks = [];
      state.expandedAlbums = {};
      state.expandedPlaylists = {};
      state.activeAlbum = null;
      state.activePlaylist = null;
      renderResults();
    }
    return;
  }
  state.searchTimer = window.setTimeout(() => {
    search(query).catch(() => {});
  }, 280);
});

$("refresh").addEventListener("click", refresh);

$("homeButton").addEventListener("click", () => {
  state.view = "home";
  renderHome();
});

$("playerHandle").addEventListener("click", () => {
  state.playerExpanded = !state.playerExpanded;
  $("playerHandle").textContent = state.playerExpanded ? "⌄" : "⌃";
  renderPlayer();
});

play.addEventListener("click", async () => {
  if (!audio.src) return;
  if (audio.paused) {
    state.userPaused = false;
    await playCurrentSource();
  } else {
    state.userPaused = true;
    audio.pause();
    play.textContent = "▶";
  }
});

audio.addEventListener("loadedmetadata", () => {
  seek.max = audio.duration || 0;
  $("duration").textContent = formatSeconds(audio.duration || 0);
  updateMediaSessionPosition();
});

audio.addEventListener("timeupdate", () => {
  seek.value = audio.currentTime;
  $("currentTime").textContent = formatSeconds(audio.currentTime);
  updateMediaSessionPosition();
});

audio.addEventListener("pause", () => {
  play.textContent = "▶";
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = audio.src ? "paused" : "none";
});

audio.addEventListener("play", () => {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
});

audio.addEventListener("ended", () => {
  if (state.advancedCurrentSource) return;
  state.advancedCurrentSource = true;
  playNextInQueue();
});

audio.addEventListener("error", () => {
  const job = state.streamJob;
  if (state.userPaused || !job?.stream_url || job.stream_status === "unavailable") return;
  setTimeout(() => {
    if (state.userPaused || !state.streamJob) return;
    audio.load();
    audio.play().then(() => {
      play.textContent = "Ⅱ";
    }).catch(() => {
      play.textContent = "▶";
    });
  }, 1200);
});

seek.addEventListener("input", () => {
  audio.currentTime = Number(seek.value);
});

function setVolumeFromSlider() {
  const value = Math.max(0, Math.min(1, Number(volume.value)));
  audio.volume = value;
  volume.style.backgroundSize = `${value * 100}% 100%`;
  $("volumeValue").textContent = `${Math.round(value * 100)}%`;
  volume.title = `Volume ${Math.round(value * 100)}%`;
}

volume.addEventListener("input", setVolumeFromSlider);
volume.addEventListener("change", setVolumeFromSlider);

favoriteButton.addEventListener("click", () => {
  toggleFavorite(trackFromJob(state.streamJob));
});

document.addEventListener("contextmenu", (event) => {
  if (event.target instanceof Element && event.target.closest(".authScreen")) return;
  event.preventDefault();
});

let lastTouchY = 0;

function isScrollControl(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, .queueGrip"));
}

function canScrollElement(element, deltaY) {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll") return false;
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  if (deltaY < 0) return element.scrollTop > 0;
  if (deltaY > 0) return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  return true;
}

function hasScrollableParent(target, deltaY) {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    if (canScrollElement(node, deltaY)) return true;
    node = node.parentElement;
  }
  return false;
}

document.addEventListener("wheel", (event) => {
  if (event.defaultPrevented || isScrollControl(event.target)) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  if (hasScrollableParent(event.target, event.deltaY)) return;
  window.scrollBy({ top: event.deltaY, left: 0, behavior: "auto" });
  event.preventDefault();
}, { capture: true, passive: false });

document.addEventListener("touchstart", (event) => {
  lastTouchY = event.touches[0]?.clientY || 0;
}, { capture: true, passive: true });

document.addEventListener("touchmove", (event) => {
  if (event.defaultPrevented || event.touches.length !== 1 || isScrollControl(event.target)) return;
  const nextY = event.touches[0]?.clientY || lastTouchY;
  const deltaY = lastTouchY - nextY;
  lastTouchY = nextY;
  if (!deltaY || hasScrollableParent(event.target, deltaY)) return;
  window.scrollBy({ top: deltaY, left: 0, behavior: "auto" });
  event.preventDefault();
}, { capture: true, passive: false });

window.addEventListener("resize", updatePlayerHeightVar);

loadAuth().catch(() => showAuth());

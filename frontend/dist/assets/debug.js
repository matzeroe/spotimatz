const jobsNode = document.getElementById("jobs");
const eventLog = document.getElementById("eventLog");
const pollStatus = document.getElementById("pollStatus");
const jobCount = document.getElementById("jobCount");
const activeCount = document.getElementById("activeCount");
const lastUpdate = document.getElementById("lastUpdate");

const seen = new Map();
const events = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function addEvent(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  events.unshift(line);
  events.splice(160);
  eventLog.textContent = events.join("\n");
}

function summarize(job) {
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

function diffJobs(jobs) {
  for (const job of jobs) {
    const summary = summarize(job);
    const previous = seen.get(job.id);
    if (!previous) {
      addEvent(`job ${job.id.slice(0, 8)} created: ${job.title || job.spotify_url}`);
    } else if (previous !== summary) {
      addEvent(`job ${job.id.slice(0, 8)} ${job.status}/${job.stream_status}: ${job.phase || job.error || "updated"}`);
    }
    seen.set(job.id, summary);
  }
}

function renderJobs(jobs) {
  jobsNode.innerHTML = "";
  if (!jobs.length) {
    jobsNode.innerHTML = `<p class="empty">No jobs yet</p>`;
    return;
  }
  for (const job of jobs) {
    const progress = Math.max(0, Math.min(100, job.progress || 0));
    const logs = (job.logs || []).slice(-18).map((line) => `> ${line}`).join("\n");
    const card = document.createElement("article");
    card.className = "jobCard";
    card.innerHTML = `
      <div class="jobTop">
        <div class="jobTitle"><strong>${escapeHtml(job.title || "Untitled")}</strong></div>
        <span class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
      </div>
      <div class="jobMeta">
        ${escapeHtml(job.artist || "Unknown artist")} · ${escapeHtml(job.album || "Unknown album")}<br>
        user=${escapeHtml(job.owner_username || "unknown")}${job.owner_user_id ? ` · ${escapeHtml(job.owner_user_id)}` : ""}<br>
        stream=${escapeHtml(job.stream_status)} · phase=${escapeHtml(job.phase || "-")}<br>
        provider=${escapeHtml(job.stream_provider || "-")} · quality=${escapeHtml(job.stream_quality || "-")}<br>
        bytes=${Number(job.bytes_available || 0).toLocaleString()} / ${Number(job.total_bytes || 0).toLocaleString()} · id=${escapeHtml(job.id)}
      </div>
      <div class="jobProgress"><span style="width: ${progress}%"></span></div>
      ${job.error ? `<div class="jobLogs">ERROR: ${escapeHtml(job.error)}</div>` : ""}
      <pre class="jobLogs">${escapeHtml(logs || "No logs yet")}</pre>
    `;
    jobsNode.appendChild(card);
  }
}

async function refreshDebug() {
  try {
    pollStatus.textContent = "ok";
    const response = await fetch("/api/jobs", { cache: "no-store" });
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    const jobs = data.jobs || [];
    diffJobs(jobs);
    renderJobs(jobs);
    jobCount.textContent = String(jobs.length);
    activeCount.textContent = String(jobs.filter((job) => job.status === "queued" || job.status === "running").length);
    lastUpdate.textContent = new Date().toLocaleTimeString();
  } catch (error) {
    pollStatus.textContent = "error";
    addEvent(`poll failed: ${error?.message || error}`);
  }
}

addEvent("debug interface started");
refreshDebug();
setInterval(refreshDebug, 1500);

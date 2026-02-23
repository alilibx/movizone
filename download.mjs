#!/usr/bin/env node
// Torrent download helper - runs under Node.js to avoid Bun's libuv limitations
import WebTorrent from "webtorrent";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";

const [,, magnet, downloadDir, stateFilePath] = process.argv;

if (!magnet || !downloadDir) {
  console.error(JSON.stringify({ type: "error", message: "Usage: download.mjs <magnet> <dir> [stateFile]" }));
  process.exit(1);
}

if (!existsSync(downloadDir)) {
  mkdirSync(downloadDir, { recursive: true });
}

// Read existing state file to preserve CLI-written metadata (id, movieTitle, etc.)
let existingState = {};
if (stateFilePath) {
  try {
    existingState = JSON.parse(readFileSync(stateFilePath, "utf-8"));
  } catch {}
}

// Current state tracked in memory, flushed to disk on every send()
const state = {
  ...existingState,
  pid: process.pid,
  magnet,
  status: "connecting",
  progress: 0,
  downloaded: 0,
  total: 0,
  speed: 0,
  eta: 0,
  peers: 0,
  filePath: null,
  error: null,
};

function writeState() {
  if (!stateFilePath) return;
  try {
    writeFileSync(stateFilePath, JSON.stringify(state) + "\n");
  } catch {}
}

// Write initial state with PID
writeState();

const client = new WebTorrent();

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  // Mirror to state file
  if (obj.type === "meta") {
    state.total = obj.size;
    state.status = "downloading";
  } else if (obj.type === "progress") {
    state.status = "downloading";
    state.progress = obj.progress;
    state.downloaded = obj.downloaded;
    state.total = obj.total;
    state.speed = obj.speed;
    state.eta = obj.eta;
    state.peers = obj.peers;
  } else if (obj.type === "done") {
    state.status = "done";
    state.progress = 1;
    state.filePath = obj.path;
  } else if (obj.type === "error") {
    state.status = "error";
    state.error = obj.message;
  } else if (obj.type === "timeout") {
    state.status = "timeout";
    state.error = "Could not connect to peers";
  }
  writeState();
}

client.add(magnet, { path: downloadDir }, (torrent) => {
  send({
    type: "meta",
    name: torrent.name,
    size: torrent.length,
  });

  const interval = setInterval(() => {
    send({
      type: "progress",
      progress: torrent.progress,
      downloaded: torrent.downloaded,
      total: torrent.length,
      speed: torrent.downloadSpeed,
      eta: torrent.timeRemaining,
      peers: torrent.numPeers,
    });
  }, 500);

  torrent.on("done", () => {
    clearInterval(interval);
    send({ type: "done", path: `${downloadDir}/${torrent.name}` });
    client.destroy();
    process.exit(0);
  });

  torrent.on("error", (err) => {
    clearInterval(interval);
    send({ type: "error", message: err.message });
    client.destroy();
    process.exit(1);
  });
});

client.on("error", (err) => {
  send({ type: "error", message: err.message });
  client.destroy();
  process.exit(1);
});

// Timeout if no metadata after 30s
setTimeout(() => {
  if (client.torrents.length === 0 || !client.torrents[0].ready) {
    send({ type: "timeout" });
    client.destroy();
    process.exit(0);
  }
}, 30000);

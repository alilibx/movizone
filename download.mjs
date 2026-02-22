#!/usr/bin/env node
// Torrent download helper - runs under Node.js to avoid Bun's libuv limitations
import WebTorrent from "webtorrent";
import { mkdirSync, existsSync } from "fs";

const [,, magnet, downloadDir] = process.argv;

if (!magnet || !downloadDir) {
  console.error(JSON.stringify({ type: "error", message: "Usage: download.mjs <magnet> <dir>" }));
  process.exit(1);
}

if (!existsSync(downloadDir)) {
  mkdirSync(downloadDir, { recursive: true });
}

const client = new WebTorrent();

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
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

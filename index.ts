#!/usr/bin/env bun
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import boxen from "boxen";
import Table from "cli-table3";
import figlet from "figlet";
import gradient from "gradient-string";
import terminalImage from "terminal-image";
import { homedir } from "os";
import { join, dirname } from "path";
import { readdir, rename, unlink, rm, mkdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "readline";
import { fileURLToPath } from "url";

// --- TUI Theme ---

const movizonGradient = gradient(["#ff00ff", "#00ffff"]);

const { version } = require("./package.json");

function renderHeader(): string {
  const ascii = figlet.textSync("MOVIZONE", { font: "ANSI Shadow", horizontalLayout: "fitted" });
  return boxen(movizonGradient.multiline(ascii) + "\n" + chalk.dim(`  Movie Explorer  v${version}`), {
    padding: { top: 0, bottom: 0, left: 2, right: 2 },
    borderStyle: "double",
    borderColor: "magenta",
    dimBorder: true,
  });
}

const DISCLAIMER = chalk.yellow("Disclaimer: ") + chalk.dim(
  "This is a hobby project for educational purposes only. " +
  "The developers do not host, distribute, or endorse any copyrighted content. " +
  "Downloading copyrighted material without authorization may be illegal in your jurisdiction. " +
  "You are solely responsible for ensuring your use complies with applicable laws."
);

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function contextBar(left: string, right: string): string {
  const width = Math.max(process.stdout.columns || 80, 60);
  const innerWidth = width - 4; // boxen borders + padding
  const visibleLeft = stripAnsi(left).length;
  const visibleRight = stripAnsi(right).length;
  const gap = innerWidth - visibleLeft - visibleRight;
  const content = left + " ".repeat(Math.max(gap, 2)) + right;
  return boxen(content, {
    borderStyle: "single",
    borderColor: "gray",
    dimBorder: true,
    padding: 0,
  });
}

function navFooter(): string {
  return boxen(
    chalk.dim("  ↑↓ Navigate") + "  " +
    chalk.dim("⏎ Select") + "  " +
    chalk.dim("n Next") + "  " +
    chalk.dim("p Prev") + "  " +
    chalk.dim("b Back"),
    {
      borderStyle: "single",
      borderColor: "gray",
      dimBorder: true,
      padding: 0,
    }
  );
}

// --- API Layer ---

const API_BASE = "https://yts.torrentbay.st/api/v2";
const DOWNLOAD_DIR = join(homedir(), "Downloads", "Movizone");
const STATE_DIR = join(DOWNLOAD_DIR, ".downloads");

const TRACKERS = [
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.openbittorrent.com:80",
  "udp://tracker.coppersurfer.tk:6969",
  "udp://glotorrents.pw:6969/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://torrent.gresille.org:80/announce",
  "udp://p4p.arenabg.com:1337",
  "udp://tracker.leechers-paradise.org:6969",
];

const SUBTITLE_DOMAINS = ["yts-subs.com", "yifysubtitles.ch"];

const SUBTITLE_LANGUAGES = [
  "English", "Arabic", "Spanish", "French", "German", "Portuguese",
  "Brazilian Portuguese", "Turkish", "Italian", "Dutch", "Polish",
  "Russian", "Chinese", "Korean", "Japanese", "Indonesian", "Romanian",
  "Greek", "Swedish", "Norwegian", "Finnish", "Danish", "Farsi/Persian",
  "Urdu", "Vietnamese",
];

interface Torrent {
  url: string;
  hash: string;
  quality: string;
  type: string;
  seeds: number;
  peers: number;
  size: string;
  size_bytes: number;
  video_codec: string;
  bit_depth: string;
  audio_channels: string;
}

export interface SubtitleEntry {
  language: string;
  release: string;
  rating: number;
  downloadPath: string;
}

interface Movie {
  id: number;
  title: string;
  title_long: string;
  year: number;
  rating: number;
  runtime: number;
  genres: string[];
  summary: string;
  language: string;
  imdb_code: string;
  yt_trailer_code: string;
  small_cover_image: string;
  medium_cover_image: string;
  large_cover_image: string;
  torrents: Torrent[];
}

interface ListResponse {
  status: string;
  data: {
    movie_count: number;
    limit: number;
    page_number: number;
    movies: Movie[];
  };
}

async function apiGet(endpoint: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function listMovies(page = 1, opts: Record<string, any> = {}): Promise<ListResponse> {
  return apiGet("list_movies.json", { limit: 20, page, sort_by: "date_added", order_by: "desc", ...opts });
}

async function searchMovies(query: string, page = 1): Promise<ListResponse> {
  return apiGet("list_movies.json", { query_term: query, limit: 20, page });
}

async function getMovieSuggestions(movieId: number): Promise<ListResponse> {
  return apiGet("movie_suggestions.json", { movie_id: movieId });
}

export function buildMagnet(hash: string, title: string): string {
  const dn = encodeURIComponent(title);
  const trackers = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("");
  return `magnet:?xt=urn:btih:${hash}&dn=${dn}${trackers}`;
}

// --- Poster Image ---

async function fetchPosterImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = new Uint8Array(await res.arrayBuffer());
    return await terminalImage.buffer(buffer, { width: 30 });
  } catch {
    return null;
  }
}

// --- Fuzzy Search ---

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

export function fuzzyScore(query: string, title: string): number {
  const q = query.toLowerCase().trim();
  const t = title.toLowerCase().trim();

  // Exact substring match is best
  if (t.includes(q)) return 100;

  // Check each query word against the title
  const qWords = q.split(/\s+/);
  const tWords = t.split(/\s+/);

  let wordMatches = 0;
  for (const qw of qWords) {
    // Check if it's a year (4 digits)
    if (/^\d{4}$/.test(qw)) continue; // year is handled separately

    let bestDist = Infinity;
    for (const tw of tWords) {
      const dist = levenshtein(qw, tw);
      bestDist = Math.min(bestDist, dist);
    }
    // Allow up to 2 edits per word for a match
    if (bestDist <= 2) wordMatches++;
  }

  const nonYearWords = qWords.filter((w) => !/^\d{4}$/.test(w));
  if (nonYearWords.length === 0) return 0;

  return (wordMatches / nonYearWords.length) * 80;
}

export function extractYear(query: string): number | null {
  const match = query.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : null;
}

export function generateTypoCorrections(word: string): string[] {
  const corrections: string[] = [];
  const w = word.toLowerCase();

  // Priority 1: Transpose adjacent characters (most common typo)
  for (let i = 0; i < w.length - 1; i++) {
    corrections.push(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
  }

  // Priority 2: Replace each character with nearby vowel/consonant
  // Common substitutions: a<->e, i<->e, o<->a, b<->p, etc.
  const similar: Record<string, string> = {
    a: "eou", b: "pvd", c: "ks", d: "tbg", e: "iao", f: "vph",
    g: "jkd", h: "g", i: "eya", j: "g", k: "cg", l: "r",
    m: "n", n: "m", o: "aue", p: "b", q: "k", r: "l",
    s: "czx", t: "d", u: "oi", v: "bf", w: "v", x: "sz",
    y: "ie", z: "sx",
  };
  for (let i = 0; i < w.length; i++) {
    const subs = similar[w[i]!] || "";
    for (const c of subs) {
      corrections.push(w.slice(0, i) + c + w.slice(i + 1));
    }
  }

  // Priority 3: Delete one character
  for (let i = 0; i < w.length; i++) {
    corrections.push(w.slice(0, i) + w.slice(i + 1));
  }

  // Dedupe while preserving order
  return [...new Set(corrections)];
}

async function tryCorrections(words: string[], wordIndex: number, maxAttempts = 30): Promise<Movie[]> {
  const corrections = generateTypoCorrections(words[wordIndex]!).slice(0, maxAttempts);

  // Try in parallel batches of 10
  for (let i = 0; i < corrections.length; i += 10) {
    const batch = corrections.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(async (correction) => {
        const correctedWords = [...words];
        correctedWords[wordIndex] = correction;
        try {
          const res = await searchMovies(correctedWords.join(" "));
          return res.data.movies?.length ? res.data.movies : null;
        } catch {
          return null;
        }
      })
    );
    const found = results.find((r) => r !== null);
    if (found) return found;
  }
  return [];
}

async function smartSearch(query: string): Promise<Movie[]> {
  // First try exact API search
  const exact = await searchMovies(query);
  if (exact.data.movies?.length) return exact.data.movies;

  // Extract year if present for filtering
  const year = extractYear(query);
  const queryWithoutYear = query.replace(/\b(19|20)\d{2}\b/, "").trim();

  // Try searching without the year
  if (queryWithoutYear !== query) {
    const noYear = await searchMovies(queryWithoutYear);
    if (noYear.data.movies?.length) {
      if (year) {
        const yearFiltered = noYear.data.movies.filter((m) => m.year === year);
        if (yearFiltered.length) return yearFiltered;
      }
      return noYear.data.movies;
    }
  }

  // Try typo corrections - all words in parallel
  const words = queryWithoutYear.split(/\s+/).filter((w) => w.length >= 3);
  const allResults: Movie[] = [];
  const seenIds = new Set<number>();

  const correctionResults = await Promise.all(
    words.slice(0, 3).map((_, wi) => tryCorrections(words, wi))
  );
  for (const results of correctionResults) {
    for (const m of results) {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id);
        allResults.push(m);
      }
    }
  }

  // Fallback: try each word individually, sorted by rating for better results
  if (!allResults.length) {
    for (const word of words.slice(0, 3)) {
      try {
        const res = await listMovies(1, { query_term: word, sort_by: "rating", order_by: "desc" });
        if (res.data.movies) {
          for (const m of res.data.movies) {
            if (!seenIds.has(m.id)) {
              seenIds.add(m.id);
              allResults.push(m);
            }
          }
        }
      } catch {}
    }
  }

  if (!allResults.length) return [];

  // Score and sort by fuzzy match + year bonus + rating tiebreaker
  const scored = allResults
    .map((m) => ({
      movie: m,
      score: fuzzyScore(query, m.title) + (year && m.year === year ? 20 : 0) + (m.rating || 0) * 0.5,
    }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 20).map((s) => s.movie);
}

// --- Download with WebTorrent (via Node.js subprocess) ---

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(ms: number): string {
  const seconds = ms / 1000;
  if (!seconds || !isFinite(seconds)) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

// --- Download Manager ---

interface DownloadState {
  id: string;
  pid?: number;
  magnet?: string;
  movieTitle: string;
  quality: string;
  status: "connecting" | "downloading" | "done" | "error" | "timeout";
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
  eta: number;
  peers: number;
  filePath?: string;
  error?: string;
  startedAt?: number;
}

export class DownloadManager {
  private downloads = new Map<string, DownloadState>();
  private processes = new Map<string, import("node:child_process").ChildProcess>();
  private idCounter = 0;

  private stateFilePath(id: string): string {
    return join(STATE_DIR, `${id}.json`);
  }

  private writeState(state: DownloadState): void {
    Bun.write(this.stateFilePath(state.id), JSON.stringify(state) + "\n");
  }

  private deleteStateFile(id: string): void {
    unlink(this.stateFilePath(id)).catch(() => {});
  }

  async loadDownloads(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(STATE_DIR);
    } catch {
      return; // Directory doesn't exist yet — no prior downloads
    }

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      try {
        const data = await Bun.file(join(STATE_DIR, file)).json();
        const state = data as DownloadState;
        if (!state.id || this.downloads.has(state.id)) continue;

        const isTerminal = state.status === "done" || state.status === "error" || state.status === "timeout";

        // Auto-clean terminal states older than 24h
        if (isTerminal && state.startedAt && (now - state.startedAt) > ONE_DAY) {
          this.deleteStateFile(state.id);
          continue;
        }

        // For active downloads, check if the process is still alive
        if (!isTerminal && state.pid) {
          try {
            process.kill(state.pid, 0);
            // Process is alive — re-read state file for latest progress
          } catch {
            // Process is dead
            state.status = "error";
            state.error = "Process ended unexpectedly";
            this.writeState(state);
          }
        }

        this.downloads.set(state.id, state);
      } catch {}
    }
  }

  /** Re-read state files for downloads without a live stdout connection (previous sessions) */
  async refreshOrphaned(): Promise<void> {
    for (const [id, state] of this.downloads) {
      if (this.processes.has(id)) continue; // current session, has live stdout

      const filePath = this.stateFilePath(id);
      try {
        const data = await Bun.file(filePath).json();
        const fresh = data as DownloadState;
        // Update in-memory state with latest from disk
        state.status = fresh.status;
        state.progress = fresh.progress;
        state.downloaded = fresh.downloaded;
        state.total = fresh.total;
        state.speed = fresh.speed;
        state.eta = fresh.eta;
        state.peers = fresh.peers;
        state.filePath = fresh.filePath;
        state.error = fresh.error;

        // Check if process died since last refresh
        const isTerminal = state.status === "done" || state.status === "error" || state.status === "timeout";
        if (!isTerminal && state.pid) {
          try {
            process.kill(state.pid, 0);
          } catch {
            state.status = "error";
            state.error = "Process ended unexpectedly";
            this.writeState(state);
          }
        }
      } catch {}
    }
  }

  startDownload(magnet: string, movieTitle: string, torrentInfo?: Torrent): string {
    const id = `${Date.now()}-${++this.idCounter}`;
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const helperPath = join(scriptDir, "download.mjs");

    mkdirSync(STATE_DIR, { recursive: true });

    const stateFile = this.stateFilePath(id);

    const state: DownloadState = {
      id,
      magnet,
      movieTitle,
      quality: torrentInfo?.quality || "unknown",
      status: "connecting",
      progress: 0,
      downloaded: 0,
      total: torrentInfo?.size_bytes || 0,
      speed: 0,
      eta: 0,
      peers: 0,
      startedAt: Date.now(),
    };
    this.downloads.set(id, state);
    this.writeState(state);

    const child = nodeSpawn("node", [helperPath, magnet, DOWNLOAD_DIR, stateFile], {
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    });
    child.unref();

    state.pid = child.pid;
    this.writeState(state);

    this.processes.set(id, child);

    // Start reading output in background (no await)
    this.readOutput(id, child);

    return id;
  }

  private readOutput(id: string, child: import("node:child_process").ChildProcess): void {
    const state = this.downloads.get(id)!;
    let buffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          if (msg.type === "meta") {
            state.total = msg.size;
            state.status = "downloading";
          } else if (msg.type === "progress") {
            state.status = "downloading";
            state.progress = msg.progress;
            state.downloaded = msg.downloaded;
            state.total = msg.total;
            state.speed = msg.speed;
            state.eta = msg.eta;
            state.peers = msg.peers;
          } else if (msg.type === "done") {
            state.status = "done";
            state.progress = 1;
            state.filePath = msg.path;
          } else if (msg.type === "error") {
            state.status = "error";
            state.error = msg.message;
          } else if (msg.type === "timeout") {
            state.status = "timeout";
            state.error = "Could not connect to peers";
          }
        } catch {}
      }
    });

    child.on("close", () => {
      if (state.status === "connecting" || state.status === "downloading") {
        state.status = "error";
        state.error = "Process ended unexpectedly";
        this.writeState(state);
      }
      this.processes.delete(id);
    });
  }

  getDownloads(): DownloadState[] {
    return [...this.downloads.values()];
  }

  getActive(): DownloadState[] {
    return this.getDownloads().filter((d) => d.status === "connecting" || d.status === "downloading");
  }

  cancelDownload(id: string): void {
    const state = this.downloads.get(id);

    // Kill via live child process handle (current session)
    const child = this.processes.get(id);
    if (child) {
      child.kill();
      this.processes.delete(id);
    } else if (state?.pid) {
      // Kill via PID (previous session's detached process)
      try { process.kill(state.pid); } catch {}
    }

    if (state && (state.status === "connecting" || state.status === "downloading")) {
      state.status = "error";
      state.error = "Cancelled";
      this.writeState(state);
    }
  }

  clearCompleted(): void {
    for (const [id, state] of this.downloads) {
      if (state.status === "done" || state.status === "error" || state.status === "timeout") {
        this.downloads.delete(id);
        this.deleteStateFile(id);
      }
    }
  }

  deleteDownload(id: string): void {
    const state = this.downloads.get(id);
    if (!state) return;

    const child = this.processes.get(id);
    if (child) {
      child.kill();
      this.processes.delete(id);
    } else if (state.pid) {
      try { process.kill(state.pid); } catch {}
    }

    this.downloads.delete(id);
    this.deleteStateFile(id);
  }
}

const downloadManager = new DownloadManager();

async function downloadTorrent(magnet: string, movieTitle: string, torrentInfo?: Torrent): Promise<void> {
  // Movie info box
  const infoLines = [
    `${chalk.bold("Title:")}    ${chalk.white(movieTitle)}`,
    torrentInfo ? `${chalk.bold("Quality:")}  ${chalk.cyan(torrentInfo.quality)} ${chalk.dim(torrentInfo.type)}` : "",
    torrentInfo ? `${chalk.bold("Size:")}     ${torrentInfo.size}` : "",
    torrentInfo ? `${chalk.bold("Codec:")}    ${chalk.dim(`${torrentInfo.video_codec} ${torrentInfo.audio_channels}ch`)}` : "",
    `${chalk.bold("Save to:")}  ${chalk.dim(DOWNLOAD_DIR)}`,
  ].filter(Boolean).join("\n");
  console.log(boxen(infoLines, {
    title: chalk.bold(" Download "),
    titleAlignment: "left",
    borderStyle: "round",
    borderColor: "green",
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  }));

  console.log(chalk.yellow("  Note: ") + chalk.dim("Ensure you have the right to download this content in your jurisdiction."));
  downloadManager.startDownload(magnet, movieTitle, torrentInfo);
  console.log(chalk.green("\n  Download started in background!"));
  console.log(chalk.dim("  Check progress from the Downloads menu.\n"));
}

// --- Subtitle Downloads ---

export function parseSubtitleRows(html: string): SubtitleEntry[] {
  const entries: SubtitleEntry[] = [];
  const rowRegex = /<tr\s+data-id="[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1]!;

    const langMatch = row.match(/<span\s+class="sub-lang">([^<]+)<\/span>/);
    const ratingMatch = row.match(/<td\s+class="rating-cell"[^>]*>\s*<span[^>]*>(\d+)<\/span>/);
    const releaseMatch = row.match(/<td>\s*<a\s+href="[^"]*"[^>]*>\s*(?:<span[^>]*>[^<]*<\/span>\s*)?([^<]+)<\/a>/);
    const downloadMatch = row.match(/<td\s+class="download-cell"[^>]*>\s*<a\s+href="([^"]+)"/);

    if (langMatch && downloadMatch) {
      entries.push({
        language: langMatch[1]!.trim(),
        release: releaseMatch?.[1]?.trim() || "",
        rating: parseInt(ratingMatch?.[1] || "0", 10),
        downloadPath: downloadMatch[1]!,
      });
    }
  }

  return entries;
}

async function fetchSubtitles(imdbCode: string): Promise<SubtitleEntry[]> {
  for (const domain of SUBTITLE_DOMAINS) {
    try {
      const url = `https://${domain}/movie-imdb/${imdbCode}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const html = await res.text();
      const entries = parseSubtitleRows(html);
      if (entries.length) return entries;
    } catch {
      continue;
    }
  }
  return [];
}

export function scoreSubtitle(entry: SubtitleEntry, torrent: Torrent): number {
  let score = entry.rating;
  const rel = entry.release.toLowerCase();
  if (torrent.quality && rel.includes(torrent.quality.toLowerCase())) score += 30;
  if (torrent.type && rel.includes(torrent.type.toLowerCase())) score += 20;
  if (rel.includes("yify") || rel.includes("yts")) score += 15;
  return score;
}

async function downloadSubtitle(
  entry: SubtitleEntry,
  movieTitle: string,
  quality: string,
  language: string,
): Promise<string | null> {
  const zipUrl = `https://subtitles.yts-subs.com${entry.downloadPath}.zip`;
  const tmpDir = join(DOWNLOAD_DIR, ".subtitle-tmp-" + Date.now());

  try {
    await mkdir(tmpDir, { recursive: true });
    await mkdir(DOWNLOAD_DIR, { recursive: true });

    const res = await fetch(zipUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;

    const zipPath = join(tmpDir, "sub.zip");
    await Bun.write(zipPath, await res.arrayBuffer());

    // Extract ZIP
    const unzipProc = Bun.spawn(["unzip", "-o", zipPath, "-d", tmpDir], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await unzipProc.exited;

    // Find .srt file
    const files = await readdir(tmpDir);
    const srtFile = files.find((f) => f.endsWith(".srt"));
    if (!srtFile) return null;

    const safeName = movieTitle.replace(/[^a-zA-Z0-9 ._-]/g, "");
    const finalName = `${safeName}.${quality}.${language}.srt`;
    const finalPath = join(DOWNLOAD_DIR, finalName);

    await rename(join(tmpDir, srtFile), finalPath);
    return finalPath;
  } catch {
    return null;
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function promptSubtitleDownload(movie: Movie, torrent?: Torrent, skipConfirm = false): Promise<void> {
  try {
    if (!skipConfirm) {
      const { wantSubs } = await inquirer.prompt([
        { type: "confirm", name: "wantSubs", message: "Download subtitles?", default: false },
      ]);
      if (!wantSubs) return;
    }

    const spinner = ora("Fetching available subtitles...").start();
    const allSubs = await fetchSubtitles(movie.imdb_code);

    if (!allSubs.length) {
      spinner.fail(chalk.yellow("No subtitles found for this movie."));
      return;
    }

    // Group by language, count entries per language, sort by SUBTITLE_LANGUAGES order
    const langMap = new Map<string, SubtitleEntry[]>();
    for (const s of allSubs) {
      const key = s.language;
      if (!langMap.has(key)) langMap.set(key, []);
      langMap.get(key)!.push(s);
    }

    const availableLangs = [...langMap.keys()].sort((a, b) => {
      const ai = SUBTITLE_LANGUAGES.indexOf(a);
      const bi = SUBTITLE_LANGUAGES.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    spinner.stop();

    const { language } = await inquirer.prompt([
      {
        type: "list",
        name: "language",
        message: "Subtitle language:",
        choices: availableLangs.map((l) => ({
          name: `${l} (${langMap.get(l)!.length})`,
          value: l,
        })),
        pageSize: 15,
      },
    ]);

    const langSubs = langMap.get(language)!;

    // Score and pick best
    const best = langSubs
      .map((s) => ({ entry: s, score: torrent ? scoreSubtitle(s, torrent) : s.rating }))
      .sort((a, b) => b.score - a.score)[0]!;

    const dlSpinner = ora("Downloading subtitle...").start();
    const quality = torrent?.quality || "unknown";
    const path = await downloadSubtitle(best.entry, movie.title, quality, language);

    if (path) {
      dlSpinner.succeed(chalk.green(`Subtitle saved: ${chalk.dim(path)}`));
    } else {
      dlSpinner.fail(chalk.yellow("Failed to download subtitle file."));
    }
  } catch (err) {
    if (isExitPromptError(err)) return;
    console.log(chalk.yellow("  Subtitle download skipped."));
  }
}

// --- Display Helpers ---

export function formatRuntime(minutes: number): string {
  if (!minutes) return "N/A";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function healthColor(seeds: number): (text: string) => string {
  if (seeds >= 50) return chalk.green;
  if (seeds >= 10) return chalk.yellow;
  return chalk.red;
}

function displayMovieTable(movies: Movie[]): void {
  const table = new Table({
    head: [
      chalk.dim("#"),
      chalk.bold("Title"),
      chalk.dim("Year"),
      chalk.yellow("Rating"),
      chalk.cyan("Quality"),
      chalk.green("Seeds"),
      chalk.dim("Genre"),
    ],
    colWidths: [5, 32, 7, 9, 9, 8, 22],
    style: { head: [], border: ["gray"], compact: false },
    wordWrap: true,
  });

  for (let i = 0; i < movies.length; i++) {
    const m = movies[i]!;
    const rating = m.rating ? chalk.yellow(`★ ${m.rating}`) : chalk.dim("--");
    const genres = m.genres?.slice(0, 2).join(", ") || "N/A";
    const bestTorrent = m.torrents?.reduce((best, t) => (t.seeds > (best?.seeds || 0) ? t : best), m.torrents[0]);
    const seeds = bestTorrent ? healthColor(bestTorrent.seeds)(`↑${bestTorrent.seeds}`) : chalk.dim("--");
    const quality = bestTorrent ? chalk.cyan(bestTorrent.quality) : chalk.dim("--");

    table.push([
      chalk.dim(`${i + 1}`),
      chalk.bold.white(m.title),
      chalk.dim(`${m.year}`),
      rating,
      quality,
      seeds,
      chalk.dim(genres),
    ]);
  }

  console.log(table.toString());
}

async function displayMovieDetail(movie: Movie): Promise<void> {
  console.log();

  // Poster image
  if (movie.medium_cover_image) {
    const poster = await fetchPosterImage(movie.medium_cover_image);
    if (poster) {
      console.log(poster);
    }
  }

  // Title bar
  const titleLine = chalk.bold.white(movie.title) + chalk.dim(` (${movie.year})`) + "  " + chalk.dim(movie.imdb_code);
  console.log(boxen(titleLine, {
    borderStyle: "double",
    borderColor: "magenta",
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  }));

  // Info row
  const ratingVal = movie.rating || 0;
  const ratingBarFull = Math.round(ratingVal);
  const ratingBar = chalk.yellow("█".repeat(ratingBarFull)) + chalk.dim("░".repeat(10 - ratingBarFull));
  const infoTable = new Table({
    style: { head: [], border: ["gray"], compact: true },
    colWidths: [22, 12, 10, 30],
  });
  infoTable.push([
    `${chalk.yellow(`★ ${ratingVal}`)} ${ratingBar}`,
    chalk.white(formatRuntime(movie.runtime)),
    chalk.white(movie.language?.toUpperCase() || "EN"),
    chalk.dim(movie.genres?.join(", ") || "N/A"),
  ]);
  console.log(infoTable.toString());

  if (movie.yt_trailer_code) {
    console.log(chalk.dim(`  Trailer: https://youtube.com/watch?v=${movie.yt_trailer_code}`));
  }

  // Synopsis
  if (movie.summary) {
    const wrapWidth = 68;
    const words = movie.summary.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if ((line + " " + word).length > wrapWidth) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) lines.push(line);
    const synopsisText = lines.slice(0, 6).join("\n") + (lines.length > 6 ? chalk.dim("\n...") : "");
    console.log(boxen(synopsisText, {
      title: chalk.bold(" Synopsis "),
      titleAlignment: "left",
      borderStyle: "round",
      borderColor: "gray",
      dimBorder: true,
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
    }));
  }

  // Torrents
  if (movie.torrents?.length) {
    const torrentTable = new Table({
      head: [
        chalk.cyan("Quality"),
        chalk.dim("Type"),
        chalk.white("Size"),
        chalk.green("Seeds"),
        chalk.red("Peers"),
        chalk.dim("Codec"),
        chalk.dim("Audio"),
      ],
      style: { head: [], border: ["gray"], compact: false },
    });

    for (const t of movie.torrents) {
      torrentTable.push([
        chalk.cyan.bold(t.quality),
        chalk.dim(t.type),
        t.size,
        healthColor(t.seeds)(`↑${t.seeds}`),
        chalk.dim(`↓${t.peers}`),
        chalk.dim(t.video_codec || "--"),
        chalk.dim(t.audio_channels ? `${t.audio_channels}ch` : "--"),
      ]);
    }

    console.log(boxen(torrentTable.toString(), {
      title: chalk.bold(" Torrents "),
      titleAlignment: "left",
      borderStyle: "round",
      borderColor: "cyan",
      dimBorder: true,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    }));
  } else {
    console.log(chalk.dim("  No torrents available"));
  }
  console.log();
}

// --- Menu Actions ---

const SORT_OPTIONS = [
  { name: "Date Added", value: "date_added" },
  { name: "Trending", value: "like_count" },
  { name: "Rating", value: "rating" },
  { name: "Seeds", value: "seeds" },
  { name: "Year", value: "year" },
  { name: "Title", value: "title" },
];

const GENRE_OPTIONS = [
  "all", "action", "adventure", "animation", "biography", "comedy", "crime",
  "documentary", "drama", "family", "fantasy", "history", "horror", "music",
  "mystery", "romance", "sci-fi", "sport", "thriller", "war", "western",
];

async function browseMovies(): Promise<void> {
  const { sortBy } = await inquirer.prompt([
    { type: "list", name: "sortBy", message: "Sort by:", choices: SORT_OPTIONS },
  ]);

  const { genre } = await inquirer.prompt([
    {
      type: "list",
      name: "genre",
      message: "Genre:",
      choices: GENRE_OPTIONS.map((g) => ({
        name: g === "all" ? "All Genres" : g.charAt(0).toUpperCase() + g.slice(1),
        value: g,
      })),
    },
  ]);

  await paginatedList(
    (page) => {
      const params: Record<string, any> = { sort_by: sortBy, order_by: "desc" };
      if (genre !== "all") params.genre = genre;
      return listMovies(page, params);
    },
    "Browse",
  );
}

async function searchAction(): Promise<void> {
  const { query } = await inquirer.prompt([
    { type: "input", name: "query", message: "Search movies:" },
  ]);

  if (!query.trim()) return;

  const spinner = ora("Searching...").start();
  try {
    const movies = await smartSearch(query.trim());
    spinner.stop();

    if (!movies.length) {
      console.log(chalk.yellow(`\n  No results for "${query}".\n`));
      return;
    }

    console.log();
    console.log(contextBar(chalk.bold.magenta("MOVIZONE"), chalk.dim(`Search: "${query}" · ${movies.length} found`)));
    displayMovieTable(movies);
    console.log(navFooter());

    const choices: any[] = movies.map((m, i) => ({
      name: `${i + 1}. ${m.title} (${m.year})`,
      value: `movie_${i}`,
    }));
    choices.push({ name: "↩ Back to menu", value: "back" });

    const { action } = await inquirer.prompt([
      { type: "list", name: "action", message: "Select:", choices, pageSize: 25 },
    ]);

    if (action.startsWith("movie_")) {
      const idx = parseInt(action.split("_")[1]);
      await viewMovie(movies[idx]!);
    }
  } catch (err: any) {
    spinner.stop();
    if (isExitPromptError(err)) throw err;
    console.log(chalk.red(`\n  Error: ${err.message}\n`));
  }
}

async function viewMovie(movie: Movie): Promise<void> {
  await displayMovieDetail(movie);

  let viewing = true;
  while (viewing) {
    const choices: any[] = [];

    if (movie.torrents?.length) {
      for (const t of movie.torrents) {
        choices.push({
          name: `Download ${t.quality} (${t.size}, ↑${t.seeds})`,
          value: `dl_${t.hash}`,
        });
      }
    }

    choices.push({ name: "Copy magnet link", value: "magnet" });
    choices.push({ name: "Download subtitles", value: "subtitles" });
    choices.push({ name: "Similar movies", value: "similar" });
    choices.push({ name: "Back", value: "back" });

    const { action } = await inquirer.prompt([
      { type: "list", name: "action", message: "Action:", choices },
    ]);

    if (action === "back") {
      viewing = false;
    } else if (action === "similar") {
      await showSimilar(movie);
    } else if (action === "magnet") {
      await selectTorrentAndCopyMagnet(movie);
    } else if (action === "subtitles") {
      await promptSubtitleDownload(movie, undefined, true);
    } else if (action.startsWith("dl_")) {
      const hash = action.slice(3);
      const torrent = movie.torrents?.find((t) => t.hash === hash);
      const magnet = buildMagnet(hash, movie.title);
      await downloadTorrent(magnet, movie.title, torrent);
      await promptSubtitleDownload(movie, torrent);
      viewing = false;
    }
  }
}

async function selectTorrentAndCopyMagnet(movie: Movie): Promise<void> {
  if (!movie.torrents?.length) {
    console.log(chalk.yellow("\n  No torrents available.\n"));
    return;
  }

  const { torrent } = await inquirer.prompt([
    {
      type: "list",
      name: "torrent",
      message: "Select quality:",
      choices: movie.torrents.map((t) => ({
        name: `${t.quality} · ${t.size} · ↑${t.seeds} ↓${t.peers}`,
        value: t,
      })),
    },
  ]);

  const magnet = buildMagnet(torrent.hash, movie.title);

  const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
  proc.stdin.write(magnet);
  proc.stdin.end();
  await proc.exited;

  console.log(chalk.green("\n  Magnet link copied to clipboard!\n"));
}

async function showSimilar(movie: Movie): Promise<void> {
  const spinner = ora("Finding similar movies...").start();
  try {
    const res = await getMovieSuggestions(movie.id);
    spinner.stop();

    if (!res.data.movies?.length) {
      console.log(chalk.yellow("\n  No suggestions found.\n"));
      return;
    }

    console.log();
    console.log(contextBar(chalk.bold.magenta("MOVIZONE"), chalk.dim(`Similar to "${movie.title}"`)));
    displayMovieTable(res.data.movies);
    console.log(navFooter());

    const choices: any[] = res.data.movies.map((m, i) => ({
      name: `${i + 1}. ${m.title} (${m.year})`,
      value: `movie_${i}`,
    }));
    choices.push({ name: "Back", value: "back" });

    const { action } = await inquirer.prompt([
      { type: "list", name: "action", message: "Select:", choices },
    ]);

    if (action.startsWith("movie_")) {
      const idx = parseInt(action.split("_")[1]);
      await viewMovie(res.data.movies[idx]!);
    }
  } catch (err: any) {
    spinner.stop();
    if (isExitPromptError(err)) throw err;
    console.log(chalk.red(`\n  Error: ${err.message}\n`));
  }
}

// --- Shared Paginated List ---

async function paginatedList(
  fetcher: (page: number) => Promise<ListResponse>,
  label: string,
): Promise<void> {
  let page = 1;
  let browsing = true;

  while (browsing) {
    const spinner = ora("Loading...").start();
    try {
      const res = await fetcher(page);
      spinner.stop();

      if (!res.data.movies?.length) {
        console.log(chalk.yellow("\n  No movies found.\n"));
        return;
      }

      console.log();
      console.log(contextBar(chalk.bold.magenta("MOVIZONE"), chalk.dim(`${label} · Page ${page} · ${res.data.movie_count.toLocaleString()} total`)));
      displayMovieTable(res.data.movies);
      console.log(navFooter());

      const choices: any[] = res.data.movies.map((m, i) => ({
        name: `${i + 1}. ${m.title} (${m.year})`,
        value: `movie_${i}`,
      }));
      if (page > 1) choices.push({ name: "Previous page", value: "prev" });
      if (res.data.movies.length === 20) choices.push({ name: "Next page", value: "next" });
      choices.push({ name: "Back to menu", value: "back" });

      const { action } = await inquirer.prompt([
        { type: "list", name: "action", message: "Select:", choices, pageSize: 25 },
      ]);

      if (action === "back") browsing = false;
      else if (action === "next") page++;
      else if (action === "prev") page--;
      else if (action.startsWith("movie_")) {
        const idx = parseInt(action.split("_")[1]);
        await viewMovie(res.data.movies[idx]!);
      }
    } catch (err: any) {
      spinner.stop();
      if (isExitPromptError(err)) throw err;
      console.log(chalk.red(`\n  Error: ${err.message}\n`));
      browsing = false;
    }
  }
}

// --- Downloads View ---

function downloadStatusIcon(status: DownloadState["status"]): string {
  switch (status) {
    case "connecting": return chalk.yellow("◌");
    case "downloading": return chalk.cyan("▼");
    case "done": return chalk.green("✓");
    case "error": return chalk.red("✗");
    case "timeout": return chalk.yellow("⏱");
  }
}

function downloadProgressBar(progress: number, width = 20): string {
  const filled = Math.round(progress * width);
  return chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(width - filled));
}

function renderDownloadsScreen(downloads: DownloadState[]): void {
  const table = new Table({
    head: [
      chalk.dim("#"),
      chalk.bold("Title"),
      chalk.cyan("Quality"),
      chalk.white("Progress"),
      chalk.cyan("Speed"),
      chalk.white("ETA"),
      chalk.dim("Status"),
    ],
    colWidths: [5, 28, 10, 28, 12, 10, 12],
    style: { head: [], border: ["gray"], compact: false },
    wordWrap: true,
  });

  for (let i = 0; i < downloads.length; i++) {
    const d = downloads[i]!;
    const pct = (d.progress * 100).toFixed(1) + "%";
    const progressCell = d.status === "downloading"
      ? `${downloadProgressBar(d.progress)} ${chalk.bold(pct)}`
      : d.status === "done"
        ? `${downloadProgressBar(1)} ${chalk.bold("100%")}`
        : chalk.dim("--");
    const speedCell = d.status === "downloading" ? chalk.cyan(formatSpeed(d.speed)) : chalk.dim("--");
    const etaCell = d.status === "downloading" ? formatEta(d.eta) : chalk.dim("--");
    const statusCell = `${downloadStatusIcon(d.status)} ${d.status === "error" || d.status === "timeout" ? chalk.red(d.error || d.status) : d.status}`;

    table.push([
      chalk.dim(`${i + 1}`),
      chalk.white(d.movieTitle),
      chalk.cyan(d.quality),
      progressCell,
      speedCell,
      etaCell,
      statusCell,
    ]);
  }

  console.log(boxen(table.toString(), {
    title: chalk.bold(" Downloads "),
    titleAlignment: "left",
    borderStyle: "round",
    borderColor: "cyan",
    dimBorder: true,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
  }));

  // Show file paths for completed downloads
  const doneWithFiles = downloads.filter((d) => d.status === "done" && d.filePath);
  if (doneWithFiles.length) {
    for (const d of doneWithFiles) {
      console.log(chalk.dim(`  ✓ ${d.movieTitle}: ${d.filePath}`));
    }
    console.log();
  }
}

function waitForKey(timeoutMs?: number): Promise<string | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function cleanup() {
      if (timer) clearTimeout(timer);
      process.stdin.removeAllListeners("data");
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    }

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
    }

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", (data: Buffer) => {
      cleanup();
      resolve(data.toString());
    });
  });
}

async function viewDownloads(): Promise<void> {
  while (true) {
    const downloads = downloadManager.getDownloads();
    if (!downloads.length) {
      console.log(chalk.dim("\n  No downloads yet.\n"));
      return;
    }

    await downloadManager.refreshOrphaned();

    const active = downloadManager.getActive();
    const inactive = downloads.filter((d) => d.status === "done" || d.status === "error" || d.status === "timeout");
    const doneWithFiles = downloads.filter((d) => d.status === "done" && d.filePath);

    // Clear screen and render
    process.stdout.write("\x1b[2J\x1b[H");
    renderDownloadsScreen(downloads);

    // Key hints footer
    const hints: string[] = [];
    if (active.length) hints.push(chalk.bold("c") + chalk.dim(" Cancel"));
    if (inactive.length) hints.push(chalk.bold("x") + chalk.dim(" Clear"));
    if (doneWithFiles.length) hints.push(chalk.bold("d") + chalk.dim(" Delete file"));
    hints.push(chalk.bold("b") + chalk.dim(" Back"));

    console.log(boxen(
      "  " + hints.join("   ") + "  ",
      { borderStyle: "single", borderColor: "gray", dimBorder: true, padding: 0 },
    ));

    if (active.length) {
      console.log(chalk.dim("  Auto-refreshing..."));
    }

    // Wait for keypress (auto-refresh every 1s if active downloads)
    const key = await waitForKey(active.length > 0 ? 1000 : undefined);

    if (key === null) continue; // Timeout → auto-refresh

    const k = key.charAt(0);

    if (k === "b" || k === "q" || k === "\x1b") return;
    if (k === "\x03") exitGracefully();

    // Cancel active download
    if (k === "c" && active.length) {
      if (active.length === 1) {
        downloadManager.cancelDownload(active[0]!.id);
      } else {
        const { id } = await inquirer.prompt([{
          type: "list",
          name: "id",
          message: "Cancel which download?",
          choices: [
            ...active.map((d) => ({ name: `${d.movieTitle} (${d.quality})`, value: d.id })),
            { name: "Never mind", value: "" },
          ],
        }]);
        if (id) downloadManager.cancelDownload(id);
      }
    }

    // Clear completed/failed from list
    if (k === "x" && inactive.length) {
      downloadManager.clearCompleted();
    }

    // Delete completed download file from disk
    if (k === "d" && doneWithFiles.length) {
      if (doneWithFiles.length === 1) {
        const d = doneWithFiles[0]!;
        const { confirm } = await inquirer.prompt([{
          type: "confirm",
          name: "confirm",
          message: `Delete "${d.movieTitle}" from disk?`,
          default: false,
        }]);
        if (confirm) {
          try {
            await rm(d.filePath!, { recursive: true, force: true });
            downloadManager.deleteDownload(d.id);
          } catch (err: any) {
            console.log(chalk.red(`  Error: ${err.message}`));
          }
        }
      } else {
        const { ids } = await inquirer.prompt([{
          type: "checkbox",
          name: "ids",
          message: "Delete which files?",
          choices: doneWithFiles.map((d) => ({
            name: `${d.movieTitle} (${d.quality})`,
            value: d.id,
          })),
        }]);
        for (const id of ids) {
          const d = downloads.find((dl) => dl.id === id);
          if (d?.filePath) {
            try {
              await rm(d.filePath, { recursive: true, force: true });
              downloadManager.deleteDownload(id);
            } catch {}
          }
        }
      }
    }

    // Any other key → just re-render
  }
}

// --- Self-Update ---

interface UpdateInfo {
  latest: string;
  current: string;
  hasUpdate: boolean;
}

async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch("https://registry.npmjs.org/movizone/latest", {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { version: string };
    const latest = data.version;
    const current = version;
    const hasUpdate = latest !== current;
    return { latest, current, hasUpdate };
  } catch {
    return null;
  }
}

async function runUpdate(): Promise<void> {
  console.log(chalk.cyan("\n  Updating movizone...\n"));
  const proc = Bun.spawn(["bun", "install", "-g", "movizone@latest"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code === 0) {
    console.log(chalk.green("\n  Updated successfully! Restart movizone to use the new version.\n"));
  } else {
    console.log(chalk.red("\n  Update failed. Try manually: bun install -g movizone@latest\n"));
  }
}

// --- SIGINT / Exit Handling ---

function isExitPromptError(err: unknown): boolean {
  return err instanceof Error && err.name === "ExitPromptError";
}

function exitGracefully(): never {
  console.log(chalk.dim("\n  Bye!\n"));
  process.exit(0);
}

// --- Main ---

async function main(): Promise<void> {
  const updateCheck = checkForUpdate(); // start fetch immediately

  console.log();
  console.log(renderHeader());
  console.log(chalk.dim(`  Downloads: ${DOWNLOAD_DIR}`));
  console.log(boxen(DISCLAIMER, {
    borderStyle: "round",
    borderColor: "yellow",
    dimBorder: true,
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  }));

  const update = await updateCheck; // already in-flight
  if (update?.hasUpdate) {
    console.log(boxen(
      chalk.dim(`Current: v${update.current}`) + "  →  " + chalk.green.bold(`v${update.latest} available`),
      {
        title: chalk.yellow.bold(" Update Available "),
        titleAlignment: "center",
        borderStyle: "round",
        borderColor: "yellow",
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
      },
    ));
  }

  console.log();

  await downloadManager.loadDownloads();

  let running = true;

  while (running) {
    try {
      const activeCount = downloadManager.getActive().length;
      const downloadsLabel = activeCount > 0
        ? `Downloads (${activeCount} active)`
        : "Downloads";

      const choices: { name: string; value: string }[] = [
        { name: "Search movies", value: "search" },
        { name: "Browse movies", value: "browse" },
        { name: "Trending now", value: "trending" },
        { name: "Top rated", value: "top" },
        { name: downloadsLabel, value: "downloads" },
      ];
      if (update?.hasUpdate) {
        choices.push({ name: chalk.yellow(`Update available (v${update.latest})`), value: "update" });
      }
      choices.push({ name: "Exit", value: "exit" });

      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What do you want to do?",
          choices,
        },
      ]);

      switch (action) {
        case "search":
          await searchAction();
          break;
        case "browse":
          await browseMovies();
          break;
        case "trending":
          await paginatedList((p) => listMovies(p, { sort_by: "like_count", order_by: "desc" }), "Trending");
          break;
        case "top":
          await paginatedList((p) => listMovies(p, { sort_by: "rating", order_by: "desc", minimum_rating: 7 }), "Top Rated");
          break;
        case "downloads":
          await viewDownloads();
          break;
        case "update":
          await runUpdate();
          break;
        case "exit":
          exitGracefully();
      }
    } catch (err) {
      if (isExitPromptError(err)) exitGracefully();
      throw err;
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    if (isExitPromptError(err)) exitGracefully();
    console.error(err);
    process.exit(1);
  });
}

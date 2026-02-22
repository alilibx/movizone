#!/usr/bin/env bun
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import boxen from "boxen";
import Table from "cli-table3";
import figlet from "figlet";
import gradient from "gradient-string";
import { homedir } from "os";
import { join, dirname } from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";

// --- TUI Theme ---

const movizonGradient = gradient(["#ff00ff", "#00ffff"]);

function renderHeader(): string {
  const ascii = figlet.textSync("MOVIZONE", { font: "ANSI Shadow", horizontalLayout: "fitted" });
  return boxen(movizonGradient.multiline(ascii) + "\n" + chalk.dim("  Movie Explorer"), {
    padding: { top: 0, bottom: 0, left: 2, right: 2 },
    borderStyle: "double",
    borderColor: "magenta",
    dimBorder: true,
  });
}

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

function buildMagnet(hash: string, title: string): string {
  const dn = encodeURIComponent(title);
  const trackers = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("");
  return `magnet:?xt=urn:btih:${hash}&dn=${dn}${trackers}`;
}

// --- Fuzzy Search ---

function levenshtein(a: string, b: string): number {
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

function fuzzyScore(query: string, title: string): number {
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

function extractYear(query: string): number | null {
  const match = query.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : null;
}

function generateTypoCorrections(word: string): string[] {
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(ms: number): string {
  const seconds = ms / 1000;
  if (!seconds || !isFinite(seconds)) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

async function downloadTorrent(magnet: string, movieTitle: string, torrentInfo?: Torrent): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const helperPath = join(scriptDir, "download.mjs");

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

  console.log(chalk.dim("  Connecting to peers...\n"));

  return new Promise<void>((resolve) => {
    const child = Bun.spawn(["node", helperPath, magnet, DOWNLOAD_DIR], {
      stdout: "pipe",
      stderr: "inherit",
    });

    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let totalSize = "";
    let progressLines = 0;

    function renderProgress(percent: string, downloaded: string, speed: string, eta: string, peers: number, progress: number) {
      const barWidth = 50;
      const filled = Math.round(progress * barWidth);
      const bar = chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(barWidth - filled));

      const statsTable = new Table({
        style: { head: [], border: ["gray"], compact: true },
        colWidths: [16, 16, 14, 12],
      });
      statsTable.push([
        `${chalk.dim("Downloaded")} ${chalk.white(downloaded + "/" + totalSize)}`,
        `${chalk.dim("Speed")} ${chalk.cyan(speed)}`,
        `${chalk.dim("ETA")} ${chalk.white(eta)}`,
        `${chalk.dim("Peers")} ${chalk.white(String(peers))}`,
      ]);

      const content = `  ${bar}  ${chalk.bold(percent + "%")}\n${statsTable.toString()}`;
      const frame = boxen(content, {
        title: chalk.bold(" Progress "),
        titleAlignment: "left",
        borderStyle: "round",
        borderColor: "cyan",
        dimBorder: true,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      });

      // Clear previous progress frame
      if (progressLines > 0) {
        process.stdout.write(`\x1b[${progressLines}A\x1b[0J`);
      }
      process.stdout.write(frame + "\n");
      progressLines = frame.split("\n").length;
    }

    async function readOutput() {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);

            if (msg.type === "meta") {
              totalSize = formatBytes(msg.size);
              console.log(chalk.green(`  Downloading: ${msg.name}`));
              console.log(chalk.dim(`  Size: ${totalSize}\n`));
            } else if (msg.type === "progress") {
              const percent = (msg.progress * 100).toFixed(1);
              const downloaded = formatBytes(msg.downloaded);
              const speed = formatSpeed(msg.speed);
              const eta = formatEta(msg.eta);
              renderProgress(percent, downloaded, speed, eta, msg.peers, msg.progress);
            } else if (msg.type === "done") {
              if (progressLines > 0) {
                process.stdout.write(`\x1b[${progressLines}A\x1b[0J`);
              }
              console.log(boxen(
                chalk.green.bold("  Download complete!") + "\n" + chalk.dim(`  Saved to: ${msg.path}`),
                {
                  borderStyle: "round",
                  borderColor: "green",
                  padding: { top: 0, bottom: 0, left: 0, right: 0 },
                }
              ));
            } else if (msg.type === "error") {
              console.log(chalk.red(`\n  Download error: ${msg.message}\n`));
            } else if (msg.type === "timeout") {
              console.log(chalk.yellow("\n  Could not connect to peers. Try a torrent with more seeds.\n"));
            }
          } catch {}
        }
      }
    }

    readOutput().then(() => {
      child.exited.then(() => resolve());
    });
  });
}

// --- Display Helpers ---

function formatRuntime(minutes: number): string {
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

function displayMovieDetail(movie: Movie): void {
  console.log();

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
  displayMovieDetail(movie);

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
    } else if (action.startsWith("dl_")) {
      const hash = action.slice(3);
      const torrent = movie.torrents?.find((t) => t.hash === hash);
      const magnet = buildMagnet(hash, movie.title);
      await downloadTorrent(magnet, movie.title, torrent);
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
  console.log();
  console.log(renderHeader());
  console.log(chalk.dim(`  Downloads: ${DOWNLOAD_DIR}`));
  console.log();

  let running = true;

  while (running) {
    try {
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What do you want to do?",
          choices: [
            { name: "Search movies", value: "search" },
            { name: "Browse movies", value: "browse" },
            { name: "Trending now", value: "trending" },
            { name: "Top rated", value: "top" },
            { name: "Exit", value: "exit" },
          ],
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
        case "exit":
          exitGracefully();
      }
    } catch (err) {
      if (isExitPromptError(err)) exitGracefully();
      throw err;
    }
  }
}

main().catch((err) => {
  if (isExitPromptError(err)) exitGracefully();
  console.error(err);
  process.exit(1);
});

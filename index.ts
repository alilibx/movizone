#!/usr/bin/env bun
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import WebTorrent from "webtorrent";
import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// --- API Layer ---

const API_BASE = "https://yts.torrentbay.st/api/v2";
const DOWNLOAD_DIR = join(homedir(), "Downloads", "Movizon");

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
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
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
    const subs = similar[w[i]] || "";
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
  const corrections = generateTypoCorrections(words[wordIndex]).slice(0, maxAttempts);

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

// --- Download with WebTorrent ---

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

function formatEta(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

async function downloadTorrent(magnet: string, movieTitle: string): Promise<void> {
  if (!existsSync(DOWNLOAD_DIR)) {
    mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  const client = new WebTorrent();

  return new Promise((resolve, reject) => {
    console.log(chalk.dim(`\n  Saving to: ${DOWNLOAD_DIR}`));
    console.log(chalk.dim("  Connecting to peers...\n"));

    client.add(magnet, { path: DOWNLOAD_DIR }, (torrent) => {
      const totalSize = formatBytes(torrent.length);
      console.log(chalk.green(`  Downloading: ${torrent.name}`));
      console.log(chalk.dim(`  Size: ${totalSize}\n`));

      const interval = setInterval(() => {
        const percent = (torrent.progress * 100).toFixed(1);
        const downloaded = formatBytes(torrent.downloaded);
        const speed = formatSpeed(torrent.downloadSpeed);
        const eta = formatEta(torrent.timeRemaining / 1000);
        const peers = torrent.numPeers;

        const barWidth = 30;
        const filled = Math.round(torrent.progress * barWidth);
        const bar = chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(barWidth - filled));

        process.stdout.write(
          `\r  ${bar} ${chalk.bold(percent + "%")}  ${downloaded}/${totalSize}  ${chalk.cyan(speed)}  ${chalk.dim(`ETA ${eta}`)}  ${chalk.dim(`${peers} peers`)}  `
        );
      }, 500);

      torrent.on("done", () => {
        clearInterval(interval);
        process.stdout.write("\r" + " ".repeat(120) + "\r");
        console.log(chalk.green.bold(`  Download complete!`));
        console.log(chalk.dim(`  Saved to: ${join(DOWNLOAD_DIR, torrent.name)}\n`));
        client.destroy();
        resolve();
      });

      torrent.on("error", (err) => {
        clearInterval(interval);
        console.log(chalk.red(`\n  Download error: ${err.message}\n`));
        client.destroy();
        reject(err);
      });
    });

    client.on("error", (err) => {
      console.log(chalk.red(`\n  Torrent error: ${err.message}\n`));
      client.destroy();
      reject(err);
    });

    // Timeout if no metadata after 30s
    setTimeout(() => {
      if (client.torrents.length === 0 || !client.torrents[0].ready) {
        console.log(chalk.yellow("\n  Could not connect to peers. Try a torrent with more seeds.\n"));
        client.destroy();
        resolve();
      }
    }, 30000);
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

function displayMovieRow(movie: Movie, index: number): void {
  const rating = movie.rating ? chalk.yellow(`★ ${movie.rating}`) : chalk.dim("unrated");
  const genres = movie.genres?.slice(0, 3).join(", ") || "N/A";
  const bestTorrent = movie.torrents?.reduce((best, t) => (t.seeds > (best?.seeds || 0) ? t : best), movie.torrents[0]);
  const seeds = bestTorrent ? healthColor(bestTorrent.seeds)(`↑${bestTorrent.seeds}`) : chalk.dim("no torrents");
  const quality = bestTorrent ? chalk.cyan(bestTorrent.quality) : "";

  console.log(
    `  ${chalk.dim(`${index}.`)} ${chalk.bold.white(movie.title)} ${chalk.dim(`(${movie.year})`)}  ${rating}  ${quality}  ${seeds}  ${chalk.dim(genres)}`
  );
}

function displayMovieDetail(movie: Movie): void {
  console.log();
  console.log(chalk.bold.white(`  ${movie.title}`) + chalk.dim(` (${movie.year})`));
  console.log(chalk.dim("  " + "─".repeat(60)));
  console.log(`  ${chalk.yellow(`★ ${movie.rating}`)}  ${chalk.dim("·")}  ${formatRuntime(movie.runtime)}  ${chalk.dim("·")}  ${movie.language?.toUpperCase() || "EN"}`);
  console.log(`  ${chalk.dim("Genres:")} ${movie.genres?.join(", ") || "N/A"}`);
  console.log(`  ${chalk.dim("IMDB:")} ${movie.imdb_code}`);

  if (movie.yt_trailer_code) {
    console.log(`  ${chalk.dim("Trailer:")} https://youtube.com/watch?v=${movie.yt_trailer_code}`);
  }

  console.log();
  if (movie.summary) {
    const words = movie.summary.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if ((line + " " + word).length > 70) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) lines.push(line);
    for (const l of lines.slice(0, 5)) {
      console.log(`  ${chalk.dim(l)}`);
    }
    if (lines.length > 5) console.log(chalk.dim("  ..."));
  }

  console.log();
  console.log(chalk.bold("  Torrents:"));

  if (movie.torrents?.length) {
    for (const t of movie.torrents) {
      const seedColor = healthColor(t.seeds);
      console.log(
        `    ${chalk.cyan.bold(t.quality.padEnd(6))} ${chalk.dim(t.type.padEnd(7))} ${t.size.padEnd(10)} ${seedColor(`↑${t.seeds}`)} ${chalk.dim(`↓${t.peers}`)}  ${chalk.dim(`${t.video_codec} ${t.bit_depth}bit ${t.audio_channels}ch`)}`
      );
    }
  } else {
    console.log(chalk.dim("    No torrents available"));
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

    console.log(chalk.dim(`\n  Results for "${query}" · ${movies.length} found\n`));
    movies.forEach((m, i) => displayMovieRow(m, i + 1));
    console.log();

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
      await viewMovie(movies[idx]);
    }
  } catch (err: any) {
    spinner.stop();
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
      const magnet = buildMagnet(hash, movie.title);
      await downloadTorrent(magnet, movie.title);
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

    console.log(chalk.dim(`\n  Similar to "${movie.title}":\n`));
    res.data.movies.forEach((m, i) => displayMovieRow(m, i + 1));
    console.log();

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
      await viewMovie(res.data.movies[idx]);
    }
  } catch (err: any) {
    spinner.stop();
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

      console.log(chalk.dim(`\n  ${label} · Page ${page} · ${res.data.movie_count.toLocaleString()} total\n`));
      res.data.movies.forEach((m, i) => displayMovieRow(m, i + 1));
      console.log();

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
        await viewMovie(res.data.movies[idx]);
      }
    } catch (err: any) {
      spinner.stop();
      console.log(chalk.red(`\n  Error: ${err.message}\n`));
      browsing = false;
    }
  }
}

// --- Main ---

async function main(): Promise<void> {
  console.log();
  console.log(chalk.bold.magenta("  Movizon") + chalk.dim(" — Movie Torrent Explorer"));
  console.log(chalk.dim("  " + "─".repeat(40)));
  console.log(chalk.dim(`  Downloads: ${DOWNLOAD_DIR}`));
  console.log();

  let running = true;

  while (running) {
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
        console.log(chalk.dim("\n  Bye!\n"));
        running = false;
        break;
    }
  }
}

main();

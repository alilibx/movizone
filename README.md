<p align="center">
  <img src="https://img.shields.io/npm/v/movizone?color=magenta&style=flat-square" alt="npm version" />
  <img src="https://img.shields.io/npm/l/movizone?style=flat-square" alt="license" />
  <img src="https://img.shields.io/github/actions/workflow/status/alilibx/movizone/ci.yml?style=flat-square&label=CI" alt="CI" />
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" alt="Bun" />
  <img src="https://img.shields.io/badge/73k%2B-movies-cyan?style=flat-square" alt="Movies" />
</p>

# Movizone

A beautiful terminal UI for browsing, searching, and downloading movies. Fuzzy search handles your typos, and WebTorrent downloads run right in the terminal — no external torrent client needed.

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║  ███╗   ███╗ ██████╗ ██╗   ██╗██╗███████╗ ██████╗ ███╗   ██╗███████╗      ║
║  ████╗ ████║██╔═══██╗██║   ██║██║╚══███╔╝██╔═══██╗████╗  ██║██╔════╝      ║
║  ██╔████╔██║██║   ██║██║   ██║██║  ███╔╝ ██║   ██║██╔██╗ ██║█████╗        ║
║  ██║╚██╔╝██║██║   ██║╚██╗ ██╔╝██║ ███╔╝  ██║   ██║██║╚██╗██║██╔══╝        ║
║  ██║ ╚═╝ ██║╚██████╔╝ ╚████╔╝ ██║███████╗╚██████╔╝██║ ╚████║███████╗      ║
║  ╚═╝     ╚═╝ ╚═════╝   ╚═══╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝      ║
║    Movie Explorer                                                         ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

## Features

- **Fuzzy search** — handles typos like `zootobia` → Zootopia, `incpetion` → Inception
- **In-terminal downloads** — WebTorrent with live progress bar, speed, ETA, and peer count
- **Rich TUI** — gradient ASCII header, boxed panels, color-coded tables, rating bars
- **Browse** — sort by trending, rating, seeds, year, or date added with genre filters
- **Paginated results** — navigate pages of 20 movies at a time
- **Movie details** — rating bar, runtime, genres, synopsis, trailer link, full torrent table
- **Copy magnet links** — to clipboard for use in external clients
- **Similar movies** — discover related films from any movie detail view

## Install

```bash
# Run instantly (no install)
npx movizone

# Or with Bun
bun x movizone
```

Install globally:

```bash
npm install -g movizone
# or
bun install -g movizone
```

### From source

```bash
git clone https://github.com/alilibx/movizone.git
cd movizone
bun install
bun run index.ts
```

## Usage

### Main menu

```
? What do you want to do?
  > Search movies
    Browse movies
    Trending now
    Top rated
    Exit
```

### Search

Fuzzy search corrects typos automatically — it tries transpositions, similar-character substitutions, and per-word corrections in parallel:

```
? Search movies: incpetion

┌──────────────────────────────────────────────────────────────────────────┐
│ MOVIZONE                               Search: "incpetion" · 8 found   │
└──────────────────────────────────────────────────────────────────────────┘
┌─────┬────────────────────────────────┬───────┬─────────┬─────────┬────────┬──────────────────────┐
│ #   │ Title                          │ Year  │ Rating  │ Quality │ Seeds  │ Genre                │
├─────┼────────────────────────────────┼───────┼─────────┼─────────┼────────┼──────────────────────┤
│ 1   │ Inception                      │ 2010  │ ★ 8.8   │ 2160p   │ ↑120   │ Action, Sci-Fi       │
│ 2   │ Interception                   │ 2009  │ ★ 5.3   │ 1080p   │ ↑12    │ Drama, Thriller      │
│ ...                                                                                              │
└─────┴────────────────────────────────┴───────┴─────────┴─────────┴────────┴──────────────────────┘
```

### Movie details

```
╔══════════════════════════════════════════════════════╗
║ Inception (2010)  tt1375666                          ║
╚══════════════════════════════════════════════════════╝
┌──────────────────────┬────────────┬──────────┬──────────────────────────────┐
│ ★ 8.8 ████████░░     │ 2h 28m     │ EN       │ Action, Adventure, Sci-Fi    │
└──────────────────────┴────────────┴──────────┴──────────────────────────────┘
  Trailer: https://youtube.com/watch?v=...

╭─ Synopsis ────────────────────────────────────────────╮
│ A thief who steals corporate secrets through the use  │
│ of dream-sharing technology is given the inverse task  │
│ of planting an idea into the mind of a C.E.O...       │
╰───────────────────────────────────────────────────────╯

╭─ Torrents ────────────────────────────────────────────╮
│ Quality │ Type │ Size    │ Seeds │ Peers │ Codec      │
│ 720p    │ web  │ 1.1 GB  │ ↑85   │ ↓12   │ x264       │
│ 1080p   │ blu  │ 1.9 GB  │ ↑120  │ ↓25   │ x264       │
│ 2160p   │ web  │ 4.2 GB  │ ↑42   │ ↓8    │ x265       │
╰───────────────────────────────────────────────────────╯

? Action:
  > Download 1080p (1.9 GB, ↑120)
    Download 2160p (4.2 GB, ↑42)
    Copy magnet link
    Similar movies
    Back
```

### Download

Downloads run in-terminal via WebTorrent with a live-updating progress panel:

```
╭─ Download ────────────────────────────────────────────╮
│ Title:    Inception                                    │
│ Quality:  1080p blu                                    │
│ Size:     1.9 GB                                       │
│ Codec:    x264 2.0ch                                   │
│ Save to:  ~/Downloads/Movizone                         │
╰───────────────────────────────────────────────────────╯

╭─ Progress ────────────────────────────────────────────╮
│  ████████████████████░░░░░░░░░░░░░░░░░░░░  40.2%     │
│ Downloaded 756MB/1.9GB  Speed 2.3MB/s  ETA 8m  15    │
╰───────────────────────────────────────────────────────╯
```

### Browse

Filter by genre and sort order, with pagination:

```
? Sort by: Rating
? Genre: Sci-Fi

┌──────────────────────────────────────────────────────────────────────────┐
│ MOVIZONE                              Browse · Page 1 · 4,521 total     │
└──────────────────────────────────────────────────────────────────────────┘
┌─────┬────────────────────────────────┬───────┬─────────┬─────────┬────────┬──────────────────────┐
│ 1   │ Inception                      │ 2010  │ ★ 8.8   │ 2160p   │ ↑120   │ Action, Sci-Fi       │
│ 2   │ Interstellar                   │ 2014  │ ★ 8.7   │ 2160p   │ ↑100   │ Adventure, Sci-Fi    │
│ 3   │ The Matrix                     │ 1999  │ ★ 8.7   │ 1080p   │ ↑100   │ Action, Sci-Fi       │
│ ...                                                                                              │
└─────┴────────────────────────────────┴───────┴─────────┴─────────┴────────┴──────────────────────┘
```

## How it works

- **Movie data** — YTS API with 73,000+ movies and torrent metadata
- **Fuzzy search** — edit-distance-1 corrections (transposes, similar-char substitutions) tried in parallel batches, with Levenshtein scoring to rank results
- **Downloads** — [WebTorrent](https://github.com/webtorrent/webtorrent) for peer-to-peer downloading, runs in a Node.js subprocess with JSON IPC back to the TUI
- **TUI** — [chalk](https://github.com/chalk/chalk), [boxen](https://github.com/sindresorhus/boxen), [cli-table3](https://github.com/cli-table/cli-table3), [figlet](https://github.com/patorjk/figlet.js), [gradient-string](https://github.com/bokub/gradient-string), [inquirer](https://github.com/SBoudrias/Inquirer.js)
- Movies saved to `~/Downloads/Movizone/`

## Requirements

- [Bun](https://bun.sh) v1.0+ (or Node.js 18+ via npx)

## License

MIT

# Movizon

A movie torrent explorer CLI. Search, browse, and download movies directly in the terminal.

## Features

- **Fuzzy search** - handles typos like "zootobia" -> Zootopia, "incpetion" -> Inception
- **In-terminal downloads** - download via WebTorrent with a live progress bar, no torrent client needed
- **Browse** - sort by trending, rating, seeds, year, or date added with genre filters
- **Movie details** - rating, runtime, genres, synopsis, trailer link, torrent info
- **Copy magnet links** - to clipboard for use in external clients
- **Similar movies** - discover related films

## Requirements

- [Bun](https://bun.sh) v1.0+

## Install

```bash
# Clone and install
git clone https://github.com/alilibx/movizon.git
cd movizon
bun install

# Link globally
bun link
```

Or run directly:

```bash
bun run index.ts
```

## Usage

```
$ movizon

  Movizon — Movie Torrent Explorer
  ────────────────────────────────────────
  Downloads: ~/Downloads/Movizon

? What do you want to do?
  > Search movies
    Browse movies
    Trending now
    Top rated
    Exit
```

### Search

Search handles typos and misspellings automatically:

```
? Search movies: zootobia 2 2025

  Results for "zootobia 2 2025" · 2 found

  1. Zootopia 2 (2025)  ★ 6.6  720p  ↑42  Animation, Adventure, Comedy
  2. Zootopia (2016)    ★ 8    1080p ↑95  Animation, Adventure, Comedy
```

### Download

Select a movie and choose a quality to download directly in the terminal:

```
? Action: Download 1080p (1.85 GB, ↑100)

  Saving to: ~/Downloads/Movizon
  Downloading: Inception.2010.1080p.BluRay.x264.mp4
  Size: 1.85 GB

  ████████████░░░░░░░░░░░░░░░░░░ 40.2%  756MB/1.85GB  2.3MB/s  ETA 8m 12s  15 peers
```

### Browse

Filter by genre and sort order:

```
? Sort by: Rating
? Genre: Sci-Fi

  Browse · Page 1 · 4,521 total

  1. Inception (2010)           ★ 8.8  1080p  ↑100  Action, Sci-Fi, Thriller
  2. Interstellar (2014)        ★ 8.7  2160p  ↑100  Adventure, Drama, Sci-Fi
  3. The Matrix (1999)          ★ 8.7  1080p  ↑100  Action, Sci-Fi
  ...
```

## How It Works

- **Movie data** comes from the YTS API (73,000+ movies with torrent links)
- **Fuzzy search** uses edit-distance-1 corrections (transposes, similar-char substitutions) tried in parallel, with Levenshtein scoring to rank results
- **Downloads** use [WebTorrent](https://github.com/webtorrent/webtorrent) for peer-to-peer downloading directly in Node/Bun
- Movies are saved to `~/Downloads/Movizon/`

## License

MIT

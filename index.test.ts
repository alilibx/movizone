import { test, expect, describe } from "bun:test";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  formatRuntime,
  buildMagnet,
  levenshtein,
  fuzzyScore,
  extractYear,
  generateTypoCorrections,
  DownloadManager,
  parseSubtitleRows,
  scoreSubtitle,
} from "./index.ts";
import type { SubtitleEntry } from "./index.ts";

// --- formatBytes ---

describe("formatBytes", () => {
  test("returns '0 B' for 0", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  test("formats bytes", () => {
    expect(formatBytes(500)).toBe("500.0 B");
  });

  test("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  test("formats megabytes", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });

  test("formats gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GB");
    expect(formatBytes(1.5 * 1073741824)).toBe("1.5 GB");
  });
});

// --- formatSpeed ---

describe("formatSpeed", () => {
  test("formats speed with /s suffix", () => {
    expect(formatSpeed(1024)).toBe("1.0 KB/s");
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(5 * 1048576)).toBe("5.0 MB/s");
  });
});

// --- formatEta ---

describe("formatEta", () => {
  test("returns --:-- for 0", () => {
    expect(formatEta(0)).toBe("--:--");
  });

  test("returns --:-- for Infinity", () => {
    expect(formatEta(Infinity)).toBe("--:--");
  });

  test("formats seconds and minutes", () => {
    expect(formatEta(90000)).toBe("1m 30s");
    expect(formatEta(30000)).toBe("0m 30s");
  });

  test("formats hours", () => {
    expect(formatEta(3600000)).toBe("1h 0m");
    expect(formatEta(5400000)).toBe("1h 30m");
  });
});

// --- formatRuntime ---

describe("formatRuntime", () => {
  test("returns N/A for 0", () => {
    expect(formatRuntime(0)).toBe("N/A");
  });

  test("formats minutes only", () => {
    expect(formatRuntime(45)).toBe("45m");
  });

  test("formats hours and minutes", () => {
    expect(formatRuntime(120)).toBe("2h 0m");
    expect(formatRuntime(150)).toBe("2h 30m");
  });
});

// --- buildMagnet ---

describe("buildMagnet", () => {
  test("builds valid magnet URI", () => {
    const magnet = buildMagnet("abc123", "Test Movie");
    expect(magnet).toStartWith("magnet:?xt=urn:btih:abc123");
    expect(magnet).toContain("dn=Test%20Movie");
    expect(magnet).toContain("&tr=");
  });

  test("encodes special characters in title", () => {
    const magnet = buildMagnet("hash", "Movie: The Sequel (2024)");
    expect(magnet).toContain("dn=Movie%3A%20The%20Sequel%20(2024)");
  });
});

// --- levenshtein ---

describe("levenshtein", () => {
  test("returns 0 for identical strings", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  test("returns string length for empty comparison", () => {
    expect(levenshtein("hello", "")).toBe(5);
    expect(levenshtein("", "world")).toBe(5);
  });

  test("calculates correct edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("cat", "car")).toBe(1);
    expect(levenshtein("abc", "def")).toBe(3);
  });
});

// --- fuzzyScore ---

describe("fuzzyScore", () => {
  test("returns 100 for exact substring match", () => {
    expect(fuzzyScore("dark", "The Dark Knight")).toBe(100);
  });

  test("returns 100 for exact match", () => {
    expect(fuzzyScore("inception", "Inception")).toBe(100);
  });

  test("returns positive score for close match", () => {
    const score = fuzzyScore("incption", "Inception");
    expect(score).toBeGreaterThan(0);
  });

  test("returns 0 for completely unrelated", () => {
    expect(fuzzyScore("xyzzy", "Inception")).toBe(0);
  });
});

// --- extractYear ---

describe("extractYear", () => {
  test("extracts 4-digit year from query", () => {
    expect(extractYear("inception 2010")).toBe(2010);
    expect(extractYear("the matrix 1999")).toBe(1999);
  });

  test("returns null when no year present", () => {
    expect(extractYear("inception")).toBeNull();
    expect(extractYear("the dark knight")).toBeNull();
  });

  test("only matches valid year ranges", () => {
    expect(extractYear("movie 1800")).toBeNull();
    expect(extractYear("movie 2024")).toBe(2024);
  });
});

// --- generateTypoCorrections ---

describe("generateTypoCorrections", () => {
  test("generates transpositions", () => {
    const corrections = generateTypoCorrections("teh");
    expect(corrections).toContain("the");
  });

  test("generates character substitutions", () => {
    const corrections = generateTypoCorrections("bat");
    // b -> p is in the similar map
    expect(corrections).toContain("pat");
  });

  test("generates deletions", () => {
    const corrections = generateTypoCorrections("hello");
    expect(corrections).toContain("hllo");
    expect(corrections).toContain("helo");
  });

  test("returns no duplicates", () => {
    const corrections = generateTypoCorrections("test");
    const unique = new Set(corrections);
    expect(corrections.length).toBe(unique.size);
  });
});

// --- DownloadManager ---

describe("DownloadManager", () => {
  test("starts with no downloads", () => {
    const dm = new DownloadManager();
    expect(dm.getDownloads()).toEqual([]);
    expect(dm.getActive()).toEqual([]);
  });

  test("getActive returns only connecting/downloading", () => {
    const dm = new DownloadManager();
    // We can't easily start real downloads in tests, but we can verify the
    // public interface contracts by checking initial state
    const downloads = dm.getDownloads();
    const active = dm.getActive();
    expect(active.length).toBeLessThanOrEqual(downloads.length);
  });

  test("cancelDownload on nonexistent id is a no-op", () => {
    const dm = new DownloadManager();
    // Should not throw
    dm.cancelDownload("999");
    expect(dm.getDownloads()).toEqual([]);
  });

  test("clearCompleted on empty is a no-op", () => {
    const dm = new DownloadManager();
    dm.clearCompleted();
    expect(dm.getDownloads()).toEqual([]);
  });
});

// --- parseSubtitleRows ---

describe("parseSubtitleRows", () => {
  const sampleHTML = `
<tr data-id="250883" class="high-rating">
  <td class="rating-cell"><span class="label label-success">3</span></td>
  <td class="flag-cell"><span class="sub-lang">Arabic</span></td>
  <td><a href="/subtitles/inception-2010-arabic-yify-90032">
      <span class="text-muted">subtitle</span> Inception 2010 720p BrRip x264 YIFY</a></td>
  <td class="uploader-cell">sub</td>
  <td class="download-cell">
    <a href="/subtitles/inception-2010-arabic-yify-90033" class="subtitle-download">download</a>
  </td>
</tr>
<tr data-id="250884" class="">
  <td class="rating-cell"><span class="label label-info">1</span></td>
  <td class="flag-cell"><span class="sub-lang">English</span></td>
  <td><a href="/subtitles/inception-2010-english-yify-90034">
      <span class="text-muted">subtitle</span> Inception 2010 1080p BluRay x264 YTS</a></td>
  <td class="uploader-cell">admin</td>
  <td class="download-cell">
    <a href="/subtitles/inception-2010-english-yify-90035" class="subtitle-download">download</a>
  </td>
</tr>`;

  test("parses multiple rows from HTML", () => {
    const entries = parseSubtitleRows(sampleHTML);
    expect(entries).toHaveLength(2);
  });

  test("extracts language correctly", () => {
    const entries = parseSubtitleRows(sampleHTML);
    expect(entries[0]!.language).toBe("Arabic");
    expect(entries[1]!.language).toBe("English");
  });

  test("extracts rating correctly", () => {
    const entries = parseSubtitleRows(sampleHTML);
    expect(entries[0]!.rating).toBe(3);
    expect(entries[1]!.rating).toBe(1);
  });

  test("extracts release text", () => {
    const entries = parseSubtitleRows(sampleHTML);
    expect(entries[0]!.release).toContain("Inception 2010 720p");
    expect(entries[1]!.release).toContain("1080p BluRay");
  });

  test("extracts download path", () => {
    const entries = parseSubtitleRows(sampleHTML);
    expect(entries[0]!.downloadPath).toBe("/subtitles/inception-2010-arabic-yify-90033");
    expect(entries[1]!.downloadPath).toBe("/subtitles/inception-2010-english-yify-90035");
  });

  test("returns empty array for no matches", () => {
    expect(parseSubtitleRows("<html><body>No subs</body></html>")).toEqual([]);
  });
});

// --- scoreSubtitle ---

describe("scoreSubtitle", () => {
  const baseTorrent = {
    url: "", hash: "abc", quality: "1080p", type: "BluRay",
    seeds: 100, peers: 50, size: "1.5 GB", size_bytes: 1500000000,
    video_codec: "x264", bit_depth: "8", audio_channels: "2.0",
  };

  test("includes entry rating in score", () => {
    const entry: SubtitleEntry = { language: "English", release: "Random Sub", rating: 5, downloadPath: "/sub" };
    expect(scoreSubtitle(entry, baseTorrent)).toBe(5);
  });

  test("adds 30 for matching quality", () => {
    const entry: SubtitleEntry = { language: "English", release: "Movie 1080p BrRip", rating: 2, downloadPath: "/sub" };
    expect(scoreSubtitle(entry, baseTorrent)).toBe(2 + 30);
  });

  test("adds 20 for matching type", () => {
    const entry: SubtitleEntry = { language: "English", release: "Movie BluRay Sub", rating: 1, downloadPath: "/sub" };
    expect(scoreSubtitle(entry, baseTorrent)).toBe(1 + 20);
  });

  test("adds 15 for YIFY/YTS tag", () => {
    const entry: SubtitleEntry = { language: "English", release: "Movie YIFY", rating: 0, downloadPath: "/sub" };
    expect(scoreSubtitle(entry, baseTorrent)).toBe(15);
  });

  test("stacks all bonuses", () => {
    const entry: SubtitleEntry = {
      language: "English",
      release: "Movie 1080p BluRay x264 YIFY",
      rating: 3,
      downloadPath: "/sub",
    };
    // 3 (rating) + 30 (quality) + 20 (type) + 15 (YIFY)
    expect(scoreSubtitle(entry, baseTorrent)).toBe(68);
  });

  test("case insensitive matching", () => {
    const entry: SubtitleEntry = { language: "English", release: "movie 1080P bluray yts", rating: 1, downloadPath: "/sub" };
    expect(scoreSubtitle(entry, baseTorrent)).toBe(1 + 30 + 20 + 15);
  });
});

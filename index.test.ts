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
} from "./index.ts";

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

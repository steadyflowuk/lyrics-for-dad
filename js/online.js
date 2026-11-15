// Finding lyrics on the internet.
// 1. LRCLIB (lrclib.net): free, open lyrics database, no account or key needed.
// 2. lyrics.ovh: tried when LRCLIB has nothing (or isn't answering).
// If neither has the song, the app offers to paste the words in by hand.

import { cleanLyrics } from "./template.js";

const LRCLIB = "https://lrclib.net/api";
const OVH = "https://api.lyrics.ovh";
const TIMEOUT = 12000;
const MAX_RESULTS = 8;

export class LookupError extends Error {
  constructor(kind) { super(kind); this.kind = kind; } // "offline" | "unavailable"
}

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const key = (t, a) => (t + "|" + a).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9|]+/g, "");

async function searchLrclib(q) {
  const data = await getJSON(`${LRCLIB}/search?q=${encodeURIComponent(q)}`);
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  const out = [];
  for (const r of data) {
    if (!r || r.instrumental) continue;
    const lyrics = cleanLyrics(r.plainLyrics || r.syncedLyrics || "");
    if (!lyrics.trim()) continue;
    const title = String(r.trackName || r.name || "").trim();
    const artist = String(r.artistName || "").trim();
    if (!title) continue;
    const k = key(title, artist);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, artist, album: String(r.albumName || ""), lyrics, source: "LRCLIB" });
  }
  return rank(out, q).slice(0, MAX_RESULTS);
}

// Put the most likely song first: the title and singer he typed, and the original over covers.
const words = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const EXTRAS = /\b(karaoke|cover|tribute|instrumental|remix|live|acoustic|version|made famous|in the style)\b/i;

export function rank(list, q) {
  const qw = new Set(words(q));
  const score = r => {
    const tw = words(r.title.replace(/\(.*?\)|\[.*?\]/g, ""));
    const aw = words(r.artist);
    let s = 0;
    if (tw.length && tw.every(w => qw.has(w))) s += 4;
    if (aw.length && aw.every(w => qw.has(w))) s += 3;
    for (const w of qw) if (tw.includes(w) || aw.includes(w)) s += 1;
    if (EXTRAS.test(r.title + " " + r.artist + " " + (r.album || "")) && !EXTRAS.test(q)) s -= 3;
    return s;
  };
  return list.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.r);
}

async function searchOvh(q) {
  const data = await getJSON(`${OVH}/suggest/${encodeURIComponent(q)}`);
  const list = data && Array.isArray(data.data) ? data.data : [];
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const title = String(r.title || "").trim();
    const artist = String((r.artist && r.artist.name) || "").trim();
    if (!title || !artist) continue;
    const k = key(title, artist);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, artist, album: String((r.album && r.album.title) || ""), lyrics: null, source: "lyrics.ovh" });
  }
  return rank(out, q).slice(0, MAX_RESULTS);
}

// lyrics.ovh only gives the words once a particular song is chosen.
export async function fetchOvhLyrics(result) {
  const titles = [result.title];
  const plain = result.title.replace(/\s*[-–(\[].*\b(remaster\w*|live|version|edit|mono|stereo|mix|feat\.?|ft\.?)\b.*$/i, "").trim();
  if (plain && plain !== result.title) titles.push(plain);
  for (const t of titles) {
    const data = await getJSON(`${OVH}/v1/${encodeURIComponent(result.artist)}/${encodeURIComponent(t)}`);
    const lyrics = cleanLyrics(data && data.lyrics);
    if (lyrics.trim()) return lyrics;
  }
  return null;
}

export async function findSongs(q) {
  q = q.trim();
  if (!q) return [];
  let failures = 0;
  try {
    const found = await searchLrclib(q);
    if (found.length) return found;
  } catch (e) { failures++; console.warn("LRCLIB:", e); }
  try {
    const found = await searchOvh(q);
    if (found.length) return found;
  } catch (e) { failures++; console.warn("lyrics.ovh:", e); }
  if (failures === 2) throw new LookupError(navigator.onLine === false ? "offline" : "unavailable");
  return [];
}

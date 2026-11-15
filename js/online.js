// Finding lyrics on the internet.
// LRCLIB (lrclib.net) is a free, open lyrics database; lyrics.ovh's suggestions come from Deezer's
// music catalogue, which copes with typos and knows which version of a song is the famous one.
// Both are asked at once. Songs Deezer suggests that LRCLIB's search missed are listed too, and
// their words are fetched when one is chosen. If nothing has the song, the app offers to paste it in.

import { tidyFetched } from "./template.js";

const LRCLIB = "https://lrclib.net/api";
const OVH = "https://api.lyrics.ovh";
const TIMEOUT = 10000;
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

// ---------- Tidying names ----------

const words = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/['’`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const keyOf = (t, a) => words(t).join(" ") + "|" + words(a).join(" ");

// Words people add that aren't part of the song's name.
const FILLER = new Set(["lyrics", "lyric", "words", "song", "by", "the song", "chords"]);
export function cleanQuery(q) {
  return String(q).replace(/[-–—:|"“”]+/g, " ").split(/\s+/).filter(w => w && !FILLER.has(w.toLowerCase())).join(" ").trim() || String(q).trim();
}

const JUNK_BRACKETS = /\s*[(\[][^)\]]*\b(remaster\w*|lyrics?|official|audio|video|from\b|mono|stereo|explicit|clean|radio edit|single version|album version|bonus|deluxe|\d{4})\b[^)\]]*[)\]]/gi;

function titleCase(s) {
  return s.replace(/\b([a-z])([a-z']*)/g, (m, a, b) => a.toUpperCase() + b);
}

// "Eagles - Hotel California (2013 Remaster)" by "Eagles" -> "Hotel California".
export function tidyTitle(title, artist) {
  let t = String(title || "").replace(JUNK_BRACKETS, "").replace(/\s+-\s+(\d{4} )?remaster\w*.*$/i, "").trim();
  const a = String(artist || "").trim();
  if (a) {
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`^${esc}(?:\\s*[-–—‒―|:~•·/]+\\s*|\\s{2,})`, "i"), "").trim();
  }
  t = t.replace(/\s+/g, " ");
  if (t && t === t.toLowerCase()) t = titleCase(t);
  return t || String(title || "").trim();
}
function tidyArtist(artist) {
  const a = String(artist || "").trim();
  return a && a === a.toLowerCase() ? titleCase(a) : a;
}

// ---------- Choosing the likeliest song ----------

const EXTRAS = /\b(karaoke|cover|covers|tribute|instrumental|remix|live|acoustic|unplugged|version|made famous|in the style|originally performed|piano|lullaby|8.?bit)\b/i;

export function rank(list, q, popular = new Map()) {
  const qw = new Set(words(q));
  const score = r => {
    const tw = words(r.title.replace(/\(.*?\)|\[.*?\]/g, ""));
    const aw = words(r.artist);
    let s = 0;
    if (tw.length && tw.every(w => qw.has(w))) s += 4;
    // The singer counts only if he typed it as well as the title (so an upload credited to
    // "Hotel" doesn't win a search for "hotel california").
    const rest = new Set([...qw].filter(w => !tw.includes(w)));
    if (aw.length && aw.every(w => rest.has(w))) s += 3;
    if (aw.length && aw.every(w => tw.includes(w))) s -= 2; // singer is just the title again: a junk upload
    for (const w of qw) if (tw.includes(w) || aw.includes(w)) s += 1;
    if (EXTRAS.test(r.title + " " + r.artist + " " + (r.album || "")) && !EXTRAS.test(q)) s -= 3;
    const p = popular.get(keyOf(r.title, r.artist));
    if (p != null) s += Math.max(0, 3 - p);  // Deezer's top suggestions are usually the famous version
    if (r.lyrics) s += 0.5;
    return s;
  };
  return list.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.r);
}

// Several people upload the same song to LRCLIB. Keep the copy that's laid out best.
function layoutScore(text) {
  const stanzas = text.split(/\n\s*\n/).filter(x => x.trim()).length;
  const lines = text.split("\n").filter(l => l.trim()).length;
  return (stanzas > 1 ? 1000 : 0) + Math.min(lines, 200);
}

function fromLrclib(data) {
  const best = new Map();
  for (const r of Array.isArray(data) ? data : []) {
    if (!r || r.instrumental) continue;
    const rawTitle = String(r.trackName || r.name || "");
    if (!rawTitle.trim() || /�/.test(rawTitle + (r.artistName || ""))) continue;
    const raw = r.plainLyrics || r.syncedLyrics || "";
    if (!raw.trim()) continue;
    const artist = tidyArtist(r.artistName);
    const title = tidyTitle(rawTitle, artist);
    const lyrics = tidyFetched(raw);
    if (!lyrics.trim()) continue;
    const item = { title, artist, album: String(r.albumName || ""), lyrics, source: "LRCLIB", order: best.size };
    const k = keyOf(title, artist);
    const old = best.get(k);
    if (!old) best.set(k, item);
    else if (layoutScore(lyrics) > layoutScore(old.lyrics)) best.set(k, { ...item, order: old.order });
  }
  return [...best.values()].sort((a, b) => a.order - b.order).map(({ order, ...r }) => r);
}

async function searchLrclib(q) {
  return fromLrclib(await getJSON(`${LRCLIB}/search?q=${encodeURIComponent(q)}`));
}

async function suggestOvh(q) {
  const data = await getJSON(`${OVH}/suggest/${encodeURIComponent(q)}`);
  const list = data && Array.isArray(data.data) ? data.data : [];
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const artist = String((r.artist && r.artist.name) || "").trim();
    const title = tidyTitle(r.title, artist);
    if (!title || !artist) continue;
    const k = keyOf(title, artist);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, artist, album: String((r.album && r.album.title) || ""), lyrics: null, source: "lyrics.ovh" });
  }
  return out;
}

// Words for a song chosen from the suggestions: LRCLIB by name first, then lyrics.ovh.
export async function fetchLyricsFor(result) {
  try {
    const data = await getJSON(`${LRCLIB}/search?track_name=${encodeURIComponent(result.title)}&artist_name=${encodeURIComponent(result.artist)}`);
    const k = keyOf(result.title, result.artist);
    const found = fromLrclib(data);
    const hit = found.find(r => keyOf(r.title, r.artist) === k) || found.find(r => keyOf(r.title, "") === keyOf(result.title, ""));
    if (hit) return { lyrics: hit.lyrics, source: "LRCLIB" };
  } catch (e) { console.warn("LRCLIB:", e); }
  const titles = [result.title];
  const plain = result.title.replace(/\s*[-–(\[].*\b(remaster\w*|live|version|edit|mono|stereo|mix|feat\.?|ft\.?)\b.*$/i, "").trim();
  if (plain && plain !== result.title) titles.push(plain);
  for (const t of titles) {
    try {
      const data = await getJSON(`${OVH}/v1/${encodeURIComponent(result.artist)}/${encodeURIComponent(t)}`);
      const lyrics = tidyFetched(data && data.lyrics);
      if (lyrics.trim()) return { lyrics, source: "lyrics.ovh" };
    } catch (e) { console.warn("lyrics.ovh:", e); }
  }
  return null;
}

export async function findSongs(input) {
  const q = cleanQuery(input);
  if (!q) return [];
  const [lrc, ovh] = await Promise.allSettled([searchLrclib(q), suggestOvh(q)]);
  if (lrc.status === "rejected") console.warn("LRCLIB:", lrc.reason);
  if (ovh.status === "rejected") console.warn("lyrics.ovh:", ovh.reason);
  if (lrc.status === "rejected" && ovh.status === "rejected") {
    throw new LookupError(navigator.onLine === false ? "offline" : "unavailable");
  }
  const found = lrc.status === "fulfilled" ? lrc.value : [];
  const suggested = ovh.status === "fulfilled" ? ovh.value : [];
  const popular = new Map(suggested.map((r, i) => [keyOf(r.title, r.artist), i]));
  const have = new Set(found.map(r => keyOf(r.title, r.artist)));
  // Add the best few suggestions LRCLIB's search didn't return (their words are fetched when chosen).
  const extra = suggested.filter(r => !have.has(keyOf(r.title, r.artist))).slice(0, 4);
  return rank([...found, ...extra], q, popular).slice(0, MAX_RESULTS);
}

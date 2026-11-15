// The song library, kept on this tablet only (IndexedDB, with localStorage as a fallback).
// Nothing is ever sent anywhere: the lyrics are a personal copy for reading along.

const DB_NAME = "my-songs";
const STORE = "songs";
const LS_KEY = "my-songs-library";
let dbPromise = null;
let useLocal = false;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("no indexedDB")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  }).catch(err => { useLocal = true; console.warn("Using localStorage for songs:", err); return null; });
  return dbPromise;
}

function localAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}
function localSave(list) { localStorage.setItem(LS_KEY, JSON.stringify(list)); }

function tx(mode, fn) {
  return openDB().then(db => {
    if (!db || useLocal) return null;
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      fn(store, r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("aborted"));
    });
  });
}

export async function allSongs() {
  await openDB();
  if (useLocal) return localAll();
  return tx("readonly", (s, done) => { const r = s.getAll(); r.onsuccess = () => done(r.result); });
}

export async function getSong(id) {
  await openDB();
  if (useLocal) return localAll().find(s => s.id === id) || null;
  return tx("readonly", (s, done) => { const r = s.get(id); r.onsuccess = () => done(r.result || null); });
}

export async function putSong(song) {
  await openDB();
  if (useLocal) {
    const list = localAll().filter(s => s.id !== song.id);
    list.push(song);
    localSave(list);
    return song;
  }
  await tx("readwrite", s => s.put(song));
  return song;
}

export async function deleteSong(id) {
  await openDB();
  if (useLocal) { localSave(localAll().filter(s => s.id !== id)); return; }
  await tx("readwrite", s => s.delete(id));
}

export function newId() {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Ask the tablet not to clear the library when space runs low.
export async function keepSafe() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* not supported */ }
  return false;
}

export async function isKeptSafe() {
  try { return !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); }
  catch { return false; }
}

// ---- Backup file ----

export async function exportLibrary() {
  const songs = await allSongs();
  return { app: "my-songs", version: 1, exported: new Date().toISOString(), songs };
}

function validSong(s) {
  return s && typeof s === "object" && typeof s.id === "string" && s.id.length < 80 &&
    typeof s.title === "string" && typeof (s.lyrics ?? "") === "string";
}

// Merge a backup into the library. Newer copies of the same song win; nothing is deleted.
export async function importLibrary(data) {
  if (!data || data.app !== "my-songs" || !Array.isArray(data.songs)) throw new Error("not a backup");
  const existing = new Map((await allSongs()).map(s => [s.id, s]));
  let added = 0, updated = 0, skipped = 0;
  for (const raw of data.songs) {
    if (!validSong(raw)) { skipped++; continue; }
    const song = {
      id: raw.id,
      title: String(raw.title).slice(0, 200),
      artist: String(raw.artist || "").slice(0, 200),
      lyrics: String(raw.lyrics || "").slice(0, 100000),
      source: String(raw.source || "Backup").slice(0, 60),
      added: Number(raw.added) || Date.now(),
      updated: Number(raw.updated) || Number(raw.added) || Date.now(),
    };
    const old = existing.get(song.id);
    if (!old) { await putSong(song); added++; }
    else if ((song.updated || 0) > (old.updated || 0)) { await putSong(song); updated++; }
  }
  return { added, updated, skipped };
}

// The song library, kept on this tablet only (IndexedDB, with localStorage as a fallback).
// Nothing is ever sent anywhere: the lyrics are a personal copy for reading along.

const DB_NAME = "my-songs";
const STORE = "songs";
const FOLDERS = "folders";
const LS_KEY = "my-songs-library";
const LS_FOLDERS = "my-songs-folders";
let dbPromise = null;
let useLocal = false;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("no indexedDB")); return; }
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FOLDERS)) db.createObjectStore(FOLDERS, { keyPath: "id" }); // version 2: gig folders
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  }).catch(err => { useLocal = true; console.warn("Using localStorage for songs:", err); return null; });
  return dbPromise;
}

function localAll(key = LS_KEY) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}
function localSave(list, key = LS_KEY) { localStorage.setItem(key, JSON.stringify(list)); }

function tx(mode, fn, storeName = STORE) {
  return openDB().then(db => {
    if (!db || useLocal) return null;
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
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
  if (useLocal) localSave(localAll().filter(s => s.id !== id));
  else await tx("readwrite", s => s.delete(id));
  // Take it out of any folders too.
  for (const f of await allFolders()) {
    if (f.songIds.includes(id)) await putFolder({ ...f, songIds: f.songIds.filter(x => x !== id), updated: Date.now() });
  }
}

// ---- Folders (for example "Gig 01"): a name and an ordered list of song ids ----

export async function allFolders() {
  await openDB();
  if (useLocal) return localAll(LS_FOLDERS);
  return tx("readonly", (s, done) => { const r = s.getAll(); r.onsuccess = () => done(r.result); }, FOLDERS);
}
export async function getFolder(id) {
  await openDB();
  if (useLocal) return localAll(LS_FOLDERS).find(f => f.id === id) || null;
  return tx("readonly", (s, done) => { const r = s.get(id); r.onsuccess = () => done(r.result || null); }, FOLDERS);
}
export async function putFolder(folder) {
  await openDB();
  if (useLocal) {
    localSave(localAll(LS_FOLDERS).filter(f => f.id !== folder.id).concat([folder]), LS_FOLDERS);
    return folder;
  }
  await tx("readwrite", s => s.put(folder), FOLDERS);
  return folder;
}
export async function deleteFolder(id) {
  await openDB();
  if (useLocal) { localSave(localAll(LS_FOLDERS).filter(f => f.id !== id), LS_FOLDERS); return; }
  await tx("readwrite", s => s.delete(id), FOLDERS);
}

export function newId(prefix = "s") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
  const folders = await allFolders();
  return { app: "my-songs", version: 2, exported: new Date().toISOString(), songs, folders };
}

function clampInt(v, lo, hi) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; }

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
      transpose: clampInt(raw.transpose, -11, 11),
      capo: clampInt(raw.capo, 0, 11),
      playCapo: raw.playCapo == null ? undefined : clampInt(raw.playCapo, 0, 11),
      lastOpened: Number(raw.lastOpened) || 0,
      added: Number(raw.added) || Date.now(),
      updated: Number(raw.updated) || Number(raw.added) || Date.now(),
    };
    if (song.playCapo === undefined) delete song.playCapo;
    const old = existing.get(song.id);
    if (!old) { await putSong(song); added++; }
    else if ((song.updated || 0) > (old.updated || 0)) { await putSong(song); updated++; }
  }
  // Folders: added if new, replaced if the backup's copy is newer. Only songs that exist are kept.
  let folders = 0;
  if (Array.isArray(data.folders)) {
    const ids = new Set((await allSongs()).map(s => s.id));
    const have = new Map((await allFolders()).map(f => [f.id, f]));
    for (const raw of data.folders) {
      if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string" || !Array.isArray(raw.songIds)) continue;
      const f = {
        id: raw.id.slice(0, 80), name: raw.name.slice(0, 80),
        songIds: raw.songIds.filter(x => typeof x === "string" && ids.has(x)),
        created: Number(raw.created) || Date.now(), updated: Number(raw.updated) || Date.now(),
      };
      const old = have.get(f.id);
      if (!old || f.updated > (old.updated || 0)) { await putFolder(f); folders++; }
    }
  }
  return { added, updated, skipped, folders };
}

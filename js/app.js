// My Songs: a big-print lyrics library for Dad's tablet.
import { renderSong, firstLine, plainWords, cleanLyrics, songHasChords, firstChord, extractSheet } from "./template.js";
import * as db from "./db.js";
import { findSongs, fetchLyricsFor, LookupError } from "./online.js";
import { transposeChord, bassNote, prefersFlats, guitarDiagram, bassDiagram, cleanChordSheet, tuningShift, tuningName } from "./chords.js";

const VERSION = "2.0.1";
const main = document.getElementById("main");
const toastEl = document.getElementById("toast");

const SIZES = [22, 26, 30, 34, 38, 44, 50, 58, 66, 76];  // words size in pixels
const DEFAULT_SIZE = 4;
const SPEEDS = [0.1, 0.15, 0.2, 0.27, 0.35, 0.45, 0.6]; // auto-scroll, in lines per second
const DEFAULT_SPEED = 2;

// ---------- Settings ----------

const SETTINGS_KEY = "my-songs-settings";
const settings = Object.assign(
  { theme: "auto", size: DEFAULT_SIZE, speed: DEFAULT_SPEED, instrument: "guitar", shapes: true, bold: false, lastBackup: 0 },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; } })()
);
settings.size = clamp(settings.size | 0, 0, SIZES.length - 1);
settings.speed = clamp(settings.speed | 0, 0, SPEEDS.length - 1);
if (!["guitar", "bass", "off"].includes(settings.instrument)) settings.instrument = settings.chords === false ? "off" : "guitar";
delete settings.chords;
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* full */ } }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function applyTheme() {
  const root = document.documentElement;
  if (["light", "dark", "contrast"].includes(settings.theme)) root.dataset.theme = settings.theme;
  else delete root.dataset.theme;
  if (settings.bold) root.dataset.bold = ""; else delete root.dataset.bold;
  const dark = settings.theme === "dark" || settings.theme === "contrast" || (settings.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", settings.theme === "contrast" ? "#000000" : dark ? "#0C1322" : "#1E2B45");
}
applyTheme();
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch { /* old browser */ }

// ---------- Small helpers ----------

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

// Navigation keeps a depth counter in the history, so "← My Songs" can step back to the
// home screen instead of piling up new pages behind it, and the tablet's own Back button
// always goes where he expects.
const depth = () => (history.state && typeof history.state.depth === "number" ? history.state.depth : 0);

function go(path, replace = false) {
  const url = "#" + path;
  if (replace) history.replaceState({ depth: depth() }, "", url);
  else history.pushState({ depth: depth() + 1 }, "", url);
  route();
}

function goHome() {
  const d = depth();
  if (d > 0) history.go(-d);           // the first page is always the home screen
  else go("/", true);
}

function goBack(fallback = "/") {
  if (depth() > 0) history.back();
  else go(fallback, true);
}

// Links inside the app go through go(), and "#/" links mean home.
document.addEventListener("click", e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  const path = a.getAttribute("href").slice(1);
  if (a.dataset.nav === "back") goBack(path);
  else if (a.dataset.nav === "tab") go(path, true);   // switching tabs doesn't pile up pages
  else if (path === "/") goHome();
  else go(path);
});

let toastTimer = null;
function toast(msg, ms = 3500) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

// A pop-up with any content; resolves with whatever close() is given. Back button closes it.
function modal(label, build) {
  return new Promise(resolve => {
    const close = val => { wrap.remove(); closeModal = null; resolve(val); };
    closeModal = close;
    const box = h("div", { class: "modal" });
    const wrap = h("div", { class: "modal-wrap", role: "dialog", "aria-modal": "true", "aria-label": label }, box);
    wrap.addEventListener("click", e => { if (e.target === wrap) close(null); });
    wrap.addEventListener("keydown", e => { if (e.key === "Escape") close(null); });
    build(box, close);
    document.body.append(wrap);
    const first = box.querySelector("input, button, a");
    if (first) first.focus();
  });
}

function askName(title, value, okLabel) {
  return modal(title, (box, close) => {
    const input = h("input", { class: "field", type: "text", value, maxlength: "60", autocomplete: "off", "aria-label": title });
    const form = h("form", { onsubmit: e => { e.preventDefault(); const v = input.value.trim(); if (v) close(v); else input.focus(); } },
      h("p", { class: "modal-text", text: title }), input,
      h("div", { class: "modal-buttons" },
        h("button", { class: "btn big green", type: "submit", text: okLabel }),
        h("button", { class: "btn big secondary", type: "button", onclick: () => close(null), text: "Cancel" })));
    box.append(form);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

function confirmBox(message, yes, no) {
  return new Promise(resolve => {
    const close = val => { wrap.remove(); closeModal = null; resolve(val); };
    closeModal = close;
    const wrap = h("div", { class: "modal-wrap", role: "dialog", "aria-modal": "true", "aria-label": message },
      h("div", { class: "modal" },
        h("p", { class: "modal-text", text: message }),
        h("div", { class: "modal-buttons" },
          h("button", { class: "btn big danger", type: "button", onclick: () => close(true) }, yes),
          h("button", { class: "btn big secondary", type: "button", onclick: () => close(false) }, no))));
    wrap.addEventListener("click", e => { if (e.target === wrap) close(false); });
    wrap.addEventListener("keydown", e => { if (e.key === "Escape") close(false); });
    document.body.append(wrap);
    wrap.querySelector(".secondary").focus();
  });
}

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/['’`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const sortKey = s => norm(s).replace(/^the /, "");
const songKey = (t, a) => sortKey(t) + "|" + norm(a);

// ---------- Library in memory ----------

let library = [];
const wordsIndex = new Map(); // id -> { stamp, title, words }

async function loadLibrary() {
  try { library = await db.allSongs(); }
  catch (e) { console.error(e); library = []; toast("Sorry, the song list couldn't be opened."); }
  library.sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)) || norm(a.artist).localeCompare(norm(b.artist)));
}

function indexFor(song) {
  const stamp = song.updated || song.added || 0;
  let ix = wordsIndex.get(song.id);
  if (!ix || ix.stamp !== stamp) {
    ix = { stamp, name: " " + norm(song.title + " " + (song.artist || "")) + " ", words: " " + norm(plainWords(song.lyrics)) + " " };
    wordsIndex.set(song.id, ix);
  }
  return ix;
}

function findInLibrary(q) {
  const nq = norm(q);
  if (!nq) return { byName: library, byWords: [] };
  const terms = nq.split(" ");
  const byName = library.filter(s => { const n = indexFor(s).name; return terms.every(t => n.includes(" " + t)); });
  const named = new Set(byName.map(s => s.id));
  const byWords = nq.length >= 3 ? library.filter(s => !named.has(s.id) && indexFor(s).words.includes(" " + nq)) : [];
  return { byName, byWords };
}

function alreadyHave(title, artist) {
  const k = songKey(title, artist);
  return library.find(s => songKey(s.title, s.artist) === k) || null;
}

// ---------- Screen keeping ----------

let wake = null;
let onSongScreen = false;
async function holdScreenOn() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible" && !wake) {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => { wake = null; });
    }
  } catch { /* not allowed right now */ }
}
function letScreenSleep() { if (wake) { wake.release().catch(() => {}); wake = null; } }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && onSongScreen) holdScreenOn();
  if (document.visibilityState === "hidden") stopScrolling();
});

// ---------- Auto-scroll ----------

let scroller = null;
function lineHeightPx() { return SIZES[settings.size] * 1.5; }
function atBottom() { return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2; }

function startScrolling() {
  if (scroller) return;
  if (atBottom()) window.scrollTo(0, 0);
  scroller = { pos: window.scrollY, lastSet: window.scrollY, last: performance.now(), raf: 0 };
  const step = now => {
    if (!scroller) return;
    const dt = Math.min(0.1, (now - scroller.last) / 1000);
    scroller.last = now;
    if (Math.abs(window.scrollY - scroller.lastSet) > 3) scroller.pos = window.scrollY; // he moved it by hand
    scroller.pos += dt * lineHeightPx() * SPEEDS[settings.speed];
    window.scrollTo(0, scroller.pos);
    scroller.lastSet = window.scrollY;
    if (atBottom()) { stopScrolling(); toast("That's the end of the song."); return; }
    scroller.raf = requestAnimationFrame(step);
  };
  scroller.raf = requestAnimationFrame(step);
  updateScrollButton();
}
function stopScrolling() {
  if (!scroller) return;
  cancelAnimationFrame(scroller.raf);
  scroller = null;
  updateScrollButton();
}
function updateScrollButton() {
  const b = document.querySelector('[data-act="scroll"]');
  if (!b) return;
  b.classList.toggle("on", !!scroller);
  b.setAttribute("aria-pressed", scroller ? "true" : "false");
  b.querySelector(".tb-icon").textContent = scroller ? "❚❚" : "▶";
  b.querySelector(".tb-label").textContent = scroller ? "Stop scrolling" : "Start scrolling";
}

// ---------- Router ----------

let renderToken = 0;
let routedHash = null;
let closeModal = null;
let libraryScroll = 0;
let lastQuery = sessionStorage.getItem("my-songs-q") || "";
let lastResults = null; // { q, results }
let pending = null;     // song being previewed before saving

async function route() {
  const token = ++renderToken;
  routedHash = location.hash;
  stopScrolling();
  letScreenSleep();
  if (closeModal) closeModal(false);
  onSongScreen = false;
  document.body.className = "";
  // Split before decoding, so song names with & + % or ? in them survive.
  const raw = location.hash.slice(1) || "/";
  const qAt = raw.indexOf("?");
  const path = qAt < 0 ? raw : raw.slice(0, qAt);
  const params = new URLSearchParams(qAt < 0 ? "" : raw.slice(qAt + 1));
  const parts = path.split("/").filter(Boolean).map(decodeURIComponentSafe);
  const stale = () => token !== renderToken;

  if (!parts.length) return showLibrary(stale);
  switch (parts[0]) {
    case "find": return showFind(params.get("q") || "", stale);
    case "preview": return showPreview();
    case "song": return showSong(parts[1], stale, params.get("f"));
    case "new": return showEdit(null, params.get("q") || "", stale);
    case "edit": return showEdit(parts[1], "", stale);
    case "settings": return showSettings(stale);
    case "help": return showHelp();
    case "folders": return showFolders(stale);
    case "folder": return parts[2] === "add" ? showFolderAdd(parts[1], stale) : showFolder(parts[1], stale);
    case "chords": return showPasteChords(parts[1], stale);
    default: go("/", true);
  }
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

function screen(cls, ...kids) {
  main.textContent = "";
  const s = h("div", { class: "screen " + cls }, ...kids);
  main.append(s);
  window.scrollTo(0, 0);
  return s;
}

function backButton(label = "My Songs", href = "#/", back = false) {
  return h("a", { class: "btn back", href, "data-nav": back ? "back" : null }, h("span", { class: "arrow", "aria-hidden": "true", text: "←" }), " " + label);
}

// ---------- Screen: My Songs ----------

function showLibrary() {
  const input = h("input", {
    id: "q", type: "search", class: "search-input", placeholder: "Type a song name or singer",
    autocomplete: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "search", value: lastQuery,
  });
  const clear = h("button", { class: "btn clear", type: "button", text: "Clear" });
  const addBtn = h("a", { class: "btn big gold add", href: "#/find" });
  const count = h("p", { class: "count" });
  const list = h("div", { class: "song-list" });

  const recent = h("div", { class: "recent" });
  const s = screen("library", homeTop("songs"),
    h("form", { class: "search-row", role: "search", onsubmit: e => { e.preventDefault(); submitSearch(); } },
      h("label", { for: "q", class: "vh", text: "Find a song" }), input, clear),
    addBtn, recent, count, list);

  function draw() {
    const q = input.value;
    lastQuery = q;
    sessionStorage.setItem("my-songs-q", q);
    clear.hidden = !q;
    const trimmed = q.trim();
    addBtn.textContent = "";
    if (trimmed) {
      addBtn.href = "#/find?q=" + encodeURIComponent(trimmed);
      addBtn.append(h("span", { class: "plus", "aria-hidden": "true", text: "🔍" }), ` Find “${trimmed}” on the internet`);
    } else {
      addBtn.href = "#/find";
      addBtn.append(h("span", { class: "plus", "aria-hidden": "true", text: "+" }), " Add a new song");
    }
    list.textContent = "";
    recent.textContent = "";
    // Recently played, for getting back to a song quickly (once there are a few songs).
    const played = trimmed || library.length < 6 ? [] :
      library.filter(x => x.lastOpened).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 3);
    if (played.length) {
      recent.append(h("h2", { class: "sub", text: "Played recently" }), h("ul", { class: "tiles" }, played.map(tile)));
    }
    if (!library.length) {
      count.textContent = "";
      list.append(h("div", { class: "welcome" },
        h("h2", { text: "No songs saved yet" }),
        h("ol", {},
          h("li", { text: "Press the gold “Add a new song” button." }),
          h("li", { text: "Type the name of the song." }),
          h("li", { text: "Press the right song, then press “Save to My Songs”." })),
        h("p", { text: "After that, the song stays here for good, even without the internet." })));
      return;
    }
    const { byName, byWords } = findInLibrary(q);
    if (!trimmed) count.textContent = library.length === 1 ? "All your songs (1)" : `All your songs (${library.length})`;
    else if (!byName.length && !byWords.length) count.textContent = `None of your songs match “${trimmed}”.`;
    else count.textContent = byName.length + byWords.length === 1 ? "1 song found" : `${byName.length + byWords.length} songs found`;

    let letter = null;
    const tiles = h("ul", { class: "tiles" });
    for (const song of byName) {
      if (!trimmed) {
        const first = (sortKey(song.title)[0] || "#").toUpperCase();
        const L = /[A-Z]/.test(first) ? first : "#";
        if (L !== letter) { letter = L; tiles.append(h("li", { class: "letter", "aria-hidden": "true", text: L })); }
      }
      tiles.append(tile(song));
    }
    list.append(tiles);
    if (byWords.length) {
      list.append(h("h2", { class: "sub", text: `Songs with “${trimmed}” in the words` }));
      list.append(h("ul", { class: "tiles" }, byWords.map(tile)));
    }
  }
  function tile(song) {
    return h("li", {}, h("a", { class: "tile", href: "#/song/" + encodeURIComponent(song.id), onclick: () => { libraryScroll = window.scrollY; } },
      h("span", { class: "tile-title", text: song.title || "Untitled song" }),
      song.artist ? h("span", { class: "tile-artist", text: song.artist }) : null));
  }

  input.addEventListener("input", draw);
  function submitSearch() {
    const q = input.value.trim();
    const { byName, byWords } = findInLibrary(q);
    if (q && !byName.length && !byWords.length) { clearHomeSearch(); go("/find?q=" + encodeURIComponent(q)); }
    else input.blur();
  }
  // Looking online starts afresh, so the home box isn't left holding an unmatched search.
  addBtn.addEventListener("click", () => { if (input.value.trim()) clearHomeSearch(); });
  clear.addEventListener("click", () => { input.value = ""; draw(); input.focus(); });
  draw();
  if (libraryScroll) { window.scrollTo(0, libraryScroll); libraryScroll = 0; }
  return s;
}

// Title, Help and Settings, and the Songs / Folders tabs, at the top of the home screen.
function homeTop(active) {
  const tab = (key, href, label) => h("a", {
    class: "tab" + (active === key ? " on" : ""), href, "data-nav": "tab", role: "tab",
    "aria-selected": active === key ? "true" : "false",
  }, label);
  return h("div", { class: "home-top" },
    h("div", { class: "top" },
      h("h1", { class: "app-title" }, h("span", { class: "note", "aria-hidden": "true", text: "♪" }), " My Songs"),
      h("div", { class: "top-buttons" },
        h("a", { class: "btn small secondary", href: "#/help", text: "Help" }),
        h("a", { class: "btn small secondary", href: "#/settings", text: "Settings" }))),
    h("div", { class: "tabs", role: "tablist", "aria-label": "Songs or folders" },
      tab("songs", "#/", "♪ Songs"), tab("folders", "#/folders", "🗂 Folders")));
}

function clearHomeSearch() { lastQuery = ""; sessionStorage.removeItem("my-songs-q"); }

// ---------- Screen: Find a new song ----------

function showFind(q) {
  const input = h("input", {
    id: "fq", type: "search", class: "search-input", value: q, autocomplete: "off", enterkeyhint: "search",
    placeholder: "For example: Wonderwall Oasis",
  });
  const status = h("div", { class: "status", "aria-live": "polite" });
  const results = h("ul", { class: "results" });
  const manual = h("div", { class: "manual" },
    h("p", { text: "Can't find it, or the words aren't right?" }),
    h("a", { class: "btn secondary", href: "#/new" + (q ? "?q=" + encodeURIComponent(q) : ""), text: "Type or paste the words myself" }));

  const form = h("form", { class: "find-form", onsubmit: e => { e.preventDefault(); search(input.value); } },
    h("label", { for: "fq", class: "field-label", text: "Song name, and the singer if you know it" }),
    h("div", { class: "search-row" }, input, h("button", { class: "btn big gold", type: "submit", text: "Search" })));

  const s = screen("find", backButton(), h("h1", { text: "Find a new song" }), form, status, results, manual);

  let busy = 0;
  let choosing = false;
  async function search(text) {
    const query = text.trim();
    if (!query) { status.textContent = "Type the name of a song first."; input.focus(); return; }
    input.blur();
    history.replaceState({ depth: depth() }, "", "#/find?q=" + encodeURIComponent(query));
    routedHash = location.hash;
    manual.querySelector("a").href = "#/new?q=" + encodeURIComponent(query);
    if (lastResults && lastResults.q === query) return show(lastResults.results, query);
    const mine = ++busy;
    results.textContent = "";
    status.textContent = "";
    status.append(h("span", { class: "spinner", "aria-hidden": "true" }), " Looking for the words…");
    try {
      const found = await findSongs(query);
      if (mine !== busy || !s.isConnected) return;
      lastResults = { q: query, results: found };
      show(found, query);
    } catch (e) {
      if (mine !== busy || !s.isConnected) return;
      status.textContent = e instanceof LookupError && e.kind === "offline"
        ? "The tablet isn't connected to the internet. Check the Wi-Fi and try again. Your saved songs still work."
        : "The song finder isn't answering right now. Try again in a minute, or type the words in yourself.";
    }
  }

  function show(found, query) {
    results.textContent = "";
    if (!found.length) {
      status.textContent = `Sorry, no words were found for “${query}”. Check the spelling, try adding the singer's name, or type the words in yourself.`;
      return;
    }
    status.textContent = found.length === 1 ? "1 song found. Press the right one." : `${found.length} songs found. Press the right one.`;
    for (const r of found) {
      const have = alreadyHave(r.title, r.artist);
      const start = r.lyrics ? firstLine(r.lyrics) : "";
      results.append(h("li", {}, h("button", { class: "result", type: "button", onclick: () => choose(r) },
        h("span", { class: "tile-title", text: r.title }),
        h("span", { class: "tile-artist", text: r.artist || "Unknown singer" }),
        start ? h("span", { class: "result-start", text: "Starts: “" + start + "”" }) : null,
        have ? h("span", { class: "badge", text: "Already in My Songs" }) : null)));
    }
  }

  async function choose(r) {
    if (choosing) return;
    if (!r.lyrics) {
      choosing = true;
      status.textContent = "";
      status.append(h("span", { class: "spinner", "aria-hidden": "true" }), " Getting the words…");
      let got = null;
      try { got = await fetchLyricsFor(r); } catch { got = null; }
      choosing = false;
      if (!s.isConnected) return;
      if (!got) { status.textContent = `Sorry, the words for “${r.title}” couldn't be found. Try another one, or type them in yourself.`; return; }
      r.lyrics = got.lyrics;
      r.source = got.source;
    }
    pending = { title: r.title, artist: r.artist, lyrics: r.lyrics, source: r.source };
    go("/preview");
  }

  if (q) search(q); else setTimeout(() => input.focus(), 50);
  return s;
}

// ---------- Screen: Check before saving ----------

function showPreview() {
  if (!pending) { go("/find", true); return; }
  const song = pending;
  const have = alreadyHave(song.title, song.artist);
  const sheet = h("article", { class: "song-sheet" });
  renderSong(sheet, song);
  sheet.style.setProperty("--lyric-size", SIZES[settings.size] + "px");

  const saveBtn = () => h("button", { class: "btn big green save", type: "button", onclick: save }, have ? "Save another copy" : "✓ Save to My Songs");
  const openBtn = () => have ? h("a", { class: "btn big gold", href: "#/song/" + encodeURIComponent(have.id), text: "Open my copy" }) : null;

  const s = screen("preview",
    h("div", { class: "preview-bar" },
      h("button", { class: "btn back", type: "button", onclick: () => goBack("/find") }, h("span", { class: "arrow", "aria-hidden": "true", text: "←" }), " Back"),
      openBtn(), saveBtn()),
    h("p", { class: "hint", text: have
      ? "You already have this song in My Songs."
      : "This is how the song will look. If it's the right one, press the green Save button." }),
    sheet,
    h("div", { class: "song-end" }, openBtn(), saveBtn()));

  let saving = false;
  async function save() {
    if (saving) return;
    saving = true;
    const now = Date.now();
    const rec = { id: db.newId(), title: song.title, artist: song.artist || "", lyrics: cleanLyrics(song.lyrics), source: song.source || "", added: now, updated: now };
    try {
      await db.putSong(rec);
      db.keepSafe();
      await loadLibrary();
      pending = null;
      lastQuery = "";
      sessionStorage.removeItem("my-songs-q");
      go("/song/" + encodeURIComponent(rec.id), true);
      toast("Saved to My Songs ✓");
    } catch (e) {
      console.error(e);
      saving = false;
      toast("Sorry, the song couldn't be saved. Please try again.");
    }
  }
  return s;
}

// ---------- Screen: A song ----------

const UG_SEARCH = "https://www.ultimate-guitar.com/search.php?search_type=title&value=";

function keyLabel(n, song) {
  const moved = n ? (n > 0 ? `up ${n}` : `down ${-n}`) : "";
  if (song && song.key) {
    const extra = song.standardTuning ? tuningShift(song.tuning) : 0;
    const k = transposeChord(song.key, n + extra, prefersFlats(transposeChord(song.key, n + extra, false)));
    return `Key of ${k}` + (moved ? ` (${moved})` : "");
  }
  if (!n) return "Original key";
  return n > 0 ? `Up ${n}` : `Down ${-n}`;
}

// What each written chord shows as, for the chosen instrument, key and capo.
function chordView(song) {
  const capo = song.capo || 0;
  const transpose = song.transpose || 0;
  const playCapo = song.playCapo == null ? capo : song.playCapo;
  const mode = settings.instrument;
  // Chords written for a guitar tuned down (Eb tuning etc.) can be moved to standard tuning.
  const tune = song.standardTuning ? tuningShift(song.tuning) : 0;
  const shift = mode === "bass" ? capo + transpose + tune : capo + transpose + tune - playCapo;
  const first = firstChord(song.lyrics);
  const flats = shift ? prefersFlats(transposeChord(first || "C", shift, false)) : false;
  const show = mode === "bass" ? c => bassNote(c, shift, flats) : c => transposeChord(c, shift, flats);
  return { mode, show, capo, transpose, playCapo };
}

async function showSong(id, stale, folderId) {
  const song = id ? await db.getSong(id) : null;
  const folder = folderId ? await db.getFolder(folderId) : null;
  if (stale()) return;
  if (!song) { toast("That song isn't in My Songs any more."); go("/", true); return; }
  song.lastOpened = Date.now();
  db.putSong(song).catch(() => {});
  { const x = library.find(l => l.id === song.id); if (x) x.lastOpened = song.lastOpened; }

  // In a folder: where this song is, and the songs either side.
  const order = folder ? folder.songIds.filter(x => library.some(l => l.id === x)) : [];
  const at = order.indexOf(song.id);
  const inFolder = folder && at >= 0;
  const songById = x => library.find(l => l.id === x);
  const prevId = inFolder && at > 0 ? order[at - 1] : null;
  const nextId = inFolder && at < order.length - 1 ? order[at + 1] : null;
  const folderHref = x => "#/song/" + encodeURIComponent(x) + "?f=" + encodeURIComponent(folder.id);
  const goSong = x => go("/song/" + encodeURIComponent(x) + "?f=" + encodeURIComponent(folder.id), true);

  const sheet = h("article", { class: "song-sheet" });
  const shapes = h("div", { class: "shapes", role: "group", tabindex: "0", "aria-label": "Chord shapes (slide sideways for more)" });
  const chordInfo = h("p", { class: "chord-info" });
  let hasChords = false;
  function draw() {
    const view = chordView(song);
    const r = renderSong(sheet, song, { show: view.show });
    hasChords = r.hasChords;
    sheet.classList.toggle("hide-chords", view.mode === "off");
    sheet.classList.toggle("bass-mode", view.mode === "bass");
    sheet.style.setProperty("--lyric-size", SIZES[settings.size] + "px");
    // Chord shapes for the chords in this song.
    shapes.textContent = "";
    shapes.hidden = !(hasChords && view.mode !== "off" && settings.shapes && r.chords.length);
    if (!shapes.hidden) {
      for (const c of r.chords.slice(0, 24)) {
        const d = view.mode === "bass" ? bassDiagram(c) : guitarDiagram(c);
        shapes.append(h("figure", { class: "shape" }, h("figcaption", { text: c }), d || h("span", { class: "no-shape", text: "?" })));
      }
    }
    chordInfo.hidden = !hasChords || view.mode === "off";
    const tuning = !song.tuning ? ""
      : song.standardTuning && tuningShift(song.tuning) ? " · Standard tuning"
      : ` · Tuning: ${song.tuning}${tuningName(song.tuning) ? " (" + tuningName(song.tuning) + ")" : ""}`;
    chordInfo.textContent = (view.mode === "bass"
      ? `Bass notes · ${keyLabel(view.transpose, song)}`
      : `Guitar · ${view.playCapo ? "Capo " + view.playCapo : "No capo"} · ${keyLabel(view.transpose, song)}`) + tuning;
    const head = sheet.querySelector(".song-head");
    head.after(chordInfo, shapes);
  }
  draw();

  const tb = (act, icon, label, extra = {}) => h("button", { class: "tb", type: "button", "data-act": act, ...extra },
    h("span", { class: "tb-icon", "aria-hidden": "true", text: icon }), h("span", { class: "tb-label", text: label }));

  const toolbar = h("nav", { class: "toolbar", "aria-label": "Song controls" },
    tb("smaller", "A−", "Smaller"),
    tb("bigger", "A+", "Bigger"),
    tb("scroll", "▶", "Start scrolling", { "aria-pressed": "false", class: "tb wide" }),
    tb("slower", "−", "Slower"),
    tb("faster", "+", "Faster"),
    tb("chords", "♯", "Chords"));

  const top = h("div", { class: "song-top" },
    inFolder ? backButton(folder.name, "#/folder/" + encodeURIComponent(folder.id), true) : backButton(),
    inFolder ? h("div", { class: "folder-nav" },
      h("a", { class: "btn secondary" + (prevId ? "" : " disabled"), href: prevId ? folderHref(prevId) : null, "data-nav": "tab", "aria-disabled": prevId ? null : "true" }, "◀ Previous"),
      h("span", { class: "folder-pos", text: `${at + 1} of ${order.length}` }),
      h("a", { class: "btn gold" + (nextId ? "" : " disabled"), href: nextId ? folderHref(nextId) : null, "data-nav": "tab", "aria-disabled": nextId ? null : "true" }, "Next ▶")) : null);

  const next = nextId ? songById(nextId) : null;
  const s = screen("song", top, sheet,
    h("div", { class: "song-end" },
      h("p", { class: "end-mark", text: "— End of song —" }),
      next ? h("a", { class: "btn big gold next-song", href: folderHref(nextId), "data-nav": "tab" }, `Next song: ${next.title}  ▶`) : null,
      inFolder && !next ? h("p", { class: "end-mark", text: `That was the last song in “${folder.name}”.` }) : null,
      h("button", { class: "btn secondary", type: "button", onclick: addToFolder, text: "🗂 Add to a folder" }),
      h("a", { class: "btn secondary", href: "#/edit/" + encodeURIComponent(song.id), text: "Change the words" }),
      h("button", { class: "btn secondary danger-text", type: "button", onclick: remove, text: "Remove this song" })),
    toolbar);
  document.body.className = "has-toolbar";
  onSongScreen = true;
  holdScreenOn();

  function keepPlace(fn) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const frac = max > 0 ? window.scrollY / max : 0;
    fn();
    const max2 = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, frac * max2);
    if (scroller) { scroller.pos = window.scrollY; scroller.lastSet = window.scrollY; }
  }

  toolbar.addEventListener("click", e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "smaller" || act === "bigger") {
      const n = clamp(settings.size + (act === "bigger" ? 1 : -1), 0, SIZES.length - 1);
      if (n === settings.size) { toast(act === "bigger" ? "That's the biggest size." : "That's the smallest size."); return; }
      settings.size = n; saveSettings();
      keepPlace(() => sheet.style.setProperty("--lyric-size", SIZES[settings.size] + "px"));
      updateLimits();
    } else if (act === "scroll") {
      scroller ? stopScrolling() : startScrolling();
    } else if (act === "slower" || act === "faster") {
      const n = clamp(settings.speed + (act === "faster" ? 1 : -1), 0, SPEEDS.length - 1);
      if (n === settings.speed) { toast(act === "faster" ? "That's the fastest speed." : "That's the slowest speed."); return; }
      settings.speed = n; saveSettings();
      toast(`Scrolling speed ${settings.speed + 1} of ${SPEEDS.length}`, 1800);
      updateLimits();
    } else if (act === "chords") {
      stopScrolling();
      chordPanel();
    }
  });
  function updateLimits() {
    toolbar.querySelector('[data-act="smaller"]').classList.toggle("limit", settings.size === 0);
    toolbar.querySelector('[data-act="bigger"]').classList.toggle("limit", settings.size === SIZES.length - 1);
    toolbar.querySelector('[data-act="slower"]').classList.toggle("limit", settings.speed === 0);
    toolbar.querySelector('[data-act="faster"]').classList.toggle("limit", settings.speed === SPEEDS.length - 1);
  }
  updateLimits();

  // Tapping the words while they scroll pauses them.
  sheet.addEventListener("click", () => { if (scroller) { stopScrolling(); toast("Scrolling paused. Press “Start scrolling” to carry on."); } });

  // A Bluetooth page-turner pedal or keyboard: down/up turn the page; left/right change song in a folder.
  const onKey = e => {
    if (!s.isConnected) { document.removeEventListener("keydown", onKey); return; }
    if (closeModal || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
    const page = dir => { stopScrolling(); window.scrollBy({ top: dir * window.innerHeight * 0.7, behavior: "smooth" }); };
    if (["PageDown", "ArrowDown", " "].includes(e.key)) { e.preventDefault(); page(1); }
    else if (["PageUp", "ArrowUp"].includes(e.key)) { e.preventDefault(); page(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); if (nextId) goSong(nextId); else page(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (prevId) goSong(prevId); else page(-1); }
  };
  document.addEventListener("keydown", onKey);

  async function save(changes) {
    Object.assign(song, changes, { updated: Date.now() });
    await db.putSong(song);
    await loadLibrary();
  }

  function chordPanel() {
    return modal("Chords", (box, close) => {
      const fill = () => {
        box.textContent = "";
        box.classList.add("panel-sheet");
        box.append(h("p", { class: "modal-text", text: "Chords" }));
        if (!hasChords) {
          box.append(
            h("p", { text: "This song doesn't have chords yet. Look them up on a chords website, copy them, then paste them here." }),
            h("div", { class: "modal-buttons" },
              h("a", { class: "btn big gold", href: UG_SEARCH + encodeURIComponent(song.title + " " + (song.artist || "")), target: "_blank", rel: "noopener",
                onclick: () => setTimeout(() => go("/chords/" + encodeURIComponent(song.id)), 300) }, "1. Look up chords online ↗"),
              h("a", { class: "btn big green", href: "#/chords/" + encodeURIComponent(song.id) }, "2. Paste the chords"),
              h("button", { class: "btn big secondary", type: "button", onclick: () => close(null), text: "Close" })));
          return;
        }
        const view = chordView(song);
        const choice = (val, label) => h("button", {
          class: "choice" + (settings.instrument === val ? " on" : ""), type: "button", "aria-pressed": settings.instrument === val ? "true" : "false",
          onclick: () => { settings.instrument = val; saveSettings(); keepPlace(draw); fill(); },
        }, label);
        const stepper = (label, value, onMinus, onPlus, minusLabel, plusLabel) => h("div", { class: "stepper" },
          h("span", { class: "stepper-label", text: label }),
          h("button", { class: "btn secondary", type: "button", onclick: onMinus }, minusLabel),
          h("span", { class: "stepper-value", text: value }),
          h("button", { class: "btn secondary", type: "button", onclick: onPlus }, plusLabel));
        const setKey = d => async () => { await save({ transpose: clamp((song.transpose || 0) + d, -11, 11) }); keepPlace(draw); fill(); };
        const setCapo = d => async () => { await save({ playCapo: clamp(view.playCapo + d, 0, 9) }); keepPlace(draw); fill(); };
        box.append(
          h("p", { class: "panel-label", text: "Show chords for" }),
          h("div", { class: "choices" }, choice("guitar", "🎸 Guitar"), choice("bass", "Bass"), choice("off", "Words only")),
          settings.instrument !== "off" ? stepper("Key", keyLabel(view.transpose, song), setKey(-1), setKey(1), "− Lower", "+ Higher") : null,
          settings.instrument !== "off" && tuningShift(song.tuning) ? h("div", { class: "tuning-choice" },
            h("p", { class: "muted", text: `These chords are for instruments tuned ${tuningName(song.tuning)} (${song.tuning}).` }),
            h("button", {
              class: "choice wide" + (song.standardTuning ? " on" : ""), type: "button", "aria-pressed": song.standardTuning ? "true" : "false",
              onclick: async () => { await save({ standardTuning: !song.standardTuning }); keepPlace(draw); fill(); },
            }, song.standardTuning ? "Playing in standard tuning (chords changed to match)" : "Change the chords for standard tuning")) : null,
          settings.instrument === "guitar" ? stepper("Capo", view.playCapo ? `Capo ${view.playCapo}` : "No capo", setCapo(-1), setCapo(1), "−", "+") : null,
          settings.instrument !== "off" ? h("button", {
            class: "choice wide" + (settings.shapes ? " on" : ""), type: "button", "aria-pressed": settings.shapes ? "true" : "false",
            onclick: () => { settings.shapes = !settings.shapes; saveSettings(); keepPlace(draw); fill(); },
          }, settings.shapes ? "Chord shapes: shown" : "Chord shapes: hidden") : null,
          view.capo ? h("p", { class: "muted", text: `The chords were written for capo ${view.capo}.` }) : null,
          h("div", { class: "modal-buttons" },
            h("button", { class: "btn big green", type: "button", onclick: () => close(null), text: "Done" }),
            h("a", { class: "btn secondary", href: UG_SEARCH + encodeURIComponent(song.title + " " + (song.artist || "")), target: "_blank", rel: "noopener" }, "Look up other chords online ↗"),
            h("a", { class: "btn secondary", href: "#/chords/" + encodeURIComponent(song.id) }, "Paste new chords"),
            song.wordsOnly ? h("button", { class: "btn secondary danger-text", type: "button", onclick: async () => {
              await save({ lyrics: song.wordsOnly, wordsOnly: undefined, capo: 0, playCapo: undefined, transpose: 0, tuning: "", key: "", standardTuning: false });
              delete song.wordsOnly; await db.putSong(song);
              close(null); keepPlace(draw); toast("Chords removed. The words are back as they were.");
            } }, "Remove the chords") : null));
      };
      fill();
    });
  }

  async function addToFolder() {
    stopScrolling();
    const folders = (await db.allFolders()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const picked = await modal("Add to a folder", (box, close) => {
      box.append(h("p", { class: "modal-text", text: `Add “${song.title}” to which folder?` }));
      const list = h("div", { class: "modal-buttons" });
      for (const f of folders) {
        const there = f.songIds.includes(song.id);
        list.append(h("button", { class: "btn big secondary", type: "button", onclick: () => close(f) },
          `🗂 ${f.name}${there ? "  ✓ already in it" : ""}`));
      }
      list.append(
        h("button", { class: "btn big gold", type: "button", onclick: () => close("new") }, "＋ New folder"),
        h("button", { class: "btn secondary", type: "button", onclick: () => close(null) }, "Cancel"));
      box.append(list);
    });
    if (!picked) return;
    let f = picked;
    if (picked === "new") {
      const name = await askName("Name of the new folder", nextFolderName(folders), "Make folder");
      if (!name) return;
      f = { id: db.newId("f"), name, songIds: [], created: Date.now(), updated: Date.now() };
    }
    if (f.songIds.includes(song.id)) { toast(`It's already in “${f.name}”.`); return; }
    await db.putFolder({ ...f, songIds: f.songIds.concat(song.id), updated: Date.now() });
    toast(`Added to “${f.name}” ✓`);
  }

  async function remove() {
    stopScrolling();
    const ok = await confirmBox(`Remove “${song.title}” from My Songs?`, "Yes, remove it", "No, keep it");
    if (!ok) return;
    await db.deleteSong(song.id);
    await loadLibrary();
    goHome();
    toast(`“${song.title}” was removed.`);
  }
  return s;
}

// ---------- Screen: Paste chords into a song ----------

async function showPasteChords(id, stale) {
  const song = id ? await db.getSong(id) : null;
  if (stale()) return;
  if (!song) { go("/", true); return; }
  const box = h("textarea", { id: "pc", class: "field words", rows: "14", spellcheck: "false", placeholder: "The chords and words will appear here" });
  const msg = h("p", { class: "form-msg", role: "status" });
  const canRead = !!(navigator.clipboard && navigator.clipboard.readText);
  const lookUp = UG_SEARCH + encodeURIComponent(song.title + " " + (song.artist || ""));

  // Whatever was copied (the whole web page is fine), keep just the chord sheet.
  function fill(raw) {
    const { text, removed } = extractSheet(raw);
    box.value = text;
    if (!text.trim()) { msg.className = "form-msg"; msg.textContent = "There was nothing to paste. Copy the chords first."; return false; }
    if (!songHasChords(text)) { msg.className = "form-msg"; msg.textContent = "No chords were found in what was copied. Make sure it's a page with chords (like G, Am or D7 above the words)."; return false; }
    msg.className = "form-msg good";
    msg.textContent = removed
      ? `✓ Found the chords (and left out ${removed} lines of website text). Check them below, then press “Save the chords”.`
      : "✓ Chords pasted. Press “Save the chords”.";
    return true;
  }

  const s = screen("edit",
    backButton("Cancel", "#/song/" + encodeURIComponent(song.id), true),
    h("h1", { text: `Add chords to “${song.title}”` }),
    h("ol", { class: "steps" },
      h("li", {}, "Press ", h("a", { href: lookUp, target: "_blank", rel: "noopener", text: "Look up chords online ↗" }),
        " and choose a version marked “Chords”."),
      h("li", { text: "On the chords page, press and hold on any words, choose “Select all”, then “Copy”. (No need to pick out just the chords — the whole page is fine.)" }),
      h("li", { text: canRead ? "Come back to My Songs and press the gold “Paste” button." : "Come back to My Songs, press and hold in the box below and choose “Paste”." })),
    canRead ? h("button", { class: "btn big gold", type: "button", onclick: pasteNow, text: "📋 Paste" }) : null,
    msg,
    h("label", { for: "pc", class: "field-label", text: "Chords and words" }),
    box,
    h("div", { class: "form-buttons" },
      h("button", { class: "btn big green", type: "button", onclick: saveIt, text: "✓ Save the chords" }),
      h("a", { class: "btn big secondary", href: "#/song/" + encodeURIComponent(song.id), "data-nav": "back", text: "Cancel" })));

  // Pasting straight into the box is tidied the same way.
  box.addEventListener("paste", e => {
    const raw = e.clipboardData && e.clipboardData.getData("text/plain");
    if (!raw) return;
    e.preventDefault();
    fill(raw);
  });

  async function pasteNow() {
    try { fill(await navigator.clipboard.readText()); }
    catch { msg.className = "form-msg"; msg.textContent = "The tablet didn't allow pasting that way. Press and hold in the box below, then choose Paste."; box.focus(); }
  }

  // Coming back from the chords website: if he's already allowed pasting once, fill it in for him.
  const onBack = async () => {
    if (!s.isConnected) { document.removeEventListener("visibilitychange", onBack); return; }
    if (document.visibilityState !== "visible" || box.value.trim() || !canRead) return;
    try {
      const perm = navigator.permissions && await navigator.permissions.query({ name: "clipboard-read" });
      if (!perm || perm.state !== "granted") return;
      const raw = await navigator.clipboard.readText();
      if (raw && songHasChords(extractSheet(raw).text)) fill(raw);
    } catch { /* not allowed: he can press Paste */ }
  };
  document.addEventListener("visibilitychange", onBack);

  async function saveIt() {
    const { text, capo, tuning, key } = cleanChordSheet(extractSheet(box.value).text, song.title);
    const lyrics = cleanLyrics(text);
    if (!lyrics.trim()) { msg.className = "form-msg"; msg.textContent = "The box is empty. Paste the chords first."; return; }
    if (!songHasChords(lyrics)) { msg.className = "form-msg"; msg.textContent = "No chords were found in that. Check you copied the chords page (it shows chords like G, Am or D7 above the words)."; return; }
    const keepWords = song.wordsOnly || (songHasChords(song.lyrics) ? undefined : song.lyrics);
    const rec = { ...song, lyrics, capo, tuning, key, standardTuning: false, transpose: 0, updated: Date.now() };
    delete rec.playCapo;
    if (keepWords) rec.wordsOnly = keepWords;
    await db.putSong(rec);
    await loadLibrary();
    goBack("/song/" + encodeURIComponent(song.id));
    toast(capo ? `Chords saved ✓ (capo ${capo})` : "Chords saved ✓");
  }
  return s;
}

// ---------- Screen: Add or change a song by hand ----------

async function showEdit(id, q, stale) {
  const song = id ? await db.getSong(id) : null;
  if (stale && stale()) return;
  if (id && !song) { go("/", true); return; }

  const title = h("input", { id: "et", class: "field", type: "text", value: song ? song.title : q, autocomplete: "off", maxlength: "200" });
  const artist = h("input", { id: "ea", class: "field", type: "text", value: song ? song.artist : "", autocomplete: "off", maxlength: "200" });
  const words = h("textarea", { id: "ew", class: "field words", rows: "16", spellcheck: "false" });
  words.value = song ? song.lyrics : "";
  const msg = h("p", { class: "form-msg", role: "alert" });

  const s = screen("edit",
    backButton("Cancel", song ? "#/song/" + encodeURIComponent(song.id) : "#/", true),
    h("h1", { text: song ? "Change this song" : "Add a song yourself" }),
    h("label", { for: "et", class: "field-label", text: "Song name" }), title,
    h("label", { for: "ea", class: "field-label", text: "Singer or band" }), artist,
    h("label", { for: "ew", class: "field-label", text: "Words" }),
    h("p", { class: "field-help", text: "Leave an empty line between each verse. You can copy the words from a website and paste them here." }),
    words,
    h("details", { class: "tip" },
      h("summary", { text: "How to add guitar chords" }),
      h("p", { text: "Either put each chord in square brackets just before the word it goes with:" }),
      h("pre", { text: "[G]Here are the [C]words of the [D]song" }),
      h("p", { text: "or put the chords on their own line above the words, lined up with spaces:" }),
      h("pre", { text: "G           C          D\nHere are the words of the song" }),
      h("p", { text: "Section names on their own line, like [Chorus] or Verse 2, are shown as headings." })),
    msg,
    h("div", { class: "form-buttons" },
      h("button", { class: "btn big green", type: "button", onclick: save, text: "✓ Save" }),
      h("a", { class: "btn big secondary", href: song ? "#/song/" + encodeURIComponent(song.id) : "#/", "data-nav": "back", text: "Cancel" })));

  if (!song) setTimeout(() => (q ? words : title).focus(), 50);

  async function save() {
    const t = title.value.trim();
    if (!t) { msg.textContent = "Please type the name of the song."; title.focus(); return; }
    const now = Date.now();
    const rec = song
      ? { ...song, title: t, artist: artist.value.trim(), lyrics: cleanLyrics(words.value), updated: now }
      : { id: db.newId(), title: t, artist: artist.value.trim(), lyrics: cleanLyrics(words.value), source: "Typed in", added: now, updated: now };
    try {
      await db.putSong(rec);
      db.keepSafe();
      await loadLibrary();
      if (song && depth() > 0) goBack("/song/" + encodeURIComponent(rec.id)); // back to the song, now updated
      else go("/song/" + encodeURIComponent(rec.id), true);
      toast("Saved ✓");
    } catch (e) {
      console.error(e);
      msg.textContent = "Sorry, it couldn't be saved. Please try again.";
    }
  }
  return s;
}

// ---------- Folders (for example a gig's songs, in order) ----------

function nextFolderName(folders) {
  let n = 1;
  const names = new Set(folders.map(f => f.name.toLowerCase()));
  while (names.has(`gig ${String(n).padStart(2, "0")}`)) n++;
  return `Gig ${String(n).padStart(2, "0")}`;
}

async function newFolder() {
  const folders = await db.allFolders();
  const name = await askName("Name of the new folder", nextFolderName(folders), "Make folder");
  if (!name) return null;
  const f = { id: db.newId("f"), name, songIds: [], created: Date.now(), updated: Date.now() };
  await db.putFolder(f);
  return f;
}

async function showFolders(stale) {
  const folders = (await db.allFolders()).sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), undefined, { numeric: true }));
  if (stale()) return;
  const known = new Set(library.map(l => l.id));
  const s = screen("library folders", homeTop("folders"),
    h("button", { class: "btn big gold add", type: "button", onclick: async () => {
      const f = await newFolder();
      if (f) go("/folder/" + encodeURIComponent(f.id));
    } }, h("span", { class: "plus", "aria-hidden": "true", text: "+" }), " New folder"),
    folders.length
      ? h("ul", { class: "tiles" }, folders.map(f => {
        const n = f.songIds.filter(x => known.has(x)).length;
        return h("li", {}, h("a", { class: "tile folder-tile", href: "#/folder/" + encodeURIComponent(f.id) },
          h("span", { class: "tile-title", text: "🗂 " + f.name }),
          h("span", { class: "tile-artist", text: n === 1 ? "1 song" : `${n} songs` })));
      }))
      : h("div", { class: "welcome" },
        h("h2", { text: "No folders yet" }),
        h("p", { text: "A folder holds a list of songs in the order you want them, for example the songs for a gig." }),
        h("ol", {},
          h("li", { text: "Press “New folder” and give it a name, like Gig 01." }),
          h("li", { text: "Press “Add songs” and tick the songs you want." }),
          h("li", { text: "Use “Change the order” to put them in running order." }))));
  return s;
}

async function showFolder(id, stale) {
  const folder = await db.getFolder(id);
  if (stale()) return;
  if (!folder) { toast("That folder isn't there any more."); go("/folders", true); return; }
  const byId = new Map(library.map(l => [l.id, l]));
  let ids = folder.songIds.filter(x => byId.has(x));
  let ordering = false;
  const list = h("ol", { class: "set-list" });
  const count = h("p", { class: "count" });
  const orderBtn = h("button", { class: "btn big secondary", type: "button", onclick: () => { ordering = !ordering; draw(); } });

  async function saveOrder() {
    folder.songIds = ids.slice();
    folder.updated = Date.now();
    await db.putFolder(folder);
  }
  function draw() {
    count.textContent = ids.length === 1 ? "1 song" : `${ids.length} songs`;
    orderBtn.textContent = ordering ? "✓ Finished changing the order" : "⇅ Change the order";
    orderBtn.classList.toggle("green", ordering);
    orderBtn.hidden = ids.length < 1;
    startBtn.hidden = ids.length < 1;
    list.textContent = "";
    list.classList.toggle("ordering", ordering);
    if (!ids.length) {
      list.append(h("li", { class: "empty" }, "This folder is empty. Press “Add songs” to choose some."));
      return;
    }
    ids.forEach((sid, i) => {
      const song = byId.get(sid);
      const label = h("span", { class: "set-text" },
        h("span", { class: "tile-title", text: song.title }),
        song.artist ? h("span", { class: "tile-artist", text: song.artist }) : null);
      if (!ordering) {
        list.append(h("li", {}, h("a", { class: "set-row", href: "#/song/" + encodeURIComponent(sid) + "?f=" + encodeURIComponent(folder.id) },
          h("span", { class: "set-no", text: String(i + 1) }), label)));
        return;
      }
      const move = d => async () => {
        const j = i + d;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await saveOrder();
        draw();
        const btn = list.children[j] && list.children[j].querySelector(d < 0 ? ".up" : ".down");
        if (btn && !btn.disabled) btn.focus();
      };
      list.append(h("li", { class: "set-row ordering" },
        h("span", { class: "set-no", text: String(i + 1) }), label,
        h("span", { class: "set-buttons" },
          h("button", { class: "btn secondary up", type: "button", "aria-label": `Move ${song.title} up`, disabled: i === 0, onclick: move(-1) }, "▲ Up"),
          h("button", { class: "btn secondary down", type: "button", "aria-label": `Move ${song.title} down`, disabled: i === ids.length - 1, onclick: move(1) }, "▼ Down"),
          h("button", { class: "btn secondary danger-text", type: "button", "aria-label": `Take ${song.title} out of this folder`, onclick: async () => {
            ids.splice(i, 1); await saveOrder(); draw(); toast(`“${song.title}” taken out of the folder (it's still in My Songs).`);
          } }, "✕ Take out"))));
    });
  }
  const startBtn = h("a", { class: "btn big gold", href: "#/folder/" + encodeURIComponent(folder.id), onclick: e => {
    e.preventDefault(); e.stopPropagation();
    if (ids.length) go("/song/" + encodeURIComponent(ids[0]) + "?f=" + encodeURIComponent(folder.id));
  } }, "▶ Start from the first song");
  const title = h("h1", { text: "🗂 " + folder.name });
  const s = screen("folder",
    backButton("Folders", "#/folders", true),
    title, count,
    h("div", { class: "btn-row folder-actions" },
      startBtn,
      h("a", { class: "btn big green", href: "#/folder/" + encodeURIComponent(folder.id) + "/add" }, "＋ Add songs"),
      orderBtn),
    list,
    h("div", { class: "song-end" },
      h("button", { class: "btn secondary", type: "button", onclick: async () => {
        const name = await askName("New name for the folder", folder.name, "Rename");
        if (!name) return;
        folder.name = name; folder.updated = Date.now(); await db.putFolder(folder);
        title.textContent = "🗂 " + name; toast("Renamed ✓");
      } }, "Rename folder"),
      h("button", { class: "btn secondary danger-text", type: "button", onclick: async () => {
        const ok = await confirmBox(`Delete the folder “${folder.name}”? The songs stay in My Songs.`, "Yes, delete the folder", "No, keep it");
        if (!ok) return;
        await db.deleteFolder(folder.id);
        go("/folders", true);
        toast(`Folder “${folder.name}” deleted.`);
      } }, "Delete folder")));
  draw();
  return s;
}

async function showFolderAdd(id, stale) {
  const folder = await db.getFolder(id);
  if (stale()) return;
  if (!folder) { go("/folders", true); return; }
  const chosen = new Set(folder.songIds);
  const input = h("input", { id: "fa", type: "search", class: "search-input", placeholder: "Find a song", autocomplete: "off", enterkeyhint: "search" });
  const list = h("ul", { class: "tiles pick-list" });
  const done = h("button", { class: "btn big green done-bar", type: "button", onclick: finish });

  async function toggle(sid) {
    if (chosen.has(sid)) { chosen.delete(sid); folder.songIds = folder.songIds.filter(x => x !== sid); }
    else { chosen.add(sid); folder.songIds = folder.songIds.concat(sid); }   // new songs go at the end
    folder.updated = Date.now();
    await db.putFolder(folder);
    draw();
  }
  function draw() {
    const inFolder = folder.songIds.filter(x => library.some(l => l.id === x)).length;
    done.textContent = `✓ Done (${inFolder} song${inFolder === 1 ? "" : "s"} in “${folder.name}”)`;
    list.textContent = "";
    const { byName, byWords } = findInLibrary(input.value);
    const songs = byName.concat(byWords);
    if (!library.length) list.append(h("li", { class: "empty" }, "There are no songs in My Songs yet. Add some songs first."));
    for (const song of songs) {
      const on = chosen.has(song.id);
      list.append(h("li", {}, h("button", {
        class: "tile pick" + (on ? " on" : ""), type: "button", role: "checkbox", "aria-checked": on ? "true" : "false",
        onclick: () => toggle(song.id),
      },
        h("span", { class: "tick", "aria-hidden": "true", text: on ? "✓" : "" }),
        h("span", { class: "set-text" },
          h("span", { class: "tile-title", text: song.title }),
          song.artist ? h("span", { class: "tile-artist", text: song.artist }) : null))));
    }
  }
  function finish() { goBack("/folder/" + encodeURIComponent(folder.id)); }
  input.addEventListener("input", draw);
  const s = screen("folder-add",
    backButton(folder.name, "#/folder/" + encodeURIComponent(folder.id), true),
    h("h1", { text: `Add songs to “${folder.name}”` }),
    h("p", { class: "field-help", text: "Press a song to tick it. Press it again to untick it. Ticked songs are added to the end of the folder." }),
    h("form", { class: "search-row", role: "search", onsubmit: e => { e.preventDefault(); input.blur(); } }, input),
    list, done);
  document.body.className = "has-done-bar";
  draw();
  return s;
}

// ---------- Screen: Help ----------

function showHelp() {
  const sec = (title, ...items) => h("section", { class: "panel" }, h("h2", { text: title }), h("ul", { class: "help-list" }, items.map(t => h("li", { text: t }))));
  return screen("help", backButton(),
    h("h1", { text: "How to use My Songs" }),
    sec("Finding a new song",
      "Press the gold “Add a new song” button and type the song's name (and the singer, if you know it).",
      "Press the right song in the list. Check it, then press the green “Save to My Songs”.",
      "Once saved, the song stays on the tablet, even without the internet."),
    sec("Reading along",
      "A− and A+ make the words smaller or bigger.",
      "“Start scrolling” moves the words up slowly by themselves. “Slower” and “Faster” change the speed. Tap the words to pause.",
      "The screen stays on while a song is open."),
    sec("Chords for guitar or bass",
      "Press “Chords” at the bottom of a song. Choose Guitar, Bass or Words only.",
      "Key changes the key up or down. Capo shows the shapes to play with a capo.",
      "If a song has no chords yet, press “Look up chords online” and pick a version marked Chords.",
      "On that page, press and hold on any words, choose “Select all”, then “Copy”. Come back and press “Paste”: My Songs keeps just the chords and words."),
    sec("Folders for gigs",
      "Press “Folders” at the top of the home screen, then “New folder” (for example Gig 01).",
      "Press “Add songs” and tick the songs. Use “Change the order” to move them up or down.",
      "Press “Start from the first song”. “Next ▶” and “◀ Previous” at the top move through the folder."),
    sec("Page-turner pedal",
      "A Bluetooth page-turner pedal works too: down/up turn the page, and right/left go to the next or previous song in a folder."));
}

// ---------- Screen: Settings ----------

let installPrompt = null;
// Redraw Settings only if he's still on it (a slow redraw mustn't cover the page he moved to).
function refreshSettings() { if (location.hash.startsWith("#/settings")) route(); }
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; });

async function showSettings(stale) {
  const safe = await db.isKeptSafe();
  if (stale()) return;

  const themeBtn = (value, label) => h("button", {
    class: "choice" + (settings.theme === value ? " on" : ""), type: "button", "aria-pressed": settings.theme === value ? "true" : "false",
    onclick: () => { settings.theme = value; saveSettings(); applyTheme(); refreshSettings(); },
  }, label);

  const sample = h("p", { class: "size-sample", text: "This is how big the words will be." });
  sample.style.fontSize = SIZES[settings.size] + "px";
  const sizeBtn = (d, label) => h("button", { class: "btn big secondary", type: "button", onclick: () => {
    settings.size = clamp(settings.size + d, 0, SIZES.length - 1); saveSettings(); sample.style.fontSize = SIZES[settings.size] + "px";
  } }, label);

  const fileIn = h("input", { type: "file", class: "vh", id: "restore" });
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await db.importLibrary(data);
      await loadLibrary();
      db.keepSafe();
      toast(`Backup loaded: ${r.added} new song${r.added === 1 ? "" : "s"}, ${r.updated} updated, ${r.folders} folder${r.folders === 1 ? "" : "s"}.`, 5000);
      refreshSettings();
    } catch (e) {
      console.warn("Backup not loaded:", e);
      toast("That file isn't a My Songs backup.", 5000);
    }
  });

  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const last = settings.lastBackup ? new Date(settings.lastBackup).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;

  const s = screen("settings",
    backButton(),
    h("h1", { text: "Settings" }),

    h("section", { class: "panel" },
      h("h2", { text: "Colours" }),
      h("div", { class: "choices" }, themeBtn("light", "Light"), themeBtn("dark", "Dark"), themeBtn("contrast", "Extra contrast"), themeBtn("auto", "Same as the tablet")),
      h("button", {
        class: "choice wide" + (settings.bold ? " on" : ""), type: "button", "aria-pressed": settings.bold ? "true" : "false",
        onclick: () => { settings.bold = !settings.bold; saveSettings(); applyTheme(); refreshSettings(); },
      }, settings.bold ? "Bold words: on" : "Bold words: off")),

    h("section", { class: "panel" },
      h("h2", { text: "Size of the words" }),
      sample,
      h("div", { class: "btn-row" }, sizeBtn(-1, "A− Smaller"), sizeBtn(1, "A+ Bigger"))),

    h("section", { class: "panel" },
      h("h2", { text: "Backup" }),
      h("p", { text: `There ${library.length === 1 ? "is 1 song" : `are ${library.length} songs`} in My Songs. They and your folders are kept on this tablet only, so it's worth saving a backup file now and then.` }),
      h("p", { class: "muted", text: last ? `Last backup: ${last}.` : "No backup saved yet." }),
      h("div", { class: "btn-row" },
        h("button", { class: "btn big gold", type: "button", onclick: backup, text: "Save a backup file" }),
        h("label", { class: "btn big secondary", for: "restore", text: "Load a backup file" }), fileIn),
      safe ? h("p", { class: "muted", text: "✓ The tablet has been asked to keep these songs safe." }) : null),

    h("section", { class: "panel" },
      h("h2", { text: "Home screen" }),
      standalone
        ? h("p", { text: "✓ My Songs is on the home screen." })
        : installPrompt
          ? h("button", { class: "btn big gold", type: "button", onclick: install, text: "Add My Songs to the home screen" })
          : h("div", {},
            h("p", { text: "In Chrome: press the ⋮ menu at the top right, then “Add to home screen” (or “Install app”)." }),
            h("p", { text: "In Samsung Internet: press the ≡ menu at the bottom, then “Add page to”, then “Home screen”." }))),

    h("section", { class: "panel" },
      h("h2", { text: "Updates" }),
      h("p", { text: "My Songs updates itself: close it (swipe it away) and open it again while on Wi-Fi to get the newest version." }),
      h("p", { class: "muted", text: "This is version " + VERSION + "." }),
      h("button", { class: "btn big secondary", type: "button", onclick: checkUpdates, text: "Check for updates now" })),

    h("section", { class: "panel about" },
      h("h2", { text: "About" }),
      h("p", {}, h("a", { href: "#/help", text: "How to use My Songs" })),
      h("p", { text: "Words are looked up from LRCLIB (lrclib.net) and lyrics.ovh, and saved on this tablet for reading along. Nothing is shared." })));

  async function checkUpdates() {
    toast("Checking…", 2000);
    try {
      const t = await (await fetch("js/app.js?check=" + Date.now(), { cache: "no-store" })).text();
      const live = (t.match(/const VERSION = "([^"]+)"/) || [])[1];
      if (!live) throw new Error("no version");
      if (live === VERSION) { toast("You have the newest version ✓"); return; }
      toast(`Updating to version ${live}…`, 4000);
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update().catch(() => {});
      setTimeout(() => location.reload(), 800);
    } catch {
      toast("Couldn't check just now. Make sure the tablet is on Wi-Fi.");
    }
  }

  async function backup() {
    const data = await db.exportLibrary();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const date = new Date().toISOString().slice(0, 10);
    const a = h("a", { href: URL.createObjectURL(blob), download: `my-songs-backup-${date}.json`, hidden: true }, "Backup file");
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    settings.lastBackup = Date.now(); saveSettings();
    toast("Backup saved to the Downloads folder.", 5000);
  }
  async function install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch { /* dismissed */ }
    installPrompt = null;
    refreshSettings();
  }
  return s;
}

// ---------- Start ----------

// Back/forward and any hash typed by hand. (Both events can fire for one step; route once.)
const onNav = () => { if (location.hash !== routedHash) route(); };
window.addEventListener("popstate", onNav);
window.addEventListener("hashchange", onNav);

(async () => {
  // Always start with the home screen as the first page, so Back never leaves the app by surprise.
  const start = location.hash && location.hash !== "#" && location.hash !== "#/" ? location.hash : null;
  history.replaceState({ depth: 0 }, "", "#/");
  if (start) history.pushState({ depth: 1 }, "", start);
  await loadLibrary();
  route();
})();

// Updates: the service worker fetches the newest app files whenever the app is opened online
// (falling back to the saved copy after a few seconds, or when offline). So closing the app and
// opening it again is all it takes to get a new version.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
    .then(reg => reg.update().catch(() => {}))
    .catch(e => console.warn("Offline support unavailable:", e));
}

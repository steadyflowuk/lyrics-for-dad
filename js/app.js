// My Songs: a big-print lyrics library for Dad's tablet.
import { renderSong, firstLine, plainWords, cleanLyrics } from "./template.js";
import * as db from "./db.js";
import { findSongs, fetchLyricsFor, LookupError } from "./online.js";

const VERSION = "1.1.0";
const main = document.getElementById("main");
const toastEl = document.getElementById("toast");

const SIZES = [22, 26, 30, 34, 38, 44, 50, 58, 66, 76];  // words size in pixels
const DEFAULT_SIZE = 4;
const SPEEDS = [0.1, 0.15, 0.2, 0.27, 0.35, 0.45, 0.6]; // auto-scroll, in lines per second
const DEFAULT_SPEED = 2;

// ---------- Settings ----------

const SETTINGS_KEY = "my-songs-settings";
const settings = Object.assign(
  { theme: "auto", size: DEFAULT_SIZE, speed: DEFAULT_SPEED, chords: true, lastBackup: 0 },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; } })()
);
settings.size = clamp(settings.size | 0, 0, SIZES.length - 1);
settings.speed = clamp(settings.speed | 0, 0, SPEEDS.length - 1);
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* full */ } }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === "light" || settings.theme === "dark") root.dataset.theme = settings.theme;
  else delete root.dataset.theme;
  const dark = settings.theme === "dark" || (settings.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#0C1322" : "#1E2B45");
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
    case "song": return showSong(parts[1], stale);
    case "new": return showEdit(null, params.get("q") || "", stale);
    case "edit": return showEdit(parts[1], "", stale);
    case "settings": return showSettings(stale);
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

  const s = screen("library",
    h("div", { class: "top" },
      h("h1", { class: "app-title" }, h("span", { class: "note", "aria-hidden": "true", text: "♪" }), " My Songs"),
      h("a", { class: "btn small secondary", href: "#/settings", text: "Settings" })),
    h("form", { class: "search-row", role: "search", onsubmit: e => { e.preventDefault(); submitSearch(); } },
      h("label", { for: "q", class: "vh", text: "Find a song" }), input, clear),
    addBtn, count, list);

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
    if (!trimmed) count.textContent = library.length === 1 ? "You have 1 song" : `You have ${library.length} songs`;
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

async function showSong(id, stale) {
  const song = id ? await db.getSong(id) : null;
  if (stale()) return;
  if (!song) { toast("That song isn't in My Songs any more."); go("/", true); return; }

  const sheet = h("article", { class: "song-sheet" + (settings.chords ? "" : " hide-chords") });
  const { hasChords } = renderSong(sheet, song);
  const setSize = () => sheet.style.setProperty("--lyric-size", SIZES[settings.size] + "px");
  setSize();

  const tb = (act, icon, label, extra = {}) => h("button", { class: "tb", type: "button", "data-act": act, ...extra },
    h("span", { class: "tb-icon", "aria-hidden": "true", text: icon }), h("span", { class: "tb-label", text: label }));

  const toolbar = h("nav", { class: "toolbar", "aria-label": "Song controls" },
    tb("smaller", "A−", "Smaller"),
    tb("bigger", "A+", "Bigger"),
    tb("scroll", "▶", "Start scrolling", { "aria-pressed": "false", class: "tb wide" }),
    tb("slower", "−", "Slower"),
    tb("faster", "+", "Faster"),
    hasChords ? tb("chords", "♯", settings.chords ? "Hide chords" : "Show chords") : null);

  const s = screen("song",
    h("div", { class: "song-top" }, backButton()),
    sheet,
    h("div", { class: "song-end" },
      h("p", { class: "end-mark", text: "— End of song —" }),
      h("a", { class: "btn secondary", href: "#/edit/" + encodeURIComponent(song.id), text: "Change the words or add chords" }),
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
      const next = clamp(settings.size + (act === "bigger" ? 1 : -1), 0, SIZES.length - 1);
      if (next === settings.size) { toast(act === "bigger" ? "That's the biggest size." : "That's the smallest size."); return; }
      settings.size = next; saveSettings();
      keepPlace(setSize);
      updateLimits();
    } else if (act === "scroll") {
      scroller ? stopScrolling() : startScrolling();
    } else if (act === "slower" || act === "faster") {
      const next = clamp(settings.speed + (act === "faster" ? 1 : -1), 0, SPEEDS.length - 1);
      if (next === settings.speed) { toast(act === "faster" ? "That's the fastest speed." : "That's the slowest speed."); return; }
      settings.speed = next; saveSettings();
      toast(`Scrolling speed ${settings.speed + 1} of ${SPEEDS.length}`, 1800);
      updateLimits();
    } else if (act === "chords") {
      settings.chords = !settings.chords; saveSettings();
      keepPlace(() => sheet.classList.toggle("hide-chords", !settings.chords));
      b.querySelector(".tb-label").textContent = settings.chords ? "Hide chords" : "Show chords";
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
      toast(`Backup loaded: ${r.added} new song${r.added === 1 ? "" : "s"}, ${r.updated} updated.`, 5000);
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
      h("div", { class: "choices" }, themeBtn("light", "Light"), themeBtn("dark", "Dark"), themeBtn("auto", "Same as the tablet"))),

    h("section", { class: "panel" },
      h("h2", { text: "Size of the words" }),
      sample,
      h("div", { class: "btn-row" }, sizeBtn(-1, "A− Smaller"), sizeBtn(1, "A+ Bigger"))),

    h("section", { class: "panel" },
      h("h2", { text: "Backup" }),
      h("p", { text: `There ${library.length === 1 ? "is 1 song" : `are ${library.length} songs`} in My Songs. They are kept on this tablet only, so it's worth saving a backup file now and then.` }),
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

    h("section", { class: "panel about" },
      h("h2", { text: "About" }),
      h("p", { text: "Words are looked up from LRCLIB (lrclib.net) and lyrics.ovh, and saved on this tablet for reading along. Nothing is shared." }),
      h("p", { class: "muted", text: "My Songs, version " + VERSION })));

  async function backup() {
    const data = await db.exportLibrary();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const date = new Date().toISOString().slice(0, 10);
    const a = h("a", { href: URL.createObjectURL(blob), download: `my-songs-backup-${date}.json` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
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

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(e => console.warn("Offline support unavailable:", e));
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // A new version arrived. Only refresh when he's not in the middle of a song.
    if (!hadController || reloaded || onSongScreen) return;
    reloaded = true;
    location.reload();
  });
}

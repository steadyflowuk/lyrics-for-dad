import { TAB_LINE, sheetDetails } from "./chords.js";

// The big-print song template: turns plain lyrics (with optional chords) into the on-screen layout.
// All song text is untrusted (it comes from the internet or a paste), so everything is built with
// textContent, never innerHTML.

const SECTION_WORDS = "verse|chorus|pre-chorus|pre chorus|prechorus|post-chorus|bridge|intro|outro|hook|refrain|interlude|solo|guitar solo|instrumental|tag|coda|breakdown|middle 8|middle eight|ending";
// "[Chorus]", "[Verse 2: Name]", "(Chorus x2)" — but not a sung line like "(Bridge over the water)".
const SECTION_BRACKETED = new RegExp(`^\\s*[\\[(]\\s*(${SECTION_WORDS})(\\s*\\d+)?\\s*(\\(?x\\s*\\d+\\)?)?\\s*(:[^\\])]{0,60})?\\s*[\\])]\\s*:?\\s*$`, "i");
const SECTION_PLAIN = new RegExp(`^\\s*(${SECTION_WORDS})(\\s*\\d+)?\\s*(\\(?x\\s*\\d+\\)?)?\\s*:?\\s*$`, "i");
const CHORUS_WORDS = /chorus|refrain|hook/i;

// A chord name such as G, Am, F#m7, Bbmaj7, Dsus4, C/G, Gadd9, E7b9, A5.
// Also: Gm(maj7), Asus4(2), C6/9, E7#9, A7alt, and a chord in brackets like (Em) for a passing chord.
const CHORD = /^[A-G](?:#|b|♯|♭)?(?:maj|min|mi|m|M|dim|aug|sus|add|\+|°|ø|Δ)?\d*(?:(?:sus|add|maj|dim|aug|b|#|\+|-|\/)\d+|\((?:add|maj|sus|b|#|\+|-)?\d+\)|alt)*(?:\/[A-G](?:#|b|♯|♭)?)?$/;
// Notes that sit on a chord line without making it a line of words: x2, N.C., |, (repeat), riff...
const CHORD_LINE_EXTRAS = /^(\|+|\/+|-+>?|\.{2,}|\*+|%|x\d+|\d+x|\(x?\d+x?\)|n\.?c\.?|riff\d?|repeat|hold|stop|break|tacet|let|ring|fade|end|etc\.?|[\[(][^\])\s]{1,12}[\])]|\(|\))$/i;
const INLINE_CHORD = /\[([^\]\s]{1,12})\]/g;

export function isChord(token) {
  return CHORD.test(String(token).replace(/^\((.+)\)$/, "$1").replace(/\*+$/, ""));
}

// A line made up only of chords, e.g. "G      C     D".
export function isChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  let chords = 0;
  for (const t of tokens) {
    if (isChord(t)) chords++;
    else if (!CHORD_LINE_EXTRAS.test(t)) return false;
  }
  return chords > 0;
}

export function sectionLabel(line) {
  if (SECTION_BRACKETED.test(line) || SECTION_PLAIN.test(line)) {
    // "[Verse 2: Ann & Bob]" -> "Verse 2" (the singers' names aren't needed on the page).
    return line.trim().replace(/^[\[(]\s*/, "").replace(/\s*[\])]\s*:?\s*$/, "").replace(/:.*$/, "").trim();
  }
  return null;
}

function hasInlineChords(line) {
  INLINE_CHORD.lastIndex = 0;
  let m;
  while ((m = INLINE_CHORD.exec(line))) if (isChord(m[1])) return true;
  return false;
}

// Tidy text that has come from a lyrics site or a paste.
export function cleanLyrics(text) {
  if (!text) return "";
  let t = String(text).replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/\t/g, "    ");
  t = t.replace(/^\s*Paroles de la chanson[^\n]*\n/i, ""); // added by lyrics.ovh
  t = t.replace(/^\s*\[(ar|ti|al|au|by|length|offset|re|ve|tool|#):[^\]\n]*\]\s*$/gim, ""); // synced-lyrics tags
  t = t.replace(/^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s?)+/gm, "");           // timestamps from synced lyrics
  t = t.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>\s?/g, "");                     // word-by-word timestamps
  const lines = t.split("\n").map(l => l.replace(/\s+$/, ""))
    .filter(l => !/^\s*\d*\s*Embed\s*$/i.test(l) && !/^\s*You might also like\s*$/i.test(l));
  const out = [];
  for (const l of lines) {
    if (!l.trim()) { if (out.length && out[out.length - 1] !== "") out.push(""); }
    else out.push(l);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// Lyrics from the internet sometimes arrive as one long wall of lines with no gaps, or with a
// gap after every single line. Both are hard to follow at a distance, so split them into verses,
// using lines that repeat as the chorus. (Text typed in by hand is left exactly as typed.)
export function tidyFetched(text) {
  const t = cleanLyrics(text);
  if (!t || t.split("\n").some(l => sectionLabel(l))) return t;
  const stanzas = t.split(/\n\n/);
  const lines = t.split("\n").filter(l => l.trim());
  const singles = stanzas.filter(s => !s.includes("\n")).length;
  const doubleSpaced = stanzas.length >= 6 && singles / stanzas.length > 0.6;
  const wall = stanzas.some(s => s.split("\n").length > 14);
  if (!doubleSpaced && !wall) return t;
  if (doubleSpaced) return groupLines(lines).map(b => b.join("\n")).join("\n\n");
  // Only break up the over-long verses; keep the gaps that were already there.
  return stanzas.map(s => {
    const ls = s.split("\n");
    return ls.length > 14 ? groupLines(ls).map(b => b.join("\n")).join("\n\n") : s;
  }).join("\n\n");
}

export function groupLines(lines) {
  const n = lines.length;
  const key = lines.map(l => norm(l));
  const taken = new Array(n).fill(false);
  const starts = new Map(); // start index -> length of a repeated run
  const free = (i, k) => { for (let x = i; x < i + k; x++) if (taken[x] || !key[x]) return false; return true; };
  const take = (i, k) => { for (let x = i; x < i + k; x++) taken[x] = true; starts.set(i, k); };
  // Longest repeated runs first (a chorus is usually 2–8 lines).
  for (let k = Math.min(8, Math.floor(n / 2)); k >= 2; k--) {
    for (let i = 0; i + k <= n; i++) {
      if (!free(i, k)) continue;
      const sig = key.slice(i, i + k).join("|");
      const repeats = [];
      for (let j = i + k; j + k <= n; j++) {
        if (free(j, k) && key.slice(j, j + k).join("|") === sig) { repeats.push(j); j += k - 1; }
      }
      if (repeats.length) { take(i, k); for (const j of repeats) take(j, k); }
    }
  }
  const blocks = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length <= 6) blocks.push(run);
    else {
      // Split long verses into fours; don't leave a lonely line at the end.
      for (let x = 0; x < run.length; x += 4) blocks.push(run.slice(x, x + 4));
      const last = blocks[blocks.length - 1];
      if (last.length === 1 && blocks.length > 1) { blocks.pop(); blocks[blocks.length - 1].push(...last); }
    }
    run = [];
  };
  for (let i = 0; i < n;) {
    if (starts.has(i)) { flush(); const k = starts.get(i); blocks.push(lines.slice(i, i + k)); i += k; }
    else { run.push(lines[i]); i++; }
  }
  flush();
  return blocks;
}

// "Select all" on a chords website copies the whole page: menus, ratings, comments, footer...
// Find the chord sheet inside it: the stretch of lines richest in chords (a "best stretch"
// search: chord lines and section names score points, other lines lose a point, so menus and
// comments fall away). Only used when there's plenty of page text around the sheet, so a
// sheet pasted on its own is left exactly as it is.
export function extractSheet(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const single = l => /^\s*[A-Z]\s*$/.test(l);
  const kinds = lines.map(l => {
    if (!l.trim()) return "_";
    if (TAB_LINE.test(l)) return "T";
    if (sectionLabel(l) || /^\s*\[[^\]\n]{1,30}\]\s*$/.test(l)) return "S";
    const lab = LABELLED_CHORDS.exec(l);
    if (isChordLine(l) || (lab && isChordLine(lab[2]))) return "C";
    if (hasInlineChords(l)) return "I";
    return "w";
  });
  // An A–Z list of single letters (site navigation) isn't chords.
  const near = (i, d) => { for (let j = i + d; j >= 0 && j < lines.length; j += d) if (lines[j].trim()) return j; return -1; };
  kinds.forEach((k, i) => {
    if (!single(lines[i])) return;
    const c = lines[i].trim().charCodeAt(0);
    for (const d of [-1, 1]) {
      const j = near(i, d);
      if (j >= 0 && single(lines[j]) && Math.abs(lines[j].trim().charCodeAt(0) - c) === 1) kinds[i] = "J";
    }
  });
  // Website buttons and labels next to the sheet ("PLAY" under each chord in the chord list, etc.)
  kinds.forEach((k, i) => { if (k !== "_" && isFurniture(lines[i])) kinds[i] = "F"; });
  const weight = (k, i) => {
    if (k === "C") return 2;
    if (k === "I") return 3;
    if (k === "S") return 2;
    if (k === "T") return 1;
    if (k === "J" || k === "F") return -2;
    if (k === "w") return i > 0 && kinds[i - 1] === "C" ? 1 : -1;   // words under a chord line belong
    return 0;
  };
  // The core: the stretch of lines richest in chords.
  let best = 0, a = -1, b = -1, sum = 0, start = 0;
  kinds.forEach((k, i) => {
    if (sum <= 0) { sum = 0; start = i; }
    sum += weight(k, i);
    if (sum > best) { best = sum; a = start; b = i; }
  });
  if (a < 0 || best < 6) return { text, removed: 0 };
  // Then widen it to the whole sheet: verses without chords, a closing riff, a note at the top...
  // everything up to the website's own buttons and labels on either side.
  const stop = i => kinds[i] === "F" || kinds[i] === "J";
  while (a > 0 && !stop(a - 1) && a - 1 >= 0) a--;
  while (b < lines.length - 1 && !stop(b + 1)) b++;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b].trim()) b--;
  const outside = lines.filter((l, i) => (i < a || i > b) && l.trim()).length;
  if (outside < 12) return { text, removed: 0 };    // looks like just the sheet: keep it all
  // Keep the details from the page's header (capo, tuning, key) as plain lines the app reads.
  const d = sheetDetails(lines.slice(0, a).join("\n"));
  const head = [];
  if (d.capo) head.push(`Capo: ${d.capo}`);
  if (d.tuning) head.push(`Tuning: ${d.tuning}`);
  if (d.key) head.push(`Key: ${d.key}`);
  return { text: head.concat(lines.slice(a, b + 1)).join("\n"), removed: outside };
}

// Buttons, labels and counters that chords websites put around the sheet.
const FURNITURE = new Set(("print|create correction|report bad tab|rating|please rate this tab|please, rate this tab|close ad|x|" +
  "view in app|transpose|listen|pdf|download pdf|simplify|autoscroll|open official|backing track|check out the tab|save|edit|" +
  "add to favorites|strumming|play|chords|guitar|ukulele|piano|versions|official|share|reply|install|font|show all|" +
  "related tabs|comments|top tabs|more versions|related songs|&").split("|"));
function isFurniture(line) {
  const t = line.trim().toLowerCase().replace(/\s+/g, " ");
  if (FURNITURE.has(t)) return true;
  if (/^[\d.,&★/ ]+$/.test(t)) return true;                                   // 4.8, 6,730, 1 & 2 &
  if (/^(last update|last edit|rating|author|difficulty|tuning|key|capo|speed|official version|ver \d)\b/.test(t)) return true;
  if (/\b(views|saves|rates|comments|contributor)\b/.test(t) && /\d/.test(t)) return true;
  if (/^\d+ ?bpm$/.test(t)) return true;
  return false;
}

// Lyrics text with chords removed, used for searching and for spotting repeated choruses.
export function plainWords(text) {
  const chordLines = countChordLines(text) >= 2;
  return String(text || "").split("\n")
    .filter(l => !(chordLines && isChordLine(l)))
    .map(l => l.replace(INLINE_CHORD, (m, c) => (isChord(c) ? "" : m)))
    .join("\n");
}

function countChordLines(text) {
  let n = 0;
  for (const l of String(text || "").split("\n")) if (l.trim() && isChordLine(l)) n++;
  return n;
}

// The first chord in the song (used to decide sharps or flats after a key change).
export function firstChord(text) {
  for (const l of String(text || "").split("\n")) {
    INLINE_CHORD.lastIndex = 0;
    let m;
    while ((m = INLINE_CHORD.exec(l))) if (isChord(m[1])) return m[1];
    const lab = LABELLED_CHORDS.exec(l);
    const tokens = (lab ? lab[2] : l).trim().split(/\s+/);
    if (isChordLine(lab ? lab[2] : l)) for (const t of tokens) if (isChord(t)) return t;
  }
  return null;
}

export function songHasChords(text) {
  const lines = String(text || "").split("\n");
  return countChordLines(text) >= 2 || lines.some(hasInlineChords) ||
    lines.some(l => { const lab = LABELLED_CHORDS.exec(l); return lab && isChordLine(lab[2]); });
}

const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Split the song into blocks: { label, chorus, lines[] }.
export function parseSong(text) {
  const cleaned = cleanLyrics(text);
  const chordLines = countChordLines(cleaned) >= 2;
  const blocks = [];
  let cur = null;
  const start = label => { cur = { label, chorus: !!(label && CHORUS_WORDS.test(label)), lines: [] }; blocks.push(cur); };
  for (const line of cleaned.split("\n")) {
    if (!line.trim()) { cur = null; continue; }
    const label = sectionLabel(line);
    if (label) { start(label); continue; }
    if (!cur) start(null);
    cur.lines.push(line);
  }
  const kept = blocks.filter(b => b.lines.length || b.label);

  // No labels given: a block of two or more lines that appears more than once is the chorus.
  if (!kept.some(b => b.label)) {
    const key = b => norm(b.lines.filter(l => !(chordLines && isChordLine(l)))
      .map(l => l.replace(INLINE_CHORD, (m, c) => (isChord(c) ? "" : m))).join(" "));
    const counts = new Map();
    for (const b of kept) if (b.lines.length >= 2) counts.set(key(b), (counts.get(key(b)) || 0) + 1);
    for (const b of kept) if (b.lines.length >= 2 && counts.get(key(b)) > 1 && key(b)) { b.chorus = true; b.label = "Chorus"; }
  }
  return { blocks: kept, chordLines };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// One lyric line with chords written inline: "[G]Amazing [C]grace".
function inlineChordLine(line, show = c => c) {
  const div = el("div", "line has-chords");
  const parts = [];
  let last = 0, m, pending = null;
  INLINE_CHORD.lastIndex = 0;
  while ((m = INLINE_CHORD.exec(line))) {
    if (!isChord(m[1])) continue;
    parts.push({ chord: pending, text: line.slice(last, m.index) });
    pending = m[1];
    last = m.index + m[0].length;
  }
  parts.push({ chord: pending, text: line.slice(last) });
  for (const p of parts) {
    if (!p.chord) { if (p.text) div.append(document.createTextNode(p.text)); continue; }
    // A chord that lands on a gap belongs to the next word.
    const lead = p.text.match(/^\s*/)[0];
    if (lead && p.text.trim()) {
      const prev = div.lastChild && div.lastChild.textContent;
      if (!prev || !/\s$/.test(prev)) div.append(document.createTextNode(" "));   // one space, not two
      p.text = p.text.slice(lead.length);
    }
    // The chord sits over the first word only, so long lines can still wrap.
    // (The space after the word stays outside the chord box, or it would be lost.)
    const mm = p.text.match(/^(\S*)([\s\S]*)$/);
    const first = mm[1] || " ", rest = mm[2] || "";
    const seg = el("span", "seg");
    const ch = el("span", "chord", show(p.chord));
    ch.dataset.chord = p.chord;
    seg.append(ch, el("span", "w", first));
    div.append(seg);
    if (rest) div.append(document.createTextNode(rest));
  }
  return div;
}

// "G     C" above "Here are the words" -> "[G]Here are[C] the words", by column.
export function mergeChordLine(chordLine, lyric) {
  const marks = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(chordLine))) if (isChord(m[0])) marks.push({ at: m.index, chord: m[0] });
  let out = lyric;
  const longest = marks.length ? marks[marks.length - 1].at : 0;
  if (out.length < longest) out = out.padEnd(longest, " ");
  for (let k = marks.length - 1; k >= 0; k--) {
    const { at, chord } = marks[k];
    out = out.slice(0, at) + "[" + chord + "]" + out.slice(at);
  }
  return out;
}

const LABELLED_CHORDS = /^\s*[\[(]?\s*(intro|outro|interlude|solo|instrumental|riff|ending|bridge|verse|chorus|pre-chorus)[^:\])]{0,12}[\])]?\s*:?\s+(.+)$/i;

// Build the template for a song into `root`.
// `show` turns a written chord into what's displayed (changed key, capo, or the bass note).
export function renderSong(root, song, { show = c => c } = {}) {
  const used = [];
  const seen = new Set();
  const note = c => { const d = show(c); if (d && !seen.has(d)) { seen.add(d); used.push(d); } return d; };
  const chordLineEl = line => {
    const out = el("div", "chordline");
    line.trim().split(/\s+/).forEach((t, k) => {
      if (k) out.append(document.createTextNode("   "));
      if (isChord(t)) { const c = el("span", "chord-inline", note(t)); c.dataset.chord = t; out.append(c); }
      else out.append(document.createTextNode(t));
    });
    return out;
  };
  root.textContent = "";
  const head = el("header", "song-head");
  head.append(el("h1", "song-title", song.title || "Untitled song"));
  if (song.artist) head.append(el("p", "song-artist", song.artist));
  root.append(head);

  const { blocks, chordLines } = parseSong(song.lyrics);
  const body = el("div", "song-body");
  if (!blocks.length) body.append(el("p", "empty-words", "There are no words saved for this song yet."));
  for (const b of blocks) {
    const sec = el("section", "block" + (b.chorus ? " chorus" : ""));
    if (b.label) sec.append(el("p", "block-label", b.label));
    for (let i = 0; i < b.lines.length; i++) {
      const line = b.lines[i];
      if (TAB_LINE.test(line)) {
        // Guitar/bass tab: keep the columns lined up.
        const tab = [line];
        while (i + 1 < b.lines.length && TAB_LINE.test(b.lines[i + 1])) tab.push(b.lines[++i]);
        sec.append(el("pre", "tabnotes", tab.join("\n")));
        continue;
      }
      const lab = LABELLED_CHORDS.exec(line);
      if (lab && isChordLine(lab[2])) {
        // "Intro: G C D G"
        const row = el("div", "chordline-row");
        row.append(el("span", "chord-label", lab[1].replace(/^./, x => x.toUpperCase()) + ":"), chordLineEl(lab[2]));
        sec.append(row);
        continue;
      }
      if (chordLines && isChordLine(line)) {
        const next = b.lines[i + 1];
        if (next != null && !isChordLine(next) && !hasInlineChords(next) && !TAB_LINE.test(next) && !sectionLabel(next)) {
          // Chords written above the words: place each chord over the right word.
          const merged = mergeChordLine(line, next);
          sec.append(inlineChordLine(merged, note));
          i++;
        } else {
          sec.append(chordLineEl(line));
        }
      } else if (hasInlineChords(line)) {
        sec.append(inlineChordLine(line, note));
      } else {
        sec.append(el("div", "line", line));
      }
    }
    body.append(sec);
  }
  root.append(body);
  return { hasChords: songHasChords(song.lyrics), chords: used };
}

// The first proper line of words, shown under search results so songs can be told apart.
export function firstLine(text) {
  const { blocks, chordLines } = parseSong(text);
  for (const b of blocks) for (const l of b.lines) {
    if (chordLines && isChordLine(l)) continue;
    const words = l.replace(INLINE_CHORD, (m, c) => (isChord(c) ? "" : m)).trim();
    if (words) return words;
  }
  return "";
}

// Chords: names, changing key, capo, guitar shapes and bass notes.
// Everything is worked out on the tablet, so it works offline.

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const CHORD_RE = /^([A-G])(#|b|♯|♭)?(.*?)(?:\/([A-G])(#|b|♯|♭)?)?$/;

function noteIndex(letter, acc) {
  let n = LETTER[letter];
  if (acc === "#" || acc === "♯") n += 1;
  if (acc === "b" || acc === "♭") n -= 1;
  return (n + 12) % 12;
}

export function parseChord(name) {
  const m = CHORD_RE.exec(String(name || "").trim());
  if (!m) return null;
  return {
    root: noteIndex(m[1], m[2]),
    quality: m[3] || "",
    bass: m[4] ? noteIndex(m[4], m[5]) : null,
    flat: m[2] === "b" || m[2] === "♭" || m[5] === "b" || m[5] === "♭",
  };
}

export function noteName(n, flats) {
  return (flats ? FLATS : SHARPS)[((n % 12) + 12) % 12];
}

// Keys that are normally written with flats.
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]);   // F Bb Eb Ab Db Gb
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);   // Dm Gm Cm Fm Bbm Ebm
export function prefersFlats(keyChord) {
  const c = parseChord(keyChord);
  if (!c) return false;
  const minor = /^(m|min|mi|-)(?!aj)/.test(c.quality);
  return minor ? FLAT_MINOR.has(c.root) : FLAT_MAJOR.has(c.root);
}

// Move a chord up or down by some semitones. With no change, the chord is shown exactly as written.
export function transposeChord(name, shift, flats) {
  if (!shift) return name;
  const c = parseChord(name);
  if (!c) return name;
  const root = noteName(c.root + shift, flats);
  const bass = c.bass == null ? "" : "/" + noteName(c.bass + shift, flats);
  return root + c.quality + bass;
}

// The note a bass player plays for a chord: the bass note after a slash, otherwise the root.
export function bassNote(name, shift = 0, flats = false) {
  const c = parseChord(name);
  if (!c) return name;
  return noteName((c.bass != null ? c.bass : c.root) + shift, flats || (!shift && c.flat));
}

// ---------- Guitar shapes ----------
// Frets from the low E string to the high E string; null = don't play that string.

function chordType(q) {
  q = q.replace(/[()]/g, "");
  if (q === "" || q === "maj" || q === "M") return "maj";
  if (/^(maj7|M7|Δ7?|maj9|M9)/.test(q)) return "maj7";
  if (/^(m7b5|ø|min7b5|-7b5)/.test(q)) return "m7b5";
  if (/^(dim|°|o)/.test(q)) return "dim";
  if (/^(aug|\+)/.test(q)) return "aug";
  if (/^(m|min|mi|-)(7|9|11|13)/.test(q)) return "m7";
  if (/^(m|min|mi|-)6/.test(q)) return "m";
  if (/^(m|min|mi|-)/.test(q)) return "m";
  if (/^7?sus2/.test(q)) return "sus2";
  if (/^7?sus/.test(q)) return "sus4";
  if (/^(add9|add2|2)$/.test(q)) return "add9";
  if (/^9/.test(q)) return "9";
  if (/^(7|11|13)/.test(q)) return "7";
  if (/^6/.test(q)) return "6";
  if (/^5/.test(q)) return "5";
  if (/^add/.test(q)) return "maj";
  return "maj";
}

const _ = null;
const OPEN = {
  "C:maj": [_, 3, 2, 0, 1, 0], "C:7": [_, 3, 2, 3, 1, 0], "C:maj7": [_, 3, 2, 0, 0, 0], "C:add9": [_, 3, 2, 0, 3, 0],
  "C:sus4": [_, 3, 3, 0, 1, 1], "C:sus2": [_, 3, 0, 0, 1, 3], "C:6": [_, 3, 2, 2, 1, 0], "C:aug": [_, 3, 2, 1, 1, 0],
  "D:maj": [_, _, 0, 2, 3, 2], "D:m": [_, _, 0, 2, 3, 1], "D:7": [_, _, 0, 2, 1, 2], "D:maj7": [_, _, 0, 2, 2, 2],
  "D:m7": [_, _, 0, 2, 1, 1], "D:sus4": [_, _, 0, 2, 3, 3], "D:sus2": [_, _, 0, 2, 3, 0], "D:6": [_, _, 0, 2, 0, 2],
  "D:5": [_, _, 0, 2, 3, _], "D:dim": [_, _, 0, 1, 3, 1],
  "E:maj": [0, 2, 2, 1, 0, 0], "E:m": [0, 2, 2, 0, 0, 0], "E:7": [0, 2, 0, 1, 0, 0], "E:m7": [0, 2, 0, 0, 0, 0],
  "E:maj7": [0, 2, 1, 1, 0, 0], "E:sus4": [0, 2, 2, 2, 0, 0], "E:5": [0, 2, 2, _, _, _], "E:add9": [0, 2, 2, 1, 0, 2],
  "E:6": [0, 2, 2, 1, 2, 0], "E:9": [0, 2, 0, 1, 0, 2],
  "F:maj": [1, 3, 3, 2, 1, 1], "F:m": [1, 3, 3, 1, 1, 1], "F:7": [1, 3, 1, 2, 1, 1], "F:maj7": [_, _, 3, 2, 1, 0],
  "F:m7": [1, 3, 1, 1, 1, 1], "F:5": [1, 3, 3, _, _, _],
  "G:maj": [3, 2, 0, 0, 0, 3], "G:7": [3, 2, 0, 0, 0, 1], "G:maj7": [3, 2, 0, 0, 0, 2], "G:sus4": [3, _, 0, 0, 1, 3],
  "G:6": [3, 2, 0, 0, 0, 0], "G:add9": [3, _, 0, 2, 0, 3], "G:5": [3, 5, 5, _, _, _],
  "A:maj": [_, 0, 2, 2, 2, 0], "A:m": [_, 0, 2, 2, 1, 0], "A:7": [_, 0, 2, 0, 2, 0], "A:m7": [_, 0, 2, 0, 1, 0],
  "A:maj7": [_, 0, 2, 1, 2, 0], "A:sus4": [_, 0, 2, 2, 3, 0], "A:sus2": [_, 0, 2, 2, 0, 0], "A:6": [_, 0, 2, 2, 2, 2],
  "A:add9": [_, 0, 2, 4, 2, 0], "A:5": [_, 0, 2, 2, _, _], "A:dim": [_, 0, 1, 2, 1, _], "A:9": [_, 0, 2, 4, 2, 3],
  "B:7": [_, 2, 1, 2, 0, 2], "B:m7": [_, 2, 0, 2, 0, 2],
};
// Common chords with a different bass note.
const SLASH = {
  "G/B": [_, 2, 0, 0, 0, 3], "C/G": [3, 3, 2, 0, 1, 0], "D/F#": [2, _, 0, 2, 3, 2], "C/E": [0, 3, 2, 0, 1, 0],
  "F/C": [_, 3, 3, 2, 1, 1], "Am/G": [3, 0, 2, 2, 1, 0], "G/F#": [2, 2, 0, 0, 0, 3], "D/A": [_, 0, 0, 2, 3, 2],
  "C/B": [_, 2, 2, 0, 1, 0], "Em/D": [_, _, 0, 0, 0, 0], "A/E": [0, 0, 2, 2, 2, 0], "G/D": [_, _, 0, 0, 0, 3],
  "F/A": [_, 0, 3, 2, 1, 1], "D/C": [_, 3, 0, 2, 3, 2], "Am/E": [0, 0, 2, 2, 1, 0], "E/G#": [4, 2, 2, 1, 0, 0],
};
// Moveable shapes: root on the low E string ("E shape") or on the A string ("A shape").
const E_SHAPE = {
  maj: [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, _, 1, 1, 0, _], sus4: [0, 2, 2, 2, 0, 0], 5: [0, 2, 2, _, _, _],
};
const A_SHAPE = {
  maj: [_, 0, 2, 2, 2, 0], m: [_, 0, 2, 2, 1, 0], 7: [_, 0, 2, 0, 2, 0], m7: [_, 0, 2, 0, 1, 0],
  maj7: [_, 0, 2, 1, 2, 0], sus2: [_, 0, 2, 2, 0, 0], sus4: [_, 0, 2, 2, 3, 0], 6: [_, 0, 2, 2, 2, 2],
  add9: [_, 0, 2, 4, 2, 0], 9: [_, 0, -1, 0, 0, 0], dim: [_, 0, 1, 2, 1, _], m7b5: [_, 0, 1, 0, 1, _],
  aug: [_, 0, 3, 2, 2, _], 5: [_, 0, 2, 2, _, _],
};
const FALLBACK = { add9: "maj", 6: "maj", 9: "7", dim: "m", m7b5: "m", aug: "maj", sus2: "maj", sus4: "maj" };

export function guitarShape(name) {
  const c = parseChord(name);
  if (!c) return null;
  const type = chordType(c.quality);
  const rootName = SHARPS[c.root];
  if (c.bass != null) {
    const slash = SLASH[rootName + (type === "m" ? "m" : type === "maj" ? "" : "?") + "/" + SHARPS[c.bass]];
    if (slash) return { frets: slash, barre: null };
  }
  const f = (c.root - 4 + 12) % 12;  // fret of the root on the low E string
  const a = (c.root - 9 + 12) % 12;  // ... and on the A string
  // The exact chord if there's a shape for it (open first, then barre); otherwise the nearest simpler chord.
  for (let t = type; t; t = FALLBACK[t]) {
    const open = OPEN[rootName + ":" + t];
    if (open) return { frets: open, barre: null };
    const opts = [];
    if (E_SHAPE[t]) opts.push({ base: f, shape: E_SHAPE[t] });
    if (A_SHAPE[t]) opts.push({ base: a, shape: A_SHAPE[t] });
    if (!opts.length) continue;
    opts.sort((x, y) => x.base - y.base);
    const { base, shape } = opts[0];
    return { frets: shape.map(o => (o == null ? null : o + base)), barre: base || null };
  }
  return null;
}

// Where to play a note on a bass guitar (E A D G strings): the lowest easy spot.
const BASS_STRINGS = [["E", 4], ["A", 9], ["D", 2], ["G", 7]];
export function bassPosition(note) {
  const c = parseChord(note);
  if (!c) return null;
  for (let i = 0; i < BASS_STRINGS.length; i++) {
    const fret = (c.root - BASS_STRINGS[i][1] + 12) % 12;
    if (fret <= 4) return { string: i, stringName: BASS_STRINGS[i][0], fret };
  }
  return { string: 0, stringName: "E", fret: (c.root - 4 + 12) % 12 };
}

// ---------- Diagrams (SVG) ----------

const svgNS = "http://www.w3.org/2000/svg";
function s(tag, attrs, text) {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function box(strings, frets, base, label) {
  const W = 120, H = strings === 4 ? 162 : 150, left = 22, top = 28, gap = (W - left * 2) / (strings - 1), rowH = 22, rows = 5;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "diagram", role: "img", "aria-label": label });
  if (base <= 1) svg.append(s("rect", { x: left - 2, y: top - 5, width: gap * (strings - 1) + 4, height: 5, class: "nut" }));
  else svg.append(s("text", { x: 4, y: top + rowH / 2 + 5, class: "fret-no" }, String(base)));
  for (let i = 0; i < strings; i++) svg.append(s("line", { x1: left + i * gap, y1: top, x2: left + i * gap, y2: top + rows * rowH, class: "string" }));
  for (let r = 0; r <= rows; r++) svg.append(s("line", { x1: left, y1: top + r * rowH, x2: left + (strings - 1) * gap, y2: top + r * rowH, class: "fret" }));
  return { svg, left, top, gap, rowH };
}

export function guitarDiagram(name) {
  const shape = guitarShape(name);
  if (!shape) return null;
  const fretted = shape.frets.filter(f => f != null && f > 0);
  const max = Math.max(0, ...fretted);
  const base = max <= 5 ? 1 : Math.min(...fretted);
  const { svg, left, top, gap, rowH } = box(6, shape.frets, base, `${name} guitar chord`);
  if (shape.barre && shape.barre === base && base > 0) {
    const on = shape.frets.map((f, i) => (f === base ? i : -1)).filter(i => i >= 0);
    if (on.length >= 2) {
      const y = top + (base - base + 0.5) * rowH;
      svg.append(s("rect", { x: left + on[0] * gap - 7, y: y - 7, width: (on[on.length - 1] - on[0]) * gap + 14, height: 14, rx: 7, class: "dot" }));
    }
  }
  shape.frets.forEach((f, i) => {
    const x = left + i * gap;
    if (f == null) svg.append(s("text", { x, y: top - 10, class: "mark", "text-anchor": "middle" }, "×"));
    else if (f === 0) svg.append(s("circle", { cx: x, cy: top - 14, r: 5, class: "open" }));
    else svg.append(s("circle", { cx: x, cy: top + (f - base + 0.5) * rowH, r: 7.5, class: "dot" }));
  });
  return svg;
}

export function bassDiagram(note) {
  const pos = bassPosition(note);
  if (!pos) return null;
  const { svg, left, top, gap, rowH } = box(4, null, 1, `${note} on bass: ${pos.stringName} string, ${pos.fret ? "fret " + pos.fret : "open"}`);
  ["E", "A", "D", "G"].forEach((n, i) => svg.append(s("text", { x: left + i * gap, y: top + 5 * rowH + 18, class: "string-name", "text-anchor": "middle" }, n)));
  const x = left + pos.string * gap;
  if (pos.fret === 0) svg.append(s("circle", { cx: x, cy: top - 14, r: 6, class: "dot" }));
  else svg.append(s("circle", { cx: x, cy: top + (pos.fret - 0.5) * rowH, r: 8, class: "dot" }));
  return svg;
}

// ---------- Chord sheets pasted from websites ----------

// Tidy a chord sheet copied from a chords website, and pick up "Capo 2" if it says so.
// Header lines the app shows anyway (song name, capo, tuning, key, difficulty...) are dropped.
export function cleanChordSheet(text, title = "") {
  let t = String(text || "").replace(/\r\n?/g, "\n");
  t = t.replace(/\[\/?ch\]/g, "").replace(/\[\/?tab\]/g, "");
  let capo = 0;
  const lines = t.split("\n");
  const simple = x => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const name = simple(title);
  const out = [];
  lines.forEach((line, i) => {
    const m = /^\s*capo\b[^\d\n]{0,14}(\d{1,2})(?!\d)/i.exec(line);
    if (m && i < 30) { if (!capo) capo = Math.min(11, parseInt(m[1], 10)); return; }
    if (i < 30 && /^\s*(no capo\b|capo\s*:?\s*(none|no)\b|(tuning|key|difficulty|author|strumming|strumming pattern|tabbed by|chords by|bpm|tempo)\s*:)[^\n]{0,60}$/i.test(line)) return;
    if (i < 5 && name && simple(line).startsWith(name) && simple(line).length < name.length + 40) return;
    out.push(line);
  });
  return { text: out.join("\n"), capo };
}

export const TAB_LINE = /^\s*[eBGDAEbgdaE]?\s*\|[-\d|hpbrsvx\/\\~().^*=<> ]{6,}$/;

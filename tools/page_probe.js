// Live check of the "Select all → Copy" chord-sheet finder against a real chords web page.
// Open a chords page in a browser, then in its console (or via the browser tool):
//   const p = await import("https://cdn.jsdelivr.net/gh/steadyflowuk/lyrics-for-dad@<commit>/tools/page_probe.js");
//   p.run()
// It compares what My Songs would keep with the page's own chord sheet (its <pre> block) and reports
// what was lost or wrongly kept. Sung lines are never printed, only counted, so nothing is copied.
import { extractSheet, cleanLyrics, isChordLine, isChord, sectionLabel } from "../js/template.js";
import * as Ch from "../js/chords.js";
const { cleanChordSheet, TAB_LINE } = Ch;

const lyricLike = l => /[a-z]{3,}/.test(l) && !isChordLine(l) && !TAB_LINE.test(l) && !sectionLabel(l);
const show = l => (lyricLike(l) ? `«sung line, ${l.trim().length} chars»` : l.trim().slice(0, 60));

const simple = x => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function onPurpose(l, title) {
  return /^\s*(capo|no capo|tuning|key|difficulty|author|strumming|tabbed by|chords by|bpm|tempo)\b/i.test(l) || (title && simple(l).startsWith(simple(title)));
}

export function run(title = document.title.replace(/ (chords|tab).*$/i, "")) {
  const pres = [...document.querySelectorAll("pre")].sort((a, b) => b.innerText.length - a.innerText.length);
  if (!pres.length) return { error: "no chord sheet on this page" };
  const pre = pres[0];
  const page = document.body.innerText;
  const r = extractSheet(page);
  const details = Ch.sheetDetails ? Ch.sheetDetails(page) : null;
  const kept = cleanLyrics(cleanChordSheet(r.text, title).text).split("\n").filter(l => l.trim());
  const want = cleanLyrics(pre.innerText).split("\n").filter(l => l.trim());
  const keptSet = new Set(kept.map(l => l.trim())), wantSet = new Set(want.map(l => l.trim()));
  const missing = want.map((l, i) => [l, i]).filter(([l]) => !keptSet.has(l.trim()));
  const extra = kept.filter(l => !wantSet.has(l.trim()));
  // Chord names the website marks as chords that My Songs doesn't recognise.
  const marked = [...pre.querySelectorAll("span")].map(s => s.textContent.trim()).filter(t => /^[A-H][^\s]{0,12}$/.test(t));
  const unknown = [...new Set(marked.filter(t => !isChord(t)))];
  // Lines the website shows as chord lines that My Songs wouldn't treat as chords.
  const chordLines = want.filter(l => [...l.matchAll(/\S+/g)].some(m => isChord(m[0])));
  const notChord = chordLines.filter(l => !isChordLine(l) && !lyricLike(l)).map(l => l.trim().slice(0, 60));
  // Details in the page header a player needs (capo, tuning, key).
  const header = page.slice(0, page.indexOf(pre.innerText.split("\n").find(l => l.trim()) || "~~"))
    .split("\n").filter(l => /^\s*(capo|tuning|key)\b/i.test(l)).map(l => l.trim());
  return {
    page: location.pathname.split("/").slice(-1)[0],
    sheetLines: want.length, kept: kept.length, removed: r.removed,
    // Lines dropped on purpose (song name, capo/tuning/key, which the app shows anyway) are listed apart.
    missing: missing.filter(([l]) => !onPurpose(l, title)).map(([l, i]) => `${i}/${want.length}: ${show(l)}`).slice(0, 12),
    droppedOnPurpose: missing.filter(([l]) => onPurpose(l, title)).map(([l]) => show(l)).slice(0, 6),
    extra: extra.map(l => show(l)).slice(0, 8),
    unknownChords: unknown.slice(0, 12),
    chordLinesNotRecognised: notChord.slice(0, 8),
    header, details,
  };
}

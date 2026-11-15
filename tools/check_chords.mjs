// Musical check of every guitar shape and bass position the app can show.
// Works out the notes each shape actually sounds (standard tuning) and checks they spell the chord.
// Run: node tools/check_chords.mjs   (exit code 1 if anything is wrong)
import { guitarShape, bassPosition, transposeChord, bassNote, parseChord } from "../js/chords.js";

const ROOTS = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"];
const TUNING = [4, 9, 2, 7, 11, 4]; // E A D G B E
// For each kind of chord: the notes allowed (semitones above the root). All must be played
// except the 5th (often left out on guitar); nothing outside the set may be played.
const KINDS = {
  "": [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], sus2: [0, 2, 7],
  dim: [0, 3, 6], aug: [0, 4, 8], 6: [0, 4, 7, 9], add9: [0, 2, 4, 7], 9: [0, 2, 4, 7, 10], 5: [0, 7], m7b5: [0, 3, 6, 10],
  "m(maj7)": [0, 3, 7, 11],
};
const problems = [];
let checked = 0;
for (const r of ROOTS) {
  for (const [q, allowed] of Object.entries(KINDS)) {
    const name = r + q;
    const shape = guitarShape(name);
    checked++;
    if (!shape) { problems.push(`${name}: no shape`); continue; }
    const f = shape.frets;
    if (f.length !== 6) { problems.push(`${name}: not 6 strings`); continue; }
    const played = f.map((x, i) => (x == null ? null : (TUNING[i] + x) % 12));
    const root = parseChord(name).root;
    const rel = new Set(played.filter(x => x != null).map(n => (n - root + 12) % 12));
    const missing = allowed.filter(n => !rel.has(n) && !(n === 7 && q !== "5"));
    const wrong = [...rel].filter(n => !allowed.includes(n));
    // A 9th chord may leave out the 3rd or 5th on guitar; others must have everything listed.
    const tolerated = q === "9" ? missing.filter(n => n !== 4) : missing;
    if (tolerated.length) problems.push(`${name} ${f.map(x => x ?? "x").join("")}: missing ${tolerated.join(",")}`);
    if (wrong.length) problems.push(`${name} ${f.map(x => x ?? "x").join("")}: has wrong note ${wrong.join(",")}`);
    if (f.some(x => x != null && (x < 0 || x > 15))) problems.push(`${name}: fret out of range`);
    const fretted = f.filter(x => x != null && x > 0);
    if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 4) problems.push(`${name}: stretch too wide`);
    if (f.filter(x => x != null).length < 3) problems.push(`${name}: fewer than 3 strings`);
  }
}
// Fancy chords get a simpler shape, and the app says so (it never claims a wrong shape is exact).
for (const [name, exact] of [["G", true], ["Am7", true], ["Gm(maj7)", true], ["C6/9", false], ["E7#9", false], ["A13", false], ["Asus4(2)", false]]) {
  checked++;
  const s = guitarShape(name);
  if (!s || s.exact !== exact) problems.push(`${name}: shape should be marked ${exact ? "exact" : "simpler stand-in"}`);
}
// Slash chords: the lowest note played should be the bass note.
for (const name of ["G/B", "C/G", "D/F#", "C/E", "F/C", "Am/G", "G/F#", "D/A", "A/E", "E/G#"]) {
  const s = guitarShape(name);
  checked++;
  const low = s.frets.findIndex(x => x != null);
  const note = (TUNING[low] + s.frets[low]) % 12;
  if (note !== parseChord(name).bass) problems.push(`${name}: lowest note isn't the bass note`);
}
// Bass positions: right note, easy fret.
const STR = [4, 9, 2, 7];
for (const r of ROOTS) {
  const p = bassPosition(r);
  checked++;
  if ((STR[p.string] + p.fret) % 12 !== parseChord(r).root) problems.push(`bass ${r}: wrong note`);
  if (p.fret > 4) problems.push(`bass ${r}: fret ${p.fret} is a stretch`);
}
// Key changes come back round, and bass notes follow slash chords.
const eq = (a, b, what) => { checked++; if (a !== b) problems.push(`${what}: got ${a}, expected ${b}`); };
eq(transposeChord("G", 2, false), "A", "G up 2");
eq(transposeChord("C/E", 1, true), "Db/F", "C/E up 1 (flats)");
eq(transposeChord("F#m7", -1, false), "Fm7", "F#m7 down 1");
eq(transposeChord("Bb", 0, false), "Bb", "unchanged spelling");
eq(bassNote("C/G"), "G", "bass of C/G");
eq(bassNote("Am7", 2, false), "B", "bass of Am7 up 2");
for (let n = -11; n <= 11; n++) for (const c of ["C", "Am", "F#7", "Bbmaj7"]) eq(parseChord(transposeChord(transposeChord(c, n, false), -n, false)).root, parseChord(c).root, `${c} there and back ${n}`);

if (problems.length) { console.log(problems.join("\n")); console.log(`\n${problems.length} chord problem(s) in ${checked} checks`); process.exit(1); }
console.log(`Chords: all ${checked} checks passed`);

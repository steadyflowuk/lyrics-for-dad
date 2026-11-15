# My Songs

A big-print song lyrics app for Dad's tablet (Samsung Galaxy Tab A7), added to the home screen like an app.

- **Find a song:** type the name, pick the right one, press Save. Words are looked up from
  [LRCLIB](https://lrclib.net) first, then [lyrics.ovh](https://lyrics.ovh). If neither has it,
  the words can be pasted in by hand.
- **My Songs:** everything saved stays on the tablet and works without the internet.
  Search by song name, singer, or a line from the words.
- **Reading along:** large Atkinson Hyperlegible text, choruses highlighted, Bigger/Smaller,
  hands-free auto-scroll, screen kept awake, light and dark colours.
- **Chords:** add chords in `[G]square brackets` before a word, or on their own line above the words.
  They can be shown or hidden.
- **Backup:** Settings → Save a backup file / Load a backup file.

## Privacy and copyright

This repository contains **no lyrics**. Songs are fetched on the tablet and stored only in that
browser's own storage, as a personal copy for reading along. Nothing is uploaded.

## Development

Plain HTML, CSS and JavaScript, no build step. Hosted on GitHub Pages.

- Bump `VERSION` in `sw.js` whenever an app file changes, so the tablet picks up the update.
- Tests (headless Chromium at Tab A7 size, lyrics services faked with made-up words):
  `python3 tools/test_app.py` (add `--shots` for screenshots in `tools/shots/`, which is git-ignored).

Colours follow Aleph to Omega (navy, sage, gold, beige). Font: Atkinson Hyperlegible by the
Braille Institute, SIL Open Font License 1.1 (see `assets/fonts/OFL.txt`).

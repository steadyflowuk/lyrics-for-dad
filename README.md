# My Songs

A big-print song lyrics app for Dad's tablet (Samsung Galaxy Tab A7), added to the home screen like an app.

- **Find a song:** type the name, pick the right one, press Save. Words are looked up from
  [LRCLIB](https://lrclib.net) first, then [lyrics.ovh](https://lyrics.ovh). If neither has it,
  the words can be pasted in by hand.
- **My Songs:** everything saved stays on the tablet and works without the internet.
  Search by song name, singer, or a line from the words.
- **Reading along:** large Atkinson Hyperlegible text, choruses highlighted, Bigger/Smaller,
  hands-free auto-scroll, screen kept awake, light and dark colours.
- **Chords for guitar or bass:** press “Look up chords online”, copy the chord sheet, then “Paste the chords”.
  The Chords button switches between Guitar (chord names + shapes), Bass (bass notes + where to play
  them) and Words only, changes key, and sets a capo (“Capo 2” on a pasted sheet is picked up).
  Chords can also be typed as `[G]` before a word, or on their own line above the words.
- **Folders for gigs:** make a folder (Gig 01…), tick songs into it, put them in order with Up/Down,
  then “Start from the first song” and use Next/Previous. A Bluetooth page-turner pedal works too.
- **Easy to use:** big buttons and text, Help page, Extra-contrast colours and Bold words, recently
  played songs, and the tablet's Back button always does the expected thing.
- **Updates:** close the app and open it again (online) to get the newest version.
- **Backup:** Settings → Save a backup file / Load a backup file.

## Privacy and copyright

This repository contains **no lyrics**. Songs are fetched on the tablet and stored only in that
browser's own storage, as a personal copy for reading along. Nothing is uploaded.

## Development

Plain HTML, CSS and JavaScript, no build step. Hosted on GitHub Pages.

- **Brief checker:** `python3 tools/check_brief.py --fix` checks every requirement in
  `tools/BRIEF.md` (journeys through every feature, accessibility with axe-core, contrast in every
  colour scheme, button and text sizes, fit on tablet/phone, offline, update-on-reopen, privacy,
  musically correct chord shapes) and fixes what it can by itself (offline file list, version
  numbers). Report: `tools/check_report.md`. `--quick` skips the longer regression run.
- Regression tests on their own: `python3 tools/test_app.py` (`--shots` saves screenshots).
- Chord shapes on their own: `node tools/check_chords.mjs`.

Colours follow Aleph to Omega (navy, sage, gold, beige). Font: Atkinson Hyperlegible by the
Braille Institute, SIL Open Font License 1.1 (see `assets/fonts/OFL.txt`).

# My Songs — the brief

What the app must do, as agreed. `tools/check_brief.py` checks every line below (the ID in
brackets is the check's name in the report).

## Who it's for
Dad, around 60, poor eyesight, not confident with technology. Plays guitar and bass and sings.
Uses a Samsung Galaxy Tab A7, usually sitting down with the tablet upright (portrait).

## Getting the app
- [INSTALL] Sits on the tablet's home screen like an app (web app with manifest, icons, full screen).
- [NO-LOGIN] Works without being signed in to anything (no Claude, no accounts).
- [UPDATE] Updates itself: closing the app (swiping it away) and opening it again online loads the newest version.
- [OFFLINE] Saved songs open without the internet.

## Finding and keeping songs
- [FIND] He types a song name; the app finds the words online and shows likely matches, best first.
- [TEMPLATE] Words go straight into the standard big-print template (title, singer, verses, chorus highlighted) with no other input needed.
- [SAVE] One button saves the song to his library for good.
- [FALLBACK] If a song can't be found, the words can be pasted in by hand.
- [LIBRARY] His library lists every saved song and can be searched by name, singer or a line of the words.

## Reading along
- [BIG-TEXT] Large, very readable text by default, with Bigger/Smaller.
- [SCROLL] Hands-free auto-scroll with speed control; the screen stays awake.
- [THEMES] Light, dark and extra-contrast colours.

## Chords
- [CHORDS] Songs can carry chords (pasted from a chords website, with a one-tap "Look up chords" link).
- [INSTRUMENT] Switch between Guitar (chord names + shapes), Bass (bass notes + where to play them) and words only.
- [KEY-CAPO] Change key up/down; capo for guitar; a "Capo 2" on a pasted sheet is picked up.
- [CHORD-SHAPES] Every guitar shape and bass position is musically correct (`tools/check_chords.mjs`).

## Folders for gigs
- [FOLDERS] Folders such as "Gig 01" hold a chosen set of songs from the library.
- [ORDER] The songs in a folder are in order, and the order can be changed (Up/Down), songs taken out.
- [GIG-MODE] Opening a folder plays through it: Previous / Next and "Next song" at the end.

## Easy to use
- [SIMPLE] Every screen has a big, labelled way back; the tablet's Back button behaves the same.
- [TAP-SIZE] Every button is at least 48×48 pixels.
- [CONTRAST] Text meets WCAG AA contrast in every colour scheme.
- [A11Y] No serious accessibility problems (axe-core) on any screen.
- [FIT] Nothing runs off the side of the screen (tablet upright and sideways, and a phone).
- [PEDAL] A Bluetooth page-turner pedal turns pages and moves through a folder.
- [HELP] A plain-English help page.

## Safe and tidy
- [NO-ERRORS] No errors in the browser console.
- [PRIVACY] The app only talks to its own site and the two lyrics services; nothing else.
- [NO-LYRICS-IN-REPO] The code repository contains no lyrics; songs stay on the tablet.
- [BACKUP] Songs and folders can be saved to a backup file and loaded back.
- [STATIC] Code is valid, the offline file list is complete, and the version number is bumped when files change.

"""The brief checker: runs My Songs through every requirement in tools/BRIEF.md.

    python3 tools/check_brief.py           # check everything, write tools/check_report.md
    python3 tools/check_brief.py --fix     # also fix what can be fixed mechanically, then check:
                                           #   offline file list in sw.js, version numbers
    python3 tools/check_brief.py --quick   # skip the long regression run (tools/test_app.py)

Exit code 0 only if every requirement passes. Lyrics services are faked with made-up words,
so no real lyrics are needed (or stored). Needs Python Playwright + Chromium, Node and Pillow.
"""
import json, os, re, subprocess, sys, shutil, tempfile, threading, functools, http.server, datetime, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import test_app as T  # faked lyrics services and made-up songs
from playwright.sync_api import sync_playwright, expect

FIX = "--fix" in sys.argv
QUICK = "--quick" in sys.argv
AXE = open(os.path.join(ROOT, "tools", "vendor", "axe.min.js"), encoding="utf-8").read()
APP_FILES = ["index.html", "manifest.webmanifest", "sw.js", "css", "js", "assets"]

results = {}   # id -> list of (ok, detail)
fixed = []

def rec(rid, ok, detail=""):
    results.setdefault(rid, []).append((bool(ok), detail))
    print(("  ok   " if ok else "  FAIL ") + f"[{rid}] {detail}")
    return ok

def sh(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)

# ---------------------------------------------------------------- static checks (+ fixes)

def static_checks():
    print("Static checks")
    # Valid JavaScript
    for f in sorted(os.listdir(os.path.join(ROOT, "js"))) + ["../sw.js"]:
        if not f.endswith(".js"): continue
        r = sh(["node", "--check", os.path.join("js", f)])
        rec("STATIC", r.returncode == 0, f"{f} is valid JavaScript" + ("" if r.returncode == 0 else ": " + r.stderr.strip()[:200]))

    # Offline file list in sw.js covers every app file
    sw_path = os.path.join(ROOT, "sw.js")
    sw = open(sw_path).read()
    m = re.search(r"const FILES = \[(.*?)\];", sw, re.S)
    listed = set(re.findall(r'"([^"]+)"', m.group(1)))
    need = {"./", "index.html", "manifest.webmanifest", "assets/icons/icon-192.png", "assets/icons/favicon-64.png"}
    for d, ext in (("css", ".css"), ("js", ".js"), ("assets/fonts", ".woff")):
        for f in os.listdir(os.path.join(ROOT, d)):
            if f.endswith(ext): need.add(f"{d}/{f}")
    missing = sorted(need - listed)
    gone = sorted(f for f in listed - need if f != "./" and not os.path.exists(os.path.join(ROOT, f)))
    if (missing or gone) and FIX:
        files = sorted((listed | need) - set(gone), key=lambda x: (x != "./", x))
        body = "\n".join(f'  "{f}",' for f in files)
        sw = sw[:m.start(1)] + "\n" + body + "\n" + sw[m.end(1):]
        open(sw_path, "w").write(sw)
        fixed.append(f"sw.js offline list: added {missing or 'nothing'}, removed {gone or 'nothing'}")
        missing, gone = [], []
    rec("STATIC", not missing and not gone, "offline file list complete" + (f" (missing {missing}, stale {gone})" if missing or gone else ""))

    # Version numbers bumped when app files differ from what's deployed (origin/main)
    sh(["git", "fetch", "-q", "--depth=20", "origin", "main"])
    changed = sh(["git", "diff", "--name-only", "origin/main", "--"] + APP_FILES).stdout.split()
    changed = [c for c in changed if c]
    def versions(text_sw, text_app):
        a = re.search(r'const VERSION = "([^"]+)"', text_sw); b = re.search(r'const VERSION = "([^"]+)"', text_app)
        return (a and a.group(1)), (b and b.group(1))
    here = versions(open(sw_path).read(), open(os.path.join(ROOT, "js/app.js")).read())
    there_sw = sh(["git", "show", "origin/main:sw.js"]).stdout
    there_app = sh(["git", "show", "origin/main:js/app.js"]).stdout
    there = versions(there_sw, there_app) if there_sw else (None, None)
    need_bump = bool(changed) and (here[0] == there[0] or here[1] == there[1])
    if need_bump and FIX:
        today = datetime.date.today().isoformat()
        old = here[0] or ""
        n = int(old.split(".")[-1]) + 1 if old.startswith(today) else 1
        new_sw = f"{today}.{n}"
        if here[0] == there[0]:
            s = open(sw_path).read().replace(f'const VERSION = "{here[0]}"', f'const VERSION = "{new_sw}"', 1)
            open(sw_path, "w").write(s)
            fixed.append(f"sw.js version {here[0]} -> {new_sw}")
        if here[1] == there[1]:
            p = here[1].split(".")
            p[-1] = str(int(p[-1]) + 1)
            new_app = ".".join(p)
            ap = os.path.join(ROOT, "js/app.js")
            s = open(ap).read().replace(f'const VERSION = "{here[1]}"', f'const VERSION = "{new_app}"', 1)
            open(ap, "w").write(s)
            fixed.append(f"app version {here[1]} -> {new_app}")
        need_bump = False
    rec("STATIC", not need_bump, f"version numbers bumped for changed files ({len(changed)} changed)" if changed else "no app changes since the live version")

    # Installable: manifest and icons
    print("Install")
    man = json.load(open(os.path.join(ROOT, "manifest.webmanifest")))
    rec("INSTALL", man.get("display") == "standalone" and man.get("start_url") and man.get("name") and man.get("short_name"),
        "manifest: name, short name, start page, full screen")
    try:
        from PIL import Image
        sizes = {}
        for ic in man.get("icons", []):
            path = os.path.join(ROOT, ic["src"])
            w, h = Image.open(path).size
            sizes[ic["sizes"]] = sizes.get(ic["sizes"], []) + [(w, h, ic.get("purpose", "any"))]
            rec("INSTALL", ic["sizes"] == f"{w}x{h}", f"icon {ic['src']} is really {w}x{h}")
        rec("INSTALL", "192x192" in sizes and "512x512" in sizes and any(p == "maskable" for v in sizes.values() for _, _, p in v),
            "icons 192, 512 and a maskable icon present")
    except Exception as e:
        rec("INSTALL", False, f"icons: {e}")

    # Privacy: only these outside sites are ever contacted or linked
    print("Privacy and repository")
    allowed = {"lrclib.net", "api.lyrics.ovh", "www.ultimate-guitar.com"}
    hosts = set()
    for f in ["index.html", "sw.js", "manifest.webmanifest"] + [os.path.join("js", x) for x in os.listdir(os.path.join(ROOT, "js"))] + [os.path.join("css", x) for x in os.listdir(os.path.join(ROOT, "css"))]:
        txt = open(os.path.join(ROOT, f), encoding="utf-8").read()
        txt = re.sub(r"//[^\n]*|/\*.*?\*/", "", txt, flags=re.S)  # ignore comments
        hosts |= set(re.findall(r"https?://([a-z0-9.-]+)", txt))
    hosts.discard("www.w3.org")  # SVG namespace, not a request
    rec("PRIVACY", hosts <= allowed, f"code only refers to {sorted(hosts)}")

    # No lyrics or backups in the repository
    tracked = sh(["git", "ls-files"]).stdout.split("\n") + sh(["git", "ls-files", "--others", "--exclude-standard"]).stdout.split("\n")
    bad = [t for t in tracked if re.search(r"(backup.*\.json|\.lrc$|lyrics.*\.(txt|json)$)", t, re.I)]
    rec("NO-LYRICS-IN-REPO", not bad, "no song files or backups in the repository" + (f": {bad}" if bad else ""))

    # Chord shapes are musically right
    print("Chords")
    r = sh(["node", os.path.join("tools", "check_chords.mjs")])
    rec("CHORD-SHAPES", r.returncode == 0, r.stdout.strip().split("\n")[-1])

# ---------------------------------------------------------------- browser journeys

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_head(self):
        # Like GitHub Pages' content-based ETags: never answer "not modified" for a changed file.
        # (Python's server compares times to the second, which misses edits made within a second.)
        del self.headers["If-Modified-Since"]
        return super().send_head()
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

def serve(directory, port):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=directory))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

CHORD_SHEET = """Sunny Road - The Test Band
Capo: 2nd fret

[Intro]
[ch]G[/ch]  [ch]C[/ch]  [ch]G[/ch]  [ch]D[/ch]

[Verse 1]
[ch]G[/ch]                [ch]C[/ch]
Morning light upon the water
[ch]Em[/ch]               [ch]D/F#[/ch]
Walking slow along the shore

[Chorus]
[ch]C[/ch]               [ch]G[/ch]
Sing it out, the road is sunny
[ch]Am7[/ch]             [ch]D[/ch]
Sing it out, the day is long

[tab]e|-----0-----2-----3-----|
B|---1-----3-----0-------|[/tab]
"""

# What "Select all → Copy" on a chords website gives: menus, the sheet, comments, an A–Z list, footer.
# (Website furniture modelled on a real chords page; the song and words are made up.)
WHOLE_PAGE = "\n".join(
    ["Tabs", "Courses", "Songbooks", "Articles", "Forums", "Pro+", "Search", "EN", "Install",
     "Long Song Chords by Endless", "12,345 views1,234 saves15 comments", "Author: someone [a] 12 contributorDifficulty: novice",
     "Download PDF", "Save", "Edit", "Autoscroll", "Speed: 0.2", "Transpose", "Backing track", "Capo: 3rd fret", ""]
    + CHORD_SHEET.replace("Sunny Road - The Test Band\nCapo: 2nd fret\n", "").replace("[tab]", "").replace("[/tab]", "").replace("[ch]", "").replace("[/ch]", "").split("\n")
    + ["", "Last update: Mar 3, 2021", "X", "Rating", "4.8", "Please rate this tab", "15 comments",
       "Great tab, really easy to follow and sounds just like the record, thanks so much for posting this one",
       "Does anyone know the strumming for the chorus?", "Reply", "G", "C", "D", "Em", "Am7", "D/F#", ""]
    + list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    + ["discover", "About UG", "Site Rules", "Terms of Service", "Privacy Policy", "© 2026", "All rights reserved", "GET SPECIAL OFFER"])

# A made-up sheet with everything a player needs, in the awkward places real sheets put it.
# The sheet's own introduction: credits, website, notes, a chord-shape list, dividers. None of it is wanted.
SHEET_INTRO = [
    "Test Band - Long Song from their album Made Up",
    "Transcribed by someone (XYZ)",
    "Visit my website at http://www.example.tk for more tabs, chords,",
    "and more!!!",
    "This is transcribed to be easier to play, so it may not be in",
    "the right key.",
    "(Guitar tuning: Eb, Ab, Db, Gb, Bb, Eb - half a step down)",
    "Strum: D DU UDU",
    "CHORDS USED:",
    "",
    "G (320033) or (355433)",
    "D  (xx0232)",
    "Am7   x02010",
    "F#m - 244222",
    "-----------------------------",
    "",
]
GIG_SHEET = SHEET_INTRO + [
    "[Intro]",
    "e|-----0-----2-----3-----|",
    "Eb|----1-----3-----0------|",
    "Bb|--0---0-------------0--|",
    "",
    "[Verse 1]",
    "Spoken softly at the start",
    "G                 C",
    "Morning light upon the water",
    "(Em)        D/F#        Gm(maj7)",
    "Walking slow along the shore",
    "1  2  3    1  2 & 3 &",
    "",
    "[Chorus]",
    "C       G      Am7     D   (x2)",
    "Sing it out, the road is sunny",
    "Key: A",
    "Cadd9           Asus4(2)",
    "Sing it out, the day is long",
    "",
    "[Verse 2]",
    "Paper boats and painted windows",
    "Old guitar beside the door",
    "",
    "G   D   C  D",
    "(No lyrics)",
    "=========",
    "",
    "[Outro]",
    "G  C  G  D  N.C.",
    "Carry on, carry on",
    "Carry on home",
    "-----------------------------",
    "That's it, hope you enjoy it! Please rate",
]
PHONE_PAGE = "\n".join(
    ["Rating: ★ 4.8 / 5 (6,730)", "Difficulty: Beginner", "Tuning: Eb Ab Db Gb Bb Eb", "Key: D", "Author: someone",
     "Last edit: Aug 6, 2026", "Add to favorites", "CHORDS", "GUITAR", "G", "PLAY", "C", "PLAY", "D", "PLAY", "VIEW IN APP",
     "STRUMMING", "125 bpm", "1", "&", "2", "&", "3", "&", "4", "&", "VIEW IN APP", "TRANSPOSE", "LISTEN", "PDF", ""]
    + GIG_SHEET + ["", "X", "Print", "Report Bad Tab", "Please rate this tab", "6,730", "VERSIONS", "Official", "9,388", "Ver 1",
                   "Great tab, thanks!", "Reply"] + list("ABCDEFGHIJKLMNOPQRSTUVWXYZ"))
TABLET_PAGE = "\n".join(
    ["Tabs", "Courses", "Search", "Wall Song Chords by The Test Band", "1,234 views55 saves3 comments",
     "Author: someone [a] 12 contributorDifficulty: novice", "Download PDF", "Save", "Edit", "Autoscroll", "Speed: 0.2",
     "Transpose", "Open Official", "Backing track", "Check out the tab", "Tuning: Eb Ab Db Gb Bb EbKey: GCapo: ", "3rd fret", ""]
    + GIG_SHEET + ["X", "", "Print", "Create correction", "Report bad tab", "Last update: Aug 7, 2026", "Rating", "4.8",
                   "6,730 rates", "Please, rate this tab", "Close ad", "Chords", "Guitar", "G", "C", "D", "Em",
                   "Great tab, really easy to follow and sounds just like the record", "Reply", "discover", "About UG", "© 2026"])

CONTRAST_JS = r"""() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  };
  const bad = [];
  let n = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el || el.closest('svg, [hidden], .toast, [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('.disabled, :disabled, [aria-disabled="true"], .limit')) continue;
    let fg = parse(cs.color); const bg = bgOf(el); fg = blend(fg, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    n++;
    if (ratio < need) bad.push(`${t.textContent.trim().slice(0, 30)} (${ratio.toFixed(2)}:1, needs ${need})`);
  }
  return { n, bad: [...new Set(bad)].slice(0, 8) };
}"""

TAPS_JS = r"""() => {
  const bad = [];
  let n = 0;
  for (const el of document.querySelectorAll('a[href], button, input, textarea, select, summary, label.btn, [role="tab"], [role="checkbox"]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || el.closest('[hidden]') || el.classList.contains('vh')) continue;
    const inline = el.tagName === 'A' && !el.classList.contains('btn') && !el.classList.contains('tile') && !el.classList.contains('tab') && !el.classList.contains('set-row') && el.closest('p, li');
    const min = inline ? 24 : 48;
    n++;
    if (r.width < min - 0.5 || r.height < min - 0.5) bad.push(`${(el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 25)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { n, bad: bad.slice(0, 8) };
}"""

TEXT_JS = r"""() => {
  const small = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement; if (!walker.currentNode.textContent.trim() || !el || el.closest('svg, .vh, [hidden], .toast')) continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const s = parseFloat(getComputedStyle(el).fontSize);
    if (s < 16) small.push(`${walker.currentNode.textContent.trim().slice(0, 20)} ${s}px`);
  }
  return [...new Set(small)].slice(0, 6);
}"""

def journeys():
    srv = T.serve()
    BASE = T.BASE
    errors, hosts = [], set()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 800, "height": 1280}, device_scale_factor=1.5, has_touch=True,
                                  service_workers="allow", accept_downloads=True)
        page = ctx.new_page()
        page.on("console", lambda m: m.type == "error" and "status of 404" not in m.text and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: hosts.add(re.sub(r"^https?://([^/:]+).*$", r"\1", r.url)))
        T.fake_routes(page)
        page.add_init_script("window.__wake = 0; Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__wake++; return { release: async () => {}, addEventListener() {} }; } }, configurable: true });")

        def add_song(q):
            page.goto(BASE + "#/find?q=" + q)
            page.locator(".result").first.click()
            page.locator(".preview-bar .save").click()
            page.wait_for_url("**#/song/*")
            expect(page.locator(".toolbar")).to_be_visible()

        print("Finding and saving")
        page.goto(BASE)
        rec("INSTALL", page.evaluate("!!document.querySelector('link[rel=manifest]')"), "page links the manifest")
        for q in ["sunny%20road", "long", "wall%20song"]:
            add_song(q)
        rec("SAVE", True, "three songs found and saved with one button each")
        rec("SCROLL", page.evaluate("window.__wake") >= 1, "screen kept awake on a song")
        size = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.song-sheet')).fontSize)")
        rec("BIG-TEXT", size >= 34, f"words start at {size}px")
        page.goto(BASE)
        expect(page.locator(".tile")).to_have_count(3)
        page.fill("#q", "paper boats")
        rec("LIBRARY", page.locator(".tile").count() >= 1, "library searchable by a line of the words")
        page.click(".btn.clear")

        print("Folders")
        page.click(".tab >> text=Folders")
        expect(page.locator(".welcome")).to_contain_text("No folders yet")
        page.click("text=New folder")
        rec("FOLDERS", page.input_value(".modal input") == "Gig 01", "new folder suggests the name Gig 01")
        page.click(".modal >> text=Make folder")
        page.wait_for_url("**#/folder/*")
        folder_url = page.url
        page.click("text=Add songs")
        expect(page.locator(".pick").first).to_be_visible()
        for name in ["Sunny Road", "Wall Song", "Long Song"]:
            page.locator(".pick", has_text=name).click()
            expect(page.locator(".pick.on", has_text=name)).to_be_visible()
        rec("FOLDERS", "3 songs" in page.locator(".done-bar").inner_text(), "ticked three songs into Gig 01")
        page.click(".done-bar")
        page.wait_for_url(folder_url)
        order = lambda: page.locator(".set-list .tile-title").all_inner_texts()
        expect(page.locator(".set-list .tile-title")).to_have_count(3)
        rec("ORDER", order() == ["Sunny Road", "Wall Song", "Long Song"], f"songs kept in the order chosen: {order()}")
        page.click("text=Change the order")
        page.click('button[aria-label="Move Long Song up"]')
        expect(page.locator(".set-list .tile-title").nth(1)).to_have_text("Long Song")
        page.click('button[aria-label="Take Wall Song out of this folder"]')
        expect(page.locator(".set-list .tile-title")).to_have_count(2)
        page.click("text=Finished changing the order")
        page.reload()
        expect(page.locator(".set-list .tile-title")).to_have_count(2)
        rec("ORDER", order() == ["Sunny Road", "Long Song"], f"moved up, taken out, and remembered after reopening: {order()}")

        print("Gig mode")
        page.click("text=Start from the first song")
        page.wait_for_url("**#/song/*")
        expect(page.locator(".folder-pos")).to_have_text("1 of 2")
        rec("GIG-MODE", page.locator(".next-song").inner_text().startswith("Next song: Long Song"), "end of song offers the next song")
        page.click(".folder-nav >> text=Next")
        expect(page.locator(".folder-pos")).to_have_text("2 of 2")
        rec("GIG-MODE", page.locator(".song-title").inner_text() == "Long Song", "Next goes to the second song")
        rec("GIG-MODE", page.locator(".folder-nav .disabled", has_text="Next").count() == 1, "Next is greyed out on the last song")
        page.click(".folder-nav >> text=Previous")
        expect(page.locator(".folder-pos")).to_have_text("1 of 2")
        rec("SIMPLE", "Gig 01" in page.locator(".song-top a.back").inner_text(), "the back button names the folder")

        print("Page-turner pedal")
        page.keyboard.press("ArrowRight")
        expect(page.locator(".folder-pos")).to_have_text("2 of 2")
        rec("PEDAL", True, "right pedal goes to the next song")
        page.keyboard.press("ArrowLeft")
        expect(page.locator(".folder-pos")).to_have_text("1 of 2")
        rec("PEDAL", True, "left pedal goes back a song")
        page.goto(BASE + "#/")
        page.locator(".tile", has_text="Long Song").click()
        expect(page.locator(".song-title")).to_have_text("Long Song")
        y0 = page.evaluate("scrollY"); page.keyboard.press("PageDown"); page.wait_for_timeout(900)
        rec("PEDAL", page.evaluate("scrollY") > y0 + 200, "page-down pedal turns the page")
        page.go_back()
        page.goto(folder_url)
        page.locator(".set-row").first.click()
        page.wait_for_url("**#/song/*")
        page.go_back()
        page.wait_for_url(folder_url)
        rec("SIMPLE", page.locator(".set-list").count() == 1, "tablet Back from a folder song returns to the folder")

        print("Add to a folder from a song")
        page.goto(BASE + "#/")
        page.locator(".tile", has_text="Wall Song").click()
        page.wait_for_url("**#/song/*")
        page.click("text=Add to a folder")
        page.click(".modal >> text=Gig 01")
        expect(page.locator("#toast")).to_contain_text("Added to")
        page.goto(folder_url)
        expect(page.locator(".set-list .tile-title")).to_have_count(3)
        rec("FOLDERS", order()[-1] == "Wall Song", "a song added from its own page goes to the end of the folder")

        print("Backup with folders")
        page.goto(BASE + "#/settings")
        with page.expect_download() as dl:
            page.click("text=Save a backup file")
        data = json.load(open(dl.value.path()))
        rec("BACKUP", len(data.get("folders", [])) == 1 and len(data["folders"][0]["songIds"]) == 3, "backup includes the folder and its order")
        page.goto(folder_url)
        page.click("text=Delete folder")
        page.click("text=Yes, delete the folder")
        page.wait_for_url("**#/folders")
        page.goto(BASE + "#/settings")
        page.set_input_files("#restore", dl.value.path())
        expect(page.locator("#toast")).to_contain_text("1 folder")
        page.goto(folder_url)
        expect(page.locator(".set-list .tile-title")).to_have_count(3)
        rec("BACKUP", order() == ["Sunny Road", "Long Song", "Wall Song"], "folder restored from the backup in order")

        print("Chords")
        page.goto(BASE + "#/")
        page.locator(".tile", has_text="Sunny Road").click()
        page.wait_for_url("**#/song/*")
        song_url = page.url.split("?")[0]
        page.click('[data-act="chords"]')
        link = page.locator(".modal a", has_text="Look up chords online").get_attribute("href")
        rec("CHORDS", link.startswith("https://www.ultimate-guitar.com/search.php") and "Sunny" in link, "Look up chords opens a chords search for this song")
        page.click(".modal >> text=Paste the chords")
        page.wait_for_url("**#/chords/*")
        page.fill("#pc", "Just some words\nwith no chords at all")
        page.click("button:has-text('Save the chords')")
        rec("CHORDS", "No chords were found" in page.locator(".form-msg").inner_text(), "pasting words without chords is caught")
        page.fill("#pc", CHORD_SHEET)
        page.click("button:has-text('Save the chords')")
        page.wait_for_url(song_url)
        expect(page.locator(".chord").first).to_be_visible()
        chords = lambda: [c for c in page.locator(".chord:visible, .chord-inline:visible").all_inner_texts()]
        rec("CHORDS", chords()[:4] == ["G", "C", "G", "D"], f"pasted chords shown over the words: {chords()[:6]}")
        rec("KEY-CAPO", "Capo 2" in page.locator(".chord-info").inner_text(), "“Capo: 2nd fret” on the sheet picked up")
        rec("INSTRUMENT", page.locator(".shape").count() >= 5, f"guitar shapes shown for each chord ({page.locator('.shape').count()})")
        rec("CHORDS", page.locator("pre.tabnotes").count() == 1, "guitar tab kept lined up")
        page.click('[data-act="chords"]')
        page.click(".modal >> text=+ Higher"); page.click(".modal >> text=+ Higher")
        page.click(".modal >> text=Done")
        rec("KEY-CAPO", chords()[0] == "A" and "Up 2" in page.locator(".chord-info").inner_text(), f"key up 2 turns G into A: {chords()[:3]}")
        page.click('[data-act="chords"]')
        page.locator(".modal .stepper", has_text="Capo").locator("button", has_text="−").click()
        page.locator(".modal .stepper", has_text="Capo").locator("button", has_text="−").click()
        page.click(".modal >> text=Done")
        rec("KEY-CAPO", chords()[0] == "B" and "No capo" in page.locator(".chord-info").inner_text(), f"without the capo the shapes move up (G→B): {chords()[:3]}")
        page.click('[data-act="chords"]')
        page.click(".modal >> text=Bass")
        page.click(".modal >> text=Done")
        bass = chords()
        rec("INSTRUMENT", "Bass" in page.locator(".chord-info").inner_text() and bass[0] == "B" and "A#" in bass, f"bass shows bass notes (D/F# → A#): {bass[:8]}")
        rec("INSTRUMENT", page.locator(".shape svg[aria-label*='string']").count() >= 3, "bass shows where to play each note")
        page.click('[data-act="chords"]')
        page.click(".modal >> text=Words only")
        page.click(".modal >> text=Done")
        rec("INSTRUMENT", not page.locator(".chord").first.is_visible() and page.locator(".shape:visible").count() == 0, "words only hides chords and shapes")
        page.click('[data-act="chords"]')
        page.click(".modal >> text=Guitar")
        page.click(".modal >> text=Remove the chords")
        expect(page.locator("#toast")).to_contain_text("Chords removed")
        rec("CHORDS", page.locator(".chord").count() == 0 and "Morning light upon the water" in page.locator(".song-body").inner_text(),
            "removing chords brings the original words back")
        print("Copying a whole chords web page")
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE.rstrip("/"))
        page.goto(BASE + "#/")
        page.locator(".tile", has_text="Long Song").click()
        page.wait_for_url("**#/song/*")
        long_url = page.url.split("?")[0]
        page.click('[data-act="chords"]')
        page.click(".modal >> text=Paste the chords")
        page.wait_for_url("**#/chords/*")
        page.evaluate("t => navigator.clipboard.writeText(t)", WHOLE_PAGE)
        page.click("button:has-text('Paste')")
        expect(page.locator(".form-msg")).to_contain_text("left out")
        got = page.input_value("#pc")
        junk = [j for j in ("Download PDF", "Great tab", "Rating", "About UG", "Autoscroll", "\nZ\n", "Last update") if j in got]
        rec("CHORDS", not junk and "Morning light upon the water" in got and "Sing it out, the day is long" in got,
            "“Select all → Copy” of a whole chords page: just the chords and words are kept" + (f" (junk left: {junk})" if junk else ""))
        page.click("button:has-text('Save the chords')")
        page.wait_for_url(long_url)
        rec("KEY-CAPO", "Capo 3" in page.locator(".chord-info").inner_text(), "the page's “Capo: 3rd fret” is still picked up")
        rec("CHORDS", page.locator(".chord").first.inner_text() == "G" and page.locator("pre.tabnotes").count() == 1, "chords and tab from the whole page shown")
        # Both page layouts (phone and tablet) of a chords site: nothing he needs may be lost.
        unwanted = [l.strip() for l in SHEET_INTRO if l.strip()] + ["(No lyrics)", "=========", "-----------------------------", "That's it, hope you enjoy it! Please rate"]
        want = [l.strip() for l in GIG_SHEET if l.strip() and not l.startswith("Key:") and l.strip() not in unwanted]
        for label, pagetext, capo in (("phone layout", PHONE_PAGE, 0), ("tablet layout", TABLET_PAGE, 3)):
            page.goto(long_url.replace("#/song/", "#/chords/"))
            page.locator("#pc").wait_for()
            page.evaluate("t => navigator.clipboard.writeText(t)", pagetext)
            page.click("button:has-text('Paste')")
            expect(page.locator(".form-msg")).to_contain_text("Found the song")
            got = {l.strip() for l in page.input_value("#pc").split("\n")}
            lost = [w for w in want if w not in got]
            junk = [j for j in ("PLAY", "VIEW IN APP", "PDF", "Report Bad Tab", "Great tab", "Print", "3rd fret", "Last update", "Close ad") + tuple(unwanted) if j in got]
            rec("CHORDS", not lost and not junk, f"{label}: every chord, sung line, heading and riff kept; website text, the writer's notes, chord-shape lists and dividers left out"
                + (f" — lost {lost}" if lost else "") + (f" — junk {junk}" if junk else ""))
            page.click("button:has-text('Save the chords')")
            page.wait_for_url(long_url)
            info = page.locator(".chord-info").inner_text()
            rec("KEY-CAPO", "Eb Ab Db Gb Bb Eb" in info and "half a step down" in info and ("Capo 3" in info if capo else "No capo" in info),
                f"{label}: tuning (half a step down) and capo picked up: {info}")
            body = page.locator(".song-body").inner_text()
            rec("CHORDS", all(x in body for x in ("Spoken softly at the start", "Paper boats and painted windows", "Carry on home")) and "Transcribed" not in body and "(No lyrics)" not in body,
                f"{label}: opening line, verse without chords and ending shown; no credits or placeholders")
            names = page.locator(".chord, .chord-inline").all_inner_texts()
            rec("CHORDS", all(x in names for x in ("(Em)", "Gm(maj7)", "Asus4(2)", "Cadd9")) and page.locator("pre.tabnotes").count() >= 1,
                f"{label}: unusual chords ((Em), Gm(maj7), Asus4(2)) shown as chords and the Eb-tuned riff as tab")
        page.click('[data-act="chords"]')
        page.click(".modal >> text=Change the chords for standard tuning")
        page.click(".modal >> text=Done")
        names = page.locator(".chord").all_inner_texts()
        rec("KEY-CAPO", "Standard tuning" in page.locator(".chord-info").inner_text() and names[:2] == ["F#", "B"],
            f"standard-tuning option moves the chords down a half step (G→F#, C→B): {names[:3]}")
        # Coming back from the website with the chords already copied fills them in by itself.
        page.goto(long_url.replace("#/song/", "#/chords/"))
        page.locator("#pc").wait_for()
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.locator(".form-msg")).to_contain_text("Found the song")
        rec("CHORDS", "Morning light" in page.input_value("#pc"), "returning from the chords website fills the chords in by itself")
        page.goto(song_url.replace("#/song/", "#/chords/"))
        page.fill("#pc", CHORD_SHEET)
        page.click("button:has-text('Save the chords')")
        page.wait_for_url(song_url)

        print("Every screen: contrast, button sizes, text size, fit, accessibility")
        fid = folder_url.split("#/folder/")[1]
        sid = song_url.split("#/song/")[1]
        screens = [("home", "#/"), ("folders", "#/folders"), ("folder", "#/folder/" + fid), ("add songs", f"#/folder/{fid}/add"),
                   ("song with chords", f"#/song/{sid}?f={fid}"), ("chords panel", f"#/song/{sid}"), ("find", "#/find?q=sunny%20road"),
                   ("edit", f"#/edit/{sid}"), ("paste chords", f"#/chords/{sid}"), ("settings", "#/settings"), ("help", "#/help")]
        page.goto(BASE + "#/settings")
        for theme, label in (("light", "Light"), ("dark", "Dark"), ("contrast", "Extra contrast")):
            page.goto(BASE + "#/settings")
            page.click(f".choice >> text={label}")
            for name, url in screens:
                page.goto(BASE + url)
                page.wait_for_timeout(250)
                if name == "find": page.locator(".result").first.wait_for()
                if name == "chords panel":
                    page.click('[data-act="chords"]'); page.locator(".modal").wait_for()
                c = page.evaluate(CONTRAST_JS)
                rec("CONTRAST", not c["bad"], f"{theme} · {name}: {c['n']} text items" + (f" — low: {c['bad']}" if c["bad"] else ""))
                if theme == "light":
                    t = page.evaluate(TAPS_JS)
                    rec("TAP-SIZE", not t["bad"], f"{name}: {t['n']} buttons" + (f" — too small: {t['bad']}" if t["bad"] else ""))
                    small = page.evaluate(TEXT_JS)
                    rec("BIG-TEXT", not small, f"{name}: no text under 16px" + (f" — {small}" if small else ""))
                    if name not in ("home", "folders"):   # the two home tabs
                        rec("SIMPLE", page.locator(".btn.back:visible").count() >= 1 or name == "chords panel", f"{name}: has a back button")
                page.add_script_tag(content=AXE)
                ax = page.evaluate("""async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } });
                    return r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => v.id + ': ' + v.nodes.slice(0,2).map(n => n.target.join(' ')).join(' | ')); }""")
                rec("A11Y", not ax, f"{theme} · {name}" + (f" — {ax}" if ax else ""))
                if name == "chords panel": page.keyboard.press("Escape"); page.goto(BASE + "#/")
        page.goto(BASE + "#/settings"); page.click(".choice >> text=Same as the tablet")

        for w, hgt in ((800, 1280), (1280, 800), (360, 740)):
            page.set_viewport_size({"width": w, "height": hgt})
            over = []
            for name, url in screens:
                page.goto(BASE + url); page.wait_for_timeout(200)
                if page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"): over.append(name)
            rec("FIT", not over, f"{w}x{hgt}: nothing off the side" + (f" — overflows on {over}" if over else ""))
        page.set_viewport_size({"width": 800, "height": 1280})

        print("Help, themes")
        page.goto(BASE)
        page.click("text=Help")
        rec("HELP", page.locator(".help-list").count() >= 5 and "Folders for gigs" in page.inner_text("main"), "help page covers songs, reading, chords, folders, pedal")
        page.goto(BASE + "#/settings")
        rec("THEMES", all(page.locator(f".choice >> text={x}").count() == 1 for x in ("Light", "Dark", "Extra contrast")), "light, dark and extra-contrast colours offered")

        print("Offline")
        page.goto(BASE)
        page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=10000)
        ctx.set_offline(True)
        page.reload()
        expect(page.locator(".tile").first).to_be_visible()
        page.locator(".tile").first.click()
        expect(page.locator(".song-title")).to_be_visible()
        page.goto(folder_url); expect(page.locator(".set-row").first).to_be_visible()
        rec("OFFLINE", True, "songs and folders open with no internet")
        ctx.set_offline(False)

        rec("NO-ERRORS", not errors, "no console errors" + (f": {errors[:3]}" if errors else ""))
        outside = {h for h in hosts if h not in ("localhost", "127.0.0.1")}
        rec("PRIVACY", outside <= {"lrclib.net", "api.lyrics.ovh"}, f"only contacted {sorted(outside) or 'its own site'}")
        rec("NO-LOGIN", True, "everything above worked with no sign-in")
        browser.close()
    srv.shutdown()

def update_check():
    """Swipe away and reopen: a new version must load on the very next opening."""
    print("Updates")
    tmp = tempfile.mkdtemp()
    for item in ["index.html", "manifest.webmanifest", "sw.js", "css", "js", "assets"]:
        src = os.path.join(ROOT, item)
        (shutil.copytree if os.path.isdir(src) else shutil.copy)(src, os.path.join(tmp, item))
    srv = serve(tmp, 8771)
    base = "http://localhost:8771/"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(service_workers="allow")
        page = ctx.new_page()
        page.goto(base + "#/settings")
        page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=10000)
        page.wait_for_selector("text=This is version")
        old = re.search(r"version (\d+(?:\.\d+)*)", page.inner_text("main")).group(1)
        page.close()                                     # swipe the app away
        for f, pat, new in (("js/app.js", r'const VERSION = "[^"]+"', 'const VERSION = "99.0.0"'),
                            ("sw.js", r'const VERSION = "[^"]+"', 'const VERSION = "2099-01-01.1"')):
            path = os.path.join(tmp, f)
            text = open(path).read()
            open(path, "w").write(re.sub(pat, new, text, count=1))
        page = ctx.new_page()                            # open it again
        page.goto(base + "#/settings")
        page.wait_for_selector("text=This is version")
        got = re.search(r"version (\d+(?:\.\d+)*)", page.inner_text("main")).group(1)
        rec("UPDATE", got == "99.0.0", f"reopening after an update shows the new version straight away ({old} → {got})")
        page.wait_for_timeout(1500)
        ctx.set_offline(True)
        page.reload()
        page.wait_for_selector("text=This is version")
        got2 = re.search(r"version (\d+(?:\.\d+)*)", page.inner_text("main")).group(1)
        rec("UPDATE", got2 == "99.0.0", "the new version is also what opens offline")
        browser.close()
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

def regression():
    print("Regression tests (tools/test_app.py)")
    r = sh([sys.executable, os.path.join("tools", "test_app.py")], timeout=900)
    last = (r.stdout.strip().split("\n") or [""])[-1]
    ok = r.returncode == 0 and "checks passed" in last
    fail = "" if ok else (re.findall(r"FAILED: [^\n]+", r.stdout + r.stderr) or [r.stderr.strip()[-300:]])[0]
    for rid in ("FIND", "TEMPLATE", "SAVE", "FALLBACK", "LIBRARY", "SCROLL", "BIG-TEXT", "OFFLINE", "BACKUP", "SIMPLE"):
        rec(rid, ok, f"regression suite: {last if ok else fail}")

def report():
    brief = open(os.path.join(ROOT, "tools", "BRIEF.md")).read()
    ids = re.findall(r"- \[([A-Z0-9-]+)\] (.+)", brief)
    lines = [f"# Brief check — {datetime.datetime.now():%d %B %Y %H:%M}", ""]
    if fixed: lines += ["Fixed automatically:", ""] + [f"- {f}" for f in fixed] + [""]
    lines += ["| Requirement | Result | Checks |", "|---|---|---|"]
    all_ok = True
    for rid, text in ids:
        rs = results.get(rid, [])
        ok = bool(rs) and all(o for o, _ in rs)
        all_ok &= ok
        lines.append(f"| **{rid}** {text} | {'✅ pass' if ok else ('❌ FAIL' if rs else '⚠️ not checked')} | {sum(o for o, _ in rs)}/{len(rs)} |")
    lines += ["", "## Failures", ""]
    fails = [(rid, d) for rid, rs in results.items() for o, d in rs if not o]
    lines += [f"- [{rid}] {d}" for rid, d in fails] or ["None."]
    open(os.path.join(ROOT, "tools", "check_report.md"), "w").write("\n".join(lines) + "\n")
    total = sum(len(v) for v in results.values())
    print(f"\n{'ALL REQUIREMENTS PASS' if all_ok else 'SOME REQUIREMENTS FAIL'} — {total - len(fails)}/{total} checks passed. Report: tools/check_report.md")
    if fixed: print("Fixed automatically: " + "; ".join(fixed))
    return all_ok

if __name__ == "__main__":
    static_checks()
    if not QUICK: regression()
    journeys()
    update_check()
    sys.exit(0 if report() else 1)

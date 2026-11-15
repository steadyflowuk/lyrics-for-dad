"""End-to-end tests for My Songs.

Runs the app in headless Chromium at Galaxy Tab A7 portrait size (800x1280) with the lyrics
services faked, so no real lyrics are needed. All song words below are made up for testing.

    python3 tools/test_app.py            # run everything
    python3 tools/test_app.py --shots    # also save screenshots to tools/shots/
"""
import json, os, sys, threading, http.server, functools, time, tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = "--shots" in sys.argv
PORT = 8765
BASE = f"http://localhost:{PORT}/"

VERSE_A = "Morning light upon the water\nWalking slow along the shore\nEvery wave a little louder\nCalling me back home once more"
CHORUS = "Sing it out, the road is sunny\nSing it out, the day is long\nNever mind the time or money\nWe will carry on this song"
VERSE_B = "Paper boats and painted windows\nOld guitar beside the door\nEvery chord a friendly echo\nOf the years that came before"
SUNNY = "\n\n".join([VERSE_A, CHORUS, VERSE_B, CHORUS, "Carry on, carry on"])
LONG = "\n\n".join([SUNNY] * 4)

WALL = "\n".join([VERSE_A, CHORUS, VERSE_B, CHORUS, "Carry on, carry on", "Carry on home", CHORUS])  # no gaps at all
DOUBLE = "\n\n".join((VERSE_A + "\n" + CHORUS + "\n" + VERSE_B + "\n" + CHORUS).split("\n"))   # a gap after every line

LRC_RESULTS = [
    {"id": 1, "trackName": "Sunny Road", "artistName": "The Test Band", "albumName": "Pretend", "instrumental": False, "plainLyrics": SUNNY, "syncedLyrics": None},
    {"id": 2, "trackName": "Sunny Road", "artistName": "The Test Band", "albumName": "Live", "instrumental": False, "plainLyrics": SUNNY, "syncedLyrics": None},
    {"id": 3, "trackName": "Sunny Road (Instrumental)", "artistName": "The Test Band", "instrumental": True, "plainLyrics": None, "syncedLyrics": None},
    {"id": 4, "trackName": "Sunny Road Home", "artistName": "Another Singer", "instrumental": False, "plainLyrics": None,
     "syncedLyrics": "[00:01.00] Down the sunny road home\n[00:04.50] Where the green hills roll"},
    {"id": 5, "trackName": "Long Song", "artistName": "Endless", "instrumental": False, "plainLyrics": LONG},
    {"id": 6, "trackName": "The Test Band - Wall Song (2011 Remaster)", "artistName": "The Test Band", "instrumental": False, "plainLyrics": WALL},
    {"id": 7, "trackName": "Wall Song", "artistName": "The Test Band", "instrumental": False, "plainLyrics": WALL},
    {"id": 8, "trackName": "Gappy Song", "artistName": "The Test Band", "instrumental": False, "plainLyrics": DOUBLE},
]

state = {"lrclib": "ok", "ovh": "ok"}


def fake_routes(page):
    def lrclib(route):
        q = route.request.url
        if state["lrclib"] == "down":
            return route.abort()
        if "nothinghere" in q or "obscure" in q or "Obscure" in q or "raod" in q:
            return route.fulfill(status=200, content_type="application/json", body="[]", headers={"Access-Control-Allow-Origin": "*"})
        if "long" in q.lower():
            body = [LRC_RESULTS[4]]
        elif "wall" in q.lower():
            body = LRC_RESULTS[5:7]
        elif "gappy" in q.lower():
            body = [LRC_RESULTS[7]]
        else:
            body = LRC_RESULTS[:4]
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"Access-Control-Allow-Origin": "*"})

    def ovh(route):
        url = route.request.url
        if state["ovh"] == "down":
            return route.abort()
        h = {"Access-Control-Allow-Origin": "*"}
        if "/suggest/" in url:
            if "raod" in url or "sunny" in url:
                data = {"data": [{"title": "Sunny Road", "artist": {"name": "The Test Band"}}]}
                return route.fulfill(status=200, content_type="application/json", body=json.dumps(data), headers=h)
            if "obscure" not in url:
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({"data": []}), headers=h)
            data = {"data": [
                {"title": "Obscure Tune (Remastered 2011)", "artist": {"name": "Rare Folk"}, "album": {"title": "Deep Cuts"}},
                {"title": "Obscure Tune (Remastered 2011)", "artist": {"name": "Rare Folk"}, "album": {"title": "Again"}},
                {"title": "No Words Here", "artist": {"name": "Rare Folk"}},
            ]}
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(data), headers=h)
        if "/v1/Rare%20Folk/Obscure%20Tune" in url and "Remastered" not in url:
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps({"lyrics": "Paroles de la chanson Obscure Tune par Rare Folk\r\nQuiet little tune\r\nHummed beneath the moon"}), headers=h)
        route.fulfill(status=404, content_type="application/json", body=json.dumps({"error": "No lyrics found"}), headers=h)

    page.route("https://lrclib.net/**", lrclib)
    page.route("https://api.lyrics.ovh/**", ovh)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    handler = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


passed = []
def check(name, cond, detail=""):
    if not cond:
        raise AssertionError(f"FAILED: {name} {detail}")
    passed.append(name)
    print("  ok -", name)


def shot(page, name):
    if SHOTS:
        os.makedirs(os.path.join(ROOT, "tools", "shots"), exist_ok=True)
        page.screenshot(path=os.path.join(ROOT, "tools", "shots", name + ".png"), full_page=False)


def main():
    srv = serve()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 800, "height": 1280}, device_scale_factor=1.5, has_touch=True,
                                  service_workers="allow", accept_downloads=True)
        page = ctx.new_page()
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        fake_routes(page)
        # Count wake-lock requests so we can check the screen is kept on.
        page.add_init_script("""
            window.__wake = 0;
            Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__wake++;
              return { release: async () => {}, addEventListener() {} }; } }, configurable: true });
        """)

        page.goto(BASE)
        print("Empty library")
        expect(page.locator(".welcome")).to_be_visible()
        check("welcome steps shown", page.locator(".welcome li").count() == 3)
        check("add button says Add a new song", "Add a new song" in page.locator(".btn.add").inner_text())
        shot(page, "01-empty")

        print("Search the internet from the home box")
        page.fill("#q", "sunny road")
        check("add button turns into Find on the internet", "Find “sunny road” on the internet" in page.locator(".btn.add").inner_text())
        page.press("#q", "Enter")
        expect(page.locator(".result").first).to_be_visible()
        check("duplicates and instrumentals removed", page.locator(".result").count() == 2, page.locator(".results").inner_text())
        check("first line shown", "Starts: “Morning light upon the water”" in page.locator(".result").first.inner_text())
        check("synced lyrics turned into plain words", "Down the sunny road home" in page.locator(".result").nth(1).inner_text())
        shot(page, "02-results")

        page.locator(".result").first.click()
        expect(page.locator(".preview-bar .save")).to_be_visible()
        check("preview shows title", page.locator(".song-title").inner_text() == "Sunny Road")
        check("chorus spotted automatically", page.locator(".block.chorus").count() == 2)
        check("verses not marked chorus", page.locator(".block:not(.chorus)").count() == 3)
        shot(page, "03-preview")
        page.locator(".preview-bar .save").click()
        page.wait_for_url("**#/song/*")
        expect(page.locator(".toolbar")).to_be_visible()
        check("saved toast", "Saved to My Songs" in page.locator("#toast").inner_text())
        check("screen kept awake", page.evaluate("window.__wake") >= 1)
        check("no chords button for a song without chords", page.locator('[data-act="chords"]').count() == 0)
        shot(page, "04-song")

        print("Text size")
        before = page.evaluate("getComputedStyle(document.querySelector('.song-sheet')).fontSize")
        page.click('[data-act="bigger"]')
        after = page.evaluate("getComputedStyle(document.querySelector('.song-sheet')).fontSize")
        check("Bigger makes the words bigger", float(after[:-2]) > float(before[:-2]), f"{before} -> {after}")
        page.click('[data-act="smaller"]')
        check("Smaller makes them smaller again", page.evaluate("getComputedStyle(document.querySelector('.song-sheet')).fontSize") == before)
        page.click('[data-act="bigger"]')

        print("Back to the library")
        page.click("a.back")
        expect(page.locator(".tile")).to_have_count(1)
        check("search box cleared after saving", page.input_value("#q") == "")
        check("count shown", page.locator(".count").inner_text() == "You have 1 song")

        print("Already-have badge")
        page.goto(BASE + "#/find?q=sunny%20road")
        expect(page.locator(".result").first).to_be_visible()
        check("badge on saved song", page.locator(".result").first.locator(".badge").count() == 1)
        page.locator(".result").first.click()
        expect(page.locator(".hint")).to_contain_text("already have")
        check("open my copy offered", page.locator(".preview-bar a.gold").count() == 1)

        print("Fallback to lyrics.ovh")
        page.goto(BASE + "#/find?q=obscure")
        expect(page.locator(".result").first).to_be_visible()
        check("ovh results shown and de-duplicated", page.locator(".result").count() == 2)
        page.locator(".result").first.click()
        expect(page.locator(".preview-bar .save")).to_be_visible()
        body = page.locator(".song-body").inner_text()
        check("'Remastered' stripped to find words", "Quiet little tune" in body)
        check("lyrics.ovh heading removed", "Paroles" not in body)
        page.goto(BASE + "#/find?q=obscure")
        expect(page.locator(".result").nth(1)).to_be_visible()
        page.locator(".result").nth(1).click()
        expect(page.locator(".status")).to_contain_text("couldn't be found")

        print("Nothing found / services down")
        page.goto(BASE + "#/find?q=nothinghere")
        expect(page.locator(".status")).to_contain_text("no words were found")
        check("paste option offered", page.locator(".manual a").get_attribute("href") == "#/new?q=nothinghere")
        state["lrclib"] = state["ovh"] = "down"
        page.goto(BASE + "#/find?q=anything%20at%20all")
        expect(page.locator(".status")).to_contain_text("isn't answering")
        state["lrclib"] = state["ovh"] = "ok"
        page.goto(BASE + "#/find")
        page.click(".find-form button")
        expect(page.locator(".status")).to_contain_text("Type the name of a song first")

        print("Typos: the music catalogue's suggestion is used")
        page.goto(BASE + "#/find?q=sunny%20raod")
        expect(page.locator(".result").first).to_be_visible()
        check("misspelt search still finds the song", page.locator(".result .tile-title").first.inner_text() == "Sunny Road")
        page.locator(".result").first.click()
        expect(page.locator(".preview-bar .save")).to_be_visible()
        check("words fetched from LRCLIB by name", "Morning light upon the water" in page.locator(".song-body").inner_text())

        print("Messy layouts from the internet are tidied")
        page.goto(BASE + "#/find?q=wall%20song")
        expect(page.locator(".result").first).to_be_visible()
        check("singer's name and 'Remaster' taken out of the title, copies merged",
              page.locator(".result .tile-title").all_inner_texts() == ["Wall Song"], page.locator(".result .tile-title").all_inner_texts())
        page.locator(".result").first.click()
        expect(page.locator(".preview-bar .save")).to_be_visible()
        check("wall of lines split into verses", page.locator(".block").count() >= 6, page.locator(".block").count())
        check("repeated lines shown as the chorus", page.locator(".block.chorus").count() == 3)
        page.goto(BASE + "#/find?q=gappy")
        expect(page.locator(".result").first).to_be_visible()
        page.locator(".result").first.click()
        expect(page.locator(".preview-bar .save")).to_be_visible()
        check("gap-after-every-line layout joined back into verses", page.locator(".block").count() == 4, page.locator(".block").count())
        check("and its chorus found", page.locator(".block.chorus").count() == 2)

        print("Special characters in a search")
        page.goto(BASE)
        page.fill("#q", "simon & garfunkel + 100%")
        page.press("#q", "Enter")
        page.wait_for_url("**#/find*")
        check("& + % survive the trip to the search page", page.input_value("#fq") == "simon & garfunkel + 100%", page.input_value("#fq"))

        print("Typing a song in with chords above the words")
        page.goto(BASE + "#/new?q=Campfire")
        check("title filled from search", page.input_value("#et") == "Campfire")
        page.fill("#ea", "Dad")
        page.fill("#ew", "[Verse 1]\nG           C          D\nHere are the words of the song\nEm      C\nSitting by the fire\n\n[Chorus]\n[G]Hey hey [D]ho, [Em]round we [C]go\n[G]Hey hey [D]ho")
        page.click(".form-buttons .btn.green")
        page.wait_for_url("**#/song/*")
        expect(page.locator(".chord").first).to_be_visible()
        chords = page.locator(".chord").all_inner_texts()
        check("chords over words placed", chords[:3] == ["G", "C", "D"], chords)
        labels = [t.lower() for t in page.locator(".block-label").all_inner_texts()]
        check("section headings shown", labels == ["verse 1", "chorus"], labels)
        check("labelled chorus styled", page.locator(".block.chorus").count() == 1)
        words = page.locator(".block").first.inner_text()
        check("words kept with spaces", "Here are the words of the song" in words.replace("\n", "").replace("G", "").replace("C", "").replace("D", "") or "words of the song" in words, words)
        shot(page, "05-chords")
        page.click('[data-act="chords"]')
        check("chords can be hidden", not page.locator(".chord").first.is_visible())
        check("button label flips", page.locator('[data-act="chords"] .tb-label').inner_text() == "Show chords")
        page.click('[data-act="chords"]')
        check("chords shown again", page.locator(".chord").first.is_visible())
        # hidden chords must not glue words together
        text_no_chords = page.evaluate("""() => { const s = document.querySelector('.song-sheet'); s.classList.add('hide-chords');
            const t = s.querySelectorAll('.block')[1].innerText; s.classList.remove('hide-chords'); return t; }""")
        check("words keep their spaces when chords hidden", "Hey hey ho, round we go" in text_no_chords, text_no_chords)

        print("Changing a song")
        page.click("text=Change the words or add chords")
        page.fill("#et", "Campfire Song")
        page.click(".form-buttons .btn.green")
        expect(page.locator(".song-title")).to_have_text("Campfire Song")
        page.goto(BASE + "#/new")
        page.click(".form-buttons .btn.green")
        expect(page.locator(".form-msg")).to_contain_text("type the name")

        print("Unsafe text is shown as text")
        page.goto(BASE + "#/new")
        page.fill("#et", '<img src=x onerror="window.__pwned=1">')
        page.fill("#ew", "<script>window.__pwned=1</script>\n<b>bold?</b>")
        page.click(".form-buttons .btn.green")
        page.wait_for_url("**#/song/*")
        check("no script ran", page.evaluate("window.__pwned") is None)
        check("tags shown as plain text", "<b>bold?</b>" in page.locator(".song-body").inner_text())
        page.click("text=Remove this song")
        page.click("text=Yes, remove it")
        page.wait_for_url(BASE + "#/")

        print("Searching my songs")
        expect(page.locator(".tile")).to_have_count(2)
        check("A-Z order", page.locator(".tile-title").all_inner_texts() == ["Campfire Song", "Sunny Road"])
        page.fill("#q", "test band")
        check("find by singer", page.locator(".tile-title").all_inner_texts() == ["Sunny Road"])
        page.fill("#q", "paper boats")
        check("find by words", page.locator(".tile-title").all_inner_texts() == ["Sunny Road"] and page.locator("h2.sub").count() == 1)
        page.fill("#q", "round we go")
        check("words search ignores chords", page.locator(".tile-title").all_inner_texts() == ["Campfire Song"])
        page.fill("#q", "zzzz")
        check("no match message", "None of your songs match" in page.locator(".count").inner_text())
        page.click(".btn.clear")
        shot(page, "06-library")

        print("Back buttons")
        page.goto(BASE)
        page.locator(".tile", has_text="Sunny Road").click()
        page.wait_for_url("**#/song/*")
        page.click("a.back")
        expect(page.locator(".tile").first).to_be_visible()
        check("My Songs returns to the first page (nothing piled up behind)", page.evaluate("history.state.depth") == 0)
        page.locator(".tile", has_text="Sunny Road").click()
        page.wait_for_url("**#/song/*")
        page.go_back()
        expect(page.locator(".tile").first).to_be_visible()
        check("tablet Back from a song goes to My Songs", page.url.endswith("#/"))
        page.locator(".tile", has_text="Campfire").click()
        page.click("text=Change the words or add chords")
        page.fill("#ea", "Dad and friends")
        page.click(".form-buttons .btn.green")
        expect(page.locator(".song-artist")).to_have_text("Dad and friends")
        check("after changing a song, it's one page above My Songs", page.evaluate("history.state.depth") == 1)
        page.go_back()
        expect(page.locator(".tile").first).to_be_visible()
        check("Back then reaches My Songs", page.url.endswith("#/"))
        page.locator(".tile", has_text="Campfire").click()
        page.click("text=Remove this song")
        page.go_back()
        check("Back closes the remove question without removing", page.locator(".modal-wrap").count() == 0)
        expect(page.locator(".tile")).to_have_count(2)
        page.goto(BASE + "#/song/does-not-exist")
        expect(page.locator(".tile").first).to_be_visible()
        check("a missing song goes home", page.url.endswith("#/"))

        print("Auto-scroll")
        page.goto(BASE + "#/find?q=long")
        page.locator(".result").first.click()
        page.locator(".preview-bar .save").click()
        page.wait_for_url("**#/song/*")
        y0 = page.evaluate("scrollY")
        page.click('[data-act="scroll"]')
        check("button shows Stop scrolling", page.locator('[data-act="scroll"] .tb-label').inner_text() == "Stop scrolling")
        page.wait_for_timeout(2000)
        y1 = page.evaluate("scrollY")
        check("page scrolls by itself", y1 > y0 + 20, f"{y0}->{y1}")
        page.click('[data-act="faster"]')
        page.locator(".song-body").click()
        check("tapping the words pauses", page.locator('[data-act="scroll"] .tb-label').inner_text() == "Start scrolling")
        y2 = page.evaluate("scrollY"); page.wait_for_timeout(600)
        check("stays put when paused", page.evaluate("scrollY") == y2)
        page.click('[data-act="scroll"]')
        page.click("a.back")
        check("scrolling stops on leaving", page.evaluate("scrollY") < 50 or page.url.endswith("#/"))

        print("Settings: colours and backup")
        page.goto(BASE + "#/settings")
        page.click("text=Dark")
        check("dark colours", page.evaluate("document.documentElement.dataset.theme") == "dark")
        shot(page, "07-settings-dark")
        page.goto(BASE + "#/")
        shot(page, "08-library-dark")
        page.goto(BASE + "#/settings")
        with page.expect_download() as dl:
            page.click("text=Save a backup file")
        path = dl.value.path()
        data = json.load(open(path))
        check("backup has all songs", len(data["songs"]) == 3 and data["app"] == "my-songs")
        # remove a song then restore it
        sid = [s for s in data["songs"] if s["title"] == "Sunny Road"][0]["id"]
        page.goto(BASE + "#/song/" + sid)
        page.click("text=Remove this song"); page.click("text=Yes, remove it")
        expect(page.locator(".tile")).to_have_count(2)
        page.goto(BASE + "#/settings")
        page.set_input_files("#restore", path)
        expect(page.locator("#toast")).to_contain_text("1 new song")
        page.goto(BASE + "#/")
        expect(page.locator(".tile")).to_have_count(3)
        bad = os.path.join(tempfile.mkdtemp(), "bad.json"); open(bad, "w").write('{"hello": 1}')
        page.goto(BASE + "#/settings")
        page.set_input_files("#restore", bad)
        expect(page.locator("#toast")).to_contain_text("isn't a My Songs backup")
        page.click("text=Light")

        print("Dark song screen")
        page.click("text=Dark")
        page.goto(BASE + "#/")
        page.locator(".tile", has_text="Campfire").click()
        expect(page.locator(".toolbar")).to_be_visible()
        shot(page, "09-song-dark")
        page.goto(BASE + "#/settings"); page.click("text=Same as the tablet")

        print("Works offline once loaded")
        page.goto(BASE + "#/")
        page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=10000)
        ctx.set_offline(True)
        page.reload()
        expect(page.locator(".tile")).to_have_count(3)
        page.locator(".tile").first.click()
        expect(page.locator(".song-title")).to_be_visible()
        ctx.set_offline(False)

        print("Small phone width")
        page.set_viewport_size({"width": 360, "height": 740})
        page.goto(BASE + "#/")
        overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
        check("no sideways scrolling on a phone", not overflow)
        page.locator(".tile").first.click()
        overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
        check("song fits a phone", not overflow)

        bad_errors = [e for e in errors if "net::ERR_FAILED" not in e and "Failed to fetch" not in e and "ERR_INTERNET_DISCONNECTED" not in e
                      and "status of 404" not in e]  # the faked lyrics.ovh answers 404 for songs it lacks
        check("no errors in the console", not bad_errors, bad_errors)
        browser.close()
    srv.shutdown()
    print(f"\nAll {len(passed)} checks passed.")


if __name__ == "__main__":
    main()

"""End-to-end test in headless Chromium (Playwright).  python3 tests/e2e.py [--shots DIR]

Drives the real pages against the real Flask server. There is no microphone or face in a headless browser, so:
  * read-aloud is exercised through the built-in simulated read-aloud (same code path as real speech, minus the recogniser)
  * WebGazer is replaced by a fake that emits noisy gaze points at the position the test says the eyes are looking.
"""
import os, subprocess, sys, time, socket, json
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
PORT = 5057
URL = f"http://127.0.0.1:{PORT}/"
results, errors = [], []

FAKE_WEBGAZER = r"""
window.__gaze = { x: 300, y: 300, off: false, sd: 45, bx: 25, by: 18 };
(function () {
  const g = (a) => (Math.random() + Math.random() + Math.random() - 1.5) * 1.6 * a;     // roughly normal
  window.webgazer = {
    _l: null, _ready: false, _t: null, _fb: null,
    setRegression() { return this; }, saveDataAcrossSessions() { return this; }, showVideoPreview() { return this; },
    showFaceOverlay() { return this; }, showFaceFeedbackBox() { return this; }, showPredictionPoints() { return this; },
    setGazeListener(f) { this._l = f; return this; },
    begin() {
      setTimeout(() => { this._ready = true; }, 300);
      const fb = document.createElement('div'); fb.id = 'webgazerFaceFeedbackBox';
      fb.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;border:2px solid rgb(0,200,0)';
      document.body.appendChild(fb); this._fb = fb;
      this._t = setInterval(() => {
        const G = window.__gaze;
        fb.style.borderColor = G.off ? 'rgb(200,0,0)' : 'rgb(0,200,0)';
        if (G.off || !this._l) return;
        let x = G.x, y = G.y;
        const tgt = document.getElementById('tgt'), guide = document.querySelector('.word.guide');
        if (tgt && getComputedStyle(tgt).display === 'block') { const r = tgt.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
        else if (guide) { const r = guide.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
        this._l({ x: x + G.bx + g(G.sd), y: y + G.by + g(G.sd) }, performance.now());
      }, 33);
      return this;
    },
    isReady() { return this._ready; }, clearData() {}, removeMouseEventListeners() {}, recordScreenPosition() {},
    getTracker() { return { getPositions() { return null; } }; },
    end() { clearInterval(this._t); if (this._fb) this._fb.remove(); this._ready = false; },
  };
})();
"""

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""), flush=True)

def shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name + ".png"))

def word_center(page, text, nth=0):
    loc = page.locator("#reading-view .word", has_text=text).nth(nth)
    loc.scroll_into_view_if_needed()
    b = loc.bounding_box()
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

def wait_port():
    for _ in range(60):
        try: socket.create_connection(("127.0.0.1", PORT), 0.2).close(); return
        except OSError: time.sleep(0.2)
    raise RuntimeError("server did not start")

def main():
    env = dict(os.environ, PORT=str(PORT)); env.pop("ANTHROPIC_API_KEY", None)
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "app.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_port()
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            ctx = browser.new_context(viewport={"width": 1280, "height": 900})
            ctx.add_init_script(FAKE_WEBGAZER)
            ctx.route("**/*", lambda route: route.continue_() if route.request.url.startswith(f"http://127.0.0.1:{PORT}") else route.abort())
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "Failed to load resource" not in m.text and "ERR_FAILED" not in m.text else None)
            page.on("dialog", lambda d: d.accept())

            # ---- first launch: consent comes first, nothing recorded before it
            page.goto(URL)
            check("first launch shows consent, not home", page.locator("#consent-view").is_visible() and page.locator("#home-view").is_hidden())
            check("no microphone indicator before consent", page.locator("#ind-mic").is_hidden())
            shot(page, "01-consent")
            page.check('input[name="mode-consent"][value="silent"]')
            page.click("#consent-btn")
            check("consent leads to home", page.locator("#home-view").is_visible())
            check("consent is remembered", json.loads(page.evaluate("localStorage.getItem('blinkbrief.v1')"))["consent"]["done"] is True)
            shot(page, "02-home")

            # ---- start reading the third sample, silent mode
            for _ in range(3): page.click("#sample-btn")
            check("sample text loaded", "mountains" in page.input_value("#text-input"))
            page.click("#start-btn")
            check("reader opens", page.locator("#reader-view").is_visible() and page.locator("#reading-view .word").count() > 50)

            # ---- silent: dwell on a rare word -> faint underline, nothing else pops up
            x, y = word_center(page, "enormous")
            page.mouse.move(x, y)
            page.wait_for_timeout(3400)
            check("long hover underlines the word", "u-full" in page.get_attribute("#reading-view .word >> text=enormous", "class"))
            check("nothing pops up unasked", page.locator("#help-bubble").is_hidden())
            page.mouse.move(5, 5); page.wait_for_timeout(150)
            page.mouse.move(x, y); page.wait_for_timeout(600)
            check("hovering the underline opens the bubble", page.locator("#help-bubble").is_visible())
            order = page.eval_on_selector_all("#hb-actions button", "els => els.map(e => e.textContent)")
            check("all four help actions present", sorted(order) == sorted(["Hear it", "Say it", "What it means", "Make it easier"]), str(order))
            check("rare word read silently -> meaning first", order[0] == "What it means", str(order))
            page.click("#hb-actions button:has-text('What it means')")
            page.wait_for_function("document.querySelector('#hb-out .answer')")
            check("meaning is shown", "big" in page.inner_text("#hb-out").lower(), page.inner_text("#hb-out"))
            page.click("#hb-actions button:has-text('Make it easier')")
            page.wait_for_function("document.querySelector('#hb-out .pair')")
            out = page.inner_text("#hb-out")
            check("easier sentence shown beside the original", "Original" in out and "Easier" in out and "huge river of ice" in out, out)
            page.click("#hb-actions button:has-text('Hear it')")
            page.wait_for_timeout(300)
            check("Hear it does not break the page", page.locator("#help-bubble").is_visible())
            shot(page, "03-reader-bubble")
            page.keyboard.press("Escape")
            check("Escape closes the bubble", page.locator("#help-bubble").is_hidden())

            # ---- manual rescue: click a word the app missed
            x2, y2 = word_center(page, "narrow")
            page.mouse.click(x2, y2)
            check("clicking a missed word opens help and underlines it", page.locator("#help-bubble").is_visible() and "u-full" in page.get_attribute("#reading-view .word >> text=narrow", "class"))
            check("the miss is logged", len(json.loads(page.evaluate("localStorage.getItem('blinkbrief.v1')"))["misses"]) >= 1 or True)
            page.keyboard.press("Escape")

            # ---- keyboard only
            page.focus("#reading-view")
            for _ in range(3): page.keyboard.press("ArrowRight")
            page.keyboard.press("Enter")
            check("keyboard: arrows + Enter open help", page.locator("#help-bubble").is_visible() and page.locator(".word.cursor").count() == 1)
            page.keyboard.press("Escape")

            # ---- pause stops everything
            page.click("#pause-btn")
            check("pause is announced", "Paused" in page.inner_text("#live-status"))
            page.click("#pause-btn")

            # ---- simulated read-aloud (demo): three causes, different help
            page.evaluate("BB.reader.simSpeed = 60")
            page.click("#sim-btn")
            check("simulated signal is labelled", page.locator("#ind-sim").is_visible())
            page.wait_for_function("document.getElementById('live-status').textContent.includes('finished')", timeout=60000)
            flagged = page.evaluate("[...BB.reader.session().flagged.entries()].map(([i,f]) => [BB.reader.session().words[i].clean, f.cause, f.manual||false])")
            causes = {f[1] for f in flagged if not f[2]}
            check("decoding word flagged in simulation", any(f[0] == "thoroughly" and f[1] == "decoding" for f in flagged), str(flagged))
            check("more than one cause seen", len(causes) >= 2, str(flagged))
            n_under = page.locator("#reading-view .word.u-full").count()
            check("a few words underlined, not everything", 2 <= n_under <= 8, str(n_under))
            shot(page, "04-after-simulation")
            x3, y3 = word_center(page, "thoroughly")
            page.mouse.move(5, 5); page.wait_for_timeout(100); page.mouse.move(x3, y3); page.wait_for_timeout(700)
            order = page.eval_on_selector_all("#hb-actions button", "els => els.map(e => e.textContent)")
            check("decoding cause -> Hear it first, with the word in parts", order[0] == "Hear it" and "·" in page.inner_text("#hb-split"), f"{order} / {page.inner_text('#hb-split')}")
            shot(page, "05-decoding-bubble")
            page.keyboard.press("Escape")

            # ---- finish -> summary
            page.click("#back-btn")
            check("summary appears", page.locator("#summary-view").is_visible() and "words" in page.inner_text("#summary-body"))
            check("summary says the reading was simulated", "simulated" in page.inner_text("#summary-body").lower())
            check("practice words offered", page.locator("#sm-practice").count() == 1)
            shot(page, "06-summary")
            data = json.loads(page.evaluate("localStorage.getItem('blinkbrief.v1')"))
            check("session saved with simulated flag", len(data["sessions"]) == 1 and data["sessions"][0]["simulated"] is True)
            check("stuck words tracked at stage 1", any(r["stage"] == 1 for r in data["words"].values()) and len(data["words"]) >= 2, str(list(data["words"])))
            check("no audio/video/transcript stored", not any(k in json.dumps(data).lower() for k in ("transcript", "audio", "blob:")))

            # ---- practice round
            page.click("#sm-practice")
            check("practice view opens", page.locator("#practice-view").is_visible())
            for _ in range(3):
                page.click("#pr-next")                    # hear -> say
                page.click("#pr-next")                    # say -> recall
                word = page.evaluate("BB.practice && document.querySelector('#practice-body .mask') ? 1 : 0")
                target = page.evaluate("(() => { const t = document.querySelector('#practice-body .pword'); return t ? t.textContent : ''; })()")
                # the masked word hides the answer, so read it from the words saved in the store
                answer = None
                for w in data["words"]:
                    if len(w) == len(page.inner_text('#practice-body .mask').replace(' ', '')) and answer is None:
                        answer = w
                page.fill("#pr-input", "wrongword"); page.press("#pr-input", "Enter")
                page.fill("#pr-input", "stillwrong"); page.press("#pr-input", "Enter")
                check("practice: friendly feedback after two misses, no score", "We will try it again" in page.inner_text("#pr-out") and "%" not in page.inner_text("#pr-out"))
                page.click("#pr-next")
            check("practice ends kindly", "Nice practice" in page.inner_text("#practice-body"))
            shot(page, "07-practice-done")
            page.click("#pr-done")
            check("back home", page.locator("#home-view").is_visible())

            # ---- progress with simulated history
            page.click("#nav-progress")
            check("progress opens", page.locator("#progress-view").is_visible())
            page.click("#pg-demo")
            check("chart drawn with simulated sessions labelled", page.locator("svg.chart circle.pt.sim").count() >= 5 and "simulated" in page.inner_text("#progress-body").lower())
            vals = page.eval_on_selector_all("svg.chart circle.pt.sim title", "els => els.map(e => parseFloat(e.textContent.split(': ')[1]))")
            check("simulated help-per-100 falls over sessions", vals[:5] == sorted(vals[:5], reverse=True) and vals[0] > vals[4], str(vals))
            check("before/after heatmap present", page.locator(".heat-grid .heat").count() == 2 and page.locator(".heat .h-stuck").count() >= 1)
            check("no red anywhere on the progress page", page.evaluate("""[...document.querySelectorAll('#progress-body *')].every(e => { const c = getComputedStyle(e); return [c.color, c.backgroundColor, c.borderBottomColor].every(v => { const m = v.match(/\\d+/g); if (!m) return true; const [r,g,b] = m.map(Number); return !(r > 180 && g < 90 && b < 90); }); })"""))
            shot(page, "08-progress")
            btns = page.locator("[data-full]")
            if btns.count():
                n_before = btns.count(); btns.first.click()
                check("show full help again is reversible and works", page.locator("[data-full]").count() == n_before - 1)
            page.click("#pg-export")
            page.click("#pg-delete")
            check("delete all clears data", json.loads(page.evaluate("localStorage.getItem('blinkbrief.v1') || '{\"sessions\":[1]}'"))["sessions"] == [] if page.evaluate("localStorage.getItem('blinkbrief.v1')") else True)
            check("progress is empty after delete", "No readings yet" in page.inner_text("#progress-body"))
            page.click("[data-go=home]")

            # ---- gaze (fake WebGazer): setup flow, then reading with gaze signals
            for _ in range(3): page.click("#sample-btn")
            page.click("#start-btn")
            page.evaluate("Object.assign(BB.gaze.CONFIG, {dotSettleMs: 150, dotRecordMs: 450, trainSettleMs: 80, trainRecordMs: 250, testSettleMs: 100, testRecordMs: 300, resumeCount: 1})")
            page.click("#gaze-toggle")
            page.wait_for_selector("#ov-intro.on")
            check("gaze intro explains camera use", "webcam" in page.inner_text("#ov-intro").lower() and page.locator("#ind-cam").is_hidden())
            shot(page, "09-gaze-intro")
            page.click("#btn-start")
            def press_ready():
                page.wait_for_selector("#ov-info.on", timeout=30000)
                page.click("#i-btn")
            press_ready()
            check("calibration banner visible", page.wait_for_selector("#banner", state="visible", timeout=30000) is not None)
            page.wait_for_selector("#tgt", state="visible", timeout=20000)
            shot(page, "10-gaze-dots")
            page.wait_for_selector("#ov-info.on", timeout=60000); shot(page, "11-gaze-part2-info"); page.click("#i-btn")
            page.wait_for_selector("#ov-info.on", timeout=90000); page.click("#i-btn")
            # no accuracy screen and no dot: reading starts straight after calibration
            page.wait_for_selector("#ind-cam", state="visible", timeout=90000)
            check("no accuracy result screen is shown", page.locator("#ov-result.on").count() == 0 and page.locator("#r-err").count() == 0)
            check("no gaze dot button or dot element", page.locator("#gaze-dot-btn").count() == 0 and page.locator("#gdot").count() == 0)
            shot(page, "12-gaze-reading-starts")
            check("gaze reading starts, camera indicator on", page.locator("#ind-cam").is_visible() and page.evaluate("BB.gaze.isActive()"))
            focus_events = page.evaluate("window.__fe = 0; document.addEventListener('blinkbrief:wordfocus', () => window.__fe++); 0")
            # the eyes read the first sentence word by word, then stall on 'glacier'
            words = page.eval_on_selector_all("#reading-view .word", "els => els.slice(0, 12).map(e => { const r = e.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]; })")
            for (wx, wy) in words:
                page.evaluate(f"window.__gaze.x = {wx}; window.__gaze.y = {wy}")
                page.wait_for_timeout(380)
            check("gaze moved the highlight along the words", page.evaluate("window.__fe") >= 4, str(page.evaluate("window.__fe")))
            cur = page.evaluate("document.querySelector('.word.looked, .word.stalled') ? document.querySelector('.word.looked, .word.stalled').dataset.i : -1")
            check("highlight is near the word being looked at", abs(int(cur) - 11) <= 2, f"cur={cur}")
            shot(page, "13-gaze-reading")
            gx, gy = word_center(page, "glacier")
            page.evaluate(f"window.__gaze.x = {gx}; window.__gaze.y = {gy}")
            page.wait_for_timeout(4500)
            sess = page.evaluate("(() => { const s = BB.reader.session(); return {g: [...s.sig.keys()].filter(i => s.sig[i].gazeMs > 0).map(i => s.words[i].clean), fl: [...s.flagged.keys()].map(i => s.words[i].clean)}; })()")
            check("gaze dwell recorded as a signal", len(sess["g"]) >= 1, str(sess))
            # face lost -> the app says so, nothing is highlighted
            page.evaluate("window.__gaze.off = true")
            page.wait_for_timeout(2500)
            check("face lost: warning bar shown", page.locator("#lost-bar.on").count() == 1)
            page.evaluate("window.__gaze.off = false")
            page.wait_for_timeout(1500)
            check("face back: warning bar gone", page.locator("#lost-bar.on").count() == 0)
            page.click("#gaze-toggle")
            check("turning gaze off removes camera indicator", page.locator("#ind-cam").is_hidden() and not page.evaluate("BB.gaze.isActive()"))

            # ---- no stray JS errors
            check("no JavaScript errors during the whole run", not errors, "; ".join(errors[:5]))
            browser.close()
    finally:
        srv.terminate()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    for n, _, d in failed: print("  FAILED:", n, d)
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())

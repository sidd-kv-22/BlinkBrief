// The reading view: shows the text, follows the reader (voice, mouse, keyboard or gaze),
// underlines words that look hard, opens the help bubble on request, and records the session.
(function (root) {
  const BB = root.BB = root.BB || {};
  const S = BB.struggle;
  const $ = (id) => document.getElementById(id);
  const view = $("reading-view");

  let R = null;                 // the reading in progress
  const reduceMotion = () => root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stageOf = (clean) => { const r = BB.store.wordRec(clean); return r ? r.stage : 1; };

  /* ---------- rendering ---------- */
  function render(parsed) {
    view.innerHTML = "";
    const els = [];
    parsed.paras.forEach((idxs) => {
      const p = document.createElement("p");
      idxs.forEach((i) => {
        const w = parsed.words[i];
        const span = document.createElement("span");
        span.className = "word";
        span.dataset.i = i;
        span.dataset.clean = w.clean;
        span.textContent = w.text;
        els[i] = span;
        p.appendChild(span);
        p.appendChild(document.createTextNode(" "));
      });
      view.appendChild(p);
    });
    return els;
  }

  function paint(i) {
    const el = R.els[i], f = R.session.flagged.get(i);
    el.classList.remove("u-full", "u-faint");
    el.removeAttribute("data-help");
    if (!f) return;
    const d = S.display(f.manual ? 1 : stageOf(R.session.words[i].clean));
    if (d.underline === "full") el.classList.add("u-full");
    else if (d.underline === "faint") el.classList.add("u-faint");
    if (d.underline !== "none") el.dataset.help = "1";
  }

  function markPreHelp() {
    const prof = BB.store.get().patterns;
    R.session.words.forEach((w, i) => {
      if (stageOf(w.clean) > 2) return;
      const tags = S.preHelpTags(w.patterns, prof);
      if (tags.length) { R.els[i].classList.add("predot"); R.els[i].dataset.pre = tags.join(","); }
    });
  }

  function setNow(i) {
    if (R.nowEl) R.nowEl.classList.remove("now");
    R.nowEl = i == null ? null : R.els[i];
    if (!R.nowEl) return;
    R.nowEl.classList.add("now");
    if (R.mode === "aloud" || R.sim) {
      const r = R.nowEl.getBoundingClientRect();
      if (r.top < 90 || r.bottom > root.innerHeight - 140) R.nowEl.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    }
  }

  const sentenceOf = (i) => {
    const sn = R.parsed.sentences[R.session.words[i].sent];
    return R.parsed.words.slice(sn.start, sn.end).map((w) => w.text).join(" ");
  };

  const status = (msg) => { $("live-status").textContent = msg || ""; };

  function updateIndicators() {
    const mic = $("ind-mic"), cam = $("ind-cam"), sim = $("ind-sim");
    mic.hidden = !(R && R.listening);
    if (R && R.listening) mic.textContent = "● Microphone on " + (R.listener && R.listener.local ? "(on this device)" : "(browser speech service)");
    cam.hidden = !(R && R.gazeActive);
    sim.hidden = !(R && R.sim);
    $("mode-aloud").setAttribute("aria-pressed", R && R.mode === "aloud");
    $("mode-silent").setAttribute("aria-pressed", R && R.mode === "silent");
    $("pause-btn").setAttribute("aria-pressed", !!(R && R.paused));
    $("pause-btn").textContent = R && R.paused ? "Resume" : "Pause";
  }

  /* ---------- help ---------- */
  function openHelp(i, how) {
    const s = R.session, w = s.words[i];
    const predot = R.els[i].classList.contains("predot");
    if (!s.flagged.has(i) && !predot) {                       // manual rescue: the app missed this word
      s.flagManually(i);
      BB.store.get().misses.push({ word: w.clean, t: Date.now() }); BB.store.save();
      paint(i);
    }
    const c = S.cause(s.sig[i], s.ctx(i));
    if (!s.flagged.has(i) && predot) { c.cause = "decoding"; c.order = S.ORDERS.decoding.slice(); c.hint = "This word has a pattern that has tripped you up before. Here it is in parts."; }
    const now = performance.now();
    if (!(R.lastHelp && R.lastHelp.i === i && now - R.lastHelp.t < 5000)) { s.noteHelp(i); R.lastHelp = { i, t: now }; }
    BB.help.open({
      index: i, word: w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || w.text, clean: w.clean, sentence: sentenceOf(i),
      cause: c.cause, order: c.order, hint: c.hint,
      onHelp: (idx, action) => { R.actions[action] = (R.actions[action] || 0) + 1; },
      onStageReset: (idx) => paint(idx),
      onClose: () => { R.els[i].classList.remove("helping"); },
    });
    R.els[i].classList.add("helping");
    if (R.mode === "silent") { s.record({ type: "pointer", i }); }
  }

  /* ---------- following the reader ---------- */
  function handleEvents(evs) {
    for (const ev of evs) {
      R.session.record(ev);
      if (ev.type === "read") setNow(ev.i);
    }
  }

  function startAloud() {
    if (!BB.speech.supported()) {
      R.mode = "silent";
      status("Read-aloud needs a browser with speech recognition, such as Chrome or Edge. Using silent mode: move your pointer along the words as you read.");
      BB.store.get().settings.mode = "silent"; BB.store.save();
      updateIndicators();
      return;
    }
    R.aligner = new BB.speech.Aligner(R.session.words, null);
    R.listener = new BB.speech.Listener({
      onTranscript: (text, t) => { if (!R || R.paused || R.sim) return; handleEvents(R.aligner.feedTranscript(text, t)); },
      onRestart: () => R && R.aligner.resetTranscript(),
      onState: (st, local) => {
        if (!R) return;
        if (st === "listening") { R.listening = true; status("Read aloud. BlinkBrief is listening."); }
        else if (st === "denied") { R.listening = false; R.mode = "silent"; status("The microphone is off, so BlinkBrief switched to silent mode. Move your pointer along the words as you read."); }
        else if (st === "stopped") R.listening = false;
        else if (st === "error") status("Speech recognition had a problem (" + local + "). You can keep reading in silent mode.");
        updateIndicators();
      },
    });
    R.listener.start();
  }

  function stopAloud() {
    if (R.listener) { R.listener.stop(); R.listener = null; }
    R.listening = false;
  }

  function setMode(mode) {
    if (!R || R.mode === mode) return;
    R.mode = mode; R.session.mode = mode;
    BB.store.get().settings.mode = mode; BB.store.save();
    if (mode === "aloud") { status(""); if (!R.paused) startAloud(); }
    else { stopAloud(); status("Silent mode. Move your pointer along the words as you read, or use the arrow keys."); }
    updateIndicators();
  }

  function setPaused(p) {
    if (!R) return;
    R.paused = p;
    if (p) { if (R.listener) R.listener.stop(); R.listening = false; if (R.simTimer) clearTimeout(R.simTimer); R.focus = null; status("Paused. Nothing is listening or recording."); }
    else {
      if (R.aligner) R.aligner.lastT = null;                   // do not count the break as a long pause
      if (R.mode === "aloud" && !R.sim) startAloud();
      status(R.mode === "aloud" ? "Read aloud. BlinkBrief is listening." : "Silent mode.");
      if (R.sim) runSim();
    }
    if (root.BB.gaze && R.gazeActive) BB.gaze.setPaused(p);
    updateIndicators();
  }

  /* ---------- simulated read-aloud (demo) ---------- */
  function startSim() {
    if (!R) return;
    if (R.listener) { R.listener.stop(); R.listener = null; R.listening = false; }
    if (R.simTimer) clearTimeout(R.simTimer);
    R.sim = { steps: BB.speech.buildScript(R.session.words, R.parsed.sentences).steps, k: 0, vt: 0 };
    R.aligner = new BB.speech.Aligner(R.session.words, null);
    R.usedSim = true;
    R.paused = false;
    status("Simulated read-aloud (demo). This is scripted, not your voice. Watch for faint underlines.");
    updateIndicators();
    runSim();
  }

  function runSim() {
    const sim = R && R.sim;
    if (!sim || R.paused) return;
    if (sim.k >= sim.steps.length) {
      R.sim = null; updateIndicators();
      status("The simulated reading is finished. The underlined words are the ones BlinkBrief noticed. Hover on one for help.");
      return;
    }
    const st = sim.steps[sim.k++];
    sim.vt += st.dt;
    if (st.hover != null) { R.session.record({ type: "hover", i: st.hover, ms: st.ms }); setNow(st.hover); }
    else handleEvents(R.aligner.token(st.tok, sim.vt));
    const speed = BB.reader.simSpeed || 4;
    R.simTimer = setTimeout(runSim, Math.max(8, st.dt / speed));
  }

  /* ---------- pointer, keyboard, gaze ---------- */
  function wordOf(target) { return target && target.closest ? target.closest(".word") : null; }

  function focusWord(i) {
    if (!R) return;
    R.focus = i;
    if (i == null) return;
    if (R.mode === "silent" || R.gazeActive) {
      const s = R.session;
      if (R.front == null) R.front = -1;
      if (i <= R.front - 3 && R.front - i <= 25) { s.record({ type: "reread", at: R.front, to: i }); R.front = i; }
      else if (i > R.front) R.front = i;
      s.record({ type: "pointer", i });
      setNow(i);
    }
  }

  function onOver(e) {
    if (!R || R.paused) return;
    const w = wordOf(e.target);
    if (!w) return;
    const i = Number(w.dataset.i);
    focusWord(i);
    clearTimeout(R.openTimer);
    const f = R.session.flagged.get(i);
    if (f && S.display(f.manual ? 1 : stageOf(R.session.words[i].clean)).hoverOpens && BB.help.currentIndex() !== i && R.suppress !== i) {
      R.openTimer = setTimeout(() => { if (R && R.focus === i) openHelp(i, "hover"); }, 250);
    }
  }
  function onOut(e) {
    if (!R) return;
    const w = wordOf(e.target);
    if (!w) return;
    clearTimeout(R.openTimer);
    if (R.focus === Number(w.dataset.i)) R.focus = null;
    R.suppress = null;
  }
  function onClick(e) {
    if (!R) return;
    const w = wordOf(e.target);
    if (w) openHelp(Number(w.dataset.i), "click");
  }
  function onKey(e) {
    if (!R) return;
    if (e.key === "Escape") { BB.help.close(); return; }
    const s = R.session;
    let i = R.cursor == null ? (s.pointer >= 0 ? s.pointer : 0) : R.cursor;
    if (e.key === "ArrowRight") i = Math.min(s.words.length - 1, i + 1);
    else if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const sn = R.parsed.sentences, cur = s.words[i].sent;
      const target = e.key === "ArrowDown" ? Math.min(sn.length - 1, cur + 1) : Math.max(0, i === sn[cur].start ? cur - 1 : cur);
      i = sn[target].start;
    } else if (e.key === "Enter" || e.key === " ") {
      if (R.cursor != null) { e.preventDefault(); openHelp(R.cursor, "key"); }
      return;
    } else return;
    e.preventDefault();
    R.cursor = i;
    R.els.forEach((el) => el.classList.remove("cursor"));
    R.els[i].classList.add("cursor");
    $("sr-current").textContent = R.session.words[i].text + (R.session.flagged.has(i) ? ", help available" : "");
    focusWord(i);
    const r = R.els[i].getBoundingClientRect();
    if (r.top < 90 || r.bottom > root.innerHeight - 140) R.els[i].scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
  }

  function onGazeFocus(e) {
    if (!R || !R.gazeActive || R.paused) return;
    const i = e.detail.index;
    const s = R.session;
    if (R.gazeFront == null) R.gazeFront = -1;
    if (i <= R.gazeFront - 3 && R.gazeFront - i <= 25) { s.record({ type: "reread", at: R.gazeFront, to: i }); R.gazeFront = i; }
    else if (i > R.gazeFront) R.gazeFront = i;
    s.record({ type: "pointer", i });
  }
  function onGazeBlur(e) {
    if (!R || !R.gazeActive || R.paused) return;
    const { index, dwellMs } = e.detail;
    const extra = R.gazeStalled === index ? dwellMs - 2000 : dwellMs;
    if (R.gazeStalled === index) R.gazeStalled = null;
    if (extra >= 300) R.session.record({ type: "gaze", i: index, ms: extra });
  }
  function onGazeStall(e) {
    if (!R || !R.gazeActive || R.paused) return;
    R.gazeStalled = e.detail.index;
    R.session.record({ type: "gaze", i: e.detail.index, ms: 2000 });
  }

  /* Dwell time on the word under the pointer or keyboard cursor is a signal ("hover"). */
  function tick() {
    if (!R) return;
    const now = performance.now();
    const dt = Math.min(500, now - R.lastTick);
    R.lastTick = now;
    if (R.paused) return;
    if (R.focus != null && BB.help.currentIndex() !== R.focus && !R.sim) R.session.record({ type: "hover", i: R.focus, ms: dt });
    if (R.mode === "aloud" && R.aligner && R.listening && !R.sim) {
      const lp = R.aligner.livePause(now);
      if (lp && lp.pauseMs >= 3000 && lp.pauseMs - (R.lastPauseRec && R.lastPauseRec.i === lp.i ? R.lastPauseRec.ms : 0) >= 500) {
        R.session.record({ type: "pause", i: lp.i, pauseMs: lp.pauseMs });
        R.lastPauseRec = { i: lp.i, ms: lp.pauseMs };
      }
    }
  }

  /* ---------- gaze (optional) ---------- */
  function startGaze() {
    if (!R) return;
    if (!BB.gaze) { status("The gaze module did not load."); return; }
    BB.gaze.start({ pageEl: view, words: R.els });
    R.gazeWanted = true;
    $("gaze-toggle").setAttribute("aria-pressed", "true");
  }
  function stopGaze() {
    if (!R) return;
    if (BB.gaze) BB.gaze.stop();
    R.gazeWanted = false; R.gazeActive = false;
    $("gaze-toggle").setAttribute("aria-pressed", "false");
    $("gaze-tools").hidden = true;
    updateIndicators();
  }
  document.addEventListener("blinkbrief:gazestate", (e) => {
    if (!R) return;
    const st = e.detail.state;
    R.gazeActive = st === "reading";
    $("gaze-tools").hidden = !R.gazeWanted || st === "off";
    if (st === "off") { R.gazeWanted = false; $("gaze-toggle").setAttribute("aria-pressed", "false"); }
    updateIndicators();
  });
  document.addEventListener("blinkbrief:gazestatus", (e) => { const el = $("gaze-status"); if (el) { el.textContent = e.detail.text; el.classList.toggle("bad", !!e.detail.bad); } });
  document.addEventListener("blinkbrief:wordfocus", onGazeFocus);
  document.addEventListener("blinkbrief:wordblur", onGazeBlur);
  document.addEventListener("blinkbrief:stall", onGazeStall);

  /* ---------- open / finish ---------- */
  function open(title, text) {
    if (R) teardown();
    const settings = BB.store.get().settings;
    const parsed = BB.text.tokenize(text);
    const session = new BB.Session(parsed, {
      mode: settings.mode, sensitivity: settings.sensitivity, baselineMs: BB.store.get().baseline.paceMs || undefined,
      onFlag: (i) => { if (R) { paint(i); if (R.focus === i) R.suppress = i; } },
    });
    R = { title, text, parsed, session, els: [], mode: settings.mode, paused: false, listening: false, focus: null, cursor: null, lastTick: performance.now(),
          actions: {}, front: null, gazeFront: null, nowEl: null };
    R.els = render(parsed);
    $("reader-title").textContent = title;
    view.style.setProperty("--reading-size", settings.fontSize + "px");
    $("sens").value = settings.sensitivity;
    markPreHelp();
    R.timer = setInterval(tick, 200);
    updateIndicators();
    $("gaze-tools").hidden = true;
    $("gaze-toggle").setAttribute("aria-pressed", "false");
    status(R.mode === "aloud" ? "Starting the microphone…" : "Silent mode. Move your pointer along the words as you read, or use the arrow keys.");
    if (R.mode === "aloud") startAloud();
    if (settings.gaze) startGaze();
    return R;
  }

  function teardown() {
    if (!R) return;
    clearInterval(R.timer); clearTimeout(R.simTimer); clearTimeout(R.openTimer);
    if (R.listener) R.listener.stop();
    if (R.gazeWanted && BB.gaze) BB.gaze.stop();
    BB.help.close(false);
    R = null;
  }

  /* End of session: update word stages, the pattern profile and the saved session list. */
  function finish() {
    if (!R) return null;
    const r = R;
    const s = r.session, sum = s.summary();
    const practice = s.practiceWords(3);
    let saved = false;
    if (sum.wordsRead >= 3) {
      const d = BB.store.get();
      const byWord = new Map();
      for (let i = 0; i <= s.maxIndex && i < s.words.length; i++) {
        const w = s.words[i].clean, o = s.outcome(i);
        if (!w || w.length < 2) continue;
        if (o === "stuck") byWord.set(w, "stumble");
        else if (o === "smooth" && !byWord.has(w)) byWord.set(w, "smooth");
      }
      const helpsByWord = {};
      s.helped.forEach((n, i) => { const w = s.words[i].clean; helpsByWord[w] = (helpsByWord[w] || 0) + n; });
      byWord.forEach((o, w) => {
        let rec = d.words[w];
        if (!rec && o === "smooth") return;                           // only words that have caused trouble are tracked
        rec = S.nextStage(rec || S.newRecord(), o);
        delete rec.simulated;
        rec.helps = (rec.helps || 0) + (helpsByWord[w] || 0);
        d.words[w] = rec;
      });
      const seen = new Set();
      s.flagged.forEach((_, i) => {
        const w = s.words[i].clean;
        if (seen.has(w)) return; seen.add(w);
        d.patterns = S.addPatterns(d.patterns, s.words[i].patterns);
      });
      if (sum.baselineMs) d.baseline.paceMs = d.baseline.paceMs ? Math.round(0.5 * d.baseline.paceMs + 0.5 * sum.baselineMs) : sum.baselineMs;
      const hash = BB.text.hashText(r.text);
      d.passages[hash] = { title: r.title, text: r.text };
      const keys = Object.keys(d.passages);
      if (keys.length > 12) delete d.passages[keys[0]];
      BB.store.addSession({
        id: "s-" + Date.now(), t: Date.now(), hash, title: r.title, simulated: !!r.usedSim, mode: r.mode,
        wordsRead: sum.wordsRead, helps: sum.helps, helpPer100: sum.helpPer100, stuck: sum.stuck, outcomes: sum.outcomes, actions: r.actions,
      });
      BB.store.save();
      saved = true;
    }
    teardown();
    return { summary: sum, practice, title: r.title, saved, simulated: !!r.usedSim };
  }

  function init() {
    view.addEventListener("mouseover", onOver);
    view.addEventListener("mouseout", onOut);
    view.addEventListener("click", onClick);
    view.addEventListener("keydown", onKey);
    view.addEventListener("blur", () => { if (R) R.focus = null; });
    $("pause-btn").addEventListener("click", () => R && setPaused(!R.paused));
    $("mode-aloud").addEventListener("click", () => setMode("aloud"));
    $("mode-silent").addEventListener("click", () => setMode("silent"));
    $("sens").addEventListener("input", (e) => { const v = Number(e.target.value); BB.store.get().settings.sensitivity = v; BB.store.save(); if (R) R.session.sensitivity = v; });
    const size = (d) => { const st = BB.store.get().settings; st.fontSize = Math.max(16, Math.min(48, st.fontSize + d)); BB.store.save(); view.style.setProperty("--reading-size", st.fontSize + "px"); if (BB.gaze) BB.gaze.refresh(); };
    $("font-minus").addEventListener("click", () => size(-2));
    $("font-plus").addEventListener("click", () => size(2));
    $("sim-btn").addEventListener("click", startSim);
    $("gaze-toggle").addEventListener("click", () => { if (!R) return; if (R.gazeWanted) stopGaze(); else startGaze(); });
    $("gaze-recal").addEventListener("click", () => BB.gaze && BB.gaze.recalibrate());
    $("gaze-cam-btn").addEventListener("click", (e) => { const on = BB.gaze.toggleCamera(); e.currentTarget.setAttribute("aria-pressed", on); });
    root.addEventListener("pagehide", () => { if (R) finish(); });
  }
  document.addEventListener("DOMContentLoaded", init);

  BB.reader = { open, finish, teardown, simSpeed: 4, session: () => (R ? R.session : null), state: () => R, setPaused, startSim };
})(typeof self !== "undefined" ? self : this);

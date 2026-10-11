// Read-aloud tracking: line up what the learner says with the text and turn it into signals
// (word time, pauses, repeats, wrong words, re-reading). Also wraps the browser's speech recognition
// and provides a scripted "simulated read-aloud" so the whole loop can be demonstrated without a microphone.
// The Aligner is pure logic (testable in Node); Listener and listenOnce need a browser.
(function (root, factory) {
  const isNode = typeof require === "function" && typeof module === "object";
  const api = factory(root, isNode ? require("./textproc.js") : root.BB.text);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.BB = root.BB || {}; root.BB.speech = api; }
})(typeof self !== "undefined" ? self : this, function (root, T) {
  const NUMBERS = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };
  const norm = (t) => { const c = T.clean(t); return NUMBERS[c] || c; };
  const sim = (a, b) => T.similarity(norm(a), norm(b));

  const MATCH = 0.8, LOOK = 0.85, PARTIAL = 0.4;

  /* Aligner: feed it recognised words with times; it emits events about the text word the reader is on.
     Events: read {i, pauseMs}, repeat {i}, mismatch {i, value}, skip {i}, reread {at, to}. */
  class Aligner {
    constructor(words, startT) {
      this.w = words.map((x) => norm(x.clean != null ? x.clean : x));
      this.p = 0;                     // next expected word
      this.lastT = startT == null ? null : startT;
      this.pending = null;            // index of a word the reader has just got wrong
      this.consumed = 0;              // transcript tokens already handled
    }
    resetTranscript() { this.consumed = 0; }

    /* Full transcript so far (speech recognisers revise earlier words, so only new tail words are used). */
    feedTranscript(text, t) {
      const toks = String(text).split(/\s+/).filter(Boolean);
      const evs = [];
      for (let k = this.consumed; k < toks.length; k++) evs.push(...this.token(toks[k], t));
      this.consumed = Math.max(this.consumed, toks.length);
      return evs;
    }

    token(tok, t) {
      const evs = [];
      const n = this.w.length;
      if (this.p >= n) return evs;
      const p = this.p;
      const first = this.lastT == null;
      const pause = () => (first ? 0 : Math.max(0, t - this.lastT));
      const done = (i) => { evs.push({ type: "read", i, pauseMs: pause(), t }); this.lastT = t; this.p = i + 1; };

      if (sim(tok, this.w[p]) >= MATCH) {
        if (this.pending === p) { evs.push({ type: "repeat", i: p }); this.pending = null; }
        done(p);
        return evs;
      }
      for (let k = 1; k <= 3 && p + k < n; k++) {                          // reader skipped ahead
        if (sim(tok, this.w[p + k]) >= LOOK) {
          for (let q = p; q < p + k; q++) {
            if (q === this.pending) { evs.push({ type: "read", i: q, pauseMs: pause(), t }); this.pending = null; }   // mumbled through it
            else evs.push({ type: "skip", i: q });
          }
          done(p + k);
          return evs;
        }
      }
      for (let j = p - 1; j >= Math.max(0, p - 15); j--) {                 // reader went back
        if (sim(tok, this.w[j]) >= LOOK) {
          if (j === p - 1) evs.push({ type: "repeat", i: j });
          else { evs.push({ type: "reread", at: p - 1, to: j }); this.p = j + 1; }
          this.lastT = t;
          return evs;
        }
      }
      const s0 = sim(tok, this.w[p]);
      if (s0 >= PARTIAL) { evs.push({ type: "mismatch", i: p, value: 1 - s0 }); this.pending = p; }   // close but not right
      return evs;                                                          // anything else is treated as noise ("um", a cough)
    }

    /* How long the reader has been silent on the current word (for flagging a long pause as it happens). */
    livePause(t) { return this.lastT == null || this.p >= this.w.length ? null : { i: this.p, pauseMs: t - this.lastT }; }
  }

  /* ---------- simulated read-aloud ----------
     Builds a scripted reading of the text that stumbles in three ways (one per cause rule) so the demo
     can show different help for each. It feeds the same Aligner and Session as real speech. */
  function buildScript(words, sentences, opts) {
    opts = opts || {};
    const pace = opts.paceMs || 420;
    const toks = words.map((w) => w.clean);
    const info = words.map((w) => ({ rar: T.rarity(w.clean), len: w.clean.length }));
    const usable = (i) => toks[i] && toks[i].length >= 4;
    // decoding: the longest rare word; vocabulary: the next rarest mid-length word; meaning: a later sentence
    const byLen = words.map((_, i) => i).filter(usable).sort((a, b) => info[b].len - info[a].len || info[b].rar - info[a].rar);
    const dec = byLen[0];
    const vocab = byLen.find((i) => i !== dec && info[i].rar >= 0.45 && info[i].len <= 9 && Math.abs(i - dec) > 4 && !/(ed|ing|ly)$/.test(toks[i]));
    let meanSent = null;
    for (let s = sentences.length - 1; s >= 0; s--) {
      const sn = sentences[s];
      if (sn.end - sn.start >= 5 && !(dec >= sn.start && dec < sn.end)) { meanSent = sn; break; }
    }
    const steps = [];   // {dt, tok} or {dt, hover: i, ms}
    const push = (dt, tok) => steps.push({ dt, tok });
    for (let i = 0; i < toks.length; i++) {
      if (i === dec) {
        const w = toks[i];
        push(2900, w.slice(0, Math.max(2, Math.ceil(w.length / 2.5))) + "er");   // long pause, then a wrong / split attempt
        push(900, w);                                                            // then the right word
        continue;
      }
      push(pace + ((i * 37) % 120), toks[i]);
      if (i === vocab) steps.push({ dt: 400, hover: i, ms: 3000 });             // read smoothly, then hovers on it
      if (meanSent && i === meanSent.end - 1) {                                  // finishes the sentence, then reads it again
        for (let k = meanSent.start; k < meanSent.end; k++) push(k === meanSent.start ? 700 : pace, toks[k]);
        meanSent = null;
      }
    }
    return { steps, targets: { decoding: dec, vocabulary: vocab, meaning: null } };
  }

  /* ---------- browser speech recognition ---------- */
  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  const supported = () => !!SR;

  /* Continuous listening. Tries on-device recognition first (privacy); reports which is in use. */
  class Listener {
    constructor(h) { this.h = h; this.running = false; this.local = false; this.rec = null; }
    start() {
      if (!SR) { this.h.onState && this.h.onState("unsupported"); return false; }
      this.running = true;
      this._make(true);
      return true;
    }
    _make(tryLocal) {
      const rec = new SR();
      rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
      let local = false;
      if (tryLocal && "processLocally" in rec) { try { rec.processLocally = true; local = true; } catch (_) { local = false; } }
      this.local = local;
      rec.onstart = () => this.h.onState && this.h.onState("listening", this.local);
      rec.onresult = (e) => {
        let text = "";
        for (let k = 0; k < e.results.length; k++) text += e.results[k][0].transcript + " ";
        this.h.onTranscript && this.h.onTranscript(text.trim(), performance.now());
      };
      rec.onerror = (e) => {
        if (e.error === "language-not-supported" && this.local) { this.rec = null; this._make(false); return; }   // no on-device pack: use the browser's service
        if (e.error === "not-allowed" || e.error === "service-not-allowed") { this.running = false; this.h.onState && this.h.onState("denied"); return; }
        if (e.error !== "no-speech" && e.error !== "aborted") this.h.onState && this.h.onState("error", e.error);
      };
      rec.onend = () => {
        this.h.onRestart && this.h.onRestart();
        if (this.running) { try { rec.start(); } catch (_) { setTimeout(() => this.running && this._make(this.local), 300); } }
        else this.h.onState && this.h.onState("stopped");
      };
      this.rec = rec;
      try { rec.start(); } catch (_) { if (this.local) this._make(false); }
    }
    stop() { this.running = false; try { this.rec && this.rec.stop(); } catch (_) {} }
  }

  /* One short attempt, for "Say it". Resolves {heard} or {error}. */
  function listenOnce(timeoutMs) {
    return new Promise((resolve) => {
      if (!SR) return resolve({ error: "unsupported" });
      const rec = new SR();
      rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 3;
      if ("processLocally" in rec) { try { rec.processLocally = true; } catch (_) {} }
      let finished = false;
      const finish = (v) => { if (!finished) { finished = true; clearTimeout(timer); try { rec.stop(); } catch (_) {} resolve(v); } };
      const timer = setTimeout(() => finish({ error: "no-speech" }), timeoutMs || 6000);
      rec.onresult = (e) => finish({ heard: [...e.results[0]].map((a) => a.transcript.trim().toLowerCase()) });
      rec.onerror = (e) => finish({ error: e.error || "error" });
      rec.onend = () => finish({ error: "no-speech" });
      try { rec.start(); } catch (_) { finish({ error: "error" }); }
    });
  }

  return { Aligner, buildScript, Listener, listenOnce, supported, norm, sim };
});

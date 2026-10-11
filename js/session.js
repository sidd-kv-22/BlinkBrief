// One reading session: collects signals per word, scores them and decides when to flag a word.
// Signals come from read-aloud timing (speech.js), mouse/keyboard (reader.js) and optional gaze (gaze.js).
// Pure logic (no DOM). Loaded as window.BB.Session.
(function (root, factory) {
  const isNode = typeof require === "function" && typeof module === "object";
  const api = factory(isNode ? require("./struggle.js") : root.BB.struggle, isNode ? require("./textproc.js") : root.BB.text);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.BB = root.BB || {}; root.BB.Session = api; }
})(typeof self !== "undefined" ? self : this, function (S, T) {
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  class Session {
    /* parsed: result of BB.text.tokenize; opts: {mode, sensitivity, baselineMs, onFlag(i, info), onChange()} */
    constructor(parsed, opts) {
      opts = opts || {};
      this.parsed = parsed;
      this.words = parsed.words.map((w) => ({
        i: w.i, text: w.text, clean: w.clean, sent: w.sent,
        len: w.clean.length, rarity: T.rarity(w.clean), syll: T.syllableCount(w.clean), patterns: T.patterns(w.clean),
      }));
      this.mode = opts.mode || "silent";
      this.sensitivity = opts.sensitivity == null ? 0.5 : opts.sensitivity;
      this.baselineMs = opts.baselineMs || S.CONFIG.defaultBaselineMs;
      this.onFlag = opts.onFlag || (() => {});
      this.onChange = opts.onChange || (() => {});
      this.sig = this.words.map(() => ({ pauseMs: 0, repeats: 0, mismatch: 0, reread: 0, hoverMs: 0, gazeMs: 0, regress: 0, speech: false }));
      this.maxScore = this.words.map(() => 0);
      this.flagged = new Map();          // i -> {score, cause, at}
      this.helped = new Map();           // i -> number of help requests
      this.manual = new Set();           // flagged by the learner (missed by the app)
      this.skipped = new Set();
      this.maxIndex = -1;
      this.pointer = -1;
      this.pace = [];
      this.helpRequests = 0;
      this.startedAt = Date.now();
    }

    ctx(i) {
      const w = this.words[i];
      return { baselineMs: this.baselineMs, len: w.len, rarity: w.rarity, hoverWeight: 1 };
    }
    threshold() { return S.threshold(this.sensitivity); }

    evaluate(i) {
      const r = S.score(this.sig[i], this.ctx(i));
      if (r.score > this.maxScore[i]) this.maxScore[i] = r.score;
      if (r.score >= this.threshold() && !this.flagged.has(i)) {
        const c = S.cause(this.sig[i], this.ctx(i));
        const info = { score: r.score, cause: c.cause, at: Date.now() };
        this.flagged.set(i, info);
        this.onFlag(i, info);
      }
      return r;
    }

    /* The hardest word in [from, to], used to anchor a sentence-level signal (re-reading) to one word. */
    hardest(from, to) {
      let best = Math.min(to, this.words.length - 1), bs = -1;
      for (let i = Math.max(0, from); i <= to && i < this.words.length; i++) {
        const w = this.words[i];
        const s = w.rarity * 2 + w.len / 10 + w.syll / 5;
        if (s > bs) { bs = s; best = i; }
      }
      return best;
    }

    /* Events: read, repeat, mismatch, skip, reread, hover, gaze, regress, pointer. */
    record(ev) {
      const n = this.words.length;
      const i = ev.i;
      switch (ev.type) {
        case "read": {
          const g = this.sig[i]; g.speech = true; g.pauseMs = Math.max(g.pauseMs, ev.pauseMs || 0);
          if (ev.pauseMs > 0 && ev.pauseMs < 6000) this.pace.push(ev.pauseMs);
          if (i > this.maxIndex) this.maxIndex = i;
          this.pointer = i; this.evaluate(i); break;
        }
        case "repeat": this.sig[i].speech = true; this.sig[i].repeats += 1; this.evaluate(i); break;
        case "mismatch": this.sig[i].speech = true; this.sig[i].mismatch = Math.max(this.sig[i].mismatch, ev.value == null ? 0.6 : ev.value); this.evaluate(i); break;
        case "skip": this.skipped.add(i); if (i > this.maxIndex) this.maxIndex = i; break;
        case "reread": {                         // the reader went back: anchor it to the hardest word of the re-read stretch
          const k = this.hardest(ev.to, ev.at);
          this.sig[k].reread = 1; this.evaluate(k); break;
        }
        case "pause": { const g = this.sig[i]; g.pauseMs = Math.max(g.pauseMs, ev.pauseMs); g.speech = true; this.evaluate(i); break; }
        case "hover": this.sig[i].hoverMs += ev.ms; this.evaluate(i); break;
        case "gaze": this.sig[i].gazeMs += ev.ms; this.evaluate(i); break;
        case "regress": this.sig[i].regress += 1; this.evaluate(i); break;
        case "pointer": {                         // silent mode: where the reader's pointer (mouse or keyboard) is
          if (i > this.maxIndex) this.maxIndex = i;
          this.pointer = i; break;
        }
        default: break;
      }
      this.onChange(ev);
      return i != null && i >= 0 && i < n ? this.sig[i] : null;
    }

    flagManually(i) {
      if (!this.flagged.has(i)) { this.flagged.set(i, { score: 1, cause: "unclear", at: Date.now(), manual: true }); this.manual.add(i); this.onFlag(i, this.flagged.get(i)); }
      if (i > this.maxIndex) this.maxIndex = i;
    }
    noteHelp(i) { this.helped.set(i, (this.helped.get(i) || 0) + 1); this.helpRequests += 1; }

    /* Outcome for the heatmap and for the stage updates. */
    outcome(i) {
      if (this.flagged.has(i) || this.helped.has(i)) return "stuck";
      if (i > this.maxIndex) return "unread";
      if (this.maxScore[i] >= 0.6 * this.threshold()) return "slowed";
      return "smooth";
    }

    wordsRead() { return this.maxIndex + 1; }
    helpPer100() { const r = this.wordsRead(); return r > 0 ? (this.helpRequests / r) * 100 : 0; }

    summary() {
      const outcomes = {};
      let stuck = 0;
      for (let i = 0; i <= this.maxIndex && i < this.words.length; i++) {
        const o = this.outcome(i);
        if (o !== "smooth") outcomes[i] = o;
        if (o === "stuck") stuck++;
      }
      return {
        wordsRead: this.wordsRead(), helps: this.helpRequests, helpPer100: this.helpPer100(), stuck, outcomes,
        baselineMs: this.pace.length >= 8 ? Math.round(median(this.pace)) : null,
      };
    }

    /* Three words most worth practising: stuck words ranked by score and help used. */
    practiceWords(max) {
      const list = [];
      for (let i = 0; i < this.words.length; i++) {
        if (!this.flagged.has(i) && !this.helped.has(i)) continue;
        if (!this.words[i].clean || this.words[i].len < 3) continue;
        list.push({ i, word: this.words[i].clean, rank: this.maxScore[i] + (this.helped.get(i) || 0) * 0.3 });
      }
      list.sort((a, b) => b.rank - a.rank);
      const seen = new Set(), out = [];
      for (const x of list) { if (seen.has(x.word)) continue; seen.add(x.word); out.push(x); if (out.length >= (max || 3)) break; }
      return out;
    }
  }

  return Session;
});

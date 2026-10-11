// Help content: meanings, easier sentences and syllables.
// Order of sources: cache -> optional local backend (language model) -> built-in lists -> a plain fallback.
// The app works with no backend at all. If the backend is running, only the word and its sentence are sent to it.
(function (root) {
  const BB = root.BB = root.BB || {};
  const G = BB.GLOSSARY || { MEANINGS: {}, EASIER: [], SIMPLER: {} };
  const TIMEOUT_MS = 1800;                       // design target: help appears within about 2 seconds

  const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const easierMap = new Map(G.EASIER.map(([a, b]) => [key(a), b]));
  const state = { up: false, llm: false, pyphen: false, probed: false };

  async function post(path, body, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || TIMEOUT_MS);
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) throw new Error("http " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  /* Is the optional backend there? (Not when the page is opened straight from a file.) */
  async function probe() {
    if (location.protocol === "file:") { state.probed = true; return state; }
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 800);
      const r = await fetch("/api/health", { signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json();
      state.up = true; state.llm = !!j.llm; state.pyphen = !!j.pyphen;
    } catch (_) { state.up = false; state.llm = false; state.pyphen = false; }
    state.probed = true;
    return state;
  }

  const cacheGet = (k) => BB.store.get().cache[k] || null;
  function cacheSet(k, v) {
    const c = BB.store.get().cache;
    c[k] = v;
    const keys = Object.keys(c);
    if (keys.length > 300) delete c[keys[0]];
    BB.store.save();
  }

  function timed(p) {
    const t0 = performance.now();
    return p.then((r) => {
      const ms = Math.round(performance.now() - t0);
      const L = BB.store.get().latencies; L.push(ms); if (L.length > 300) L.shift(); BB.store.save();
      r.ms = ms; return r;
    });
  }

  /* ---------- syllables ---------- */
  function syllablesLocal(word) { return BB.text.syllables(word); }
  async function syllables(word) {
    const local = syllablesLocal(word);
    if (!state.up || !state.pyphen) return local;
    const k = "syl:" + word;
    const c = cacheGet(k);
    if (c) return c.text.split("-");
    try {
      const j = await post("/api/syllables", { word }, 800);
      if (j && j.syllables && j.syllables.length) { cacheSet(k, { text: j.syllables.join("-"), source: "pyphen" }); return j.syllables; }
    } catch (_) { /* keep the local split */ }
    return local;
  }

  /* ---------- meaning ---------- */
  function meaningLocal(word) {
    const m = G.MEANINGS[word.toLowerCase()];
    if (m) return { text: m, source: "built-in list" };
    return { text: "There is no built-in meaning for “" + word + "” yet. Try the words around it, or ask someone to explain it. A language-model backend can give meanings for any word.", source: "none" };
  }

  function meaning(word, sentence) {
    return timed((async () => {
      const k = "m:" + word.toLowerCase() + "|" + key(sentence || "");
      const c = cacheGet(k);
      if (c) return { text: c.text, source: c.source + " (cached)" };
      if (state.up && state.llm) {
        try {
          const j = await post("/api/meaning", { word, sentence });
          if (j && j.text) { cacheSet(k, { text: j.text, source: j.source || "language model" }); return { text: j.text, source: j.source || "language model" }; }
        } catch (_) { /* too slow or offline: fall back */ }
      }
      return meaningLocal(word);
    })());
  }

  /* ---------- easier sentence ---------- */
  function splitLong(s) {
    const words = s.split(/\s+/);
    if (words.length < 16) return s;
    const m = s.match(/^(.{20,}?),?\s+(and|but|because|which|so|while)\s+(.{12,})$/i);
    if (!m) return s;
    const tail = m[3].charAt(0).toUpperCase() + m[3].slice(1);
    const joiner = /^(because|which)$/i.test(m[2]) ? m[2].charAt(0).toUpperCase() + m[2].slice(1) + " " : "";
    return m[1].replace(/[,;]$/, "") + ". " + joiner + tail;
  }
  function simplifyLocal(sentence) {
    const known = easierMap.get(key(sentence));
    if (known) return { text: known, source: "built-in list" };
    let changed = false;
    let out = sentence.replace(/\p{L}+/gu, (w) => {
      const s = G.SIMPLER[w.toLowerCase()];
      if (!s) return w;
      changed = true;
      return w[0] === w[0].toUpperCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    });
    const split = splitLong(out);
    if (split !== out) { out = split; changed = true; }
    if (!changed) return { text: sentence, source: "none", same: true };
    return { text: out, source: "simple rules" };
  }

  function simplify(sentence) {
    return timed((async () => {
      const k = "s:" + key(sentence);
      const c = cacheGet(k);
      if (c) return { text: c.text, source: c.source + " (cached)" };
      if (state.up && state.llm) {
        try {
          const j = await post("/api/simplify", { sentence });
          if (j && j.text) { cacheSet(k, { text: j.text, source: j.source || "language model" }); return { text: j.text, source: j.source || "language model" }; }
        } catch (_) { /* fall back */ }
      }
      return simplifyLocal(sentence);
    })());
  }

  function flagBad(kind, word, text) {
    const d = BB.store.get();
    d.flags.push({ kind, word, text, t: Date.now() });
    // a flagged explanation should not come back from the cache
    for (const k of Object.keys(d.cache)) if (d.cache[k].text === text) delete d.cache[k];
    BB.store.save();
  }

  BB.api = { state, probe, syllables, syllablesLocal, meaning, meaningLocal, simplify, simplifyLocal, flagBad, key };
})(typeof self !== "undefined" ? self : this);

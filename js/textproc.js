// Text analysis: words, sentences, syllables, rarity and spelling patterns.
// Pure logic (no DOM) so it can be tested in Node. Loaded as window.BB.text in the browser.
(function (root, factory) {
  const api = factory(typeof require === "function" && typeof module === "object" ? require("../data/common-words.js") : root.BB && root.BB.COMMON);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.BB = root.BB || {}; root.BB.text = api; }
})(typeof self !== "undefined" ? self : this, function (COMMON) {
  COMMON = COMMON || new Set();

  const ABBREV = /^(mr|mrs|ms|dr|st|vs|e\.g|i\.e|etc|prof|jr|sr)\.$/i;

  function clean(token) {
    return String(token).toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "").replace(/[’]/g, "'");
  }

  /* Split text into paragraphs, sentences and words.
     Returns { paras: [[wordIndex,...]], words: [{i, text, clean, sent, para}], sentences: [{start, end}] } (end is exclusive). */
  function tokenize(text) {
    const paras = [], words = [], sentences = [];
    let sentStart = 0;
    String(text).split(/\n\s*\n/).forEach((para) => {
      const toks = para.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) return;
      const idxs = [];
      toks.forEach((tok, k) => {
        const i = words.length;
        words.push({ i, text: tok, clean: clean(tok), sent: sentences.length, para: paras.length });
        idxs.push(i);
        const next = toks[k + 1];
        const endsSentence = /[.!?]["'”’)\]]*$/.test(tok) && !ABBREV.test(tok) &&
          (!next || /^["'“‘(\[]?[\p{Lu}\d]/u.test(next));
        if (endsSentence || !next) {
          if (!next && !endsSentence) { /* paragraph ends without punctuation: still a sentence boundary */ }
          sentences.push({ start: sentStart, end: i + 1 });
          sentStart = i + 1;
        }
      });
      paras.push(idxs);
    });
    return { paras, words, sentences };
  }

  /* ---------- syllables ---------- */
  const OVERRIDES = {
    thorough: "thor-ough", careful: "care-ful", enormous: "e-nor-mous", necessary: "nec-es-sar-y",
    mysterious: "mys-te-ri-ous", adventure: "ad-ven-ture", certain: "cer-tain", scientist: "sci-en-tist",
    results: "re-sults", different: "dif-fer-ent", through: "through", although: "al-though", enough: "e-nough",
    business: "busi-ness", island: "is-land", knowledge: "knowl-edge", environment: "en-vi-ron-ment",
    difficult: "dif-fi-cult", beautiful: "beau-ti-ful", comfortable: "com-fort-a-ble", rhythm: "rhy-thm",
    exhausted: "ex-haust-ed", cognitive: "cog-ni-tive", complex: "com-plex", structures: "struc-tures",
    disruption: "dis-rup-tion", developmental: "de-vel-op-men-tal", dyslexia: "dys-lex-i-a",
    accurate: "ac-cu-rate", decoding: "de-cod-ing", profound: "pro-found", processing: "pro-cess-ing",
    assistance: "as-sis-tance", experience: "ex-pe-ri-ence", fisherman: "fish-er-man", harbour: "har-bour",
    gently: "gen-tly", wooden: "wood-en", appeared: "ap-peared", single: "sin-gle", glacier: "gla-cier",
    avalanche: "av-a-lanche", temperature: "tem-per-a-ture", unfamiliar: "un-fa-mil-iar", familiar: "fa-mil-iar",
    pronounce: "pro-nounce", vocabulary: "vo-cab-u-lar-y", scaffold: "scaf-fold", extraordinary: "ex-traor-di-nar-y",
  };
  const DIGRAPH = new Set(["th", "ch", "sh", "ph", "wh", "ck", "ng", "gh", "qu"]);
  const BLEND = new Set(["bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "sc", "sk", "sl", "sm", "sn", "sp", "st", "sw", "tr", "tw", "th", "ch", "sh", "ph", "wh"]);

  function syllables(word) {
    const w = clean(word).replace(/[^a-z]/g, "");
    if (!w) return [String(word)];
    if (OVERRIDES[w]) return OVERRIDES[w].split("-");
    if (w.length <= 3) return [w];

    // mark vowels; drop a silent final e / es / ed so it joins the previous syllable
    let body = w;
    let tail = "";
    if (/[^aeiouy]e$/.test(body) && !/[^aeiouy]le$/.test(body)) { tail = "e"; body = body.slice(0, -1); }
    else if (/[^aeiouytd]ed$/.test(body)) { tail = "ed"; body = body.slice(0, -2); }
    else if (/[^aeiouysxzh]es$/.test(body) && !/(ce|ge)s$/.test(body)) { tail = "es"; body = body.slice(0, -2); }

    const groups = [];
    const re = /[aeiouy]+/g;
    let m;
    while ((m = re.exec(body))) groups.push({ start: m.index, end: m.index + m[0].length });
    if (groups.length <= 1) return [w];

    const cuts = [];
    for (let g = 0; g < groups.length - 1; g++) {
      const a = groups[g], b = groups[g + 1];
      const between = body.slice(a.end, b.start);
      let cut;
      if (between.length === 0) cut = a.end;
      else if (between.length === 1) cut = a.end;                                  // V-CV
      else if (DIGRAPH.has(between)) cut = a.end;                                  // keep th, ch ... with the next vowel
      else if (between.length === 2) cut = a.end + 1;                              // VC-CV
      else cut = BLEND.has(between.slice(-2)) ? b.start - 2 : b.start - 1;         // VCC-CV or VC-CCV
      if (cut > 0 && cut < body.length) cuts.push(cut);
    }
    const parts = [];
    let last = 0;
    for (const c of [...new Set(cuts)].sort((x, y) => x - y)) { if (c > last) { parts.push(w.slice(last, c)); last = c; } }
    parts.push(w.slice(last));
    return parts.filter(Boolean);
  }

  function syllableCount(word) { return syllables(word).length; }

  /* ---------- rarity ---------- */
  function stems(w) {
    const out = [w];
    for (const [suf, rep] of [["ing", ""], ["ing", "e"], ["ed", ""], ["ed", "e"], ["es", ""], ["s", ""], ["ly", ""], ["er", ""], ["ful", ""]]) {
      if (w.length > suf.length + 2 && w.endsWith(suf)) out.push(w.slice(0, -suf.length) + rep);
    }
    return out;
  }
  function isCommon(word) { const w = clean(word); return stems(w).some((s) => COMMON.has(s)); }
  /* 0 = very common, 1 = rare. Longer words that are not on the common list score higher. */
  function rarity(word) {
    const w = clean(word);
    if (!w || /^\d+$/.test(w)) return 0;
    if (isCommon(w)) return 0;
    return Math.min(1, 0.45 + Math.max(0, w.length - 4) * 0.08);
  }

  /* ---------- spelling patterns (used for the pattern profile and pre-help dots) ---------- */
  const PATTERNS = {
    long: { label: "long words (3+ syllables)", test: (w) => syllableCount(w) >= 3 },
    silent: { label: "silent letters (kn, wr, gn, mb ...)", test: (w) => /^(kn|wr|gn|ps)|mb$|mn$|igh|ght|wh[oa]/.test(w) },
    ough: { label: "tricky endings (ough, augh, eigh)", test: (w) => /ough|augh|eigh/.test(w) },
    shun: { label: "-tion / -sion / -cial endings", test: (w) => /(tion|sion|cious|tious|cial|tial|ture)s?$/.test(w) },
    lookalike: { label: "look-alike letters (b d p q)", test: (w) => /[bdpq].*[bdpq]/.test(w) && w.length >= 5 },
  };
  function patterns(word) {
    const w = clean(word).replace(/[^a-z]/g, "");
    if (w.length < 4) return [];
    return Object.keys(PATTERNS).filter((k) => PATTERNS[k].test(w));
  }

  function hashText(text) {
    let h = 2166136261;
    const s = String(text).replace(/\s+/g, " ").trim();
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function similarity(a, b) {            // 1 = same, 0 = nothing in common (Levenshtein ratio)
    if (a === b) return 1;
    if (!a || !b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n);
  }

  return { clean, tokenize, syllables, syllableCount, isCommon, rarity, patterns, PATTERNS, hashText, similarity };
});

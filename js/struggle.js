// Struggle score, cause rules and the four fading stages (project document sections 7.3, 7.4, 8.2).
// Everything here is a HYPOTHESIS: weights, thresholds and rules are placeholders to be tuned on pilot data.
// Pure logic (no DOM). Loaded as window.BB.struggle.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.BB = root.BB || {}; root.BB.struggle = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  const CONFIG = {
    // Placeholder weights. A word is flagged when the weighted sum crosses the threshold.
    weights: { pause: 0.45, repeat: 0.25, mismatch: 0.30, reread: 0.50, hover: 0.50, gaze: 0.30, regress: 0.15, prior: 0.10 },
    defaultBaselineMs: 450,          // typical time per word when reading aloud, until we have the learner's own pace
    hoverStartMs: 800, hoverSpanMs: 2200,
    gazeStartMs: 900, gazeSpanMs: 2000,
    // Stage moves (section 7.4): smooth reads in later sessions needed to move up from stage 1, 2, 3.
    smoothToMoveUp: { 1: 2, 2: 2, 3: 3 },
    preHelpMinCount: 2,              // a spelling pattern needs this many stumbles before we mark similar words
  };

  /* The learner's sensitivity slider (0 = calm, 1 = eager) moves the threshold. */
  function threshold(sensitivity) {
    const s = clamp01(sensitivity == null ? 0.5 : sensitivity);
    return 0.65 - 0.4 * s;           // 0.65 .. 0.25
  }

  /* sig: {pauseMs, repeats, mismatch, reread, hoverMs, gazeMs, regress}; ctx: {baselineMs, len, rarity, hoverWeight}.
     Pause is judged against the learner's own pace, not a fixed number of seconds (document 8.2). */
  function parts(sig, ctx, cfg) {
    cfg = cfg || CONFIG;
    const base = (ctx && ctx.baselineMs) || cfg.defaultBaselineMs;
    const w = cfg.weights;
    const len = (ctx && ctx.len) || 0;
    const rar = (ctx && ctx.rarity) || 0;
    const hoverW = ctx && ctx.hoverWeight != null ? ctx.hoverWeight : 1;
    return {
      pause: clamp01(((sig.pauseMs || 0) - 2 * base) / (5 * base)),
      repeat: clamp01((sig.repeats || 0) / 2),
      mismatch: clamp01(sig.mismatch || 0),
      reread: sig.reread ? 1 : 0,
      hover: clamp01(((sig.hoverMs || 0) - cfg.hoverStartMs) / cfg.hoverSpanMs) * hoverW,
      gaze: clamp01(((sig.gazeMs || 0) - cfg.gazeStartMs) / cfg.gazeSpanMs),
      regress: clamp01((sig.regress || 0) / 2),
      // Longer and rarer words are more likely to cause trouble, so they raise the score slightly.
      prior: clamp01((len >= 8 ? 0.5 : len >= 6 ? 0.25 : 0) + rar * 0.5),
    };
  }

  function score(sig, ctx, cfg) {
    cfg = cfg || CONFIG;
    const p = parts(sig, ctx, cfg);
    let s = 0;
    // The prior only adds weight when some real signal is present, so a long word alone never gets flagged.
    let real = 0;
    for (const k of Object.keys(p)) { if (k === "prior") continue; s += p[k] * cfg.weights[k]; real += p[k]; }
    if (real > 0.05) s += p.prior * cfg.weights.prior;
    return { score: clamp01(s), parts: p };
  }

  /* Cause rules (section 7.3). Returns the guessed cause and the order of the four help buttons. */
  const ORDERS = {
    decoding: ["hear", "say", "meaning", "easier"],
    meaning: ["meaning", "easier", "hear", "say"],
    vocabulary: ["meaning", "hear", "easier", "say"],
    unclear: ["hear", "say", "meaning", "easier"],
  };
  const HINTS = {
    decoding: "This one may be tricky to sound out.",
    meaning: "The sentence may have been hard to follow.",
    vocabulary: "This word may be new.",
    unclear: "Choose whatever helps.",
  };

  function cause(sig, ctx, cfg) {
    const p = parts(sig, ctx, cfg || CONFIG);
    const speech = !!sig.speech;
    const hesitated = p.pause >= 0.4;
    const wrong = p.mismatch >= 0.4 || (sig.repeats || 0) >= 1;
    const smooth = p.pause < 0.4 && p.mismatch < 0.3 && !(sig.repeats > 0);
    const dwelled = p.hover >= 0.3 || p.gaze >= 0.3;
    const rar = (ctx && ctx.rarity) || 0;
    const len = (ctx && ctx.len) || 0;
    let c = "unclear";
    if (speech && hesitated && wrong) c = "decoding";                               // long pause, then wrong / split / mumbled
    else if (speech && p.mismatch < 0.3 && p.reread) c = "meaning";                 // says it correctly, then re-reads the sentence
    else if (speech && smooth && rar >= 0.5 && dwelled) c = "vocabulary";           // rare word read smoothly, then hovered on
    else if (!speech) {                                                             // silent: only dwell and look-back are available
      if (p.reread || p.regress >= 0.5) c = "meaning";
      else if (dwelled && rar >= 0.5 && len < 9) c = "vocabulary";
      else if (dwelled && len >= 8) c = "decoding";
    }
    return { cause: c, order: ORDERS[c].slice(), hint: HINTS[c] };
  }

  /* ---------- fading stages (section 7.4) ----------
     rec: {stage 1..4, smooth, stumbles, helps}. outcome: "smooth" | "stumble".
     Every move is reversible: the learner can set a word back to stage 1 with one click. */
  const STAGE_NAMES = { 1: "Full help", 2: "Light help", 3: "Watching", 4: "Mastered" };

  function newRecord() { return { stage: 1, smooth: 0, stumbles: 0, helps: 0 }; }

  function nextStage(rec, outcome, cfg) {
    cfg = cfg || CONFIG;
    const r = Object.assign(newRecord(), rec);
    if (outcome === "stumble") {
      r.stumbles += 1; r.smooth = 0;
      r.stage = Math.max(1, r.stage - 1);
    } else if (outcome === "smooth" && r.stage < 4) {
      r.smooth += 1;
      if (r.smooth >= cfg.smoothToMoveUp[r.stage]) { r.stage += 1; r.smooth = 0; }
    }
    return r;
  }

  /* What the reader sees for a flagged word at each stage. */
  function display(stage) {
    if (stage <= 1) return { underline: "full", hoverOpens: true };
    if (stage === 2) return { underline: "faint", hoverOpens: false };
    return { underline: "none", hoverOpens: false };
  }

  /* ---------- pattern profile (section 7.5) ---------- */
  function addPatterns(profile, tags) {
    const p = Object.assign({}, profile);
    for (const t of tags) p[t] = (p[t] || 0) + 1;
    return p;
  }
  function preHelpTags(tags, profile, cfg) {
    cfg = cfg || CONFIG;
    return tags.filter((t) => (profile[t] || 0) >= cfg.preHelpMinCount);
  }

  return { CONFIG, threshold, parts, score, cause, nextStage, newRecord, display, addPatterns, preHelpTags, STAGE_NAMES, ORDERS, HINTS };
});

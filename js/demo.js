// SIMULATED multi-session history for the demo (project document 13.3: "the simulated session-5 view").
// This is invented data that shows the interface. It is NOT evidence that BlinkBrief helps anyone learn,
// and every place it appears is labelled "simulated".
(function (root) {
  const BB = root.BB = root.BB || {};
  const DAY = 24 * 3600 * 1000;

  /* Help requests per 100 words over five sessions, falling as words become easier. */
  const HELP_PER_100 = [9.1, 6.4, 4.6, 3.1, 1.6];

  function seed(passage) {
    const store = BB.store, S = BB.struggle, T = BB.text;
    const d = store.get();
    const parsed = T.tokenize(passage.text);
    const hash = T.hashText(passage.text);
    d.passages[hash] = { title: passage.title, text: passage.text };

    // The hard words of the passage: rare or long, spread through the text.
    const hard = parsed.words.map((w) => ({ i: w.i, w: w.clean, score: T.rarity(w.clean) * 2 + w.clean.length / 10 }))
      .filter((x) => x.w.length >= 5 && x.score > 1.1).sort((a, b) => b.score - a.score).slice(0, 9).map((x) => x.i)
      .sort((a, b) => a - b);

    const n = parsed.words.length;
    const now = Date.now();
    const sessions = HELP_PER_100.map((rate, s) => {
      const outcomes = {};
      const stuckCount = Math.max(1, Math.round(rate / 100 * n));
      // later sessions: fewer stuck words, and the remaining trouble is lighter ("slowed")
      hard.forEach((i, k) => {
        if (k < stuckCount + (s === 0 ? 2 : 0) && k < hard.length - Math.floor(s * 1.6)) outcomes[i] = "stuck";
        else if (k < hard.length - Math.floor(s * 0.9)) outcomes[i] = "slowed";
      });
      // a few "slowed" words that are not hard words, early on
      if (s < 2) [3, 11, 19].forEach((i) => { if (i < n && !outcomes[i]) outcomes[i] = "slowed"; });
      const stuck = Object.values(outcomes).filter((o) => o === "stuck").length;
      return {
        id: "sim-" + hash + "-" + s, t: now - (HELP_PER_100.length - s) * 2 * DAY, hash, title: passage.title, simulated: true, seeded: true,
        mode: "aloud", wordsRead: n, helps: Math.round(rate / 100 * n * 10) / 10, helpPer100: rate, stuck, outcomes,
      };
    });
    // drop any earlier simulated sessions for this passage, then add the new ones
    d.sessions = d.sessions.filter((x) => !(x.seeded && x.hash === hash));
    d.sessions.push(...sessions);

    // simulated word stages: the words that were stuck early are now at lighter stages
    hard.forEach((i, k) => {
      const w = parsed.words[i].clean;
      if (d.words[w] && !d.words[w].simulated) return;
      d.words[w] = Object.assign(S.newRecord(), { stage: Math.min(4, 1 + (k % 4)), helps: 3 - (k % 3), stumbles: 2, simulated: true });
    });
    // simulated pattern profile
    const prof = {};
    hard.forEach((i) => T.patterns(parsed.words[i].clean).forEach((p) => { prof[p] = (prof[p] || 0) + 2; }));
    for (const k of Object.keys(prof)) d.patterns[k] = Math.max(d.patterns[k] || 0, prof[k]);
    store.save();
    return sessions.length;
  }

  function clear() {
    const d = BB.store.get();
    d.sessions = d.sessions.filter((x) => !x.seeded);
    for (const w of Object.keys(d.words)) if (d.words[w].simulated) delete d.words[w];
    BB.store.save();
  }

  const hasSeeded = () => BB.store.get().sessions.some((x) => x.seeded);

  BB.demo = { seed, clear, hasSeeded, HELP_PER_100 };
})(typeof self !== "undefined" ? self : this);

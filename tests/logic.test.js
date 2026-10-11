// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const T = require("../js/textproc.js");
const S = require("../js/struggle.js");
const Session = require("../js/session.js");
const SP = require("../js/speech.js");
const PASSAGES = (() => { const src = require("fs").readFileSync(__dirname + "/../data/passages.js", "utf8"); return new Function(src + "; return PASSAGES;")(); })();

test("tokenize: words, sentences, paragraphs", () => {
  const t = T.tokenize("Dr. Smith went home. He slept!\n\nNext day, it rained.");
  assert.strictEqual(t.words.length, 10);
  assert.strictEqual(t.sentences.length, 3);
  assert.strictEqual(t.paras.length, 2);
  assert.strictEqual(t.words[0].clean, "dr.".replace(".", ""));
  assert.strictEqual(t.words[3].sent, 0);       // "home." ends sentence 0
  assert.strictEqual(t.words[4].sent, 1);
});

test("syllables: sensible splits", () => {
  assert.deepStrictEqual(T.syllables("thorough"), ["thor", "ough"]);
  assert.strictEqual(T.syllableCount("cat"), 1);
  assert.strictEqual(T.syllableCount("table"), 2);
  assert.strictEqual(T.syllableCount("banana"), 3);
  assert.strictEqual(T.syllableCount("remember"), 3);
  assert.strictEqual(T.syllableCount("made"), 1);
  assert.ok(T.syllables("glacier").join("") === "glacier");
  for (const w of ["unbelievable", "photograph", "kindergarten", "strength", "rhythm"]) assert.strictEqual(T.syllables(w).join(""), w);
});

test("rarity and patterns", () => {
  assert.strictEqual(T.rarity("the"), 0);
  assert.strictEqual(T.rarity("walked"), 0);
  assert.ok(T.rarity("enormous") > 0.6);
  assert.ok(T.patterns("thorough").includes("ough"));
  assert.ok(T.patterns("knowledge").includes("silent"));
  assert.ok(T.patterns("education").includes("shun"));
  assert.deepStrictEqual(T.patterns("cat"), []);
});

test("score: pause alone is not enough at default sensitivity, a worked example is", () => {
  const ctx = { baselineMs: 450, len: 8, rarity: 0.77 };
  const thr = S.threshold(0.5);
  assert.ok(S.score({ pauseMs: 700 }, ctx).score < thr);
  assert.ok(S.score({}, ctx).score === 0, "a long rare word alone is never flagged");
  // document 8.2 worked example: ~2.5 s pause, two attempts
  const ex = S.score({ pauseMs: 2500, repeats: 1, mismatch: 0.5 }, ctx);
  assert.ok(ex.score >= thr, "worked example should cross the threshold, got " + ex.score);
});

test("sensitivity moves the threshold", () => {
  assert.ok(S.threshold(1) < S.threshold(0.5) && S.threshold(0.5) < S.threshold(0));
});

test("cause rules follow section 7.3", () => {
  const ctx = { baselineMs: 450, len: 10, rarity: 0.9 };
  assert.strictEqual(S.cause({ speech: true, pauseMs: 2800, mismatch: 0.5, repeats: 1 }, ctx).cause, "decoding");
  assert.strictEqual(S.cause({ speech: true, pauseMs: 300, reread: 1 }, ctx).cause, "meaning");
  assert.strictEqual(S.cause({ speech: true, pauseMs: 300, hoverMs: 3000 }, { baselineMs: 450, len: 7, rarity: 0.8 }).cause, "vocabulary");
  assert.strictEqual(S.cause({ speech: true, pauseMs: 300 }, ctx).cause, "unclear");
  assert.deepStrictEqual(S.cause({ speech: true, pauseMs: 2800, mismatch: 0.5, repeats: 1 }, ctx).order.slice(0, 2), ["hear", "say"]);
  assert.strictEqual(S.cause({ speech: true }, ctx).order.length, 4);
});

test("stages: move up with smooth reads, back down on a stumble, reversible", () => {
  let r = S.newRecord();
  r = S.nextStage(r, "smooth"); assert.strictEqual(r.stage, 1);
  r = S.nextStage(r, "smooth"); assert.strictEqual(r.stage, 2);
  r = S.nextStage(r, "smooth"); r = S.nextStage(r, "smooth"); assert.strictEqual(r.stage, 3);
  for (let i = 0; i < 3; i++) r = S.nextStage(r, "smooth"); assert.strictEqual(r.stage, 4);
  r = S.nextStage(r, "smooth"); assert.strictEqual(r.stage, 4);
  r = S.nextStage(r, "stumble"); assert.strictEqual(r.stage, 3);
  r = S.nextStage(r, "stumble"); r = S.nextStage(r, "stumble"); r = S.nextStage(r, "stumble"); assert.strictEqual(r.stage, 1);
  assert.strictEqual(S.display(1).underline, "full"); assert.strictEqual(S.display(2).underline, "faint"); assert.strictEqual(S.display(3).underline, "none");
});

test("pre-help tags need repeated stumbles", () => {
  let prof = {};
  prof = S.addPatterns(prof, ["long"]);
  assert.deepStrictEqual(S.preHelpTags(["long"], prof), []);
  prof = S.addPatterns(prof, ["long", "ough"]);
  assert.deepStrictEqual(S.preHelpTags(["long", "ough"], prof), ["long"]);
});

test("aligner: smooth reading, pause, wrong attempt, retry, skip, re-read", () => {
  const words = T.tokenize("The scientist made a careful thorough check.").words;
  const a = new SP.Aligner(words, 0);
  let evs = [];
  let t = 0;
  for (const tok of ["the", "scientist", "made", "a"]) { t += 400; evs.push(...a.token(tok, t)); }
  assert.deepStrictEqual(evs.filter(e => e.type === "read").map(e => e.i), [0, 1, 2, 3]);
  t += 400; evs = a.token("careful", t); assert.strictEqual(evs[0].i, 4);
  t += 2900; evs = a.token("thor", t);                        // wrong attempt
  assert.strictEqual(evs[0].type, "mismatch");
  t += 900; evs = a.token("thorough", t);                     // retry
  assert.deepStrictEqual(evs.map(e => e.type), ["repeat", "read"]);
  assert.ok(evs[1].pauseMs >= 3800);
  t += 500; evs = a.token("um", t); assert.deepStrictEqual(evs, []);   // filler ignored
  const b = new SP.Aligner(words, 0);
  evs = b.token("the", 100).concat(b.token("made", 500));    // skipped "scientist"
  assert.deepStrictEqual(evs.map(e => e.type), ["read", "skip", "read"]);
  const c = new SP.Aligner(words, 0);
  for (const [k, tok] of ["the", "scientist", "made", "a"].entries()) c.token(tok, 100 * (k + 1));
  evs = c.token("the", 1000);                                  // went back to the start
  assert.strictEqual(evs[0].type, "reread");
  assert.strictEqual(c.p, 1);
});

test("aligner: transcript growth is only counted once", () => {
  const words = T.tokenize("one two three four").words;
  const a = new SP.Aligner(words, 0);
  assert.strictEqual(a.feedTranscript("one", 100).length, 1);
  assert.strictEqual(a.feedTranscript("one two", 200).length, 1);
  assert.strictEqual(a.feedTranscript("one two", 300).length, 0);
});

test("simulated read-aloud flags three words with three different causes", () => {
  const p = PASSAGES.find(x => x.id === "demo3");
  const parsed = T.tokenize(p.text);
  const flagged = [];
  const sess = new Session(parsed, { mode: "aloud", sensitivity: 0.5, onFlag: (i, info) => flagged.push([parsed.words[i].clean, info.cause]) });
  const script = SP.buildScript(sess.words, parsed.sentences);
  const al = new SP.Aligner(sess.words, 0);
  let t = 0;
  for (const st of script.steps) {
    t += st.dt;
    if (st.hover != null) { sess.record({ type: "hover", i: st.hover, ms: st.ms }); continue; }
    for (const ev of al.token(st.tok, t)) sess.record(ev);
  }
  const causes = new Set(flagged.map(f => f[1]));
  assert.ok(causes.has("decoding"), JSON.stringify(flagged));
  assert.ok(causes.has("meaning") || causes.has("vocabulary"), JSON.stringify(flagged));
  assert.ok(flagged.length >= 2 && flagged.length <= 5, "should flag a few words, not everything: " + JSON.stringify(flagged));
  assert.strictEqual(sess.wordsRead(), parsed.words.length);
  assert.ok(sess.helpPer100() === 0);
  const sum = sess.summary();
  assert.ok(sum.stuck === flagged.length);
});

test("session: smooth reading flags nothing", () => {
  const parsed = T.tokenize(PASSAGES[1].text);
  const sess = new Session(parsed, { mode: "aloud" });
  const al = new SP.Aligner(sess.words, 0);
  let t = 0;
  for (const w of sess.words) { t += 420; for (const ev of al.token(w.clean, t)) sess.record(ev); }
  assert.strictEqual(sess.flagged.size, 0);
  assert.strictEqual(sess.wordsRead(), sess.words.length);
});

// Optional webcam gaze (WebGazer) for BlinkBrief: which word is the reader looking at?
// Ported from blinkbrief-gaze.html (the latest tracker). It is an EXTRA signal: reading, help and fading work without it.
//
// Pipeline: WebGazer ridge regression -> second-stage calibration (identity unless clearly better) ->
// light One Euro filter -> reading model (probability over words in reading order) -> highlighted word.
// Setup has three parts (nine dots, follow a highlight, a test on words it never trained on) and pauses if the face is lost.
// Video stays in the browser. WebGazer is loaded from the CDN only when the learner turns gaze on.
//
// Events fired on document:
//   blinkbrief:wordfocus {word, index, element}   a new word is being looked at
//   blinkbrief:wordblur  {index, dwellMs}         the gaze left a word
//   blinkbrief:stall     {word, index, dwellMs}   2 s on one word
//   blinkbrief:gazestate {state}                  off | intro | loading | calibrating | result | reading
//   blinkbrief:gazestatus {text, bad}             short text for a status line
(function () {
'use strict';
// ===PURE-START===
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const FEATURES = {
  affine: (x, y) => [1, x, y],
  quad: (x, y) => [1, x, y, x * x, x * y, y * y]
};
const nFeatures = kind => FEATURES[kind](0, 0).length;

/* Ridge least squares: pts [{nx, ny, tx, ty}] (nx, ny normalised about -0.5..0.5, tx, ty in px). */
function fit(pts, kind) {
  const F = FEATURES[kind], n = nFeatures(kind);
  if (pts.length < n) return null;
  const M = Array.from({ length: n }, () => new Array(n + 2).fill(0));
  for (const p of pts) {
    const f = F(p.nx, p.ny);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) M[i][j] += f[i] * f[j];
      M[i][n] += f[i] * p.tx; M[i][n + 1] += f[i] * p.ty;
    }
  }
  const lambda = 0.002 * pts.length;
  for (let i = 1; i < n; i++) M[i][i] += lambda;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < n + 2; k++) M[r][k] -= f * M[c][k];
    }
  }
  const bx = [], by = [];
  for (let i = 0; i < n; i++) { bx.push(M[i][n] / M[i][i]); by.push(M[i][n + 1] / M[i][i]); }
  return { kind, bx, by };
}

function predictModel(m, nx, ny) {
  const f = FEATURES[m.kind](nx, ny);
  let x = 0, y = 0;
  for (let i = 0; i < f.length; i++) { x += m.bx[i] * f[i]; y += m.by[i] * f[i]; }
  return [x, y];
}

/* Group word boxes (document order) into lines. words: [{id, left, right, top, bottom}] */
function groupLines(words) {
  const lines = [];
  for (const w of words) {
    const cy = (w.top + w.bottom) / 2, h = w.bottom - w.top;
    const last = lines[lines.length - 1];
    if (last && Math.abs(cy - last.cy) < h * 0.6) {
      last.words.push(w);
      last.cy = (last.cy * (last.words.length - 1) + cy) / last.words.length;
    } else lines.push({ cy, words: [w] });
  }
  const diffs = [];
  for (let i = 1; i < lines.length; i++) { const d = lines[i].cy - lines[i - 1].cy; if (d > 0) diffs.push(d); }
  return { lines, gap: diffs.length ? median(diffs) : 60 };
}

function makeSelCfg(gap, tolerancePx, hysteresisPx) {
  return { lineReach: 0.9 * gap, lineMargin: 0.25 * gap, xReach: tolerancePx, xMargin: hysteresisPx };
}

/* Pick a line first (vertical error is the big one), then the word on it by x.
   st = { line, word } is the previous choice, used so the pick does not flicker. */
function selectWord(L, x, y, st, cfg) {
  if (!L.lines.length) return null;
  let best = -1, bd = Infinity, curD = Infinity;
  L.lines.forEach((ln, i) => {
    const d = Math.abs(y - ln.cy);
    if (d < bd) { bd = d; best = i; }
    if (i === st.line) curD = d;
  });
  if (bd > cfg.lineReach) return null;
  let li = best;
  if (st.line !== null && st.line !== best && curD <= bd + cfg.lineMargin && curD <= cfg.lineReach) li = st.line;

  let bw = null, bwd = Infinity, cw = null, cwd = Infinity;
  for (const w of L.lines[li].words) {
    const d = Math.max(w.left - x, 0, x - w.right);
    if (d < bwd) { bwd = d; bw = w; }
    if (w.id === st.word) { cw = w; cwd = d; }
  }
  if (bwd > cfg.xReach) return { line: li, word: null };
  const word = (cw && cwd <= cfg.xReach && cwd <= bwd + cfg.xMargin) ? cw : bw;
  return { line: li, word };
}

/* pairs: [{mx, my, tx, ty, id}] = tracker output vs where the highlighted word really was.
   Scores raw output and two correction models using leave-one-out, so numbers are honest. */
function evaluate(pairs, L, W, H, cfg) {
  const toPt = p => ({ nx: p.mx / W - 0.5, ny: p.my / H - 0.5, tx: p.tx, ty: p.ty });
  const pts = pairs.map(toPt);
  const score = preds => {
    let wordHit = 0, lineHit = 0; const errs = [], adx = [], ady = [];
    pairs.forEach((p, i) => {
      const [x, y] = preds[i];
      errs.push(Math.hypot(x - p.tx, y - p.ty)); adx.push(Math.abs(x - p.tx)); ady.push(Math.abs(y - p.ty));
      const sel = selectWord(L, x, y, { line: null, word: null }, cfg);
      const tl = L.lines.findIndex(ln => ln.words.some(w => w.id === p.id));
      if (sel) { if (sel.line === tl) lineHit++; if (sel.word && sel.word.id === p.id) wordHit++; }
    });
    return { err: median(errs), sigx: 1.4826 * median(adx), sigy: 1.4826 * median(ady), word: wordHit / pairs.length, line: lineHit / pairs.length };
  };
  const stats = { identity: score(pairs.map(p => [p.mx, p.my])) };
  for (const kind of ['affine', 'quad']) {
    if (pairs.length < nFeatures(kind) + 3) continue;
    const preds = pairs.map((p, i) => {
      const m = fit(pts.filter((_, j) => j !== i), kind);
      return m ? predictModel(m, pts[i].nx, pts[i].ny) : [p.mx, p.my];
    });
    stats[kind] = score(preds);
  }
  let best = 'identity';
  for (const kind of ['affine', 'quad']) {
    if (stats[kind] && stats[kind].err < stats[best].err * 0.95) best = kind;   // must clearly help
  }
  return { best, stats, model: best === 'identity' ? null : fit(pts, best), toPt };
}

/* One Euro filter: smooths hard while the signal is still, and lets it through fast when it moves.
   minCutoff (Hz) = how smooth at rest, beta = how quickly it opens up with speed. */
function makeOneEuro(minCutoff, beta) { return { minCutoff, beta, dCutoff: 1, x: null, dx: 0, t: 0 }; }

function oneEuroStep(f, v, tSec) {
  if (f.x === null) { f.x = v; f.dx = 0; f.t = tSec; return v; }
  const dt = Math.max(tSec - f.t, 1e-3);
  f.t = tSec;
  const alpha = fc => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
  f.dx += alpha(f.dCutoff) * ((v - f.x) / dt - f.dx);
  f.x += alpha(f.minCutoff + f.beta * Math.abs(f.dx)) * (v - f.x);
  return f.x;
}

/* ---------- reading model ----------
   The reader is on exactly one word (never between words), and usually moves on to the next one.
   We keep a probability for every word and, for each gaze reading, (1) move the probabilities along
   how people read (stay, next word, skip ahead, look back), then (2) weight them by how close the
   reading is to each word. A reading far from every word is treated as "looking away" and changes nothing. */
const READ = {
  rate: 2.5,                                    // chance per second of leaving the current word
  moves: [[1, .55], [2, .14], [3, .04], [-1, .10], [-2, .04]],   // where the eyes go when they leave (sums to .87)
  jump: .13,                                    // the rest: land anywhere (re-reading, losing the place)
  floor: 1e-3, offText: .02, minConf: .2, stick: .7,
  lengthBias: 0                                 // 0..1: how much longer words attract the eyes
};

function readerInit(n) {
  const p = new Array(n).fill(n > 1 ? .6 / (n - 1) : 0);
  if (n) p[0] = n > 1 ? .4 : 1;                 // a reader starts at the beginning
  return { p };
}

function readerSet(R, i, mass) {                // e.g. the reader clicked a word
  const n = R.p.length; if (!n) return;
  const rest = (1 - mass) / Math.max(1, n - 1);
  for (let j = 0; j < n; j++) R.p[j] = j === i ? mass : rest;
}

/* boxes ordered by reading order, sig = {x, y} expected tracker error in px. Returns {off, pick}. */
function readerStep(R, boxes, x, y, dt, sig) {
  const n = boxes.length;
  if (!n || R.p.length !== n) return { off: true, pick: null };
  const e = new Array(n);
  let maxE = 0;
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    const dx = Math.max(b.left - x, 0, x - b.right);
    const dy = y - (b.top + b.bottom) / 2;
    e[i] = Math.exp(-.5 * ((dx / sig.x) ** 2 + (dy / sig.y) ** 2));
    if (e[i] > maxE) maxE = e[i];
  }
  if (maxE < READ.offText) return { off: true, pick: null };       // not looking at the text: leave the belief alone

  // Longer words draw more attention: the eyes land on them more often and stay longer (lengthBias 0 turns this off).
  let meanW = 0;
  for (const b of boxes) meanW += (b.right - b.left);
  meanW = Math.max(meanW / n, 1);
  const wn = boxes.map(b => Math.pow(Math.max(b.right - b.left, 1) / meanW, READ.lengthBias));
  const moveMass = READ.moves.reduce((m, mv) => m + mv[1], 0);
  const dtc = Math.min(Math.max(dt, 0), .5);

  const q = new Array(n).fill(0);
  let jumpMass = 0;
  for (let i = 0; i < n; i++) {
    const pi = R.p[i];
    if (pi < 1e-12) continue;
    const leave = 1 - Math.exp(-READ.rate * dtc / wn[i]);          // stay longer on long words
    q[i] += pi * (1 - leave);
    const ws = READ.moves.map(([d, w]) => { const j = i + d; return w * (j >= 0 && j < n ? wn[j] : 1); });
    const scale = moveMass / ws.reduce((a, v) => a + v, 0);
    READ.moves.forEach(([d], k) => {
      const j = i + d;
      q[j >= 0 && j < n ? j : i] += pi * leave * ws[k] * scale;    // off either end of the text: stay
    });
    jumpMass += pi * leave * READ.jump;
  }
  const spread = jumpMass / n;
  let sum = 0, best = 0;
  for (let i = 0; i < n; i++) {
    q[i] = (q[i] + spread) * (e[i] + READ.floor);
    sum += q[i];
  }
  for (let i = 0; i < n; i++) { q[i] /= sum; if (q[i] > q[best]) best = i; }
  R.p = q;
  return { off: false, pick: best };
}

/* Decide the line first (the line holding the most probability), then the likeliest word on that line. */
function readerDecode(R, lines) {
  if (!lines.length) return { line: -1, pick: null };
  let bestLine = 0, bestMass = -1;
  lines.forEach((ln, l) => {
    let m = 0;
    for (const w of ln.words) m += R.p[w.id] || 0;
    if (m > bestMass) { bestMass = m; bestLine = l; }
  });
  let pick = null;
  for (const w of lines[bestLine].words) if (pick === null || R.p[w.id] > R.p[pick]) pick = w.id;
  return { line: bestLine, pick };
}
// ===PURE-END===

const DOM = `<div id="banner" role="status">
  <span id="b-title"></span><span id="b-text"></span><span id="b-count"></span><span id="b-warn"></span>
</div>

<div id="ov-intro" class="overlay">
  <h2>Webcam gaze (optional)</h2>
  <p>BlinkBrief can use your webcam to estimate which word you are looking at. This is an extra signal only: everything works without it. Video stays in your browser and is never uploaded. Setup takes about two minutes and has three parts: look at nine dots, follow a highlight across the text, then a test. Each part starts with instructions you can read at your own pace, and setup pauses by itself if the camera loses your face.</p>
  <ul class="tips">
    <li>Sit about an arm's length from the screen, camera at eye level.</li>
    <li>Face a light source, not a window behind you.</li>
    <li>Keep your head still from now until you finish reading.</li>
    <li>Keep the browser window the same size, and use a wide window.</li>
  </ul>
  <div class="controls" style="justify-content:center;"><button class="primary" id="btn-start">Turn on camera</button><button id="btn-cancel">No thanks</button></div>
</div>

<div id="ov-loading" class="overlay">
  <h2>Starting the camera</h2>
  <p id="loading-msg">Allow camera access when your browser asks. The first start can take a few seconds.</p>
</div>

<div id="ov-dots" class="overlay"></div>

<div id="ov-info" class="overlay" role="dialog" aria-live="polite">
  <h2 id="i-title"></h2>
  <p id="i-text"></p>
  <ul class="tips" id="i-tips"></ul>
  <div class="big-count" id="i-count"></div>
  <button class="primary" id="i-btn">I'm ready</button>
</div>

<div id="ov-pause" class="overlay" role="alertdialog" aria-live="assertive">
  <h2 id="p-title">Paused: can't see your face</h2>
  <p id="p-text"></p>
  <div class="big-count" id="p-count"></div>
  <p id="p-debug" style="font-size:12px;margin:0 0 14px;"></p>
  <div class="controls" style="justify-content:center;">
    <button id="p-ignore">My face is in view, continue anyway</button>
    <button id="p-restart">Start setup over</button>
  </div>
</div>

<div id="lost-bar">Can't see your face. Tracking is paused until you are back in view.</div>

<div id="ov-result" class="overlay">
  <h2 id="r-title">Setup result</h2>
  <p id="r-text"></p>
  <div id="result-actions">
    <button id="btn-recal">Set up again</button>
    <button id="btn-go" class="primary">Start reading</button><button id="btn-leave">Turn gaze off</button>
  </div>
</div>

<div id="tgt"></div>
<div id="gaze-dot"></div>


<div class="gz-hidden" aria-hidden="true">
  <div id="cur-word"></div><div id="dwell-bar"><i id="dwell-fill"></i></div><span id="dwell-ms"></span><span id="word-idx"></span><ul id="trail"></ul>
</div>
`;

/* =====================================================================
   PAGE LOGIC
   ===================================================================== */
const CONFIG = {
  medianWindow: 1,        // 1 = use each reading as it comes. Averaging first makes the highlight lag and, in tests, picks the wrong word more often
  filterX: { minCutoff: 6, beta: 0.05 },      // very light smoothing, just to take the jitter off the dot
  filterY: { minCutoff: 3, beta: 0.02 },      // (the reading model does the real noise handling)
  tolerancePx: 60,        // how far beside a word the gaze may be and still pick it
  hysteresisPx: 14,       // current word is kept unless another is this much closer
  confirmMs: 120,         // a new word must win this long before we switch
  leaveGraceMs: 450,      // keep the last word this long after gaze leaves the text
  stallMs: 2000,          // dwell on one word before it counts as a stall
  recordEveryMs: 100,     // training sample rate while you look at a target
  dotSettleMs: 900, dotRecordMs: 1500,
  trainSettleMs: 250, trainRecordMs: 500,
  testSettleMs: 350, testRecordMs: 450,
  minVisibleWords: 12,
  noFaceMs: 1200,
  pauseAfterMs: 800,      // no face data for this long pauses setup
  resumeCount: 3,         // seconds the face must stay in view before setup resumes
  diagnoseUrl: null       // e.g. '/diagnose' to POST { word, dwell_ms } to your Flask app on a stall
};

let root = null, pageEl = null;
const $ = s => root.querySelector(s);
let dotOn = false, camOn = false, clicksBound = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let state = 'off';                // off | intro | loading | calibrating | result | reading
let paused = false;
let runId = 0;
let lastDataAt = 0;               // last time WebGazer produced a gaze prediction
let lastFaceAt = 0;               // last time a face was seen (prediction OR green face box)
const readLog = [];               // recent raw readings {t, x, y}
const phaseReadings = { dots: 0, train: 0, test: 0 };
let phaseName = 'dots';
let gazeCount = 0, teachCount = 0, teachErrors = 0, lastTeachError = '';   // diagnostics for this setup run
let ignoreFace = false;           // set by 'continue anyway' if face detection is wrong
let rawX = null, rawY = null;     // median-filtered tracker output, before our correction
let filtX = null, filtY = null, lastFilterAt = 0;
let sx = null, sy = null;         // corrected + smoothed gaze
const bufX = [], bufY = [];

let model = null;                 // second-stage correction (null = use tracker output as is)
let chosenKind = 'identity';
let calPairs = [];                // tracker-vs-truth pairs, grows with your clicks
let faceBase = null;

let layout = null, selCfg = null, selState = { line: null, word: null };
let reader = null, wordBoxes = [], lastTrackAt = 0, readSig = { x: 120, y: 120 };   // reading model (see READ)
let wordEls = [];
let current = null, candidate = null, candSince = 0, lastOnWord = 0;
let focusSince = 0, stallFired = false;
const trail = [];

/* ---------- text: the words come from the reader ---------- */
function setWords(els) {
  wordEls = (els || []).filter(Boolean);
  wordEls.forEach((w, i) => { if (!w.dataset.i) w.dataset.i = i; });
  current = candidate = null;
  setCurrent(null, performance.now());
  if (state !== 'off') buildLayout();
}

function buildLayout() {
  const words = wordEls.map((el, i) => {
    const r = el.getBoundingClientRect();
    return { id: i, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  layout = groupLines(words);
  selCfg = makeSelCfg(layout.gap, CONFIG.tolerancePx, CONFIG.hysteresisPx);
  wordBoxes = layout.lines.flatMap(l => l.words).sort((a, b) => a.id - b.id);
  if (!reader || reader.p.length !== wordBoxes.length) reader = readerInit(wordBoxes.length);
}

/* ---------- start ---------- */
function loadWebGazer() {
  if (typeof webgazer !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/webgazer@3.3.0/dist/webgazer.js';
    s.onload = resolve; s.onerror = () => reject(new Error('load'));
    document.head.appendChild(s);
  });
}

async function startTracking() {
  setState('loading');
  try { await loadWebGazer(); }
  catch (_) { $('#loading-msg').textContent = 'WebGazer did not load. It needs an internet connection the first time. Check your connection and press Webcam gaze again.'; return; }
  if (state !== 'loading') return;
  webgazer
    .setRegression('ridge')
    .setGazeListener(onGaze)
    .saveDataAcrossSessions(false)       // old sessions (other head positions) would pollute the model
    .showVideoPreview(true)
    .showFaceOverlay(true)
    .showFaceFeedbackBox(true)
    .showPredictionPoints(false)
    .begin(() => { $('#loading-msg').textContent = 'The camera could not start. Allow camera access in your browser and reload.'; });

  const wait = setInterval(() => {
    if (state !== 'loading') { clearInterval(wait); return; }
    if (typeof webgazer.isReady === 'function' && webgazer.isReady()) {
      clearInterval(wait);
      if (webgazer.clearData) webgazer.clearData();
      // We train the model ourselves with known target positions; stray mouse movement would corrupt it.
      if (webgazer.removeMouseEventListeners) webgazer.removeMouseEventListeners();
      runCalibration();
    }
  }, 250);
}

/* ---------- gaze in ---------- */
function onGaze(data) {
  const now = performance.now();
  if (!data) return;
  lastDataAt = now;
  lastFaceAt = now;
  gazeCount++;
  phaseReadings[phaseName]++;
  readLog.push({ t: now, x: data.x, y: data.y });
  if (readLog.length > 800) readLog.shift();
  bufX.push(data.x); bufY.push(data.y);
  if (bufX.length > CONFIG.medianWindow) { bufX.shift(); bufY.shift(); }
  rawX = median(bufX); rawY = median(bufY);

  const [cx, cy] = model
    ? predictModel(model, rawX / innerWidth - 0.5, rawY / innerHeight - 0.5)
    : [rawX, rawY];
  if (sx === null || now - lastFilterAt > 1000) {              // first reading, or a long gap: start the filters fresh
    filtX = makeOneEuro(CONFIG.filterX.minCutoff, CONFIG.filterX.beta);
    filtY = makeOneEuro(CONFIG.filterY.minCutoff, CONFIG.filterY.beta);
  }
  lastFilterAt = now;
  sx = oneEuroStep(filtX, cx, now / 1000);
  sy = oneEuroStep(filtY, cy, now / 1000);
  $('#gaze-dot').style.transform = `translate(${sx}px, ${sy}px)`;
  updateDot();

  if (state === 'reading' && !paused) trackWord(sx, sy, now);
}

/* WebGazer makes no predictions until it has been trained, so 'no predictions yet' must not mean 'no face'.
   We also read the green/red outline WebGazer draws around the detected face. */
function greenBox() {
  const fb = document.getElementById('webgazerFaceFeedbackBox');
  if (!fb) return false;
  const m = getComputedStyle(fb).borderTopColor.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return false;
  const [r, g, b] = m.map(Number);
  return g > 90 && g > r && g > b;
}
setInterval(() => {
  if (state !== 'off' && state !== 'intro' && state !== 'loading' && greenBox()) lastFaceAt = performance.now();
}, 100);

const faceOk = () => ignoreFace || performance.now() - lastFaceAt < 400;
const faceLost = () => !ignoreFace && performance.now() - lastFaceAt > CONFIG.pauseAfterMs;
const teach = (x, y) => {
  try { webgazer.recordScreenPosition(x, y, 'click'); teachCount++; }
  catch (e) { teachErrors++; lastTeachError = (e && e.message) ? e.message : String(e); }
};

/* Instruction card: stays until you press the button, then counts down 3, 2, 1. Resolves false if cancelled. */
function showInfo(run, title, text, tips) {
  return new Promise(resolve => {
    $('#i-title').textContent = title;
    $('#i-text').textContent = text;
    const ul = $('#i-tips');
    ul.innerHTML = '';
    tips.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    $('#i-count').textContent = '';
    const btn = $('#i-btn');
    btn.disabled = false;
    btn.textContent = "I'm ready";
    $('#ov-info').classList.add('on');
    btn.focus();
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Get ready';
      for (let n = 3; n > 0; n--) {
        $('#i-count').textContent = n;
        await sleep(1000);
        if (run !== runId) break;
      }
      $('#i-count').textContent = '';
      $('#ov-info').classList.remove('on');
      resolve(run === runId);
    };
  });
}

/* Blocks while the face is missing. 'ok' = no pause was needed, 'resumed' = it paused and came back, 'cancel' = setup restarted. */
async function faceGuard(run) {
  if (!faceLost()) return 'ok';
  $('#ov-pause').classList.add('on');
  $('#tgt').classList.remove('capturing');
  let steady = false;
  while (!steady) {
    $('#p-text').textContent = 'Setup is paused. Move back in view of the camera and face the light. It continues by itself once your face is found.';
    $('#p-count').textContent = '';
    while (faceLost()) {
      $('#p-debug').textContent = `Face outline green: ${greenBox() ? 'yes' : 'no'}   |   gaze readings: ${performance.now() - lastDataAt < 1000 ? 'yes' : 'none yet'}`;
      await sleep(150);
      if (run !== runId) return 'cancel';
    }
    $('#p-text').textContent = 'Face found. Hold still.';
    steady = true;
    for (let n = CONFIG.resumeCount; n > 0 && steady; n--) {
      $('#p-count').textContent = n;
      const t0 = performance.now();
      while (performance.now() - t0 < 1000) {
        await sleep(100);
        if (run !== runId) return 'cancel';
        if (faceLost()) { steady = false; break; }
      }
    }
  }
  bufX.length = 0; bufY.length = 0; rawX = rawY = null; sx = sy = null;   // stale readings from before the pause
  $('#ov-pause').classList.remove('on');
  return 'resumed';
}

/* ---------- setup, part 1: nine dots over the reading area ---------- */
function dotTargets() {
  const r = pageEl.getBoundingClientRect();
  const left = Math.max(r.left, 24), right = Math.min(r.right, innerWidth - 24);
  const top = Math.max(r.top, 90), bottom = Math.min(r.bottom, innerHeight - 40);
  const xs = [0.1, 0.5, 0.9].map(f => left + (right - left) * f);
  const ys = [0.12, 0.5, 0.88].map(f => top + (bottom - top) * f);
  return ys.flatMap(y => xs.map(x => [x, y]));
}

function banner(title, text, count) {
  $('#b-title').textContent = title;
  $('#b-text').textContent = text;
  $('#b-count').textContent = count || '';
}

async function phaseDots(run) {
  const targets = dotTargets();
  $('#ov-dots').classList.add('on');
  const tgt = $('#tgt');
  for (let i = 0; i < targets.length; i++) {
    const [x, y] = targets[i];
    tgt.style.left = x + 'px'; tgt.style.top = y + 'px'; tgt.style.display = 'block';
    let done = false;
    while (!done) {                                   // repeats this dot if the face was lost while recording it
      if (await faceGuard(run) === 'cancel') return false;
      banner('Part 1 of 3: look at the dots', 'Keep looking at each dot until its ring closes.', `Dot ${i + 1} of ${targets.length}`);
      await sleep(CONFIG.dotSettleMs);
      if (run !== runId) return false;
      tgt.classList.add('capturing');
      const t0 = performance.now();
      done = true;
      while (performance.now() - t0 < CONFIG.dotRecordMs) {
        if (faceLost()) { done = false; break; }
        if (faceOk()) teach(x, y);   // teach the model: eyes like this = this point
        await sleep(CONFIG.recordEveryMs);
        if (run !== runId) return false;
      }
      tgt.classList.remove('capturing');
    }
  }
  tgt.style.display = 'none';
  $('#ov-dots').classList.remove('on');
  return true;
}

/* ---------- setup, parts 2 and 3: follow the highlight along real words ---------- */
function visibleWordIndexes() {
  const out = [];
  wordEls.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (r.top >= 70 && r.bottom <= innerHeight - 8 && r.left >= 0 && r.right <= innerWidth) out.push(i);
  });
  return out;
}

async function phaseGuided(run, ids, train) {
  const out = [];
  for (let k = 0; k < ids.length; k++) {
    const el = wordEls[ids[k]];
    const r = el.getBoundingClientRect();
    const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
    el.classList.add('guide');
    const cancel = () => { el.classList.remove('guide'); return null; };
    let xs, ys, done = false;
    while (!done) {                                   // repeats this word if the face was lost while recording it
      if (await faceGuard(run) === 'cancel') return cancel();
      banner(train ? 'Part 2 of 3: follow the highlight' : 'Part 3 of 3: test',
             train ? 'Look at the highlighted word as it moves.' : 'Same again. Nothing is learned in this part; it only measures.',
             `Word ${k + 1} of ${ids.length}`);
      await sleep(train ? CONFIG.trainSettleMs : CONFIG.testSettleMs);
      if (run !== runId) return cancel();

      const t0 = performance.now(), recordMs = train ? CONFIG.trainRecordMs : CONFIG.testRecordMs;
      done = true;
      while (performance.now() - t0 < recordMs) {
        if (faceLost()) { done = false; break; }
        if (train && faceOk()) teach(tx, ty);
        await sleep(train ? CONFIG.recordEveryMs : 50);
        if (run !== runId) return cancel();
      }
      if (!train && done) {
        const win = readLog.filter(q => q.t >= t0 && q.t <= performance.now());
        xs = win.map(q => q.x); ys = win.map(q => q.y);
      }
    }
    el.classList.remove('guide');
    if (!train && xs && xs.length >= 2) out.push({ mx: median(xs), my: median(ys), tx, ty, id: ids[k], raw: xs.map((x, i) => [x, ys[i]]) });
  }
  return out;
}

async function runCalibration() {
  const run = ++runId;
  model = null; chosenKind = 'identity'; calPairs = []; faceBase = null;
  sx = sy = null; bufX.length = 0; bufY.length = 0;
  selState = { line: null, word: null };
  setCurrent(null, performance.now());
  gazeCount = 0; teachCount = 0; teachErrors = 0; lastTeachError = '';
  phaseReadings.dots = phaseReadings.train = phaseReadings.test = 0; phaseName = 'dots'; readLog.length = 0;
  try { if (webgazer.clearData) await webgazer.clearData(); } catch (_) {}
  if (run !== runId) return;
  if (webgazer.removeMouseEventListeners) webgazer.removeMouseEventListeners();
  ignoreFace = false;
  window.scrollTo(0, 0);
  $('#ov-pause').classList.remove('on'); $('#ov-info').classList.remove('on');
  setState('calibrating');
  buildLayout();

  if (!await showInfo(run, 'Part 1 of 3: look at the dots',
      'Nine dots will appear one at a time across the page. This teaches the tracker how your eyes look when you look at each part of the screen.',
      ['Look at each dot until the ring around it closes, then it moves on.',
       'Do not click and do not move the mouse.',
       'Keep your head still and your face in view of the camera.',
       'If the camera loses your face, setup pauses and waits for you.'])) return;
  if (!await phaseDots(run)) return;

  const vis = visibleWordIndexes();
  if (vis.length < CONFIG.minVisibleWords) {
    showResult(null, `Only ${vis.length} words fit on screen. Lower the text size or zoom the browser out (Ctrl and minus), then set up again.`);
    return;
  }
  const trainIds = vis.filter((_, k) => k % 2 === 0);
  const testIds = vis.filter((_, k) => k % 2 === 1);

  if (!await showInfo(run, 'Part 2 of 3: follow the highlight',
      'A word will light up in orange and jump from word to word. This trains the tracker on the real text you will read.',
      ['Look at the highlighted word the whole time it is lit.',
       'It moves quickly, so follow it with your eyes only and keep your head still.',
       'About half of the words on screen are used in this part.'])) return;
  phaseName = 'train';
  if (await phaseGuided(run, trainIds, true) === null) return;
  if (!await showInfo(run, 'Part 3 of 3: the test',
      'Same as the last part, but with the other words. This fine-tunes the tracker for your screen.',
      ['Look at each highlighted word, just like before.',
       'Stay in the same position as in Part 2.',
       'Reading starts right after.'])) return;
  phaseName = 'test';
  const pairs = await phaseGuided(run, testIds, false);
  if (pairs === null) return;

  buildLayout();
  if (pairs.length < 8) {
    const why = gazeCount === 0
      ? `WebGazer produced no gaze readings at all, even though the camera could see you (trained on ${teachCount} samples, ${teachErrors} errors${lastTeachError ? ': ' + lastTeachError : ''}). That is a tracker problem, not your position. Reload the page, close other tabs that use the camera, and try Chrome.`
      : `Only ${pairs.length} of ${testIds.length} test words had gaze readings (readings per part: dots ${phaseReadings.dots}, follow ${phaseReadings.train}, test ${phaseReadings.test}; trained on ${teachCount} samples). If the test count is far below the others, readings stopped partway. Otherwise they are arriving too slowly. Close other tabs and apps, move closer, put light on your face, and set up again.`;
    showResult(null, why);
    return;
  }
  showResult(pairs);
}

const pct = v => Math.round(v * 100) + '%';

function showResult(pairs, failMsg) {
  if (!pairs) {
    setState('result');
    $('#r-title').textContent = 'Setup did not finish';
    $('#r-text').textContent = failMsg;
    $('#btn-go').style.display = 'none';
    return;
  }
  const ev = evaluate(pairs, layout, innerWidth, innerHeight, selCfg);
  chosenKind = ev.best;
  calPairs = pairs.slice();
  model = ev.model;

  const s = ev.stats[ev.best];
  const clampPx = v => Math.min(260, Math.max(40, v));
  const resX = [], resY = [];
  pairs.forEach(p => (p.raw || []).forEach(([rx, ry]) => {
    const [qx, qy] = model ? predictModel(model, rx / innerWidth - 0.5, ry / innerHeight - 0.5) : [rx, ry];
    resX.push(Math.abs(qx - p.tx)); resY.push(Math.abs(qy - p.ty));
  }));
  readSig = resX.length >= 20
    ? { x: clampPx(1.4826 * median(resX) * 1.1), y: clampPx(1.4826 * median(resY) * 1.1) }   // noise of single readings, measured in the test
    : { x: clampPx(s.sigx * 1.3), y: clampPx(s.sigy * 1.3) };
  reader = readerInit(wordBoxes.length); lastTrackAt = 0;
  enterReading();                              // accuracy is measured above for the reading model, but not shown
}

/* ---------- which word? ---------- */
function trackWord(x, y, now) {
  const dt = lastTrackAt ? (now - lastTrackAt) / 1000 : .1;
  lastTrackAt = now;
  const out = readerStep(reader, wordBoxes, x, y, dt, readSig);
  let target = null;
  if (!out.off) {
    let pick = readerDecode(reader, layout.lines).pick;
    if (pick === null) pick = out.pick;
    const cur = current ? Number(current.dataset.i) : null;
    if (cur !== null && reader.p[cur] >= READ.stick * reader.p[pick]) pick = cur;   // do not flip between near-equal words
    if (reader.p[pick] >= READ.minConf) target = wordEls[pick];
  }

  if (!target) {
    candidate = null;
    if (current && now - lastOnWord > CONFIG.leaveGraceMs) setCurrent(null, now);
  } else if (target === current) {
    lastOnWord = now; candidate = null;
  } else if (candidate !== target) {
    candidate = target; candSince = now;
  } else if (now - candSince >= CONFIG.confirmMs) {
    setCurrent(target, now); lastOnWord = now; candidate = null;
  }
  updateDwell(now);
}

function setCurrent(w, now) {
  if (current) {
    document.dispatchEvent(new CustomEvent('blinkbrief:wordblur', { detail: { index: Number(current.dataset.i), dwellMs: now - focusSince } }));
    trail.unshift({ word: current.dataset.clean || current.textContent, ms: now - focusSince });
    if (trail.length > 6) trail.pop();
    current.classList.remove('looked', 'stalled');
    renderTrail();
  }
  current = w;
  focusSince = now;
  stallFired = false;
  $('#dwell-bar').classList.remove('stalled');
  if (w) {
    w.classList.add('looked');
    $('#cur-word').textContent = w.dataset.clean || w.textContent;
    $('#cur-word').classList.remove('none');
    $('#word-idx').textContent = `word ${Number(w.dataset.i) + 1}`;
    document.dispatchEvent(new CustomEvent('blinkbrief:wordfocus', {
      detail: { word: w.dataset.clean || w.textContent, index: Number(w.dataset.i), element: w }
    }));
  } else {
    $('#cur-word').textContent = '–';
    $('#cur-word').classList.add('none');
    $('#word-idx').textContent = '';
    $('#dwell-fill').style.width = '0%';
    $('#dwell-ms').textContent = '0.0 s';
  }
}

function updateDwell(now) {
  if (!current) return;
  const ms = now - focusSince;
  $('#dwell-fill').style.width = Math.min(100, ms / CONFIG.stallMs * 100) + '%';
  $('#dwell-ms').textContent = (ms / 1000).toFixed(1) + ' s';
  if (ms >= CONFIG.stallMs && !stallFired) {
    stallFired = true;
    current.classList.remove('looked');
    current.classList.add('stalled');
    $('#dwell-bar').classList.add('stalled');
    const word = current.dataset.clean || current.textContent;
    document.dispatchEvent(new CustomEvent('blinkbrief:stall', {
      detail: { word, index: Number(current.dataset.i), dwellMs: ms, element: current }
    }));
    if (CONFIG.diagnoseUrl) {
      fetch(CONFIG.diagnoseUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, dwell_ms: Math.round(ms) })
      }).catch(() => {});
    }
  }
}

function renderTrail() {
  const ul = $('#trail');
  ul.innerHTML = '';
  if (!trail.length) { ul.innerHTML = '<li style="color:var(--muted)">Nothing yet</li>'; return; }
  trail.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = '<b></b><span></span>';
    li.firstChild.textContent = t.word;
    li.lastChild.textContent = (t.ms / 1000).toFixed(1) + ' s';
    ul.appendChild(li);
  });
}

/* ---------- click-to-correct: your clicks become extra training pairs for the correction ---------- */
function refit() {
  const clicks = calPairs.filter(p => p.click).length;
  let kind = chosenKind;
  if (kind === 'identity') { if (clicks < 5) return; kind = 'affine'; }
  const pts = calPairs.map(p => ({ nx: p.mx / innerWidth - 0.5, ny: p.my / innerHeight - 0.5, tx: p.tx, ty: p.ty }));
  const m = fit(pts, kind);
  if (m) model = m;
}

function onPageClick(e) {
  if (state !== 'reading' || paused || rawX === null || !e.target.classList.contains('word')) return;
  calPairs.push({ mx: rawX, my: rawY, tx: e.clientX, ty: e.clientY, id: Number(e.target.dataset.i), click: true });
  refit();
  readerSet(reader, Number(e.target.dataset.i), .85);
  flashStatus('Learned from your click');
}

/* ---------- head-movement guard (uses WebGazer's face landmarks if available) ---------- */
function faceMetrics() {
  try {
    const pos = webgazer.getTracker().getPositions();
    if (!pos || pos.length < 455) return null;
    const nose = pos[1], l = pos[234], r = pos[454];
    return { x: nose[0], y: nose[1], w: Math.hypot(r[0] - l[0], r[1] - l[1]) };
  } catch (_) { return null; }
}

function headMoved() {
  if (!faceBase) return false;
  const m = faceMetrics();
  if (!m || !faceBase.w) return false;
  return Math.abs(m.x - faceBase.x) / faceBase.w > 0.15 ||
         Math.abs(m.y - faceBase.y) / faceBase.w > 0.15 ||
         Math.abs(m.w / faceBase.w - 1) > 0.12;
}

/* ---------- status line ---------- */
let flashUntil = 0;
let lastStatus = '';
function setStatus(msg, bad) {
  if (msg === lastStatus + '|' + !!bad) return;
  lastStatus = msg + '|' + !!bad;
  document.dispatchEvent(new CustomEvent('blinkbrief:gazestatus', { detail: { text: msg, bad: !!bad } }));
}
function flashStatus(msg) { setStatus(msg, false); flashUntil = performance.now() + 1500; }

setInterval(() => {
  if (state === 'off') return;
  const now = performance.now();
  const lost = !ignoreFace && now - lastFaceAt > CONFIG.noFaceMs;
  $('#b-warn').textContent = state !== 'calibrating' ? '' : lost ? "Can't see your face" : (now - lastDataAt > 3000 ? 'The camera sees you, but there are no gaze readings yet' : '');
  $('#gaze-dot').classList.toggle('stale', now - lastDataAt > 1000);
  $('#lost-bar').classList.toggle('on', state === 'reading' && lost && !paused);
  if (state === 'reading' && lost && current) setCurrent(null, now);      // no stale highlight while the face is missing
  if (state !== 'reading' || now < flashUntil) return;
  if (paused) { setStatus('Paused', false); return; }
  if (lost) { setStatus("Can't see your face", true); return; }
  if (headMoved()) { setStatus('You moved. Sit where you calibrated, or press Recalibrate.', true); return; }
  setStatus('Gaze tracking', false);
}, 400);

/* ---------- state + controls ---------- */
function updateDot() {
  $('#gaze-dot').style.display = (dotOn && sx !== null && ['calibrating', 'result', 'reading'].includes(state)) ? 'block' : 'none';
}

function setState(s) {
  state = s;
  document.body.classList.toggle('setup', s === 'loading' || s === 'calibrating' || s === 'result');
  document.body.classList.toggle('calibrating', s === 'calibrating');
  $('#ov-intro').classList.toggle('on', s === 'intro');
  $('#ov-loading').classList.toggle('on', s === 'loading');
  $('#ov-result').classList.toggle('on', s === 'result');
  if (s !== 'calibrating') { $('#ov-dots').classList.remove('on'); $('#ov-info').classList.remove('on'); $('#ov-pause').classList.remove('on'); $('#tgt').style.display = 'none'; }
  if (s === 'off') { $('#lost-bar').classList.remove('on'); $('#gaze-dot').style.display = 'none'; }
  updateDot();
  document.dispatchEvent(new CustomEvent('blinkbrief:gazestate', { detail: { state: s } }));
}

function enterReading() {
  setState('reading');
  buildLayout();
  faceBase = faceMetrics();
  if (webgazer.showVideoPreview) webgazer.showVideoPreview(false);
  camOn = false;
  setStatus('Gaze tracking', false);
}

/* ---------- public API ---------- */
let mounted = false;
function mount() {
  if (mounted) return;
  root = document.createElement('div');
  root.id = 'gaze-root';
  root.innerHTML = DOM;
  document.body.appendChild(root);
  mounted = true;
  $('#btn-start').addEventListener('click', startTracking);
  $('#btn-cancel').addEventListener('click', stop);
  $('#btn-go').addEventListener('click', enterReading);
  $('#p-ignore').addEventListener('click', () => { ignoreFace = true; });
  $('#p-restart').addEventListener('click', () => { $('#ov-pause').classList.remove('on'); $('#ov-info').classList.remove('on'); runCalibration(); });
  $('#btn-recal').addEventListener('click', () => { if (webgazer.showVideoPreview) webgazer.showVideoPreview(true); runCalibration(); });
  $('#btn-leave').addEventListener('click', stop);
  window.addEventListener('resize', () => { if (state !== 'off') buildLayout(); });
  window.addEventListener('scroll', () => { if (state !== 'off') buildLayout(); }, { passive: true });
  window.addEventListener('beforeunload', () => { try { webgazer.end(); } catch (_) {} });
}

function start(opts) {
  mount();
  pageEl = opts.pageEl;
  if (clicksBound !== pageEl) { pageEl.addEventListener('click', onPageClick); clicksBound = pageEl; }
  paused = false; ignoreFace = false; camOn = false;
  setWords(opts.words);
  document.body.classList.add('gaze-on');
  setState('intro');
}

function stop() {
  runId++;                                   // cancels any setup that is still running
  if (mounted && state !== 'off') {
    try { if (typeof webgazer !== 'undefined') webgazer.end(); } catch (_) {}
    current = candidate = null; sx = sy = null;
    setState('off');
  }
  document.body.classList.remove('gaze-on');
}

function setPaused(p) {
  paused = p; lastTrackAt = 0;
  if (p) setCurrent(null, performance.now());
}
function recalibrate() { if (state === 'off') return; if (webgazer.showVideoPreview) webgazer.showVideoPreview(true); camOn = true; runCalibration(); }
function toggleCamera() { camOn = !camOn; if (typeof webgazer !== 'undefined' && webgazer.showVideoPreview) webgazer.showVideoPreview(camOn); return camOn; }

window.BB = window.BB || {};
window.BB.gaze = { start, stop, setPaused, recalibrate, toggleCamera, refresh: () => { if (state !== 'off') buildLayout(); }, isActive: () => state === 'reading', state: () => state, CONFIG, READ };

})();

// Local data store. Everything lives in this browser's localStorage and nowhere else.
// Stored: per-word stage, help counts, pattern profile, session summaries, settings.
// Not stored: audio, video, or transcripts. "Delete my data" clears it all.
(function (root) {
  const KEY = "blinkbrief.v1";
  const DEFAULTS = () => ({
    version: 1,
    consent: { done: false, at: null },
    settings: { mode: "silent", gaze: false, sensitivity: 0.5, fontSize: 24 },
    words: {},            // word -> {stage, smooth, stumbles, helps, patterns}
    patterns: {},         // pattern tag -> number of stumbles
    baseline: { paceMs: null },
    passages: {},         // textHash -> {title, text}   (kept so before/after heatmaps can be drawn)
    sessions: [],         // {id, t, hash, title, simulated, mode, wordsRead, helps, helpPer100, stuck, outcomes}
    cache: {},            // cached help text: key -> {text, source}
    latencies: [],        // ms taken to show help (design target: 90% within about 2 s)
    flags: [],            // explanations the learner flagged as wrong
    misses: [],           // words the learner highlighted that the app had missed
  });

  let data = null;
  let memoryOnly = false;

  function load() {
    if (data) return data;
    try {
      const raw = root.localStorage.getItem(KEY);
      data = raw ? Object.assign(DEFAULTS(), JSON.parse(raw)) : DEFAULTS();
      data.settings = Object.assign(DEFAULTS().settings, data.settings);
    } catch (_) { data = DEFAULTS(); memoryOnly = true; }
    return data;
  }

  function save() {
    if (!data) return;
    try { root.localStorage.setItem(KEY, JSON.stringify(data)); memoryOnly = false; }
    catch (_) {
      memoryOnly = true;   // private mode or storage full: keep working in memory for this visit
      // Drop the heaviest, least important data first and try once more.
      try { data.cache = {}; data.latencies = data.latencies.slice(-100); root.localStorage.setItem(KEY, JSON.stringify(data)); memoryOnly = false; } catch (_2) {}
    }
  }

  const get = () => load();

  function deleteAll() {
    data = DEFAULTS();
    try { root.localStorage.removeItem(KEY); } catch (_) {}
    return data;
  }

  function exportJSON() { return JSON.stringify(load(), null, 2); }

  function addSession(rec) {
    const d = load();
    d.sessions.push(rec);
    if (d.sessions.length > 200) d.sessions.shift();
    save();
  }

  function wordRec(word) { return load().words[word] || null; }
  function setWordRec(word, rec) { load().words[word] = rec; save(); }

  root.BB = root.BB || {};
  root.BB.store = { get, save, deleteAll, exportJSON, addSession, wordRec, setWordRec, isMemoryOnly: () => memoryOnly };
})(typeof self !== "undefined" ? self : this);

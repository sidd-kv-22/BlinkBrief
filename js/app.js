// App shell: which screen is showing, first-launch consent, settings, and the hand-offs between screens.
(function (root) {
  const BB = root.BB = root.BB || {};
  const $ = (id) => document.getElementById(id);
  const VIEWS = ["consent", "home", "reader", "summary", "progress", "practice"];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let current = null;

  function show(name) {
    VIEWS.forEach((v) => { $(v + "-view").hidden = v !== name; });
    current = name;
    const v = $(name + "-view");
    v.classList.remove("view-enter"); void v.offsetWidth; v.classList.add("view-enter");
    root.scrollTo(0, 0);
    const h = $(name + "-view").querySelector("h1, h2");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }

  /* ---------- settings (mode and gaze) ---------- */
  function syncSettings() {
    const st = BB.store.get().settings;
    document.querySelectorAll('input[name="mode-home"], input[name="mode-consent"]').forEach((r) => { r.checked = r.value === st.mode || (r.value === "unsure" && false); });
    $("gaze-home").checked = !!st.gaze;
    $("gaze-consent").checked = !!st.gaze;
  }
  function wireSettings() {
    document.querySelectorAll('input[name="mode-home"]').forEach((r) => r.addEventListener("change", () => {
      BB.store.get().settings.mode = r.value; BB.store.save(); syncSettings();
    }));
    $("gaze-home").addEventListener("change", (e) => { BB.store.get().settings.gaze = e.target.checked; BB.store.save(); syncSettings(); });
  }

  /* ---------- consent ---------- */
  function acceptConsent() {
    const d = BB.store.get();
    const chosen = document.querySelector('input[name="mode-consent"]:checked');
    d.settings.mode = chosen && chosen.value === "aloud" ? "aloud" : "silent";   // "not sure" starts silent
    d.settings.gaze = $("gaze-consent").checked;
    d.consent = { done: true, at: Date.now() };
    BB.store.save();
    syncSettings();
    show("home");
  }

  /* ---------- reading, summary, practice ---------- */
  function read(title, text) {
    BB.reader.open(title, text);
    show("reader");
    $("reading-view").focus({ preventScroll: true });
  }

  function finishReading() {
    const res = BB.reader.finish();
    if (!res || res.summary.wordsRead === 0) { show("home"); return; }
    renderSummary(res);
    show("summary");
  }

  function renderSummary(res) {
    const s = res.summary;
    const words = res.practice.map((p) => p.word);
    $("summary-body").innerHTML = `
      <p class="lead">You read ${s.wordsRead} word${s.wordsRead === 1 ? "" : "s"} and used help ${s.helps} time${s.helps === 1 ? "" : "s"}.</p>
      ${res.simulated ? '<p class="note-inline">This reading used the <strong>simulated read-aloud</strong>, so it shows how BlinkBrief works. It is not your own reading.</p>' : ""}
      ${words.length
        ? `<h3>Words worth practising</h3><ul class="chips">${words.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
        : "<p>No words tripped you up this time. Lovely.</p>"}
      ${res.saved ? "" : '<p class="small">That was a very short reading, so it was not saved to your progress.</p>'}
      <div class="actions">
        ${words.length ? '<button type="button" class="btn primary" id="sm-practice">Two-minute practice</button>' : ""}
        <button type="button" class="btn secondary" id="sm-progress">See my progress</button>
        <button type="button" class="btn secondary" id="sm-home">Done</button>
      </div>`;
    const p = $("sm-practice"); if (p) p.onclick = () => startPractice(words);
    $("sm-progress").onclick = openProgress;
    $("sm-home").onclick = () => show("home");
  }

  function startPractice(words) {
    show("practice");
    BB.practice.start(words, () => show("home"));
  }
  function practiceFromStore() { startPractice(BB.practice.pickFromStore(3)); }

  function openProgress() { BB.progress.render(); show("progress"); }

  /* ---------- start up ---------- */
  function init() {
    const d = BB.store.get();
    wireSettings();
    $("consent-btn").addEventListener("click", acceptConsent);
    $("back-btn").addEventListener("click", finishReading);
    $("brand-home").addEventListener("click", (e) => { e.preventDefault(); if (BB.store.get().consent.done) { BB.help.close(false); show("home"); } });
    $("hero-start").addEventListener("click", (e) => { e.preventDefault(); const t = $("start-title"); if (t) { t.scrollIntoView({ behavior: "smooth", block: "start" }); t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); } });
    $("nav-progress").addEventListener("click", openProgress);
    $("nav-privacy").addEventListener("click", () => { syncSettings(); show("consent"); });
    $("home-delete").addEventListener("click", () => {
      if (root.confirm("Delete everything BlinkBrief has saved in this browser? This cannot be undone.")) { BB.store.deleteAll(); syncSettings(); $("status").textContent = "All your data has been deleted from this browser."; }
    });
    document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { BB.help.close(false); show(b.dataset.go); }));
    syncSettings();
    show(d.consent.done ? "home" : "consent");

    BB.api.probe().then((st) => {
      const note = $("backend-note");
      if (!note) return;
      note.textContent = st.up
        ? (st.llm ? "Help source: your local BlinkBrief server with a language model. Only the word and its sentence are sent to it." : "Help source: built-in lists (the local server is running, but no language model key is set).")
        : "Help source: built-in lists. Run app.py for optional language-model help.";
    });
    if (BB.store.isMemoryOnly()) $("status").textContent = "This browser is not letting BlinkBrief save data, so progress will be lost when you close the page.";
  }

  BB.app = { show, read, finishReading, practiceFromStore, startPractice, openProgress, view: () => current };
  root.showReader = read;       // kept for home.js
  document.addEventListener("DOMContentLoaded", init);
})(typeof self !== "undefined" ? self : this);

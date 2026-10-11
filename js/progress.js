// Progress view: help requests per 100 words by session, before/after heatmap,
// word stages (with one-click "show full help again"), pattern profile and data controls.
// No red marks and no scores: stuck words are amber, slowed are sand, smooth are teal. Each colour also has a text label.
(function (root) {
  const BB = root.BB = root.BB || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);
  let chosenHash = null;

  function chart(sessions) {
    const W = 560, H = 230, L = 46, R = 16, T = 16, B = 40;
    const max = Math.max(2, ...sessions.map((s) => s.helpPer100)) * 1.15;
    const x = (k) => L + (sessions.length === 1 ? (W - L - R) / 2 : (k * (W - L - R)) / (sessions.length - 1));
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const pts = sessions.map((s, k) => `${x(k)},${y(s.helpPer100)}`).join(" ");
    const ticks = [0, max / 2, max].map((v) => `<g><line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text></g>`).join("");
    const labels = sessions.map((s, k) => `<text x="${x(k)}" y="${H - 18}" text-anchor="middle">${k + 1}</text>`).join("");
    const dots = sessions.map((s, k) => `<circle cx="${x(k)}" cy="${y(s.helpPer100)}" r="6" style="--k:${k}" class="${s.simulated ? "pt sim" : "pt"}"><title>Session ${k + 1}: ${fmt(s.helpPer100)} help requests per 100 words${s.simulated ? " (simulated)" : ""}</title></circle>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-title chart-desc" class="chart">
      <title id="chart-title">Help requests per 100 words, by session</title>
      <desc id="chart-desc">${sessions.map((s, k) => `Session ${k + 1}: ${fmt(s.helpPer100)}${s.simulated ? " (simulated)" : ""}`).join(". ")}</desc>
      ${ticks}${sessions.length > 1 ? `<polyline points="${pts}" class="line" pathLength="1"/>` : ""}${dots}${labels}
      <text x="${(L + W - R) / 2}" y="${H - 2}" text-anchor="middle" class="axis">Session</text>
      <text transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="axis">Help requests per 100 words</text></svg>`;
  }

  function heat(hash, session) {
    const p = BB.store.get().passages[hash];
    if (!p || !session) return "<p class=\"small\">No saved reading of this passage yet.</p>";
    const parsed = BB.text.tokenize(p.text);
    const spans = parsed.words.map((w, n) => {
      const o = session.outcomes[w.i] || (w.i < session.wordsRead ? "smooth" : "unread");
      const cls = { stuck: "h-stuck", slowed: "h-slow", smooth: "h-ok", unread: "h-un" }[o];
      const tag = { stuck: " (stuck)", slowed: " (slowed)", smooth: "", unread: " (not read)" }[o];
      return `<span class="${cls}" style="--k:${Math.min(n, 60)}"${tag ? ` title="${esc(w.text + tag)}"` : ""}>${esc(w.text)}</span>`;
    });
    return `<p class="heat">${spans.join(" ")}</p>`;
  }

  function render() {
    const d = BB.store.get();
    const sessions = d.sessions.slice().sort((a, b) => a.t - b.t);
    const body = $("progress-body");
    const anySim = sessions.some((s) => s.simulated);
    let html = "";

    if (!sessions.length) {
      html += `<div class="empty"><p>No readings yet. Read a passage, or load a simulated history to see how this page will look after a few sessions.</p></div>`;
    } else {
      const first = sessions[0], last = sessions[sessions.length - 1];
      const totalWords = sessions.reduce((a, s) => a + s.wordsRead, 0);
      let headline = `You have read ${totalWords} words in ${sessions.length} session${sessions.length === 1 ? "" : "s"}.`;
      if (sessions.length > 1 && last.helpPer100 < first.helpPer100 * 0.8) headline = `You needed less help: ${fmt(first.helpPer100)} requests per 100 words at the start, ${fmt(last.helpPer100)} now.`;
      else if (sessions.length > 1) headline = `Help per 100 words: ${fmt(first.helpPer100)} at the start, ${fmt(last.helpPer100)} now.`;
      const stages = Object.values(d.words), light = stages.filter((r) => r.stage > 1).length;
      html += `<div class="tiles">
        <div class="tile"><b data-count="${totalWords}">${totalWords}</b><span>words read</span></div>
        <div class="tile"><b data-count="${sessions.length}">${sessions.length}</b><span>session${sessions.length === 1 ? "" : "s"}</span></div>
        <div class="tile"><b data-count="${light}">${light}</b><span>word${light === 1 ? "" : "s"} with lighter help</span></div></div>`;
      html += `<section aria-labelledby="pg-h1"><h2 id="pg-h1">Help over time</h2><p class="headline">${esc(headline)}</p>
        ${chart(sessions.slice(-14))}
        <p class="legend"><span class="key real"></span> real session <span class="key simk"></span> simulated session</p>
        <p class="small">A help request is one time the help bubble was opened for a word. Fewer requests alone does not mean better understanding. A passage read again can also feel easier simply because it was read before.</p></section>`;

      // heatmap: pick a passage that has at least two sessions, else the latest one
      const byHash = {};
      sessions.forEach((s) => { (byHash[s.hash] = byHash[s.hash] || []).push(s); });
      const multi = Object.keys(byHash).filter((h) => byHash[h].length >= 2 && d.passages[h]);
      if (!chosenHash || !byHash[chosenHash]) chosenHash = multi.length ? multi[multi.length - 1] : last.hash;
      const list = byHash[chosenHash] || [];
      const options = Object.keys(byHash).filter((h) => d.passages[h]).map((h) => `<option value="${h}"${h === chosenHash ? " selected" : ""}>${esc(d.passages[h].title)}</option>`).join("");
      html += `<section aria-labelledby="pg-h2"><h2 id="pg-h2">Before and after</h2>
        <label class="inline">Passage <select id="heat-pick">${options}</select></label>
        <p class="legend"><span class="sw h-stuck">stuck</span> <span class="sw h-slow">slowed</span> <span class="sw h-ok">smooth</span> <span class="sw h-un">not read</span></p>
        <div class="heat-grid"><div><h3>First reading${list[0] && list[0].simulated ? " (simulated)" : ""}</h3>${heat(chosenHash, list[0])}</div>
        <div><h3>Latest reading${list.length > 1 && list[list.length - 1].simulated ? " (simulated)" : ""}</h3>${list.length > 1 ? heat(chosenHash, list[list.length - 1]) : "<p class=\"small\">Read this passage again to see how it changes.</p>"}</div></div></section>`;
    }

    // stages
    const words = Object.entries(d.words).sort((a, b) => a[1].stage - b[1].stage || b[1].stumbles - a[1].stumbles);
    html += `<section aria-labelledby="pg-h3"><h2 id="pg-h3">Your words</h2>`;
    if (!words.length) html += `<p class="small">Words that tripped you up will appear here. Help gets lighter as they get easier. Nothing is taken away for good: you can always bring full help back.</p>`;
    else {
      html += `<ul class="stages">` + words.slice(0, 40).map(([w, r]) =>
        `<li><span class="wname">${esc(w)}</span><span class="badge st${r.stage}">${esc(BB.struggle.STAGE_NAMES[r.stage])}</span>${r.simulated ? '<span class="sim-tag">simulated</span>' : ""}${r.stage > 1 ? `<button type="button" class="linkish" data-full="${esc(w)}">Show full help again</button>` : ""}</li>`).join("") + `</ul>`;
    }
    html += `</section>`;

    // patterns
    const pats = Object.entries(d.patterns).filter(([k]) => BB.text.PATTERNS[k]).sort((a, b) => b[1] - a[1]);
    if (pats.length) {
      html += `<section aria-labelledby="pg-h4"><h2 id="pg-h4">Patterns that trip you up</h2><p class="small">A tiny dot appears under similar words in new texts, so you can tap for them in parts.</p><ul class="pats">` +
        pats.map(([k, n]) => `<li>${esc(BB.text.PATTERNS[k].label)} <span class="count">${n}</span></li>`).join("") + `</ul></section>`;
    }

    html += `<section aria-labelledby="pg-h5"><h2 id="pg-h5">Practice</h2><p>A short practice round: hear, say and recall your three trickiest words. No scores.</p><button type="button" class="btn primary" id="pg-practice">Start a practice round</button></section>`;

    html += `<section class="note" aria-labelledby="pg-h6"><h2 id="pg-h6">Your data</h2>
      <p>Everything on this page is stored only in this browser. ${anySim ? "<strong>This page includes simulated sessions made for the demo.</strong> They show how the page looks; they are not real readings." : ""}</p>
      <div class="actions">
        <button type="button" class="btn secondary" id="pg-demo">${BB.demo.hasSeeded() ? "Remove simulated history" : "Load simulated history (demo)"}</button>
        <button type="button" class="btn secondary" id="pg-export">Download my data</button>
        <button type="button" class="btn secondary" id="pg-delete">Delete all my data</button>
      </div><p id="pg-msg" class="status" role="status"></p></section>`;

    body.innerHTML = html;
    if (!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      body.querySelectorAll("[data-count]").forEach((el) => {
        const to = +el.dataset.count, t0 = performance.now();
        const tick = (t) => { const k = Math.min(1, (t - t0) / 800); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
    }

    const pick = $("heat-pick"); if (pick) pick.addEventListener("change", (e) => { chosenHash = e.target.value; render(); });
    body.querySelectorAll("[data-full]").forEach((b) => b.addEventListener("click", () => {
      const rec = BB.store.wordRec(b.dataset.full);
      if (rec) { rec.stage = 1; rec.smooth = 0; BB.store.setWordRec(b.dataset.full, rec); render(); }
    }));
    $("pg-practice").addEventListener("click", () => BB.app.practiceFromStore());
    $("pg-demo").addEventListener("click", () => { if (BB.demo.hasSeeded()) BB.demo.clear(); else { BB.demo.seed(PASSAGES.find((p) => p.id === "demo3") || PASSAGES[0]); } render(); });
    $("pg-export").addEventListener("click", () => {
      const blob = new Blob([BB.store.exportJSON()], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "blinkbrief-my-data.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $("pg-delete").addEventListener("click", () => {
      if (!root.confirm("Delete everything BlinkBrief has saved in this browser? This cannot be undone.")) return;
      BB.store.deleteAll(); chosenHash = null; render();
      $("pg-msg").textContent = "All your data has been deleted from this browser.";
    });
  }

  BB.progress = { render };
})(typeof self !== "undefined" ? self : this);

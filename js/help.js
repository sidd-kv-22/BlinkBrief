// The help bubble: Hear it, Say it, What it means, Make it easier.
// The first button depends on the guessed cause (rules in struggle.js); all four are always available.
(function (root) {
  const BB = root.BB = root.BB || {};
  const $ = (id) => document.getElementById(id);
  const LABELS = { hear: "Hear it", say: "Say it", meaning: "What it means", easier: "Make it easier" };
  const synth = root.speechSynthesis;

  let ctx = null;          // {index, word, clean, sentence, cause, order, hint, onHelp, onClose}
  let syls = [];
  let speakToken = 0;
  let micOk = false;

  const out = () => $("hb-out");
  const say = (html) => { out().innerHTML = html; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function renderSplit() {
    $("hb-split").innerHTML = syls.length > 1
      ? syls.map((s, k) => `<span class="syl" data-k="${k}">${esc(s)}</span>`).join('<span class="dot-sep" aria-hidden="true"> · </span>')
      : `<span class="syl" data-k="0">${esc(syls[0] || ctx.clean)}</span>`;
    $("hb-split").setAttribute("aria-label", "Word split into parts: " + syls.join(", "));
  }

  function speak(text, rate) {
    return new Promise((resolve) => {
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") return resolve(false);
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate || 0.85; u.lang = "en-US";
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      u.onend = () => fin(true); u.onerror = () => fin(false);
      setTimeout(() => fin(true), 4000 + text.length * 120);     // some browsers never fire onend
      synth.speak(u);
    });
  }

  function mark(k) { document.querySelectorAll("#hb-split .syl").forEach((el) => el.classList.toggle("on", Number(el.dataset.k) === k)); }

  async function doHear() {
    if (!synth) { say("<p>Audio is not available in this browser. The word is split into parts above.</p>"); return; }
    const my = ++speakToken;
    synth.cancel();
    say("<p>Listening…</p>");
    await speak(ctx.clean, 0.8);
    if (my !== speakToken) return;
    if (syls.length > 1) {
      for (let k = 0; k < syls.length; k++) {
        mark(k);
        await speak(syls[k], 0.65);
        if (my !== speakToken) return;
      }
      mark(-1);
      await speak(ctx.clean, 0.8);
    }
    if (my === speakToken) say("<p>Want to hear it again? Press Hear it.</p>");
  }

  async function doSay() {
    if (!BB.speech.supported()) { say("<p>Say it needs a browser with speech recognition, such as Chrome or Edge, and a microphone.</p>"); return; }
    if (!micOk && BB.store.get().settings.mode !== "aloud") {
      micOk = true;
      say("<p>Say it uses your microphone for one short try. Press Say it again if that is OK.</p>");
      return;
    }
    say('<p class="listening">Listening… say the word.</p>');
    const r = await BB.speech.listenOnce(6000);
    if (r.error === "not-allowed" || r.error === "service-not-allowed") { say("<p>The microphone is switched off for this page. You can allow it in your browser's site settings.</p>"); return; }
    if (r.error) { say("<p>I didn't catch that. Press Say it and try once more.</p>"); return; }
    const best = Math.max(...r.heard.map((h) => BB.speech.sim(h.split(/\s+/)[0] || h, ctx.clean)), ...r.heard.map((h) => BB.speech.sim(h, ctx.clean)));
    const heard = esc(r.heard[0]);
    if (best >= 0.8) say(`<p class="good">Got it. That sounded right.</p><p class="small">I heard “${heard}”.</p>`);
    else if (best >= 0.5) say(`<p>Close! I heard “${heard}”. Try it in parts: <strong>${esc(syls.join(" · "))}</strong></p>`);
    else say(`<p>I heard “${heard}”. Try again, one part at a time: <strong>${esc(syls.join(" · "))}</strong></p>`);
  }

  async function doMeaning() {
    say('<p class="wait">One moment…</p>');
    const r = await BB.api.meaning(ctx.clean, ctx.sentence);
    if (!ctx || $("help-bubble").hidden) return;
    say(`<p class="answer">${esc(r.text)}</p>
         <p class="small">Source: ${esc(r.source)}. <button type="button" class="linkish" id="hb-flag">This explanation looks wrong</button></p>`);
    $("hb-flag").onclick = () => { BB.api.flagBad("meaning", ctx.clean, r.text); say("<p>Thanks. We won't show that one again.</p>"); };
  }

  async function doEasier() {
    say('<p class="wait">One moment…</p>');
    const r = await BB.api.simplify(ctx.sentence);
    if (!ctx || $("help-bubble").hidden) return;
    const note = r.same ? "<p class=\"small\">I could not make this one simpler without the language-model backend.</p>" : `<p class="small">Source: ${esc(r.source)}. <button type="button" class="linkish" id="hb-flag">This rewrite looks wrong</button></p>`;
    say(`<div class="pair"><div><h4>Original</h4><p>${esc(ctx.sentence)}</p></div>${r.same ? "" : `<div><h4>Easier</h4><p class="answer">${esc(r.text)}</p></div>`}</div>${note}`);
    const f = $("hb-flag"); if (f) f.onclick = () => { BB.api.flagBad("simplify", ctx.clean, r.text); say("<p>Thanks. We won't show that one again.</p>"); };
  }

  const ACTIONS = { hear: doHear, say: doSay, meaning: doMeaning, easier: doEasier };

  function renderButtons() {
    const box = $("hb-actions");
    box.innerHTML = "";
    ctx.order.forEach((a, k) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.action = a; b.textContent = LABELS[a];
      b.className = "btn small " + (k === 0 && ctx.cause !== "unclear" ? "primary" : "secondary");
      b.addEventListener("click", () => { if (ctx.onHelp) ctx.onHelp(ctx.index, a); ACTIONS[a](); });
      box.appendChild(b);
    });
  }

  function renderStage() {
    const rec = BB.store.wordRec(ctx.clean);
    const box = $("hb-stage");
    if (rec && rec.stage > 1) {
      box.hidden = false;
      box.innerHTML = `Help for this word is ${BB.struggle.STAGE_NAMES[rec.stage].toLowerCase()} now. <button type="button" class="linkish" id="hb-full">Show full help again</button>`;
      $("hb-full").onclick = () => {
        rec.stage = 1; rec.smooth = 0; BB.store.setWordRec(ctx.clean, rec);
        box.textContent = "Full help is back for this word.";
        if (ctx.onStageReset) ctx.onStageReset(ctx.index);
      };
    } else box.hidden = true;
  }

  function open(c) {
    ctx = c;
    speakToken++; if (synth) synth.cancel();
    syls = BB.api.syllablesLocal(ctx.clean);
    $("hb-word").textContent = ctx.word;
    $("hb-hint").textContent = ctx.hint || "";
    renderSplit(); renderButtons(); renderStage();
    say("");
    const el = $("help-bubble");
    el.hidden = false;
    el.dataset.cause = ctx.cause;
    // upgrade the split from the backend (pyphen) if it is running and disagrees
    BB.api.syllables(ctx.clean).then((s) => { if (ctx && s.join("") === syls.join("") && s.length !== syls.length) { syls = s; renderSplit(); } });
    if (c.autoAction) ACTIONS[c.autoAction]();
  }

  function close(returnFocus) {
    const el = $("help-bubble");
    if (el.hidden) return;
    el.hidden = true;
    speakToken++; if (synth) synth.cancel();
    const c = ctx; ctx = null;
    if (c && c.onClose) c.onClose(c.index);
    if (returnFocus !== false) { const v = $("reading-view"); if (v) v.focus({ preventScroll: true }); }
  }

  const isOpen = () => !$("help-bubble").hidden;
  const currentIndex = () => (ctx && isOpen() ? ctx.index : null);

  document.addEventListener("DOMContentLoaded", () => {
    $("hb-close").addEventListener("click", () => close());
    $("help-bubble").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  });

  BB.help = { open, close, isOpen, currentIndex, LABELS, speak };
})(typeof self !== "undefined" ? self : this);

// Practice round (document 7.6): hear it, say it and recall it for the words that tripped the learner.
// Friendly wording, no scores, no red marks.
(function (root) {
  const BB = root.BB = root.BB || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let words = [], w = 0, step = 0, tries = 0, onDone = null;
  const STEPS = ["hear", "say", "recall"];

  /* Three trickiest words saved so far: most stumbles and help first, lighter stages later. */
  function pickFromStore(max) {
    return Object.entries(BB.store.get().words)
      .filter(([word]) => word.length >= 3)
      .sort((a, b) => (b[1].stumbles + b[1].helps) - (a[1].stumbles + a[1].helps) || a[1].stage - b[1].stage)
      .slice(0, max || 3).map(([word]) => word);
  }

  function parts(word) { return BB.api.syllablesLocal(word); }
  const dotted = (word) => parts(word).join(" · ");

  function card(html) { const pb = $("practice-body"); pb.classList.remove("swap"); void pb.offsetWidth; pb.classList.add("swap"); pb.innerHTML = html; const b = $("practice-body").querySelector("button, input"); if (b) b.focus(); }
  const progress = () => `<p class="small" aria-live="polite">Word ${w + 1} of ${words.length} &middot; ${["Hear it", "Say it", "Recall it"][step]}</p>`;

  function render() {
    if (w >= words.length) return finish();
    const word = words[w];
    if (STEPS[step] === "hear") {
      card(`${progress()}<div class="pword" aria-label="${esc(word)}">${esc(word)}</div><p class="split">${esc(dotted(word))}</p>
        <div class="actions"><button type="button" class="btn secondary" id="pr-hear">Hear it</button><button type="button" class="btn primary" id="pr-next">Next</button></div><p id="pr-out" class="status" role="status"></p>`);
      $("pr-hear").onclick = async () => { await BB.help.speak(word, 0.8); for (const p of parts(word)) await BB.help.speak(p, 0.65); await BB.help.speak(word, 0.8); };
      $("pr-next").onclick = next;
      BB.help.speak(word, 0.8);
    } else if (STEPS[step] === "say") {
      card(`${progress()}<div class="pword">${esc(word)}</div><p class="split">${esc(dotted(word))}</p><p>Say the word out loud.</p>
        <div class="actions">${BB.speech.supported() ? '<button type="button" class="btn secondary" id="pr-say">Say it</button>' : ""}<button type="button" class="btn primary" id="pr-next">I said it</button></div><p id="pr-out" class="status" role="status"></p>`);
      const sayBtn = $("pr-say");
      if (sayBtn) sayBtn.onclick = async () => {
        $("pr-out").textContent = "Listening…";
        const r = await BB.speech.listenOnce(6000);
        if (r.error) { $("pr-out").textContent = "I didn't catch that. You can try again or press I said it."; return; }
        const best = Math.max(...r.heard.map((h) => BB.speech.sim(h, word)));
        $("pr-out").textContent = best >= 0.8 ? "Got it. That sounded right." : `I heard “${r.heard[0]}”. Close! Try it in parts: ${dotted(word)}`;
      };
      $("pr-next").onclick = next;
    } else {
      tries = 0;
      card(`${progress()}<div class="pword mask" aria-hidden="true">${"• ".repeat(word.length).trim()}</div><p>Listen, then type the word.</p>
        <div class="actions"><button type="button" class="btn secondary" id="pr-hear">Hear it</button></div>
        <form id="pr-form" class="recall"><label for="pr-input" class="vh">Type the word</label><input id="pr-input" autocomplete="off" autocapitalize="off" spellcheck="false" /><button type="submit" class="btn primary">Check</button></form>
        <p id="pr-out" class="status" role="status"></p>`);
      $("pr-hear").onclick = () => BB.help.speak(word, 0.8);
      BB.help.speak(word, 0.8);
      $("pr-form").onsubmit = (e) => {
        e.preventDefault();
        const val = $("pr-input").value.trim().toLowerCase();
        if (val === word) { $("pr-out").innerHTML = '<span class="good">Got it!</span> <button type="button" class="btn primary" id="pr-next">Next</button>'; $("pr-next").onclick = next; $("pr-next").focus(); return; }
        tries++;
        if (tries < 2) { $("pr-out").textContent = `Nearly. Look at the parts: ${dotted(word)}. Try once more.`; $("pr-input").select(); }
        else { $("pr-out").innerHTML = `The word is <strong>${esc(word)}</strong> (${esc(dotted(word))}). We will try it again another day. <button type="button" class="btn primary" id="pr-next">Next</button>`; $("pr-next").onclick = next; $("pr-next").focus(); }
      };
    }
  }

  function next() { step++; if (step >= STEPS.length) { step = 0; w++; } render(); }

  function finish() {
    card(`<h3>Nice practice.</h3><p>These words will come back in your next readings, and help for them gets lighter as they get easier.</p>
      <div class="actions"><button type="button" class="btn primary" id="pr-done">Done</button></div>`);
    $("pr-done").onclick = () => { if (onDone) onDone(); };
  }

  function start(list, done) {
    words = list.slice(0, 3); w = 0; step = 0; onDone = done;
    if (!words.length) { card(`<p>There are no words to practise yet. Read a passage first, and the words that trip you up will show here.</p><div class="actions"><button type="button" class="btn primary" id="pr-done">Back</button></div>`); $("pr-done").onclick = () => onDone && onDone(); return; }
    render();
  }

  BB.practice = { start, pickFromStore };
})(typeof self !== "undefined" ? self : this);

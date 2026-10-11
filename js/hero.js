// The home page demo: plays BlinkBrief's loop once. A highlight follows the reading, a hard word gets an
// underline, the help card opens, then the underline fades over later sessions. Decorative only (aria-hidden);
// a text description sits beside it for screen readers. With reduced motion it shows the end state, still.
(function (root) {
  const SENTENCE = "The scientist made a careful, thorough check of the results.";
  const HARD = 5;                                   // "thorough"
  const $ = (id) => document.getElementById(id);
  let timers = [], words = [];

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); };
  const reduced = () => root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function build() {
    const box = $("demo-text");
    box.innerHTML = "";
    words = SENTENCE.split(" ").map((w) => {
      const s = document.createElement("span");
      s.className = "dw"; s.textContent = w;
      box.appendChild(s); box.appendChild(document.createTextNode(" "));
      return s;
    });
  }

  function place(i) {
    const hl = $("demo-hl"), card = hl.parentElement, w = words[i];
    if (!w) { hl.style.opacity = 0; return; }
    const c = card.getBoundingClientRect(), r = w.getBoundingClientRect();
    hl.style.opacity = 1;
    hl.style.width = r.width + "px"; hl.style.height = r.height + "px";
    hl.style.transform = `translate(${r.left - c.left}px, ${r.top - c.top}px)`;
  }

  function reset() {
    timers.forEach(clearTimeout); timers = [];
    build();
    $("demo-bubble").classList.remove("show");
    $("demo-hl").style.opacity = 0;
    $("demo-chip").textContent = "Session 1";
    document.querySelectorAll("#demo-fade span").forEach((s) => s.classList.remove("in"));
  }

  function endState() {
    words[HARD].classList.add("draw");
    document.querySelectorAll("#demo-fade span").forEach((s) => s.classList.add("in"));
  }

  function play() {
    reset();
    if (reduced()) { endState(); return; }
    let t = 700;
    for (let i = 0; i < words.length; i++) {
      const step = i === HARD ? 1700 : 330;
      later(() => place(i), t);
      if (i === HARD) {
        later(() => words[HARD].classList.add("draw"), t + 700);
        later(() => $("demo-bubble").classList.add("show"), t + 1500);
        later(() => $("demo-bubble").classList.remove("show"), t + 4300);
        t += 3200;
      }
      t += step;
    }
    later(() => { $("demo-hl").style.opacity = 0; }, t + 200);
    later(() => { $("demo-chip").textContent = "Later sessions"; }, t + 500);
    document.querySelectorAll("#demo-fade span").forEach((s, k) => later(() => s.classList.add("in"), t + 600 + k * 650));
  }

  function init() {
    if (!$("demo-text")) return;
    build();
    $("demo-replay").addEventListener("click", play);
    // start when the home page is actually showing (and re-sync if the layout shifts)
    const home = $("home-view");
    let started = false;
    const go = () => { if (!started && !home.hidden) { started = true; later(play, 300); } };
    new MutationObserver(go).observe(home, { attributes: true, attributeFilter: ["hidden"] });
    go();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!started) return; });
  }
  document.addEventListener("DOMContentLoaded", init);
})(typeof self !== "undefined" ? self : this);

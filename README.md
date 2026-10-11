# BlinkBrief

A reading coach for dyslexic learners that notices when a reader gets stuck, offers help that
fits the likely cause, and fades as the learner improves. Built for the AI for Education hackathon (Pysustain).

> **Status: prototype.** Statements about effectiveness are hypotheses until tested with real learners.
> The cause rules, struggle-score weights and fading thresholds are placeholders. The multi-session
> history in the demo is **simulated** and labelled as such. BlinkBrief does not diagnose dyslexia.

## What it does (project document, section 7)

| Step | Where |
|---|---|
| First launch: privacy message, choose read-aloud / silent, nothing recorded before consent | `index.html`, `js/app.js` |
| Reading view with soft highlight following the voice, mouse, keyboard or gaze | `js/reader.js` |
| Read-aloud tracking: word times, pauses, repeats, wrong words, re-reading | `js/speech.js` |
| Struggle score and cause rules (decoding / vocabulary / meaning / unclear) | `js/struggle.js`, `js/session.js` |
| Faint underline, quiet corner help bubble: **Hear it, Say it, What it means, Make it easier** (order depends on the cause, original sentence always shown) | `js/help.js`, `js/api.js` |
| Manual rescue: click any missed word, the miss is logged | `js/reader.js` |
| Four fading stages per word, reversible with one click | `js/struggle.js`, `js/progress.js` |
| Pattern profile and tiny pre-help dots on similar words | `js/struggle.js`, `js/reader.js` |
| End summary, practice round (hear, say, recall; no scores) | `js/practice.js` |
| Progress: help requests per 100 words, before/after heatmap | `js/progress.js` |
| Controls: pause, sensitivity slider, text size, mode switch, export and **delete all data** | `index.html`, `js/store.js` |
| Optional webcam gaze (WebGazer, three-part calibration, reading model) | `js/gaze.js`, `css/gaze.css` |

## Run it

```bash
python3 -m venv .venv               # Ubuntu/Debian block system-wide pip, so use a virtual environment
source .venv/bin/activate           # (sudo apt install python3-venv  if the line above fails)
pip install -r requirements.txt     # flask (+ optional pyphen)
python3 app.py                      # http://127.0.0.1:5000
```
`.venv/` is ignored by git.

You can also open `index.html` directly: everything except the optional server helpers works.

Optional language-model help (meanings from the sentence, rewrites of any sentence):

```bash
export ANTHROPIC_API_KEY=...        # optional; BLINKBRIEF_MODEL overrides the default model
python3 app.py
```

Without a key, BlinkBrief uses built-in meanings and easier sentences for the demo passages and simple
rewriting rules for other text. Only the word and its sentence are ever sent to the model.

## Modes and browser support

* **Read aloud** needs speech recognition (Chrome or Edge). BlinkBrief asks the browser for on-device
  recognition and shows "on this device" or "browser speech service" on the microphone label.
  Chrome may use an online service when no on-device language pack is installed, so the "everything stays on the device"
  claim only holds for on-device recognition. Say so in the demo.
* **Silent** works everywhere: the pointer (or arrow keys) follows the reading; long dwell, looking back and rare words are the signals.
* **Simulated read-aloud (demo)** button in the reader runs a scripted reading through the same pipeline, for demos with no microphone.
* **Webcam gaze** is optional. WebGazer is loaded from a CDN only when gaze is turned on (internet needed the first time).
  Webcam gaze is coarse (about 100 to 200 px); BlinkBrief uses it as an extra signal.

## Privacy

Stored in this browser only (localStorage): per-word stage and help counts, pattern profile, session summaries,
the passage text (for the before/after heatmap) and settings. Never stored: audio, video, transcripts.
"Delete all my data" (home and progress pages) clears everything; "Download my data" exports it.

## Tests

```bash
node --test tests/logic.test.js                          # text analysis, score, cause rules, stages, speech alignment
python3 -m unittest discover -s tests -p "test_*.py"     # Flask server and API
python3 tests/e2e.py [--shots DIR]                       # whole app in headless Chromium (needs playwright)
```

The e2e test uses a fake WebGazer and the simulated read-aloud, because a headless browser has no face or microphone.
It has not been run with a real webcam, microphone or learner.

## Evaluation tooling

`eval/metrics.py` computes precision, recall and F1 per signal and Cohen's kappa for the cause rules from a
labelled CSV (objectives O1 and O2). See the file header for the format.

## Layout

```
index.html  app.py  requirements.txt
js/   textproc struggle session speech store api demo help gaze reader progress practice extract home app
data/ passages  glossary (cached meanings and easier sentences)  common-words
css/  style  gaze
lib/  pdf.js, jszip (file upload)
tests/  eval/  archive/old-gaze-versions/
```

## Known limits

* Silent-mode "words read" is the furthest word the pointer reached.
* Cause rules and thresholds are untuned guesses; syllable splitting in the browser is rule-based (pyphen is better).
* No testing with dyslexic learners has taken place.

## Team
Siddarth KV, Soham Vyas, Shikhar Konnur, Pavan Soman

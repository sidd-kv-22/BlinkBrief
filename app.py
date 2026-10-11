"""BlinkBrief local server.

Serves the front end and offers three optional helpers:
  /api/syllables  word -> syllable split (pyphen, if installed)
  /api/meaning    word + its sentence -> plain-words meaning (needs ANTHROPIC_API_KEY)
  /api/simplify   sentence -> easier sentence          (needs ANTHROPIC_API_KEY)

The app works without any of these: the browser falls back to built-in lists and simple rules.
Privacy: the server only ever receives a word and its sentence. No audio, video, names or history.
It listens on 127.0.0.1 (this computer only) unless you set HOST.
"""
import json
import os
import re
import urllib.error
import urllib.request
from collections import OrderedDict

from flask import Flask, abort, jsonify, request, send_from_directory

try:
    import pyphen
    _DIC = pyphen.Pyphen(lang="en_US")
except Exception:  # pyphen is optional
    _DIC = None

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIRS = {"css", "js", "lib", "data"}          # only these folders are served as static files
MODEL = os.environ.get("BLINKBRIEF_MODEL", "claude-haiku-5-5")
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]{0,39}$")

app = Flask(__name__, static_folder=None)
_cache = OrderedDict()                                # tiny in-memory cache, cleared when the server stops
_stages = {}                                          # /diagnose compatibility: word -> help stage


def _llm_key():
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def llm_complete(system, user, max_tokens=140):
    """Ask the language model. Returns text, or None when no key is set or the call fails."""
    key = _llm_key()
    if not key:
        return None
    body = json.dumps({
        "model": MODEL, "max_tokens": max_tokens, "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            data = json.load(r)
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip() or None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None


def _cached(key, fn):
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    val = fn()
    if val:
        _cache[key] = val
        if len(_cache) > 500:
            _cache.popitem(last=False)
    return val


def syllables_of(word):
    if _DIC is None:
        return None
    return _DIC.inserted(word.lower()).split("-")


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:path>")
def static_files(path):
    parts = path.split("/")
    # Only the public folders, and never a ".." (otherwise /js/../app.py would reach private files).
    if parts[0] not in PUBLIC_DIRS or any(p in ("", ".", "..") or "\\" in p for p in parts):
        abort(404)
    return send_from_directory(ROOT, path)


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "llm": bool(_llm_key()), "pyphen": _DIC is not None, "model": MODEL if _llm_key() else None})


@app.post("/api/syllables")
def api_syllables():
    word = (request.get_json(silent=True) or {}).get("word", "")
    if not WORD_RE.match(word):
        return jsonify({"error": "bad word"}), 400
    parts = syllables_of(word)
    if parts is None:
        return jsonify({"error": "pyphen not installed"}), 503
    return jsonify({"word": word, "syllables": parts})


@app.post("/api/meaning")
def api_meaning():
    data = request.get_json(silent=True) or {}
    word = str(data.get("word", "")).strip()
    sentence = str(data.get("sentence", "")).strip()[:400]
    if not WORD_RE.match(word):
        return jsonify({"error": "bad word"}), 400
    system = ("You help a child who finds reading hard. Explain the word in one or two short, simple sentences, "
              "using the sentence for context. Use plain, common words. Do not mention reading difficulties.")
    user = f'Word: "{word}"\nSentence: "{sentence}"'
    text = _cached(("m", word.lower(), sentence), lambda: llm_complete(system, user))
    if not text:
        return jsonify({"error": "no language model available"}), 503
    return jsonify({"text": text, "source": "language model"})


@app.post("/api/simplify")
def api_simplify():
    sentence = str((request.get_json(silent=True) or {}).get("sentence", "")).strip()[:400]
    if len(sentence) < 3:
        return jsonify({"error": "no sentence"}), 400
    system = ("Rewrite the sentence so it is easier to read for a child. Keep the same meaning. Use common words and "
              "short sentences. Do not add new facts. Reply with only the rewritten text.")
    text = _cached(("s", sentence), lambda: llm_complete(system, f'Sentence: "{sentence}"'))
    if not text:
        return jsonify({"error": "no language model available"}), 503
    return jsonify({"text": text, "source": "language model"})


@app.post("/diagnose")
def diagnose():
    """Kept from the first prototype for the standalone gaze page (CONFIG.diagnoseUrl). The main app does this in the browser."""
    data = request.get_json(silent=True) or {}
    word = "".join(c for c in str(data.get("word", "")) if c.isalpha() or c == "'")
    if not word:
        return jsonify({"status": "error", "message": "No word provided"}), 400
    parts = syllables_of(word) or [word]
    stage = _stages.get(word.lower(), 1)
    _stages[word.lower()] = stage + 1
    return jsonify({"word": word, "type": "phonetic" if len(parts) >= 3 else "vocabulary",
                    "payload": {"syllables": " · ".join(parts)}, "stage": stage, "status": "scaffolded"})


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    print(f"BlinkBrief is running at http://{host}:{port}")
    print("Language-model help:", "ON" if _llm_key() else "off (set ANTHROPIC_API_KEY to turn it on)")
    print("Syllable splitting:", "pyphen" if _DIC else "built into the browser (pip install pyphen for better splits)")
    app.run(host=host, port=port, debug=os.environ.get("BLINKBRIEF_DEBUG") == "1")

"""Server tests. Run with: python3 -m unittest discover -s tests -p "test_*.py" """
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import app as blink  # noqa: E402


class ServerTests(unittest.TestCase):
    def setUp(self):
        blink.app.config["TESTING"] = True
        blink._cache.clear()
        self.c = blink.app.test_client()

    def test_home_and_static(self):
        self.assertIn(b"BlinkBrief", self.c.get("/").data)
        self.assertEqual(self.c.get("/js/textproc.js").status_code, 200)
        self.assertEqual(self.c.get("/css/style.css").status_code, 200)

    def test_private_files_are_not_served(self):
        for path in ("/app.py", "/tests/test_app.py", "/archive/old-gaze-versions/gaze-1.html", "/requirements.txt"):
            self.assertEqual(self.c.get(path).status_code, 404, path)
        for path in ("/js/../app.py", "/js/%2e%2e/app.py", "/data/../.git/config", "/js//textproc.js"):
            self.assertIn(self.c.get(path).status_code, (404, 308), path)

    @mock.patch.dict(os.environ, {}, clear=False)
    def test_health_and_fallback_without_key(self):
        os.environ.pop("ANTHROPIC_API_KEY", None)
        j = self.c.get("/api/health").get_json()
        self.assertTrue(j["ok"])
        self.assertFalse(j["llm"])
        r = self.c.post("/api/meaning", json={"word": "thorough", "sentence": "A thorough check."})
        self.assertEqual(r.status_code, 503)

    def test_meaning_and_simplify_with_model(self):
        calls = []

        def fake(system, user, max_tokens=140):
            calls.append(user)
            return "Complete. Nothing is missed."

        with mock.patch.object(blink, "llm_complete", fake):
            r = self.c.post("/api/meaning", json={"word": "thorough", "sentence": "A thorough check."})
            self.assertEqual(r.status_code, 200)
            self.assertTrue(r.get_json()["text"].startswith("Complete"))
            self.assertIn('Word: "thorough"', calls[0])
            self.assertIn("A thorough check.", calls[0])
            self.c.post("/api/meaning", json={"word": "thorough", "sentence": "A thorough check."})
            self.assertEqual(len(calls), 1, "an identical second request should come from the cache")
            self.assertEqual(self.c.post("/api/simplify", json={"sentence": "She made a thorough check."}).status_code, 200)

    def test_input_validation(self):
        with mock.patch.object(blink, "llm_complete", lambda *a, **k: "x"):
            self.assertEqual(self.c.post("/api/meaning", json={"word": "<script>", "sentence": "s"}).status_code, 400)
            self.assertEqual(self.c.post("/api/meaning", json={"word": "a" * 60, "sentence": "s"}).status_code, 400)
            self.assertEqual(self.c.post("/api/simplify", json={"sentence": ""}).status_code, 400)
            self.assertEqual(self.c.post("/api/syllables", json={"word": "no spaces"}).status_code, 400)

    def test_syllables(self):
        r = self.c.post("/api/syllables", json={"word": "thorough"})
        if blink._DIC is None:
            self.assertEqual(r.status_code, 503)
        else:
            self.assertEqual("".join(r.get_json()["syllables"]), "thorough")

    def test_model_failure_gives_503_not_500(self):
        os.environ["ANTHROPIC_API_KEY"] = "test"
        try:
            with mock.patch("urllib.request.urlopen", side_effect=OSError("offline")):
                r = self.c.post("/api/simplify", json={"sentence": "She made a thorough check."})
            self.assertEqual(r.status_code, 503)
        finally:
            os.environ.pop("ANTHROPIC_API_KEY", None)

    def test_diagnose_compat(self):
        r = self.c.post("/diagnose", json={"word": "thorough!"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["word"], "thorough")
        self.assertEqual(self.c.post("/diagnose", json={"word": ""}).status_code, 400)


if __name__ == "__main__":
    unittest.main()

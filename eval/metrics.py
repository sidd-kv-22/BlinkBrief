"""Pilot evaluation helpers (objectives O1 and O2). Plain Python, no dependencies.

Input CSV for signal evaluation (one row per word):  word,label,signal_a,signal_b,...,fused
  label = 1 if the reader said the word was hard, else 0; each signal column is 1 if that signal flagged the word.
Input CSV for the cause rules:  word,rule,human   (cause names: decoding, vocabulary, meaning, unclear)

    python3 eval/metrics.py signals words.csv
    python3 eval/metrics.py kappa causes.csv
"""
import csv
import sys
from collections import Counter


def prf(truth, pred):
    tp = sum(1 for t, p in zip(truth, pred) if t and p)
    fp = sum(1 for t, p in zip(truth, pred) if not t and p)
    fn = sum(1 for t, p in zip(truth, pred) if t and not p)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return prec, rec, f1


def cohen_kappa(a, b):
    n = len(a)
    if n == 0:
        return 0.0
    po = sum(1 for x, y in zip(a, b) if x == y) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum(ca[k] * cb[k] for k in set(a) | set(b)) / (n * n)
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)


def main(argv):
    if len(argv) != 3 or argv[1] not in ("signals", "kappa"):
        print(__doc__)
        return 2
    with open(argv[2], newline="") as f:
        rows = list(csv.DictReader(f))
    if argv[1] == "signals":
        truth = [int(r["label"]) for r in rows]
        for col in [c for c in rows[0] if c not in ("word", "label")]:
            p, r, f1 = prf(truth, [int(x[col]) for x in rows])
            print(f"{col:12s} precision {p:.2f}  recall {r:.2f}  F1 {f1:.2f}")
        print(f"\n{len(rows)} words. Target (O1): fused F1 at least as high as the best single signal.")
    else:
        k = cohen_kappa([r["rule"] for r in rows], [r["human"] for r in rows])
        majority = Counter(r["human"] for r in rows).most_common(1)[0][1] / len(rows)
        print(f"Cohen's kappa {k:.2f}  (target for O2: at least 0.4). Majority-class agreement: {majority:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

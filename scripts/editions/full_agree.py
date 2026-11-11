"""Keeps the differences that both OCR texts show at the same place, with a class for each.
Usage: python3 -I full_agree.py <d600.json> <d1600.json> <out.json>"""
import json, sys, collections
a, b = (json.load(open(f)) for f in sys.argv[1:3])
key = lambda d: (d["i"], tuple(d["mine"]), tuple(d["ocr"]))
kb = {key(d) for d in b}
both = [d for d in a if key(d) in kb]
def cls(d):
    m, o = "".join(d["mine"]), "".join(d["ocr"])
    if m.replace("-", "") == o.replace("-", ""): return "hyphen"
    if all(not c.isalnum() for c in m + o): return "punct"
    if m.lower() == o.lower(): return "case"
    return "word"
c = collections.Counter(cls(d) for d in both)
print(len(both), c)
for d in both: d["cls"] = cls(d)
json.dump(both, open(sys.argv[3], "w"), indent=0)

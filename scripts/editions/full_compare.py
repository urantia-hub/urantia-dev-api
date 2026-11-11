"""Aligns the 1955 build with one archive.org OCR text of the whole book. Writes the differences as JSON.
Usage: python3 -I scripts/editions/full_compare.py <b1955.jsonl> <searchtext> <pageindex> <page_numbers> <out.json>
<b1955.jsonl>: one line {ref, paper, text} for each paragraph, the 1955 edition in book order."""
import json, re, sys, difflib, bisect

b_path, st_path, ix_path, pn_path, out_path = sys.argv[1:6]
text = open(st_path).read()
index = json.load(open(ix_path))
pages = json.load(open(pn_path))["pages"]
page_of_leaf = {p["leafNum"]: p["pageNumber"] for p in pages}

# The OCR text without the running head (first line) of each leaf; keep the leaf of each character.
parts, leaf_at = [], []
for i, (s, e, *_r) in enumerate(index):
    t = text[s:e]
    first, _, rest = t.partition("\n")
    if len(first) < 70 and (re.search(r"\d", first) or first.isupper()):
        t = rest
    t = re.sub(r"([a-z])- \n?(?=[a-z])", r"\1", t)  # a word broken at a line end
    parts.append(t + "\n")
    leaf_at.append(sum(len(p) for p in parts[:-1]))
ocr = "".join(parts)
leaf_starts = leaf_at

QUOTES = str.maketrans({c: '"' for c in "“”„‟«»"} | {c: "'" for c in "‘’‚‛`"})
TOK = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z]+)*|[^\sA-Za-z0-9]")


def toks(s, base=0):
    s = s.translate(QUOTES)
    return [(m.group(), base + m.start()) for m in TOK.finditer(s)]


O = toks(ocr)
ow = [t for t, _ in O]

paras = [json.loads(l) for l in open(b_path)]
mine, ref_of = [], []
for p in paras:
    for t, _ in toks(p["text"]):
        mine.append(t); ref_of.append(p["ref"])

# Anchors: word 6-grams that occur once in each text, kept in the same order in both (LIS).
def grams(ws):
    idx = [i for i, w in enumerate(ws) if w[0].isalnum()]
    lw = [ws[i].lower() for i in idx]
    c, at = {}, {}
    for k in range(len(lw) - 5):
        g = tuple(lw[k:k + 6]); c[g] = c.get(g, 0) + 1; at[g] = idx[k]
    return {g: at[g] for g, n in c.items() if n == 1}
gm, go = grams(mine), grams(ow)
pairs = sorted((gm[g], go[g]) for g in gm.keys() & go.keys())
tails, prev, tail_idx = [], [None] * len(pairs), []
for n, (_, j) in enumerate(pairs):
    k = bisect.bisect_left(tails, j)
    if k == len(tails): tails.append(j); tail_idx.append(n)
    else: tails[k] = j; tail_idx[k] = n
    prev[n] = tail_idx[k - 1] if k else None
chain, n = [], tail_idx[-1]
while n is not None:
    chain.append(pairs[n]); n = prev[n]
chain.reverse()
print("anchors", len(chain), "of", len(pairs))

out = []
bounds = [(0, 0)] + [(i, j) for i, j in chain] + [(len(mine), len(ow))]
for (i0, j0), (i1, j1) in zip(bounds, bounds[1:]):
    if i1 - i0 == j1 - j0 and mine[i0:i1] == ow[j0:j1]:
        continue
    sm = difflib.SequenceMatcher(None, mine[i0:i1], ow[j0:j1], autojunk=False)
    for op, a1, a2, b1, b2 in sm.get_opcodes():
        if op == "equal":
            continue
        I1, I2, J1, J2 = i0 + a1, i0 + a2, j0 + b1, j0 + b2
        off = O[J1][1] if J1 < len(O) else 0
        li = bisect.bisect_right(leaf_starts, off) - 1
        out.append({"ref": ref_of[min(I1, len(ref_of) - 1)], "i": I1, "op": op,
                    "mine": mine[I1:I2], "ocr": ow[J1:J2],
                    "ctx": " ".join(mine[max(0, I1 - 6):I2 + 6]),
                    "leaf": li, "page": page_of_leaf.get(li)})
json.dump(out, open(out_path, "w"))
print("diffs", len(out))

# The leaf of each paragraph's first anchored word.
first_i, n = {}, 0
for p in paras:
    first_i[p["ref"]] = n; n += len(toks(p["text"]))
ci = [i for i, _ in chain]
para_leaf = {}
for ref, i in first_i.items():
    k = bisect.bisect_left(ci, i)
    if k < len(chain):
        para_leaf[ref] = bisect.bisect_right(leaf_starts, O[chain[k][1]][1]) - 1
json.dump(para_leaf, open(out_path.replace(".json", "-leaf.json"), "w"))

"""Builds data/editions/variants.json from Urantia Foundation sources only.

Usage: python3 -I build_variants.py <reports dir> <stored json dir> <out.json>
<reports dir> holds adopted.html (urantia.org/study/adopted-corrections-1955-text) and the committee
report PDFs as text (pdftotext -layout). <stored json dir> is the seed JSON (download 1.22).
"""
import re, html, json, sys, glob, collections

rep, json_dir, out_path = sys.argv[1:4]

# 1. The rows of the adopted corrections page.
page = open(f"{rep}/adopted.html", encoding="utf-8").read()


def plain(x):
    x = html.unescape(re.sub(r"<[^>]+>", "", x))
    return re.sub(r"\s+", " ", x).strip()


def side(review, new, keep_em=False):
    # The 1955 wording (new=False) or the SRT wording (new=True) of a "Review:" line.
    def rep_mark(m):
        inner = m.group(1)
        old = "".join(re.findall(r"<s>(.*?)</s>", inner, re.S))
        ins = re.sub(r"<s>.*?</s>", "", inner, flags=re.S)
        return ins if new else old
    out = re.sub(r"<mark>(.*?)</mark>", rep_mark, review, flags=re.S)
    out = re.sub(r"</?s>", "", out)
    if not keep_em:
        out = re.sub(r"<[^>]+>", "", out)
    out = html.unescape(out)
    out = re.sub(r"\s+", " ", out).strip()
    out = re.sub(r" ([,;:.])", r"\1", out)
    out = out.replace("“ ", "“").replace(" ”", "”")
    # The stored text puts a space on each side of an em dash.
    out = re.sub(r"\s*—\s*", " — ", out)
    return out


rows = []
for tr in re.findall(r"<tr>(.*?)</tr>", page, re.S):
    m = re.search(r'#U(\d+)_(\d+)_(\d+)"[^>]*>([^<]*)</a>', tr)
    if not m:
        continue
    tds = re.findall(r"<td>(.*?)</td>", tr, re.S)
    ps = re.findall(r"<p>(.*?)</p>", tds[0], re.S)
    review = [p for p in ps if p.strip().startswith("Review:")][0].strip()[len("Review:"):].strip()
    page_m = re.search(r"\(([\d.]+)", m[4])
    rows.append({
        "ref": f"{int(m[1])}:{int(m[2])}.{int(m[3])}",
        "page1955": page_m[1] if page_m else None,
        "review": review,
        "reason": plain(tds[1]) if len(tds) > 1 else None,
    })

# 2. The year: the committee report that adopted it.
later = {}
for y in (2015, 2018, 2021, 2024):
    t = open(f"{rep}/standardized-reference-text-committee-approved-{y}.txt").read()
    for block in re.split(r"\n\s*Item\s+Reference", t)[1:]:
        if "Adopted" in block:
            for ref in re.findall(r"(?<![\d.:])(\d+:\d+\.\d+)(?![\d])", block):
                later.setdefault(ref, y)
v8 = open(f"{rep}/standardized-reference-text-committee-summary-report-v8.01.txt").read()


def in_2009(ref):
    p, rest = ref.split(":")
    s, n = rest.split(".")
    return re.search(rf"(^|\s){p}\s+{s}\s+{n}\s", v8, re.M) is not None


# 3. The stored text.
stored = {}
for f in glob.glob(json_dir + "/[0-9][0-9][0-9].json"):
    for p in json.load(open(f)):
        if p.get("standardReferenceId") and p.get("text") is not None:
            stored[p["standardReferenceId"]] = p["text"]

# Hand fixes, each checked against download 1.22 and the 2009 report.
FIXES = {
    # The page links 84:7.7; the 2009 report and the text put "children of Badonan" at 86:5.17.
    ("84:7.7", "Badanon"): {"ref": "86:5.17", "page1955": "955.5", "note": "The Foundation page links this row to 84:7.7."},
    # The review line shortens the paragraph with "..."; the change is the bracket at each end.
    ("119:8.9", "["): {"before": "[This paper, depicting", "after": "This paper, depicting",
                       "note": "The 1955 text also has a closing bracket at the end of the paragraph."},
    # The review line puts the new word outside its mark or drops a 1955 apostrophe or space; the
    # quote line and the 1955 page photo agree (phase 2 scan check).
    ("59:1.17", "Paradise paradise"): {"before": "a veritable tropic Paradise"},
    ("59:2.12", "muscles mussels"): {"before": "the muscles, clams, oysters, and scallops"},
    ("134:7.5", "CaesareaPhilippi"): {"before": "Caesarea Philippi"},
    ("134:8.1", "CaesareaPhilippi"): {"before": "Caesarea Philippi"},
    ("139:12.1", "Judas parents"): {"before": "Judas’ parents were Sadducees"},
    ("153:1.7", "Jairus only"): {"before": "Jairus’ only reply to all this"},
    ("173:1.3", "tencent"): {"before": "the size of a ten cent piece"},
    ("105:3.8", "corelator"): {"before": "corelater of the absolute and the relative",
                               "note": "The review line strikes corelator; the 1955 page and the quote line read corelater."},
    # The 1955 page shows more change than the Foundation's list records.
    ("90:2.9", "Teuskwatawa"): {"before": "the Shawnee Teuskwatowa,",
                                "note": "The 1955 page reads Teuskwatowa; the list quotes Teuskwatawa and records one of the two changed letters."},
    ("167:4.3", "second"): {"before": "on the second, or even the third, day such", "after": "on the second or even the third day, such",
                            "note": "The 1955 page has a comma after third, not after day; the list records only the comma after second."},
}
PRINTING = {"101:3.5", "117:7.4"}  # Faults of the printed 1955 book, never in an electronic text.
out, problems = [], []
for r in rows:
    before, after = side(r["review"], False), side(r["review"], True)
    for (fref, word), fix in FIXES.items():
        if r["ref"] == fref and word in before:
            r.update({k: v for k, v in fix.items() if k in ("ref", "page1955")})
            before, after = fix.get("before", before), fix.get("after", after)
            if "note" in fix:
                r["note"] = fix["note"]
    year = later.get(r["ref"]) or (2009 if in_2009(r["ref"]) else None)
    text = stored[r["ref"]]
    if before == after:
        kind = "format"
        before, after = side(r["review"], False, True), side(r["review"], True, True)
    elif r["ref"] in PRINTING:
        kind = "printing"
    else:
        kind = "text"
    row = {
        "ref": r["ref"],
        "year": year,
        "kind": kind,
        "before": before,
        "after": after,
        "inStoredText": True,
        "source": {
            "list": "adopted-corrections-1955-text",
            "report": (f"approved-{year}" if year and year > 2009 else "summary-report-v8.01" if year else None),
        },
        "page1955": r["page1955"],
        "reason": r["reason"],
    }
    if r.get("note"):
        row["note"] = r["note"]
    if kind != "format":
        n_after, n_before = text.count(after), text.count(before)
        # When one side holds the other ("[This" and "This"), the longer side decides.
        if after in before and n_before > 0:
            n_after = 0
        if n_after != 1:
            if n_before == 1:
                row["inStoredText"] = False  # The Foundation lists it, but download 1.22 has the 1955 wording.
            else:
                problems.append((r["ref"], n_after, n_before, before, after))
    out.append(row)

print("rows", len(out), collections.Counter((x["kind"], x["year"]) for x in out))
print("not in stored text", [x["ref"] for x in out if not x["inStoredText"]])
print("no report", [x["ref"] for x in out if x["year"] is None])
print("problems", problems)
json.dump(out, open(out_path, "w"), indent=2, ensure_ascii=False)
open(out_path, "a").write("\n")

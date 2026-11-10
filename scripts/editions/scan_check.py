"""Checks each row's 1955 wording against the archive.org photos of the 1955 first printing.

Usage: python3 -I scan_check.py <variants.json> <page_numbers.json> <work dir> <out.json>
For each row: get the photo of its 1955 page (and the next page), OCR it with tesseract, and look for
`before` and `after`. The result per row: before_found, after_found, leaf, page.
"""
import json, re, subprocess, sys, os, urllib.request, concurrent.futures as cf

variants_path, pn_path, work, out_path = sys.argv[1:5]
rows = json.load(open(variants_path))
pages = json.load(open(pn_path))["pages"]
leaf_of = {}
for p in pages:
    if p["pageNumber"] and p["pageNumber"] not in leaf_of:
        leaf_of[p["pageNumber"]] = p["leafNum"]

BASE = ("https://archive.org/download/TheUrantiaBook1955FirstEdition/"
        "The-Urantia-Book-1955-Guardian-Plates-600dpi_jp2.zip/"
        "The-Urantia-Book-1955-Guardian-Plates-600dpi_jp2%2FThe-Urantia-Book-1955-Guardian-Plates-600dpi_{:04d}.jp2")
os.makedirs(f"{work}/img", exist_ok=True)


def ocr(leaf):
    txt = f"{work}/img/{leaf}.txt"
    if os.path.exists(txt):
        return open(txt).read()
    jp2, png = f"{work}/img/{leaf}.jp2", f"{work}/img/{leaf}.png"
    if not os.path.exists(png):
        urllib.request.urlretrieve(BASE.format(leaf), jp2)
        subprocess.run(["opj_decompress", "-i", jp2, "-o", png], capture_output=True, check=True)
    t = subprocess.run(["tesseract", png, "-"], capture_output=True, text=True).stdout
    open(txt, "w").write(t)
    return t


def norm(s):
    s = re.sub(r"-\s*\n\s*", "", s)  # a word broken at the end of a line
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("—", " — ").replace("--", " — ")
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def loose(s):
    return re.sub(r"[^a-z0-9]", "", norm(s))


def leaves(row):
    page = (row.get("page1955") or "").split(".")[0]
    leaf = leaf_of.get(page)
    return [leaf, leaf + 1] if leaf is not None else []


need = sorted({l for r in rows for l in leaves(r)})
with cf.ThreadPoolExecutor(4) as ex:
    texts = dict(zip(need, ex.map(ocr, need)))

out = []
for r in rows:
    ls = leaves(r)
    text = "\n".join(texts[l] for l in ls)
    n, b, a = norm(text), norm(r["before"]), norm(r["after"])
    res = {
        "ref": r["ref"], "kind": r["kind"], "page": r.get("page1955"), "leaves": ls,
        "before_exact": b in n, "after_exact": a in n,
        "before_loose": loose(r["before"]) in loose(text), "after_loose": loose(r["after"]) in loose(text),
    }
    out.append(res)
json.dump(out, open(out_path, "w"), indent=1)
ok = [x for x in out if x["before_exact"] and not x["after_exact"]]
print("rows", len(out), "before found, after not:", len(ok))
for x in out:
    if x not in ok:
        print(x["ref"], x["kind"], x["page"], "B", x["before_exact"], x["before_loose"], "A", x["after_exact"], x["after_loose"])

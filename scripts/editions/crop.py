import subprocess, sys, csv, io

# Crops the band of a page photo around the first line that holds a word.
# Usage: python3 -I crop.py <png> <word> <out.png> [lines above] [lines below]
png, word, out = sys.argv[1:4]
up = int(sys.argv[4]) if len(sys.argv) > 4 else 1
down = int(sys.argv[5]) if len(sys.argv) > 5 else 2
tsv = subprocess.run(["tesseract", png, "-", "tsv"], capture_output=True, text=True).stdout
rows = list(csv.DictReader(io.StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE))
words = [r for r in rows if r.get("level") == "5" and r.get("text")]
hit = next((r for r in words if word.lower() in r["text"].lower()), None)
if not hit:
    print("not found"); sys.exit(1)
h = int(hit["height"]) * 2
top = max(0, int(hit["top"]) - h * up - 10)
height = h * (up + down) + 30
w = subprocess.run(["sips", "-g", "pixelWidth", png], capture_output=True, text=True).stdout.split()[-1]
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", png, "-vf",
                f"crop={w}:{height}:0:{top},scale=1400:-1", out], check=True)
print(out)

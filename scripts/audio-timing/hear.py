"""The words a speech model hears in the first seconds after each time of an audio file.

Used by scripts/generate-paper-audio-timing.ts. Needs ffmpeg and `pip install faster-whisper`.
Reads one JSON line {"path": ..., "ats": [seconds, ...]} at a time, and answers one JSON line [text, ...].
"""

import json
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

RATE = 16000
SECONDS = 4
model = WhisperModel("base.en", device="cpu", compute_type="int8")
# Names of the Papers that the model mishears ("your own ship" for Urantia). A prompt of names only:
# never the text that is expected, which the model could then repeat.
NAMES = ("Urantia, Uversa, Havona, Nebadon, Orvonton, Salvington, Jerusem, Satania, Edentia, Melchizedek, "
         "Machiventa, Adjuster, morontia, seraphim, Nodites, Andites, Caligastia, Lucifer, Gabriel, Michael.")
loaded = {"path": None, "pcm": None}


def pcm(path):
    # The whole file is decoded once, then each time is a slice of it.
    if loaded["path"] != path:
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
            capture_output=True, check=True,
        ).stdout
        loaded["path"], loaded["pcm"] = path, np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    return loaded["pcm"]


for line in sys.stdin:
    ask = json.loads(line)
    audio = pcm(ask["path"])
    said = []
    for at in ask["ats"]:
        start = max(0, int((at - 0.05) * RATE))
        segments, _ = model.transcribe(audio[start:start + SECONDS * RATE], language="en", beam_size=1,
                                       without_timestamps=True, initial_prompt=NAMES)
        said.append(" ".join(s.text for s in segments).strip())
    print(json.dumps(said), flush=True)

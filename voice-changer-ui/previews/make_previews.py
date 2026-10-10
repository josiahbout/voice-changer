"""Makes the voice samples the speaker button on each voice card plays (previews/<id>.mp3),
and copies the two test recordings they're made from (previews/original-<male|female>.mp3)
for the sample bubble's "Original audio" checkbox.

Each sample is a test recording converted to that voice by the voice-changer server, with
the voice's starting pitch for a speaker of the other range: male voices convert the
female recording (pitch for a "higher" first-run answer), female voices convert the male
recording (pitch for a "deeper" answer). The voice list, slots and pitches come from
VOICES / RANGE_PITCH in ../app.js, so re-run this after adding or changing a voice.

Run it with the server's Python while a server is up (VoicePlay's on 18888, or a separate
one, e.g. `MMVCServerSIO.py -p 18889 --https false --no_client true`, so a running VoicePlay
isn't disturbed):

    ..\\..\\server\\.venv\\Scripts\\python.exe make_previews.py [--port 18889] [--only gamer,shy]
"""
import argparse
import base64
import json
import os
import re
import shutil
import urllib.parse
import urllib.request

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
APP_JS = os.path.join(HERE, "..", "app.js")
TEST_AUDIO = os.path.join(HERE, "..", "..", "voices", "test_audio")
SOURCES = {  # voice gender -> recording to convert (the other range)
    "male": os.path.join(TEST_AUDIO, "female_voice_test_original.mp3"),
    "female": os.path.join(TEST_AUDIO, "male_voice_test_original.mp3"),
}
RANGE_FOR_SOURCE = {"male": "higher", "female": "deeper"}  # whose starting pitch to use

RATE = 48000
CHUNK = 24000  # 500 ms, the "Smooth" setting
# The app's defaults: the "Smooth" speed stop, Index 75 %, Protect 33 %, Sensitivity 98 %.
SETTINGS = {
    "extraConvertSize": 32768,
    "crossFadeOverlapSize": 4096,
    "rvcQuality": 1,
    "silenceFront": 1,
    "f0Detector": "rmvpe_onnx",
    "indexRatio": 0.75,
    "protect": 0.335,
    "silentThreshold": 0.00002,
}
TARGET_RMS_DB = -20.0  # loudness of the speech in every sample
PEAK_LIMIT = 0.95


def read_voices():
    """VOICES and RANGE_PITCH from app.js (they're plain object literals)."""
    src = open(APP_JS, encoding="utf-8").read()
    block = re.search(r"const VOICES = \[(.*?)\n\];", src, re.S).group(1)
    voices = []
    for line in block.splitlines():
        m = re.search(r'id: "([^"]+)", name: "([^"]+)".*?slot: (\d+), gender: "(\w+)"(?:, pitch: \{([^}]*)\})?', line)
        if m:
            pitch = {k: int(v) for k, v in re.findall(r"(\w+): (-?\d+)", m.group(5) or "")}
            voices.append({"id": m.group(1), "name": m.group(2), "slot": int(m.group(3)), "gender": m.group(4), "pitch": pitch})
    ranges = re.search(r"const RANGE_PITCH = \{(.*?)\n\};", src, re.S).group(1)
    range_pitch = {r: {g: int(p) for g, p in re.findall(r"(\w+): (-?\d+)", body)} for r, body in re.findall(r"(\w+): \{([^}]*)\}", ranges)}
    return voices, range_pitch


class Server:
    def __init__(self, port):
        self.base = f"http://127.0.0.1:{port}"

    def update(self, key, val):
        data = urllib.parse.urlencode({"key": key, "val": str(val)}).encode()
        with urllib.request.urlopen(urllib.request.Request(f"{self.base}/update_settings", data=data), timeout=120) as r:
            return json.loads(r.read())

    def convert(self, pcm: np.ndarray) -> np.ndarray:
        body = json.dumps({"timestamp": 0, "buffer": base64.b64encode(pcm.astype("<i2").tobytes()).decode()}).encode()
        req = urllib.request.Request(f"{self.base}/test", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            result = json.loads(r.read())
        if not isinstance(result, dict):
            raise RuntimeError(f"server: {result}")
        return np.frombuffer(base64.b64decode(result["changedVoiceBase64"]), dtype="<i2")


def load_source(path):
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if sr != RATE:
        g = np.gcd(sr, RATE)
        audio = resample_poly(audio, RATE // g, sr // g).astype(np.float32)
    return (np.clip(audio, -1, 1) * 32767).astype(np.int16)


def convert_file(server, source):
    # Two quiet chunks first so the voice has settled, then the recording, then silence to
    # flush out the server's last chunk (its output runs about 0.1 s behind).
    noise = lambda: (np.random.uniform(-1, 1, CHUNK) * 20).astype(np.int16)
    for _ in range(2):
        server.convert(noise())
    padded = np.concatenate([source, np.zeros(CHUNK * 2 - len(source) % CHUNK, np.int16)])
    out = np.concatenate([server.convert(padded[i:i + CHUNK]) for i in range(0, len(padded), CHUNK)])
    return out[: len(source) + RATE // 4].astype(np.float32) / 32768


def finish(audio):
    """Even out loudness (judged on the speech, not the pauses), cap peaks, fade the ends."""
    frame = RATE // 50
    frames = audio[: len(audio) // frame * frame].reshape(-1, frame)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    speech = rms[rms > rms.max() * 0.1]
    gain = 10 ** (TARGET_RMS_DB / 20) / max(np.sqrt((speech ** 2).mean()), 1e-6)
    gain = min(gain, PEAK_LIMIT / max(np.abs(audio).max(), 1e-6))
    audio = audio * gain
    fade = np.linspace(0, 1, RATE // 100)
    audio[: len(fade)] *= fade
    audio[-len(fade):] *= fade[::-1]
    return audio


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18888)
    parser.add_argument("--only", help="comma-separated voice ids")
    args = parser.parse_args()
    server = Server(args.port)
    voices, range_pitch = read_voices()
    if args.only:
        voices = [v for v in voices if v["id"] in args.only.split(",")]
    # The recordings themselves, for the bubble's "Original audio" checkbox.
    for name in ("male", "female"):
        shutil.copyfile(os.path.join(TEST_AUDIO, f"{name}_voice_test_original.mp3"), os.path.join(HERE, f"original-{name}.mp3"))
    sources = {g: load_source(p) for g, p in SOURCES.items()}
    for voice in voices:
        rng = RANGE_FOR_SOURCE[voice["gender"]]
        pitch = voice["pitch"].get(rng, range_pitch[rng][voice["gender"]])
        server.update("modelSlotIndex", voice["slot"])  # loads the voice and resets its settings
        for key, val in {**SETTINGS, "tran": pitch}.items():
            server.update(key, val)
        audio = finish(convert_file(server, sources[voice["gender"]]))
        path = os.path.join(HERE, f"{voice['id']}.mp3")
        # Constant bitrate: with a variable one, players can't tell the length up front, so
        # the timeline in the sample bubble would be off.
        sf.write(path, audio, RATE, format="MP3", bitrate_mode="CONSTANT", compression_level=0.5)
        print(f"{voice['name']:15s} slot {voice['slot']:2d}  pitch {pitch:+3d}  {len(audio) / RATE:4.1f} s  -> {os.path.basename(path)} ({os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    main()

# WhisperX fleet transcription on Modal (second-show; engine decision
# 2026-08-18: WhisperX large-v3 beat Deepgram 2:1 on human-adjudicated
# disagreement sites, and Modal's monthly free credits cover the whole
# 78.5h fleet — docs/design/transcription-bake-off.md).
#
# One-time setup (Abram):
#   uv tool install modal
#   modal setup                       # browser auth
#   modal secret create huggingface HF_TOKEN=hf_...   # paste your token
#   accept the gated pyannote terms with that HF account:
#     https://huggingface.co/pyannote/speaker-diarization-3.1
#     https://huggingface.co/pyannote/segmentation-3.0
#
# Run (from repo root; audio must be fetched first via --stage=fetch):
#   modal run scripts/ingest-podcast/whisperx_modal.py --episodes all
#   modal run scripts/ingest-podcast/whisperx_modal.py --episodes 63onrrP5Tz4,LXoi1I_TQAk
#
# Output: data/podcasts/stick-of-joseph/<vid>.whisperx-raw.json — the raw
# WhisperX result. whisperx-convert.mjs turns it into the pipeline
# artifact; this script never touches the database.
import json
import zlib
from pathlib import Path

import modal

DATA_DIR = Path(__file__).parent.parent.parent / "data" / "podcasts" / "stick-of-joseph"

app = modal.App("lintel-whisperx")

image = (
	modal.Image.debian_slim(python_version="3.12")
	.apt_install("ffmpeg")
	.pip_install("whisperx==3.8.6")
	.env({"HF_HOME": "/cache/hf"})
)

# model weights (whisper large-v3 ~3GB + pyannote) cache across containers
cache = modal.Volume.from_name("lintel-whisperx-cache", create_if_missing=True)


@app.function(
	image=image,
	gpu="L4",
	timeout=3600,
	retries=2,
	secrets=[modal.Secret.from_name("huggingface")],
	volumes={"/cache": cache},
)
def transcribe(audio_bytes: bytes, vid: str) -> bytes:
	import os
	import tempfile

	import whisperx

	device = "cuda"
	with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as f:
		f.write(audio_bytes)
		path = f.name

	audio = whisperx.load_audio(path)
	model = whisperx.load_model("large-v3", device, compute_type="float16", language="en")
	result = model.transcribe(audio, batch_size=16, language="en")

	align_model, meta = whisperx.load_align_model(language_code="en", device=device)
	result = whisperx.align(result["segments"], align_model, meta, audio, device)

	token = os.environ["HF_TOKEN"]
	try:
		from whisperx.diarize import DiarizationPipeline
	except ImportError:  # layout moved across whisperx versions
		DiarizationPipeline = whisperx.DiarizationPipeline
	diarizer = DiarizationPipeline(use_auth_token=token, device=device)
	diarize_segments = diarizer(audio)
	result = whisperx.assign_word_speakers(diarize_segments, result)

	cache.commit()
	os.unlink(path)
	# large episodes exceed Modal's plain-return comfort zone — compress
	return zlib.compress(json.dumps({"vid": vid, "result": result}).encode())


@app.local_entrypoint()
def main(episodes: str = "all"):
	manifest = json.loads((DATA_DIR / "episodes.json").read_text())
	eps = manifest if isinstance(manifest, list) else manifest["episodes"]
	ids = [e["id"] for e in eps]
	if episodes != "all":
		wanted = set(episodes.split(","))
		unknown = wanted - set(ids)
		if unknown:
			raise SystemExit(f"unknown episode ids: {sorted(unknown)}")
		ids = [i for i in ids if i in wanted]

	todo = []
	for vid in ids:
		audio = DATA_DIR / f"{vid}.m4a"
		out = DATA_DIR / f"{vid}.whisperx-raw.json"
		if out.exists():
			print(f"skip {vid} (raw output exists)")
			continue
		if not audio.exists():
			raise SystemExit(f"missing audio for {vid} — run --stage=fetch first")
		todo.append(vid)

	print(f"transcribing {len(todo)} episode(s) on Modal")
	inputs = [((DATA_DIR / f"{vid}.m4a").read_bytes(), vid) for vid in todo]
	done = 0
	for blob in transcribe.starmap(inputs, order_outputs=False):
		payload = json.loads(zlib.decompress(blob))
		vid = payload["vid"]
		out = DATA_DIR / f"{vid}.whisperx-raw.json"
		tmp = out.with_suffix(".tmp")
		tmp.write_text(json.dumps(payload["result"]))
		tmp.rename(out)
		done += 1
		print(f"[{done}/{len(todo)}] {vid} done")
	print("fleet transcription complete")

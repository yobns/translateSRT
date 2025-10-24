# Subtitle Translator (SRT)

Fast, context-aware SRT translator using Google (deep-translator), with automatic tuning per language and robust formatting. All prompts and logs are in English.

## Features
- Automatic source language detection and per-language tuning (groups + concurrency)
- Robust tag preservation (`<i>`, `<b>`, etc.) and clean SRT formatting
- Contextual grouping (scene-aware by timing and size) for high coherence
- Parallel processing with dynamic concurrency
- Persistent SQLite cache for fast re-runs

## Requirements
- Python 3.11+
- A virtual environment is recommended

Install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## Project structure

- `src/translator/` — main library
	- `translate.py` — translation pipeline (auto-tuned, grouping, cache, download)
	- `srt_utils.py` — shared utilities (tag protection, normalization, auto-tune)
- `run_deep.py` — simple CLI runner (imports the library)
- `scripts/format_srt.py` — formatter for existing SRT files
- `.translate_cache.sqlite*` — on-disk translation cache

## Usage
Place your input `file.srt` in the folder.

Fastest run (auto-tuned, prompts for target language):

```bash
.venv/bin/python run_deep.py           # auto-picks an input .srt
.venv/bin/python run_deep.py file.srt  # or pass a specific file
```

The output file will be written next to the input with a suffix based on the target (e.g. `_fr.srt`, `_es.srt`).

<!-- API server section removed: this project is now CLI-only and does not ship an HTTP API. -->

### Language selection
- On start, the program asks for the target language code (e.g., `fr`, `en`, `es`, `ar`, `he`, `zh-TW`).
- Non-interactive override: set `TARGET_LANG`.
- Mixed-language SRTs are supported: source defaults to `auto` per block; grouping falls back to per-block if a group mixes languages.

### Tuning (optional)
- Auto-tuning sets optimal grouping and concurrency based on the input file and language.
- You can override any value via env vars:
	- `GROUP_MAX_CHARS`, `GROUP_MAX_BLOCKS`, `GROUP_MAX_GAP_MS`
	- `TRANSLATE_CONCURRENCY`
	- `GROUP_DEEP=0` to disable grouping

### Download the result (optional)
After translation, the script can offer a one-click download link via a temporary local server:

- Prompt enabled by default. To skip the prompt and auto-open the browser:

```bash
AUTO_DOWNLOAD=1 .venv/bin/python run_deep.py file.srt
```

- Disable the offer entirely:

```bash
OFFER_DOWNLOAD=0 .venv/bin/python run_deep.py file.srt
```

## Notes on quality
- Grouped scenes are translated together then split back, with placeholders to preserve tags.
- All blocks go through a final formatter: no stray blank lines inside cues.
- Fallbacks ensure each block is translated even if the service changes output formatting.

## Troubleshooting
- Performance: increase `TRANSLATE_CONCURRENCY` (8–16) and adjust grouping parameters to balance speed and coherence.

## Deploying the backend (one-click on Render)

You can deploy the Python FastAPI backend (`translate/src/server/api.py`) easily on Render using the included `render.yaml`.

Steps:

1. Push your repo to GitHub.
2. Go to https://render.com and create a new Web Service -> Connect GitHub -> choose this repository.
3. Render will detect `render.yaml` in the `translate/` folder and create a service called `translate-backend`.
	- Root directory: `translate`
	- Build command (from `render.yaml`): `pip install -r requirements.txt`
	- Start command: `uvicorn src.server.api:app --host 0.0.0.0 --port $PORT`
4. After deployment, copy the public URL (e.g. `https://translate-xyz.onrender.com`) and set it in your Vercel project as `PY_BACKEND_URL`.

Local quick test:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.server.api:app --reload
# open http://127.0.0.1:8000/health
```

Notes:
- The backend exposes `/health`, `/validate` and `/translate`.
- Default speed/quality tunables are already enabled; override them via Render environment variables if needed (e.g., `GROUP_MAX_CHARS`, `TRANSLATE_CONCURRENCY`).

Once the backend is up, configure Vercel (see root README) with `PY_BACKEND_URL` pointing to the backend and redeploy the Next.js site.

in local execute npm run dev:all then nump run dev:stop

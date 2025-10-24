## Translate SRT – Next.js + Python

This app provides a simple web UI to translate `.srt` subtitle files using your existing Python translator (deep-translator + pysrt). The Next.js API route calls the Python CLI under `translate/` and streams back a translated SRT for download.

### Requirements (local dev)
- Node.js 20+
- Python 3.9+
- pip

Install dependencies:

```bash
npm install
pip3 install -r translate/requirements.txt
```

Run the app:

```bash
npm run dev
```

Open http://localhost:3000 and upload an `.srt`. Choose the target language and download the translated file.

Notes:
- The API route runs the Python CLI with environment variables, disables the interactive prompts, and stores temporary files in the OS temp directory.
- Caching is enabled per-request in a temp SQLite file (set via `TRANSLATE_CACHE_PATH`).

### Containerized run (easy deploy)

Build and start with Docker Compose:

```bash
docker compose up --build
```

Then visit http://localhost:3000.

The container includes Python 3, installs `translate/requirements.txt`, builds the Next.js app, and serves it on port 3000.

### Deploying to Vercel (UI) + a Python service

Vercel n'exécute pas Python dans les API routes Next.js. Pour la production sur Vercel, déployez l'UI sur Vercel et le service Python à part (Render, Fly.io, Railway, un VPS, etc.). Ensuite, configurez l'UI pour proxy vers ce backend.

1) Déployer le backend Python

- Commande de démarrage (ex: Render):

```bash
uvicorn translate.src.server.api:app --host 0.0.0.0 --port 8000
```

Le backend expose `POST /translate` (multipart/form-data) avec les mêmes champs que l'API UI.

2) Configurer l'UI sur Vercel

- Sur Vercel, définissez la variable d'env `PY_BACKEND_URL` (ex: `https://votre-backend-python.example.com`).
- Déployez normalement le projet Next.js.
- L'API route `app/api/translate/route.ts` détecte `PY_BACKEND_URL` et proxy automatiquement la requête vers le backend.

3) Contrat backend

`POST /translate` (multipart/form-data):
- `file`: SRT
- `target`: langue (ex: `fr`)
- `source`: `auto` par défaut
- `group_deep`: `1` par défaut

Réponse: attachement `text/plain` du SRT traduit.

### API contract

POST `/api/translate` (multipart/form-data):
- `file` – required `.srt` file
- `source` – optional, default `auto` (e.g., `en`, `fr`, `ar`, `zh-tw`)
- `target` – required, e.g., `fr`
- `group_deep` – optional, `1` (default) for grouped translation

Response: `text/plain` attachment with the translated `.srt` content.

### Troubleshooting
- Make sure `python3` is available on your PATH (or set `PYTHON_CMD` env var to the Python executable).
- If translation fails, check server logs; the API returns stderr/stdout details.
- Large files: SRT files are usually small. If you hit limits, we can increase body size or stream more aggressively.


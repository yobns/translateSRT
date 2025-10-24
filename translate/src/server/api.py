import os
import tempfile
import subprocess
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import Response, RedirectResponse

app = FastAPI(title="SRT Translate Backend", version="1.0.0")


def _strict_validate_bytes(data: bytes) -> Optional[str]:
    import re
    try:
        text = data.decode("utf-8", errors="ignore")
    except Exception:
        text = data.decode(errors="ignore")
    ts = r"\d{2}:\d{2}:\d{2},\d{3}"
    allowed = re.compile(rf"^\s*{ts}\s+-->\s+{ts}(?:\s+.*)?$")
    two_ts_anywhere = re.compile(rf"{ts}.*{ts}")
    lines = text.splitlines()

    for i, ln in enumerate(lines, start=1):
        if two_ts_anywhere.search(ln) and not allowed.match(ln):
            return f"invalid timecode syntax at line {i} (expected '-->')"

    idxs = [i for i, ln in enumerate(lines) if allowed.match(ln)]
    if not idxs:
        return "no valid timecode lines found"

    for k, i in enumerate(idxs):
        end = idxs[k + 1] if k + 1 < len(idxs) else len(lines)
        j = i + 1
        has_text = False
        import re as _re
        while j < end:
            ln = lines[j].strip()
            if ln == "":
                break
            if not _re.fullmatch(r"\d+", ln):
                has_text = True
            j += 1
        if not has_text:
            return f"missing text after timecode at line {i+1}"
    return None


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/validate")
async def validate(file: UploadFile = File(...)):
    raw = await file.read()
    msg = _strict_validate_bytes(raw)
    if msg:
        raise HTTPException(status_code=400, detail=msg)
    # Deep validation using pysrt
    import pysrt
    with tempfile.NamedTemporaryFile(delete=False, suffix=".srt") as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        subs = pysrt.open(tmp_path, encoding='utf-8')
        if len(subs) == 0:
            raise HTTPException(status_code=400, detail="empty srt")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
    return {"ok": True}


@app.post("/translate")
async def translate(
    file: UploadFile = File(...),
    target: str = Form("fr"),
    source: str = Form("auto"),
    group_deep: str = Form("1"),
):
    raw = await file.read()
    # Write input file
    with tempfile.TemporaryDirectory() as tmpdir:
        in_path = os.path.join(tmpdir, file.filename or "input.srt")
        with open(in_path, "wb") as f:
            f.write(raw)

        base = os.path.splitext(os.path.basename(in_path))[0]
        out_path = os.path.join(tmpdir, f"{base}_{target}.srt")

        env = os.environ.copy()
        env.update({
            "INPUT_SRT": in_path,
            "TARGET_LANG": (target or "fr").lower(),
            "SOURCE_LANG": (source or "auto").lower(),
            "OFFER_DOWNLOAD": "0",
            "AUTO_DOWNLOAD": "0",
            # Speed + context defaults (can be tuned by host env)
            "FAST_MODE": env.get("FAST_MODE", "1"),
            "USE_DOMINANT_FOR_GROUP": env.get("USE_DOMINANT_FOR_GROUP", "1"),
            "ALLOW_GROUP_AUTO": env.get("ALLOW_GROUP_AUTO", "1"),
            "GROUP_DEEP": str(group_deep or "1"),
            "GROUP_MAX_CHARS": env.get("GROUP_MAX_CHARS", "2200"),
            "GROUP_MAX_BLOCKS": env.get("GROUP_MAX_BLOCKS", "12"),
            "GROUP_MAX_GAP_MS": env.get("GROUP_MAX_GAP_MS", "3000"),
            "CACHE_GROUP_THRESHOLD": env.get("CACHE_GROUP_THRESHOLD", "0.4"),
            "TRANSLATE_CONCURRENCY": env.get("TRANSLATE_CONCURRENCY", "6"),
        })

        # Run translator from the translate/ directory so relative imports/paths work
        cwd = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # translate/
        try:
            proc = subprocess.run(
                [env.get("PYTHON_CMD", "python3"), "run_deep.py"],
                cwd=cwd,
                env=env,
                capture_output=True,
                text=True,
                timeout=int(os.environ.get("TRANSLATE_TIMEOUT", "300")),
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="translation timeout")

        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail=f"translation failed: {proc.stderr or proc.stdout}")

        # Read output
        try:
            with open(out_path, "rb") as f:
                data = f.read()
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="output not found")

    headers = {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": f"attachment; filename=\"{base}_{target}.srt\"",
        "Content-Length": str(len(data)),
        "Cache-Control": "no-store",
    }
    return Response(content=data, status_code=200, headers=headers)
import os
import asyncio
import tempfile
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import Response

from ..translator import translate as t

app = FastAPI(title="SRT Translator API")

@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/", include_in_schema=False)
async def root_redirect():
    """Redirect the service root to /health to avoid 404s on /."""
    return RedirectResponse(url="/health")

@app.post("/validate")
async def validate_endpoint(file: UploadFile = File(...)):
    import os
    import tempfile
    try:
        import pysrt
    except Exception as e:
        return Response(content=str(e).encode(), status_code=500)
    with tempfile.TemporaryDirectory(prefix="srt-val-") as tmp:
        safe_name = os.path.basename(file.filename or "input.srt")
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in safe_name) or "input.srt"
        in_path = os.path.join(tmp, safe_name)
        data = await file.read()
        with open(in_path, "wb") as f:
            f.write(data)
        try:
            try:
                subs = pysrt.open(in_path, encoding='utf-8')
            except UnicodeDecodeError:
                subs = pysrt.open(in_path)
            if len(subs) == 0:
                return Response(content=b"empty srt", status_code=400)
        except Exception as e:
            return Response(content=str(e).encode(), status_code=400)
    return {"ok": True}


@app.post("/translate")
async def translate_endpoint(
    file: UploadFile = File(...),
    target: str = Form("fr"),
    source: str = Form("auto"),
    group_deep: str = Form("1"),
):
    # Save upload to a temp dir
    with tempfile.TemporaryDirectory(prefix="srt-") as tmp:
        # Sanitize filename and persist
        safe_name = os.path.basename(file.filename or "input.srt")
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in safe_name) or "input.srt"
        in_path = os.path.join(tmp, safe_name)
        data = await file.read()
        with open(in_path, "wb") as f:
            f.write(data)

        # Configure env knobs for the translator pipeline
        env = os.environ.copy()
        env.update({
            "INPUT_SRT": in_path,
            "TARGET_LANG": (target or "fr").lower(),
            "SOURCE_LANG": (source or "auto").lower(),
            "GROUP_DEEP": "1" if str(group_deep) != "0" else "0",
            "OFFER_DOWNLOAD": "0",
            "AUTO_DOWNLOAD": "0",
            "TRANSLATE_CACHE_PATH": os.path.join(tmp, ".translate_cache.sqlite"),
        })
        # Patch os.environ for the duration of this request
        old_env = os.environ.copy()
        try:
            os.environ.clear()
            os.environ.update(env)
            await t.translate_srt_file()
        finally:
            os.environ.clear()
            os.environ.update(old_env)

        base, _ = os.path.splitext(in_path)
        out_path = f"{base}_{(target or 'fr').lower()}.srt"
        try:
            with open(out_path, "rb") as f:
                out = f.read()
        except FileNotFoundError:
            return Response(content=b"", status_code=500)

        fname = os.path.basename(out_path)
        headers = {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": f"attachment; filename=\"{fname}\"",
            "Cache-Control": "no-store",
        }
        return Response(content=out, media_type="text/plain; charset=utf-8", headers=headers)

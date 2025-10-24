import os
import glob
import re
import asyncio
import sqlite3
import hashlib
import threading
import http.server
import socket
import webbrowser
import tempfile

import pysrt
from tqdm import tqdm
from deep_translator import GoogleTranslator
from langdetect import detect as _ld_detect

from .srt_utils import (
    normalize_google_lang,
    protect_tags,
    restore_tags,
    normalize_text_block,
    detect_file_language,
    auto_tune,
)

TRANSLATION_CACHE = {}

DISK_CACHE_ENABLED = os.environ.get('TRANSLATE_CACHE', '1') != '0'
_DB_PATH = os.environ.get('TRANSLATE_CACHE_PATH', '.translate_cache.sqlite')
_DB_CONN = None
_DB_LOCK = threading.Lock()


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8', errors='ignore')).hexdigest()


def _db_connect():
    global _DB_CONN
    if _DB_CONN is None:
        conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
        conn.execute('PRAGMA journal_mode=WAL;')
        conn.execute('PRAGMA synchronous=NORMAL;')
        conn.execute(
            'CREATE TABLE IF NOT EXISTS translations ('
            ' src TEXT NOT NULL,'
            ' tgt TEXT NOT NULL,'
            ' hash TEXT NOT NULL,'
            ' text TEXT NOT NULL,'
            ' PRIMARY KEY (src, tgt, hash)'
            ');'
        )
        _DB_CONN = conn
    return _DB_CONN


def disk_cache_get(src: str, tgt: str, cleaned: str):
    if not DISK_CACHE_ENABLED:
        return None
    h = _hash_text(cleaned)
    with _DB_LOCK:
        conn = _db_connect()
        cur = conn.execute('SELECT text FROM translations WHERE src=? AND tgt=? AND hash=?', (src, tgt, h))
        row = cur.fetchone()
        return row[0] if row else None


def disk_cache_set(src: str, tgt: str, cleaned: str, translated: str):
    if not DISK_CACHE_ENABLED:
        return
    h = _hash_text(cleaned)
    with _DB_LOCK:
        conn = _db_connect()
        conn.execute('INSERT OR REPLACE INTO translations(src, tgt, hash, text) VALUES (?, ?, ?, ?)', (src, tgt, h, translated))
        conn.commit()


def _time_ms(t) -> int:
    return t.hours*3600000 + t.minutes*60000 + t.seconds*1000 + t.milliseconds


def group_subs(subs: 'pysrt.SubRipFile', max_chars: int = 1200, max_blocks: int = 8, max_gap_ms: int = 2000):
    groups = []
    current = []
    current_len = 0
    last_end = None
    for i, sub in enumerate(subs):
        text = sub.text or ''
        if not text.strip():
            if current:
                groups.append(current)
                current, current_len = [], 0
            groups.append([i])
            last_end = sub.end
            continue
        gap_ok = True
        if last_end is not None:
            gap = _time_ms(sub.start) - _time_ms(last_end)
            if gap > max_gap_ms:
                gap_ok = False
        if (not gap_ok) or (len(current) >= max_blocks) or (current_len + len(text) > max_chars):
            if current:
                groups.append(current)
            current, current_len = [i], len(text)
        else:
            current.append(i)
            current_len += len(text)
        last_end = sub.end
    if current:
        groups.append(current)
    return groups


async def translate_text(text, source_lang, target_lang):
    cleaned, placeholders = protect_tags(text)

    cache_key = (source_lang, target_lang, cleaned)
    if cache_key in TRANSLATION_CACHE:
        translated_all = TRANSLATION_CACHE[cache_key]
    else:
        translated_all = None
        if DISK_CACHE_ENABLED:
            translated_all = await asyncio.to_thread(disk_cache_get, source_lang, target_lang, cleaned)
        if translated_all is None:
            def _do_translate():
                src = normalize_google_lang(source_lang)
                tgt = normalize_google_lang(target_lang)
                translator = GoogleTranslator(source=src, target=tgt)
                return translator.translate(cleaned)
            translated_all = await asyncio.to_thread(_do_translate)
            TRANSLATION_CACHE[cache_key] = translated_all
            if DISK_CACHE_ENABLED:
                await asyncio.to_thread(disk_cache_set, source_lang, target_lang, cleaned, translated_all)

    translated_text = restore_tags(translated_all, placeholders)
    translated_text = normalize_text_block(translated_text)
    return translated_text


def _select_target_language():
    import sys
    env_tgt = os.environ.get('TARGET_LANG')
    if env_tgt:
        return env_tgt.strip().lower()
    try:
        if sys.stdin.isatty():
            ans = input("Target language (e.g., fr, en, es, ar, he, zh-TW) [fr]: ").strip()
            return (ans or 'fr').lower()
    except Exception:
        pass
    print("No target language provided; defaulting to 'fr'.")
    return 'fr'


async def translate_srt_file():
    env_input = os.environ.get('INPUT_SRT')
    if env_input and os.path.exists(env_input):
        input_srt = env_input
    else:
        srt_files = sorted(glob.glob('*.srt'))
        if not srt_files:
            print("No SRT file found in the current folder.")
            return
        non_out = [p for p in srt_files if not re.match(r'.*_[a-z]{2}(?:-[A-Za-z]{2})?\.srt$', p)]
        input_srt = (non_out[0] if non_out else srt_files[0])
    print(f"Processing file: {input_srt}")

    try:
        subs = pysrt.open(input_srt, encoding='utf-8')
    except Exception as e:
        print(f"Error opening SRT file: {e}")
        return

    target_lang = _select_target_language()
    base, ext = os.path.splitext(input_srt)
    output_srt = f"{base}_{target_lang}.srt"
    print(f"Output file: {output_srt}")

    dominant_lang = detect_file_language(subs)
    tuning = auto_tune(subs, dominant_lang)

    # Tunables and speed options
    fast_mode = os.environ.get('FAST_MODE', os.environ.get('SPEED_MODE', '0')) == '1'
    max_chars = int(os.environ.get('GROUP_MAX_CHARS', str(tuning['group_max_chars'])))
    max_blocks = int(os.environ.get('GROUP_MAX_BLOCKS', str(tuning['group_max_blocks'])))
    max_gap_ms = int(os.environ.get('GROUP_MAX_GAP_MS', str(tuning['group_max_gap_ms'])))
    group_deep = os.environ.get('GROUP_DEEP', '1') != '0'
    conc = int(os.environ.get('TRANSLATE_CONCURRENCY', str(tuning['group_concurrency' if group_deep else 'block_concurrency'])))
    # Fast mode prefers larger groups and moderate concurrency to reduce network overhead and throttling
    if fast_mode:
        max_chars = max(max_chars, 2200)
        max_blocks = max(max_blocks, 12)
        max_gap_ms = max_gap_ms if max_gap_ms >= 2500 else 2500
        conc = min(conc, 6)
    default_source = (os.environ.get('SOURCE_LANG') or 'auto').strip().lower()
    semaphore = asyncio.Semaphore(conc)

    progress_bar = tqdm(total=len(subs), desc="Translating subtitles", unit="cue")
    if not group_deep:
        async def process_one(i, sub):
            if not sub.text.strip():
                progress_bar.update(1)
                return i, sub.text
            async with semaphore:
                try:
                    tt = await translate_text(sub.text, default_source, target_lang)
                except Exception as e:
                    print(f"Error at cue {i}: {e}")
                    tt = sub.text
            progress_bar.update(1)
            return i, tt

        tasks = [asyncio.create_task(process_one(i, sub)) for i, sub in enumerate(subs)]
        for coro in asyncio.as_completed(tasks):
            i, tt = await coro
            subs[i].text = tt
    else:
        cache_group_threshold = float(os.environ.get('CACHE_GROUP_THRESHOLD', '0.6'))
        use_dominant_for_group = os.environ.get('USE_DOMINANT_FOR_GROUP', '1') != '0'
        allow_group_auto = os.environ.get('ALLOW_GROUP_AUTO', '1') != '0'
        groups = group_subs(subs, max_chars=max_chars, max_blocks=max_blocks, max_gap_ms=max_gap_ms)
        SEP = "<<<GSEP_d3e6p>>>"

        async def process_group(idx_list):
            per_placeholders = []
            cleaned_blocks = []
            for i in idx_list:
                cleaned_i, placeholders_i = protect_tags(subs[i].text or '')
                per_placeholders.append(placeholders_i)
                cleaned_blocks.append(cleaned_i)

            if default_source != 'auto':
                group_source = default_source
            else:
                if use_dominant_for_group:
                    group_source = dominant_lang or 'auto'
                else:
                    langs = set()
                    for txt in cleaned_blocks:
                        t = txt.strip()
                        if len(t) >= 6:
                            try:
                                langs.add(_ld_detect(t))
                            except Exception:
                                pass
                    group_source = list(langs)[0] if len(langs) == 1 else 'auto'

            cached_results = [None] * len(idx_list)
            if DISK_CACHE_ENABLED:
                for j, cleaned in enumerate(cleaned_blocks):
                    cached_results[j] = await asyncio.to_thread(disk_cache_get, group_source, target_lang, cleaned)
            have_cached = sum(1 for x in cached_results if x is not None)
            if have_cached == len(idx_list):
                for (i, placeholders_i, cached_text) in zip(idx_list, per_placeholders, cached_results):
                    restored = restore_tags(cached_text or '', placeholders_i)
                    subs[i].text = normalize_text_block(restored)
                    progress_bar.update(1)
                return
            if have_cached / max(1, len(idx_list)) >= cache_group_threshold:
                for j, i in enumerate(idx_list):
                    if cached_results[j] is not None:
                        restored = restore_tags(cached_results[j] or '', per_placeholders[j])
                        subs[i].text = normalize_text_block(restored)
                        progress_bar.update(1)
                        continue
                    try:
                        tt = await translate_text(subs[i].text or '', group_source, target_lang)
                    except Exception:
                        tt = subs[i].text
                    subs[i].text = tt
                    progress_bar.update(1)
                return

            if group_source == 'auto' and default_source == 'auto' and not allow_group_auto:
                for i in idx_list:
                    try:
                        tt = await translate_text(subs[i].text or '', 'auto', target_lang)
                    except Exception:
                        tt = subs[i].text
                    subs[i].text = tt
                    progress_bar.update(1)
                return

            combined = f"\n{SEP}\n".join(cleaned_blocks)
            async with semaphore:
                try:
                    def _do_translate_combined():
                        src = normalize_google_lang(group_source)
                        tgt = normalize_google_lang(target_lang)
                        translator = GoogleTranslator(source=src, target=tgt)
                        return translator.translate(combined)
                    translated_combined = await asyncio.to_thread(_do_translate_combined)
                except Exception as e:
                    print(f"Group translation error {idx_list[0]}-{idx_list[-1]}: {e}")
                    translated_combined = None
            if translated_combined is None:
                for i in idx_list:
                    try:
                        tt = await translate_text(subs[i].text or '', group_source, target_lang)
                    except Exception:
                        tt = subs[i].text
                    subs[i].text = tt
                    progress_bar.update(1)
                return
            parts = translated_combined.split(SEP)
            if len(parts) != len(idx_list):
                for i in idx_list:
                    try:
                        tt = await translate_text(subs[i].text or '', group_source, target_lang)
                    except Exception:
                        tt = subs[i].text
                    subs[i].text = tt
                    progress_bar.update(1)
                return
            for seg, i, placeholders_i, cleaned in zip(parts, idx_list, per_placeholders, cleaned_blocks):
                text_i = restore_tags(seg or '', placeholders_i)
                subs[i].text = normalize_text_block(text_i)
                if DISK_CACHE_ENABLED:
                    await asyncio.to_thread(disk_cache_set, group_source, target_lang, cleaned, seg or '')
                progress_bar.update(1)

        tasks = [asyncio.create_task(process_group(g)) for g in groups]
        for coro in asyncio.as_completed(tasks):
            await coro

    progress_bar.close()

    for sub in subs:
        sub.text = normalize_text_block(sub.text or '')

    try:
        subs.save(output_srt, encoding='utf-8')
        print(f"Saved: {output_srt}")
    except Exception as e:
        print(f"Error when saving the SRT file: {e}")
        return

    await _maybe_offer_download(output_srt)

def _serve_file_once(file_path: str):
    target = os.path.abspath(file_path)
    filename = os.path.basename(target)

    class OneShotHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            return

        def do_GET(self):
            if self.path not in ("/", "/download"):
                self.send_response(404)
                self.end_headers()
                return
            try:
                data = open(target, 'rb').read()
            except Exception:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(data)
            threading.Timer(0.2, self.server.shutdown).start()

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        host, port = s.getsockname()
    httpd = http.server.HTTPServer(("127.0.0.1", port), OneShotHandler)
    url = f"http://127.0.0.1:{port}/download"
    print(f"Download ready: {url}")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    httpd.serve_forever()


async def _maybe_offer_download(file_path: str):
    offer = os.environ.get('OFFER_DOWNLOAD', '1') != '0'
    auto = os.environ.get('AUTO_DOWNLOAD', '0') == '1'
    if not offer:
        return
    try:
        import sys
        if (not auto) and sys.stdout.isatty():
            ans = input("Open a link to download the file now? [Y/n] ").strip().lower()
            if ans not in ("", "y", "yes"):
                print("Okay, the file is saved on disk.")
                return
        await asyncio.to_thread(_serve_file_once, file_path)
    except Exception as e:
        print(f"Local download unavailable ({e}). The file is ready on disk.")

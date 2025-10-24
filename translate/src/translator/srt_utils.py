import re
from langdetect import detect

_GOOGLE_LANG_MAP = {
    'he': 'iw',
    'zh': 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-sg': 'zh-CN',
    'zh-hans': 'zh-CN',
    'zh-tw': 'zh-TW',
    'zh-hk': 'zh-TW',
    'zh-hant': 'zh-TW',
}

RTL_LANGS = {'ar', 'iw', 'he', 'fa', 'ur'}
CJK_LANGS = {'zh', 'zh-cn', 'zh-tw', 'ja', 'ko'}


def normalize_google_lang(code: str) -> str:
    if not code:
        return 'auto'
    c = code.strip().lower()
    return _GOOGLE_LANG_MAP.get(c, c)


def protect_tags(text: str):
    tags = re.findall(r'<[^>]+>', text)
    cleaned = text
    placeholders = []
    for idx, tag in enumerate(tags):
        ph = f"[[T{idx}]]"
        cleaned = cleaned.replace(tag, ph, 1)
        placeholders.append((ph, tag))
    return cleaned, placeholders


def restore_tags(text: str, placeholders):
    for ph, tag in placeholders:
        text = text.replace(ph, tag)
    return text


def normalize_text_block(text: str) -> str:
    s = text.replace('\r\n', '\n').replace('\r', '\n')
    s = re.sub(r"[\u200e\u200f\u202a-\u202e]", "", s)
    lines = [ln.rstrip() for ln in s.split('\n')]
    while lines and lines[0].strip() == "":
        lines.pop(0)
    while lines and lines[-1].strip() == "":
        lines.pop()
    lines = [ln for ln in lines if ln.strip() != ""]
    lines = [re.sub(r"\s{2,}", " ", ln) for ln in lines]
    return "\n".join(lines)


def detect_file_language(subs) -> str:
    samples = []
    for sub in subs:
        txt = (sub.text or '').strip()
        if txt:
            samples.append(txt)
        if len(samples) >= 40:
            break
    if not samples:
        return 'en'
    counts = {}
    for s in samples:
        try:
            d = detect(s)
            counts[d] = counts.get(d, 0) + 1
        except Exception:
            pass
    if counts.get('he', 0) >= counts.get('en', 0):
        return 'he'
    return max(counts, key=counts.get, default='en')


def srt_stats(subs):
    n = len(subs)
    total_chars = 0
    gaps = []
    last_end = None
    for s in subs:
        total_chars += len(s.text or '')
        if last_end is not None:
            gap = (s.start.hours*3600000 + s.start.minutes*60000 + s.start.seconds*1000 + s.start.milliseconds) - \
                  (last_end.hours*3600000 + last_end.minutes*60000 + last_end.seconds*1000 + last_end.milliseconds)
            if gap >= 0:
                gaps.append(gap)
        last_end = s.end
    avg_chars = total_chars / max(1, n)
    gaps_sorted = sorted(gaps)
    p90_gap = gaps_sorted[int(0.9*len(gaps_sorted))] if gaps_sorted else 1200
    return {
        'n': n,
        'avg_chars': avg_chars,
        'p90_gap': p90_gap,
    }


def auto_tune(subs, lang_code: str):
    code = normalize_google_lang(lang_code)
    stats = srt_stats(subs)
    avg = stats['avg_chars']
    p90_gap = stats['p90_gap']

    if code in RTL_LANGS:
        base_chars = 1200
        max_blocks = 8
    elif code in CJK_LANGS:
        base_chars = 1400
        max_blocks = 8
    else:
        base_chars = 1600
        max_blocks = 8

    if avg > 120:
        base_chars = int(base_chars * 0.85)
    elif avg < 60:
        base_chars = int(base_chars * 1.1)
    base_chars = max(800, min(2400, base_chars))

    gap_ms = int(min(2500, max(800, p90_gap)))

    try:
        import multiprocessing
        cores = multiprocessing.cpu_count()
    except Exception:
        cores = 8
    group_conc = max(6, min(16, cores // 2))
    block_conc = max(12, min(32, cores * 2))

    return {
        'group_max_chars': base_chars,
        'group_max_blocks': max_blocks,
        'group_max_gap_ms': gap_ms,
        'group_concurrency': group_conc,
        'block_concurrency': block_conc,
    }

import sys
import json
import re


def strict_scan(text: str):
    # Strictly require timecode lines with the exact arrow "-->" and valid hh:mm:ss,mmm formats.
    ts = r"\d{2}:\d{2}:\d{2},\d{3}"
    allowed = re.compile(rf"^\s*{ts}\s+-->\s+{ts}(?:\s+.*)?$")
    two_ts_anywhere = re.compile(rf"{ts}.*{ts}")
    lines = text.splitlines()

    # Fail if any line contains two timestamps but does NOT match the allowed timecode syntax
    for i, ln in enumerate(lines, start=1):
        if two_ts_anywhere.search(ln) and not allowed.match(ln):
            return False, f"invalid timecode syntax at line {i} (expected '-->')"

    # Collect valid timecode lines
    idxs = [i for i, ln in enumerate(lines) if allowed.match(ln)]
    if not idxs:
        return False, "no valid timecode lines found"

    # For each timecode line, ensure there is at least one non-empty text line before next timecode or blank separator
    for k, i in enumerate(idxs):
        end = idxs[k + 1] if k + 1 < len(idxs) else len(lines)
        j = i + 1
        has_text = False
        while j < end:
            ln = lines[j].strip()
            if ln == "":
                break
            # ignore purely numeric index line after timecode; otherwise require real text
            if not re.fullmatch(r"\d+", ln):
                has_text = True
            j += 1
        if not has_text:
            return False, f"missing text after timecode at line {i+1}"
    return True, None


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing path"}))
        return 2
    path = sys.argv[1]
    try:
        # First, strict regex scan of the raw file to catch common formatting mistakes (e.g., '->' instead of '-->').
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read()
        ok, err = strict_scan(raw)
        if not ok:
            print(json.dumps({"ok": False, "error": err}))
            return 2

        # Then try parsing with pysrt for deeper validation
        import pysrt
        try:
            subs = pysrt.open(path, encoding='utf-8')
        except UnicodeDecodeError:
            subs = pysrt.open(path)
        if len(subs) == 0:
            print(json.dumps({"ok": False, "error": "empty srt"}))
            return 2
        prev_ms = -1
        bad = 0
        for s in subs[:200]:  # inspect first 200 cues
            ms = s.start.hours*3600000 + s.start.minutes*60000 + s.start.seconds*1000 + s.start.milliseconds
            if ms < prev_ms:
                bad += 1
            prev_ms = ms
        if bad > max(2, len(subs)//20):
            print(json.dumps({"ok": False, "error": "timecodes out of order"}))
            return 2
        print(json.dumps({"ok": True, "count": len(subs)}))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 2

if __name__ == "__main__":
    raise SystemExit(main())

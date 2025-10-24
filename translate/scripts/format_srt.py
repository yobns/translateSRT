import sys
import pysrt
from src.translator.srt_utils import normalize_text_block


def format_srt(path: str):
    subs = pysrt.open(path, encoding='utf-8')
    for s in subs:
        s.text = normalize_text_block(s.text or '')
    subs.save(path, encoding='utf-8')
    print(f"Formatted: {path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/format_srt.py <file.srt>")
        sys.exit(1)
    format_srt(sys.argv[1])

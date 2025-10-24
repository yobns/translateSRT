import sys
import pysrt

def main(path: str):
    subs=pysrt.open(path, encoding='utf-8')
    for i in range(min(20, len(subs))):
        s=subs[i]
        print(f"{i+1}: {repr(s.text)}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python scripts/inspect_srt.py <file.srt>')
        sys.exit(1)
    main(sys.argv[1])

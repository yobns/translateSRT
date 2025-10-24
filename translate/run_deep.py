import os
import sys
import asyncio

# Minimal runner; auto-tuning happens in translator.translate
os.environ.setdefault('GROUP_DEEP', '1')

if len(sys.argv) > 1:
    os.environ['INPUT_SRT'] = sys.argv[1]

from src.translator import translate  # noqa: E402

if __name__ == '__main__':
    asyncio.run(translate.translate_srt_file())

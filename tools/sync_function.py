"""Copy the shared TypeScript engine into the Claude Supabase function.

    python3 tools/sync_function.py

The function can't reach outside its own folder when deployed, so it carries
copies of web/src's candle, indicator and engine files under lib/. Edit them
only in web/src, then run this. web/tests/function-sync.test.ts fails if a
copy differs.
"""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ["data/candles.ts", "indicators/core.ts", "indicators/index.ts", "engine/scans.ts", "engine/backtest.ts"]

for f in FILES:
    src, dst = ROOT / "web" / "src" / f, ROOT / "supabase" / "functions" / "claude" / "lib" / f
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    print(f"copied {f}")

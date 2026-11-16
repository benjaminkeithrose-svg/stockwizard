"""The browser's reference file must match the Python library exactly.

If this fails, an indicator changed: run `python tools/make_golden.py` and
the web tests will then show whether the TypeScript copy still agrees.
"""

import importlib.util
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "make_golden.py"


def test_golden_file_is_up_to_date():
    spec = importlib.util.spec_from_file_location("make_golden", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT.exists(), "Run python tools/make_golden.py"
    assert mod.OUT.read_text() == mod.render(), "golden.json is stale: run python tools/make_golden.py"

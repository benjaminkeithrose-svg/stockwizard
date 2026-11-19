"""The archive guards itself (19 Nov 2026): a damaged archive is set aside and the backup put back; a damaged
archive is never backed up over a good backup. Made-up candles in temporary folders only."""

from __future__ import annotations

import pandas as pd
import pytest

from stockwizard.data.archive import Archive, healthy


def candles(n=5):
    idx = pd.DatetimeIndex([pd.Timestamp("2026-01-05", tz="UTC") + pd.Timedelta(days=i) for i in range(n)])
    return pd.DataFrame({"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10.0}, index=idx)


def damage(path):
    data = bytearray(path.read_bytes())
    data[100:4096] = b"\xff" * (4096 - 100)   # scribble over the header and the first page
    path.write_bytes(bytes(data))


def test_a_good_archive_backs_up_and_keeps_the_previous_backup(tmp_path):
    a = Archive(tmp_path / "archive.sqlite", backup_dir=tmp_path / "od")
    a.upsert_candles("SPY", "1d", "ibkr", candles())
    a.backup(tmp_path / "od")
    a.upsert_candles("SPY", "1d", "ibkr", candles(8))
    a.backup(tmp_path / "od")
    assert healthy(tmp_path / "od" / "archive.sqlite") and (tmp_path / "od" / "archive.previous.sqlite").exists()


def test_a_damaged_archive_is_set_aside_and_the_backup_put_back(tmp_path):
    path, od = tmp_path / "archive.sqlite", tmp_path / "od"
    a = Archive(path, backup_dir=od)
    a.upsert_candles("SPY", "1d", "ibkr", candles())
    a.backup(od)
    a.close()
    damage(path)
    assert not healthy(path)
    said = []
    b = Archive(path, backup_dir=od, log=said.append)
    assert b.count() == 5, "the backup's candles are back"
    assert any(f.name.startswith("archive.damaged-") for f in tmp_path.iterdir()), "the damaged one is kept, not deleted"
    assert any("moved aside" in s for s in said) and any("backup" in s for s in said)


def test_with_no_sound_backup_it_starts_empty(tmp_path):
    path = tmp_path / "archive.sqlite"
    a = Archive(path, backup_dir=tmp_path / "none")
    a.upsert_candles("SPY", "1d", "ibkr", candles())
    a.close()
    damage(path)
    assert Archive(path, backup_dir=tmp_path / "none", log=lambda s: None).count() == 0


def test_a_damaged_archive_is_never_backed_up_over_a_good_backup(tmp_path, monkeypatch):
    od = tmp_path / "od"
    a = Archive(tmp_path / "archive.sqlite", backup_dir=od)
    a.upsert_candles("SPY", "1d", "ibkr", candles())
    a.backup(od)
    good = (od / "archive.sqlite").read_bytes()

    class Sick:
        def execute(self, q):
            class R:
                def fetchone(self):
                    return ["*** in database main ***\nPage 3 is never used"]
            return R()
    monkeypatch.setattr(a, "db", Sick())
    with pytest.raises(RuntimeError, match="not backed up"):
        a.backup(od)
    assert (od / "archive.sqlite").read_bytes() == good

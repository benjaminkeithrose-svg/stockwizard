"""Days the brief wants results split by (section 10).

Expiration Fridays (the third Friday of the month) are worked out. Fed
announcement days are listed from the Federal Reserve's published FOMC
calendar (the second day of each meeting); check them against federalreserve.gov.
Inflation (CPI) and jobs-report days aren't filled in yet: their dates move
and need checking against the Bureau of Labor Statistics schedules before
they're added, rather than being guessed.
"""

from __future__ import annotations

from datetime import date, timedelta

FOMC = {date.fromisoformat(d) for d in [
    "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
]}
# NYSE full-day closures (nyse.com, "Holidays and trading hours"); check each year's list before it starts.
HOLIDAYS = {date.fromisoformat(d) for d in [
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]}
CPI: set[date] = set()     # to add from the BLS schedule
JOBS: set[date] = set()    # to add from the BLS schedule


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in HOLIDAYS


def trading_day_ahead(d: date, n: int) -> date:
    """The trading day `n` sessions after `d` (n=0 is `d` itself)."""
    while n > 0:
        d += timedelta(days=1)
        if is_trading_day(d):
            n -= 1
    return d


def sessions_between(a: date, b: date) -> int:
    """Whole sessions after `a`, up to and including `b`."""
    n, d = 0, a
    while d < b:
        d += timedelta(days=1)
        n += is_trading_day(d)
    return n


def is_expiration_friday(d: date) -> bool:
    return d.weekday() == 4 and 15 <= d.day <= 21


def tags(d: date) -> list[str]:
    out = []
    if d in FOMC:
        out.append("fed_day")
    if d in CPI:
        out.append("cpi_day")
    if d in JOBS:
        out.append("jobs_day")
    if is_expiration_friday(d):
        out.append("expiration_friday")
    return out

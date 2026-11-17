"""Days the brief wants results split by (section 10).

Expiration Fridays (the third Friday of the month) are worked out. Fed
announcement days are listed from the Federal Reserve's published FOMC
calendar (the second day of each meeting); check them against federalreserve.gov.
Inflation (CPI) and jobs-report days aren't filled in yet: their dates move
and need checking against the Bureau of Labor Statistics schedules before
they're added, rather than being guessed.
"""

from __future__ import annotations

from datetime import date

FOMC = {date.fromisoformat(d) for d in [
    "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
]}
CPI: set[date] = set()     # to add from the BLS schedule
JOBS: set[date] = set()    # to add from the BLS schedule


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

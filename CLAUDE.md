# Stock Wizard

A technical-analysis workspace: charts, a scanner, a bar-by-bar backtester, a
pattern lab and, last of all, a paper-trading bot on Interactive Brokers, all
backed by Supabase. Phase 0 (indicators, loader, database) and phase 1
(the chart workspace web app) are built.

## Who you are working with

@PREFERENCES.md

That file is Ben's own, shared across his projects. Where it and this file
disagree, this file wins.

## Read first

| File | What it is |
|---|---|
| `SPEC.md` | The handoff spec: build order, data model, backtest rules, safety rails, in-app Claude limits. This is the brief. |
| `PROPOSAL.md` | The reasoning behind the spec: scope, indicator shortlist, broker comparison, risk and gates. |

Both are exports of Claude docs ("Trading Workspace: Handoff Spec for Claude
Code" and "Technical Trading Workspace: Proposal"). The repository copies are
the source of truth from here on; record any decision that changes the spec in
`SPEC.md` in the same pull request.

## Start here

Follow the working agreements at the end of `SPEC.md`: read both files, then
confirm the build order with Ben before writing code. Phase 0 needs the open
inputs listed under "Still needed from Ben" (Supabase project first).

## Files

| Path | What it is |
|---|---|
| `backend/stockwizard/candles.py` | The candle frame every part uses: UTC open times, checks that refuse bad data |
| `backend/stockwizard/indicators/` | The indicator library and its registry; bump an indicator's version when its maths changes |
| `backend/stockwizard/data/` | Candle sources behind one interface (the free Yahoo source for now) and the Supabase writer |
| `backend/stockwizard/load.py` | Loads a symbol list's candles into Supabase |
| `backend/tests/` | Truncation test on every indicator, hand-worked values, loader tests. Made-up candles only |
| `backend/tools/make_golden.py` | Writes `web/src/indicators/golden.json`, the Python library's numbers the browser copy must match |
| `web/` | The web app: React, Vite, TypeScript, Lightweight Charts (TradingView, Apache 2.0; keep its logo link on) |
| `web/src/indicators/` | The browser's copy of the indicators. Change it with the Python library, regenerate `golden.json`, and both test suites must pass |
| `web/src/data/` | Candles, the saved shapes (`model.ts`), the Supabase and made-up data stores, workspace saving |
| `web/src/chart/Chart.tsx` | The chart: candles, overlays, indicator panes, drawings, taps |
| `web/src/ui/` | Screens, sheets and styles. The look is Field CRM's (`benjaminkeithrose-svg/CRM`, `index.html`), without its logo |
| `web/public/sw.js` | Service worker. `CACHE` must equal `stockwizard-` + `APP_BUILD` in `web/src/config.ts`; bump both on every change to the app |
| `supabase/migrations/` | Database changes, one file per change, applied in order |
| `supabase/tests/` | Row-level security checks, run on a local Postgres with a stand-in for Supabase's sign-in |

## Supabase

Project `stockwizard` (ref `cxpspihahmztfydvdwpd`, Sydney). Every migration in
`supabase/migrations/` is applied to it; check the security advisors after
each one. Keys never go in the repository: loaders read `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` from the environment.

## Testing

```
cd backend && pip install -e ".[test]" && python -m pytest     # Python: indicators, loader, golden file
cd web && npm install && npm test                             # browser copy of the indicators, app logic
cd web && npm run build && NODE_PATH=$(npm root -g) node tests/browser.mjs   # the built app in Chromium
bash supabase/tests/run_local.sh                              # migrations and security rules, local Postgres
```

`npm install` needs `legacy-peer-deps` (set in `web/.npmrc`) because of an
npm bug with these versions. The browser test opens the app with `?demo`:
made-up candles, everything kept in the browser, no network. None of these
touch real market data, the live Supabase project or a phone. Say which ran.

## Hard rules

- No look-ahead anywhere. Nothing is reported as validated unless it passed
  the truncation test and the held-back test.
- No order logic before the safety rails exist. Live trading stays disabled
  and cannot be enabled from the app.
- No secrets in the repository, the browser or Supabase tables.
- Look and feel follows Ben's existing repositories; do not design the
  interface. `SPEC.md` overrides `PREFERENCES.md` where they differ (for
  example, the spec's Python and Supabase stack).

## Git

Work on a branch and open a pull request; never push to `main`. When a pull
request is ready, end with a tap-to-answer question asking whether to merge
it, "Merge it" first. Never force-push or rewrite history.

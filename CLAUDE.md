# Stock Wizard

A technical-analysis workspace: charts, a scanner, a bar-by-bar backtester, a
pattern lab and, last of all, a paper-trading bot on Interactive Brokers, all
backed by Supabase. Nothing is built yet.

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

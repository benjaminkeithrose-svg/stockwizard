-- 0DTE research runs, for the app's 0DTE tab (Ben, 18 Nov 2026). Each run of
-- the experiment matrix (backend/stockwizard/run_0dte_research.py) is saved
-- whole: the notes on what it is and isn't, the periods, how many strategies
-- were tried, the survivors with their validation, walk-forward and regime
-- results, and every strategy's development result. Server writes;
-- signed-in read.

create table public.research_runs (
  id          bigint generated always as identity primary key,
  kind        text not null default '0dte_matrix',
  ran_at      timestamptz not null default now(),
  title       text not null,
  modelled    boolean not null,       -- true while prices are modelled, not real quotes
  result      jsonb not null
);

create index research_runs_kind on public.research_runs (kind, ran_at desc);

comment on table public.research_runs is '0DTE experiment matrix runs, whole, for the app. Server writes; signed-in read.';

alter table public.research_runs enable row level security;
create policy "signed-in read" on public.research_runs for select to authenticated using (true);

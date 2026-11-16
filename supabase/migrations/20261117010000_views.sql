-- Chart pages ("views"): saved arrangements of workspace tabs as cards on a
-- grid, to come back to for a quick scan of the charts (Ben, 17 Nov 2026).

create table public.views (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  position    integer not null default 0,
  cards       jsonb not null default '[]'::jsonb,  -- [{id, workspace_id, x, y, w, h}] on a 12-column grid
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cards_is_list check (jsonb_typeof(cards) = 'array'),
  constraint at_most_ten_cards check (jsonb_array_length(cards) <= 10)
);

create index views_owner on public.views (owner, position);

create trigger views_touch before update on public.views
  for each row execute function public.touch_updated_at();

alter table public.views enable row level security;

create policy "own views" on public.views
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

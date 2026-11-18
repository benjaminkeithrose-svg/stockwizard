-- The PC status line (Ben, 18 Nov 2026: one installed program, stage 1). The supervisor on each
-- person's PC (backend/stockwizard/supervisor.py) runs their bot (and on Ben's PC the data
-- program) and writes a heartbeat here every 30 seconds; the app shows it on every device, so a
-- PC that's off or a TWS that's logged out is seen from the phone. One row a person.

create table public.pc_status (
  owner        uuid primary key references auth.users (id) on delete cascade,
  updated_at   timestamptz not null default now(),
  host         text,                    -- the PC's name
  bot_state    text not null check (bot_state in ('off', 'starting', 'connected', 'waiting', 'stopped')),
  bot_detail   text,                    -- its last line, in plain words
  data_state   text check (data_state in ('off', 'starting', 'catching up', 'idle', 'streaming', 'stopped')),
  data_detail  text,
  tws_open     boolean not null default false,  -- TWS or IB Gateway is taking connections on the bot's port
  version      text
);

comment on table public.pc_status is
  'Heartbeat from each person''s PC: their bot (and Ben''s data program), every 30 seconds. Old means the PC or the program is off.';

alter table public.pc_status enable row level security;
create policy "own PC" on public.pc_status for select to authenticated
  using (owner = (select auth.uid()) or owner = (select public.bot_owner()));
create policy "bot: report" on public.pc_status for insert to authenticated with check (owner = (select public.bot_owner()));
create policy "bot: report again" on public.pc_status for update to authenticated
  using (owner = (select public.bot_owner())) with check (owner = (select public.bot_owner()));

-- Working an order's price (Ben, 19 Nov 2026): an opening order starts at the midpoint and steps towards a
-- worst price (the midpoint moved against us by 10% of the structure's width) over 30 minutes, then holds;
-- unfilled after 55 minutes it is cancelled. The plan is kept with the order so a restart carries on.
alter table public.paper_orders
  add column work_start  numeric,       -- the midpoint it started at, per share
  add column work_worst  numeric,       -- never past this
  add column work_began  timestamptz,
  add column work_until  timestamptz;   -- cancelled unfilled at this time

comment on column public.paper_orders.work_worst is
  'The least credit (or most debit) the order may go to while its price is worked; see backend/stockwizard/working.py.';

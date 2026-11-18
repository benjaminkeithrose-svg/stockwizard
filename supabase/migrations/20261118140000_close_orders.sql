-- A close is a real order at the broker (Ben, 18 Nov 2026). The position stays
-- 'filled' while it works; the bot books the profit or loss at the close's
-- actual fill price, and only then marks it 'closed'. Kept here so a restart
-- picks up a close still working, or one that filled while the bot was away.

alter table public.paper_orders
  add column close_broker_id text,          -- the close order's id at the broker, while it works
  add column close_price     numeric,       -- its limit price per share (same credit/debit sense as the opening)
  add column close_reason    text;          -- why: by you, profit target, stop, ...

comment on column public.paper_orders.close_broker_id is
  'The working close order at the broker; cleared if it is cancelled unfilled. The position counts as open until it fills.';

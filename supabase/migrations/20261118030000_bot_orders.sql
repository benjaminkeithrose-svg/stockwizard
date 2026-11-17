-- The bot writes its orders itself (backend/stockwizard/run_bot.py), so
-- paper_orders also keeps when the order's prices and signal were taken
-- (the stale-data rail checks them again at approval), and can hold an
-- order the rails refused for having no price or no contracts.

alter table public.paper_orders
  add column prices_as_of timestamptz,
  add column signal_as_of timestamptz,
  alter column limit_price drop not null,
  drop constraint paper_orders_limit_price_check,
  add constraint paper_orders_limit_price_check check (limit_price >= 0),
  drop constraint paper_orders_quantity_check,
  add constraint paper_orders_quantity_check check (quantity >= 0);

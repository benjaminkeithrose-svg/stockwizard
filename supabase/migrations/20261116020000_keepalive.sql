-- A free Supabase project is paused after a week with no activity. A
-- scheduled GitHub job (.github/workflows/keepalive.yml) calls this twice a
-- week with the publishable key, so the database answers a real query. It
-- reads no table and returns only the server's time. (Same as Field CRM.)
create or replace function public.keepalive()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now() $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

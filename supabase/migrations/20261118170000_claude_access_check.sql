-- Claude only for the people in claude_access (Ben, 18 Nov 2026: multi-user). The claude
-- function calls claude_take on every request, so the check lives here and the deployed
-- function needs no change: anyone not listed is refused with the reason before anything
-- is counted or sent to Anthropic.

create or replace function public.claude_take(p_user uuid, p_limit integer) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare used integer;
begin
  if not exists (select 1 from public.claude_access where user_id = p_user) then
    raise exception 'Claude isn''t switched on for your account.';
  end if;
  insert into public.claude_usage (user_id, day, requests) values (p_user, (now() at time zone 'Australia/Sydney')::date, 1)
  on conflict (user_id, day) do update set requests = public.claude_usage.requests + 1
  returning requests into used;
  if used > p_limit then
    update public.claude_usage set requests = requests - 1 where user_id = p_user and day = (now() at time zone 'Australia/Sydney')::date;
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.claude_take(uuid, integer) from public, anon, authenticated;

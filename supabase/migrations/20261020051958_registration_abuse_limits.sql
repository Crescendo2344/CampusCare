-- Shared atomic counters hold keyed hashes, never raw IP addresses, emails, or IDs.
create table if not exists private.registration_rate_limits (
  scope text not null check (scope in ('ip','email','id')),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null,
  expires_at timestamptz not null,
  primary key (scope,subject_hash)
);
alter table private.registration_rate_limits enable row level security;
revoke all on private.registration_rate_limits from public,anon,authenticated;
-- Only the service role may access counters; ordinary user sessions have no policy or grants.
drop policy if exists registration_rate_limits_service on private.registration_rate_limits;
create policy registration_rate_limits_service on private.registration_rate_limits to service_role using(true) with check(true);
create index if not exists registration_rate_limits_expiry on private.registration_rate_limits(expires_at);

-- This narrowly scoped RPC is callable only by the server's service role.
-- A single UPSERT serializes concurrent requests across all Edge Function instances.
create or replace function public.consume_registration_limit(p_scope text,p_subject_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ceiling integer;
  duration interval;
  checked_at timestamptz := clock_timestamp();
  used integer;
  expiry timestamptz;
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit subject' using errcode='22023';
  end if;
  if p_scope='ip' then ceiling:=30; duration:=interval '15 minutes';
  elsif p_scope in ('email','id') then ceiling:=5; duration:=interval '1 hour';
  else raise exception 'Invalid rate-limit scope' using errcode='22023';
  end if;
  insert into private.registration_rate_limits as counter(scope,subject_hash,attempts,expires_at)
  values(p_scope,p_subject_hash,1,checked_at+duration)
  on conflict(scope,subject_hash) do update set
    attempts=case when counter.expires_at<=checked_at then 1 else least(counter.attempts+1,ceiling+1) end,
    expires_at=case when counter.expires_at<=checked_at then checked_at+duration else counter.expires_at end
  returning attempts,expires_at into used,expiry;
  return jsonb_build_object('allowed',used<=ceiling,'retry_after',case when used<=ceiling then 0 else greatest(1,ceil(extract(epoch from expiry-checked_at))::integer) end);
end;
$$;
revoke all on function public.consume_registration_limit(text,text) from public,anon,authenticated;
grant execute on function public.consume_registration_limit(text,text) to service_role;

-- Remove expired counters daily; this does not affect active windows.
select cron.schedule('cleanup-registration-rate-limits','17 2 * * *',
  $job$delete from private.registration_rate_limits where expires_at<now()-interval '1 day'$job$);

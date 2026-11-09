-- Signed-in devices: a user can list their own sessions and end any of them except the current one.
-- Ending a session removes its refresh token, so that device is signed out when its access token expires
-- (within the configured JWT lifetime, normally one hour).
create or replace function public.list_my_sessions()
returns table(id uuid,created_at timestamptz,last_active_at timestamptz,user_agent text,ip text,current boolean)
language sql
security definer
set search_path=''
stable
as $$
  select s.id,
         s.created_at,
         coalesce(s.refreshed_at::timestamptz,s.updated_at,s.created_at) as last_active_at,
         s.user_agent,
         host(s.ip) as ip,
         s.id::text=coalesce(auth.jwt()->>'session_id','') as current
  from auth.sessions s
  where s.user_id=auth.uid()
    and (s.not_after is null or s.not_after>now())
  order by (s.id::text=coalesce(auth.jwt()->>'session_id','')) desc,
           coalesce(s.refreshed_at::timestamptz,s.updated_at,s.created_at) desc;
$$;

create or replace function public.revoke_my_session(target uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare removed integer;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if target::text=coalesce(auth.jwt()->>'session_id','') then
    raise exception 'Use Logout to end this device''s session.';
  end if;
  delete from auth.sessions where id=target and user_id=auth.uid();
  get diagnostics removed=row_count;
  return removed>0;
end;
$$;

revoke all on function public.list_my_sessions() from public,anon;
revoke all on function public.revoke_my_session(uuid) from public,anon;
grant execute on function public.list_my_sessions() to authenticated;
grant execute on function public.revoke_my_session(uuid) to authenticated;

-- Accounts the administrator creates (staff and doctors) failed with "Database error creating new user":
-- Supabase Auth now inserts the auth user first and marks the email confirmed afterwards, so the sign-up
-- trigger saw an unconfirmed internal account and refused it. The admin-users function now records the
-- email here just before creating the account; the trigger accepts an internal account that is either
-- confirmed or on this list. Only the service role can write here, so direct sign-ups stay blocked.
create table if not exists public.internal_account_requests (
  email text primary key,
  requested_by bigint references public.users(user_id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.internal_account_requests enable row level security;
revoke all on public.internal_account_requests from anon, authenticated;

do $$
declare v_def text; v_old text; v_new text;
begin
  v_def:=pg_get_functiondef('public.handle_new_auth_user()'::regprocedure);
  v_old:='if new.email_confirmed_at is null then';
  v_new:='if new.email_confirmed_at is null and not exists(select 1 from public.internal_account_requests r where lower(r.email)=lower(coalesce(new.email,'''')) and r.created_at>now()-interval ''10 minutes'') then';
  if position(v_old in v_def)=0 then
    if position('internal_account_requests' in v_def)>0 then return; end if;
    raise exception 'handle_new_auth_user has changed; update this migration.';
  end if;
  v_def:=replace(v_def,v_old,v_new);
  v_def:=replace(v_def,'  insert into public.users(','  delete from public.internal_account_requests where lower(email)=lower(coalesce(new.email,''''));'||chr(10)||chr(10)||'  insert into public.users(');
  execute v_def;
end $$;

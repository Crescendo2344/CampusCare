-- Failed username sign-ins, kept by resolve-login to lock a username for 15 minutes after five wrong
-- passwords. Only the service role reads or writes it; old rows are removed daily.
create table if not exists public.login_attempts (
  attempt_id bigserial primary key,
  identifier text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists login_attempts_identifier_time_idx on public.login_attempts(identifier,attempted_at);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='campuscare-login-attempts-cleanup';
    perform cron.schedule('campuscare-login-attempts-cleanup','17 3 * * *',$q$delete from public.login_attempts where attempted_at<now()-interval '1 day'$q$);
  end if;
end $$;

-- Changing the sign-in email needs a 6-digit code sent to the new address. Only a hash of the code is
-- kept, it expires after 10 minutes, and five wrong tries end it. Only the service role can read or
-- write here (profile-actions); signed-in users have no access.
create table if not exists public.contact_change_codes (
  user_id bigint not null references public.users(user_id) on delete cascade,
  channel text not null check (channel in ('email','phone')),
  new_value text not null,
  code_hash text not null,
  attempts integer not null default 0 check (attempts>=0),
  sends integer not null default 1 check (sends>=1),
  window_started_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id,channel)
);
alter table public.contact_change_codes enable row level security;
revoke all on public.contact_change_codes from anon, authenticated;

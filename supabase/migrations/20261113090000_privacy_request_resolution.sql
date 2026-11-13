-- Privacy/data requests can be typed (access, correction, deletion, withdrawal) and resolved by an
-- administrator with a reply, like the request queues of other data-protection tools.
alter table public.privacy_consents
  add column if not exists request_type text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by bigint references public.users(user_id),
  add column if not exists resolution text;
create index if not exists privacy_consents_open_requests_idx
  on public.privacy_consents(consented_at) where event_type='Withdrawal Request' and resolved_at is null;

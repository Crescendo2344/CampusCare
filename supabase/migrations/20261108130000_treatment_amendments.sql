-- A saved visit record is never overwritten. The doctor who wrote it adds dated clarifications instead,
-- so the original entry and every later correction stay readable.
alter table public.treatments add column if not exists amendments jsonb not null default '[]'::jsonb;
alter table public.treatments drop constraint if exists treatments_amendments_array;
alter table public.treatments add constraint treatments_amendments_array check (jsonb_typeof(amendments)='array');
comment on column public.treatments.amendments is 'Append-only clarifications: [{at, by, by_name, note}]. Written only by treatment-actions.';

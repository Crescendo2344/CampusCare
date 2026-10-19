-- Keep private document-holding selfies separate from editable profile photos.
alter table public.users add column if not exists verification_selfie_url text;
comment on column public.users.verification_selfie_url is 'Private campuscare-verification object path for the registration camera selfie.';

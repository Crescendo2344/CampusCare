-- Preserve legacy front-document paths while storing a separate private back ID photo.
alter table public.users add column if not exists id_back_file_url text;
comment on column public.users.id_back_file_url is 'Private campuscare-verification object path for the back of the registration ID.';

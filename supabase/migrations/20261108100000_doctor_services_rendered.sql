-- A doctor's specialization (field of expertise) plus the services they render; booking offers
-- only those services with that doctor.
alter table public.users add column if not exists services_rendered text[] not null default '{}';
comment on column public.users.specialty is 'Specialization (field of expertise) for doctors, e.g. General Medicine or Dental.';
comment on column public.users.services_rendered is 'Services this doctor renders, e.g. {Dental Checkup,Oral Prophylaxis}. Empty means every service of the clinic.';

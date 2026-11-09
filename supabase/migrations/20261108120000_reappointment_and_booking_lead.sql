-- Return for reappointment instead of cancellation: when a visit cannot push through, the doctor or the
-- front desk proposes a new time. The appointment keeps its place, moves to the proposed time, and the
-- patient accepts it or picks another time.
alter table public.appointments add column if not exists reappoint_from_date date;
alter table public.appointments add column if not exists reappoint_from_time time;
alter table public.appointments add column if not exists reappoint_reason text;
alter table public.appointments add column if not exists reappointed_by bigint references public.users(user_id);
alter table public.appointments add column if not exists reappointed_at timestamptz;
alter table public.appointments add column if not exists patient_response text;
alter table public.appointments drop constraint if exists appointments_patient_response_check;
alter table public.appointments add constraint appointments_patient_response_check check (patient_response is null or patient_response in ('Awaiting','Accepted'));
comment on column public.appointments.patient_response is 'Awaiting: the clinic proposed a new time (reappointment) and the patient has not answered yet.';

-- Patients book at least this many hours ahead. Later slots stay open for reappointments the clinic
-- places, so a visit that cannot push through can move into the next day.
alter table public.system_settings add column if not exists booking_lead_hours integer not null default 24;
alter table public.system_settings drop constraint if exists system_settings_booking_lead_hours_check;
alter table public.system_settings add constraint system_settings_booking_lead_hours_check check (booking_lead_hours between 0 and 72);

-- A patient's reschedule is a request: the appointment keeps its current time until the doctor approves
-- the requested date and time. Requests close 24 hours before the appointment (checked in
-- appointment-actions, which is the only writer).
alter table public.appointments add column if not exists reschedule_request_date date;
alter table public.appointments add column if not exists reschedule_request_time time;
alter table public.appointments add column if not exists reschedule_requested_at timestamptz;
alter table public.appointments drop constraint if exists appointments_reschedule_request_complete;
alter table public.appointments add constraint appointments_reschedule_request_complete check (
  (reschedule_request_date is null and reschedule_request_time is null and reschedule_requested_at is null)
  or (reschedule_request_date is not null and reschedule_request_time is not null and reschedule_requested_at is not null)
);
create index if not exists appointments_pending_reschedule_idx on public.appointments(doctor_id) where reschedule_request_date is not null;

-- Existing students stay unclassified; staff record the confirmed session through patient-actions.
-- Existing table RLS and grants continue to protect this nullable field.
alter table public.patients add column class_session text null
  constraint patients_class_session_check check (class_session in ('Morning','Evening','Mixed'));
comment on column public.patients.class_session is 'Confirmed student class session. NULL means not recorded; never infer from appointment time.';

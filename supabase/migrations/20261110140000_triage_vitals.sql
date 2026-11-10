-- Triage vital signs: the front desk takes blood pressure, temperature and SpO₂ when the patient
-- arrives, so the doctor sees them before the consultation. Staff may correct them until the visit is
-- completed; the doctor copies them into the visit record. Kept apart from public.appointments so the
-- clinical readings follow clinical access rules: staff, the appointment's doctor and the patient read
-- them; administrators do not. Writes go through the appointment-actions function only.
create table if not exists public.appointment_vitals (
  appointment_id bigint primary key references public.appointments(appointment_id) on delete cascade,
  vitals jsonb not null default '{}'::jsonb,
  recorded_by bigint references public.users(user_id),
  recorded_at timestamptz not null default now(),
  updated_by bigint references public.users(user_id),
  updated_at timestamptz not null default now(),
  constraint appointment_vitals_shape check (jsonb_typeof(vitals)='object')
);
comment on table public.appointment_vitals is
  'Triage vital signs (blood pressure, temperature, SpO2) taken by clinic staff before the doctor sees the patient.';

alter table public.appointment_vitals enable row level security;

drop policy if exists appointment_vitals_select on public.appointment_vitals;
create policy appointment_vitals_select on public.appointment_vitals
  for select to authenticated
  using (
    exists(
      select 1 from public.appointments a
       where a.appointment_id=appointment_vitals.appointment_id
         and (
           ((select private.has_role(array['Staff']::text[])) and a.clinic=(select private.current_clinic()))
           or a.patient_id=(select private.current_patient_id())
           or (a.doctor_id=(select private.current_app_user_id()) and (select private.has_role(array['Doctor']::text[])))
         )
    )
  );

revoke insert,update,delete on public.appointment_vitals from anon, authenticated;
grant select on public.appointment_vitals to authenticated;

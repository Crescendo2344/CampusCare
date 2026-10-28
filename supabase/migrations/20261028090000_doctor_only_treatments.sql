-- Visit notes are clinical records: only the treating doctor and the patient read them.
-- Administrators and staff no longer read treatment or dental rows; clinic reports get the
-- de-identified facts they need (no notes, findings, prescriptions or vitals) from report_treatment_facts().
drop policy if exists treatments_select on public.treatments;
create policy treatments_select on public.treatments
  for select to authenticated
  using (
    patient_id = (select private.current_patient_id())
    or (doctor_id = (select private.current_app_user_id()) and (select private.has_role(array['Doctor']::text[])))
  );

drop policy if exists dental_records_select on public.dental_records;
create policy dental_records_select on public.dental_records
  for select to authenticated
  using (
    patient_id = (select private.current_patient_id())
    or (dentist_user_id = (select private.current_app_user_id()) and (select private.has_role(array['Doctor']::text[])))
  );

create or replace function public.report_treatment_facts()
returns table(treatment_id bigint, patient_id bigint, doctor_id bigint, appointment_id bigint, diagnosis text, treatment_date date, status text, archived_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.treatment_id, t.patient_id, t.doctor_id, t.appointment_id, t.diagnosis::text, t.treatment_date, t.status::text, t.archived_at
  from public.treatments t
  where private.has_role(array['Administrator','Staff']::text[])
  order by t.treatment_id;
$function$;

revoke all on function public.report_treatment_facts() from public, anon;
grant execute on function public.report_treatment_facts() to authenticated;

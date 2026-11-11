-- Medical history and allergies for the patient themself, doctors and clinic staff. Administrators get no rows.
create or replace function public.patient_health_notes(p_patient_ids bigint[])
returns table(patient_id bigint, medical_history text, allergies text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.patient_id, p.medical_history, p.allergies
  from public.patients p
  where p.patient_id = any(p_patient_ids)
    and (
      p.patient_id = (select private.current_patient_id())
      or (select private.has_role(array['Doctor','Staff']))
    );
$$;

revoke all on function public.patient_health_notes(bigint[]) from public, anon;
grant execute on function public.patient_health_notes(bigint[]) to authenticated;

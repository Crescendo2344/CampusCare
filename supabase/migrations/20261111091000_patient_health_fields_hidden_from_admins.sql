-- Administrators manage accounts; they must not read patients' medical history or allergies.
-- Row access stays as before (patients_select); the two health columns are taken out of the
-- authenticated role's column grant and served only through patient_health_notes(), which
-- returns them to the patient themself and to doctors and clinic staff.
revoke select on public.patients from authenticated;
revoke select on public.patients from anon;
grant select (
  patient_id,user_id,birth_date,sex,address,height_cm,weight_kg,
  emergency_contact_name,emergency_contact_number,created_at,archived_at,
  blood_type,updated_at,archived_previous_user_status,class_session,course,major
) on public.patients to authenticated;

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

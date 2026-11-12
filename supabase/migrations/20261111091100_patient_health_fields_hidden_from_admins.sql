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

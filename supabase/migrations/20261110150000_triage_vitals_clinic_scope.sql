-- Staff read the triage vital signs of their own clinic's appointments only, like the rest of the
-- clinic-separated records. The appointment's doctor and the patient still read them; administrators do not.
drop policy if exists appointment_vitals_select on public.appointment_vitals;
create policy appointment_vitals_select on public.appointment_vitals
  for select to authenticated
  using (
    exists(
      select 1 from public.appointments a
       where a.appointment_id=appointment_vitals.appointment_id
         and (
           ((select private.has_role(array['Staff']::text[])) and a.clinic::text=(select private.current_clinic()))
           or a.patient_id=(select private.current_patient_id())
           or (a.doctor_id=(select private.current_app_user_id()) and (select private.has_role(array['Doctor']::text[])))
         )
    )
  );

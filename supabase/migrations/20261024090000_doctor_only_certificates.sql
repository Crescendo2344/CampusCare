-- Medical certificates belong to the issuing doctor. Patients may read only certificates that were
-- issued to them (including ones later voided, so they can see why); staff and administrators no longer
-- read certificate records. All writes go through the certificate-actions function.
drop policy if exists certificates_select on public.medical_certificates;
create policy certificates_select on public.medical_certificates
  for select to authenticated
  using (
    (doctor_id = (select private.current_app_user_id()) and (select private.has_role(array['Doctor']::text[])))
    or (
      patient_id = (select private.current_patient_id())
      and issued_at is not null
      and status in ('Issued','Cancelled')
    )
  );

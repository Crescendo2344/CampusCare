-- Doctors prepare, sign, issue and void; front-desk staff release finished documents to patients.
-- Staff may read issued or voided certificates and completed fitness assessments, never drafts,
-- and cannot write either table (writes stay in doctor-only edge functions).
drop policy if exists certificates_staff_release_select on public.medical_certificates;
create policy certificates_staff_release_select on public.medical_certificates
  for select to authenticated
  using ((select private.has_role(array['Staff'::text])) and status in ('Issued','Cancelled'));

drop policy if exists fitness_staff_release_select on public.fitness_assessments;
create policy fitness_staff_release_select on public.fitness_assessments
  for select to authenticated
  using ((select private.has_role(array['Staff'::text])) and status='Completed');

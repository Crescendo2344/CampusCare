-- Fitness-to-compete assessments are a doctor's clinical work. Doctors read the assessments assigned
-- to them and unclaimed open requests; a patient may still read their own record. Staff and
-- administrators no longer read fitness records. All writes go through the fitness-actions function.
drop policy if exists fitness_select on public.fitness_assessments;
create policy fitness_select on public.fitness_assessments
  for select to authenticated
  using (
    patient_id = (select private.current_patient_id())
    or (doctor_id = (select private.current_app_user_id()) and (select private.has_role(array['Doctor']::text[])))
    or (
      doctor_id is null
      and status in ('Requested','In Assessment')
      and (select private.has_role(array['Doctor']::text[]))
    )
  );

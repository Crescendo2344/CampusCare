-- The official dental record (tooth chart, oral health record, accomplishment) stays with the Dental
-- Clinic: patients no longer read it. They see a summary of their dental visits from their visit records.
drop policy if exists dental_records_select on public.dental_records;
create policy dental_records_select on public.dental_records
  for select to authenticated
  using (dentist_user_id = (select private.current_app_user_id()) and (select private.has_role(array['Doctor'])));

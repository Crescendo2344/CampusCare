-- The nightly archive of patients inactive for 5 years runs after the automated daily backup (2:00 AM
-- Manila), so that backup still holds the records as they were. Each run is written to the backup history
-- (backup_logs) as an "Inactive Patient Archive" entry; file_size holds the number of records archived.
create or replace function private.run_inactive_patient_archive(p_years integer default 5)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_started timestamptz:=now(); v_count integer;
begin
  v_count:=private.archive_inactive_patients(p_years);
  insert into public.backup_logs(backup_type,storage_location,status,started_at,completed_at,file_size,error_message)
  values('Inactive Patient Archive','archive://patients/inactive-'||p_years||'-years','Completed',v_started,now(),v_count,null);
  return v_count;
exception when others then
  insert into public.backup_logs(backup_type,storage_location,status,started_at,completed_at,file_size,error_message)
  values('Inactive Patient Archive','archive://patients/inactive-'||p_years||'-years','Failed',v_started,now(),0,left(sqlerrm,500));
  return 0;
end;
$$;
revoke all on function private.run_inactive_patient_archive(integer) from public, anon, authenticated;

do $$ begin
  if exists(select 1 from cron.job where jobname='campuscare-archive-inactive-patients') then
    perform cron.unschedule('campuscare-archive-inactive-patients');
  end if;
  perform cron.schedule('campuscare-archive-inactive-patients','40 18 * * *',$job$select private.run_inactive_patient_archive(5);$job$);
end $$;

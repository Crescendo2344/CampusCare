-- A booking whose patient has not arrived one hour after the appointment time becomes a No-show by itself.
-- "Arrived" means the front desk took the vital signs, the patient answered the Dental Health History at
-- check-in, or the doctor started the visit record. Bookings waiting for the patient to confirm a proposed
-- time are left to their own deadline. Only appointments from the day this rule began are affected, so
-- older bookings still waiting for an outcome are left for the clinic to close. Bookings of an inactive
-- patient or doctor are skipped (the appointment integrity check refuses to update them).
create or replace function private.mark_overdue_no_shows()
returns integer language plpgsql security definer set search_path to '' as $$
declare v_count integer;
begin
  with overdue as (
    select a.appointment_id
      from public.appointments a
      join public.patients p on p.patient_id=a.patient_id and p.archived_at is null
      join public.users pu on pu.user_id=p.user_id and pu.status='Active'
      join public.users d on d.user_id=a.doctor_id and d.role='Doctor' and d.status='Active'
     where a.status in ('Scheduled','Confirmed','Pending')
       and a.appointment_date>=date '2026-11-19'
       and coalesce(a.patient_response,'')<>'Awaiting'
       and ((a.appointment_date+a.appointment_time) at time zone 'Asia/Manila')+interval '1 hour'<=now()
       and not exists(select 1 from public.appointment_vitals v where v.appointment_id=a.appointment_id)
       and not exists(select 1 from public.treatments t where t.appointment_id=a.appointment_id)
       and not exists(select 1 from public.dental_health_histories h where h.appointment_id=a.appointment_id and h.source='check-in')
     for update of a skip locked
  ), marked as (
    update public.appointments a
       set status='No-show',
           notes=concat_ws(E'\n',nullif(a.notes,''),'Marked no-show automatically: the patient had not arrived one hour after the appointment time.')
      from overdue o
     where a.appointment_id=o.appointment_id
    returning a.appointment_id
  ), logged as (
    insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
    select null,'APPOINTMENT_NO_SHOW_AUTO','appointments',m.appointment_id,jsonb_build_object('rule','not arrived one hour after the appointment time')
      from marked m
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end $$;
revoke all on function private.mark_overdue_no_shows() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('campuscare-auto-no-show') where exists(select 1 from cron.job where jobname='campuscare-auto-no-show');
  perform cron.schedule('campuscare-auto-no-show','*/10 * * * *',$job$select private.mark_overdue_no_shows();$job$);
end $$;

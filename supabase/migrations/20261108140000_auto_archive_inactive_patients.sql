-- Patient records archive themselves after five years without activity; there is no manual archive.
-- Activity is the latest of: a booked visit (not cancelled), a treatment, a sign-in, or registration.
-- A patient with an upcoming booking is never archived. Staff can still restore a returning patient.
create or replace function private.archive_inactive_patients(p_years integer default 5)
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_cutoff date:=((now() at time zone 'Asia/Manila')::date - make_interval(years=>p_years))::date;
  v_today date:=(now() at time zone 'Asia/Manila')::date;
  r record; v_count integer:=0;
begin
  for r in
    select p.patient_id,p.user_id,u.status
      from public.patients p join public.users u on u.user_id=p.user_id
     where p.archived_at is null and u.role='Patient'
       and greatest(
             coalesce((select max(a.appointment_date) from public.appointments a where a.patient_id=p.patient_id and a.status<>'Cancelled'),'1900-01-01'::date),
             coalesce((select max(t.treatment_date) from public.treatments t where t.patient_id=p.patient_id),'1900-01-01'::date),
             coalesce((u.last_login_at at time zone 'Asia/Manila')::date,'1900-01-01'::date),
             coalesce((p.created_at at time zone 'Asia/Manila')::date,'1900-01-01'::date)
           ) < v_cutoff
       and not exists (select 1 from public.appointments a where a.patient_id=p.patient_id and a.appointment_date>=v_today and a.status in ('Scheduled','Confirmed'))
  loop
    update public.patients set archived_at=now(),archived_previous_user_status=r.status,updated_at=now() where patient_id=r.patient_id;
    update public.users set status='Archived' where user_id=r.user_id;
    insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
    values(null,'PATIENT_RECORD_AUTO_ARCHIVED','patients',r.patient_id,jsonb_build_object('target_user_id',r.user_id,'previous_status',r.status,'inactive_years',p_years));
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.archive_inactive_patients(integer) from public, anon, authenticated;

do $$
begin
  if exists(select 1 from cron.job where jobname='campuscare-archive-inactive-patients') then
    perform cron.unschedule('campuscare-archive-inactive-patients');
  end if;
  perform cron.schedule('campuscare-archive-inactive-patients','40 18 * * *',$job$select private.archive_inactive_patients(5);$job$);
end $$;

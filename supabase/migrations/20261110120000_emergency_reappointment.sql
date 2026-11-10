-- Emergency reappointment: when a doctor declares an emergency (no administrator approval needed), every
-- remaining visit that day is moved to the earliest open slot with the same doctor and the patient must
-- confirm by a deadline: accept the new time or pick another open time. A patient who does not answer in
-- time loses the reserved slot and books a new appointment on their own; the clinic does not offer again.
alter table public.appointments add column if not exists reappoint_deadline timestamptz;
comment on column public.appointments.reappoint_deadline is
  'Emergency reappointment: the patient must accept or pick another time by this moment, or the reserved slot is released.';

-- A cancelled visit frees its slot everywhere in the app (availability, conflict checks, undo), but the
-- table-wide unique key still held it, so a released or cancelled time could never be booked again.
-- Only live bookings need to be unique per doctor, date and time.
alter table public.appointments drop constraint if exists appointments_doctor_id_appointment_date_appointment_time_key;
create unique index if not exists appointments_live_slot_key
  on public.appointments(doctor_id,appointment_date,appointment_time)
  where status<>'Cancelled';

create index if not exists appointments_awaiting_deadline_idx
  on public.appointments(reappoint_deadline)
  where patient_response='Awaiting' and reappoint_deadline is not null;

-- Releases every emergency reappointment whose deadline has passed without an answer, and tells the
-- patient (in CampusCare and by email) to book again. The title contains "Cancelled" and the message ends
-- with "Reason: ..." so the branded email shows it as a cancellation with that reason.
create or replace function private.release_unconfirmed_reappointments()
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_count integer:=0; v_user bigint; v_deadline text;
begin
  for r in
    select a.appointment_id,a.patient_id,a.appointment_date,a.appointment_time,a.reappoint_deadline,a.reappointed_by
      from public.appointments a
     where a.patient_response='Awaiting'
       and a.reappoint_deadline is not null
       and a.reappoint_deadline<=now()
       and a.status in ('Scheduled','Confirmed')
       -- Rows of archived or inactive patients cannot be changed (validate_appointment_integrity).
       and exists(select 1 from public.patients p join public.users u on u.user_id=p.user_id
                   where p.patient_id=a.patient_id and p.archived_at is null and u.status='Active')
     for update of a skip locked
  loop
    begin
    v_deadline:=to_char(r.reappoint_deadline at time zone 'Asia/Manila','Dy, Mon FMDD, YYYY "at" FMHH12:MI AM');
    update public.appointments
       set status='Cancelled',cancelled_at=now(),patient_response=null,
           cancellation_reason='Rebooking not confirmed by '||v_deadline
     where appointment_id=r.appointment_id;
    insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
    values(null,'APPOINTMENT_REAPPOINTMENT_RELEASED','appointments',r.appointment_id,
           jsonb_build_object('deadline',r.reappoint_deadline,'date',r.appointment_date,'time',r.appointment_time));
    select p.user_id into v_user from public.patients p where p.patient_id=r.patient_id;
    if v_user is not null then
      insert into public.notifications(user_id,title,message,type,channel,delivery_status,reference_type,reference_id,action_page)
      values(v_user,'Appointment Cancelled – Rebooking Not Confirmed',
        'Your reserved time on '||to_char(r.appointment_date,'Dy, Mon FMDD, YYYY')||' at '||to_char(r.appointment_time,'FMHH12:MI AM')||
        ' has been released. Reason: it was not confirmed by '||v_deadline||'. To see a doctor, please book a new appointment in CampusCare.',
        'Appointment','In-app','Created','appointments',r.appointment_id,'my-appointments');
    end if;
    if r.reappointed_by is not null then
      insert into public.notifications(user_id,title,message,type,channel,delivery_status,reference_type,reference_id,action_page)
      values(r.reappointed_by,'Rebooking not confirmed',
        'A patient did not confirm the new time on '||to_char(r.appointment_date,'Dy, Mon FMDD, YYYY')||' at '||to_char(r.appointment_time,'FMHH12:MI AM')||'. The slot is open again.',
        'Schedule','In-app','Created','appointments',r.appointment_id,'appointments');
    end if;
    v_count:=v_count+1;
    exception when others then
      -- One bad row (e.g. a patient archived meanwhile) must not stop the others from being released.
      insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
      values(null,'APPOINTMENT_REAPPOINTMENT_RELEASE_FAILED','appointments',r.appointment_id,jsonb_build_object('error',sqlerrm));
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.release_unconfirmed_reappointments() from public, anon, authenticated;

do $$
begin
  if exists(select 1 from cron.job where jobname='campuscare-release-unconfirmed-reappointments') then
    perform cron.unschedule('campuscare-release-unconfirmed-reappointments');
  end if;
  perform cron.schedule('campuscare-release-unconfirmed-reappointments','*/10 * * * *',$job$select private.release_unconfirmed_reappointments();$job$);
end $$;

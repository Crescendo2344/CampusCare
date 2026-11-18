-- Dental Health History Form answers. Patients answer after booking a dental appointment; at check-in the
-- clinic can hand them a device or record that the paper form was used. One row per appointment
-- (a later visit in the same semester can be a "no changes" confirmation copying the earlier answers).
-- Only the dental-health-history Edge Function reads or writes this table: the answers are seen by the
-- patient and the dentists, never by staff or administrators.
create table if not exists public.dental_health_histories(
  history_id bigint generated always as identity primary key,
  patient_id bigint not null references public.patients(patient_id) on delete cascade,
  appointment_id bigint references public.appointments(appointment_id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  height_cm numeric(5,1),
  weight_kg numeric(5,1),
  source text not null default 'online' check (source in ('online','check-in','paper')),
  confirmed_unchanged boolean not null default false,
  attested boolean not null default false,
  submitted_by bigint references public.users(user_id) on delete set null,
  reviewed_by bigint references public.users(user_id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dental_health_histories_patient_idx on public.dental_health_histories(patient_id,created_at desc);
create index if not exists dental_health_histories_appointment_idx on public.dental_health_histories(appointment_id);
create index if not exists dental_health_histories_submitted_by_idx on public.dental_health_histories(submitted_by);
create index if not exists dental_health_histories_reviewed_by_idx on public.dental_health_histories(reviewed_by);
alter table public.dental_health_histories enable row level security;
revoke all on public.dental_health_histories from anon, authenticated;
comment on table public.dental_health_histories is 'Dental Health History Form answers; read and written only by the dental-health-history Edge Function (patient and dentists).';

-- The day-before reminder also asks for the Dental Health History when a dental visit still needs it.
create or replace function public.queue_campuscare_appointment_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_days integer:=1; v_today date; v_count integer;
begin
  select coalesce(max(appointment_reminder_days),1) into v_days from public.system_settings;
  v_days:=greatest(0,least(14,v_days));
  v_today:=(now() at time zone 'Asia/Manila')::date;
  insert into public.notifications(user_id,title,message,type,channel,is_read,scheduled_at,sent_at,delivery_status,reference_type,reference_id,action_page,notification_key)
  select p.user_id,'Appointment Reminder',
    coalesce(a.clinic,'Clinic')||' · '||to_char(a.appointment_date,'Dy, Mon FMDD, YYYY')||' at '||to_char(a.appointment_time,'FMHH12:MI AM')||
    case when coalesce(u.person_type,'Student') in ('Teaching Personnel','Non-Teaching Personnel') then '. Bring your Employee ID.'
      else '. Bring your signed COR for '||private.campuscare_semester_label(a.appointment_date)||' and your Student ID.' end||
    case when a.clinic='Dental Clinic' and not exists(select 1 from public.dental_health_histories h where h.appointment_id=a.appointment_id)
      then ' Please answer your Dental Health History in CampusCare (My Appointments) before your visit.' else '' end,
    'Appointment','In-app',false,now(),now(),'Delivered','appointments',a.appointment_id,'my-appointments',
    'appointment-reminder-'||a.appointment_id||'-'||a.appointment_date||'-'||to_char(a.appointment_time,'HH24:MI')
  from public.appointments a
  join public.patients p on p.patient_id=a.patient_id
  join public.users u on u.user_id=p.user_id
  where a.status='Scheduled' and p.user_id is not null and u.status='Active'
    and a.appointment_date between v_today and (v_today+v_days)
    and not exists(select 1 from public.notifications n where n.notification_key='appointment-reminder-'||a.appointment_id||'-'||a.appointment_date||'-'||to_char(a.appointment_time,'HH24:MI'));
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

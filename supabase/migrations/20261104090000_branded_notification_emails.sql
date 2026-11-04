-- One email layout for every CampusCare notification. Appointment emails add a details card and,
-- unless the visit was cancelled, a "Bring this when you arrive" box naming the semester's COR.

create or replace function private.html_escape(value text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(value,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;');
$$;

-- "1st Semester, SY 2026–2027" from the clinic's semester dates, falling back to
-- July–December = 1st Semester and January–June = 2nd Semester.
create or replace function private.campuscare_semester_label(day date)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare s record; y integer;
begin
  select semester_start,semester_end,semester2_start,semester2_end into s from public.system_settings order by settings_id limit 1;
  if s.semester_start is not null and day between s.semester_start and s.semester_end then
    y:=extract(year from s.semester_start);return '1st Semester, SY '||y||'–'||(y+1);
  end if;
  if s.semester2_start is not null and day between s.semester2_start and s.semester2_end then
    y:=coalesce(extract(year from s.semester_start)::int,extract(year from s.semester2_start)::int-1);return '2nd Semester, SY '||y||'–'||(y+1);
  end if;
  y:=extract(year from day);
  if extract(month from day)>=7 then return '1st Semester, SY '||y||'–'||(y+1); end if;
  return '2nd Semester, SY '||(y-1)||'–'||y;
end;
$$;

create or replace function private.render_notification_email(p_notification_id bigint)
returns table(subject text,html_body text,text_body text)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  n record; u record; a record; st record;
  v_first text; v_rows text:=''; v_rows_text text:=''; v_bring text:=''; v_bring_text text:='';
  v_accent text:='#0a7ea8'; v_intro text; v_app constant text:='https://campuscare-brown-two.vercel.app/';
  v_html text; v_text text; v_is_appt boolean:=false; v_cancelled boolean:=false; v_student boolean;
begin
  select * into n from public.notifications where notification_id=p_notification_id;
  if not found then return; end if;
  select email,first_name,last_name,person_type into u from public.users where user_id=n.user_id;
  select clinic_name,address,contact_email,contact_number into st from public.system_settings order by settings_id limit 1;
  v_first:=coalesce(nullif(btrim(u.first_name),''),'there');
  v_intro:=n.message;
  v_cancelled:=n.title ilike '%cancel%';
  v_accent:=case when v_cancelled then '#b42318' when n.title ilike '%reminder%' then '#8f5200' when n.title ilike '%resched%' then '#5b4fd6' else '#0a7ea8' end;

  if n.reference_type='appointments' and n.reference_id is not null then
    select ap.clinic,ap.service,ap.appointment_date,ap.appointment_time,ap.status,
           nullif(btrim(coalesce(d.first_name,'')||' '||coalesce(d.last_name,'')),'') as doctor
      into a
      from public.appointments ap left join public.users d on d.user_id=ap.doctor_id
     where ap.appointment_id=n.reference_id;
    if found then
      v_is_appt:=true;
      -- The details card carries the facts, so the intro keeps only the first sentence.
      v_intro:=case
        when v_cancelled then 'Your appointment below has been cancelled.'
        when n.title ilike '%reminder%' then 'This is a friendly reminder of your upcoming clinic visit.'
        when n.title ilike '%resched%' then 'Your appointment has been moved to the new date and time below.'
        else 'Your clinic appointment is booked. Here are the details.' end;
      if v_cancelled and substring(n.message from 'Reason: (.*)$') is not null then
        v_intro:='Your appointment below has been cancelled. Reason: '||substring(n.message from 'Reason: (.*)$');
      end if;
      v_rows:=
        '<tr><td style="padding:8px 0;color:#5b6b75;font-size:13px;width:110px">Clinic</td><td style="padding:8px 0;font-size:14px;font-weight:600">'||private.html_escape(coalesce(a.clinic,'Clinic'))||'</td></tr>'||
        case when a.service is not null then '<tr><td style="padding:8px 0;color:#5b6b75;font-size:13px">Service</td><td style="padding:8px 0;font-size:14px;font-weight:600">'||private.html_escape(a.service)||'</td></tr>' else '' end||
        case when a.doctor is not null then '<tr><td style="padding:8px 0;color:#5b6b75;font-size:13px">Doctor</td><td style="padding:8px 0;font-size:14px;font-weight:600">Dr. '||private.html_escape(a.doctor)||'</td></tr>' else '' end||
        '<tr><td style="padding:8px 0;color:#5b6b75;font-size:13px">Date</td><td style="padding:8px 0;font-size:14px;font-weight:600">'||to_char(a.appointment_date,'FMDay, FMMonth FMDD, YYYY')||'</td></tr>'||
        '<tr><td style="padding:8px 0;color:#5b6b75;font-size:13px">Time</td><td style="padding:8px 0;font-size:14px;font-weight:600">'||to_char(a.appointment_time,'FMHH12:MI AM')||'</td></tr>'||
        '<tr><td style="padding:8px 0;color:#5b6b75;font-size:13px">Where</td><td style="padding:8px 0;font-size:14px">'||private.html_escape(coalesce(st.clinic_name,'CTU Main Medical & Dental Clinic'))||', Ground Floor, Education Building</td></tr>';
      v_rows_text:='Clinic: '||coalesce(a.clinic,'Clinic')||E'\n'||coalesce('Service: '||a.service||E'\n','')||coalesce('Doctor: Dr. '||a.doctor||E'\n','')||
        'Date: '||to_char(a.appointment_date,'FMDay, FMMonth FMDD, YYYY')||E'\nTime: '||to_char(a.appointment_time,'FMHH12:MI AM')||E'\nWhere: Ground Floor, Education Building, CTU Main Campus\n';
      if not v_cancelled then
        v_student:=coalesce(u.person_type,'Student') not in ('Teaching Personnel','Non-Teaching Personnel');
        v_bring:='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;background:#fff7e6;border:1px solid #f4c778;border-radius:12px"><tr><td style="padding:16px 18px">'||
          '<div style="font-size:14px;font-weight:700;color:#7a4500;margin-bottom:8px">Bring this when you arrive</div>'||
          case when v_student then
            '<div style="font-size:14px;line-height:1.6;color:#3d2a06">&#10003;&nbsp; Your <strong>signed</strong> Certificate of Registration (COR) for '||private.campuscare_semester_label(a.appointment_date)||'<br>&#10003;&nbsp; Your Student ID<br>&#10003;&nbsp; Arrive 10 minutes before your time</div>'||
            '<div style="font-size:12px;color:#7a4500;margin-top:8px">An unsigned COR may not be accepted. A printed copy or a clear photo on your phone is fine.</div>'
          else
            '<div style="font-size:14px;line-height:1.6;color:#3d2a06">&#10003;&nbsp; Your Employee ID<br>&#10003;&nbsp; Arrive 10 minutes before your time</div>'
          end||'</td></tr></table>';
        v_bring_text:=E'\nBRING THIS WHEN YOU ARRIVE\n'||case when v_student then
          '- Your signed Certificate of Registration (COR) for '||private.campuscare_semester_label(a.appointment_date)||E'\n- Your Student ID\n- Arrive 10 minutes before your time\nAn unsigned COR may not be accepted.\n'
          else E'- Your Employee ID\n- Arrive 10 minutes before your time\n' end;
      end if;
    end if;
  end if;

  v_html:=
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'||private.html_escape(n.title)||'</title></head>'||
    '<body style="margin:0;background:#eef3f7;font-family:Segoe UI,Arial,sans-serif;color:#16262f">'||
    '<div style="display:none;max-height:0;overflow:hidden">'||private.html_escape(left(v_intro,140))||'</div>'||
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f7"><tr><td align="center" style="padding:28px 14px">'||
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dbe5ec">'||
    '<tr><td style="background:#0a7ea8;padding:20px 26px;color:#ffffff"><div style="font-size:20px;font-weight:800;letter-spacing:.01em">CampusCare</div><div style="font-size:12px;opacity:.9;margin-top:2px">CTU Main Medical &amp; Dental Clinic</div></td></tr>'||
    '<tr><td style="height:4px;background:'||v_accent||'"></td></tr>'||
    '<tr><td style="padding:26px">'||
    '<p style="margin:0 0 6px;font-size:14px;color:#4a6571">Hello '||private.html_escape(v_first)||',</p>'||
    '<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:'||v_accent||'">'||private.html_escape(n.title)||'</h1>'||
    '<p style="margin:0;font-size:15px;line-height:1.6;white-space:pre-line">'||private.html_escape(v_intro)||'</p>'||
    case when v_rows<>'' then '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #e3eaef;border-bottom:1px solid #e3eaef">'||v_rows||'</table>' else '' end||
    v_bring||
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr><td style="border-radius:10px;background:#0a7ea8"><a href="'||v_app||'" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">'||
      case when v_is_appt then 'View my appointment' else 'Open CampusCare' end||'</a></td></tr></table>'||
    case when v_is_appt and not v_cancelled then '<p style="margin:14px 0 0;font-size:12px;color:#4a6571">Can’t make it? Cancel or reschedule in CampusCare so the slot can go to another patient.</p>' else '' end||
    '</td></tr>'||
    '<tr><td style="padding:16px 26px;background:#f6f9fb;border-top:1px solid #e3eaef;font-size:12px;line-height:1.6;color:#4a6571">'||
    '<strong style="color:#16262f">'||private.html_escape(coalesce(st.clinic_name,'CTU Main Medical & Dental Clinic'))||'</strong><br>'||
    'Ground Floor, Education Building, CTU Main Campus<br>'||private.html_escape(coalesce(st.contact_number,''))||' · '||private.html_escape(coalesce(st.contact_email,''))||'</td></tr>'||
    '</table>'||
    '<p style="max-width:560px;margin:14px auto 0;font-size:11px;line-height:1.5;color:#6b7f89;text-align:center">This is an automated CampusCare message. Please do not reply with medical information. For emergencies, go to the clinic or the nearest hospital.</p>'||
    '</td></tr></table></body></html>';

  v_text:='Hello '||v_first||E',\n\n'||n.title||E'\n\n'||v_intro||E'\n\n'||
    case when v_rows_text<>'' then v_rows_text else '' end||v_bring_text||
    E'\nOpen CampusCare: '||v_app||E'\n\n'||coalesce(st.clinic_name,'CTU Main Medical & Dental Clinic')||
    E'\nGround Floor, Education Building, CTU Main Campus\n'||coalesce(st.contact_number,'')||' · '||coalesce(st.contact_email,'');

  return query select ('CampusCare · '||left(n.title,230))::text, v_html, v_text;
end;
$$;

create or replace function public.queue_notification_email()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_email text; v_type text; r record;
begin
  v_type:=lower(coalesce(new.type,''));
  if v_type not in ('appointment','certificate','fitness','treatment','inventory','medication','account') then return new; end if;
  select nullif(btrim(u.email),'') into v_email from public.users u where u.user_id=new.user_id and u.status='Active';
  if v_email is null then return new; end if;
  select * into r from private.render_notification_email(new.notification_id);
  if r.subject is null then return new; end if;
  insert into public.email_outbox(user_id,notification_id,recipient_email,subject,html_body,text_body,template_key,status,scheduled_at)
  values(new.user_id,new.notification_id,v_email,r.subject,r.html_body,r.text_body,v_type,'Pending',greatest(coalesce(new.scheduled_at,now()),now()))
  on conflict(notification_id) do nothing;
  return new;
end;
$$;

-- Automatic reminders use the same title and wording as the "Send reminder" button.
create or replace function public.queue_campuscare_appointment_reminders()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_days integer:=1; v_today date; v_count integer;
begin
  select coalesce(max(appointment_reminder_days),1) into v_days from public.system_settings;
  v_days:=greatest(0,least(14,v_days));
  v_today:=(now() at time zone 'Asia/Manila')::date;
  insert into public.notifications(user_id,title,message,type,channel,is_read,scheduled_at,sent_at,delivery_status,reference_type,reference_id,action_page,notification_key)
  select p.user_id,'Appointment Reminder',
    coalesce(a.clinic,'Clinic')||' · '||to_char(a.appointment_date,'Dy, Mon FMDD, YYYY')||' at '||to_char(a.appointment_time,'FMHH12:MI AM')||
    case when coalesce(u.person_type,'Student') in ('Teaching Personnel','Non-Teaching Personnel') then '. Bring your Employee ID.'
      else '. Bring your signed COR for '||private.campuscare_semester_label(a.appointment_date)||' and your Student ID.' end,
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
$$;

revoke execute on function private.render_notification_email(bigint) from public, anon, authenticated;
revoke execute on function private.campuscare_semester_label(date) from public, anon, authenticated;

-- Re-render emails still waiting in the queue so they use the new layout; retired message emails are skipped.
update public.email_outbox o set subject=r.subject,html_body=r.html_body,text_body=r.text_body,updated_at=now()
  from public.notifications n, lateral private.render_notification_email(n.notification_id) r
 where o.status='Pending' and o.notification_id=n.notification_id and o.template_key<>'message' and r.subject is not null;
update public.email_outbox set status='Skipped',last_error='Secure messaging was retired.',updated_at=now()
 where status='Pending' and template_key='message';

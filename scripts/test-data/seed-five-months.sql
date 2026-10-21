-- Run as the project owner after supplying a private bcrypt hash with:
-- SELECT set_config('campuscare.sample_password_hash', '<bcrypt hash>', false);
-- A single transaction protects the import and restores booking validation before commit.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('CC-SAMPLE-5M-v1'));
CREATE TEMP TABLE sample_import_guard(value boolean) ON COMMIT DROP;
CREATE OR REPLACE FUNCTION pg_temp.track_sample(kind text, ident bigint, description text DEFAULT '') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
  VALUES(kind,ident,'CC-SAMPLE-5M-v1|'||description);
$$;
-- Historical imports need past dates. Only this date-integrity trigger is paused,
-- under an exclusive transaction lock; FK/check/unique constraints and RLS policies stay intact.
LOCK TABLE public.appointments IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.appointments DISABLE TRIGGER trg_validate_appointment_integrity;
DO $seed$
DECLARE
  batch text := 'CC-SAMPLE-5M-v1';
  today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  first_day date := ((now() AT TIME ZONE 'Asia/Manila')::date - interval '5 months')::date;
  password_hash text := current_setting('campuscare.sample_password_hash',true);
  uid bigint; pid bigint; aid bigint; tid bigint; rid bigint; authid uuid;
  medical bigint; dental bigint; staff_id bigint; sender bigint; receiver bigint;
  patient_ids bigint[] := '{}'; user_ids bigint[] := '{}'; available bigint[];
  item_ids bigint[] := '{}'; first_message bigint; issue_id bigint;
  i int; j int; m int; quota int; n int; used int; qty int; stock int;
  d date; registered date; ts timestamptz; doc bigint; clinic text; service text; diagnosis text; status text;
  username text; email text; person text; college text; role_name text; class_time text;
  unit_name text; rate numeric; estimate numeric;
BEGIN
  IF password_hash IS NULL OR password_hash !~ '^\$2[aby]\$' THEN RAISE EXCEPTION 'Supply a private bcrypt hash before seeding.'; END IF;
  IF EXISTS(SELECT 1 FROM public.presentation_sample_entities WHERE label LIKE batch||'|%') THEN RAISE EXCEPTION 'This sample batch already exists; use its cleanup script before reseeding.'; END IF;
  IF EXISTS(SELECT 1 FROM public.users existing WHERE existing.username LIKE 'ccsample.%') THEN RAISE EXCEPTION 'The sample namespace is already in use.'; END IF;
  -- The Auth trigger creates each linked public user/patient; no invitations or emails are sent.
  FOR i IN 1..35 LOOP
    role_name := CASE WHEN i=33 OR i=34 THEN 'Doctor' WHEN i=35 THEN 'Staff' ELSE 'Patient' END;
    username := CASE i WHEN 33 THEN 'ccsample.medical' WHEN 34 THEN 'ccsample.dental' WHEN 35 THEN 'ccsample.staff' ELSE 'ccsample.p'||lpad(i::text,2,'0') END;
    email := username||'@example.test';
    person := CASE WHEN i<=24 OR i BETWEEN 29 AND 32 THEN 'Student' WHEN i IN (25,26) THEN 'Teaching Personnel' ELSE 'Non-Teaching Personnel' END;
    college := CASE WHEN person IN ('Student','Teaching Personnel') THEN (ARRAY['CCICT','COE','COED','CME','CAS','COT'])[1+mod(i-1,6)] ELSE 'Clinic / Health Services' END;
    registered := CASE WHEN i IN (29,30) THEN today-3 WHEN i BETWEEN 13 AND 24 THEN first_day + (mod(i-13,5)||' months')::interval ELSE first_day-7 END;
    authid := gen_random_uuid();
    INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
    VALUES('00000000-0000-0000-0000-000000000000',authid,'authenticated','authenticated',email,password_hash,registered,'','','','',
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'sample_batch',batch),
      jsonb_build_object('first_name','Sample','last_name',CASE i WHEN 33 THEN 'Medical Doctor' WHEN 34 THEN 'Dentist' WHEN 35 THEN 'Clinic Staff' ELSE 'Patient '||lpad(i::text,2,'0') END,
        'username',username,'person_type',person,'college',college,'id_number',CASE WHEN person='Student' THEN (9900000+i)::text ELSE (99000+i)::text END,
        'registration_context','sample-import','verification_document_type','SAMPLE ID — not valid identification','birth_date',(date '2002-01-01'+i*37)::text,'sex',CASE WHEN mod(i,2)=0 THEN 'Female' ELSE 'Male' END,'address','SAMPLE address — not a real residence'),registered,now(),false,false);
    INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
    VALUES(authid::text,authid,jsonb_build_object('sub',authid::text,'email',email,'email_verified',true),'email',registered,now());
    SELECT user_id INTO STRICT uid FROM public.users WHERE auth_user_id=authid;
    SELECT patient_id INTO STRICT pid FROM public.patients WHERE user_id=uid;
    UPDATE public.users SET role=role_name,status=CASE WHEN i IN (29,30) THEN 'Pending' ELSE 'Active' END,
      verified=i NOT IN (29,30),created_at=registered,last_login_at=NULL,
      specialty=CASE i WHEN 33 THEN 'General Medicine' WHEN 34 THEN 'Dental' ELSE NULL END,
      work_days=CASE WHEN role_name='Doctor' THEN '["Mon","Tue","Wed","Thu","Fri"]'::jsonb ELSE '[]'::jsonb END,
      start_time=CASE WHEN role_name='Doctor' THEN time '08:00' END,end_time=CASE WHEN role_name='Doctor' THEN time '17:00' END,
      slot_duration=CASE WHEN role_name='Doctor' THEN 60 END,max_patients=CASE WHEN role_name='Doctor' THEN 20 END
    WHERE user_id=uid;
    PERFORM pg_temp.track_sample('users',uid,username);
    IF i<=32 THEN
      user_ids := array_append(user_ids,uid); patient_ids := array_append(patient_ids,pid);
      class_time := CASE WHEN person='Student' THEN (ARRAY['Morning','Evening','Mixed',NULL])[1+mod((i-1)/6,4)] END;
      UPDATE public.patients SET created_at=registered,class_session=class_time,blood_type=(ARRAY['O+','A+','B+','AB+','Unknown'])[1+mod(i,5)],height_cm=155+mod(i,25),weight_kg=48+mod(i,30),
        medical_history=CASE WHEN mod(i,5)=0 THEN 'SAMPLE history: prior asthma entry for UI testing only.' END,
        allergies=CASE WHEN mod(i,7)=0 THEN 'SAMPLE allergy entry — not clinical information.' END WHERE patient_id=pid;
      PERFORM pg_temp.track_sample('patients',pid,username);
    ELSE
      -- Clinic-only actors do not need accidental patient records from the signup trigger.
      DELETE FROM public.patients WHERE patient_id=pid;
      IF i=33 THEN medical:=uid; ELSIF i=34 THEN dental:=uid; ELSE staff_id:=uid; END IF;
    END IF;
    INSERT INTO public.privacy_consents(user_id,privacy_version,consented,consented_at,event_type,notes,created_at)
    VALUES(uid,'SAMPLE-v1',true,registered,'Sample Fixture','SAMPLE only: simulated consent, not a real person acknowledgement.',registered) RETURNING consent_id INTO rid;
    PERFORM pg_temp.track_sample('privacy_consents',rid,username);
  END LOOP;
  -- Varied weekday demand increases across the five-month period; slots are unique.
  FOR d IN SELECT day::date FROM generate_series(first_day::timestamp,(today-1)::timestamp,interval '1 day') day WHERE extract(isodow FROM day)<=5 LOOP
    m := (extract(year FROM age(d,first_day))*12+extract(month FROM age(d,first_day)))::int;
    quota := 2+least(4,m);
    SELECT array_agg(p.patient_id ORDER BY p.patient_id) INTO available FROM public.patients p JOIN public.users u USING(user_id)
      WHERE p.patient_id=ANY(patient_ids) AND u.status='Active' AND u.created_at::date<=d;
    FOR j IN 1..quota LOOP
      pid:=available[1+mod((d-first_day)*3+j,array_length(available,1))];
      doc:=CASE WHEN mod(j,2)=0 THEN dental ELSE medical END;clinic:=CASE WHEN doc=dental THEN 'Dental Clinic' ELSE 'Medical Clinic' END;
      service:=CASE WHEN doc=dental THEN (ARRAY['Dental Checkup','Oral Prophylaxis','Tooth Restoration'])[1+mod(j+m,3)] ELSE 'General Checkup' END;
      status:=CASE WHEN mod((d-first_day)+j,13)=0 THEN 'Cancelled' WHEN mod((d-first_day)+j,17)=0 THEN 'No-show' ELSE 'Completed' END;
      ts:=d+time '08:00';
      INSERT INTO public.appointments(patient_id,doctor_id,clinic,service,appointment_date,appointment_time,status,priority,reason,notes,created_by,created_at,cancelled_at,cancellation_reason)
      VALUES(pid,doc,clinic,service,d,(ARRAY[time '08:00',time '09:00',time '10:00',time '13:00',time '14:00',time '15:00'])[j],status,'Student','SAMPLE visit — synthetic testing only',batch,staff_id,ts-interval '2 days',CASE WHEN status='Cancelled' THEN ts-interval '1 day' END,CASE WHEN status='Cancelled' THEN 'SAMPLE cancellation scenario' END) RETURNING appointment_id INTO aid;
      PERFORM pg_temp.track_sample('appointments',aid,d::text);
      IF status='Completed' THEN
        diagnosis:=CASE WHEN doc=dental THEN (ARRAY['Dental caries','Gingivitis','Routine dental examination'])[1+mod(j+m,3)] ELSE CASE WHEN m>=3 AND mod(j,3)<>0 THEN 'Upper respiratory tract infection' ELSE (ARRAY['Headache','Fever','Minor abrasion'])[1+mod(j+m,3)] END END;
        INSERT INTO public.treatments(patient_id,doctor_id,appointment_id,examination_findings,diagnosis,prescription,clinical_notes,vitals,treatment_date,follow_up_date,created_at,status,archived_at,archived_by)
        VALUES(pid,doc,aid,'SAMPLE findings — not clinical information','SAMPLE — '||diagnosis,'SAMPLE entry; no medication instructions',batch,jsonb_build_object('bp','120/80','hr','76','temperature','36.7'),d,d+7,ts+interval '1 hour',CASE WHEN mod(aid,23)=0 THEN 'Archived' ELSE 'Active' END,CASE WHEN mod(aid,23)=0 THEN ts+interval '1 day' END,CASE WHEN mod(aid,23)=0 THEN staff_id END) RETURNING treatment_id INTO tid;
        PERFORM pg_temp.track_sample('treatments',tid,d::text);
        IF doc=dental THEN
          INSERT INTO public.dental_records(treatment_id,patient_id,dentist_user_id,dentist_name_snapshot,record_date,course_major,year_section,odontogram,oral_health,accomplishment,work_status,recommendation,created_at,updated_at)
          VALUES(tid,pid,dental,'Sample Dentist',d,'SAMPLE course','SAMPLE section','{"11":"S","16":"C"}',jsonb_build_object('fair',true),'[]','Completed','SAMPLE only — not a real dental record',ts+interval '1 hour',ts+interval '1 hour') RETURNING dental_record_id INTO rid;
          PERFORM pg_temp.track_sample('dental_records',rid,d::text);
          IF mod(aid,3)=0 THEN
            rate:=3+mod(j+m,3);
            INSERT INTO public.clinic_surveys(patient_id,appointment_id,clinic_type,group_type,department,service_availed,visit_frequency,heard_from,ratings,citizens_charter,sqd,suggestions,submitted_by,created_at)
            SELECT pid,aid,clinic,'Student',u.college,service,'First visit','CampusCare',jsonb_build_object('quality',rate,'accuracy',rate,'information',rate,'friendly',5,'services',rate,'overall',rate),' {"cc1":"1","cc2":"1","cc3":"1"}',jsonb_build_object('sqd0',rate,'sqd1',rate,'sqd2',rate,'sqd3',rate,'sqd4',rate,'sqd5',rate,'sqd6',rate,'sqd7',rate,'sqd8',rate),'SAMPLE survey response — not actual feedback',u.user_id,ts+interval '2 hours' FROM public.patients p JOIN public.users u USING(user_id) WHERE p.patient_id=pid RETURNING survey_id INTO rid;
            PERFORM pg_temp.track_sample('clinic_surveys',rid,d::text);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  -- Current queues and future booking actions complement the historical trend data.
  FOR i IN 1..12 LOOP
    doc:=CASE WHEN mod(i,2)=0 THEN dental ELSE medical END;
    -- Use three distinct business days so the queue matches the doctors' weekly rules.
    IF i>3 THEN
      SELECT day::date INTO d FROM generate_series((today+1)::timestamp,(today+10)::timestamp,interval '1 day') day WHERE extract(isodow FROM day)<=5 ORDER BY day OFFSET ((i-4)/3) LIMIT 1;
    ELSE d:=today; END IF;
    status:=CASE WHEN i<=3 THEN 'Completed' ELSE (ARRAY['Pending','Confirmed','Scheduled'])[1+mod(i,3)] END;
    IF status='Completed' THEN d:=today; END IF;
    INSERT INTO public.appointments(patient_id,doctor_id,clinic,service,appointment_date,appointment_time,status,reason,notes,created_by,created_at)
    VALUES(patient_ids[i],doc,CASE WHEN doc=dental THEN 'Dental Clinic' ELSE 'Medical Clinic' END,CASE WHEN doc=dental THEN 'Dental Checkup' ELSE 'General Checkup' END,d,(time '08:00'+mod(i,3)*interval '1 hour')::time,status,'SAMPLE current queue',batch,staff_id,now()) RETURNING appointment_id INTO rid;
    PERFORM pg_temp.track_sample('appointments',rid,'current queue');
  END LOOP;
  FOR i IN 1..8 LOOP
    unit_name:=CASE WHEN i<=3 THEN 'tablet' WHEN i<=5 THEN 'bottle' WHEN i=6 THEN 'box' ELSE 'piece' END;
    INSERT INTO public.inventory_items(item_name,category,quantity,threshold,unit,expiry_date,supplier,unit_cost,created_at,updated_at,archived,archived_at,archived_by)
    VALUES('SAMPLE — '||(ARRAY['Paracetamol','Cetirizine','Vitamin C','Oral rinse','Antiseptic','Gloves','Gauze','Archived supply'])[i],CASE WHEN i<=5 THEN 'Medicine' ELSE 'Supplies' END,0,25,unit_name,CASE WHEN i=2 THEN today-5 WHEN i=4 THEN today+7 ELSE today+180 END,'SAMPLE supplier',2+i*3,first_day,now(),i=8,CASE WHEN i=8 THEN now() END,CASE WHEN i=8 THEN staff_id END) RETURNING item_id INTO rid;
    item_ids:=array_append(item_ids,rid);PERFORM pg_temp.track_sample('inventory_items',rid,'stock');
    INSERT INTO public.inventory_transactions(item_id,transaction_type,quantity,transaction_date,notes,created_by) VALUES(rid,'Stock In',500,first_day,batch||' opening balance',staff_id) RETURNING transaction_id INTO uid;
    PERFORM pg_temp.track_sample('inventory_transactions',uid,'opening');
    FOR d IN SELECT day::date FROM generate_series(first_day::timestamp,(today-1)::timestamp,interval '3 days') day LOOP
      INSERT INTO public.inventory_transactions(item_id,transaction_type,quantity,transaction_date,notes,created_by)
      VALUES(rid,'Disbursement',2+mod(i+(d-first_day)/14,5),d+time '12:00',batch||' usage',staff_id) RETURNING transaction_id INTO uid;
      PERFORM pg_temp.track_sample('inventory_transactions',uid,d::text);
    END LOOP;
    -- Monthly restocks exercise stock-in history as well as consumption history.
    FOR d IN SELECT day::date FROM generate_series((date_trunc('month',first_day)+interval '1 month')::timestamp,date_trunc('month',today)::timestamp,interval '1 month') day LOOP
      INSERT INTO public.inventory_transactions(item_id,transaction_type,quantity,transaction_date,notes,created_by)
      VALUES(rid,'Stock In',30,d,batch||' monthly restock',staff_id) RETURNING transaction_id INTO uid;
      PERFORM pg_temp.track_sample('inventory_transactions',uid,'monthly restock');
    END LOOP;
    SELECT sum(CASE WHEN transaction_type='Stock In' THEN quantity ELSE -quantity END) INTO stock FROM public.inventory_transactions WHERE item_id=rid;
    IF i IN (1,2) THEN
      qty:=stock-CASE WHEN i=1 THEN 10 ELSE 0 END;
      INSERT INTO public.inventory_transactions(item_id,transaction_type,quantity,transaction_date,notes,created_by) VALUES(rid,CASE WHEN i=2 THEN 'Expired' ELSE 'Adjustment' END,qty,today-1,batch||' documented sample stock reduction',staff_id) RETURNING transaction_id INTO uid;
      PERFORM pg_temp.track_sample('inventory_transactions',uid,'reduction');stock:=stock-qty;
    END IF;
    UPDATE public.inventory_items SET quantity=stock WHERE item_id=rid;
    IF i<=5 THEN
      SELECT sum(quantity)/60.0 INTO rate FROM public.inventory_transactions WHERE item_id=rid AND transaction_type='Disbursement' AND transaction_date::date>=today-60;
      FOR m IN 1..3 LOOP
        estimate:=round(rate*30);
        INSERT INTO public.inventory_forecasts(item_id,forecast_month,predicted_usage,predicted_remaining_stock,predicted_stockout_date,recommended_reorder_qty)
        VALUES(rid,(date_trunc('month',today)+(m||' months')::interval)::date,estimate,greatest(0,stock-m*estimate),CASE WHEN rate>0 AND stock>0 THEN today+ceil(stock/rate)::int END,greatest(0,ceil(m*estimate+25-stock))::int) RETURNING forecast_id INTO uid;
        PERFORM pg_temp.track_sample('inventory_forecasts',uid,'calculated from sample usage');
      END LOOP;
    END IF;
  END LOOP;
  -- Certificates are unmistakably watermarked and do not carry a real signature.
  FOR i IN 1..20 LOOP
    status:=(ARRAY['Pending','Awaiting Signature','Issued','Declined','Cancelled'])[1+mod(i-1,5)];
    d:=CASE WHEN status IN ('Pending','Awaiting Signature') THEN today-1 ELSE first_day+(i*6) END;
    INSERT INTO public.medical_certificates(patient_id,doctor_id,purpose,request_details,examination_findings,diagnosis,remarks,document_content,status,requested_at,created_at,certificate_no,issued_at,prepared_by,prepared_at,signed_by,signed_at,decline_reason)
    VALUES(patient_ids[i],medical,'SAMPLE — school requirement','SAMPLE request, not a real certification','SAMPLE findings','SAMPLE examination','TEST ONLY — not valid for official use','<h1>SAMPLE — NOT VALID</h1><p>Fictional document for CampusCare testing. This is not a medical certificate.</p>',status,d,d,'SAMPLE-MC-'||lpad(i::text,4,'0'),CASE WHEN status='Issued' THEN d+time '12:00' END,CASE WHEN status IN ('Issued','Awaiting Signature') THEN staff_id END,CASE WHEN status IN ('Issued','Awaiting Signature') THEN d+time '10:00' END,CASE WHEN status='Issued' THEN medical END,CASE WHEN status='Issued' THEN d+time '11:00' END,CASE WHEN status='Declined' THEN 'SAMPLE declined request' END) RETURNING certificate_id INTO rid;
    PERFORM pg_temp.track_sample('medical_certificates',rid,status);
  END LOOP;
  FOR i IN 1..20 LOOP
    status:=(ARRAY['Requested','In Assessment','Completed','Cancelled'])[1+mod(i-1,4)];d:=CASE WHEN status IN ('Requested','In Assessment') THEN today-1 ELSE first_day+i*6 END;
    INSERT INTO public.fitness_assessments(patient_id,doctor_id,sport_event,event_date,assessment_date,vitals,medical_history,examination_findings,decision,restrictions,status,requested_at,completed_at,request_notes)
    VALUES(patient_ids[i],medical,'SAMPLE Intramurals',CASE WHEN status='Completed' THEN d+7 ELSE today+14 END,CASE WHEN status='Completed' THEN d END,'{"bp":"120/80","hr":"76","height":"165","weight":"60"}','SAMPLE only','SAMPLE examination — not real clearance',CASE WHEN status='Completed' THEN (ARRAY['Fit to Compete','Fit with Restrictions','Not Fit to Compete'])[1+mod(i/4,3)] END,'SAMPLE restrictions entry',status,d,CASE WHEN status='Completed' THEN d+time '12:00' END,batch) RETURNING assessment_id INTO rid;
    PERFORM pg_temp.track_sample('fitness_assessments',rid,status);
  END LOOP;
  FOR i IN 1..10 LOOP
    INSERT INTO public.medication_reminders(patient_id,medication,dosage,frequency,times_of_day,start_date,end_date,active,created_at)
    VALUES(patient_ids[i],'SAMPLE medication reminder','TEST ONLY — no real dose','Sample schedule','["08:00","20:00"]',CASE WHEN i<=5 THEN today-2 ELSE first_day+i*3 END,CASE WHEN i<=5 THEN today+5 ELSE first_day+i*3+5 END,i<=5,first_day+i*3) RETURNING reminder_id INTO rid;
    PERFORM pg_temp.track_sample('medication_reminders',rid,'sample schedule');
  END LOOP;
  FOR i IN 1..25 LOOP
    sender:=CASE WHEN mod(i,2)=0 THEN staff_id ELSE user_ids[1+mod(i,8)] END;receiver:=CASE WHEN sender=staff_id THEN user_ids[1+mod(i,8)] ELSE staff_id END;
    INSERT INTO public.messages(from_user_id,to_user_id,subject,body,is_read,created_at) VALUES(sender,receiver,'SAMPLE conversation',batch||' — Sample message '||i||'. This is fictional test content.',mod(i,3)<>0,first_day+i*5+time '09:00') RETURNING message_id INTO rid;
    IF i=1 THEN first_message:=rid; END IF;PERFORM pg_temp.track_sample('messages',rid,'conversation');
  END LOOP;
  INSERT INTO public.message_hidden(message_id,user_id) VALUES(first_message,user_ids[2]);
  -- Small workflow queues cover each request type without editing existing accounts/schedules.
  FOR i IN 1..9 LOOP
    status:=(ARRAY['Pending','Applied','Rejected'])[1+mod(i-1,3)];
    INSERT INTO public.workflow_requests(request_type,requester_id,target_user_id,payload,reason,effective_date,status,admin_note,created_at)
    VALUES(CASE WHEN i<=3 THEN 'Name Change' WHEN i<=6 THEN 'Schedule Change' ELSE 'Day Off' END,
      CASE WHEN i<=3 THEN user_ids[i] ELSE medical END,CASE WHEN i<=3 THEN user_ids[i] ELSE medical END,
      CASE WHEN i<=3 THEN '{"current":{"firstName":"Sample","lastName":"Patient"},"requested":{"firstName":"Sample","lastName":"Updated"}}'::jsonb WHEN i<=6 THEN '{"current":{"startTime":"08:00","endTime":"17:00","slotDuration":60,"maxPatients":20,"workDays":["Mon","Tue","Wed","Thu","Fri"]},"requested":{"startTime":"09:00","endTime":"16:00","slotDuration":60,"maxPatients":15,"workDays":["Mon","Tue","Wed","Thu","Fri"]}}'::jsonb ELSE jsonb_build_object('leaveDate',(today+10)::text) END,
      'SAMPLE workflow request',CASE WHEN status='Pending' THEN today+10 ELSE first_day+i*4 END,status,'SAMPLE status scenario; not a real approval',first_day+i*4) RETURNING request_id INTO rid;
    PERFORM pg_temp.track_sample('workflow_requests',rid,status);
  END LOOP;
  FOR i IN 0..6 LOOP
    INSERT INTO public.doctor_schedule_rules(doctor_id,weekday,is_working,start_time,end_time,slot_duration,max_patients,effective_from,created_by)
    VALUES(medical,i,i BETWEEN 1 AND 5,CASE WHEN i BETWEEN 1 AND 5 THEN time '08:00' END,CASE WHEN i BETWEEN 1 AND 5 THEN time '17:00' END,60,20,first_day,staff_id) RETURNING rule_id INTO rid;
    PERFORM pg_temp.track_sample('doctor_schedule_rules',rid,'medical weekly schedule');
    INSERT INTO public.doctor_schedule_rules(doctor_id,weekday,is_working,start_time,end_time,slot_duration,max_patients,effective_from,created_by)
    VALUES(dental,i,i BETWEEN 1 AND 5,CASE WHEN i BETWEEN 1 AND 5 THEN time '08:00' END,CASE WHEN i BETWEEN 1 AND 5 THEN time '17:00' END,60,20,first_day,staff_id) RETURNING rule_id INTO rid;
    PERFORM pg_temp.track_sample('doctor_schedule_rules',rid,'dental weekly schedule');
  END LOOP;
  INSERT INTO public.doctor_leaves(doctor_id,leave_date,reason) VALUES(dental,today+14,'SAMPLE day-off entry') RETURNING leave_id INTO rid;PERFORM pg_temp.track_sample('doctor_leaves',rid,'day off');
  INSERT INTO public.appointment_slot_overrides(doctor_id,override_date,slot_time,is_available,reason,modified_by) VALUES(medical,today+14,'14:00',false,'SAMPLE blocked slot',staff_id) RETURNING override_id INTO rid;PERFORM pg_temp.track_sample('appointment_slot_overrides',rid,'blocked slot');
  FOR i IN 1..4 LOOP
    status:=(ARRAY['Open','In Review','Resolved','Dismissed'])[i];
    INSERT INTO public.issue_reports(reporter_id,issue_type,page_affected,description,status,admin_note,created_at)
    VALUES(user_ids[i],(ARRAY['Bug','Suggestion','Feedback'])[1+mod(i,3)],'SAMPLE testing',batch||' — Sample issue '||i,status,'SAMPLE entry — fictional feedback',first_day+i*20) RETURNING public.issue_reports.issue_id INTO issue_id;
    PERFORM pg_temp.track_sample('issue_reports',issue_id,status);
    INSERT INTO public.issue_replies(issue_id,author_id,body,created_at) VALUES(issue_id,user_ids[i],batch||' — Sample follow-up reply.',first_day+i*20+1) RETURNING reply_id INTO rid;
    PERFORM pg_temp.track_sample('issue_replies',rid,'reply');
  END LOOP;
  FOR i IN 1..3 LOOP
    INSERT INTO public.health_resources(title,category,content,author_id,published_at,teaser,source_name,created_at,archived_at)
    VALUES('SAMPLE — Resource preview '||i,'SAMPLE','This is fictional content for testing resource display and editing. It is not health advice.',staff_id,first_day+i*20,'SAMPLE content only','CampusCare test dataset',first_day+i*20,CASE WHEN i=3 THEN now() END) RETURNING resource_id INTO rid;
    PERFORM pg_temp.track_sample('health_resources',rid,'preview');
    INSERT INTO public.user_drafts(user_id,module,draft_key,payload) VALUES(user_ids[i],'patient','sample-draft-'||i,jsonb_build_object('sample_batch',batch,'notes','SAMPLE unsent draft')) RETURNING draft_id INTO rid;
    PERFORM pg_temp.track_sample('user_drafts',rid,'unsent draft');
    INSERT INTO public.form_drafts(user_id,draft_type,record_key,title,payload) VALUES(staff_id,'treatment','sample-'||i,'SAMPLE unsent treatment draft',jsonb_build_object('sample_batch',batch)) RETURNING draft_id INTO rid;
    PERFORM pg_temp.track_sample('form_drafts',rid,'unsent draft');
  END LOOP;
  FOR i IN 1..32 LOOP
    INSERT INTO public.uat_test_results(case_key,title,role_name,device,status,notes)
    VALUES('CC-SAMPLE-'||i,'SAMPLE — '||(ARRAY['Login / logout','Patient Records','Appointments','Approval Queue','Certificates','Treatments / dental chart','Fitness Assessments','Inventory','Messages / attachments','User Management','Surveys','Reports / export','Forecast','Feedback / replies','Schedules / leave','Privacy / drafts'])[1+mod(i-1,16)]||' manual check',(ARRAY['Patient','Doctor','Staff','Administrator'])[1+mod((i-1)/4,4)],CASE WHEN mod(i,2)=0 THEN 'Mobile' ELSE 'Desktop' END,'Not Tested','Seeded checklist only; this does not mean the test passed.') RETURNING result_id INTO rid;
    PERFORM pg_temp.track_sample('uat_test_results',rid,'not yet tested');
  END LOOP;
  -- Queue examples are in-app only. Trigger-created outbox rows are marked Skipped
  -- before this transaction becomes visible to the email dispatcher.
  INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
  SELECT 'notifications',n.notification_id,batch||'|issue notification' FROM public.notifications n
    WHERE n.reference_type='issue_reports' AND n.reference_id IN(SELECT entity_id FROM public.presentation_sample_entities WHERE entity_type='issue_reports' AND label LIKE batch||'|%');
  FOR i IN 1..12 LOOP
    INSERT INTO public.notifications(user_id,title,message,type,channel,is_read,delivery_status,action_page,notification_key,created_at)
    VALUES(CASE WHEN mod(i,2)=0 THEN staff_id ELSE user_ids[1] END,'SAMPLE notification '||i,batch||' — Fictional in-app notice','Sample','In-app',mod(i,3)=0,'Created',CASE WHEN mod(i,2)=0 THEN 'inventory' ELSE 'my-appointments' END,batch||'-'||i,first_day+i*8) RETURNING notification_id INTO rid;
    PERFORM pg_temp.track_sample('notifications',rid,'in-app sample');
  END LOOP;
  UPDATE public.email_outbox SET status='Skipped',last_error='SAMPLE import: external delivery intentionally disabled',updated_at=now()
    WHERE notification_id IN(SELECT entity_id FROM public.presentation_sample_entities WHERE entity_type='notifications' AND label LIKE batch||'|%');
  INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
    SELECT 'email_outbox',email_id,batch||'|not sent' FROM public.email_outbox WHERE notification_id IN(SELECT entity_id FROM public.presentation_sample_entities WHERE entity_type='notifications' AND label LIKE batch||'|%');
  INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
    SELECT 'audit_logs',audit_id,batch||'|sample issue lifecycle' FROM public.audit_logs WHERE entity_type='issue_reports' AND entity_id IN(SELECT entity_id FROM public.presentation_sample_entities WHERE entity_type='issue_reports' AND label LIKE batch||'|%');
  INSERT INTO public.audit_logs(user_id,action,entity_type,details) VALUES(staff_id,'SAMPLE_DATA_IMPORTED','sample_batch',jsonb_build_object('batch',batch,'from',first_day,'to',today-1,'synthetic',true)) RETURNING audit_id INTO rid;
  PERFORM pg_temp.track_sample('audit_logs',rid,'import marker');
  -- Final status edge cases are applied after their legitimate historical visits.
  UPDATE public.users SET status='Suspended' WHERE user_id=user_ids[31];
  UPDATE public.users SET status='Archived',verified=false WHERE user_id=user_ids[32];
  UPDATE public.patients SET archived_at=now(),archived_previous_user_status='Active' WHERE patient_id=patient_ids[32];
  -- Restore the exact integrity rules: only dates were imported historically.
  IF EXISTS(SELECT 1 FROM public.appointments a JOIN public.presentation_sample_entities e ON e.entity_type='appointments' AND e.entity_id=a.appointment_id WHERE e.label LIKE batch||'|%' AND (a.doctor_id NOT IN(medical,dental) OR a.patient_id<>ALL(patient_ids))) THEN RAISE EXCEPTION 'Unexpected appointment relationship'; END IF;
END;
$seed$;
ALTER TABLE public.appointments ENABLE TRIGGER trg_validate_appointment_integrity;
SELECT entity_type,count(*) AS sample_records FROM public.presentation_sample_entities WHERE label LIKE 'CC-SAMPLE-5M-v1|%' GROUP BY entity_type ORDER BY entity_type;
COMMIT;

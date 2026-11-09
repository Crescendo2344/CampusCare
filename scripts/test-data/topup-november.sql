-- Top up the test batch for testing from November 5, 2026 onward (Asia/Manila).
-- Adds today's and upcoming bookings, a doctor day off, a blocked slot, urgent issues, and moves
-- pending requests to future dates. Every new row is tracked under CC-SAMPLE-5M-v1|topup-2026-11
-- so scripts/test-data/cleanup-five-months.sql removes it with the rest of the batch.
-- Only test people take part; real accounts get no bookings or requests.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('CC-SAMPLE-5M-v1'));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.presentation_sample_entities WHERE label='CC-SAMPLE-5M-v1|topup-2026-11')
  THEN RAISE EXCEPTION 'The November top-up was already loaded.'; END IF;
END $$;

-- Bookings: medical with Dr. Ramon Villareal (118), dental with Dr. Katherine Uy (119) and Dr. Jilt Sanchez (4).
-- Lunch (12:00) is skipped; personnel bookings carry no student priority.
WITH v(patient_id,doctor_id,clinic,service,d,t,status,reason) AS (VALUES
  (90,118,'Medical Clinic','General Checkup','2026-11-05','09:00','Confirmed','Fever since yesterday'),
  (96,118,'Medical Clinic','General Checkup','2026-11-05','10:00','Confirmed','Cough and colds for 3 days'),
  (110,118,'Medical Clinic','General Checkup','2026-11-05','14:00','Scheduled','Follow-up check-up'),
  (95,119,'Dental Clinic','Dental Checkup','2026-11-05','15:00','Confirmed','Routine dental check-up'),
  (86,118,'Medical Clinic','General Checkup','2026-11-06','08:00','Scheduled','Medical check-up for OJT'),
  (93,118,'Medical Clinic','General Checkup','2026-11-06','09:00','Confirmed','Recurring headache'),
  (104,118,'Medical Clinic','General Checkup','2026-11-06','13:00','Pending','Stomach ache'),
  (97,119,'Dental Clinic','Oral Prophylaxis','2026-11-06','10:00','Scheduled','Teeth cleaning'),
  (99,118,'Medical Clinic','General Checkup','2026-11-09','10:00','Pending','Fever and body pain'),
  (88,4,'Dental Clinic','Dental Checkup','2026-11-09','09:00','Pending','Routine dental check-up'),
  (102,118,'Medical Clinic','General Checkup','2026-11-10','09:00','Scheduled','Medical check-up for OJT'),
  (109,119,'Dental Clinic','Tooth Restoration','2026-11-11','14:00','Pending','Toothache on a lower molar'),
  (91,4,'Dental Clinic','Oral Prophylaxis','2026-11-12','10:00','Scheduled','Teeth cleaning'),
  (112,118,'Medical Clinic','General Checkup','2026-11-12','15:00','Pending','Blood pressure check')
), ins AS (
  INSERT INTO public.appointments(patient_id,doctor_id,clinic,service,appointment_date,appointment_time,status,priority,reason,created_by)
  SELECT v.patient_id,v.doctor_id,v.clinic,v.service,v.d::date,v.t::time,v.status,
    CASE WHEN u.person_type='Student' THEN 'Student' END,v.reason,p.user_id
  FROM v JOIN public.patients p ON p.patient_id=v.patient_id JOIN public.users u ON u.user_id=p.user_id
  RETURNING appointment_id
)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label) SELECT 'appointments',appointment_id,'CC-SAMPLE-5M-v1|topup-2026-11' FROM ins;

-- A booking the patient cancelled ahead of time.
WITH ins AS (
  INSERT INTO public.appointments(patient_id,doctor_id,clinic,service,appointment_date,appointment_time,status,priority,reason,created_by,cancelled_at,cancellation_reason)
  VALUES (105,118,'Medical Clinic','General Checkup','2026-11-10','11:00','Cancelled','Student','Cough and colds',105,now(),'Class schedule conflict') RETURNING appointment_id
)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label) SELECT 'appointments',appointment_id,'CC-SAMPLE-5M-v1|topup-2026-11' FROM ins;

-- Availability: a day off next week and one blocked slot.
WITH ins AS (INSERT INTO public.doctor_leaves(doctor_id,leave_date,reason) VALUES (119,'2026-11-13','Attending a dental seminar in Cebu City') RETURNING leave_id)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label) SELECT 'doctor_leaves',leave_id,'CC-SAMPLE-5M-v1|topup-2026-11' FROM ins;
WITH ins AS (INSERT INTO public.appointment_slot_overrides(doctor_id,override_date,slot_time,is_available,reason,modified_by) VALUES (118,'2026-11-10','10:00',false,'Clinic staff meeting',1) RETURNING override_id)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label) SELECT 'appointment_slot_overrides',override_id,'CC-SAMPLE-5M-v1|topup-2026-11' FROM ins;

-- Pending requests point at future dates so they can still be approved.
UPDATE public.workflow_requests w SET effective_date='2026-11-20',payload=jsonb_set(w.payload,'{leaveDate}','"2026-11-20"')
FROM public.presentation_sample_entities e WHERE e.entity_type='workflow_requests' AND e.entity_id=w.request_id AND w.status='Pending' AND w.request_type='Day Off';
UPDATE public.workflow_requests w SET effective_date='2026-11-16'
FROM public.presentation_sample_entities e WHERE e.entity_type='workflow_requests' AND e.entity_id=w.request_id AND w.status='Pending' AND w.request_type='Schedule Change';
UPDATE public.workflow_requests w SET effective_date='2026-11-05'
FROM public.presentation_sample_entities e WHERE e.entity_type='workflow_requests' AND e.entity_id=w.request_id AND w.status='Pending' AND w.request_type='Name Change';

-- Inventory: the mouthwash now expires within 90 days (balances are unchanged).
UPDATE public.inventory_items i SET expiry_date='2027-01-20'
FROM public.presentation_sample_entities e WHERE e.entity_type='inventory_items' AND e.entity_id=i.item_id AND i.item_name='Chlorhexidine 0.12% Mouthwash';

-- Feedback: two open problems that need attention first.
WITH v(reporter,page,descr,prio,ago) AS (VALUES
  (92,'Appointments','After booking, the confirmation screen shows the wrong clinic name on my phone.','High',interval '3 hours'),
  (113,'Login','I cannot log in since this morning. It keeps saying my session expired.','Urgent',interval '40 minutes')
), ins AS (
  INSERT INTO public.issue_reports(reporter_id,issue_type,page_affected,description,status,priority,device_info,created_at,updated_at)
  SELECT reporter,'Bug',page,descr,'Open',prio,'Android phone · Chrome',now()-ago,now()-ago FROM v RETURNING issue_id
)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label) SELECT 'issue_reports',issue_id,'CC-SAMPLE-5M-v1|topup-2026-11' FROM ins;
-- Track what the issue trigger created so cleanup can remove it too.
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
SELECT 'notifications',n.notification_id,'CC-SAMPLE-5M-v1|topup-2026-11' FROM public.notifications n
WHERE n.reference_type='issue_reports' AND n.created_at=now();
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
SELECT 'audit_logs',a.audit_id,'CC-SAMPLE-5M-v1|topup-2026-11' FROM public.audit_logs a
WHERE a.action='ISSUE_REPORT_CREATED' AND a.created_at=now();

-- Nothing from this top-up may ever be emailed.
WITH skipped AS (
  UPDATE public.email_outbox o SET status='Skipped',last_error='Test data: never sent.',updated_at=now()
  WHERE o.created_at=now() AND o.status IN ('Pending','Sending') RETURNING o.email_id
)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label) SELECT 'email_outbox',email_id,'CC-SAMPLE-5M-v1|topup-2026-11' FROM skipped;
COMMIT;

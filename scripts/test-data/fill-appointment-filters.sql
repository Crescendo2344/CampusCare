-- Fill every Appointments filter with test patients (loaded November 18, 2026, Asia/Manila).
-- For both the Medical and Dental Clinic, every status (Scheduled, Completed, Cancelled, No-show)
-- gets patients from every college (Morning and Evening class), teaching personnel and every
-- non-teaching department, spread across every doctor. Scheduled bookings are upcoming (from Nov 19);
-- the other outcomes are on past weekdays.
-- Only fictional test patients take part. Real doctors only receive bookings from test patients.
-- Thirteen fictional non-teaching personnel (one per department that had no patient) are added as
-- sign-in-less patient records. Everything is tracked as CC-SAMPLE-5M-v1|filters-2026-11-18, so
-- scripts/test-data/cleanup-five-months.sql removes it with the rest of the batch.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('CC-SAMPLE-5M-v1'));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.presentation_sample_entities WHERE label='CC-SAMPLE-5M-v1|filters-2026-11-18')
  THEN RAISE EXCEPTION 'The appointment filter top-up was already loaded.'; END IF;
END $$;

-- 1. One fictional patient for each non-teaching department (no sign-in account).
CREATE TEMP TABLE fill_dept ON COMMIT DROP AS
SELECT * FROM (VALUES
  (1,'Administration','Ernesto','Pacquiao','Male','1979-03-14'),
  (2,'Registrar','Maricel','Durano','Female','1984-07-02'),
  (3,'Finance / Accounting','Gilbert','Sanchez-Lim','Male','1981-11-23'),
  (4,'Human Resources','Teresita','Alfafara','Female','1977-01-30'),
  (5,'Procurement / Supply','Romeo','Yap','Male','1986-05-17'),
  (6,'Library','Leonora','Borromeo','Female','1974-09-09'),
  (7,'ICT / MIS','Jayson','Cabrera','Male','1992-12-04'),
  (8,'Student Affairs','Rowena','Escario','Female','1988-02-26'),
  (9,'Guidance Services','Ma. Luisa','Tecson','Female','1983-08-11'),
  (10,'Research / Extension','Eduardo','Remolador','Male','1975-04-05'),
  (11,'Facilities / Maintenance','Danilo','Gonzaga','Male','1980-10-19'),
  (12,'Security Services','Reynaldo','Tampus','Male','1978-06-28'),
  (13,'Janitorial / Cleaning Services','Nenita','Alcover','Female','1972-03-08')
) v(n,dept,fname,lname,sex,birth);

CREATE TEMP TABLE fill_users ON COMMIT DROP AS
WITH ins AS (
  INSERT INTO public.users(first_name,last_name,username,role,email,contact_number,status,person_type,college,id_number,verified,created_at)
  SELECT d.fname,d.lname,'ccsample.dept'||lpad(d.n::text,2,'0'),'Patient','ccsample.dept'||lpad(d.n::text,2,'0')||'@example.test',
    '0999555'||lpad((100+d.n)::text,4,'0'),'Active','Non-Teaching Personnel',d.dept,(20600+d.n)::text,true,now()-interval '60 days'
  FROM fill_dept d RETURNING user_id,username
) SELECT * FROM ins;
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
SELECT 'users',user_id,'CC-SAMPLE-5M-v1|filters-2026-11-18' FROM fill_users;

WITH ins AS (
  INSERT INTO public.patients(user_id,birth_date,sex,address,emergency_contact_name,emergency_contact_number,created_at)
  SELECT u.user_id,d.birth::date,d.sex,'Brgy. Lahug, Cebu City','Family contact','09995559'||lpad(d.n::text,3,'0'),now()-interval '60 days'
  FROM fill_users u JOIN fill_dept d ON u.username='ccsample.dept'||lpad(d.n::text,2,'0')
  RETURNING patient_id
)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
SELECT 'patients',patient_id,'CC-SAMPLE-5M-v1|filters-2026-11-18' FROM ins;

-- 2. Who takes part: a Morning and an Evening student from each college, both teaching personnel,
--    and one non-teaching patient per department (28 people).
CREATE TEMP TABLE fill_roster ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY p.patient_id) AS r,p.patient_id,u.user_id,u.person_type
FROM public.patients p JOIN public.users u ON u.user_id=p.user_id
WHERE p.archived_at IS NULL AND u.status='Active' AND u.role='Patient'
  AND (u.username IN ('carlo.mendoza','andrea.villanueva','miguel.ramos','patricia.navarro','joshua.delacruz','kristine.bautista',
                      'paolo.garcia','angelica.reyes','johnrey.abellana','marygrace.cabahug','kenneth.ouano','shielamae.pepito',
                      'ronaldo.villacorta','liza.montecillo','antonio.cabatingan')
       OR u.username LIKE 'ccsample.dept%');
DO $$ BEGIN
  IF (SELECT count(*) FROM fill_roster)<>28 THEN RAISE EXCEPTION 'Expected 28 test patients, found %.',(SELECT count(*) FROM fill_roster); END IF;
END $$;

-- 3. One booking per person, clinic and status, rotated across that clinic's doctors.
CREATE TEMP TABLE fill_rows ON COMMIT DROP AS
SELECT r.patient_id,r.user_id,r.person_type,c.clinic,s.status,s.ord,
  CASE WHEN c.clinic='Medical Clinic' THEN (ARRAY[118,130])[1+((r.r+s.ord)%2)]
       ELSE (ARRAY[119,4,7])[1+((r.r+s.ord)%3)] END AS doctor_id,
  CASE WHEN s.status='Scheduled' THEN 'future' ELSE 'past' END AS dir,
  (r.r*7+s.ord*3)::int AS pick
FROM fill_roster r
CROSS JOIN (VALUES ('Medical Clinic'),('Dental Clinic')) c(clinic)
CROSS JOIN (VALUES ('Scheduled',0),('Completed',1),('Cancelled',2),('No-show',3)) s(status,ord);

-- 4. Free slots: weekdays only, no lunch hour, dental from 9:00, no holidays/Christmas break,
--    no doctor day off, blocked slot or existing live booking. Every third free slot is used so
--    each day keeps room for real bookings.
CREATE TEMP TABLE fill_slots ON COMMIT DROP AS
WITH doc AS (SELECT * FROM (VALUES (118,'Medical Clinic'),(130,'Medical Clinic'),(119,'Dental Clinic'),(4,'Dental Clinic'),(7,'Dental Clinic')) d(doctor_id,clinic)),
cand AS (
  SELECT doc.doctor_id,day::date AS d,t::time AS t,
    CASE WHEN day::date>'2026-11-18' THEN 'future' ELSE 'past' END AS dir
  FROM doc
  CROSS JOIN generate_series('2026-10-19'::date,'2027-01-29'::date,interval '1 day') day
  CROSS JOIN unnest(ARRAY['08:00','09:00','10:00','11:00','13:00','14:00','15:00','16:00']) t
  WHERE extract(isodow FROM day) BETWEEN 1 AND 5 AND day::date<>'2026-11-18'
    AND NOT (doc.clinic='Dental Clinic' AND t='08:00')
    AND day::date NOT IN ('2026-11-01','2026-11-02','2026-11-30','2026-12-08')
    AND NOT (day::date BETWEEN '2026-12-21' AND '2027-01-03')
), free AS (
  SELECT c.* FROM cand c
  WHERE NOT EXISTS(SELECT 1 FROM public.appointments a WHERE a.doctor_id=c.doctor_id AND a.appointment_date=c.d AND a.appointment_time=c.t AND a.status<>'Cancelled')
    AND NOT EXISTS(SELECT 1 FROM public.doctor_leaves l WHERE l.doctor_id=c.doctor_id AND l.leave_date=c.d)
    AND NOT EXISTS(SELECT 1 FROM public.appointment_slot_overrides o WHERE o.doctor_id=c.doctor_id AND o.override_date=c.d AND o.slot_time=c.t AND NOT o.is_available)
), ranked AS (
  SELECT f.*,row_number() OVER (PARTITION BY doctor_id,dir ORDER BY CASE WHEN dir='future' THEN d END,CASE WHEN dir='past' THEN d END DESC,t) AS rn FROM free f
)
SELECT doctor_id,dir,d,t,row_number() OVER (PARTITION BY doctor_id,dir ORDER BY rn) AS n FROM ranked WHERE rn%3=1;

CREATE TEMP TABLE fill_final ON COMMIT DROP AS
WITH numbered AS (
  SELECT f.*,row_number() OVER (PARTITION BY doctor_id,dir ORDER BY pick,patient_id,clinic) AS n FROM fill_rows f
)
SELECT nb.*,s.d,s.t FROM numbered nb JOIN fill_slots s USING(doctor_id,dir,n);
DO $$ BEGIN
  IF (SELECT count(*) FROM fill_final)<>(SELECT count(*) FROM fill_rows) THEN RAISE EXCEPTION 'Not enough free slots.'; END IF;
END $$;

-- 5. Insert. Past outcomes need the past-date check paused inside this locked transaction; it is
--    restored before commit. Doctor/patient validity is checked explicitly instead.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM fill_final f JOIN public.users u ON u.user_id=f.doctor_id WHERE u.role<>'Doctor' OR u.status<>'Active')
  THEN RAISE EXCEPTION 'An assigned doctor is not active.'; END IF;
END $$;
LOCK TABLE public.appointments IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.appointments DISABLE TRIGGER trg_validate_appointment_integrity;
WITH ins AS (
  INSERT INTO public.appointments(patient_id,doctor_id,clinic,service,appointment_date,appointment_time,status,priority,reason,notes,
    created_by,created_at,cancelled_at,cancellation_reason)
  SELECT f.patient_id,f.doctor_id,f.clinic,
    CASE WHEN f.clinic='Medical Clinic' THEN (ARRAY['General Checkup','Consultation','Follow-up','Physical Exam'])[1+(f.pick%4)]
         ELSE (ARRAY['Dental Checkup','Oral Prophylaxis','Tooth Restoration','Tooth Extraction'])[1+(f.pick%4)] END,
    f.d,f.t,f.status,
    CASE WHEN f.person_type='Student' THEN 'Student' END,
    CASE WHEN f.clinic='Medical Clinic' THEN (ARRAY['Fever since yesterday','Cough and colds for 3 days','Recurring headache','Medical check-up for OJT','Stomach ache','Blood pressure check','Allergy rashes on both arms'])[1+(f.pick%7)]
         ELSE (ARRAY['Routine dental check-up','Teeth cleaning','Toothache on a lower molar','Bleeding gums when brushing','Sensitive front teeth','Broken filling'])[1+(f.pick%6)] END,
    CASE f.status WHEN 'No-show' THEN 'Patient did not arrive.' END,
    f.user_id,
    CASE WHEN f.dir='future' THEN now()-interval '1 day'*(1+f.pick%4) ELSE (f.d - (3+f.pick%5))::timestamp AT TIME ZONE 'Asia/Manila' END,
    CASE WHEN f.status='Cancelled' THEN (f.d - 1)::timestamp AT TIME ZONE 'Asia/Manila' + interval '15 hours' END,
    CASE WHEN f.status='Cancelled' THEN (ARRAY['Class schedule conflict','Feeling better already','Family emergency','Out of town'])[1+(f.pick%4)] END
  FROM fill_final f
  RETURNING appointment_id
)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
SELECT 'appointments',appointment_id,'CC-SAMPLE-5M-v1|filters-2026-11-18' FROM ins;
ALTER TABLE public.appointments ENABLE TRIGGER trg_validate_appointment_integrity;

-- Nothing from this top-up may ever be emailed.
WITH skipped AS (
  UPDATE public.email_outbox o SET status='Skipped',last_error='Test data: never sent.',updated_at=now()
  WHERE o.created_at=now() AND o.status IN ('Pending','Sending') RETURNING o.email_id
)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label) SELECT 'email_outbox',email_id,'CC-SAMPLE-5M-v1|filters-2026-11-18' FROM skipped;
COMMIT;

-- Visit records for completed test bookings that had none (November 18, 2026, Asia/Manila).
-- Run after fill-appointment-filters.sql and consolidate-doctors.sql. Touches only bookings tracked in
-- the CC-SAMPLE-5M-v1 batch; every new row is tracked as CC-SAMPLE-5M-v1|visit-records-2026-11-18.
-- Medical: findings, diagnosis, prescription, notes and vitals that match the visit reason.
-- Dental: a treatment plus a dental chart (all teeth checked, one marked tooth for restoration or
-- extraction) with the matching accomplishment, signed by the clinic's dentist.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('CC-SAMPLE-5M-v1'));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.presentation_sample_entities WHERE label='CC-SAMPLE-5M-v1|visit-records-2026-11-18')
  THEN RAISE EXCEPTION 'The visit records were already loaded.'; END IF;
END $$;

-- The first fill gave every booking of one status the same medical reason; vary them per booking.
UPDATE public.appointments a SET reason=(ARRAY['Fever since yesterday','Cough and colds for 3 days','Recurring headache',
  'Medical check-up for OJT','Stomach ache','Blood pressure check','Allergy rashes on both arms'])[1+(a.appointment_id%7)::int]
FROM public.presentation_sample_entities e
WHERE e.label='CC-SAMPLE-5M-v1|filters-2026-11-18' AND e.entity_type='appointments' AND e.entity_id=a.appointment_id
  AND a.clinic='Medical Clinic';

CREATE TEMP TABLE visit_src ON COMMIT DROP AS
SELECT a.appointment_id,a.patient_id,a.doctor_id,a.clinic,a.service,a.reason,a.appointment_date,a.appointment_time,
  (a.appointment_id%32)::int AS k
FROM public.appointments a
JOIN public.presentation_sample_entities e ON e.entity_type='appointments' AND e.entity_id=a.appointment_id AND e.label LIKE 'CC-SAMPLE-5M-v1|%'
WHERE a.status='Completed' AND NOT EXISTS(SELECT 1 FROM public.treatments t WHERE t.appointment_id=a.appointment_id);

CREATE TEMP TABLE visit_new ON COMMIT DROP AS
WITH ins AS (
  INSERT INTO public.treatments(patient_id,doctor_id,appointment_id,examination_findings,diagnosis,prescription,clinical_notes,vitals,
    treatment_date,follow_up_date,status,created_at)
  SELECT s.patient_id,s.doctor_id,s.appointment_id,
    CASE WHEN s.clinic='Medical Clinic' THEN CASE s.reason
        WHEN 'Fever since yesterday' THEN 'Temp 38.1 °C. Throat slightly red; lungs clear.'
        WHEN 'Cough and colds for 3 days' THEN 'Clear nasal discharge, mild throat redness; lungs clear on auscultation.'
        WHEN 'Recurring headache' THEN 'Alert, no neurologic deficit. BP within normal range.'
        WHEN 'Stomach ache' THEN 'Soft abdomen, mild epigastric tenderness; no guarding.'
        WHEN 'Blood pressure check' THEN 'BP 130/85 on two readings; heart sounds normal.'
        WHEN 'Allergy rashes on both arms' THEN 'Raised itchy wheals on both forearms; no swelling of lips or eyes.'
        ELSE 'Normal physical examination. Heart and lungs normal; vision and hearing within normal limits.' END
      ELSE CASE s.service
        WHEN 'Oral Prophylaxis' THEN 'Moderate plaque and calculus on lower front teeth; gums slightly inflamed.'
        WHEN 'Tooth Restoration' THEN 'Class 1 caries on tooth '||(ARRAY['36','46','37','47'])[1+s.k%4]||'; no pain on percussion.'
        WHEN 'Tooth Extraction' THEN 'Tooth '||(ARRAY['38','48','18','28'])[1+s.k%4]||' badly decayed and not restorable.'
        ELSE 'No caries detected. Gums healthy; mild plaque.' END END,
    CASE WHEN s.clinic='Medical Clinic' THEN CASE s.reason
        WHEN 'Fever since yesterday' THEN 'Acute viral fever'
        WHEN 'Cough and colds for 3 days' THEN 'Upper respiratory tract infection'
        WHEN 'Recurring headache' THEN 'Tension-type headache'
        WHEN 'Stomach ache' THEN 'Dyspepsia'
        WHEN 'Blood pressure check' THEN 'Elevated blood pressure, for monitoring'
        WHEN 'Allergy rashes on both arms' THEN 'Allergic urticaria'
        ELSE 'Fit for on-the-job training' END
      ELSE CASE s.service
        WHEN 'Oral Prophylaxis' THEN 'Gingivitis with calculus deposits'
        WHEN 'Tooth Restoration' THEN 'Dental caries, restored'
        WHEN 'Tooth Extraction' THEN 'Non-restorable tooth, extracted'
        ELSE 'Routine dental examination' END END,
    CASE WHEN s.clinic='Medical Clinic' THEN CASE s.reason
        WHEN 'Fever since yesterday' THEN 'Paracetamol 500 mg, 1 tablet every 6 hours as needed for fever.'
        WHEN 'Cough and colds for 3 days' THEN 'Paracetamol 500 mg as needed; increase fluid intake.'
        WHEN 'Recurring headache' THEN 'Paracetamol 500 mg as needed for headache.'
        WHEN 'Stomach ache' THEN 'Antacid suspension 10 mL after meals as needed.'
        WHEN 'Blood pressure check' THEN 'None. Low-salt diet advised.'
        WHEN 'Allergy rashes on both arms' THEN 'Cetirizine 10 mg, 1 tablet once a day for 5 days.'
        ELSE 'None.' END
      ELSE CASE s.service
        WHEN 'Tooth Extraction' THEN 'Mefenamic acid 500 mg every 8 hours as needed for pain.'
        WHEN 'Oral Prophylaxis' THEN 'Chlorhexidine 0.12% mouthwash twice a day for 1 week.'
        ELSE 'None.' END END,
    CASE WHEN s.clinic='Medical Clinic' THEN CASE s.reason
        WHEN 'Blood pressure check' THEN 'Recheck blood pressure in one week.'
        WHEN 'Medical check-up for OJT' THEN 'Cleared for OJT. Medical certificate may be requested.'
        ELSE 'Advised rest and fluids; return if symptoms persist beyond 3 days.' END
      ELSE CASE s.service
        WHEN 'Tooth Extraction' THEN 'Bite on gauze for 30 minutes; soft diet for the rest of the day.'
        ELSE 'Oral hygiene instructions given; recall in 6 months.' END END,
    CASE WHEN s.clinic='Medical Clinic' THEN jsonb_build_object(
        'bp',CASE WHEN s.reason='Blood pressure check' THEN '130/85' ELSE (ARRAY['110/70','120/80','118/76','116/74'])[1+s.k%4] END,
        'hr',(70+s.k%15)::text,
        'temperature',CASE WHEN s.reason='Fever since yesterday' THEN '38.1' ELSE (ARRAY['36.5','36.7','36.8','36.6'])[1+s.k%4] END)
      ELSE '{}'::jsonb END,
    s.appointment_date,
    CASE WHEN s.clinic='Medical Clinic' AND s.reason IN ('Blood pressure check','Fever since yesterday') THEN s.appointment_date+7 END,
    'Active',
    (s.appointment_date+s.appointment_time+interval '40 minutes')::timestamp AT TIME ZONE 'Asia/Manila'
  FROM visit_src s
  RETURNING treatment_id,appointment_id
) SELECT * FROM ins;
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
SELECT 'treatments',treatment_id,'CC-SAMPLE-5M-v1|visit-records-2026-11-18' FROM visit_new;

-- Dental charts for the dental visits.
WITH teeth AS (
  SELECT jsonb_object_agg(n::text,'✓') AS all_checked
  FROM unnest(ARRAY[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38]) n
), ins AS (
  INSERT INTO public.dental_records(treatment_id,patient_id,dentist_user_id,dentist_name_snapshot,record_date,odontogram,oral_health,
    accomplishment,work_status,created_at,updated_at)
  SELECT v.treatment_id,s.patient_id,s.doctor_id,'Dr. '||u.first_name||' '||u.last_name,s.appointment_date,
    CASE s.service
      WHEN 'Tooth Restoration' THEN teeth.all_checked||jsonb_build_object((ARRAY['36','46','37','47'])[1+s.k%4],'CL1',(ARRAY['36','46','37','47'])[1+s.k%4]||'-surfaces','T')
      WHEN 'Tooth Extraction' THEN teeth.all_checked||jsonb_build_object((ARRAY['38','48','18','28'])[1+s.k%4],'M')
      ELSE teeth.all_checked END,
    jsonb_build_object('satisfactory',s.service<>'Oral Prophylaxis','fair',s.service='Oral Prophylaxis','poor',false,
      'defective_gums',s.service='Oral Prophylaxis','harelip',false,'cleft_palate',false,'others',''),
    jsonb_build_array(jsonb_build_object('nature',CASE s.service
        WHEN 'Oral Prophylaxis' THEN 'Oral prophylaxis'
        WHEN 'Tooth Restoration' THEN 'Tooth restoration'
        WHEN 'Tooth Extraction' THEN 'Tooth extraction'
        ELSE 'Oral examination' END,
      'tooth_no',CASE s.service WHEN 'Tooth Restoration' THEN (ARRAY['36','46','37','47'])[1+s.k%4]
                                WHEN 'Tooth Extraction' THEN (ARRAY['38','48','18','28'])[1+s.k%4] ELSE '' END)),
    CASE WHEN s.service IN ('Dental Checkup','General Checkup') THEN 'No Dental Work Necessary' ELSE 'Completed' END,
    (s.appointment_date+s.appointment_time+interval '45 minutes')::timestamp AT TIME ZONE 'Asia/Manila',
    (s.appointment_date+s.appointment_time+interval '45 minutes')::timestamp AT TIME ZONE 'Asia/Manila'
  FROM visit_new v JOIN visit_src s USING(appointment_id) JOIN public.users u ON u.user_id=s.doctor_id CROSS JOIN teeth
  WHERE s.clinic='Dental Clinic'
  RETURNING dental_record_id
)
INSERT INTO public.presentation_sample_entities(entity_type,entity_id,label)
SELECT 'dental_records',dental_record_id,'CC-SAMPLE-5M-v1|visit-records-2026-11-18' FROM ins;
COMMIT;

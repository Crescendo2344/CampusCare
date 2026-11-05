-- Give the CC-SAMPLE-5M-v1 and CC-DOCTOR-JILT-v1 test batches realistic names and wording for prototyping.
-- Only rows tracked in presentation_sample_entities are changed; real accounts are untouched.
-- Safe to re-run: every rule maps already-renamed values to themselves.
-- Emails stay on the reserved example.test domain so no test person can ever receive mail.
-- Certificates keep a "TEST DOCUMENT — NOT VALID" body: realistic details, never a usable document.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('CC-SAMPLE-5M-v1'));

CREATE TEMP TABLE s ON COMMIT DROP AS SELECT entity_type t, entity_id id FROM public.presentation_sample_entities WHERE label LIKE 'CC-SAMPLE-5M-v1|%' OR label LIKE 'CC-DOCTOR-JILT-v1|%';

-- People -----------------------------------------------------------------------------------
CREATE TEMP TABLE people(user_id bigint PRIMARY KEY, first text, last text, uname text, id_no text, birth date, guardian text) ON COMMIT DROP;
INSERT INTO people VALUES
 (86,'Carlo','Mendoza','carlo.mendoza','2210381',NULL,'Rosalinda Mendoza'),
 (87,'Andrea','Villanueva','andrea.villanueva','2210422',NULL,'Eduardo Villanueva'),
 (88,'Miguel','Ramos','miguel.ramos','2210457',NULL,'Teresita Ramos'),
 (89,'Patricia','Navarro','patricia.navarro','2210503',NULL,'Ramil Navarro'),
 (90,'Joshua','Dela Cruz','joshua.delacruz','2210548',NULL,'Marites Dela Cruz'),
 (91,'Kristine','Bautista','kristine.bautista','2210590',NULL,'Danilo Bautista'),
 (92,'Paolo','Garcia','paolo.garcia','2310112',NULL,'Gemma Garcia'),
 (93,'Angelica','Reyes','angelica.reyes','2310154',NULL,'Rodel Reyes'),
 (94,'John Rey','Abellana','johnrey.abellana','2310198',NULL,'Nenita Abellana'),
 (95,'Mary Grace','Cabahug','marygrace.cabahug','2310236',NULL,'Felipe Cabahug'),
 (96,'Kenneth','Ouano','kenneth.ouano','2310271',NULL,'Lourdes Ouano'),
 (97,'Shiela Mae','Pepito','shielamae.pepito','2310315',NULL,'Arnel Pepito'),
 (98,'Christian','Lapitan','christian.lapitan','2310359',NULL,'Evelyn Lapitan'),
 (99,'Jasmine','Alcoseba','jasmine.alcoseba','2410104',NULL,'Romeo Alcoseba'),
 (100,'Mark Anthony','Gabutero','markanthony.gabutero','2410147',NULL,'Cecilia Gabutero'),
 (101,'Princess','Cañete','princess.canete','2410183',NULL,'Wilfredo Cañete'),
 (102,'Rhey','Sepulveda','rhey.sepulveda','2410226',NULL,'Josefina Sepulveda'),
 (103,'Bea','Tabañag','bea.tabanag','2410262',NULL,'Ernesto Tabañag'),
 (104,'Vincent','Monterde','vincent.monterde','2410305',NULL,'Gloria Monterde'),
 (105,'Camille','Rosales','camille.rosales','2510118',NULL,'Alfredo Rosales'),
 (106,'Ralph','Laurente','ralph.laurente','2510152',NULL,'Imelda Laurente'),
 (107,'Nicole','Pacaña','nicole.pacana','2510197',NULL,'Renato Pacaña'),
 (108,'Jerome','Saavedra','jerome.saavedra','2510234',NULL,'Corazon Saavedra'),
 (109,'Hannah','Quijano','hannah.quijano','2510276',NULL,'Benjamin Quijano'),
 (110,'Ronaldo','Villacorta','ronaldo.villacorta','10425','1979-03-14','Maricel Villacorta'),
 (111,'Liza','Montecillo','liza.montecillo','10518','1984-09-02','Jonathan Montecillo'),
 (112,'Antonio','Cabatingan','antonio.cabatingan','20311','1976-06-21','Divina Cabatingan'),
 (113,'Rosemarie','Tumulak','rosemarie.tumulak','20347','1982-11-08','Edgar Tumulak'),
 (114,'Daniel','Ompad','daniel.ompad','2510309',NULL,'Lorena Ompad'),
 (116,'Kevin','Lumapas','kevin.lumapas','2310402',NULL,'Agnes Lumapas'),
 (117,'Ma. Cristina','Belarmino','macristina.belarmino','2310447',NULL,'Herminio Belarmino'),
 (118,'Ramon','Villareal','dr.ramon.villareal','30112',NULL,NULL),
 (119,'Katherine','Uy','dr.katherine.uy','30127',NULL,NULL),
 (120,'Lorna','Gimenez','lorna.gimenez','20402',NULL,NULL);

-- Nothing outside the tracked batch may be renamed.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM people p LEFT JOIN s ON s.t='users' AND s.id=p.user_id WHERE s.id IS NULL)
  THEN RAISE EXCEPTION 'A renamed person is not part of the tracked test batch.'; END IF;
END $$;

UPDATE public.users u SET first_name=p.first,last_name=p.last,username=p.uname,
  email=replace(p.uname,'dr.','')||'@example.test',id_number=p.id_no,
  contact_number='0999555'||lpad((u.user_id-80)::text,4,'0')
FROM people p WHERE p.user_id=u.user_id;

-- Sign-in uses the Auth email, so keep it identical to the profile email.
UPDATE auth.users a SET email=u.email,
  raw_user_meta_data=coalesce(a.raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('first_name',u.first_name,'last_name',u.last_name,'username',u.username)
FROM public.users u JOIN people p ON p.user_id=u.user_id
WHERE a.id=u.auth_user_id AND a.raw_app_meta_data->>'sample_batch'='CC-SAMPLE-5M-v1';
UPDATE auth.identities i SET identity_data=i.identity_data||jsonb_build_object('email',u.email)
FROM public.users u JOIN people p ON p.user_id=u.user_id
WHERE i.user_id=u.auth_user_id AND i.provider='email';

UPDATE public.patients pt SET
  address=(ARRAY['Brgy. Lahug, Cebu City','Brgy. Mabolo, Cebu City','Brgy. Guadalupe, Cebu City','Brgy. Talamban, Cebu City','Brgy. Banilad, Mandaue City','Brgy. Basak, Mandaue City','Brgy. Pajo, Lapu-Lapu City','Brgy. Tisa, Cebu City','Brgy. Labangon, Cebu City','Brgy. Poblacion, Talisay City','Brgy. Tabok, Mandaue City','Brgy. Pardo, Cebu City'])[1+(pt.patient_id%12)::int],
  emergency_contact_name=p.guardian,
  emergency_contact_number='0999556'||lpad((pt.patient_id-80)::text,4,'0'),
  birth_date=coalesce(p.birth,pt.birth_date),
  medical_history=CASE WHEN pt.medical_history ~* 'sample' THEN 'Mild asthma since childhood; uses a salbutamol inhaler as needed.' ELSE pt.medical_history END,
  allergies=CASE WHEN pt.allergies ~* 'sample' THEN (ARRAY['Penicillin','Shrimp and crabs','Ibuprofen','Dust mites'])[1+(pt.patient_id%4)::int] ELSE pt.allergies END
FROM people p, s WHERE s.t='patients' AND s.id=pt.patient_id AND pt.user_id=p.user_id;

UPDATE public.workflow_requests w SET payload=CASE
  WHEN w.status='Applied' THEN jsonb_build_object('current',jsonb_build_object('firstName',CASE w.requester_id WHEN 86 THEN 'Karlo' WHEN 87 THEN 'Andria' ELSE 'Migel' END,'lastName',u.last_name),'requested',jsonb_build_object('firstName',u.first_name,'lastName',u.last_name))
  ELSE jsonb_build_object('current',jsonb_build_object('firstName',u.first_name,'lastName',u.last_name),'requested',jsonb_build_object('firstName',CASE w.requester_id WHEN 86 THEN 'Juan Carlo' WHEN 87 THEN 'Andrea Mae' ELSE 'Miguel Angelo' END,'lastName',u.last_name)) END
FROM public.users u, s WHERE s.t='workflow_requests' AND s.id=w.request_id AND w.request_type='Name Change' AND u.user_id=w.requester_id;
UPDATE public.workflow_requests w SET
  reason=CASE w.request_type
    WHEN 'Name Change' THEN 'My first name is misspelled. Correcting it to match my PSA birth certificate.'
    WHEN 'Schedule Change' THEN 'Requesting Tuesday and Thursday afternoons off for a CPD training program this semester.'
    ELSE 'Attending the PDA Cebu Chapter dental convention.' END,
  admin_note=CASE w.status
    WHEN 'Applied' THEN 'Verified and approved.'
    WHEN 'Rejected' THEN CASE w.request_type WHEN 'Name Change' THEN 'The attached document does not show the requested name.' ELSE 'Clinic coverage is too thin on those dates. Please choose other days.' END
    ELSE NULL END
FROM s WHERE s.t='workflow_requests' AND s.id=w.request_id;

-- Clinical history (integrity triggers paused only for these text-only updates) ------------
ALTER TABLE public.appointments DISABLE TRIGGER trg_validate_appointment_integrity;
ALTER TABLE public.treatments DISABLE TRIGGER trg_validate_treatment_integrity;

UPDATE public.treatments t SET diagnosis=regexp_replace(t.diagnosis,'^SAMPLE\s*[—-]\s*','') FROM s WHERE s.t='treatments' AND s.id=t.treatment_id;
UPDATE public.treatments t SET
  examination_findings=CASE t.diagnosis
    WHEN 'Upper respiratory tract infection' THEN 'Temp 37.4 °C. Mild pharyngeal redness; lungs clear on auscultation.'
    WHEN 'Fever' THEN 'Temp 38.2 °C. No rashes; throat and lungs clear.'
    WHEN 'Headache' THEN 'BP 110/70. Alert and oriented; no neurologic deficits.'
    WHEN 'Minor abrasion' THEN 'Superficial abrasion on the knee; no signs of infection.'
    WHEN 'Routine dental examination' THEN 'No caries detected. Mild plaque on lower front teeth.'
    WHEN 'Dental caries' THEN 'Occlusal caries on a lower molar.'
    WHEN 'Gingivitis' THEN 'Gum inflammation with bleeding on probing.'
    ELSE 'Vital signs within normal limits.' END,
  prescription=CASE t.diagnosis
    WHEN 'Upper respiratory tract infection' THEN 'Paracetamol 500 mg, 1 tablet every 6 hours as needed for fever. Increase fluid intake.'
    WHEN 'Fever' THEN 'Paracetamol 500 mg, 1 tablet every 6 hours as needed. Oral rehydration.'
    WHEN 'Headache' THEN 'Paracetamol 500 mg, 1 tablet as needed.'
    WHEN 'Minor abrasion' THEN 'Wound cleaned with povidone-iodine; sterile gauze dressing applied.'
    WHEN 'Gingivitis' THEN 'Chlorhexidine 0.12% mouthwash, rinse twice daily for 7 days.'
    ELSE 'None.' END,
  clinical_notes=CASE t.diagnosis
    WHEN 'Upper respiratory tract infection' THEN 'Advised rest; return if symptoms last beyond 5 days.'
    WHEN 'Fever' THEN 'Advised to monitor temperature; return if fever lasts more than 3 days.'
    WHEN 'Headache' THEN 'Advised adequate sleep and hydration; limit screen time.'
    WHEN 'Minor abrasion' THEN 'Keep the wound clean and dry; return for redressing in 2 days.'
    WHEN 'Routine dental examination' THEN 'Oral hygiene instructions given; recall in 6 months.'
    WHEN 'Dental caries' THEN 'Composite restoration done; avoid hard food for 24 hours.'
    WHEN 'Gingivitis' THEN 'Oral prophylaxis done; flossing instructions given.'
    ELSE 'No further treatment needed.' END
FROM s WHERE s.t='treatments' AND s.id=t.treatment_id;

UPDATE public.appointments a SET notes=NULL,
  reason=coalesce((SELECT CASE t.diagnosis
      WHEN 'Upper respiratory tract infection' THEN 'Cough and colds for 3 days'
      WHEN 'Fever' THEN 'Fever since yesterday'
      WHEN 'Headache' THEN 'Recurring headache'
      WHEN 'Minor abrasion' THEN 'Wound dressing for a scraped knee'
      WHEN 'Routine dental examination' THEN 'Routine dental check-up'
      WHEN 'Dental caries' THEN 'Toothache on a lower molar'
      WHEN 'Gingivitis' THEN 'Bleeding gums when brushing' END
    FROM public.treatments t WHERE t.appointment_id=a.appointment_id LIMIT 1),
    CASE a.service
      WHEN 'Dental Checkup' THEN 'Routine dental check-up'
      WHEN 'Oral Prophylaxis' THEN 'Teeth cleaning'
      WHEN 'Tooth Restoration' THEN 'Toothache on a lower molar'
      WHEN 'Tooth Extraction' THEN 'Tooth extraction'
      ELSE (ARRAY['Fever and body pain','Cough and colds','Headache','Medical check-up for OJT','Stomach ache','Follow-up check-up'])[1+(a.appointment_id%6)::int] END),
  cancellation_reason=CASE WHEN a.cancellation_reason ~* 'sample' THEN (ARRAY['Class schedule conflict','Feeling better already','Family emergency','Rescheduled to a later date','Doctor unavailable; clinic will reschedule'])[1+(a.appointment_id%5)::int] ELSE a.cancellation_reason END
FROM s WHERE s.t='appointments' AND s.id=a.appointment_id;

ALTER TABLE public.appointments ENABLE TRIGGER trg_validate_appointment_integrity;
ALTER TABLE public.treatments ENABLE TRIGGER trg_validate_treatment_integrity;

UPDATE public.dental_records d SET
  dentist_name_snapshot=coalesce((SELECT 'Dr. '||u.first_name||' '||u.last_name FROM public.users u WHERE u.user_id=d.dentist_user_id),'Dr. Katherine Uy'),
  course_major=CASE WHEN pu.person_type='Student' THEN CASE pu.college
      WHEN 'CCICT' THEN 'BS Information Technology' WHEN 'COE' THEN 'BS Civil Engineering'
      WHEN 'COED' THEN 'Bachelor of Secondary Education major in English' WHEN 'CME' THEN 'BS Hospitality Management'
      WHEN 'CAS' THEN 'BS Biology' ELSE 'BS Industrial Technology major in Automotive' END
    ELSE pu.person_type END,
  year_section=CASE WHEN pu.person_type='Student' THEN (4-least(3,greatest(0,extract(year FROM p.birth_date)::int-2002)))::text||'-'||(ARRAY['A','B','C'])[1+(d.patient_id%3)::int] ELSE 'N/A' END,
  recommendation=(ARRAY['Return after 6 months for oral prophylaxis.','Brush twice daily and floss every night.','Schedule restoration of the remaining caries.','Reduce sugary drinks; recall in 6 months.'])[1+(d.dental_record_id%4)::int]
FROM public.patients p JOIN public.users pu ON pu.user_id=p.user_id, s
WHERE s.t='dental_records' AND s.id=d.dental_record_id AND p.patient_id=d.patient_id;

-- Certificates and fitness ---------------------------------------------------------------
UPDATE public.medical_certificates c SET
  certificate_no=CASE WHEN c.certificate_no LIKE 'SAMPLE-JILT-%' THEN 'CTU-MC-2026-T1'||right(c.certificate_no,3) ELSE 'CTU-MC-2026-T'||right(c.certificate_no,4) END,
  purpose=(ARRAY['OJT / Internship Requirement','Excused Absence','Sports / Athletics Participation'])[1+(c.certificate_id%3)::int]
FROM s WHERE s.t='medical_certificates' AND s.id=c.certificate_id;
UPDATE public.medical_certificates c SET
  diagnosis=CASE c.purpose WHEN 'Excused Absence' THEN (ARRAY['Acute gastroenteritis','Influenza-like illness','Acute tonsillopharyngitis'])[1+(c.certificate_id%3)::int] ELSE 'Physically fit; no communicable disease noted' END,
  examination_findings=CASE c.purpose WHEN 'Excused Absence' THEN 'Temp 38.0 °C on examination; advised home rest.' ELSE 'BP 110/70, HR 74, lungs clear, normal heart sounds.' END,
  request_details=CASE c.purpose
    WHEN 'OJT / Internship Requirement' THEN 'Required by the OJT coordinator before deployment.'
    WHEN 'Excused Absence' THEN 'Absent from classes while recovering; for submission to the instructor.'
    ELSE 'Required by the coach for the CTU Intramurals.' END,
  decline_reason=CASE WHEN c.decline_reason ~* 'sample' THEN 'No clinic visit on record for the requested dates.' ELSE c.decline_reason END,
  document_content='<h1>TEST DOCUMENT — NOT VALID</h1><p>Prototype record for CampusCare testing. This is not a medical certificate.</p>'
FROM s WHERE s.t='medical_certificates' AND s.id=c.certificate_id;

UPDATE public.fitness_assessments f SET
  sport_event=(ARRAY['CTU Intramurals 2026 — Basketball','CTU Intramurals 2026 — Volleyball','CTU Intramurals 2026 — Athletics (100 m)','CVIRAA 2026 — Football','CTU Intramurals 2026 — Badminton','CTU Intramurals 2026 — Table Tennis','CVIRAA 2026 — Swimming'])[1+(f.assessment_id%7)::int],
  medical_history=(ARRAY['No known chronic illness.','Mild asthma, controlled; last attack two years ago.','Sprained right ankle last year; fully recovered.','No known chronic illness.'])[1+(f.assessment_id%4)::int],
  request_notes='Requested by the team coach before tryouts.',
  restrictions=CASE f.decision WHEN 'Fit with Restrictions' THEN 'Avoid strenuous play in extreme heat; carry an inhaler during games.' ELSE NULL END,
  examination_findings=CASE WHEN f.status IN ('Completed','In Assessment') THEN 'BP 110/70, HR 72 at rest; lungs clear; normal cardiovascular exam.' ELSE NULL END
FROM s WHERE s.t='fitness_assessments' AND s.id=f.assessment_id;

-- Inventory --------------------------------------------------------------------------------
UPDATE public.inventory_items i SET
  item_name=CASE regexp_replace(i.item_name,'^SAMPLE\s*[—-]\s*','')
    WHEN 'Antiseptic' THEN 'Povidone-Iodine 10% Solution' WHEN 'Gloves' THEN 'Nitrile Examination Gloves (Medium)'
    WHEN 'Gauze' THEN 'Sterile Gauze Pads 4x4' WHEN 'Archived supply' THEN 'Cotton Balls (old pack size)'
    WHEN 'Paracetamol' THEN 'Paracetamol 500 mg Tablet' WHEN 'Cetirizine' THEN 'Cetirizine 10 mg Tablet'
    WHEN 'Vitamin C' THEN 'Ascorbic Acid 500 mg Tablet' WHEN 'Oral rinse' THEN 'Chlorhexidine 0.12% Mouthwash'
    ELSE regexp_replace(i.item_name,'^SAMPLE\s*[—-]\s*','') END,
  supplier=(ARRAY['Cebu Medical Supply Co.','Visayas Pharma Distributors','MetroDrug Cebu'])[1+(i.item_id%3)::int]
FROM s WHERE s.t='inventory_items' AND s.id=i.item_id;
UPDATE public.inventory_transactions x SET notes=CASE
    WHEN x.notes ILIKE '%opening balance' THEN 'Opening balance'
    WHEN x.notes ILIKE '%monthly restock%' THEN 'Monthly restock delivery'
    WHEN (x.notes ILIKE '%stock reduction' OR x.notes ILIKE 'Damaged packs%') THEN 'Damaged packs removed from stock'
    ELSE 'Dispensed to patient' END
FROM s WHERE s.t='inventory_transactions' AND s.id=x.transaction_id;

-- Engagement, requests and records -----------------------------------------------------------
UPDATE public.clinic_surveys v SET suggestions=(ARRAY['The staff were very accommodating. Thank you!','Waiting time was short. Keep it up.','Please add more chairs in the waiting area.','The dentist explained everything clearly.','Online booking made it easy to get a slot.','It would help to have SMS reminders.','Clean clinic and friendly staff.','Hope the clinic opens earlier on exam week.',NULL,NULL])[1+(v.survey_id%10)::int]
FROM s WHERE s.t='clinic_surveys' AND s.id=v.survey_id;
UPDATE public.privacy_consents c SET privacy_version='1.0',event_type='Registration Acknowledgement',notes=NULL
FROM s WHERE s.t='privacy_consents' AND s.id=c.consent_id;
UPDATE public.notifications n SET
  type=(ARRAY['Appointment','Account','Certificate','Appointment'])[1+(n.notification_id%4)::int],
  title=(ARRAY['Appointment reminder','Account verified','Medical certificate ready','Appointment confirmed'])[1+(n.notification_id%4)::int],
  message=(ARRAY['Your clinic appointment is tomorrow. Please bring your signed COR and school ID.','Your CampusCare account has been verified. You can now book appointments.','Your medical certificate is ready for pick-up at the clinic.','Your appointment has been confirmed. See you at the clinic.'])[1+(n.notification_id%4)::int]
FROM s WHERE s.t='notifications' AND s.id=n.notification_id AND (n.title ~* 'sample' OR n.type ~* 'sample' OR n.message ~* 'sample');
UPDATE public.medication_reminders m SET
  medication=(ARRAY['Amoxicillin 500 mg','Paracetamol 500 mg','Cetirizine 10 mg','Ascorbic Acid 500 mg','Mefenamic Acid 500 mg'])[1+(m.reminder_id%5)::int],
  frequency=(ARRAY['Every 8 hours','Every 6 hours as needed','Once daily at night','Once daily','Every 8 hours after meals'])[1+(m.reminder_id%5)::int]
FROM s WHERE s.t='medication_reminders' AND s.id=m.reminder_id;
UPDATE public.messages m SET subject='Follow-up on my clinic visit',
  body=(ARRAY['Good day! May I ask if I can get a copy of my visit summary?','Hello, is the dental clinic open on Saturday?','Thank you, doctor. I am feeling better now.','Noted, I will bring my COR tomorrow.'])[1+(m.message_id%4)::int]
FROM s WHERE s.t='messages' AND s.id=m.message_id;

UPDATE public.issue_reports r SET
  description=CASE r.issue_type
    WHEN 'Bug' THEN 'The appointment calendar did not load on my phone after I tapped Book Appointment.'
    WHEN 'Feedback' THEN 'Booking was quick, but I could not find where to see my past visit records.'
    ELSE CASE r.status WHEN 'Dismissed' THEN 'Please add a chat feature so I can message the doctor directly.' ELSE 'It would help to get a reminder the day before my dental appointment.' END END,
  page_affected=CASE r.issue_type WHEN 'Bug' THEN 'Appointments' WHEN 'Feedback' THEN 'My Health Records' ELSE 'Notifications' END,
  admin_note=CASE r.status
    WHEN 'Resolved' THEN 'Fixed in the latest update.'
    WHEN 'Dismissed' THEN 'Direct messaging was retired; patients can reach the clinic through Report an Issue.'
    WHEN 'In Review' THEN 'Checking with the team how to make visit history easier to find.'
    ELSE NULL END
FROM s WHERE s.t='issue_reports' AND s.id=r.issue_id;
UPDATE public.issue_replies p SET body=(ARRAY['Thank you for reporting this. We are looking into it.','Could you tell us which phone and browser you used?','This has been fixed. Please try again and let us know.','Thanks for the suggestion! We have noted it for a future update.'])[1+(p.reply_id%4)::int]
FROM s WHERE s.t='issue_replies' AND s.id=p.reply_id;

UPDATE public.health_resources h SET
  title=(ARRAY['Heat Stroke: Warning Signs During Outdoor Activities','Healthy Gums Start with Daily Habits','Flu Vaccination Drive 2025: Schedule and Venue'])[h.resource_id-15],
  category=(ARRAY['First Aid','Nutrition','Vaccination'])[h.resource_id-15],
  teaser=(ARRAY['Know the early signs and what to do while waiting for help.','Simple daily steps that keep your gums healthy.','Free flu shots for students and personnel at the Main Campus clinic.'])[h.resource_id-15],
  content=(ARRAY['Heat stroke is a medical emergency. Warning signs include very high body temperature, confusion, hot and dry skin, and fainting. Move the person to a cool, shaded place, loosen tight clothing, cool the skin with water and fanning, and call for help right away. During intramurals and P.E. classes, drink water before you feel thirsty and rest in the shade between activities.','Healthy gums do not bleed. Brush twice a day for two minutes with fluoride toothpaste, floss once a day, and limit sugary drinks between meals. Bleeding when brushing is often an early sign of gum inflammation, which a dental cleaning can treat. Visit the dental clinic every six months for a check-up.','The clinic held a free flu vaccination drive for students and personnel. Bring your school or employee ID. Tell the nurse if you have a fever, an egg allergy, or a history of reactions to vaccines. This notice is archived because the drive has ended.'])[h.resource_id-15]
FROM s WHERE s.t='health_resources' AND s.id=h.resource_id AND h.resource_id BETWEEN 16 AND 18;

UPDATE public.doctor_leaves l SET reason='Attending a medical conference in Cebu City' FROM s WHERE s.t='doctor_leaves' AND s.id=l.leave_id;
UPDATE public.appointment_slot_overrides o SET reason='Clinic staff meeting' FROM s WHERE s.t='appointment_slot_overrides' AND s.id=o.override_id;
UPDATE public.uat_test_results u SET title=regexp_replace(u.title,'^SAMPLE\s*[—-]\s*','') FROM s WHERE s.t='uat_test_results' AND s.id=u.result_id;
UPDATE public.email_outbox e SET recipient_email=u.email FROM public.users u, s WHERE s.t='email_outbox' AND s.id=e.email_id AND u.user_id=e.user_id AND e.status='Skipped';

-- Drafts that only held the batch label would restore an empty form; remove them.
DELETE FROM public.form_drafts d USING s WHERE s.t='form_drafts' AND s.id=d.draft_id;
DELETE FROM public.user_drafts d USING s WHERE s.t='user_drafts' AND s.id=d.draft_id;
DELETE FROM public.presentation_sample_entities e WHERE e.label LIKE 'CC-SAMPLE-5M-v1|%' AND e.entity_type IN ('form_drafts','user_drafts');

-- The paused triggers must be back on before commit.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_validate_appointment_integrity','trg_validate_treatment_integrity') AND tgenabled<>'O')
  THEN RAISE EXCEPTION 'Integrity triggers were not re-enabled.'; END IF;
END $$;
COMMIT;

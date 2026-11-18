-- One doctor per clinic (requested November 18, 2026, Asia/Manila).
-- Keeps Dr. Daisy Therese Llenes (user 130) for the Medical Clinic and Dr. Jilt Sanchez (user 4)
-- for the Dental Clinic. Permanently deletes Dr. Ramon Villareal (118), Dr. Katherine Uy (119) and
-- Dr. Jennifer Irene Buchan (7) after moving their clinical work to the kept doctor:
--   appointments, visit records (treatments), dental charts, certificates and fitness assessments.
-- Their own schedules, days off, blocked slots, notifications, consents and requests are deleted.
-- A booking that would collide with the kept doctor's booking at the same hour moves to the nearest
-- free hour that day (or the nearest earlier/later weekday). Real patients' bookings never collided.
-- The integrity triggers are paused only inside this locked transaction and restored before commit.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('CC-SAMPLE-5M-v1'));
CREATE TEMP TABLE doc_map(old_id bigint PRIMARY KEY,new_id bigint NOT NULL,clinic text NOT NULL) ON COMMIT DROP;
INSERT INTO doc_map VALUES (118,130,'Medical Clinic'),(119,4,'Dental Clinic'),(7,4,'Dental Clinic');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.users WHERE user_id IN (130,4) AND role='Doctor' AND status='Active')<>2
  THEN RAISE EXCEPTION 'Kept doctors must be active Doctor accounts.'; END IF;
END $$;

LOCK TABLE public.appointments,public.treatments IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.appointments DISABLE TRIGGER trg_validate_appointment_integrity;
ALTER TABLE public.treatments DISABLE TRIGGER trg_validate_treatment_integrity;

-- 1. Appointments, one at a time so every move is checked against the kept doctor's live slots.
DO $$
DECLARE a record; slot record; times text[];
BEGIN
  FOR a IN
    SELECT x.appointment_id,x.appointment_date,x.appointment_time,x.status,m.new_id,m.clinic
    FROM public.appointments x JOIN doc_map m ON m.old_id=x.doctor_id
    ORDER BY (EXISTS(SELECT 1 FROM public.presentation_sample_entities e WHERE e.entity_type='appointments' AND e.entity_id=x.appointment_id)),
             x.appointment_date,x.appointment_time,x.appointment_id
  LOOP
    IF a.status='Cancelled' OR NOT EXISTS(
      SELECT 1 FROM public.appointments y WHERE y.doctor_id=a.new_id AND y.appointment_date=a.appointment_date
        AND y.appointment_time=a.appointment_time AND y.status<>'Cancelled') THEN
      UPDATE public.appointments SET doctor_id=a.new_id WHERE appointment_id=a.appointment_id;
      CONTINUE;
    END IF;
    times:=CASE WHEN a.clinic='Dental Clinic' THEN ARRAY['09:00','10:00','11:00','13:00','14:00','15:00','16:00']
                ELSE ARRAY['08:00','09:00','10:00','11:00','13:00','14:00','15:00','16:00'] END;
    SELECT c.d,c.t INTO slot
    FROM generate_series(0,40) k
    CROSS JOIN LATERAL (SELECT CASE WHEN a.appointment_date<(now() AT TIME ZONE 'Asia/Manila')::date
                                    THEN a.appointment_date-k ELSE a.appointment_date+k END AS d) dd
    CROSS JOIN LATERAL unnest(times) tt(t0)
    CROSS JOIN LATERAL (SELECT dd.d,tt.t0::time AS t) c
    WHERE extract(isodow FROM c.d) BETWEEN 1 AND 5
      AND (CASE WHEN a.appointment_date<(now() AT TIME ZONE 'Asia/Manila')::date THEN c.d<(now() AT TIME ZONE 'Asia/Manila')::date
                ELSE c.d>(now() AT TIME ZONE 'Asia/Manila')::date END)
      AND NOT EXISTS(SELECT 1 FROM public.appointments y WHERE y.doctor_id=a.new_id AND y.appointment_date=c.d AND y.appointment_time=c.t AND y.status<>'Cancelled')
      AND NOT EXISTS(SELECT 1 FROM public.doctor_leaves l WHERE l.doctor_id=a.new_id AND l.leave_date=c.d)
      AND NOT EXISTS(SELECT 1 FROM public.appointment_slot_overrides o WHERE o.doctor_id=a.new_id AND o.override_date=c.d AND o.slot_time=c.t AND NOT o.is_available)
    ORDER BY k,abs(extract(epoch FROM c.t-a.appointment_time))
    LIMIT 1;
    IF slot IS NULL THEN RAISE EXCEPTION 'No free slot for appointment %.',a.appointment_id; END IF;
    UPDATE public.appointments SET doctor_id=a.new_id,appointment_date=slot.d,appointment_time=slot.t WHERE appointment_id=a.appointment_id;
  END LOOP;
END $$;

-- Visit records follow their booking's (possibly moved) date; unlinked ones follow the doctor map.
UPDATE public.treatments t SET doctor_id=a.doctor_id,treatment_date=a.appointment_date,
  follow_up_date=CASE WHEN t.follow_up_date IS NOT NULL THEN t.follow_up_date+(a.appointment_date-t.treatment_date) END
FROM public.appointments a, doc_map m WHERE t.appointment_id=a.appointment_id AND t.doctor_id=m.old_id;
UPDATE public.treatments t SET doctor_id=m.new_id FROM doc_map m WHERE t.doctor_id=m.old_id;
UPDATE public.dental_records r SET dentist_user_id=m.new_id,dentist_name_snapshot='Dr. Jilt Sanchez',
  record_date=COALESCE((SELECT t.treatment_date FROM public.treatments t WHERE t.treatment_id=r.treatment_id),r.record_date)
FROM doc_map m WHERE r.dentist_user_id=m.old_id;
UPDATE public.medical_certificates c SET doctor_id=m.new_id FROM doc_map m WHERE c.doctor_id=m.old_id;
UPDATE public.medical_certificates c SET signed_by=m.new_id FROM doc_map m WHERE c.signed_by=m.old_id;
UPDATE public.fitness_assessments f SET doctor_id=m.new_id FROM doc_map m WHERE f.doctor_id=m.old_id;
UPDATE public.doctor_schedule_rules r SET created_by=NULL FROM doc_map m WHERE r.created_by=m.old_id;

-- 2. The removed doctors' own availability, inbox and requests.
DELETE FROM public.doctor_leaves t USING doc_map m WHERE t.doctor_id=m.old_id;
DELETE FROM public.appointment_slot_overrides t USING doc_map m WHERE t.doctor_id=m.old_id;
DELETE FROM public.doctor_schedule_rules t USING doc_map m WHERE t.doctor_id=m.old_id;
DELETE FROM public.notifications t USING doc_map m WHERE t.user_id=m.old_id;
DELETE FROM public.privacy_consents t USING doc_map m WHERE t.user_id=m.old_id;
DELETE FROM public.workflow_requests t USING doc_map m WHERE t.requester_id=m.old_id OR t.target_user_id=m.old_id;
DELETE FROM public.email_outbox t USING doc_map m WHERE t.user_id=m.old_id;

ALTER TABLE public.treatments ENABLE TRIGGER trg_validate_treatment_integrity;
ALTER TABLE public.appointments ENABLE TRIGGER trg_validate_appointment_integrity;

-- 3. Delete the accounts and their sign-ins. Tracking rows for already-deleted entities go too.
CREATE TEMP TABLE doc_auth ON COMMIT DROP AS
  SELECT u.auth_user_id FROM public.users u JOIN doc_map m ON m.old_id=u.user_id WHERE u.auth_user_id IS NOT NULL;
DELETE FROM public.presentation_sample_entities e USING doc_map m WHERE e.entity_type='users' AND e.entity_id=m.old_id;
DELETE FROM public.presentation_sample_entities e WHERE e.entity_type IN ('doctor_leaves','appointment_slot_overrides','doctor_schedule_rules','notifications','privacy_consents','workflow_requests','email_outbox')
  AND NOT EXISTS(SELECT 1 FROM public.doctor_leaves x WHERE e.entity_type='doctor_leaves' AND x.leave_id=e.entity_id)
  AND NOT EXISTS(SELECT 1 FROM public.appointment_slot_overrides x WHERE e.entity_type='appointment_slot_overrides' AND x.override_id=e.entity_id)
  AND NOT EXISTS(SELECT 1 FROM public.doctor_schedule_rules x WHERE e.entity_type='doctor_schedule_rules' AND x.rule_id=e.entity_id)
  AND NOT EXISTS(SELECT 1 FROM public.notifications x WHERE e.entity_type='notifications' AND x.notification_id=e.entity_id)
  AND NOT EXISTS(SELECT 1 FROM public.privacy_consents x WHERE e.entity_type='privacy_consents' AND x.consent_id=e.entity_id)
  AND NOT EXISTS(SELECT 1 FROM public.workflow_requests x WHERE e.entity_type='workflow_requests' AND x.request_id=e.entity_id)
  AND NOT EXISTS(SELECT 1 FROM public.email_outbox x WHERE e.entity_type='email_outbox' AND x.email_id=e.entity_id);
DELETE FROM public.users u USING doc_map m WHERE u.user_id=m.old_id;
DELETE FROM auth.sessions t USING doc_auth a WHERE t.user_id=a.auth_user_id;
DELETE FROM auth.identities t USING doc_auth a WHERE t.user_id=a.auth_user_id;
DELETE FROM auth.users t USING doc_auth a WHERE t.id=a.auth_user_id;
COMMIT;

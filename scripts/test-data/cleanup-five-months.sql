-- Remove only the explicitly tracked CC-SAMPLE-5M-v1 batch.
-- Delete its uploaded fixtures through Storage first (see TEST-DATA.md).
-- Foreign keys deliberately stop cleanup if testers added untracked dependent records.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('CC-SAMPLE-5M-v1'));
CREATE TEMP TABLE sample_cleanup_ids ON COMMIT DROP AS
  SELECT entity_type,entity_id FROM public.presentation_sample_entities WHERE label LIKE 'CC-SAMPLE-5M-v1|%';
CREATE TEMP TABLE sample_cleanup_auth ON COMMIT DROP AS
  SELECT u.auth_user_id FROM public.users u JOIN sample_cleanup_ids s ON s.entity_type='users' AND s.entity_id=u.user_id
  WHERE u.username LIKE 'ccsample.%' AND u.auth_user_id IS NOT NULL;
-- Abort instead of hiding a storage cleanup problem or deleting unrelated objects.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id IN('campuscare-verification','campuscare-profiles','campuscare-message-files')
    AND (o.name LIKE ANY(ARRAY(SELECT auth_user_id::text||'/CC-SAMPLE-5M-v1%' FROM sample_cleanup_auth))
      OR o.name LIKE ANY(ARRAY(SELECT entity_id::text||'/%CC-SAMPLE-5M-v1%' FROM sample_cleanup_ids WHERE entity_type='users'))))
  THEN RAISE EXCEPTION 'Remove sample Storage fixture objects through the Storage API before running SQL cleanup.'; END IF;
END $$;
-- Links are removed before their parents. No real user, settings or backup rows are touched.
DELETE FROM public.message_hidden h USING sample_cleanup_ids s WHERE s.entity_type='messages' AND h.message_id=s.entity_id;
DELETE FROM public.email_outbox t USING sample_cleanup_ids s WHERE s.entity_type='email_outbox' AND t.email_id=s.entity_id;
DELETE FROM public.notifications t USING sample_cleanup_ids s WHERE s.entity_type='notifications' AND t.notification_id=s.entity_id;
DELETE FROM public.issue_replies t USING sample_cleanup_ids s WHERE s.entity_type='issue_replies' AND t.reply_id=s.entity_id;
DELETE FROM public.issue_reports t USING sample_cleanup_ids s WHERE s.entity_type='issue_reports' AND t.issue_id=s.entity_id;
DELETE FROM public.user_drafts t USING sample_cleanup_ids s WHERE s.entity_type='user_drafts' AND t.draft_id=s.entity_id;
DELETE FROM public.form_drafts t USING sample_cleanup_ids s WHERE s.entity_type='form_drafts' AND t.draft_id=s.entity_id;
DELETE FROM public.messages t USING sample_cleanup_ids s WHERE s.entity_type='messages' AND t.message_id=s.entity_id;
DELETE FROM public.medication_reminders t USING sample_cleanup_ids s WHERE s.entity_type='medication_reminders' AND t.reminder_id=s.entity_id;
DELETE FROM public.clinic_surveys t USING sample_cleanup_ids s WHERE s.entity_type='clinic_surveys' AND t.survey_id=s.entity_id;
DELETE FROM public.dental_records t USING sample_cleanup_ids s WHERE s.entity_type='dental_records' AND t.dental_record_id=s.entity_id;
DELETE FROM public.medical_certificates t USING sample_cleanup_ids s WHERE s.entity_type='medical_certificates' AND t.certificate_id=s.entity_id;
DELETE FROM public.fitness_assessments t USING sample_cleanup_ids s WHERE s.entity_type='fitness_assessments' AND t.assessment_id=s.entity_id;
DELETE FROM public.treatments t USING sample_cleanup_ids s WHERE s.entity_type='treatments' AND t.treatment_id=s.entity_id;
DELETE FROM public.appointments t USING sample_cleanup_ids s WHERE s.entity_type='appointments' AND t.appointment_id=s.entity_id;
DELETE FROM public.appointment_slot_overrides t USING sample_cleanup_ids s WHERE s.entity_type='appointment_slot_overrides' AND t.override_id=s.entity_id;
DELETE FROM public.doctor_leaves t USING sample_cleanup_ids s WHERE s.entity_type='doctor_leaves' AND t.leave_id=s.entity_id;
DELETE FROM public.doctor_schedule_rules t USING sample_cleanup_ids s WHERE s.entity_type='doctor_schedule_rules' AND t.rule_id=s.entity_id;
DELETE FROM public.workflow_requests t USING sample_cleanup_ids s WHERE s.entity_type='workflow_requests' AND t.request_id=s.entity_id;
DELETE FROM public.inventory_forecasts t USING sample_cleanup_ids s WHERE s.entity_type='inventory_forecasts' AND t.forecast_id=s.entity_id;
DELETE FROM public.inventory_transactions t USING sample_cleanup_ids s WHERE s.entity_type='inventory_transactions' AND t.transaction_id=s.entity_id;
DELETE FROM public.inventory_items t USING sample_cleanup_ids s WHERE s.entity_type='inventory_items' AND t.item_id=s.entity_id;
DELETE FROM public.health_resources t USING sample_cleanup_ids s WHERE s.entity_type='health_resources' AND t.resource_id=s.entity_id;
DELETE FROM public.privacy_consents t USING sample_cleanup_ids s WHERE s.entity_type='privacy_consents' AND t.consent_id=s.entity_id;
DELETE FROM public.audit_logs t USING sample_cleanup_ids s WHERE s.entity_type='audit_logs' AND t.audit_id=s.entity_id;
DELETE FROM public.uat_test_results t USING sample_cleanup_ids s WHERE s.entity_type='uat_test_results' AND t.result_id=s.entity_id;
DELETE FROM public.patients t USING sample_cleanup_ids s WHERE s.entity_type='patients' AND t.patient_id=s.entity_id;
DELETE FROM public.users t USING sample_cleanup_ids s WHERE s.entity_type='users' AND t.user_id=s.entity_id AND t.username LIKE 'ccsample.%';
-- Revoke only the synthetic accounts' sessions before deleting their Auth identities.
DELETE FROM auth.sessions t USING sample_cleanup_auth s WHERE t.user_id=s.auth_user_id;
DELETE FROM auth.identities t USING sample_cleanup_auth s WHERE t.user_id=s.auth_user_id;
DELETE FROM auth.users t USING sample_cleanup_auth s WHERE t.id=s.auth_user_id AND t.raw_app_meta_data->>'sample_batch'='CC-SAMPLE-5M-v1';
DELETE FROM public.presentation_sample_entities e USING sample_cleanup_ids s WHERE e.entity_type=s.entity_type AND e.entity_id=s.entity_id;
COMMIT;

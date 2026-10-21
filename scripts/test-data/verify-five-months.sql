-- Aggregate checks expose no original patient details or authentication credentials.
WITH samples AS (SELECT * FROM public.presentation_sample_entities WHERE label LIKE 'CC-SAMPLE-5M-v1|%')
SELECT jsonb_build_object(
 'counts',(SELECT jsonb_object_agg(entity_type,total) FROM(SELECT entity_type,count(*) AS total FROM samples GROUP BY entity_type)x),
 'appointment_months',(SELECT jsonb_agg(x) FROM(SELECT to_char(a.appointment_date,'YYYY-MM') AS month,count(*) AS appointments,count(*) FILTER(WHERE a.status='Completed') AS completed FROM public.appointments a JOIN samples s ON s.entity_type='appointments' AND s.entity_id=a.appointment_id GROUP BY 1 ORDER BY 1)x),
 'appointment_statuses',(SELECT jsonb_object_agg(status,total) FROM(SELECT a.status,count(*) AS total FROM public.appointments a JOIN samples s ON s.entity_type='appointments' AND s.entity_id=a.appointment_id GROUP BY a.status)x),
 'class_sessions',(SELECT jsonb_object_agg(session,total) FROM(SELECT coalesce(p.class_session,'Not recorded') AS session,count(*) AS total FROM public.patients p JOIN samples s ON s.entity_type='patients' AND s.entity_id=p.patient_id GROUP BY 1)x),
 'user_statuses',(SELECT jsonb_object_agg(status,total) FROM(SELECT u.status,count(*) AS total FROM public.users u JOIN samples s ON s.entity_type='users' AND s.entity_id=u.user_id GROUP BY u.status)x),
 'mismatched_treatments',(SELECT count(*) FROM public.treatments t JOIN samples s ON s.entity_type='treatments' AND s.entity_id=t.treatment_id LEFT JOIN public.appointments a ON a.appointment_id=t.appointment_id WHERE a.appointment_id IS NULL OR a.patient_id<>t.patient_id OR a.doctor_id<>t.doctor_id OR a.appointment_date<>t.treatment_date),
 'unbalanced_inventory',(SELECT count(*) FROM public.inventory_items i JOIN samples s ON s.entity_type='inventory_items' AND s.entity_id=i.item_id WHERE i.quantity<>(SELECT coalesce(sum(CASE WHEN transaction_type='Stock In' THEN quantity ELSE -quantity END),0) FROM public.inventory_transactions tx WHERE tx.item_id=i.item_id)),
 'queued_sample_emails',(SELECT count(*) FROM public.email_outbox e JOIN samples s ON s.entity_type='email_outbox' AND s.entity_id=e.email_id WHERE e.status IN('Pending','Sending')),
 'test_cases_marked_pass',(SELECT count(*) FROM public.uat_test_results u JOIN samples s ON s.entity_type='uat_test_results' AND s.entity_id=u.result_id WHERE u.status='Pass'),
 'booking_trigger_enabled',(SELECT tgenabled='O' FROM pg_trigger WHERE tgrelid='public.appointments'::regclass AND tgname='trg_validate_appointment_integrity')
) AS verification;

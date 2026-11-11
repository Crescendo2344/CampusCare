-- The 9 AM dental start is in 20261111080000_dental_schedule_starts_at_nine.sql.
-- Daily limits: the Dental Clinic caters to 8 patients a day and the Medical Clinic to 15.
-- Medical visits use 30-minute slots so 15 patients fit in the day (one-hour slots hold only 9).
UPDATE public.users
SET max_patients=CASE WHEN specialty='Dental' THEN 8 ELSE 15 END,
    slot_duration=CASE WHEN specialty='Dental' THEN slot_duration ELSE 30 END
WHERE role='Doctor';

UPDATE public.doctor_schedule_rules r
SET max_patients=CASE WHEN u.specialty='Dental' THEN 8 ELSE 15 END,
    slot_duration=CASE WHEN u.specialty='Dental' THEN r.slot_duration ELSE 30 END
FROM public.users u
WHERE u.user_id=r.doctor_id AND u.role='Doctor';

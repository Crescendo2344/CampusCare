-- The first hour of the dental day (8:00 AM) is for sterilizing instruments, so dental doctors start at 9:00 AM.
-- Medical doctors keep their 8:00 AM start. Appointments already booked at 8:00 AM are left as they are.
UPDATE public.users
SET start_time=time '09:00'
WHERE role='Doctor' AND specialty='Dental' AND start_time<time '09:00';

UPDATE public.doctor_schedule_rules r
SET start_time=time '09:00'
FROM public.users u
WHERE u.user_id=r.doctor_id AND u.role='Doctor' AND u.specialty='Dental'
  AND r.is_working AND r.start_time<time '09:00';

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

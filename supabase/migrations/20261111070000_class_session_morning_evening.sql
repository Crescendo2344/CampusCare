-- Students attend either the Morning or the Evening session; there is no mixed session. Records marked
-- "Mixed" cannot be mapped to one of them, so they become "not recorded" (NULL) for staff to fill in.
update public.patients set class_session=null where class_session='Mixed';
alter table public.patients drop constraint if exists patients_class_session_check;
alter table public.patients add constraint patients_class_session_check check (class_session in ('Morning','Evening'));

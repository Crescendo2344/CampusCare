-- Students who shift programs keep one patient record; the course and major can be updated.
alter table public.patients add column if not exists course text;
alter table public.patients add column if not exists major text;
alter table public.patients drop constraint if exists patients_course_length;
alter table public.patients add constraint patients_course_length check (char_length(coalesce(course,''))<=120 and char_length(coalesce(major,''))<=120);
comment on column public.patients.course is 'Current degree program (e.g. BS Information Technology); updated when a student shifts.';
comment on column public.patients.major is 'Current major or specialization within the course, if any.';

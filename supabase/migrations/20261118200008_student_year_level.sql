-- A student's year level (1st to 4th year). Optional; personnel have none.
alter table public.patients add column if not exists year_level smallint;
alter table public.patients drop constraint if exists patients_year_level_check;
alter table public.patients add constraint patients_year_level_check check (year_level is null or year_level between 1 and 4);
comment on column public.patients.year_level is 'Student year level: 1 = 1st Year … 4 = 4th Year.';

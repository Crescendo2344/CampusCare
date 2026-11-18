-- patients is read through a column-level grant (medical history and allergies stay hidden), so the
-- new year_level column must be granted explicitly or every patient list query is refused.
grant select (year_level) on public.patients to authenticated;

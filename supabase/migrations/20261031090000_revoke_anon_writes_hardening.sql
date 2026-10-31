-- Anonymous visitors never write; policies already require a signed-in user, this removes the unused grants too.
revoke insert, update, delete on public.issue_replies, public.issue_reports, public.user_drafts from anon;
-- Signed-in-only helpers are never callable without a session.
revoke execute on function public.list_my_sessions(), public.report_treatment_facts(), public.respond_to_issue_resolution(bigint,boolean,text), public.revoke_my_session(uuid) from public, anon;

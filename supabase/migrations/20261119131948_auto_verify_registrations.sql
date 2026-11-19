-- Automatic verification of new registrations. When a patient who registered online confirms their
-- email, the account becomes Active at once: no staff approval is needed. Each auto-verified account
-- stays listed for administrators (Approvals → Auto-verified) with its ID photos and selfie, so it can
-- still be checked and suspended. Administrators can turn this off; registrations then wait for review.
alter table public.system_settings add column if not exists auto_verify_registrations boolean not null default true;
alter table public.users add column if not exists auto_verified_at timestamptz;
alter table public.users add column if not exists auto_verify_reviewed_at timestamptz;
alter table public.users add column if not exists auto_verify_reviewed_by bigint references public.users(user_id);
create index if not exists users_auto_verified_idx on public.users(auto_verified_at) where auto_verified_at is not null;

create or replace function public.auto_verify_confirmed_registration()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_enabled boolean; v_user bigint;
begin
  if new.email_confirmed_at is null or old.email_confirmed_at is not null then return new; end if;
  begin
    select coalesce(s.auto_verify_registrations,true) into v_enabled from public.system_settings s order by s.settings_id limit 1;
    if not coalesce(v_enabled,true) then return new; end if;
    -- Only a complete online registration: a Pending patient with a selfie and both ID sides.
    update public.users u
       set status='Active',verified=true,auto_verified_at=now()
     where u.auth_user_id=new.id and u.role='Patient' and u.status='Pending'
       and u.verification_selfie_url is not null and u.id_file_url is not null and u.id_back_file_url is not null
    returning u.user_id into v_user;
    if v_user is null then return new; end if;
    insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
    values(null,'USER_AUTO_VERIFIED','users',v_user,jsonb_build_object(
      'previous_status','Pending','new_status','Active','trigger','email_confirmed',
      'id_scan',coalesce(new.raw_user_meta_data->'id_scan','null'::jsonb)));
    -- An Account notification is also emailed to the patient.
    insert into public.notifications(user_id,title,message,type,channel,delivery_status)
    values(v_user,'Account approved','Your email is confirmed and your CampusCare account is verified. You may now sign in and book appointments.','Account','In-app','Created');
  exception when others then
    -- Never block the email confirmation itself; the registration then waits for manual review.
    raise warning 'auto verification skipped: %',sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.auto_verify_confirmed_registration() from public, anon, authenticated;

drop trigger if exists trg_auto_verify_confirmed_registration on auth.users;
create trigger trg_auto_verify_confirmed_registration
  after update of email_confirmed_at on auth.users
  for each row execute function public.auto_verify_confirmed_registration();

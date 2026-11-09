-- Feedback & Issues works like a small helpdesk: reports carry a priority and an assignee, administrators
-- can leave internal notes the reporter never sees, and a reporter can confirm a fix or reopen the report.
alter table public.issue_reports
  add column if not exists priority varchar(10) not null default 'Normal',
  add column if not exists assigned_to bigint references public.users(user_id) on delete set null,
  add column if not exists device_info text,
  add column if not exists reporter_rating smallint;

alter table public.issue_reports drop constraint if exists issue_reports_priority_check;
alter table public.issue_reports add constraint issue_reports_priority_check check (priority in ('Low','Normal','High','Urgent'));
alter table public.issue_reports drop constraint if exists issue_reports_rating_check;
alter table public.issue_reports add constraint issue_reports_rating_check check (reporter_rating in (-1,1));

alter table public.issue_replies add column if not exists is_internal boolean not null default false;

-- Stock changes record when they were entered, so a mistaken one can be undone shortly afterwards.
alter table public.inventory_transactions add column if not exists created_at timestamptz;
update public.inventory_transactions set created_at=transaction_date where created_at is null;
alter table public.inventory_transactions alter column created_at set default now();
alter table public.inventory_transactions alter column created_at set not null;

-- Reporters file a report; triage fields are set by administrators.
drop policy if exists issue_reports_insert on public.issue_reports;
create policy issue_reports_insert on public.issue_reports
  for insert to authenticated
  with check (
    reporter_id = (select private.current_app_user_id())
    and priority = 'Normal' and assigned_to is null and reporter_rating is null
  );

-- Reporters never see internal notes; only administrators can write them.
drop policy if exists issue_replies_select on public.issue_replies;
create policy issue_replies_select on public.issue_replies
  for select to authenticated
  using (
    (select private.has_role(array['Administrator']::text[]))
    or (
      not is_internal
      and exists (
        select 1 from public.issue_reports r
        where r.issue_id = issue_replies.issue_id
          and r.reporter_id = (select private.current_app_user_id())
      )
    )
  );

drop policy if exists issue_replies_insert on public.issue_replies;
create policy issue_replies_insert on public.issue_replies
  for insert to authenticated
  with check (
    author_id = (select private.current_app_user_id())
    and (not is_internal or (select private.has_role(array['Administrator']::text[])))
    and exists (
      select 1 from public.issue_reports r
      where r.issue_id = issue_replies.issue_id
        and (
          (select private.has_role(array['Administrator']::text[]))
          or (r.reporter_id = (select private.current_app_user_id()) and r.status not in ('Resolved','Dismissed'))
        )
    )
  );

-- Internal notes are logged but change nothing and notify no one.
create or replace function public.issue_reply_after_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_issue public.issue_reports;
  v_role text;
begin
  select * into v_issue from public.issue_reports where issue_id=new.issue_id;
  select role into v_role from public.users where user_id=new.author_id;

  insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
  values (
    new.author_id,
    case when new.is_internal then 'ISSUE_INTERNAL_NOTE_ADDED' else 'ISSUE_REPLY_ADDED' end,
    'issue_reports',new.issue_id,
    jsonb_build_object('reply_id',new.reply_id)
  );

  if new.is_internal then
    return new;
  end if;

  if v_role='Administrator' then
    if v_issue.status='Open' then
      update public.issue_reports
      set status='In Review',updated_at=now()
      where issue_id=new.issue_id;
    end if;

    insert into public.notifications(
      user_id,title,message,type,channel,delivery_status,
      reference_type,reference_id,action_page
    ) values (
      v_issue.reporter_id,
      'Reply to Your CampusCare Report',
      'An administrator replied to your report. Open Report an Issue to view the response.',
      'Account','In-app','Created',
      'issue_reports',new.issue_id,'report-issue'
    );
  else
    insert into public.notifications(
      user_id,title,message,type,channel,delivery_status,
      reference_type,reference_id,action_page
    )
    select
      u.user_id,
      'New Reply on a CampusCare Report',
      'A reporter replied to an existing issue or feedback thread.',
      'Account','In-app','Created',
      'issue_reports',new.issue_id,'feedback-issues'
    from public.users u
    where u.role='Administrator' and u.status='Active';
  end if;

  return new;
end;
$function$;

-- Status, priority and assignee changes are all logged. Closing a report tells the reporter;
-- reopening it soon after (an administrator's undo) withdraws that notice.
create or replace function public.issue_report_status_after_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor bigint := coalesce(private.current_app_user_id(), new.resolved_by);
begin
  if new.status is distinct from old.status then
    if new.status in ('Resolved','Dismissed') then
      insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
      values (
        v_actor,
        case when new.status='Resolved' then 'ISSUE_REPORT_RESOLVED' else 'ISSUE_REPORT_DISMISSED' end,
        'issue_reports',new.issue_id,
        jsonb_build_object('admin_note',new.admin_note,'previous_status',old.status)
      );

      insert into public.notifications(
        user_id,title,message,type,channel,delivery_status,
        reference_type,reference_id,action_page
      ) values (
        new.reporter_id,
        case when new.status='Resolved' then 'Your Report Was Resolved' else 'Your Report Was Reviewed' end,
        'Your '||lower(new.issue_type)||' report '||
        case when new.status='Resolved' then 'has been marked resolved.' else 'was reviewed and closed.' end ||
        case when nullif(trim(coalesce(new.admin_note,'')),'') is not null then ' Note: '||new.admin_note else '' end,
        'Account','In-app','Created',
        'issue_reports',new.issue_id,'report-issue'
      );
    elsif old.status in ('Resolved','Dismissed') then
      insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
      values (v_actor,'ISSUE_REPORT_REOPENED','issue_reports',new.issue_id,
        jsonb_build_object('previous_status',old.status,'new_status',new.status));

      if v_actor = new.reporter_id then
        insert into public.notifications(
          user_id,title,message,type,channel,delivery_status,
          reference_type,reference_id,action_page
        )
        select u.user_id,'Report Reopened',
          'A reporter says their '||lower(new.issue_type)||' report is not fixed yet and reopened it.',
          'Account','In-app','Created','issue_reports',new.issue_id,'feedback-issues'
        from public.users u
        where u.role='Administrator' and u.status='Active';
      elsif old.resolved_at is not null and old.resolved_at > now() - interval '15 minutes' then
        delete from public.notifications
        where user_id=new.reporter_id and reference_type='issue_reports' and reference_id=new.issue_id
          and title in ('Your Report Was Resolved','Your Report Was Reviewed')
          and created_at >= old.resolved_at - interval '1 minute';
      end if;
    else
      insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
      values (v_actor,'ISSUE_STATUS_CHANGED','issue_reports',new.issue_id,
        jsonb_build_object('previous_status',old.status,'new_status',new.status));
    end if;
  end if;

  if new.priority is distinct from old.priority then
    insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
    values (v_actor,'ISSUE_PRIORITY_CHANGED','issue_reports',new.issue_id,
      jsonb_build_object('previous_priority',old.priority,'new_priority',new.priority));
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.audit_logs(user_id,action,entity_type,entity_id,details)
    values (v_actor,'ISSUE_ASSIGNED','issue_reports',new.issue_id,
      jsonb_build_object('previous_assignee',old.assigned_to,'assignee',new.assigned_to));
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_issue_report_status_after_update on public.issue_reports;
create trigger trg_issue_report_status_after_update
  after update on public.issue_reports
  for each row execute function public.issue_report_status_after_update();

-- A reporter answers "Did this fix it?" on a resolved report: yes records the rating,
-- no reopens it with their explanation as a reply.
create or replace function public.respond_to_issue_resolution(p_issue_id bigint, p_fixed boolean, p_message text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user bigint := private.current_app_user_id();
  v_issue public.issue_reports;
  v_message text := nullif(btrim(coalesce(p_message,'')),'');
begin
  select * into v_issue from public.issue_reports where issue_id=p_issue_id for update;
  if not found or v_issue.reporter_id is distinct from v_user then
    raise exception 'Report not found.';
  end if;
  if v_issue.status <> 'Resolved' then
    raise exception 'Only resolved reports can be confirmed or reopened.';
  end if;

  if p_fixed then
    update public.issue_reports set reporter_rating=1, updated_at=now() where issue_id=p_issue_id;
    return;
  end if;

  if v_issue.resolved_at < now() - interval '30 days' then
    raise exception 'This report was resolved more than 30 days ago. Please submit a new report.';
  end if;
  if v_message is null or length(v_message) < 3 then
    raise exception 'Tell the administrators what is still wrong.';
  end if;

  update public.issue_reports
  set status='Open', reporter_rating=-1, resolved_at=null, resolved_by=null, updated_at=now()
  where issue_id=p_issue_id;

  insert into public.issue_replies(issue_id,author_id,body) values (p_issue_id, v_user, left(v_message,3000));
end;
$function$;

revoke all on function public.respond_to_issue_resolution(bigint,boolean,text) from public, anon;
grant execute on function public.respond_to_issue_resolution(bigint,boolean,text) to authenticated;

-- Medical Clinic and Dental Clinic staff are separated. Both see the shared patient list, but appointments,
-- visit facts, released certificates and fitness results, inventory, purchase orders and surveys are limited
-- to the staff member's own clinic. Doctors belong to a clinic through their specialization.

alter table public.users add column if not exists clinic text;
alter table public.users drop constraint if exists users_clinic_check;
alter table public.users add constraint users_clinic_check check (clinic is null or clinic in ('Medical Clinic','Dental Clinic'));
-- Existing staff are not tied to dental anywhere, so they join the Medical Clinic.
update public.users set clinic='Medical Clinic' where role='Staff' and clinic is null;
alter table public.users drop constraint if exists users_staff_clinic_required;
alter table public.users add constraint users_staff_clinic_required check (role<>'Staff' or clinic is not null);

alter table public.inventory_items add column if not exists clinic text;
update public.inventory_items set clinic=case when category='Dental' then 'Dental Clinic' else 'Medical Clinic' end where clinic is null;
alter table public.inventory_items alter column clinic set default 'Medical Clinic';
alter table public.inventory_items alter column clinic set not null;
alter table public.inventory_items drop constraint if exists inventory_items_clinic_check;
alter table public.inventory_items add constraint inventory_items_clinic_check check (clinic in ('Medical Clinic','Dental Clinic'));

alter table public.purchase_orders add column if not exists clinic text;
update public.purchase_orders set clinic='Medical Clinic' where clinic is null;
alter table public.purchase_orders alter column clinic set default 'Medical Clinic';
alter table public.purchase_orders alter column clinic set not null;
alter table public.purchase_orders drop constraint if exists purchase_orders_clinic_check;
alter table public.purchase_orders add constraint purchase_orders_clinic_check check (clinic in ('Medical Clinic','Dental Clinic'));

-- The clinic a person works in: a doctor's comes from the specialization, a staff member's is assigned.
create or replace function private.user_clinic(p_user_id bigint)
returns text language sql stable security definer set search_path to '' as $$
  select case when u.role='Doctor' then case when u.specialty='Dental' then 'Dental Clinic' else 'Medical Clinic' end
              when u.role='Staff' then u.clinic end
    from public.users u where u.user_id=p_user_id
$$;
create or replace function private.current_clinic()
returns text language sql stable security definer set search_path to '' as $$
  select private.user_clinic(u.user_id) from public.users u where u.auth_user_id=(select auth.uid()) and u.status='Active' limit 1
$$;
revoke all on function private.user_clinic(bigint) from public, anon;
revoke all on function private.current_clinic() from public, anon;
grant execute on function private.user_clinic(bigint) to authenticated;
grant execute on function private.current_clinic() to authenticated;

-- Appointments: the patient, the assigned doctor, administrators, and staff of that clinic.
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated using (
  patient_id=(select private.current_patient_id())
  or doctor_id=(select private.current_app_user_id())
  or (select private.has_role(array['Administrator'::text]))
  or ((select private.has_role(array['Staff'::text])) and clinic=(select private.current_clinic()))
);

-- Released certificates and completed fitness results: staff of the issuing doctor's clinic.
drop policy if exists certificates_staff_release_select on public.medical_certificates;
create policy certificates_staff_release_select on public.medical_certificates for select to authenticated using (
  (select private.has_role(array['Staff'::text])) and status::text in ('Issued','Cancelled')
  and private.user_clinic(doctor_id)=(select private.current_clinic())
);
drop policy if exists fitness_staff_release_select on public.fitness_assessments;
create policy fitness_staff_release_select on public.fitness_assessments for select to authenticated using (
  (select private.has_role(array['Staff'::text])) and status::text='Completed'
  and private.user_clinic(doctor_id)=(select private.current_clinic())
);

-- Inventory belongs to one clinic.
drop policy if exists inventory_items_read on public.inventory_items;
create policy inventory_items_read on public.inventory_items for select to authenticated using (
  (select private.has_role(array['Administrator'::text]))
  or ((select private.has_role(array['Doctor'::text,'Staff'::text])) and clinic=(select private.current_clinic()))
);
drop policy if exists inventory_transactions_read on public.inventory_transactions;
create policy inventory_transactions_read on public.inventory_transactions for select to authenticated using (
  (select private.has_role(array['Administrator'::text]))
  or ((select private.has_role(array['Staff'::text])) and exists(select 1 from public.inventory_items i where i.item_id=inventory_transactions.item_id and i.clinic=(select private.current_clinic())))
);
drop policy if exists inventory_forecasts_read on public.inventory_forecasts;
create policy inventory_forecasts_read on public.inventory_forecasts for select to authenticated using (
  (select private.has_role(array['Administrator'::text]))
  or ((select private.has_role(array['Staff'::text])) and exists(select 1 from public.inventory_items i where i.item_id=inventory_forecasts.item_id and i.clinic=(select private.current_clinic())))
);
drop policy if exists inventory_requests_read on public.inventory_requests;
create policy inventory_requests_read on public.inventory_requests for select to authenticated using (
  requested_by=(select private.current_app_user_id())
  or ((select private.has_role(array['Staff'::text])) and exists(select 1 from public.inventory_items i where i.item_id=inventory_requests.item_id and i.clinic=(select private.current_clinic())))
);
drop policy if exists purchase_orders_read on public.purchase_orders;
create policy purchase_orders_read on public.purchase_orders for select to authenticated using (
  (select private.has_role(array['Staff'::text])) and clinic=(select private.current_clinic())
);
drop policy if exists purchase_order_items_read on public.purchase_order_items;
create policy purchase_order_items_read on public.purchase_order_items for select to authenticated using (
  (select private.has_role(array['Staff'::text])) and exists(select 1 from public.purchase_orders po where po.po_id=purchase_order_items.po_id and po.clinic=(select private.current_clinic()))
);

-- Clinic surveys: the respondent, administrators, and staff of the surveyed clinic.
drop policy if exists clinic_surveys_select on public.clinic_surveys;
create policy clinic_surveys_select on public.clinic_surveys for select to authenticated using (
  patient_id=(select private.current_patient_id())
  or (select private.has_role(array['Administrator'::text]))
  or ((select private.has_role(array['Staff'::text])) and clinic_type=(select private.current_clinic()))
);

-- Report facts on visits: administrators see all; staff see their clinic's visits.
create or replace function public.report_treatment_facts()
returns table(treatment_id bigint, patient_id bigint, doctor_id bigint, appointment_id bigint, diagnosis text, treatment_date date, status text, archived_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select t.treatment_id, t.patient_id, t.doctor_id, t.appointment_id, t.diagnosis::text, t.treatment_date, t.status::text, t.archived_at
    from public.treatments t
    left join public.appointments a on a.appointment_id=t.appointment_id
   where private.has_role(array['Administrator']::text[])
      or (private.has_role(array['Staff']::text[]) and coalesce(a.clinic,private.user_clinic(t.doctor_id))=private.current_clinic())
   order by t.treatment_id;
$$;

-- Daily stock watch: reminders go to the staff of the item's clinic.
create or replace function private.inventory_stock_watch()
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  r record; v_sent integer:=0; v_key text; v_today date:=(now() at time zone 'Asia/Manila')::date;
begin
  for r in
    select i.item_id,i.item_name,i.quantity,i.unit,i.expiry_date,i.clinic,
           coalesce((select sum(t.quantity) from public.inventory_transactions t
                      where t.item_id=i.item_id and t.transaction_type='Disbursement' and t.transaction_date>=now()-interval '90 days'),0)/90.0 as per_day,
           exists(select 1 from public.purchase_order_items pi join public.purchase_orders po on po.po_id=pi.po_id
                   where pi.item_id=i.item_id and po.status in ('Prepared','Sent')) as on_order
      from public.inventory_items i where not i.archived
  loop
    if r.per_day>0 and r.quantity/r.per_day<=30 and not r.on_order then
      v_key:='reorder:'||r.item_id||':'||to_char(v_today,'IYYY-IW');
      if not exists(select 1 from public.notifications where notification_key like v_key||'%') then
        insert into public.notifications(user_id,title,message,type,channel,delivery_status,reference_type,reference_id,action_page,notification_key)
        select u.user_id,'Place a purchase order',
               r.item_name||' runs out in about '||greatest(0,floor(r.quantity/r.per_day))::int||' days at the current rate ('||r.quantity||' '||coalesce(r.unit,'')||' left). Order now so it arrives in time.',
               'Inventory','In-app','Created','inventory_items',r.item_id,'inventory',v_key||':'||u.user_id
          from public.users u where u.role='Staff' and u.status='Active' and u.clinic=r.clinic;
        v_sent:=v_sent+1;
      end if;
    end if;
    if r.expiry_date is not null and r.quantity>0 and r.expiry_date<=v_today+30 then
      v_key:='expiry:'||r.item_id||':'||to_char(v_today,'IYYY-IW');
      if not exists(select 1 from public.notifications where notification_key like v_key||'%') then
        insert into public.notifications(user_id,title,message,type,channel,delivery_status,reference_type,reference_id,action_page,notification_key)
        select u.user_id,case when r.expiry_date<v_today then 'Expired stock on hand' else 'Medicine expiring soon' end,
               r.item_name||' ('||r.quantity||' '||coalesce(r.unit,'')||') '||case when r.expiry_date<v_today then 'expired on '||to_char(r.expiry_date,'FMMon DD, YYYY')||'. Remove it from stock.' else 'expires on '||to_char(r.expiry_date,'FMMon DD, YYYY')||'. Use it first or plan its replacement.' end,
               'Inventory','In-app','Created','inventory_items',r.item_id,'inventory',v_key||':'||u.user_id
          from public.users u where u.role='Staff' and u.status='Active' and u.clinic=r.clinic;
        v_sent:=v_sent+1;
      end if;
    end if;
  end loop;
  return v_sent;
end;
$$;
revoke all on function private.inventory_stock_watch() from public, anon, authenticated;

-- Medicine requests: a doctor asks for medicine (for a patient or the clinic room); staff release it,
-- which deducts stock, or decline it with a reason.
create table if not exists public.inventory_requests(
  request_id bigint generated always as identity primary key,
  item_id bigint not null references public.inventory_items(item_id),
  quantity integer not null check (quantity>0),
  requested_by bigint not null references public.users(user_id),
  patient_id bigint references public.patients(patient_id),
  purpose text,
  status text not null default 'Pending' check (status in ('Pending','Released','Declined','Withdrawn')),
  decided_by bigint references public.users(user_id),
  decided_at timestamptz,
  decline_reason text,
  transaction_id bigint references public.inventory_transactions(transaction_id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_requests_status_idx on public.inventory_requests(status,created_at);
alter table public.inventory_requests enable row level security;
drop policy if exists inventory_requests_read on public.inventory_requests;
create policy inventory_requests_read on public.inventory_requests for select to authenticated
  using ((select private.has_role(array['Staff'::text])) or requested_by=(select private.current_app_user_id()));

-- Purchase orders: staff order stock before it runs out; an administrator approves; staff record receipt,
-- which adds the stock.
create table if not exists public.purchase_orders(
  po_id bigint generated always as identity primary key,
  po_no text unique,
  status text not null default 'Submitted' check (status in ('Submitted','Approved','Rejected','Received')),
  supplier text,
  notes text,
  needed_by date,
  created_by bigint not null references public.users(user_id),
  decided_by bigint references public.users(user_id),
  decided_at timestamptz,
  reject_reason text,
  received_by bigint references public.users(user_id),
  received_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.purchase_order_items(
  po_item_id bigint generated always as identity primary key,
  po_id bigint not null references public.purchase_orders(po_id) on delete cascade,
  item_id bigint not null references public.inventory_items(item_id),
  quantity integer not null check (quantity>0),
  unit_cost numeric(12,2),
  unique(po_id,item_id)
);
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
drop policy if exists purchase_orders_read on public.purchase_orders;
create policy purchase_orders_read on public.purchase_orders for select to authenticated
  using ((select private.has_role(array['Staff'::text,'Administrator'::text])));
drop policy if exists purchase_order_items_read on public.purchase_order_items;
create policy purchase_order_items_read on public.purchase_order_items for select to authenticated
  using ((select private.has_role(array['Staff'::text,'Administrator'::text])));
-- Writes happen only in inventory-actions (service role).
revoke insert,update,delete on public.inventory_requests,public.purchase_orders,public.purchase_order_items from anon,authenticated;

-- Daily stock watch for staff: order a month before an item runs out (from the last 90 days of use),
-- and keep track of medicine that is expired or expires within 30 days. One reminder per item per week.
create or replace function private.inventory_stock_watch()
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  r record; v_sent integer:=0; v_key text; v_today date:=(now() at time zone 'Asia/Manila')::date;
begin
  for r in
    select i.item_id,i.item_name,i.quantity,i.unit,i.expiry_date,
           coalesce((select sum(t.quantity) from public.inventory_transactions t
                      where t.item_id=i.item_id and t.transaction_type='Disbursement' and t.transaction_date>=now()-interval '90 days'),0)/90.0 as per_day,
           exists(select 1 from public.purchase_order_items pi join public.purchase_orders po on po.po_id=pi.po_id
                   where pi.item_id=i.item_id and po.status in ('Submitted','Approved')) as on_order
      from public.inventory_items i where not i.archived
  loop
    -- Reorder: stock lasts 30 days or less at the recent rate, and nothing is on order yet.
    if r.per_day>0 and r.quantity/r.per_day<=30 and not r.on_order then
      v_key:='reorder:'||r.item_id||':'||to_char(v_today,'IYYY-IW');
      if not exists(select 1 from public.notifications where notification_key like v_key||'%') then
        insert into public.notifications(user_id,title,message,type,channel,delivery_status,reference_type,reference_id,action_page,notification_key)
        select u.user_id,'Place a purchase order',
               r.item_name||' runs out in about '||greatest(0,floor(r.quantity/r.per_day))::int||' days at the current rate ('||r.quantity||' '||coalesce(r.unit,'')||' left). Order now so it arrives in time.',
               'Inventory','In-app','Created','inventory_items',r.item_id,'inventory',v_key||':'||u.user_id
          from public.users u where u.role='Staff' and u.status='Active';
        v_sent:=v_sent+1;
      end if;
    end if;
    -- Expiry trace: expired stock still on the shelf, or stock expiring within 30 days.
    if r.expiry_date is not null and r.quantity>0 and r.expiry_date<=v_today+30 then
      v_key:='expiry:'||r.item_id||':'||to_char(v_today,'IYYY-IW');
      if not exists(select 1 from public.notifications where notification_key like v_key||'%') then
        insert into public.notifications(user_id,title,message,type,channel,delivery_status,reference_type,reference_id,action_page,notification_key)
        select u.user_id,case when r.expiry_date<v_today then 'Expired stock on hand' else 'Medicine expiring soon' end,
               r.item_name||' ('||r.quantity||' '||coalesce(r.unit,'')||') '||case when r.expiry_date<v_today then 'expired on '||to_char(r.expiry_date,'FMMon DD, YYYY')||'. Remove it from stock.' else 'expires on '||to_char(r.expiry_date,'FMMon DD, YYYY')||'. Use it first or plan its replacement.' end,
               'Inventory','In-app','Created','inventory_items',r.item_id,'inventory',v_key||':'||u.user_id
          from public.users u where u.role='Staff' and u.status='Active';
        v_sent:=v_sent+1;
      end if;
    end if;
  end loop;
  return v_sent;
end;
$$;
revoke all on function private.inventory_stock_watch() from public, anon, authenticated;

do $$
begin
  if exists(select 1 from cron.job where jobname='campuscare-inventory-stock-watch') then
    perform cron.unschedule('campuscare-inventory-stock-watch');
  end if;
  perform cron.schedule('campuscare-inventory-stock-watch','20 23 * * *',$job$select private.inventory_stock_watch();$job$);
end $$;

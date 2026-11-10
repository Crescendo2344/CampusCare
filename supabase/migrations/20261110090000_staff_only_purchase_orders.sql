-- Purchase orders are handled by staff alone: staff prepare the order, print it for the person or office that
-- buys, mark it sent, and record the delivery (which adds the stock). There is no administrator approval.
alter table public.purchase_orders drop constraint if exists purchase_orders_status_check;
update public.purchase_orders set status=case status when 'Submitted' then 'Prepared' when 'Approved' then 'Sent' when 'Rejected' then 'Cancelled' else status end;
alter table public.purchase_orders alter column status set default 'Prepared';
alter table public.purchase_orders add constraint purchase_orders_status_check check (status in ('Prepared','Sent','Received','Cancelled'));
alter table public.purchase_orders rename column decided_by to sent_by;
alter table public.purchase_orders rename column decided_at to sent_at;
alter table public.purchase_orders rename column reject_reason to cancel_reason;
alter table public.purchase_orders add column if not exists cancelled_at timestamptz;

drop policy if exists purchase_orders_read on public.purchase_orders;
create policy purchase_orders_read on public.purchase_orders for select to authenticated
  using ((select private.has_role(array['Staff'::text])));
drop policy if exists purchase_order_items_read on public.purchase_order_items;
create policy purchase_order_items_read on public.purchase_order_items for select to authenticated
  using ((select private.has_role(array['Staff'::text])));

-- The daily stock watch treats prepared and sent orders as "on order".
do $$
declare d text;
begin
  d:=pg_get_functiondef('private.inventory_stock_watch()'::regprocedure);
  d:=replace(d,$x$po.status in ('Submitted','Approved')$x$,$x$po.status in ('Prepared','Sent')$x$);
  execute d;
end $$;

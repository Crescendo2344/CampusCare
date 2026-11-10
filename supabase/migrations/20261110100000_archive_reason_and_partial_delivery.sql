-- Why an item was archived (Discontinued, Expired, Inactive or Other: note), and what actually arrived on a
-- purchase order: only the quantity received in good condition goes into stock, with a note for any shortfall.
alter table public.inventory_items add column if not exists archive_reason text;
alter table public.purchase_order_items add column if not exists received_quantity integer check (received_quantity is null or received_quantity>=0);
alter table public.purchase_orders add column if not exists receive_note text;

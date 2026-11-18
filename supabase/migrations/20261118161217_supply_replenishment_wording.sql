-- "Purchase order" is now called "Supply Replenishment" for both the Medical and Dental Clinic.
-- Only wording changes: the daily stock watch reminder title, and reminders already in staff inboxes.
-- Tables, columns and audit actions keep their purchase_order names.
do $$
declare d text;
begin
  d:=pg_get_functiondef('private.inventory_stock_watch()'::regprocedure);
  if position('Place a purchase order' in d)>0 then
    execute replace(d,'Place a purchase order','Request supply replenishment');
  end if;
end $$;

update public.notifications set title='Request supply replenishment' where title='Place a purchase order';

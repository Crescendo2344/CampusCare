-- Dental Clinic stock with three months of deliveries and use (Aug 3 – Nov 13, 2026).
-- Deliveries arrive on the 1st of each month; use is tallied every Tuesday and Friday.
-- Three items came short in November, so they appear on the low-stock list.
-- Safe to run again: an item that already exists in the Dental Clinic is skipped.
do $$
declare
  r record; v_item bigint; v_qty int; v_monthly int; v_owed numeric; v_use int; v_got int;
  d date; v_start constant date:='2026-08-03'; v_today constant date:='2026-11-13';
  v_staff bigint:=(select user_id from public.users where role='Staff' and clinic='Dental Clinic' order by user_id limit 1);
begin
  for r in select * from (values
    ('Lidocaine 2% with Epinephrine Cartridge','Medicine','cartridge',30,'Dentaltech Cebu',38.00,date '2027-06-30',1,14.0,true),
    ('Mepivacaine 3% Cartridge','Medicine','cartridge',20,'Dentaltech Cebu',42.00,date '2027-05-31',1,5.0,false),
    ('Benzocaine 20% Topical Gel','Medicine','jar',2,'Dentaltech Cebu',310.00,date '2027-03-31',1,0.5,false),
    ('Mefenamic Acid 500 mg Capsule','Medicine','capsule',40,'Visayas Pharma Distributors',4.50,date '2027-08-31',3,9.0,false),
    ('Amoxicillin 500 mg Capsule','Medicine','capsule',40,'Visayas Pharma Distributors',6.00,date '2027-02-28',3,7.0,false),
    ('Fluoride Varnish 5% (Single Dose)','Dental','dose',20,'Oral Care Supply PH',55.00,date '2027-01-31',1,8.0,true),
    ('Glass Ionomer Restorative Cement','Dental','kit',1,'Dentaltech Cebu',1850.00,date '2027-09-30',1,0.25,false),
    ('Composite Resin A2 Syringe','Dental','syringe',3,'Dentaltech Cebu',980.00,date '2027-07-31',1,0.8,false),
    ('Zinc Oxide Eugenol Temporary Filling','Dental','pack',1,'Oral Care Supply PH',420.00,date '2027-04-30',1,0.4,false),
    ('Prophylaxis Paste (Medium Grit)','Dental','cup',30,'Oral Care Supply PH',12.00,date '2027-06-30',1,12.0,false),
    ('Absorbable Gelatin Sponge','Dental','piece',10,'Dentaltech Cebu',35.00,date '2028-01-31',1,4.0,false),
    ('Dental Cotton Rolls','Supplies','pack',6,'Cebu Medical Supply Co.',65.00,null::date,1,3.0,false),
    ('Saliva Ejector Tips','Supplies','piece',50,'Oral Care Supply PH',3.00,null::date,1,20.0,true),
    ('Disposable Dental Bibs','Supplies','piece',50,'Oral Care Supply PH',2.50,null::date,1,20.0,false),
    ('Dental Needles 27G Short','Supplies','piece',40,'Dentaltech Cebu',6.00,date '2029-12-31',1,16.0,false),
    ('Nitrile Examination Gloves (Small)','Supplies','box',3,'Cebu Medical Supply Co.',320.00,date '2028-06-30',1,1.2,false),
    ('Surgical Face Masks (3-Ply)','Supplies','box',3,'Cebu Medical Supply Co.',150.00,date '2028-06-30',1,1.2,false),
    ('Dental Mouth Mirror #5','Equipment','piece',5,'Dentaltech Cebu',85.00,null::date,12,0.0,false),
    ('Extraction Forceps (Upper Molar)','Equipment','piece',2,'Dentaltech Cebu',1450.00,null::date,4,0.0,false)
  ) as t(name,category,unit,threshold,supplier,cost,expiry,per_use,per_week,short_nov)
  loop
    continue when exists(select 1 from public.inventory_items where item_name=r.name and clinic='Dental Clinic');
    insert into public.inventory_items(item_name,category,quantity,threshold,unit,expiry_date,supplier,unit_cost,clinic,archived)
      values(r.name,r.category,0,r.threshold,r.unit,r.expiry,r.supplier,r.cost,'Dental Clinic',false) returning item_id into v_item;
    if r.category='Equipment' then
      v_qty:=r.per_use;  -- the count on hand
      insert into public.inventory_transactions(item_id,transaction_type,quantity,transaction_date,notes,created_by)
        values(v_item,'Stock In',v_qty,(v_start+time '09:00') at time zone 'Asia/Manila','Initial count',v_staff);
    else
      v_monthly:=greatest(1,round(r.per_week*r.per_use*4.4*1.1)::int);
      v_qty:=v_monthly; v_owed:=0;
      insert into public.inventory_transactions(item_id,transaction_type,quantity,transaction_date,notes,created_by)
        values(v_item,'Stock In',v_monthly,(v_start+time '09:00') at time zone 'Asia/Manila','Opening stock',v_staff);
      d:=v_start;
      while d<=v_today loop
        if extract(day from d)=1 and d>v_start then
          v_got:=case when extract(month from d)=11 and r.short_nov then round(v_monthly*0.4)::int else v_monthly end;
          v_qty:=v_qty+v_got;
          insert into public.inventory_transactions(item_id,transaction_type,quantity,transaction_date,notes,created_by)
            values(v_item,'Stock In',v_got,(d+time '09:00') at time zone 'Asia/Manila',case when v_got=v_monthly then 'Monthly restock delivery' else 'Partial delivery (supplier short)' end,v_staff);
        end if;
        if extract(isodow from d) in (2,5) then
          v_owed:=v_owed+r.per_week*r.per_use/2;
          v_use:=least(floor(v_owed)::int,v_qty);
          if v_use>0 then
            v_owed:=v_owed-v_use; v_qty:=v_qty-v_use;
            insert into public.inventory_transactions(item_id,transaction_type,quantity,transaction_date,notes,created_by)
              values(v_item,'Disbursement',v_use,(d+time '15:00') at time zone 'Asia/Manila','Used during dental procedures',v_staff);
          end if;
        end if;
        d:=d+1;
      end loop;
    end if;
    update public.inventory_items set quantity=v_qty,updated_at=now() where item_id=v_item;
  end loop;
end $$;

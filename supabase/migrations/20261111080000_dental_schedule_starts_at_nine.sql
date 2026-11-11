-- Dental appointments start at 9 AM to allow time for instrument sterilization.
-- Medical schedules remain unchanged.
update public.users
   set start_time='09:00'
 where role='Doctor'
   and specialty='Dental'
   and start_time='08:00';

update public.doctor_schedule_rules r
   set start_time='09:00'
  from public.users u
 where r.doctor_id=u.user_id
   and u.role='Doctor'
   and u.specialty='Dental'
   and r.is_working
   and r.start_time='08:00'
   and (r.effective_to is null or r.effective_to >= current_date);

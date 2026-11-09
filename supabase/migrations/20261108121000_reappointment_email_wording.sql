-- The "will not push through" email keeps the clinic's apology and the proposed time in its first line,
-- instead of the generic "your appointment is booked" intro.
do $$
declare d text;
begin
  d:=pg_get_functiondef('private.render_notification_email(bigint)'::regprocedure);
  if position('push through' in d)=0 then
    d:=replace(d,
      $x$when n.title ilike '%resched%' then 'Your appointment has been moved to the new date and time below.'$x$,
      $x$when n.title ilike '%push through%' then n.message
        when n.title ilike '%resched%' then 'Your appointment has been moved to the new date and time below.'$x$);
    d:=replace(d,
      $x$when n.title ilike '%resched%' then '#5b4fd6'$x$,
      $x$when n.title ilike '%push through%' then '#8f5200' when n.title ilike '%resched%' then '#5b4fd6'$x$);
    execute d;
  end if;
end $$;

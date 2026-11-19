-- A declined reschedule request is emailed in its own words (not "your appointment has been moved").
do $$
declare d text;
begin
  d:=pg_get_functiondef('private.render_notification_email(bigint)'::regprocedure);
  if position('%declined%' in d)=0 then
    d:=replace(d,$x$when n.title ilike '%push through%' then '#8f5200' when n.title ilike '%resched%'$x$,$x$when n.title ilike '%push through%' then '#8f5200' when n.title ilike '%declined%' then '#8f5200' when n.title ilike '%resched%'$x$);
    d:=replace(d,$x$when n.title ilike '%push through%' then n.message
        when n.title ilike '%resched%'$x$,$x$when n.title ilike '%push through%' then n.message
        when n.title ilike '%declined%' then n.message
        when n.title ilike '%resched%'$x$);
    execute d;
  end if;
end $$;

-- Run against a migrated database. Random synthetic subjects are removed before this test finishes.
do $$
declare
  subject text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  kind text;
  threshold integer;
  result jsonb;
begin
  foreach kind in array array['ip','email','id'] loop
    threshold := case when kind='ip' then 30 else 5 end;
    for i in 1..threshold loop
      result:=public.consume_registration_limit(kind,subject);
      if result->>'allowed'<>'true' then raise exception 'Premature % limit at attempt %',kind,i; end if;
    end loop;
    result:=public.consume_registration_limit(kind,subject);
    if result->>'allowed'<>'false' or (result->>'retry_after')::integer<1 then raise exception 'Missing % rate limit',kind; end if;
    update private.registration_rate_limits set expires_at=now()-interval '1 second' where scope=kind and subject_hash=subject;
    result:=public.consume_registration_limit(kind,subject);
    if result->>'allowed'<>'true' then raise exception 'Expired % limit did not reset',kind; end if;
  end loop;
  delete from private.registration_rate_limits where subject_hash=subject;
  if has_function_privilege('anon','public.consume_registration_limit(text,text)','execute') or has_function_privilege('authenticated','public.consume_registration_limit(text,text)','execute') then raise exception 'Rate limiter exposed to client roles'; end if;
  if not has_function_privilege('service_role','public.consume_registration_limit(text,text)','execute') then raise exception 'Server cannot consume rate limits'; end if;
end;
$$;
select 'PASS: all thresholds, window resets, and server-only permissions' as result;

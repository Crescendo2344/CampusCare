-- Notification emails get the same branded layout as the server-sent emails: a CTU seal header,
-- a security line on account emails, and a footer that says why the email was sent.
do $$
declare d text;
begin
  d:=pg_get_functiondef('private.render_notification_email(bigint)'::regprocedure);
  if position('email-ctu-seal.png' in d)=0 then
    d:=replace(d,
      $x$'<tr><td style="background:#0a7ea8;padding:20px 26px;color:#ffffff"><div style="font-size:20px;font-weight:800;letter-spacing:.01em">CampusCare</div><div style="font-size:12px;opacity:.9;margin-top:2px">CTU Main Medical &amp; Dental Clinic</div></td></tr>'$x$,
      $x$'<tr><td style="padding:18px 26px;border-bottom:1px solid #e3eaef"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px;vertical-align:middle"><img src="'||v_app||'assets/email-ctu-seal.png" width="48" height="48" alt="CTU seal" style="display:block;border:0;width:48px;height:48px"></td><td style="vertical-align:middle"><div style="font-size:19px;font-weight:800;color:#0a5a78;letter-spacing:.01em">CampusCare</div><div style="font-size:12px;color:#4a6571">CTU Main Medical &amp; Dental Clinic · Cebu Technological University</div></td></tr></table></td></tr>'$x$);
    d:=replace(d,
      $x$v_bring||$x$,
      $x$v_bring||case when lower(coalesce(n.type,''))='account' then '<p style="margin:18px 0 0;padding:12px 14px;background:#fff7e6;border:1px solid #f4c778;border-radius:10px;font-size:13px;line-height:1.55;color:#5c3b00">If you did not expect this change, contact the clinic administrator right away.</p>' else '' end||$x$);
    d:=replace(d,
      $x$This is an automated CampusCare message. Please do not reply with medical information. For emergencies, go to the clinic or the nearest hospital.$x$,
      $x$You received this because CampusCare emails you about your appointments and important changes to your account. This is an automated message; please do not reply with medical information. For emergencies, go to the clinic or the nearest hospital.$x$);
    execute d;
  end if;
end $$;

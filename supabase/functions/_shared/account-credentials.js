// New doctor and staff accounts: the server generates the password and emails it only to the new user.
// The administrator never sees it; email-dispatch wipes the stored copy as soon as it is sent, and the
// person must replace it at first sign-in (app_metadata.must_change_password).
import {passwordValidationError} from './registration-validation.js';

const SETS=['ABCDEFGHJKLMNPQRSTUVWXYZ','abcdefghijkmnpqrstuvwxyz','23456789','!@#$%&*?'];

export function generatePassword(context={},random=crypto){
  const all=SETS.join('');
  // Rejection sampling keeps every character equally likely.
  const pick=n=>{const limit=256-256%n,b=new Uint8Array(1);do random.getRandomValues(b);while(b[0]>=limit);return b[0]%n;};
  for(;;){
    const chars=SETS.map(set=>set[pick(set.length)]);
    while(chars.length<14)chars.push(all[pick(all.length)]);
    for(let i=chars.length-1;i>0;i--){const j=pick(i+1);[chars[i],chars[j]]=[chars[j],chars[i]];}
    const password=chars.join('');
    if(!passwordValidationError(password,context))return password;
  }
}

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const CREDENTIALS_TEMPLATE='credentials';
const APP='https://campuscare-brown-two.vercel.app/';

export function credentialsEmail({firstName,username,email,password,role}){
  const roleName=role==='Doctor'?'doctor':'staff';
  const subject='CampusCare · Your new account';
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your CampusCare account</title></head>
<body style="margin:0;background:#eef3f7;font-family:Segoe UI,Arial,sans-serif;color:#16262f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f7"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dbe5ec">
<tr><td style="background:#0a7ea8;padding:20px 26px;color:#ffffff"><div style="font-size:20px;font-weight:800">CampusCare</div><div style="font-size:12px;opacity:.9;margin-top:2px">CTU Main Medical &amp; Dental Clinic</div></td></tr>
<tr><td style="padding:26px">
<p style="margin:0 0 6px;font-size:14px;color:#4a6571">Hello ${esc(firstName||'there')},</p>
<h1 style="margin:0 0 12px;font-size:22px;color:#0a7ea8">Your ${roleName} account is ready</h1>
<p style="margin:0;font-size:15px;line-height:1.6">A CampusCare administrator created an account for you. Sign in with the details below. You will be asked to choose your own password right away.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #e3eaef;border-bottom:1px solid #e3eaef">
<tr><td style="padding:8px 0;color:#5b6b75;font-size:13px;width:150px">Username</td><td style="padding:8px 0;font-size:14px;font-weight:600">${esc(username)}</td></tr>
<tr><td style="padding:8px 0;color:#5b6b75;font-size:13px">Email</td><td style="padding:8px 0;font-size:14px;font-weight:600">${esc(email)}</td></tr>
<tr><td style="padding:8px 0;color:#5b6b75;font-size:13px">Temporary password</td><td style="padding:8px 0;font-size:16px;font-weight:700;font-family:Consolas,monospace;letter-spacing:.04em">${esc(password)}</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr><td style="border-radius:10px;background:#0a7ea8"><a href="${APP}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">Sign in to CampusCare</a></td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#4a6571">Do not share this password. If you did not expect this email, tell the clinic administrator.</p>
</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-size:11px;color:#6b7f89;text-align:center">This is an automated CampusCare message.</p>
</td></tr></table></body></html>`;
  const text=`Hello ${firstName||'there'},\n\nYour CampusCare ${roleName} account is ready.\n\nUsername: ${username}\nEmail: ${email}\nTemporary password: ${password}\n\nSign in at ${APP} — you will be asked to choose your own password right away.\nDo not share this password.`;
  return {subject,html,text};
}

// Queues the email, then asks email-dispatch to send it now. Returns 'sent', 'queued' or 'not_configured'.
export async function emailCredentials(admin,supabaseUrl,{userId,email,firstName,username,password,role}){
  const mail=credentialsEmail({firstName,username,email,password,role});
  const {data:row,error}=await admin.from('email_outbox').insert({
    user_id:userId,recipient_email:email,subject:mail.subject,html_body:mail.html,text_body:mail.text,
    template_key:CREDENTIALS_TEMPLATE,status:'Pending',scheduled_at:new Date().toISOString()
  }).select('email_id').single();
  if(error)throw error;
  try{
    const {data:cfg}=await admin.from('email_dispatch_config').select('dispatch_key').eq('config_id',1).maybeSingle();
    if(!cfg?.dispatch_key)return 'queued';
    const res=await fetch(`${supabaseUrl}/functions/v1/email-dispatch`,{method:'POST',headers:{'Content-Type':'application/json','X-Dispatch-Key':cfg.dispatch_key},body:JSON.stringify({action:'dispatch'}),signal:AbortSignal.timeout(8000)});
    const result=await res.json().catch(()=>({}));
    if(result?.configured===false)return 'not_configured';
    const {data:after}=await admin.from('email_outbox').select('status').eq('email_id',row.email_id).maybeSingle();
    return after?.status==='Sent'?'sent':'queued';
  }catch{return 'queued';}
}

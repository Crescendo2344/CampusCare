import {renderCampusCareEmail} from './email-layout.js';
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
  const {html,text}=renderCampusCareEmail({title:`Your ${roleName} account is ready`,label:'New account',tone:'info',name:firstName||'there',
    paragraphs:['A CampusCare administrator created an account for you. Sign in with the details below. You will be asked to choose your own password right away.'],
    rows:[['Username',username],['Email',email],['Temporary password',password]],button:{label:'Sign in to CampusCare',url:APP},
    note:'Do not share this password. If you did not expect this email, tell the clinic administrator.'});
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

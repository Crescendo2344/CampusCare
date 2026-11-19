// CampusCare sends its own "confirm your email" message through the clinic mailer (the same queue as
// appointment and password emails), not Supabase's built-in mailer, whose small hourly limit
// ("email rate limit exceeded") stopped registrations. The link carries a one-time token; the app
// verifies it when the page opens, which confirms the address.
import {authRedirect} from './app-url.js';
import {queueEmail} from './email-layout.js';
export const CONFIRM_SUBJECT='CampusCare · Confirm your email';

/** @returns {Promise<boolean>} whether the confirmation email was queued */
export async function queueConfirmationEmail(admin,{email,userId=null,firstName='',env=()=>'',fetcher=fetch}){
  const read=name=>{try{return env(name)||'';}catch{return '';}};
  // A magic-link token confirms the address of an unconfirmed account when it is verified.
  const {data:link,error}=await admin.auth.admin.generateLink({type:'magiclink',email});
  const tokenHash=link?.properties?.hashed_token;
  if(error||!tokenHash)return false;
  // Supabase may issue a signup token instead for an unconfirmed account; the link says which.
  const linkType=['signup','magiclink'].includes(link?.properties?.verification_type)?link.properties.verification_type:'magiclink';
  const url=authRedirect('confirmed',read)+'&type='+linkType+'&token_hash='+encodeURIComponent(tokenHash);
  // With automatic verification on (the default), confirming the email also verifies the account.
  let autoVerify=true;
  try{
    const {data:settings}=await admin.from('system_settings').select('auto_verify_registrations').order('settings_id',{ascending:true}).limit(1).maybeSingle();
    autoVerify=settings?.auto_verify_registrations!==false;
  }catch{ /* keep the default wording */ }
  const queued=await queueEmail(admin,{to:email,userId,subject:CONFIRM_SUBJECT,template:'verification',
    title:'Confirm your email',label:'Welcome',tone:'success',name:firstName||'there',
    paragraphs:['Thank you for registering with CampusCare, the CTU Main Campus clinic system. Use the button below to confirm your email address.',
      autoVerify
        ?'Confirming your email also verifies your account, so you can log in and book appointments right away. The clinic may still check your ID photos.'
        :'After that, the clinic reviews your ID and selfie. You can log in once your registration is approved.'],
    button:{label:'Confirm my email',url},
    note:'This link works once and only for a short time. If it has expired, open CampusCare and choose "Resend verification email". If you did not register, ignore this email.'});
  if(!queued)return false;
  try{
    const {data:cfg}=await admin.from('email_dispatch_config').select('dispatch_key').eq('config_id',1).maybeSingle();
    if(cfg?.dispatch_key)await fetcher(`${read('SUPABASE_URL')}/functions/v1/email-dispatch`,{method:'POST',headers:{'Content-Type':'application/json','X-Dispatch-Key':cfg.dispatch_key},body:JSON.stringify({action:'dispatch'}),signal:AbortSignal.timeout(8000)});
  }catch{ /* The 5-minute job sends it if this attempt fails. */ }
  return true;
}

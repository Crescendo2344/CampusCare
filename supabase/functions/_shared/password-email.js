// CampusCare sends its own password emails (never Supabase's built-in template), in the branded layout.
// The link carries a one-time token that the app uses only when the new password is submitted, so an
// email scanner or link preview that opens the link cannot use it up.
import {authRedirect} from './app-url.js';
import {queueEmail} from './email-layout.js';
export const RESET_SUBJECT='CampusCare · Reset your password';
export const SETUP_SUBJECT='CampusCare · Set your password';

/**
 * Queues the reset (or first-password) email and asks the dispatcher to send it right away.
 * @returns {Promise<boolean>} whether the email was queued
 */
export async function queuePasswordEmail(admin,{email,userId,firstName,setup=false,env=()=>'',fetcher=fetch}){
  const read=name=>{try{return env(name)||'';}catch{return '';}};
  const {data:link,error}=await admin.auth.admin.generateLink({type:'recovery',email});
  const tokenHash=link?.properties?.hashed_token;
  if(error||!tokenHash)return false;
  const url=authRedirect('recovery',read)+'&type=recovery&token_hash='+encodeURIComponent(tokenHash);
  const queued=await queueEmail(admin,setup
    ?{to:email,userId,subject:SETUP_SUBJECT,template:'verification',title:'Set your CampusCare password',label:'Welcome',tone:'success',name:firstName||'there',
      paragraphs:['The CTU clinic created a CampusCare account for you. Use the button below to choose your password; this also confirms your email address.','After that, log in with your username or email and the password you chose.'],
      button:{label:'Set my password',url},
      note:'This link works once and only for a short time. If it has expired, open CampusCare, choose "Forgot password?" and enter your email to get a new one.'}
    :{to:email,userId,subject:RESET_SUBJECT,template:'verification',title:'Reset your password',label:'Password reset',tone:'info',name:firstName||'there',
      paragraphs:['We received a request to reset the password of your CampusCare account. Use the button below to choose a new password.'],
      button:{label:'Choose a new password',url},
      note:'This link works once and only for a short time. If you asked more than once, use the newest email. If you did not ask for this, ignore this email and your password stays the same.'});
  if(!queued)return false;
  try{
    const {data:cfg}=await admin.from('email_dispatch_config').select('dispatch_key').eq('config_id',1).maybeSingle();
    if(cfg?.dispatch_key)await fetcher(`${read('SUPABASE_URL')}/functions/v1/email-dispatch`,{method:'POST',headers:{'Content-Type':'application/json','X-Dispatch-Key':cfg.dispatch_key},body:JSON.stringify({action:'dispatch'}),signal:AbortSignal.timeout(8000)});
  }catch{ /* The 5-minute job sends it if this attempt fails. */ }
  return true;
}

import {authRedirect} from './app-url.js';
import {queuePasswordEmail,RESET_SUBJECT,SETUP_SUBJECT} from './password-email.js';
import {CONFIRM_SUBJECT,queueConfirmationEmail} from './confirm-email.js';
// Both public email flows verify the application profile and Auth record on the server.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json',...extra}});

// Hosted Supabase sets CF-Connecting-IP at ingress; a client cannot choose it. Counters store a keyed
// hash, never the address itself.
function requestIp(req){
  const ip=String(req.headers.get('cf-connecting-ip')||'').trim().toLowerCase();
  return ip.length<=64&&/^[0-9a-f:.]+$/.test(ip)?ip:'unknown';
}
async function keyedHash(value,secret){
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
// Returns a response when the caller must wait; a broken counter store blocks rather than lets a flood through.
async function emailLimit(admin,scope,value,secret){
  try{
    const {data,error}=await admin.rpc('consume_registration_limit',{p_scope:scope,p_subject_hash:await keyedHash(scope+':'+value,secret)});
    if(error||typeof data?.allowed!=='boolean')throw new Error('Rate store unavailable');
    if(data.allowed)return null;
    const retry=Math.max(1,Math.ceil(Number(data.retry_after)||60));
    return json({error:`Too many email requests. Please wait ${Math.ceil(retry/60)} minute(s) and try again.`,retry_after:retry},429,{'Retry-After':String(retry)});
  }catch{return json({error:'Unable to send emails right now. Please try again shortly.'},503);}
}

export function createAccountEmailHandler({createClient,env,action,fetcher=fetch}){
  // Optional configuration must never turn a missing variable into a failed email request.
  const safeEnv=name=>{try{return env(name);}catch{return '';}};
  return async req=>{
    if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
    if(req.method!=='POST')return json({error:'Method not allowed.'},405);
    let body;
    try{body=await req.json();}catch{return json({error:'Invalid request.'},400);}
    const identifier=typeof body?.identifier==='string'?body.identifier.trim().toLowerCase():'';
    if(!identifier||identifier.length>150)return json({error:'Enter your registered username or email.'},400);
    try{
      const options={auth:{persistSession:false,autoRefreshToken:false}};
      const admin=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),options);
      // Each network may ask for only a few account emails before any account lookup happens.
      const secret=String(safeEnv('SUPABASE_SERVICE_ROLE_KEY')||'campuscare');
      const limited=await emailLimit(admin,'mail_ip',requestIp(req),secret);if(limited)return limited;
      // Escape LIKE metacharacters so an underscore or percent never matches a different account.
      const literal=identifier.replace(/[\\%_]/g,'\\$&');
      const {data:account,error:lookupError}=await admin.from('users')
        .select('user_id,first_name,auth_user_id,email,status')
        .ilike(identifier.includes('@')?'email':'username',literal).maybeSingle();
      if(lookupError)throw lookupError;
      if(!account?.auth_user_id||!account?.email)return json({error:'No CampusCare account matches that username or email. Check your details or register first.'},404);
      if(!['Active','Pending'].includes(account.status))return json({error:'This account is not eligible. Please contact the clinic.'},403);
      const {data,error:authError}=await admin.auth.admin.getUserById(account.auth_user_id);
      if(authError||!data?.user)return json({error:'This registration could not be verified. Please contact the clinic.'},409);
      // Do not send to an address that no longer belongs to the linked authentication account.
      if(String(data.user.email||'').toLowerCase()!==account.email.toLowerCase())return json({error:'Your account email needs review. Please contact the clinic.'},409);
      if(action==='resend'&&data.user.email_confirmed_at)return json({error:'Your email is already verified. Please log in or use Forgot password.'},409);
      // And each inbox receives only a few account emails an hour, whichever network asks.
      const inboxLimited=await emailLimit(admin,'mail_to',account.email.toLowerCase(),secret);if(inboxLimited)return inboxLimited;
      if(action==='reset'){
        if(account.status!=='Active')return json({error:'Your registration is still pending clinic approval.'},403);
        // A forgotten password can always be reset: the emailed link proves who is asking. That includes
        // accounts the clinic created whose first "set your password" link expired before it was used.
        const since=new Date(Date.now()-60000).toISOString();
        const {count:recent}=await admin.from('email_outbox').select('email_id',{count:'exact',head:true})
          .eq('recipient_email',account.email).in('subject',[RESET_SUBJECT,SETUP_SUBJECT]).gte('created_at',since);
        if(recent)return json({error:'A reset email was just sent. Check your inbox and spam folder, or try again in a minute.'},429);
        const queued=await queuePasswordEmail(admin,{email:account.email,userId:account.user_id,firstName:account.first_name,env:safeEnv,fetcher});
        if(!queued)return json({error:'The email could not be sent. Please try again later.'},502);
        return json({ok:true});
      }
      // The clinic mailer sends the new confirmation link; one per minute per address.
      const since=new Date(Date.now()-60000).toISOString();
      const {count:recent}=await admin.from('email_outbox').select('email_id',{count:'exact',head:true})
        .eq('recipient_email',account.email).eq('subject',CONFIRM_SUBJECT).gte('created_at',since);
      if(recent)return json({error:'Please wait before requesting another email.'},429);
      const queued=await queueConfirmationEmail(admin,{email:account.email,userId:account.user_id,firstName:account.first_name,env:safeEnv,fetcher});
      if(!queued)return json({error:'The email could not be sent. Please try again later.'},502);
      return json({ok:true});
    }catch(error){
      console.error('Account email request failed:',error?.message||'Unknown error');
      return json({error:'Unable to check your account right now. Please try again later.'},500);
    }
  };
}

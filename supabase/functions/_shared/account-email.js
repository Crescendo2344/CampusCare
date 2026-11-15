import {authRedirect} from './app-url.js';
import {queueEmail} from './email-layout.js';
// Both public email flows verify the application profile and Auth record on the server.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const RESET_SUBJECT='CampusCare · Reset your password';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});

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
      if(action==='reset'){
        if(!data.user.email_confirmed_at)return json({error:'Please contact the clinic for help activating this registration.'},409);
        if(account.status!=='Active')return json({error:'Your registration is still pending clinic approval.'},403);
        // A forgotten password can always be reset: the emailed link proves who is asking.
        // CampusCare sends this email itself (same branded layout as every other notice).
        const since=new Date(Date.now()-60000).toISOString();
        const {count:recent}=await admin.from('email_outbox').select('email_id',{count:'exact',head:true})
          .eq('recipient_email',account.email).eq('subject',RESET_SUBJECT).gte('created_at',since);
        if(recent)return json({error:'A reset email was just sent. Check your inbox and spam folder, or try again in a minute.'},429);
        const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'recovery',email:account.email});
        const tokenHash=link?.properties?.hashed_token;
        if(linkError||!tokenHash)return json({error:'The email could not be sent. Please try again later.'},502);
        // The link opens the app, which uses the token only when the new password is submitted,
        // so an email scanner that opens the link cannot use it up.
        const url=authRedirect('recovery',safeEnv)+'&type=recovery&token_hash='+encodeURIComponent(tokenHash);
        const queued=await queueEmail(admin,{to:account.email,userId:account.user_id,subject:RESET_SUBJECT,template:'verification',
          title:'Reset your password',label:'Password reset',tone:'info',name:account.first_name||'there',
          paragraphs:['We received a request to reset the password of your CampusCare account. Use the button below to choose a new password.'],
          button:{label:'Choose a new password',url},
          note:'This link works once and only for a short time. If you asked more than once, use the newest email. If you did not ask for this, ignore this email and your password stays the same.'});
        if(!queued)return json({error:'The email could not be sent. Please try again later.'},502);
        try{
          const {data:cfg}=await admin.from('email_dispatch_config').select('dispatch_key').eq('config_id',1).maybeSingle();
          if(cfg?.dispatch_key)await fetcher(`${env('SUPABASE_URL')}/functions/v1/email-dispatch`,{method:'POST',headers:{'Content-Type':'application/json','X-Dispatch-Key':cfg.dispatch_key},body:JSON.stringify({action:'dispatch'}),signal:AbortSignal.timeout(8000)});
        }catch{ /* The 5-minute job sends it if this attempt fails. */ }
        return json({ok:true});
      }
      // Keep credentials server-side and preserve Supabase's email rate limits.
      const client=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),options);
      const {error}=await client.auth.resend({type:'signup',email:account.email,options:{emailRedirectTo:authRedirect('confirmed',safeEnv)}});
      if(error){
        const limited=error.status===429||/rate|too many|seconds/i.test(error.message||'');
        return json({error:limited?'Please wait before requesting another email.':'The email could not be sent. Please try again later.'},limited?429:502);
      }
      return json({ok:true});
    }catch(error){
      console.error('Account email request failed:',error?.message||'Unknown error');
      return json({error:'Unable to check your account right now. Please try again later.'},500);
    }
  };
}

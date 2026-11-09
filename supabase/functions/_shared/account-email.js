import {authRedirect} from './app-url.js';
// Both public email flows verify the application profile and Auth record on the server.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const week=7*24*60*60*1000;

export function createAccountEmailHandler({createClient,env,action}){
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
        .select('auth_user_id,email,status,password_changed_at')
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
        if(account.password_changed_at&&Date.now()<new Date(account.password_changed_at).getTime()+week)return json({error:'You recently changed your password. Please wait seven days before resetting it again.'},429);
      }
      // Keep credentials server-side and preserve Supabase's email rate limits.
      const client=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),options);
      const {error}=action==='resend'
        ? await client.auth.resend({type:'signup',email:account.email,options:{emailRedirectTo:authRedirect('confirmed',safeEnv)}})
        : await client.auth.resetPasswordForEmail(account.email,{redirectTo:authRedirect('recovery',safeEnv)});
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

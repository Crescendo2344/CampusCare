// The registration form owns one Turnstile widget. Secrets never enter browser configuration.
let settings,loading,scriptLoading,widgetId=null,token='',verifiedAt=0;
const section=()=>document.getElementById('registration-captcha-section');
const status=message=>{const node=document.getElementById('registration-captcha-status');if(node)node.textContent=message;};
function loadTurnstile(){
  if(window.turnstile)return Promise.resolve(window.turnstile);
  if(scriptLoading)return scriptLoading;
  scriptLoading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    const timer=setTimeout(()=>{script.remove();reject(new Error('Security check could not load. Check your connection and retry.'));},12000);
    script.onload=()=>{clearTimeout(timer);if(window.turnstile)resolve(window.turnstile);else reject(new Error('Security check is unavailable. Please retry.'));};
    script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('Security check could not load. Check your connection and retry.'));};
    document.head.appendChild(script);
  }).catch(error=>{scriptLoading=null;throw error;});
  return scriptLoading;
}
export async function prepareRegistrationCaptcha(url,key,{refresh=false}={}){
  if(loading)return loading;
  if(settings&&!refresh)return settings;
  loading=(async()=>{
    try{
      const response=await fetch(url+'/functions/v1/register-patient',{headers:{apikey:key},cache:'no-store',signal:AbortSignal.timeout(10000)});
      const config=await response.json();
      if(!response.ok||typeof config.captcha_required!=='boolean')throw new Error('Registration security is unavailable. Please retry shortly.');
      const previous=settings?.site_key;settings=config;
      if(!config.captcha_required){section().hidden=true;return config;}
      section().hidden=false;status('Loading security check…');
      const turnstile=await loadTurnstile();
      if(widgetId!==null&&previous!==config.site_key){turnstile.remove(widgetId);widgetId=null;token='';verifiedAt=0;}
      if(widgetId===null){
        // loadTurnstile already waits for script.onload; ready() rejects async/defer script tags.
        widgetId=turnstile.render('#registration-captcha-widget',{
          sitekey:config.site_key,action:'campuscare_register',size:'flexible',theme:'auto',
          callback:value=>{token=value;verifiedAt=Date.now();status('Security check complete.');},
          'expired-callback':()=>{token='';verifiedAt=0;status('Security check expired. Please complete it again.');},
          'error-callback':()=>{token='';verifiedAt=0;status('Security check failed to load. Retry or check your connection.');}
        });
      }else status(token?'Security check complete.':'Complete the security check below.');
      return config;
    }catch(error){settings=null;if(section()){section().hidden=false;status(error.message);}throw error;}
  })().finally(()=>{loading=null;});
  return loading;
}
export async function registrationCaptchaToken(url,key){
  // Refresh configuration at submission so adding server keys activates protection on an already-open form.
  const config=await prepareRegistrationCaptcha(url,key,{refresh:true});
  if(!config.captcha_required)return '';
  if(!token||Date.now()-verifiedAt>240000){if(token)resetRegistrationCaptcha();throw new Error('Complete the security check below before registering.');}
  return token;
}
export function resetRegistrationCaptcha(){
  token='';verifiedAt=0;
  if(widgetId!==null&&window.turnstile){window.turnstile.reset(widgetId);status('Complete a new security check before retrying.');}
}

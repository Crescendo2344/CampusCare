// Auth emails must return to the deployed site. Supabase only honours this address when it is
// listed under Authentication → URL Configuration → Redirect URLs; otherwise it falls back to Site URL.
const DEFAULT_APP_URL='https://campuscare-brown-two.vercel.app/';
export function campusCareAppUrl(read=()=>''){
  const configured=String(read('CAMPUSCARE_APP_URL')||'').trim();
  try{
    const url=new URL(configured||DEFAULT_APP_URL);
    // Only an HTTPS origin may receive one-time auth tokens.
    if(url.protocol!=='https:')return DEFAULT_APP_URL;
    return url.origin+'/';
  }catch{return DEFAULT_APP_URL;}
}
export const authRedirect=(mode,read)=>campusCareAppUrl(read)+'?auth='+mode;

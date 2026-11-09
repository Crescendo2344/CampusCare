// A thin bar along the top while CampusCare waits on its server: it starts quickly, crawls, and finishes
// fast when the last request ends. Short requests (under 150 ms) never show it, so it does not flicker.
let pending=0,showTimer=0,hideTimer=0,bar=null;
const isServerCall=url=>/\.supabase\.co\/(functions|rest|storage)\/v1\//.test(url);

function ensureBar(){
  if(bar)return bar;
  bar=document.createElement('div');
  bar.className='cc-progress';bar.setAttribute('role','progressbar');bar.setAttribute('aria-label','Loading');bar.hidden=true;
  document.body.append(bar);
  return bar;
}
function start(){
  pending++;
  if(pending>1)return;
  clearTimeout(hideTimer);
  showTimer=setTimeout(()=>{
    const el=ensureBar();
    el.hidden=false;el.className='cc-progress';void el.offsetWidth;el.classList.add('running');
  },150);
}
function done(){
  pending=Math.max(0,pending-1);
  if(pending)return;
  clearTimeout(showTimer);
  if(!bar||bar.hidden)return;
  bar.classList.add('finishing');
  hideTimer=setTimeout(()=>{bar.hidden=true;bar.className='cc-progress';},380);
}

export function trackNetworkProgress(){
  const nativeFetch=globalThis.fetch;
  if(typeof nativeFetch!=='function'||nativeFetch.__ccTracked)return;
  const tracked=function(input,init){
    const url=typeof input==='string'?input:input?.url||String(input);
    if(!isServerCall(url))return nativeFetch.call(this,input,init);
    start();
    return nativeFetch.call(this,input,init).finally(done);
  };
  tracked.__ccTracked=true;
  globalThis.fetch=tracked;
}

// After a new deployment, a tab opened earlier still asks for the previous build's page files, which no
// longer exist (each build renames them). Reload once to pick up the current build instead of showing a
// broken page. A short guard stops a reload loop if the file is missing for another reason.
const KEY='campuscare-stale-build-reload';
const GUARD_MS=60000;

export function isStaleBuildError(error){
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i
    .test(String(error?.message||error||''));
}

export function reloadForNewBuild({storage=globalThis.sessionStorage,reload=()=>location.reload(),now=Date.now()}={}){
  let last=0;
  try{last=Number(storage?.getItem(KEY)||0);}catch{}
  if(last&&now-last<GUARD_MS)return false;
  try{storage?.setItem(KEY,String(now));}catch{}
  reload();
  return true;
}

export function installStaleBuildRecovery(target=window){
  // Vite reports a failed page-file load here; preventing the default stops the error from being thrown.
  target.addEventListener('vite:preloadError',event=>{if(reloadForNewBuild())event.preventDefault();});
  target.addEventListener('unhandledrejection',event=>{if(isStaleBuildError(event.reason)&&reloadForNewBuild())event.preventDefault();});
}

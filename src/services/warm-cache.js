// Warm start: non-personal data (clinic settings, published health articles) is kept in the browser so a
// returning visitor sees it at once while CampusCare refreshes it in the background. Patient records,
// appointments and anything personal are never written here.
const PREFIX='campuscare-cache:';
const VERSION=1;
export function saveWarm(key,data,storage=globalThis.localStorage){
  try{storage?.setItem(PREFIX+key,JSON.stringify({v:VERSION,at:Date.now(),data}));}catch{ /* Storage may be full or blocked. */ }
}
export function loadWarm(key,maxAgeMs,storage=globalThis.localStorage,now=Date.now()){
  try{
    const entry=JSON.parse(storage?.getItem(PREFIX+key)||'null');
    if(!entry||entry.v!==VERSION||now-entry.at>maxAgeMs)return null;
    return entry.data;
  }catch{return null;}
}

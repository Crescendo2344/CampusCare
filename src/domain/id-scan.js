// Reading a Student or Employee ID photo (the text Tesseract recognised) to fill the registration form.
// Pure functions: no page, no state. The scan only assists; the applicant checks every filled field.

const STOP_WORDS=new Set(['republic','philippines','cebu','technological','university','campus','main','student','employee',
  'identification','card','college','signature','valid','validity','bachelor','science','sciences','engineering','education',
  'course','id','no','number','school','year','of','in','and','ctu','city','address','date','birth','sex','blood','type',
  'emergency','contact','person','case','faculty','personnel','registrar','president','director','office','department',
  'technology','arts','industrial','information','communications','computer','major','semester','issued','expiry','expires']);
const SURNAME_PARTICLES=new Set(['de','del','dela','delos','de los','san','santa','sta','sto','santo','van','von','la','las','los','mac','mc']);
const LETTERS=/^[A-Za-zÀ-ÿÑñ.'-]+$/;

const titleCase=word=>String(word||'').toLowerCase().replace(/(^|[\s'-])([a-zà-ÿñ])/g,(m,sep,ch)=>sep+ch.toUpperCase());
const clean=line=>String(line||'').replace(/[|_~`"“”‘’•·*]/g,' ').replace(/\s+/g,' ').trim();
const words=line=>clean(line).split(' ').filter(Boolean);
export const normalizeForMatch=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

// "JUAN CARLO M. DELA CRUZ" → first "Juan Carlo", last "Dela Cruz" (the middle initial and surname particles mark the split).
export function splitFullName(text){
  const parts=words(text).filter(w=>LETTERS.test(w));
  if(parts.length<2)return null;
  const initial=parts.findIndex((w,i)=>i>0&&i<parts.length-1&&/^[A-Za-z]\.?$/.test(w));
  let firstEnd;
  if(initial>0)firstEnd=initial;
  else{
    const particle=parts.findIndex((w,i)=>i>0&&SURNAME_PARTICLES.has(w.toLowerCase().replace(/\.$/,'')));
    firstEnd=particle>0?particle:parts.length-1;
  }
  const first=parts.slice(0,firstEnd).join(' '),last=parts.slice(initial>0?initial+1:firstEnd).join(' ');
  if(!first||!last)return null;
  return {first:titleCase(first),last:titleCase(last)};
}

// "DELA CRUZ, JUAN CARLO M." → first "Juan Carlo", last "Dela Cruz".
export function splitCommaName(text){
  const [lastPart,rest]=String(text||'').split(',');
  if(!rest)return null;
  const last=words(lastPart).filter(w=>LETTERS.test(w)),given=words(rest).filter(w=>LETTERS.test(w));
  const first=given.filter((w,i)=>!(i>0&&/^[A-Za-z]\.?$/.test(w)));
  if(!last.length||!first.length)return null;
  return {first:titleCase(first.join(' ')),last:titleCase(last.join(' '))};
}

const looksLikeName=line=>{
  const list=words(line);
  if(list.length<2||list.length>6)return false;
  if(!list.every(w=>LETTERS.test(w.replace(/,$/,''))))return false;
  if(list.some(w=>STOP_WORDS.has(w.toLowerCase().replace(/[.,]/g,''))))return false;
  const letters=list.join('').replace(/[^A-Za-zÀ-ÿÑñ]/g,'');
  return letters.length>=5;
};

/** The holder's name: a labelled "Name:" line first, then a "LAST, FIRST" line, then the most name-like line. */
export function extractIdName(rawText=''){
  const lines=String(rawText||'').split(/\r?\n/).map(clean).filter(Boolean);
  for(const line of lines){
    const m=line.match(/(?:student\s*name|employee\s*name|full\s*name|name)\s*[:\-]\s*(.{4,80})$/i);
    if(m)return splitCommaName(m[1])||splitFullName(m[1]);
  }
  // Uppercase lines are how most school IDs print the holder's name.
  const candidates=lines.filter(looksLikeName).map(line=>({line,upper:(line.match(/[A-Z]/g)||[]).length/Math.max(1,(line.match(/[A-Za-z]/g)||[]).length)}));
  const ranked=candidates.sort((a,b)=>(b.upper>=.8)-(a.upper>=.8)||b.line.length-a.line.length);
  for(const {line} of ranked){
    const name=line.includes(',')?splitCommaName(line):splitFullName(line);
    if(name)return name;
  }
  return null;
}

/** A 7-digit Student or 5-digit Employee number, preferring one on a line that mentions the ID. */
export function extractIdNumber(rawText='',personType='Student'){
  const expected=personType==='Student'?7:5;
  // Common OCR confusions inside numbers.
  const normalized=String(rawText||'').replace(/(?<=\d)[Oo](?=\d)|(?<=\d)[Oo]|[Oo](?=\d)/g,'0').replace(/(?<=\d)[Il|](?=\d)/g,'1').replace(/(?<=\d)[Ss](?=\d)/g,'5');
  const flexible=new RegExp(`(?<!\\d)(?:\\d[\\s\\-]?){${expected-1}}\\d(?!\\d)`,'g');
  const candidates=[...new Set((normalized.match(flexible)||[]).map(v=>v.replace(/\D/g,'')).filter(v=>v.length===expected&&!/^(\d)\1+$/.test(v)))];
  if(!candidates.length)return '';
  for(const line of normalized.split(/\r?\n/)){
    if(!/\b(id|student|employee|number|no\.?)\b/i.test(line))continue;
    const digits=line.replace(/\D/g,'');
    const hit=candidates.find(id=>digits.includes(id));
    if(hit)return hit;
  }
  return candidates[0];
}

/** College or department code printed on the ID, if one of the known ones appears. */
export function detectUnit(rawText='',units=[]){
  const text=` ${normalizeForMatch(rawText)} `;
  const found=units.map(([value,label])=>[value,normalizeForMatch(value),normalizeForMatch(label)])
    .filter(([,code,label])=>(code&&text.includes(` ${code} `))||(label&&label.length>4&&text.includes(` ${label} `)));
  // The most specific code wins (CCICT over COE when both appear in longer text).
  return found.sort((a,b)=>b[1].length-a[1].length)[0]?.[0]||'';
}

/** Does the ID text contain the name and ID number the applicant typed? */
export function scanMatches(rawText='',{first='',last='',idNo=''}={}){
  const text=normalizeForMatch(rawText),compact=text.replace(/\s/g,'');
  const lastWords=normalizeForMatch(last).split(' ').filter(w=>w.length>1);
  const firstWord=normalizeForMatch(first).split(' ').filter(w=>w.length>1)[0]||'';
  const nameMatch=Boolean(lastWords.length&&firstWord&&lastWords.every(w=>text.includes(w))&&text.includes(firstWord));
  const idMatch=Boolean(idNo&&compact.includes(String(idNo)));
  return {name_match:nameMatch,id_match:idMatch};
}

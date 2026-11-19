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

// OCR often gets one letter of a name wrong (JOPHET → JOPHFT), so a word of 4+ letters may differ
// by one letter; shorter words must match exactly.
function closeEnough(a,b){
  if(a===b)return true;
  if(a.length<4||Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){
    if(a[i]===b[j]){i++;j++;continue;}
    if(++edits>1)return false;
    if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}
  }
  return edits+(a.length-i)+(b.length-j)<=1;
}
/** Two names agree when each word matches, allowing one misread letter in words of 4+ letters. */
export function namesAgree(a,b){
  const x=normalizeForMatch(a).split(' ').filter(Boolean),y=normalizeForMatch(b).split(' ').filter(Boolean);
  return x.length>0&&x.length===y.length&&x.every((word,i)=>closeEnough(word,y[i]));
}
const textHasWord=(text,tokens,word)=>text.includes(word)||tokens.some(token=>closeEnough(token,word));

/** Does the ID text contain the name and ID number the applicant typed? */
export function scanMatches(rawText='',{first='',last='',idNo=''}={}){
  const text=normalizeForMatch(rawText),compact=text.replace(/\s/g,''),tokens=text.split(' ');
  const lastWords=normalizeForMatch(last).split(' ').filter(w=>w.length>1);
  const firstWord=normalizeForMatch(first).split(' ').filter(w=>w.length>1)[0]||'';
  const nameMatch=Boolean(lastWords.length&&firstWord&&lastWords.every(w=>textHasWord(text,tokens,w))&&textHasWord(text,tokens,firstWord));
  // The typed number is on the ID, allowing one misread digit (3 for 5, 8 for 0) in a 7-digit number.
  const typedId=String(idNo||'');
  const numbers=normalizeForMatch(rawText).match(/\d+/g)||[];
  const idMatch=Boolean(typedId&&(compact.includes(typedId)||(typedId.length>=7&&numbers.some(n=>n.length===typedId.length&&[...n].filter((d,i)=>d!==typedId[i]).length<=1))));
  return {name_match:nameMatch,id_match:idMatch};
}

/**
 * Several readings of one ID (different crops and clean-ups) vote: the name and ID number read most
 * often win, so one garbled reading cannot fill the form. Readings are ordered best first, which
 * breaks ties.
 */
export function voteReadings(texts=[],personType='Student',digitTexts=[]){
  const tally=(values)=>{
    const counts=new Map();
    values.forEach((value,index)=>{if(!value)return;const key=value.key||value;const entry=counts.get(key)||{value,count:0,first:index};entry.count++;counts.set(key,entry);});
    return [...counts.values()].sort((a,b)=>b.count-a.count||a.first-b.first)[0]||null;
  };
  const names=texts.map(text=>extractIdName(text)).filter(Boolean);
  const ids=texts.map(text=>extractIdNumber(text,personType));
  // First and last names vote separately: "JOPHET V SANCHEZ" and "Tv SANCHEZ" still agree on the
  // surname. A one- or two-letter first name is a misread, not a name.
  const first=tally(names.map(n=>n.first).filter(f=>f.replace(/[^A-Za-zÀ-ÿ]/g,'').length>=3));
  const last=tally(names.map(n=>n.last));
  const name=first&&last?{value:{first:first.value,last:last.value},count:Math.min(first.count,last.count)}:null;
  let id=tally(ids);
  // When no ID number was read the same way twice, every number of the right length (from every
  // reading and the digits-only pass) votes digit by digit.
  if(!id||id.count<2){
    const expected=personType==='Student'?7:5;
    const candidates=[...ids,...digitTexts.flatMap(text=>String(text).match(new RegExp(`(?<!\\d)\\d{${expected}}(?!\\d)`,'g'))||[])]
      .filter(value=>value&&value.length===expected&&!/^(\d)\1+$/.test(value));
    if(candidates.length>=2){
      const digits=Array.from({length:expected},(_,i)=>{
        const counts={};for(const value of candidates)counts[value[i]]=(counts[value[i]]||0)+1;
        return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
      }).join('');
      const support=candidates.filter(value=>value===digits).length;
      id={value:digits,count:Math.max(support,1)};
    }
  }
  return {name:name?{first:name.value.first,last:name.value.last}:null,nameVotes:name?.count||0,idNumber:id?.value||'',idVotes:id?.count||0,readings:texts.length};
}

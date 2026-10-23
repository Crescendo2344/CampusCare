// Browser and server share these rules; a provider list detects typos, not an email allowlist.
const familiarDomains=['gmail.com','googlemail.com','yahoo.com','yahoo.com.ph','ymail.com','outlook.com','hotmail.com','live.com','msn.com','icloud.com','me.com','aol.com','proton.me','protonmail.com','gmx.com','gmx.net','mail.com','email.com','rocketmail.com','hotmail.co.uk','live.co.uk','pm.me','zoho.com','yandex.com','fastmail.com','tutanota.com','tuta.com','ctu.edu.ph'];
function oneEditApart(a,b){
  if(Math.abs(a.length-b.length)>1)return false;
  // Include swapped adjacent letters, a common typing mistake such as gmial.com.
  if(a.length===b.length){
    const differences=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])differences.push(i);
    if(differences.length===1)return true;
    if(differences.length!==2)return false;
    const [i,j]=differences;return j===i+1&&a[i]===b[j]&&a[j]===b[i];
  }
  const shorter=a.length<b.length?a:b,longer=a.length<b.length?b:a;
  let i=0,j=0,skipped=false;
  while(i<shorter.length&&j<longer.length){if(shorter[i]===longer[j]){i++;j++;}else{if(skipped)return false;skipped=true;j++;}}
  return true;
}
// Edit distance for short domain names; small inputs keep this cheap.
function editDistance(a,b){
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let previous=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){const saved=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=saved;}
  }
  return row[b.length];
}
const providerNames={gmail:'gmail.com',yahoo:'yahoo.com',outlook:'outlook.com',hotmail:'hotmail.com',icloud:'icloud.com',ymail:'ymail.com',proton:'proton.me',protonmail:'protonmail.com'};
const comTypos=['com','con','cmo','ocm','cm','om','co','comm','vom','xom'];
// Suggest the intended domain for common slips, including ones missing a dot or ending.
export function suggestEmailDomain(value){
  const domain=String(value||'').trim().toLowerCase().replace(/\.+$/,'');
  if(!domain||familiarDomains.includes(domain))return '';
  const compact=domain.replace(/[.-]/g,'');
  // CTU addresses: ctu, ctu.edu, ctuedu.ph, ctu.edu.p, ctu.eduph…
  if(['ctu','ctuedu','ctuph'].includes(compact)||(compact.startsWith('ctu')&&editDistance(compact,'ctueduph')<=1))return 'ctu.edu.ph';
  const joined=familiarDomains.find(known=>known.replace(/\./g,'')===compact);
  if(joined)return joined;
  const near=familiarDomains.find(known=>oneEditApart(domain,known));
  if(near)return near;
  const labels=domain.split('.'),name=labels[0];
  if(name.length<4)return '';
  const provider=Object.keys(providerNames).find(known=>editDistance(name,known)<=2);
  if(!provider)return '';
  // "gmel" or "gmel.com"; an exact provider name with another country ending is left alone.
  if(labels.length===1)return providerNames[provider];
  if(name!==provider&&labels.length===2&&comTypos.includes(labels[1]))return providerNames[provider];
  return '';
}
export function emailValidationError(value){
  const email=String(value||'').trim().toLowerCase();
  if(email.length>150)return 'Email must not exceed 150 characters.';
  const parts=email.split('@');
  if(parts.length!==2)return 'Enter a complete email address, for example name@gmail.com.';
  const [local,domain]=parts,labels=domain.split('.');
  const suggestion=suggestEmailDomain(domain);
  if(local&&suggestion)return `Check the email domain. Did you mean @${suggestion}?`;
  // Allow standard unquoted local parts and tagged addresses without silently changing their meaning.
  if(!local||local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)||labels.length<2||labels.some(label=>!label||label.length>63||!(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))||!(/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1))))return 'Enter a valid email address with a complete domain.';
  return '';
}
export function normalizePhilippineMobile(value){
  // Store one canonical local format while accepting either Philippine dialling notation.
  const phone=String(value||'').trim().replace(/[\s()-]/g,'');
  if(/^09\d{9}$/.test(phone))return phone;
  if(/^\+639\d{9}$/.test(phone))return '0'+phone.slice(3);
  return '';
}

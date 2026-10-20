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
export function emailValidationError(value){
  const email=String(value||'').trim().toLowerCase();
  if(email.length>150)return 'Email must not exceed 150 characters.';
  const parts=email.split('@');
  if(parts.length!==2)return 'Enter a complete email address, for example name@gmail.com.';
  const [local,domain]=parts,labels=domain.split('.');
  // Allow standard unquoted local parts and tagged addresses without silently changing their meaning.
  if(!local||local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)||labels.length<2||labels.some(label=>!label||label.length>63||!(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))||!(/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1))))return 'Enter a valid email address with a complete domain.';
  if(familiarDomains.includes(domain)||familiarDomains.some(known=>domain.endsWith('.'+known)))return '';
  const suggestion=familiarDomains.find(known=>oneEditApart(domain,known));
  return suggestion?`Check the email domain. Did you mean @${suggestion}?`:'';
}
export function normalizePhilippineMobile(value){
  // Store one canonical local format while accepting either Philippine dialling notation.
  const phone=String(value||'').trim().replace(/[\s()-]/g,'');
  if(/^09\d{9}$/.test(phone))return phone;
  if(/^\+639\d{9}$/.test(phone))return '0'+phone.slice(3);
  return '';
}

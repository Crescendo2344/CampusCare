// One person, one CampusCare account. Email, username and ID number are unique in the database, but a
// person can still sign up a second time with another email or a mistyped ID. Their name and date of
// birth give that away, so registration stops and says where the first account stands.

// "Ma. Clara  DELA-CRUZ" and "ma clara dela cruz" are the same name; accents are ignored too.
export function normalizePersonName(value){
  return String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .replace(/[^a-z]+/g,' ').trim();
}

const OPEN=['Pending','Active','Suspended'];
/**
 * @param {{status:string,first_name?:string,last_name?:string,role?:string}[]} accounts
 *   patient accounts with the same date of birth as the applicant
 * @returns {{status:string,error:string,code:string}|null}
 */
export function existingRegistrationFor(accounts,{first_name,last_name}){
  const name=normalizePersonName(`${first_name} ${last_name}`);
  if(!name)return null;
  const match=(accounts||[]).filter(a=>(a.role||'Patient')==='Patient'&&OPEN.includes(a.status)
    &&normalizePersonName(`${a.first_name} ${a.last_name}`)===name)
    // A waiting registration is the likeliest reason someone signs up again, so it is reported first.
    .sort((a,b)=>(a.status==='Pending'?0:1)-(b.status==='Pending'?0:1))[0];
  if(!match)return null;
  // The message never shows the other account's email, so it cannot be used to look people up.
  if(match.status==='Pending')return {status:'Pending',code:'registration_pending',
    error:'You already registered and your registration is waiting for clinic approval. Please wait for the clinic\'s email instead of registering again. If you need to change your details, contact the clinic.'};
  return {status:match.status,code:'account_exists',
    error:'You already have a CampusCare account. Log in, or use Forgot password with the email you registered. If this is not your account, contact the clinic.'};
}

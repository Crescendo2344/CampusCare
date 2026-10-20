import {emailValidationError,normalizePhilippineMobile} from './contact-validation.js';
// Shared UI/server policy: account approval and status transitions are separate from profile edits.
export function canEditApprovedUser(user){return Boolean(user&&!user.archived&&['Active','Suspended'].includes(user.status));}
export function buildUserEditPatch(body,target){
  if(!canEditApprovedUser(target))return {error:'Approve this account before editing it. Archived accounts must be restored first.'};
  if(body.status!==undefined||body.role!==undefined)return {error:'Account status and role cannot be changed through profile editing. Use the dedicated account actions.'};
  const patch={};
  for(const name of ['first_name','last_name'])if(body[name]!==undefined){const value=String(body[name]).trim();if(!value||value.length>100)return {error:'First and last name are required and must not exceed 100 characters.'};if(value!==target[name])patch[name]=value;}
  if(body.email!==undefined&&String(body.email).trim().toLowerCase()!==target.email){const value=String(body.email).trim().toLowerCase(),error=emailValidationError(value);if(error)return {error};if(value!==target.email)patch.email=value;}
  if(body.contact_number!==undefined&&String(body.contact_number).trim()!==String(target.contact_number||'').trim()){const value=String(body.contact_number).trim(),normalized=value?normalizePhilippineMobile(value):'';if(value&&!normalized)return {error:'Use a valid mobile number starting with 09 or +639.'};if(normalized!==(target.contact_number||''))patch.contact_number=normalized;}
  if(body.specialty!==undefined){if(target.role!=='Doctor')return {error:'Only Doctor accounts have a specialty.'};const value=String(body.specialty).trim();if(!['General Medicine','Dental','Eye','Mental Health'].includes(value))return {error:'Choose a valid doctor specialty.'};if(value!==target.specialty)patch.specialty=value;}
  return {patch};
}

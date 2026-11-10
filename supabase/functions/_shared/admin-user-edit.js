import {emailValidationError,normalizePhilippineMobile} from './contact-validation.js';
import {SPECIALIZATIONS,cleanServicesRendered} from './clinic-services.js';
// Shared UI/server policy: account approval and status transitions are separate from profile edits.
export function canEditApprovedUser(user){return Boolean(user&&!user.archived&&['Active','Suspended'].includes(user.status));}
export function buildUserEditPatch(body,target){
  if(!canEditApprovedUser(target))return {error:'Approve this account before editing it. Archived accounts must be restored first.'};
  if(body.status!==undefined||body.role!==undefined)return {error:'Account status and role cannot be changed through profile editing. Use the dedicated account actions.'};
  const patch={};
  for(const name of ['first_name','last_name'])if(body[name]!==undefined){const value=String(body[name]).trim();if(!value||value.length>100)return {error:'First and last name are required and must not exceed 100 characters.'};if(value!==target[name])patch[name]=value;}
  if(body.email!==undefined&&String(body.email).trim().toLowerCase()!==target.email){const value=String(body.email).trim().toLowerCase(),error=emailValidationError(value);if(error)return {error};if(value!==target.email)patch.email=value;}
  if(body.contact_number!==undefined&&String(body.contact_number).trim()!==String(target.contact_number||'').trim()){const value=String(body.contact_number).trim(),normalized=value?normalizePhilippineMobile(value):'';if(value&&!normalized)return {error:'Use a valid mobile number starting with 09 or +639.'};if(normalized!==(target.contact_number||''))patch.contact_number=normalized;}
  if(body.specialty!==undefined){if(target.role!=='Doctor')return {error:'Only Doctor accounts have a specialization.'};const value=String(body.specialty).trim();if(!Object.keys(SPECIALIZATIONS).includes(value))return {error:'Choose a valid specialization.'};if(value!==target.specialty)patch.specialty=value;}
  if(body.services_rendered!==undefined){
    if(target.role!=='Doctor')return {error:'Only Doctor accounts render services.'};
    const services=cleanServicesRendered(patch.specialty||target.specialty,body.services_rendered);
    if(!services.length)return {error:'Tick at least one service the doctor renders.'};
    if(services.join('|')!==(target.services_rendered||[]).join('|'))patch.services_rendered=services;
  }
  // Staff and doctors carry a 5-digit employee number; a patient's ID number comes from their registration.
  if(body.id_number!==undefined&&String(body.id_number).trim()!==String(target.id_number||'').trim()){
    if(!['Staff','Doctor'].includes(target.role))return {error:'Only staff and doctor employee numbers can be edited here.'};
    const value=String(body.id_number).trim();
    if(!/^\d{5}$/.test(value))return {error:'Enter the 5-digit employee number.'};
    patch.id_number=value;
  }
  if(body.clinic!==undefined){
    if(target.role!=='Staff')return {error:'Only staff accounts are assigned to a clinic. A doctor\'s clinic follows the specialization.'};
    const value=String(body.clinic).trim();
    if(!['Medical Clinic','Dental Clinic'].includes(value))return {error:'Choose Medical Clinic or Dental Clinic.'};
    if(value!==target.clinic)patch.clinic=value;
  }
  return {patch};
}

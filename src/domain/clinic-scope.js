// Medical Clinic and Dental Clinic staff work separately. A doctor's clinic follows the specialization;
// a staff member's is assigned by the administrator. Administrators and patients have no single clinic.
export const CLINICS=['Medical Clinic','Dental Clinic'];
export function userClinic(user){
  if(!user)return '';
  if(user.role==='Doctor')return user.specialty==='Dental'?'Dental Clinic':'Medical Clinic';
  if(user.role==='Staff')return CLINICS.includes(user.clinic)?user.clinic:'';
  return '';
}
// The clinic the signed-in staff member is limited to, or '' for everyone else.
export function staffClinicOf(user){return user?.role==='Staff'?userClinic(user):'';}
// Pages a staff member does not get because they belong to the other clinic.
// The Dental Clinic Survey and its results belong to the dental clinic.
export function pagesHiddenFor(user){
  return user?.role==='Staff'&&userClinic(user)!=='Dental Clinic'?['survey-results']:[];
}

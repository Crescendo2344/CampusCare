// Profile strength for a patient, like the completion meters on LinkedIn, GCash ("Fully verified")
// and university health portals: identity is verified by the clinic, then the profile is
// "Fully verified" once the details the clinic needs in a visit or an emergency are on file.
// Each step names where it is completed: by the patient in My Account, or by the clinic at a visit.

const filled=v=>String(v??'').trim()!=='';
const known=v=>filled(v)&&!/^unknown$/i.test(String(v).trim());

export const PROFILE_LEVELS=[
  {min:0,label:'Getting started',tone:'warning'},
  {min:60,label:'Almost there',tone:'info'},
  {min:100,label:'Fully verified',tone:'success'}
];

/**
 * @param {object} user  the signed-in account (status, verified, contact, profilePhoto, personType)
 * @param {object} pt    the patient record in UI shape (see currentPatientToUi)
 * @returns {{percent:number,level:{label:string,tone:string},steps:{id:string,label:string,done:boolean,by:'patient'|'clinic'|'system',section:string}[],missing:object[]}}
 */
export function profileCompleteness(user={},pt={}){
  const student=(pt.personType||user.personType)==='Student';
  const steps=[
    {id:'identity',label:'ID verified by the clinic',done:user.status==='Active'&&user.verified!==false,by:'system',section:'Registration'},
    {id:'contact',label:'Mobile number',done:filled(user.contact),by:'patient',section:'Account Information'},
    {id:'photo',label:'Profile photo',done:filled(user.profilePhoto||pt.profilePhoto),by:'patient',section:'Profile Photo'},
    {id:'personal',label:'Date of birth and sex',done:filled(pt.birthDate)&&filled(pt.gender),by:'clinic',section:'Registration Details'},
    ...(student?[
      {id:'program',label:'Course',done:filled(pt.course),by:'patient',section:'Account Information'},
      {id:'session',label:'Class session (morning or evening)',done:filled(pt.classSession),by:'clinic',section:'Registration Details'}
    ]:[]),
    {id:'address',label:'Home address',done:filled(pt.address),by:'patient',section:'Emergency Details'},
    {id:'emergency',label:'Emergency contact',done:filled(pt.emergencyName)&&filled(pt.emergencyContact),by:'patient',section:'Emergency Details'},
    {id:'blood',label:'Blood type',done:known(pt.blood),by:'clinic',section:'Health record'},
    {id:'body',label:'Height and weight',done:filled(pt.height)&&filled(pt.weight),by:'clinic',section:'Health record'},
    {id:'allergies',label:'Allergies (or "None")',done:filled(pt.allergies),by:'clinic',section:'Health record'}
  ];
  const done=steps.filter(s=>s.done).length;
  const percent=Math.round(done/steps.length*100);
  const level=[...PROFILE_LEVELS].reverse().find(l=>percent>=l.min);
  return {percent,level,steps,missing:steps.filter(s=>!s.done)};
}

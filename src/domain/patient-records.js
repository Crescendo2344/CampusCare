// Profile and patient mapping use explicit records; no application globals are read.
export function normalizeSupabaseUser(profile){
  if(!profile)return profile;
  const dbUserId=Number(profile.user_id??profile.dbUserId??profile.id);
  return {
    ...profile,
    // Keep real DB IDs separately; UI IDs are offset so they never collide
    // with the old demo records while modules are being migrated.
    id: Number.isFinite(dbUserId) ? 100000+dbUserId : profile.id,
    dbUserId,
    authUserId: profile.auth_user_id??profile.authUserId,
    fname: profile.first_name??profile.fname??'',
    lname: profile.last_name??profile.lname??'',
    username: profile.username??'',
    email: profile.email??'',
    role: profile.role??'Patient',
    status: profile.status??'Pending',
    archived:String(profile.status||'').toLowerCase()==='archived',
    verified: profile.verified??false,
    contact: profile.contact_number??profile.contact??'',
    contactNo: profile.contact_number??profile.contactNo??'',
    personType: profile.person_type??profile.personType??'',
    college: profile.college??'',
    idNo: profile.id_number??profile.idNo??'',
    profileImage: profile.profile_signed_url??profile.profileImage??'',
    profilePhoto: profile.profile_signed_url??profile.profilePhoto??'',
    specialty: profile.specialty??'',
    workDays: profile.work_days??profile.workDays??[],
    startTime: profile.start_time??profile.startTime??'',
    endTime: profile.end_time??profile.endTime??'',
    slotDuration: profile.slot_duration??profile.slotDuration??60,
    maxPatients: profile.max_patients??profile.maxPatients??20,
    createdAt: profile.created_at??profile.createdAt??'',
    lastLogin: profile.last_login_at??profile.lastLogin??'',
    passwordChangedAt: profile.password_changed_at??profile.passwordChangedAt??'',
    savedSignature: profile.saved_signature_data??profile.savedSignature??'',
    _realSupabase:true
  };
}

export function ageFromBirthDate(date,now=new Date()){
  if(!date)return '';
  const d=new Date(`${date}T00:00:00`);
  if(Number.isNaN(d.getTime()))return '';
  let age=now.getFullYear()-d.getFullYear();
  const md=now.getMonth()-d.getMonth();
  if(md<0||(md===0&&now.getDate()<d.getDate()))age--;
  return age;
}

export function directoryRowToPatient(u,now=new Date()){
  const p=u.patient;
  if(!p)return null;
  const uiUser=normalizeSupabaseUser(u);
  return {
    id:200000+Number(p.patient_id),
    dbPatientId:Number(p.patient_id),
    userId:uiUser.id,
    dbUserId:uiUser.dbUserId,
    fname:uiUser.fname,
    lname:uiUser.lname,
    age:ageFromBirthDate(p.birth_date,now),
    birthDate:p.birth_date||'',
    gender:p.sex||'',
    blood:p.blood_type||'Unknown',
    address:p.address||'',
    college:uiUser.college||'',
    personType:uiUser.personType||'',
    idNo:uiUser.idNo||'',
    height:p.height_cm?`${p.height_cm}cm`:'',
    weight:p.weight_kg?`${p.weight_kg}kg`:'',
    contact:uiUser.contact||'',
    emergencyName:p.emergency_contact_name||'',
    emergencyContact:p.emergency_contact_number||'',
    medHistory:p.medical_history||'',
    allergies:p.allergies||'',
    archived:!!p.archived_at,
    profilePhoto:uiUser.profilePhoto||'',
    createdAt:uiUser.createdAt||'',
    _realSupabase:true
  };
}

export function patientDisplayId(pt){
  const id=Number(pt?.dbPatientId??pt?.id??0);
  return String(id).padStart(6,'0');
}

export function patientMeasurementNumber(value){
  const n=parseFloat(String(value??'').replace(/[^\d.]/g,''));
  return Number.isFinite(n)?n:'';
}

export function currentPatientToUi(row,user,now=new Date()){
  return {
    id:200000+Number(row.patient_id),
    dbPatientId:Number(row.patient_id),
    userId:user.id,
    dbUserId:user.dbUserId,
    fname:user.fname,
    lname:user.lname,
    age:ageFromBirthDate(row.birth_date,now),
    birthDate:row.birth_date||'',
    gender:row.sex||'',
    blood:row.blood_type||'Unknown',
    address:row.address||'',
    college:user.college||'',
    personType:user.personType||'',
    idNo:user.idNo||'',
    height:row.height_cm?`${row.height_cm}cm`:'',
    weight:row.weight_kg?`${row.weight_kg}kg`:'',
    contact:user.contact||'',
    emergencyName:row.emergency_contact_name||'',
    emergencyContact:row.emergency_contact_number||'',
    medHistory:row.medical_history||'',
    allergies:row.allergies||'',
    archived:!!row.archived_at,
    profilePhoto:user.profilePhoto||'',
    _realSupabase:true
  };
}

export function mergeClinicalDirectory(db,rows,now=new Date()){
  return {users:[...(db.users||[]).filter(u=>!u._realSupabase),...rows.map(normalizeSupabaseUser)],
    patients:[...(db.patients||[]).filter(p=>!p._realSupabase),...rows.map(r=>directoryRowToPatient(r,now)).filter(Boolean)]};
}

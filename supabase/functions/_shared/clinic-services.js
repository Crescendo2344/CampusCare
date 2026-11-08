// The services each clinic offers. A doctor's "services rendered" is a subset of their clinic's list;
// an empty list means the doctor renders every service of that clinic.
export const CLINIC_SERVICES={
  'Medical Clinic':['General Checkup','Consultation','Follow-up','Physical Exam'],
  'Dental Clinic':['Dental Checkup','Oral Prophylaxis','Tooth Restoration','Tooth Extraction']
};
export const SPECIALIZATIONS={'General Medicine':'Medical Clinic','Dental':'Dental Clinic'};

export function clinicForSpecialization(specialization){
  return SPECIALIZATIONS[specialization]||'Medical Clinic';
}

// Keeps only real services of the doctor's clinic, in the catalog's order.
export function cleanServicesRendered(specialization,services){
  const allowed=CLINIC_SERVICES[clinicForSpecialization(specialization)];
  const chosen=new Set((Array.isArray(services)?services:[]).map(s=>String(s).trim()));
  return allowed.filter(s=>chosen.has(s));
}

export function doctorRendersService(doctor,service){
  const list=doctor?.servicesRendered||doctor?.services_rendered||[];
  return !list.length||list.includes(service);
}

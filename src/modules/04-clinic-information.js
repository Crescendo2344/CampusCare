// ================================================================
// OFFICIAL CTU MAIN CLINIC INFORMATION
// Based on the current on-site CTU Main Clinic notices supplied for CampusCare.
// The posted extended schedule specifically identifies the MEDICAL CLINIC.
// ================================================================
const CTU_CLINIC_INFO = Object.freeze({
  name:'CTU Main Medical & Dental Clinic',
  location:'Ground Floor, Education Building, CTU Main Campus',
  address:'Ground Floor, Education Building, CTU Main Campus, M.J. Cuenco Ave. cor. R. Palma St., Cebu City, Philippines',
  email:'ctumainmedclinic@gmail.com',
  phone:'(032) 402 4060 loc. 1142',
  facebook:'CTU Main Medical Clinic',
  medicalHours:{
    regular:'Monday–Friday, 8:00 AM–5:00 PM',
    extendedWeekdays:'Monday–Friday, 5:00 PM–9:00 PM',
    saturday:'Saturday, 8:00 AM–9:00 PM',
    sunday:'Sunday, 8:00 AM–5:00 PM'
  }
});

const TODAY = clinicToday(); // Use the clinic's date, not UTC.
let currentUser = null;
let currentPatient = null;
let activeModal = null;

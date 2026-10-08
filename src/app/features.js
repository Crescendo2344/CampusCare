// Explicit imports replace source concatenation and implicit top-level globals.
import * as feature0 from '../features/authSession.js';
import * as feature1 from '../features/supabaseClient.js';
import * as feature2 from '../features/demoData.js';
import * as feature3 from '../features/dataServices.js';
import * as feature4 from '../features/utilities.js';
import * as feature5 from '../features/clinicInformation.js';
import * as feature6 from '../features/persistence.js';
import * as feature7 from '../features/auditAndBackups.js';
import * as feature8 from '../features/serverBackups.js';
import * as feature9 from '../features/systemSettings.js';
import * as feature10 from '../features/emailDelivery.js';
import * as feature11 from '../features/theme.js';
import * as feature12 from '../features/inputValidation.js';
import {camera as feature13} from './optional-features.js';
import * as feature14 from '../features/documentScanner.js';
import * as feature15 from '../features/predictiveAnalytics.js';
import * as feature16 from '../features/inventoryService.js';
import * as feature17 from '../features/notifications.js';
import * as feature18 from '../features/assistant.js';
import * as feature19 from '../features/authentication.js';
import * as feature20 from '../features/loginLockout.js';
import * as feature21 from '../features/passwordRecovery.js';
import * as feature22 from '../features/sessionSecurity.js';
import * as feature23 from '../features/appInitialization.js';
import * as feature24 from '../features/topbarAndNavigation.js';
import * as feature25 from '../features/navigationRaceProtection.js';
import * as feature26 from '../features/privacy.js';
import * as feature27 from '../features/issueReports.js';
import * as feature28 from '../features/loadingSkeletons.js';
import * as feature29 from '../features/dashboardChartHelpers.js';
import * as feature30 from '../features/dashboard.js';
import * as feature31 from '../features/appointmentService.js';
import * as feature32 from '../features/patientAppointments.js';
import * as feature33 from '../features/treatmentService.js';
import * as feature34 from '../features/patientRecords.js';
import * as feature35 from '../features/accountSettings.js';
import * as feature36 from '../features/workflowRequests.js';
import * as feature37 from '../features/nameChangeRequests.js';
import * as feature38 from '../features/doctorSchedule.js';
import * as feature39 from '../features/doctorPatients.js';
import * as feature40 from '../features/patientService.js';
import * as feature41 from '../features/patientManagement.js';
import * as feature42 from '../features/fitnessAssessments.js';
import * as feature43 from '../features/appointments.js';
import * as feature44 from '../features/approvalQueue.js';
import * as feature45 from '../features/dentalSurvey.js';
import * as feature46 from '../features/treatmentList.js';
import * as feature47 from '../features/messaging.js';
import * as feature48 from '../features/inventory.js';
import {reports as feature49} from './optional-features.js';
import {reportCharts as feature50} from './optional-features.js';
import * as feature51 from '../features/userManagement.js';
import * as feature52 from '../features/settingsAndCertificates.js';
import * as feature53 from '../features/certificateService.js';
import * as feature54 from '../features/modals.js';
import * as feature55 from '../features/calendar.js';
import * as feature56 from '../features/datePicker.js';
import * as feature57 from '../features/bookingForm.js';
import * as feature58 from '../features/appointmentDetails.js';
import * as feature59 from '../features/patientForm.js';
import * as feature60 from '../features/treatmentForm.js';
import * as feature61 from '../features/inventoryForms.js';
import * as feature62 from '../features/userForm.js';
import * as feature63 from '../features/startup.js';
import * as feature64 from '../features/scheduleAndDrafts.js';
import * as feature65 from '../features/shellActions.js';
export const features={
analyticsDisplay,
  authSession:feature0,
  supabaseClient:feature1,
  demoData:feature2,
  dataServices:feature3,
  utilities:feature4,
  clinicInformation:feature5,
  persistence:feature6,
  auditAndBackups:feature7,
  serverBackups:feature8,
  systemSettings:feature9,
  emailDelivery:feature10,
  theme:feature11,
  inputValidation:feature12,
  camera:feature13,
  documentScanner:feature14,
  predictiveAnalytics:feature15,
  inventoryService:feature16,
  notifications:feature17,
  assistant:feature18,
  authentication:feature19,
  loginLockout:feature20,
  passwordRecovery:feature21,
  sessionSecurity:feature22,
  appInitialization:feature23,
  topbarAndNavigation:feature24,
  navigationRaceProtection:feature25,
  privacy:feature26,
  issueReports:feature27,
  loadingSkeletons:feature28,
  dashboardChartHelpers:feature29,
  dashboard:feature30,
  appointmentService:feature31,
  patientAppointments:feature32,
  treatmentService:feature33,
  patientRecords:feature34,
  accountSettings:feature35,
  workflowRequests:feature36,
  nameChangeRequests:feature37,
  doctorSchedule:feature38,
  doctorPatients:feature39,
  patientService:feature40,
  patientManagement:feature41,
  fitnessAssessments:feature42,
  appointments:feature43,
  approvalQueue:feature44,
  dentalSurvey:feature45,
  treatmentList:feature46,
  messaging:feature47,
  inventory:feature48,
  reports:feature49,
  reportCharts:feature50,
  userManagement:feature51,
  settingsAndCertificates:feature52,
  certificateService:feature53,
  modals:feature54,
  calendar:feature55,
  datePicker:feature56,
  bookingForm:feature57,
  appointmentDetails:feature58,
  patientForm:feature59,
  treatmentForm:feature60,
  inventoryForms:feature61,
  userForm:feature62,
  startup:feature63,
  scheduleAndDrafts:feature64,
  shellActions:feature65,
};
import {initializeOptionalState} from './optional-state.js';
import * as analyticsDisplay from '../features/analyticsDisplay.js';
export function initializeFeatures(){
initializeOptionalState();
  feature0.initializeFeature();
  feature1.initializeFeature();
  feature2.initializeFeature();
  feature3.initializeFeature();
  feature4.initializeFeature();
  feature5.initializeFeature();
  feature6.initializeFeature();
  feature7.initializeFeature();
  feature8.initializeFeature();
  feature9.initializeFeature();
  feature10.initializeFeature();
  feature11.initializeFeature();
  feature12.initializeFeature();
  feature13.initializeFeature();
  feature14.initializeFeature();
  feature15.initializeFeature();
  feature16.initializeFeature();
  feature17.initializeFeature();
  feature18.initializeFeature();
  feature19.initializeFeature();
  feature20.initializeFeature();
  feature21.initializeFeature();
  feature22.initializeFeature();
  feature23.initializeFeature();
  feature24.initializeFeature();
  feature25.initializeFeature();
  feature26.initializeFeature();
  feature27.initializeFeature();
  feature28.initializeFeature();
  feature29.initializeFeature();
  feature30.initializeFeature();
  feature31.initializeFeature();
  feature32.initializeFeature();
  feature33.initializeFeature();
  feature34.initializeFeature();
  feature35.initializeFeature();
  feature36.initializeFeature();
  feature37.initializeFeature();
  feature38.initializeFeature();
  feature39.initializeFeature();
  feature40.initializeFeature();
  feature41.initializeFeature();
  feature42.initializeFeature();
  feature43.initializeFeature();
  feature44.initializeFeature();
  feature45.initializeFeature();
  feature46.initializeFeature();
  feature47.initializeFeature();
  feature48.initializeFeature();
  feature49.initializeFeature();
  feature50.initializeFeature();
  feature51.initializeFeature();
  feature52.initializeFeature();
  feature53.initializeFeature();
  feature54.initializeFeature();
  feature55.initializeFeature();
  feature56.initializeFeature();
  feature57.initializeFeature();
  feature58.initializeFeature();
  feature59.initializeFeature();
  feature60.initializeFeature();
  feature61.initializeFeature();
  feature62.initializeFeature();
  feature63.initializeFeature();
  feature64.initializeFeature();
  feature65.initializeFeature();
}

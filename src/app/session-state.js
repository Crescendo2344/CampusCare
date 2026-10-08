// Clearing account-owned caches prevents one account from seeing the previous account's data.
import {state} from './state.js';
export function clearAccountState(){
  state.auth.currentUser=null;
  state.auth.currentPatient=null;
  state.navigationRaceProtection.campusNavigationToken=(state.navigationRaceProtection.campusNavigationToken||0)+1;
  if(state.messaging.messagePollTimer){clearInterval(state.messaging.messagePollTimer);state.messaging.messagePollTimer=null;}
  state.reports.currentAnalyticsSummary=null;
  state.reportCharts.lastReportRows=[];
  state.doctorPatients.myPatients=[];
  state.workflowRequests.pendingAccountUpdate=null;
  // Stop an active camera stream rather than keeping the device running after sign-out.
  state.camera._cameraStream?.getTracks().forEach(track=>track.stop());
  state.camera._cameraStream=null;
  state.messaging.activeConversationId=null;
  state.messaging.pendingAttachment=null;
  state.approvalQueue.realPendingApprovals=[];
  state.topbarAndNavigation.navTaskCounts={};
  state.topbarAndNavigation.navTaskItems={};
  state.topbarAndNavigation.navTaskSeen={};
  const snapshot=state.data.DB;
  if(snapshot)for(const [key,value]of Object.entries(snapshot)){
    if(key.startsWith('real')||key==='emailDeliveryStatus'){delete snapshot[key];continue;}
    if(Array.isArray(value))snapshot[key]=value.filter(row=>!row?._realSupabase&&!row?._realSupabaseApproval&&!row?._realMessageDirectory&&!row?._realDoctorDirectory);
  }
}

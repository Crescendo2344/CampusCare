// settingsAndCertificates: imported feature APIs; state belongs to explicit application namespaces.
import {academicYearFor,validateAcademicYear} from '../domain/academic-year.js';
import {openModal,closeAllModals} from './modals.js';
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {saveRealSystemSettings,syncRealSystemSettings} from './systemSettings.js';
import {changeBackupRetention,renderBackupListHtml,renderBackupPanel,sizeBackupHistory,runRealBackupNow,syncRealBackupStatus} from './serverBackups.js';
import {dispatchOperationalEmails,renderEmailDeliveryPanel,renderEmailQueueHtml,sendTestOperationalEmail,syncEmailDeliveryStatus} from './emailDelivery.js';
import {openPrivacyNotice,syncPrivacyAdminSummary} from './loginLockout.js';
import {escapeHtml} from './issueReports.js';
import {campusDateFieldHtml} from './datePicker.js';
import {createDailyBackup} from './auditAndBackups.js';
import {persistDB} from './persistence.js';
import {showConfirmDialog,toast,toastWithUndo} from './theme.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// RESTORED SETTINGS + PATIENT CERTIFICATE RENDERERS
// These functions existed in the original CampusCare build but were
// accidentally removed during the Supabase merge.
// ================================================================

export function showSettingsSection(id){
  (appState.settingsPage??={}).tab=id;
  for(const panel of document.querySelectorAll('[data-settings-panel]'))panel.hidden=panel.dataset.settingsPanel!==id;
  for(const tab of document.querySelectorAll('[data-settings-tab]'))tab.setAttribute('aria-selected',String(tab.dataset.settingsTab===id));
}

export async function renderSettings(){
  const s=appState.data.DB.settings;
  const c=document.getElementById('app-content');
  if(!c)return;
  const pageToken=captureCampusPageToken();

  if(appState.auth.currentUser?._realSupabase&&appState.auth.currentUser.role==='Administrator'){
    showDatabaseSkeleton('table');
    try{
      await Promise.all([
        syncRealSystemSettings(),
        syncRealBackupStatus(),
        syncEmailDeliveryStatus(),
        syncPrivacyAdminSummary()
      ]);
    }
    catch(e){
      if(!isCampusPageCurrent('settings',pageToken))return;
      console.error('Settings sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load system settings.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderSettings()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('settings',pageToken))return;
  }
  const ui=appState.settingsPage??={};ui.tab??='clinic';
  const sections=[['clinic','Clinic & semesters','bi-hospital'],['privacy','Privacy','bi-shield-lock'],...(appState.auth.currentUser?._realSupabase?[['email','Email delivery','bi-envelope']]:[]),['backups','Backups','bi-database']];
  c.innerHTML=`
    <div class="report-tabs settings-tabs" role="tablist" aria-label="Settings sections">${sections.map(([id,label,icon])=>`<button type="button" role="tab" aria-selected="${ui.tab===id}" data-settings-tab="${id}" ${bindAction('click',()=>showSettingsSection(id))}><i class="bi ${icon}" aria-hidden="true"></i>${label}</button>`).join('')}</div>
    <div class="grid-2" data-settings-panel="clinic">
      <div class="card">
        <div class="card-header"><h3>Clinic Settings</h3></div><p class="settings-danger-notice">Critical settings: changes affect clinic information, visit limits and appointment reminders. Review every change before confirming.</p>
        <div id="set-msg"></div>
        <div class="form-group"><label>Clinic Name</label><input id="set-name" value="${escapeHtml(s.clinicName||'')}"></div>
        <div class="form-group"><label>Address</label><input id="set-addr" value="${escapeHtml(s.address||'')}"></div>
        <div class="form-group"><label>Contact Email</label><input id="set-email" type="email" value="${escapeHtml(s.contactEmail||'')}"></div>
        <div class="form-group"><label>Contact Phone</label><input id="set-phone" value="${escapeHtml(s.contactPhone||appState.clinicInformation.CTU_CLINIC_INFO.phone)}"></div>
        <div class="form-group"><label>Dental Visits Allowed Per Semester</label><input id="set-dental" type="number" min="1" max="5" value="${Number(s.dentalLimitPerSemester||1)}"></div>
        <div class="form-group"><label>Appointment Reminder Days Before</label><input id="set-remind" type="number" min="0" max="14" value="${Number(s.appointmentReminderDays??1)}"><div class="form-note">0 = same-day reminder only. Server reminders are generated automatically every hour.</div></div>
        <button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{saveSettings()})}>Save Settings</button>
      </div>
      <div class="card">
        <div class="card-header"><h3>Semester Configuration</h3></div><p class="settings-danger-notice">Critical settings: changing semester boundaries changes dental visit quotas and semester reporting. Existing records are retained.</p><div class="form-group"><label for="set-school-year">School Year</label><select id="set-school-year">${Array.from({length:8},(_,i)=>Number(academicYearFor(s).slice(0,4))-2+i).map(year=>`<option value="${year}-${year+1}" ${academicYearFor(s)===`${year}-${year+1}`?'selected':''}>${year}–${year+1}</option>`).join('')}</select><p class="form-note">Use the actual school calendar: Semester 1 begins in the first year; Semester 2 ends in the following year.</p></div>
        <div class="form-group"><label>Semester 1 Start</label>${campusDateFieldHtml('set-s1s',s.semesterStart,'Semester 1 Start')}</div>
        <div class="form-group"><label>Semester 1 End</label>${campusDateFieldHtml('set-s1e',s.semesterEnd,'Semester 1 End')}</div>
        <div class="form-group"><label>Semester 2 Start</label>${campusDateFieldHtml('set-s2s',s.semester2Start,'Semester 2 Start')}</div>
        <div class="form-group"><label>Semester 2 End</label>${campusDateFieldHtml('set-s2e',s.semester2End,'Semester 2 End')}</div>
        <button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{saveSemSettings()})}>Save Semester</button>
      </div>
    </div>
    <div class="card" data-settings-panel="privacy">
      <div class="card-header">
        <div>
          <h3>Privacy &amp; Data Protection</h3>
          <div class="tech-note">The Privacy Notice version is recorded with registration acknowledgements and privacy/data requests.</div>
        </div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{openPrivacyNotice()})}>View Privacy Notice</button>
      </div>

      <div class="grid-3" style="margin-bottom:1rem">
        <div class="stat-card"><div class="stat-val">v${escapeHtml(s.privacyPolicyVersion||'1.0')}</div><div class="stat-lbl">Current Notice Version</div></div>
        <div class="stat-card"><div class="stat-val">${Number(appState.data.DB.privacyAdminSummary?.total_users_with_history||0)}</div><div class="stat-lbl">Users with Privacy Records</div></div>
        <div class="stat-card"><div class="stat-val text-danger">${Number(appState.data.DB.privacyAdminSummary?.withdrawal_requests||0)}</div><div class="stat-lbl">Privacy Requests</div></div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Privacy Notice Version</label>
          <input id="set-privacy-version" maxlength="40" value="${escapeHtml(s.privacyPolicyVersion||'1.0')}">
        </div>
        <div class="form-group">
          <label>Notice Updated Date</label>
          ${campusDateFieldHtml('set-privacy-updated',s.privacyPolicyUpdated||appState.clinicInformation.TODAY,'Privacy Notice Updated')}
        </div>
      </div>

      <div class="alert alert-info show" style="font-size:.76rem">
        This version is stored with future registration acknowledgements. Existing users are not automatically asked to acknowledge the notice again during normal use.
        If a future change materially affects how CampusCare processes information, CTU can communicate that update through an appropriate separate process.
      </div>

      <button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{savePrivacySettings()})}>Save Privacy Notice Version</button>
    </div>
    ${appState.auth.currentUser?._realSupabase?`<div class="card" data-settings-panel="email">
      <div class="card-header">
        <div>
          <h3>Operational Email Delivery</h3>
          <div class="tech-note">In-app notifications are automatically mirrored into a secure email queue for appointments, reminders, certificates, fitness assessments, treatments, and inventory alerts.</div>
        </div>
        <button class="btn btn-sm" id="email-dispatch-btn" ${bindAction('click',(event,element)=>{dispatchOperationalEmails()})}>Process Queue Now</button>
      </div>

      <div class="grid-3" style="margin-bottom:1rem">
        <div class="stat-card"><div class="stat-val" id="email-count-sent">${Number(appState.data.DB.emailDeliveryStatus?.counts?.sent||0)}</div><div class="stat-lbl">Sent</div></div>
        <div class="stat-card"><div class="stat-val text-warning" id="email-count-pending">${Number(appState.data.DB.emailDeliveryStatus?.counts?.pending||0)}</div><div class="stat-lbl">Pending</div></div>
        <div class="stat-card"><div class="stat-val text-danger" id="email-count-failed">${Number(appState.data.DB.emailDeliveryStatus?.counts?.failed||0)}</div><div class="stat-lbl">Failed</div></div>
      </div>

      <div class="official-info-card" style="margin-bottom:1rem">
        <h4>Email Provider</h4>
        <p id="email-provider-status">
          ${appState.data.DB.emailDeliveryStatus?.configured
            ? `<span class="badge badge-success">Configured</span> ${escapeHtml(appState.data.DB.emailDeliveryStatus.provider||'Provider')} · ${escapeHtml(appState.data.DB.emailDeliveryStatus.fromAddress||'')}`
            : `<span class="badge badge-warning">Provider setup required</span>`}
        </p>
        ${!appState.data.DB.emailDeliveryStatus?.configured?`
          <div class="alert alert-warning show" style="font-size:.76rem;margin-top:.6rem;display:block">
            Emails are queued but not sent yet. Ask the system maintainer to add the email provider key
            (<code>RESEND_API_KEY</code>) and sender address (<code>CAMPUSCARE_EMAIL_FROM</code>) as Supabase secrets.
            Queued emails are delivered once these are set.
          </div>
        `:''}
      </div>

      <div class="form-row" style="align-items:end;margin-bottom:1rem">
        <div class="form-group full">
          <label>Send Test Email</label>
          <input id="email-test-recipient" type="email" value="${escapeHtml(appState.auth.currentUser?.email||'')}" placeholder="recipient@example.com">
        </div>
        <div class="form-group">
          <button class="btn btn-primary btn-sm" id="email-test-btn" ${bindAction('click',(event,element)=>{sendTestOperationalEmail()})}>Send Test</button>
        </div>
      </div>

      <div class="alert alert-info show" style="font-size:.76rem">
        <strong>Automatic workflow:</strong> operational notification → secure email queue → scheduled dispatcher every 5 minutes.
        Appointment reminders are generated server-side every hour, so the Patient does not need to keep CampusCare open.
      </div>

      <div id="email-queue-list">${renderEmailQueueHtml()}</div>
    </div>`:''}

    <div class="card" data-settings-panel="backups">
      <div class="card-header">
        <div>
          <h3>Automated Daily Backups</h3>
          <div class="tech-note">Automatic database backups are recorded in the backup history.</div>
        </div>
        ${appState.auth.currentUser?._realSupabase
          ? `<button class="btn btn-primary btn-sm" id="backup-now-btn" ${bindAction('click',(event,element)=>{runRealBackupNow()})}>Back Up Now</button>`
          : `<button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{createDailyBackup(true);persistDB();renderSettings();toast('Local backup snapshot created.','success')})}>Back Up Now</button>`}
      </div>

      ${appState.auth.currentUser?._realSupabase?`
        <div class="grid-2" style="margin-bottom:1rem">
          <div class="official-info-card">
            <h4>Backup Schedule</h4>
            <p id="backup-schedule-text">Automatic database snapshot: every day at 2:00 AM (Asia/Manila)</p>
            <p><strong>Status:</strong> <span class="badge badge-success">Scheduled</span></p>
          </div>
          <div class="official-info-card">
            <h4>Retention Policy</h4>
            <div class="form-group" style="margin-bottom:.4rem">
              <label>Keep snapshots for</label>
              <select id="backup-retention" ${bindAction('change',(event,element)=>{changeBackupRetention()})}>
                ${[7,14,30,60,90,180,365].map(d=>`<option value="${d}" ${Number(appState.data.DB.realBackupRetentionDays||30)===d?'selected':''}>${d} days</option>`).join('')}
              </select>
            </div>
            <p>Expired database snapshots are removed automatically.</p>
          </div>
        </div>

        <div class="alert alert-info show" style="font-size:.78rem">
          <strong>Backup scope:</strong> CampusCare application database records, audit history, notifications, clinical records, appointments,
          inventory, certificates, fitness assessments, privacy consents, settings, and a manifest of uploaded profile/verification files.
          Supabase Auth password secrets are intentionally not copied into application backup files.
        </div>

        <div class="alert alert-warning show" style="font-size:.76rem">
          Restore is intentionally not exposed as a one-click browser action. A production restore should be performed through an authorized
          database recovery procedure to avoid accidentally overwriting live clinical records.
        </div>
      `:''}

      <div id="backup-list">${renderBackupListHtml()}</div>
    </div>`;
  showSettingsSection(sections.some(([id])=>id===ui.tab)?ui.tab:'clinic');
  requestAnimationFrame(sizeBackupHistory);
  if(appState.auth.currentUser?._realSupabase){
    renderEmailDeliveryPanel();
    renderBackupPanel();
  }
}

// A typed confirmation reviews captured values before any local or server settings are changed.
export function confirmCriticalSettings(kind,candidate){
 const phrase=kind==='clinic'?'UPDATE CLINIC':'UPDATE SEMESTER';
 const keys=kind==='clinic'?['clinicName','address','contactEmail','contactPhone','dentalLimitPerSemester','appointmentReminderDays']:['semesterStart','semesterEnd','semester2Start','semester2End'];
 const labels={clinicName:'Clinic',address:'Address',contactEmail:'Email',contactPhone:'Phone',dentalLimitPerSemester:'Dental visits per semester',appointmentReminderDays:'Reminder days',semesterStart:'Semester 1 start',semesterEnd:'Semester 1 end',semester2Start:'Semester 2 start',semester2End:'Semester 2 end'};
 openModal(`<div class="modal"><div class="modal-header"><h3>Confirm Critical ${kind==='clinic'?'Clinic':'Semester'} Changes</h3><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div><div class="modal-body"><p class="settings-danger-notice">These changes apply across CampusCare. Confirm only after checking the values below.</p>${kind==='semester'?`<p><strong>School Year ${escapeHtml(candidate.academicYear)}</strong></p>`:''}<dl class="settings-change-review">${keys.filter(key=>candidate[key]!==appState.data.DB.settings[key]).map(key=>`<div><dt>${labels[key]}</dt><dd>${escapeHtml(String(appState.data.DB.settings[key]??'—'))} → <strong>${escapeHtml(String(candidate[key]))}</strong></dd></div>`).join('')}</dl><label for="critical-settings-phrase">Type <strong>${phrase}</strong> to confirm</label><input id="critical-settings-phrase" autocomplete="off" ${bindAction('input',(event,element)=>{document.getElementById('critical-settings-save').disabled=element.value.trim()!==phrase})}><p id="critical-settings-error" role="alert"></p></div><div class="modal-footer"><button id="critical-settings-save" class="btn btn-danger" disabled ${bindAction('click',async(event,element)=>{
 if(document.getElementById('critical-settings-phrase')?.value.trim()!==phrase)return;
 element.disabled=true;
 const previous={...appState.data.DB.settings};
 const apply=async values=>{if(appState.auth.currentUser?._realSupabase)await saveRealSystemSettings(values,true);else{Object.assign(appState.data.DB.settings,values);persistDB();}};
 try{await apply(candidate);closeAllModals();await renderSettings();toastWithUndo('Settings updated.',async()=>{await apply(previous);await renderSettings();},{undoneMessage:'Previous settings restored.'});}
 catch(error){document.getElementById('critical-settings-error').textContent=error?.message||'Settings could not be saved.';element.disabled=false;}
 })}>Confirm Changes</button></div></div>`);
}
export function saveSettings(){
 const candidate={...appState.data.DB.settings,clinicName:document.getElementById('set-name').value.trim(),address:document.getElementById('set-addr').value.trim(),contactEmail:document.getElementById('set-email').value.trim(),contactPhone:document.getElementById('set-phone').value.trim(),dentalLimitPerSemester:Number(document.getElementById('set-dental').value),appointmentReminderDays:Number(document.getElementById('set-remind').value)};
 if(!candidate.clinicName||!document.getElementById('set-email').checkValidity()||!Number.isInteger(candidate.dentalLimitPerSemester)||candidate.dentalLimitPerSemester<1||candidate.dentalLimitPerSemester>5||!Number.isInteger(candidate.appointmentReminderDays)||candidate.appointmentReminderDays<0||candidate.appointmentReminderDays>14){toast('Check the clinic name, email, visit limit and reminder days.','warning');return;}
 confirmCriticalSettings('clinic',candidate);
}

export async function savePrivacySettings(){
  const version=document.getElementById('set-privacy-version')?.value.trim()||'';
  const updated=document.getElementById('set-privacy-updated')?.value||appState.clinicInformation.TODAY;

  if(!version){
    toast('Privacy notice version is required.','warning');
    return;
  }

  showConfirmDialog({
    title:'Update Privacy Notice Version',
    message:`Set the current CampusCare Privacy Notice to <strong>version ${escapeHtml(version)}</strong>? The version will be recorded with future registration acknowledgements; existing users will not be prompted to acknowledge it again automatically.`,
    confirmLabel:'Update Version',
    onConfirm:async()=>{
      const settings=appState.data.DB.settings,previous={version:settings.privacyPolicyVersion,updated:settings.privacyPolicyUpdated};
      const apply=async(v,u)=>{
        settings.privacyPolicyVersion=v;
        settings.privacyPolicyUpdated=u;
        await saveRealSystemSettings();
        await syncPrivacyAdminSummary();
        await renderSettings();
      };
      try{
        await apply(version,updated);
        toastWithUndo('Privacy notice version updated.',()=>apply(previous.version,previous.updated),{undoneMessage:'Previous privacy notice version restored.'});
      }catch(e){
        toast(e?.message||'Unable to update the privacy notice version.','error');
      }
    }
  });
}

export async function saveSemSettings(){
 const candidate={...appState.data.DB.settings,academicYear:document.getElementById('set-school-year').value,semesterStart:document.getElementById('set-s1s').value,semesterEnd:document.getElementById('set-s1e').value,semester2Start:document.getElementById('set-s2s').value,semester2End:document.getElementById('set-s2e').value};
 const error=validateAcademicYear(candidate,candidate.academicYear);if(error){toast(error,'warning');return;}
 confirmCriticalSettings('semester',candidate);
}

export function loadJsPDF(){
  return new Promise((resolve,reject)=>{
    if(window.jspdf&&window.jspdf.jsPDF){resolve(window.jspdf.jsPDF);return;}
    const sources=[
      'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    ];
    let index=0;
    const tryNext=()=>{
      if(index>=sources.length){reject(new Error('Could not load PDF library'));return;}
      const script=document.createElement('script');
      script.src=sources[index++];
      script.async=true;
      script.onload=()=>window.jspdf&&window.jspdf.jsPDF?resolve(window.jspdf.jsPDF):tryNext();
      script.onerror=tryNext;
      document.head.appendChild(script);
    };
    tryNext();
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}

// settingsAndCertificates: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {saveRealSystemSettings,syncRealSystemSettings} from './systemSettings.js';
import {changeBackupRetention,renderBackupListHtml,renderBackupPanel,runRealBackupNow,syncRealBackupStatus} from './serverBackups.js';
import {dispatchOperationalEmails,renderEmailDeliveryPanel,renderEmailQueueHtml,sendTestOperationalEmail,syncEmailDeliveryStatus} from './emailDelivery.js';
import {openPrivacyNotice,syncPrivacyAdminSummary} from './loginLockout.js';
import {escapeHtml} from './issueReports.js';
import {campusDateFieldHtml} from './datePicker.js';
import {createDailyBackup} from './auditAndBackups.js';
import {persistDB} from './persistence.js';
import {showConfirmDialog,toast} from './theme.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// RESTORED SETTINGS + PATIENT CERTIFICATE RENDERERS
// These functions existed in the original CampusCare build but were
// accidentally removed during the Supabase merge.
// ================================================================

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
  c.innerHTML=`
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><h3>Clinic Settings</h3></div>
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
        <div class="card-header"><h3>Semester Configuration</h3></div>
        <div class="form-group"><label>Semester 1 Start</label>${campusDateFieldHtml('set-s1s',s.semesterStart,'Semester 1 Start')}</div>
        <div class="form-group"><label>Semester 1 End</label>${campusDateFieldHtml('set-s1e',s.semesterEnd,'Semester 1 End')}</div>
        <div class="form-group"><label>Semester 2 Start</label>${campusDateFieldHtml('set-s2s',s.semester2Start,'Semester 2 Start')}</div>
        <div class="form-group"><label>Semester 2 End</label>${campusDateFieldHtml('set-s2e',s.semester2End,'Semester 2 End')}</div>
        <button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{saveSemSettings()})}>Save Semester</button>
      </div>
    </div>
    <div class="card">
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
    ${appState.auth.currentUser?._realSupabase?`<div class="card">
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
          <div class="alert alert-warning show" style="font-size:.76rem;margin-top:.6rem">
            The CampusCare queue and automatic scheduler are active, but external email sending requires two protected
            <strong>Supabase Edge Function secrets</strong>: <code>RESEND_API_KEY</code> and <code>CAMPUSCARE_EMAIL_FROM</code>.
            Do not place these credentials in this HTML file or in GitHub.
          </div>
          <div class="tech-note">
            This Supabase build uses a Resend delivery adapter. When CampusCare is later moved to the planned Vercel/Node.js architecture,
            the same <code>email_outbox</code> queue can be consumed by Nodemailer without changing the patient-facing workflow.
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

    <div class="card">
      <div class="card-header">
        <div>
          <h3>Automated Daily Backups</h3>
          <div class="tech-note">Server-side CampusCare database snapshots are created automatically and recorded in Supabase backup logs.</div>
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
  if(appState.auth.currentUser?._realSupabase){
    renderEmailDeliveryPanel();
    renderBackupPanel();
  }
}

export function saveSettings(){
  showConfirmDialog({
    title:'Save Clinic Settings',
    message:'Save these clinic-wide settings and reminder rules?',
    confirmLabel:'Save Settings',
    onConfirm:async()=>{
      const s=appState.data.DB.settings;
      s.clinicName=document.getElementById('set-name').value.trim();
      s.address=document.getElementById('set-addr').value.trim();
      s.contactEmail=document.getElementById('set-email').value.trim();
      s.contactPhone=document.getElementById('set-phone')?.value.trim()||appState.clinicInformation.CTU_CLINIC_INFO.phone;
      s.dentalLimitPerSemester=Math.max(1,Math.min(5,parseInt(document.getElementById('set-dental').value,10)||1));
      s.appointmentReminderDays=Math.max(0,Math.min(14,parseInt(document.getElementById('set-remind').value,10)||0));

      try{
        if(appState.auth.currentUser?._realSupabase){
          await saveRealSystemSettings();
        }else{
          persistDB();
        }
        toast('Settings saved.','success');
      }catch(e){
        toast(e?.message||'Unable to save settings.','error');
      }
    }
  });
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
      try{
        appState.data.DB.settings.privacyPolicyVersion=version;
        appState.data.DB.settings.privacyPolicyUpdated=updated;
        await saveRealSystemSettings();
        await syncPrivacyAdminSummary();
        toast('Privacy notice version updated.','success');
        await renderSettings();
      }catch(e){
        toast(e?.message||'Unable to update the privacy notice version.','error');
      }
    }
  });
}

export async function saveSemSettings(){
  const s=appState.data.DB.settings;
  s.semesterStart=document.getElementById('set-s1s').value;
  s.semesterEnd=document.getElementById('set-s1e').value;
  s.semester2Start=document.getElementById('set-s2s').value;
  s.semester2End=document.getElementById('set-s2e').value;

  try{
    if(appState.auth.currentUser?._realSupabase){
      await saveRealSystemSettings();
    }else{
      persistDB();
    }
    toast('Semester settings saved.','success');
  }catch(e){
    toast(e?.message||'Unable to save semester settings.','error');
  }
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

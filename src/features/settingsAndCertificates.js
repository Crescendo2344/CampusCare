// settingsAndCertificates: imported feature APIs; state belongs to explicit application namespaces.
import {fmtDate} from './inputValidation.js';
import {academicYearFor,validateAcademicYear} from '../domain/academic-year.js';
import {openModal,closeAllModals} from './modals.js';
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {saveRealSystemSettings,syncRealSystemSettings} from './systemSettings.js';
import {changeBackupRetention,renderBackupListHtml,renderBackupPanel,sizeBackupHistory,runRealBackupNow,syncRealBackupStatus} from './serverBackups.js';
import {dispatchOperationalEmails,renderEmailDeliveryPanel,renderEmailQueueHtml,sendTestOperationalEmail,syncEmailDeliveryStatus} from './emailDelivery.js';
import {openPrivacyNotice,privacyAction,syncPrivacyAdminSummary} from './loginLockout.js';
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
        syncPrivacyAdminSummary(),
        syncPrivacyRequests()
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
      <div class="card settings-clinic-card" id="clinic-settings-card">
        <div class="card-header"><h3>Clinic Settings</h3><button type="button" class="btn btn-sm" id="clinic-settings-edit" ${bindAction('click',()=>setClinicSettingsEditing(true))}><i class="bi bi-pencil" aria-hidden="true"></i> Edit</button></div>
        <div id="set-msg"></div>
        <fieldset class="settings-group" disabled><legend><i class="bi bi-calendar-check" aria-hidden="true"></i> Booking rules</legend>
          <div class="form-group"><label for="set-lead">Booking lead time (hours)</label><input id="set-lead" type="number" min="0" max="72" value="${Number(s.bookingLeadHours??24)}"></div>
          <div class="form-row"><div class="form-group"><label for="set-lunch-start">Lunch break starts</label><input id="set-lunch-start" type="time" min="10:00" max="15:00" step="900" value="${escapeHtml(s.lunchBreakStart||'12:00')}"></div>
            <div class="form-group"><label for="set-lunch-end">Lunch break ends</label><input id="set-lunch-end" type="time" min="10:00" max="15:00" step="900" value="${escapeHtml(s.lunchBreakEnd||'13:00')}"></div></div>
        </fieldset>
        <fieldset class="settings-group" disabled><legend><i class="bi bi-bell" aria-hidden="true"></i> Reminders &amp; notices</legend>
          <div class="form-row"><div class="form-group"><label for="set-remind">Appointment reminder (days before)</label><input id="set-remind" type="number" min="0" max="14" value="${Number(s.appointmentReminderDays??1)}"></div>
            <div class="form-group"><label for="set-notice">Schedule change notice (days)</label><input id="set-notice" type="number" min="0" max="30" value="${Number(s.scheduleChangeNoticeDays??3)}"></div></div>
        </fieldset>
        <fieldset class="settings-group" disabled><legend><i class="bi bi-shield-lock" aria-hidden="true"></i> Security</legend>
          <div class="form-group"><label for="set-timeout">Sign out after inactivity (minutes)</label><input id="set-timeout" type="number" min="5" max="120" value="${Number(s.sessionTimeoutMinutes??30)}"></div>
        </fieldset>
        <fieldset class="settings-group" disabled><legend><i class="bi bi-envelope" aria-hidden="true"></i> Contact on documents</legend>
          <div class="form-row"><div class="form-group"><label for="set-email">Clinic email</label><input id="set-email" type="email" value="${escapeHtml(s.contactEmail||'')}"></div>
            <div class="form-group"><label for="set-phone">Clinic phone</label><input id="set-phone" value="${escapeHtml(s.contactPhone||appState.clinicInformation.CTU_CLINIC_INFO.phone)}"></div></div>
        </fieldset>
        <div class="settings-edit-actions" id="clinic-settings-actions" hidden>
          <button type="button" class="btn btn-sm" ${bindAction('click',()=>renderSettings())}>Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{saveSettings()})}>Save Settings</button>
        </div>
      </div>
      <div class="settings-side">
      <div class="card">
        <div class="card-header"><h3>Semester Configuration</h3></div><p class="settings-danger-notice">Critical settings: changing semester boundaries changes dental visit quotas and semester reporting. Existing records are retained.</p><div class="form-group"><label for="set-school-year">School Year</label><select id="set-school-year">${Array.from({length:8},(_,i)=>Number(academicYearFor(s).slice(0,4))-2+i).map(year=>`<option value="${year}-${year+1}" ${academicYearFor(s)===`${year}-${year+1}`?'selected':''}>${year}–${year+1}</option>`).join('')}</select><p class="form-note">Use the actual school calendar: Semester 1 begins in the first year; Semester 2 ends in the following year.</p></div>
        <div class="form-group"><label>Semester 1 Start</label>${campusDateFieldHtml('set-s1s',s.semesterStart,'Semester 1 Start')}</div>
        <div class="form-group"><label>Semester 1 End</label>${campusDateFieldHtml('set-s1e',s.semesterEnd,'Semester 1 End')}</div>
        <div class="form-group"><label>Semester 2 Start</label>${campusDateFieldHtml('set-s2s',s.semester2Start,'Semester 2 Start')}</div>
        <div class="form-group"><label>Semester 2 End</label>${campusDateFieldHtml('set-s2e',s.semester2End,'Semester 2 End')}</div>
        <button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{saveSemSettings()})}>Save Semester</button>
      </div>
      <div class="card settings-profile-card">
        <div class="card-header"><h3><i class="bi bi-lock" aria-hidden="true"></i> Clinic profile</h3></div>
        <dl class="settings-readonly">
          <div><dt>Clinic name</dt><dd>${escapeHtml(s.clinicName||'—')}</dd></div>
          <div><dt>Address</dt><dd>${escapeHtml(s.address||'—')}</dd></div>
          <div><dt>Dental visits allowed per semester</dt><dd>${Number(s.dentalLimitPerSemester||1)}</dd></div>
        </dl>
      </div>
      </div>
    </div>
    <div data-settings-panel="privacy">${privacyPanelHtml(s)}</div>
    ${appState.auth.currentUser?._realSupabase?`<div class="card" data-settings-panel="email">
      <div class="card-header">
        <div>
          <h3>Operational Email Delivery</h3>
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
            Emails are queued but not sent yet. Ask the system maintainer to add the mail server settings
            (<code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>) and sender address
            (<code>CAMPUSCARE_EMAIL_FROM</code>) as Supabase secrets. Queued emails are delivered once these are set.
          </div>
        `:''}
      </div>

      <div class="form-group email-test-row">
        <label for="email-test-recipient">Send a test email</label>
        <div class="email-test-controls">
          <input id="email-test-recipient" type="email" autocomplete="email" value="${escapeHtml(appState.auth.currentUser?.email||'')}" placeholder="recipient@example.com" ${bindAction('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();sendTestOperationalEmail();}})}>
          <button type="button" class="btn btn-primary btn-sm" id="email-test-btn" ${bindAction('click',()=>sendTestOperationalEmail())}><i class="bi bi-send" aria-hidden="true"></i> Send test</button>
        </div>
        <p class="registration-field-error" id="email-test-error" aria-live="polite" hidden></p>
      </div>

      <div id="email-queue-list">${renderEmailQueueHtml()}</div>
    </div>`:''}

    <div class="card" data-settings-panel="backups">
      <div class="card-header">
        <div>
          <h3>Automated Daily Backups</h3>
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
          </div>
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
 const keys=kind==='clinic'?['bookingLeadHours','lunchBreakStart','lunchBreakEnd','appointmentReminderDays','scheduleChangeNoticeDays','sessionTimeoutMinutes','contactEmail','contactPhone']:['semesterStart','semesterEnd','semester2Start','semester2End'];
 const labels={clinicName:'Clinic',address:'Address',contactEmail:'Email',contactPhone:'Phone',dentalLimitPerSemester:'Dental visits per semester',appointmentReminderDays:'Reminder days',bookingLeadHours:'Booking lead time (hours)',lunchBreakStart:'Lunch break starts',lunchBreakEnd:'Lunch break ends',scheduleChangeNoticeDays:'Schedule change notice (days)',sessionTimeoutMinutes:'Sign out after (minutes)',semesterStart:'Semester 1 start',semesterEnd:'Semester 1 end',semester2Start:'Semester 2 start',semester2End:'Semester 2 end'};
 openModal(`<div class="modal"><div class="modal-header"><h3>Confirm Critical ${kind==='clinic'?'Clinic':'Semester'} Changes</h3><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div><div class="modal-body"><p class="settings-danger-notice">These changes apply across CampusCare. Confirm only after checking the values below.</p>${kind==='semester'?`<p><strong>School Year ${escapeHtml(candidate.academicYear)}</strong></p>`:''}<dl class="settings-change-review">${keys.filter(key=>candidate[key]!==appState.data.DB.settings[key]).map(key=>`<div><dt>${labels[key]}</dt><dd>${escapeHtml(String(appState.data.DB.settings[key]??'—'))} → <strong>${escapeHtml(String(candidate[key]))}</strong></dd></div>`).join('')}</dl><label for="critical-settings-phrase">Type <strong>${phrase}</strong> to confirm</label><input id="critical-settings-phrase" autocomplete="off" ${bindAction('input',(event,element)=>{document.getElementById('critical-settings-save').disabled=element.value.trim()!==phrase})}><p id="critical-settings-error" role="alert"></p></div><div class="modal-footer"><button id="critical-settings-save" class="btn btn-danger" disabled ${bindAction('click',async(event,element)=>{
 if(document.getElementById('critical-settings-phrase')?.value.trim()!==phrase)return;
 element.disabled=true;
 const previous={...appState.data.DB.settings};
 const apply=async values=>{if(appState.auth.currentUser?._realSupabase)await saveRealSystemSettings(values,true);else{Object.assign(appState.data.DB.settings,values);persistDB();}};
 try{await apply(candidate);closeAllModals();await renderSettings();toastWithUndo('Settings updated.',async()=>{await apply(previous);await renderSettings();},{undoneMessage:'Previous settings restored.'});}
 catch(error){document.getElementById('critical-settings-error').textContent=error?.message||'Settings could not be saved.';element.disabled=false;}
 })}>Confirm Changes</button></div></div>`);
}
// Clinic Settings open read-only; Edit unlocks the fields and shows Save and Cancel.
export function setClinicSettingsEditing(on){
  const card=document.getElementById('clinic-settings-card');if(!card)return;
  for(const group of card.querySelectorAll('fieldset.settings-group'))group.disabled=!on;
  card.classList.toggle('editing',on);
  const edit=document.getElementById('clinic-settings-edit');if(edit)edit.hidden=on;
  const actions=document.getElementById('clinic-settings-actions');if(actions)actions.hidden=!on;
  if(on)document.getElementById('set-lead')?.focus();
}
export function saveSettings(){
 const num=id=>Number(document.getElementById(id).value),val=id=>document.getElementById(id).value.trim();
 const candidate={...appState.data.DB.settings,contactEmail:val('set-email'),contactPhone:val('set-phone'),
   appointmentReminderDays:num('set-remind'),bookingLeadHours:num('set-lead'),scheduleChangeNoticeDays:num('set-notice'),sessionTimeoutMinutes:num('set-timeout'),
   lunchBreakStart:val('set-lunch-start'),lunchBreakEnd:val('set-lunch-end')};
 const whole=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
 const problems=[
   !candidate.contactEmail||!document.getElementById('set-email').checkValidity()?'a valid clinic email':'',
   !whole(candidate.bookingLeadHours,0,72)?'booking lead time (0–72 hours)':'',
   !whole(candidate.appointmentReminderDays,0,14)?'reminder days (0–14)':'',
   !whole(candidate.scheduleChangeNoticeDays,0,30)?'schedule change notice (0–30 days)':'',
   !whole(candidate.sessionTimeoutMinutes,5,120)?'sign-out time (5–120 minutes)':'',
   !(candidate.lunchBreakStart&&candidate.lunchBreakEnd&&candidate.lunchBreakStart<candidate.lunchBreakEnd&&candidate.lunchBreakStart>='10:00'&&candidate.lunchBreakEnd<='15:00')?'a lunch break between 10:00 AM and 3:00 PM':''
 ].filter(Boolean);
 if(problems.length){toast(`Check ${problems.join(', ')}.`,'warning');return;}
 confirmCriticalSettings('clinic',candidate);
}

// Privacy & data protection, modelled on the consent and request tools of data-protection platforms:
// who has acknowledged the current notice, publishing a new version (everyone is asked again at their
// next sign-in), and a queue of privacy/data requests the administrator resolves with a reply.
function privacyPanelHtml(s){
  const sum=appState.data.DB.privacyAdminSummary||{};
  const active=Number(sum.active_users||0),acked=Number(sum.current_acknowledged||0);
  const requests=appState.data.DB.privacyRequests||[];
  const open=requests.filter(r=>!r.resolved_at);
  const stat=(value,label,cls='')=>`<div class="stat-card"><div class="stat-val ${cls}">${value}</div><div class="stat-lbl">${label}</div></div>`;
  return `<div class="card">
      <div class="card-header"><h3>Privacy &amp; Data Protection</h3><button class="btn btn-sm" ${bindAction('click',()=>openPrivacyNotice())}>View Privacy Notice</button></div>
      <div class="grid-3 privacy-stats">
        ${stat(`v${escapeHtml(s.privacyPolicyVersion||'1.0')}`,'Current notice version')}
        ${stat(`${acked}${active?` <small>of ${active}</small>`:''}`,'Acknowledged this version')}
        ${stat(open.length,'Open privacy requests',open.length?'text-danger':'')}
      </div>
    </div>
    <div class="card" id="privacy-version-card">
      <div class="card-header"><h3>Notice version</h3><button type="button" class="btn btn-sm" id="privacy-version-edit" ${bindAction('click',()=>setPrivacyVersionEditing(true))}><i class="bi bi-pencil" aria-hidden="true"></i> Edit</button></div>
      <fieldset class="settings-group" id="privacy-version-fields" disabled><legend><i class="bi bi-file-earmark-text" aria-hidden="true"></i> Published notice</legend>
        <div class="form-row">
          <div class="form-group"><label for="set-privacy-version">Version</label><input id="set-privacy-version" maxlength="40" value="${escapeHtml(s.privacyPolicyVersion||'1.0')}"></div>
          <div class="form-group"><label for="set-privacy-updated">Updated on</label>${campusDateFieldHtml('set-privacy-updated',s.privacyPolicyUpdated||appState.clinicInformation.TODAY,'Privacy Notice Updated')}</div>
        </div>
      </fieldset>
      <div class="settings-edit-actions" id="privacy-version-actions" hidden>
        <button type="button" class="btn btn-sm" ${bindAction('click',()=>renderSettings())}>Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" ${bindAction('click',()=>savePrivacySettings())}>Publish version</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Privacy requests</h3></div>
      ${requests.length?`<div class="table-wrap"><table class="privacy-requests"><thead><tr><th scope="col">Requested</th><th scope="col">Person</th><th scope="col">Request</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${requests.map(r=>`<tr>
          <td data-label="Requested">${escapeHtml(fmtDate(String(r.consented_at||'').slice(0,10)))}</td>
          <td data-label="Person"><strong>${escapeHtml(r.requester||'Unknown user')}</strong><div class="text-muted">${escapeHtml(r.requester_role||'')}${r.requester_email?` · ${escapeHtml(r.requester_email)}`:''}</div></td>
          <td data-label="Request"><strong>${escapeHtml(r.request_type||'Other')}</strong><div>${escapeHtml(r.notes||'')}</div>${r.resolution?`<div class="text-muted">Reply: ${escapeHtml(r.resolution)}</div>`:''}</td>
          <td data-label="Status">${r.resolved_at?`<span class="badge badge-success">Resolved</span><div class="text-muted">${escapeHtml(fmtDate(String(r.resolved_at).slice(0,10)))}${r.resolved_by_name?` · ${escapeHtml(r.resolved_by_name)}`:''}</div>`:'<span class="badge badge-warning">Open</span>'}</td>
          <td data-label="Actions">${r.resolved_at?'':`<button type="button" class="btn btn-xs btn-primary" ${bindAction('click',()=>openResolvePrivacyRequest(r))}>Resolve</button>`}</td>
        </tr>`).join('')}</tbody></table></div>`
      :'<div class="empty-state"><p>No privacy requests yet.</p></div>'}
    </div>`;
}
function setPrivacyVersionEditing(on){
  const fields=document.getElementById('privacy-version-fields');if(fields)fields.disabled=!on;
  const edit=document.getElementById('privacy-version-edit');if(edit)edit.hidden=on;
  const actions=document.getElementById('privacy-version-actions');if(actions)actions.hidden=!on;
  if(on)document.getElementById('set-privacy-version')?.focus();
}
function openResolvePrivacyRequest(r){
  openModal(`<div class="modal modal-sm" role="dialog" aria-labelledby="pr-title">
    <div class="modal-header"><div><h3 id="pr-title">Resolve privacy request</h3><div class="text-muted">${escapeHtml(r.requester||'')} · ${escapeHtml(r.request_type||'Other')}</div></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body"><p>${escapeHtml(r.notes||'')}</p>
      <div class="form-group"><label for="pr-reply">Reply to the person <span class="required">*</span></label><textarea id="pr-reply" rows="4" maxlength="1200"></textarea><p class="registration-field-error" id="pr-reply-error" hidden></p></div></div>
    <div class="modal-footer"><button type="button" class="btn btn-primary" id="pr-save" ${bindAction('click',async(event,element)=>{
      const reply=document.getElementById('pr-reply').value.trim(),err=document.getElementById('pr-reply-error');
      if(reply.length<5){err.textContent='Write a short reply (at least 5 characters).';err.hidden=false;return;}
      element.disabled=true;
      try{await privacyAction({action:'resolve_request',consent_id:r.consent_id,resolution:reply});closeAllModals();toast('Request resolved. The person was notified.','success');await syncPrivacyRequests();await syncPrivacyAdminSummary();await renderSettings();}
      catch(e){err.textContent=e?.message||'The request could not be resolved.';err.hidden=false;element.disabled=false;}
    })}>Resolve and notify</button></div>
  </div>`);
}
export async function syncPrivacyRequests(){
  if(!appState.auth.currentUser?._realSupabase||appState.auth.currentUser.role!=='Administrator')return [];
  const result=await privacyAction({action:'list_requests'});
  appState.data.DB.privacyRequests=result.requests||[];
  return appState.data.DB.privacyRequests;
}

export async function savePrivacySettings(){
  const version=document.getElementById('set-privacy-version')?.value.trim()||'';
  const updated=document.getElementById('set-privacy-updated')?.value||appState.clinicInformation.TODAY;

  if(!version){
    toast('Privacy notice version is required.','warning');
    return;
  }

  showConfirmDialog({
    title:'Publish Privacy Notice Version',
    message:`Publish <strong>version ${escapeHtml(version)}</strong> of the Privacy Notice? Everyone will be asked to acknowledge it at their next sign-in.`,
    confirmLabel:'Publish',
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
        toastWithUndo(`Privacy Notice version ${version} published.`,()=>apply(previous.version,previous.updated),{undoneMessage:'Previous privacy notice version restored.'});
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

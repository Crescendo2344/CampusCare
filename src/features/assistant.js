// assistant: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {navTo} from './navigationRaceProtection.js';
import {getInventoryForecast,inventoryRecords} from './inventoryService.js';
import {computeCampusHealthAnalytics} from './predictiveAnalytics.js';
import {getLowStock,getPatientByUserId,getUserById} from './documentScanner.js';
import {appointmentRecords} from './appointmentService.js';
import {fmtDate,fmtTime} from './inputValidation.js';
import {docName} from './messaging.js';
import {getDoctorLeaves} from './doctorSchedule.js';
import {addNotif,notificationCenterAction,notificationPageFor,notificationRecords,notificationTone,updateNotifUI} from './notifications.js';
import {toast} from './theme.js';
import {bindAction,notificationData} from '../dependencies.js';
// ================================================================
// AI ASSISTANT — a built-in helper that answers from your live app
// data and can jump you to the right page. It's a rule-based/pattern-
// matching assistant (not a connected generative-AI model), which
// means it works fully offline and never sends your data anywhere.
// ================================================================

export function resetAssistantChat(){
  appState.assistant.assistantHistory=[];
  const name=appState.auth.currentUser?appState.auth.currentUser.fname:'there';
  addAssistantMessage('bot',`Hi ${name}! I'm your CampusCare Assistant. I can look up things in the app for you, or point you to the right page. Try one of these, or just ask me something:`);
  renderAssistantChips();
}

export function getAssistantChips(){
  if(!appState.auth.currentUser)return [];
  const role=appState.auth.currentUser.role;
  if(role==='Administrator')return ['Any predicted stock-outs?','Campus health trends','How many pending approvals?',"Today's appointments"];
  if(role==='Doctor')return ["Today's appointments",'Campus health trends','How do I use Clinical Copilot?'];
  if(role==='Staff')return ['Any predicted stock-outs?','Campus health trends','Pending approvals'];
  return ['My next appointment','How do I book an appointment?','Clinic hours'];
}

export function renderAssistantChips(){
  const el=document.getElementById('ai-chips');
  if(!el)return;
  el.innerHTML=getAssistantChips().map(c=>`<div class="ai-chip" ${bindAction('click',(event,element)=>{askAssistant((String(c)))})}>${escapeHtml(c)}</div>`).join('');
}

export function toggleAssistant(){
  const panel=document.getElementById('ai-panel');
  const opening=!panel.classList.contains('show');
  panel.classList.toggle('show',opening);
  if(opening){
    document.getElementById('ai-fab-dot').style.display='none';
    setTimeout(()=>document.getElementById('ai-input').focus(),150);
  }
}

export function addAssistantMessage(role,text){
  appState.assistant.assistantHistory.push({role,text});
  const wrap=document.getElementById('ai-messages');
  if(!wrap)return;
  const div=document.createElement('div');
  div.className=`ai-msg ${role==='user'?'user':'bot'}`;
  div.textContent=text;
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
}

export function askAssistant(text){
  document.getElementById('ai-input').value=text;
  sendAssistantMessage();
}

export function sendAssistantMessage(){
  const input=document.getElementById('ai-input');
  const text=input.value.trim();
  if(!text)return;
  addAssistantMessage('user',text);
  input.value='';
  const reply=getAssistantReply(text);
  setTimeout(()=>addAssistantMessage('bot',reply),250);
}

export function getAssistantReply(raw){
  const q=raw.toLowerCase();
  const u=appState.auth.currentUser;
  if(!u)return "Please log in first so I can help with your account.";
  const role=u.role;
  const has=(...words)=>words.some(w=>q.includes(w));
  const hasAllWords=(phrase)=>phrase.split(' ').every(w=>q.includes(w));

  // Greetings
  if(has('hello','hi ','hey','good morning','good afternoon') || q==='hi')
    return `Hello, ${u.fname}! Ask me about appointments, approvals, inventory, or how to do something in the app.`;

  // Navigation intent takes priority over keyword data-lookups below,
  // since "take me to inventory" should navigate, not report stock levels.
  if(has('go to','open ','take me to','show me','navigate to')){
    const items=(appState.topbarAndNavigation.NAV_CONFIG[role]||[]).filter(i=>i.id);
    const match=items.find(i=>q.includes(i.label.toLowerCase().replace('&amp;','&')));
    if(match){
      navTo(match.id);
      toggleAssistant();
      return `Sure, here's ${match.label.replace('&amp;','&')}.`;
    }
  }

  // Emerging-tech intelligence shortcuts
  if(has('predicted stock','stock-out','stockout','inventory forecast','forecast inventory')){
    if(!(role==='Administrator'||role==='Staff'||role==='Doctor'))return "Inventory forecasting is available to clinic staff.";
    const rows=inventoryRecords().filter(i=>!i.archived).map(i=>({i,f:getInventoryForecast(i)})).filter(x=>x.f.hasData).sort((a,b)=>a.f.daysRemaining-b.f.daysRemaining);
    if(!rows.length)return "There is not enough disbursement history yet to calculate a reliable inventory forecast.";
    const risk=rows.filter(x=>x.f.daysRemaining<=14);
    return risk.length
      ?`${risk.length} item${risk.length===1?' is':'s are'} projected to deplete within 14 days: ${risk.slice(0,4).map(x=>`${x.i.name} (~${x.f.daysRemaining} days)`).join(', ')}. Open Inventory for reorder recommendations.`
      :"No item with sufficient usage history is projected to deplete within 14 days.";
  }

  if(has('campus health trend','health trends','health analytics','trend alert')){
    if(role==='Patient')return "Campus-wide analytics are available to authorized clinic personnel.";
    const a=computeCampusHealthAnalytics(7),top=a.signalRows[0];
    return `The current 7-day analytics window contains ${a.current.length} clinical record${a.current.length===1?'':'s'} (${a.visitGrowth>=0?'+':''}${a.visitGrowth}% versus the previous window). ${top?`Top detected signal: ${top.name} (${top.now}). `:''}${a.alerts.length?`${a.alerts.length} trend alert${a.alerts.length===1?'':'s'} meet the review threshold.`:'No unusual cluster currently meets the alert threshold.'}`;
  }

  if(has('clinical copilot','copilot')){
    if(role!=='Doctor'&&role!=='Administrator')return "The Clinical Copilot is available to doctors and administrators from a patient's record.";
    return "Open Patient Records (or My Patients), view a patient, then choose “Clinical Copilot.” It summarizes existing history, highlights recorded allergies/follow-ups, and prepares a draft structured note. All output requires clinician review.";
  }

  // Low stock / inventory (staff/admin/doctor)
  if(has('low stock','stock level','running out','out of stock')){
    if(!(role==='Administrator'||role==='Staff'||role==='Doctor'))return "Inventory info is only available to clinic staff.";
    const low=getLowStock();
    if(!low.length)return "Good news — no items are currently below their restock threshold.";
    return `There ${low.length===1?'is':'are'} ${low.length} item${low.length===1?'':'s'} low on stock: ${low.map(i=>`${i.name} (${i.qty} ${i.unit} left)`).join(', ')}. Head to Inventory to reorder.`;
  }

  // Pending approvals (staff/admin)
  if(has('pending approval','approval queue','awaiting approval','new registration')){
    if(!(role==='Administrator'||role==='Staff'))return "Approval info is only available to staff and administrators.";
    const pending=appState.data.DB.users.filter(x=>x.status==='Pending').length;
    return pending?`There ${pending===1?'is':'are'} ${pending} registration${pending===1?'':'s'} waiting for approval. You'll find them in Approval Queue.`:"No pending registrations right now — the queue is clear.";
  }

  // Today's appointments
  if(has("today's appointment","today appointment","appointments today","my appointment","upcoming appointment","next appointment")){
    if(role==='Patient'){
      const mine=appointmentRecords().filter(a=>appState.auth.currentPatient&&a.patientId===appState.auth.currentPatient.id&&a.status==='Scheduled').sort((a,b)=>a.date.localeCompare(b.date));
      if(!mine.length)return "You don't have any upcoming appointments. Want to book one from the Appointments page?";
      const next=mine[0];
      const doc=getUserById(next.doctorId);
      return `Your next appointment is ${next.clinic} – ${next.service} on ${fmtDate(next.date)} at ${fmtTime(next.time)}${doc?' with '+docName(doc):''}.`;
    }
    if(role==='Doctor'){
      const mine=appointmentRecords().filter(a=>a.doctorId===u.id&&a.date===appState.clinicInformation.TODAY&&a.status==='Scheduled');
      return mine.length?`You have ${mine.length} appointment${mine.length===1?'':'s'} today, starting with ${fmtTime(mine.sort((a,b)=>a.time.localeCompare(b.time))[0].time)}.`:"You have no appointments scheduled for today.";
    }
    const today=appointmentRecords().filter(a=>a.date===appState.clinicInformation.TODAY&&a.status==='Scheduled');
    return today.length?`There ${today.length===1?'is':'are'} ${today.length} appointment${today.length===1?'':'s'} scheduled today across the clinic.`:"No appointments are scheduled for today.";
  }

  // Doctor's own leave/schedule
  if(has('day off','days off','my leave','my schedule','my hours','my work schedule')){
    if(role!=='Doctor')return "Schedule info here is specific to doctor accounts — admins can check Doctor Work Schedules under User Management.";
    const upcoming=getDoctorLeaves(u.id);
    const scheduleMsg=`Your hours are ${fmtTime(u.startTime||'08:00')}–${fmtTime(u.endTime||'17:00')} on ${(u.workDays||[]).join(', ')||'no set days yet'}.`;
    return upcoming.length?`${scheduleMsg} You have ${upcoming.length} approved day${upcoming.length===1?'':'s'} off coming up, starting ${fmtDate(upcoming[0].date)}.`:`${scheduleMsg} No upcoming approved days off.`;
  }

  // Patient count
  if(has('how many patient','total patient','number of patient')){
    if(!(role==='Administrator'||role==='Staff'||role==='Doctor'))return "Patient counts are only available to clinic staff.";
    const count=(appState.auth.currentUser?.role==='Administrator'?appState.data.DB.patients.filter(p=>p._realSupabase):appState.data.DB.patients).filter(p=>!p.archived).length;
    return `There ${count===1?'is':'are'} currently ${count} active patient record${count===1?'':'s'} on file.`;
  }

  // Clinic info
  if(has('clinic hours','contact number','clinic address','clinic email','where is the clinic','education building')){
    return `${appState.clinicInformation.CTU_CLINIC_INFO.name} is located at ${appState.clinicInformation.CTU_CLINIC_INFO.location}. Medical Clinic hours posted on site are: regular ${appState.clinicInformation.CTU_CLINIC_INFO.medicalHours.regular}; extended ${appState.clinicInformation.CTU_CLINIC_INFO.medicalHours.extendedWeekdays}; ${appState.clinicInformation.CTU_CLINIC_INFO.medicalHours.saturday}; ${appState.clinicInformation.CTU_CLINIC_INFO.medicalHours.sunday}. Contact: ${appState.clinicInformation.CTU_CLINIC_INFO.phone} or ${appState.clinicInformation.CTU_CLINIC_INFO.email}.`;
  }

  // How-to guidance
  const howTo=[
    {keys:['add patient','new patient','register patient','create patient'],ans:"Go to Patient Records and click \"+ Add Patient\" (staff/admin), or have the patient register their own account from the login screen — you can approve it from Approval Queue."},
    {keys:['edit patient','update patient information','update patient record'],ans:"Open Patient Records, click a patient row (or the Edit button) to open their record, then update the details and save."},
    {keys:['archive patient','remove patient','delete patient'],ans:"Patient records can't be deleted — open Patient Records and use the \"Archive\" button instead. You can restore it anytime from the Archived filter."},
    {keys:['archive user','suspend user','remove user','delete user'],ans:"In User Management, use Suspend to temporarily block login, or Archive to hide the account while keeping the record. Both are reversible."},
    {keys:['book appointment','schedule appointment','new appointment','make appointment'],ans:"Go to Appointments and click \"+ Book Appointment\", choose a doctor and date, then pick an open time slot. The Medical and Dental Clinic is on the Ground Floor of the Education Building."},
    {keys:['intramurals','eligibility form','sports medical certificate','sports clearance'],ans:"For the posted Intramurals 2026–2027 process: secure the Eligibility Form from your coach, complete your personal information and sports event, sign the waiver/release, obtain the required parent/guardian and coach signatures, and bring the completed form to the clinic at the Ground Floor, Education Building. The clinic notice also states that enrollment medical requirements must have been submitted to be eligible for a medical certificate."},
    {keys:['graduate medical requirements','graduate school requirements','medical requirements submission','chest xray','cbc','drug test'],ans:"The posted Graduate School medical-requirements notice asks new graduate students to submit complete, clear, correctly named JPEG files, each not exceeding 1 MB. The listed requirements include the Medical Certificate/physical examination report, typewritten Chest X-ray result (not the film), pregnancy documentation when applicable, CBC, and Drug Test result."},
    {keys:['cancel appointment'],ans:"Open Appointments, find the appointment, and click \"Cancel.\" You'll be asked to confirm since it notifies the patient."},
    {keys:['complete appointment','mark appointment done','finish appointment'],ans:"Doctors complete an appointment by clicking \"Add Notes & Complete\" and filling in the diagnosis — notes are required before it can be marked done."},
    {keys:['reset password','forgot password'],ans:"On the login screen, click \"Forgot password?\". CampusCare sends a secure password-reset link to the registered email address; open that link to create a new password."},
    {keys:['change password','update password'],ans:"Go to Account Settings → Change Password. Enter your current password and a new password that meets the security checklist. Password changes are limited to once every 7 days."},
    {keys:['change name','update name','name change'],ans:role==='Administrator'?"As an administrator, you can update your own name directly from User Management by editing your account.":"For security, names can only be changed by an administrator. Go to Account Settings and use \"Request a name change.\""},
    {keys:['change email','update email','change my email'],ans:role==='Administrator'?"As an administrator, you can update your email directly on Account Settings — no verification code needed.":"Go to Account Settings, enter the new email, and save. CampusCare sends a 6-digit reauthentication code to your current verified email or phone before starting the email-change verification."},
    {keys:['change phone','update phone','change contact number','update contact'],ans:role==='Administrator'?"As an administrator, you can update your contact number directly on Account Settings — no verification code needed.":"Go to Account Settings, enter the new contact number, and save. CampusCare first sends a 6-digit reauthentication code to your current verified email or phone, then sends an SMS code to the new number before completing the change."},
    {keys:['change profile photo','update profile photo','change my picture','update picture'],ans:"Go to Account Settings → Profile Photo, then click \"Upload Photo\" or \"Use Camera\" to set a new one."},
    {keys:['dark mode','night mode','theme'],ans:"Click the moon/sun icon at the bottom of the sidebar (or on the login screen) to switch between light and dark mode."},
    {keys:['report issue','report bug','feedback','suggestion'],ans:"Use \"Report an Issue\" in the sidebar — you can describe the problem, attach a screenshot, and administrators can reply directly to you."},
    {keys:['export report','download report','pdf report','excel report','word report'],ans:"Go to Reports & Analytics, generate the report you need, then use the Export buttons to save it as CSV, Word, or PDF."},
    {keys:['generate report','create report','view analytics'],ans:"Go to Reports & Analytics, pick a report type and chart style, then click Generate. You can filter by date and college too."},
    {keys:['approve registration','approve user','approve account'],ans:"Go to Approval Queue, review the uploaded ID and selfie against the person's details, then click Approve or Reject."},
    {keys:['request schedule change','change my schedule','change my hours'],ans:"Doctors can go to My Schedule and click \"Request Schedule Change\" — propose new hours and an effective date, and an admin will review it."},
    {keys:['day off','request leave','take a day off','vacation'],ans:"Doctors can go to My Schedule → Time Off and click \"Request Day Off.\" It needs admin approval before bookings are blocked on that date."},
    {keys:['add inventory','new inventory item','add stock item'],ans:"Go to Inventory and click \"+ Add Item.\" You can also attach a photo by uploading one or using your camera."},
    {keys:['update stock','adjust quantity','restock'],ans:"In Inventory, click \"Update Qty\" next to an item to add or remove stock, or record a disbursement."},
    {keys:['add article','write article','create health article','post article'],ans:"On Health Education, click \"+ Add Article\" (staff/admin). You can upload a real photo, pick or type any category you like, and add a source link."},
    {keys:['upload id','upload photo id','verify identity'],ans:"During registration you'll upload a selfie and a valid ID/COR — you can also use your camera directly instead of a file upload."},
    {keys:['register','create account','sign up'],ans:"On the login screen, click Register, fill in your details including date of birth, upload a selfie and ID, then submit. An admin approves it within 24–48 hours."},
    {keys:['pending account','account not approved','still pending'],ans:"New accounts are reviewed by an administrator, usually within 24–48 hours. Try logging in again later, or check with the clinic office if it's been a while."},
    {keys:['print prescription','print treatment','print record'],ans:"Open a treatment record and click the 🖨️ Print button in the footer."},
    {keys:['zoom photo','zoom image','view photo larger'],ans:"Click any photo (profile picture, ID, or shared image) to open it full-size — then click again, or use the zoom in/out buttons, to zoom."},
    {keys:['undo','undid','undo that'],ans:"After certain actions like archiving or suspending, a toast appears at the bottom with an \"Undo\" button — click it within a few seconds to reverse the change."},
    {keys:['strong password','password requirement'],ans:"Passwords need at least 8 characters, including an uppercase letter, a lowercase letter, and a number."},
    {keys:['name change requests','review name change'],ans:"Administrators can review and approve or reject name change requests from the User Management page."},
    {keys:['doctor schedule','doctor work schedule','doctor hours'],ans:role==='Administrator'?"You can view and directly edit any doctor's work schedule from the \"Doctor Work Schedules\" card on User Management.":"Doctor work hours are set by administrators. Doctors can propose changes via \"Request Schedule Change\" on My Schedule."},
  ];
  for(const item of howTo){
    if(item.keys.some(k=>hasAllWords(k)))return item.ans;
  }

  return "I'm not totally sure about that one yet. Try asking about appointments, approvals, inventory, or how to do something — or use \"Report an Issue\" if something seems broken.";
}

// Notification panel: All/Unread tabs, Today/Yesterday/Earlier sections, grouped repeats,
// relative times and a "show older" step, following common notification-centre behaviour.
const NOTIFICATION_PAGE_SIZE=15;
export function setNotificationFilter(filter){
  appState.assistant.notificationFilter=filter==='unread'?'unread':'all';
  appState.assistant.notificationLimit=NOTIFICATION_PAGE_SIZE;
  renderNotifList();
}

export function renderNotifList(){
  const list=document.getElementById('notif-list');
  if(!list||!appState.auth.currentUser)return;
  const filter=appState.assistant.notificationFilter||'all';
  const limit=appState.assistant.notificationLimit||NOTIFICATION_PAGE_SIZE;
  const mine=notificationRecords().filter(n=>n.userId===appState.auth.currentUser.id);
  const unreadCount=mine.filter(n=>!n.read).length;

  for(const [id,active] of [['notif-tab-all',filter==='all'],['notif-tab-unread',filter==='unread']]){
    const tab=document.getElementById(id);
    if(!tab)continue;
    tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));
  }
  const unreadTab=document.getElementById('notif-tab-unread');
  if(unreadTab)unreadTab.textContent=unreadCount?`Unread (${unreadCount>99?'99+':unreadCount})`:'Unread';
  const markAll=document.getElementById('notif-mark-all');
  if(markAll)markAll.disabled=!unreadCount;

  const sections=notificationData.groupNotifications(filter==='unread'?mine.filter(n=>!n.read):mine);
  if(!sections.length){
    list.innerHTML=`<div class="notif-empty"><i class="bi ${filter==='unread'?'bi-check2-circle':'bi-bell-slash'}" aria-hidden="true"></i><strong>${filter==='unread'?'You are all caught up':'No notifications yet'}</strong><span>${filter==='unread'?'New updates will appear here.':'Updates about your clinic activity will appear here.'}</span></div>`;
    return;
  }

  let shown=0,total=0;
  const html=sections.map(section=>{
    total+=section.groups.length;
    const groups=section.groups.slice(0,Math.max(0,limit-shown));
    shown+=groups.length;
    if(!groups.length)return '';
    return `<div class="notif-section">${section.name}</div>`+groups.map(group=>{
      const n=group.lead,extra=group.members.length-1;
      const tone=notificationTone(n),page=notificationPageFor(n);
      const ids=group.members.map(member=>member.id);
      const exact=n.createdAt?new Date(n.createdAt).toLocaleString('en-PH'):'';
      return `<button type="button" class="notif-item ${group.unread?'unread':''}" ${bindAction('click',()=>{readNotif(ids,page||null)})}>
        <span class="notif-icon ${tone}" aria-hidden="true"><i class="bi ${notificationData.notificationIcon(n)}"></i></span>
        <span class="notif-content">
          <span class="notif-item-title">${escapeHtml(n.title)}</span>
          <span class="notif-item-text">${escapeHtml(n.body)}</span>
          <span class="notif-item-time" title="${escapeHtml(exact)}">${escapeHtml(notificationData.relativeNotificationTime(n.createdAt))}${extra?` · +${extra} more`:''}</span>
        </span>
        ${group.unread?'<span class="notif-unread-dot" aria-label="Unread"></span>':''}
      </button>`;
    }).join('');
  }).join('');
  const more=total>shown?`<button type="button" class="notif-more" ${bindAction('click',()=>{appState.assistant.notificationLimit=limit+NOTIFICATION_PAGE_SIZE;renderNotifList();})}>Show older notifications</button>`:'';
  list.innerHTML=html+more;
}

// Opening a notification marks it (and any grouped repeats) read, then goes to its page.
export async function readNotif(ids,page=null){
  const wanted=new Set((Array.isArray(ids)?ids:[ids]).map(Number));
  const targets=notificationRecords().filter(x=>wanted.has(x.id)&&!x.read);
  await Promise.all(targets.map(async n=>{
    if(!n._realSupabase){n.read=true;return;}
    try{await notificationCenterAction({action:'read',notification_id:n.dbNotificationId});n.read=true;}
    catch(e){console.error('Read notification:',e);}
  }));

  document.getElementById('notif-panel')?.classList.remove('show');
  document.getElementById('notif-btn')?.setAttribute('aria-expanded','false');
  await updateNotifUI();
  if(page&&typeof navTo==='function')navTo(page);
}

export async function markAllRead(){
  if(!appState.auth.currentUser)return;

  if(appState.auth.currentUser._realSupabase){
    try{
      await notificationCenterAction({action:'read_all'});
      notificationRecords().filter(n=>n.userId===appState.auth.currentUser.id).forEach(n=>n.read=true);
    }catch(e){
      toast(e?.message||'Unable to mark notifications as read.','error');
      return;
    }
  }else{
    notificationRecords().filter(n=>n.userId===appState.auth.currentUser.id).forEach(n=>n.read=true);
  }

  await updateNotifUI();
}

export function toggleNotifPanel(){
  const p=document.getElementById('notif-panel');
  if(!p)return;
  const open=p.classList.toggle('show');
  document.getElementById('notif-btn')?.setAttribute('aria-expanded',String(open));
  if(open){appState.assistant.notificationLimit=NOTIFICATION_PAGE_SIZE;renderNotifList();updateNotifUI();}
}

// Appointment reminders are generated on the server and deduplicated by
// appointment/date/time. For real users this runs whenever CampusCare opens.
export async function checkReminders(){
  if(!appState.auth.currentUser)return;

  if(appState.auth.currentUser._realSupabase){
    try{
      await notificationCenterAction({action:'refresh_reminders'});
      await updateNotifUI();
    }catch(e){
      console.error('Reminder refresh:',e);
    }
    return;
  }

  if(appState.auth.currentUser.role!=='Patient')return;
  const pt=getPatientByUserId(appState.auth.currentUser.id);
  if(!pt)return;
  const reminderDays=appState.data.DB.settings.appointmentReminderDays;

  appointmentRecords().forEach(a=>{
    if(a.patientId!==pt.id||a.status!=='Scheduled')return;
    const diff=(new Date(a.date)-new Date(appState.clinicInformation.TODAY))/(1000*60*60*24);
    if(diff>=0&&diff<=reminderDays){
      const existing=notificationRecords().find(n=>n.userId===appState.auth.currentUser.id&&n.title.includes(a.date)&&!n.read);
      if(!existing){
        addNotif(appState.auth.currentUser.id,'Upcoming Appointment Reminder',
          `You have a ${a.clinic} appointment on ${fmtDate(a.date)} at ${fmtTime(a.time)}. Please bring your signed COR (Certificate of Registration) for this semester when you come to the clinic.`,'warning');
      }
    }
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.assistant.assistantHistory=[];
  appState.assistant.notificationFilter='all';
  appState.assistant.notificationLimit=NOTIFICATION_PAGE_SIZE;
  const closePanel=()=>{
    const p=document.getElementById('notif-panel');
    if(!p?.classList.contains('show'))return;
    p.classList.remove('show');
    document.getElementById('notif-btn')?.setAttribute('aria-expanded','false');
  };
  // Clicking elsewhere or pressing Escape closes the panel, as in other apps.
  document.addEventListener('click',e=>{
    const p=document.getElementById('notif-panel');
    const btn=document.getElementById('notif-btn');
    // The click path still includes the panel when a tab or "show older" re-renders its target.
    const path=e.composedPath?.()||[e.target];
    if(p&&btn&&!path.includes(p)&&!path.includes(btn))closePanel();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closePanel();});
}

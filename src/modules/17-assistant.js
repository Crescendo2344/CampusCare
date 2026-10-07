// ================================================================
// AI ASSISTANT — a built-in helper that answers from your live app
// data and can jump you to the right page. It's a rule-based/pattern-
// matching assistant (not a connected generative-AI model), which
// means it works fully offline and never sends your data anywhere.
// ================================================================
let assistantHistory=[];

function resetAssistantChat(){
  assistantHistory=[];
  const name=currentUser?currentUser.fname:'there';
  addAssistantMessage('bot',`Hi ${name}! I'm your CampusCare Assistant. I can look up things in the app for you, or point you to the right page. Try one of these, or just ask me something:`);
  renderAssistantChips();
}

function getAssistantChips(){
  if(!currentUser)return [];
  const role=currentUser.role;
  if(role==='Administrator')return ['Any predicted stock-outs?','Campus health trends','How many pending approvals?',"Today's appointments"];
  if(role==='Doctor')return ["Today's appointments",'Campus health trends','How do I use Clinical Copilot?',"Unread messages"];
  if(role==='Staff')return ['Any predicted stock-outs?','Campus health trends','Pending approvals','Unread messages'];
  return ['My next appointment','How do I book an appointment?','Unread messages','Clinic hours'];
}

function renderAssistantChips(){
  const el=document.getElementById('ai-chips');
  if(!el)return;
  el.innerHTML=getAssistantChips().map(c=>`<div class="ai-chip" onclick="askAssistant('${jsAttrSafe(c)}')">${escapeHtml(c)}</div>`).join('');
}

function toggleAssistant(){
  const panel=document.getElementById('ai-panel');
  const opening=!panel.classList.contains('show');
  panel.classList.toggle('show',opening);
  if(opening){
    document.getElementById('ai-fab-dot').style.display='none';
    setTimeout(()=>document.getElementById('ai-input').focus(),150);
  }
}

function addAssistantMessage(role,text){
  assistantHistory.push({role,text});
  const wrap=document.getElementById('ai-messages');
  if(!wrap)return;
  const div=document.createElement('div');
  div.className=`ai-msg ${role==='user'?'user':'bot'}`;
  div.textContent=text;
  wrap.appendChild(div);
  wrap.scrollTop=wrap.scrollHeight;
}

function askAssistant(text){
  document.getElementById('ai-input').value=text;
  sendAssistantMessage();
}

function sendAssistantMessage(){
  const input=document.getElementById('ai-input');
  const text=input.value.trim();
  if(!text)return;
  addAssistantMessage('user',text);
  input.value='';
  const reply=getAssistantReply(text);
  setTimeout(()=>addAssistantMessage('bot',reply),250);
}

function getAssistantReply(raw){
  const q=raw.toLowerCase();
  const u=currentUser;
  if(!u)return "Please log in first so I can help with your account.";
  const role=u.role;
  const has=(...words)=>words.some(w=>q.includes(w));
  const hasAllWords=(phrase)=>phrase.split(' ').every(w=>q.includes(w));

  // Greetings
  if(has('hello','hi ','hey','good morning','good afternoon') || q==='hi')
    return `Hello, ${u.fname}! Ask me about appointments, approvals, inventory, messages, or how to do something in the app.`;

  // Navigation intent takes priority over keyword data-lookups below,
  // since "take me to inventory" should navigate, not report stock levels.
  if(has('go to','open ','take me to','show me','navigate to')){
    const items=(NAV_CONFIG[role]||[]).filter(i=>i.id);
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
    const pending=DB.users.filter(x=>x.status==='Pending').length;
    return pending?`There ${pending===1?'is':'are'} ${pending} registration${pending===1?'':'s'} waiting for approval. You'll find them in Approval Queue.`:"No pending registrations right now — the queue is clear.";
  }

  // Today's appointments
  if(has("today's appointment","today appointment","appointments today","my appointment","upcoming appointment","next appointment")){
    if(role==='Patient'){
      const mine=appointmentRecords().filter(a=>currentPatient&&a.patientId===currentPatient.id&&a.status==='Scheduled').sort((a,b)=>a.date.localeCompare(b.date));
      if(!mine.length)return "You don't have any upcoming appointments. Want to book one from the Appointments page?";
      const next=mine[0];
      const doc=getUserById(next.doctorId);
      return `Your next appointment is ${next.clinic} – ${next.service} on ${fmtDate(next.date)} at ${fmtTime(next.time)}${doc?' with '+docName(doc):''}.`;
    }
    if(role==='Doctor'){
      const mine=appointmentRecords().filter(a=>a.doctorId===u.id&&a.date===TODAY&&a.status==='Scheduled');
      return mine.length?`You have ${mine.length} appointment${mine.length===1?'':'s'} today, starting with ${fmtTime(mine.sort((a,b)=>a.time.localeCompare(b.time))[0].time)}.`:"You have no appointments scheduled for today.";
    }
    const today=appointmentRecords().filter(a=>a.date===TODAY&&a.status==='Scheduled');
    return today.length?`There ${today.length===1?'is':'are'} ${today.length} appointment${today.length===1?'':'s'} scheduled today across the clinic.`:"No appointments are scheduled for today.";
  }

  // Doctor's own leave/schedule
  if(has('day off','days off','my leave','my schedule','my hours','my work schedule')){
    if(role!=='Doctor')return "Schedule info here is specific to doctor accounts — admins can check Doctor Work Schedules under User Management.";
    const upcoming=getDoctorLeaves(u.id);
    const scheduleMsg=`Your hours are ${fmtTime(u.startTime||'08:00')}–${fmtTime(u.endTime||'17:00')} on ${(u.workDays||[]).join(', ')||'no set days yet'}.`;
    return upcoming.length?`${scheduleMsg} You have ${upcoming.length} approved day${upcoming.length===1?'':'s'} off coming up, starting ${fmtDate(upcoming[0].date)}.`:`${scheduleMsg} No upcoming approved days off.`;
  }

  // Messages / unread
  if(has('unread message','new message','messages')){
    const unread=messageRecords().filter(m=>m.toUserId===u.id&&!m.isRead&&!m.deleted).length;
    return unread?`You have ${unread} unread message${unread===1?'':'s'}. Check the Messages page.`:"You're all caught up — no unread messages.";
  }

  // Patient count
  if(has('how many patient','total patient','number of patient')){
    if(!(role==='Administrator'||role==='Staff'||role==='Doctor'))return "Patient counts are only available to clinic staff.";
    const count=(currentUser?.role==='Administrator'?DB.patients.filter(p=>p._realSupabase):DB.patients).filter(p=>!p.archived).length;
    return `There ${count===1?'is':'are'} currently ${count} active patient record${count===1?'':'s'} on file.`;
  }

  // Clinic info
  if(has('clinic hours','contact number','clinic address','clinic email','where is the clinic','education building')){
    return `${CTU_CLINIC_INFO.name} is located at ${CTU_CLINIC_INFO.location}. Medical Clinic hours posted on site are: regular ${CTU_CLINIC_INFO.medicalHours.regular}; extended ${CTU_CLINIC_INFO.medicalHours.extendedWeekdays}; ${CTU_CLINIC_INFO.medicalHours.saturday}; ${CTU_CLINIC_INFO.medicalHours.sunday}. Contact: ${CTU_CLINIC_INFO.phone} or ${CTU_CLINIC_INFO.email}.`;
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
    {keys:['send message','message a doctor','contact staff','chat with'],ans:"Go to Messages and click the ✏️ pencil icon to start a secure conversation. Patient accounts can contact active Doctors, clinic Staff, and Administrators, but not other Patient accounts."},
    {keys:['forward message','share message'],ans:"Hover a message bubble and click the ⋯ button — you'll see options to Forward, Share, and (for your own messages) Edit or Delete."},
    {keys:['delete message'],ans:"Hover the message and click ⋯ → Delete. You can choose \"Delete for Everyone\" (your own messages only) or \"Delete for Me.\""},
    {keys:['voice message','record audio','send voice note'],ans:"In a conversation, click the 🎤 microphone icon to start recording, and click it again to stop and send."},
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

  return "I'm not totally sure about that one yet. Try asking about appointments, approvals, inventory, messages, or how to do something — or use \"Report an Issue\" if something seems broken.";
}

function renderNotifList(){
  const list=document.getElementById('notif-list');
  if(!list||!currentUser)return;

  const notifs=notificationRecords()
    .filter(n=>n.userId===currentUser.id)
    .slice()
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));

  if(!notifs.length){
    list.innerHTML='<div class="empty-state" style="padding:1rem"><p>No notifications</p></div>';
    return;
  }

  list.innerHTML=notifs.map(n=>{
    const tone=notificationTone(n);
    const color=tone==='danger'?'var(--danger)':tone==='success'?'#639922':tone==='warning'?'#EF9F27':'var(--primary)';
    const when=n.createdAt?new Date(n.createdAt).toLocaleString('en-PH'):'';
    const page=notificationPageFor(n);

    return `<div class="notif-item ${n.read?'':'unread'}" onclick="readNotif(${n.id},${page?`'${jsAttrSafe(page)}'`:'null'})">
      <div style="display:flex;gap:.5rem;align-items:flex-start">
        <div class="notif-type-dot" style="background:${color}"></div>
        <div style="flex:1;min-width:0">
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div style="color:var(--ink-muted);margin-bottom:2px;line-height:1.4">${escapeHtml(n.body)}</div>
          <div class="notif-item-time">${escapeHtml(when)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function readNotif(id,page=null){
  const n=notificationRecords().find(x=>x.id===Number(id));
  if(!n)return;

  if(n._realSupabase&&!n.read){
    try{
      await notificationCenterAction({action:'read',notification_id:n.dbNotificationId});
      n.read=true;
    }catch(e){
      console.error('Read notification:',e);
    }
  }else{
    n.read=true;
  }

  await updateNotifUI();

  const panel=document.getElementById('notif-panel');
  if(panel)panel.classList.remove('show');

  if(page&&typeof navTo==='function')navTo(page);
}

async function markAllRead(){
  if(!currentUser)return;

  if(currentUser._realSupabase){
    try{
      await notificationCenterAction({action:'read_all'});
      notificationRecords().filter(n=>n.userId===currentUser.id).forEach(n=>n.read=true);
    }catch(e){
      toast(e?.message||'Unable to mark notifications as read.','error');
      return;
    }
  }else{
    notificationRecords().filter(n=>n.userId===currentUser.id).forEach(n=>n.read=true);
  }

  await updateNotifUI();
}

function toggleNotifPanel(){
  const p=document.getElementById('notif-panel');
  if(!p)return;
  p.classList.toggle('show');
  if(p.classList.contains('show'))updateNotifUI();
}

document.addEventListener('click',e=>{
  const p=document.getElementById('notif-panel');
  const btn=document.getElementById('notif-btn');
  if(p&&btn&&!p.contains(e.target)&&!btn.contains(e.target))p.classList.remove('show');
});

// Appointment reminders are generated on the server and deduplicated by
// appointment/date/time. For real users this runs whenever CampusCare opens.
async function checkReminders(){
  if(!currentUser)return;

  if(currentUser._realSupabase){
    try{
      await notificationCenterAction({action:'refresh_reminders'});
      await updateNotifUI();
    }catch(e){
      console.error('Reminder refresh:',e);
    }
    return;
  }

  if(currentUser.role!=='Patient')return;
  const pt=getPatientByUserId(currentUser.id);
  if(!pt)return;
  const reminderDays=DB.settings.appointmentReminderDays;

  appointmentRecords().forEach(a=>{
    if(a.patientId!==pt.id||a.status!=='Scheduled')return;
    const diff=(new Date(a.date)-new Date(TODAY))/(1000*60*60*24);
    if(diff>=0&&diff<=reminderDays){
      const existing=notificationRecords().find(n=>n.userId===currentUser.id&&n.title.includes(a.date)&&!n.read);
      if(!existing){
        addNotif(currentUser.id,'Upcoming Appointment Reminder',
          `You have a ${a.clinic} appointment on ${fmtDate(a.date)} at ${fmtTime(a.time)}. Please bring your COR (Certificate of Registration) when you come to the clinic.`,'warning');
      }
    }
  });
}

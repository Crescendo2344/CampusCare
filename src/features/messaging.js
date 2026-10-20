import {fitMessageViewport} from '../ui/message-viewport.js';
import {reconcileMessages} from '../ui/message-list.js';
import {createVoicePlayer,startVoiceMeter,prepareVoiceContext} from '../ui/voice-message.js';
import {appIcon} from '../ui/app-icons.js';
import {createFeatureSyncService} from '../services/feature-sync.js';
// messaging: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {normalizeSupabaseUser,syncAdminDirectoryFromSupabase} from './patientService.js';
import {appointmentRecords,syncRealAppointments,syncRealDoctorDirectory} from './appointmentService.js';
import {syncRealTreatments,treatmentRecords} from './treatmentService.js';
import {getUserById} from './documentScanner.js';
import {escapeHtml} from './issueReports.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {updateNotifUI} from './notifications.js';
import {closeAllModals,openModal,showFilePreview} from './modals.js';
import {showAlert,toast} from './theme.js';
import {persistDB} from './persistence.js';
import {readFileAsDataURL,resizeImageDataUrl} from './inputValidation.js';
import {bindAction,createOperationalService,workflowData} from '../dependencies.js';
// ================================================================
// SECURE CAMPUSCARE MESSAGING — REAL SUPABASE WORKFLOW
// ================================================================

export function docName(user){
  if(!user)return '';
  return (user.role==='Doctor'?'Dr. ':'')+user.fname+' '+user.lname;
}

export function messageRecords(){
  if(appState.auth.currentUser?._realSupabase)return (appState.data.DB.messages||[]).filter(m=>m._realSupabase);
  return appState.data.DB.messages||[];
}

export function realMessageToUi(m){return workflowData.realMessageToUi(m);}

export async function messageAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).messageAction(payload);}

export function mergeRealMessageContacts(rows=[]){
  for(const row of rows||[]){
    const dbUserId=Number(row.user_id||0);
    if(!dbUserId||dbUserId===Number(appState.auth.currentUser?.dbUserId))continue;

    const existing=(appState.data.DB.users||[]).find(u=>u._realSupabase&&Number(u.dbUserId)===dbUserId);
    if(existing){
      existing.fname=row.first_name||existing.fname||'';
      existing.lname=row.last_name||existing.lname||'';
      existing.role=row.role||existing.role||'Patient';
      existing.status=row.status||existing.status||'Active';
      existing.specialty=row.specialty||existing.specialty||'';
      if(row.profile_signed_url)existing.profilePhoto=row.profile_signed_url;
      existing._realMessageDirectory=true;
      continue;
    }

    const user=normalizeSupabaseUser({
      user_id:dbUserId,
      first_name:row.first_name||'',
      last_name:row.last_name||'',
      role:row.role||'Patient',
      status:row.status||'Active',
      specialty:row.specialty||'',
      profile_signed_url:row.profile_signed_url||''
    });
    user._realMessageDirectory=true;
    appState.data.DB.users.push(user);
  }
}

export async function syncRealMessages(){
  return createFeatureSyncService({getState:()=>appState,callbacks:{messageRecords,messageAction,mergeRealMessageContacts,realMessageToUi}}).syncRealMessages();
}

export async function syncMessagingContext(){
  if(!appState.auth.currentUser?._realSupabase)return;

  if(appState.auth.currentUser.role==='Patient'){
    await syncRealDoctorDirectory();
  }else{
    await syncAdminDirectoryFromSupabase();
    if(appState.auth.currentUser.role==='Doctor'){
      // Doctor-to-patient chat is limited to patients linked to the doctor's
      // appointment/treatment history. Keep these relationships current.
      await syncRealAppointments();
      await syncRealTreatments();
    }
  }

  await syncRealMessages();
}

export function isCompactMessenger(){
  // Tablets can have a wide viewport but a much narrower CampusCare content
  // area because the application sidebar is still visible. Use both viewport
  // and actual content width so portrait/landscape tablets behave correctly.
  const content=document.getElementById('app-content');
  return window.innerWidth<=1100 || Boolean(content&&content.clientWidth<760);
}

// Background sync patches mounted views only; no loading skeletons or conversation resets.
export function refreshMessageViews(){
  if(!document.getElementById('msgr-shell'))return;
  renderContactList();renderPeopleCarousel();
  if(appState.messaging.activeConversationId)renderChatMessages(appState.messaging.activeConversationId);
}
export function startMessagePolling(){
  if(appState.messaging.messagePollTimer)clearInterval(appState.messaging.messagePollTimer);
  if(!appState.auth.currentUser?._realSupabase)return;
  let busy=false;
  const account=appState.auth.currentUser;
  appState.messaging.messagePollTimer=setInterval(async()=>{
    if(busy||document.hidden||appState.navigationRaceProtection.campusActivePageId!=='messages'||appState.auth.currentUser!==account)return;
    busy=true;
    try{await syncRealMessages();if(appState.auth.currentUser===account&&appState.navigationRaceProtection.campusActivePageId==='messages')refreshMessageViews();}
    catch(e){console.error('Secure message refresh:',e);}
    finally{busy=false;}
  },7000);
}

export function getPresence(_userId){
  return appState.auth.currentUser?._realSupabase?'secure':'online';
}
export function presenceColor(status){
  return status==='secure'?'#0a7ea8':status==='online'?'#2ecc71':status==='away'?'#f0b429':'#9aa5ab';
}
export function presenceLabel(status){
  return status==='secure'?'Secure messaging':status==='online'?'Online':status==='away'?'Away':'Offline';
}
export function startPresenceSimulation(){
  // Production CampusCare deliberately does not invent or expose live presence.
}

export function msgrAvatarHtml(user,size=42){
  const initials=user?((user.fname?.[0]||'')+(user.lname?.[0]||'')).toUpperCase():'?';
  const inner=user&&user.profilePhoto
    ?`<img src="${user.profilePhoto}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">`
    :`<div class="sb-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.34)}px">${initials}</div>`;
  const dotSize=Math.max(9,Math.round(size*0.26));
  const status=getPresence(user?.id);
  return `<div class="msgr-avatar-wrap">${inner}<span class="msgr-presence-dot" style="width:${dotSize}px;height:${dotSize}px;background:${presenceColor(status)}"></span></div>`;
}

export function fmtShortTime(d){
  try{
    const dt=new Date(d),now=new Date();
    if(dt.toDateString()===now.toDateString())return dt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
    return dt.toLocaleDateString('en-PH',{month:'short',day:'numeric'});
  }catch(_){return '';}
}

export function attachmentPreviewLabel(att){
  if(!att)return '';
  if(att.type==='image')return 'Photo';
  if(att.type==='audio')return 'Voice message';
  return att.name||'File';
}

export function getMessageContacts(){
  const myId=appState.auth.currentUser.id;
  const partnerIds=new Set();

  messageRecords().forEach(m=>{
    if(m.fromUserId===myId)partnerIds.add(m.toUserId);
    if(m.toUserId===myId)partnerIds.add(m.fromUserId);
  });

  return [...partnerIds].map(pid=>{
    const msgs=messageRecords()
      .filter(m=>(m.fromUserId===myId&&m.toUserId===pid)||(m.fromUserId===pid&&m.toUserId===myId))
      .sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));

    const last=msgs[msgs.length-1];
    const unread=msgs.filter(m=>m.toUserId===myId&&!m.isRead&&!m.deleted).length;
    return {id:pid,user:getUserById(pid),last,unread};
  }).filter(c=>c.user&&c.last)
    .sort((a,b)=>new Date(b.last.createdAt)-new Date(a.last.createdAt));
}

export function getAllMessagePeople(){
  const real=appState.auth.currentUser?._realSupabase;
  const users=(appState.data.DB.users||[]).filter(u=>
    u.id!==appState.auth.currentUser.id&&
    u.status==='Active'&&
    (!real||u._realSupabase)
  );

  if(appState.auth.currentUser.role==='Patient'){
    // Patients may contact the clinic team, but not other Patient accounts.
    // The backend enforces the same role rule.
    return users
      .filter(u=>['Doctor','Staff','Administrator'].includes(u.role))
      .map(user=>({id:user.id,user}));
  }

  if(appState.auth.currentUser.role==='Doctor'){
    const linkedPatientIds=new Set([
      ...appointmentRecords().filter(a=>a.doctorId===appState.auth.currentUser.id).map(a=>a.patientId),
      ...treatmentRecords().filter(t=>t.doctorId===appState.auth.currentUser.id).map(t=>t.patientId)
    ]);
    const linkedUserIds=new Set(
      (appState.data.DB.patients||[])
        .filter(p=>(!real||p._realSupabase)&&linkedPatientIds.has(p.id))
        .map(p=>p.userId)
    );

    return users
      .filter(u=>u.role!=='Patient'||linkedUserIds.has(u.id))
      .map(user=>({id:user.id,user}));
  }

  // Staff and Administrators can coordinate with all active CampusCare users.
  return users.map(user=>({id:user.id,user}));
}

export function contactItemHtml(ct){
  let preview='No message';
  if(ct.last){
    if(ct.last.deleted)preview='Message deleted';
    else if(ct.last.attachment)preview=ct.last.attachment.type==='image'?'sent a photo':ct.last.attachment.type==='audio'?'sent a voice message':'sent a file';
    else preview=(ct.last.message||'').substring(0,42)+((ct.last.message||'').length>42?'…':'');
  }

  return `<div class="msgr-contact-item ${appState.messaging.activeConversationId===ct.id?'active':''}" ${bindAction('click',(event,element)=>{openConversation((ct.id))})}>
    ${msgrAvatarHtml(ct.user,40)}
    <div class="msgr-contact-info">
      <div class="msgr-contact-name">${escapeHtml(docName(ct.user))}</div>
      <div class="msgr-contact-preview">${ct.last&&ct.last.fromUserId===appState.auth.currentUser.id?'You: ':''}${escapeHtml(preview)}</div>
    </div>
    <div class="msgr-contact-meta">
      <div class="msgr-contact-time">${ct.last?fmtShortTime(ct.last.createdAt):''}</div>
      ${ct.unread?`<span class="msgr-unread-badge">${ct.unread}</span>`:''}
    </div>
  </div>`;
}

export function renderPeopleCarousel(){
  const el=document.getElementById('msgr-people-carousel');if(!el)return;
  const people=getAllMessagePeople();

  // Rotating signed avatar URLs do not change the visible person or justify a repaint.
  const version=JSON.stringify(people.map(p=>[p.id,p.user.fname,p.user.lname,p.user.role,p.user.specialty,p.user.profilePhoto?.split('?')[0]]));
  if(el.dataset.version===version)return;el.dataset.version=version;
  const left=el.scrollLeft;
  el.innerHTML=people.length?people.map(p=>`<button class="msgr-person-card" ${bindAction('click',(event,element)=>{openConversation((p.id))})} title="Message ${escapeHtml(docName(p.user))}">
    ${msgrAvatarHtml(p.user,46)}
    <span class="msgr-person-name">${escapeHtml(p.user.fname)}</span>
    <span class="msgr-person-role">${escapeHtml(p.user.role==='Doctor'?(p.user.specialty||'Doctor'):p.user.role)}</span>
  </button>`).join(''):'<span class="text-muted">No people available.</span>';
  el.scrollLeft=left;
}

export function renderContactList(){
  const el=document.getElementById('msgr-contacts');if(!el)return;
  const q=((document.getElementById('msgr-search')||{}).value||'').trim().toLowerCase();
  const contacts=getMessageContacts();
  const version=JSON.stringify([q,appState.messaging.activeConversationId,contacts.map(c=>[c.id,c.unread,c.last?.id,c.last?.message,c.last?.deleted,c.last?.attachment?.name,c.user.fname,c.user.lname,c.user.profilePhoto?.split('?')[0]]),getAllMessagePeople().map(p=>[p.id,p.user.fname,p.user.lname])]);
  if(el.dataset.version===version)return;el.dataset.version=version;

  if(!q){
    el.innerHTML=contacts.length
      ?contacts.map(contactItemHtml).join('')
      :'<div class="empty-state"><p>No conversations yet.<br>Choose New message to start one.</p></div>';
    return;
  }

  const matched=contacts.filter(c=>`${c.user.fname} ${c.user.lname}`.toLowerCase().includes(q));
  const existingIds=new Set(contacts.map(c=>c.id));
  const extra=getAllMessagePeople()
    .filter(p=>!existingIds.has(p.id)&&`${p.user.fname} ${p.user.lname}`.toLowerCase().includes(q));

  let html=matched.map(contactItemHtml).join('');
  if(extra.length){
    html+=`<div class="section-label" style="padding:.6rem .9rem .3rem">People</div>`;
    html+=extra.map(p=>`<div class="msgr-contact-item" ${bindAction('click',(event,element)=>{document.getElementById('msgr-search').value='';openConversation((p.id))})}>
      ${msgrAvatarHtml(p.user,40)}
      <div class="msgr-contact-info">
        <div class="msgr-contact-name">${escapeHtml(docName(p.user))}</div>
        <div class="msgr-contact-preview">${escapeHtml(p.user.role)}${p.user.role==='Doctor'&&p.user.specialty?' · '+escapeHtml(p.user.specialty):''}</div>
      </div>
    </div>`).join('');
  }
  el.innerHTML=html||'<div class="empty-state"><p>No people match your search.</p></div>';
}

export async function renderMessages(){
  const c=document.getElementById('app-content');if(!c)return;
  const pageToken=captureCampusPageToken();
  // An explicit refresh of a mounted messenger is quiet as well as the polling refresh.
  if(document.getElementById('msgr-shell')){await syncRealMessages();if(isCampusPageCurrent('messages',pageToken))refreshMessageViews();return;}

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncMessagingContext();}
    catch(e){
      if(!isCampusPageCurrent('messages',pageToken))return;
      console.error('Messaging sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load secure messages.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderMessages()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('messages',pageToken))return;
  }

  startPresenceSimulation();
  const contacts=getMessageContacts();

  if(isCompactMessenger())appState.messaging.activeConversationId=null;

  c.innerHTML=`
    <div class="alert alert-info show" style="font-size:.76rem">
      ${appIcon('shield',16)} <strong>Secure CampusCare messaging.</strong>
      ${appState.auth.currentUser.role==='Patient'
        ? 'Use Messages to contact Doctors, clinic Staff, or Administrators for non-emergency health and clinic-related concerns. For urgent or emergency symptoms, seek immediate in-person or emergency care.'
        : 'Messages may contain health-related information. Use only what is necessary for clinic coordination and patient care.'}
    </div>
    <div class="msgr-shell" id="msgr-shell">
      <div class="msgr-sidebar">
        <div class="msgr-sidebar-header">
          <h3>${appIcon('message')}<span>Messages</span></h3>
          <div style="display:flex;gap:.35rem">
            <button class="msgr-icon-btn" ${bindAction('click',(event,element)=>{openMessageSettings()})} title="Message settings" aria-label="Message settings">${appIcon('settings')}</button>
            <button class="msgr-icon-btn" ${bindAction('click',(event,element)=>{openNewMessageModal()})} title="New message" aria-label="New message">${appIcon('compose')}</button>
          </div>
        </div>
        <div style="padding:.6rem .7rem .7rem">
          <input type="text" id="msgr-search" placeholder="Search people..." ${bindAction('input',(event,element)=>{renderContactList()})} style="width:100%;padding:.42rem .8rem;border:1px solid var(--line);border-radius:20px;font-size:.8rem;background:var(--overlay);backdrop-filter:blur(6px);color:var(--ink)">
        </div>
        <div class="msgr-people-wrap">
          <div class="msgr-people-title"><span>People</span><span id="msgr-browse-hint" style="font-weight:500">Scroll to browse</span></div>
          <div class="msgr-people-carousel" id="msgr-people-carousel"></div>
        </div>
        <div class="msgr-contacts" id="msgr-contacts">
          ${contacts.length?contacts.map(contactItemHtml).join(''):'<div class="empty-state"><p>No conversations yet.<br>Choose New message to start one.</p></div>'}
        </div>
      </div>

      <div class="msgr-chat" id="msgr-chat">
        <div class="empty-state" style="margin-top:4rem"><p>👋 Select a conversation, or start a new one.</p></div>
      </div>
    </div>`;

  fitMessageViewport(document.getElementById('msgr-shell'));
  renderPeopleCarousel();
  const hint=document.getElementById('msgr-browse-hint');
  if(hint)hint.textContent=isCompactMessenger()?'Swipe to browse':'Scroll to browse';

  if(contacts.length&&!isCompactMessenger()){
    await openConversation(contacts[0].id);
  }

  startMessagePolling();
}

export async function openConversation(userId){
  if(appState.messaging.activeConversationId===Number(userId)&&document.getElementById('msgr-messages')){refreshMessageViews();return;}
  appState.messaging.stopVoiceRecording?.(true);
  clearPendingAttachment();
  document.querySelectorAll('.voice-player audio').forEach(audio=>audio.pause());
  appState.messaging.activeConversationId=Number(userId);
  const conversationId=Number(userId),account=appState.auth.currentUser;
  const shell=document.getElementById('msgr-shell');
  if(shell&&isCompactMessenger()) shell.classList.add('mobile-chat-open');

  const user=getUserById(appState.messaging.activeConversationId);
  if(!user)return;

  if(appState.auth.currentUser?._realSupabase){
    try{
      await messageAction({action:'read_conversation',partner_user_id:user.dbUserId});
      messageRecords().forEach(m=>{
        if(m.fromUserId===appState.messaging.activeConversationId&&m.toUserId===appState.auth.currentUser.id)m.isRead=true;
      });
    }catch(e){console.error('Read secure conversation:',e);}
  }else{
    messageRecords().forEach(m=>{
      if(m.fromUserId===appState.messaging.activeConversationId&&m.toUserId===appState.auth.currentUser.id)m.isRead=true;
    });
  }

  if(appState.messaging.activeConversationId!==conversationId||appState.auth.currentUser!==account||!document.getElementById('msgr-shell'))return;
  updateNotifUI&&updateNotifUI();
  renderContactList();

  const chat=document.getElementById('msgr-chat');if(!chat)return;
  const status=getPresence(appState.messaging.activeConversationId);

  chat.innerHTML=`
    <div class="msgr-chat-header">
      <button class="msgr-icon-btn msgr-mobile-back" ${bindAction('click',(event,element)=>{backToMessageLobby()})} title="Back to chats" aria-label="Back to chats">${appIcon('back')}</button>
      <div style="cursor:pointer;display:flex;align-items:center;gap:.65rem;min-width:0" ${bindAction('click',(event,element)=>{openContactInfo((appState.messaging.activeConversationId))})} title="View contact info">
        ${msgrAvatarHtml(user,38)}
        <div>
          <div class="msgr-chat-header-name">${escapeHtml(docName(user))}</div>
          <div class="msgr-chat-header-status"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${presenceColor(status)};margin-right:4px"></span>${presenceLabel(status)}</div>
        </div>
      </div>
      <button class="msgr-icon-btn" style="margin-left:auto" ${bindAction('click',(event,element)=>{openContactInfo((appState.messaging.activeConversationId))})} title="Conversation info" aria-label="Conversation info">${appIcon('info')}</button>
    </div>
    <div class="msgr-messages" id="msgr-messages"></div>
    <div id="msgr-pending-attach"></div>
    <div class="msgr-input-bar">
      <input type="file" id="msgr-photo-input" accept="image/jpeg,image/png,image/webp" style="display:none" ${bindAction('change',(event,element)=>{attachPhoto(element)})}>
      <input type="file" id="msgr-file-input" accept=".pdf,.txt,.docx,.xlsx" style="display:none" ${bindAction('change',(event,element)=>{attachFileGeneric(element)})}>
      <button class="msgr-icon-btn" title="Send a photo" aria-label="Send a photo" ${bindAction('click',(event,element)=>{document.getElementById('msgr-photo-input').click()})}>${appIcon('photo')}</button>
      <button class="msgr-icon-btn" title="Send a file" aria-label="Send a file" ${bindAction('click',(event,element)=>{document.getElementById('msgr-file-input').click()})}>${appIcon('paperclip')}</button>
      <button class="msgr-icon-btn" id="msgr-voice-btn" title="Record a voice message" aria-label="Record a voice message" ${bindAction('click',(event,element)=>{toggleVoiceRecording((appState.messaging.activeConversationId))})}>${appIcon('mic')}</button>
      <input type="text" id="msgr-text-input" maxlength="4000" placeholder="Type a secure message..." ${bindAction('keydown',(event,element)=>{handleMsgrKeydown(event,(appState.messaging.activeConversationId))})}>
      <button class="msgr-send-btn" id="msgr-send-btn" ${bindAction('click',(event,element)=>{sendChatMessage((appState.messaging.activeConversationId))})} title="Send message" aria-label="Send message">${appIcon('send')}</button>
    </div>`;

  renderChatMessages(appState.messaging.activeConversationId);
}

export function backToMessageLobby(){
  appState.messaging.stopVoiceRecording?.(true);
  document.querySelectorAll('.voice-player audio').forEach(audio=>audio.pause());
  const shell=document.getElementById('msgr-shell');if(!shell)return;
  shell.classList.remove('mobile-chat-open');
  appState.messaging.activeConversationId=null;
  renderContactList();
}

export function syncMessengerMobileLayout(){
  const shell=document.getElementById('msgr-shell');if(!shell)return;

  if(isCompactMessenger()){
    shell.classList.toggle('mobile-chat-open',!!appState.messaging.activeConversationId);
  }else{
    // Desktop returns to the normal split view.
    shell.classList.remove('mobile-chat-open');
  }
}

export function renderChatMessages(userId,options={}){
  const wrap=document.getElementById('msgr-messages');if(!wrap)return;

  const msgs=messageRecords()
    .filter(m=>(m.fromUserId===appState.auth.currentUser.id&&m.toUserId===userId)||(m.fromUserId===userId&&m.toUserId===appState.auth.currentUser.id))
    .sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));

  reconcileMessages(wrap,msgs.map(m=>({...m,_timeLabel:`${fmtShortTime(m.createdAt)}${m.edited?' · edited':''}${m.fromUserId===appState.auth.currentUser.id?` · ${m.isRead?'read':'sent'}`:''}`})),m=>{
    const template=document.createElement('template');
    const sent=m.fromUserId===appState.auth.currentUser.id;

    if(m.deleted){
      template.innerHTML=`<div class="msgr-bubble-row ${sent?'sent':'received'}">
        <div class="msgr-bubble deleted">This message was deleted</div>
      </div>`;return template.content.firstElementChild;
    }

    let bodyHtml='';
    if(m.forwarded)bodyHtml+='<div style="font-size:.67rem;opacity:.65;margin-bottom:.2rem">Forwarded</div>';

    if(m.message)bodyHtml+=`<div${m.attachment?' style="margin-bottom:.3rem"':''}>${escapeHtml(m.message)}</div>`;

    if(m.attachment){
      if(m.attachment.type==='image'){
        bodyHtml+=`<img src="${m.attachment.dataUrl}" ${bindAction('click',(event,element)=>{showFilePreview('Photo',(String(m.attachment.dataUrl)))})} style="cursor:pointer">`;
      }else if(m.attachment.type==='audio'){
        bodyHtml+='<span class="voice-player-slot"></span>';
      }else{
        bodyHtml+=`<a href="${m.attachment.dataUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">
          <div class="msgr-file-chip">${appIcon('paperclip',16)} ${escapeHtml(m.attachment.name)}</div></a>`;
      }
    }

    const canEdit=sent&&!m.attachment;
    template.innerHTML=`<div class="msgr-bubble-row ${sent?'sent':'received'}" data-msg-id="${m.id}">
      <div class="msgr-bubble-group"><div class="msgr-bubble" id="msgr-bubble-${m.id}">${bodyHtml||' '}</div><span class="msgr-bubble-time">${fmtShortTime(m.createdAt)}${m.edited?' · edited':''}${sent?` · ${m.isRead?'read':'sent'}`:''}</span></div>
      <button class="msgr-msg-actions-btn" ${bindAction('click',(event,element)=>{toggleMsgMenu(event,(m.id),(canEdit),true)})} title="More message options" aria-label="More message options">${appIcon('more')}</button>
    </div>`;
    const row=template.content.firstElementChild;
    const slot=row.querySelector('.voice-player-slot');if(slot)slot.replaceWith(createVoicePlayer(m.attachment.dataUrl));
    return row;
  },options);
}

export function openContactInfo(userId){
  const user=getUserById(userId);if(!user)return;
  const msgs=messageRecords().filter(m=>!m.deleted&&(
    (m.fromUserId===appState.auth.currentUser.id&&m.toUserId===userId)||
    (m.fromUserId===userId&&m.toUserId===appState.auth.currentUser.id)
  ));
  const photos=msgs.filter(m=>m.attachment?.type==='image');
  const files=msgs.filter(m=>m.attachment&&m.attachment.type!=='image'&&m.attachment.type!=='audio');
  const urlRegex=/(https?:\/\/[^\s]+)/g;
  const links=[];
  msgs.forEach(m=>{
    if(m.message){
      const found=m.message.match(urlRegex);
      if(found)found.forEach(url=>links.push({url,date:m.createdAt}));
    }
  });

  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Contact Info</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div style="display:flex;flex-direction:column;align-items:center;gap:.5rem;margin-bottom:1rem">
        ${user.profilePhoto?`<img src="${user.profilePhoto}" style="width:76px;height:76px;border-radius:50%;object-fit:cover">`:`<div class="sb-avatar" style="width:76px;height:76px;font-size:1.6rem">${escapeHtml((user.fname?.[0]||'')+(user.lname?.[0]||''))}</div>`}
        <strong style="font-size:1.05rem">${escapeHtml(docName(user))}</strong>
        <span class="badge badge-info">${escapeHtml(user.role)}</span>
        <span class="text-muted" style="font-size:.76rem">Secure CampusCare conversation</span>
      </div>
      <div class="tabs" style="margin-bottom:.8rem">
        <button class="tab active" ${bindAction('click',(event,element)=>{switchContactInfoTab(element,'ci-media')})}>Media (${photos.length})</button>
        <button class="tab" ${bindAction('click',(event,element)=>{switchContactInfoTab(element,'ci-files')})}>Files (${files.length})</button>
        <button class="tab" ${bindAction('click',(event,element)=>{switchContactInfoTab(element,'ci-links')})}>Links (${links.length})</button>
      </div>
      <div id="ci-media">${photos.length?`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem">${photos.map(m=>`<img src="${m.attachment.dataUrl}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer" ${bindAction('click',(event,element)=>{showFilePreview('Shared photo',(String(m.attachment.dataUrl)))})}>`).join('')}</div>`:'<p class="text-muted" style="text-align:center;padding:1rem 0">No photos shared.</p>'}</div>
      <div id="ci-files" style="display:none">${files.length?files.map(m=>`<a href="${m.attachment.dataUrl}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div class="msgr-file-chip" style="margin-bottom:.4rem">${appIcon('paperclip',16)} ${escapeHtml(m.attachment.name)}</div></a>`).join(''):'<p class="text-muted" style="text-align:center;padding:1rem 0">No files shared.</p>'}</div>
      <div id="ci-links" style="display:none">${links.length?links.map(l=>`<a href="${l.url}" target="_blank" rel="noopener" style="display:block;font-size:.82rem;color:var(--primary);margin-bottom:.5rem;word-break:break-all">${escapeHtml(l.url)}</a>`).join(''):'<p class="text-muted" style="text-align:center;padding:1rem 0">No links shared.</p>'}</div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button></div>
  </div>`);
}

export function switchContactInfoTab(btn,paneId){
  btn.parentElement.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  ['ci-media','ci-files','ci-links'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.style.display=id===paneId?'block':'none';
  });
}

export function handleMsgrKeydown(ev,userId){
  const prefs=getMsgPrefs();
  if(ev.key==='Enter'&&!ev.shiftKey&&prefs.enterToSend){
    ev.preventDefault();
    sendChatMessage(userId);
  }
}

export function closeMsgMenus(){
  document.querySelectorAll('.msgr-msg-menu').forEach(m=>m.remove());
  document.removeEventListener('click',closeMsgMenus);
}

export function toggleMsgMenu(evt,msgId,canEdit,canDelete){
  evt.stopPropagation();
  closeMsgMenus();

  // Delegated actions receive a document currentTarget; anchor to the actual options button.
  const anchor=evt.target.closest('button');if(!anchor)return;
  const rect=anchor.getBoundingClientRect();
  const menu=document.createElement('div');
  menu.className='msgr-msg-menu';
  menu.setAttribute('role','group');menu.setAttribute('aria-label','Message actions');
  menu.innerHTML=`
    ${canEdit?`<button ${bindAction('click',(event,element)=>{closeMsgMenus();startEditMessage((msgId))})}>${appIcon('edit',16)}<span>Edit</span></button>`:''}
    <button ${bindAction('click',(event,element)=>{closeMsgMenus();forwardMessage((msgId))})}>${appIcon('forward',16)}<span>Forward</span></button>
    <button ${bindAction('click',(event,element)=>{closeMsgMenus();shareMessage((msgId))})}>${appIcon('share',16)}<span>Share</span></button>
    ${canDelete?`<button class="danger" ${bindAction('click',(event,element)=>{closeMsgMenus();deleteMessage((msgId))})}>${appIcon('trash',16)}<span>Delete</span></button>`:''}
  `;
  document.body.appendChild(menu);
  // Clamp the action sheet inside the viewport, including on narrow phones and scrolled pages.
  const bounds=menu.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(rect.right-bounds.width,window.innerWidth-bounds.width-8))+'px';
  menu.style.top=Math.max(8,Math.min(rect.bottom+6,window.innerHeight-bounds.height-8))+'px';
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMsgMenus();anchor.focus();}});
  menu.querySelector('button')?.focus();
  setTimeout(()=>document.addEventListener('click',closeMsgMenus),0);
}

export function startEditMessage(msgId){
  const m=messageRecords().find(x=>x.id===Number(msgId));if(!m)return;
  const bubble=document.getElementById(`msgr-bubble-${msgId}`);if(!bubble)return;

  bubble.innerHTML=`<div class="msgr-bubble-edit-area">
    <textarea id="msgr-edit-input-${msgId}" rows="2" maxlength="4000">${escapeHtml(m.message)}</textarea>
    <div class="msgr-edit-btns">
      <button class="btn btn-xs" ${bindAction('click',(event,element)=>{cancelEditMessage((msgId))})}>Cancel</button>
      <button class="btn btn-xs btn-primary" ${bindAction('click',(event,element)=>{saveEditedMessage((msgId))})}>Save</button>
    </div>
  </div>`;
  document.getElementById(`msgr-edit-input-${msgId}`)?.focus();
}

export function cancelEditMessage(_msgId){renderChatMessages(appState.messaging.activeConversationId,{force:true});}

export async function saveEditedMessage(msgId){
  const m=messageRecords().find(x=>x.id===Number(msgId));
  const input=document.getElementById(`msgr-edit-input-${msgId}`);
  if(!m||!input)return;

  const next=input.value.trim();
  if(!next){toast('Message cannot be empty.','error');return;}

  try{
    if(m._realSupabase){
      await messageAction({action:'edit',message_id:m.dbMessageId,body:next});
      await syncRealMessages();
    }else{
      m.message=next;m.edited=true;persistDB();
    }
    renderChatMessages(appState.messaging.activeConversationId,{force:true});
    renderContactList();
    toast('Message edited.','success');
  }catch(e){toast(e?.message||'Unable to edit the message.','error');}
}

export function deleteMessage(msgId){
  const m=messageRecords().find(x=>x.id===Number(msgId));if(!m)return;
  const own=m.fromUserId===appState.auth.currentUser.id;

  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Delete Message</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body"><p style="font-size:.85rem;color:var(--ink-muted)">${own?'You can remove it for everyone, or hide it only from your own view.':'This will hide the message only from your own view.'}</p></div>
    <div class="modal-footer" style="flex-direction:column;align-items:stretch;gap:.5rem">
      ${own?`<button class="btn btn-danger" style="width:100%" ${bindAction('click',(event,element)=>{confirmDeleteMessage((msgId),'everyone')})}>Delete for Everyone</button>`:''}
      <button class="btn" style="width:100%" ${bindAction('click',(event,element)=>{confirmDeleteMessage((msgId),'me')})}>Delete for Me</button>
      <button class="btn" style="width:100%" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
    </div>
  </div>`);
}

export async function confirmDeleteMessage(msgId,mode){
  const m=messageRecords().find(x=>x.id===Number(msgId));if(!m)return;

  try{
    if(m._realSupabase){
      await messageAction({
        action:mode==='everyone'?'delete_everyone':'hide',
        message_id:m.dbMessageId
      });
      await syncRealMessages();
    }else if(mode==='everyone'){
      m.deleted=true;m.message='';m.attachment=null;persistDB();
    }else{
      m.deletedFor=m.deletedFor||[];
      if(!m.deletedFor.includes(appState.auth.currentUser.id))m.deletedFor.push(appState.auth.currentUser.id);
      persistDB();
    }

    closeAllModals();
    renderChatMessages(appState.messaging.activeConversationId);
    renderContactList();
    toast(mode==='everyone'?'Message deleted for everyone.':'Message hidden from your view.','warning');
  }catch(e){toast(e?.message||'Unable to delete the message.','error');}
}

export function forwardMessage(msgId){
  const m=messageRecords().find(x=>x.id===Number(msgId));if(!m||m.deleted)return;
  const people=getAllMessagePeople();

  if(!people.length){toast('No available recipient for forwarding.','warning');return;}

  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Forward Message</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Forward to</label>
        <select id="fwd-to">${people.map(p=>`<option value="${p.id}">${escapeHtml(docName(p.user))} (${escapeHtml(p.user.role)})</option>`).join('')}</select>
      </div>
      <div class="card" style="margin:0;padding:.6rem .8rem;font-size:.82rem;background:var(--overlay)">
        ${m.attachment?escapeHtml(attachmentPreviewLabel(m.attachment)):escapeHtml(m.message)}
      </div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{confirmForwardMessage((msgId))})}>Forward</button></div>
  </div>`);
}

export async function confirmForwardMessage(msgId){
  const m=messageRecords().find(x=>x.id===Number(msgId));
  const toId=parseInt(document.getElementById('fwd-to')?.value||'0',10);
  const recipient=getUserById(toId);
  if(!m||!recipient)return;

  try{
    if(m._realSupabase){
      await messageAction({
        action:'forward',
        message_id:m.dbMessageId,
        to_user_id:recipient.dbUserId
      });
      await syncRealMessages();
    }else{
      appState.data.DB.messages.push({
        id:appState.data.DB.nextMessageId++,fromUserId:appState.auth.currentUser.id,toUserId:toId,
        subject:'',message:m.message,attachment:m.attachment?{...m.attachment}:null,
        createdAt:new Date().toISOString(),isRead:false,replyToId:null,forwarded:true
      });
      persistDB();
    }

    closeAllModals();
    toast('Message forwarded.','success');
    renderContactList();
    if(appState.messaging.activeConversationId===toId)renderChatMessages(toId);
  }catch(e){toast(e?.message||'Unable to forward the message.','error');}
}

export function shareMessage(msgId){
  const m=messageRecords().find(x=>x.id===Number(msgId));if(!m||m.deleted)return;
  const shareText=m.attachment?`${attachmentPreviewLabel(m.attachment)} (shared from CampusCare)`:m.message;

  if(navigator.share){
    navigator.share({title:'CampusCare Message',text:shareText}).catch(()=>{});
  }else if(navigator.clipboard){
    navigator.clipboard.writeText(shareText)
      .then(()=>toast('Copied to clipboard.','success'))
      .catch(()=>toast('Could not copy message.','error'));
  }else toast('Sharing is not supported on this browser.','warning');
}

export async function sendChatMessage(toId){
  const input=document.getElementById('msgr-text-input');
  const btn=document.getElementById('msgr-send-btn');
  const message=input?.value.trim()||'';
  if(!message&&!appState.messaging.pendingAttachment)return;

  const recipient=getUserById(Number(toId));
  if(!recipient){toast('Recipient is unavailable.','error');return;}

  if(appState.messaging.stopVoiceRecording){toast('Stop recording to preview your voice message first.','info');return;}
  const old=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.textContent='…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      await messageAction({
        action:'send',
        to_user_id:recipient.dbUserId,
        body:message,
        attachment_data_url:appState.messaging.pendingAttachment?.dataUrl||null,
        attachment_name:appState.messaging.pendingAttachment?.name||null,
        attachment_type:appState.messaging.pendingAttachment?.type||null
      });
      await syncRealMessages();
    }else{
      appState.data.DB.messages.push({
        id:appState.data.DB.nextMessageId++,fromUserId:appState.auth.currentUser.id,toUserId:Number(toId),
        subject:'',message,attachment:appState.messaging.pendingAttachment,
        createdAt:new Date().toISOString(),isRead:false,replyToId:null
      });
      persistDB();
    }

    const prefs=getMsgPrefs();
    if(prefs.sound)playMsgSendSound();

    if(input)input.value='';
    appState.messaging.pendingAttachment=null;
    const pa=document.getElementById('msgr-pending-attach');if(pa)pa.innerHTML='';
    const photo=document.getElementById('msgr-photo-input');if(photo)photo.value='';
    const file=document.getElementById('msgr-file-input');if(file)file.value='';

    toast('Secure message sent.','success');
    if(appState.messaging.activeConversationId===Number(toId))renderChatMessages(Number(toId),{scrollToEnd:true});
    renderContactList();
    if(!appState.auth.currentUser?._realSupabase)simulateReplyTyping(Number(toId));
  }catch(e){
    toast(e?.message||'Unable to send the message.','error');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.innerHTML=old||appIcon('send');
    }
  }
}

export function showTypingIndicator(){
  const el=document.getElementById('msgr-typing-indicator');if(!el)return;
  el.innerHTML='<div class="msgr-bubble-row received"><div class="msgr-typing-bubble"><span></span><span></span><span></span></div></div>';
}
export function hideTypingIndicator(){
  const el=document.getElementById('msgr-typing-indicator');if(el)el.innerHTML='';
}
export function simulateReplyTyping(toId){
  if(appState.auth.currentUser?._realSupabase)return;
  if(appState.messaging._typingTimer)clearTimeout(appState.messaging._typingTimer);
  appState.messaging._typingTimer=setTimeout(()=>{
    if(appState.messaging.activeConversationId!==toId)return;
    showTypingIndicator();
    setTimeout(()=>{if(appState.messaging.activeConversationId===toId)hideTypingIndicator();},1500);
  },600);
}

export function playMsgSendSound(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.frequency.value=700;
    gain.gain.setValueAtTime(.08,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.15);
    osc.connect(gain);gain.connect(ctx.destination);
    osc.start();osc.stop(ctx.currentTime+.15);
  }catch(_){}
}

export async function attachPhoto(input){
  if(appState.messaging.stopVoiceRecording)return;
  const file=input.files?.[0];if(!file)return;
  if(file.size>5*1024*1024){toast('Photo is too large. Maximum attachment size is 5 MB.','error');return;}

  try{
    const raw=await readFileAsDataURL(file);
    const resized=await resizeImageDataUrl(raw,1200,0.82);
    appState.messaging.pendingAttachment={type:'image',name:file.name,dataUrl:resized,size:file.size};
    showPendingAttachPreview();
  }catch(_){toast('Could not attach that photo.','error');}
}

export async function attachFileGeneric(input){
  if(appState.messaging.stopVoiceRecording)return;
  const file=input.files?.[0];if(!file)return;
  if(file.size>5*1024*1024){toast('File is too large. Maximum attachment size is 5 MB.','error');return;}

  const allowed=[
    'application/pdf','text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  if(!allowed.includes(file.type)){
    toast('Allowed files: PDF, TXT, DOCX, and XLSX.','warning');
    input.value='';
    return;
  }

  try{
    const raw=await readFileAsDataURL(file);
    appState.messaging.pendingAttachment={type:'file',name:file.name,dataUrl:raw,size:file.size,mime:file.type};
    showPendingAttachPreview();
  }catch(_){toast('Could not attach that file.','error');}
}

export function showPendingAttachPreview(){
  const el=document.getElementById('msgr-pending-attach'),attachment=appState.messaging.pendingAttachment;
  if(!el||!attachment)return;
  el.innerHTML=`<div class="msgr-pending-attach"><span>${escapeHtml(attachmentPreviewLabel(attachment))}</span><button type="button" class="voice-discard" aria-label="Remove attachment" ${bindAction('click',()=>clearPendingAttachment())}>${appIcon('trash',18)}</button></div>`;
  if(attachment.type==='audio')el.firstElementChild.prepend(createVoicePlayer(attachment.dataUrl,{duration:attachment.duration}));
}
export function clearPendingAttachment(){
  appState.messaging.pendingAttachment=null;
  const el=document.getElementById('msgr-pending-attach');if(el){el.querySelectorAll('audio').forEach(audio=>audio.pause());el.innerHTML='';}
  const photo=document.getElementById('msgr-photo-input');if(photo)photo.value='';
  const file=document.getElementById('msgr-file-input');if(file)file.value='';
}
export async function toggleVoiceRecording(toId){
  if(appState.messaging.stopVoiceRecording){appState.messaging.stopVoiceRecording(false);return;}
  const btn=document.getElementById('msgr-voice-btn'),host=document.getElementById('msgr-pending-attach');
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Your browser does not support voice recording.','error');return;}
  if(!host||btn?.disabled)return;
  const account=appState.auth.currentUser;let stream,recorder,meter,limit,discarded=false,stopped=false;
  const audioContext=prepareVoiceContext();
  if(btn)btn.disabled=true;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(appState.auth.currentUser!==account||appState.messaging.activeConversationId!==Number(toId)||!host.isConnected){stream.getTracks().forEach(t=>t.stop());audioContext?.close().catch(()=>{});return;}
    clearPendingAttachment();
    const preferred=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:{});
    const chunks=[];let bytes=0;
    const stop=(discard=false)=>{
      discarded=discarded||discard;if(stopped)return;stopped=true;meter?.dispose();clearTimeout(limit);
      if(appState.messaging.voiceRecorder===recorder)appState.messaging.stopVoiceRecording=null;
      if(btn?.isConnected)btn.disabled=!discard;
      document.querySelectorAll('.msgr-input-bar [aria-label="Send a photo"],.msgr-input-bar [aria-label="Send a file"]').forEach(control=>control.disabled=false);
      if(recorder.state!=='inactive')recorder.stop();
      stream.getTracks().forEach(t=>t.stop());
      if(btn?.isConnected){btn.classList.remove('recording');btn.innerHTML=appIcon('mic');btn.setAttribute('aria-label','Record a voice message');btn.setAttribute('aria-pressed','false');}
      if(discard&&host.isConnected)host.innerHTML='';
    };
    appState.messaging.stopVoiceRecording=stop;appState.messaging.voiceRecorder=recorder;
    recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>5*1024*1024)stop(false);}};
    const token=String(window.performance.now());host.dataset.recordingToken=token;
    recorder.onstop=async()=>{
      const duration=meter?.seconds()||0;
      stop(discarded);
      if(btn?.isConnected&&appState.messaging.voiceRecorder===recorder)btn.disabled=false;
      if(discarded||!host.isConnected||appState.auth.currentUser!==account||appState.messaging.activeConversationId!==Number(toId))return;
      const mime=recorder.mimeType||chunks[0]?.type||'audio/webm',blob=new Blob(chunks,{type:mime});
      host.innerHTML='';
      if(blob.size<500){toast('Recording was too short.','warning');return;}
      if(blob.size>5*1024*1024){toast('Voice message is too large. Maximum size is 5 MB.','error');return;}
      const dataUrl=await readFileAsDataURL(blob);
      if(!host.isConnected||host.dataset.recordingToken!==token||appState.auth.currentUser!==account||appState.messaging.activeConversationId!==Number(toId))return;
      appState.messaging.pendingAttachment={type:'audio',name:'Voice message.'+(mime.includes('mp4')?'m4a':'webm'),dataUrl,size:blob.size,mime,duration};
      showPendingAttachPreview();
    };
    recorder.onerror=()=>{stop(true);toast('Recording failed. Please try again.','error');};
    meter=startVoiceMeter(host,stream,{onStop:()=>stop(false),onDiscard:()=>stop(true),context:audioContext});
    recorder.start(250);btn?.classList.add('recording');
    document.querySelectorAll('.msgr-input-bar [aria-label="Send a photo"],.msgr-input-bar [aria-label="Send a file"]').forEach(control=>control.disabled=true);
    if(btn){btn.innerHTML=appIcon('stop');btn.setAttribute('aria-label','Stop recording');btn.setAttribute('aria-pressed','true');}
    // Bound microphone lifetime and file size; stopped recordings remain drafts until Send is pressed.
    limit=setTimeout(()=>stop(false),5*60*1000);
  }catch{stream?.getTracks().forEach(t=>t.stop());meter?.dispose();audioContext?.close().catch(()=>{});appState.messaging.stopVoiceRecording=null;toast('Microphone access was denied or unavailable.','error');}
  finally{if(btn?.isConnected)btn.disabled=false;}
}

export async function openNewMessageModal(){
  const recipients=getAllMessagePeople();
  openModal(`<div class="modal">
    <div class="modal-header"><h3>New Secure Message</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div id="msg-err"></div>
      <div class="form-group"><label>To</label>
        <select id="msg-to">${recipients.length?recipients.map(r=>`<option value="${r.id}">${escapeHtml(docName(r.user))} (${escapeHtml(r.user.role)})</option>`).join(''):'<option value="">No available recipients</option>'}</select>
      </div>
      <div class="form-group"><label>Message</label><textarea id="msg-body" maxlength="4000" rows="4" placeholder="Type your secure message..."></textarea></div>
      ${appState.auth.currentUser.role==='Patient'?'<div class="alert alert-warning show" style="font-size:.74rem">This messaging feature is not for emergencies. Seek immediate care for urgent symptoms.</div>':''}
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" id="new-msg-btn" ${bindAction('click',(event,element)=>{startNewConversation()})}>Send</button>
    </div>
  </div>`);
}

export async function startNewConversation(){
  const toId=parseInt(document.getElementById('msg-to')?.value||'0',10);
  const body=document.getElementById('msg-body')?.value.trim()||'';
  const err=document.getElementById('msg-err');
  const btn=document.getElementById('new-msg-btn');
  const recipient=getUserById(toId);

  if(!recipient){showAlert(err,'Please choose a recipient.');return;}
  if(!body){showAlert(err,'Message cannot be empty.');return;}

  if(appState.messaging.stopVoiceRecording){toast('Stop recording to preview your voice message first.','info');return;}
  const old=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.textContent='Sending…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      await messageAction({action:'send',to_user_id:recipient.dbUserId,body});
      await syncRealMessages();
    }else{
      appState.data.DB.messages.push({
        id:appState.data.DB.nextMessageId++,fromUserId:appState.auth.currentUser.id,toUserId:toId,
        subject:'',message:body,attachment:null,
        createdAt:new Date().toISOString(),isRead:false,replyToId:null
      });
      persistDB();
    }

    closeAllModals();
    toast('Secure message sent.','success');
    await renderMessages();
    await openConversation(toId);
  }catch(e){
    showAlert(err,e?.message||'Unable to send the message.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||'Send';
    }
  }
}

export function getMsgPrefs(){
  try{
    const raw=localStorage.getItem('campuscare_msg_prefs');
    return raw?{sound:true,enterToSend:true,...JSON.parse(raw)}:{sound:true,enterToSend:true};
  }catch(_){return {sound:true,enterToSend:true};}
}

export function saveMsgPrefs(p){
  try{localStorage.setItem('campuscare_msg_prefs',JSON.stringify(p));}catch(_){}
}

export function openMessageSettings(){
  const prefs=getMsgPrefs();
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Message Settings</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div class="form-group" style="flex-direction:row;align-items:center;justify-content:space-between">
        <label style="margin:0">Sound when I send a message</label>
        <input type="checkbox" id="mp-sound" ${prefs.sound?'checked':''} style="width:18px;height:18px">
      </div>
      <div class="form-group" style="flex-direction:row;align-items:center;justify-content:space-between">
        <label style="margin:0">Enter key sends message</label>
        <input type="checkbox" id="mp-enter" ${prefs.enterToSend?'checked':''} style="width:18px;height:18px">
      </div>
      ${appState.auth.currentUser?._realSupabase?'':'<p class="form-note">Sample availability indicators.</p>'}
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" ${bindAction('click',(event,element)=>{saveMessageSettings()})}>Save</button>
    </div>
  </div>`);
}

export function saveMessageSettings(){
  saveMsgPrefs({
    sound:document.getElementById('mp-sound').checked,
    enterToSend:document.getElementById('mp-enter').checked
  });
  toast('Message settings saved.','success');
  closeAllModals();
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.messaging.activeConversationId=null;
  appState.messaging.pendingAttachment=null;
  appState.messaging.voiceRecorder=null;
  appState.messaging.voiceChunks=[];
  appState.messaging.messagePollTimer=null;
  window.addEventListener('resize',syncMessengerMobileLayout);
  window.addEventListener('orientationchange',()=>{
  setTimeout(syncMessengerMobileLayout,120);
});
  appState.messaging._typingTimer=null;
}

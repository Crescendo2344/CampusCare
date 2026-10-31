// legalPages: Terms of Service, Cookie & Storage Policy and the first-visit storage notice.
import {state as appState} from '../app/state.js';
import {closeAllModals,openModal} from './modals.js';
import {bindAction} from '../dependencies.js';

export const TERMS_VERSION='1.0';
export const TERMS_UPDATED='October 31, 2026';
export const COOKIE_POLICY_VERSION='1.0';
const STORAGE_NOTICE_KEY='campuscare-storage-notice';

// Both documents share the Privacy Notice layout: numbered sections with a jump list.
function openLegalDocument({id,icon,title,meta,intro,sections}){
  openModal(`<div class="modal modal-lg privacy-notice legal-doc" aria-labelledby="${id}-title">
    <div class="modal-header pn-header"><div class="pn-title"><span class="pn-badge" aria-hidden="true"><i class="bi ${icon}"></i></span><div><h3 id="${id}-title">${title}</h3><p>${meta}</p></div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body pn-body">
      <p class="legal-intro">${intro}</p>
      <nav class="pn-toc" aria-label="Sections">${sections.map(([key,,heading],i)=>`<button type="button" ${bindAction('click',()=>document.getElementById(`${id}-${key}`)?.scrollIntoView({behavior:'smooth',block:'start'}))}>${i+1}. ${heading}</button>`).join('')}</nav>
      ${sections.map(([key,sectionIcon,heading,body],i)=>`<section class="pn-section" id="${id}-${key}"><h4><span class="pn-num">${i+1}</span><i class="bi ${sectionIcon}" aria-hidden="true"></i>${heading}</h4>${body}</section>`).join('')}
    </div>
    <div class="modal-footer pn-footer"><button type="button" class="btn" ${bindAction('click',()=>window.print())}><i class="bi bi-printer" aria-hidden="true"></i> Print</button><button type="button" class="btn btn-primary" ${bindAction('click',()=>closeAllModals())}>Close</button></div>
  </div>`);
}

export function openTermsOfService(){
  openLegalDocument({
    id:'tos',icon:'bi-file-earmark-text',title:'Terms of Service',
    meta:`Version ${TERMS_VERSION} · Updated ${TERMS_UPDATED}`,
    intro:'These terms explain the rules for using CampusCare, the online service of the CTU Main Medical &amp; Dental Clinic. By creating an account or signing in, you agree to them.',
    sections:[
      ['who','bi-people','Who may use CampusCare',`<p>CampusCare is for currently enrolled CTU students and CTU teaching and non-teaching personnel, and for the clinic doctors, staff and administrators who serve them. Patient accounts are verified by the clinic before they can be used.</p>`],
      ['account','bi-person-lock','Your account',`<ul class="pn-list">
        <li>Give true, complete and current information, and keep it up to date.</li>
        <li>Use only your own account. Do not share your password or let anyone else sign in as you.</li>
        <li>Sign out on shared or public computers, and do not tick “Remember me” on them.</li>
        <li>Tell the clinic right away if you think someone else has used your account.</li></ul>`],
      ['emergency','bi-exclamation-octagon','Not for emergencies',`<p>CampusCare is not an emergency service. For chest pain, difficulty breathing, severe bleeding, loss of consciousness or any urgent condition, go to the clinic in person or to the nearest hospital emergency room. Health Education articles are general information and do not replace a consultation with a doctor.</p>`],
      ['appointments','bi-calendar-check','Appointments',`<ul class="pn-list">
        <li>Book only the time you intend to use. Cancel or reschedule before the cutoff so the slot can go to another patient.</li>
        <li>The Dental Clinic allows a limited number of visits per semester, as set by the clinic.</li>
        <li>Bring your signed Certificate of Registration (COR) and school or employee ID to every visit.</li>
        <li>The clinic may cancel or move an appointment when a doctor is unavailable; you will be notified.</li></ul>`],
      ['use','bi-shield-check','Acceptable use',`<p>You must not:</p><ul class="pn-list">
        <li>impersonate another person or submit false identification, documents or health information;</li>
        <li>try to view, change or delete records that are not yours, or get around access controls;</li>
        <li>probe, scan or test CampusCare for weaknesses, or overload it, without written permission from CTU;</li>
        <li>upload malicious files or content that is offensive, threatening or unlawful.</li></ul>
        <p>Misuse may be reported under CTU rules and Philippine law, including the Data Privacy Act of 2012 (RA 10173) and the Cybercrime Prevention Act of 2012 (RA 10175).</p>`],
      ['records','bi-file-medical','Clinical records and certificates',`<p>Visit notes, diagnoses, prescriptions and medical certificates are written by clinic doctors. Medical certificates are issued only by the examining doctor and collected at the clinic. Altering or forging any CampusCare record or certificate is prohibited.</p>`],
      ['privacy','bi-shield-lock','Privacy',`<p>How your personal and health information is collected, used and protected is explained in the <a href="#" ${bindAction('click',async event=>{event.preventDefault();const {openPrivacyNotice}=await import('./loginLockout.js');openPrivacyNotice();})}>Privacy Notice &amp; Consent</a>. How CampusCare uses browser storage is explained in the <a href="#" ${bindAction('click',event=>{event.preventDefault();openCookiePolicy();})}>Cookie &amp; Storage Policy</a>.</p>`],
      ['availability','bi-cloud-check','Availability and changes',`<p>The clinic works to keep CampusCare available but cannot promise it will always be uninterrupted. These terms may be updated; the version and date above show the current text, and continued use after a change means you accept it.</p>`],
      ['suspension','bi-person-x','Suspension',`<p>Accounts that break these terms may be suspended or deactivated by a clinic administrator. Clinical records are kept as required by law even when an account is closed.</p>`],
      ['contact','bi-envelope','Contact',`<p>Questions about these terms can be sent to the CTU Main Medical &amp; Dental Clinic, Ground Floor, Education Building, CTU Main Campus, or through Report an Issue after signing in.</p>`]
    ]
  });
}

export function openCookiePolicy(){
  const row=(name,purpose,kept)=>`<tr><td><code>${name}</code></td><td>${purpose}</td><td>${kept}</td></tr>`;
  openLegalDocument({
    id:'cookies',icon:'bi-cookie',title:'Cookie &amp; Storage Policy',
    meta:`Version ${COOKIE_POLICY_VERSION} · Updated ${TERMS_UPDATED}`,
    intro:'CampusCare does not use advertising or tracking cookies. It keeps a small amount of information in your browser so that sign-in and your preferences work.',
    sections:[
      ['what','bi-hdd','What CampusCare stores',`<div class="table-wrap"><table class="legal-table">
        <thead><tr><th scope="col">Item</th><th scope="col">Purpose</th><th scope="col">How long</th></tr></thead>
        <tbody>
          ${row('sb-…-auth-token','Keeps you signed in securely (essential).','Until you sign out; until the browser closes unless “Remember me” is ticked')}
          ${row('campuscare-remember-session','Remembers whether you chose “Remember me”.','Until changed')}
          ${row('campuscare-remembered-login','Fills in your username or email when “Remember me” is ticked. Passwords are never stored.','Until you untick “Remember me”')}
          ${row('campuscare_last_activity','Signs you out after a period of inactivity (security).','Until you sign out')}
          ${row('campuscare_login_attempts','Pauses sign-in briefly after repeated failed attempts on this device (security).','Until the next successful sign-in')}
          ${row('campuscare-theme','Remembers light or dark mode.','Until changed')}
          ${row('campuscare-storage-notice','Remembers that you have seen the storage notice.','Until this policy changes')}
          ${row('Drafts','Unsent appointment or schedule drafts you saved.','Until the browser tab closes')}
        </tbody></table></div>`],
      ['health','bi-heart-pulse','Your health information',`<p>Your health records are kept on CampusCare's secured server, not in your browser's storage. They are loaded only while you are signed in and are cleared from the page when you sign out.</p>`],
      ['third','bi-globe','Third-party services',`<p>To load the page, your browser contacts a few providers: Supabase (the clinic's secure database and sign-in service), Cloudflare Turnstile (a security check on the registration form), and public content networks for fonts and icons (Google Fonts, jsDelivr and cdnjs). These providers receive standard technical details such as your IP address. CampusCare does not allow them to track you for advertising.</p>`],
      ['choices','bi-sliders','Your choices',`<p>All of the items above are needed for CampusCare to work securely, or are set only when you choose a preference. You can clear them at any time in your browser settings; you will then need to sign in again. Blocking browser storage completely will stop sign-in from working.</p>`]
    ]
  });
}

// First-visit notice: essential storage only, so it informs rather than asks for opt-in.
export function initStorageNotice(){
  let seen='';
  try{seen=localStorage.getItem(STORAGE_NOTICE_KEY)||'';}catch{ /* Storage may be blocked in private modes. */ }
  if(seen===COOKIE_POLICY_VERSION||document.getElementById('storage-notice'))return;
  const bar=document.createElement('section');
  bar.id='storage-notice';bar.className='storage-notice';bar.setAttribute('role','region');bar.setAttribute('aria-label','Cookie and storage notice');
  bar.innerHTML=`<i class="bi bi-cookie" aria-hidden="true"></i>
    <p>CampusCare uses only essential browser storage to keep you signed in and remember your preferences. No advertising or tracking cookies. <a href="#" id="storage-notice-policy">Cookie &amp; Storage Policy</a></p>
    <button type="button" class="btn btn-primary btn-sm" id="storage-notice-ok">Got it</button>`;
  document.body.append(bar);
  bar.querySelector('#storage-notice-policy').addEventListener('click',event=>{event.preventDefault();openCookiePolicy();});
  bar.querySelector('#storage-notice-ok').addEventListener('click',()=>{
    try{localStorage.setItem(STORAGE_NOTICE_KEY,COOKIE_POLICY_VERSION);}catch{ /* Storage may be blocked in private modes. */ }
    bar.remove();
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.legalPages.ready=true;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initStorageNotice,{once:true});
  else initStorageNotice();
}

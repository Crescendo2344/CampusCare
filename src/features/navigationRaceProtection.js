import {createFeatureSyncService} from '../services/feature-sync.js';
// navigationRaceProtection: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {acknowledgeNavAttention,toggleSidebar} from './topbarAndNavigation.js';
import {renderPage,showDatabaseSkeleton} from './loadingSkeletons.js';
import {escapeHtml,openArticleModal} from './issueReports.js';
import {fmtDate} from './inputValidation.js';
import {closeAllModals,openModal} from './modals.js';
import {showConfirmDialog,toast,toastWithUndo} from './theme.js';
import {persistDB} from './persistence.js';
import {bindAction,createOperationalService} from '../dependencies.js';
import {articleIconHtml} from '../ui/app-icons.js';
import {articleBodyHtml,readingMinutes,relatedArticles} from '../domain/health-articles.js';
// ================================================================
// NAVIGATION RACE PROTECTION
// ================================================================
// Some CampusCare pages load Supabase data asynchronously. If the user taps
// another sidebar item before the first request finishes, the old request must
// not render over the newer page.

export function beginCampusNavigation(id){
  appState.navigationRaceProtection.campusActivePageId=id;
  appState.navigationRaceProtection.campusNavigationToken+=1;
  const content=document.getElementById('app-content');
  if(content){
    content.dataset.pageId=id;
    content.dataset.navToken=String(appState.navigationRaceProtection.campusNavigationToken);
  }
  return appState.navigationRaceProtection.campusNavigationToken;
}

export function captureCampusPageToken(){
  return appState.navigationRaceProtection.campusNavigationToken;
}

export function isCampusPageCurrent(pageId,token){
  return appState.navigationRaceProtection.campusActivePageId===pageId && appState.navigationRaceProtection.campusNavigationToken===token;
}

// Browser entries are scoped to this account and sign-in session, never shared across users.
export function navigationAccountKey(){
  const user=appState.auth.currentUser;
  return user?`${user.id}:${user.role}:${appState.navigationRaceProtection.historySession}`:null;
}
export function recordPageHistory(id,historyMode){
  const account=navigationAccountKey(),previous=window.history.state?.campuscareNavigation;
  if(!account)return;
  // Replacing the first entry prevents Back from replaying the login page or another account.
  const first=!previous||previous.account!==account;
  if(first||historyMode==='replace'){
    window.history.replaceState({...window.history.state,campuscareNavigation:{account,page:id,index:first?0:previous.index}},'');
  }else if(historyMode==='push'&&previous.page!==id){
    window.history.pushState({...window.history.state,campuscareNavigation:{account,page:id,index:previous.index+1}},'');
  }
}
// Pages that are no longer part of CampusCare open the dashboard instead (e.g. old history entries).
const RETIRED_PAGES=new Set(['messages']);
export function navTo(id,{historyMode='push'}={}){
  if(!appState.auth.currentUser)return;
  if(RETIRED_PAGES.has(id))id='dashboard';
  // Fitness-to-compete assessments are a doctor's clinical work only.
  // Clinical records (visit notes and fitness assessments) belong to doctors.
  if(['fitness','treatments'].includes(id)&&appState.auth.currentUser.role!=='Doctor')id='dashboard';
  recordPageHistory(id,historyMode);
  if(window.innerWidth<=768) toggleSidebar(false);
  document.querySelectorAll('[id^="nav-"]').forEach(el=>el.classList.remove('active'));
  const btn=document.getElementById('nav-'+id);
  if(btn)btn.classList.add('active');
  document.getElementById('top-title').textContent={
    dashboard:'Dashboard','my-appointments':'My Appointments','my-records':'My Health Records','my-certificates':'Medical Certificates',
    'my-account':'Account Settings',patients:'Patient Records',appointments:'Appointments',
    approvals:'Approval Queue',certificates:'Medical Certificates','cert-requests':'Medical Certificates',treatments:'Treatments',inventory:'Inventory Management',
    reports:appState.auth.currentUser.role==='Doctor'?'My Reports':'Reports & Analytics',users:'User Management',settings:'System Settings',
    schedule:'My Schedule','my-patients':'My Patients','report-issue':'Report an Issue',
    'feedback-issues':'Feedback & Issues','health_education':'Health Education',fitness:'Fitness Assessments','activity-log':'Activity Log',
    'dental-survey':'Dental Clinic Survey','survey-results':'Survey Results'
  }[id]||id;
  renderPage(id);
  void acknowledgeNavAttention(id);
  window.scrollTo({top:0,behavior:'smooth'});
}

export function healthResourceRecords(){
  if(appState.auth.currentUser?._realSupabase)return (appState.data.DB.healthResources||[]).filter(r=>r._realSupabase);
  return (appState.data.DB.healthResources||[]).filter(r=>!r.archived);
}

export async function healthResourceAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).healthResourceAction(payload);}

export function realHealthResourceToUi(r){
  return {
    id:1300000+Number(r.resource_id),
    dbResourceId:Number(r.resource_id),
    title:r.title||'',
    category:r.category||'Health',
    content:r.content||'',
    teaser:r.teaser||'',
    sourceName:r.source_name||'',
    sourceUrl:r.source_url||'',
    icon:r.icon||'bi-newspaper',
    photo:r.image_url||'',
    imagePath:r.image_path||'',
    authorId:r.author_id?100000+Number(r.author_id):null,
    published:Boolean(r.published),
    publishedAt:r.published_at||'',
    createdAt:r.created_at||'',
    updatedAt:r.updated_at||'',
    _realSupabase:true
  };
}

export async function syncRealHealthResources(){
  return createFeatureSyncService({getState:()=>appState,callbacks:{healthResourceRecords,healthResourceAction,realHealthResourceToUi}}).syncRealHealthResources();
}

export function articleCategoryColor(cat){
  const map={
    'Stress Management':['#8b7ff0','#5b4fd6'],
    'Mental Health':['#7aa8f0','#3f5fc4'],
    'Nutrition':['#5ecfa8','#0b7d63'],
    'First Aid':['#ef9b8a','#b0431e'],
    'Sexual Health':['#f091b8','#c14d80'],
    'Vaccination':['#5cb8e6','#0a6ebd']
  };
  if(map[cat])return map[cat];
  // Custom/staff-defined categories get a consistent color picked from a
  // small palette, based on the category name, so they still look on-brand.
  const palette=[['#7aa8d8','#3a7ab0'],['#f0b25e','#a15c00'],['#8fd6c1','#0f6e56'],['#e79bb0','#a5325a'],['#a9b8f0','#4f5fc4'],['#f2a483','#b0431e']];
  let hash=0;
  for(let i=0;i<(cat||'').length;i++)hash=(hash*31+cat.charCodeAt(i))>>>0;
  return palette[hash%palette.length];
}

// The category gradient sits underneath, so a photo that fails to load still leaves a banner.
// In the reader the whole photo shows over a blurred copy of itself instead of being cropped.
export function articleBannerHtml(art,variant='card'){
  const [c1,c2]=articleCategoryColor(art.category);
  const photo=art.photo?escapeHtml(art.photo):'';
  return `<div class="he-media he-media-${variant}" style="--c1:${c1};--c2:${c2}${photo&&variant==='reader'?`;--img:url('${photo}')`:''}">
    <span class="article-banner-icon">${articleIconHtml(art.icon)}</span>
    ${photo?`<img class="he-img" src="${photo}" alt="" loading="lazy" decoding="async">`:''}
  </div>`;
}

const heUi=()=>appState.navigationRaceProtection.healthEducation??={category:'',sort:'newest',status:'',query:''};
const isArticleEditor=()=>['Administrator','Staff'].includes(appState.auth.currentUser.role);
const articleDate=art=>fmtDate(String(art.publishedAt||art.createdAt||'').slice(0,10));
const articleMeta=art=>`${articleDate(art)} · ${readingMinutes(art.content)} min read`;

export async function renderHealthEducation() {
  const c=document.getElementById('app-content');if(!c)return;
  const pageToken=captureCampusPageToken();

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('cards');
    try{await syncRealHealthResources();}
    catch(e){
      if(!isCampusPageCurrent('health_education',pageToken))return;
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load Health Education resources.')}</div>
        <button class="btn btn-sm" ${bindAction('click',()=>renderHealthEducation())}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('health_education',pageToken))return;
  }

  const ui=heUi(),editor=isArticleEditor();
  c.innerHTML=`
    <div class="he-head">
      <div><h2><i class="bi bi-book" aria-hidden="true"></i> Health Education</h2><p id="he-count"></p></div>
      ${editor?`<button class="btn btn-primary btn-sm" ${bindAction('click',()=>openArticleModal())}><i class="bi bi-plus-lg" aria-hidden="true"></i> New article</button>`:''}
    </div>
    <div class="he-toolbar">
      <div class="he-search"><i class="bi bi-search" aria-hidden="true"></i><input type="search" id="article-search" placeholder="Search health topics" aria-label="Search articles" value="${escapeHtml(ui.query)}" ${bindAction('input',(event,element)=>{ui.query=element.value;renderArticlesList();})}></div>
      ${editor?`<div class="he-status" id="he-status" role="tablist" aria-label="Article status"></div>`:''}
      <select id="article-sort" aria-label="Sort articles" ${bindAction('change',(event,element)=>{ui.sort=element.value;renderArticlesList();})}><option value="newest" ${ui.sort==='newest'?'selected':''}>Newest first</option><option value="title" ${ui.sort==='title'?'selected':''}>A–Z</option></select>
    </div>
    <div class="he-topics" id="he-topics" role="tablist" aria-label="Topics"></div>
    <div id="articles-list"></div>`;
  renderArticlesList();
}

function articleCardHtml(art,editor,featured=false){
  return `<article class="he-card ${featured?'featured':''}" tabindex="0" role="button" aria-label="Read ${escapeHtml(art.title)}" ${bindAction('click',()=>viewArticle(art.id))} ${bindAction('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();viewArticle(art.id);}})}>
    <div class="he-card-media">${articleBannerHtml(art,featured?'featured':'card')}</div>
    <div class="he-card-body">
      <div class="he-card-tags"><span class="he-cat" style="--cat:${articleCategoryColor(art.category)[1]}">${escapeHtml(art.category)}</span>${editor&&!art.published?'<span class="badge badge-warning">Draft</span>':''}</div>
      <h4>${escapeHtml(art.title)}</h4>
      <p>${escapeHtml(art.teaser||String(art.content||'').slice(0,160))}</p>
      <span class="he-card-meta">${articleMeta(art)}${art.sourceName?` · ${escapeHtml(art.sourceName)}`:''}</span>
    </div>
  </article>`;
}

export function renderArticlesList() {
  const ui=heUi(),editor=isArticleEditor();
  const all=healthResourceRecords().filter(r=>editor||r.published);
  const q=String(ui.query||'').trim().toLowerCase();
  const matchesStatus=r=>!ui.status||(ui.status==='published'?r.published:!r.published);
  const visible=all.filter(matchesStatus);
  const topics=[...new Set(visible.map(r=>r.category).filter(Boolean))].sort();
  if(ui.category&&!topics.includes(ui.category))ui.category='';

  const count=document.getElementById('he-count');
  if(count)count.textContent=`${visible.length} article${visible.length===1?'':'s'} · ${topics.length} topic${topics.length===1?'':'s'}`;
  const status=document.getElementById('he-status');
  if(status){
    const n=f=>all.filter(f).length;
    status.innerHTML=[['','All',n(()=>true)],['published','Published',n(r=>r.published)],['draft','Drafts',n(r=>!r.published)]].map(([key,label,num])=>`<button type="button" role="tab" aria-selected="${ui.status===key}" class="${ui.status===key?'active':''}" ${bindAction('click',()=>{ui.status=key;renderArticlesList();})}>${label} <span>${num}</span></button>`).join('');
  }
  const chips=document.getElementById('he-topics');
  if(chips)chips.innerHTML=[['','All topics',visible.length],...topics.map(t=>[t,t,visible.filter(r=>r.category===t).length])].map(([key,label,num])=>`<button type="button" role="tab" aria-selected="${ui.category===key}" class="he-topic ${ui.category===key?'active':''}" ${key?`style="--cat:${articleCategoryColor(key)[1]}"`:''} ${bindAction('click',()=>{ui.category=key;renderArticlesList();})}>${key?'<i class="he-dot" aria-hidden="true"></i>':''}${escapeHtml(label)} <span>${num}</span></button>`).join('');

  let articles=visible.filter(r=>(!ui.category||r.category===ui.category)&&(!q||`${r.title} ${r.teaser||''} ${r.content||''} ${r.category}`.toLowerCase().includes(q)));
  articles=articles.sort(ui.sort==='title'
    ?(a,b)=>String(a.title).localeCompare(String(b.title))
    :(a,b)=>String(b.publishedAt||b.createdAt).localeCompare(String(a.publishedAt||a.createdAt))||b.id-a.id);

  const container=document.getElementById('articles-list');
  if(!container)return;
  if(!articles.length){
    container.innerHTML=`<div class="empty-state"><i class="bi bi-journal-text" aria-hidden="true" style="font-size:1.6rem"></i><p>${all.length?'No articles match your search.':editor?'No articles yet. Write the first one with New article.':'No health articles yet.'}</p></div>`;
    return;
  }
  // The newest article leads the library when nobody is searching or filtering.
  const feature=!q&&!ui.category&&ui.sort==='newest'&&articles.length>2?articles[0]:null;
  const rest=feature?articles.slice(1):articles;
  container.innerHTML=`${feature?articleCardHtml(feature,editor,true):''}<div class="he-grid">${rest.map(art=>articleCardHtml(art,editor)).join('')}</div>`;
}

export function viewArticle(id) {
  const art=healthResourceRecords().find(r=>r.id===Number(id));
  if(!art)return;
  const editor=isArticleEditor(),patient=appState.auth.currentUser.role==='Patient';
  const related=relatedArticles(art,healthResourceRecords());
  openModal(`
    <div class="modal modal-lg he-reader">
      <div class="modal-header no-print">
        <span class="he-cat" style="--cat:${articleCategoryColor(art.category)[1]}">${escapeHtml(art.category)}</span>
        <button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button>
      </div>
      <div class="modal-body" style="padding:0">
        ${articleBannerHtml(art,'reader')}
        <div class="he-article">
          ${editor&&!art.published?'<span class="badge badge-warning">Draft</span>':''}
          <h2>${escapeHtml(art.title)}</h2>
          <div class="he-article-meta">${articleMeta(art)}</div>
          ${art.teaser?`<p class="he-lead">${escapeHtml(art.teaser)}</p>`:''}
          <div class="he-body">${articleBodyHtml(art.content,escapeHtml)}</div>
          ${art.sourceName&&art.sourceUrl?`<a class="he-source" href="${escapeHtml(art.sourceUrl)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-journal-bookmark" aria-hidden="true"></i><span><small>Source</small>${escapeHtml(art.sourceName)}</span><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>`:''}
          ${patient?`<div class="he-cta no-print"><div><strong>Have a health concern?</strong><span>The clinic can see you in person.</span></div><button class="btn btn-primary btn-sm" ${bindAction('click',()=>{closeAllModals();navTo('my-appointments');import('./bookingForm.js').then(m=>m.openBookApptModal());})}>Book a visit</button></div>`:''}
          <p class="he-disclaimer">General health information, not personal medical advice.</p>
          ${related.length?`<div class="he-related no-print"><h4>Related articles</h4>${related.map(r=>`<button type="button" class="he-related-item" ${bindAction('click',()=>viewArticle(r.id))}><span class="he-dot" style="--cat:${articleCategoryColor(r.category)[1]}" aria-hidden="true"></span><span><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.category)} · ${readingMinutes(r.content)} min read</small></span></button>`).join('')}</div>`:''}
        </div>
      </div>
      <div class="modal-footer no-print">
        ${editor?`<button class="btn btn-sm" ${bindAction('click',()=>openArticleModal(art.id))}><i class="bi bi-pencil" aria-hidden="true"></i> Edit</button>
          ${art.published
            ?`<button class="btn btn-sm btn-warning" ${bindAction('click',()=>deleteArticle(art.id))}>Unpublish</button>`
            :`<button class="btn btn-sm btn-success" ${bindAction('click',()=>publishArticle(art.id))}>Publish</button>
              <button class="btn btn-sm btn-danger" ${bindAction('click',()=>deleteDraftArticle(art.id))}><i class="bi bi-trash" aria-hidden="true"></i> Delete draft</button>`}
          ${appState.auth.currentUser.role==='Administrator'?`<button class="btn btn-sm btn-danger" ${bindAction('click',()=>archiveArticle(art.id))}>Archive</button>`:''}`:''}
        <button class="btn btn-sm" ${bindAction('click',()=>window.print())}><i class="bi bi-printer" aria-hidden="true"></i> Print</button>
      </div>
    </div>`);
}

// publish / unpublish / archive / restore, then refresh the library.
async function applyArticleAction(art,action){
  if(art._realSupabase){
    await healthResourceAction({action,resource_id:art.dbResourceId});
    await syncRealHealthResources();
  }else{
    if(action==='publish'||action==='unpublish')art.published=action==='publish';
    else art.archived=action==='archive';
    persistDB();
  }
  renderArticlesList();
}
const ARTICLE_UNDO={publish:'unpublish',unpublish:'publish',archive:'restore'};
const ARTICLE_DONE={publish:'Article published.',unpublish:'Article unpublished.',archive:'Article archived.'};
const ARTICLE_UNDONE={publish:'Article unpublished again.',unpublish:'Article published again.',archive:'Article restored.'};
async function changeArticle(art,action){
  try{await applyArticleAction(art,action);}
  catch(e){toast(e?.message||`Unable to ${action} the article.`,'error');return;}
  closeAllModals();
  toastWithUndo(ARTICLE_DONE[action],()=>applyArticleAction(art,ARTICLE_UNDO[action]),{undoneMessage:ARTICLE_UNDONE[action]});
}

export function deleteArticle(id){
  const art=healthResourceRecords().find(r=>r.id===Number(id));if(!art)return;

  showConfirmDialog({
    title:'Unpublish Article',
    message:`Unpublish <strong>${escapeHtml(art.title)}</strong>? It will be hidden from normal Health Education views but kept in the database.`,
    confirmLabel:'Unpublish',
    danger:true,
    onConfirm:()=>changeArticle(art,'unpublish')
  });
}

export async function publishArticle(id){
  const art=healthResourceRecords().find(r=>r.id===Number(id));if(!art)return;
  await changeArticle(art,'publish');
}

export function archiveArticle(id){
  const art=healthResourceRecords().find(r=>r.id===Number(id));if(!art)return;
  showConfirmDialog({
    title:'Archive Health Article',
    message:`Archive <strong>${escapeHtml(art.title)}</strong>? It will be preserved in the database and removed from the active library.`,
    confirmLabel:'Archive',
    danger:true,
    onConfirm:()=>changeArticle(art,'archive')
  });
}

// Drafts were never shown to patients, so they can be removed for good after a confirmation.
export function deleteDraftArticle(id){
  const art=healthResourceRecords().find(r=>r.id===Number(id));if(!art||art.published)return;
  showConfirmDialog({
    title:'Delete draft',
    message:`Delete the draft <strong>${escapeHtml(art.title)}</strong>? This removes it and its photo permanently.`,
    confirmLabel:'Delete draft',
    danger:true,
    onConfirm:async()=>{
      try{
        if(art._realSupabase){
          await healthResourceAction({action:'delete',resource_id:art.dbResourceId});
          await syncRealHealthResources();
        }else{
          appState.data.DB.healthResources=(appState.data.DB.healthResources||[]).filter(r=>r.id!==art.id);
          persistDB();
        }
      }catch(e){toast(e?.message||'Unable to delete the draft.','error');return;}
      closeAllModals();
      renderArticlesList();
      toast('Draft deleted.','success');
    }
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.navigationRaceProtection.campusNavigationToken=0;
  appState.navigationRaceProtection.campusActivePageId='dashboard';
  appState.navigationRaceProtection.historySession=0;
  // Image errors do not bubble, so a capture listener drops a broken article photo and the banner shows instead.
  document.addEventListener('error',event=>{
    const img=event.target;
    if(img?.tagName==='IMG'&&img.classList.contains('he-img')){img.closest('.he-media')?.style.removeProperty('--img');img.remove();}
  },true);
  // Back and Forward use the same renderer and race guard as sidebar navigation.
  window.addEventListener('popstate',event=>{
    if(!appState.auth.currentUser)return;
    const entry=event.state?.campuscareNavigation;
    if(entry?.account===navigationAccountKey()&&document.getElementById('nav-'+entry.page))navTo(entry.page,{historyMode:'pop'});
    else navTo('dashboard',{historyMode:'replace'});
  });
}

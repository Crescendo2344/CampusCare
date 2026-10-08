import {createFeatureSyncService} from '../services/feature-sync.js';
// navigationRaceProtection: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {acknowledgeNavAttention,toggleSidebar} from './topbarAndNavigation.js';
import {renderPage,showDatabaseSkeleton} from './loadingSkeletons.js';
import {escapeHtml,openArticleModal} from './issueReports.js';
import {fmtDate} from './inputValidation.js';
import {closeAllModals,openModal} from './modals.js';
import {showConfirmDialog,toast} from './theme.js';
import {persistDB} from './persistence.js';
import {bindAction,createOperationalService} from '../dependencies.js';
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
export function updateBackButton(){
  const button=document.getElementById('page-back');
  if(button)button.disabled=!(window.history.state?.campuscareNavigation?.account===navigationAccountKey()&&window.history.state.campuscareNavigation.index>0);
}
export function goBackPage(){
  if(appState.auth.currentUser&&!document.getElementById('page-back')?.disabled)window.history.back();
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
  updateBackButton();
}
export function navTo(id,{historyMode='push'}={}){
  if(!appState.auth.currentUser)return;
  recordPageHistory(id,historyMode);
  if(window.innerWidth<=768) toggleSidebar(false);
  document.querySelectorAll('[id^="nav-"]').forEach(el=>el.classList.remove('active'));
  const btn=document.getElementById('nav-'+id);
  if(btn)btn.classList.add('active');
  document.getElementById('top-title').textContent={
    dashboard:'Dashboard','my-appointments':'My Appointments','my-records':'My Health Records','my-certificates':'Medical Certificates',
    'my-account':'Account Settings',patients:'Patient Records',appointments:'Appointments',
    approvals:'Approval Queue',certificates:'Medical Certificates','cert-requests':'Certificate Requests',treatments:'Treatments',inventory:'Inventory Management',
    reports:'Reports & Analytics',users:'User Management',settings:'System Settings',
    schedule:'My Schedule','my-patients':'My Patients','report-issue':'Report an Issue',
    'feedback-issues':'Feedback & Issues','health_education':'Health Education',fitness:'Fitness to Compete','activity-log':'Activity Log',
    'dental-survey':'Dental Clinic Survey','survey-results':'Survey Results',
    messages:'Messages'
  }[id]||id;
  renderPage(id);
  void acknowledgeNavAttention(id);
  window.scrollTo({top:0,behavior:'smooth'});
}

export function healthResourceRecords(){
  if(appState.auth.currentUser?._realSupabase)return (appState.data.DB.healthResources||[]).filter(r=>r._realSupabase);
  return appState.data.DB.healthResources||[];
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
    icon:r.icon||'📰',
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

export function articleBannerHtml(art,height=140){
  if(art.photo){
    return `<div style="height:${height}px;border-radius:14px 14px 0 0;overflow:hidden">
      <img src="${art.photo}" style="width:100%;height:100%;object-fit:cover;display:block">
    </div>`;
  }
  const [c1,c2]=articleCategoryColor(art.category);
  return `<div style="height:${height}px;border-radius:14px 14px 0 0;background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:${Math.round(height*0.4)}px;position:relative;overflow:hidden">
    <div style="position:absolute;width:180%;height:180%;border-radius:50%;background:rgba(255,255,255,.08);top:-60%;left:-40%"></div>
    <span style="filter:drop-shadow(0 2px 6px rgba(0,0,0,.15))">${art.icon||'📰'}</span>
  </div>`;
}

export async function renderHealthEducation() {
  const c=document.getElementById('app-content');if(!c)return;
  const role=appState.auth.currentUser.role;
  const isEditor=role==='Administrator'||role==='Staff';
  const pageToken=captureCampusPageToken();

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('cards');
    try{await syncRealHealthResources();}
    catch(e){
      if(!isCampusPageCurrent('health_education',pageToken))return;
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load Health Education resources.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderHealthEducation()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('health_education',pageToken))return;
  }

  const records=healthResourceRecords();
  const categories=[...new Set(records.filter(r=>r.published).map(r=>r.category).filter(Boolean))].sort();

  c.innerHTML=`
    <div class="card" style="background:linear-gradient(135deg,rgba(10,126,168,.14),rgba(91,79,214,.1));border:none">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
        <div>
          <h2 style="font-size:1.15rem;margin-bottom:.25rem">📚 Health &amp; Wellness Library</h2>
          <p class="text-muted" style="max-width:560px">Clinic-curated educational resources with source links. Articles are general information and do not replace individualized medical or dental advice.</p>
        </div>
        ${isEditor?`<button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{openArticleModal()})}>+ Add Article</button>`:''}
      </div>
    </div>

    <div class="toolbar">
      <input type="text" id="article-search" placeholder="Search articles..." ${bindAction('input',(event,element)=>{renderArticlesList()})}>
      <select id="article-category" ${bindAction('change',(event,element)=>{renderArticlesList()})}>
        <option value="">All Categories</option>
        ${categories.map(cat=>`<option>${escapeHtml(cat)}</option>`).join('')}
      </select>
      ${isEditor?`<select id="article-status" ${bindAction('change',(event,element)=>{renderArticlesList()})}>
        <option value="">All Statuses</option>
        <option value="published">Published</option>
        <option value="draft">Draft / Unpublished</option>
      </select>`:''}
    </div>
    <div id="articles-list"></div>
  `;

  renderArticlesList();
}

export function renderArticlesList() {
  const search=(document.getElementById('article-search')?.value||'').toLowerCase();
  const category=document.getElementById('article-category')?.value||'';
  const status=document.getElementById('article-status')?.value||'';
  const isEditor=appState.auth.currentUser.role==='Administrator'||appState.auth.currentUser.role==='Staff';

  let articles=healthResourceRecords().filter(r=>{
    const haystack=`${r.title} ${r.teaser||''} ${r.content||''}`.toLowerCase();
    return haystack.includes(search);
  });

  if(!isEditor)articles=articles.filter(r=>r.published);
  if(category)articles=articles.filter(r=>r.category===category);
  if(status==='published')articles=articles.filter(r=>r.published);
  if(status==='draft')articles=articles.filter(r=>!r.published);

  articles=articles.sort((a,b)=>String(b.publishedAt||b.createdAt).localeCompare(String(a.publishedAt||a.createdAt))||b.id-a.id);

  const container=document.getElementById('articles-list');
  if(!container)return;

  if(!articles.length){
    container.innerHTML='<div class="empty-state"><p>No articles found.</p></div>';
    return;
  }

  container.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:1rem">${articles.map(art=>`
    <div class="card" style="margin-bottom:0;padding:0;overflow:hidden;cursor:pointer;display:flex;flex-direction:column" ${bindAction('click',(event,element)=>{viewArticle((art.id))})}>
      ${articleBannerHtml(art)}
      <div style="padding:1rem;display:flex;flex-direction:column;gap:.4rem;flex:1">
        <div style="display:flex;gap:.35rem;align-items:center;flex-wrap:wrap">
          <span class="badge badge-info">${escapeHtml(art.category)}</span>
          ${isEditor?`<span class="badge ${art.published?'badge-success':'badge-warning'}">${art.published?'Published':'Draft'}</span>`:''}
        </div>
        <h4 style="font-size:.92rem;line-height:1.3;margin:0">${escapeHtml(art.title)}</h4>
        <p style="font-size:.79rem;color:var(--ink-muted);flex:1">${escapeHtml((art.teaser||art.content).substring(0,110))}${(art.teaser||art.content).length>110?'…':''}</p>
        <div style="font-size:.7rem;color:var(--ink-muted);display:flex;justify-content:space-between;align-items:center;padding-top:.4rem;border-top:1px solid var(--line-soft)">
          <span>${fmtDate(art.publishedAt||art.createdAt)}</span>
          ${art.sourceName?`<span>📎 ${escapeHtml(art.sourceName)}</span>`:''}
        </div>
      </div>
    </div>`).join('')}</div>`;
}

export function viewArticle(id) {
  const art=healthResourceRecords().find(r=>r.id===Number(id));
  if(!art)return;

  const isEditor=appState.auth.currentUser.role==='Administrator'||appState.auth.currentUser.role==='Staff';
  openModal(`
    <div class="modal modal-lg">
      <div class="modal-header no-print">
        <h3>Health Education Article</h3>
        <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
      </div>
      <div class="modal-body" style="padding:0">
        ${articleBannerHtml(art,170)}
        <div style="padding:1.25rem">
          <span class="badge badge-info">${escapeHtml(art.category)}</span>
          ${isEditor?` <span class="badge ${art.published?'badge-success':'badge-warning'}">${art.published?'Published':'Draft'}</span>`:''}
          <span class="text-muted" style="font-size:.78rem"> · ${fmtDate(art.publishedAt||art.createdAt)}</span>

          <h2 style="font-size:1.2rem;margin:.6rem 0">${escapeHtml(art.title)}</h2>
          <div style="white-space:pre-wrap;line-height:1.65;font-size:.88rem;color:var(--ink)">${escapeHtml(art.content)}</div>

          ${art.sourceName&&art.sourceUrl?`
            <div class="card" style="background:var(--overlay);margin-top:1.1rem;padding:.9rem 1rem">
              <div style="font-size:.78rem;color:var(--ink-muted);margin-bottom:.4rem">Source / further reading</div>
              <a href="${escapeHtml(art.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">📎 Open ${escapeHtml(art.sourceName)} →</a>
            </div>`:''}

          <div class="alert alert-info show" style="font-size:.73rem;margin-top:1rem">
            This article is for health education only and is not a diagnosis or individualized treatment recommendation.
          </div>

          ${isEditor?`<div class="divider"></div><div class="td-actions">
            <button class="btn btn-xs btn-info" ${bindAction('click',(event,element)=>{openArticleModal((art.id))})}>Edit Article</button>
            ${art.published
              ? `<button class="btn btn-xs btn-warning" ${bindAction('click',(event,element)=>{deleteArticle((art.id))})}>Unpublish</button>`
              : `<button class="btn btn-xs btn-success" ${bindAction('click',(event,element)=>{publishArticle((art.id))})}>Publish</button>`}
            ${appState.auth.currentUser.role==='Administrator'?`<button class="btn btn-xs btn-danger" ${bindAction('click',(event,element)=>{archiveArticle((art.id))})}>Archive</button>`:''}
          </div>`:''}
        </div>
      </div>
      <div class="modal-footer no-print">
        <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
        <button class="btn btn-info" ${bindAction('click',(event,element)=>{window.print()})}>🖨️ Print</button>
      </div>
    </div>`);
}

export function deleteArticle(id){
  const art=healthResourceRecords().find(r=>r.id===Number(id));if(!art)return;

  showConfirmDialog({
    title:'Unpublish Article',
    message:`Unpublish <strong>${escapeHtml(art.title)}</strong>? It will be hidden from normal Health Education views but kept in the database.`,
    confirmLabel:'Unpublish',
    danger:true,
    onConfirm:async()=>{
      try{
        if(art._realSupabase){
          await healthResourceAction({action:'unpublish',resource_id:art.dbResourceId});
          await syncRealHealthResources();
        }else{
          art.published=false;
          persistDB();
        }
        closeAllModals();
        toast('Article unpublished.','warning');
        renderArticlesList();
      }catch(e){toast(e?.message||'Unable to unpublish the article.','error');}
    }
  });
}

export async function publishArticle(id){
  const art=healthResourceRecords().find(r=>r.id===Number(id));if(!art)return;
  try{
    if(art._realSupabase){
      await healthResourceAction({action:'publish',resource_id:art.dbResourceId});
      await syncRealHealthResources();
    }else{
      art.published=true;
      persistDB();
    }
    closeAllModals();
    toast('Article published.','success');
    renderArticlesList();
  }catch(e){toast(e?.message||'Unable to publish the article.','error');}
}

export function archiveArticle(id){
  const art=healthResourceRecords().find(r=>r.id===Number(id));if(!art)return;
  showConfirmDialog({
    title:'Archive Health Article',
    message:`Archive <strong>${escapeHtml(art.title)}</strong>? It will be preserved in the database and removed from the active library.`,
    confirmLabel:'Archive',
    danger:true,
    onConfirm:async()=>{
      try{
        if(art._realSupabase){
          await healthResourceAction({action:'archive',resource_id:art.dbResourceId});
          await syncRealHealthResources();
        }
        closeAllModals();
        toast('Article archived.','success');
        renderArticlesList();
      }catch(e){toast(e?.message||'Unable to archive the article.','error');}
    }
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.navigationRaceProtection.campusNavigationToken=0;
  appState.navigationRaceProtection.campusActivePageId='dashboard';
  appState.navigationRaceProtection.historySession=0;
  // Back and Forward use the same renderer and race guard as sidebar navigation.
  window.addEventListener('popstate',event=>{
    if(!appState.auth.currentUser)return;
    const entry=event.state?.campuscareNavigation;
    if(entry?.account===navigationAccountKey()&&document.getElementById('nav-'+entry.page))navTo(entry.page,{historyMode:'pop'});
    else navTo('dashboard',{historyMode:'replace'});
  });
}

// ================================================================
// REPORT AN ISSUE / FEEDBACK — REAL SUPABASE TRACKING
// ================================================================
let reportIssuePhotoData=null;

function issueReportRecords(){
  if(currentUser?._realSupabase)return (DB.issueReports||[]).filter(r=>r._realSupabase);
  return DB.issueReports||[];
}

function issueDisplayId(r){
  const id=Number(r?.dbIssueId??r?.id??0);
  return String(id).padStart(6,'0');
}

function issueTypeBadge(type){
  const map={Bug:'badge-danger',Suggestion:'badge-info',Feedback:'badge-purple'};
  const icon={Bug:'🐞',Suggestion:'💡',Feedback:'💬'};
  return `<span class="badge ${map[type]||'badge-gray'}">${icon[type]||''} ${escapeHtml(type||'Report')}</span>`;
}

function issueStatusBadge(status){
  const map={Open:'badge-warning','In Review':'badge-info',Resolved:'badge-success',Dismissed:'badge-gray'};
  return `<span class="badge ${map[status]||'badge-gray'}">${escapeHtml(status||'Open')}</span>`;
}

function realIssueToUi(row,userMap,replyRows,screenshotUrl){
  const reporter=userMap.get(Number(row.reporter_id));
  return {
    id:1400000+Number(row.issue_id),
    dbIssueId:Number(row.issue_id),
    reporterId:100000+Number(row.reporter_id),
    dbReporterId:Number(row.reporter_id),
    reporterName:reporter?`${reporter.first_name||''} ${reporter.last_name||''}`.trim():'CampusCare user',
    reporterRole:reporter?.role||'User',
    type:row.issue_type||'Feedback',
    page:row.page_affected||'',
    description:row.description||'',
    photo:screenshotUrl||'',
    screenshotPath:row.screenshot_path||'',
    status:row.status||'Open',
    adminNote:row.admin_note||'',
    resolvedBy:row.resolved_by?100000+Number(row.resolved_by):null,
    resolvedAt:row.resolved_at||'',
    createdAt:row.created_at||'',
    updatedAt:row.updated_at||'',
    replies:replyRows
      .filter(r=>Number(r.issue_id)===Number(row.issue_id))
      .map(r=>{
        const author=userMap.get(Number(r.author_id));
        return {
          id:1450000+Number(r.reply_id),
          dbReplyId:Number(r.reply_id),
          authorId:100000+Number(r.author_id),
          dbAuthorId:Number(r.author_id),
          authorName:author?`${author.first_name||''} ${author.last_name||''}`.trim():'CampusCare user',
          authorRole:author?.role||'User',
          body:r.body||'',
          createdAt:r.created_at||''
        };
      }),
    _realSupabase:true
  };
}

async function syncRealIssueReports(){
  if(!currentUser?._realSupabase)return issueReportRecords();

  const {data:reports,error:reportErr}=await supabaseClient
    .from('issue_reports')
    .select('issue_id,reporter_id,issue_type,page_affected,description,screenshot_path,status,admin_note,resolved_by,resolved_at,created_at,updated_at')
    .order('created_at',{ascending:false});
  if(reportErr)throw reportErr;

  const issueIds=(reports||[]).map(r=>Number(r.issue_id));
  let replies=[];
  if(issueIds.length){
    const {data,error}=await supabaseClient
      .from('issue_replies')
      .select('reply_id,issue_id,author_id,body,created_at')
      .in('issue_id',issueIds)
      .order('created_at',{ascending:true});
    if(error)throw error;
    replies=data||[];
  }

  const userIds=[...new Set([
    ...(reports||[]).map(r=>Number(r.reporter_id)),
    ...replies.map(r=>Number(r.author_id))
  ].filter(Boolean))];

  const userMap=new Map();
  if(userIds.length){
    const {data:users,error:userErr}=await supabaseClient
      .from('users')
      .select('user_id,first_name,last_name,role')
      .in('user_id',userIds);
    if(userErr)throw userErr;
    (users||[]).forEach(u=>userMap.set(Number(u.user_id),u));
  }

  const signedUrls=new Map();
  await Promise.all((reports||[]).map(async row=>{
    if(!row.screenshot_path)return;
    const {data,error}=await supabaseClient.storage
      .from('campuscare-issue-screenshots')
      .createSignedUrl(row.screenshot_path,3600);
    if(!error&&data?.signedUrl)signedUrls.set(Number(row.issue_id),data.signedUrl);
  }));

  DB.issueReports=(DB.issueReports||[]).filter(r=>!r._realSupabase);
  DB.issueReports.push(...(reports||[]).map(row=>
    realIssueToUi(row,userMap,replies,signedUrls.get(Number(row.issue_id))||'')
  ));
  return issueReportRecords();
}

async function renderReportIssue(){
  const c=document.getElementById('app-content');if(!c)return;
  const pageToken=captureCampusPageToken();
  reportIssuePhotoData=null;

  if(currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncRealIssueReports();}
    catch(e){
      if(!isCampusPageCurrent('report-issue',pageToken))return;
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load your reports.')}</div>
        <button class="btn btn-sm" onclick="renderReportIssue()">Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('report-issue',pageToken))return;
  }

  const myReports=issueReportRecords()
    .filter(r=>r.reporterId===currentUser.id)
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));

  c.innerHTML=`
    <div class="card">
      <div class="card-header">
        <div>
          <h3>🐞 Report an Issue or Share Feedback</h3>
          <div class="tech-note">Reports are stored securely and can be followed as a conversation with CampusCare administrators.</div>
        </div>
      </div>
      <p class="text-muted" style="margin-bottom:.9rem">Spotted a bug, have a suggestion, or want to share feedback? Send it directly to the administrators. You can attach a screenshot if it helps explain the issue.</p>
      <div id="ri-msg"></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label>
          <select id="ri-type">
            <option value="Bug">🐞 Bug / Something's broken</option>
            <option value="Suggestion">💡 Suggestion / Feature idea</option>
            <option value="Feedback">💬 General feedback</option>
          </select>
        </div>
        <div class="form-group"><label>Page affected (optional)</label><input id="ri-page" maxlength="160" placeholder="e.g. Appointments, Messages"></div>
      </div>
      <div class="form-group"><label>Tell us what happened <span class="required">*</span></label><textarea id="ri-desc" maxlength="6000" rows="4" placeholder="Please describe the issue, suggestion, or feedback in as much detail as you can..."></textarea></div>
      <div class="form-group">
        <label>Attach a Screenshot / Photo (optional)</label>
        <div class="upload-area" onclick="document.getElementById('ri-photo-file').click()">
          <input type="file" id="ri-photo-file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleReportPhotoChange(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:22px;height:22px;margin:0 auto .4rem;display:block;color:#aaa"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          <p>Click to attach a screenshot</p>
        </div>
        <div id="ri-photo-preview" style="margin-top:.5rem"></div>
        <p class="form-note">JPG, PNG, or WebP · maximum 5 MB. Screenshots are stored in private CampusCare Storage.</p>
      </div>
      <button class="btn btn-primary btn-sm" id="ri-submit-btn" onclick="submitIssueReport()">Submit Report</button>
    </div>

    <div class="card">
      <div class="card-header"><h3>Your Past Reports</h3></div>
      ${myReports.length?`<div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Type</th><th>Page</th><th>Description</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>${myReports.map(r=>`<tr style="cursor:pointer" onclick="viewIssueThread(${r.id})">
          <td>#${issueDisplayId(r)}</td>
          <td>${issueTypeBadge(r.type)}</td>
          <td>${r.page?escapeHtml(r.page):'<span class="text-muted">—</span>'}</td>
          <td style="max-width:280px">${escapeHtml(r.description.substring(0,90))}${r.description.length>90?'…':''}</td>
          <td>${issueStatusBadge(r.status)}</td>
          <td>${fmtDate(r.createdAt)}</td>
          <td>${(r.replies||[]).length?`<span class="badge badge-info">💬 ${(r.replies||[]).length}</span>`:''}</td>
        </tr>`).join('')}</tbody>
      </table></div>`:'<p class="text-muted">You haven\'t submitted any reports yet.</p>'}
    </div>`;
}

async function handleReportPhotoChange(input){
  const file=input.files&&input.files[0];
  const preview=document.getElementById('ri-photo-preview');
  if(!file){
    reportIssuePhotoData=null;
    if(preview)preview.innerHTML='';
    return;
  }
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
    toast('Screenshot must be JPG, PNG, or WebP.','error');
    input.value='';
    return;
  }
  if(file.size>5*1024*1024){
    toast('Screenshot must be 5 MB or smaller.','error');
    input.value='';
    return;
  }

  try{
    const raw=await readFileAsDataURL(file);
    reportIssuePhotoData=await resizeImageDataUrl(raw,1200,0.82);
    if(preview)preview.innerHTML=`<img src="${reportIssuePhotoData}" style="max-width:180px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.15)">`;
  }catch(e){
    toast('Could not attach that photo. Please try again.','error');
  }
}

async function submitIssueReport(){
  const type=document.getElementById('ri-type').value;
  const page=document.getElementById('ri-page').value.trim();
  const description=document.getElementById('ri-desc').value.trim();
  const msg=document.getElementById('ri-msg');
  const btn=document.getElementById('ri-submit-btn');

  hideAlert(msg);
  if(!description){
    showAlert(msg,'Please describe the issue, suggestion, or feedback before submitting.');
    return;
  }

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Submitting securely…';}

  let uploadedPath='';
  try{
    if(currentUser?._realSupabase){
      const dbUserId=Number(currentUser.dbUserId);
      if(!dbUserId)throw new Error('Your CampusCare user record could not be identified.');

      if(reportIssuePhotoData){
        const response=await fetch(reportIssuePhotoData);
        const blob=await response.blob();
        const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
        uploadedPath=`${dbUserId}/${crypto.randomUUID()}.${ext}`;

        const {error:uploadErr}=await supabaseClient.storage
          .from('campuscare-issue-screenshots')
          .upload(uploadedPath,blob,{contentType:blob.type,upsert:false});
        if(uploadErr)throw uploadErr;
      }

      const {error}=await supabaseClient.from('issue_reports').insert({
        reporter_id:dbUserId,
        issue_type:type,
        page_affected:page||null,
        description,
        screenshot_path:uploadedPath||null,
        status:'Open'
      });
      if(error)throw error;

      await syncRealIssueReports();
      await updateNotifUI();
    }else{
      DB.issueReports=DB.issueReports||[];
      DB.nextIssueId=DB.nextIssueId||1;
      DB.issueReports.push({
        id:DB.nextIssueId++,reporterId:currentUser.id,type,page,description,
        photo:reportIssuePhotoData,status:'Open',adminNote:'',replies:[],createdAt:new Date().toISOString()
      });
      DB.users.filter(a=>a.role==='Administrator').forEach(a=>
        addNotif(a.id,`New ${type} Report`,`${currentUser.fname} ${currentUser.lname} submitted a ${type.toLowerCase()} report.`,'info')
      );
      persistDB();
    }

    await renderReportIssue();
    openModal(`<div class="modal modal-sm">
      <div class="modal-body" style="text-align:center;padding:2rem 1.5rem">
        <div style="width:60px;height:60px;border-radius:50%;background:var(--success-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-size:28px">🙏</div>
        <h3 style="margin-bottom:.5rem">Thank you for letting us know!</h3>
        <p style="font-size:.87rem;color:var(--ink-muted);line-height:1.6">Your ${type.toLowerCase()} report was sent to CampusCare administrators. You can return to this page to see its status and any replies.</p>
      </div>
      <div class="modal-footer" style="justify-content:center"><button class="btn btn-primary" onclick="closeAllModals()">Got it, thanks!</button></div>
    </div>`);
  }catch(e){
    if(uploadedPath){
      try{await supabaseClient.storage.from('campuscare-issue-screenshots').remove([uploadedPath]);}catch(_){}
    }
    showAlert(msg,e?.message||'Unable to submit your report.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||'Submit Report';
    }
  }
}

async function renderFeedbackIssues(){
  const c=document.getElementById('app-content');if(!c)return;
  const pageToken=captureCampusPageToken();

  if(currentUser.role!=='Administrator'){
    c.innerHTML='<div class="alert alert-danger show">Administrator access required.</div>';
    return;
  }

  if(currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{
      await Promise.all([syncAdminDirectoryFromSupabase(),syncRealIssueReports()]);
    }catch(e){
      if(!isCampusPageCurrent('feedback-issues',pageToken))return;
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load feedback and issue reports.')}</div>
        <button class="btn btn-sm" onclick="renderFeedbackIssues()">Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('feedback-issues',pageToken))return;
  }

  c.innerHTML=`
    <div class="card">
      <div class="card-header">
        <div><h3>Feedback &amp; Issue Tracking</h3><div class="tech-note">Review, reply to, and close reports submitted by CampusCare users.</div></div>
      </div>
      <div class="toolbar">
        <input id="fi-search" type="search" placeholder="Search reporter, page, or description..." oninput="renderFeedbackIssuesList()">
        <select id="fi-type" onchange="renderFeedbackIssuesList()">
          <option value="">All Types</option><option>Bug</option><option>Suggestion</option><option>Feedback</option>
        </select>
        <select id="fi-status" onchange="renderFeedbackIssuesList()">
          <option value="">All Statuses</option><option>Open</option><option>In Review</option><option>Resolved</option><option>Dismissed</option>
        </select>
      </div>
      <div id="fi-list"></div>
    </div>`;
  renderFeedbackIssuesList();
}

function renderFeedbackIssuesList(){
  const el=document.getElementById('fi-list');if(!el)return;
  const q=(document.getElementById('fi-search')?.value||'').trim().toLowerCase();
  const type=document.getElementById('fi-type')?.value||'';
  const status=document.getElementById('fi-status')?.value||'';

  let reports=issueReportRecords()
    .slice()
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));

  if(type)reports=reports.filter(r=>r.type===type);
  if(status)reports=reports.filter(r=>r.status===status);
  if(q)reports=reports.filter(r=>
    `${r.reporterName||''} ${r.page||''} ${r.description||''} ${r.type||''}`.toLowerCase().includes(q)
  );

  if(!reports.length){
    el.innerHTML='<div class="empty-state"><p>No reports match this filter.</p></div>';
    return;
  }

  el.innerHTML=reports.map(r=>{
    const user=getUserById(r.reporterId);
    const replyCount=(r.replies||[]).length;
    return `<div class="card" style="cursor:pointer;margin-bottom:.7rem" onclick="viewIssueThread(${r.id})">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem;flex-wrap:wrap">
        <div style="display:flex;gap:.6rem;align-items:center;min-width:0">
          ${user?userAvatarHtml(user,32):'<div class="sb-avatar" style="width:32px;height:32px;font-size:.7rem">?</div>'}
          <div style="min-width:0">
            <strong style="font-size:.85rem">${escapeHtml(r.reporterName||'CampusCare user')}</strong>
            <div class="text-muted" style="font-size:.72rem">#${issueDisplayId(r)} · ${fmtDate(r.createdAt)}${r.page?' · '+escapeHtml(r.page):''}${replyCount?` · 💬 ${replyCount}`:''}</div>
          </div>
        </div>
        <div style="display:flex;gap:.4rem;align-items:center">${issueTypeBadge(r.type)}${issueStatusBadge(r.status)}</div>
      </div>
      <p style="font-size:.85rem;margin:.7rem 0">${escapeHtml(r.description.substring(0,160))}${r.description.length>160?'…':''}</p>
      ${r.photo?`<img src="${r.photo}" style="max-width:140px;max-height:90px;object-fit:cover;border-radius:8px" onclick="event.stopPropagation();showFilePreview('Issue Screenshot','${r.photo}')">`:''}
    </div>`;
  }).join('');
}

function viewIssueThread(id){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  const isAdmin=currentUser.role==='Administrator';
  const reporter=getUserById(r.reporterId);
  const replies=r.replies||[];
  const canReply=isAdmin||!['Resolved','Dismissed'].includes(r.status);

  openModal(`<div class="modal modal-lg">
    <div class="modal-header"><h3>${issueTypeBadge(r.type)} Report #${issueDisplayId(r)}</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;flex-wrap:wrap;gap:.5rem">
        <div style="display:flex;align-items:center;gap:.5rem">
          ${reporter?userAvatarHtml(reporter,30):'<div class="sb-avatar" style="width:30px;height:30px;font-size:.68rem">?</div>'}
          <div>
            <strong style="font-size:.85rem">${escapeHtml(r.reporterName||'CampusCare user')}</strong>
            <div class="text-muted" style="font-size:.72rem">${escapeHtml(r.reporterRole||'User')} · ${new Date(r.createdAt).toLocaleString('en-PH')}${r.page?' · '+escapeHtml(r.page):''}</div>
          </div>
        </div>
        ${issueStatusBadge(r.status)}
      </div>

      <div class="card" style="background:var(--overlay);margin-bottom:.8rem">
        <p style="font-size:.85rem;white-space:pre-wrap">${escapeHtml(r.description)}</p>
        ${r.photo?`<img src="${r.photo}" style="max-width:100%;max-height:330px;object-fit:contain;border-radius:8px;cursor:pointer;margin-top:.5rem" onclick="showFilePreview('Issue Screenshot','${r.photo}')">`:''}
      </div>

      ${r.adminNote?`<div class="alert ${r.status==='Resolved'?'alert-success':'alert-info'} show" style="font-size:.78rem"><strong>Administrator note:</strong> ${escapeHtml(r.adminNote)}</div>`:''}

      <div id="issue-thread-replies" style="display:flex;flex-direction:column;gap:.6rem;margin-bottom:1rem;max-height:300px;overflow-y:auto">
        ${replies.length?replies.map(rp=>{
          const isAdminReply=rp.authorRole==='Administrator';
          return `<div style="align-self:${isAdminReply?'flex-end':'flex-start'};max-width:82%">
            <div style="background:${isAdminReply?'var(--primary-light)':'var(--overlay-strong)'};border-radius:12px;padding:.55rem .8rem;font-size:.82rem;white-space:pre-wrap">${escapeHtml(rp.body)}</div>
            <div class="text-muted" style="font-size:.68rem;margin-top:2px;text-align:${isAdminReply?'right':'left'}">${escapeHtml(rp.authorName||'CampusCare user')} · ${fmtShortTime(rp.createdAt)}</div>
          </div>`;
        }).join(''):'<p class="text-muted" style="font-size:.8rem">No replies yet.</p>'}
      </div>

      ${canReply?`<div class="form-group"><label>${isAdmin?'Reply to reporter':'Reply to administrators'}</label><textarea id="issue-reply-text" maxlength="3000" rows="2" placeholder="Write a reply..."></textarea></div>`:
        '<div class="alert alert-info show" style="font-size:.76rem">This report is closed. Its history remains available for reference.</div>'}

      ${isAdmin&&!['Resolved','Dismissed'].includes(r.status)?`<div class="td-actions" style="margin-bottom:.6rem">
        <button class="btn btn-xs btn-success" onclick="resolveIssueReport(${r.id})">Mark Resolved</button>
        <button class="btn btn-xs btn-warning" onclick="dismissIssueReport(${r.id})">Dismiss</button>
      </div>`:''}
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeAllModals()">Close</button>
      ${canReply?`<button class="btn btn-primary" id="issue-reply-btn" onclick="sendIssueReply(${r.id})">Send Reply</button>`:''}
    </div>
  </div>`);
}

async function sendIssueReply(id){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  const input=document.getElementById('issue-reply-text');
  const body=input?.value.trim()||'';
  const btn=document.getElementById('issue-reply-btn');
  if(!body){toast('Please write a reply first.','error');return;}

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Sending…';}

  try{
    if(r._realSupabase){
      const {error}=await supabaseClient.from('issue_replies').insert({
        issue_id:r.dbIssueId,
        author_id:Number(currentUser.dbUserId),
        body
      });
      if(error)throw error;
      await syncRealIssueReports();
      await updateNotifUI();
    }else{
      r.replies=r.replies||[];
      r.replies.push({
        authorId:currentUser.id,
        authorName:docName(currentUser),
        authorRole:currentUser.role,
        body,
        createdAt:new Date().toISOString()
      });
      if(currentUser.role==='Administrator'&&r.status==='Open')r.status='In Review';
      persistDB();
    }

    toast('Reply sent.','success');
    viewIssueThread(id);
    if(document.getElementById('fi-list'))renderFeedbackIssuesList();
  }catch(e){
    toast(e?.message||'Unable to send the reply.','error');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||'Send Reply';
    }
  }
}

function resolveIssueReport(id){
  openIssueDecisionModal(id,'Resolved');
}

function dismissIssueReport(id){
  openIssueDecisionModal(id,'Dismissed');
}

function openIssueDecisionModal(id,decision){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  const isResolve=decision==='Resolved';

  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>${isResolve?'Mark as Resolved':'⚠️ Dismiss Report'}</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <p style="font-size:.87rem;margin-bottom:.7rem">${isResolve?'Mark this report as resolved?':'Are you sure you want to dismiss this report?'} The reporter will be notified.</p>
      <div class="form-group"><label>Note for the reporter (optional)</label><textarea id="issue-decision-note" maxlength="3000" rows="2" placeholder="e.g. Fixed in the latest update. Thank you for reporting it."></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeAllModals()">Cancel</button>
      <button class="btn ${isResolve?'btn-success':'btn-danger'}" id="issue-decision-btn" onclick="confirmIssueDecision(${id},'${decision}')">${isResolve?'Mark Resolved':'Dismiss'}</button>
    </div>
  </div>`);
}

async function confirmIssueDecision(id,decision){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  const note=document.getElementById('issue-decision-note')?.value.trim()||'';
  const btn=document.getElementById('issue-decision-btn');
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Saving…';}

  try{
    if(r._realSupabase){
      const {error}=await supabaseClient.from('issue_reports').update({
        status:decision,
        admin_note:note||null,
        resolved_by:Number(currentUser.dbUserId),
        resolved_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq('issue_id',r.dbIssueId);
      if(error)throw error;

      await syncRealIssueReports();
      await updateNotifUI();
    }else{
      r.status=decision;
      r.adminNote=note;
      persistDB();
    }

    toast(decision==='Resolved'?'Marked as resolved.':'Report dismissed.',decision==='Resolved'?'success':'warning');
    closeAllModals();
    if(document.getElementById('fi-list'))renderFeedbackIssuesList();
  }catch(e){
    toast(e?.message||'Unable to update the report.','error');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||(decision==='Resolved'?'Mark Resolved':'Dismiss');
    }
  }
}

let articlePhotoData=null;
let articlePhotoRemove=false;
let articlePhotoExistingUrl='';

function openArticleModal(id=null) {
  const art=id?healthResourceRecords().find(r=>r.id===Number(id)):null;
  articlePhotoData=null;
  articlePhotoRemove=false;
  articlePhotoExistingUrl=art?.photo||'';

  const existingCategories=[...new Set(healthResourceRecords().map(r=>r.category).filter(Boolean))].sort();

  openModal(`
    <div class="modal modal-lg">
      <div class="modal-header"><h3>${art?'Edit':'Add'} Health Article</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
      <div class="modal-body">
        <div id="art-msg"></div>

        <div class="form-group"><label>Title <span class="required">*</span></label><input id="art-title" maxlength="255" value="${art?escapeHtml(art.title):''}" placeholder="A clear, headline-style title"></div>

        <div class="form-row">
          <div class="form-group">
            <label>Category <span class="required">*</span></label>
            <input id="art-category" maxlength="120" list="art-category-list" value="${art?escapeHtml(art.category||''):''}" placeholder="Type or pick a category">
            <datalist id="art-category-list">${existingCategories.map(cat=>`<option value="${escapeHtml(cat)}">`).join('')}</datalist>
          </div>
          <div class="form-group"><label>Icon (used if no photo)</label>
            <select id="art-icon">${['📰','🧘','🥗','💧','🩹','💉','😴','🛡️','🏃','❤️','🧠','🦷'].map(icon=>`<option ${art&&art.icon===icon?'selected':''}>${icon}</option>`).join('')}</select>
          </div>
        </div>

        <div class="form-group">
          <label>Banner Photo</label>
          <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
            <div id="art-photo-preview" style="width:120px;height:70px;border-radius:8px;overflow:hidden;background:var(--overlay);border:1px solid var(--glass-border-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              ${articlePhotoExistingUrl?`<img src="${articlePhotoExistingUrl}" style="width:100%;height:100%;object-fit:cover">`:'<span class="text-muted" style="font-size:.7rem">No photo</span>'}
            </div>
            <button type="button" class="btn btn-sm" onclick="document.getElementById('art-photo-file').click()">Upload Photo</button>
            <button type="button" class="btn btn-sm btn-info" onclick="openCamera('article')"><i class="bi bi-camera" aria-hidden="true"></i> Use Camera</button>
            ${(articlePhotoExistingUrl||articlePhotoData)?`<button type="button" class="btn btn-sm btn-danger" onclick="clearArticlePhoto()">Remove</button>`:''}
            <input type="file" id="art-photo-file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleArticlePhotoChange(this)">
          </div>
          <p class="form-note">Optional. Article images are stored in private CampusCare Storage and displayed through temporary signed links.</p>
        </div>

        <div class="form-group"><label>Teaser</label><input id="art-teaser" maxlength="1200" value="${art?escapeHtml(art.teaser||''):''}" placeholder="A short summary shown on the article card"></div>
        <div class="form-group"><label>Full Content <span class="required">*</span></label><textarea id="art-content" maxlength="20000" rows="8">${art?escapeHtml(art.content):''}</textarea></div>

        <div class="form-row">
          <div class="form-group"><label>Source Name (optional)</label><input id="art-source-name" maxlength="255" value="${art?escapeHtml(art.sourceName||''):''}" placeholder="e.g. WHO, DOH, U.S. CDC"></div>
          <div class="form-group"><label>Source URL (optional)</label><input id="art-source-url" maxlength="1500" value="${art?escapeHtml(art.sourceUrl||''):''}" placeholder="https://..."></div>
        </div>

        <div class="form-group"><label><input type="checkbox" id="art-published" ${art?(art.published?'checked':''):'checked'}> Publish immediately</label></div>
      </div>

      <div class="modal-footer">
        <button class="btn" onclick="closeAllModals()">Cancel</button>
        <button class="btn btn-primary" id="art-save-btn" onclick="saveArticle(${id||'null'})">Save Article</button>
      </div>
    </div>`);
}

async function handleArticlePhotoChange(input){
  const file=input.files?.[0];if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
    toast('Article photo must be JPG, PNG, or WebP.','error');
    return;
  }
  if(file.size>5*1024*1024){
    toast('Article photo must be 5 MB or smaller.','error');
    return;
  }

  try{
    const raw=await readFileAsDataURL(file);
    articlePhotoData=await resizeImageDataUrl(raw,1200,0.82);
    articlePhotoRemove=false;
    const preview=document.getElementById('art-photo-preview');
    if(preview)preview.innerHTML=`<img src="${articlePhotoData}" style="width:100%;height:100%;object-fit:cover">`;
  }catch(e){
    toast('Could not attach that photo. Please try again.','error');
  }
}

function clearArticlePhoto(){
  articlePhotoData=null;
  articlePhotoExistingUrl='';
  articlePhotoRemove=true;
  const preview=document.getElementById('art-photo-preview');
  if(preview)preview.innerHTML='<span class="text-muted" style="font-size:.7rem">No photo</span>';
}

async function saveArticle(id){
  const title=document.getElementById('art-title').value.trim();
  const category=document.getElementById('art-category').value.trim();
  const icon=document.getElementById('art-icon').value;
  const teaser=document.getElementById('art-teaser').value.trim();
  const content=document.getElementById('art-content').value.trim();
  const sourceName=document.getElementById('art-source-name').value.trim();
  let sourceUrl=document.getElementById('art-source-url').value.trim();
  const published=document.getElementById('art-published').checked;
  const msg=document.getElementById('art-msg');
  const btn=document.getElementById('art-save-btn');

  hideAlert(msg);
  if(!title||!content){showAlert(msg,'Title and content are required.');return;}
  if(!category){showAlert(msg,'Please enter a category.');return;}
  if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl))sourceUrl='https://'+sourceUrl;

  const art=id?healthResourceRecords().find(r=>r.id===Number(id)):null;
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Saving securely…';}

  try{
    if(currentUser?._realSupabase){
      const result=await healthResourceAction({
        action:art?'update':'create',
        resource_id:art?.dbResourceId||null,
        title,category,icon,teaser,content,
        source_name:sourceName,
        source_url:sourceUrl,
        published,
        image_data_url:articlePhotoData||null,
        remove_image:articlePhotoRemove
      });

      await syncRealHealthResources();
    }else if(art){
      Object.assign(art,{
        title,category,icon,teaser,content,sourceName,sourceUrl,published,
        photo:articlePhotoRemove?'':(articlePhotoData||art.photo||'')
      });
      persistDB();
    }else{
      DB.healthResources.push({
        id:DB.nextResourceId++,
        title,category,icon,teaser,content,sourceName,sourceUrl,
        photo:articlePhotoData||'',
        authorId:currentUser.id,
        createdAt:TODAY,
        published
      });
      persistDB();
    }

    closeAllModals();
    toast(art?'Article updated.':'Article added.','success');
    await renderHealthEducation();
  }catch(e){
    showAlert(msg,e?.message||'Unable to save the article.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||'Save Article';
    }
  }
}


// Helper to escape HTML (prevent XSS)
// Safely embed user-supplied text as a single-quoted JS string literal
// inside an onclick="..." HTML attribute (prevents both breaking out of
// the string and breaking out of the attribute).
function jsAttrSafe(s){
  return String(s==null?'':s)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\n/g,' ');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
    return c;
  });
}
function getUserName(id) {
  const u = DB.users.find(u => u.id === id);
  return u ? `${u.fname} ${u.lname}` : 'System';
}

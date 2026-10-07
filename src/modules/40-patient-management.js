// ================================================================
// PATIENTS PAGE (Staff/Admin)
// ================================================================
async function renderPatients(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(currentUser?._realSupabase&&['Administrator','Staff'].includes(currentUser.role)){
    showDatabaseSkeleton('table');
    try{
      await Promise.all([
        syncAdminDirectoryFromSupabase(),
        syncRealWorkflowRequests()
      ]);
    }
    catch(e){
      if(!isCampusPageCurrent('patients',pageToken))return;
      console.error(e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load patient records.')}</div>
        <button class="btn btn-sm" onclick="renderPatients()">Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('patients',pageToken))return;
  }
  const canEdit=currentUser.role==='Administrator'||currentUser.role==='Staff';
  c.innerHTML=`
    <div class="toolbar">
      <input type="text" placeholder="Search by name, ID..." id="pt-search" oninput="renderPatientTable()">
      <select id="pt-college" onchange="renderPatientTable()">
        <option value="">All Colleges</option>
        ${['CCICT','COE','COED','CME','CAS','COT'].map(col=>`<option value="${col}">${col}</option>`).join('')}
      </select>
      <select id="pt-ptype" onchange="renderPatientTable()">
        <option value="">All Types</option>
        <option>Student</option><option>Teaching Personnel</option><option>Non-Teaching Personnel</option>
      </select>
      <select id="pt-status" onchange="renderPatientTable()">
        <option value="active">Active Records</option>
        <option value="archived">Archived Records</option>
        <option value="all">All Records</option>
      </select>
      ${canEdit?`<button class="btn btn-primary btn-sm" onclick="openPatientModal()">+ Add Patient</button>`:''}
    </div>
    <div class="card"><div id="pt-table"></div></div>`;
  renderPatientTable();
}

function patientAvatarHtml(pt,size=36){
  const user=pt.userId?getUserById(pt.userId):null;
  const photo=(user&&user.profilePhoto)||pt.profilePhoto||'';
  const initials=((pt.fname?.[0]||'')+(pt.lname?.[0]||'')).toUpperCase()||'P';
  if(photo){
    return `<div style="width:${size}px;height:${size}px;position:relative;flex-shrink:0">
      <img src="${escapeHtml(photo)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;cursor:pointer;display:block"
        onclick="event.stopPropagation();showFilePreview('${jsAttrSafe(pt.fname)} ${jsAttrSafe(pt.lname)} - Photo','${jsAttrSafe(photo)}')"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
        title="Click to view full size">
      <div class="sb-avatar" style="display:none;width:${size}px;height:${size}px;font-size:${Math.round(size*0.34)}px;position:absolute;inset:0;cursor:pointer"
        onclick="event.stopPropagation();viewPatient(${pt.id})">${initials}</div>
    </div>`;
  }
  return `<div class="sb-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.34)}px;flex-shrink:0;cursor:pointer"
    onclick="event.stopPropagation();viewPatient(${pt.id})" title="No photo on file — click to view patient record">${initials}</div>`;
}

function renderPatientTable(){
  const q=(document.getElementById('pt-search')||{}).value||'';
  const col=(document.getElementById('pt-college')||{}).value||'';
  const ptype=(document.getElementById('pt-ptype')||{}).value||'';
  const status=(document.getElementById('pt-status')||{}).value||'active';
  const sourcePatients=currentUser?._realSupabase
    ? DB.patients.filter(p=>p._realSupabase)
    : DB.patients;
  let pts=sourcePatients.filter(p=>{
    const name=`${p.fname} ${p.lname} ${p.idNo}`.toLowerCase();
    const matchStatus=status==='all'||(status==='archived'?!!p.archived:!p.archived);
    return (!q||name.includes(q.toLowerCase()))&&(!col||p.college===col)&&(!ptype||p.personType===ptype)&&matchStatus;
  });
  const el=document.getElementById('pt-table');
  if(!el)return;
  const canEdit=currentUser.role==='Administrator'||currentUser.role==='Staff';
  if(!pts.length){el.innerHTML='<div class="empty-state"><p>No patients found.</p></div>';return;}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Photo</th><th>ID</th><th>Name</th><th>Age</th><th>College</th><th>Type</th><th>Blood</th><th>Contact</th><th>Actions</th></tr></thead><tbody>${
    pts.map(p=>`<tr ${p.archived?'style="opacity:.6;cursor:pointer"':'style="cursor:pointer"'} onclick="viewPatient(${p.id})" title="Click to view patient record">
      <td>${patientAvatarHtml(p,34)}</td>
      <td><strong>P-${patientDisplayId(p)}</strong><br><span class="text-muted">${escapeHtml(p.idNo||'—')}</span></td>
      <td><strong>${p.fname} ${p.lname}</strong>${p.archived?' <span class="badge badge-gray">Archived</span>':''}</td>
      <td>${p.age}</td><td>${collegeBadge(p.college)}</td>
      <td>${priorityBadge(p.personType)}</td><td>${p.blood||'-'}</td><td>${p.contact||'-'}</td>
      <td><div class="td-actions" onclick="event.stopPropagation()">
        <button class="btn btn-xs" onclick="viewPatient(${p.id})">View</button>
        ${canEdit&&!p.archived?`<button class="btn btn-xs btn-info" onclick="openPatientModal(${p.id})">Edit</button>`:''}
        ${currentUser.role==='Administrator'?(p.archived?`<button class="btn btn-xs btn-success" onclick="restorePatient(${p.id})">Restore</button>`:`<button class="btn btn-xs btn-warning" onclick="archivePatient(${p.id})">🗄️ Archive</button>`):''}
      </div></td>
    </tr>`).join('')
  }</tbody></table></div>`;
}

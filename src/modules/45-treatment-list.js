// ================================================================
// TREATMENTS
// ================================================================
async function renderTreatments(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();

  if(currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncTreatmentContext();}
    catch(e){
      if(!isCampusPageCurrent('treatments',pageToken))return;
      console.error('Treatments sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load treatment records.')}</div>
        <button class="btn btn-sm" onclick="renderTreatments()">Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('treatments',pageToken))return;
  }

  const canAdd=currentUser.role==='Doctor'||currentUser.role==='Administrator';
  c.innerHTML=`
    <div class="toolbar">
      <input type="text" placeholder="Search patient, diagnosis..." id="tr-search" oninput="renderTreatTable()">
      <select id="tr-college" onchange="renderTreatTable()">
        <option value="">All Colleges</option>
        ${['CCICT','COE','COED','CME','CAS','COT'].map(col=>`<option value="${col}">${col}</option>`).join('')}
      </select>
      <select id="tr-status" onchange="renderTreatTable()">
        <option value="active">Active Records</option>
        <option value="archived">Archived Records</option>
        <option value="all">All Records</option>
      </select>
      ${canAdd?`<button class="btn btn-primary btn-sm" onclick="openAddTreatmentModalPt(null)">+ Add Treatment</button>`:''}
    </div>
    <div class="card"><div id="treat-table"></div></div>`;
  renderTreatTable();
}

function renderTreatTable(){
  const q=((document.getElementById('tr-search')||{}).value||'').toLowerCase();
  const col=(document.getElementById('tr-college')||{}).value||'';
  const status=(document.getElementById('tr-status')||{}).value||'active';
  const role=currentUser.role;

  let treats=treatmentRecords().filter(t=>{
    const pt=getPatientById(t.patientId);
    const name=pt?`${pt.fname} ${pt.lname}`.toLowerCase():'';
    const matchQ=!q||name.includes(q)||String(t.diagnosis||'').toLowerCase().includes(q);
    const matchC=!col||(pt&&pt.college===col);
    const matchDoc=role!=='Doctor'||t.doctorId===currentUser.id;
    const matchStatus=status==='all'||(status==='archived'?!!t.archived:!t.archived);
    return matchQ&&matchC&&matchDoc&&matchStatus;
  }).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.id-a.id);

  const el=document.getElementById('treat-table');
  if(!el)return;
  if(!treats.length){
    el.innerHTML='<div class="empty-state"><p>No treatment records.</p></div>';
    return;
  }

  el.innerHTML=`<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Patient</th><th>College</th><th>Diagnosis</th><th>Doctor</th><th>Date</th><th>Follow-up</th><th>Actions</th></tr></thead>
    <tbody>${treats.map(t=>{
      const pt=getPatientById(t.patientId);
      const doc=getUserById(t.doctorId);
      return `<tr ${t.archived?'style="opacity:.67"':''}>
        <td>#${treatmentDisplayId(t)}${t.archived?'<br><span class="badge badge-gray">Archived</span>':''}</td>
        <td>${pt?`<button class="link-btn" onclick="viewPatient(${pt.id})">${escapeHtml(pt.fname+' '+pt.lname)}</button>`:'Unknown'}</td>
        <td>${collegeBadge(pt?.college||'')}</td>
        <td>${escapeHtml(t.diagnosis)}</td>
        <td>${doc?escapeHtml(docName(doc)):'Doctor'}</td>
        <td>${fmtDate(t.date)}</td>
        <td>${t.followupDate?fmtDate(t.followupDate):'—'}</td>
        <td><div class="td-actions">
          <button class="btn btn-xs" onclick="viewTreatment(${t.id})">View</button>
          ${currentUser.role==='Administrator'
            ? (t.archived
              ? `<button class="btn btn-xs btn-success" onclick="restoreTreat(${t.id})">Restore</button>`
              : `<button class="btn btn-xs btn-warning" onclick="archiveTreat(${t.id})">Archive</button>`)
            : ''}
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

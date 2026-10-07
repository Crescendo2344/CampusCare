// ================================================================
// EMERGING TECHNOLOGY ENGINE
// 1. Clinical Copilot — real Supabase-backed, explainable decision support
// 2. Predictive Campus Health Analytics
// 3. Predictive Inventory
// 4. FHIR R4-style interoperability export
// ================================================================

// ---------- Predictive Campus Health Analytics ----------
function healthAnalyticsAnchorDate(){
  const clinicalDates=[
    ...DB.treatments.map(t=>t.date),
    ...appointmentRecords().filter(a=>a.status==='Completed').map(a=>a.date)
  ].filter(Boolean).sort();
  // Use today's date when there is recent data. For old demo datasets, anchor
  // on the most recent clinical event so the prototype still demonstrates
  // the analytics honestly instead of manufacturing current cases.
  const latest=clinicalDates[clinicalDates.length-1]||TODAY;
  const days=Math.abs((new Date(TODAY+'T12:00:00')-new Date(latest+'T12:00:00'))/86400000);
  return {date:days<=45?TODAY:latest,isHistorical:days>45};
}

function extractHealthSignals(record){
  const source=[
    record.reason,record.notes,record.findings,record.diagnosis,record.prescription,record.service
  ].filter(Boolean).join(' ').toLowerCase();
  const defs=[
    ['Fever / flu-like',['fever','flu','influenza','febrile']],
    ['Respiratory',['urti','cough','cold','sore throat','pharyngeal','respiratory']],
    ['Headache / dizziness',['headache','migraine','dizziness','dizzy']],
    ['Dental',['tooth','dental','caries','molar','extraction','gum']],
    ['Gastrointestinal',['stomach','abdominal','diarrhea','vomit','nausea']],
    ['Injury / wound',['injury','wound','sprain','cut','bruise']]
  ];
  return defs.filter(([,keys])=>keys.some(k=>source.includes(k))).map(([label])=>label);
}

function computeCampusHealthAnalytics(windowDays=7){
  const anchorInfo=healthAnalyticsAnchorDate();
  const anchor=anchorInfo.date;
  const currentFrom=isoDateOffset(anchor,-(windowDays-1));
  const prevTo=isoDateOffset(currentFrom,-1);
  const prevFrom=isoDateOffset(prevTo,-(windowDays-1));

  const clinical=treatmentRecords().filter(t=>!t.archived).map(t=>{
    const pt=getPatientById(t.patientId)||{};
    return {...t,_kind:'Treatment',college:pt.college||'',signals:extractHealthSignals(t)};
  });
  const current=clinical.filter(x=>x.date>=currentFrom&&x.date<=anchor);
  const previous=clinical.filter(x=>x.date>=prevFrom&&x.date<=prevTo);

  const countSignals=list=>{
    const m={};list.forEach(x=>x.signals.forEach(s=>m[s]=(m[s]||0)+1));return m;
  };
  const currSignals=countSignals(current),prevSignals=countSignals(previous);
  const allSignals=[...new Set([...Object.keys(currSignals),...Object.keys(prevSignals)])];

  const signalRows=allSignals.map(name=>{
    const now=currSignals[name]||0,before=prevSignals[name]||0;
    const growth=before===0?(now>0?100:0):Math.round(((now-before)/before)*100);
    return {name,now,before,growth};
  }).sort((a,b)=>b.now-a.now||b.growth-a.growth);

  const diagnosisCount={};
  current.forEach(t=>{
    const d=(t.diagnosis||'Unspecified').trim();
    diagnosisCount[d]=(diagnosisCount[d]||0)+1;
  });
  const topDiagnosis=Object.entries(diagnosisCount).sort((a,b)=>b[1]-a[1])[0]||null;

  const collegeCount={};
  current.forEach(t=>{const c=t.college||'Unknown';collegeCount[c]=(collegeCount[c]||0)+1;});
  const topCollege=Object.entries(collegeCount).sort((a,b)=>b[1]-a[1])[0]||null;

  const prevCount=previous.length;
  const visitGrowth=prevCount===0?(current.length?100:0):Math.round(((current.length-prevCount)/prevCount)*100);

  // Conservative alerting: a trend needs at least 2 current records.
  // This intentionally says "trend" rather than "outbreak".
  const alerts=signalRows.filter(r=>r.now>=2&&r.growth>=50).map(r=>({
    severity:r.growth>=100?'high':'medium',
    title:`${r.name} trend increased`,
    detail:`${r.now} related clinical record${r.now===1?'':'s'} in the current ${windowDays}-day window (${r.growth>=0?'+':''}${r.growth}% vs the previous window).`
  }));

  return {
    anchor,anchorInfo,currentFrom,prevFrom,prevTo,windowDays,current,previous,
    signalRows,topDiagnosis,topCollege,visitGrowth,alerts
  };
}


// Uses the exact Reports & Analytics From/To range and compares it with the
// immediately preceding range of the same length.
function computeCampusHealthAnalyticsRange(dateFrom,dateTo){
  const from=dateFrom||TODAY.substring(0,7)+'-01',to=dateTo||TODAY;
  const fromD=new Date(from+'T12:00:00'),toD=new Date(to+'T12:00:00');
  const spanDays=Math.max(1,Math.round((toD-fromD)/86400000)+1);
  const prevTo=isoDateOffset(from,-1),prevFrom=isoDateOffset(prevTo,-(spanDays-1));
  const clinical=treatmentRecords().filter(t=>!t.archived).map(t=>{const pt=getPatientById(t.patientId)||{};return {...t,college:pt.college||'',signals:extractHealthSignals(t)};});
  const current=clinical.filter(x=>x.date>=from&&x.date<=to),previous=clinical.filter(x=>x.date>=prevFrom&&x.date<=prevTo);
  const countSignals=list=>{const m={};list.forEach(x=>x.signals.forEach(s=>m[s]=(m[s]||0)+1));return m;};
  const curr=countSignals(current),prev=countSignals(previous),names=[...new Set([...Object.keys(curr),...Object.keys(prev)])];
  const signalRows=names.map(name=>{const now=curr[name]||0,before=prev[name]||0;const growth=before===0?(now>0?100:0):Math.round(((now-before)/before)*100);return {name,now,before,growth};}).sort((a,b)=>b.now-a.now||b.growth-a.growth);
  const collegeCount={};current.forEach(t=>{const c=t.college||'Unknown';collegeCount[c]=(collegeCount[c]||0)+1;});
  const topCollege=Object.entries(collegeCount).sort((a,b)=>b[1]-a[1])[0]||null;
  const visitGrowth=previous.length===0?(current.length?100:0):Math.round(((current.length-previous.length)/previous.length)*100);
  const alerts=signalRows.filter(r=>r.now>=2&&r.growth>=50).map(r=>({severity:r.growth>=100?'high':'medium',title:`${r.name} trend increased`,detail:`${r.now} related clinical record${r.now===1?'':'s'} in the selected range (${r.growth>=0?'+':''}${r.growth}% vs the preceding ${spanDays}-day range).`}));
  return {currentFrom:from,anchor:to,prevFrom,prevTo,spanDays,current,previous,signalRows,topCollege,visitGrowth,alerts};
}

function renderHealthIntelligenceCard(dateFrom,dateTo){
  const a=computeCampusHealthAnalyticsRange(dateFrom,dateTo);
  const topSignal=a.signalRows[0],growthTone=a.visitGrowth>30?'text-danger':a.visitGrowth>0?'text-warning':'text-success';
  return `<div class="card">
    <div class="card-header">
      <div><h3>Campus Health Intelligence</h3><div class="tech-note">Predictive trend detection from clinical records — not an outbreak diagnosis.</div></div>
      <button class="btn btn-sm" type="button" onclick="openReportDateRange()"><i class="bi bi-calendar3"></i> ${fmtDate(a.currentFrom)} – ${fmtDate(a.anchor)}</button>
    </div>
    <div class="intel-grid">
      <div class="intel-card"><div class="intel-kicker">Clinical records</div><div class="intel-value">${a.current.length}</div><div class="intel-meta">${fmtDate(a.currentFrom)} – ${fmtDate(a.anchor)}</div></div>
      <div class="intel-card"><div class="intel-kicker">Period change</div><div class="intel-value ${growthTone}">${a.visitGrowth>=0?'+':''}${a.visitGrowth}%</div><div class="intel-meta">Compared with the previous ${a.spanDays}-day range</div></div>
      <div class="intel-card"><div class="intel-kicker">Top signal</div><div class="intel-value" style="font-size:.95rem">${topSignal?escapeHtml(topSignal.name):'No signal'}</div><div class="intel-meta">${topSignal?`${topSignal.now} matching record${topSignal.now===1?'':'s'}`:'More data is needed'}</div></div>
      <div class="intel-card"><div class="intel-kicker">Most active college</div><div class="intel-value">${a.topCollege?escapeHtml(a.topCollege[0]):'—'}</div><div class="intel-meta">${a.topCollege?`${a.topCollege[1]} clinical record${a.topCollege[1]===1?'':'s'}`:'No records in range'}</div></div>
    </div>
    <div class="section-label">Health trend alerts</div>
    <div class="intel-alert-list">${a.alerts.length?a.alerts.map(x=>`<div class="intel-alert-item"><div class="intel-alert-icon">${x.severity==='high'?'⚠️':'📈'}</div><div class="intel-alert-copy"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.detail)}</span></div></div>`).join(''):`<div class="intel-alert-item"><div class="intel-alert-icon">✓</div><div class="intel-alert-copy"><strong>No unusual cluster detected</strong><span>The detector did not find a signal meeting the review threshold for the selected date range.</span></div></div>`}</div>
    <div class="tech-note" style="margin-top:.65rem">The comparison automatically uses the immediately preceding range with the same number of days.</div>
  </div>`;
}
async function refreshHealthIntelligence(){
  const from=document.getElementById('rpt-from')?.value||TODAY.substring(0,7)+'-01';
  const to=document.getElementById('rpt-to')?.value||TODAY;
  const college=document.getElementById('rpt-college')?.value||'';
  const el=document.getElementById('health-intelligence-wrap');
  if(!el)return;

  if(!currentUser?._realSupabase){
    el.innerHTML=renderHealthIntelligenceCard(from,to);
    return;
  }

  el.innerHTML=databaseSkeletonHtml('cards',4);
  try{
    const summary=await fetchAnalyticsSummary(from,to,college);
    if(campusActivePageId!=='reports')return;
    el.innerHTML=renderLiveAnalyticsCard(summary);
  }catch(e){
    if(campusActivePageId!=='reports')return;
    el.innerHTML=`<div class="card"><div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to refresh analytics.')}</div>
      <button class="btn btn-sm" onclick="refreshHealthIntelligence()">Retry</button></div>`;
  }
}

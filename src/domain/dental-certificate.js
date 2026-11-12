// Dental certificate content is derived from a patient's dental records; it depends only on the supplied treatments.
const byRecency=(a,b)=>String(a.dentalRecord?.recordDate||a.date||'').localeCompare(String(b.dentalRecord?.recordDate||b.date||''))||Number(a.id)-Number(b.id);

// Teeth keep the latest mark they were given, oral health, work status and recommendation come from the most recent record,
// and every operation recorded across visits is listed once.
export function dentalHistorySummary(treatments=[]){
  const records=treatments.filter(t=>t?.dentalRecord&&!t.archived).sort(byRecency);
  const summary={hasRecord:records.length>0,odontogram:{},oral:{},operations:[],workStatus:'',recommendation:'',courseMajor:'',yearSection:'',cellNo:'',messengerAccount:'',recordDate:''};
  const seen=new Set();
  for(const t of records){
    const d=t.dentalRecord;
    Object.assign(summary.odontogram,d.odontogram||{});
    for(const op of Array.isArray(d.accomplishment)?d.accomplishment:[]){
      const key=`${op.tooth_no||''}|${op.nature||''}`.toLowerCase();
      if(seen.has(key))continue;
      seen.add(key);summary.operations.push({tooth_no:op.tooth_no||'',nature:op.nature||''});
    }
    summary.oral=d.oralHealth||{};
    summary.workStatus=d.workStatus||'';
    summary.recommendation=d.recommendation||'';
    summary.recordDate=d.recordDate||t.date||'';
    for(const key of ['courseMajor','yearSection','cellNo','messengerAccount'])if(d[key])summary[key]=d[key];
  }
  return summary;
}

// Text for the certificate's "Tooth No. / Nature of Operation" lines.
export function accomplishmentText(operations=[]){
  return operations.map(op=>[op.tooth_no,op.nature].filter(Boolean).join(' – ')).join('; ');
}

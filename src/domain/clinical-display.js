// Presentation helpers for the Clinical Copilot and FHIR preview; no clinical inference happens here.

const SOAP_KEYS=['S','O','A','P'];
// Split a "S: … O: … A: … P: …" draft into its four sections; null when the text is not in that shape.
export function splitSoapNote(text){
  const sections={S:'',O:'',A:'',P:''};
  let current=null,found=0;
  for(const line of String(text||'').split(/\r?\n/)){
    const match=line.match(/^\s*([SOAP])\s*:\s?(.*)$/);
    if(match&&SOAP_KEYS.includes(match[1])&&!sections[match[1]]){current=match[1];found++;sections[current]=match[2];continue;}
    if(current)sections[current]+=(sections[current]?'\n':'')+line;
  }
  if(found<2)return null;
  for(const key of SOAP_KEYS)sections[key]=sections[key].trim();
  return sections;
}
export function joinSoapNote(sections){
  return SOAP_KEYS.map(key=>`${key}: ${String(sections[key]||'').trim()}`).join('\n');
}

const firstText=(...values)=>values.find(value=>typeof value==='string'&&value.trim())||'';
// One readable line per FHIR resource, plus counts per resource type, for a human-facing summary.
export function summarizeFhirBundle(bundle){
  const resources=(bundle?.entry||[]).map(entry=>entry?.resource).filter(Boolean);
  const counts={};
  const rows=resources.map(resource=>{
    const type=resource.resourceType||'Resource';
    counts[type]=(counts[type]||0)+1;
    const name=resource.name?.[0];
    const detail=type==='Patient'
      ? [name?.given?.join(' '),name?.family].filter(Boolean).join(' ')
      : firstText(resource.code?.text,resource.medicationCodeableConcept?.text,resource.serviceType?.[0]?.text,resource.type?.text,resource.description,resource.class?.display);
    const date=String(firstText(resource.recordedDate,resource.authoredOn,resource.effectiveDateTime,resource.start,resource.period?.start,resource.date)||'').slice(0,10);
    return {type,id:resource.id||'',detail:detail||'—',status:firstText(resource.status,resource.clinicalStatus?.text),date};
  });
  return {total:resources.length,counts:Object.entries(counts).map(([type,count])=>({type,count})),rows};
}

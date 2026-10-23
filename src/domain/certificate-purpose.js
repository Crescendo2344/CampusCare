// Medical certificates are issued by the examining doctor for three purposes only. Each purpose
// collects the facts the receiving office needs and turns them into one certifying statement.
export const CERTIFICATE_PURPOSES=['OJT / Internship Requirement','Excused Absence','Sports / Athletics Participation'];
export const FITNESS_OPTIONS=['Fit','Fit with restrictions'];

const long=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
const days=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/864e5)+1;

export function certificateDetailErrors(purpose,fields={},today){
  const errors={};
  if(!CERTIFICATE_PURPOSES.includes(purpose))errors.purpose='Choose one of the three certificate purposes.';
  if(purpose==='Excused Absence'){
    const {absentFrom:from='',absentTo:to=''}=fields;
    if(!from)errors.absentFrom='Enter the first day of absence.';
    if(!to)errors.absentTo='Enter the last day of absence.';
    if(from&&to&&to<from)errors.absentTo='The last day cannot be before the first day.';
    else if(from&&to&&days(from,to)>30)errors.absentTo='A single certificate covers at most 30 days.';
    if(from&&today&&days(today,from)>8)errors.absentFrom='Rest can start at most 7 days from today.';
  }
  if(purpose==='OJT / Internship Requirement'||purpose==='Sports / Athletics Participation'){
    if(!FITNESS_OPTIONS.includes(fields.fitness))errors.fitness='Choose the fitness result.';
    if(fields.fitness==='Fit with restrictions'&&String(fields.restrictions||'').trim().length<3)errors.restrictions='Describe the restrictions.';
  }
  if(purpose==='Sports / Athletics Participation'&&String(fields.event||'').trim().length<2)errors.event='Enter the sport or event.';
  return errors;
}

// The certifying sentence printed on the certificate, and a short summary for lists.
export function certificateStatement(purpose,fields={}){
  const restrictions=fields.fitness==='Fit with restrictions'&&fields.restrictions?`, with the following restrictions: ${String(fields.restrictions).trim()}`:'';
  if(purpose==='Excused Absence'){
    const span=fields.absentFrom===fields.absentTo?`on ${long(fields.absentFrom)}`:`from ${long(fields.absentFrom)} to ${long(fields.absentTo)}`;
    return {statement:`was advised to rest and was unable to attend classes or work ${span} (${days(fields.absentFrom,fields.absentTo)} day${days(fields.absentFrom,fields.absentTo)===1?'':'s'}).`,
      summary:fields.absentFrom===fields.absentTo?`Absent ${fields.absentFrom}`:`Absent ${fields.absentFrom} to ${fields.absentTo}`};
  }
  if(purpose==='OJT / Internship Requirement')return {statement:`is physically fit to undergo on-the-job training or internship${restrictions}.`,summary:fields.fitness||''};
  if(purpose==='Sports / Athletics Participation'){
    const event=String(fields.event||'').trim();
    return {statement:`is physically fit to participate in ${event}${restrictions}.`,summary:`${event} · ${fields.fitness||''}`};
  }
  return {statement:'',summary:''};
}

// Adapt already-authorized application snapshots. No extra patient data is requested.
import {state} from '../app/state.js';
import {inventoryRecords,inventoryTransactionRecords} from '../domain/inventory-records.js';
import {clinicalVisitEvents,isoDay} from '../domain/report-analysis.js';
export function reportData(){
  const account=state.auth.currentUser;
  const db=state.reports.snapshotAccount===account?state.reports.snapshot:state.data.DB;
  const real=row=>!account?._realSupabase||row._realSupabase;
  const own=row=>account?.role!=='Doctor'||row.doctorId===account.id;
  const appointments=(db.appointments||[]).filter(real).filter(own),treatments=(db.treatments||[]).filter(real).filter(own);
  const allowed=new Set([...appointments,...treatments].map(r=>r.patientId));
  const allPatients=db.patients.filter(p=>real(p)&&(account?.role!=='Doctor'||allowed.has(p.id)));
  const patients=allPatients.filter(p=>!p.archived);
  // Archived patients still supply historical demographics for their earlier visits.
  const patientMap=new Map(allPatients.map(p=>[p.id,p]));
  const users=new Map(db.users.filter(real).map(u=>[u.id,u]));
  const name=p=>p?[p.fname,p.lname].filter(Boolean).join(' '):'Not recorded';
  const appointmentMap=new Map(appointments.map(a=>[a.id,a]));
  const decorate=row=>{
    const p=patientMap.get(row.patientId)||{},doctor=users.get(row.doctorId);
    return {...row,clinic:row.clinic||appointmentMap.get(row.appointmentId)?.clinic||'Not recorded',date:isoDay(row.date),patient:name(patientMap.get(row.patientId)),college:row.college||p.college||'Not recorded',personType:p.personType||'Not recorded',classSession:p.classSession||'Not recorded',sex:p.gender||'Not recorded',doctor:name(doctor)};
  };
  const stock=['Administrator','Staff'].includes(account?.role)?inventoryRecords(db,account).filter(i=>!i.archived):[];
  return {
    appointments:appointments.filter(a=>!a.archived).map(decorate),treatments:treatments.filter(t=>!t.archived).map(decorate),
    patients:patients.map(p=>({id:p.dbPatientId||p.id,patientId:p.id,patient:name(p),college:p.college,personType:p.personType,classSession:p.classSession,sex:p.gender,blood:p.blood})),
    inventory:stock.map(i=>({...i,item:i.name,stock:i.qty<=i.threshold?'Low stock':'Available',value:Number(i.qty||0)*Number(i.unitCost||0)})),
    visits:clinicalVisitEvents(appointments,treatments).map(decorate),
    consumption:stock.filter(i=>i.category==='Medicine').map(i=>({item:i,events:inventoryTransactionRecords(db,account).filter(t=>t.itemId===i.id&&t.type==='Disbursement').map(t=>({date:isoDay(t.date),amount:Math.abs(Number(t.qty||0))}))}))
  };
}

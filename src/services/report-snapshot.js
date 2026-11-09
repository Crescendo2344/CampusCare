import {normalizeSupabaseUser,directoryRowToPatient} from '../domain/patient-records.js';
import {realAppointmentToUi} from '../domain/appointment-records.js';
import {realTreatmentToUi} from '../domain/treatment-records.js';
import {realInventoryToUi,realInventoryTransactionToUi} from '../domain/inventory-records.js';
// Read every authorized page in stable primary-key order. A failed page rejects
// the whole snapshot rather than silently forecasting from a truncated history.
export async function readReportPages(client,table,columns,key,pageSize=500){
  const rows=[];
  for(let start=0;;start+=pageSize){
    const {data,error}=await client.from(table).select(columns).order(key,{ascending:true}).range(start,start+pageSize-1);
    if(error)throw error;
    rows.push(...(data||[]));
    if(!data||data.length<pageSize)return rows;
  }
}
// Administrators and staff do not read visit notes; their reports use the de-identified treatment facts.
export async function readTreatmentFactPages(client,pageSize=500){
  const rows=[];
  for(let start=0;;start+=pageSize){
    const {data,error}=await client.rpc('report_treatment_facts').range(start,start+pageSize-1);
    if(error)throw error;
    rows.push(...(data||[]));
    if(!data||data.length<pageSize)return rows;
  }
}
export async function loadReportSnapshot(client,role){
  if(!['Administrator','Staff','Doctor'].includes(role))throw new Error('Clinical reports access required.');
  const stockAccess=['Administrator','Staff'].includes(role);
  const [users,patients,appointments,treatments,inventory,transactions]=await Promise.all([
    readReportPages(client,'users','user_id,first_name,last_name,role,person_type,college','user_id'),
    readReportPages(client,'patients','patient_id,user_id,class_session,sex,blood_type,archived_at','patient_id'),
    readReportPages(client,'appointments','appointment_id,patient_id,doctor_id,clinic,service,appointment_date,appointment_time,status','appointment_id'),
    stockAccess?readTreatmentFactPages(client):readReportPages(client,'treatments','treatment_id,patient_id,doctor_id,appointment_id,diagnosis,treatment_date,status,archived_at','treatment_id'),
    stockAccess?readReportPages(client,'inventory_items','item_id,item_name,category,quantity,threshold,unit,unit_cost,archived','item_id'):[],
    stockAccess?readReportPages(client,'inventory_transactions','transaction_id,item_id,transaction_type,quantity,transaction_date','transaction_id'):[]
  ]);
  const userMap=new Map(users.map(u=>[Number(u.user_id),u]));
  const db={users:users.map(normalizeSupabaseUser),patients:patients.map(p=>directoryRowToPatient({...userMap.get(Number(p.user_id)),user_id:p.user_id,patient:p}))};
  return {...db,appointments:appointments.map(a=>realAppointmentToUi(a,db)),treatments:treatments.map(realTreatmentToUi),inventory:inventory.map(realInventoryToUi),inventoryTransactions:transactions.map(realInventoryTransactionToUi)};
}

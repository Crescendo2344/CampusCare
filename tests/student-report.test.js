// Synthetic fixtures verify unique students, clinical evidence and combined filter semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildStudentReport} from '../src/domain/student-report.js';
const filters={from:'2026-10-01',to:'2026-10-14'};
const user=(id,college='CCICT')=>({user_id:id,first_name:'Student',last_name:String(id),id_number:'ID'+id,role:'Patient',person_type:'Student',college,status:'Active',verified:true,created_at:'2026-09-01'});
const data={users:[user(1),user(2),user(3,'COE'),user(4),{...user(5),created_at:'2026-11-01'},{...user(6),person_type:'Teaching Personnel'}],patients:[{patient_id:11,user_id:1,class_session:'Morning',sex:'Female',birth_date:'2005-10-15'},{patient_id:12,user_id:2,class_session:'Evening'},{patient_id:13,user_id:3}],appointments:[{appointment_id:101,patient_id:11,clinic:'Dental Clinic',appointment_date:'2026-10-02',status:'Completed'},{appointment_id:102,patient_id:12,clinic:'Dental Clinic',appointment_date:'2026-10-02',status:'Pending'},{appointment_id:103,patient_id:13,clinic:'Dental Clinic',appointment_date:'2026-09-02',status:'Completed'}],treatments:[{treatment_id:201,patient_id:11,appointment_id:101,treatment_date:'2026-10-02',status:'Active'}],dentalRecords:[{treatment_id:201,patient_id:11,record_date:'2026-10-02'}]};
test('completed dental booking, treatment and dental chart count once; pending is not care',()=>{
 const r=buildStudentReport(data,filters);assert.equal(r.registered,4);assert.equal(r.dentalUsed,1);assert.equal(r.dentalNotUsed,2);assert.equal(r.unknownCoverage,1);assert.equal(r.rows.find(x=>x.userId===1).dentalVisits,1);assert.equal(r.rows.find(x=>x.userId===1).age,20);
});
test('class session, college, sex, verification and age combine without guessing unknowns',()=>{
 const r=buildStudentReport(data,{...filters,college:'CCICT',classSession:'Morning',sex:'Female',verified:'yes',minAge:20,maxAge:20});assert.deepEqual(r.rows.map(x=>x.userId),[1]);
 assert.deepEqual(buildStudentReport(data,{...filters,classSession:'Unknown'}).rows.map(x=>x.userId),[4,3]);
});
test('no-use filter preserves college registration denominator; unknown coverage is separate',()=>{
 const r=buildStudentReport(data,{...filters,college:'CCICT',dental:'not'});assert.deepEqual(r.rows.map(x=>x.userId),[2]);assert.equal(r.colleges[0].registered,3);assert.equal(r.colleges[0].unknownCoverage,1);
});
test('all-history and selected-period coverage differ; new registrations are a separate cohort',()=>{
 assert.equal(buildStudentReport(data,{...filters,history:'all'}).dentalUsed,2);
 assert.equal(buildStudentReport(data,{...filters,registration:'range'}).registered,0);
});
test('archived and non-student accounts never inflate default student counts',()=>{
 const archived={...data,users:data.users.map(x=>x.user_id===1?{...x,status:'Archived'}:x)};
 assert.equal(buildStudentReport(archived,filters).registered,3);assert.equal(buildStudentReport(archived,{...filters,archive:'all'}).registered,4);
});
test('invalid dates, ages and enum values fail explicitly; shared server code stays identical',()=>{
 assert.throws(()=>buildStudentReport(data,{...filters,from:'2026-02-30'}),/calendar/);
 assert.throws(()=>buildStudentReport(data,{...filters,minAge:30,maxAge:20}),/age/);
 assert.throws(()=>buildStudentReport(data,{...filters,history:'invalid'}),/filter/);
 assert.equal(readFileSync('src/domain/student-report.js','utf8'),readFileSync('supabase/functions/student-reports/student-report.js','utf8'));
});

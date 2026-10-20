import test from 'node:test';
import assert from 'node:assert/strict';
import {filterReportRows,groupReportRows,clinicalVisitEvents,buildForecast,validDay} from '../src/domain/report-analysis.js';
const range={from:'2026-01-01',to:'2026-01-14'};
test('combined report filters honor inclusive dates and exact demographic choices',()=>{
 const rows=[{date:'2026-01-01',college:'COE',classSession:'Morning',status:'Completed'},{date:'2026-01-14',college:'COE',classSession:'Evening',status:'Completed'},{date:'2026-01-15',college:'COE',classSession:'Morning',status:'Completed'}];
 assert.equal(filterReportRows(rows,'appointments',{...range,college:'COE',classSession:'Morning',status:'Completed'}).length,1);
 assert.equal(filterReportRows(rows,'appointments',{...range}).length,2);
 assert.equal(filterReportRows(rows,'patients',{...range}).length,3,'Snapshots are explicitly independent of activity dates');
 assert.throws(()=>filterReportRows(rows,'appointments',{from:'2026-02-30',to:'2026-03-01'}),/valid/);
 assert.equal(validDay('2026-02-29'),false);
});
test('two-dimensional aggregation preserves unique patients per group and numeric stock value',()=>{
 const rows=[{college:'COE',clinic:'Medical',patientId:1},{college:'COE',clinic:'Medical',patientId:1},{college:'COE',clinic:'Dental',patientId:1},{college:'CCICT',clinic:'Dental',patientId:2}];
 assert.deepEqual(groupReportRows(rows,{group:'college',split:'clinic',measure:'patients'}),[{group:'CCICT',split:'Dental',value:1},{group:'COE',split:'Dental',value:1},{group:'COE',split:'Medical',value:1}]);
 assert.equal(groupReportRows([{category:'Medicine',value:20},{category:'Medicine',value:30}],{group:'category',measure:'value'})[0].value,50);
 assert.deepEqual(groupReportRows([{date:'2026-01-04'},{date:'2026-01-05'}],{group:'week'}).map(r=>r.group),['2025-12-29','2026-01-05']);
});
test('linked completed bookings are counted once while standalone treatment visits remain',()=>{
 const events=clinicalVisitEvents([{id:1,status:'Completed'},{id:2,status:'Cancelled'}],[{id:3,appointmentId:1},{id:4},{id:5,archived:true},{id:6,appointmentId:9},{id:7,appointmentId:9}]);
 assert.equal(events.length,3);
});
test('forecast learns only from selected past dates, includes zero days, and starts tomorrow',()=>{
 const events=[{date:'2025-12-31',amount:999},{date:'2026-01-01',amount:7},{date:'2026-01-07',amount:7},{date:'2026-01-14',amount:14},{date:'2026-01-15',amount:999}];
 const f=buildForecast(events,{...range,today:'2026-02-01',weeks:4,method:'average'});
 assert.equal(f.total,28);assert.equal(f.days,14);assert.equal(f.records,3);assert.equal(f.dailyAverage,2);assert.equal(f.projected,56);
 assert.equal(f.rows[0].start,'2026-02-02');assert.equal(f.rows.at(-1).end,'2026-03-01');
 const changed=buildForecast(events,{from:'2026-01-01',to:'2026-01-15',today:'2026-02-01',weeks:8,method:'average'});
 assert.equal(changed.total,1027);assert.equal(changed.rows.length,8);
});
test('weekday method divides by occurrences, handles leap dates, and rejects invalid or thin history',()=>{
 const events=[{date:'2024-02-12',amount:7},{date:'2024-02-19',amount:7},{date:'2024-02-26',amount:7}];
 const f=buildForecast(events,{from:'2024-02-12',to:'2024-03-03',today:'2024-03-03',weeks:4,method:'weekday'});
 assert.equal(f.projected,28);assert.equal(f.rows[0].amount,7);
 assert.match(buildForecast([],{...range,today:'2026-02-01'}).reason,/14 days/);
 assert.throws(()=>buildForecast([],{...range,today:'2026-01-01'}),/today/);
 assert.throws(()=>buildForecast([],{...range,today:'2026-02-01',weeks:100}),/supported/);
 assert.throws(()=>buildForecast([],{from:'2026-01-20',to:'2026-01-01',today:'2026-02-01'}),/valid/);
});

test('report history pagination reads beyond one API page and propagates later failures',async()=>{
 const {readReportPages,loadReportSnapshot}=await import('../src/services/report-snapshot.js');
 const calls=[],client={from(table){return{select(columns){return this;},order(key){calls.push([table,key]);return this;},async range(from,to){calls.push([from,to]);return {data:from===0?[{id:1},{id:2}]:[{id:3}]};}};}};
 assert.equal((await readReportPages(client,'treatments','id','id',2)).length,3);
 assert.deepEqual(calls,[['treatments','id'],[0,1],['treatments','id'],[2,3]]);
 const failed={from(){return{select(){return this;},order(){return this;},async range(from){return from===0?{data:[1,2]}:{error:new Error('History page unavailable')};}};}};
 await assert.rejects(readReportPages(failed,'table','id','id',2),/History page unavailable/);
 await assert.rejects(loadReportSnapshot(client,'Patient'),/access required/);
});

test('report snapshot isolates doctors, excludes demo rows, and retains archived-patient visit demographics',async()=>{
 const {state}=await import('../src/app/state.js');
 const {reportData}=await import('../src/reports/report-data.js');
 const saved={auth:state.auth.currentUser,reports:{...state.reports}};
 const account={id:1,role:'Doctor',_realSupabase:true};state.auth.currentUser=account;
 state.reports.snapshotAccount=account;
 state.reports.snapshot={users:[],patients:[{id:10,college:'COE',archived:true,_realSupabase:true},{id:11,college:'CAS',_realSupabase:true}],appointments:[{id:1,patientId:10,doctorId:1,date:'2026-01-01',status:'Completed',_realSupabase:true},{id:2,patientId:11,doctorId:2,date:'2026-01-01',status:'Completed',_realSupabase:true},{id:3,doctorId:1,date:'2026-01-01',status:'Completed'}],treatments:[],inventory:[{id:4,_realSupabase:true}],inventoryTransactions:[]};
 try{
   const data=reportData();assert.equal(data.appointments.length,1);assert.equal(data.appointments[0].college,'COE');assert.equal(data.patients.length,0);assert.equal(data.inventory.length,0);assert.equal(data.visits.length,1);
 }finally{state.auth.currentUser=saved.auth;Object.keys(state.reports).forEach(k=>delete state.reports[k]);Object.assign(state.reports,saved.reports);}
});

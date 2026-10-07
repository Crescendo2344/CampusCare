// Run the production JavaScript against the assembled HTML without contacting live services.
const fs=require('fs'),path=require('path'),assert=require('assert');const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');let html=fs.readFileSync(root+'/dist/index.html','utf8');
const scripts=[];html=html.replace(/<script([^>]*)src="([^"]+)"([^>]*)><\/script>/g,(full,before,src,after)=>{if(src.startsWith('https:'))return '';const code=fs.readFileSync(root+'/dist'+src,'utf8');if((before+after).includes('type="module"')){scripts.push(code);return '';}return '<script>'+code.replace(/<\/script/gi,'<\\/script')+'</script>';});
html=html.replace('</body>',()=>'<script>'+scripts.join('\n').replace(/<\/script/gi,'<\\/script')+'</script></body>');
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html,{
 url:'https://campuscare.test/',runScripts:'dangerously',virtualConsole:vc,pretendToBeVisual:true,
 beforeParse(w){
  w.scrollTo=()=>{};
  w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});
  w.fetch=async()=>{throw Error('Network disabled for test')};
  w.supabase={createClient:()=>({auth:{
   getSession:async()=>({data:{session:null}}),
   onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
  }})};
 }
});
const w=dom.window;
// The legacy DOM adapter still uses the independent sanitizer and preserves the cursor.
function checkInputAdapter(){
  const input=w.document.createElement('input');input.type='text';input.value='12a3';input.setSelectionRange(4,4);
  w.sanitizeInput(input,'phone');assert.equal(input.value,'123');assert.equal(input.selectionStart,3);
  assert.equal(w.fmtTime('17:15'),'5:15 PM');assert.equal(w.genId('PT',7),'PT-0007');
  assert(w.statusBadge('Pending').includes('badge-warning'));
}

// Exercise the inventory adapter with a fake client and restore all application state.
async function checkInventoryAdapter(){
  const client=w.supabaseClient,user=w.currentUser;
  const saved={inventory:w.DB.inventory,inventoryTransactions:w.DB.inventoryTransactions,
    disbursements:w.DB.disbursements,inventoryForecasts:w.DB.inventoryForecasts};
  let queries=0;
  w.supabaseClient={from(table){queries++;return {select(){return this;},order(){return Promise.resolve({data:table==='inventory_items'?[{item_id:42,item_name:'Test Gauze',quantity:5}]:[]});}};}};
  try{
    w.currentUser={role:'Patient',_realSupabase:true};assert.equal((await w.syncRealInventory()).length,0);assert.equal(queries,0);
    w.currentUser={role:'Staff',_realSupabase:true};const items=await w.syncRealInventory();
    assert.equal(queries,3);assert.equal(items.length,1);assert.equal(items[0].dbItemId,42);
    assert.equal(items[0].qty,5);assert.equal(w.inventoryDisplayId(items[0]),'000042');
  }finally{w.supabaseClient=client;w.currentUser=user;Object.assign(w.DB,saved);}
}
// Exercise appointment state adapters with fake directory and query responses.
async function checkAppointmentAdapter(){
  const client=w.supabaseClient,user=w.currentUser,request=w.fetch;
  const saved={appointments:w.DB.appointments,doctorLeaves:w.DB.doctorLeaves,users:w.DB.users};
  const overrides=w.DB.settings.slotOverrides;let queries=0;
  w.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})},from(table){
    queries++;return {select(){return this;},order(){return this;},then(resolve,reject){
      const data=table==='appointments'?[{appointment_id:77,patient_id:4,doctor_id:2,status:'Confirmed'}]:table==='doctor_leaves'?[{leave_id:8,doctor_id:2,leave_date:'2026-10-09'}]:[{doctor_id:2,override_date:'2026-10-08',slot_time:'12:00:00',is_available:true}];
      return Promise.resolve({data}).then(resolve,reject);
    }};
  }};
  w.fetch=async()=>({ok:true,json:async()=>({ok:true,doctors:[{user_id:2,first_name:'Test',last_name:'Doctor'}]})});
  try{
    w.currentUser={role:'Patient',_realSupabase:false};assert.equal((await w.syncRealAppointments()).length,0);assert.equal(queries,0);
    w.currentUser={role:'Patient',_realSupabase:true};await w.syncRealDoctorDirectory();
    assert(w.DB.users.some(u=>u.dbUserId===2&&u._realDoctorDirectory));
    const rows=await w.syncRealAppointments();assert.equal(queries,3);assert.equal(rows.length,1);
    assert.equal(rows[0].dbAppointmentId,77);assert.equal(rows[0].status,'Scheduled');assert.equal(w.appointmentDisplayId(rows[0]),'000077');
    assert.equal(w.DB.settings.slotOverrides[0].availableTimes.join(','),'12:00');
    assert(w.DB.doctorLeaves.some(l=>l.dbLeaveId===8));
  }finally{w.supabaseClient=client;w.currentUser=user;w.fetch=request;Object.assign(w.DB,saved);w.DB.settings.slotOverrides=overrides;}
}
// Verify treatment-context ordering and dental attachment with synthetic records only.
async function checkTreatmentAdapter(){
  const client=w.supabaseClient,user=w.currentUser,patient=w.currentPatient,request=w.fetch;
  const saved={treatments:w.DB.treatments,medReminders:w.DB.medReminders,users:w.DB.users};
  const queries=[];
  w.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})},from(table){
    queries.push(table);return {select(){return this;},order(){return this;},then(resolve,reject){
      const data=table==='treatments'?[{treatment_id:7,patient_id:4,doctor_id:2}]:table==='dental_records'?[{dental_record_id:8,treatment_id:7,patient_id:4,dentist_user_id:2}]:[{reminder_id:9,patient_id:4,active:true,times_of_day:['08:00']}];
      return Promise.resolve({data}).then(resolve,reject);
    }};
  }};
  w.fetch=async()=>({ok:true,json:async()=>({ok:true,doctors:[{user_id:2}]})});
  try{
    w.currentUser={role:'Patient',_realSupabase:false};await w.syncRealTreatments();await w.syncRealDentalRecords();await w.syncRealMedicationReminders();assert.equal(queries.length,0);
    w.currentUser={role:'Patient',_realSupabase:true};w.currentPatient={_realSupabase:true};await w.syncTreatmentContext();
    assert.equal(queries.join(','),'treatments,medication_reminders,dental_records');
    const rows=w.treatmentRecords();assert.equal(rows.length,1);assert.equal(w.treatmentDisplayId(rows[0]),'000007');
    assert.equal(rows[0].dentalRecord.id,8);assert.equal(rows[0].dentalRecord.treatmentId,rows[0].id);
    const existing=rows[0];await w.syncRealDentalRecords();assert.equal(w.treatmentRecords()[0],existing);
    assert(w.DB.medReminders.some(r=>r.dbReminderId===9&&r.status==='active'));
  }finally{w.supabaseClient=client;w.currentUser=user;w.currentPatient=patient;w.fetch=request;Object.assign(w.DB,saved);}
}
// Verify the directory adapters moved out of the early session bootstrap.
async function checkPatientAdapter(){
  const client=w.supabaseClient,user=w.currentUser,patient=w.currentPatient;
  const saved={users:w.DB.users,patients:w.DB.patients};const queries=[];
  const rows={users:[{user_id:2,auth_user_id:'test-auth',first_name:'Test',last_name:'Staff',role:'Staff',profile_image_url:'test-photo'}],patients:[{patient_id:4,user_id:2,height_cm:160}]};
  w.supabaseClient={storage:{from(){return {createSignedUrl:async()=>({data:{signedUrl:'https://photo.test/test'}})};}},from(table){
    queries.push(table);return {select(){return this;},order(){return this;},eq(){return this;},maybeSingle:async()=>({data:rows.patients[0]}),then(resolve,reject){return Promise.resolve({data:rows[table]}).then(resolve,reject);}};
  }};
  try{
    w.currentUser={role:'Patient',id:100002,dbUserId:2,_realSupabase:true};assert.equal((await w.fetchAdminDirectory()).length,0);await w.syncAdminDirectoryFromSupabase();assert.equal(queries.length,0);
    await w.syncCurrentPatientFromSupabase();assert.equal(w.currentPatient.dbPatientId,4);assert.equal(w.patientDisplayId(w.currentPatient),'000004');assert.equal(w.currentPatient.height,'160cm');
    const account={role:'Staff',authUserId:'test-auth',id:100002,dbUserId:2,_realSupabase:true};w.currentUser=account;
    await w.syncAdminDirectoryFromSupabase();assert.equal(w.currentUser,account);assert.equal(account.fname,'Test');assert.equal(account.profilePhoto,'https://photo.test/test');
    assert(w.DB.patients.some(p=>p.dbPatientId===4&&p.userId===100002));
    const count=queries.length;await w.syncCurrentPatientFromSupabase();assert.equal(queries.length,count);
    assert.equal(typeof w.normalizeSupabaseUser,'function');assert.equal(typeof w.syncCampusCareSessionUI,'function');
  }finally{w.supabaseClient=client;w.currentUser=user;w.currentPatient=patient;Object.assign(w.DB,saved);}
}
// Test unread badges and read actions against a fake notification-center endpoint.
async function checkNotificationAdapter(){
  const client=w.supabaseClient,user=w.currentUser,request=w.fetch,notifications=w.DB.notifications;
  const counts=w.navTaskCounts,items=w.navTaskItems,seen=w.navTaskSeen;
  let rows=[{notification_id:7,user_id:2,title:'Test notice',action_page:'patient-messages',is_read:false},{notification_id:8,user_id:2,title:'Other notice',action_page:'my-messages',is_read:false}];
  const calls=[];
  w.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})}};
  w.fetch=async(url,options)=>{
    const payload=JSON.parse(options.body);calls.push(payload);
    if(payload.action==='read')rows.find(n=>n.notification_id===payload.notification_id).is_read=true;
    if(payload.action==='read_all')rows.forEach(n=>n.is_read=true);
    return {ok:true,json:async()=>({ok:true,notifications:rows})};
  };
  try{
    w.currentUser={...w.DB.users.find(u=>u.role==='Staff'),id:100002,_realSupabase:true};
    w.navTaskCounts={};w.navTaskItems={};w.navTaskSeen={};w.buildNav();
    await w.updateNotifUI();assert.equal(w.document.getElementById('notif-count').textContent,'2');
    assert.equal(w.document.querySelector('#nav-messages .nav-badge').textContent,'2');
    assert.equal(w.document.querySelectorAll('#notif-list .unread').length,2);
    const total=w.DB.notifications.length;w.addNotif(w.currentUser.id,'Test','Test');assert.equal(w.DB.notifications.length,total);
    await w.readNotif(1100007);assert(calls.some(c=>c.action==='read'&&c.notification_id===7));
    assert.equal(w.document.getElementById('notif-count').textContent,'1');assert.equal(w.document.querySelector('#nav-messages .nav-badge').textContent,'1');
    await w.markAllRead();assert(calls.some(c=>c.action==='read_all'));
    assert.equal(w.document.getElementById('notif-count').hidden,true);assert.equal(w.document.querySelector('#nav-messages .nav-badge'),null);
    rows=Array.from({length:101},(_,i)=>({notification_id:100+i,user_id:2,action_page:'messages',is_read:false}));await w.updateNotifUI();
    assert.equal(w.document.getElementById('notif-count').textContent,'99+');assert.equal(w.document.querySelector('#nav-messages .nav-badge').textContent,'99+');
  }finally{w.supabaseClient=client;w.currentUser=user;w.fetch=request;w.DB.notifications=notifications;w.navTaskCounts=counts;w.navTaskItems=items;w.navTaskSeen=seen;}
}
// Verify certificate refresh, failure recovery and actions through the production adapters.
async function checkCertificateAdapter(){
  const client=w.supabaseClient,user=w.currentUser,patient=w.currentPatient,request=w.fetch,certificates=w.DB.certRequests;
  let queries=0,failure=false;const actions=[];
  const demo={id:11,patientId:4};
  w.DB.certRequests=[demo,{id:700001,_realSupabase:true}];
  w.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})},from(table){
    assert.equal(table,'medical_certificates');queries++;
    return {select(){return this;},order(){return this;},then(resolve,reject){return Promise.resolve(failure?{error:new Error('Test certificate failure')}:{data:[{certificate_id:7,patient_id:4,status:'Issued',certificate_no:'CTU-MC-2025-000007',document_content:'<p>Test document</p>'}]}).then(resolve,reject);}};
  }};
  w.fetch=async(url,options)=>{assert(url.endsWith('/certificate-actions'));actions.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};};
  try{
    w.currentUser={role:'Patient',_realSupabase:false};assert.equal((await w.syncRealCertificates()).length,2);assert.equal(queries,0);
    w.currentUser={role:'Patient',_realSupabase:true};w.currentPatient={_realSupabase:true};await w.syncCertificateContext();
    assert.equal(queries,1);assert.equal(w.DB.certRequests[0],demo);const rows=w.certificateRecords();assert.equal(rows.length,1);
    assert.equal(w.certificateDisplayId(rows[0]),'000007');assert.equal(w.certificateNumberFor(rows[0]),'CTU-MC-2025-000007');assert.equal(rows[0].documentHtml,'<p>Test document</p>');
    const snapshot=w.DB.certRequests;failure=true;await assert.rejects(w.syncRealCertificates(),/Test certificate failure/);assert.equal(w.DB.certRequests,snapshot);
    await w.certificateAction({action:'request',purpose:'Test purpose'});assert.equal(actions[0].purpose,'Test purpose');
  }finally{w.supabaseClient=client;w.currentUser=user;w.currentPatient=patient;w.fetch=request;w.DB.certRequests=certificates;}
}
(async()=>{await new Promise(r=>setTimeout(r,150));console.log('startup errors',errors);assert.deepEqual(errors,[]);assert.equal(typeof w.buildNav,'function');checkInputAdapter();assert.equal(w.CAMPUSCARE_APP_URL,'https://campuscare.test');await checkInventoryAdapter();await checkAppointmentAdapter();await checkTreatmentAdapter();await checkPatientAdapter();await checkNotificationAdapter();await checkCertificateAdapter();
w.currentUser=w.DB.users.find(u=>u.role==='Doctor');w.buildNav();w.navTo('dashboard');assert(w.document.querySelector('#nav-schedule'));assert(!w.document.querySelector('#nav-task-center'));
w.openScheduleChangeRequest();await new Promise(r=>setTimeout(r,30));assert(w.document.querySelector('[data-campus-draft]'));w.captureCampusDraft('schedule');w.closeAllModals();w.openScheduleChangeRequest();await new Promise(r=>setTimeout(r,30));assert(w.document.querySelector('[data-campus-resume]'));w.restoreCampusDraft('schedule');assert.equal(w.document.querySelectorAll('.scr-day:checked').length,5);
assert.equal(w.appointmentSlotBaseTimes({startTime:'08:00',endTime:'09:15',slotDuration:60}).join(','),'08:00');assert(w.validateSchedule({...w.canonicalSchedule(w.currentUser),slotDuration:0},w.clinicToday(),w.currentUser).includes('Slot duration'));
w.closeAllModals();w.currentUser=w.DB.users.find(u=>u.role==='Administrator');w.buildNav();w.navTaskCounts={approvals:2};w.navTaskItems={approvals:['one','two']};w.navTaskSeen={};w.applyNavBadges();assert(w.document.querySelector('#nav-approvals .nav-badge'));assert.equal(w.unseenTaskCount('approvals'),2);
for(const user of w.DB.users.filter(x=>['Patient','Doctor','Staff','Administrator'].includes(x.role)).slice(0,6)){w.currentUser=user;w.currentPatient=w.DB.patients.find(p=>p.userId===user.id)||w.DB.patients[0];w.buildNav();w.navTo('dashboard');}
assert.deepEqual(errors,[]);
// Every inline handler still resolves after Vite minifies function names.
const handlerCalls=new Set();for(const el of w.document.querySelectorAll('*'))for(const a of el.attributes)if(/^on/.test(a.name))for(const m of a.value.matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\(/g))handlerCalls.add(m[1]);const missing=[...handlerCalls].filter(n=>!['if','Number','String','parseInt','setTimeout','alert','confirm'].includes(n)&&typeof w[n]!=='function');assert.deepEqual(missing,[]);
console.log('PASS: production bundle startup, runtime bindings, role dashboards, sidebar badges, draft actions, schedule validation, slot boundaries, inline handlers and deployment-origin redirects');w.close();})().catch(e=>{console.error(e);w.close();process.exitCode=1;});

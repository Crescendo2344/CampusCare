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
(async()=>{await new Promise(r=>setTimeout(r,150));console.log('startup errors',errors);assert.deepEqual(errors,[]);assert.equal(typeof w.buildNav,'function');checkInputAdapter();assert.equal(w.CAMPUSCARE_APP_URL,'https://campuscare.test');await checkInventoryAdapter();await checkAppointmentAdapter();
w.currentUser=w.DB.users.find(u=>u.role==='Doctor');w.buildNav();w.navTo('dashboard');assert(w.document.querySelector('#nav-schedule'));assert(!w.document.querySelector('#nav-task-center'));
w.openScheduleChangeRequest();await new Promise(r=>setTimeout(r,30));assert(w.document.querySelector('[data-campus-draft]'));w.captureCampusDraft('schedule');w.closeAllModals();w.openScheduleChangeRequest();await new Promise(r=>setTimeout(r,30));assert(w.document.querySelector('[data-campus-resume]'));w.restoreCampusDraft('schedule');assert.equal(w.document.querySelectorAll('.scr-day:checked').length,5);
assert.equal(w.appointmentSlotBaseTimes({startTime:'08:00',endTime:'09:15',slotDuration:60}).join(','),'08:00');assert(w.validateSchedule({...w.canonicalSchedule(w.currentUser),slotDuration:0},w.clinicToday(),w.currentUser).includes('Slot duration'));
w.closeAllModals();w.currentUser=w.DB.users.find(u=>u.role==='Administrator');w.buildNav();w.navTaskCounts={approvals:2};w.navTaskItems={approvals:['one','two']};w.navTaskSeen={};w.applyNavBadges();assert(w.document.querySelector('#nav-approvals .nav-badge'));assert.equal(w.unseenTaskCount('approvals'),2);
for(const user of w.DB.users.filter(x=>['Patient','Doctor','Staff','Administrator'].includes(x.role)).slice(0,6)){w.currentUser=user;w.currentPatient=w.DB.patients.find(p=>p.userId===user.id)||w.DB.patients[0];w.buildNav();w.navTo('dashboard');}
assert.deepEqual(errors,[]);
// Every inline handler still resolves after Vite minifies function names.
const handlerCalls=new Set();for(const el of w.document.querySelectorAll('*'))for(const a of el.attributes)if(/^on/.test(a.name))for(const m of a.value.matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\(/g))handlerCalls.add(m[1]);const missing=[...handlerCalls].filter(n=>!['if','Number','String','parseInt','setTimeout','alert','confirm'].includes(n)&&typeof w[n]!=='function');assert.deepEqual(missing,[]);
console.log('PASS: production bundle startup, runtime bindings, role dashboards, sidebar badges, draft actions, schedule validation, slot boundaries, inline handlers and deployment-origin redirects');w.close();})().catch(e=>{console.error(e);w.close();process.exitCode=1;});

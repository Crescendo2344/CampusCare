// Exercise actual Chromium UI events and API contracts using synthetic, intercepted backend responses.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
// Serve built assets in this process so the command is reproducible without a separate dev server.
let server,baseUrl=process.env.CAMPUSCARE_TEST_URL;
if(!baseUrl){
  const root=path.resolve('dist');
  server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    let file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=root+'/index.html';
    const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
    response.writeHead(200,{'Content-Type':type});fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseUrl=`http://127.0.0.1:${server.address().port}`;
}
// CI uses Playwright's installed browser; restricted environments may supply an explicit binary provider.
let executablePath=process.env.CAMPUSCARE_CHROMIUM_PATH;
if(process.env.CAMPUSCARE_CHROMIUM_PROVIDER){
  const provider=(await import(process.env.CAMPUSCARE_CHROMIUM_PROVIDER)).default;
  executablePath=await provider.executablePath();
}
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
const authId='00000000-0000-4000-8000-000000000001';
const now=Math.floor(Date.now()/1000),token=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:authId,role:'authenticated',exp:now+3600,iat:now})).toString('base64url'),'fixture-signature'].join('.');
let cases=0;
try{
 for(const mobile of [false,true])for(const role of ['Patient','Doctor','Staff','Administrator']){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('net::ERR'))errors.push(message.text());});
  // Capture the public lifecycle event only inside this test realm, with no production globals added.
  await page.addInitScript(()=>document.addEventListener('campuscare:ready',event=>{window.__fixtureApp=event.detail;},{once:true}));
  const profile={user_id:1,auth_user_id:authId,first_name:'Fixture',last_name:role,username:'fixture',email:'fixture@example.test',role,status:'Active',verified:true,person_type:'Staff',work_days:['Mon','Tue','Wed','Thu','Fri'],start_time:'08:00',end_time:'17:00',slot_duration:60,max_patients:20,specialty:'General Medicine'};
  const doctor={...profile,user_id:2,auth_user_id:'00000000-0000-4000-8000-000000000002',role:'Doctor',first_name:'Fixture',last_name:'Doctor'};
  const patient={patient_id:4,user_id:1,birth_date:'2000-01-01',college:'CCICT',person_type:'Student',archived:false};
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===new URL(baseUrl).origin)return route.continue();
   if(!url.hostname.endsWith('.supabase.co'))return route.abort();
   const path=url.pathname;requests.push({path,method:request.method(),body:request.postDataJSON?.()});
   let response={};
   if(path.endsWith('/token'))response={access_token:token,refresh_token:'fixture-refresh',expires_in:3600,expires_at:now+3600,token_type:'bearer',user:{id:authId,email:profile.email,aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString()}};
   else if(path.endsWith('/user'))response={id:authId,email:profile.email};
   else if(path.includes('/rest/v1/')){
    const table=path.split('/').at(-1),single=request.headers().accept?.includes('object+json');
    const rows=table==='users'?[profile,doctor]:table==='patients'?[patient]:table==='system_settings'?[{settings_id:1,clinic_name:'Fixture Clinic',session_timeout_minutes:30}]:[];
    response=single?(rows[0]||null):rows;
   }else if(path.includes('/functions/v1/'))response={ok:true,notifications:[],requests:[],doctor_leaves:[],messages:[],contacts:[doctor],resources:[],surveys:[],users:[],doctors:[doctor],counts:{},items:{}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
  });
  await page.goto(baseUrl);await page.waitForFunction(()=>Boolean(window.__fixtureApp));
  await page.locator('[data-action-click="shell-8"]').click();
  await page.getByRole('button',{name:'Login to CampusCare',exact:true}).click();
  await page.getByText('Enter your username/email and password.',{exact:true}).waitFor();
  await page.locator('#li-user').fill(profile.email);await page.locator('#li-pass').fill('Fixture-only-password1!');
  await page.getByRole('button',{name:'Login to CampusCare',exact:true}).click();
  await page.locator('#app.visible').waitFor();
  await page.waitForFunction(role=>window.__fixtureApp.state.auth.currentUser?.role===role,role);
  // Walk every visible role route through its actual generated click callback.
  const navIds=await page.locator('#sidebar nav [id^="nav-"]').evaluateAll(elements=>elements.map(element=>element.id));
  assert(navIds.length>0);assert(!navIds.includes('nav-task-center'));
  for(const id of navIds){
    await page.evaluate(id=>document.getElementById(id).click(),id);
    await page.waitForTimeout(120);
    assert(await page.locator('#app-content').innerHTML(),`${role}: empty ${id}`);
  }
  if(role==='Doctor'){
    await page.evaluate(()=>window.__fixtureApp.features.workflowRequests.openScheduleChangeRequest());
    await page.getByRole('button',{name:'Clear',exact:true}).click();assert.equal(await page.locator('.scr-day:checked').count(),0);
    // Empty days must be explained in the preview, and tiles must work through real clicks.
    assert.match(await page.locator('#schedule-preview').innerText(),/work day/i);
    await page.locator('.schedule-day').filter({has:page.locator('input[value="Mon"]')}).click();
    assert.equal(await page.locator('.scr-day:checked').count(),1);
    assert.match(await page.locator('#schedule-proposed-summary').innerText(),/^Mon ·/);
    assert.equal(await page.locator('.schedule-day input[value="Mon"]').getAttribute('aria-label'),'Monday');
    assert.equal(await page.locator('.schedule-request').evaluate(element=>element.scrollWidth<=element.clientWidth),true);
    await page.getByRole('button',{name:'Send for Approval',exact:true}).waitFor();
    await page.getByRole('button',{name:'Mon–Fri',exact:true}).click();assert.equal(await page.locator('.scr-day:checked').count(),5);
    await page.locator('#scr-reason').fill('Fixture work pattern');
    await page.locator('[data-campus-draft]').click();await page.evaluate(()=>window.__fixtureApp.features.modals.closeAllModals());
    await page.evaluate(()=>window.__fixtureApp.features.workflowRequests.openScheduleChangeRequest());await page.getByRole('button',{name:'Restore Draft',exact:true}).waitFor();
    await page.evaluate(()=>window.__fixtureApp.features.modals.closeAllModals());
  }
  // Confirm sign-out through the same dialog and real SDK request path used in production.
  await page.locator('.sb-logout').evaluate(element=>element.click());
  await page.locator('#cc-confirm-ok-btn').click();
  await page.waitForFunction(()=>window.__fixtureApp.state.auth.currentUser===null);
  await page.getByText('Logged out successfully.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixtureApp.state.data.DB.patients.some(row=>row._realSupabase)),false);
  assert(requests.some(request=>request.path.endsWith('/token')),`${role}: actual login request missing`);
  assert(requests.some(request=>request.path.includes('/rest/v1/users')),`${role}: profile query missing`);
  assert.deepEqual(errors,[],`${mobile?'mobile':'desktop'} ${role}`);
  console.log(`PASS: ${mobile?'mobile':'desktop'} ${role}, login/API/profile and ${navIds.length} routes`);cases++;
  await context.close();
 }
 console.log(`PASS: ${cases} Chromium role/device scenarios, with all Supabase requests intercepted`);
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}

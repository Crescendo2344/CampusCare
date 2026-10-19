import {buildStudentReport} from '../src/domain/student-report.js';
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
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    // Unknown-account cases deliberately return HTTP 404; their visible error handling is asserted below.
    const expectedRejection=/\/(resend-verification|request-password-reset)$/.test(message.location().url||'')&&message.text().includes('status of 404');
    if(message.type()==='error'&&!message.text().includes('net::ERR')&&!expectedRejection)errors.push(message.text());
  });
  // Capture the public lifecycle event only inside this test realm, with no production globals added.
  await page.addInitScript(()=>document.addEventListener('campuscare:ready',event=>{window.__fixtureApp=event.detail;},{once:true}));
  const profile={user_id:1,auth_user_id:authId,first_name:'Fixture',last_name:role,username:'fixture',email:'fixture@example.test',role,status:'Active',verified:true,person_type:'Staff',work_days:['Mon','Tue','Wed','Thu','Fri'],start_time:'08:00',end_time:'17:00',slot_duration:60,max_patients:20,specialty:'General Medicine'};
  const doctor={...profile,user_id:2,auth_user_id:'00000000-0000-4000-8000-000000000002',role:'Doctor',first_name:'Fixture',last_name:'Doctor'};
  const patient={patient_id:4,user_id:1,birth_date:'2000-01-01',college:'CCICT',person_type:'Student',archived:false};
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===new URL(baseUrl).origin)return route.continue();
   if(!url.hostname.endsWith('.supabase.co'))return route.abort();
   const path=url.pathname;requests.push({path,method:request.method(),body:request.headers()['content-type']?.includes('application/json')?request.postDataJSON():null});
   let response={};
   if(path.endsWith('/token'))response={access_token:token,refresh_token:'fixture-refresh',expires_in:3600,expires_at:now+3600,token_type:'bearer',user:{id:authId,email:profile.email,aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString()}};
   else if(path.endsWith('/user'))response={id:authId,email:profile.email};
   else if(path.includes('/rest/v1/')){
    const table=path.split('/').at(-1),single=request.headers().accept?.includes('object+json');
    const rows=table==='users'?[profile,doctor]:table==='patients'?[patient]:table==='system_settings'?[{settings_id:1,clinic_name:'Fixture Clinic',session_timeout_minutes:30}]:[];
    response=single?(rows[0]||null):rows;
   }else if(path.endsWith('/resend-verification')||path.endsWith('/request-password-reset')){
    if(request.postDataJSON().identifier==='not-registered@example.test')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'No CampusCare account matches that username or email.'})});
    response={ok:true};
   }else if(path.endsWith('/register-patient'))response={ok:true,email_confirmation_required:true};
   else if(path.endsWith('/student-reports'))response={ok:true,report:buildStudentReport({users:[{user_id:10,first_name:'Morning',last_name:'Student',id_number:'ST10',role:'Patient',person_type:'Student',college:'CCICT',status:'Active',verified:true,created_at:'2026-01-01'},{user_id:11,first_name:'Evening',last_name:'Student',id_number:'ST11',role:'Patient',person_type:'Student',college:'CCICT',status:'Active',verified:true,created_at:'2026-01-01'}],patients:[{patient_id:10,user_id:10,class_session:'Morning'},{patient_id:11,user_id:11,class_session:'Evening'}],appointments:[{appointment_id:10,patient_id:10,clinic:'Dental Clinic',appointment_date:request.postDataJSON().from,status:'Completed'}]},request.postDataJSON())};
   else if(path.includes('/functions/v1/'))response={ok:true,notifications:[],requests:[],doctor_leaves:[],messages:[],contacts:[doctor],resources:[],surveys:[],users:[],doctors:[doctor],counts:{},items:{}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
  });
  await page.goto(baseUrl);await page.waitForFunction(()=>Boolean(window.__fixtureApp));
  if(!mobile&&role==='Patient'){
    // A solid panel must remain readable without backdrop filtering at every breakpoint.
    for(const width of [320,360,768,1366])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:800});
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      const layout=await page.evaluate(()=>({
        overflow:document.documentElement.scrollWidth>window.innerWidth+1,
        font:parseFloat(getComputedStyle(document.querySelector('.hero-mini-card p')).fontSize),
        background:getComputedStyle(document.querySelector('.hero-info-carousel')).backgroundColor,
        blur:getComputedStyle(document.querySelector('.hero-info-carousel')).backdropFilter,
        navbar:getComputedStyle(document.getElementById('landing-navbar')).backgroundColor,
        // Text fragments reveal real wrapping rather than merely checking a CSS declaration.
        ctaLines:(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('.landing-get-started'));return range.getClientRects().length;})()
      }));
      assert.equal(layout.ctaLines,1,`${width} ${theme}: Get Started wraps`);
      assert.equal(layout.navbar,'rgb(10, 20, 32)');
      assert.equal(layout.overflow,false,`${width} ${theme}: horizontal overflow`);
      assert(layout.font>=14,`${width} ${theme}: unreadable carousel font`);
      assert.equal(layout.background,'rgb(22, 44, 61)');assert.equal(layout.blur,'none');
      if(width>1100){
        // Desktop carousel and navbar CTA share a right edge.
        const edges=await page.evaluate(()=>({carousel:document.querySelector('.hero-info-carousel').getBoundingClientRect().right,cta:document.querySelector('.landing-get-started').getBoundingClientRect().right}));
        assert(Math.abs(edges.carousel-edges.cta)<2,'Carousel must align with Get Started');
      }
      if(process.env.CAMPUSCARE_VISUAL_DIR){
        // Optional screenshots aid local visual review and are never production assets.
        await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/landing-${width}-${theme}.png`,fullPage:true});
      }
    }
    await page.setViewportSize({width:1440,height:1000});
  }
  if(role==='Patient'){
    // Real wheel/touch gestures must scroll the document, not a clipped nested route.
    await page.setViewportSize(mobile?{width:390,height:640}:{width:1440,height:800});
    const scrollDown=async()=>{
      if(mobile){
        const session=await context.newCDPSession(page);
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:520}]});
        for(const y of [450,380,310,240]){
          await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:190,y}]});
          await page.waitForTimeout(35);
        }
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await session.detach();
      }else{
        await page.mouse.move(700,400);await page.mouse.wheel(0,650);
      }
      await page.waitForFunction(()=>window.scrollY>50);
    };
    for(const route of ['home','services','about','contact']){
      await page.evaluate(route=>window.__fixtureApp.features.authentication.landingNavTo(route),route);
      const long=await page.evaluate(()=>document.scrollingElement.scrollHeight>innerHeight+50);
      if(long)await scrollDown();
      await page.evaluate(()=>window.scrollTo(0,document.scrollingElement.scrollHeight));
      assert(await page.evaluate(()=>document.querySelector('.landing-route.active').getBoundingClientRect().bottom<=innerHeight+2),`${route}: bottom is clipped`);
    }
    await page.locator('.landing-get-started').click();
    const links=await page.locator('.auth-recovery-links a').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));
    assert(links[0]<links[1],'Resend verification must appear above Forgot password');
    // Unknown identifiers stay on the request form and never show email-sent feedback.
    await page.getByRole('link',{name:'Resend verification email',exact:true}).click();
    await page.locator('#resend-verify-id').fill('not-registered@example.test');
    await page.locator('#resend-verify-btn').click();
    await page.locator('#resend-verify-msg').getByText('No CampusCare account matches that username or email.',{exact:true}).waitFor();
    await page.evaluate(()=>window.__fixtureApp.features.modals.closeAllModals());
    await page.getByRole('link',{name:'Forgot password?',exact:true}).click();
    await page.locator('#fp-identifier').fill('not-registered@example.test');await page.locator('#fp-send-btn').click();
    await page.locator('#fp-err').getByText('No CampusCare account matches that username or email.',{exact:true}).waitFor();
    assert(await page.locator('#forgot-step1').isVisible());assert(!await page.locator('#forgot-step2').isVisible());
    await page.evaluate(()=>window.__fixtureApp.features.passwordRecovery.closeForgotPassword());
    await page.getByRole('button',{name:'Register',exact:true}).click();
    await scrollDown();
    // Populate a valid registration and an OCR name mismatch at the requested 25% boundary.
    const fields={'r-fname':'Fixture','r-lname':'Student','r-user':'fixture.student','r-email':'fixture@example.test','r-pass':'Fixture-only-password1!','r-idno':'1234567'};
    for(const [id,value]of Object.entries(fields))await page.locator('#'+id).fill(value);
    await page.locator('#r-college').selectOption({index:0});await page.locator('#r-sex').selectOption('Male');
    await page.evaluate(()=>{
      // The date picker stores its chosen date in a hidden field.
      document.getElementById('r-dob').value='2000-01-01';
      for(const id of ['r-selfie-file','r-id-file']){
        const transfer=new DataTransfer();transfer.items.add(new File(['fixture'],'fixture.png',{type:'image/png'}));document.getElementById(id).files=transfer.files;
      }
      Object.assign(window.__fixtureApp.state.documentScanner,{lastOcrRawText:'Unclear printed document',lastOcrConfidence:25,lastOcrDocumentType:'Document'});
      window.__fixtureApp.features.documentScanner.recheckNameMatch();
    });
    assert((await page.locator('#id-analyze-status').textContent()).includes('You can continue with registration.'));
    await page.locator('#r-privacy-consent').check();
    await page.evaluate(()=>window.scrollTo(0,document.scrollingElement.scrollHeight));
    const submit=await page.locator('#registration-submit-button').boundingBox();assert(submit.y>=0&&submit.y+submit.height<=640+(mobile?0:160),'Registration submit is clipped');
    await page.locator('#registration-submit-button').click();await page.locator('#pending-section').waitFor({state:'visible'});
    assert(requests.some(request=>request.path.endsWith('/register-patient')),'OCR 25% must reach staff review submission');
    // Confirmation links always end at login, even for an already active account.
    await page.goto(baseUrl+'/?auth=confirmed#access_token='+token+'&refresh_token=fixture-refresh&expires_in=3600&token_type=bearer&type=signup');
    await page.waitForFunction(()=>Boolean(window.__fixtureApp));await page.locator('#login-section').waitFor({state:'visible'});
    await page.waitForFunction(()=>!location.search&&!location.hash);
    assert(!await page.locator('#app').isVisible(),'Confirmation must not auto-open the dashboard');
    await page.evaluate(()=>window.__fixtureApp.features.authentication.showLandingPage());
    await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});
  }
  // Only native browser navigation is shown, and auth has no theme toggle.
  assert.equal(await page.locator('#page-back').count(),0);
  assert.equal(await page.getByRole('button',{name:'Book an Appointment',exact:true}).count(),0);
  await page.locator('.landing-get-started').click();
  assert.equal(await page.locator('#landing-navbar').evaluate(nav=>getComputedStyle(nav).backgroundColor),'rgb(10, 20, 32)');
  assert.equal(await page.locator('#auth-theme-toggle-btn').count(),0);
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
  if(['Staff','Administrator'].includes(role)){
    // Combine class/session and no-use filters, then check that the registration denominator survives.
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('reports'));
    await page.locator('#rpt-type').waitFor();await page.locator('#rpt-type').selectOption('students');
    await page.locator('#student-report-filters').waitFor();
    await page.locator('#rpt-session').selectOption('Evening');await page.locator('#rpt-dental').selectOption('not');
    await page.getByRole('button',{name:'Generate Report',exact:true}).click();
    await page.locator('#rpt-result').getByText('Evening Student',{exact:true}).waitFor();
    assert.equal(await page.locator('#rpt-result').getByText('Morning Student',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.__fixtureApp.state.reportCharts.lastReportRows.length),1);
    assert.equal(await page.evaluate(()=>window.__fixtureApp.state.reportCharts.lastReportRows[0]['Class Session']),'Evening');
    await page.locator('#rpt-session').selectOption('');await page.locator('#rpt-dental').selectOption('used');
    await page.getByRole('button',{name:'Generate Report',exact:true}).click();
    await page.locator('#rpt-result').getByText('Morning Student',{exact:true}).waitFor();
    const downloaded=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export college summary CSV',exact:true}).click();
    assert.equal((await downloaded).suggestedFilename(),'Student_College_Summary.csv');
  }
  // Brand navigation works from every role; Patient history returns to the actual previous page.
  await page.locator('.sb-brand').evaluate(element=>element.click());
  await page.waitForFunction(()=>window.__fixtureApp.state.navigationRaceProtection.campusActivePageId==='dashboard');
  if(role==='Patient'){
    assert.equal(await page.locator('.dashboard-a-head').getByRole('button',{name:/Book Appointment/}).count(),0);
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('my-appointments'));
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('health_education'));
    await page.goBack();
    await page.waitForFunction(()=>window.__fixtureApp.state.navigationRaceProtection.campusActivePageId==='my-appointments');
    await page.goForward();
    await page.waitForFunction(()=>window.__fixtureApp.state.navigationRaceProtection.campusActivePageId==='health_education');
    await page.locator('.sb-brand-icon').evaluate(element=>element.click());
    await page.waitForFunction(()=>window.__fixtureApp.state.navigationRaceProtection.campusActivePageId==='dashboard');
    await page.goBack();
    await page.waitForFunction(()=>window.__fixtureApp.state.navigationRaceProtection.campusActivePageId==='health_education');
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

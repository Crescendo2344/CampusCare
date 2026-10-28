import {buildDoctorAvailability,addBookingDays} from '../src/domain/booking-availability.js';
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
    const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream';
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
// A synthetic camera exercises real getUserMedia and capture without accessing a person's camera.
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],...(executablePath?{executablePath}: {})});
const authId='00000000-0000-4000-8000-000000000001';
const now=Math.floor(Date.now()/1000),token=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:authId,role:'authenticated',exp:now+3600,iat:now})).toString('base64url'),'fixture-signature'].join('.');
let cases=0;
try{
 for(const mobile of [false,true])for(const role of ['Patient','Doctor','Staff','Administrator']){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,permissions:['camera','microphone']});
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    // Unknown-account cases deliberately return HTTP 404; their visible error handling is asserted below.
    const modelInfo=/^INFO: Created TensorFlow Lite XNNPACK delegate for CPU\.$/.test(message.text());
    const expectedRejection=/\/(resend-verification|request-password-reset)$/.test(message.location().url||'')&&message.text().includes('status of 404');
    const expectedThrottle=/\/register-patient$/.test(message.location().url||'')&&message.text().includes('status of 429');
    if(message.type()==='error'&&!message.text().includes('net::ERR')&&!expectedRejection&&!expectedThrottle&&!modelInfo)errors.push(message.text());
  });
  // Capture the public lifecycle event only inside this test realm, with no production globals added.
  await page.addInitScript(()=>document.addEventListener('campuscare:ready',event=>{window.__fixtureApp=event.detail;},{once:true}));
  // Keep the real detector/worker on desktop; only its synthetic frame results are varied for UI assertions.
  await page.addInitScript(mobile=>{
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{
      constructor(url,options){
        if(mobile&&String(url).includes('face-detector.worker'))throw new Error('Fixture: worker unavailable');
        super(url,options);
        this.addEventListener('message',event=>{if(event.data.type==='result'&&window.__fixtureGuidance)Object.assign(event.data,window.__fixtureGuidance);});
      }
    };
  },mobile);
  // OCR is isolated from third-party networks; live framing still analyzes real camera pixels.
  await page.addInitScript(()=>{window.Tesseract={recognize:async()=>({data:{confidence:25,text:'Unclear printed document'}})};});
  const profile={user_id:1,auth_user_id:authId,first_name:'Fixture',last_name:role,username:'fixture',email:'fixture@example.test',role,status:'Active',verified:true,person_type:'Staff',work_days:['Mon','Tue','Wed','Thu','Fri'],start_time:'08:00',end_time:'17:00',slot_duration:60,max_patients:20,specialty:'General Medicine'};
  const doctor={...profile,user_id:2,auth_user_id:'00000000-0000-4000-8000-000000000002',role:'Doctor',first_name:'Fixture',last_name:'Doctor'};
  const managedUsers=[profile,doctor];
  const patient={patient_id:4,user_id:1,birth_date:'2000-01-01',college:'CCICT',person_type:'Student',archived:false};
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===new URL(baseUrl).origin)return route.continue();
   if(url.hostname==='challenges.cloudflare.com')return route.fulfill({contentType:'application/javascript',body:`
     // Simulate only the provider widget; backend token enforcement has separate handler tests.
     window.turnstile={ready:()=>{throw new Error('Turnstile ready() cannot be used with an async script');},render:(selector,options)=>{window.__fixtureTurnstile=options;const button=document.createElement('button');button.id='fixture-captcha-solve';button.type='button';button.textContent='Verify security check';button.onclick=()=>options.callback('fixture-captcha-'+Date.now());document.querySelector(selector).appendChild(button);return 'fixture-widget';},reset:()=>{window.__fixtureCaptchaResets=(window.__fixtureCaptchaResets||0)+1;},remove:()=>document.getElementById('registration-captcha-widget').replaceChildren()};
    `});
   if(!url.hostname.endsWith('.supabase.co'))return route.abort();
   const path=url.pathname;requests.push({path,method:request.method(),body:request.headers()['content-type']?.includes('application/json')?request.postDataJSON():null});
   let response={};
   if(path.endsWith('/token'))response={access_token:token,refresh_token:'fixture-refresh',expires_in:3600,expires_at:now+3600,token_type:'bearer',user:{id:authId,email:profile.email,aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString()}};
   else if(path.endsWith('/user'))response={id:authId,email:profile.email};
   else if(path.includes('/rest/v1/')){
    const table=path.split('/').at(-1),single=request.headers().accept?.includes('object+json');
    const rows=table==='users'?managedUsers:table==='patients'?[patient]:table==='system_settings'?[{settings_id:1,clinic_name:'Fixture Clinic',session_timeout_minutes:30}]:[];
    response=single?(rows[0]||null):rows;
   }else if(path.endsWith('/resend-verification')||path.endsWith('/request-password-reset')){
    if(request.postDataJSON().identifier==='not-registered@example.test')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'No CampusCare account matches that username or email.'})});
    response={ok:true};
   }else if(path.endsWith('/admin-users')){
    const body=request.postDataJSON(),target=managedUsers.find(user=>user.user_id===body.user_id);
    if(body.action==='update'){
      assert.equal(body.confirmed,true);assert(!('status' in body));assert(['Active','Suspended'].includes(target.status));
      for(const field of ['first_name','last_name','email','contact_number','specialty'])if(body[field]!==undefined)target[field]=body[field];response={ok:true,user:{...target}};
    }else if(body.action==='status'){target.status=body.status;response={ok:true,status:target.status};}
    else if(body.action==='detail')response={ok:true,user:{...target},patient:null};else response={ok:true};
   }else if(path.endsWith('/register-patient')){
    if(request.method()==='GET')response={captcha_required:!mobile,site_key:mobile?null:'0x4-fixture-key'};
    else{
      if(!mobile){assert(request.postDataBuffer().toString().includes('fixture-captcha-'),'The CAPTCHA token must reach the API');if(!page.__fixtureLimited){page.__fixtureLimited=true;return route.fulfill({status:429,contentType:'application/json',headers:{'Retry-After':'120'},body:JSON.stringify({error:'Too many registration attempts. Please wait 2 minutes before trying again.',retry_after:120})});}}
      response={ok:true,email_confirmation_required:false};
    }
   }
   else if(path.endsWith('/booking-availability')){
    const body=request.postDataJSON();let date=addBookingDays(body.from,45);
    while([0,6].includes(new Date(date+'T12:00:00Z').getUTCDay()))date=addBookingDays(date,1);
    page.__bookingDate=date;
    const days=buildDoctorAvailability({doctor:{workDays:['Mon','Tue','Wed','Thu','Fri'],startTime:'08:00',endTime:'17:00',slotDuration:60,maxPatients:20},from:date,to:page.__wideAvailability?addBookingDays(date,14):date,today:body.from,appointments:[{date,time:'09:00',status:'Scheduled'}],overrides:[{date,time:'10:00',available:false}]});
    response={ok:true,days};
   }else if(path.endsWith('/appointment-actions')){
    const body=request.postDataJSON();
    if(body.action==='create'){assert.equal(body.appointment_date,page.__bookingDate);assert.equal(body.appointment_time,'08:00');assert.equal(body.doctor_id,2);assert(!body.appointment_id,'New bookings must not pass a truthy null string as an edit ID');}
    response={ok:true};
   }
   else if(path.endsWith('/student-reports'))response={ok:true,report:buildStudentReport({users:[{user_id:10,first_name:'Morning',last_name:'Student',id_number:'ST10',role:'Patient',person_type:'Student',college:'CCICT',status:'Active',verified:true,created_at:'2026-01-01'},{user_id:11,first_name:'Evening',last_name:'Student',id_number:'ST11',role:'Patient',person_type:'Student',college:'CCICT',status:'Active',verified:true,created_at:'2026-01-01'}],patients:[{patient_id:10,user_id:10,class_session:'Morning'},{patient_id:11,user_id:11,class_session:'Evening'}],appointments:[{appointment_id:10,patient_id:10,clinic:'Dental Clinic',appointment_date:request.postDataJSON().from,status:'Completed'}]},request.postDataJSON())};
   else if(path.endsWith('/clinical-intelligence')){
    const body=request.postDataJSON();
    response=body.action==='copilot'
      ?{ok:true,copilot:{summary:'Two clinic visits in the last 90 days.',alerts:[{type:'warning',title:'Repeat complaint',detail:'Headache recorded at two consecutive visits.'}],recent_history:['2026-03-02 — Tension headache; treatment: Paracetamol 500 mg'],record_counts:{treatments:2,appointments:3},draft_note:'S: Headache for two days.\nO: BP 110/70, T 36.8 C.\nA: Tension headache.\nP: Rest, fluids, paracetamol as needed.',method:'Explainable clinical-record summarization'}}
      :{ok:true,bundle:{resourceType:'Bundle',type:'collection',entry:[{resource:{resourceType:'Patient',id:'patient-10',name:[{family:'Fixture',given:['Morning']}],gender:'female'}},{resource:{resourceType:'Encounter',id:'encounter-1',status:'finished',period:{start:'2026-03-02T09:00:00+08:00'}}},{resource:{resourceType:'Condition',id:'condition-1',code:{text:'Tension headache'},recordedDate:'2026-03-02'}}]}};
   }
   else if(path.endsWith('/workflow-actions')){
    // One pending day off with a supporting photo, as the function returns it to admins and the requester.
    const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const owner=role==='Doctor'?1:2;
    response={ok:true,doctor_leaves:[],requests:[{request_id:9,request_type:'Day Off',requester_id:owner,target_user_id:owner,payload:{leaveDate:'2026-12-01',attachment:{path:'requests/2/fixture.png',name:'medical-certificate.png',mime:'image/png',size:2048}},reason:'Scheduled minor procedure',effective_date:'2026-12-01',status:'Pending',created_at:'2026-10-20T01:00:00Z',attachment_url:pixel}]};
   }
   else if(path.includes('/functions/v1/'))response={ok:true,notifications:[],requests:[],doctor_leaves:[],messages:[],contacts:[doctor],resources:[],surveys:[],users:[],doctors:[doctor],counts:{},items:{}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
  });
  await page.goto(baseUrl);await page.waitForFunction(()=>Boolean(window.__fixtureApp));
  if(!mobile&&role==='Patient'){
    await page.evaluate(()=>window.__fixtureApp.features.authentication.showLandingRoute('contact',false));
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      assert.equal(await page.locator('.public-faq details').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
    }
    await page.evaluate(()=>window.__fixtureApp.features.authentication.showLandingRoute('home',false));
    // The compact translucent panel must remain readable at every breakpoint.
    for(const width of [320,360,768,1366])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:800});
      await page.evaluate(theme=>{
        document.documentElement.dataset.theme=theme;
        window.__fixtureApp.features.authentication.pauseLandingCarouselTimer();
        window.__fixtureApp.features.authentication.positionLandingCarousel(0);
      },theme);
      await page.waitForTimeout(250);
      const layout=await page.evaluate(()=>({
        overflow:document.documentElement.scrollWidth>window.innerWidth+1,
        font:parseFloat(getComputedStyle(document.querySelector('.hero-mini-card p')).fontSize),
        background:getComputedStyle(document.querySelector('.hero-info-carousel')).backgroundColor,
        blur:getComputedStyle(document.querySelector('.hero-info-carousel')).backdropFilter,
        navbar:getComputedStyle(document.getElementById('landing-navbar')).backgroundColor,
        // Text fragments reveal real wrapping rather than merely checking a CSS declaration.
        ctaLines:(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('.landing-get-started'));return range.getClientRects().length;})()
      }));
      assert.equal(layout.ctaLines,1,`${width} ${theme}: Register wraps`);
      assert.equal(layout.navbar,'rgb(10, 20, 32)');
      assert.equal(layout.overflow,false,`${width} ${theme}: horizontal overflow`);
      assert(layout.font>=13,`${width} ${theme}: unreadable carousel font`);
      assert(['rgba(83, 113, 145, 0.82)','rgba(64, 92, 116, 0.9)'].includes(layout.background));
      if(width>1100){
        const panel=await page.locator('.hero-info-carousel').boundingBox();assert.equal(panel.height,320);assert.equal(panel.width,420);
        // Desktop carousel and navbar CTA share a right edge.
        const edges=await page.evaluate(()=>({carousel:document.querySelector('.hero-info-carousel').getBoundingClientRect().right,cta:document.querySelector('.landing-get-started').getBoundingClientRect().right}));
        assert(Math.abs(edges.carousel-edges.cta)<2,'Carousel must align with Register');
        assert(await page.evaluate(()=>[...document.querySelectorAll('.hero-carousel-slide')].every(slide=>slide.scrollHeight<=slide.clientHeight+1)),`${width}: carousel slides must fit without scrolling`);
      }
      if(process.env.CAMPUSCARE_VISUAL_DIR){
        // Optional screenshots aid local visual review and are never production assets.
        await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/landing-${width}-${theme}.png`,fullPage:true});
      }
    }
    // Every step, wrap and resize settles on one whole slide with no duplicated panels.
    assert.equal(await page.locator('.hero-carousel-slide').count(),4);
    const aligned=async index=>page.waitForFunction(index=>{
      const viewport=document.getElementById('hero-carousel-viewport'),slide=document.querySelectorAll('.hero-carousel-slide')[index];
      return Math.abs(slide.getBoundingClientRect().left-viewport.getBoundingClientRect().left)<1;
    },index);
    for(const index of [1,2,3,0]){
      await page.evaluate(()=>window.__fixtureApp.features.authentication.moveLandingCarousel(1));
      await aligned(index);
    }
    await page.evaluate(()=>window.__fixtureApp.features.authentication.positionLandingCarousel(2));
    await page.setViewportSize({width:390,height:800});await aligned(2);
    await page.setViewportSize({width:1366,height:800});await aligned(2);
    const carousel=page.locator('.hero-info-carousel');
    await carousel.hover();
    await page.evaluate(()=>window.__fixtureApp.features.authentication.startLandingCarouselTimer());
    assert(await page.evaluate(()=>window.__fixtureApp.state.authentication.landingCarouselTimer===null),'Hover must pause autoplay');
    await carousel.focus();await carousel.press('ArrowRight');await aligned(3);
    await page.locator('.landing-get-started').focus();
    // Both button animations must be visible without resizing their layout boxes.
    for(const selector of ['.landing-get-started','.landing-book-appointment']){
      await page.mouse.move(5,75);await page.locator(selector).blur();await page.waitForTimeout(200);
      const before=await page.locator(selector).boundingBox();
      await page.locator(selector).hover();await page.waitForTimeout(220);
      const after=await page.locator(selector).boundingBox();
      assert(Math.abs(after.width-before.width)<.1&&after.y<before.y-1,'Hover should lift the button without changing its width');
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
      if(process.env.CAMPUSCARE_VISUAL_DIR){
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/public-${route}-${mobile?'mobile':'desktop'}.png`,fullPage:true});
      }
      if(route==='about')assert(await page.evaluate(()=>document.querySelector('.public-team-grid').compareDocumentPosition(document.querySelector('.public-achievement-card'))&Node.DOCUMENT_POSITION_FOLLOWING),'The milestone should follow the clinic team');
      const long=await page.evaluate(()=>document.scrollingElement.scrollHeight>innerHeight+50);
      if(long)await scrollDown();
      await page.evaluate(()=>window.scrollTo(0,document.scrollingElement.scrollHeight));
      assert(await page.evaluate(()=>document.querySelector('.landing-route.active').getBoundingClientRect().bottom<=innerHeight+2),`${route}: bottom is clipped`);
    }
    await page.locator('.landing-get-started').click();
    await page.locator('#reg-section').waitFor({state:'visible'});
    assert.equal(await page.locator('.landing-get-started').innerText(),'Register');
    // Visiting and leaving an empty field is not an error; skipped fields are reported on submit.
    await page.locator('#r-fname').focus();await page.locator('#r-lname').focus();await page.locator('#r-lname').blur();
    assert(await page.locator('#r-fname-error').isHidden()&&await page.locator('#r-lname-error').isHidden(),'Empty fields must not error on blur');
    // Typo feedback appears beside the email field; legitimate school and company domains stay valid.
    await page.locator('#r-email').fill('student@gmal.com');await page.locator('#r-email').blur();
    await page.locator('#r-email-error').getByText('Check the email domain. Did you mean @gmail.com?',{exact:true}).waitFor();
    for(const email of ['student@ctu.edu.ph','student+clinic@gmail.com','student@school.edu.ph']){
      await page.locator('#r-email').fill(email);await page.locator('#r-email').blur();assert(await page.locator('#r-email-error').isHidden());
    }
    assert(await page.locator('#r-contact-help').isHidden());
    assert.equal(await page.locator('#r-contact').getAttribute('placeholder'),'09… or +63…');
    await page.locator('#r-contact').focus();assert(await page.locator('#r-contact-help').isVisible());
    await page.locator('#r-contact').fill('+639171234567');await page.locator('#r-contact').blur();assert(await page.locator('#r-contact-error').isHidden());
    assert.equal(await page.locator('#r-contact').inputValue(),'+639171234567');
    assert(await page.locator('#r-contact-help').isHidden(),'Contact guidance hides after blur');
    await page.locator('#r-contact').fill('08171234567');await page.locator('#r-contact').blur();await page.locator('#r-contact-error').waitFor({state:'visible'});
    await page.locator('#r-contact').fill('');await page.locator('#r-contact').blur();
    await page.evaluate(()=>window.__fixtureApp.features.authentication.showLandingPage());
    await page.locator('.landing-book-appointment').click();
    const loginBox=await page.locator('#login-section').getByRole('button',{name:'Login',exact:true}).boundingBox();
    const forgotBox=await page.getByRole('link',{name:'Forgot password?',exact:true}).boundingBox();
    assert(forgotBox.y+forgotBox.height<loginBox.y,'Forgot password sits with Remember me above Login');
    assert.equal(await page.locator('#auth-mode-title').innerText(),'Welcome');
    const rememberBox=await page.getByLabel('Remember me').boundingBox();
    assert(Math.abs(rememberBox.y+rememberBox.height/2-(forgotBox.y+forgotBox.height/2))<8,'Remember me shares a row with Forgot password');
    assert.equal(await page.getByText('Resend verification email',{exact:false}).count(),0);
    await page.evaluate(()=>window.__fixtureApp.features.loginLockout.openPrivacyNotice());
    await page.locator('.privacy-notice').waitFor();
    assert.equal(await page.locator('.privacy-notice .pn-statement').evaluate(el=>getComputedStyle(el).display),'block');
    assert(await page.locator('.privacy-notice .pn-section h4').first().evaluate(el=>el.getBoundingClientRect().width>150),'Privacy headings must not collapse to a narrow column');
    assert(await page.locator('.privacy-notice').evaluate(el=>el.scrollWidth<=el.clientWidth),'Privacy notice must not scroll sideways');
    await page.locator('.privacy-notice .modal-header .close-btn').click();
    // CAPTCHA appears before consent in both visual and keyboard reading order.
    assert(await page.evaluate(()=>document.getElementById('registration-captcha-section').compareDocumentPosition(document.querySelector('.privacy-agree'))&Node.DOCUMENT_POSITION_FOLLOWING));
    // Unknown identifiers stay on the request form and never show email-sent feedback.
    await page.getByRole('link',{name:'Forgot password?',exact:true}).click();
    for(const selector of ['#fp-send-btn','#forgot-step1 [data-action-click="shell-40"]']){
      const centered=await page.locator(selector).evaluate(button=>{const text=document.createRange();text.selectNodeContents(button);const a=button.getBoundingClientRect(),b=text.getBoundingClientRect();return Math.abs((a.left+a.right-b.left-b.right)/2)<2;});
      assert(centered,'Reset actions must have centered labels');
    }
    await page.locator('#fp-identifier').fill('not-registered@example.test');await page.locator('#fp-send-btn').click();
    await page.locator('#fp-err').getByText('No CampusCare account matches that username or email.',{exact:true}).waitFor();
    assert(await page.locator('#forgot-step1').isVisible());assert(!await page.locator('#forgot-step2').isVisible());
    await page.evaluate(()=>window.__fixtureApp.features.passwordRecovery.closeForgotPassword());
    await page.locator('#login-section').getByRole('link',{name:'Create an account',exact:true}).click();
    assert.equal(await page.locator('#auth-mode-title').innerText(),'Create an account');
    assert.equal(await page.locator('.auth-tab').count(),0,'Forms use headings, not tabs');
    await scrollDown();
    await page.locator('#r-ptype').selectOption('Teaching Personnel');
    await page.waitForFunction(()=>document.getElementById('r-verification-label').textContent.includes('Employee ID — Front and Back'));
    await page.locator('#r-ptype').selectOption('Student');
    await page.waitForFunction(()=>document.getElementById('r-verification-label').textContent.includes('Student ID — Front and Back'));
    // Populate a valid registration and an OCR name mismatch at the requested 25% boundary.
    const fields={'r-fname':'Fixture','r-lname':'Student','r-user':'fixture.student','r-email':'fixture@example.test','r-pass':'Clinic-only-Pass1!','r-pass2':'Clinic-only-Pass1!','r-idno':'1234567'};
    for(const [id,value]of Object.entries(fields))await page.locator('#'+id).fill(value);
    await page.locator('#r-college').selectOption({index:0});await page.locator('#r-sex').selectOption('Male');
    await page.evaluate(()=>{
      // The date picker stores its chosen date in a hidden field.
      document.getElementById('r-dob').value='2000-01-01';
      Object.assign(window.__fixtureApp.state.documentScanner,{lastOcrRawText:'Unclear printed document',lastOcrConfidence:25,lastOcrDocumentType:'Document'});
      window.__fixtureApp.features.documentScanner.recheckNameMatch();
    });
    assert.equal(await page.locator('#id-analyze-status').count(),0,'OCR technical results must not be rendered');
    assert.equal(await page.locator('#r-selfie-file').count(),0,'Selfie file upload must be unavailable');
    await page.locator('#r-privacy-consent').check();
    await page.locator('#registration-submit-button').click();
    await page.locator('#r-selfie-error').getByText('Use the camera to take a verification selfie while holding the ID you will upload.',{exact:true}).waitFor();
    assert(await page.locator('#r-fname-error').isHidden(),'Valid fields must not show errors');
    assert(!requests.some(request=>request.path.endsWith('/register-patient')&&request.method==='POST'),'Missing camera selfie must block submission');
    await page.locator('#selfie-camera-button').click();
    await page.getByRole('button',{name:'Start Camera',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('camera-video')?.readyState>=2);
    assert(await page.locator('#camera-video').evaluate(video=>getComputedStyle(video).transform.includes('-1')),'Selfie preview should mirror the front camera');
    await page.locator('#camera-mirror-preview').uncheck();assert.equal(await page.locator('#camera-video').evaluate(video=>getComputedStyle(video).transform),'none');
    await page.locator('#camera-mirror-preview').check();
    for(const ratio of ['4/3','3/4']){
      await page.locator('#selfie-stage').evaluate((stage,ratio)=>stage.style.aspectRatio=ratio,ratio);
      const shape=await page.locator('.selfie-guide-square').evaluate(oval=>{const r=oval.getBoundingClientRect();return r.width/r.height;});
      assert(Math.abs(shape-.76)<.03,'Face guide keeps a comfortable oval in either camera orientation');
      assert.equal(await page.locator('.selfie-id-guide').count(),1,'ID has a separate fixed guide');
    }
    await page.locator('#selfie-stage').evaluate(stage=>stage.style.aspectRatio='4/3');
    if(mobile){
      await page.waitForFunction(()=>document.getElementById('selfie-stage')?.dataset.inference==='main');
      await page.getByText('Position your face inside the face guide',{exact:true}).waitFor();
      assert(await page.locator('#camera-capture-button').isDisabled());
      assert(await page.locator('#selfie-manual-button').isHidden(),'Compatibility checks must not allow an unchecked selfie');
      // Remaining registration scenarios use synthetic approved evidence, not a camera bypass.
      await page.evaluate(()=>{const canvas=document.getElementById('camera-canvas');canvas.width=320;canvas.height=240;window.__fixtureApp.state.camera.capturedSelfieDataUrl=canvas.toDataURL();document.getElementById('r-selfie-preview-wrap').innerHTML='<img alt="Synthetic test evidence" src="'+canvas.toDataURL()+'">';window.__fixtureApp.features.camera.stopCamera();window.__fixtureApp.features.modals.closeAllModals();});
    }else{
      await page.waitForFunction(()=>document.getElementById('selfie-stage')?.dataset.detector==='ready');
      await page.getByText('Position your face inside the face guide',{exact:true}).waitFor();
      // Actual fake-device color bars have no face; assert guidance before injecting known geometry.
      assert(await page.locator('#camera-capture-button').isDisabled());
      // Place the synthetic face inside the oval as drawn (the preview is mirrored, the camera frame is not).
      const oval=await page.locator('.selfie-guide-square').evaluate(el=>{const s=el.parentElement.getBoundingClientRect(),r=el.getBoundingClientRect();return {cx:1-((r.left+r.width/2)-s.left)/s.width,cy:(r.top-s.top+r.height*.55)/s.height};});
      const geometry={x:Math.round(oval.cx*640-86),y:Math.round(oval.cy*480-98),width:172,height:196,keypoints:[{x:.45,y:.3},{x:.55,y:.3},{x:.5,y:.35}]};
      await page.evaluate(data=>window.__fixtureGuidance=data,{faces:[{...geometry,x:20,y:250}],width:640,height:480,brightness:120,sharpness:80,documentVisible:true});
      await page.getByText('Move your face into the oval',{exact:true}).waitFor();
      assert(await page.locator('#camera-capture-button').isDisabled(),'A face outside the oval must block capture');
      const feed=async(changes,expected)=>{
        await page.evaluate(data=>window.__fixtureGuidance=data,{faces:[geometry],width:640,height:480,brightness:120,sharpness:80,documentVisible:true,...changes});
        await page.getByText(expected,{exact:true}).waitFor();
      };
      await feed({faces:[{...geometry,width:70,height:80}]},'Move closer so your face fills the oval');
      await feed({faces:[{...geometry,width:470,height:400}]},'Move back a little so your face fits the oval');
      await feed({brightness:25},'Move to brighter, even lighting');
      await feed({documentVisible:false},'Hold the front of your ID inside the ID box, with all corners visible');
      assert(await page.locator('#camera-capture-button').isDisabled(),'Face without a held document must block capture');
      await feed({},'Good position — keep your ID visible');
      assert(await page.locator('#camera-capture-button').isEnabled());
      if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/guided-selfie.png`,fullPage:true});
      await page.locator('#camera-capture-button').click();
    }
    await page.waitForFunction(()=>Boolean(window.__fixtureApp.state.camera.capturedSelfieDataUrl));
    assert(await page.locator('#r-selfie-preview-wrap img').isVisible());
    assert(await page.evaluate(()=>!window.__fixtureApp.state.camera._cameraStream),'Capture must stop the camera');
    // Retake may be canceled without losing the first capture; closing the backdrop must release tracks.
    await page.locator('#selfie-camera-button').click();
    await page.getByRole('button',{name:'Start Camera',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('camera-video')?.readyState>=2);
    await page.evaluate(()=>{window.__fixtureCameraTracks=window.__fixtureApp.state.camera._cameraStream.getTracks();document.getElementById('active-modal').click();});
    await page.waitForFunction(()=>window.__fixtureCameraTracks.every(track=>track.readyState==='ended'));
    // A denied permission offers browser guidance without exposing a selfie upload fallback.
    await page.evaluate(()=>{window.__fixtureGetUserMedia=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Permission denied','NotAllowedError');};});
    await page.locator('#selfie-camera-button').click();
    await page.getByRole('button',{name:'Start Camera',exact:true}).click();
    await page.getByText('Camera access was blocked. Allow camera access in this site’s settings. If you opened CampusCare inside Messenger or Facebook, open it in Safari or Chrome and retry.',{exact:true}).waitFor();
    await page.locator('#active-modal .modal-header .close-btn').click();
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=window.__fixtureGetUserMedia;});


    // Both ID sides are mandatory even after a successful selfie.
    await page.locator('#registration-submit-button').click();
    await page.locator('#r-id-error').getByText('Provide the front and back of your Student or Employee ID.',{exact:true}).waitFor();
    assert(!requests.some(request=>request.path.endsWith('/register-patient')&&request.method==='POST'));
    const front=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=640;c.height=480;const g=c.getContext('2d');g.fillStyle='#141414';g.fillRect(0,0,640,480);g.fillStyle='#ddd';g.fillRect(120,112,400,256);g.fillStyle='#222';g.font='24px sans-serif';g.fillText('STUDENT ID FRONT',145,190);return c.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#r-id-file').setInputFiles({name:'front.png',mimeType:'image/png',buffer:Buffer.from(front,'base64')});
    await page.getByRole('button',{name:'Use Front Photo',exact:true}).click();
    await page.getByText('Front saved — add the back',{exact:true}).waitFor();
    await page.locator('#active-modal').getByRole('button',{name:'Back to registration',exact:true}).click();
    assert.equal(await page.locator('.registration-id-panel').count(),1,'Only one ID panel should occupy the form');
    await page.getByText('Step 2 of 2 — Back of ID',{exact:true}).waitFor();
    assert.equal(await page.locator('#r-id-preview img').count(),0,'The back step should request a new image');
    await page.locator('#r-id-show-front').click();
    assert(await page.locator('#r-id-preview img[alt="ID front"]').isVisible());
    const framed=await page.locator('#r-id-preview').evaluate(preview=>{const frame=preview.getBoundingClientRect(),image=preview.querySelector('img').getBoundingClientRect();return image.height<=frame.height&&image.width<=frame.width;});
    assert(framed,'The single preview must show the whole image without intrinsic-size clipping');
    await page.locator('#r-id-show-back').click();
    await page.locator('#registration-submit-button').click();
    assert(!requests.some(request=>request.path.endsWith('/register-patient')&&request.method==='POST'),'One side must not reach registration');
    // A duplicate upload is rejected without replacing existing evidence.
    await page.locator('#r-id-back-file').setInputFiles({name:'back.png',mimeType:'image/png',buffer:Buffer.from(front,'base64')});
    await page.getByRole('button',{name:'Use Back Photo',exact:true}).click();
    await page.getByText('Use a different photo for the front and back of your ID.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Choose another photo',exact:true}).click();
    // Feed an actual canvas MediaStream to exercise ID boundary/quality detection end to end.
    await page.evaluate(()=>{
      window.__fixtureIdPose='far';
      navigator.mediaDevices.getUserMedia=async()=>{
        const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const g=canvas.getContext('2d');
        const draw=()=>{
          const pose=window.__fixtureIdPose;let x=60,y=56,w=200,h=128;
          if(pose==='far'){x=110;y=90;w=100;h=60;}
          if(pose==='missing'){w=0;h=0;}
          if(pose==='close'){x=2;y=20;w=316;h=200;}
          if(pose==='center'){x=165;y=56;w=140;h=90;}
          g.fillStyle=pose==='dark'?'#000':'#141414';g.fillRect(0,0,320,240);
          g.fillStyle=pose==='dark'?'#232323':'#c8c8c8';g.fillRect(x,y,w,h);
          g.fillStyle=pose==='dark'?'#000':'#222';g.font='12px sans-serif';if(pose!=='missing')g.fillText(window.__fixtureIdLabel||'ID BACK',x+15,y+30);
        };
        draw();const stream=canvas.captureStream(10),timer=setInterval(draw,100);
        stream.getTracks().forEach(track=>track.addEventListener('ended',()=>clearInterval(timer)));return stream;
      };
    });
    await page.locator('#r-id-camera-button').click();
    await page.getByText('ID visible — ready to capture',{exact:true}).waitFor();
    assert(await page.locator('#camera-capture-button').isEnabled(),'Main ID capture must allow distant or blurry frames');
    assert.equal(await page.locator('#selfie-manual-button').count(),0,'ID capture must not need a separate review action');
    await page.evaluate(()=>window.__fixtureIdPose='missing');
    await page.getByText('Place the ID inside the rectangle, with all four corners visible',{exact:true}).waitFor();
    assert(await page.locator('#camera-capture-button').isDisabled(),'An empty scene must not count as an ID');
    // Framing advice must not reduce capture to a one-frame opportunity on a soft mobile camera.
    for(const pose of ['close','center','good']){
      await page.evaluate(pose=>window.__fixtureIdPose=pose,pose);
      await page.getByText('ID visible — ready to capture',{exact:true}).waitFor();
      assert(await page.locator('#camera-capture-button').isEnabled());
    }
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/guided-id-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    await page.locator('#camera-capture-button').click();
    assert(await page.locator('#r-id-preview img[alt="ID back"]').isVisible());
    assert(await page.evaluate(()=>!window.__fixtureApp.state.camera._cameraStream));
    await page.locator('#r-id-camera-button').click();await page.evaluate(()=>window.__fixtureIdPose='far');
    await page.getByText('ID visible — ready to capture',{exact:true}).waitFor();
    await page.locator('#camera-capture-button').click();assert(await page.locator('#r-id-preview img[alt="ID back"]').isVisible());
    await page.evaluate(()=>window.__fixtureIdPose='good');
    // A front retake advances to the flip step; canceling the back retake keeps the saved back.
    await page.locator('#r-id-show-front').click();
    await page.evaluate(()=>window.__fixtureIdLabel='ID FRONT');
    await page.locator('#r-id-camera-button').click();
    await page.getByText('Good framing — keep the ID still',{exact:true}).waitFor();
    await page.locator('#camera-capture-button').click();
    await page.getByText('Front saved — flip your ID',{exact:true}).waitFor();
    await page.locator('#active-modal').getByRole('button',{name:'Photograph Back',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('camera-video')?.readyState>=2);
    await page.locator('#active-modal .modal-header .close-btn').click();
    assert(await page.locator('#r-id-preview img[alt="ID back"]').isVisible());
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=window.__fixtureGetUserMedia;});

    await page.evaluate(()=>window.scrollTo(0,document.scrollingElement.scrollHeight));
    const submit=await page.locator('#registration-submit-button').boundingBox();assert(submit.y>=0&&submit.y+submit.height<=640+(mobile?0:160),'Registration submit is clipped');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('.registration-id-panel').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/compact-id-${mobile?'mobile':'desktop'}.png`});
    if(!mobile){
      await page.locator('#registration-submit-button').click();
      await page.getByText('Complete the security check below before registering.',{exact:true}).waitFor();
      assert(!requests.some(request=>request.path.endsWith('/register-patient')&&request.method==='POST'));
      await page.locator('#fixture-captcha-solve').click();
      await page.evaluate(()=>window.__fixtureTurnstile['error-callback']());
      await page.locator('#registration-security-retry').waitFor({state:'visible'});
      if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#registration-captcha-section').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/security-retry.png`});
      const resets=await page.evaluate(()=>window.__fixtureCaptchaResets||0);
      await page.locator('#registration-security-retry').click();
      await page.waitForFunction(()=>document.getElementById('registration-captcha-section').dataset.state==='waiting');
      assert(await page.evaluate(previous=>(window.__fixtureCaptchaResets||0)>previous,resets));
      await page.locator('#fixture-captcha-solve').click();
      assert(await page.locator('#registration-security-retry').isHidden());
      await page.evaluate(()=>window.__fixtureTurnstile['expired-callback']());
      await page.locator('#registration-security-retry').waitFor({state:'visible'});
      await page.locator('#registration-submit-button').click();
      assert(!requests.some(request=>request.path.endsWith('/register-patient')&&request.method==='POST'),'Expired tokens must not submit');
      await page.locator('#fixture-captcha-solve').click();
      await page.locator('#registration-submit-button').click();
      await page.getByText('Too many registration attempts. Please wait 2 minutes before trying again.',{exact:true}).waitFor();
      assert(await page.locator('#reg-section').isVisible());
      assert(await page.evaluate(()=>window.__fixtureCaptchaResets>0));
      await page.locator('#fixture-captcha-solve').click();
    }else assert(await page.locator('#registration-captcha-section').isHidden(),'Unconfigured CAPTCHA must not pretend to be active');
    await page.locator('#registration-submit-button').click();await page.locator('#pending-section').waitFor({state:'visible'});
    // Pending verification follows the recovery layout: illustration, steps, one centered Close and no top exit.
    assert.equal(await page.locator('#pending-section .auth-illustration svg').count(),1);
    assert.equal(await page.locator('#pending-section .pending-steps li').count(),4);
    assert.equal(await page.locator('#pending-section .close-btn').count(),0);
    assert.equal(await page.locator('#pending-section').getByRole('button',{name:'Close',exact:true}).evaluate(el=>getComputedStyle(el).justifyContent),'center');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#pending-section').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/pending-${mobile?'mobile':'desktop'}.png`});
    assert(requests.some(request=>request.path.endsWith('/register-patient')&&request.method==='POST'),'OCR 25% must reach staff review submission');
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
  assert.equal(await page.getByRole('button',{name:'Book an Appointment',exact:true}).count(),1);
  await page.locator('.landing-book-appointment').click();
  assert.equal(await page.locator('#landing-navbar').evaluate(nav=>getComputedStyle(nav).backgroundColor),'rgb(10, 20, 32)');
  assert.equal(await page.locator('#auth-theme-toggle-btn').count(),0);
  await page.locator('#login-section').getByRole('button',{name:'Login',exact:true}).click();
  await page.locator('#toast-wrap .toast.error').getByText('Enter your username/email and password.',{exact:true}).waitFor();
  await page.locator('#li-user').fill(profile.email);await page.locator('#li-pass').fill('Fixture-only-password1!');
  await page.getByLabel('Remember me').check();
  await page.locator('#login-section').getByRole('button',{name:'Login',exact:true}).click();
  await page.locator('#app.visible').waitFor();
  await page.waitForFunction(role=>window.__fixtureApp.state.auth.currentUser?.role===role,role);
  // Date endpoints share one compact control; all app headers remain opaque in both themes.
  const rangeButton=page.getByRole('button',{name:/Select dashboard date range:/});
  await rangeButton.waitFor();assert.equal(await rangeButton.locator('.dashboard-range-endpoint').count(),2);
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    assert(await page.locator('.top-bar').evaluate(el=>!getComputedStyle(el).backgroundColor.startsWith('rgba')),'Top bar must be opaque');
  }
  // Stat cards are read-only summaries with a written trend instead of an unlabeled sparkline.
  assert.equal(await page.locator('.dashboard-a-stat').count(),4);
  assert.equal(await page.locator('.dashboard-a-stat[role="button"], .dashboard-a-stat .das-spark').count(),0,'Stat cards are not clickable and have no sparkline');
  assert.equal(await page.locator('.dashboard-a-stat .das-trend').count(),4);
  // Notification centre: solid panel, day sections, grouped repeats, Unread filter, click-through and Escape.
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.locator('#notif-btn').click();await page.locator('#notif-panel.show').waitFor();
    await page.waitForTimeout(150);
    await page.evaluate(()=>{
      const app=window.__fixtureApp,me=app.state.auth.currentUser,now=Date.now(),hour=36e5;
      const make=(id,title,body,ago,read,ref=null)=>({id,dbNotificationId:id,userId:me.id,title,body,type:'info',read,createdAt:new Date(now-ago*hour).toISOString(),referenceType:ref?'issue_reports':'',referenceId:ref,actionPage:'',_realSupabase:Boolean(me._realSupabase)});
      app.state.data.DB.notifications=[
        make(1,'New Reply on a CampusCare Report','A reporter replied to an existing issue thread.',1/60,false,7),
        make(2,'New Reply on a CampusCare Report','A reporter replied to an existing issue thread.',2/60,false,7),
        make(3,'Appointment Confirmed','Your appointment was confirmed.',3/60,true),
        make(4,'Low Stock Alert','Paracetamol is below its threshold.',30,false),
        make(5,'Certificate Issued','Your medical certificate is ready.',100,true)
      ];
      app.features.assistant.renderNotifList();
    });
    const panel=page.locator('#notif-panel');
    assert(!(await panel.evaluate(el=>getComputedStyle(el).backgroundColor)).startsWith('rgba'),'Notification panel must be opaque');
    assert((await panel.locator('.notif-section').allInnerTexts()).map(t=>t.toUpperCase()).join(',').startsWith('TODAY'));
    await panel.getByText('+1 more',{exact:false}).waitFor();
    assert.equal(await panel.locator('.notif-item').count(),4,'Two replies on one report collapse into one entry');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await panel.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/notifications-${theme}-${mobile?'mobile':'desktop'}.png`});
    await panel.getByRole('tab',{name:/Unread/}).click();
    assert(await panel.isVisible(),'Filtering keeps the panel open');
    assert.equal(await panel.locator('.notif-item').count(),2);
    await page.keyboard.press('Escape');
    assert(await panel.isHidden(),'Escape closes the panel');
    await page.evaluate(()=>window.__fixtureApp.features.assistant.setNotificationFilter('all'));
  }
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({fullPage:true,path:`${process.env.CAMPUSCARE_VISUAL_DIR}/workspace-range-${mobile?'mobile':'desktop'}.png`});
  await rangeButton.click();assert.equal(await page.locator('#active-modal').getByRole('button',{name:'Cancel',exact:true}).count(),0);
  await page.evaluate(()=>{const f=window.__fixtureApp.features.dashboardChartHelpers;f.chooseDashboardRangeDate('2026-10-14');f.chooseDashboardRangeDate('2026-10-20');});
  await page.getByRole('button',{name:'Apply Date Range',exact:true}).click();
  assert.match(await rangeButton.innerText(),/Oct 14, 2026/);
  if(['Patient','Staff','Administrator'].includes(role)){
    // Exercise real doctor/date/time clicks and draft restoration, with server requests intercepted.
    await page.evaluate(async()=>{await window.__fixtureApp.features.appointmentService.syncAppointmentContext();window.__fixtureApp.features.bookingForm.openBookApptModal();});
    assert.equal(await page.getByText(/Posted Medical Clinic hours/).count(),0);
    assert(await page.locator('#booking-modern-calendar .modern-calendar-day').first().isDisabled());
    assert.equal(await page.locator('#b-doc').inputValue(),'');
    await page.locator('#b-doc').selectOption('100002');
    await page.waitForFunction(()=>document.getElementById('b-doctor-note')?.textContent.startsWith('Next opening:'));
    assert.equal(await page.evaluate(()=>window.__fixtureApp.state.calendar.modernCalendarState['booking-modern-calendar'].viewMonth),page.__bookingDate.slice(0,7));
    assert.equal(await page.locator('#booking-modern-calendar .modern-calendar-day.available').count(),1);
    // Selecting an empty month redirects to the nearest opening instead of leaving a calendar to hunt through.
    await page.locator('#booking-modern-calendar select[aria-label="Month"]').selectOption(String(Number(addBookingDays(page.__bookingDate,-45).slice(5,7))));
    await page.locator('#booking-modern-calendar .modern-calendar-day.available').click();
    assert.equal(await page.locator('#b-date').inputValue(),page.__bookingDate);
    await page.locator('#slot-grid button[data-time="08:00"]').click();
    assert.equal(await page.locator('#b-time').inputValue(),'08:00');
    assert.equal(await page.locator('#slot-grid button.selected').getAttribute('aria-pressed'),'true');
    for(const time of ['09:00','10:00','12:00'])assert(await page.locator('#slot-grid button[data-time="'+time+'"]').isDisabled());
    assert.equal(await page.locator('#b-manage-slots').count(),0,'Slot management lives outside the booking form');
    if(role!=='Patient'){
      // Priority follows the chosen patient's record and cannot be edited.
      await page.evaluate(()=>{const {state,features}=window.__fixtureApp;const p=state.data.DB.patients.find(x=>x.id===200004)||state.data.DB.patients[0];features.datePicker.selectBookPatient(p.id);});
      assert(await page.locator('#b-priority').evaluate(el=>el.readOnly&&el.tagName==='INPUT'),'Priority is read-only');
      assert.match(await page.locator('#b-priority').inputValue(),/^(Student|Teaching|Non-Teaching)$/);
    }
    if(role!=='Patient')await page.locator('#b-pt').evaluate(el=>el.value='200004');
    await page.locator('#b-reason').fill('Synthetic booking flow verification');
    await page.getByRole('button',{name:'Save Draft',exact:true}).click();
    await page.locator('#active-modal .close-btn').click();
    await page.evaluate(()=>window.__fixtureApp.features.bookingForm.openBookApptModal());
    await page.getByRole('button',{name:'Restore Draft',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('b-time')?.value==='08:00');
    await page.getByRole('button',{name:'Confirm Booking',exact:true}).click();
    await page.waitForFunction(()=>!document.getElementById('b-time'));
    if(role==='Patient'){
      // Patients get a confirmation that asks for a signed COR; staff get a toast reminder instead.
      await page.locator('.booking-done').waitFor();
      assert.match(await page.locator('.booking-done .cor-reminder').innerText(),/signed/i);
      assert.equal(await page.locator('.booking-done .cor-checklist li').count(),3);
      if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('.booking-done').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/booking-done-${mobile?'mobile':'desktop'}.png`});
      await page.getByRole('button',{name:'Got it',exact:true}).click();
    }else{
      const reminder=page.locator('#toast-wrap .toast',{hasText:/signed COR/});
      await reminder.waitFor();
      assert.equal(await reminder.locator('.toast-close').count(),1,'Toasts can be dismissed');
      if(process.env.CAMPUSCARE_VISUAL_DIR&&role==='Staff')await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/toast-${mobile?'mobile':'desktop'}.png`});
      await reminder.locator('.toast-close').click();
      await page.waitForFunction(()=>![...document.querySelectorAll('#toast-wrap .toast')].some(t=>/signed COR/.test(t.textContent)&&!t.classList.contains('leaving')));
    }
    if(['Staff','Administrator'].includes(role)){
      // Time slots are managed from the Appointments page: pick a doctor and a day, toggle times, save.
      await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('appointments'));
      page.__wideAvailability=true;
      await page.locator('#appt-manage-slots').click();
      await page.locator('.slot-manager-modal').waitFor();
      assert(await page.locator('#slot-manager-save').isDisabled());
      const doctorId=await page.evaluate(()=>String(window.__fixtureApp.state.data.DB.users.find(u=>u.role==='Doctor'&&u._realSupabase).id));
      await page.locator('#sm-doc').selectOption(doctorId);
      await page.locator('#sm-calendar .modern-calendar-day.available').first().click();
      await page.locator('#slot-manager-grid .slot-toggle').first().waitFor();
      assert(await page.locator('.slot-toggle.locked').first().isDisabled(),'Booked times cannot be changed');
      await page.locator('.slot-toggle',{hasText:'11:00'}).click();
      assert.match(await page.locator('#slot-manager-summary').innerText(),/1 unsaved change/);
      // A custom time outside the regular grid, then the same pattern on the next same weekdays.
      await page.locator('#sm-custom-time').fill('07:30');
      await page.locator('.sm-custom').getByRole('button',{name:'Add'}).click();
      assert.match(await page.locator('#slot-manager-grid .slot-toggle').first().innerText(),/7:30 AM[\s\S]*Custom time/);
      await page.locator('#sm-batch-toggle').click();
      await page.locator('.sm-batch').getByRole('button',{name:/Next 4/}).click();
      const extra=await page.locator('.sm-chip').count();
      assert(extra>=1,'Same weekdays are added to the batch');
      assert.equal(await page.locator('#slot-manager-save').innerText(),`Save to ${extra+1} dates`);
      if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('.slot-manager-modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/slot-manager-${mobile?'mobile':'desktop'}.png`});
      const before=requests.length;
      await page.locator('#slot-manager-save').click();
      await page.locator('#slot-manager-summary').filter({hasNotText:'unsaved'}).waitFor();
      const saves=requests.slice(before).filter(r=>r.path.endsWith('/appointment-actions')&&r.body?.action==='manage_slots');
      assert.equal(saves.length,extra+1,'One save per selected date');
      for(const save of saves){
        assert(save.body.slots.some(x=>x.time==='11:00'&&x.is_available===false),'Closing a time sends it as unavailable');
        assert(save.body.slots.some(x=>x.time==='07:30'&&x.is_available===true),'Custom times are saved as open');
      }
      assert(await page.locator('.slot-manager-modal').isVisible(),'The manager stays open for the next day');
      page.__wideAvailability=false;
      await page.locator('.slot-manager-modal .close-btn').click();
    }
    assert(requests.some(request=>request.path.endsWith('/appointment-actions')&&request.body?.action==='create'),'A real slot click must reach the booking API');
  }
  await page.evaluate(()=>window.__fixtureApp.features.accountSettings.openProfileDetails());
  assert.equal(await page.locator('#active-modal .modal-header .close-btn').count(),1);
  assert.equal(await page.locator('#active-modal').getByRole('button',{name:/Change password/}).count(),1);
  if(process.env.CAMPUSCARE_VISUAL_DIR&&!mobile)await page.locator('#active-modal .modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/profile-${role}.png`});
  assert.equal(await page.locator('#active-modal .modal-footer').getByRole('button',{name:'Close',exact:true}).count(),0);
  await page.locator('#active-modal .close-btn').click();
  if(role==='Doctor'){
    // Certificates: doctors write, sign and issue them; only the three purposes are offered.
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('cert-requests'));
    await page.getByRole('button',{name:'+ New Certificate'}).click();
    assert.deepEqual(await page.locator('#nc-purpose option').evaluateAll(o=>o.map(x=>x.value)),['OJT / Internship Requirement','Excused Absence','Sports / Athletics Participation']);
    await page.getByRole('button',{name:'Continue to document'}).click();
    assert(await page.locator('#nc-pt-error').isVisible());
    await page.locator('#nc-purpose').selectOption('Excused Absence');
    assert.equal(await page.locator('#nc-absentFrom').count(),1);
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#active-modal .modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/certificate-new-${mobile?'mobile':'desktop'}.png`});
    await page.locator('#active-modal .close-btn').click();
    // Fitness assessment: screening questions gate the decision.
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('fitness'));
    await page.getByRole('button',{name:'+ New Assessment'}).click();
    assert.equal(await page.locator('#fit-screening .fit-screen-row').count(),9);
    await page.locator('input[name="fit-q-syncope"][value="yes"]').check();
    assert(await page.locator('#fit-screen-warning').isVisible());
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#active-modal .modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/fitness-form-${mobile?'mobile':'desktop'}.png`});
    await page.locator('#active-modal .close-btn').click();
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('treatments'));
    await page.locator('#tr-summary').waitFor();
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/treatments-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  }
  if(role==='Administrator'){
    // Request rows open a review with the requester, the change, the reason and the supporting file.
    await page.evaluate(()=>{window.__fixtureApp.state.userManagement.tab='requests';window.__fixtureApp.features.navigationRaceProtection.navTo('users');});
    await page.locator('tr.req-row').first().waitFor();
    assert.equal(await page.locator('tr.req-row .req-attach-badge').count(),1);
    await page.locator('tr.req-row').first().click();
    await page.locator('.req-review').waitFor();
    assert.match(await page.locator('.req-review').innerText(),/Scheduled minor procedure/);
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('.req-review').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/request-review-${mobile?'mobile':'desktop'}.png`});
    await page.locator('.req-review .req-attach-view').click();
    await page.locator('#preview-img').waitFor();
    await page.locator('#active-modal .close-btn').click();
    await page.locator('.req-review').waitFor();
    await page.locator('#req-review-note').fill('Approved, get well soon');
    await page.locator('.req-review').getByRole('button',{name:'Approve',exact:true}).click();
    await page.locator('#cc-confirm-ok-btn').click();
    await page.waitForFunction(()=>!document.getElementById('cc-confirm-ok-btn'));
    await page.waitForTimeout(300);
    const decision=requests.filter(r=>r.path.endsWith('/workflow-actions')&&r.body?.action==='decision').at(-1);
    assert.equal(decision?.body.admin_note,'Approved, get well soon');
    assert.equal(decision.body.request_id,9);
    // Action buttons inside a row act directly without opening the review.
    await page.locator('tr.req-row').first().getByRole('button',{name:'Reject',exact:true}).click();
    assert.equal(await page.locator('.req-review').count(),0);
    await page.evaluate(()=>{window.__fixtureApp.features.modals.closeAllModals();window.__fixtureApp.state.userManagement.tab='users';});
    // Doctor schedules: a weekly coverage board, and an editor that checks bookings before applying.
    await page.evaluate(()=>{window.__fixtureApp.state.userManagement.tab='schedules';window.__fixtureApp.features.navigationRaceProtection.navTo('users');});
    await page.locator('tr.dsb-row').first().waitFor();
    await page.waitForFunction(()=>document.querySelector('tr.dsb-row')?.querySelectorAll('.dsb-cell.work').length===5);
    assert.match(await page.locator('tr.dsb-row').first().innerText(),/8 AM\s*to\s*5 PM/);
    if(!mobile)assert(await page.locator('.dsb-table').evaluate(t=>t.parentElement.scrollWidth<=t.parentElement.clientWidth+1),'Coverage grid fits without sideways scrolling');
    assert.equal(await page.locator('.dsb-stat').count(),4);
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/doctor-schedules-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    await page.locator('tr.dsb-row').first().click();
    await page.locator('.dse-modal').waitFor();
    assert.equal(await page.locator('#dse-max').inputValue(),'9','A daily limit above the available slots is lowered to fit');
    assert(await page.locator('#dse-save').isDisabled(),'Nothing to save until something changes');
    await page.locator('.dse-day[data-day="Sat"] .dse-switch').click();
    await page.locator('.dse-day[data-day="Sat"] .dse-end').fill('12:00');
    assert.match(await page.locator('.dse-day[data-day="Sat"] .dse-slots').innerText(),/4 slots · 4 patients max/);
    assert.match(await page.locator('#dse-summary').innerText(),/reason/i);
    // The date picker opens over the editor and returns to it with the edits intact.
    await page.locator('#dse-reason').fill('Saturday clinic for exams');
    await page.locator('.dse-modal .modern-date-btn').first().click();
    await page.locator('#campus-single-date-calendar').waitFor();
    await page.locator('#active-modal .close-btn').click();
    await page.locator('.dse-modal').waitFor();
    assert.equal(await page.locator('#dse-reason').inputValue(),'Saturday clinic for exams');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('.dse-modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/schedule-editor-${mobile?'mobile':'desktop'}.png`});
    await page.locator('#dse-save').click();
    await page.locator('#dse-apply').click();
    await page.waitForFunction(()=>!document.querySelector('.dse-modal'));
    const preview=requests.filter(r=>r.path.endsWith('/workflow-actions')&&r.body?.action==='preview_schedule').at(-1);
    const update=requests.filter(r=>r.path.endsWith('/workflow-actions')&&r.body?.action==='admin_schedule_update').at(-1);
    assert(preview,'Bookings are checked before saving');
    assert.equal(update.body.max_patients,9);
    assert.deepEqual(update.body.weekly_schedule.find(d=>d.day==='Sat'),{day:'Sat',is_working:true,start_time:'08:00',end_time:'12:00',slot_duration:60,max_patients:4});
    assert.equal(update.body.weekly_schedule.find(d=>d.day==='Mon').max_patients,9);
    await page.evaluate(()=>{window.__fixtureApp.state.userManagement.tab='users';});
    // Add staff account: role cards, registration rules inline, a review step, then sign-in details.
    await page.evaluate(()=>window.__fixtureApp.features.userForm.openAddUserModal());
    await page.locator('.au-modal').waitFor();
    assert.equal(await page.locator('.au-role').count(),3);
    assert(await page.locator('#au-doctor').isVisible(),'Doctors choose a specialty');
    await page.locator('.au-role',{hasText:'Staff'}).click();
    assert(await page.locator('#au-doctor').isHidden());
    await page.getByRole('button',{name:'Review account'}).click();
    assert(await page.locator('#au-fname-error').isVisible());assert(await page.locator('#au-email-error').isVisible());
    await page.locator('#au-fname').fill('Ma. Clara');await page.locator('#au-lname').fill('Dela Cruz');
    await page.locator('#au-user').fill('mclara');
    await page.locator('#au-email').fill('mclara@gmial.com');await page.locator('#au-email').blur();
    await page.locator('#au-email-error').getByRole('button',{name:'Use @gmail.com'}).click();
    assert.equal(await page.locator('#au-email').inputValue(),'mclara@gmail.com');
    await page.locator('#au-contact').fill('12345');await page.locator('#au-contact').blur();
    assert(await page.locator('#au-contact-error').isVisible());
    await page.locator('#au-contact').fill('+639171234567');
    assert(await page.locator('#au-contact-error').isHidden());
    assert.match(await page.locator('#au-generated').innerText(),/^\S{14}$/);
    await page.locator('.au-pw-modes label',{hasText:'Set a password'}).click();
    await page.locator('#au-pass').fill('weakpass');await page.locator('#au-pass').blur();
    assert.match(await page.locator('#au-pass-error').innerText(),/uppercase/);
    await page.locator('#au-pass').fill('Clinic2026!x');await page.locator('#au-pass2').fill('Clinic2026!y');await page.locator('#au-pass2').blur();
    assert.match(await page.locator('#au-pass2-error').innerText(),/do not match/);
    await page.locator('#au-pass2').fill('Clinic2026!x');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('.au-modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/add-user-${mobile?'mobile':'desktop'}.png`});
    await page.getByRole('button',{name:'Review account'}).click();
    await page.locator('#au-review').getByText('Check the new account').waitFor();
    await page.getByRole('button',{name:'Create account'}).click();
    await page.locator('.au-done').waitFor();
    const created=requests.filter(r=>r.path.endsWith('/admin-users')&&r.body?.action==='create').at(-1);
    assert.equal(created.body.role,'Staff');assert.equal(created.body.contact_number,'09171234567');
    assert.equal(created.body.password,'Clinic2026!x');assert.equal(created.body.specialty,null);
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('.au-modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/add-user-done-${mobile?'mobile':'desktop'}.png`});
    await page.getByRole('button',{name:'Done'}).click();
    await page.evaluate(()=>window.__fixtureApp.features.loginLockout.openPrivacyNotice());
    await page.locator('.privacy-notice .pn-rights').waitFor();
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('.privacy-notice').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/privacy-${mobile?'mobile':'desktop'}.png`});
    await page.locator('.privacy-notice').getByRole('button',{name:'I understand'}).click();
    // Fitness assessments are doctor-only: no menu entry, and the page redirects to the dashboard.
    assert.equal(await page.locator('#nav-fitness').count(),0);
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('fitness'));
    await page.waitForFunction(()=>window.__fixtureApp.state.navigationRaceProtection.campusActivePageId==='dashboard');
    // Clinic-side cancellation: a reason the patient sees, then typing CANCEL to confirm.
    await page.evaluate(()=>{const {state,features}=window.__fixtureApp;const pt=state.data.DB.patients.find(p=>p._realSupabase)||state.data.DB.patients[0];const doc=state.data.DB.users.find(u=>u.role==='Doctor'&&u._realSupabase);
      state.data.DB.appointments.push({id:990077,dbAppointmentId:77,_realSupabase:true,patientId:pt.id,doctorId:doc?.id,clinic:'Medical Clinic',service:'General Checkup',date:'2026-12-01',time:'09:00',status:'Scheduled'});
      features.appointments.cancelAppt(990077);});
    await page.locator('.cancel-flow').waitFor();
    assert(await page.locator('#cancel-next').isDisabled(),'A reason is required');
    await page.locator('#cancel-reason-choice').selectOption('Doctor unavailable');
    await page.locator('#cancel-appt-reason').fill('Please rebook next week.');
    await page.locator('#cancel-next').click();
    assert(await page.locator('#cancel-final').isDisabled(),'Typing CANCEL is required');
    await page.locator('#cancel-confirm-text').fill('cancel');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('.cancel-flow').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/cancel-confirm-${mobile?'mobile':'desktop'}.png`});
    await page.locator('#cancel-final').click();
    await page.waitForFunction(()=>!document.querySelector('.cancel-flow'));
    await page.waitForTimeout(300);
    const cancelled=requests.filter(r=>r.path.endsWith('/appointment-actions')&&r.body?.action==='cancel').at(-1);
    assert.equal(cancelled.body.appointment_id,77);assert.equal(cancelled.body.reason,'Doctor unavailable. Please rebook next week.');
    // Inventory forecast: 3 months by default, presets and custom days (7–365), a plan column and a CSV with options.
    await page.evaluate(()=>{
      const {state,features}=window.__fixtureApp,today=state.clinicInformation.TODAY,anchor=features.predictiveAnalytics.healthAnalyticsAnchorDate().date,back=n=>{const d=new Date(anchor+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);};
      state.data.DB.inventory=[{id:500001,dbItemId:1,_realSupabase:true,name:'Gauze pads',category:'Supplies',qty:100,threshold:20,unit:'pcs',unitCost:2}];
      state.data.DB.inventoryTransactions=[{id:1,_realSupabase:true,itemId:500001,type:'Disbursement',qty:5,date:back(3)}];
      state.data.DB.inventoryForecasts=[{itemId:500001,forecastMonth:today.slice(0,7)+'-01',predictedUsage:150}];
      state.inventoryList.forecastDays=undefined;
      document.getElementById('app-content').innerHTML='<div id="inv-forecast"></div>';
      document.getElementById('inv-forecast').innerHTML=features.inventoryService.forecastSectionHtml();
    });
    assert.equal(await page.locator('.fc-preset.active').innerText(),'3 months');
    assert.match(await page.locator('.forecast-table thead').innerText(),/Plan for 3 months/);
    assert.match(await page.locator('.fc-plan').innerText(),/Order \d+ pcs/);
    await page.locator('.fc-preset',{hasText:'30 days'}).click();
    assert.equal(await page.locator('.forecast-table thead th').count(),7,'Item, five weeks and the plan');
    await page.locator('#fc-days').fill('400');await page.locator('#fc-days').press('Enter');
    assert.match(await page.locator('.forecast-table thead').innerText(),/Plan for 1 year/);
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#inv-forecast').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/inventory-forecast-${mobile?'mobile':'desktop'}.png`});
    await page.locator('.fc-preset',{hasText:'3 months'}).click();
    await page.getByRole('button',{name:'Download CSV'}).click();
    await page.locator('.fc-csv').waitFor();
    await page.locator('input[name="fc-layout"][value="detailed"]').check();
    await page.locator('input[name="fc-col"][value="category"]').uncheck();
    const [forecastCsv]=await Promise.all([page.waitForEvent('download'),page.locator('.fc-csv').getByRole('button',{name:'Download',exact:true}).click()]);
    assert.match(forecastCsv.suggestedFilename(),/^campuscare-inventory-forecast-90-days-from-\d{4}-\d{2}-\d{2}\.csv$/);
    const forecastText=(await import('node:fs')).readFileSync(await forecastCsv.path(),'utf8');
    assert(forecastText.startsWith('\ufeff'),'UTF-8 marker for Excel');
    const forecastLines=forecastText.slice(1).trimEnd().split('\r\n');
    assert.match(forecastLines[0],/^Item,Item #,Unit,Quantity on hand,Reorder level,Period start,Period end,Projected use,Stock left at period end$/);
    assert(forecastLines.length>=4,'One row per item per month');
    // Use synthetic registration images to exercise the real review/preview controls without patient data.
    await page.evaluate(()=>{
      const {state,features}=window.__fixtureApp,canvas=document.createElement('canvas');canvas.width=40;canvas.height=60;
      canvas.getContext('2d').fillRect(0,0,40,60);const photo=canvas.toDataURL('image/jpeg');
      state.approvalQueue.realPendingApprovals=[{user_id:77,first_name:'Review',last_name:'Fixture',person_type:'Student',verification_document_type:'Student ID',id_file_url:'id-front.jpg',selfie_verification_signed_url:photo,verification_signed_url:photo,verification_back_signed_url:photo}];
      features.approvalQueue.reviewApproval(77);window.__reviewNode=document.getElementById('active-modal');
    });
    for(const [label,method]of [['Open Selfie','close'],['Open ID Front','escape'],['Open ID Back','backdrop']]){
      await page.getByRole('button',{name:label,exact:true}).click();
      await page.locator('#preview-img').waitFor();
      if(method==='close')await page.locator('#active-modal .close-btn').click();
      if(method==='escape')await page.keyboard.press('Escape');
      if(method==='backdrop')await page.locator('#active-modal').evaluate(el=>el.click());
      await page.locator('.approval-review-modal').waitFor();
      assert(await page.evaluate(()=>document.getElementById('active-modal')===window.__reviewNode),'Preview must return to the original review dialog');
      assert(await page.getByRole('button',{name:'Approve Registration',exact:true}).isVisible());
    }
    // Approval needs every checklist point confirmed first.
    const approveButton=page.getByRole('button',{name:'Approve Registration',exact:true});
    assert(await approveButton.isDisabled());
    for(const box of await page.locator('#ap-checklist input[type=checkbox]').all())await box.check();
    assert(await approveButton.isEnabled());
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#active-modal .modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/approval-review-${mobile?'mobile':'desktop'}.png`});
    // Rejecting needs a reason; the confirm button stays disabled until one is chosen.
    await page.getByRole('button',{name:'Reject…',exact:true}).click();
    const rejectConfirm=page.getByRole('button',{name:'Reject registration',exact:true});
    assert(await rejectConfirm.isDisabled());
    await page.getByLabel('Other reason').check();assert(await rejectConfirm.isDisabled());
    await page.locator('#reject-reason-text').fill('Please retake the back photo.');assert(await rejectConfirm.isEnabled());
    await page.getByRole('button',{name:'Back to review',exact:true}).click();
    await page.locator('.approval-review-modal').waitFor();
    await page.locator('#active-modal .close-btn').click();
    await page.evaluate(()=>{
      const {state,features}=window.__fixtureApp,base=state.approvalQueue.realPendingApprovals[0];
      const day=d=>new Date(Date.now()-d*864e5).toISOString();
      state.approvalQueue.realPendingApprovals=[{...base,user_id:77,email:'review@gmail.com',id_number:'1350098',college:'CCICT',email_confirmed_at:day(1),created_at:day(3)},{...base,user_id:78,first_name:'Ana',last_name:'Reyes',email:'ana@gmail.com',person_type:'Non-Teaching Personnel',college:'Registrar',id_number:'123',verification_back_signed_url:null,created_at:day(0.2)}];
      features.approvalQueue.renderApprovals(false);
    });
    await page.locator('.approval-table').waitFor();
    assert.equal(await page.locator('.approval-table .approval-row').count(),2);
    assert.match(await page.locator('.approval-table .approval-row').first().innerText(),/Fixture, Review/);
    assert(await page.locator('.approval-flag',{hasText:'Email not confirmed'}).count());
    await page.locator('#ap-ptype').selectOption('Non-Teaching Personnel');assert.equal(await page.locator('#ap-unit option').first().innerText(),'All Departments');
    assert.equal(await page.locator('.approval-table .approval-row').count(),1);
    await page.locator('#ap-ptype').selectOption('');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/approvals-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    // A theme picked with the toggle survives a reload.
    if(!mobile){
      const before=await page.evaluate(()=>document.documentElement.dataset.theme||'light');
      await page.locator('#theme-toggle-btn').click();
      const chosen=before==='dark'?'light':'dark';
      assert.equal(await page.evaluate(()=>localStorage.getItem('campuscare-theme')),chosen);
      await page.reload();await page.waitForFunction(()=>Boolean(window.__fixtureApp));
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme||'light'),chosen);
      await page.evaluate(()=>localStorage.removeItem('campuscare-theme'));
    }
  }
  if(role==='Administrator'&&!mobile){
    // Signed-in devices list each session; other devices can be signed out one by one.
    await page.evaluate(()=>{
      const client=window.__fixtureApp.state.supabaseClient.supabaseClient,now=Date.now();
      window.__revoked=[];window.__realRpc=client.rpc;
      client.rpc=async(name,args)=>{
        if(name==='revoke_my_session'){window.__revoked.push(args.target);return {data:true,error:null};}
        return {data:[
          {id:'a',current:true,user_agent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',ip:'203.0.113.4',created_at:new Date(now-864e5).toISOString(),last_active_at:new Date(now).toISOString()},
          {id:'b',current:false,user_agent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',ip:'198.51.100.7',created_at:new Date(now-5*864e5).toISOString(),last_active_at:new Date(now-2*864e5).toISOString()}
        ].filter(r=>!window.__revoked.includes(r.id)),error:null};
      };
    });
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('my-account'));
    const devices=page.locator('#acc-devices .device-row');await devices.first().waitFor();
    await page.waitForTimeout(800);await devices.first().waitFor();
    assert.equal(await devices.count(),2);
    assert.match(await devices.first().innerText(),/Chrome on Windows[\s\S]*This device/);
    assert.match(await devices.nth(1).innerText(),/Safari on iOS/);
    if(process.env.CAMPUSCARE_VISUAL_DIR){await page.evaluate(()=>document.getElementById('acc-devices').scrollIntoView({block:'center'}));const box=await page.locator('#acc-devices').boundingBox();await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/devices.png`,clip:{x:box.x-10,y:box.y-60,width:box.width+20,height:box.height+70}});}
    await devices.nth(1).getByRole('button',{name:'Sign out'}).click();await page.locator('#cc-confirm-ok-btn').click();
    await page.waitForFunction(()=>document.querySelectorAll('#acc-devices .device-row').length===1);
    // Mismatched passwords are flagged beside the confirmation field.
    await page.locator('#pw-new').fill('NewPass123');await page.locator('#pw-conf').fill('NewPass12x');
    assert.equal(await page.locator('#pw-conf-error').innerText(),'Passwords do not match.');
    await page.locator('#pw-conf').fill('NewPass123');assert(await page.locator('#pw-conf-error').isHidden());
    assert.equal(await page.locator('#pw-cooldown-note.alert-info').count(),0);
    await page.evaluate(()=>{const client=window.__fixtureApp.state.supabaseClient.supabaseClient;client.rpc=window.__realRpc;});
  }
  if(process.env.CAMPUSCARE_VISUAL_DIR&&role==='Administrator'&&!mobile){
    for(const route of ['inventory','users','survey-results','feedback-issues','settings','activity-log','my-account']){
      await page.evaluate(route=>window.__fixtureApp.features.navigationRaceProtection.navTo(route),route);
      await page.waitForTimeout(400);
      await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/admin-${route}.png`,fullPage:true});
    }
  }
  if(role==='Administrator'&&!mobile){
    // Feedback & Issues works like a helpdesk: queue stats, priority order, bulk selection and a thread with internal notes.
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('feedback-issues'));
    await page.locator('#fi-list').waitFor();
    await page.evaluate(()=>{
      const {state,features}=window.__fixtureApp,me=state.auth.currentUser,now=Date.now(),h=36e5;
      const iso=ago=>new Date(now-ago*h).toISOString();
      state.data.DB.issueReports=[
        {id:1400001,dbIssueId:1,reporterId:me.id,reporterName:'Ana Reyes',reporterRole:'Patient',type:'Bug',page:'Appointments',description:'Booking page freezes after choosing a date\nIt spins forever.',status:'Open',priority:'Normal',deviceInfo:'Chrome 141 · Windows · 1920×1080',replies:[],createdAt:iso(30),_realSupabase:true},
        {id:1400002,dbIssueId:2,reporterId:me.id,reporterName:'Ben Cruz',reporterRole:'Staff',type:'Suggestion',page:'Inventory',description:'Add barcode scanning',status:'In Review',priority:'Urgent',replies:[{authorRole:'Administrator',authorName:'Admin',body:'Checking with the team.',internal:true,createdAt:iso(5)}],createdAt:iso(10),_realSupabase:true},
        {id:1400003,dbIssueId:3,reporterId:me.id,reporterName:'Cy Lim',reporterRole:'Patient',type:'Feedback',description:'Nice update',status:'Resolved',priority:'Low',resolvedAt:iso(2),replies:[{authorRole:'Administrator',authorName:'Admin',body:'Thanks!',createdAt:iso(3)}],createdAt:iso(8),_realSupabase:true}
      ];
      features.issueReports.renderFeedbackIssuesList();
    });
    const rows=page.locator('#fi-list div.fi-row');
    assert.equal(await rows.count(),2,'Needs action lists open reports only');
    assert.match(await rows.first().innerText(),/Add barcode scanning[\s\S]*Urgent/,'Urgent reports come first');
    await rows.first().locator('.fi-select').check();
    assert.match(await page.locator('#fi-bulk').innerText(),/1 selected/);
    await rows.first().locator('.fi-open').click();
    await page.locator('#issue-thread .fi-side').waitFor();
    assert.match(await page.locator('#issue-thread .fi-msg.internal').innerText(),/Internal note/);
    await page.locator('#fi-composer .seg button[data-mode="internal"]').click();
    assert.equal(await page.locator('#fi-composer').getAttribute('data-mode'),'internal');
    assert(await page.locator('#issue-reply-resolve-btn').isHidden(),'Internal notes cannot resolve the report');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/feedback-thread.png`});
    await page.locator('#issue-thread .close-btn').click();
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/feedback-queue.png`,fullPage:true});
  }
  // Walk every visible role route through its actual generated click callback.
  const navIds=await page.locator('#sidebar nav [id^="nav-"]').evaluateAll(elements=>elements.map(element=>element.id));
  assert(navIds.length>0);assert(!navIds.includes('nav-task-center'));
  for(const id of navIds){
    await page.evaluate(id=>document.getElementById(id).click(),id);
    await page.waitForTimeout(120);
    assert(await page.locator('#app-content').innerHTML(),`${role}: empty ${id}`);
  }
  // Messages is not part of CampusCare: no navigation entry, and old links land on the dashboard.
  assert(!navIds.includes('nav-messages'),`${role}: Messages must not be in the sidebar`);
  await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('messages'));
  await page.waitForFunction(()=>window.__fixtureApp.state.navigationRaceProtection.campusActivePageId==='dashboard');
  assert.equal(await page.locator('#msgr-shell').count(),0);
  if(['Staff','Administrator'].includes(role)){
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('patients'));
    await page.locator('#pt-session').waitFor();
    await page.evaluate(()=>{
      const {state,features}=window.__fixtureApp;
      state.data.DB.patients=[['Morning','Student','CCICT','Morning',false],['Evening','Student','CCICT','Evening',false],['Archived','Student','COE','Morning',true],['Unknown','Student','CCICT','',false],['Mixed','Student','CCICT','Mixed',false],['Personnel','Teaching Personnel','CCICT','Morning',false]].map(([fname,personType,college,classSession,archived],i)=>({id:200010+i,dbPatientId:10+i,fname,lname:'Fixture',personType,college,classSession,archived,age:20,idNo:'123450'+i,_realSupabase:true}));
      features.patientManagement.renderPatientTable();
    });
    // More records must scroll in the patient panel without making a screen-tall page of rows.
    await page.evaluate(()=>{
      const body=document.querySelector('#pt-table tbody'),row=body.querySelector('tr');
      for(let i=0;i<24;i++)body.append(row.cloneNode(true));
    });
    await page.waitForFunction(()=>{const wrap=document.querySelector('#pt-table .data-table-scroll');return wrap&&wrap.scrollHeight>wrap.clientHeight&&wrap.clientHeight<=innerHeight*.63;});
    const patientScroll=page.locator('#pt-table .data-table-scroll');
    assert.equal(await patientScroll.getAttribute('tabindex'),'0');
    assert.equal(await patientScroll.locator('thead').evaluate(el=>getComputedStyle(el).position),'sticky');
    await patientScroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    assert(await patientScroll.evaluate(el=>el.scrollTop>0));
    await page.locator('#pt-session').selectOption('Morning');assert.equal(await page.locator('#pt-ptype').inputValue(),'Student');
    assert.equal(await page.locator('#pt-table tbody tr').count(),1);assert.match(await page.locator('#pt-table').innerText(),/Fixture, Morning/);
    await page.locator('#pt-college').selectOption('COE');assert.equal(await page.locator('#pt-table tbody tr').count(),0);
    await page.locator('#pt-status').selectOption('archived');assert.equal(await page.locator('#pt-table tbody tr').count(),1);
    await page.locator('#pt-college').selectOption('');await page.locator('#pt-status').selectOption('active');
    await page.locator('#pt-session').selectOption('Evening');assert.match(await page.locator('#pt-table').innerText(),/Fixture, Evening/);
    // Class sessions are Morning or Evening only.
    assert.deepEqual(await page.locator('#pt-session option').evaluateAll(options=>options.map(o=>o.value)),['','Morning','Evening']);
    // The college filter becomes a department filter for non-teaching personnel, as on the registration form.
    await page.locator('#pt-ptype').selectOption('Non-Teaching Personnel');
    assert.equal(await page.locator('#pt-college option').first().innerText(),'All Departments');
    assert(await page.locator('#pt-college option',{hasText:'Registrar'}).count());
    await page.locator('#pt-ptype').selectOption('');assert.equal(await page.locator('#pt-college optgroup').count(),2);
    // Every dropdown, short or long, opens the same themed list; on phones a tap opens it too.
    if(mobile)await page.locator('#pt-status').tap();else await page.locator('#pt-status').click();
    await page.locator('.select-popover').waitFor();
    await page.locator('.select-popover').getByRole('option',{name:'All Records',exact:true}).click();
    assert.equal(await page.locator('#pt-status').inputValue(),'all');
    await page.locator('#pt-status').selectOption('active');
    if(!mobile){
      // Long dropdowns open as a short scrollable list; choosing an option updates the real select.
      await page.locator('#pt-college').click();
      const popover=page.locator('.select-popover');await popover.waitFor();
      assert(await popover.evaluate(el=>el.getBoundingClientRect().height<=301&&el.scrollHeight>el.clientHeight));
      if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/select-popover.png`,clip:await popover.evaluate(el=>{const r=el.getBoundingClientRect();return {x:Math.max(0,r.left-200),y:Math.max(0,r.top-60),width:r.width+400,height:r.height+80};})});
      await popover.getByRole('option',{name:'Registrar',exact:true}).click();
      assert.equal(await page.locator('#pt-college').inputValue(),'Registrar');
      assert.equal(await page.locator('.select-popover').count(),0);
      await page.locator('#pt-college').selectOption('');
    }
    await page.locator('#pt-ptype').selectOption('Teaching Personnel');assert(await page.locator('#pt-session').isDisabled());
    assert.equal(await page.locator('#pt-college option').first().innerText(),'All Colleges');
    assert.equal(await page.locator('#pt-session').inputValue(),'');assert.match(await page.locator('#pt-table').innerText(),/Fixture, Personnel/);
    await page.locator('#pt-ptype').selectOption('Student');await page.locator('#pt-session').selectOption('Morning');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/workspace-patients-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    // Sortable columns announce their order; the export covers the filtered list.
    await page.locator('#pt-table th').getByRole('button',{name:/Patient/}).click();
    assert.equal(await page.locator('#pt-table th[aria-sort="descending"]').count(),1);
    assert.equal(await page.getByRole('button',{name:/Export CSV/}).count(),1);
    await page.locator('#pt-table').getByRole('button',{name:'View',exact:true}).click();
    for(const label of ['Allergies','Medical History'])assert.equal(await page.locator('.info-row').filter({has:page.locator('.info-label',{hasText:label})}).locator('.info-val').innerText(),'—');
    // Chart layout: identity banner, no allergy alert without allergies, and five keyboard-navigable tabs.
    assert.equal(await page.locator('#pt-chart .pt-allergy-alert').count(),0);
    // Certificates and fitness are doctor-only, so staff and administrators see three tabs.
    assert.equal(await page.locator('#pt-chart [role="tab"]').count(),3);
    assert.equal(await page.locator('#pt-chart [data-pt-tab="fitness"]').count(),0);
    await page.locator('#pt-chart [role="tab"]').first().focus();await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#pt-chart [role="tab"][aria-selected="true"]').innerText(),'Treatments (0)');
    assert(await page.locator('#pt-chart [data-pt-panel="treatments"]').isVisible());
    if(process.env.CAMPUSCARE_VISUAL_DIR){await page.locator('#pt-chart [role="tab"]').first().click();await page.locator('#pt-chart').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/patient-chart-${mobile?'mobile':'desktop'}.png`});}
    if(process.env.CAMPUSCARE_VISUAL_DIR){
      const dir=process.env.CAMPUSCARE_VISUAL_DIR,tag=mobile?'mobile':'desktop',shot=async name=>{await page.waitForTimeout(250);await page.locator('#active-modal .modal').first().screenshot({path:`${dir}/${name}-${tag}.png`});};
      const fhir=page.locator('#pt-chart').getByRole('button',{name:/FHIR Preview/});
      if(await fhir.count()){await fhir.first().click();await shot('fhir');await page.locator('#active-modal .close-btn').first().click();}
      const copilot=page.getByRole('button',{name:/Clinical Copilot/});
      if(await copilot.count()){await copilot.first().click();await shot('copilot');await page.locator('#active-modal .close-btn').first().click();}
      const edit=page.getByRole('button',{name:'Edit Record',exact:true});
      if(await edit.count()){await edit.click();await shot('patient-edit');}
      await page.evaluate(()=>window.__fixtureApp.features.modals.closeAllModals());
      const add=page.getByRole('button',{name:'+ Add Patient'});
      if(await add.count()){await add.click();await shot('patient-create');await page.evaluate(()=>window.__fixtureApp.features.modals.closeAllModals());}
      await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=600;const g=c.getContext('2d');const gr=g.createLinearGradient(0,0,900,600);gr.addColorStop(0,'#2b6cb0');gr.addColorStop(1,'#68d391');g.fillStyle=gr;g.fillRect(0,0,900,600);g.fillStyle='#fff';g.font='48px sans-serif';g.fillText('Zoom test',300,320);window.__fixtureApp.features.modals.showFilePreview('id-front.png',c.toDataURL());});
      const vp=page.locator('#preview-img-viewport');const box=await vp.boundingBox();
      await page.mouse.move(box.x+box.width*.7,box.y+box.height*.4);await page.mouse.wheel(0,-400);
      await shot('zoom');
      await page.evaluate(()=>window.__fixtureApp.features.modals.closeAllModals());
      await page.locator('#pt-table').getByRole('button',{name:'View',exact:true}).click();
    }
    await page.locator('#active-modal .close-btn').click();
    // Appointments: list tabs with counts, agenda day headings and a row action menu.
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('appointments'));
    await page.locator('#appt-views [role="tab"]').first().waitFor();
    assert.deepEqual(await page.locator('#appt-views [role="tab"]').evaluateAll(tabs=>tabs.map(t=>t.firstChild.textContent)),['Upcoming','Needs outcome','History','All']);
    await page.getByRole('tab',{name:/^All/}).click();
    assert.match(await page.locator('#appt-summary').innerText(),/appointments? · All/);
    if(await page.locator('.appt-table .row-menu summary').count()){await page.locator('.appt-table .row-menu summary').first().click();assert(await page.locator('.row-menu[open] .row-menu-list').isVisible());await page.keyboard.press('Escape');}
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.evaluate(()=>{
      const {state,features}=window.__fixtureApp,pt=state.data.DB.patients.find(p=>p._realSupabase)||state.data.DB.patients[0],doc=state.data.DB.users.find(u=>u.role==='Doctor'&&u._realSupabase)||state.data.DB.users.find(u=>u.role==='Doctor');
      const today=state.clinicInformation.TODAY,shift=d=>{const x=new Date(today+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+d);return x.toISOString().slice(0,10);};
      state.data.DB.appointments=[[0,'16:00','Scheduled'],[1,'09:00','Scheduled'],[1,'10:00','Scheduled'],[-2,'09:00','Scheduled'],[-5,'13:00','Completed'],[-6,'08:00','Cancelled']].map(([d,time,status],i)=>({id:300500+i,dbAppointmentId:500+i,patientId:pt.id,doctorId:doc?.id,clinic:i%2?'Dental Clinic':'Medical Clinic',service:i%2?'Dental check-up':'General consultation',date:shift(d),time,status,priority:'Student',college:pt.college,reason:'Follow-up',_realSupabase:true}));
      state.topbarAndNavigation.navTaskCounts={approvals:3,inventory:2,appointments:1};features.topbarAndNavigation.applyNavBadges();
      state.appointments.view='upcoming';features.appointments.renderApptTable();
    });
    if(process.env.CAMPUSCARE_VISUAL_DIR){await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/appointments-${mobile?'mobile':'desktop'}.png`,fullPage:true});await page.locator('#sidebar').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/sidebar-${mobile?'mobile':'desktop'}.png`}).catch(()=>{});}
    if(await page.locator('.appt-table .appt-row').count()){await page.locator('.appt-table .appt-row').first().click();await page.locator('#active-modal .appt-detail').waitFor();if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#active-modal .modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/appointment-detail-${mobile?'mobile':'desktop'}.png`});await page.locator('#active-modal .close-btn').click();}
    // Combine class/session and no-use filters, then check that the registration denominator survives.
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('reports'));
    await page.locator('#rpt-type').waitFor();
    await page.evaluate(()=>{
      const {state}=window.__fixtureApp,from=document.getElementById('rpt-from').value;
      state.reports.snapshot.appointments=[...['2026-01-01','2026-02-15','2026-03-01'].map((date,i)=>({id:300020+i,patientId:200004,doctorId:100002,date,college:'CCICT',clinic:'Medical Clinic',status:'Completed',_realSupabase:true})),{id:300010,patientId:200004,doctorId:100002,date:from,college:'CCICT',clinic:'Medical Clinic',status:'Completed',_realSupabase:true},{id:300011,patientId:200004,doctorId:100002,date:from,college:'CCICT',clinic:'Dental Clinic',status:'Completed',_realSupabase:true}];
    });
    await page.getByRole('tab',{name:'Custom Reports',exact:true}).click();
    await page.locator('#rpt-type').selectOption('appointments');
    await page.locator('#rpt-group').selectOption('college');await page.locator('#rpt-split').selectOption('clinic');
    await page.getByRole('button',{name:'Generate Report',exact:true}).click();
    await page.locator('.report-result').waitFor();
    assert.match(await page.locator('.report-result').innerText(),/Record count by College and Clinic/);
    assert.equal(await page.locator('.report-answer>strong').innerText(),'2');
    assert.equal(await page.locator('.report-result table').first().locator('tbody tr').count(),2);
    assert.equal(await page.evaluate(()=>window.__fixtureApp.state.reportCharts.lastReportRows[0]['Record count']),1);
    await page.locator('#rpt-split').selectOption('status');
    assert(await page.locator('#rpt-stale').isVisible());
    await page.getByRole('button',{name:'Last 90 days',exact:true}).click();
    await page.getByRole('tab',{name:'Forecast',exact:true}).click();
    await page.locator('#forecast-from').fill('2026-01-01');await page.locator('#forecast-to').fill('2026-03-31');
    await page.locator('#forecast-weeks').selectOption('8');
    await page.getByRole('button',{name:'Update forecast',exact:true}).click();
    assert.match(await page.locator('#forecast-result').innerText(),/History: 2026-01-01 to 2026-03-31/);
    assert.match(await page.locator('#forecast-result').innerText(),/Expected next 8 weeks/i);
    assert.equal(await page.locator('#forecast-result tbody tr').count(),8);
    const forecastDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export forecast CSV',exact:true}).click();
    assert.equal((await forecastDownload).suggestedFilename(),'campuscare-forecast-2026-01-01-to-2026-03-31.csv');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/reports-forecast-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    await page.locator('#forecast-from').fill('2026-04-01');
    await page.getByRole('button',{name:'Update forecast',exact:true}).click();
    assert.match(await page.locator('#forecast-result').innerText(),/valid start date/);
    await page.locator('#rpt-type').selectOption('students');
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
    const summaryFile=await downloaded;
    assert.match(summaryFile.suggestedFilename(),/^campuscare-student-college-summary-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    const summaryText=(await import('node:fs')).readFileSync(await summaryFile.path(),'utf8');
    assert.match(summaryText,/^\ufeffCollege\/Department,Registered students,/,'Readable headers in the shared CSV format');
  }
  if(role==='Administrator'){
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('settings'));
    await page.locator('#set-school-year').waitFor();
    assert.equal(await page.locator('.settings-danger-notice').count(),2);
    await page.locator('#set-name').fill('Reviewed Fixture Clinic');
    const before=requests.filter(r=>r.path.endsWith('/settings-actions')&&r.body?.action==='update').length;
    await page.getByRole('button',{name:'Save Settings',exact:true}).click();
    await page.getByRole('heading',{name:'Confirm Critical Clinic Changes',exact:true}).waitFor();
    assert(await page.locator('#critical-settings-save').isDisabled());
    assert.equal(requests.filter(r=>r.path.endsWith('/settings-actions')&&r.body?.action==='update').length,before);
    await page.locator('#critical-settings-phrase').fill('UPDATE CLINIC');
    await page.locator('#critical-settings-save').click();
    await page.waitForFunction(()=>!document.getElementById('critical-settings-phrase'));
    assert.equal(requests.filter(r=>r.path.endsWith('/settings-actions')&&r.body?.action==='update').at(-1).body.critical_confirmation,true);
    await page.getByRole('tab',{name:'Backups'}).click();
    await page.evaluate(()=>{const {state,features}=window.__fixtureApp;state.data.DB.realBackupLogs=Array.from({length:6},(_,i)=>({id:i+1,type:'Daily',status:'Completed',startedAt:`2026-10-${String(21-i).padStart(2,'0')}T00:00:00Z`,fileSize:100}));features.serverBackups.renderBackupPanel();});
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#backup-list .backup-day').count(),6);
    assert(await page.locator('#backup-list').evaluate(el=>el.scrollHeight>el.clientHeight&&getComputedStyle(el).overflowY==='auto'));
    managedUsers.push({...profile,user_id:93,auth_user_id:'pending-auth',first_name:'Pending',last_name:'Applicant',username:'pending.applicant',email:'pending@example.test',role:'Patient',status:'Pending',verified:false});
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('users'));
    const pending=page.locator('#user-table tbody tr').filter({hasText:'Applicant, Pending'}),active=()=>page.locator('#user-table tbody tr').filter({hasText:'Doctor, Fixture'});
    await pending.waitFor();assert.equal(await pending.getByRole('button',{name:'Edit',exact:true}).count(),0);assert.equal(await pending.getByRole('button',{name:'Review in Approval Queue',exact:true}).count(),1);
    await page.evaluate(()=>window.__fixtureApp.features.userForm.openEditUserModal(100093));assert.equal(await page.locator('#eu-fname').count(),0);
    await pending.locator('td').first().click();await page.getByRole('heading',{name:/^(User Information|Pending Applicant)$/}).first().waitFor();await page.getByRole('heading',{name:'Pending Applicant',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Edit User',exact:true}).count(),0);await page.locator('#active-modal .close-btn').click();
    const updatesBefore=requests.filter(r=>r.path.endsWith('/admin-users')&&r.body?.action==='update').length;
    await active().getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await page.locator('#eu-status').count(),0);
    await page.locator('#eu-fname').fill('Updated');await page.locator('#eu-contact').fill('+639987654321');
    await page.getByRole('button',{name:'Review Changes',exact:true}).click();await page.getByRole('heading',{name:'Confirm user changes',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.path.endsWith('/admin-users')&&r.body?.action==='update').length,updatesBefore,'Review must not save before confirmation');
    await page.getByRole('button',{name:'Back to Editing',exact:true}).click();assert.equal(await page.locator('#eu-fname').inputValue(),'Updated');
    await page.getByRole('button',{name:'Review Changes',exact:true}).click();
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#active-modal .modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/user-edit-review-${mobile?'mobile':'desktop'}.png`});
    await page.getByRole('button',{name:'Confirm Changes',exact:true}).click();
    const updated=()=>page.locator('#user-table tbody tr').filter({hasText:'Doctor, Updated'});await updated().waitFor();
    assert.equal(managedUsers[1].first_name,'Updated');assert.equal(managedUsers[1].contact_number,'09987654321');assert.equal(managedUsers[1].status,'Active');
    await updated().getByRole('button',{name:'Suspend',exact:true}).click();await page.locator('#cc-confirm-ok-btn').click();await updated().getByRole('button',{name:'Reactivate',exact:true}).waitFor();
    await updated().getByRole('button',{name:'Reactivate',exact:true}).click();await page.locator('#cc-confirm-ok-btn').click();await updated().getByRole('button',{name:'Suspend',exact:true}).waitFor();
    managedUsers.push(...Array.from({length:12},(_,i)=>({...profile,user_id:200+i,auth_user_id:'scroll-'+i,first_name:'Scroll',last_name:String(i),username:'scroll'+i,status:i===0?'Archived':i===1?'Suspended':'Active'})));
    await page.evaluate(()=>window.__fixtureApp.features.userManagement.renderUsers());
    assert.equal(await page.locator('#user-table tbody tr').count(),15,'All Status includes archived and suspended accounts');
    const scroller=page.locator('.user-table-scroll');
    assert(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight),'More than ten users must scroll inside the table');
    // Ten rows are the ceiling; small viewports may show fewer complete rows.
    assert(await scroller.evaluate(el=>{const rows=[...el.querySelectorAll('tbody tr')],ten=el.querySelector('thead').getBoundingClientRect().height+rows.slice(0,10).reduce((sum,row)=>sum+row.getBoundingClientRect().height,0);return el.clientHeight<=Math.min(innerHeight*.63,ten+3)&&el.clientHeight>100;}),'User table fits the viewport and never exceeds ten rows');
    await page.locator('#usr-status').selectOption('Archived');assert.equal(await page.locator('#user-table tbody tr').count(),1);
    await page.locator('#usr-status').selectOption('Suspended');assert.equal(await page.locator('#user-table tbody tr').count(),1);
    await page.locator('#usr-status').selectOption('');await scroller.evaluate(el=>el.scrollTop=el.scrollHeight);assert(await scroller.evaluate(el=>el.scrollTop>0));

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
    // Day-off requests carry an optional supporting file to the workflow API.
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('schedule'));
    await page.locator('#leave-attach-file').waitFor({state:'attached'});
    await page.locator('.req-row').first().click();
    await page.locator('.req-review').waitFor();
    assert.match(await page.locator('.req-review').innerText(),/medical-certificate\.png/);
    assert.equal(await page.locator('.req-review').getByRole('button',{name:'Approve',exact:true}).count(),0,'Requesters only view their request');
    await page.locator('#active-modal .close-btn').click();
    await page.locator('#leave-attach-file').setInputFiles({name:'clinic-note.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%fixture\n')});
    await page.locator('#leave-attach-chosen').getByText('clinic-note.pdf').waitFor();
    await page.locator('#leave-attach-file').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('x')});
    await page.locator('.toast',{hasText:/JPG, PNG, WebP/}).first().waitFor();
    assert(await page.locator('#leave-attach-chosen').getByText('clinic-note.pdf').isVisible(),'A rejected file keeps the earlier choice');
    const leaveDay=await page.evaluate(()=>{const {state}=window.__fixtureApp,d=new Date(state.clinicInformation.TODAY+'T12:00:00Z');do d.setUTCDate(d.getUTCDate()+1);while(!(state.auth.currentUser.workDays||[]).includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]));return d.toISOString().slice(0,10);});
    await page.locator('#leave-date').evaluate((el,v)=>{el.value=v;},leaveDay);
    await page.locator('#leave-reason').fill('Conference');
    await page.getByRole('button',{name:'Request Day Off',exact:true}).click();
    await page.waitForTimeout(400);
    const dayOff=requests.filter(r=>r.path.endsWith('/workflow-actions')&&r.body?.action==='create').at(-1);
    assert(dayOff,'Day off request must reach the workflow API');
    assert.equal(dayOff.body.attachment_name,'clinic-note.pdf');
    assert.match(dayOff.body.attachment_data_url,/^data:application\/pdf;base64,/);
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
  if(mobile){
    // Emulate the shorter usable height caused by mobile browser controls; only the menu list scrolls.
    await page.setViewportSize({width:390,height:520});
    await page.evaluate(()=>window.__fixtureApp.features.topbarAndNavigation.toggleSidebar(true));
    await page.locator('#sidebar-nav').evaluate(nav=>nav.scrollTop=nav.scrollHeight);
    // Wait for the browser to commit the resized visual viewport before measuring fixed controls.
    await page.waitForFunction(()=>{const r=document.querySelector('.sb-logout').getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height+visualViewport.offsetTop;},null,{timeout:3000});
    assert(await page.locator('.sb-logout').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height+visualViewport.offsetTop;}),'Logout must remain above mobile browser controls');
    if(role==='Administrator')assert(await page.locator('#sidebar-nav').evaluate(el=>el.scrollHeight>el.clientHeight),'Long admin menus must scroll internally');
  }
  await page.getByRole('button',{name:'Logout',exact:true}).click();
  await page.locator('#cc-confirm-ok-btn').click();
  await page.waitForFunction(()=>window.__fixtureApp.state.auth.currentUser===null);
  await page.getByText('Logged out successfully.',{exact:true}).waitFor();
  // Remember me keeps the username or email (never the password) ready for the next sign-in.
  assert.equal(await page.locator('#li-user').inputValue(),profile.email);
  assert.equal(await page.locator('#li-pass').inputValue(),'');
  assert(await page.getByLabel('Remember me').isChecked());
  assert.equal(await page.evaluate(()=>window.__fixtureApp.state.data.DB.patients.some(row=>row._realSupabase)),false);
  assert.equal(await page.locator('#landing-navbar [data-landing-link="home"]').evaluate(el=>getComputedStyle(el).color),'rgb(230, 239, 247)');
  assert(requests.some(request=>request.path.endsWith('/token')),`${role}: actual login request missing`);
  assert(requests.some(request=>request.path.includes('/rest/v1/users')),`${role}: profile query missing`);
  assert.deepEqual(errors,[],`${mobile?'mobile':'desktop'} ${role}`);
  console.log(`PASS: ${mobile?'mobile':'desktop'} ${role}, login/API/profile and ${navIds.length} routes`);cases++;
  await context.close();
 }
 console.log(`PASS: ${cases} Chromium role/device scenarios, with all Supabase requests intercepted`);
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}

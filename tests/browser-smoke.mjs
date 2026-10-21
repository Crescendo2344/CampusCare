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
   else if(path.endsWith('/student-reports'))response={ok:true,report:buildStudentReport({users:[{user_id:10,first_name:'Morning',last_name:'Student',id_number:'ST10',role:'Patient',person_type:'Student',college:'CCICT',status:'Active',verified:true,created_at:'2026-01-01'},{user_id:11,first_name:'Evening',last_name:'Student',id_number:'ST11',role:'Patient',person_type:'Student',college:'CCICT',status:'Active',verified:true,created_at:'2026-01-01'}],patients:[{patient_id:10,user_id:10,class_session:'Morning'},{patient_id:11,user_id:11,class_session:'Evening'}],appointments:[{appointment_id:10,patient_id:10,clinic:'Dental Clinic',appointment_date:request.postDataJSON().from,status:'Completed'}]},request.postDataJSON())};
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
    assert(forgotBox.y>loginBox.y+loginBox.height,'Forgot password must be below Login');
    assert.equal(await page.getByText('Resend verification email',{exact:false}).count(),0);
    await page.evaluate(()=>window.__fixtureApp.features.loginLockout.openPrivacyNotice());
    await page.locator('.privacy-notice').waitFor();
    assert.equal(await page.locator('.privacy-notice .alert-success').evaluate(el=>getComputedStyle(el).display),'block');
    assert(await page.locator('.privacy-notice .alert-success strong').evaluate(el=>el.getBoundingClientRect().width>150),'Privacy heading must not collapse to a narrow column');
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
    await page.getByRole('button',{name:'Register',exact:true}).click();
    await scrollDown();
    await page.locator('#r-ptype').selectOption('Teaching Personnel');
    await page.waitForFunction(()=>document.getElementById('r-verification-label').textContent.includes('Employee ID — Front and Back'));
    await page.locator('#r-ptype').selectOption('Student');
    await page.waitForFunction(()=>document.getElementById('r-verification-label').textContent.includes('Student ID — Front and Back'));
    // Populate a valid registration and an OCR name mismatch at the requested 25% boundary.
    const fields={'r-fname':'Fixture','r-lname':'Student','r-user':'fixture.student','r-email':'fixture@example.test','r-pass':'Fixture-only-password1!','r-idno':'1234567'};
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
    await page.getByText('Use the camera to take a verification selfie while holding the document you will upload.',{exact:true}).waitFor();
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
      const geometry={x:234,y:70,width:172,height:196,keypoints:[{x:.45,y:.3},{x:.55,y:.3},{x:.5,y:.35}]};
      const feed=async(changes,expected)=>{
        await page.evaluate(data=>window.__fixtureGuidance=data,{faces:[geometry],width:640,height:480,brightness:120,sharpness:80,documentVisible:true,...changes});
        await page.getByText(expected,{exact:true}).waitFor();
      };
      await feed({faces:[{...geometry,width:70,height:80}]},'Move closer to the camera');
      await feed({faces:[{...geometry,width:470,height:400}]},'Move back a little');
      await feed({brightness:25},'Move to brighter, even lighting');
      await feed({documentVisible:false},'Hold the front of your ID beside your face, with all corners visible');
      assert(await page.locator('#camera-capture-button').isDisabled(),'Face without a held document must block capture');
      await feed({},'Good position — keep your document visible');
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
    await page.evaluate(()=>{window.__fixtureGetUserMedia=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>{throw new Error('Permission denied');};});
    await page.locator('#selfie-camera-button').click();
    await page.getByRole('button',{name:'Start Camera',exact:true}).click();
    await page.getByText('Camera access is required. Allow camera permission, or open CampusCare in Chrome or Safari and try again.',{exact:true}).waitFor();
    await page.locator('#active-modal .modal-header .close-btn').click();
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=window.__fixtureGetUserMedia;});


    // Both ID sides are mandatory even after a successful selfie.
    await page.locator('#registration-submit-button').click();
    await page.getByText('Provide the front and back of your Student or Employee ID.',{exact:true}).waitFor();
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
  await page.getByText('Enter your username/email and password.',{exact:true}).waitFor();
  await page.locator('#li-user').fill(profile.email);await page.locator('#li-pass').fill('Fixture-only-password1!');
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
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({fullPage:true,path:`${process.env.CAMPUSCARE_VISUAL_DIR}/workspace-range-${mobile?'mobile':'desktop'}.png`});
  await rangeButton.click();assert.equal(await page.locator('#active-modal').getByRole('button',{name:'Cancel',exact:true}).count(),0);
  await page.evaluate(()=>{const f=window.__fixtureApp.features.dashboardChartHelpers;f.chooseDashboardRangeDate('2026-10-14');f.chooseDashboardRangeDate('2026-10-20');});
  await page.getByRole('button',{name:'Apply Date Range',exact:true}).click();
  assert.match(await rangeButton.innerText(),/Oct 14, 2026/);
  await page.evaluate(()=>window.__fixtureApp.features.accountSettings.openProfileDetails());
  assert.equal(await page.locator('#active-modal .modal-header .close-btn').count(),1);
  assert.equal(await page.locator('#active-modal .modal-footer').getByRole('button',{name:'Close',exact:true}).count(),0);
  await page.locator('#active-modal .close-btn').click();
  if(role==='Administrator'){
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
    await page.locator('#active-modal .close-btn').click();
  }
  // Walk every visible role route through its actual generated click callback.
  const navIds=await page.locator('#sidebar nav [id^="nav-"]').evaluateAll(elements=>elements.map(element=>element.id));
  assert(navIds.length>0);assert(!navIds.includes('nav-task-center'));
  for(const id of navIds){
    await page.evaluate(id=>document.getElementById(id).click(),id);
    await page.waitForTimeout(120);
    assert(await page.locator('#app-content').innerHTML(),`${role}: empty ${id}`);
  }
  // Exercise the actual message toolbar and action-sheet callbacks with synthetic conversations.
  await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('messages'));
  await page.locator('#msgr-shell').waitFor();
  await page.evaluate(async()=>{
    const {state,features}=window.__fixtureApp;
    clearInterval(state.messaging.messagePollTimer);state.messaging.messagePollTimer=null;
    const partner={id:100090,dbUserId:90,fname:'Clinic',lname:'Contact',role:'Doctor',status:'Active',_realSupabase:true};
    state.data.DB.users.push(partner);
    state.data.DB.messages=[{id:901,dbMessageId:901,fromUserId:partner.id,toUserId:state.auth.currentUser.id,message:'Your clinic update is ready.',createdAt:'2026-10-20T07:00:00Z',isRead:true,_realSupabase:true},{id:902,dbMessageId:902,fromUserId:state.auth.currentUser.id,toUserId:partner.id,message:'Thank you. I will visit the clinic.',createdAt:'2026-10-20T07:01:00Z',isRead:true,_realSupabase:true}];
    await features.messaging.openConversation(partner.id);
  });
  await page.locator('#msgr-bubble-902').waitFor();
  if(mobile){
    // A short in-app browser viewport (and keyboard-sized viewport) must retain a usable composer.
    for(const height of [620,420]){
      await page.setViewportSize({width:390,height});
      await page.waitForTimeout(200);
      assert(await page.locator('#msgr-text-input').evaluate(input=>{const r=input.getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height+visualViewport.offsetTop;}),'Mobile composer must be inside the usable viewport');
      await page.locator('#msgr-text-input').fill('Mobile typing works');
    }
    await page.locator('#msgr-text-input').fill('');
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  }

  assert.equal(await page.locator('.msgr-bubble .msgr-bubble-time').count(),0,'Timestamps must sit outside message bubbles');
  // Long attachment names must remain visible rather than leaving only a trash button on phones.
  for(const attachment of [{type:'file',name:'Resume_JophetSanchez_done.docx'},{type:'image',name:'School ID front.jpg'},{type:'file',name:'https://example.test/clinic-information'}]){
    await page.evaluate(attachment=>{window.__fixtureApp.state.messaging.pendingAttachment=attachment;window.__fixtureApp.features.messaging.showPendingAttachPreview();},attachment);
    assert(await page.locator('.pending-attachment-name').isVisible());
    assert.equal(await page.locator('.pending-attachment-name').textContent(),attachment.name);
    assert(await page.locator('.pending-attachment-name').evaluate(el=>{const r=el.getBoundingClientRect();return r.width>20&&r.right<=innerWidth;}));
    await page.getByRole('button',{name:'Remove attachment',exact:true}).click();
  }
  for(const label of ['Send a photo','Send a file','Record a voice message','Conversation info','Send message'])assert.equal(await page.getByRole('button',{name:label,exact:true}).locator('svg').count(),1);
  await page.locator('[data-msg-id="902"]').getByRole('button',{name:'More message options',exact:true}).click();
  const sheet=page.getByRole('group',{name:'Message actions'});await sheet.waitFor();
  assert.equal(await sheet.getByRole('button').count(),4);
  assert(await sheet.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),'Message action sheet must fit the screen');
  if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#msgr-chat').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/workspace-messages-${mobile?'mobile':'desktop'}.png`});
  await sheet.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#msgr-edit-input-902').waitFor();
  await page.locator('#msgr-edit-input-902').fill('Draft edit survives refresh');
  await page.evaluate(()=>window.__fixtureApp.features.messaging.refreshMessageViews());
  assert.equal(await page.locator('#msgr-edit-input-902').inputValue(),'Draft edit survives refresh');
  await page.locator('#msgr-bubble-902').getByRole('button',{name:'Cancel',exact:true}).click();
  assert.match(await page.locator('#msgr-bubble-902').innerText(),/Thank you/);
  // In-place refreshes must retain the selected partner, reading position, editor and composer draft.
  await page.evaluate(()=>{
    const {state,features}=window.__fixtureApp;
    const base=state.data.DB.messages[0];
    state.data.DB.messages.push(...Array.from({length:35},(_,i)=>({...base,id:1000+i,dbMessageId:1000+i,message:'History message '+i,createdAt:new Date(Date.UTC(2026,9,20,8,i)).toISOString()})));
    features.messaging.renderChatMessages(100090);
    document.getElementById('msgr-text-input').value='Unsent composer draft';
    window.__fixtureMessageRow=document.querySelector('[data-msg-id="902"]');
    const scroller=document.getElementById('msgr-messages');scroller.dispatchEvent(new WheelEvent('wheel',{deltaY:-300}));scroller.scrollTop=120;scroller.dispatchEvent(new Event('scroll'));
    window.__fixtureReadTop=document.getElementById('msgr-messages').scrollTop;
    state.data.DB.messages.push({...base,id:1099,dbMessageId:1099,message:'New message while reading history',createdAt:'2026-10-20T08:59:00Z'});
    features.messaging.refreshMessageViews();features.authSession.refreshActivePageAfterSync();
  });
  assert(await page.evaluate(()=>document.querySelector('[data-msg-id="902"]')===window.__fixtureMessageRow));
  assert.equal(await page.locator('#msgr-text-input').inputValue(),'Unsent composer draft');
  assert(await page.evaluate(()=>Math.abs(document.getElementById('msgr-messages').scrollTop-window.__fixtureReadTop)<2));
  assert.equal(await page.evaluate(()=>window.__fixtureApp.state.messaging.activeConversationId),100090);
  await page.evaluate(()=>{
    const {features}=window.__fixtureApp;features.messaging.renderChatMessages(100090,{scrollToEnd:true});
    const late=document.createElement('div');late.id='fixture-late-media';late.style.height='20px';document.querySelector('[data-msg-id="1099"] .msgr-bubble').append(late);
  });
  await page.waitForTimeout(80);
  await page.evaluate(()=>document.getElementById('fixture-late-media').style.height='300px');
  await page.waitForFunction(()=>{const el=document.getElementById('msgr-messages');return el.scrollHeight-el.clientHeight-el.scrollTop<3;},{},{timeout:2500});
  assert(await page.locator('#msgr-messages').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<3),'Latest message must stay visible after late media/layout growth');
  await page.evaluate(()=>window.__fixtureApp.features.messaging.refreshMessageViews());await page.waitForTimeout(80);
  assert(await page.locator('#msgr-messages').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<3),'Refresh must remain at the latest message');
  // A real oscillator stream exercises MediaRecorder and the live meter without a person's microphone.
  await page.evaluate(()=>{
    window.__fixtureAudioContext=new AudioContext();const oscillator=window.__fixtureAudioContext.createOscillator(),gain=window.__fixtureAudioContext.createGain(),destination=window.__fixtureAudioContext.createMediaStreamDestination();
    gain.gain.value=.2;oscillator.connect(gain);gain.connect(destination);oscillator.start();
    window.__fixtureVoiceGain=gain;
    window.__fixtureOriginalMedia=navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia=async constraints=>constraints.audio?destination.stream.clone():window.__fixtureOriginalMedia.call(navigator.mediaDevices,constraints);
  });
  await page.getByRole('button',{name:'Record a voice message',exact:true}).click();
  await page.locator('.voice-recording').waitFor();await page.locator('.voice-recording [role="timer"]').getByText('0:01',{exact:true}).waitFor();
  assert(await page.locator('.voice-recording .voice-wave i').evaluateAll(bars=>bars.some(bar=>parseFloat(bar.style.height)>2)),'The meter must reflect real microphone levels');
  const loud=await page.locator('.voice-recording .voice-wave i').last().evaluate(bar=>parseFloat(bar.style.height));
  await page.evaluate(()=>window.__fixtureVoiceGain.gain.value=0);await page.waitForTimeout(300);
  assert(await page.locator('.voice-recording .voice-wave i').last().evaluate(bar=>parseFloat(bar.style.height))<loud,'Live amplitude must fall when the microphone goes silent');
  await page.evaluate(()=>{window.__fixtureVoiceGain.gain.value=.2;window.__fixtureApp.features.messaging.refreshMessageViews();});
  assert(await page.locator('.voice-recording').isVisible(),'Background refresh must not replace a recording');
  if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#msgr-chat').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/voice-recording-${mobile?'mobile':'desktop'}.png`});
  await page.getByRole('button',{name:'Stop voice recording',exact:true}).click();
  await page.locator('#msgr-pending-attach .voice-player').waitFor();
  assert(await page.locator('#msgr-pending-attach .msgr-pending-attach').evaluate(el=>{const items=[...el.children].filter(item=>getComputedStyle(item).display!=='none');const left=Math.min(...items.map(item=>item.getBoundingClientRect().left)),right=Math.max(...items.map(item=>item.getBoundingClientRect().right)),r=el.getBoundingClientRect();return Math.abs((left+right-r.left-r.right)/2)<3;}),'Pending voice attachment controls must be centered');
  assert(await page.evaluate(()=>window.__fixtureApp.state.messaging.voiceRecorder.stream.getTracks().every(track=>track.readyState==='ended')));
  await page.locator('#msgr-pending-attach').getByRole('button',{name:'Play voice message',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#msgr-pending-attach audio').currentTime>.1);
  await page.evaluate(()=>{
    const {state,features}=window.__fixtureApp;const attachment={...state.messaging.pendingAttachment};
    state.data.DB.messages.push({id:1100,fromUserId:100090,toUserId:state.auth.currentUser.id,message:'',attachment,createdAt:'2026-10-20T09:00:00Z',isRead:true,_realSupabase:true});
    features.messaging.clearPendingAttachment();features.messaging.renderChatMessages(100090,{scrollToEnd:true});
    window.__fixtureVoiceAudio=document.querySelector('[data-msg-id="1100"] audio');
  });
  await page.locator('[data-msg-id="1100"]').getByRole('button',{name:'Play voice message',exact:true}).click();
  await page.waitForFunction(()=>window.__fixtureVoiceAudio.currentTime>.1);
  await page.evaluate(()=>window.__fixtureApp.features.messaging.refreshMessageViews());
  assert(await page.evaluate(()=>document.querySelector('[data-msg-id="1100"] audio')===window.__fixtureVoiceAudio&&!window.__fixtureVoiceAudio.paused),'Incoming audio survives quiet updates');
  if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#msgr-chat').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/voice-playback-${mobile?'mobile':'desktop'}.png`});
  await page.evaluate(()=>{
    const {state,features}=window.__fixtureApp;state.data.DB.messages.push({id:1101,fromUserId:state.auth.currentUser.id,toUserId:100090,message:'',attachment:{type:'file',name:'Clinic form.pdf',dataUrl:'data:application/pdf;base64,AA=='},createdAt:'2026-10-20T09:01:00Z',isRead:true,_realSupabase:true});features.messaging.refreshMessageViews();
  });
  assert.match(await page.locator('.msgr-contact-item.active .msgr-contact-preview').innerText(),/^You: sent a file$/);
  await page.evaluate(()=>window.__fixtureVoiceAudio.pause());
  await page.getByRole('button',{name:'Record a voice message',exact:true}).click();await page.locator('.voice-recording').waitFor();
  await page.getByRole('button',{name:'Discard voice recording',exact:true}).click();
  await page.waitForFunction(()=>window.__fixtureApp.state.messaging.voiceRecorder.stream.getTracks().every(track=>track.readyState==='ended'));
  assert.equal(await page.locator('.voice-recording').count(),0);assert.equal(await page.evaluate(()=>window.__fixtureApp.state.messaging.pendingAttachment),null);
  await page.getByRole('button',{name:'Record a voice message',exact:true}).click();await page.locator('.voice-recording').waitFor();
  await page.evaluate(()=>{window.__fixtureLastVoiceTracks=window.__fixtureApp.state.messaging.voiceRecorder.stream.getTracks();window.__fixtureApp.features.navigationRaceProtection.navTo('dashboard');});
  await page.waitForFunction(()=>window.__fixtureLastVoiceTracks.every(track=>track.readyState==='ended'));
  await page.evaluate(async()=>{navigator.mediaDevices.getUserMedia=window.__fixtureOriginalMedia;await window.__fixtureAudioContext.close();});
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
    assert.equal(await page.locator('#pt-table tbody tr').count(),1);assert.match(await page.locator('#pt-table').innerText(),/Morning Fixture/);
    await page.locator('#pt-college').selectOption('COE');assert.equal(await page.locator('#pt-table tbody tr').count(),0);
    await page.locator('#pt-status').selectOption('archived');assert.equal(await page.locator('#pt-table tbody tr').count(),1);
    await page.locator('#pt-college').selectOption('');await page.locator('#pt-status').selectOption('active');
    await page.locator('#pt-session').selectOption('Evening');assert.match(await page.locator('#pt-table').innerText(),/Evening Fixture/);
    await page.locator('#pt-session').selectOption('unrecorded');assert.match(await page.locator('#pt-table').innerText(),/Unknown Fixture/);
    await page.locator('#pt-session').selectOption('Mixed');assert.match(await page.locator('#pt-table').innerText(),/Mixed Fixture/);
    await page.locator('#pt-ptype').selectOption('Teaching Personnel');assert(await page.locator('#pt-session').isDisabled());
    assert.equal(await page.locator('#pt-session').inputValue(),'');assert.match(await page.locator('#pt-table').innerText(),/Personnel Fixture/);
    await page.locator('#pt-ptype').selectOption('Student');await page.locator('#pt-session').selectOption('Morning');
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/workspace-patients-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    await page.locator('#pt-table').getByRole('button',{name:'View',exact:true}).click();
    for(const label of ['Allergies','Medical History'])assert.equal(await page.locator('.info-row').filter({has:page.locator('.info-label',{hasText:label})}).locator('.info-val').innerText(),'—');
    await page.locator('#active-modal .close-btn').click();
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
    assert.equal((await forecastDownload).suggestedFilename(),'Forecast_2026-01-01_2026-03-31.csv');
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
    assert.equal((await downloaded).suggestedFilename(),'Student_College_Summary.csv');
  }
  if(role==='Administrator'){
    managedUsers.push({...profile,user_id:93,auth_user_id:'pending-auth',first_name:'Pending',last_name:'Applicant',username:'pending.applicant',email:'pending@example.test',role:'Patient',status:'Pending',verified:false});
    await page.evaluate(()=>window.__fixtureApp.features.navigationRaceProtection.navTo('users'));
    const pending=page.locator('#user-table tbody tr').filter({hasText:'Pending Applicant'}),active=()=>page.locator('#user-table tbody tr').filter({hasText:'Fixture Doctor'});
    await pending.waitFor();assert.equal(await pending.getByRole('button',{name:'Edit',exact:true}).count(),0);assert.equal(await pending.getByRole('button',{name:'Approve',exact:true}).count(),1);
    await page.evaluate(()=>window.__fixtureApp.features.userForm.openEditUserModal(100093));assert.equal(await page.locator('#eu-fname').count(),0);
    await pending.locator('td').first().click();await page.getByRole('heading',{name:'User Information',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Edit User',exact:true}).count(),0);await page.locator('#active-modal .close-btn').click();
    const updatesBefore=requests.filter(r=>r.path.endsWith('/admin-users')&&r.body?.action==='update').length;
    await active().getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await page.locator('#eu-status').count(),0);
    await page.locator('#eu-fname').fill('Updated');await page.locator('#eu-contact').fill('+639987654321');
    await page.getByRole('button',{name:'Review Changes',exact:true}).click();await page.getByRole('heading',{name:'Confirm user changes',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.path.endsWith('/admin-users')&&r.body?.action==='update').length,updatesBefore,'Review must not save before confirmation');
    await page.getByRole('button',{name:'Back to Editing',exact:true}).click();assert.equal(await page.locator('#eu-fname').inputValue(),'Updated');
    await page.getByRole('button',{name:'Review Changes',exact:true}).click();
    if(process.env.CAMPUSCARE_VISUAL_DIR)await page.locator('#active-modal .modal').screenshot({path:`${process.env.CAMPUSCARE_VISUAL_DIR}/user-edit-review-${mobile?'mobile':'desktop'}.png`});
    await page.getByRole('button',{name:'Confirm Changes',exact:true}).click();
    const updated=()=>page.locator('#user-table tbody tr').filter({hasText:'Updated Doctor'});await updated().waitFor();
    assert.equal(managedUsers[1].first_name,'Updated');assert.equal(managedUsers[1].contact_number,'09987654321');assert.equal(managedUsers[1].status,'Active');
    await updated().getByRole('button',{name:'Suspend',exact:true}).click();await page.locator('#cc-confirm-ok-btn').click();await updated().getByRole('button',{name:'Reactivate',exact:true}).waitFor();
    await updated().getByRole('button',{name:'Reactivate',exact:true}).click();await page.locator('#cc-confirm-ok-btn').click();await updated().getByRole('button',{name:'Suspend',exact:true}).waitFor();
    managedUsers.push(...Array.from({length:12},(_,i)=>({...profile,user_id:200+i,auth_user_id:'scroll-'+i,first_name:'Scroll',last_name:String(i),username:'scroll'+i,status:i===0?'Archived':i===1?'Suspended':'Active'})));
    await page.evaluate(()=>window.__fixtureApp.features.userManagement.renderUsers());
    assert.equal(await page.locator('#user-table tbody tr').count(),15,'All Status includes archived and suspended accounts');
    const scroller=page.locator('.user-table-scroll');
    assert(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight),'More than ten users must scroll inside the table');
    assert(await scroller.evaluate(el=>{const rows=el.querySelectorAll('tbody tr'),r=el.getBoundingClientRect();return rows[9].getBoundingClientRect().bottom<=r.bottom+2&&rows[10].getBoundingClientRect().bottom>r.bottom+2;}),'Ten full user rows fit before scrolling');
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
  assert.equal(await page.evaluate(()=>window.__fixtureApp.state.data.DB.patients.some(row=>row._realSupabase)),false);
  assert(requests.some(request=>request.path.endsWith('/token')),`${role}: actual login request missing`);
  assert(requests.some(request=>request.path.includes('/rest/v1/users')),`${role}: profile query missing`);
  assert.deepEqual(errors,[],`${mobile?'mobile':'desktop'} ${role}`);
  console.log(`PASS: ${mobile?'mobile':'desktop'} ${role}, login/API/profile and ${navIds.length} routes`);cases++;
  await context.close();
 }
 console.log(`PASS: ${cases} Chromium role/device scenarios, with all Supabase requests intercepted`);
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}

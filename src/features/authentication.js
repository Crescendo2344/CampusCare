// authentication: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {prepareRegistrationCaptcha} from '../verification/registration-captcha.js';
import {updateRegistrationIdentityFields} from './documentScanner.js';
// ================================================================
// AUTH
// ================================================================

export function getLandingCarouselParts(){
  return {
    carousel:document.getElementById('landing-swipe-carousel'),
    viewport:document.getElementById('hero-carousel-viewport'),
    track:document.getElementById('hero-carousel-track')
  };
}

export function restartLandingCarouselProgress(){
  const bar=document.getElementById('hero-carousel-progress-bottom');
  if(!bar)return;
  bar.classList.remove('running');
  void bar.offsetWidth;
  bar.classList.add('running');
}

export function pauseLandingCarouselProgress(){
  document.getElementById('hero-carousel-progress-bottom')?.classList.remove('running');
}

export function landingCarouselSlideWidth(){
  const {viewport}=getLandingCarouselParts();
  // Fractional CSS widths must not accumulate into a partially visible neighbouring slide.
  return Math.max(1,viewport?.getBoundingClientRect().width||1);
}

export function landingCarouselRealIndex(){
  const {viewport,track}=getLandingCarouselParts();
  if(!viewport||!track)return 0;
  const left=viewport.getBoundingClientRect().left;
  const slides=[...track.querySelectorAll('.hero-carousel-slide')];
  return slides.reduce((nearest,slide,index)=>Math.abs(slide.getBoundingClientRect().left-left)<Math.abs(slides[nearest].getBoundingClientRect().left-left)?index:nearest,0);
}

export function positionLandingCarousel(index,behavior='instant'){
  const {carousel,viewport,track}=getLandingCarouselParts();
  const slides=track?.querySelectorAll('.hero-carousel-slide');
  if(!carousel||!viewport?.clientWidth||!slides?.length)return;
  const real=((index%slides.length)+slides.length)%slides.length;
  const target=viewport.scrollLeft+slides[real].getBoundingClientRect().left-viewport.getBoundingClientRect().left;
  carousel.dataset.activeIndex=String(real);
  // Read actual slide positions, rather than multiplying a rounded viewport width.
  viewport.scrollTo({left:target,behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':behavior});
}

export function normalizeLandingCarouselScroll(){
  const {viewport}=getLandingCarouselParts();
  if(!viewport?.clientWidth)return;
  positionLandingCarousel(landingCarouselRealIndex());
}

export function buildLandingCarouselLoop(){
  const {carousel,track}=getLandingCarouselParts();
  if(!carousel||!track||track.dataset.loopReady==='1')return;
  // Four real slides need no off-screen clone groups or mid-animation normalization jumps.
  track.querySelectorAll('[data-carousel-clone]').forEach(slide=>slide.remove());
  const slides=[...track.querySelectorAll('.hero-carousel-slide')];
  slides.forEach((slide,index)=>{slide.setAttribute('role','group');slide.setAttribute('aria-label',`${index+1} of ${slides.length}`);});
  track.dataset.loopReady='1';carousel.dataset.activeIndex='0';
}

export function moveLandingCarousel(step=1){
  const {carousel}=getLandingCarouselParts();
  const current=Number(carousel?.dataset.activeIndex)||0;
  const count=appState.authentication.LANDING_CAROUSEL_COUNT;
  const next=(current+(Number(step)>=0?1:-1)+count)%count;
  // Wrap directly at the ends instead of scrolling through every intermediate panel.
  positionLandingCarousel(next,Math.abs(next-current)>1?'instant':'smooth');
}

export function startLandingCarouselTimer(){
  pauseLandingCarouselTimer();
  const {carousel}=getLandingCarouselParts();
  // Reading, selecting text and keyboard focus all suspend automatic movement.
  if(!carousel||carousel.matches(':hover')||carousel.contains(document.activeElement)||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  restartLandingCarouselProgress();
  appState.authentication.landingCarouselTimer=setInterval(()=>{
    const landing=document.getElementById('landing-page');
    const home=document.querySelector('[data-landing-route="home"]');
    if(document.hidden||landing?.style.display==='none'||!home?.classList.contains('active'))return;
    moveLandingCarousel(1);restartLandingCarouselProgress();
  },5500);
}

export function pauseLandingCarouselTimer(){
  if(appState.authentication.landingCarouselTimer){
    clearInterval(appState.authentication.landingCarouselTimer);
    appState.authentication.landingCarouselTimer=null;
  }
  pauseLandingCarouselProgress();
}

export function snapLandingCarouselToNearest(){
  positionLandingCarousel(landingCarouselRealIndex(),'smooth');
}

export function initializeLandingCarouselInteractions(){
  const {carousel,viewport}=getLandingCarouselParts();
  if(!carousel||!viewport)return;
  buildLandingCarouselLoop();
  if(carousel.dataset.interactionsReady!=='1'){
    carousel.dataset.interactionsReady='1';
    carousel.addEventListener('mouseenter',pauseLandingCarouselTimer);
    carousel.addEventListener('mouseleave',startLandingCarouselTimer);
    carousel.addEventListener('focusin',pauseLandingCarouselTimer);
    carousel.addEventListener('focusout',()=>queueMicrotask(startLandingCarouselTimer));
    viewport.addEventListener('pointerdown',pauseLandingCarouselTimer);
    // Keep native touch scrolling and ordinary desktop text selection; never drag the track with a mouse.
    viewport.addEventListener('pointerup',startLandingCarouselTimer);
    viewport.addEventListener('pointercancel',startLandingCarouselTimer);
    viewport.addEventListener('scroll',()=>{
      clearTimeout(appState.authentication.landingCarouselScrollTimer);
      appState.authentication.landingCarouselScrollTimer=setTimeout(normalizeLandingCarouselScroll,220);
    },{passive:true});
    carousel.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();pauseLandingCarouselTimer();
      moveLandingCarousel(event.key==='ArrowLeft'?-1:1);
    });
    let width=landingCarouselSlideWidth();
    const reposition=()=>{
      const nextWidth=landingCarouselSlideWidth();
      if(!viewport.clientWidth||Math.abs(nextWidth-width)<.1)return;
      width=nextWidth;
      // Preserve the settled slide when a scrollbar, browser zoom or screen size changes the layout.
      clearTimeout(appState.authentication.landingCarouselScrollTimer);
      requestAnimationFrame(()=>positionLandingCarousel(Number(carousel.dataset.activeIndex)||0));
    };
    if(window.ResizeObserver)new window.ResizeObserver(reposition).observe(viewport);
    else window.addEventListener('resize',reposition);
  }
  requestAnimationFrame(()=>positionLandingCarousel(Number(carousel.dataset.activeIndex)||0));
}

export function setPublicNavbarMode(authMode=false){
  const nav=document.getElementById('landing-navbar');
  if(nav)nav.classList.toggle('auth-mode',Boolean(authMode));
}

export function showLandingRoute(route='home',updateHash=true){
  const clean=appState.authentication.LANDING_ROUTE_NAMES.includes(route)?route:'home';
  const landing=document.getElementById('landing-page');
  const auth=document.getElementById('auth-page');

  if(auth)auth.style.display='none';
  if(landing)landing.style.display='block';
  setPublicNavbarMode(false);

  document.querySelectorAll('[data-landing-route]').forEach(el=>{
    const active=el.dataset.landingRoute===clean;
    el.classList.toggle('active',active);
    el.style.display=active?'block':'none';
  });
  document.querySelectorAll('[data-landing-link]').forEach(el=>{
    el.classList.toggle('active',el.dataset.landingLink===clean);
  });

  const nl=document.querySelector('.landing-nav-links');
  if(nl)nl.classList.remove('mobile-show');

  window.scrollTo(0,0);
  if(clean==='home'){
    initializeLandingCarouselInteractions();
    startLandingCarouselTimer();
  }else{
    pauseLandingCarouselTimer();
  }

  if(updateHash){
    const nextHash=`#page=${clean}`;
    if(window.location.hash!==nextHash)history.pushState({landingRoute:clean},'',nextHash);
  }
}

export function showAuthPage(tab){
  const landing=document.getElementById('landing-page');
  const auth=document.getElementById('auth-page');
  if(landing)landing.style.display='none';
  if(auth)auth.style.display='block';
  setPublicNavbarMode(true);
  document.querySelectorAll('[data-landing-link]').forEach(el=>el.classList.remove('active'));

  const nl=document.querySelector('.landing-nav-links');
  if(nl)nl.classList.remove('mobile-show');
  window.scrollTo(0,0);
  authTab(tab==='reg'?'reg':'login');
}

export function showLandingPage(){
  showLandingRoute('home',true);
}

export function landingNavTo(route){
  showLandingRoute(route,true);
}

export function initializeLandingRouting(){
  const hash=String(window.location.hash||'');
  const match=hash.match(/^#page=(home|services|about|contact)$/);
  showLandingRoute(match?match[1]:'home',false);
  initializeLandingCarouselInteractions();
  startLandingCarouselTimer();

  window.addEventListener('popstate',()=>{
    const m=String(window.location.hash||'').match(/^#page=(home|services|about|contact)$/);
    if(m)showLandingRoute(m[1],false);
  });
}

// Login and registration share one card; its single tab names the form currently shown.
export function authTab(t){
  const title=document.getElementById('auth-mode-title');
  if(title)title.textContent=t==='reg'?'Register':'Login';
  document.getElementById('login-section').style.display=t==='login'?'':'none';
  document.getElementById('reg-section').style.display=t==='reg'?'':'none';
  const pending=document.getElementById('pending-section');
  if(pending)pending.style.display='none';
  const forgot=document.getElementById('forgot-section');
  if(forgot)forgot.style.display='none';
  document.getElementById('auth-tabs').style.display='';
  document.querySelector('#auth-page .auth-box')?.scrollIntoView?.({block:'start'});
  if(t==='reg'){
    updateRegistrationIdentityFields();
    // Load the human check while the user completes registration details.
    prepareRegistrationCaptcha(appState.supabaseClient.SUPABASE_URL,appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY).catch(()=>{});
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.authentication.LANDING_ROUTE_NAMES=['home','services','about','contact'];
  appState.authentication.landingCarouselTimer=null;
  appState.authentication.landingCarouselScrollTimer=null;
  appState.authentication.landingCarouselMouseDragging=false;
  appState.authentication.landingCarouselMouseStartX=0;
  appState.authentication.landingCarouselMouseStartScroll=0;
  appState.authentication.LANDING_CAROUSEL_COUNT=4;
}

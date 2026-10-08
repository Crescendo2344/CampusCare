// authentication: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
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
  return Math.max(1,viewport?.clientWidth||viewport?.getBoundingClientRect().width||1);
}

export function landingCarouselRealIndex(){
  const {viewport}=getLandingCarouselParts();
  if(!viewport)return 0;
  const width=landingCarouselSlideWidth();
  const raw=Math.round(viewport.scrollLeft/width);
  return ((raw%appState.authentication.LANDING_CAROUSEL_COUNT)+appState.authentication.LANDING_CAROUSEL_COUNT)%appState.authentication.LANDING_CAROUSEL_COUNT;
}

export function normalizeLandingCarouselScroll(){
  const {viewport}=getLandingCarouselParts();
  if(!viewport)return;

  const width=landingCarouselSlideWidth();
  const raw=Math.round(viewport.scrollLeft/width);
  let target=null;

  // Three identical groups exist: 0–3, 4–7, 8–11.
  // When the user reaches an outer copy, silently move to the
  // identical slide in the middle copy. No backwards animation.
  if(raw<4)target=(raw+appState.authentication.LANDING_CAROUSEL_COUNT)*width;
  else if(raw>=8)target=(raw-appState.authentication.LANDING_CAROUSEL_COUNT)*width;

  if(target!==null){
    const previous=viewport.style.scrollBehavior;
    viewport.style.scrollBehavior='auto';
    viewport.scrollLeft=target;
    // Force layout before restoring smooth scrolling so Safari/iOS
    // cannot animate the hidden normalization jump.
    void viewport.offsetWidth;
    viewport.style.scrollBehavior=previous;
  }
}

export function buildLandingCarouselLoop(){
  const {viewport,track}=getLandingCarouselParts();
  if(!viewport||!track)return;
  if(track.dataset.loopReady==='1')return;

  const originals=[...track.querySelectorAll('.hero-carousel-slide[data-real-index]')];
  if(originals.length!==appState.authentication.LANDING_CAROUSEL_COUNT)return;

  const before=originals.map(slide=>{
    const clone=slide.cloneNode(true);
    clone.removeAttribute('data-real-index');
    clone.dataset.carouselClone='before';
    return clone;
  });
  const after=originals.map(slide=>{
    const clone=slide.cloneNode(true);
    clone.removeAttribute('data-real-index');
    clone.dataset.carouselClone='after';
    return clone;
  });

  const fragment=document.createDocumentFragment();
  [...before,...originals,...after].forEach(slide=>fragment.appendChild(slide));
  track.replaceChildren(fragment);
  track.dataset.loopReady='1';

  requestAnimationFrame(()=>{
    const width=landingCarouselSlideWidth();
    const previous=viewport.style.scrollBehavior;
    viewport.style.scrollBehavior='auto';
    viewport.scrollLeft=appState.authentication.LANDING_CAROUSEL_COUNT*width;
    void viewport.offsetWidth;
    viewport.style.scrollBehavior=previous;
  });
}

export function moveLandingCarousel(step=1){
  const {viewport}=getLandingCarouselParts();
  if(!viewport)return;

  normalizeLandingCarouselScroll();
  const width=landingCarouselSlideWidth();
  const target=viewport.scrollLeft+(Number(step||1)>=0?width:-width);

  try{
    viewport.scrollTo({left:target,behavior:'smooth'});
  }catch(_){
    viewport.scrollLeft=target;
  }

  setTimeout(normalizeLandingCarouselScroll,700);
}

export function startLandingCarouselTimer(){
  if(appState.authentication.landingCarouselTimer)clearInterval(appState.authentication.landingCarouselTimer);
  restartLandingCarouselProgress();

  appState.authentication.landingCarouselTimer=setInterval(()=>{
    const landing=document.getElementById('landing-page');
    const home=document.querySelector('[data-landing-route="home"]');
    if(landing?.style.display==='none'||!home?.classList.contains('active')||appState.authentication.landingCarouselMouseDragging)return;
    moveLandingCarousel(1);
    restartLandingCarouselProgress();
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
  const {viewport}=getLandingCarouselParts();
  if(!viewport)return;
  const width=landingCarouselSlideWidth();
  const target=Math.round(viewport.scrollLeft/width)*width;

  try{
    viewport.scrollTo({left:target,behavior:'smooth'});
  }catch(_){
    viewport.scrollLeft=target;
  }

  setTimeout(normalizeLandingCarouselScroll,500);
}

export function initializeLandingCarouselInteractions(){
  const {carousel,viewport}=getLandingCarouselParts();
  if(!carousel||!viewport)return;

  buildLandingCarouselLoop();

  if(carousel.dataset.interactionsReady!=='1'){
    carousel.dataset.interactionsReady='1';

    // Native touch swipe is kept intact. Manual dragging is only added for a mouse.
    viewport.addEventListener('pointerdown',e=>{
      pauseLandingCarouselTimer();

      if(e.pointerType==='mouse'&&e.button===0){
        appState.authentication.landingCarouselMouseDragging=true;
        appState.authentication.landingCarouselMouseStartX=e.clientX;
        appState.authentication.landingCarouselMouseStartScroll=viewport.scrollLeft;
        viewport.classList.add('dragging');
        try{viewport.setPointerCapture(e.pointerId);}catch(_){}
      }
    });

    viewport.addEventListener('pointermove',e=>{
      if(!appState.authentication.landingCarouselMouseDragging||e.pointerType!=='mouse')return;
      const delta=e.clientX-appState.authentication.landingCarouselMouseStartX;
      viewport.scrollLeft=appState.authentication.landingCarouselMouseStartScroll-delta;
      if(e.cancelable)e.preventDefault();
    });

    const finishPointer=e=>{
      if(appState.authentication.landingCarouselMouseDragging){
        appState.authentication.landingCarouselMouseDragging=false;
        viewport.classList.remove('dragging');
        try{viewport.releasePointerCapture?.(e.pointerId);}catch(_){}
        snapLandingCarouselToNearest();
      }else{
        // Native touch/pen swipe settles with scroll-snap; normalize after it finishes.
        setTimeout(normalizeLandingCarouselScroll,350);
      }
      startLandingCarouselTimer();
    };

    viewport.addEventListener('pointerup',finishPointer);
    viewport.addEventListener('pointercancel',finishPointer);
    viewport.addEventListener('lostpointercapture',e=>{
      if(appState.authentication.landingCarouselMouseDragging)finishPointer(e);
    });

    viewport.addEventListener('scroll',()=>{
      if(appState.authentication.landingCarouselScrollTimer)clearTimeout(appState.authentication.landingCarouselScrollTimer);
      appState.authentication.landingCarouselScrollTimer=setTimeout(()=>{
        if(!appState.authentication.landingCarouselMouseDragging)normalizeLandingCarouselScroll();
      },180);
    },{passive:true});

    carousel.addEventListener('keydown',e=>{
      if(e.key==='ArrowLeft'){
        e.preventDefault();
        pauseLandingCarouselTimer();
        moveLandingCarousel(-1);
        startLandingCarouselTimer();
      }
      if(e.key==='ArrowRight'){
        e.preventDefault();
        pauseLandingCarouselTimer();
        moveLandingCarousel(1);
        startLandingCarouselTimer();
      }
    });

    window.addEventListener('resize',()=>{
      const real=landingCarouselRealIndex();
      requestAnimationFrame(()=>{
        const width=landingCarouselSlideWidth();
        viewport.scrollLeft=(appState.authentication.LANDING_CAROUSEL_COUNT+real)*width;
      });
    });
  }

  // Returning to Home always positions the carousel on a real middle-set slide.
  requestAnimationFrame(()=>{
    const width=landingCarouselSlideWidth();
    const real=landingCarouselRealIndex();
    viewport.scrollLeft=(appState.authentication.LANDING_CAROUSEL_COUNT+real)*width;
  });
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

export function authTab(t){
  document.querySelectorAll('.auth-tab').forEach((b,i)=>b.classList.toggle('active',i===(t==='login'?0:1)));
  document.getElementById('login-section').style.display=t==='login'?'':'none';
  document.getElementById('reg-section').style.display=t==='reg'?'':'none';
  const pending=document.getElementById('pending-section');
  if(pending)pending.style.display='none';
  const forgot=document.getElementById('forgot-section');
  if(forgot)forgot.style.display='none';
  document.getElementById('auth-tabs').style.display='flex';
  if(t==='reg')updateRegistrationIdentityFields();
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

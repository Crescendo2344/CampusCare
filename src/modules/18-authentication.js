// ================================================================
// AUTH
// ================================================================

const LANDING_ROUTE_NAMES=['home','services','about','contact'];
let landingCarouselTimer=null;
let landingCarouselScrollTimer=null;
let landingCarouselMouseDragging=false;
let landingCarouselMouseStartX=0;
let landingCarouselMouseStartScroll=0;
const LANDING_CAROUSEL_COUNT=4;

function getLandingCarouselParts(){
  return {
    carousel:document.getElementById('landing-swipe-carousel'),
    viewport:document.getElementById('hero-carousel-viewport'),
    track:document.getElementById('hero-carousel-track')
  };
}

function restartLandingCarouselProgress(){
  const bar=document.getElementById('hero-carousel-progress-bottom');
  if(!bar)return;
  bar.classList.remove('running');
  void bar.offsetWidth;
  bar.classList.add('running');
}

function pauseLandingCarouselProgress(){
  document.getElementById('hero-carousel-progress-bottom')?.classList.remove('running');
}

function landingCarouselSlideWidth(){
  const {viewport}=getLandingCarouselParts();
  return Math.max(1,viewport?.clientWidth||viewport?.getBoundingClientRect().width||1);
}

function landingCarouselRealIndex(){
  const {viewport}=getLandingCarouselParts();
  if(!viewport)return 0;
  const width=landingCarouselSlideWidth();
  const raw=Math.round(viewport.scrollLeft/width);
  return ((raw%LANDING_CAROUSEL_COUNT)+LANDING_CAROUSEL_COUNT)%LANDING_CAROUSEL_COUNT;
}

function normalizeLandingCarouselScroll(){
  const {viewport}=getLandingCarouselParts();
  if(!viewport)return;

  const width=landingCarouselSlideWidth();
  const raw=Math.round(viewport.scrollLeft/width);
  let target=null;

  // Three identical groups exist: 0–3, 4–7, 8–11.
  // When the user reaches an outer copy, silently move to the
  // identical slide in the middle copy. No backwards animation.
  if(raw<4)target=(raw+LANDING_CAROUSEL_COUNT)*width;
  else if(raw>=8)target=(raw-LANDING_CAROUSEL_COUNT)*width;

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

function buildLandingCarouselLoop(){
  const {viewport,track}=getLandingCarouselParts();
  if(!viewport||!track)return;
  if(track.dataset.loopReady==='1')return;

  const originals=[...track.querySelectorAll('.hero-carousel-slide[data-real-index]')];
  if(originals.length!==LANDING_CAROUSEL_COUNT)return;

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
    viewport.scrollLeft=LANDING_CAROUSEL_COUNT*width;
    void viewport.offsetWidth;
    viewport.style.scrollBehavior=previous;
  });
}

function moveLandingCarousel(step=1){
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

function startLandingCarouselTimer(){
  if(landingCarouselTimer)clearInterval(landingCarouselTimer);
  restartLandingCarouselProgress();

  landingCarouselTimer=setInterval(()=>{
    const landing=document.getElementById('landing-page');
    const home=document.querySelector('[data-landing-route="home"]');
    if(landing?.style.display==='none'||!home?.classList.contains('active')||landingCarouselMouseDragging)return;
    moveLandingCarousel(1);
    restartLandingCarouselProgress();
  },5500);
}

function pauseLandingCarouselTimer(){
  if(landingCarouselTimer){
    clearInterval(landingCarouselTimer);
    landingCarouselTimer=null;
  }
  pauseLandingCarouselProgress();
}

function snapLandingCarouselToNearest(){
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

function initializeLandingCarouselInteractions(){
  const {carousel,viewport}=getLandingCarouselParts();
  if(!carousel||!viewport)return;

  buildLandingCarouselLoop();

  if(carousel.dataset.interactionsReady!=='1'){
    carousel.dataset.interactionsReady='1';

    // Native touch swipe is kept intact. Manual dragging is only added for a mouse.
    viewport.addEventListener('pointerdown',e=>{
      pauseLandingCarouselTimer();

      if(e.pointerType==='mouse'&&e.button===0){
        landingCarouselMouseDragging=true;
        landingCarouselMouseStartX=e.clientX;
        landingCarouselMouseStartScroll=viewport.scrollLeft;
        viewport.classList.add('dragging');
        try{viewport.setPointerCapture(e.pointerId);}catch(_){}
      }
    });

    viewport.addEventListener('pointermove',e=>{
      if(!landingCarouselMouseDragging||e.pointerType!=='mouse')return;
      const delta=e.clientX-landingCarouselMouseStartX;
      viewport.scrollLeft=landingCarouselMouseStartScroll-delta;
      if(e.cancelable)e.preventDefault();
    });

    const finishPointer=e=>{
      if(landingCarouselMouseDragging){
        landingCarouselMouseDragging=false;
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
      if(landingCarouselMouseDragging)finishPointer(e);
    });

    viewport.addEventListener('scroll',()=>{
      if(landingCarouselScrollTimer)clearTimeout(landingCarouselScrollTimer);
      landingCarouselScrollTimer=setTimeout(()=>{
        if(!landingCarouselMouseDragging)normalizeLandingCarouselScroll();
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
        viewport.scrollLeft=(LANDING_CAROUSEL_COUNT+real)*width;
      });
    });
  }

  // Returning to Home always positions the carousel on a real middle-set slide.
  requestAnimationFrame(()=>{
    const width=landingCarouselSlideWidth();
    const real=landingCarouselRealIndex();
    viewport.scrollLeft=(LANDING_CAROUSEL_COUNT+real)*width;
  });
}

function setPublicNavbarMode(authMode=false){
  const nav=document.getElementById('landing-navbar');
  if(nav)nav.classList.toggle('auth-mode',Boolean(authMode));
}

function showLandingRoute(route='home',updateHash=true){
  const clean=LANDING_ROUTE_NAMES.includes(route)?route:'home';
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

function showAuthPage(tab){
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

function showLandingPage(){
  showLandingRoute('home',true);
}

function landingNavTo(route){
  showLandingRoute(route,true);
}

function initializeLandingRouting(){
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

function authTab(t){
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

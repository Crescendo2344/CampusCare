// Every password field gets a show/hide eye, so people can check what they typed before submitting.
// Fields are found as they appear (sign-up, login, change password, reset), not wired one by one.
const SKIP='.au-pw-wrap input,[data-no-reveal]';

function addReveal(input){
  if(input.dataset.reveal==='1'||input.matches(SKIP))return;
  input.dataset.reveal='1';
  const wrap=document.createElement('span');
  wrap.className='pw-reveal';
  input.replaceWith(wrap);
  wrap.append(input);
  const button=document.createElement('button');
  button.type='button';
  button.className='pw-reveal-btn';
  button.setAttribute('aria-label','Show password');
  button.setAttribute('aria-pressed','false');
  if(input.id)button.setAttribute('aria-controls',input.id);
  button.innerHTML='<i class="bi bi-eye" aria-hidden="true"></i>';
  button.addEventListener('click',()=>{
    const show=input.type==='password';
    input.type=show?'text':'password';
    button.setAttribute('aria-pressed',String(show));
    button.setAttribute('aria-label',show?'Hide password':'Show password');
    button.innerHTML=`<i class="bi ${show?'bi-eye-slash':'bi-eye'}" aria-hidden="true"></i>`;
    input.focus({preventScroll:true});
  });
  wrap.append(button);
}

function scan(root=document){
  for(const input of root.querySelectorAll('input[type="password"]:not([data-reveal])'))addReveal(input);
}

export function installPasswordReveal(){
  scan();
  let queued=false;
  new MutationObserver(()=>{
    if(queued)return;queued=true;
    requestAnimationFrame(()=>{queued=false;scan();});
  }).observe(document.body,{childList:true,subtree:true});
}

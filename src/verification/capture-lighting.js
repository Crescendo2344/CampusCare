// Web pages cannot change the device's screen brightness, so verification captures use what
// browsers allow: a bright white "screen light" for cameras facing the person, the rear
// camera's flashlight where supported, and a wake lock so the screen does not dim mid-capture.
export function startCaptureLighting({track,controls,documentElement=document.documentElement,navigatorRef=navigator}){
  const settings=track?.getSettings?.()||{},capabilities=track?.getCapabilities?.()||{};
  // Laptop webcams usually report no facing mode; they face the person too.
  const facesPerson=settings.facingMode!=='environment';
  let disposed=false,wakeLock=null,screenLight=facesPerson,torch=false;
  navigatorRef.wakeLock?.request?.('screen').then(lock=>{if(disposed)lock.release().catch(()=>{});else wakeLock=lock;}).catch(()=>{});
  const button=(label,pressed,onClick)=>{
    const el=document.createElement('button');
    el.type='button';el.className='btn btn-sm capture-light-toggle';
    const render=on=>{el.setAttribute('aria-pressed',String(on));el.textContent=label+(on?': On':': Off');};
    render(pressed);el.addEventListener('click',()=>render(onClick()));
    controls?.append(el);
  };
  const applyScreenLight=()=>documentElement.classList.toggle('capture-fill-light',screenLight&&!disposed);
  if(facesPerson){applyScreenLight();button('Screen light',true,()=>{screenLight=!screenLight;applyScreenLight();return screenLight;});}
  if(capabilities.torch){
    button('Flashlight',false,()=>{
      torch=!torch;
      track.applyConstraints({advanced:[{torch}]}).catch(()=>{torch=false;});
      return torch;
    });
  }
  return {
    facesPerson,
    dispose(){
      if(disposed)return;disposed=true;
      documentElement.classList.remove('capture-fill-light');
      if(torch)track.applyConstraints?.({advanced:[{torch:false}]}).catch(()=>{});
      wakeLock?.release?.().catch(()=>{});
    }
  };
}

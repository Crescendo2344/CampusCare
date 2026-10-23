// Apply the saved appearance (or the time-based default) before the module graph loads to avoid a theme flash.
try{
  const saved=localStorage.getItem('campuscare-theme');
  const hour=new Date().getHours();
  const theme=saved==='dark'||saved==='light'?saved:(hour>=18||hour<6)?'dark':'light';
  if(theme==='dark')document.documentElement.setAttribute('data-theme','dark');
}catch{
  document.documentElement.removeAttribute('data-theme');
}

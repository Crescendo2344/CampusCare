// Apply the time-based appearance before the module graph loads to avoid a theme flash.
try{
  const hour=new Date().getHours();
  if(hour>=18||hour<6)document.documentElement.setAttribute('data-theme','dark');
}catch{
  document.documentElement.removeAttribute('data-theme');
}

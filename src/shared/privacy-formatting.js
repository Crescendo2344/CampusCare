// Hide contact details in workflow summaries while retaining recognizable destinations.
export function maskEmail(value){
  const email=String(value||'');
  const at=email.lastIndexOf('@');
  if(at<1)return email?'••••':'—';
  return `${email.slice(0,Math.min(2,at))}••••${email.slice(at)}`;
}
export function maskPhone(value){
  const digits=String(value||'').replace(/\D/g,'');
  if(!digits)return '—';
  return digits.length<=4?'••••':`••••${digits.slice(-4)}`;
}

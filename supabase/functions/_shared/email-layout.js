// One branded layout for every CampusCare email sent by the server functions, matching the
// database template used for notification emails: CTU seal header, a labelled headline, a details
// card, one button, an optional security note and the clinic footer, plus a plain-text version.
export const EMAIL_APP_URL='https://campuscare-brown-two.vercel.app/';
// Inline attachments added by the email transport (see email-images.js).
const SEAL='cid:ctu-seal',LOGO='cid:campuscare-logo';
const CLINIC='CTU Main Medical & Dental Clinic';
const ADDRESS='Ground Floor, Education Building, CTU Main Campus, M. J. Cuenco Ave., Cebu City';
const PHONE='(032) 402 4060 loc. 1142';
export const EMAIL_TONES={info:'#0a7ea8',success:'#0b6b3a',warning:'#8f5200',danger:'#b42318'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/**
 * @param {{title:string,name?:string,label?:string,tone?:keyof EMAIL_TONES,paragraphs?:string[],
 *   rows?:[string,string][],button?:{label:string,url?:string}|null,note?:string,code?:string,reason?:string}} m
 */
export function renderCampusCareEmail(m){
  const accent=EMAIL_TONES[m.tone||'info']||EMAIL_TONES.info;
  const paragraphs=(m.paragraphs||[]).filter(Boolean),rows=(m.rows||[]).filter(([,v])=>v!=null&&v!=='');
  const button=m.button===null?null:{label:m.button?.label||'Open CampusCare',url:m.button?.url||EMAIL_APP_URL};
  const preheader=paragraphs[0]||m.title;
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(m.title)}</title></head>
<body style="margin:0;padding:0;background:#eef3f7;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#16262f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader.slice(0,140))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f7"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #dbe5ec;border-radius:16px;overflow:hidden">
<tr><td style="padding:18px 26px;border-bottom:1px solid #e3eaef"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px;vertical-align:middle"><img src="${LOGO}" width="46" height="46" alt="CampusCare" style="display:block;border:0;width:46px;height:46px;border-radius:10px"></td>
<td style="padding-right:12px;vertical-align:middle"><img src="${SEAL}" width="46" height="46" alt="CTU seal" style="display:block;border:0;width:46px;height:46px"></td>
<td style="vertical-align:middle"><div style="font-size:19px;font-weight:800;color:#0a5a78;letter-spacing:.01em">CampusCare</div><div style="font-size:12px;color:#4a6571">${CLINIC.replace('&','&amp;')} · Cebu Technological University</div></td>
</tr></table></td></tr>
<tr><td style="height:4px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:26px 26px 8px">
${m.label?`<div style="display:inline-block;padding:3px 10px;border-radius:999px;background:${accent}1a;color:${accent};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">${esc(m.label)}</div>`:''}
<h1 style="margin:${m.label?'10px':'0'} 0 14px;font-size:22px;line-height:1.3;color:#16262f">${esc(m.title)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6">Hello ${esc(m.name||'there')},</p>
${paragraphs.map(p=>`<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${esc(p)}</p>`).join('')}
${m.reason?`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 14px;border-left:4px solid ${accent};background:#f6f9fb;border-radius:8px"><tr><td style="padding:12px 16px"><div style="font-size:12px;font-weight:700;color:#4a6571;text-transform:uppercase;letter-spacing:.05em">Reason</div><div style="font-size:15px;line-height:1.55;margin-top:4px">${esc(m.reason)}</div></td></tr></table>`:''}
${m.code?`<div style="margin:6px 0 14px;font-size:30px;font-weight:800;letter-spacing:.3em;font-family:Consolas,'Courier New',monospace;color:#0a5a78">${esc(m.code)}</div>`:''}
${rows.length?`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 14px;border-top:1px solid #e3eaef;border-bottom:1px solid #e3eaef">${rows.map(([k,v])=>`<tr><td style="padding:8px 0;width:150px;color:#5b6b75;font-size:13px;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;font-size:14px;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>`:''}
${button?`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 18px"><tr><td style="border-radius:10px;background:${accent}"><a href="${esc(button.url)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">${esc(button.label)}</a></td></tr></table>`:''}
${m.note?`<p style="margin:0 0 18px;padding:12px 14px;background:#fff7e6;border:1px solid #f4c778;border-radius:10px;font-size:13px;line-height:1.55;color:#5c3b00">${esc(m.note)}</p>`:''}
</td></tr>
<tr><td style="padding:16px 26px;background:#f6f9fb;border-top:1px solid #e3eaef;font-size:12px;line-height:1.6;color:#4a6571">
<strong style="color:#16262f">${CLINIC.replace('&','&amp;')}</strong><br>${esc(ADDRESS)}<br>Phone: ${esc(PHONE)}</td></tr>
</table>
<p style="max-width:560px;margin:14px auto 0;font-size:11px;line-height:1.5;color:#6b7f89;text-align:center">You received this because important changes to your CampusCare account are always emailed to you. This is an automated message; please do not reply with medical information.</p>
</td></tr></table></body></html>`;
  const text=[`Hello ${m.name||'there'},`,'',m.title.toUpperCase(),'',...paragraphs.flatMap(p=>[p,'']),
    ...(m.reason?[`Reason: ${m.reason}`,'']:[]),...(m.code?[`Code: ${m.code}`,'']:[]),
    ...(rows.length?[...rows.map(([k,v])=>`${k}: ${v}`),'']:[]),
    ...(button?[`${button.label}: ${button.url}`,'']:[]),...(m.note?[m.note,'']:[]),
    CLINIC,ADDRESS,`Phone: ${PHONE}`].join('\n');
  return {html,text};
}

// Queues an email straight to an address (for people who cannot sign in to read an in-app notice,
// or a previous address). Returns whether it was queued.
export async function queueEmail(admin,{to,subject,template='account',userId=null,...content}){
  if(!to)return false;
  const {html,text}=renderCampusCareEmail(content);
  const {error}=await admin.from('email_outbox').insert({user_id:userId,recipient_email:to,subject,html_body:html,text_body:text,
    template_key:template,status:'Pending',scheduled_at:new Date().toISOString()});
  return !error;
}

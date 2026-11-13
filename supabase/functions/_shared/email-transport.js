// Outgoing clinic email. Nodemailer sends over SMTP; by default that SMTP server is Resend's
// (smtp.resend.com, user "resend", password = RESEND_API_KEY), so one Resend key powers both.
// If the SMTP connection itself fails (a blocked port, a timeout), the same message goes through
// Resend's HTTP API instead, so a network hiccup never leaves the queue stuck.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY          Resend key: SMTP password and HTTP fallback
//   CAMPUSCARE_EMAIL_FROM   Sender, e.g. "CampusCare <clinic@your-domain>" (a domain verified in Resend)
//   SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS   Optional: another SMTP provider instead of Resend
//   EMAIL_TRANSPORT         Optional: "api" sends through Resend's HTTP API only
//
// Supabase Edge Functions block outgoing ports 25 and 587, so SMTP uses 465 (implicit TLS) by default.

import {inlineImagesFor} from './email-images.js';

const CONNECTION_ERRORS=new Set(['ECONNECTION','ETIMEDOUT','ESOCKET','EDNS','ECONNREFUSED','ECONNRESET','ETLS','EPROTOCOL']);

export function emailSettings(env){
  const read=name=>{try{return String(env(name)||'').trim();}catch{return '';}};
  const resendKey=read('RESEND_API_KEY');
  const from=read('CAMPUSCARE_EMAIL_FROM');
  const customHost=read('SMTP_HOST');
  const host=customHost||(resendKey?'smtp.resend.com':'');
  const port=Number(read('SMTP_PORT'))||465;
  const user=customHost?read('SMTP_USER'):'resend';
  const pass=customHost?read('SMTP_PASS'):resendKey;
  const apiOnly=read('EMAIL_TRANSPORT').toLowerCase()==='api';
  const smtp=!apiOnly&&host&&user&&pass?{host,port,secure:port===465,auth:{user,pass}}:null;
  const configured=Boolean(from&&(smtp||resendKey));
  const provider=!configured?'Not configured'
    :smtp?`Nodemailer · ${customHost?host:'Resend'} SMTP`
    :'Resend API';
  return {from,smtp,resendKey,configured,provider};
}

export function createMailer({env,createTransport,request=(...args)=>fetch(...args)}){
  const settings=emailSettings(env);
  let transporter=null;

  async function viaSmtp(mail){
    transporter??=createTransport({...settings.smtp,pool:true,maxConnections:1,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
    // Header logos travel with the message as inline attachments (cid:), so they show without remote images.
    const attachments=inlineImagesFor(mail.html).map(img=>({filename:img.filename,content:img.base64,encoding:'base64',contentType:img.contentType,cid:img.cid}));
    const info=await transporter.sendMail({from:settings.from,to:mail.to,subject:mail.subject,html:mail.html,text:mail.text||undefined,...(attachments.length?{attachments}:{})});
    if(info?.rejected?.length)throw Object.assign(new Error(`Recipient rejected: ${info.rejected.join(', ')}`),{code:'EENVELOPE'});
    return {id:String(info?.messageId||''),transport:'nodemailer'};
  }

  async function viaApi(mail){
    const resp=await request('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:`Bearer ${settings.resendKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:settings.from,to:[mail.to],subject:mail.subject,html:mail.html,text:mail.text||undefined,
        ...(inlineImagesFor(mail.html).length?{attachments:inlineImagesFor(mail.html).map(img=>({filename:img.filename,content:img.base64,content_type:img.contentType,content_id:img.cid}))}:{})})
    });
    const result=await resp.json().catch(()=>({}));
    if(!resp.ok)throw new Error(result?.message||`Email provider returned HTTP ${resp.status}`);
    return {id:String(result?.id||''),transport:'resend-api'};
  }

  return {
    settings,
    async send(mail){
      if(!settings.configured)throw new Error('Email provider is not configured.');
      if(settings.smtp){
        try{return await viaSmtp(mail);}
        catch(error){
          // Only a connection problem falls back; a rejected message would be rejected by the API too.
          if(!settings.resendKey||!CONNECTION_ERRORS.has(error?.code))throw error;
          transporter?.close?.();transporter=null;
          const sent=await viaApi(mail);
          return {...sent,fallbackReason:String(error?.message||error?.code)};
        }
      }
      return viaApi(mail);
    },
    close(){transporter?.close?.();transporter=null;}
  };
}

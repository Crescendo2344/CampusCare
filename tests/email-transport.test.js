import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {SMTPServer} from 'smtp-server';
import {emailSettings,createMailer} from '../supabase/functions/_shared/email-transport.js';

const envFrom=values=>name=>values[name];
const mail={to:'patient@example.test',subject:'Reminder',html:'<p>Bring your COR.</p>',text:'Bring your COR.'};

test('without a key and sender nothing is configured and pending emails stay queued',()=>{
  assert.equal(emailSettings(envFrom({})).configured,false);
  assert.equal(emailSettings(envFrom({RESEND_API_KEY:'re_x'})).configured,false,'A sender address is required');
  assert.equal(emailSettings(envFrom({CAMPUSCARE_EMAIL_FROM:'CampusCare <a@b.test>'})).configured,false);
  assert.equal(emailSettings(()=>{throw new Error('blocked');}).configured,false,'Unreadable variables are treated as missing');
});

test('one Resend key makes Nodemailer use Resend SMTP on port 465',()=>{
  const s=emailSettings(envFrom({RESEND_API_KEY:'re_x',CAMPUSCARE_EMAIL_FROM:'CampusCare <a@b.test>'}));
  assert.deepEqual(s.smtp,{host:'smtp.resend.com',port:465,secure:true,auth:{user:'resend',pass:'re_x'}});
  assert.equal(s.provider,'Nodemailer · Resend SMTP');
});

test('a custom SMTP server and API-only mode are both supported',()=>{
  const custom=emailSettings(envFrom({CAMPUSCARE_EMAIL_FROM:'a@b.test',SMTP_HOST:'smtp.school.test',SMTP_PORT:'2465',SMTP_USER:'u',SMTP_PASS:'p'}));
  assert.deepEqual(custom.smtp,{host:'smtp.school.test',port:2465,secure:false,auth:{user:'u',pass:'p'}});
  assert.equal(custom.provider,'Nodemailer · smtp.school.test SMTP');
  const api=emailSettings(envFrom({RESEND_API_KEY:'re_x',CAMPUSCARE_EMAIL_FROM:'a@b.test',EMAIL_TRANSPORT:'api'}));
  assert.equal(api.smtp,null);assert.equal(api.provider,'Resend API');
});

test('a connection failure falls back to the Resend API once; a rejected message does not',async()=>{
  const requests=[];
  const request=async(url,init)=>{requests.push({url,body:JSON.parse(init.body),auth:init.headers.Authorization});return new Response(JSON.stringify({id:'api-1'}),{status:200});};
  const failing=code=>()=>({sendMail:async()=>{throw Object.assign(new Error('boom'),{code});},close(){}});
  const env=envFrom({RESEND_API_KEY:'re_x',CAMPUSCARE_EMAIL_FROM:'CampusCare <a@b.test>'});

  const sent=await createMailer({env,createTransport:failing('ETIMEDOUT'),request}).send(mail);
  assert.equal(sent.transport,'resend-api');assert.equal(sent.id,'api-1');assert.match(sent.fallbackReason,/boom/);
  assert.equal(requests.length,1);assert.equal(requests[0].url,'https://api.resend.com/emails');assert.equal(requests[0].auth,'Bearer re_x');
  assert.deepEqual(requests[0].body.to,['patient@example.test']);

  await assert.rejects(createMailer({env,createTransport:failing('EENVELOPE'),request}).send(mail),/boom/);
  assert.equal(requests.length,1,'A rejected recipient is not retried through the API');
});

test('an API error is reported with the provider message',async()=>{
  const env=envFrom({RESEND_API_KEY:'re_x',CAMPUSCARE_EMAIL_FROM:'a@b.test',EMAIL_TRANSPORT:'api'});
  const request=async()=>new Response(JSON.stringify({message:'Domain not verified'}),{status:403});
  await assert.rejects(createMailer({env,createTransport:()=>assert.fail('SMTP must not be used'),request}).send(mail),/Domain not verified/);
});

test('real Nodemailer delivers the message to an SMTP server',async()=>{
  const received=[];
  const server=new SMTPServer({authOptional:false,disabledCommands:['STARTTLS'],
    onAuth(auth,session,cb){cb(auth.username==='u'&&auth.password==='p'?null:new Error('bad login'),{user:auth.username});},
    onData(stream,session,cb){let raw='';stream.on('data',c=>raw+=c);stream.on('end',()=>{received.push({raw,to:session.envelope.rcptTo.map(r=>r.address)});cb();});}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.server.address().port;
  try{
    const mailer=createMailer({env:envFrom({CAMPUSCARE_EMAIL_FROM:'CampusCare <clinic@example.test>',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(port),SMTP_USER:'u',SMTP_PASS:'p'}),createTransport:nodemailer.createTransport,request:()=>assert.fail('No API fallback expected')});
    const result=await mailer.send(mail);
    mailer.close();
    assert.equal(result.transport,'nodemailer');assert.match(result.id,/^<.+@.+>$/);
    assert.equal(received.length,1);assert.deepEqual(received[0].to,['patient@example.test']);
    assert.match(received[0].raw,/Subject: Reminder/);assert.match(received[0].raw,/Bring your COR/);
  }finally{await new Promise(r=>server.close(r));}
});

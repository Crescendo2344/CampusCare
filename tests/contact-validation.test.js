// Exercise shared client/server validation and domain routing without contacting private mailboxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emailValidationError,normalizePhilippineMobile} from '../supabase/functions/_shared/contact-validation.js';
import {createMailDomainValidator} from '../supabase/functions/_shared/mail-domain.js';
test('email syntax supports tagged and custom addresses and catches common provider/CTU typos',()=>{
  for(const email of ['jo@gmail.com','jo+clinic@ctu.edu.ph','o\'hara@school.example.edu.ph','user@company.io','jo@yahoo.com.ph','jo@proton.me'])assert.equal(emailValidationError(email),'',email);
  for(const email of ['jo@gmal.com','jo@gmial.com','jo@gmail.con','jo@outlok.com','jo@ctu.eduph'])assert.match(emailValidationError(email),/Did you mean/,email);
  for(const email of ['jo','jo@','jo@@gmail.com','.jo@gmail.com','jo..s@gmail.com','jo@-school.com','jo@school..com','jo@school.c','jo@ctu.edu.p'])assert(emailValidationError(email),email);
});
test('Philippine mobile numbers accept both dialling formats and reject incomplete or wrong prefixes',()=>{
  for(const input of ['09175823461','+639175823461','+63 (917) 582-3461'])assert.equal(normalizePhilippineMobile(input),'09175823461');
  for(const input of ['08171234567','0917123456','+63171234567','639175823461','091758234618','+6391758234618','0917abc4567'])assert.equal(normalizePhilippineMobile(input),'');
});
test('domain routing accepts MX and implicit SMTP, rejects NXDOMAIN and null MX, and distinguishes outages',async()=>{
  let requests=[];
  const run=async responses=>createMailDomainValidator()('school.example.edu.ph',async(url,options)=>{
    requests.push({url,options});const type=new URL(url).searchParams.get('type');return Response.json(responses[type]||{Status:0,Answer:[]});
  });
  assert.equal(await run({MX:{Status:0,Answer:[{type:15,data:'10 mail.school.example.edu.ph.'}]}}),null);
  assert(requests[0].url.includes('name=school.example.edu.ph'));assert(!requests[0].url.includes('@'));assert(requests[0].options.signal);
  assert.equal(await run({MX:{Status:3}}).then(x=>x.status),400);
  assert.equal(await run({MX:{Status:0,Answer:[{type:15,data:'0 .'}]}}).then(x=>x.status),400);
  assert.equal(await run({A:{Status:0,Answer:[{type:1,data:'192.0.2.1'}]}}),null);
  assert.equal(await run({AAAA:{Status:0,Answer:[{type:28,data:'2001:db8::1'}]}}),null);
  assert.equal(await run({}).then(x=>x.status),400);
  assert.equal(await run({MX:{Status:2}}).then(x=>x.status),503);
  assert.equal((await createMailDomainValidator()('school.example.edu.ph',async()=>{throw new Error('timeout');})).status,503);
});

test('mail routing falls back to a second resolver without mistaking an outage for an invalid domain',async()=>{
  const hosts=[];
  const result=await createMailDomainValidator()('school.example.edu.ph',async url=>{
    hosts.push(new URL(url).hostname);
    if(hosts.length===1)throw new Error('first resolver unavailable');
    return Response.json({Status:0,Answer:[{type:15,data:'10 mail.school.example.edu.ph.'}]});
  });
  assert.equal(result,null);assert.deepEqual(hosts,['dns.google','cloudflare-dns.com']);
});
test('incomplete or misspelled provider and CTU domains get a suggestion; real domains do not',()=>{
  const cases={'jo@gmel':'gmail.com','jo@gmail':'gmail.com','jo@gmailcom':'gmail.com','jo@gmel.com':'gmail.com','jo@yaho':'yahoo.com','jo@outlok':'outlook.com','jo@ctu':'ctu.edu.ph','jo@ctu.edu':'ctu.edu.ph','jo@ctuedu.ph':'ctu.edu.ph'};
  for(const [email,domain] of Object.entries(cases))assert.equal(emailValidationError(email),`Check the email domain. Did you mean @${domain}?`,email);
  for(const email of ['jo@ctu.edu.ph','jo@ctu.edu.vn','jo@yahoo.de','jo@gmx.com','jo@mail.com','jo@company.io'])assert.equal(emailValidationError(email),'',email);
});
test('placeholder mobile numbers are refused with a clear message',async()=>{
  const {mobileValidationError}=await import('../supabase/functions/_shared/contact-validation.js');
  for(const input of ['09999999999','09111100001','09123456789','09171234567','09987654321','09181112222','09170000000','+639999999999'])
    {assert.equal(normalizePhilippineMobile(input),'',input);assert.match(mobileValidationError(input),/real mobile number/,input);}
  for(const input of ['09175823461','09995550013','09054247230','09281234561'])assert.equal(mobileValidationError(input),'',input);
});
test('the birth-date calendar stops 16 years back and the message does not name an age',async()=>{
  const {latestBirthDate,birthDateValidationError}=await import('../supabase/functions/_shared/registration-validation.js');
  assert.equal(latestBirthDate('2026-11-19'),'2010-11-19');
  assert.equal(latestBirthDate('2028-02-29'),'2012-02-29');
  assert.equal(latestBirthDate('2027-02-28'),'2011-02-28');
  assert.equal(birthDateValidationError('2010-11-19','2026-11-19'),'');
  const young=birthDateValidationError('2010-11-20','2026-11-19');
  assert.ok(young);assert.ok(!/16|sixteen|old|age/i.test(young),young);
});

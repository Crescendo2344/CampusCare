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
  for(const input of ['09171234567','+639171234567','+63 (917) 123-4567'])assert.equal(normalizePhilippineMobile(input),'09171234567');
  for(const input of ['08171234567','0917123456','+63171234567','639171234567','091712345678','+6391712345678','0917abc4567'])assert.equal(normalizePhilippineMobile(input),'');
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

// Check domain mail routing, never the private mailbox name. This does not prove mailbox ownership.
export function createMailDomainValidator(){
  const validDomains=new Map();
  return async function checkMailDomain(domain,fetcher=fetch){
    if((validDomains.get(domain)||0)>Date.now())return null;
    const invalid={status:400,error:'This email domain cannot receive email. Check its spelling.'};
    const query=async type=>{
      // Fail over to an independent resolver instead of blocking registration on one provider outage.
      for(const endpoint of ['https://dns.google/resolve','https://cloudflare-dns.com/dns-query']){
        try{
          const url=endpoint+'?'+new URLSearchParams({name:domain,type});
          const response=await fetcher(url,{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(15000)});
          if(!response.ok)throw new Error('DNS service unavailable');
          const result=await response.json();
          if(![0,3].includes(result.Status)||result.TC)throw new Error('DNS lookup incomplete');
          return result;
        }catch{ /* The second resolver may still be healthy. No mailbox data is transmitted. */ }
      }
      throw new Error('DNS services unavailable');
    };
    try{
      const mx=await query('MX');
      if(mx.Status===3)return invalid;
      const routes=(mx.Answer||[]).filter(record=>record.type===15);
      if(routes.length){
        // A null MX explicitly declares that a domain does not accept email.
        if(!routes.some(record=>!/^\d+\s+\.$/.test(record.data)))return invalid;
      }else{
        // SMTP permits an address record as an implicit MX when no explicit MX is published.
        const addresses=await Promise.all([query('A'),query('AAAA')]);
        if(!addresses.some(result=>result.Status===0&&(result.Answer||[]).some(record=>record.type===1||record.type===28)))return invalid;
      }
      // Bound isolate memory and avoid repeated lookups during legitimate retries.
      if(validDomains.size>=256)validDomains.delete(validDomains.keys().next().value);
      validDomains.set(domain,Date.now()+300000);
      return null;
    }catch{return {status:503,error:'Email domain check is temporarily unavailable. Please try again shortly.'};}
  };
}

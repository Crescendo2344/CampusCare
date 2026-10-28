// AI forecast insights: one panel for the report forecast and the inventory planner.
// The panel sends only the aggregated forecast (no patient details) to the forecast-insights server function,
// which asks a free AI model (Gemini or Groq) for a short briefing. Nothing runs until the user asks for it.
import {state} from '../app/state.js';
import {escapeHtml} from '../features/issueReports.js';

const esc=v=>escapeHtml(String(v??''));
const cache=new Map();

const TIMEOUT_MS=140000;
async function requestInsights(kind,context,question='',history=[]){
  const supabase=state.supabaseClient;
  if(!state.auth.currentUser?._realSupabase||!supabase?.supabaseClient)throw new Error('AI insights need a connection to the CampusCare server.');
  const {data:{session}}=await supabase.supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');
  let response;
  try{
    response=await fetch(`${supabase.SUPABASE_URL}/functions/v1/forecast-insights`,{
      method:'POST',signal:AbortSignal.timeout(TIMEOUT_MS),
      headers:{'Content-Type':'application/json',apikey:supabase.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify({kind,context,question,history})
    });
  }catch(error){
    throw new Error(error?.name==='TimeoutError'||error?.name==='AbortError'?'The AI took too long to answer. Try again.':'Could not reach the AI service. Check your connection and try again.');
  }
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok){
    const fallback=[504,546].includes(response.status)?'The AI took too long to answer. Try again.':response.status===429?'Too many AI requests right now. Try again in a minute.':`The AI service is unavailable right now (${response.status}). Try again.`;
    const error=new Error(result.error||fallback);error.setup=!!result.setup_required;throw error;
  }
  return result;
}

const SUGGESTIONS={
  inventory:['What should we order first?','Which items could run out this month?','Which items are expiring soon?'],
  reports:['Which period needs the most attention?','How reliable is this forecast?','What could explain the trend?']
};

export function aiInsightsPanelHtml(host,kind){
  return `<section class="ai-insights" id="${host}" data-kind="${kind}">
    <div class="ai-insights-head">
      <div><span class="ai-badge"><i class="bi bi-stars" aria-hidden="true"></i> AI insights</span><h4>${kind==='inventory'?'AI inventory forecast: what to reorder and when':'Let AI explain this forecast'}</h4></div>
      <button type="button" class="btn btn-sm btn-primary ai-generate">Generate insights</button>
    </div>
    <div class="ai-scroll" aria-live="polite"><div class="ai-insights-body"></div><div class="ai-thread"></div></div>
    <div class="ai-composer">
      <div class="ai-suggestions">${SUGGESTIONS[kind].map(s=>`<button type="button" class="ai-suggestion">${esc(s)}</button>`).join('')}</div>
      <form class="ai-ask">
        <i class="bi bi-stars" aria-hidden="true"></i>
        <textarea rows="1" maxlength="300" placeholder="Ask AI about this forecast…" aria-label="Ask AI about this forecast"></textarea>
        <button type="submit" class="ai-send" aria-label="Send question" disabled><i class="bi bi-arrow-up" aria-hidden="true"></i></button>
      </form>
    </div>
  </section>`;
}

function busyHtml(text){
  return `<div class="ai-loading"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span> <span>${esc(text)}</span> <span class="ai-elapsed"></span></div>`;
}
function errorHtml(error){
  return `<div class="ai-error ${error.setup?'setup':''}"><i class="bi ${error.setup?'bi-key':'bi-exclamation-circle'}" aria-hidden="true"></i><span>${esc(error.message)}</span></div>`;
}
// Counts seconds while waiting so a slow answer does not look frozen.
function startTimer(el){
  const begun=Date.now();
  const tick=()=>{const span=el.querySelector('.ai-elapsed');if(!span)return clearInterval(id);const s=Math.round((Date.now()-begun)/1000);span.textContent=s>=3?`${s}s`:'';};
  const id=setInterval(tick,1000);return ()=>clearInterval(id);
}

// getContext returns the forecast data to analyse; it is read only when the user asks.
export function mountAiInsights(host,kind,getContext){
  const root=document.getElementById(host);if(!root)return;
  const button=root.querySelector('.ai-generate'),body=root.querySelector('.ai-insights-body'),thread=root.querySelector('.ai-thread');
  const scroll=root.querySelector('.ai-scroll'),form=root.querySelector('.ai-ask'),input=form.querySelector('textarea'),send=form.querySelector('.ai-send');
  const history=[];let asking=false;
  const toBottom=()=>{scroll.scrollTop=scroll.scrollHeight;};
  const fit=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px';send.disabled=asking||input.value.trim().length<3;};

  const generate=async()=>{
    const context=getContext(),cacheKey=JSON.stringify(context);
    button.disabled=true;body.innerHTML=busyHtml('Reading the forecast…');const stop=startTimer(body);
    scroll.scrollTop=0;
    try{
      const result=cache.get(cacheKey)||await requestInsights(kind,context);
      cache.set(cacheKey,result);
      body.innerHTML=insightsHtml(result);
      button.textContent='Regenerate';
    }catch(error){body.innerHTML=errorHtml(error);}
    finally{stop();button.disabled=false;}
  };
  const ask=async question=>{
    if(asking)return;
    asking=true;fit();
    const item=document.createElement('div');item.className='ai-turn';
    item.innerHTML=`<div class="ai-q">${esc(question)}</div><div class="ai-a">${busyHtml('Thinking…')}</div>`;
    thread.append(item);toBottom();
    const answer=item.querySelector('.ai-a'),stop=startTimer(answer);
    try{
      const result=await requestInsights(kind,getContext(),question,history);
      const text=result.insights.answer||'No answer was returned.';
      history.push({question,answer:text});
      answer.innerHTML=`<i class="bi bi-stars" aria-hidden="true"></i><p>${esc(text)}</p>`;
    }catch(error){answer.innerHTML=errorHtml(error);}
    finally{stop();asking=false;fit();toBottom();}
  };

  button.addEventListener('click',()=>{cache.delete(JSON.stringify(getContext()));generate();});
  input.addEventListener('input',fit);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit();}});
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const q=input.value.trim();if(q.length<3||asking)return;
    input.value='';fit();ask(q);
  });
  root.querySelectorAll('.ai-suggestion').forEach(chip=>chip.addEventListener('click',()=>ask(chip.textContent)));
}

const RISK_ICON={high:'bi-exclamation-octagon',medium:'bi-exclamation-triangle',low:'bi-info-circle'};
const PRIORITY_LABEL={now:'Do now',soon:'This month',later:'Later'};
function insightsHtml({insights:i,model,generated_at}){
  return `<p class="ai-headline">${esc(i.headline)}</p>
    <p class="ai-summary">${esc(i.summary)}</p>
    <div class="ai-grid">
      ${i.highlights?.length?`<div class="ai-block"><h5><i class="bi bi-lightbulb" aria-hidden="true"></i> Key findings</h5><ul>${i.highlights.map(h=>`<li><strong>${esc(h.title)}</strong><span>${esc(h.detail)}</span></li>`).join('')}</ul></div>`:''}
      ${i.risks?.length?`<div class="ai-block"><h5><i class="bi bi-shield-exclamation" aria-hidden="true"></i> Risks to watch</h5><ul>${i.risks.map(r=>`<li class="ai-risk ${esc(r.level)}"><strong><i class="bi ${RISK_ICON[r.level]||'bi-info-circle'}" aria-hidden="true"></i> ${esc(r.title)}<em>${esc(r.level)}</em></strong><span>${esc(r.detail)}</span></li>`).join('')}</ul></div>`:''}
    </div>
    ${i.actions?.length?`<div class="ai-block"><h5><i class="bi bi-check2-square" aria-hidden="true"></i> Recommended actions</h5><ol class="ai-actions">${i.actions.map(a=>`<li><span class="ai-priority ${esc(a.priority)}">${esc(PRIORITY_LABEL[a.priority]||a.priority)}</span><div><strong>${esc(a.action)}</strong><span>${esc(a.reason)}</span></div></li>`).join('')}</ol></div>`:''}
    ${i.caveats?.length?`<details class="ai-caveats"><summary>Limits of this analysis</summary><ul>${i.caveats.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></details>`:''}
    <p class="ai-foot">AI-generated · ${esc(model||'Gemini')} · ${esc(new Date(generated_at).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}))}</p>`;
}

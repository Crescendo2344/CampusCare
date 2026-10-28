// AI forecast insights: one panel for the report forecast and the inventory planner.
// The panel sends only the aggregated forecast (no patient details) to the forecast-insights server function,
// which asks Claude for a short briefing. Nothing runs until the user asks for it.
import {state} from '../app/state.js';
import {escapeHtml} from '../features/issueReports.js';

const esc=v=>escapeHtml(String(v??''));
const cache=new Map();

async function requestInsights(kind,context,question=''){
  const supabase=state.supabaseClient;
  if(!state.auth.currentUser?._realSupabase||!supabase?.supabaseClient)throw new Error('AI insights need a connection to the CampusCare server.');
  const {data:{session}}=await supabase.supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');
  const response=await fetch(`${supabase.SUPABASE_URL}/functions/v1/forecast-insights`,{
    method:'POST',
    headers:{'Content-Type':'application/json',apikey:supabase.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify({kind,context,question})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok){const error=new Error(result.error||'AI insights failed.');error.setup=!!result.setup_required;throw error;}
  return result;
}

export function aiInsightsPanelHtml(host,kind){
  return `<section class="ai-insights" id="${host}" data-kind="${kind}" aria-live="polite">
    <div class="ai-insights-head">
      <div><span class="ai-badge"><i class="bi bi-stars" aria-hidden="true"></i> AI insights</span><h4>Let AI explain this forecast</h4></div>
      <button type="button" class="btn btn-sm btn-primary ai-generate">Generate insights</button>
    </div>
    <div class="ai-insights-body"></div>
  </section>`;
}

// getContext returns the forecast data to analyse; it is read only when the user asks.
export function mountAiInsights(host,kind,getContext){
  const root=document.getElementById(host);if(!root)return;
  const button=root.querySelector('.ai-generate'),body=root.querySelector('.ai-insights-body');
  const key=()=>JSON.stringify(getContext());
  const run=async(question='')=>{
    const context=getContext(),cacheKey=key()+'|'+question;
    button.disabled=true;
    const busy=`<div class="ai-loading"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span> ${question?'Thinking about your question…':'Reading the forecast…'}</div>`;
    if(question)root.querySelector('.ai-answer-slot').innerHTML=busy;else body.innerHTML=busy;
    try{
      const result=cache.get(cacheKey)||await requestInsights(kind,context,question);
      cache.set(cacheKey,result);
      if(question){root.querySelector('.ai-answer-slot').innerHTML=answerHtml(question,result.insights.answer);return;}
      body.innerHTML=insightsHtml(result);
      button.textContent='Regenerate';
      const form=root.querySelector('.ai-ask');
      form?.addEventListener('submit',event=>{
        event.preventDefault();
        const input=form.querySelector('input'),q=input.value.trim();
        if(q.length<3)return;
        run(q);input.value='';
      });
      root.querySelectorAll('.ai-suggestion').forEach(chip=>chip.addEventListener('click',()=>run(chip.textContent)));
    }catch(error){
      const html=`<div class="ai-error ${error.setup?'setup':''}"><i class="bi ${error.setup?'bi-key':'bi-exclamation-circle'}" aria-hidden="true"></i><span>${esc(error.message)}</span></div>`;
      if(question)root.querySelector('.ai-answer-slot').innerHTML=html;else body.innerHTML=html;
    }finally{button.disabled=false;}
  };
  button.addEventListener('click',()=>{for(const k of [...cache.keys()])if(k.startsWith(key()))cache.delete(k);run();});
}

const RISK_ICON={high:'bi-exclamation-octagon',medium:'bi-exclamation-triangle',low:'bi-info-circle'};
const PRIORITY_LABEL={now:'Do now',soon:'This month',later:'Later'};
function insightsHtml({insights:i,model,generated_at}){
  const suggestions=['Which period needs the most attention?','What should we order first?','How reliable is this forecast?'];
  return `<p class="ai-headline">${esc(i.headline)}</p>
    <p class="ai-summary">${esc(i.summary)}</p>
    <div class="ai-grid">
      ${i.highlights?.length?`<div class="ai-block"><h5><i class="bi bi-lightbulb" aria-hidden="true"></i> Key findings</h5><ul>${i.highlights.map(h=>`<li><strong>${esc(h.title)}</strong><span>${esc(h.detail)}</span></li>`).join('')}</ul></div>`:''}
      ${i.risks?.length?`<div class="ai-block"><h5><i class="bi bi-shield-exclamation" aria-hidden="true"></i> Risks to watch</h5><ul>${i.risks.map(r=>`<li class="ai-risk ${esc(r.level)}"><strong><i class="bi ${RISK_ICON[r.level]||'bi-info-circle'}" aria-hidden="true"></i> ${esc(r.title)}<em>${esc(r.level)}</em></strong><span>${esc(r.detail)}</span></li>`).join('')}</ul></div>`:''}
    </div>
    ${i.actions?.length?`<div class="ai-block"><h5><i class="bi bi-check2-square" aria-hidden="true"></i> Recommended actions</h5><ol class="ai-actions">${i.actions.map(a=>`<li><span class="ai-priority ${esc(a.priority)}">${esc(PRIORITY_LABEL[a.priority]||a.priority)}</span><div><strong>${esc(a.action)}</strong><span>${esc(a.reason)}</span></div></li>`).join('')}</ol></div>`:''}
    ${i.caveats?.length?`<details class="ai-caveats"><summary>Limits of this analysis</summary><ul>${i.caveats.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></details>`:''}
    <div class="ai-answer-slot"></div>
    <form class="ai-ask"><input type="text" maxlength="300" placeholder="Ask about this forecast…" aria-label="Ask a question about this forecast"><button type="submit" class="btn btn-sm">Ask</button></form>
    <div class="ai-suggestions">${suggestions.map(s=>`<button type="button" class="ai-suggestion">${esc(s)}</button>`).join('')}</div>
    <p class="ai-foot">Generated by AI (${esc(model||'Claude')}) · ${esc(new Date(generated_at).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}))} · Uses aggregated forecast numbers only, no patient details. Check important decisions against the figures above.</p>`;
}
function answerHtml(question,answer){
  return `<div class="ai-answer"><span class="ai-q"><i class="bi bi-person" aria-hidden="true"></i> ${esc(question)}</span><p><i class="bi bi-stars" aria-hidden="true"></i> ${esc(answer||'No answer was returned.')}</p></div>`;
}

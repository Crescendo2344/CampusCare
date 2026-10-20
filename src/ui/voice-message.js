import {appIcon} from './app-icons.js';
// Voice UI owns its media resources; removing a conversation releases microphone and audio playback.
export function voiceTime(seconds){const n=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
function waveform(){return `<span class="voice-wave" aria-hidden="true">${Array.from({length:36},()=>'<i></i>').join('')}</span>`;}
function paint(bars,levels){bars.forEach((bar,i)=>bar.style.height=`${Math.max(2,Math.min(28,(levels[i]||0)*28))}px`);}
export function createVoicePlayer(source,{duration=0}={}){
  const root=document.createElement('div');root.className='voice-player';
  root.innerHTML=`<button type="button" class="voice-play" aria-label="Play voice message">${appIcon('play',18)}</button><div class="voice-track">${waveform()}<input type="range" min="0" max="100" value="0" step="0.1" aria-label="Seek voice message"></div><span class="voice-time">${voiceTime(duration)}</span><audio preload="metadata"></audio>`;
  const audio=root.querySelector('audio'),button=root.querySelector('button'),range=root.querySelector('input'),time=root.querySelector('.voice-time'),bars=[...root.querySelectorAll('i')];
  audio.src=source;let total=duration,decoded=false;
  const update=()=>{if(Number.isFinite(audio.duration))total=audio.duration;const progress=total?audio.currentTime/total:0;range.value=String(progress*100);root.style.setProperty('--voice-progress',`${progress*100}%`);time.textContent=voiceTime(audio.currentTime||total);range.disabled=!total;range.setAttribute('aria-valuetext',`${voiceTime(audio.currentTime)} of ${voiceTime(total)}`);};
  const state=()=>{button.innerHTML=appIcon(audio.paused?'play':'pause',18);button.setAttribute('aria-label',audio.paused?'Play voice message':'Pause voice message');};
  // Decode on demand rather than downloading every voice attachment during message polling.
  const decode=async()=>{
    if(decoded)return;decoded=true;let context;
    try{const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;context=new Context();const response=await fetch(audio.src);if(!response.ok)throw new Error('Audio unavailable');const buffer=await context.decodeAudioData(await response.arrayBuffer());total=buffer.duration;const samples=buffer.getChannelData(0),stride=Math.max(1,Math.floor(samples.length/36));const levels=bars.map((_,i)=>{let peak=0;for(let j=i*stride;j<Math.min((i+1)*stride,samples.length);j+=8)peak=Math.max(peak,Math.abs(samples[j]));return peak;});const max=Math.max(.01,...levels);paint(bars,levels.map(n=>n/max));update();}catch{decoded=false;}finally{context?.close().catch(()=>{});}
  };
  // Prepare real peaks/duration only for visible notes, including idle incoming voice bubbles.
  const visibility=window.IntersectionObserver?new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){decode();visibility.disconnect();}}):null;
  visibility?.observe(root);
  button.addEventListener('click',async()=>{if(!audio.paused){audio.pause();return;}document.querySelectorAll('.voice-player audio').forEach(other=>{if(other!==audio)other.pause();});if(audio.error&&audio.dataset.latestSrc){audio.src=audio.dataset.latestSrc;decoded=false;}decode();try{await audio.play();}catch{time.textContent='Try again';button.setAttribute('aria-label','Retry voice message');}});
  range.addEventListener('input',()=>{if(total){audio.currentTime=Number(range.value)/100*total;update();}});
  for(const event of ['loadedmetadata','durationchange','timeupdate','ended'])audio.addEventListener(event,update);
  for(const event of ['play','pause','ended'])audio.addEventListener(event,state);
  const observer=new MutationObserver(()=>{if(!root.isConnected){audio.pause();visibility?.disconnect();observer.disconnect();}});
  observer.observe(document.body,{childList:true,subtree:true});update();return root;
}
export function startVoiceMeter(host,stream,{onStop,onDiscard}){
  host.innerHTML=`<div class="voice-recording"><button type="button" class="voice-discard" aria-label="Discard voice recording">${appIcon('trash',18)}</button><span class="voice-recording-dot" aria-hidden="true"></span><strong class="voice-recording-label">Recording</strong>${waveform()}<span class="voice-time" role="timer">0:00</span><button type="button" class="voice-stop" aria-label="Stop voice recording">${appIcon('stop',18)}</button><span class="voice-meter-note">Speak into your microphone, then stop to preview.</span></div>`;
  const root=host.firstElementChild,bars=[...root.querySelectorAll('i')],time=root.querySelector('[role="timer"]'),started=performance.now();let context,analyser,source,frame,stopped=false;
  // Read actual microphone levels; do not use a decorative animation as a signal of recorded sound.
  try{const Context=window.AudioContext||window.webkitAudioContext;if(Context){context=new Context();analyser=context.createAnalyser();analyser.fftSize=256;source=context.createMediaStreamSource(stream);source.connect(analyser);context.resume().catch(()=>{});}}catch{}
  const data=analyser?new Uint8Array(analyser.frequencyBinCount):null;
  const tick=()=>{if(stopped)return;time.textContent=voiceTime((performance.now()-started)/1000);if(analyser){analyser.getByteFrequencyData(data);paint(bars,bars.map((_,i)=>data[Math.floor(i*data.length/bars.length)]/255));}frame=requestAnimationFrame(tick);};tick();
  root.querySelector('.voice-stop').addEventListener('click',onStop);root.querySelector('.voice-discard').addEventListener('click',onDiscard);
  const observer=new MutationObserver(()=>{if(!root.isConnected){onDiscard();dispose();}});observer.observe(document.body,{childList:true,subtree:true});
  function dispose(){if(stopped)return;stopped=true;cancelAnimationFrame(frame);observer.disconnect();source?.disconnect();context?.close().catch(()=>{});}
  return {dispose,seconds:()=>Math.max(0,(performance.now()-started)/1000)};
}

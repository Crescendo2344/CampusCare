// The patient's profile meter: a ring with the percentage, the level reached and what is left.
// Details the patient can fill in link to My Account; the rest are recorded by the clinic at a visit.
import {profileCompleteness} from '../domain/profile-completeness.js';
import {escapeHtml} from './issueReports.js';
import {bindAction} from '../dependencies.js';
import {navTo} from './navigationRaceProtection.js';

const ring=(percent,tone)=>`<div class="ps-ring ps-${tone}" style="--ps:${percent}" role="img" aria-label="Profile ${percent}% complete"><span>${percent}%</span></div>`;
const stepHtml=s=>`<li class="ps-step ${s.done?'done':''}"><i class="bi ${s.done?'bi-check-circle-fill':'bi-circle'}" aria-hidden="true"></i><span>${escapeHtml(s.label)}</span>${s.done?'':`<small>${s.by==='patient'?escapeHtml(s.section):'At your next clinic visit'}</small>`}</li>`;

// compact: the dashboard version, showing only the next few things to do.
export function profileStrengthCardHtml(user,pt,{compact=false}={}){
  if(!user||user.role!=='Patient'||!pt)return '';
  const {percent,level,steps,missing}=profileCompleteness(user,pt);
  const complete=!missing.length;
  const canFix=missing.some(s=>s.by==='patient');
  const list=compact?missing.slice(0,3):steps;
  return `<div class="card ps-card" id="profile-strength">
    <div class="ps-head">${ring(percent,level.tone)}
      <div class="ps-title"><h3>${complete?'<i class="bi bi-patch-check-fill" aria-hidden="true"></i> ':''}${escapeHtml(level.label)}</h3>
        <p>${complete?'Your profile has everything the clinic needs.':`${missing.length} of ${steps.length} details left to complete your profile.`}</p></div>
      ${compact&&canFix?`<button type="button" class="btn btn-primary btn-sm" ${bindAction('click',()=>navTo('my-account'))}>Complete profile</button>`:''}
    </div>
    ${complete&&compact?'':`<ul class="ps-steps">${list.map(stepHtml).join('')}</ul>`}
  </div>`;
}

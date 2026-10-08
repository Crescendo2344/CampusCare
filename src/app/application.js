// The application lifecycle owns initialization; feature modules expose ordinary ES APIs.
import {features,initializeFeatures} from './features.js';
import {registerCallbacks} from './callbacks.js';
import {registerNamedAction} from '../ui/events.js';
import {state} from './state.js';
let initialized=false;
export function mountApplication(){
  if(initialized)return {features,state};
  initialized=true;
  registerCallbacks(features);
  registerNamedAction('back-to-top',()=>window.scrollTo({top:0,behavior:'smooth'}));
  initializeFeatures();
  return {features,state};
}
export const application={features,state};

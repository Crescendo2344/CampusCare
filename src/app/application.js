// The application lifecycle owns initialization; feature modules expose ordinary ES APIs.
import {features,initializeFeatures} from './features.js';
import {registerCallbacks} from './callbacks.js';
import {registerNamedAction} from '../ui/events.js';
import {enhanceMarkup} from '../ui/accessible-markup.js';
import {enableMotion} from '../ui/motion.js';
import {trackNetworkProgress} from '../ui/network-progress.js';
import {state} from './state.js';
let initialized=false;
export function mountApplication(){
  if(initialized)return {features,state};
  initialized=true;
  trackNetworkProgress();
  registerCallbacks(features);
  registerNamedAction('back-to-top',()=>window.scrollTo({top:0,behavior:'smooth'}));
  initializeFeatures();
  enhanceMarkup();
  enableMotion();
  return {features,state};
}
export const application={features,state};

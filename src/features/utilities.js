// utilities: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
// ================================================================
// UTILITIES
// ================================================================

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.utilities.CTU_MAIN_LOGO_DATA="/assets/embedded-f4d56c30b0477a83.jpg";
}

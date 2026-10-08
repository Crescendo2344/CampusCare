// Shells are imported templates; feature pages render after the shared shell is mounted.
import landing from './components/landing-and-auth.html?raw';
import appShell from './components/app-shell.html?raw';
import notificationPanel from './components/notification-panel.html?raw';
import modalHost from './components/modal-host.html?raw';
import sessionSkeleton from './components/session-skeleton.html?raw';
import {installActionEvents} from './ui/events.js';
import {mountApplication,application} from './app/application.js';
const templates={landingAndAuth:landing,appShell,notificationPanel,modalHost,sessionSkeleton};
for(const [name,html] of Object.entries(templates)){
  const host=document.querySelector(`[data-component="${name}"]`);
  if(host)host.outerHTML=html;
}
installActionEvents();
mountApplication();
// Consumers can observe readiness through one explicit lifecycle event.
document.dispatchEvent(new CustomEvent('campuscare:ready',{detail:application}));
// Export an explicit application API for diagnostics and isolated integration fixtures.
export {application};

// Verify the shared modal rule preserves meaningful actions and routes dismissal through cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {openModal,closeAllModals} from '../src/features/modals.js';
import {showConfirmDialog} from '../src/features/theme.js';
import {bindAction,installActionEvents} from '../src/ui/events.js';
test('modal X replaces redundant footer controls and preserves cleanup on X, backdrop and Escape',()=>{
  const dom=new JSDOM('<div id="modals"></div>');
  const previous={document:globalThis.document,window:globalThis.window,MutationObserver:globalThis.MutationObserver};
  Object.assign(globalThis,{document:dom.window.document,window:dom.window,MutationObserver:dom.window.MutationObserver});
  const cleanup=installActionEvents();let dismissals=0;
  const launch=()=>openModal(`<div class="modal"><div class="modal-header"><h3>Camera</h3><button class="close-btn" ${bindAction('click',()=>{dismissals++;closeAllModals();})}>×</button></div><div class="modal-footer"><button>Cancel</button><button>Close</button><button>Cancel Appointment</button><button>Save</button></div></div>`);
  try{
    launch();assert.deepEqual([...document.querySelectorAll('.modal-footer button')].map(b=>b.textContent),['Cancel Appointment','Save']);
    assert.equal(document.querySelector('.close-btn').getAttribute('aria-label'),'Close Camera');
    document.querySelector('.close-btn').click();assert.equal(dismissals,1);
    launch();document.getElementById('active-modal').click();assert.equal(dismissals,2);
    launch();document.getElementById('active-modal').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(dismissals,3);
    openModal('<div class="modal"><div class="modal-footer"><button>Cancel</button></div></div>');
    assert.equal(document.querySelector('.modal-footer button').textContent,'Cancel','Keep a sole dismissal action');
    let declined=0;showConfirmDialog({title:'Confirm test',message:'Test',onCancel:()=>declined++});
    assert.equal(document.getElementById('cc-confirm-cancel-btn'),null);
    document.querySelector('.close-btn').click();assert.equal(declined,1,'Closing a confirmation retains its cancellation callback');
  }finally{closeAllModals();cleanup();Object.assign(globalThis,previous);dom.window.close();}
});

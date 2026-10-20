// Verify the shared modal rule preserves meaningful actions and routes dismissal through cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {openModal,closeAllModals,showFilePreview,closeTopModal} from '../src/features/modals.js';
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

// Real preview controls must restore the original dialog node, inputs, focus and scroll offset.
test('closing file previews restores the same review and clearing dialogs cannot revive it',()=>{
  const dom=new JSDOM('<div id="modals"></div>',{pretendToBeVisual:true});
  const previous={document:globalThis.document,window:globalThis.window,MutationObserver:globalThis.MutationObserver};
  Object.assign(globalThis,{document:dom.window.document,window:dom.window,MutationObserver:dom.window.MutationObserver});
  const cleanup=installActionEvents();
  try{
    openModal('<div class="modal"><h3>Registration Review</h3><input id="review-draft"><button id="open-evidence">Open evidence</button></div>');
    const review=document.getElementById('active-modal'),input=document.getElementById('review-draft'),opener=document.getElementById('open-evidence');
    input.value='Keep this review';review.scrollTop=120;
    for(const method of ['close','escape','backdrop']){
      opener.focus();showFilePreview('id-front.jpg','data:image/jpeg;base64,AA==');
      assert.equal(review.isConnected,true);assert.equal(review.style.display,'none');assert.equal(review.inert,true);
      assert.equal(document.querySelectorAll('#active-modal').length,1);
      const preview=document.getElementById('active-modal');
      if(method==='close')preview.querySelector('.close-btn').click();
      if(method==='escape')preview.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      if(method==='backdrop')preview.click();
      assert.equal(document.getElementById('active-modal'),review);assert.equal(input.value,'Keep this review');
      assert.equal(review.scrollTop,120);assert.equal(document.activeElement,opener);assert.equal(review.inert,false);
    }
    showFilePreview('selfie.jpg','data:image/jpeg;base64,AA==');closeAllModals();closeTopModal();
    assert.equal(document.getElementById('modals').children.length,0);
    openModal('<div class="modal">New dialog</div>');closeTopModal();assert.equal(document.getElementById('modals').children.length,0);
  }finally{closeAllModals();cleanup();Object.assign(globalThis,previous);dom.window.close();}
});

// Reproduce the provider's async/ready incompatibility using the real browser loader module.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('an async script renders after its load event without calling the incompatible ready API',async()=>{
  const dom=new JSDOM('<div id="registration-captcha-section" hidden><div id="registration-captcha-frame"><div id="registration-captcha-widget"></div></div><p id="registration-captcha-status"></p><button id="registration-security-retry" hidden>Try again</button></div>');
  const previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  globalThis.fetch=async()=>Response.json({captcha_required:true,site_key:'0x4-fixture-key'});
  let scripts=0,renders=0,readyCalls=0,removes=0,callbacks,onResize;
  dom.window.ResizeObserver=class {constructor(callback){onResize=callback;}observe(){}};
  const append=dom.window.document.head.appendChild.bind(dom.window.document.head);
  dom.window.document.head.appendChild=script=>{
    scripts++;assert.equal(script.async,true);append(script);
    // Publish the provider API at script.onload, matching dynamic script loading.
    queueMicrotask(()=>{
      dom.window.turnstile={ready(){readyCalls++;throw new Error('Remove async/defer before using turnstile.ready()');},render(selector,options){renders++;callbacks=options;options.callback('fixture-token');return 'fixture-widget';},reset(){},remove(){removes++;}};
      script.onload();
    });
    return script;
  };
  try{
    const module=await import('../src/verification/registration-captcha.js');
    await module.prepareRegistrationCaptcha('https://fixture.test','fixture-key');
    assert.equal(callbacks.size,'normal','Narrow cards keep a horizontal provider layout');
    Object.defineProperty(dom.window.document.getElementById('registration-captcha-frame'),'clientWidth',{value:240,configurable:true});onResize();
    assert.equal(dom.window.document.getElementById('registration-captcha-widget').style.transform,'scale(0.8)');
    assert.equal(dom.window.document.getElementById('registration-captcha-frame').style.height,'52px');
    assert.equal(scripts,1);assert.equal(renders,1);assert.equal(readyCalls,0);
    assert.equal(dom.window.document.getElementById('registration-captcha-section').hidden,false);
    assert.equal(await module.registrationCaptchaToken('https://fixture.test','fixture-key'),'fixture-token');
    assert.equal(renders,1,'Refreshing configuration must reuse the existing widget');
    assert.equal(dom.window.document.getElementById('registration-security-retry').hidden,true);
    callbacks['error-callback']();
    assert.equal(dom.window.document.getElementById('registration-security-retry').hidden,false);
    assert.equal(dom.window.document.getElementById('registration-captcha-section').dataset.state,'error');
    module.resetRegistrationCaptcha();
    assert.equal(dom.window.document.getElementById('registration-security-retry').hidden,true);
    callbacks.callback('fixture-token-2');
    assert.equal(dom.window.document.getElementById('registration-captcha-section').dataset.state,'complete');
    callbacks['timeout-callback']();
    assert.equal(dom.window.document.getElementById('registration-security-retry').hidden,false);
    callbacks['expired-callback']();
    await assert.rejects(module.registrationCaptchaToken('https://fixture.test','fixture-key'),/Complete the security check/);
    assert.equal(dom.window.document.getElementById('registration-security-retry').hidden,false,'Refreshing config must preserve an actionable expiry');
    Object.defineProperty(dom.window.document.getElementById('registration-captcha-frame'),'clientWidth',{value:340});
    onResize();
    await module.prepareRegistrationCaptcha('https://fixture.test','fixture-key',{refresh:true});
    assert.equal(callbacks.size,'flexible');
    assert.equal(removes,1,'Crossing the size boundary must replace the old widget');
    assert.equal(renders,2);assert.equal(scripts,1);
  }finally{Object.assign(globalThis,previous);dom.window.close();}
});

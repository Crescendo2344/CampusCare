// Regressions for quiet refreshes: keep media/editor nodes and preserve a reader's scroll position.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {reconcileMessages,messageVersion} from '../src/ui/message-list.js';
import {voiceTime} from '../src/ui/voice-message.js';
test('message updates retain unchanged nodes, active editors and receipt-only changes',()=>{
  const dom=new JSDOM('<div id="messages"></div>'),wrap=dom.window.document.getElementById('messages');
  const create=m=>{const row=dom.window.document.createElement('div');row.innerHTML=`<div>${m.message}</div><span class="msgr-bubble-time"></span>`;return row;};
  const a={id:1,message:'Hello',_timeLabel:'sent'},b={id:2,message:'Reply'};
  reconcileMessages(wrap,[a,b],create);const first=wrap.children[0],second=wrap.children[1];
  reconcileMessages(wrap,[{...a,isRead:true,_timeLabel:'read'},b],create);
  assert.equal(wrap.children[0],first);assert.equal(wrap.children[1],second);assert.equal(first.querySelector('span').textContent,'read');
  first.querySelector('div').innerHTML='<textarea>Unsent edit</textarea>';
  reconcileMessages(wrap,[{...a,message:'Server changed'},b,{id:3,message:'New'}],create);
  assert.equal(wrap.children[0],first);assert.equal(first.querySelector('textarea').value,'Unsent edit');
  reconcileMessages(wrap,[a,b],create,{force:true});assert.equal(wrap.querySelector('textarea'),null);assert.equal(wrap.children.length,2);
  assert.equal(messageVersion({...a,attachment:{dataUrl:'https://example.test/audio?token=1'}}),messageVersion({...a,attachment:{dataUrl:'https://example.test/audio?token=2'}}),'Signed URL rotation must not replace playing audio');
  dom.window.close();
});
test('refreshes leave readers away from the bottom and follow messages at the bottom',()=>{
  const dom=new JSDOM('<div></div>'),wrap=dom.window.document.querySelector('div');
  Object.defineProperties(wrap,{scrollHeight:{value:1000},clientHeight:{value:200}});
  const create=()=>dom.window.document.createElement('div');
  reconcileMessages(wrap,[{id:1}],create);assert.equal(wrap.scrollTop,1000);
  wrap.dispatchEvent(new dom.window.Event('wheel'));wrap.scrollTop=100;wrap.dispatchEvent(new dom.window.Event('scroll'));reconcileMessages(wrap,[{id:1},{id:2}],create);assert.equal(wrap.scrollTop,100);
  wrap.scrollTop=800;reconcileMessages(wrap,[{id:1},{id:2},{id:3}],create);assert.equal(wrap.scrollTop,1000);
  assert.equal(voiceTime(75),'1:15');assert.equal(voiceTime(Infinity),'0:00');dom.window.close();
});

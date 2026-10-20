import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMessageDataUrl} from '../supabase/functions/_shared/message-attachment.js';
// Real mobile MIME shapes must retain exact bytes while stripping metadata before allowlist checks.
test('mobile AAC and Opus recording headers preserve attachment bytes',()=>{
 for(const mime of ['audio/mp4;codecs=mp4a.40.2','audio/webm;codecs=opus','audio/mp4;codecs="mp4a.40.2"','audio/webm','text/plain;charset=utf-8']){
  const result=parseMessageDataUrl('data:'+mime+';base64,AAECAw==');
  assert.equal(result.mime,mime.split(';')[0]);assert.deepEqual([...result.bytes],[0,1,2,3]);
 }
});
test('malformed or oversized attachments cannot be decoded',()=>{
 for(const value of ['data:audio/mp4;codecs=bad;xxx;base64,AA==','data:audio/mp4;base64,!!!','data:audio/mp4;base64,','javascript:alert(1)'])assert.throws(()=>parseMessageDataUrl(value),/Invalid attachment/);
 assert.throws(()=>parseMessageDataUrl('data:audio/mp4;base64,'+'A'.repeat(8*1024*1024)),/5 MB/);
});

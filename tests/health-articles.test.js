import test from 'node:test';
import assert from 'node:assert/strict';
import {articleBlocks,articleBodyHtml,readingMinutes,relatedArticles} from '../src/domain/health-articles.js';

test('plain-text articles become paragraphs, lists and subheadings',()=>{
  const text='Stay hydrated during exams.\nDrink water often.\n\nWhat to do:\n\n- Rest\n- Eat well\n\n1. Call the clinic\n2. Book a visit';
  assert.deepEqual(articleBlocks(text).map(b=>b.type),['p','h','ul','ol']);
  assert.equal(articleBodyHtml('- <b>x</b>',s=>s.replace(/</g,'&lt;')),'<ul><li>&lt;b>x&lt;/b></li></ul>');
});

test('reading time and related articles',()=>{
  assert.equal(readingMinutes(''),1);
  assert.equal(readingMinutes('word '.repeat(1000)),5);
  const a={id:1,category:'Nutrition',published:true,publishedAt:'2026-10-01'};
  const all=[a,{id:2,category:'Sleep',published:true,publishedAt:'2026-10-05'},{id:3,category:'Nutrition',published:true,publishedAt:'2026-09-01'},{id:4,category:'Nutrition',published:false}];
  assert.deepEqual(relatedArticles(a,all).map(x=>x.id),[3,2]);
});

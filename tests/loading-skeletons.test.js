// Loading placeholders announce themselves to screen readers. An aria-label is only allowed on an element
// with a role, so every placeholder is a status region (axe: aria-prohibited-attr).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('every labelled loading placeholder is a status region',()=>{
  const source=fs.readFileSync('src/features/loadingSkeletons.js','utf8');
  const wraps=source.match(/<div class="db-skeleton-wrap"[^>]*>/g)||[];
  assert(wraps.length>=4,'All placeholder variants are checked');
  for(const tag of wraps)if(tag.includes('aria-label='))assert.match(tag,/role="status"/,tag);
});

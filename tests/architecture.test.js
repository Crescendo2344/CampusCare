// Fail if source assembly, application globals, inline HTML code or unbound feature names return.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'acorn';
import {analyze} from 'eslint-scope';
import {state} from '../src/app/state.js';
const browserGlobals=new Set('Date Number String Boolean Math Object Array JSON Error Promise Map Set RegExp Intl URL URLSearchParams Blob File FileReader FormData Image AbortController MediaRecorder Uint8Array document window navigator console fetch crypto localStorage sessionStorage location history setTimeout clearTimeout setInterval clearInterval requestAnimationFrame atob decodeURIComponent parseInt parseFloat undefined queueMicrotask MutationObserver'.split(' '));

test('every feature uses explicit imports for application references',()=>{
 for(const file of fs.readdirSync('src/features')){
  const source=fs.readFileSync('src/features/'+file,'utf8');const ast=parse(source,{ecmaVersion:2022,sourceType:'module',ranges:true});
  const manager=analyze(ast,{ecmaVersion:2022,sourceType:'module'});
  assert.deepEqual([...new Set(manager.globalScope.through.map(ref=>ref.identifier.name))].filter(name=>!browserGlobals.has(name)),[],file);
 }
});
test('entry/config/templates have no assembled runtime or inline event attributes',()=>{
 assert(!fs.readFileSync('vite.config.js','utf8').includes('virtual:campuscare'));
 assert(!fs.readFileSync('src/main.js','utf8').includes('window['));
 for(const file of ['index.html',...fs.readdirSync('src/components').map(name=>'src/components/'+name)])assert(!/\son[a-z]+\s*=/.test(fs.readFileSync(file,'utf8')),file);
 for(const file of fs.readdirSync('src/features'))assert(!/Object\.defineProperty\(window|window\[(?:st\.callbackName|onChange)\]/.test(fs.readFileSync('src/features/'+file,'utf8')),file);
});

// Window-only caches from the old app must also have explicit state containers.
test('all feature state namespaces are allocated',()=>{
 for(const file of fs.readdirSync('src/features'))for(const match of fs.readFileSync('src/features/'+file,'utf8').matchAll(/\bappState\.([A-Za-z_$][\w$]*)\./g))assert(Object.hasOwn(state,match[1]),file+': '+match[1]);
});

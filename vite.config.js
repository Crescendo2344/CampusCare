// Feature files are assembled in their original order during this first migration.
// This keeps shared state and the existing inline handlers working while files are separated.
import { defineConfig } from 'vite';
import { parse } from 'acorn';
import fs from 'node:fs';
import path from 'node:path';

const root=import.meta.dirname;
const virtualId='virtual:campuscare-runtime';
const resolvedId='\0'+virtualId;
const readJson=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));

// Discover declarations at build time so newly added handlers also reach the interface.
function runtimeBindings(source){
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),bindings=[];
  const names=node=>{
    if(!node)return [];
    if(node.type==='Identifier')return [node.name];
    if(node.type==='ObjectPattern')return node.properties.flatMap(p=>names(p.value||p.argument));
    if(node.type==='ArrayPattern')return node.elements.flatMap(names);
    if(node.type==='RestElement')return names(node.argument);
    if(node.type==='AssignmentPattern')return names(node.left);
    return [];
  };
  for(const node of ast.body){
    if(node.type==='FunctionDeclaration')bindings.push({name:node.id.name,kind:'function',mutable:false});
    else if(node.type==='ClassDeclaration')bindings.push({name:node.id.name,kind:'state',mutable:false});
    else if(node.type==='VariableDeclaration')for(const declaration of node.declarations)for(const name of names(declaration.id))bindings.push({name,kind:'state',mutable:node.kind!=='const'});
  }
  return bindings;
}

export default defineConfig(()=>{
  return {
    // The compatibility bootstrap runs before Vite's module script; use the same public configuration.
    plugins:[{
      name:'campuscare-feature-assembly',
      resolveId(id){if(id===virtualId)return resolvedId;},
      load(id){
        if(id!==resolvedId)return;
        const order=readJson('src/module-order.json');
        const modules=order.map(({file})=>{const absolute=path.join(root,file);this.addWatchFile(absolute);return fs.readFileSync(absolute,'utf8');});
        const source=modules.join('\n');
        const bindings=runtimeBindings(source);
        // Accessors keep bootstrap/session.js and inline handlers connected to the same live state.
        const bridge=bindings.map(({name,mutable,kind})=>kind==='function'?`window[${JSON.stringify(name)}]=${name};`:`Object.defineProperty(window,${JSON.stringify(name)},{configurable:true,get:()=>${name}${mutable?`,set:value=>{${name}=value}`:''}});`).join('\n');
        return `// Compatibility bridge for the existing CampusCare interface.\n${bridge}\n${modules.join('\n')}`;
      },
      transformIndexHtml:{order:'pre',handler(html){
        const assembled=html.replace(/<!-- campuscare:component:([a-z-]+) -->/g,(_,name)=>fs.readFileSync(path.join(root,'src/components',name+'.html'),'utf8'));
        return assembled;
      }},
      handleHotUpdate({file,server}){
        // Reload shared state instead of registering duplicate listeners during hot updates.
        if(file.includes('/src/modules/')){server.ws.send({type:'full-reload'});return [];}
      },
      configureServer(server){
        // Templates are read during HTML transformation; refreshing shows edits immediately.
        server.watcher.add(path.join(root,'src/components'));
        server.watcher.on('change',file=>{if(file.includes('/src/components/'))server.ws.send({type:'full-reload'});});
      }
    }],
    build:{outDir:'dist',target:'es2022'},
  };
});

// Rebuild the readable module inventory after moving or adding feature exports.
import fs from 'node:fs';
import {parse} from 'acorn';
const previous=JSON.parse(fs.readFileSync('docs/feature-manifest.json','utf8'));
const owners=new Map(previous.map(feature=>[feature.name,feature.state]));
const manifest=fs.readdirSync('src/features').filter(file=>file.endsWith('.js')).sort().map(file=>{
  const path='src/features/'+file,ast=parse(fs.readFileSync(path,'utf8'),{ecmaVersion:2022,sourceType:'module'});
  const name=file.slice(0,-3);
  return {name,path,functions:ast.body.filter(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.type==='FunctionDeclaration'&&node.declaration.id.name!=='initializeFeature').map(node=>node.declaration.id.name),state:owners.get(name)||[],imports:ast.body.filter(node=>node.type==='ImportDeclaration').map(node=>node.source.value)};
});
fs.writeFileSync('docs/feature-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Mapped ${manifest.length} feature modules`);

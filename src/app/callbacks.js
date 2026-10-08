// Callback lookup is explicitly populated by the application lifecycle.
const callbacks=new Map();
export function registerCallbacks(features){
  for(const feature of Object.values(features))for(const [name,callback]of Object.entries(feature))if(name!=='initializeFeature'&&typeof callback==='function')callbacks.set(name,callback);
}
export function resolveCallback(name){return callbacks.get(name);}

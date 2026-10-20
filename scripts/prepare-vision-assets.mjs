// Serve the pinned vision runtime from CampusCare; camera frames never go to a CDN.
import {cp,mkdir} from 'node:fs/promises';
const destination=new URL('../public/vision/1.1.1/',import.meta.url);
await mkdir(destination,{recursive:true});
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/',import.meta.url),destination,{recursive:true});

import {build} from 'esbuild';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
await mkdir(new URL('../vendor/',import.meta.url),{recursive:true});
await build({stdin:{contents:"export {Scene,Color,PerspectiveCamera,WebGLRenderer,SRGBColorSpace,ACESFilmicToneMapping,PCFSoftShadowMap,Vector3,Vector2,Raycaster,Group,HemisphereLight,DirectionalLight,PointLight,Mesh,MeshStandardMaterial,MeshBasicMaterial,CanvasTexture,PlaneGeometry,BoxGeometry,CylinderGeometry,SphereGeometry,TorusGeometry,Shape,ShapeGeometry,ExtrudeGeometry} from 'three'; export {gsap} from 'gsap';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,format:'esm',minify:true,target:'es2022',outfile:new URL('../vendor/study-engine.js',import.meta.url).pathname,legalComments:'eof'});
await copyFile(new URL('../node_modules/three/LICENSE',import.meta.url),new URL('../vendor/THREE-LICENSE.txt',import.meta.url));
await writeFile(new URL('../vendor/GSAP-NOTICE.txt',import.meta.url),'GSAP 3.15.1. Copyright GreenSock. License: https://gsap.com/standard-license/\nFull copyright notices are retained in study-engine.js.\n');

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { loadAnimal } from './quaternius-cow.js?v=coat-1';

const card=new URLSearchParams(location.search).has('card');
if(card)document.body.classList.add('animal-card-mode');
const viewport=document.querySelector('#viewport');
const scene=new THREE.Scene();scene.background=new THREE.Color('#e9e2d7');
scene.fog=new THREE.Fog('#e9e2d7',24,55);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.13;
renderer.outputColorSpace=THREE.SRGBColorSpace;viewport.append(renderer.domElement);
renderer.domElement.setAttribute('aria-label','Животное: перетащи для поворота, используй колесо для масштаба');
const camera=new THREE.OrthographicCamera(-5,5,3,-3,.1,100);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.075;
controls.minPolarAngle=.32;controls.maxPolarAngle=Math.PI/2-.09;
controls.minZoom=.7;controls.maxZoom=2.6;controls.enablePan=false;
function resetCamera(){camera.position.set(8,5.8,-10);controls.target.set(.22,1.22,0);camera.zoom=1;camera.updateProjectionMatrix();controls.update();}
function resize(){const w=innerWidth,h=innerHeight;const span=Math.max(4.5,5/(w/h));camera.left=-span*w/h/2;camera.right=span*w/h/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();renderer.setSize(w,h);}
resetCamera();
if(card){controls.enableZoom=false;controls.minPolarAngle=controls.maxPolarAngle=controls.getPolarAngle();renderer.domElement.setAttribute('aria-label','Модель животного. Перетащите для поворота вокруг вертикальной оси.');}
resize();window.addEventListener('resize',resize);
document.querySelector('#reset').addEventListener('click',resetCamera);
const views={three:[8,5.8,-10],side:[0,1.22,-12],front:[12,1.22,0]};
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
 camera.position.set(...views[b.dataset.view]);controls.target.set(.22,1.22,0);controls.update();
 document.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));
}));
scene.add(new THREE.HemisphereLight('#f7f8eb','#88896a',2));
const sun=new THREE.DirectionalLight('#fff2df',2.2);sun.position.set(5,9,-6);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-8;sun.shadow.camera.right=8;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;
sun.shadow.normalBias=.035;sun.shadow.bias=-.00008;sun.shadow.radius=4;sun.shadow.blurSamples=8;scene.add(sun);
const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial({color:'#e9e2d7',roughness:1}));
backdrop.rotation.x=-Math.PI/2;backdrop.position.y=.015;backdrop.receiveShadow=true;scene.add(backdrop);
let cow;
const animals={};
try {
 const models=await Promise.all(['cow','bull'].map(kind=>loadAnimal(kind,new URLSearchParams(location.search).get('id'))));
 ['cow','bull'].forEach((name,i)=>{animals[name]=models[i];scene.add(models[i].root);models[i].root.visible=name==='cow';});
 cow=animals.cow;
}
catch(error) {
 document.querySelector('#loading').hidden=true;
 document.querySelector('#error').hidden=false;
 document.querySelector('#error').textContent='Не удалось загрузить модель Quaternius. Обнови страницу, чтобы повторить.';
 throw error;
}

document.querySelector('#clay').addEventListener('click',e=>{
 const value=!cow.clay;Object.values(animals).forEach(animal=>animal.setClay(value));
 e.currentTarget.setAttribute('aria-pressed',String(value));
});
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
let mode='idle',paused=reduced.matches,autoTime=0,moveSpeed=0;
let lastTime=performance.now(),waypoint=0;
const points=[new THREE.Vector2(1.25,-.75),new THREE.Vector2(-1.1,-.8),new THREE.Vector2(-1.2,.85),new THREE.Vector2(1.2,.8)];
const activities={idle:'Стоит',walk:'Идёт',slow:'Медленная ходьба',graze:'Пасётся'};
const autoSequence=[['idle',4],['walk',12],['graze',12],['slow',10]];
function currentAction(){
 if(mode!=='auto')return mode;
 let t=autoTime%38;
 for(const [name,duration] of autoSequence){if(t<duration)return name;t-=duration;}
 return 'idle';
}
let displayedActivity='';
function updateLabel(action){const text=paused?'Пауза':activities[action];if(text!==displayedActivity){document.querySelector('#activity').textContent=text;displayedActivity=text;}}
function setMode(next){mode=next;autoTime=0;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));updateLabel(currentAction());}
const pauseButton=document.querySelector('#pause');
function updatePauseButton(){pauseButton.setAttribute('aria-pressed',String(paused));pauseButton.setAttribute('aria-label',paused?'Продолжить движения':'Приостановить движения');pauseButton.title=paused?'Продолжить · Пробел':'Пауза · Пробел';pauseButton.innerHTML=paused?'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m8 5 11 7-11 7Z"/></svg>':'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 5v14M16 5v14"/></svg>';updateLabel(currentAction());}
function togglePause(){paused=!paused;updatePauseButton();}
pauseButton.addEventListener('click',togglePause);updatePauseButton();
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
function selectAnimal(name){
 cow=animals[name];cow.reset();moveSpeed=0;waypoint=0;
 Object.entries(animals).forEach(([key,animal])=>{animal.root.visible=key===name;});
 document.querySelectorAll('[data-animal]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.animal===name)));
 setMode('idle');
}
document.querySelectorAll('[data-animal]').forEach(button=>button.addEventListener('click',()=>selectAnimal(button.dataset.animal)));
window.addEventListener('keydown',e=>{
 if(card||e.target instanceof HTMLButtonElement)return;
 if(e.code==='Space'){e.preventDefault();togglePause();}
 const modes={Digit1:'auto',Digit2:'idle',Digit3:'walk',Digit4:'slow',Digit5:'graze'};if(modes[e.code])setMode(modes[e.code]);
});
reduced.addEventListener('change',e=>{if(e.matches){paused=true;updatePauseButton();}});
document.addEventListener('visibilitychange',()=>{lastTime=performance.now();});
function frame(now){
 const dt=Math.min((now-lastTime)/1000,.05);lastTime=now;
 if(document.hidden)return;
 const action=currentAction();
 if(!paused){
  autoTime+=dt;
  const targetSpeed=action==='walk'?.48:action==='slow'?.24:0;
  moveSpeed=THREE.MathUtils.damp(moveSpeed,targetSpeed,3,dt);
  let speed=0;
  if(moveSpeed>.002){
   const target=points[waypoint];
   const dx=target.x-cow.root.position.x,dz=target.y-cow.root.position.z;
   if(Math.hypot(dx,dz)<.22)waypoint=(waypoint+1)%points.length;
   const desired=Math.atan2(-dz,dx);
   const delta=Math.atan2(Math.sin(desired-cow.root.rotation.y),Math.cos(desired-cow.root.rotation.y));
   cow.root.rotation.y+=THREE.MathUtils.clamp(delta,-.7*dt,.7*dt);
   speed=moveSpeed*Math.max(.3,1-Math.abs(delta)/Math.PI);
   cow.root.position.x+=Math.cos(cow.root.rotation.y)*speed*dt;
   cow.root.position.z-=Math.sin(cow.root.rotation.y)*speed*dt;
  }
  cow.update(dt,action,speed);
 }
 controls.update();updateLabel(action);renderer.render(scene,camera);
}
const params=new URLSearchParams(location.search);
if(params.get('animal')==='bull')selectAnimal('bull');
if(params.get('shape')==='clay'){Object.values(animals).forEach(animal=>animal.setClay(true));document.querySelector('#clay').setAttribute('aria-pressed','true');}
if(views[params.get('view')]){
 camera.position.set(...views[params.get('view')]);controls.update();
 document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===params.get('view'))));
}
setMode('idle');cow.update(0,'idle');renderer.setAnimationLoop(frame);
document.querySelector('#loading').hidden=true;
// Context loss should produce a visible recoverable error, not a blank page.
renderer.domElement.addEventListener('webglcontextlost',()=>{document.querySelector('#error').hidden=false;});
renderer.domElement.addEventListener('webglcontextrestored',()=>{document.querySelector('#error').hidden=true;});

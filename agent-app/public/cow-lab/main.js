import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {createWorld} from './farm/world.js?v=21';
import {createGrass} from './farm/grass.js?v=20';
import {createHerd,HERD_SIZE} from './farm/herd.js?v=19';
import {createBridge,createPicking} from './farm/bridge.js?v=5';

const query=new URLSearchParams(location.search);
const bridge=query.has('embed')&&parent!==window?createBridge(query):null;
const loading=document.querySelector('#loading'),error=document.querySelector('#error');
try{
 const scene=new T.Scene();scene.background=new T.Color('#ffffff');
 const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
 const pixelRatio=()=>Math.min(devicePixelRatio,1.6,Math.sqrt(4500000/(innerWidth*innerHeight)));
 renderer.setPixelRatio(pixelRatio());renderer.setSize(innerWidth,innerHeight);
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;renderer.outputColorSpace=T.SRGBColorSpace;
 document.querySelector('#viewport').append(renderer.domElement);
 renderer.domElement.setAttribute('aria-label','Ферма с коровами и бычками. Перетаскивайте для поворота, используйте колесо для приближения.');
 const camera=new T.PerspectiveCamera(40,innerWidth/innerHeight,1,1500);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;
 controls.minPolarAngle=.15;controls.maxPolarAngle=Math.PI/2-.12;controls.minDistance=12;controls.maxDistance=bridge?1100:380;
 controls.screenSpacePanning=false;controls.panSpeed=.75;controls.rotateSpeed=.6;controls.zoomSpeed=.8;
 function resize(){
  if(innerWidth<1||innerHeight<1)return;
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  const ratio=pixelRatio();if(Math.abs(ratio-renderer.getPixelRatio())>.01)renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth,innerHeight);if(document.body.dataset.ready==='true')requestFrame();
 }
 function overview(){camera.position.set(192,164,252);if(bridge)camera.position.multiplyScalar(Math.max(1,1.5/camera.aspect));controls.target.set(0,-23,0);camera.position.sub(controls.target).multiplyScalar(.5).add(controls.target);camera.zoom=1;camera.updateProjectionMatrix();controls.update();}
 overview();resize();window.addEventListener('resize',resize);
 scene.add(new T.HemisphereLight('#ffffff','#aba396',1.8));
 const sun=new T.DirectionalLight('#fff6e6',2.6);sun.position.set(-100,170,85);sun.target.position.set(0,0,0);
 sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-163,right:163,top:150,bottom:-150,near:1,far:425});
 sun.shadow.normalBias=.045;sun.shadow.bias=-.00012;sun.shadow.radius=3;scene.add(sun,sun.target);
 const fill=new T.DirectionalLight('#d9e5f2',.75);fill.position.set(80,40,-70);scene.add(fill);
 const beforeWorld=new Set(scene.children);
 const world=await createWorld(scene);
 const grass=createGrass(scene,world);
 const scenery=scene.children.filter(item=>!beforeWorld.has(item));
 const terrainHeight=world.heightAt;
 let infographic=false;
 grass.updateView(camera,renderer.domElement.height);
 const first=bridge?await bridge.first:null;
 let herd=await createHerd(scene,world,first?.animals);
 if(first)herd.setData(first.animals,first.group);
 function fitInfographic(){
  const bounds=herd.infographicBounds();
  const direction=new T.Vector3(0,.82,.57).normalize();
  const up=new T.Vector3(0,direction.z,-direction.y);
  const tanY=Math.tan(camera.fov*Math.PI/360),tanX=tanY*camera.aspect;
  let distance=12;
  // Fit all corners, including animal height and label space, with a small margin.
  for(const x of [-bounds.width/2,bounds.width/2])for(const z of [-bounds.depth/2,bounds.depth/2])for(const y of [0,4]){
   const point=new T.Vector3(x,y-2,z);
   distance=Math.max(distance,point.dot(direction)+Math.max(Math.abs(x)/(tanX*.9),Math.abs(point.dot(up))/(tanY*.82)));
  }
  controls.maxDistance=Math.max(1100,distance*4);camera.far=Math.max(1500,distance*6);camera.zoom=1;camera.updateProjectionMatrix();
  controls.target.set(0,2,0);camera.position.copy(controls.target).addScaledVector(direction,distance);controls.update();
 }
 function setEnvironmentHidden(hidden){
  if(infographic===hidden)return;
  infographic=hidden;scenery.forEach(item=>{item.visible=!infographic;});world.heightAt=infographic?()=>0:terrainHeight;
  herd.setInfographic(infographic);followedAnimal=null;
  bridge?.send('mode',{infographic});
  if(infographic)fitInfographic();else overview();requestFrame();saveView();
 }
 bridge?.onEnvironment(setEnvironmentHidden);
 const picking=bridge?createPicking({renderer,camera,controls,world,getHerd:()=>herd,bridge,invalidate:()=>requestFrame()}):null;
 await renderer.compileAsync(scene,camera);
 renderer.render(scene,camera);
 if(query.has('debug'))window.farmDebug={scene,renderer,world,grass,herd,camera,controls,sun};
 if(query.has('debug')&&query.has('focus')){
  const c=herd.animals[Number(query.get('focus'))];
  if(c){const y=world.heightAt(c.x,c.z);controls.target.set(c.x,y+.55,c.z);camera.position.set(c.x+4.5,y+2.8,c.z+5.5);controls.update();}
 }
 let paused=matchMedia('(prefers-reduced-motion: reduce)').matches,last=performance.now(),frames=0,elapsed=0,followedAnimal=null;
 let running=false,contextLost=false,renderedFrames=0;
 let savedViewId=null,restoringView=false,lastSaved='';
 function saveView(){
  if(!savedViewId||restoringView)return;
  const value=JSON.stringify({infographic,position:camera.position.toArray(),target:controls.target.toArray(),zoom:camera.zoom,paused});
  if(value===lastSaved)return;
  try{localStorage.setItem('arka-scene:'+savedViewId,value);lastSaved=value;}catch{}
 }
 function restoreView(viewId){
  if(savedViewId===viewId)return;
  saveView();savedViewId=viewId;lastSaved='';restoringView=true;
  try{
   const saved=JSON.parse(localStorage.getItem('arka-scene:'+viewId)||'null');
   const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<1e6);
   if(saved&&vector(saved.position)&&vector(saved.target)&&Number.isFinite(saved.zoom)&&saved.zoom>0){
    setEnvironmentHidden(saved.infographic===true);
    camera.position.fromArray(saved.position);controls.target.fromArray(saved.target);camera.zoom=saved.zoom;
    if(typeof saved.paused==='boolean')paused=saved.paused;
    camera.updateProjectionMatrix();controls.update();
   }else{setEnvironmentHidden(false);overview();}
  }catch{setEnvironmentHidden(false);overview();}
  finally{restoringView=false;bridge?.send('mode',{infographic});saveView();}
 }

 const followOffset=new T.Vector3();
 function stopRendering(){running=false;renderer.setAnimationLoop(null);}
 function requestFrame(){
  if(running||document.hidden||contextLost||bridge&&!bridge.active)return;
  running=true;last=performance.now();frames=0;elapsed=0;renderer.setAnimationLoop(renderFrame);
 }
 window.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();paused=!paused;requestFrame();}if(e.code==='KeyR'){if(infographic)fitInfographic();else overview();}});
 controls.addEventListener('change',()=>{requestFrame();saveView();});
 window.addEventListener('pagehide',saveView);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopRendering();else requestFrame();});
 window.addEventListener('pagehide',stopRendering);window.addEventListener('pageshow',requestFrame);
 renderer.domElement.addEventListener('webglcontextlost',e=>{
  e.preventDefault();contextLost=true;stopRendering();error.hidden=false;error.textContent='Восстанавливаем 3D-сцену…';
 });
 renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;error.hidden=true;requestFrame();});
 const prefersReduced=matchMedia('(prefers-reduced-motion: reduce)');prefersReduced.addEventListener('change',e=>{if(e.matches){paused=true;requestFrame();}});
 function renderFrame(now){
  const wallDt=Math.max(0,(now-last)/1000),dt=Math.min(wallDt,.05);last=now;if(document.hidden)return;
  if(!paused||infographic){herd.update(dt);if(!infographic)grass.update(dt);}
  if(followedAnimal){followOffset.set(followedAnimal.x,world.heightAt(followedAnimal.x,followedAnimal.z)+.8,followedAnimal.z).sub(controls.target);camera.position.add(followOffset);controls.target.add(followOffset);}
  const changed=controls.update();if(!infographic)grass.updateView(camera,renderer.domElement.height);renderer.render(scene,camera);picking?.update(now);renderedFrames++;
  frames++;elapsed+=wallDt;if(elapsed>1){renderer.domElement.dataset.fps=String(Math.round(frames/elapsed));renderer.domElement.dataset.drawCalls=String(renderer.info.render.calls);frames=0;elapsed=0;}
  if(paused&&!changed&&!infographic)stopRendering();
 }
 if(bridge){
  let applying=Promise.resolve();
  bridge.onData(data=>{
   applying=applying.then(async()=>{
    if(bridge.latest()!==data)return;
    if(!herd.setData(data.animals,data.group)){
     const next=await createHerd(scene,world,data.animals);herd.dispose();herd=next;herd.setData(data.animals,data.group);herd.setInfographic(infographic);
     if(window.farmDebug)window.farmDebug.herd=herd;
    }
    if(bridge.latest()!==data)return;
    document.body.dataset.herdCount=String(herd.animals.length);restoreView(data.viewId);requestFrame();
    bridge.send('applied',{viewId:data.viewId,revision:data.revision,count:herd.animals.length,matched:data.animals.filter(r=>r.matched).length});
   }).catch(e=>{console.error(e);bridge.send('error');});
  });
  bridge.onActive(active=>{if(active)requestFrame();else{saveView();stopRendering();}});
 }
 requestFrame();
 if(query.has('debug'))window.farmDebug.frameStats=()=>({running,paused,contextLost,renderedFrames});
 if(query.has('debug'))window.farmView=(view)=>{
  followedAnimal=null;
  controls.minPolarAngle=view==='plan'?.001:.15;
  if(view==='plan'){controls.target.set(0,0,0);camera.position.set(0,320,.1);}
  else if(view==='yard'){controls.target.set(79,2,48);camera.position.set(150,78,143);}
  else if(view==='surface'){controls.target.set(18,0,49);camera.position.set(18,160,125);}
  else if(view==='ground'){controls.target.set(9,0,59);camera.position.set(17,14,81);}
  else if(view==='water'){controls.target.set(10,0,74);camera.position.set(20,12,88);}
  else if(view==='yard-ground'){controls.target.set(85,0,63);camera.position.set(91,18,82);}
  else if(view==='pen'){controls.target.set(-9,1,49);camera.position.set(72,100,151);}
  else overview();
  controls.update();
 };
 if(query.has('debug'))window.farmFollow=(id)=>{
  followedAnimal=herd.animals[id]||null;if(!followedAnimal)return;
  controls.target.set(followedAnimal.x,world.heightAt(followedAnimal.x,followedAnimal.z)+.8,followedAnimal.z);
  camera.position.copy(controls.target).add(new T.Vector3(6,4,8));controls.update();
 };
 if(query.has('debug'))window.farmAdvance=(seconds)=>{const result=herd.advance(seconds);requestFrame();return result;};
 if(query.has('debug'))window.farmRoute=(from,to)=>herd.route(from,to);
 if(query.has('debug'))window.farmSurface=(points)=>points.map(([x,z])=>{
  const s=world.terrain.sample(x,z);return{x,z,soil:s[3],moisture:s[4],compaction:s[10]};
 });
 if(query.has('debug'))window.farmDiagnostics=()=>({count:herd.animals.length,states:herd.counts(),behavior:herd.inspect(),grass:grass.inspect(),animals:herd.animals.map(c=>({id:c.id,x:c.x,z:c.z,yaw:c.yaw,state:c.state,intent:c.intent,speed:c.actualSpeed,hunger:c.hunger,thirst:c.thirst,fatigue:c.fatigue,station:c.station?{x:c.station.x,z:c.station.z,type:c.station.type}:null})),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries});
 document.body.dataset.ready='true';document.body.dataset.herdCount=String(herd.animals.length);loading.hidden=true;
}catch(e){loading.hidden=true;error.hidden=false;error.textContent='Не удалось загрузить ферму. Обновите страницу, чтобы повторить.';console.error(e);bridge?.send('error');}

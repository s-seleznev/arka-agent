import * as T from 'three';
import {appearanceSeed,coatShader} from '../appearance.js';
import {infographicPlan} from './infographic.js?v=3';
import { random } from './layout.js';
import {createBehavior} from './behavior.js?v=10';
import {createFormations} from './formations.js?v=3';

export const HERD_SIZE=164;
const stride=42*16;
const shaderCode=`
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float animalRow;
uniform sampler2D herdPoses;
uniform vec2 herdPoseSize;
mat4 herdBone(float joint) {
 float x=joint*4.0; float y=(animalRow+0.5)/herdPoseSize.y;
 return mat4(texture2D(herdPoses,vec2((x+0.5)/herdPoseSize.x,y)),
             texture2D(herdPoses,vec2((x+1.5)/herdPoseSize.x,y)),
             texture2D(herdPoses,vec2((x+2.5)/herdPoseSize.x,y)),
             texture2D(herdPoses,vec2((x+3.5)/herdPoseSize.x,y)));
}
mat4 herdSkinning() {
 mat4 m=herdBone(skinIndex.x)*skinWeight.x;
 if(skinWeight.y>0.0)m+=herdBone(skinIndex.y)*skinWeight.y;
 if(skinWeight.z>0.0)m+=herdBone(skinIndex.z)*skinWeight.z;
 if(skinWeight.w>0.0)m+=herdBone(skinIndex.w)*skinWeight.w;
 return m;
}
`;

function navigation(obstacles,field,paths){
 const limitX=field.width/2-2.5,limitZ=field.depth/2-2.5;
 const rectangles=obstacles.map(o=>{
  const p=o.padding??(Math.min(o.w,o.d)<=2?.65:1.65);
  return{minX:o.x-o.w/2-p,maxX:o.x+o.w/2+p,minZ:o.z-o.d/2-p,maxZ:o.z+o.d/2+p};
 });
 const inside=(x,z)=>rectangles.some(r=>x>r.minX&&x<r.maxX&&z>r.minZ&&z<r.maxZ);
 const clear=(a,b)=>!rectangles.some(r=>{
  let t0=0,t1=1;
  for(const [start,delta,min,max] of [[a.x,b.x-a.x,r.minX,r.maxX],[a.z,b.z-a.z,r.minZ,r.maxZ]]){
   if(Math.abs(delta)<1e-8){if(start<=min||start>=max)return false;}
   else {const u=(min-start)/delta,v=(max-start)/delta;t0=Math.max(t0,Math.min(u,v));t1=Math.min(t1,Math.max(u,v));if(t0>=t1)return false;}
  }
  return t0<t1&&t1>0&&t0<1;
 });
 const vertices=[];
 for(const r of rectangles)for(const x of [r.minX-.9,r.maxX+.9])for(const z of [r.minZ-.9,r.maxZ+.9])if(!inside(x,z)&&Math.abs(x)<limitX&&Math.abs(z)<limitZ)vertices.push({x,z});
 const trailEdges=new Set();
 for(const path of paths){
  let previous=-1;
  for(const [x,z] of path.points){
   if(inside(x,z)){previous=-1;continue;}
   let index=vertices.findIndex(v=>Math.hypot(v.x-x,v.z-z)<.01);
   if(index<0){index=vertices.length;vertices.push({x,z});}
   if(previous>=0&&clear(vertices[previous],vertices[index]))trailEdges.add([Math.min(previous,index),Math.max(previous,index)].join(':'));
   previous=index;
  }
 }
 const edges=vertices.map(()=>[]);
 for(let i=0;i<vertices.length;i++)for(let j=i+1;j<vertices.length;j++)if(clear(vertices[i],vertices[j])){
  const dist=Math.hypot(vertices[i].x-vertices[j].x,vertices[i].z-vertices[j].z)*(trailEdges.has(i+':'+j)?.8:1);edges[i].push([j,dist]);edges[j].push([i,dist]);
 }
 function route(from,to,preferPaths=false){
  const direct=clear(from,to),distance=Math.hypot(from.x-to.x,from.z-to.z);
  if(direct&&(!preferPaths||distance<14))return[to];
  const points=[...vertices,from,to],n=points.length,start=n-2,end=n-1;
  const graph=edges.map(e=>e.slice());graph.push([],[]);
  if(direct){graph[start].push([end,distance]);graph[end].push([start,distance]);}
  for(const a of [start,end])for(let j=0;j<n-2;j++)if(clear(points[a],points[j])){
   const d=Math.hypot(points[a].x-points[j].x,points[a].z-points[j].z);graph[a].push([j,d]);graph[j].push([a,d]);
  }
  const costs=Array(n).fill(Infinity),previous=Array(n).fill(-1),visited=new Set();costs[start]=0;
  for(let i=0;i<n;i++){
   let node=-1;for(let j=0;j<n;j++)if(!visited.has(j)&&(node===-1||costs[j]<costs[node]))node=j;
   if(node===end||!Number.isFinite(costs[node]))break;visited.add(node);
   for(const [j,d] of graph[node])if(costs[node]+d<costs[j]){costs[j]=costs[node]+d;previous[j]=node;}
  }
  if(previous[end]===-1)return[];
  const result=[];for(let i=end;i!==start;i=previous[i])result.unshift(points[i]);return result;
 }
 return{inside,clear,route};
}

const assets=new Map();
function loadAsset(kind){
 if(!assets.has(kind))assets.set(kind,(async()=>{
  const [meta,bin]=await Promise.all([fetch(`./farm/${kind}.json?v=3`).then(r=>{if(!r.ok)throw new Error(kind);return r.json();}),fetch(`./farm/${kind}.bin?v=3`).then(r=>{if(!r.ok)throw new Error(kind);return r.arrayBuffer();})]);
  const section=name=>{const s=meta.sections[name];return new Float32Array(bin,s.offset,s.length);};
  return{meta,section,library:section('poses')};
 })().catch(error=>{assets.delete(kind);throw error;}));
 return assets.get(kind);
}
export async function createHerd(scene,world,records=null){
 const rows=records??Array.from({length:HERD_SIZE},(_,i)=>({animalId:'demo-'+i,farmId:'demo',primaryIdentifier:String(i+1).padStart(3,'0'),name:'',sex:i>=159?'MALE':'FEMALE',matched:true,groupValue:null}));
 const count=rows.length,height=Math.max(1,count),kinds=[...new Set(rows.map(r=>r.sex==='MALE'?'bull':'cow'))];
 const loaded=await Promise.all((kinds.length?kinds:['cow']).map(async kind=>[kind,await loadAsset(kind)]));
 const sources=Object.fromEntries(loaded),meta=loaded[0][1].meta;
 const poses=new Float32Array(height*stride),texture=new T.DataTexture(poses,meta.bones*4,height,T.RGBAFormat,T.FloatType);
 texture.needsUpdate=true;
 function animateShader(material,pass){
  material.onBeforeCompile=s=>{
   s.uniforms.herdPoses={value:texture};s.uniforms.herdPoseSize={value:new T.Vector2(meta.bones*4,height)};
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\n'+shaderCode+'\nattribute float animalOpacity; varying float cowOpacity; attribute float animalCoatSeed; varying vec3 coatPosition; varying float coatSeed;')
    .replace('void main() {','void main() {\ncoatPosition=position;coatSeed=animalCoatSeed;cowOpacity=animalOpacity;mat4 herdSkin = herdSkinning();')
    .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal = mat3(herdSkin) * objectNormal;')
    .replace('#include <begin_vertex>','vec3 transformed = (herdSkin * vec4(position, 1.0)).xyz;');
   s.fragmentShader=s.fragmentShader.replace('void main() {',`varying float cowOpacity;\nvoid main() {\n${pass==='ghost'?'if(cowOpacity>=.999)discard;':'if(cowOpacity<.999)discard;'}`);
   if(pass==='solid'||pass==='ghost')s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\n'+coatShader).replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb=animalCoat(diffuseColor.rgb);');
   if(pass==='ghost')s.fragmentShader=s.fragmentShader.replace('diffuseColor.rgb=animalCoat(diffuseColor.rgb);','diffuseColor.rgb=animalCoat(diffuseColor.rgb);\ndiffuseColor.rgb=mix(vec3(.66,.74,.78),diffuseColor.rgb,smoothstep(.14,1.,cowOpacity));diffuseColor.a*=cowOpacity;');
  };
  material.customProgramCacheKey=()=> 'herd-skinning-coat-v1-'+pass;return material;
 }
 const batches=[];
 for(const kind of kinds){
  const source=sources[kind],ids=rows.flatMap((r,i)=>(r.sex==='MALE'?'bull':'cow')===kind?[i]:[]);
  const geometry=new T.BufferGeometry();
  for(const [name,size] of [['position',3],['normal',3],['color',3],['skinIndex',4],['skinWeight',4]])geometry.setAttribute(name,new T.BufferAttribute(source.section(name),size));
  geometry.setIndex(new T.BufferAttribute(Uint16Array.from(source.section('index')),1));
  geometry.setAttribute('animalCoatSeed',new T.InstancedBufferAttribute(Float32Array.from(ids,i=>appearanceSeed(rows[i].animalId)),1));
  geometry.setAttribute('animalRow',new T.InstancedBufferAttribute(Float32Array.from(ids),1));
  const opacity=new T.InstancedBufferAttribute(Float32Array.from(ids,i=>rows[i].matched?1:.13),1);opacity.setUsage(T.DynamicDrawUsage);geometry.setAttribute('animalOpacity',opacity);
  const material=animateShader(new T.MeshStandardMaterial({vertexColors:true,roughness:.9}),'solid');
  const mesh=new T.InstancedMesh(geometry,material,ids.length);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  mesh.customDepthMaterial=animateShader(new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking}),'depth');
  const ghostMaterial=animateShader(new T.MeshStandardMaterial({vertexColors:true,roughness:1,transparent:true,depthWrite:false}),'ghost');
  const ghosts=new T.InstancedMesh(geometry,ghostMaterial,ids.length);ghosts.frustumCulled=false;ghosts.receiveShadow=false;ghosts.renderOrder=2;ghosts.instanceMatrix=mesh.instanceMatrix;
  scene.add(mesh,ghosts);batches.push({kind,ids,geometry,opacity,mesh,ghosts});
 }
 let infographic=false,layoutRule=null,fade=null;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const rng=random(9251),nav=navigation(world.obstacles,world.field,world.paths),dummy=new T.Object3D();
 for(const s of world.stations)s.occupied=null;
 const behavior=createBehavior(world,nav,rng,meta.clips,count),animals=behavior.animals;
 const formations=createFormations(world,nav),ray=new T.Ray(),inverse=new T.Matrix4(),instance=new T.Matrix4(),hit=new T.Vector3();
 const box=new T.Box3(new T.Vector3(-1.55,0,-.6),new T.Vector3(1.55,1.75,.6));
 function sample(source,clip,time,out,offset,blend=1,previous=null){
  const c=source.meta.clips[clip],library=source.library;
  const frame=c.oneShot?T.MathUtils.clamp(time/c.duration,0,1)*(c.frames-1):((time%c.duration+c.duration)%c.duration)/c.duration*c.frames;
  const f=Math.floor(frame),k=frame-f,a=(c.start+f)*stride,b=(c.start+(c.oneShot?Math.min(f+1,c.frames-1):(f+1)%c.frames))*stride;
  for(let j=0;j<stride;j++){const v=library[a+j]+(library[b+j]-library[a+j])*k;out[offset+j]=previous&&blend<1?previous[j]+(v-previous[j])*blend:v;}
 }
 function clipFor(c){
  if(infographic)return 'Idle';
  if(c.state==='lieDown')return'LieDown';
  if(c.state==='standUp')return'StandUp';
  if(c.state==='rest')return'Rest';
  if(['walk','grazeStep','backOut','yieldBack','stationAlign'].includes(c.state))return Math.abs(c.actualSpeed)>.06||Math.abs(c.turnRate)>.18?'Walk':'Idle';
  if(c.state==='water'||c.state==='stationLower'&&c.intent==='water')return'Idle_Headlow';
  if(c.state==='graze'||c.state==='feed'||c.state==='stationLower'&&c.intent==='feed')return'Eating';
  return c.state==='look'||c.id%2?'Idle_2':'Idle';
 }
 for(const batch of batches){
  batch.ids.forEach((id,i)=>{
   const c=animals[id];c.record=rows[id];c.batch=batch;c.instance=i;c.source=sources[batch.kind];
   c.clip=clipFor(c);c.phase=rng()*meta.clips[c.clip].duration;c.walkPhase=rng()*meta.clips.Walk.duration;
   c.blend=1;c.previous=new Float32Array(stride);c.opacity=c.record.matched?1:.13;
   batch.mesh.setColorAt(i,new T.Color(1,1,1));
   sample(c.source,c.clip,c.phase,poses,c.id*stride);behavior.setFiltered(id,!c.record.matched);
  });
  batch.ghosts.instanceColor=batch.mesh.instanceColor;
 }
 function renderPoses(dt){
  for(const batch of batches){batch.moved=false;batch.faded=false;batch.hasGhosts=false;}
  for(const c of animals){
   const batch=c.batch,target=fade?.stage==='out'?0:c.record.matched?1:infographic?0:.13;
   const opacity=fade?.stage==='out'?(c.record.matched?1:infographic?0:.13)*Math.max(0,1-fade.time/.32):c.opacity+(target-c.opacity)*(1-Math.exp(-dt*7));
   if(Math.abs(opacity-c.opacity)>.00001){c.opacity=Math.abs(opacity-target)<.0005?target:opacity;batch.opacity.setX(c.instance,c.opacity);batch.faded=true;}
   if(c.opacity<.999)batch.hasGhosts=true;
   const next=clipFor(c);
   if(c.clip!==next){
    c.previous.set(poses.subarray(c.id*stride,(c.id+1)*stride));c.blend=0;c.clip=next;
    c.phase=meta.clips[next].oneShot?0:next==='Walk'?c.walkPhase:rng()*meta.clips[next].duration;
   }
   c.blend=Math.min(1,c.blend+dt/(meta.clips[next].oneShot?.2:.65));
   if(next==='Walk'){
    const motion=Math.max(Math.abs(c.actualSpeed),Math.abs(c.turnRate)*.32),rate=Math.max(.32,motion/(c.source.meta.strideSpeed*c.scale));
    c.phase+=dt*rate*(c.state==='backOut'||c.state==='yieldBack'?-1:1);c.walkPhase=c.phase;
   }else c.phase+=dt;
   sample(c.source,c.clip,c.phase,poses,c.id*stride,c.blend*c.blend*(3-2*c.blend),c.previous);
   if(c.groundX===c.x&&c.groundZ===c.z&&c.groundYaw===c.yaw)continue;
   c.groundX=c.x;c.groundZ=c.z;c.groundYaw=c.yaw;batch.moved=true;
   const cos=Math.cos(c.yaw),sin=Math.sin(c.yaw),y=world.heightAt(c.x,c.z);
   const pitch=Math.atan2(world.heightAt(c.x+cos,c.z-sin)-world.heightAt(c.x-cos,c.z+sin),2);
   const roll=-Math.atan2(world.heightAt(c.x+sin,c.z+cos)-world.heightAt(c.x-sin,c.z-cos),2);
   dummy.position.set(c.x,y,c.z);dummy.rotation.set(roll,c.yaw,pitch,'YXZ');dummy.scale.setScalar(c.scale);dummy.updateMatrix();batch.mesh.setMatrixAt(c.instance,dummy.matrix);
  }
  texture.needsUpdate=true;
  for(const b of batches){if(b.moved)b.mesh.instanceMatrix.needsUpdate=true;if(b.faded)b.opacity.needsUpdate=true;b.ghosts.visible=b.hasGhosts;}
 }
 let grouping=[];
 function setData(nextRows,group){
  if(nextRows.length!==count||nextRows.some((r,i)=>r.animalId!==rows[i].animalId||r.sex!==rows[i].sex))return false;
  for(const c of animals){c.record=nextRows[c.id];behavior.setFiltered(c.id,!c.record.matched);}
  layoutRule=group;
  if(infographic){scheduleLayout();return true;}
  const plan=formations.plan(animals,group);grouping=plan.groups;behavior.setTargets(plan.targets);return true;
 }
 function scheduleLayout(){fade={stage:'out',time:0,plan:infographicPlan(animals,layoutRule)};if(reduced.matches)finishLayout();}
 function finishLayout(){
  const plan=fade.plan;grouping=plan.groups;
  for(const c of animals){const p=plan.targets.get(c.id);if(p){c.x=p.x;c.z=p.z;}c.yaw=0;c.state='idle';c.actualSpeed=0;c.turnRate=0;c.groundX=NaN;c.opacity=0;c.batch.opacity.setX(c.instance,0);c.batch.opacity.needsUpdate=true;}
  fade={stage:'in',time:0};
 }
 function setInfographic(value){
  if(infographic===value)return;
  infographic=value;
  if(value){for(const c of animals)c.farmPosition={x:c.x,z:c.z,yaw:c.yaw};scheduleLayout();}
  else {fade=null;for(const c of animals){Object.assign(c,c.farmPosition);c.groundX=NaN;}setData(animals.map(c=>c.record),layoutRule);}
 }
 function update(dt){
  if(infographic){if(fade){fade.time+=dt;if(fade.stage==='out'&&fade.time>=.32)finishLayout();else if(fade.stage==='in'&&fade.time>=.65)fade=null;}}
  else behavior.update(dt);
  renderPoses(reduced.matches?1:dt);
 }

 renderPoses(0);
 return{mesh:batches[0]?.mesh,meshes:batches.map(b=>b.mesh),animals,update,setData,setInfographic,infographicBounds:()=>{const p=infographicPlan(animals,layoutRule);return {width:p.width,depth:p.depth};},groups:()=>grouping,route:(from,to)=>nav.route(from,to,true),inspect:behavior.inspect,
  pick(worldRay){
   let nearest=null,distance=Infinity,ghost=null,ghostDistance=Infinity;
   for(const c of animals){
    if(infographic&&!c.record.matched)continue;
    c.batch.mesh.getMatrixAt(c.instance,instance);inverse.copy(instance).invert();ray.copy(worldRay).applyMatrix4(inverse);
    box.max.y=c.state==='rest'?1.02:1.8;box.max.x=c.record.sex==='MALE'?1.7:1.55;box.min.x=-box.max.x;
    if(!ray.intersectBox(box,hit))continue;
    hit.applyMatrix4(instance);const d=hit.distanceToSquared(worldRay.origin);
    if(!c.record.matched){if(d<ghostDistance){ghost=c;ghostDistance=d;}}
    else if(d<distance){nearest=c;distance=d;}
   }
   return nearest||ghost;
  },
  dispose(){for(const b of batches){scene.remove(b.mesh,b.ghosts);b.geometry.dispose();b.mesh.material.dispose();b.mesh.customDepthMaterial.dispose();b.ghosts.material.dispose();}texture.dispose();},
  advance(seconds){behavior.advance(seconds);renderPoses(0);return behavior.inspect();},
  counts(){const counts={walk:0,graze:0,idle:0,rest:0,feed:0,water:0};for(const c of animals){
   const state=c.state==='lieDown'||c.state==='standUp'?'rest':c.state==='grazeStep'||c.state==='look'?'graze':c.state==='backOut'||c.state==='yieldBack'?'walk':c.state==='stationLower'||c.state==='stationRaise'||c.state==='stationAlign'?c.intent:c.state;
   counts[state]=(counts[state]||0)+1;
  }return counts;}};
}

import * as T from 'three';
import {random,FIELD,SERVICE_AREAS,heightAt} from './layout.js';
import {ISLAND,onIsland,noise} from './terrain.js?v=16';

export function createGrass(scene,world){
 const rng=random(1785),positions=[],colors=[],distantPositions=[],distantColors=[];
 // Five distinct, bent leaves share one instanced tuft. The darker base closes
 // gaps against the ground while the sunlit tips read as individual blades.
 for(let i=0;i<5;i++){
  const a=i*2.4,width=.022+rng()*.024,height=.28+rng()*.3,lean=.12+rng()*.14;
  const right=new T.Vector3(Math.cos(a),0,Math.sin(a)),root=new T.Vector3((rng()-.5)*.15,0,(rng()-.5)*.15);
  const tip=new T.Vector3(Math.sin(a)*lean,height,-Math.cos(a)*lean).add(root);
  const left=root.clone().addScaledVector(right,-width),r=root.clone().addScaledVector(right,width);
  const mid=root.clone().lerp(tip,.56),ml=mid.clone().addScaledVector(right,-width*.53),mr=mid.clone().addScaledVector(right,width*.53);
  for(const v of [left,r,ml,r,mr,ml,ml,mr,tip]){
   positions.push(v.x,v.y,v.z);const t=v.y/height;colors.push(.66+t*.36,.72+t*.31,.57+t*.46);
  }
  for(const v of [left.clone().addScaledVector(right,-width*.1),r.clone().addScaledVector(right,width*.1),tip]){
   distantPositions.push(v.x,v.y,v.z);const t=v.y/height;distantColors.push(.66+t*.36,.72+t*.31,.57+t*.46);
  }
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
 const distantGeometry=new T.BufferGeometry();distantGeometry.setAttribute('position',new T.Float32BufferAttribute(distantPositions,3));distantGeometry.setAttribute('color',new T.Float32BufferAttribute(distantColors,3));distantGeometry.computeVertexNormals();
 const time={value:0},projectionScale={value:1},material=new T.MeshStandardMaterial({color:'#ffffff',vertexColors:true,side:T.DoubleSide,roughness:1});material.forceSinglePass=true;
 material.onBeforeCompile=shader=>{
  shader.uniforms.grassTime=time;
  shader.uniforms.grassProjection=projectionScale;
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal=normalize(mat3(viewMatrix)*vec3(0.0,1.0,0.0));');
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float grassTime,grassProjection;\nattribute float tuftRank;').replace('#include <begin_vertex>',`#include <begin_vertex>
   float phase=instanceMatrix[3].x*0.21+instanceMatrix[3].z*0.17;
   transformed.x+=sin(grassTime*1.12+phase)*position.y*position.y*0.22;
   transformed.z+=cos(grassTime*0.83+phase)*position.y*position.y*0.16;
   float pixels=grassProjection/max(1.0,distance(cameraPosition,instanceMatrix[3].xyz));
   float density=clamp(pixels*pixels/144.0,0.06,1.0);
   float emergence=1.0-smoothstep(density*0.8,density,tuftRank);
   transformed*=mix(emergence,1.0,smoothstep(0.92,1.0,density));`);
 };
 const count=250000,tileSize=24,buckets=new Map(),dummy=new T.Object3D(),sample=[],color=new T.Color();
 const blocked=(x,z)=>world.vegetationObstacles.some(r=>Math.abs(x-r.x)<r.w/2+.35&&Math.abs(z-r.z)<r.d/2+.35);
 let n=0;
 while(n<count){
  const x=(rng()-.5)*ISLAND.width,z=(rng()-.5)*ISLAND.depth;
  if(!onIsland(x,z,.03)||blocked(x,z))continue;
  world.terrain.sample(x,z,sample);
  if(rng()>Math.pow(1-sample[3],1.8))continue;
  const outside=Math.abs(x)>FIELD.width/2||Math.abs(z)>FIELD.depth/2,fence=Math.min(Math.abs(Math.abs(x)-FIELD.width/2),Math.abs(Math.abs(z)-FIELD.depth/2));
  const inYard=SERVICE_AREAS.some(r=>Math.abs(x-r.x)<r.w/2&&Math.abs(z-r.z)<r.d/2);
  const rich=outside||fence<1.4,clump=noise(x*.46+81,z*.46),height=inYard?.5+clump*.48:(rich?.95:.46)+clump*(rich?.8:.48);
  dummy.position.set(x,world.heightAt(x,z)-.025,z);dummy.rotation.set(0,rng()*Math.PI*2,0);dummy.scale.set(.75+rng()*.7,height*(.7+rng()*.6)*(1-sample[3]*.75),.75+rng()*.7);dummy.updateMatrix();
  const worn=sample[3]*.4;
  color.setRGB((sample[0]+9+32*worn)/255,(sample[1]+11+4*worn)/255,(sample[2]+5+23*worn)/255,T.SRGBColorSpace);color.multiplyScalar(.85+rng()*.22);
  const key=Math.floor(x/tileSize)+','+Math.floor(z/tileSize);
  if(!buckets.has(key))buckets.set(key,{matrices:[],colors:[]});
  const bucket=buckets.get(key);bucket.matrices.push(...dummy.matrix.elements);bucket.colors.push(color.r,color.g,color.b);n++;
 }
 // Keep every tuft and its colour. Spatial batches allow WebGL to skip grass
 // outside the camera; distant leaves use one triangle instead of three.
 const tiles=[];
 for(const bucket of buckets.values()){
  const total=bucket.colors.length/3,rank=new T.InstancedBufferAttribute(Float32Array.from({length:total},(_,i)=>(i+.5)/total),1);
  const near=geometry.clone(),far=distantGeometry.clone();near.setAttribute('tuftRank',rank);far.setAttribute('tuftRank',rank);
  const mesh=new T.InstancedMesh(near,material,total);
  mesh.instanceMatrix.array.set(bucket.matrices);
  mesh.instanceColor=new T.InstancedBufferAttribute(new Float32Array(bucket.colors),3);
  mesh.computeBoundingSphere();mesh.boundingSphere.radius+=.35;
  mesh.receiveShadow=true;mesh.castShadow=false;mesh.matrixAutoUpdate=false;mesh.updateMatrix();
  scene.add(mesh);tiles.push({mesh,near,far,total});
 }
 geometry.dispose();distantGeometry.dispose();
 buckets.clear();
 const frustum=new T.Frustum(),projection=new T.Matrix4();
 let visibleTufts=count,visibleTriangles=count*15;
 function updateView(camera,renderHeight){
  camera.updateMatrixWorld();projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);
  visibleTufts=0;visibleTriangles=0;
  const pixels=renderHeight*camera.projectionMatrix.elements[5]*.55*.5;
  projectionScale.value=pixels;
  for(const {mesh,near,far,total} of tiles){
   mesh.visible=frustum.intersectsSphere(mesh.boundingSphere);if(!mesh.visible)continue;
   const distance=Math.max(1,camera.position.distanceTo(mesh.boundingSphere.center)-mesh.boundingSphere.radius);
   const size=pixels/distance;
   // Hysteresis avoids switching meshes back and forth at a distance boundary.
   if(mesh.geometry===near&&size<7)mesh.geometry=far;
   else if(mesh.geometry===far&&size>9)mesh.geometry=near;
   // Prefixes of each randomly distributed batch remain evenly distributed.
   // The shader grows new tufts gradually, rather than popping whole tiles.
   mesh.count=Math.min(total,Math.ceil(total*Math.max(.06,Math.min(1,size*size/144))));
   visibleTufts+=mesh.count;visibleTriangles+=mesh.count*(mesh.geometry===near?15:5);
  }
 }
 return{update(dt){time.value+=dt;},updateView,inspect:()=>({tufts:count,visibleTufts,triangles:visibleTriangles,tiles:tiles.length})};
}

import * as T from 'three';
import { mergeGeometries } from '../vendor/utils/BufferGeometryUtils.js';
import {createTerrain,onIsland} from './terrain.js?v=16';
import {FIELD,ISLAND,BUILDINGS,SHELTERS,TROUGHS,TOWER,ROADS,CATTLE_PATHS,FENCES,PEN_FENCES,GATES,gateLeaves,PEN,inPen,TREES,SERVICE_AREAS,groundPads,heightAt,random} from './layout.js';
export {FIELD,random} from './layout.js';
import {createBuildings} from './buildings.js?v=1';
import {farmMaterial,createWater} from './materials.js?v=1';

export async function createWorld(scene){
 const rng=random(2041), batches=new Map(), dummy=new T.Object3D();
 const materials={
  wood:'#8c623c',woodLight:'#b9925b',woodDark:'#5b422c',wall:'#d6c9a6',trim:'#eee3c7',roof:'#a56e4e',roofLight:'#b47f57',roofDark:'#785e4a',glass:'#566c64',stone:'#93917a',metal:'#6a7871',tank:'#91aaa7',tankLight:'#b9c6b5',leaf:'#56733c',leafLight:'#6b8747',leafDark:'#456235',grass:'#6c8c3e',grassLight:'#8ba24c',hay:'#c3ab63',water:'#679496',soil:'#b3a078',roofSteel:'#6c7d77',roofHay:'#8c7053',roofWorkshop:'#53616a',wallWorkshop:'#c6c2b0',hayDark:'#99834f'
 };
 function add(g,color,x=0,y=0,z=0,rx=0,ry=0,rz=0){
  dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,rz);dummy.scale.set(1,1,1);dummy.updateMatrix();
  const clone=(g.index?g.toNonIndexed():g.clone()).applyMatrix4(dummy.matrix);if(!batches.has(color))batches.set(color,[]);batches.get(color).push(clone);
 }
 function box(x,y,z,w,h,d,color,ry=0,rz=0){add(new T.BoxGeometry(w,h,d),color,x,y,z,0,ry,rz);}
 function beam(a,b,r,color){
  const v=new T.Vector3(...a),end=new T.Vector3(...b),d=end.clone().sub(v),g=new T.CylinderGeometry(r,r,d.length(),5);
  const m=new T.Matrix4().compose(v.add(end).multiplyScalar(.5),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.normalize()),new T.Vector3(1,1,1));
  g.applyMatrix4(m);add(g,color);
 }
 function post(x,z){const h=heightAt(x,z);box(x,h+.88,z,.24,1.76,.24,'wood');add(new T.ConeGeometry(.205,.17,4),'woodLight',x,h+1.83,z,0,Math.PI/4);}
 function fence(a,b){
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),n=Math.ceil(length/3.6);
  for(let i=0;i<=n;i++)post(a[0]+dx*i/n,a[1]+dz*i/n);
  for(let i=0;i<n;i++){
   const x=a[0]+dx*(i+.5)/n,z=a[1]+dz*(i+.5)/n;
   const y0=heightAt(a[0]+dx*i/n,a[1]+dz*i/n),y1=heightAt(a[0]+dx*(i+1)/n,a[1]+dz*(i+1)/n);
   for(const y of [.58,1.25])box(x,y+(y0+y1)/2,z,Math.hypot(length/n,y1-y0)+.1,.18,.13,'woodLight',-Math.atan2(dz,dx),Math.atan2(y1-y0,length/n));
  }
 }
 for(const [a,b] of FENCES)fence(a,b);
 for(const gate of GATES){
  const [ax,az]=gate.a,[bx,bz]=gate.b;
  for(const [x,z] of [gate.a,gate.b])box(x,heightAt(x,z)+1,z,.34,2,.34,'woodDark');
  const leaves=gateLeaves(gate);
  for(const [a,b] of leaves){
   const y=heightAt(a[0],a[1]);
   for(const h of [.42,.8,1.18,1.57])beam([a[0],y+h,a[1]],[b[0],y+h,b[1]],.055,'metal');
   for(const p of [a,b])beam([p[0],y+.4,p[1]],[p[0],y+1.62,p[1]],.065,'metal');
   beam([a[0],y+.4,a[1]],[b[0],y+1.57,b[1]],.045,'metal');
  }
 }
 const roads=ROADS;
 createBuildings({box,beam,add});
 // Open cattle shelter and the feeding lane.
 function shelter(sx,sz,sw=21,sd=9,sh=4.5){
 // Bedding sits on the same textured ground as the pen, without a flat colour slab.
 for(let i=0;i<180;i++){const x=sx+(rng()-.5)*(sw-1),z=sz+(rng()-.5)*(sd-1),a=rng()*Math.PI*2;beam([x,.05,z],[x+Math.cos(a)*.22,.06,z+Math.sin(a)*.22],.012,'hay');}
 for(const x of [sx-sw/2,sx-sw/6,sx+sw/6,sx+sw/2])for(const z of [sz-sd/2,sz+sd/2])box(x,sh/2,z,.34,sh,.34,'woodDark');
 for(const z of [sz-sd/2,sz+sd/2])box(sx,sh-.3,z,sw+.45,.36,.25,'wood');
 box(sx,1.3,sz-sd/2,sw,1.8,.16,'wood');
 for(const side of [-1,1])for(const z of [sz-sd/2,sz+sd/2])beam([sx+side*sw/2,sh-1.3,z],[sx+side*(sw/2-1.25),sh-.28,z],.105,'wood');
 const roofAngle=.27,half=sd/2+.7,slant=half/Math.cos(roofAngle);
 for(const side of [-1,1])add(new T.BoxGeometry(sw+1.3,.18,slant),'roofLight',sx,sh+.7,sz+side*half/2,side*roofAngle,0,0);
 box(sx,sh+1.46,sz,sw+1.4,.15,.22,'roofDark');
 }
 for(const s of SHELTERS)shelter(s.x,s.z,s.w,s.d,s.h);
 const stations=[];
 function trough({x,z,length,type,sides}){
  const water=type==='water',height=water?.6:.66,halfWidth=water?.625:.84;
  // Firm apron underneath, with a soft worn edge supplied by the terrain mask.
  box(x,.035,z,length+2,.07,water?4.7:2.8,'stone');
  box(x,water?height/2:height/2+.08,z,length,water?height:height-.16,halfWidth*2,water?'stone':'woodDark');
  if(!water)for(let i=-length/2+.6;i<length/2;i+=3.4)for(const side of [-1,1])box(x+i,.16,z+side*.66,.13,.32,.14,'woodDark');
  if(water){
   box(x,height+.035,z,length-.26,.08,.91,'water');createWater(scene,x,z,length);
   beam([x-length/2+.3,.2,z+.9],[x-length/2+.3,1.0,z+.9],.065,'metal');
   beam([x-length/2+.3,1.0,z+.9],[x-length/2+.3,1.0,z+.2],.065,'metal');
  }else{
   box(x,height+.035,z,length-.26,.1,1.4,'hay');
   for(let i=0;i<Math.ceil(length*3);i++){
    const g=new T.IcosahedronGeometry(.28+rng()*.19,0).scale(1,.58,1);
    add(g,'hay',x-length/2+.3+rng()*(length-.6),height+.15,z+(rng()-.5)*.95,0,rng()*6);
   }
   for(let i=0;i<length*24;i++){
    const xx=x+(rng()-.5)*(length-.4),zz=z+(rng()-.5)*1.3,yy=height+.17+rng()*.08,a=rng()*6.28;
    beam([xx,yy,zz],[xx+Math.cos(a)*.19,yy+.025,zz+Math.sin(a)*.19],.008,'hay');
   }
  }
  for(const side of [-1,1]){
   box(x,height+.12,z+side*(halfWidth-.025),length+.16,.21,.14,water?'stone':'woodLight');
   if(!water&&sides.includes(side)){
    box(x,1.28,z+side*.83,length+.15,.09,.09,'metal');
    for(let i=-length/2+.25;i<length/2;i+=.95)beam([x+i,.65,z+side*.8],[x+i+.24,1.31,z+side*.8],.035,'metal');
   }
   if(sides.includes(side))for(let i=-length/2+1.5;i<length/2-1;i+=3.1)stations.push({x:x+i,z:z+side*2.05,yaw:side===1?Math.PI/2:-Math.PI/2,type,occupied:null});
  }
 }
 for(const t of TROUGHS)trough(t);
 // An elevated tank on four braced legs, deliberately distinct from a silo.
 const tx=TOWER.x,tz=TOWER.z,tankY=16.3;
 for(const dx of [-1,1])for(const dz of [-1,1]){
  box(tx+dx*3,.16,tz+dz*3,1.45,.32,1.45,'stone');
  beam([tx+dx*3,.3,tz+dz*3],[tx+dx*2.1,tankY-3,tz+dz*2.1],.18,'metal');
 }
 for(const level of [0,1]){
  const low=.5+level*6.2,high=low+6.2,span=3-level*.42,topSpan=span-.42;
  for(const side of [-1,1]){
   beam([tx-span,low,tz+side*span],[tx+topSpan,high,tz+side*topSpan],.085,'metal');
   beam([tx+span,low,tz+side*span],[tx-topSpan,high,tz+side*topSpan],.085,'metal');
   beam([tx+side*span,low,tz-span],[tx+side*topSpan,high,tz+topSpan],.085,'metal');
   beam([tx+side*span,low,tz+span],[tx+side*topSpan,high,tz-topSpan],.085,'metal');
  }
 }
 add(new T.CylinderGeometry(3.1,3.1,5.7,16),'tank',tx,tankY,tz);
 add(new T.ConeGeometry(3.65,2.15,16),'tankLight',tx,tankY+3.88,tz);
 for(const y of [tankY-2.85,tankY-.8,tankY+1.15,tankY+2.85])add(new T.TorusGeometry(3.14,.09,4,32),'metal',tx,y,tz,Math.PI/2);
 add(new T.CylinderGeometry(3.75,3.75,.2,16),'metal',tx,tankY-2.95,tz);
 for(let i=0;i<16;i++){
  const a=i*Math.PI/8;beam([tx+3.6*Math.cos(a),tankY-2.9,tz+3.6*Math.sin(a)],[tx+3.6*Math.cos(a),tankY-1.8,tz+3.6*Math.sin(a)],.045,'metal');
 }
 add(new T.TorusGeometry(3.6,.055,4,32),'metal',tx,tankY-1.8,tz,Math.PI/2);
 for(const dx of [-.36,.36])beam([tx+dx,.2,tz+3.35],[tx+dx,tankY-2.8,tz+3.35],.05,'metal');
 for(let y=.5;y<tankY-2.8;y+=.52)beam([tx-.36,y,tz+3.35],[tx+.36,y,tz+3.35],.045,'metal');
 // A grove of broad, faceted crowns: natural silhouettes without voxel cubes.
 const treePositions=[];
 function tree(x,z,h,wide,type=0){
  const base=heightAt(x,z);treePositions.push({x,z,r:wide});
  add(new T.CylinderGeometry(.17,.43,h*.7,7),'wood',x,base+h*.34,z,0,0,(rng()-.5)*.05);
  const count=type===1?7:5;
  for(let i=0;i<count;i++){
   const a=i*2.399+type,r=wide*(.62+rng()*.2),cy=h*(.57+rng()*.25),spread=wide*(type===2?.76:.5);
   const cx=x+Math.cos(a)*spread,cz=z+Math.sin(a)*spread;
   beam([x,base+h*.38,z],[cx,base+cy,cz],.10,'wood');
   const g=new T.IcosahedronGeometry(1,2),v=g.attributes.position;
   for(let j=0;j<v.count;j++){
    const xx=v.getX(j),yy=v.getY(j),zz=v.getZ(j),f=1+.16*Math.sin(xx*11+yy*8)*Math.cos(zz*12+a);
    v.setXYZ(j,xx*f*r,yy*f*h*(type===1?.26:.2),zz*f*r*.86);
   }
   g.computeVertexNormals();add(g,['leaf','leafLight','leafDark'][(i+type)%3],cx,base+cy,cz,0,rng()*6);
  }
 }
 for(const [x,z,h,r,t] of TREES)tree(x,z,h,r,t);
 for(let i=0;i<55;i++){
  const x=(rng()-.5)*(ISLAND.width-4),z=(rng()-.5)*(ISLAND.depth-4);
  if(!onIsland(x,z,2)||(Math.abs(x)<FIELD.width/2+2&&Math.abs(z)<FIELD.depth/2+2))continue;
  const g=new T.IcosahedronGeometry(.13+rng()*.3,0).scale(1,.6,.8);add(g,'stone',x,heightAt(x,z)+.08,z,0,rng()*6);
 }
 for(const [key,geometries] of batches){
  const mesh=new T.Mesh(mergeGeometries(geometries),farmMaterial(key,materials[key]));
  mesh.castShadow=!['soil','water','grass','grassLight'].includes(key);mesh.receiveShadow=true;scene.add(mesh);geometries.forEach(g=>g.dispose());
 }
 const hardObstacles=[
  ...BUILDINGS.map(b=>({x:b.x,z:b.z,w:b.w+.5,d:b.d+.5})),TOWER,
  ...TROUGHS.map(t=>({x:t.x,z:t.z,w:t.length+.3,d:t.type==='feed'?1.8:1.5})),
  ...treePositions.map(p=>({x:p.x,z:p.z,w:1.1,d:1.1})),
  ...SHELTERS.flatMap(s=>[
   {x:s.x,z:s.z-s.d/2,w:s.w,d:.3},
   ...[-s.w/2,-s.w/6,s.w/6,s.w/2].flatMap(dx=>[-s.d/2,s.d/2].map(dz=>({x:s.x+dx,z:s.z+dz,w:.38,d:.38})))
  ])
 ];
 const segmentObstacle=([a,b])=>({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,w:Math.abs(b[0]-a[0])+.22,d:Math.abs(b[1]-a[1])+.22,padding:.9});
 const penBarriers=[...PEN_FENCES,...GATES.filter(g=>g.id.startsWith('meadow')).flatMap(g=>gateLeaves(g))].map(segmentObstacle);
 const obstacles=[...hardObstacles,...SERVICE_AREAS,...penBarriers];
 // Concrete aprons are walkable, but their whole footprint excludes vegetation.
 const vegetationObstacles=[...BUILDINGS,...SHELTERS,TOWER,...TROUGHS.map(t=>({x:t.x,z:t.z,w:t.length+2,d:t.type==='feed'?2.8:4.7})),...treePositions.map(p=>({x:p.x,z:p.z,w:1.2,d:1.2}))];
 const worn=groundPads;
 const shelterAreas=SHELTERS.map(s=>({x:s.x,z:s.z+1,w:s.w-3,d:s.d-3}));
 const shadeAreas=[...shelterAreas,...treePositions.filter(p=>Math.abs(p.x)<FIELD.width/2-4&&Math.abs(p.z)<FIELD.depth/2-4).map(p=>({x:p.x+3,z:p.z-2,w:p.r*1.7,d:p.r*1.5}))];
 const terrain=await createTerrain(scene,roads,worn,CATTLE_PATHS);
 return{stations,obstacles,vegetationObstacles,roads,worn,terrain,shadeAreas,shelterAreas,paths:CATTLE_PATHS,pen:PEN,inPen,field:FIELD,heightAt:terrain.heightAt};
}

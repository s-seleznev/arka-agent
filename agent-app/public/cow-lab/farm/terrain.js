import * as T from 'three';
import {mergeGeometries} from '../vendor/utils/BufferGeometryUtils.js';

import {ISLAND} from './layout.js';
import {createSurface} from './ground-surface.js?v=5';
import {createGroundMaterial} from './ground-material.js?v=7';
export {ISLAND} from './layout.js';
const clamp=T.MathUtils.clamp,lerp=T.MathUtils.lerp;
function smooth(a,b,x){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
function hash(x,z){let n=Math.imul(x,374761393)+Math.imul(z,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
export function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);return lerp(lerp(hash(ix,iz),hash(ix+1,iz),u),lerp(hash(ix,iz+1),hash(ix+1,iz+1),u),v);}
export function onIsland(x,z,inset=0){const qx=Math.abs(x)-(ISLAND.width/2-ISLAND.radius),qz=Math.abs(z)-(ISLAND.depth/2-ISLAND.radius);return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)<ISLAND.radius-inset;}
function canvas(size){const c=document.createElement('canvas');c.width=c.height=size;return c;}
function texture(c,color=true){const t=new T.CanvasTexture(c);if(color)t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;}


function perimeter(){
 const result=[],w=ISLAND.width/2,d=ISLAND.depth/2,r=ISLAND.radius;
 for(let i=0;i<4;i++){
  const a=i*Math.PI/2,cx=(i===0||i===3)?w-r:-w+r,cz=i<2?d-r:-d+r;
  for(let j=0;j<=10;j++){const t=a+j/10*Math.PI/2;result.push(new T.Vector2(cx+r*Math.cos(t),cz+r*Math.sin(t)));}
  const end=result[result.length-1],next=(i+1)%4,na=next*Math.PI/2,ncx=(next===0||next===3)?w-r:-w+r,ncz=next<2?d-r:-d+r;
  const dest=new T.Vector2(ncx+r*Math.cos(na),ncz+r*Math.sin(na)),len=end.distanceTo(dest),count=Math.ceil(len/1.65);
  for(let j=1;j<count;j++)result.push(end.clone().lerp(dest,j/count));
 }
 return result;
}

function strata(scene,ring){
 const levels=[-.035,-.58,-3.5,-8.3,-13.0,ISLAND.bottom];
 const scales=[1,1.0005,1.0005,.994,.983,.955];
 const colors=['#454a2d','#594533','#876847','#ae8b5c','#99907d'];
 const boundary=(p,l)=>levels[l]+(l===0?0:(noise(p.x*.11+l*19,p.y*.11+8)-.5)*(l===1?.32:1.15));
 const tex=canvas(256),ctx=tex.getContext('2d'),data=ctx.createImageData(256,256);
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){const k=(y*256+x)*4,v=232+(hash(x,y)-.5)*24+(noise(x/18,y/12)-.5)*22;data.data[k]=data.data[k+1]=data.data[k+2]=v;data.data[k+3]=255;}
 ctx.putImageData(data,0,0);const stone=texture(tex),bump=texture(tex,false);stone.wrapS=stone.wrapT=bump.wrapS=bump.wrapT=T.RepeatWrapping;
 let perimeterLength=0;const distances=ring.map((p,i)=>{const v=perimeterLength;perimeterLength+=p.distanceTo(ring[(i+1)%ring.length]);return v;});
 for(let layer=0;layer<levels.length-1;layer++){
  const positions=[],uv=[],vertexColors=[],indices=[],steps=4,base=new T.Color(colors[layer]);
  for(let i=0;i<=ring.length;i++){
   const p=ring[i%ring.length],length=i===ring.length?perimeterLength:distances[i];
   for(let j=0;j<=steps;j++){
    const t=j/steps,scale=lerp(scales[layer],scales[layer+1],t),relief=j===0||j===steps?0:(noise(length*.9,j*.6+layer)-.5)*.13;
    const outward=p.clone().normalize();
    positions.push(p.x*scale+outward.x*relief,lerp(boundary(p,layer),boundary(p,layer+1),t),p.y*scale+outward.y*relief);
    uv.push(length/6,(layer*3+t*3)/3);
    const light=.92+noise(length*.38,layer*11+t*4)*.17;
    vertexColors.push(base.r*light,base.g*light,base.b*light);
   }
  }
  for(let i=0;i<ring.length;i++)for(let j=0;j<steps;j++){const a=i*(steps+1)+j,b=a+steps+1;indices.push(a,b,a+1,b,b+1,a+1);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(vertexColors,3));g.setIndex(indices);g.computeVertexNormals();
  const m=new T.Mesh(g,new T.MeshStandardMaterial({vertexColors:true,map:stone,bumpMap:bump,bumpScale:.14,roughness:1,side:T.DoubleSide}));m.castShadow=true;m.receiveShadow=true;scene.add(m);
 }
 const roots=[],pebbles=[],dummy=new T.Object3D();
 for(let i=0;i<ring.length;i++){
  const p=ring[i],next=ring[(i+1)%ring.length],tangent=next.clone().sub(p).normalize(),outward=new T.Vector2(tangent.y,-tangent.x);
  if(hash(i,5)>.58){
   const points=[],length=.9+hash(i,4)*2.7;
   for(let j=0;j<5;j++){const wander=(hash(i,j+3)-.5)*.55;points.push(new T.Vector3(p.x+outward.x*.07+tangent.x*wander,-.25-length*j/4,p.y+outward.y*.07+tangent.y*wander));}
   roots.push(new T.TubeGeometry(new T.CatmullRomCurve3(points),8,.025+hash(i,8)*.025,4,false).toNonIndexed());
   const branch=[points[2],points[2].clone().add(new T.Vector3(tangent.x*.4,-.36,tangent.y*.4)),points[3].clone().add(new T.Vector3(tangent.x*.65,-.38,tangent.y*.65))];
   roots.push(new T.TubeGeometry(new T.CatmullRomCurve3(branch),5,.018,4,false).toNonIndexed());
  }
  for(let j=0;j<2;j++){
   const y=-3.5-hash(i,j+21)*8.5,scale=lerp(1,.98,(-y-3.5)/8.5),radius=.08+hash(i,j+51)*.24;
   const g=new T.IcosahedronGeometry(radius,0);
   dummy.position.set(p.x*scale+outward.x*.035,y,p.y*scale+outward.y*.035);dummy.rotation.set(hash(i,31)*4,hash(i,j)*5,hash(i,78)*4);dummy.scale.set(1.3,.65,.75);dummy.updateMatrix();g.applyMatrix4(dummy.matrix);pebbles.push(g);
  }
 }
 const rootMesh=new T.Mesh(mergeGeometries(roots),new T.MeshStandardMaterial({color:'#b39a75',roughness:1}));scene.add(rootMesh);
 const stones=new T.Mesh(mergeGeometries(pebbles),new T.MeshStandardMaterial({color:'#a39985',roughness:1,flatShading:true}));stones.receiveShadow=true;scene.add(stones);
 // A quiet studio shadow leaves a visible gap under the earth section.
 const shadowCanvas=canvas(256),shadowCtx=shadowCanvas.getContext('2d'),gradient=shadowCtx.createRadialGradient(128,128,25,128,128,125);
 gradient.addColorStop(0,'rgba(42,35,24,0.2)');gradient.addColorStop(.6,'rgba(42,35,24,0.12)');gradient.addColorStop(1,'rgba(42,35,24,0)');shadowCtx.fillStyle=gradient;shadowCtx.fillRect(0,0,256,256);
 const shadow=new T.Mesh(new T.PlaneGeometry(ISLAND.width+40,ISLAND.depth+34),new T.MeshBasicMaterial({map:texture(shadowCanvas),transparent:true,depthWrite:false,toneMapped:false}));shadow.rotation.x=-Math.PI/2;shadow.position.set(3,-29,3);scene.add(shadow);
}

export async function createTerrain(scene,roads,worn,paths=[]){
 const ring=perimeter(),shape=new T.Shape();ring.forEach((p,i)=>i?shape.lineTo(p.x,-p.y):shape.moveTo(p.x,-p.y));shape.closePath();
 const ground=createSurface(roads,worn,paths);
 const g=new T.PlaneGeometry(ISLAND.width,ISLAND.depth,512,384);g.rotateX(-Math.PI/2);
 const p=g.attributes.position,uv=g.attributes.uv;
 for(let i=0;i<p.count;i++){
  let x=p.getX(i),z=p.getZ(i);
  const cx=Math.max(0,Math.abs(x)-(ISLAND.width/2-ISLAND.radius)),cz=Math.max(0,Math.abs(z)-(ISLAND.depth/2-ISLAND.radius)),length=Math.hypot(cx,cz);
  if(length>ISLAND.radius){x=Math.sign(x)*(ISLAND.width/2-ISLAND.radius+cx/length*ISLAND.radius);z=Math.sign(z)*(ISLAND.depth/2-ISLAND.radius+cz/length*ISLAND.radius);}
  p.setXYZ(i,x,ground.heightAt(x,z),z);uv.setXY(i,x/ISLAND.width+.5,.5-z/ISLAND.depth);
 }
 g.computeVertexNormals();
 const mesh=new T.Mesh(g,await createGroundMaterial(ground));mesh.position.y=-.032;mesh.receiveShadow=true;scene.add(mesh);
 const bottom=new T.ShapeGeometry(shape);bottom.rotateX(Math.PI/2);bottom.scale(.955,1,.955);
 const base=new T.Mesh(bottom,new T.MeshStandardMaterial({color:'#81796a',roughness:1}));base.position.y=ISLAND.bottom-.4;scene.add(base);
 strata(scene,ring);
 return ground;
}

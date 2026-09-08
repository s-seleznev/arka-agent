import * as T from 'three';
import {ISLAND,PEN,SHELTERS,TROUGHS,heightAt} from './layout.js';

const clamp=T.MathUtils.clamp,lerp=T.MathUtils.lerp;
function smooth(a,b,x){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
function hash(x,z){let n=Math.imul(x,374761393)+Math.imul(z,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);return lerp(lerp(hash(ix,iz),hash(ix+1,iz),u),lerp(hash(ix,iz+1),hash(ix+1,iz+1),u),v);}
function canvas(size){const c=document.createElement('canvas');c.width=c.height=size;return c;}
function texture(c,color=true){const t=new T.CanvasTexture(c);if(color)t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;}
function join(a,b){return a+b-a*b;}
function segmentDistance(x,z,ax,az,bx,bz){
 const dx=bx-ax,dz=bz-az,t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);
 return Math.hypot(x-ax-dx*t,z-az-dz*t);
}
function compile(p,trail=false){
 let length=0;const segments=[];
 for(let i=1;i<p.points.length;i++){
  const a=p.points[i-1],b=p.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
  if(len<.01)continue;segments.push({x:a[0],z:a[1],dx,dz,len,start:length});length+=len;
 }
 const margin=p.width+6,first=p.points[0];
 const meadow=first[0]<PEN.left||first[1]<PEN.back;
 return{...p,segments,length,trail,meadow,minX:Math.min(...p.points.map(p=>p[0]))-margin,maxX:Math.max(...p.points.map(p=>p[0]))+margin,minZ:Math.min(...p.points.map(p=>p[1]))-margin,maxZ:Math.max(...p.points.map(p=>p[1]))+margin};
}

// The control field follows use, never the rectangular boundaries of a paddock.
// Each lobe describes an occupied part of the yard; the unoccupied margins stay turf.
const useAreas=[
 {x:-41,z:49,rx:23,rz:18,strength:.65},
 {x:-17,z:52,rx:25,rz:20,strength:.73},
 {x:7,z:49,rx:20,rz:18,strength:.65},
 {x:-19,z:30,rx:43,rz:8.5,strength:.55},
 {x:-36,z:32,rx:16,rz:9,strength:.38},
 {x:7,z:33,rx:16,rz:9,strength:.36},
 {x:-36,z:66,rx:20,rz:12,strength:.64},
 {x:-15,z:62,rx:25,rz:13,strength:.68},
 {x:11,z:65,rx:17,rz:12,strength:.64},
 {x:-50,z:62,rx:13,rz:8,strength:.96,turn:true},
 // The service court is a shared manoeuvring space between doors, not a plot fill.
 {x:84,z:59,rx:17,rz:14,strength:.88},
 {x:76,z:46,rx:12,rz:5.5,strength:.9},
 {x:98,z:63,rx:6,rz:8,strength:.87},
 {x:71,z:69,rx:4.3,rz:4,strength:.78}
];

export function createSurface(roads,worn,paths){
 const size=768,channels=11,grid=new Float32Array(size*size*channels);
 const vehiclePaths=roads.map(p=>compile(p)),routes=[...vehiclePaths,...paths.map(p=>compile(p,true))];
 const gates=worn.filter(r=>r.type==='gate');
 const water=TROUGHS.filter(t=>t.type==='water'),feed=TROUGHS.filter(t=>t.type==='feed');
 for(let j=0;j<size;j++)for(let i=0;i<size;i++){
  const x=(i/(size-1)-.5)*ISLAND.width,z=(j/(size-1)-.5)*ISLAND.depth;
  const broad=noise(x*.07+23,z*.07),clumps=noise(x*.44+31,z*.44+17);
  // Metre-scale indentations and small tuft-scale gaps break up the boundary.
  // Noise only perturbs authored wear; it cannot create dirt in an unused corner.
  const warpX=(noise(x*.105+17,z*.105+41)-.5)*3.5;
  const warpZ=(noise(x*.105+71,z*.105+5)-.5)*3.5;
  const edge=(clumps-.5)*.9+(noise(x*1.5+37,z*1.5)-.5)*.28;
  const xx=x+warpX,zz=z+warpZ;
  let use=0,compaction=0,wet=0,dry=0,rut=0,turn=0,churn=0;
  for(const a of useAreas){
   if(Math.abs(xx-a.x)>a.rx+1||Math.abs(zz-a.z)>a.rz+1)continue;
   const q=Math.hypot((xx-a.x)/a.rx,(zz-a.z)/a.rz)+edge*.028;
   const occupancy=.8+noise(xx*.23+51,zz*.23+8)*.2;
   const mask=(1-smooth(.2,1.06,q))*a.strength*occupancy;
   use=join(use,mask);compaction=Math.max(compaction,mask*.62);
   churn=Math.max(churn,mask*(a.x<PEN.right?.72:.26));
   if(a.turn)turn=mask;
  }
  for(const r of routes){
   if(x<r.minX||x>r.maxX||z<r.minZ||z>r.maxZ)continue;
   let best=Infinity,lateral=0,along=0;
   for(const s of r.segments){
    const t=clamp(((x-s.x)*s.dx+(z-s.z)*s.dz)/(s.len*s.len),0,1);
    const dx=x-s.x-s.dx*t,dz=z-s.z-s.dz*t,d2=dx*dx+dz*dz;
    if(d2<best){best=d2;lateral=(-dx*s.dz+dz*s.dx)/s.len;along=s.start+s.len*t;}
   }
   const distance=Math.sqrt(best),width=r.width*(.78+noise(along*.07,48)*.48);
   if(r.trail){
    const reach=r.meadow?smooth(0,22,along):1;
    const mask=(1-smooth(width*.1,width+1.25,distance+edge*.5))*reach;
    const strength=(r.meadow?.24+.26*smooth(8,40,along):.37)*(.65+.35*noise(along*.31,27));
    use=join(use,mask*strength);compaction=Math.max(compaction,mask*.42);
   }else{
    const edgeDrift=(noise(along*.14,97)-.5)*1.0;
    const mask=1-smooth(width*.48,width+2.25,distance+edge+edgeDrift);
    const drift=(noise(along*.08,63)-.5)*.68;
    let wheels=0;
    for(const side of [-1,1]){
     const wheelWidth=.56+.35*noise(along*.17,side*31+52);
     const wheel=Math.exp(-Math.pow((lateral-side*1.0-drift)/wheelWidth,2));
     const pressure=.42+.58*smooth(.25,.76,noise(along*.23,side*73+92));
     wheels=Math.max(wheels,wheel*pressure);
     rut=Math.max(rut,wheel*pressure*mask*(1-turn)*.55);
    }
    const traffic=mask*(.57+.16*noise(along*.13,66)+wheels*.28);
    use=join(use,clamp(traffic,0,.985));compaction=Math.max(compaction,mask*(.48+wheels*.46));
   }
  }
  for(const g of gates){
   const along=(x-g.x)*g.direction[0]+(z-g.z)*g.direction[1];
   const across=-(x-g.x)*g.direction[1]+(z-g.z)*g.direction[0];
   const q=Math.hypot(along/10,across/(3.9+smooth(-6,5,along)*1.2))+edge*.06;
   const mask=1-smooth(.27,1.08,q);
   use=join(use,mask*(.79+.13*clumps));compaction=Math.max(compaction,mask*.8);churn=Math.max(churn,mask*.85);
  }
  for(const s of SHELTERS){
   const distance=segmentDistance(xx,zz,s.x-s.w/2+4,s.z+.7,s.x+s.w/2-4,s.z+.7);
   const mask=1-smooth(s.d/2-.9,s.d/2+3.2,distance+edge);
   use=join(use,mask*.998);dry=Math.max(dry,mask);compaction=Math.max(compaction,mask*.8);churn=Math.max(churn,mask*.65);
  }
  for(const f of feed){
   const distance=segmentDistance(xx,zz,f.x-f.length/2+.6,f.z-.9,f.x+f.length/2-.6,f.z-.9);
   const mask=1-smooth(2.6,5.2,distance+edge);
   use=join(use,mask*.999);compaction=Math.max(compaction,mask);churn=Math.max(churn,mask);
  }
  for(let wi=0;wi<water.length;wi++){
   const t=water[wi],inward=t.z<45?1:-1;
   // The apron itself is concrete. Damp earth occurs only just outside it,
   // strongest beside the drinking edges, then dissipates into the dry soil.
   for(const side of [-1,1]){
    // Each drinking edge has its own approach fan. The busy inward side merges
    // into the shared activity ground; there is no symmetric moat around a trough.
    const busy=side===inward,shift=(noise(wi*3.1+side,14)-.5)*3.1;
    const rx=t.length*(busy?.86:.65),rz=busy?6.5+wi*.3:3.2;
    const footfall=Math.hypot((x+warpX*.23-t.x-shift)/rx,(z+warpZ*.23-t.z-side*(busy?4.8:2.8))/rz)+edge*.05;
    const wear=(1-smooth(.12,1.15,footfall))*(busy?.93:.87);
    use=join(use,wear);compaction=Math.max(compaction,wear*.93);churn=Math.max(churn,wear);
    // Hooves repeatedly land beside both long edges. Keep this contact wear
    // aligned to the apron; only the wider approach fans wander into the grass.
    const contact=segmentDistance(x+warpX*.1,z+warpZ*.1,t.x-t.length*.38,t.z+side*2.8,t.x+t.length*.38,t.z+side*2.8);
    const standing=1-smooth(.55,2.15,contact+edge*.3);
    use=join(use,standing*.95);compaction=Math.max(compaction,standing*.96);churn=Math.max(churn,standing);
    const drift=(noise(x*.4+t.x,19)-.5)*.65;
    const q=Math.hypot((x-t.x+warpX*.23)/(t.length*.58),(z-t.z-side*(3.1+drift))/1.5);
    const splash=1-smooth(.18,1.15,q+edge*.12);
    wet=Math.max(wet,splash*(.43+.36*noise(x*.64+8,z*.64+31)));
   }
  }
  // Worn edges contain islands of turf, not a uniform translucent brown halo.
  const breakup=(clumps-.5)*.5+(noise(x*1.5+67,z*1.5+7)-.5)*.15;
  const bare=clamp(use+breakup*3.8*use*(1-use),0,1);
  const turfShade=(broad-.5)*20+(noise(x*.34,z*.34+17)-.5)*8;
  const turf=[91+turfShade,116+turfShade,53+turfShade*.55];
  const earthPatches=noise(x*.16+warpX*.1+13,z*.16+warpZ*.1+22);
  const variation=(noise(x*.053+13,z*.053)-.5)*.45+(earthPatches-.5)*.5+(noise(x*.74,z*.74+29)-.5)*.13;
  const shade=clamp(.6+variation+dry*.1-compaction*.09-rut*.16,0,1);
  wet=Math.max(wet,smooth(.59,.86,earthPatches)*churn*.22*(1-dry*.7));
  const index=(j*size+i)*channels;
  // 0..2 turf; 3 exposed soil; 4 moisture; 5 vegetation variation; 6 pressure;
  // 7 relief; 8 animal footprint region; 9 soil tone; 10 compaction.
  for(let c=0;c<3;c++)grid[index+c]=turf[c];
  grid[index+3]=bare;grid[index+4]=wet;grid[index+5]=broad;grid[index+6]=rut;
  grid[index+7]=-rut*.09-compaction*.012;
  grid[index+8]=x>PEN.left&&x<PEN.right&&z>PEN.back&&z<PEN.front?bare:0;
  grid[index+9]=shade;grid[index+10]=compaction;
 }
 function sample(x,z,out=[]){
  const xx=clamp((x/ISLAND.width+.5)*(size-1),0,size-1.001),zz=clamp((z/ISLAND.depth+.5)*(size-1),0,size-1.001);
  const ix=Math.floor(xx),iz=Math.floor(zz),u=xx-ix,v=zz-iz;
  const a=(iz*size+ix)*channels,b=a+channels,c=a+size*channels,d=c+channels;
  for(let k=0;k<channels;k++)out[k]=lerp(lerp(grid[a+k],grid[b+k],u),lerp(grid[c+k],grid[d+k],u),v);
  return out;
 }
 function elevation(x,z){
  const xx=clamp((x/ISLAND.width+.5)*(size-1),0,size-1.001),zz=clamp((z/ISLAND.depth+.5)*(size-1),0,size-1.001);
  const ix=Math.floor(xx),iz=Math.floor(zz),u=xx-ix,v=zz-iz;
  const a=(iz*size+ix)*channels,b=a+channels,c=a+size*channels;
  return lerp(lerp(grid[a+7],grid[b+7],u),lerp(grid[c+7],grid[c+channels+7],u),v);
 }
 const c=canvas(2048),ctx=c.getContext('2d'),pixels=ctx.createImageData(2048,2048),bump=ctx.createImageData(2048,2048),s=[];
 const zonePixels=new Uint8Array(size*size*4);
 for(let j=0;j<size;j++)for(let i=0;i<size;i++){
  const k=((size-1-j)*size+i)*4,g=(j*size+i)*channels;
  zonePixels[k]=grid[g+3]*255;zonePixels[k+1]=grid[g+9]*255;
  zonePixels[k+2]=grid[g+4]*255;zonePixels[k+3]=grid[g+10]*255;
 }
 const zoneMap=new T.DataTexture(zonePixels,size,size,T.RGBAFormat);
 zoneMap.magFilter=T.LinearFilter;zoneMap.minFilter=T.LinearMipmapLinearFilter;zoneMap.generateMipmaps=true;zoneMap.needsUpdate=true;
 for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++){
  const x=(i/(c.width-1)-.5)*ISLAND.width,z=(j/(c.height-1)-.5)*ISLAND.depth;
  sample(x,z,s);const k=(j*c.width+i)*4,grain=hash(i,j);
  for(let n=0;n<3;n++)pixels.data[k+n]=s[n]+(grain-.5)*16;
  pixels.data[k+3]=255;
  const h=128-s[6]*12+(grain-.5)*(3+6*(1-s[3]));
  bump.data[k]=bump.data[k+1]=bump.data[k+2]=h;bump.data[k+3]=255;
 }
 ctx.putImageData(pixels,0,0);const b=canvas(2048),bctx=b.getContext('2d');bctx.putImageData(bump,0,0);
 const marks=canvas(4096),markCtx=marks.getContext('2d');markCtx.fillStyle='#ffffff';markCtx.fillRect(0,0,marks.width,marks.height);
 function paint(context,x,z,angle,draw){
  const resolution=context.canvas.width;
  context.save();context.translate((x/ISLAND.width+.5)*resolution,(z/ISLAND.depth+.5)*resolution);context.scale(resolution/ISLAND.width,resolution/ISLAND.depth);context.rotate(angle);draw(context);context.restore();
 }
 // Sparse tread fragments on the pressure bands. Unequal, interrupted passes
 // leave evidence of tyres without drawing a pair of continuous dark borders.
 for(let ri=0;ri<vehiclePaths.length;ri++){
  const road=vehiclePaths[ri];let si=0;
  for(let along=3;along<road.length-3;along+=.47){
   while(si<road.segments.length-1&&along>road.segments[si].start+road.segments[si].len)si++;
   const seg=road.segments[si],t=(along-seg.start)/seg.len;
   const x=seg.x+t*seg.dx,z=seg.z+t*seg.dz,angle=Math.atan2(seg.dz,seg.dx);
   const drift=(noise(along*.08,63)-.5)*.68;
   for(const side of [-1,1]){
    const pressure=smooth(.4,.76,noise(along*.23,side*73+92));
    if(pressure<.45||hash(Math.floor(along*100),ri*19+side)<.27)continue;
    for(const context of [markCtx,bctx])paint(context,x,z,angle,q=>{
     q.translate(0,side+drift);q.rotate(side*.46);
     q.fillStyle=context===markCtx?`rgba(57,47,32,${pressure*.26})`:`rgba(61,61,61,${pressure*.24})`;
     q.fillRect(-.07,-.2,.14,.4);
    });
   }
  }
 }
 // Paired hoof impressions follow occupied ground; green margins are untouched.
 for(let i=0;i<14000;i++){
  const x=lerp(PEN.left+2,PEN.right-2,hash(i,251)),z=lerp(PEN.back+2,PEN.front-2,hash(i,417));
  sample(x,z,s);if(s[8]<.52||hash(i,523)>s[3]*s[10])continue;
  for(const context of [markCtx,bctx])paint(context,x,z,hash(i,19)*Math.PI*2,q=>{
   const strength=.16+hash(i,69)*.26;
   q.fillStyle=context===markCtx?`rgba(54,45,34,${strength})`:`rgba(65,65,65,${strength})`;
   for(const side of [-1,1]){q.beginPath();q.ellipse(side*.07,0,.052,.13,0,0,Math.PI*2);q.fill();}
  });
 }
 return{map:texture(c),bumpMap:texture(b,false),marks:texture(marks,false),zoneMap,sample,elevation,heightAt:(x,z)=>heightAt(x,z)+elevation(x,z)};
}

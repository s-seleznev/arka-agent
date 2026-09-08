import * as THREE from 'three';

const STEP=.085;
const palette={cream:'#e9dfce',black:'#33312f',pink:'#d09a8d',hoof:'#302d2a',horn:'#c8ab7f',clay:'#bba991'};
const colors=Object.fromEntries(Object.entries(palette).map(([k,v])=>[k,new THREE.Color(v)]));
const material=new THREE.MeshStandardMaterial({roughness:.86});
let layer=0;
const clayMaterial=new THREE.MeshStandardMaterial({color:palette.clay,roughness:.95});
const voxelGeometry=new THREE.BoxGeometry(STEP,STEP,STEP,3,3,3);
const pos=voxelGeometry.attributes.position;
for(let i=0;i<pos.count;i++){
 const p=new THREE.Vector3().fromBufferAttribute(pos,i),core=p.clone().clampScalar(-STEP*.46,STEP*.46);
 p.sub(core).normalize().multiplyScalar(STEP*.038).add(core);pos.setXYZ(i,p.x,p.y,p.z);
}
voxelGeometry.computeVertexNormals();

// Each solid is a CLOSED loft. Its cross-sections define the anatomy before
// sampling a single voxel. Head, cheeks, jaw and muzzle share one loft.
// Section: [axial coordinate, cross-section centre A/B, radius A/B].
function loft(axis,sections,power=3.6){
 const at=q=>{
  let i=1;while(i<sections.length-1&&q>sections[i][0])i++;
  const a=sections[i-1],b=sections[i],t=THREE.MathUtils.clamp((q-a[0])/(b[0]-a[0]),0,1);
  return a.map((v,j)=>j?v+(b[j]-v)*t:q);
 };
 const map=(q,a,b)=>axis==='x'?[q,a,b]:[a,q,b];
 const bounds=[new THREE.Vector3(Infinity,Infinity,Infinity),new THREE.Vector3(-Infinity,-Infinity,-Infinity)];
 for(const s of sections)for(const u of [-1,1])for(const v of [-1,1]){
  const p=new THREE.Vector3(...map(s[0],s[1]+u*s[3],s[2]+v*s[4]));bounds[0].min(p);bounds[1].max(p);
 }
 return {axis,sections,power,at,map,bounds,contains(x,y,z){
  const q=axis==='x'?x:y;
  if(q<sections[0][0]||q>sections.at(-1)[0])return false;
  const s=at(q),a=axis==='x'?y:x;
  return (Math.abs((a-s[1])/s[3])**power+Math.abs((z-s[2])/s[4])**power)<=1;
 }};
}
function smoothGeometry(solid){
 const vertices=[],indices=[],rings=70,sides=48;
 const lo=solid.sections[0][0],hi=solid.sections.at(-1)[0];
 for(let i=0;i<=rings;i++){
  const s=solid.at(lo+(hi-lo)*i/rings);
  for(let j=0;j<sides;j++){
   const a=j/sides*Math.PI*2,c=Math.cos(a),n=Math.sin(a);
   vertices.push(...solid.map(s[0],s[1]+Math.sign(c)*Math.abs(c)**(2/solid.power)*s[3],s[2]+Math.sign(n)*Math.abs(n)**(2/solid.power)*s[4]));
  }
 }
 for(let i=0;i<rings;i++)for(let j=0;j<sides;j++){
  const a=i*sides+j,b=i*sides+(j+1)%sides,c=a+sides,d=b+sides;
  if(solid.axis==='x')indices.push(a,b,c,b,d,c);else indices.push(a,c,b,b,c,d);
 }
 for(const [ring,reverse] of [[0,true],[rings,false]]){
  const s=solid.at(ring===0?lo:hi),centre=vertices.length/3;vertices.push(...solid.map(s[0],s[1],s[2]));
  for(let j=0;j<sides;j++){
   const a=ring*sides+j,b=ring*sides+(j+1)%sides;
   if(reverse===(solid.axis==='x'))indices.push(centre,b,a);else indices.push(centre,a,b);
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function volume(parent,solid,colorFn,pivot=new THREE.Vector3()){
 const assembly=new THREE.Group();parent.add(assembly);
 const smooth=new THREE.Mesh(smoothGeometry(solid),clayMaterial);
 smooth.position.copy(pivot).negate();smooth.castShadow=true;smooth.receiveShadow=true;smooth.visible=false;assembly.add(smooth);
 const cells=[];const [a,b]=solid.bounds;
 for(let x=Math.ceil(a.x/STEP);x<=Math.floor(b.x/STEP);x++)
 for(let y=Math.ceil(a.y/STEP);y<=Math.floor(b.y/STEP);y++)
 for(let z=Math.ceil(a.z/STEP);z<=Math.floor(b.z/STEP);z++)
 if(solid.contains(x*STEP,y*STEP,z*STEP))cells.push([x,y,z]);
 const filled=new Set(cells.map(v=>v.join(',')));
 const surface=cells.filter(([x,y,z])=>[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([a,b,c])=>!filled.has([x+a,y+b,z+c].join(','))));
 const localMaterial=material.clone();
 // Stable depth ordering where animated volumes overlap at the joints.
 localMaterial.polygonOffset=true;localMaterial.polygonOffsetFactor=0;localMaterial.polygonOffsetUnits=++layer*2;
 const voxels=new THREE.InstancedMesh(voxelGeometry,localMaterial,surface.length),matrix=new THREE.Matrix4(),tint=new THREE.Color();
 surface.forEach(([ix,iy,iz],i)=>{
  const x=ix*STEP,y=iy*STEP,z=iz*STEP;
  matrix.makeTranslation(x-pivot.x,y-pivot.y,z-pivot.z);voxels.setMatrixAt(i,matrix);
  tint.copy(colors[colorFn(x,y,z)]);tint.multiplyScalar(.99+.025*Math.abs(Math.sin(ix*7.23+iy*4.12+iz*9.18)));voxels.setColorAt(i,tint);
 });
 voxels.castShadow=true;voxels.receiveShadow=true;assembly.add(voxels);
 assembly.userData={smooth,voxels};return assembly;
}
function box(parent,size,position,color){
 const geometry=voxelGeometry.clone();geometry.scale(size[0]/STEP,size[1]/STEP,size[2]/STEP);
 const m=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.9}));m.position.set(...position);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function bodyPaint(x,y,z){
 const wave=.045*Math.sin(y*15+z*9);
 if(((x+.95+wave)/.47)**2+((y-2.05)/.57)**2<1)return 'black';
 if(((x-.1+wave)/.48)**2+((y-2.3)/.5)**2+((z-.12)/1.5)**2<1)return 'black';
 if(((x-.78)/.34)**2+((y-1.65)/.5)**2<1)return 'black';
 return 'cream';
}
export function createCow(){
 const root=new THREE.Group(),torso=new THREE.Group();root.add(torso);
 const volumes=[],details=[];
 const body=loft('x',[
  [-1.5,1.75,0,.15,.22],[-1.36,1.77,0,.51,.51],[-1.08,1.74,0,.64,.58],
  [-.6,1.71,0,.67,.63],[0,1.73,0,.65,.62],[.55,1.77,0,.61,.54],
  [.92,1.76,0,.54,.47],[1.1,1.73,0,.34,.33],[1.17,1.73,0,.12,.18]
 ],3.7);
 volumes.push(volume(torso,body,bodyPaint));
 const legs=[];
 for(const [x,z] of [[.72,-.39],[.72,.39],[-1.03,-.4],[-1.03,.4]]){
  const pivot=new THREE.Vector3(x,1.18,z),hip=new THREE.Group();hip.position.copy(pivot);root.add(hip);
  const front=x>0,dir=front?1:-1;
  const shape=loft('y',[
   [.16,x+.035,z,.105,.12],[.28,x,z,.082,.082],[.48,x-dir*.035,z,.07,.078],
   [.67,x-dir*.025,z,.09,.09],[.76,x+dir*.02,z,.13,.12],
   [.9,x+dir*.025,z,.14,.13],[1.17,x,z,.19,.19],[1.42,x-dir*.025,z,.225,.22],[1.57,x-dir*.02,z,.15,.16]
  ],3.7);
  volumes.push(volume(hip,shape,()=> 'cream',pivot));
  const hoofShape=loft('y',[[.045,x+.035,z,.14,.14],[.19,x+.035,z,.14,.14],[.25,x+.015,z,.11,.12]],5);
  volumes.push(volume(hip,hoofShape,()=> 'hoof',pivot));
  const toe=box(hip,[.02,.055,.14],[.035+.14,.065-pivot.y,0], '#201e1d');details.push(toe);
  legs.push({hip,x,z});
 }
 const headPivot=new THREE.Vector3(.7,1.8,0),head=new THREE.Group();head.position.copy(headPivot);torso.add(head);
 const face=loft('x',[
  [.47,1.83,0,.4,.35],[.7,1.83,0,.49,.43],[.98,1.86,0,.49,.43],
  [1.21,1.86,0,.46,.385],[1.39,1.74,0,.39,.35],
  [1.58,1.59,0,.29,.305],[1.76,1.48,0,.22,.31],
  [1.94,1.465,0,.205,.35],[2.08,1.465,0,.185,.33]
 ],4.2);
 volumes.push(volume(head,face,(x,y,z)=>{
  if(x>1.81)return 'pink';
  if(x>1.67)return 'cream';
  if(y<1.32)return 'cream';
  const blaze=.15+Math.max(0,y-1.8)*.16;
  if(Math.abs(z)<blaze&&y>1.57)return 'cream';
  return 'black';
 },headPivot));
 const local=(x,y,z)=>[x-headPivot.x,y-headPivot.y,z];
 const blinkCovers=[],ears=[];
 for(const sign of [-1,1]){
  // The eyes sit on the skull; the jaw beneath them stays filled to the muzzle.
  const eye=box(head,[.115,.13,.045],local(1.37,1.945,sign*.34),'#171615');details.push(eye);
  const glint=box(head,[.031,.032,.012],local(1.398,1.972,sign*.365),'#c9c0ac');details.push(glint);
  const lid=box(head,[.12,.135,.013],local(1.37,1.945,sign*.369),'#33312f');lid.visible=false;blinkCovers.push(lid);details.push(lid);
  // Small dark recesses in the broad pink front plane.
  const nostril=box(head,[.011,.082,.088],local(2.079,1.49,sign*.21),'#80554b');details.push(nostril);
  const ear=new THREE.Group();ear.position.set(1-headPivot.x,2.21-headPivot.y,sign*.37);head.add(ear);ears.push(ear);
  const earSolid=loft('x',[[-.11,0,sign*.08,.035,.07],[-.04,0,sign*.15,.11,.2],[.1,0,sign*.15,.095,.19],[.15,0,sign*.15,.065,.13]],4);
  volumes.push(volume(ear,earSolid,()=> 'black'));
  details.push(box(ear,[.014,.105,.15],[.154,0,sign*.16],palette.pink));
  const horn=new THREE.Group();horn.position.set(.98-headPivot.x,2.27-headPivot.y,sign*.24);head.add(horn);
  const hornSolid=loft('y',[[0,0,0,.077,.075],[.12,-.01,sign*.035,.072,.06],[.29,-.035,sign*.08,.045,.043]],4.5);
  volumes.push(volume(horn,hornSolid,()=> 'horn'));
 }
 const udder=loft('x',[[-1.04,1.025,0,.07,.11],[-.85,.99,0,.15,.28],[-.53,.99,0,.16,.27],[-.36,1.02,0,.09,.16]],3.5);
 volumes.push(volume(torso,udder,()=> 'pink'));
 for(const x of [-.85,-.54])for(const z of [-.16,.16]){
  const teat=loft('y',[[.67,x,z,.037,.037],[.86,x,z,.05,.048],[.96,x,z,.06,.06]],4);
  volumes.push(volume(torso,teat,()=> 'pink'));
 }
 const tail=new THREE.Group();tail.position.set(-1.44,2.08,0);torso.add(tail);
 const tailSolid=loft('y',[[-.91,-.075,0,.065,.06],[-.58,-.09,0,.047,.045],[-.18,-.03,0,.045,.045],[0,0,0,.07,.065]],4);
 volumes.push(volume(tail,tailSolid,()=> 'cream'));
 const tuft=loft('y',[[-1.17,-.1,0,.035,.05],[-1.08,-.1,0,.12,.105],[-.85,-.07,0,.1,.1],[-.77,-.07,0,.06,.06]],4);
 volumes.push(volume(tail,tuft,()=> 'black'));
 const cow={root,torso,head,tail,ears,legs,blinkCovers,volumes,details,clay:false};
 cow.setClay=on=>{
  cow.clay=on;
  volumes.forEach(v=>{v.userData.smooth.visible=on;v.userData.voxels.visible=!on;});
  details.forEach(m=>{m.visible=!on;});blinkCovers.forEach(m=>{m.visible=false;});
 };
 return cow;
}
export function poseCow(cow,t,walk,graze,distance){
 const gait=distance*10;
 cow.torso.position.y=Math.sin(gait*2)*.004*walk;
 cow.legs.forEach((leg,i)=>{
  const phase=gait+[0,Math.PI,Math.PI*.72,Math.PI*1.72][i];
  leg.hip.rotation.z=Math.sin(phase)*.17*walk;
  leg.hip.position.y=1.18+Math.max(0,Math.cos(phase))*.025*walk;
 });
 // The entire face is rigid; the broad overlapping neck root is its only hinge.
 cow.head.rotation.z=-graze*.98+Math.sin(t*.9)*.009+Math.sin(t*4.5)*.007*graze;
 cow.head.position.y=1.8-graze*.34;
 cow.head.rotation.y=Math.sin(t*.44)*.035*(1-graze*.75);
 cow.tail.rotation.x=Math.sin(t*1.4)*.16;
 cow.tail.rotation.z=.05+Math.sin(t*.7)*.025;
 cow.ears.forEach((ear,i)=>{ear.rotation.x=Math.pow(Math.max(0,Math.sin(t*.95+i*2)),24)*.16;});
 cow.blinkCovers.forEach(m=>{m.visible=!cow.clay&&t%7.1>6.93;});
}

// Shared plan in metres. The entrance is on the south (+z) side.
export const FIELD={width:225,depth:162};
export const ISLAND={width:255,depth:192,radius:5,bottom:-17.2};
export const YARD={left:47.5,right:FIELD.width/2,back:16,front:FIELD.depth/2};
export const PEN={left:-70,right:YARD.left,back:16,front:FIELD.depth/2};
export const inPen=(x,z)=>x>PEN.left&&x<PEN.right&&z>PEN.back&&z<PEN.front;
export const BUILDINGS=[
 {id:'main',kind:'cattle-barn',x:76,z:35,w:34,d:16,h:5.4,overhang:.8,door:{x:76,z:43}},
 {id:'hay',kind:'hay-store',x:106,z:63,w:10,d:23,h:4.9,overhang:.75,door:{x:101,z:63}},
 {id:'workshop',kind:'workshop',x:60,z:69,w:17,d:12,h:3.6,overhang:.55,door:{x:68.5,z:69}}
];
export const TOWER={x:107,z:35,w:8,d:9};
export const SHELTER_MODULE={w:20,d:12,h:4.4};
export const SHELTERS=[-40,-18,4].map((x,i)=>({id:'shelter-'+i,x,z:44,...SHELTER_MODULE}));
export const TROUGHS=[
 ...SHELTERS.map(s=>({id:'feed-'+s.id,x:s.x,z:s.z+s.d/2+4.2,length:s.w-2,type:'feed',sides:[-1]})),
 // Four drinking bays along the north/south fences, clear of gate approaches,
 // the shelter aisle and the delivery/turning tracks. Both long sides stay accessible.
 {id:'water-north-west',x:-30,z:24,length:7.2,type:'water',sides:[-1,1]},
 {id:'water-north-east',x:4,z:24,length:7.2,type:'water',sides:[-1,1]},
 {id:'water-south-west',x:-30,z:74,length:7.2,type:'water',sides:[-1,1]},
 {id:'water-south-east',x:10,z:74,length:7.2,type:'water',sides:[-1,1]}
];
export const GATES=[
 {id:'entry',a:[78,81],b:[88,81],open:true,openTo:[0,-1]},
 {id:'service',a:[YARD.left,51],b:[YARD.left,57],open:false},
 {id:'meadow-west',a:[-56,PEN.back],b:[-46,PEN.back],open:true,openTo:[0,1]},
 {id:'meadow-east',a:[23,PEN.back],b:[33,PEN.back],open:true,openTo:[0,1]},
 {id:'meadow-side',a:[PEN.left,52],b:[PEN.left,62],open:true,openTo:[1,0]}
];
export function gateLeaves(g){
 if(!g.open)return[[g.a,g.b]];
 const length=Math.min(4.7,(Math.hypot(g.b[0]-g.a[0],g.b[1]-g.a[1])-.6)/2);
 return[g.a,g.b].map(p=>[p,[p[0]+g.openTo[0]*length,p[1]+g.openTo[1]*length]]);
}
const hx=FIELD.width/2,hz=FIELD.depth/2;
export const PEN_FENCES=[
 [[PEN.left,PEN.back],[-56,PEN.back]],[[-46,PEN.back],[23,PEN.back]],[[33,PEN.back],[PEN.right,PEN.back]],
 [[PEN.left,PEN.back],[PEN.left,52]],[[PEN.left,62],[PEN.left,PEN.front]]
];
export const FENCES=[
 [[-hx,-hz],[hx,-hz]],[[-hx,-hz],[-hx,hz]],[[hx,-hz],[hx,hz]],
 [[-hx,hz],[78,hz]],[[88,hz],[hx,hz]],
 [[YARD.left,YARD.back],[YARD.left,51]],[[YARD.left,57],[YARD.left,hz]],
 [[YARD.left,YARD.back],[hx,YARD.back]],...PEN_FENCES
];
export const SERVICE_AREAS=[{x:(YARD.left+YARD.right)/2,z:(YARD.back+YARD.front)/2,w:YARD.right-YARD.left,d:YARD.front-YARD.back}];
export function roundPath(points,radius=4,closed=false){
 if(closed)points=[points[points.length-1],...points,points[0]];
 const result=closed?[]:[points[0]];
 for(let i=1;i<points.length-1;i++){
  const a=points[i-1],b=points[i],c=points[i+1],ab=Math.hypot(b[0]-a[0],b[1]-a[1]),bc=Math.hypot(c[0]-b[0],c[1]-b[1]);
  if(ab<.01||bc<.01)continue;
  const r=Math.min(radius,ab*.4,bc*.4),start=[b[0]+(a[0]-b[0])*r/ab,b[1]+(a[1]-b[1])*r/ab],end=[b[0]+(c[0]-b[0])*r/bc,b[1]+(c[1]-b[1])*r/bc];
  result.push(start);
  for(let k=1;k<=5;k++){const t=k/5,u=1-t;result.push([u*u*start[0]+2*u*t*b[0]+t*t*end[0],u*u*start[1]+2*u*t*b[1]+t*t*end[1]]);}
 }
 if(!closed)result.push(points[points.length-1]);
 return result.filter((p,i)=>!i||Math.hypot(p[0]-result[i-1][0],p[1]-result[i-1][1])>.02);
}
export const ROADS=[
 {id:'entry',width:3,points:[[83,ISLAND.depth/2+2],[83,81],[82,66],[77,57],[61,55],[47.5,54]]},
 {id:'feed-delivery',width:2.65,points:[[47.5,54],[37,56],[25,59.5],[-38,59.5],[-51,61]]},
 // Branches terminate at actual doors. The unused backs of buildings stay green.
 {id:'barn-access',width:2.8,points:[[80,60],[77,54],[76,48],[76,42.5]]},
 {id:'hay-access',width:2.5,points:[[82,67],[91,64],[101.2,63]]},
 {id:'workshop-access',width:1.4,points:[[82,72],[77,70],[68.3,69]]}
].map(p=>({...p,points:roundPath(p.points,8)}));
export const CATTLE_PATHS=[
 {id:'grove-west-gate',width:.72,points:[[-73,-31],[-61,-15],[-53,3],[-51,12],[-51,23]]},
 {id:'north-east-gate',width:.72,points:[[54,-33],[42,-16],[30,1],[28,12],[28,23]]},
 {id:'east-east-gate',width:.64,points:[[88,-9],[67,0],[45,6],[28,12],[28,23]]},
 {id:'west-side-gate',width:.7,points:[[-95,47],[-84,51],[-75,57],[-65,57],[-58,53]]},
 {id:'left-water',width:.6,points:[[-51,23],[-43,28],[-33,28]]},
 {id:'left-rest',width:.65,points:[[-51,23],[-42,32],[-21,32],[19,32],[22,43],[20,52],[10,52]]},
 {id:'right-water',width:.6,points:[[28,23],[20,29],[7,28]]},
 {id:'right-rest',width:.65,points:[[28,23],[22,32],[21,41],[20,52],[10,52]]},
 {id:'west-rest',width:.65,points:[[-65,57],[-59,55],[-53,52],[-46,52]]},
 {id:'south-west-water',width:.6,points:[[-53,52],[-57,60],[-50,73],[-36,71]]},
 {id:'south-east-water',width:.6,points:[[20,52],[24,64],[18,70],[13,71]]}
].map(p=>({...p,points:roundPath(p.points,4)}));
export const TREES=[
 [-94,-59,11,5.3,0],[-84,-66,14,5.6,1],[-73,-63,12,5.4,2],[-62,-59,11,5,0],
 [-101,-48,10,4.6,2],[-91,-47,13,5.8,1],[-81,-53,15,6,0],[-73,-47,13,5.8,2],
 [-64,-48,12,5.5,1],[-54,-49,10,4.6,0],[-97,-37,11,4.9,0],[-85,-38,13,5.7,1],
 [-77,-35,11,5.2,2],[-67,-36,10,4.8,0],[-87,-28,9,4.3,2],[-58,-30,9,4.4,0],
 [-102,58,10,4.8,2],[-95,64,8,3.8,0],[93,-68,10,4.8,1],[101,-60,8,3.8,2],
 [-119,-68,9,3.8,1],[-119,39,8,4.1,2],[-88,88,8,4,0],[120,-71,9,3.5,1],[120,49,9,4,2]
];
export const GRAZING_AREAS=[
 {x:-86,z:-34,r:15},{x:-47,z:-60,r:19},{x:-19,z:-26,r:23},{x:28,z:-61,r:17},
 {x:87,z:-38,r:14},{x:26,z:-9,r:18},{x:-91,z:18,r:12},{x:-91,z:53,r:12},
 {x:76,z:-3,r:15},{x:-25,z:-3,r:13}
];
export const FLAT_AREAS=[...BUILDINGS,...SHELTERS,TOWER,...TROUGHS.map(t=>({x:t.x,z:t.z,w:t.length+5,d:8})),...SERVICE_AREAS,
 {x:(PEN.left+PEN.right)/2,z:(PEN.back+PEN.front)/2,w:PEN.right-PEN.left,d:PEN.front-PEN.back}];
export const groundPads=[
 ...TROUGHS.map(t=>({x:t.x,z:t.z,w:t.length+7,d:t.type==='feed'?9:10,type:t.type,feather:1.2,strength:.98})),
 ...SHELTERS.map(s=>({x:s.x,z:s.z+2,w:s.w+2,d:s.d+3,feather:1.2,strength:.97})),
 ...GATES.filter(g=>g.id.startsWith('meadow')).map(g=>({x:(g.a[0]+g.b[0])/2,z:(g.a[1]+g.b[1])/2,w:9,d:13,type:'gate',direction:g.openTo,feather:1,strength:.88}))
];
export function random(seed=41){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function heightAt(x,z){
 const mound=(cx,cz,w,d,h)=>h*Math.exp(-Math.pow((x-cx)/w,2)-Math.pow((z-cz)/d,2));
 let h=mound(-38,16,31,34,1.85)+mound(-87,-42,25,27,1.2)+mound(18,48,24,24,.9)-mound(-3,-12,23,22,.25);
 h+=(Math.sin(x*.055+z*.032)*Math.sin(z*.075-x*.017))*.16;
 h*=smooth(0,10,Math.min(ISLAND.width/2-Math.abs(x),ISLAND.depth/2-Math.abs(z)));
 for(const r of FLAT_AREAS)h*=smooth(0,7,Math.max(Math.abs(x-r.x)-r.w/2-1,Math.abs(z-r.z)-r.d/2-1));
 return h;
}

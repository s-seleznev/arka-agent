import {GRAZING_AREAS} from './layout.js';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const angle=x=>Math.atan2(Math.sin(x),Math.cos(x));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const moving=new Set(['walk','grazeStep','backOut','yieldBack']);

// Behaviour time is compressed for a browser diorama. Locomotion and the
// transitions into/out of lying still run at their own physical speed.
export function createBehavior(world,nav,rng,clips,count){
 const animals=[],stations=world.stations,groups=GRAZING_AREAS;
 const limitX=world.field.width/2-2.6,limitZ=world.field.depth/2-2.6;
 const grid=new Map(),cell=5,surface=[];
 let time=0;
 const totals={grazeSteps:0,drinks:0,feeds:0,rests:0,detours:0,stationChanges:0};
 const rand=(a,b)=>lerp(a,b,rng());
 const key=(x,z)=>Math.floor(x/cell)+','+Math.floor(z/cell);
 function rebuildGrid(){
  grid.clear();for(const c of animals){if(c.filteredOut)continue;const k=key(c.x,c.z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(c);}
 }
 function neighbors(c){
  const result=[],gx=Math.floor(c.x/cell),gz=Math.floor(c.z/cell);
  for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)for(const other of grid.get((gx+x)+','+(gz+z))||[])if(other!==c)result.push(other);
  return result;
 }
 function valid(p){return Math.abs(p.x)<limitX&&Math.abs(p.z)<limitZ&&!nav.inside(p.x,p.z);}
 function vacant(p,self=null,space=2.9){return valid(p)&&!animals.some(c=>!c.filteredOut&&c!==self&&distance(p,c)<space);}
 function meadow(p){return valid(p)&&!world.inPen(p.x,p.z)&&world.terrain.sample(p.x,p.z,surface)[3]<.48;}
 function freePoint(near,self=null,spread=18,grassOnly=false){
  for(let i=0;i<180;i++){
   const a=rand(0,Math.PI*2),r=Math.sqrt(rng())*spread;
   const p=near?{x:near.x+Math.cos(a)*r,z:near.z+Math.sin(a)*r}:{x:rand(-limitX,limitX),z:rand(-limitZ,limitZ)};
   if(vacant(p,self)&&(grassOnly?meadow(p):true))return p;
  }
  return null;
 }
 function shadePoint(c,areas=world.shadeAreas){
  const candidates=areas.slice().sort((a,b)=>distance(c,a)-distance(c,b));
  // In open pasture a comfortable patch of grass is also a resting place.
  // Do not send every satiated cow on a long trip to a roof or a tree.
  if(areas===world.shadeAreas&&meadow(c)&&distance(c,candidates[0])>16){
   const p=freePoint(c,c,4,true);
   if(p&&!animals.some(o=>o!==c&&o.intent==='rest'&&o.destination&&distance(o.destination,p)<3.15))return p;
  }
  for(const r of candidates.slice(0,8))for(let i=0;i<24;i++){
   const p={x:r.x+rand(-.5,.5)*r.w,z:r.z+rand(-.5,.5)*r.d};
   const inFeedingAisle=stations.some(s=>s.type==='feed'&&Math.abs(p.x-s.x)<2.5&&Math.abs(p.z-s.z)<6);
   const promised=animals.some(o=>o!==c&&o.intent==='rest'&&o.destination&&distance(o.destination,p)<3.15);
   if(!inFeedingAisle&&!promised&&vacant(p,c,3.15))return p;
  }
  return null;
 }
 function buddyCenter(c){
  let x=0,z=0,n=0;
  for(const id of c.buddies){const b=animals[id];if(!b||b.intent!=='graze'||world.inPen(b.x,b.z)||distance(c,b)>75)continue;x+=b.x;z+=b.z;n++;}
  return n?{x:x/n,z:z/n}:groups[c.group];
 }
 function grazingTarget(c){
  const home=buddyCenter(c),near=world.inPen(c.x,c.z)||distance(c,home)>22?home:c;
  return freePoint(near,c,near===c?rand(5,10):groups[c.group].r*.7,true)||freePoint(groups[c.group],c,groups[c.group].r,true);
 }
 function roundRoute(from,points){
  const all=[from,...points],result=[];
  for(let i=1;i<all.length-1;i++){
   const a=all[i-1],b=all[i],d=all[i+1],ab=distance(a,b),bd=distance(b,d);
   const r=Math.min(1.1,ab*.3,bd*.3);
   const entry={x:b.x+(a.x-b.x)*r/ab,z:b.z+(a.z-b.z)*r/ab};
   const exit={x:b.x+(d.x-b.x)*r/bd,z:b.z+(d.z-b.z)*r/bd};
   const arc=[entry];for(let k=1;k<=4;k++){const t=k/4,u=1-t;arc.push({x:u*u*entry.x+2*u*t*b.x+t*t*exit.x,z:u*u*entry.z+2*u*t*b.z+t*t*exit.z});}
   let prev=result[result.length-1]||from;
   if(arc.every(p=>{const clear=nav.clear(prev,p);prev=p;return clear;}))result.push(...arc);else result.push(b);
  }
  if(points.length)result.push(points[points.length-1]);
  return result;
 }
 function release(c){
  if(c.station){if(c.station.occupied===c.id)c.station.occupied=null;if(c.station.reservedBy===c.id)c.station.reservedBy=null;}
  c.station=null;
 }
 function available(s,c){return(s.occupied===null||s.occupied===c.id)&&(s.reservedBy==null||s.reservedBy===c.id||s.reserveUntil<time);}
 function approach(s){
  const length=s.type==='water'?2.2:4.4;
  return{x:s.x-Math.cos(s.yaw)*length,z:s.z+Math.sin(s.yaw)*length};
 }
 function stationRoute(c,s){
  const a=approach(s);if(!valid(a)||!nav.clear(a,s))return[];
  const points=nav.route(c,a,true);return points.length?[...roundRoute(c,points),{x:s.x,z:s.z}]:[];
 }
 function reserve(c){
  const s=c.station;if(!s||!available(s,c))return false;
  // A cow crossing the field does not lock an empty drinking place for minutes.
  if(distance(c,s)<14){s.reservedBy=c.id;s.reserveUntil=time+36;}
  return true;
 }
 function findStation(c,type,skip=null){
  const traffic=s=>animals.filter(o=>o!==c&&o.station===s).length*18;
  const candidates=stations.filter(s=>s.type===type&&s!==skip&&available(s,c))
   .sort((a,b)=>distance(c,a)+traffic(a)-distance(c,b)-traffic(b));
  for(const s of candidates.slice(0,10)){
   if(animals.some(o=>o!==c&&distance(o,s)<1.8&&o.station!==s))continue;
   const route=stationRoute(c,s);if(!route.length)continue;
   release(c);c.station=s;c.route=route;c.destination={x:s.x,z:s.z};c.arrival='station';c.state='walk';c.intent=type;
   c.blockedFor=0;c.replanAt=time+6;reserve(c);return true;
  }
  return false;
 }
 function idle(c,seconds=rand(4,10)){c.state='idle';c.until=time+seconds;c.speed=0;c.actualSpeed=0;c.route=[];}
 function graze(c,newBout=false){
  if(!meadow(c)){idle(c);return;}
  c.intent='graze';c.state='graze';c.until=time+rand(7,19);c.speed=0;c.actualSpeed=0;c.route=[];
  if(newBout){c.boutUntil=time+rand(110,220);c.activityStart=time;}
 }
 function travel(c,p,arrival,intent){
  if(!p)return false;const path=nav.route(c,p,arrival!=='graze');if(!path.length)return false;
  c.route=roundRoute(c,path);c.destination={...p};c.arrival=arrival;c.intent=intent;c.state='walk';c.blockedFor=0;c.replanAt=time+6;return true;
 }
 function choose(c){
  const rhythm=Math.sin(time/180+c.group*.19)*.055;
  const thirsty=c.thirst*.99,hungry=c.hunger*.88,fatigued=c.fatigue*.94+rhythm+(c.hunger<.25?.16:0);
  if(thirsty>.64&&thirsty>Math.max(hungry,fatigued)-.08){
   c.intent='water';if(findStation(c,'water'))return;idle(c,rand(3,6));return;
  }
  if(fatigued>.66&&fatigued>hungry-.02){
   c.intent='rest';const p=shadePoint(c);
   if(p&&travel(c,p,'rest','rest'))return;
   if(vacant(c,c,2.65)){c.state='lieDown';c.until=time+clips.LieDown.duration;c.activityStart=time;return;}
  }
  if(hungry>.4){
   const feedDistance=Math.min(...stations.filter(s=>s.type==='feed').map(s=>distance(c,s)));
   if(world.inPen(c.x,c.z)||feedDistance<38&&c.feedPreference>.5||c.hunger>.88&&c.feedPreference>.65){
    if(findStation(c,'feed'))return;
   }
  }
  if(c.hunger<.2&&!world.inPen(c.x,c.z)){c.intent='idle';idle(c,rand(35,65));return;}
  if(meadow(c)&&distance(c,buddyCenter(c))<27){graze(c,true);return;}
  if(travel(c,grazingTarget(c),'graze','graze'))return;
  idle(c,rand(6,12));
 }
 function grazeStep(c){
  const buddies=buddyCenter(c),toward=Math.atan2(-(buddies.z-c.z),buddies.x-c.x);
  const bias=distance(c,buddies)>8?clamp(angle(toward-c.yaw),-.55,.55)*c.sociability:0;
  for(let i=0;i<9;i++){
   const yaw=c.yaw+bias+rand(-.42,.42),step=rand(.65,1.6),p={x:c.x+Math.cos(yaw)*step,z:c.z-Math.sin(yaw)*step};
   if(meadow(p)&&vacant(p,c,2.25)&&nav.clear(c,p)){
    c.state='grazeStep';c.route=[p];c.destination=p;c.arrival='bite';c.blockedFor=0;c.replanAt=time+5;totals.grazeSteps++;return;
   }
  }
  c.state='look';c.until=time+rand(2,5);
 }
 function beginLeaving(c){c.state='stationRaise';c.until=time+1.4;c.speed=0;}
 function backOut(c){
  const s=c.station;if(!s){idle(c,2);return;}
  c.state='backOut';c.arrival='leave';
  c.destination={x:c.x-Math.cos(c.yaw)*1.45,z:c.z+Math.sin(c.yaw)*1.45};
  c.route=[c.destination];c.blockedFor=0;c.replanAt=time+8;
 }
 function arrived(c){
  c.speed=0;c.actualSpeed=0;c.route=[];
  if(c.arrival==='station'){
   if(!reserve(c)){if(!findStation(c,c.intent,c.station))idle(c,3);return;}
   c.station.occupied=c.id;c.state='stationAlign';c.until=time+1.35;c.activityStart=time;
  }else if(c.arrival==='rest'){
   c.state='lieDown';c.until=time+clips.LieDown.duration;c.activityStart=time;
  }else if(c.arrival==='leave'){release(c);idle(c,rand(2,5));}
  else if(c.arrival==='gather'){c.state='graze';c.intent='gather';c.until=time+rand(9,18);}
  else if(c.arrival==='resume'){
   const saved=c.savedTravel;c.savedTravel=null;Object.assign(c,saved);c.state='walk';c.blockedFor=0;c.waitUntil=time+rand(.6,1.1);
  }
  else graze(c,c.arrival==='graze');
 }
 // Rounded capsules approximate the torso, instead of treating an elongated
 // animal as a large circle that blocks an entire aisle.
 function pointSegment(px,pz,ax,az,bx,bz){const dx=bx-ax,dz=bz-az,t=clamp(((px-ax)*dx+(pz-az)*dz)/(dx*dx+dz*dz||1));return Math.hypot(px-ax-dx*t,pz-az-dz*t);}
 function bodyDistance(a,b,x=a.x,z=a.z,yaw=a.yaw){
  const al=.66*a.scale,bl=.66*b.scale,ac=Math.cos(yaw)*al,as=-Math.sin(yaw)*al,bc=Math.cos(b.yaw)*bl,bs=-Math.sin(b.yaw)*bl;
  const ax=x-ac,az=z-as,ay=x+ac,aw=z+as,bx=b.x-bc,bz=b.z-bs,by=b.x+bc,bw=b.z+bs;
  const cross=(ux,uz,vx,vz)=>ux*vz-uz*vx;
  const u=cross(ay-ax,aw-az,bx-ax,bz-az),v=cross(ay-ax,aw-az,by-ax,bw-az);
  const w=cross(by-bx,bw-bz,ax-bx,az-bz),q=cross(by-bx,bw-bz,ay-bx,aw-bz);
  if(u*v<0&&w*q<0)return 0;
  return Math.min(pointSegment(ax,az,bx,bz,by,bw),pointSegment(ay,aw,bx,bz,by,bw),pointSegment(bx,bz,ax,az,ay,aw),pointSegment(by,bw,ax,az,ay,aw));
 }
 const staticCells=new Map();
 function localBypass(c){
  // Replan a short part of the route around actual animals, not just buildings.
  // Steering alone cannot resolve a ring of mutually yielding cattle.
  let end=c.arrival==='gather'?c.route.length-1:c.route.findIndex(p=>distance(c,p)>8);if(end<0)end=c.route.length-1;
  if(end<0)return false;
  const goal=c.route[end],unit=c.arrival==='gather'?1.1:.8,sx=Math.round(c.x/unit),sz=Math.round(c.z/unit),ex=Math.round(goal.x/unit),ez=Math.round(goal.z/unit);
  const minX=Math.min(sx,ex)-12,maxX=Math.max(sx,ex)+12,minZ=Math.min(sz,ez)-12,maxZ=Math.max(sz,ez)+12;
  const nearby=animals.filter(o=>!o.filteredOut&&o!==c&&o.x>minX*unit-3&&o.x<maxX*unit+3&&o.z>minZ*unit-3&&o.z<maxZ*unit+3);
  const dynamic=new Map(),id=(x,z)=>x+','+z;
  function free(x,z){
   if(x<minX||x>maxX||z<minZ||z>maxZ)return false;
   const k=id(x,z),staticKey=unit+':'+k,p={x:x*unit,z:z*unit};
   if(!staticCells.has(staticKey))staticCells.set(staticKey,valid(p));
   if(!staticCells.get(staticKey))return false;
   if(!dynamic.has(k))dynamic.set(k,!nearby.some(o=>{
    const ox=Math.cos(o.yaw)*.66*o.scale,oz=-Math.sin(o.yaw)*.66*o.scale;
    const d=pointSegment(p.x,p.z,o.x-ox,o.z-oz,o.x+ox,o.z+oz);
    const start=pointSegment(c.x,c.z,o.x-ox,o.z-oz,o.x+ox,o.z+oz);
    return d<(c.arrival==='gather'?1.8:1.38)&&d<start+.06;
   }));
   return dynamic.get(k);
  }
  if(!free(ex,ez))return false;
  const open=[],costs=new Map(),parents=new Map(),points=new Map();
  function push(node){open.push(node);let i=open.length-1;while(i>0){const p=(i-1)>>1;if(open[p].f<=node.f)break;open[i]=open[p];i=p;}open[i]=node;}
  function pop(){const first=open[0],last=open.pop();if(open.length){let i=0;while(i*2+1<open.length){let child=i*2+1;if(child+1<open.length&&open[child+1].f<open[child].f)child++;if(open[child].f>=last.f)break;open[i]=open[child];i=child;}open[i]=last;}return first;}
  const start=id(sx,sz),finish=id(ex,ez);costs.set(start,0);push({x:sx,z:sz,g:0,f:Math.hypot(sx-ex,sz-ez)});points.set(start,{x:c.x,z:c.z});
  let found=false;
  for(let iterations=0;open.length&&iterations<4500;iterations++){
   const n=pop(),k=id(n.x,n.z);if(n.g!==costs.get(k))continue;if(k===finish){found=true;break;}
   const p=points.get(k)||{x:n.x*unit,z:n.z*unit};
   for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    if(!dx&&!dz)continue;const x=n.x+dx,z=n.z+dz,next=id(x,z);
    if(!free(x,z))continue;
    const q={x:x*unit,z:z*unit};if(!nav.clear(p,q))continue;
    const g=n.g+Math.hypot(dx,dz);if(g>=(costs.get(next)??Infinity))continue;
    costs.set(next,g);parents.set(next,k);points.set(next,q);push({x,z,g,f:g+Math.hypot(x-ex,z-ez)});
   }
  }
  if(!found)return false;
  const path=[];for(let k=finish;k!==start;k=parents.get(k)){if(k==null)return false;path.unshift(points.get(k));}
  if(!path.length||!nav.clear(path[path.length-1],goal))return false;
  c.route=[...path,goal,...c.route.slice(end+1)];c.blockedFor=0;c.waitUntil=0;totals.detours++;return true;
 }
 function steer(c,dt){
  if(c.waitUntil>time){c.speed=0;c.actualSpeed=0;c.turnRate=0;c.blockedFor+=dt;return;}
  let target=c.route[0];if(!target){arrived(c);return;}
  while(c.route.length>1&&distance(c,target)<.52&&nav.clear(c,c.route[1])){c.route.shift();target=c.route[0];}
  if(!nav.clear(c,target)){
   const repair=nav.route(c,target);if(repair.length>1){c.route=[...repair,...c.route.slice(1)];target=c.route[0];}
  }
  const remaining=distance(c,target),last=c.route.length===1,reverse=c.state==='backOut'||c.state==='yieldBack';
  if(last&&(remaining<.16||c.arrival==='rest'&&remaining<.65&&vacant(c,c,2.55)||c.arrival==='gather'&&remaining<.7&&vacant(c,c,2.7))){arrived(c);return;}
  const nearby=neighbors(c),dx=target.x-c.x,dz=target.z-c.z;
  let vx=dx/(remaining||1),vz=dz/(remaining||1),pace=1;
  const forwardX=vx,forwardZ=vz;
  for(const other of nearby){
   const ox=other.x-c.x,oz=other.z-c.z,dist=Math.hypot(ox,oz);
   const ahead=ox*forwardX+oz*forwardZ,lateral=forwardX*oz-forwardZ*ox;
   if(ahead>0&&ahead<Math.min(4.2,last?remaining+1.1:4.2)&&Math.abs(lateral)<1.9){
    const sameDirection=forwardX*Math.cos(other.yaw)-forwardZ*Math.sin(other.yaw)>.55;
    const following=moving.has(other.state)&&Math.abs(other.actualSpeed)>.08&&sameDirection;
    if(following&&Math.abs(lateral)<1.1)pace=Math.min(pace,smooth(1.9,4.2,ahead));
    else{
     // Opposite streams both keep to their own right. A standing neighbour is
     // passed on the side requiring the smaller change of heading.
     const side=Math.abs(lateral)>.18?(lateral>0?-1:1):-1;
     const avoidance=(1-smooth(1.4,4.3,ahead))*(1-smooth(.6,2,Math.abs(lateral)));
     vx+=-forwardZ*side*avoidance*1.25;vz+=forwardX*side*avoidance*1.25;
     pace=Math.min(pace,.55+.45*smooth(1.4,3.5,ahead));
    }
   }
   if(dist<1.85&&dist>.01){const repel=(1.85-dist)*.6;vx-=ox/dist*repel;vz-=oz/dist*repel;}
  }
  const wanted=reverse?Math.atan2(vz,-vx):Math.atan2(-vz,vx),delta=angle(wanted-c.yaw);
  const turn=clamp(delta,-.9*dt,.9*dt),yaw=c.yaw+turn;
  let cruise=c.state==='grazeStep'?c.cruise*.57:reverse?.4:c.cruise;
  let speed=cruise*pace*(.22+.78*Math.max(0,Math.cos(delta)));
  if(last)speed=Math.min(speed,Math.sqrt(Math.max(0,2*.48*(remaining-.08))));
  c.speed=lerp(c.speed,speed,1-Math.exp(-3.8*dt));
  const sign=reverse?-1:1,steeringLength=Math.hypot(vx,vz)||1;
  // A short lateral adjustment is possible while the body finishes turning.
  // This avoids trapping two long bodies nose-to-nose in a narrow passage.
  const sx=Math.cos(yaw)*sign*.45+vx/steeringLength*.55,sz=-Math.sin(yaw)*sign*.45+vz/steeringLength*.55,sl=Math.hypot(sx,sz)||1;
  const nx=c.x+sx/sl*c.speed*dt,nz=c.z+sz/sl*c.speed*dt;
  const groundClear=valid({x:nx,z:nz})&&nav.clear(c,{x:nx,z:nz});
  let clear=groundClear,blocker=null,acceptedYaw=yaw;
  c.blockedReason=clear?null:'obstacle';
  for(const other of nearby){
   if(distance(c,other)>3.8)continue;
   const gap=bodyDistance(c,other,nx,nz,yaw),old=bodyDistance(c,other),minimum=(c.scale+other.scale)*.48;
   if(gap<minimum&&gap<old-.0001){clear=false;blocker=other;c.blockedReason='animal:'+other.id;break;}
  }
  if(!clear&&groundClear&&nearby.every(other=>{
   if(distance(c,other)>3.8)return true;
   const gap=bodyDistance(c,other,nx,nz,c.yaw),old=bodyDistance(c,other);
   return gap>=(c.scale+other.scale)*.48||gap>=old;
  })){clear=true;acceptedYaw=c.yaw;}
  if(clear){
   c.x=nx;c.z=nz;c.actualSpeed=c.speed*sign;c.turnRate=angle(acceptedYaw-c.yaw)/(dt||1);c.yaw=acceptedYaw;
   c.blockedFor=c.speed>.07?0:c.blockedFor+dt;
  }else{
   c.actualSpeed=0;c.turnRate=0;c.speed=0;c.blockedFor+=dt;
   const canTurn=!reverse&&Math.abs(turn)>.002&&nearby.every(other=>{
    if(distance(c,other)>3.8)return true;
    const gap=bodyDistance(c,other,c.x,c.z,yaw),old=bodyDistance(c,other);
    return gap>=(c.scale+other.scale)*.48||gap>=old;
   });
   if(canTurn){c.yaw=yaw;c.turnRate=turn/(dt||1);}
   else if(c.blockedFor>.8)c.waitUntil=time+rand(.3,.85);
   if(!reverse&&c.state==='walk'&&blocker&&moving.has(blocker.state)&&c.id>blocker.id&&c.blockedFor>1.6){
    const p={x:c.x-Math.cos(c.yaw)*1.35,z:c.z+Math.sin(c.yaw)*1.35};
    if(vacant(p,c,1.55)&&nav.clear(c,p)){
     c.savedTravel={route:c.route.map(p=>({...p})),destination:c.destination,arrival:c.arrival};
     c.route=[p];c.destination=p;c.arrival='resume';c.state='yieldBack';c.blockedFor=0;c.waitUntil=0;
    }
   }
  }
  if(c.blockedFor>3&&time>c.replanAt){
   c.replanAt=time+rand(5,8);
   if(c.state==='grazeStep'){graze(c);return;}
   if(reverse){arrived(c);return;}
   if(c.arrival==='rest'){
    const p=shadePoint(c);if(p&&travel(c,p,'rest','rest'))return;
   }
   if(localBypass(c))return;
   const facing={x:forwardX,z:forwardZ};
   const obstacle=nearby.filter(o=>distance(c,o)<4.5).sort((a,b)=>distance(c,a)-distance(c,b))[0];
   for(const side of [-1,1]){
    const p={x:c.x-facing.z*side*2.7-facing.x*.4,z:c.z+facing.x*side*2.7-facing.z*.4};
    if(!vacant(p,c,2.15)||!nav.clear(c,p))continue;
    const pass=obstacle?{x:obstacle.x-facing.z*side*2.7+facing.x*2.4,z:obstacle.z+facing.x*side*2.7+facing.z*2.4}:p;
    if(!vacant(pass,c,2.15)||!nav.clear(p,pass))continue;
    const rest=c.station?stationRoute(pass,c.station):nav.route(pass,c.destination,true);
    if(rest.length){c.route=[p,...(pass!==p?[pass]:[]),...rest];c.blockedFor=0;totals.detours++;break;}
   }
   if(c.blockedFor>24&&c.station){const old=c.station;if(findStation(c,c.intent,old))totals.stationChanges++;}
  }
 }
 function needs(c,dt){
  c.hunger=clamp(c.hunger+dt*.0008*c.metabolism);
  c.thirst=clamp(c.thirst+dt*(.0006+(c.state==='feed'?.0008:0)+(moving.has(c.state)?.00025:0))*c.metabolism);
  c.fatigue=clamp(c.fatigue+dt*(moving.has(c.state)?.001:.00032));
  if(c.state==='graze')c.hunger=clamp(c.hunger-dt*.0026);
  if(c.state==='feed')c.hunger=clamp(c.hunger-dt*.0068);
  if(c.state==='water')c.thirst=clamp(c.thirst-dt*.03);
  if(c.state==='rest')c.fatigue=clamp(c.fatigue-dt*.0034);
 }
 function stationary(c){
  c.speed=0;c.actualSpeed=0;c.turnRate=0;
  if(time<c.until)return;
  if(c.state==='graze'||c.state==='look'){
   if(c.thirst>.84||c.hunger<.18&&time>c.activityStart+45||time>c.boutUntil&&(c.thirst>.62||c.fatigue>.65||c.hunger>.65)){choose(c);return;}
   if(c.state==='look'){grazeStep(c);return;}
   if(time>c.boutUntil){c.boutUntil=time+rand(90,180);if(distance(c,buddyCenter(c))>18&&travel(c,grazingTarget(c),'graze','graze'))return;}
   if(rng()<.23){c.state='look';c.until=time+rand(2,5);}else grazeStep(c);
  }else if(c.state==='stationLower'){
   c.state=c.intent;c.until=time+(c.intent==='water'?rand(19,30):rand(65,105));
  }else if(c.state==='feed'||c.state==='water'){
   if(c.state==='water'&&c.thirst>.2||c.state==='feed'&&c.hunger>.25){c.until=time+5;return;}
   totals[c.state==='water'?'drinks':'feeds']++;beginLeaving(c);
  }else if(c.state==='stationRaise')backOut(c);
  else if(c.state==='lieDown'){c.state='rest';c.until=time+rand(170,320);}
  else if(c.state==='rest'){
   if(c.fatigue>.3&&c.thirst<.84){c.until=time+20;return;}
   totals.rests++;c.state='standUp';c.until=time+clips.StandUp.duration;
  }else if(c.state==='standUp'){idle(c,rand(3,6));}
  else choose(c);
 }
 for(let i=0;i<count;i++){
  const group=i%groups.length,g=groups[group],rest=i%5===0||i%11===0;
  let p=freePoint(g,null,g.r,true)||freePoint(null);
  if(rest)p=shadePoint(p,i%3===0?world.shadeAreas:world.shelterAreas)||p;
  else if(i%8===2)p=freePoint({x:-12,z:66},null,14)||p;
  const state=rest?'rest':world.inPen(p.x,p.z)?'idle':'graze';
  animals.push({id:i,...p,group,buddies:[],yaw:rand(0,Math.PI*2),scale:rand(.88,1.08),state,intent:rest?'rest':'graze',
   hunger:rand(.2,.72),thirst:rand(.12,.69),fatigue:rest?rand(.5,.85):rand(.16,.65),metabolism:rand(.86,1.15),
   cruise:rand(.66,.86),feedPreference:rng(),sociability:rand(.25,.65),until:time+(rest?rand(90,240):rand(3,18)),
   boutUntil:time+rand(90,220),activityStart:time,route:[],destination:null,station:null,arrival:'graze',
   speed:0,actualSpeed:0,turnRate:0,blockedFor:0,replanAt:0,waitUntil:0});
 }
 let feeder=0;
 stations.forEach((s,i)=>{
  s.reservedBy=null;s.reserveUntil=0;
  if(i%3!==0)return;
  while(animals[feeder]?.state==='rest')feeder++;
  const c=animals[feeder++];if(!c)return;
  c.x=s.x;c.z=s.z;c.yaw=s.yaw;c.state=s.type;c.intent=s.type;c.station=s;s.occupied=c.id;
  c.until=time+(s.type==='water'?rand(18,26):rand(60,95));c[s.type==='water'?'thirst':'hunger']=rand(.65,.9);
 });
 for(const c of animals)c.buddies=animals.filter(b=>b!==c&&b.group===c.group).sort((a,b)=>distance(c,a)-distance(c,b)).slice(0,3).map(b=>b.id);
 for(let i=45;i<Math.min(78,count);i++){const c=animals[i];if(c.state==='rest'||c.station)continue;choose(c);if(c.state==='graze')grazeStep(c);}
 rebuildGrid();
 function update(dt){
  time+=dt;rebuildGrid();
  for(const c of animals){
   if(c.filteredOut){c.actualSpeed=0;c.turnRate=0;continue;}
   if(c.sceneTarget&&time>=c.gatherAfter){
    // Finish getting up before walking. Never translate a lying model.
    if(c.state==='rest'){c.state='standUp';c.until=time+clips.StandUp.duration;continue;}
    if(c.state==='standUp'||c.state==='lieDown'){stationary(c);continue;}
    if(c.station){
     if(!['stationRaise','backOut'].includes(c.state))beginLeaving(c);
     if(c.state==='backOut')steer(c,dt);else stationary(c);
     continue;
    }
    if(c.intent!=='gather'||!moving.has(c.state)&&distance(c,c.sceneTarget)>1.6){
     if(!travel(c,c.sceneTarget,'gather','gather')){idle(c,2);continue;}
    }
    if(moving.has(c.state))steer(c,dt);
    else if(time>=c.until){c.state=c.state==='graze'?'look':'graze';c.until=time+rand(7,16);}
    continue;
   }
   needs(c,dt);
   if(c.state==='walk'&&c.station&&distance(c,c.station)<14&&!reserve(c)){
    if(findStation(c,c.intent,c.station))totals.stationChanges++;else{release(c);idle(c,rand(2,4));}
   }
   if(c.state==='stationAlign'){
    const delta=angle(c.station.yaw-c.yaw),turn=clamp(delta,-.65*dt,.65*dt);
    c.yaw+=turn;c.turnRate=turn/(dt||1);c.actualSpeed=0;
    if(Math.abs(delta)<.035){c.state='stationLower';c.until=time+1.35;c.turnRate=0;}
   }else if(moving.has(c.state))steer(c,dt);else stationary(c);
  }
 }
 function inspect(){
  const states={},intents={};let overlaps=0,minGap=Infinity;
  for(const c of animals){states[c.state]=(states[c.state]||0)+1;intents[c.intent]=(intents[c.intent]||0)+1;}
  for(let i=0;i<animals.length;i++)for(let j=i+1;j<animals.length;j++){
   const a=animals[i],b=animals[j];if(a.filteredOut||b.filteredOut||distance(a,b)>3.8)continue;
   const gap=bodyDistance(a,b)-(a.scale+b.scale)*.48;minGap=Math.min(minGap,gap);if(gap<-.08)overlaps++;
  }
  return{time,states,intents,totals:{...totals},overlaps,minGap:Number.isFinite(minGap)?minGap:null,
   blocked:animals.filter(c=>moving.has(c.state)&&c.blockedFor>12).map(c=>({id:c.id,state:c.state,intent:c.intent,seconds:c.blockedFor,x:c.x,z:c.z,reason:c.blockedReason,target:c.route[0]})),
   occupied:stations.filter(s=>s.occupied!==null).length,reserved:stations.filter(s=>s.reservedBy!=null&&s.reserveUntil>=time).length};
 }
 function setTargets(targets){
  for(const c of animals){
   const target=targets.get(c.id)||null;
   if(c.sceneTarget?.x===target?.x&&c.sceneTarget?.z===target?.z)continue;
   c.sceneTarget=target;c.gatherAfter=time+(c.id%17)*.12;
   if(!c.station&&!['rest','lieDown','standUp'].includes(c.state)){idle(c,.5);c.intent='idle';}
  }
 }
 function setFiltered(id,value){
  const c=animals[id];if(!c||Boolean(c.filteredOut)===value)return;
  c.filteredOut=value;
  if(value){release(c);c.route=[];c.speed=c.actualSpeed=0;if(!['rest','lieDown','standUp'].includes(c.state))idle(c,2);}
  else if(!['rest','lieDown','standUp'].includes(c.state))idle(c,1);
 }
 return{animals,update,inspect,setTargets,setFiltered,advance(seconds){for(let left=Math.min(seconds,600);left>0;left-=.1)update(Math.min(.1,left));}};
}

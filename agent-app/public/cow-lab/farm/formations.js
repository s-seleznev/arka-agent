// Stable patches of open pasture. IDs keep their individual slots when a filter changes.
export function createFormations(world,nav){
 let signature='',cached=null;
 const valid=(x,z)=>Math.abs(x)<world.field.width/2-7&&z<9&&z>-world.field.depth/2+7&&!nav.inside(x,z);
 return{plan(animals,rule){
  if(!rule)return{targets:new Map(),groups:[]};
  const next=JSON.stringify([rule.field,animals.map(c=>[c.record.animalId,c.record.groupValue])]);
  if(next!==signature){
   signature=next;
   const buckets=new Map();
   for(const c of animals){const key=JSON.stringify(c.record.groupValue);if(!buckets.has(key))buckets.set(key,{key,value:c.record.groupValue,members:[]});buckets.get(key).members.push(c);}
   const patches=[...buckets.values()].sort((a,b)=>b.members.length-a.members.length||a.key.localeCompare(b.key));
   const occupied=[],groups=[];
   for(const group of patches){
    const radius=Math.sqrt(group.members.length)*2.9+3;
    let center=null,best=-Infinity;
    for(let z=-65;z<=-8;z+=5)for(let x=-96;x<=97;x+=5){
     if(!valid(x,z))continue;
     const separation=Math.min(40,...occupied.map(p=>Math.hypot(x-p.x,z-p.z)-p.radius-radius));
     const edge=Math.min(x+world.field.width/2,world.field.width/2-x,z+world.field.depth/2,13-z)-radius;
     const score=Math.min(separation,edge)*10-Math.hypot(x,z+25)*.015;
     if(score>best){best=score;center={x,z};}
    }
    if(!center)continue;
    occupied.push({...center,radius});
    const slots=[];
    for(let ring=0;slots.length<group.members.length&&ring<80;ring++){
     const r=ring*5.3,n=ring?Math.max(6,Math.floor(2*Math.PI*r/5.3)):1;
     for(let j=0;j<n&&slots.length<group.members.length;j++){
      const a=j/n*Math.PI*2+(ring%2)*.31,x=center.x+Math.cos(a)*r,z=center.z+Math.sin(a)*r;
      if(!valid(x,z)||groups.some(g=>g.slots.some(p=>Math.hypot(p.x-x,p.z-z)<5)))continue;
      slots.push({x,z});
     }
    }
    // The closest animals occupy inner places first; incoming cows use places
    // on their own side of the patch instead of crossing the settled herd.
    if(slots.length<group.members.length)throw new Error('Formation does not fit in the pasture');
    const remaining=slots.slice(),assigned=new Map();
    const order=group.members.slice().sort((a,b)=>Math.hypot(a.x-center.x,a.z-center.z)-Math.hypot(b.x-center.x,b.z-center.z)||a.id-b.id);
    for(const c of order){
     let best=0,dist=Infinity;
     remaining.forEach((p,i)=>{const d=Math.hypot(p.x-c.x,p.z-c.z);if(d<dist){dist=d;best=i;}});
     assigned.set(c.id,remaining.splice(best,1)[0]);
    }
    groups.push({...group,...center,slots:group.members.map(c=>assigned.get(c.id))});
   }
   cached=groups;
  }
  const targets=new Map(),groups=[];
  for(const g of cached){
   let count=0;
   g.members.forEach((original,i)=>{const c=animals[original.id];if(c.record.matched&&g.slots[i]){targets.set(c.id,g.slots[i]);count++;}});
   if(count)groups.push({key:g.key,value:g.value,x:g.x,z:g.z,count});
  }
  return{targets,groups};
 }};
}

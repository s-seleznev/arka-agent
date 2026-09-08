export function infographicPlan(animals,rule){
 const buckets=new Map();
 for(const c of animals){
  if(!c.record.matched)continue;
  const key=rule?JSON.stringify(c.record.groupValue):'all';
  if(!buckets.has(key))buckets.set(key,{key,value:c.record.groupValue,members:[]});
  buckets.get(key).members.push(c);
 }
 const groups=[...buckets.values()].sort((a,b)=>a.key.localeCompare(b.key));
 const aspect=Math.max(.4,innerWidth/Math.max(1,innerHeight));
 const gridCols=Math.max(1,Math.min(groups.length,Math.ceil(Math.sqrt(groups.length*aspect*.8))));
 const columnWidths=Array(gridCols).fill(0),rowDepths=[];
 groups.forEach((g,i)=>{
  g.members.sort((a,b)=>a.record.animalId.localeCompare(b.record.animalId));
  g.cols=Math.max(1,Math.ceil(Math.sqrt(g.members.length*(rule?1:aspect))));
  g.width=Math.max(rule?19:4,g.cols*4);
  g.depth=Math.ceil(g.members.length/g.cols)*3+5;
  columnWidths[i%gridCols]=Math.max(columnWidths[i%gridCols],g.width);
  const row=Math.floor(i/gridCols);rowDepths[row]=Math.max(rowDepths[row]||0,g.depth);
 });
 const gap=5,width=columnWidths.reduce((a,b)=>a+b,0)+Math.max(0,gridCols-1)*gap;
 const depth=rowDepths.reduce((a,b)=>a+b,0)+Math.max(0,rowDepths.length-1)*gap;
 const targets=new Map();
 groups.forEach((g,i)=>{
  const col=i%gridCols,row=Math.floor(i/gridCols);
  const left=columnWidths.slice(0,col).reduce((a,b)=>a+b,0)+col*gap-width/2;
  const top=rowDepths.slice(0,row).reduce((a,b)=>a+b,0)+row*gap-depth/2;
  g.x=left+columnWidths[col]/2;g.z=top+2;g.count=g.members.length;
  g.members.forEach((c,j)=>targets.set(c.id,{x:g.x+(j%g.cols-(g.cols-1)/2)*4,z:top+5+Math.floor(j/g.cols)*3}));
 });
 return{targets,groups:rule?groups:[],width:Math.max(4,width),depth:Math.max(4,depth)};
}

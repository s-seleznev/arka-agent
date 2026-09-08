import * as T from 'three';

export function createBridge(query){
 const channel=query.get('channel');
 let latest=null,listener=null,activityListener=null,environmentListener=null,resolveFirst;
 const first=new Promise(resolve=>{resolveFirst=resolve;});
 const bridge={first,active:true,latest:()=>latest,
  send(type,payload={}){parent.postMessage({source:'arka-farm',channel,type,...payload},location.origin);},
  onData(fn){listener=fn;if(latest)fn(latest);},
  onEnvironment(fn){environmentListener=fn;},
  onActive(fn){activityListener=fn;fn(bridge.active);}
 };
 addEventListener('message',event=>{
  const data=event.data;
  if(event.source!==parent||event.origin!==location.origin||data?.source!=='arka-workspace'||data.channel!==channel)return;
  if(data.type==='data'&&Array.isArray(data.animals)){
   if(data.animals.length>2000||data.animals.some(r=>typeof r.animalId!=='string'||typeof r.farmId!=='string'||typeof r.matched!=='boolean'||!['MALE','FEMALE'].includes(r.sex)))return;
   if(latest?.viewId===data.viewId&&latest.revision>data.revision)return;
   latest=data;resolveFirst(data);listener?.(data);
  }else if(data.type==='environment'){environmentListener?.(Boolean(data.hidden));
  }else if(data.type==='active'){bridge.active=Boolean(data.active);activityListener?.(bridge.active);}
 });
 bridge.send('ready');
 return bridge;
}

export function createPicking({renderer,camera,controls,world,getHerd,bridge,invalidate=()=>{}}){
 const canvas=renderer.domElement,raycaster=new T.Raycaster(),mouse=new T.Vector2(),point=new T.Vector3();
 let pointer=null,hovered=null,dragging=false,down=null,lastPick=0,lastHit=0,keyboard=false,lastViewport=0;
 let pending=null,pendingSince=0,stillSince=0,anchor=null,wakeTimer;
 const wakeAfter=(delay)=>{clearTimeout(wakeTimer);wakeTimer=setTimeout(invalidate,delay);};
 const clearHover=()=>{hovered=null;pending=null;button.hidden=true;};
 const button=document.createElement('button');button.className='animal-bubble';button.hidden=true;button.type='button';
 const label=document.createElement('span'),status=document.createElement('small'),icon=document.createElement('span');icon.className='animal-bubble-icon';icon.innerHTML='<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18m-5-12-3 3 3 3"/></svg>';button.append(label,status,icon);document.body.append(button);
 const labels=document.createElement('div');labels.className='group-labels';document.body.append(labels);
 let labelSignature='';
 const select=()=>{if(hovered)bridge.send('select',{animalId:hovered.record.animalId,farmId:hovered.record.farmId});};
 button.addEventListener('click',select);
 button.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();hovered=null;button.hidden=true;canvas.focus();}});
 canvas.tabIndex=0;canvas.setAttribute('aria-label','3D-ферма. Стрелки выбирают животное, Enter открывает карточку. Перетаскивание поворачивает вид, колесо приближает.');
 canvas.addEventListener('pointermove',e=>{
  keyboard=false;pointer={x:e.clientX,y:e.clientY};
  if(!anchor||Math.hypot(pointer.x-anchor.x,pointer.y-anchor.y)>4){anchor={...pointer};stillSince=performance.now();}
  if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>5){dragging=true;clearHover();}
  invalidate();wakeAfter(220);
 });
 canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};dragging=false;clearHover();});
 canvas.addEventListener('pointerup',e=>{
  const clicked=down&&!dragging&&e.button===0&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<=5;
  down=null;dragging=false;pending=null;stillSince=performance.now();lastPick=0;
  if(clicked){
   mouse.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);
   raycaster.setFromCamera(mouse,camera);
   const animal=getHerd().pick(raycaster.ray);
   if(animal)bridge.send('select',{animalId:animal.record.animalId,farmId:animal.record.farmId});
  }
  invalidate();wakeAfter(220);
 });
 canvas.addEventListener('pointercancel',()=>{down=null;dragging=false;clearHover();});
 canvas.addEventListener('pointerleave',()=>{pointer=null;pending=null;wakeAfter(250);});
 button.addEventListener('pointerenter',()=>{lastHit=performance.now();clearTimeout(wakeTimer);});
 button.addEventListener('pointerleave',()=>{lastHit=performance.now();wakeAfter(250);});
 controls.addEventListener('start',()=>{keyboard=false;clearHover();});
 controls.addEventListener('end',()=>{stillSince=performance.now();wakeAfter(220);});
 canvas.addEventListener('keydown',e=>{
  if(e.key==='Escape'){bridge.send('escape');return;}
  if(e.key==='Enter'&&hovered){e.preventDefault();select();return;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
  e.preventDefault();const cows=getHerd().animals.filter(c=>c.record.matched),at=cows.indexOf(hovered),delta=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;
  hovered=cows[(at+delta+cows.length)%cows.length]||null;keyboard=true;
  if(hovered){const offset=camera.position.clone().sub(controls.target);controls.target.set(hovered.x,world.heightAt(hovered.x,hovered.z),hovered.z);camera.position.copy(controls.target).add(offset);controls.update();}
 });
 function project(x,y,z){return point.set(x,y,z).project(camera);}
 return{update(now){
  const herd=getHerd(),onButton=button.matches(':hover')||button===document.activeElement;
  if(hovered&&!herd.animals.includes(hovered))clearHover();
  if(onButton)lastHit=now;
  if(!keyboard&&!onButton&&now-lastPick>60){
   lastPick=now;
   let candidate=null;
   if(pointer&&!dragging){mouse.set(pointer.x/innerWidth*2-1,-pointer.y/innerHeight*2+1);raycaster.setFromCamera(mouse,camera);candidate=herd.pick(raycaster.ray);}
   if(candidate!==pending){pending=candidate;pendingSince=now;if(candidate)wakeAfter(220);}
   if(candidate===hovered&&candidate)lastHit=now;
   else if(candidate&&now-Math.max(pendingSince,stillSince)>=200){hovered=candidate;lastHit=now;}
   else if(dragging||now-lastHit>220)hovered=null;
  }
  if(hovered&&!dragging){
   const p=project(hovered.x,world.heightAt(hovered.x,hovered.z)+(hovered.state==='rest'?1.05:1.8),hovered.z);
   button.hidden=p.z>1||p.z<0||Math.abs(p.x)>1.05||Math.abs(p.y)>1.05;
   button.style.left=Math.max(85,Math.min(innerWidth-85,(p.x+1)*innerWidth/2))+'px';button.style.top=Math.max(45,(1-p.y)*innerHeight/2)+'px';
   label.textContent=[hovered.record.primaryIdentifier,hovered.record.name].filter(Boolean).join(' · ');
   status.textContent=hovered.record.matched?'':'Вне фильтра';status.hidden=hovered.record.matched;
   button.dataset.animalId=hovered.record.animalId;button.setAttribute('aria-label','Открыть карточку животного '+hovered.record.primaryIdentifier);
  }else button.hidden=true;
  const groups=herd.groups(),signature=JSON.stringify(groups.map(g=>[g.key,g.count]));
  if(signature!==labelSignature){labelSignature=signature;labels.replaceChildren(...groups.map(g=>{const e=document.createElement('div');e.className='group-label';e.textContent=(bridge.latest()?.groupLabels?.[g.key]??(g.value===null?'Не указано':String(g.value)))+' · '+g.count;return e;}));}
  groups.forEach((g,i)=>{const p=project(g.x,world.heightAt(g.x,g.z)+2.8,g.z),e=labels.children[i];e.hidden=p.z>1||p.z<0||Math.abs(p.x)>1||Math.abs(p.y)>1;e.style.left=(p.x+1)*innerWidth/2+'px';e.style.top=(1-p.y)*innerHeight/2+'px';});
  if(now-lastViewport>1800){
   lastViewport=now;const ids=[];
   for(const c of herd.animals){if(!c.record.matched)continue;const p=project(c.x,world.heightAt(c.x,c.z)+.7,c.z);if(p.z>0&&p.z<1&&Math.abs(p.x)<1&&Math.abs(p.y)<1)ids.push(c.record.animalId);}
   bridge.send('viewport',{ids});
  }
 }};
}

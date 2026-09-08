import * as T from 'three';
import {BUILDINGS} from './layout.js';

export function createBuildings({box,beam,add}){
 function pitchedRoof(b,color,peak){
  const {x,z,w,d,h,overhang:o}=b,angle=Math.atan2(peak,d/2),half=d/2+o,span=half/Math.cos(angle);
  const roofY=h+peak-half*Math.tan(angle)/2+.12;
  for(const side of [-1,1]){
   add(new T.BoxGeometry(w+o*2,.18,span),color,x,roofY,z+side*half/2,side*angle);
   for(let u=-w/2;u<=w/2;u+=1.35)add(new T.BoxGeometry(.035,.045,span),color,x+u,roofY+.11,z+side*half/2,side*angle);
   box(x,h-o*Math.tan(angle)+.1,z+side*half,w+o*2,.17,.16,'metal');
  }
  box(x,h+peak+.16,z,w+o*2,.17,.27,'roofDark');
 }
 function cattleBarn(b){
  const {x,z,w,d,h}=b,front=z+d/2,back=z-d/2,door=7.2,peak=2.75;
  box(x,.12,z,w+.55,.24,d+.55,'stone');
  box(x,h/2,back,w,h,.25,'wall');
  for(const side of [-1,1]){
   box(x+side*w/2,h/2,z,.25,h,d,'wall');
   const g=new T.Shape();g.moveTo(-d/2,0);g.lineTo(d/2,0);g.lineTo(0,peak);g.closePath();
   const triangle=new T.ExtrudeGeometry(g,{depth:.25,bevelEnabled:false});triangle.rotateY(Math.PI/2);
   add(triangle,'wall',x+side*w/2-.125,h,z);
   const section=(w-door)/2,cx=x+side*(door/2+section/2);
   box(cx,h/2,front,section,h,.25,'wall');
   box(cx,.48,front+.16,section,.78,.11,'stone');
   for(let zz=back+.4;zz<front;zz+=1.25)box(x+side*(w/2+.14),h*.68,zz,.06,h*.57,.055,'trim');
   for(let i=0;i<4;i++){
    const wx=cx+(i-1.5)*2.55;
    box(wx,4.45,front+.14,2,.68,.13,'woodDark');
    for(let l=0;l<4;l++)box(wx,4.2+l*.16,front+.23,2,.06,.1,'wood');
   }
   // Sliding leaves sit alongside a genuinely open doorway.
   const leafX=x+side*(door/2+door/4+.12);
   box(leafX,2.03,front+.36,door/2,3.8,.16,'woodDark');
   for(let k=0;k<9;k++)box(leafX-door/4+(k+.5)*door/18,2.03,front+.46,door/18-.02,3.72,.06,'wood');
   for(const yy of [.55,3.45])box(leafX,yy,front+.54,door/2-.12,.13,.08,'woodLight');
   beam([leafX-door/4+.1,.6,front+.6],[leafX+door/4-.1,3.4,front+.6],.06,'woodLight');
   for(const zz of [back,front])box(x+side*w/2,.48,zz,.45,.92,.45,'stone');
  }
  box(x,4.75,front,door,1.3,.25,'wall');
  box(x,4.15,front+.4,door*2+.6,.14,.15,'metal');
  for(const u of [-w/2,-w/4,0,w/4,w/2]){
   box(x+u,h/2,back+.2,.25,h,.3,'woodDark');
   beam([x+u,h,back],[x+u,h+peak,z],.11,'wood');beam([x+u,h,front],[x+u,h+peak,z],.11,'wood');
  }
  pitchedRoof(b,'roofSteel',peak);
  for(const u of [-9,9]){
   box(x+u,h+peak+.36,z,3.2,.5,1.1,'woodDark');
   box(x+u,h+peak+.67,z,3.65,.16,1.5,'roofSteel');
  }
  for(const xx of [x-w/2+.3,x+w/2-.3])beam([xx,h-.12,front+.75],[xx,.25,front+.75],.075,'metal');
  box(x,3.65,back+.35,door*.9,.85,.12,'glass');
  // Low internal rails and feed bins remain visible through the central bay.
  for(const side of [-1,1]){
   box(x+side*6,.6,z,4,1.05,d-2,'woodDark');
   box(x+side*6,1.15,z,3.8,.08,d-2.2,'hay');
  }
 }
 function bale(x,y,z,r=.85){
  add(new T.CylinderGeometry(r,r,1.6,12),'hay',x,y,z,0,0,Math.PI/2);
  for(const xx of [x-.59,x+.59])add(new T.TorusGeometry(r+.012,.016,3,20),'hayDark',xx,y,z,0,Math.PI/2);
  for(const rr of [.2,.43,.65])add(new T.TorusGeometry(rr,.009,3,20),'hayDark',x-.807,y,z,0,Math.PI/2);
 }
 function hayStore(b){
  const {x,z,w,d,h}=b,slope=.11;
  box(x,.08,z,w+.7,.16,d+.7,'soil');
  for(const side of [-1,1]){
   const px=x+side*w/2,ph=h-side*w/2*slope;
   for(let i=0;i<5;i++){
    const zz=z-d/2+i*d/4;
    box(px,.22,zz,.7,.44,.7,'stone');box(px,ph/2,zz,.27,ph,.27,'woodDark');
    if(i<4)beam([px,ph-1.1,zz],[px,ph-.2,zz+1.2],.085,'wood');
   }
   box(px,ph-.18,z,.28,.3,d+.3,'wood');
  }
  box(x+w/2,1,z,.13,1.7,d,'wood');
  for(let u=-w/2;u<=w/2;u+=2.5)box(x+u,1,z-d/2,2.45,1.7,.14,'wood');
  box(x,h+.14,z,w+1.5,.17,d+1.5,'roofHay',0,-Math.atan(slope));
  for(let zz=-d/2;zz<=d/2;zz+=1.15)box(x,h+.25,z+zz,w+1.5,.045,.06,'roofHay',0,-Math.atan(slope));
  for(let i=0;i<8;i++){
   const zz=z-d/2+1.65+i*2.7;
   for(const xx of [x+.5,x+3])bale(xx,1,zz);
   bale(x+1.75,2.48,zz);
  }
  // A few rectangular bales make the open storage function legible from outside.
  for(let i=0;i<3;i++){
   box(x-w/2+1.5,.68,z+d/2-1.6-i*1.25,2,1.1,1.05,'hay');
   for(const dx of [-.55,.55])box(x-w/2+1.5+dx,1.24,z+d/2-1.6-i*1.25,.035,.035,1.08,'hayDark');
  }
 }
 function workshop(b){
  const {x,z,w,d,h}=b,face=x+w/2;
  box(x,.15,z,w+.4,.3,d+.4,'stone');
  box(x-w/2,h/2,z,.22,h,d,'wallWorkshop');
  for(const side of [-1,1]){
   box(x,h/2,z+side*d/2,w,h,.22,'wallWorkshop');
   box(face,h/2,z+side*(d/4+1),.22,h,d/2-2,'wallWorkshop');
   box(x+1,2.25,z+side*(d/2+.14),4,.95,.1,'trim');
   box(x+1,2.25,z+side*(d/2+.21),3.75,.72,.08,'glass');
   for(const u of [-.65,.65])box(x+1+u,2.25,z+side*(d/2+.27),.06,.78,.05,'metal');
  }
  box(face,3.18,z,.22,.85,4,'wallWorkshop');
  box(face+.19,2.88,z,.25,.42,4.25,'metal');
  for(let i=0;i<4;i++)box(face+.34,2.65+i*.1,z,.075,.065,3.95,'tank');
  box(x,h+.13,z,w+1.1,.18,d+1.1,'roofWorkshop');
  for(let i=-w/2;i<w/2;i+=1.15)box(x+i,h+.24,z,.035,.04,d+1.1,'roofWorkshop');
  // Thin roof edge, ventilation stack, workbench: no miniature farmhouse details.
  for(const side of [-1,1])box(x,h+.1,z+side*(d/2+.48),w+1,.28,.12,'metal');
  add(new T.CylinderGeometry(.18,.18,.95,10),'metal',x-4,h+.65,z-3);
  add(new T.ConeGeometry(.36,.18,10),'metal',x-4,h+1.2,z-3);
  box(x+2,1,z-3.5,5,.15,1.4,'wood');
  for(const xx of [x,x+4])box(xx,.5,z-3.5,.18,1,.8,'metal');
  box(face+1.5,.07,z,3,.14,5.4,'stone');
  for(const zz of [z-2.4,z+2.4])add(new T.CylinderGeometry(.11,.11,1,8),'metal',face+.8,.5,zz);
 }
 for(const b of BUILDINGS){
  if(b.kind==='cattle-barn')cattleBarn(b);
  if(b.kind==='hay-store')hayStore(b);
  if(b.kind==='workshop')workshop(b);
 }
}

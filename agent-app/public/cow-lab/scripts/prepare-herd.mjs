import fs from 'node:fs/promises';
import * as T from '../vendor/three.module.min.js';

// Sample the original Quaternius skeleton once; all animals share this pose library.
const base = new URL('../', import.meta.url);
const model=process.argv[2]==='bull'?'Bull':'Cow';
const gltf = JSON.parse(await fs.readFile(new URL(`models/ultimate-animals/${model}.gltf`, base), 'utf8'));
const buffer = Buffer.from(gltf.buffers[0].uri.split(',')[1], 'base64');
function accessor(id) {
  const a=gltf.accessors[id], v=gltf.bufferViews[a.bufferView];
  const n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
  const bytes={5121:1,5123:2,5125:4,5126:4}[a.componentType];
  const data=new Float32Array(a.count*n), start=(v.byteOffset||0)+(a.byteOffset||0);
  for(let i=0;i<a.count;i++)for(let k=0;k<n;k++){
    const o=start+i*(v.byteStride||n*bytes)+k*bytes;
    data[i*n+k]=a.componentType===5126?buffer.readFloatLE(o):a.componentType===5123?buffer.readUInt16LE(o):a.componentType===5121?buffer.readUInt8(o):buffer.readUInt32LE(o);
  }
  return data;
}
const nodes=gltf.nodes.map(n=>{
  const o=new T.Object3D(); o.name=n.name||'';
  if(n.translation)o.position.fromArray(n.translation);
  if(n.rotation)o.quaternion.fromArray(n.rotation);
  if(n.scale)o.scale.fromArray(n.scale);
  if(n.matrix)new T.Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);
  return o;
});
gltf.nodes.forEach((n,i)=>n.children?.forEach(child=>nodes[i].add(nodes[child])));
const root=new T.Group();gltf.scenes[0].nodes.forEach(i=>root.add(nodes[i]));root.updateMatrixWorld(true);
const mixer=new T.AnimationMixer(root), skin=gltf.skins[0], inv=accessor(skin.inverseBindMatrices);
const inverses=skin.joints.map((_,i)=>new T.Matrix4().fromArray(inv,i*16));
const geometry={position:[],normal:[],color:[],skinIndex:[],skinWeight:[],index:[]};
for(const p of gltf.meshes[0].primitives){
  const start=geometry.position.length/3, pos=accessor(p.attributes.POSITION);
  geometry.position.push(...pos);geometry.normal.push(...accessor(p.attributes.NORMAL));
  geometry.skinIndex.push(...accessor(p.attributes.JOINTS_0));geometry.skinWeight.push(...accessor(p.attributes.WEIGHTS_0));
  const col=gltf.materials[p.material].pbrMetallicRoughness.baseColorFactor;
  for(let i=0;i<pos.length/3;i++)geometry.color.push(...col.slice(0,3));
  geometry.index.push(...Array.from(accessor(p.indices),v=>v+start));
}
const clips={}, matrices=[], mat=new T.Matrix4(), idleFrames=[];
const named=Object.fromEntries(nodes.map(n=>[n.name,n]));
const smooth=t=>t*t*(3-2*t);
function restingPose(amount){
  if(amount<=0)return;
  const saved=nodes.map(n=>({p:n.position.clone(),q:n.quaternion.clone()}));
  const world=n=>n.getWorldPosition(new T.Vector3());
  const endAxes={};
  for(const side of ['L','R'])for(const part of ['Front','Back']){
    const lower=named[part+'LowerLeg.'+side],foot=named['IK'+part+'Leg.'+side];
    endAxes[part+side]=world(foot).sub(world(lower)).applyQuaternion(lower.getWorldQuaternion(new T.Quaternion()).invert());
  }
  function aim(bone,axis,direction){
    const q=bone.getWorldQuaternion(new T.Quaternion());
    const delta=new T.Quaternion().setFromUnitVectors(axis.clone().applyQuaternion(q).normalize(),direction.clone().normalize());
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(delta.multiply(q)));root.updateMatrixWorld(true);
  }
  function aimChild(bone,child,direction){aim(bone,child.position,direction);}
  function placeFoot(foot,target){foot.position.copy(foot.parent.worldToLocal(target));root.updateMatrixWorld(true);}
  named.Body.position.y-=1.8;root.updateMatrixWorld(true);
  for(const side of ['L','R']){
    const upper=named['FrontUpperLeg.'+side],lower=named['FrontLowerLeg.'+side],foot=named['IKFrontLeg.'+side];
    aimChild(upper,lower,new T.Vector3(0,-.36,.94));
    const direction=new T.Vector3(0,-.16,-.987).normalize();
    aim(lower,endAxes['Front'+side],direction);
    placeFoot(foot,world(lower).addScaledVector(direction,endAxes['Front'+side].length()));
    const hip=named['BackLeg.'+side],stifle=named['BackUpperLeg.'+side],hock=named['BackLowerLeg.'+side],backFoot=named['IKBackLeg.'+side];
    aimChild(hip,stifle,new T.Vector3(0,-.38,.925));
    aimChild(stifle,hock,new T.Vector3(0,-.54,-.842));
    const rearDirection=new T.Vector3(0,-.15,.989).normalize();
    aim(hock,endAxes['Back'+side],rearDirection);
    placeFoot(backFoot,world(hock).addScaledVector(rearDirection,endAxes['Back'+side].length()));
  }
  // Interpolate joint rotations, not flattened body geometry.
  nodes.forEach((n,i)=>{const q=n.quaternion.clone(),p=n.position.clone();n.quaternion.copy(saved[i].q).slerp(q,amount);n.position.copy(saved[i].p).lerp(p,amount);});
  root.updateMatrixWorld(true);
  // The foot controls are independent bones in this rig. Their positions must
  // follow the folded leg endpoints, not a straight lerp across the joint arc.
  for(const side of ['L','R'])for(const part of ['Front','Back']){
    const lower=named[part+'LowerLeg.'+side],foot=named['IK'+part+'Leg.'+side];
    const endpoint=endAxes[part+side].clone().applyQuaternion(lower.getWorldQuaternion(new T.Quaternion())).add(world(lower));
    placeFoot(foot,endpoint);
  }
}
for(const name of ['Idle','Walk','Eating','Idle_2','Idle_Headlow','Rest','LieDown','StandUp']){
  const custom=['Rest','LieDown','StandUp'].includes(name),oneShot=name==='LieDown'||name==='StandUp';
  const animation=gltf.animations.find(a=>a.name===(custom?'Idle':name));
  const tracks=animation.channels.map(c=>{
    const s=animation.samplers[c.sampler], path={translation:'position',rotation:'quaternion',scale:'scale'}[c.target.path];
    const C=c.target.path==='rotation'?T.QuaternionKeyframeTrack:T.VectorKeyframeTrack;
    return new C(nodes[c.target.node].uuid+'.'+path,accessor(s.input),accessor(s.output));
  });
  const clip=new T.AnimationClip(name,-1,tracks), action=mixer.clipAction(clip);
  mixer.stopAllAction();action.reset().play();
  const duration=oneShot?3.4:clip.duration,frames=Math.ceil(duration*30)+(oneShot?1:0),start=matrices.length/(skin.joints.length*16);
  clips[name]={start,frames,duration,oneShot};
  for(let f=0;f<frames;f++){
    const t=f/(oneShot?frames-1:frames);
    if(custom){
      // AnimationMixer skips writes when a sampled track has not changed.
      // Restore a clean source frame before authoring each custom pose so the
      // lowered body and relocated feet can never accumulate between samples.
      const source=idleFrames[oneShot?0:Math.floor(t*idleFrames.length)];
      nodes.forEach((n,i)=>{const p=source[i];n.position.fromArray(p,0);n.quaternion.fromArray(p,3);n.scale.fromArray(p,7);});
    }else{
      mixer.setTime(t*clip.duration);
      if(name==='Idle')idleFrames.push(nodes.map(n=>[...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()]));
    }
    root.updateMatrixWorld(true);
    if(custom)restingPose(name==='Rest'?1:smooth(name==='StandUp'?1-t:t));
    skin.joints.forEach((id,j)=>{mat.multiplyMatrices(nodes[id].matrixWorld,inverses[j]);matrices.push(...mat.elements);});
  }
}
// Compute the resting, skinned bounds, including the author's rest transforms.
const idle=clips.Idle.start*skin.joints.length*16, point=new T.Vector3(), out=new T.Vector3(), q=new T.Vector3();
const bounds=new T.Box3();
for(let i=0;i<geometry.position.length/3;i++){
  point.fromArray(geometry.position,i*3);out.set(0,0,0);
  for(let b=0;b<4;b++){
    const w=geometry.skinWeight[i*4+b];if(!w)continue;
    mat.fromArray(matrices,idle+geometry.skinIndex[i*4+b]*16);
    q.copy(point).applyMatrix4(mat).multiplyScalar(w);out.add(q);
  }
  bounds.expandByPoint(out);
}
const size=bounds.getSize(new T.Vector3()), centre=bounds.getCenter(new T.Vector3());
const scale=(model==='Bull'?2.9:2.65)/size.z;
const normalize=new T.Matrix4().makeRotationY(Math.PI/2).scale(new T.Vector3(scale,scale,scale));
const centreRot=new T.Vector3(centre.x,bounds.min.y,centre.z).applyMatrix4(normalize);
normalize.setPosition(-centreRot.x,-centreRot.y+.035,-centreRot.z);
// Fold normalization into every bone matrix, preserving the source geometry and skinning.
for(let i=0;i<matrices.length;i+=16){mat.fromArray(matrices,i).premultiply(normalize);mat.toArray(matrices,i);}
// Ground each complete custom pose. Joint arcs during folding need a different
// support height than a linear interpolation of the two endpoint heights.
for(const name of ['Rest','LieDown','StandUp']){
  const c=clips[name];
  for(let f=0;f<c.frames;f++){
    const start=(c.start+f)*skin.joints.length*16;
    let minY=Infinity,maxY=-Infinity;
    for(let i=0;i<geometry.position.length/3;i++){
      point.fromArray(geometry.position,i*3);out.set(0,0,0);
      for(let b=0;b<4;b++){
        const w=geometry.skinWeight[i*4+b];if(!w)continue;
        mat.fromArray(matrices,start+geometry.skinIndex[i*4+b]*16);out.add(q.copy(point).applyMatrix4(mat).multiplyScalar(w));
      }
      minY=Math.min(minY,out.y);maxY=Math.max(maxY,out.y);
    }
    if(!Number.isFinite(minY)||maxY-minY>size.y*scale+.15)throw new Error(`Invalid ${name} pose at frame ${f}`);
    for(let j=0;j<skin.joints.length;j++)matrices[start+j*16+13]+=.035-minY;
  }
}
const chunks=[], sections={};let offset=0;
for(const [name,data] of Object.entries({...geometry,poses:matrices})){
  const a=new Float32Array(data);sections[name]={offset,length:a.length};chunks.push(Buffer.from(a.buffer));offset+=a.byteLength;
}
await fs.writeFile(new URL(`farm/${model.toLowerCase()}.bin`,base),Buffer.concat(chunks));
await fs.writeFile(new URL(`farm/${model.toLowerCase()}.json`,base),JSON.stringify({bones:skin.joints.length,clips,sections,vertices:geometry.position.length/3,triangles:geometry.index.length/3,source:'Quaternius Ultimate Animated Animal Pack, CC0',strideSpeed:1.0}));
console.log(JSON.stringify({vertices:geometry.position.length/3,triangles:geometry.index.length/3,clips,bytes:offset,originalSize:size.toArray(),height:size.y*scale}));

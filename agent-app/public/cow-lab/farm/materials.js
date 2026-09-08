import * as T from 'three';

const noiseGLSL=`
varying vec3 farmSurfacePosition;
float farmHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yxz+33.33);return fract((p.x+p.y)*p.z);}
float farmNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(farmHash(i),farmHash(i+vec3(1,0,0)),f.x),mix(farmHash(i+vec3(0,1,0)),farmHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(farmHash(i+vec3(0,0,1)),farmHash(i+vec3(1,0,1)),f.x),mix(farmHash(i+vec3(0,1,1)),farmHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`;
export function farmMaterial(key,color){
 const wood=key.startsWith('wood'),roof=key.startsWith('roof'),leaf=key.startsWith('leaf'),metal=key==='metal'||key.startsWith('tank');
 const material=key==='water'?new T.MeshPhysicalMaterial({color:'#50777a',metalness:.15,roughness:.18,clearcoat:1,clearcoatRoughness:.08}):new T.MeshStandardMaterial({color,roughness:metal?.53:.95,metalness:metal?.3:0,flatShading:!leaf});
 if(key==='water')return material;
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 farmSurfacePosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nfarmSurfacePosition=(modelMatrix*vec4(position,1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+noiseGLSL).replace('#include <color_fragment>',`#include <color_fragment>
   vec3 p=farmSurfacePosition;
   float mottling=farmNoise(p*${leaf?'1.4':'.7'});
   float grain=farmNoise(p*vec3(${wood?'35.0,2.0,35.0':roof?'3.0,3.0,24.0':'12.0'}));
   diffuseColor.rgb*=.89+mottling*.16+grain*.08;
   ${leaf?'':`float dampBase=1.0-smoothstep(0.05,${wood?'1.1':'.8'},p.y);diffuseColor.rgb*=1.0-dampBase*.18;`}
  `);
 };
 material.customProgramCacheKey=()=>`farm-weather-${key}`;
 return material;
}

export function createWater(scene,x,z,length){
 const group=new T.Group();group.position.set(x,.685,z);
 const rings=new T.BufferGeometry(),vertices=[];
 for(const [cx,cz,r] of [[-length*.23,.08,.18],[length*.18,-.06,.22]]){
  for(let i=0;i<28;i++){
   const a=i/28*Math.PI*2,b=(i+1)/28*Math.PI*2;
   vertices.push(cx+Math.cos(a)*r,0,cz+Math.sin(a)*r,cx+Math.cos(b)*r,0,cz+Math.sin(b)*r);
  }
 }
 rings.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
 const lines=new T.LineSegments(rings,new T.LineBasicMaterial({color:'#bdcfc4',transparent:true,opacity:.3}));group.add(lines);scene.add(group);
 return group;
}

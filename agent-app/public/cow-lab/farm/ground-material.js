import * as T from 'three';

// Local CC0 scans from Poly Haven. Provenance and original URLs are stored in
// textures/ground/sources.json; the scene never calls an external asset service.
export async function createGroundMaterial(ground){
 const loader=new T.TextureLoader(),maps={};
 const files=['soil-color','soil-normal','soil-roughness','sward-color','sward-mask','sward-normal'];
 await Promise.all(files.map(async file=>{
  const map=await loader.loadAsync(new URL(`../textures/ground/${file}.jpg`,import.meta.url).href);
  map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=8;
  if(file.endsWith('-color'))map.colorSpace=T.SRGBColorSpace;
  maps[file]=map;
 }));
 const material=new T.MeshStandardMaterial({
  map:ground.map,bumpMap:ground.bumpMap,bumpScale:.025,
  normalMap:maps['soil-normal'],normalScale:new T.Vector2(.4,.4),roughness:.96
 });
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,{
   groundZones:{value:ground.zoneMap},groundMarks:{value:ground.marks},
   soilColor:{value:maps['soil-color']},soilNormal:{value:maps['soil-normal']},soilRoughness:{value:maps['soil-roughness']},
   swardColor:{value:maps['sward-color']},swardMask:{value:maps['sward-mask']},swardNormal:{value:maps['sward-normal']}
  });
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec2 groundXZ;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\ngroundXZ=vec2(position.x,-position.z);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec2 groundXZ;
   uniform sampler2D groundZones,groundMarks,soilColor,soilNormal,soilRoughness;
   uniform sampler2D swardColor,swardMask,swardNormal;
   float groundHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float groundNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(groundHash(i),groundHash(i+vec2(1,0)),f.x),mix(groundHash(i+vec2(0,1)),groundHash(i+vec2(1,1)),f.x),f.y);
   }
   vec4 groundSample(sampler2D imageMap,vec2 uv,vec2 dx,vec2 dy,vec2 cell,bool normalTexture){
    float angle=floor(groundHash(cell)*4.0)*1.57079632679;
    float c=cos(angle),s=sin(angle);mat2 rotation=mat2(c,s,-s,c);
    vec2 offset=vec2(groundHash(cell+17.1),groundHash(cell+63.7));
    vec4 value=textureGrad(imageMap,rotation*uv+offset,rotation*dx,rotation*dy);
    if(normalTexture){
     vec2 n=value.xy*2.0-1.0;
     value.xy=vec2(dot(rotation[0],n),dot(rotation[1],n))*.5+.5;
    }
    return value;
   }
   vec4 groundTile(sampler2D imageMap,vec2 uv,vec2 dx,vec2 dy,bool normalTexture){
    // Random offsets and quarter-turns on a triangular blend grid remove tiling.
    // Explicit derivatives keep sharpness stable at cell boundaries.
    vec2 lattice=mat2(1.0,0.0,-.577350269,1.154700538)*uv*.8;
    vec2 base=floor(lattice),f=fract(lattice),a,b,c;vec3 weights;
    if(f.x+f.y<1.0){a=base;b=base+vec2(1,0);c=base+vec2(0,1);weights=vec3(1.0-f.x-f.y,f.x,f.y);}
    else{a=base+vec2(1,1);b=base+vec2(0,1);c=base+vec2(1,0);weights=vec3(f.x+f.y-1.0,1.0-f.x,1.0-f.y);}
    weights=pow(weights,vec3(2.2));weights/=dot(weights,vec3(1));
    return groundSample(imageMap,uv,dx,dy,a,normalTexture)*weights.x+groundSample(imageMap,uv,dx,dy,b,normalTexture)*weights.y+groundSample(imageMap,uv,dx,dy,c,normalTexture)*weights.z;
   }
  `).replace('#include <map_fragment>',`#include <map_fragment>
   vec4 groundZone=texture2D(groundZones,vMapUv);
   vec2 soilUV=groundXZ/3.0,swardUV=groundXZ/2.0;
   // Derivatives are evaluated before branching. Covered soil does not need
   // colour/normal/roughness lookups, while the transition keeps both layers.
   vec2 soilDx=dFdx(soilUV),soilDy=dFdy(soilUV),swardDx=dFdx(swardUV),swardDy=dFdy(swardUV);
   vec2 marksDx=dFdx(vMapUv),marksDy=dFdy(vMapUv);
   // Vegetation covers soil in actual leaf shapes. Intermediate wear no longer
   // becomes a flat green/brown mix with a blurred painted border.
   float vegetation=1.0-groundZone.r;
   float turfDensity=pow(vegetation,1.8);
   float tuftNoise=.65*groundNoise(groundXZ*6.2)+.35*groundNoise(groundXZ*19.3+vec2(18.3,7.1));
   float worldPixel=max(length(dFdx(groundXZ)),length(dFdy(groundXZ)));
   float established=smoothstep(tuftNoise-.12,tuftNoise+.12,turfDensity);
   established=mix(established,smoothstep(.15,.85,turfDensity),smoothstep(.055,.18,worldPixel));
   established*=smoothstep(.01,.1,vegetation);
   float leafMask=groundTile(swardMask,swardUV,swardDx,swardDy,false).r;
   float fragments=smoothstep(.025,.62,vegetation)*(1.0-exp(-leafMask*4.5));
   float foliage=max(established,fragments);
   vec3 soilAlbedo=vec3(0),turfAlbedo=vec3(0);
   if(foliage<1.0){
    soilAlbedo=groundTile(soilColor,soilUV,soilDx,soilDy,false).rgb*vec3(1.02,.99,.94);
    soilAlbedo*=.60+groundZone.g*.72;
    soilAlbedo*=1.0-groundZone.b*.38;
    soilAlbedo*=mix(.72,1.0,textureGrad(groundMarks,vMapUv,marksDx,marksDy).r);
   }
   if(foliage>0.0){
    vec3 leafScan=groundTile(swardColor,swardUV,swardDx,swardDy,false).rgb;
    float leafLight=clamp(dot(leafScan,vec3(.21,.72,.07))*7.0,.42,1.35);
    turfAlbedo=diffuseColor.rgb*(.67+leafLight*.4);
    turfAlbedo=mix(turfAlbedo,leafScan*1.7,clamp(leafMask*1.4,0.0,.38));
   }
   diffuseColor.rgb=mix(soilAlbedo,turfAlbedo,foliage);
  `).replace('#include <normal_fragment_maps>',`
   vec3 groundN=vec3(0),leafN=vec3(0);
   if(foliage<1.0){groundN=groundTile(soilNormal,soilUV,soilDx,soilDy,true).xyz*2.0-1.0;groundN.xy*=.55*(1.0-groundZone.a*.38);}
   if(foliage>0.0){leafN=groundTile(swardNormal,swardUV,swardDx,swardDy,true).xyz*2.0-1.0;leafN.xy*=.63;}
   groundN=normalize(mix(groundN,leafN,foliage));
   normal=normalize(tbn*groundN);
   #ifdef USE_BUMPMAP
    normal=perturbNormalArb(-vViewPosition,normal,dHdxy_fwd(),faceDirection);
   #endif
  `).replace('#include <roughnessmap_fragment>',`
   float soilR=foliage<1.0?groundTile(soilRoughness,soilUV,soilDx,soilDy,false).r:1.0;
   float roughnessFactor=mix(.74+.24*soilR,.97,foliage);
   roughnessFactor*=1.0-groundZone.b*.17;
  `);
 };
 material.customProgramCacheKey=()=> 'farm-soil-and-groundcover-v6';
 return material;
}

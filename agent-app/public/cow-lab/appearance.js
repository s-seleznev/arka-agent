// Appearance v1: stable per animal ID, independent of order, filters and animation.
export function appearanceSeed(id){
 let hash=2166136261;
 for(const char of String(id)){hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;}
 return (hash%65521)/65521;
}
export const coatShader=`
varying vec3 coatPosition;
varying float coatSeed;
vec3 animalCoat(vec3 original){
 vec3 p=coatPosition;
 float seed=coatSeed*51.7;
 float pattern=sin(p.x*2.1+seed+sin(p.z*1.3))*sin(p.z*1.75-seed*.7)
              +.48*sin(p.y*2.6+seed*.4+p.x)+.22*sin(p.z*4.2+p.y*2.1+seed);
 float spot=smoothstep(.03,.15,pattern+(.5-coatSeed)*.35);
 vec3 white=vec3(.82,.80,.75)+coatSeed*.06;
 vec3 black=vec3(.019,.023,.026)+coatSeed*.016;
 vec3 color=mix(white,black,spot);
 // Preserve eyes; keep hooves and muzzle coherent across the herd and card.
 if(max(original.r,max(original.g,original.b))<.02)return original;
 if(p.y<.52)return black;
 if(p.z>4.4&&p.y<3.4)return vec3(.38,.25,.23);
 return color;
}
`;
export function applyAnimalAppearance(material,id){
 const seed=appearanceSeed(id);
 material.onBeforeCompile=shader=>{
  shader.uniforms.animalCoatSeed={value:seed};
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float animalCoatSeed; varying vec3 coatPosition; varying float coatSeed;').replace('void main() {','void main() {\ncoatPosition=position;coatSeed=animalCoatSeed;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+coatShader).replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb=animalCoat(diffuseColor.rgb);');
 };
 material.customProgramCacheKey=()=> 'animal-coat-v1';
 material.needsUpdate=true;
}

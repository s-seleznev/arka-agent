import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

export async function loadAnimal(kind) {
  const file = kind === 'bull' ? 'Bull' : 'Cow';
  const gltf = await new GLTFLoader().loadAsync(`./models/ultimate-animals/${file}.gltf`);
  const asset = gltf.scene;
  const mixer = new THREE.AnimationMixer(asset);
  const clips = Object.fromEntries(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
  clips.Idle.play();
  mixer.update(0);
  asset.updateMatrixWorld(true);

  // Preserve the author's proportions, skin weights and animation tracks.
  // Only orient, uniformly scale and centre the complete asset for the viewer.
  const originalBounds = new THREE.Box3().setFromObject(asset);
  asset.scale.setScalar(3.7 / originalBounds.getSize(new THREE.Vector3()).z);
  asset.rotation.y = Math.PI / 2;
  asset.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(asset);
  const centre = bounds.getCenter(new THREE.Vector3());
  const mount = new THREE.Group();
  mount.position.set(-centre.x, -bounds.min.y + .02, -centre.z);
  mount.add(asset);
  const root = new THREE.Group();
  root.add(mount);

  const originals = new Map();
  const clay = new THREE.MeshStandardMaterial({color:'#bba991', roughness:.95});
  asset.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    originals.set(node, node.material);
    node.frustumCulled = false;
  });
  let action = clips.Idle;
  const names = {idle:'Idle', walk:'Walk', slow:'Walk', graze:'Eating'};
  return {
    root,
    clay:false,
    animationNames:Object.keys(clips),
    setClay(value) {
      this.clay=value;
      originals.forEach((material, mesh) => { mesh.material=value?clay:material; });
    },
    reset() {
      mixer.stopAllAction();
      action = clips.Idle;
      action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      mixer.update(0);
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
    },
    update(dt, mode, speed = 0) {
      const next=clips[names[mode] || 'Idle'];
      if (next !== action) {
        next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
        next.crossFadeFrom(action, .4, false);
        action=next;
      }
      // Keep steps in sync when the animal slows down on a turn.
      if (action === clips.Walk) action.setEffectiveTimeScale(Math.max(.05, speed / 1.2));
      mixer.update(dt);
    },
  };
}

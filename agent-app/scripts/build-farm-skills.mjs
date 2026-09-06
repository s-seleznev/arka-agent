import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../lib/ai/farm-skills');
const read = path => readFileSync(resolve(root,path),'utf8');
const manifest = JSON.parse(read('manifest.json'));
assert.equal(manifest.length,8);
assert.equal(new Set(manifest.map(x=>x.id)).size,8);
const skills = manifest.map(entry=>{
  assert.match(entry.id,/^[a-z-]+$/);
  const instructions=read(`content/${entry.id}/SKILL.md`);
  assert.ok(instructions.includes(`name: ${entry.id}`));
  return {...entry,instructions};
});
const content=JSON.stringify({profile:JSON.parse(read('profile.json')),common:read('common.md'),skills},null,2)+'\n';
if(process.argv.includes('--check')) assert.equal(read('bundle.json'),content,'Skill bundle is stale; run npm run skills:build');
else writeFileSync(resolve(root,'bundle.json'),content);
console.log('8 farm skills: bundle ready');

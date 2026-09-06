import assert from 'node:assert/strict';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
async function main() {
 const { productClient } = await import('../lib/db/client');
 const { getFarmClient, getAccessibleFarms } = await import('../lib/farm/scope');
 const { getAuthorizedFieldRegistry } = await import('../lib/farm/registry');
 const { queryAnimals, getAnimalById } = await import('../lib/farm/queries');
 const sql=getFarmClient();
 try {
  const [user]=await productClient<{id:string}[]>`SELECT id FROM "User" ORDER BY "createdAt" DESC LIMIT 1`;
  assert(user);
  const farms=await getAccessibleFarms(user.id);
  assert.equal(farms.length,1); assert.equal(farms[0].id,process.env.FARM_ACTIVE_ID); assert.equal(farms[0].name,'Лактис Прайм 8');
  const registry=await getAuthorizedFieldRegistry(user.id);
  for(const field of Object.values(registry)) { if(field.farmIds) assert(field.farmIds.every(id=>id===farms[0].id)); assert(!field.label.includes('Тестовая ферма')); }
  const filters={id:'d4032934-a379-4587-958f-013237b9df88',kind:'group' as const,combinator:'and' as const,negated:false,children:[]};
  const page=await queryAnimals({userId:user.id,filters,columns:['primaryIdentifier'],limit:1});
  const [oracle]=await sql`SELECT count(*)::int n FROM animal_state_query WHERE farm_id=${farms[0].id}`;
  assert.equal(page.totalRows,oracle.n);
  const [foreign]=await sql`SELECT farm_id,animal_id FROM animal_state_query WHERE farm_id<>${farms[0].id} LIMIT 1`;
  assert(foreign);
  await assert.rejects(()=>queryAnimals({userId:user.id,columns:['primaryIdentifier'],filters:{...filters,children:[{id:'aab08976-c4af-4e89-95fa-b53b606fcbfe',kind:'condition',field:'farmId',operator:'eq',negated:false,value:{type:'string',value:foreign.farm_id}}]}}),/FARM_ACCESS_DENIED/);
  assert.equal(await getAnimalById({userId:user.id,animalId:foreign.animal_id}),null);
  const {getListRule}=await import('../lib/rules/store');
  const [foreignRule]=await productClient<{id:string}[]>`SELECT d.id FROM "RuleDefinition" d JOIN "RuleBinding" b ON b."ruleId"=d.id WHERE d."sourceCompanyId"<>'8' AND b."farmId"=${farms[0].id} LIMIT 1`;
  if(foreignRule) assert.equal(await getListRule({userId:user.id,ruleId:foreignRule.id}),null);
  console.log(JSON.stringify({passed:true,farms:farms.map(f=>f.name),fields:Object.keys(registry).length,totalRows:page.totalRows,foreignFarmDenied:true,foreignAnimalDenied:true,foreignSourceRuleDenied:true}));
 } finally {await sql.end();await productClient.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

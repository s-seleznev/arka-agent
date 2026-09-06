import {config} from 'dotenv';import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';config({path:'.env.local',quiet:true});
async function main(){
 const {productClient}=await import('../lib/db/client');const {getFarmClient}=await import('../lib/farm/scope');const {queryAnimals}=await import('../lib/farm/queries');
 const cases=JSON.parse(readFileSync(process.argv[2]||'/tmp/scenario-agent-results.json','utf8'));
 if(!process.argv[2])for(const [i,p] of [[1,'/tmp/scenario-bulls-final.json'],[4,'/tmp/scenario-inseminated-final.json'],[5,'/tmp/scenario-dry-final.json']] as const)cases[i]=JSON.parse(readFileSync(p,'utf8'))[0];
 const expected=[20,5,6,4,105,4,10,7];const required=[['lastBull','inseminationNumber','daysInMilk'],['dailyGainG','saleReadiness','birthDate'],['yesterdayMilkKg','lastClinicalEvent','animalNote'],['exitDaysInMilk','exitReason','exitDate'],['lastBull','lastTechnician','inseminationNumber'],['pregnancyDays','expectedCalvingDate','yesterdayMilkKg'],['ageMonths','lastWeightKg'],['activeProtocols','protocolProgress','nextProtocolDate','protocolResponsible']];
 try{const [user]=await productClient<{id:string}[]>`SELECT id FROM "User" ORDER BY "createdAt" DESC LIMIT 1`;
 for(let i=0;i<cases.length;i++){const c=cases[i];assert(c.view,c.error);for(const col of required[i])assert(c.view.columns.includes(col),`${i} missing ${col}`);
 const page=await queryAnimals({userId:user.id,filters:c.view.filters,columns:c.view.columns,groupBy:[],sort:c.view.sort,limit:200});assert.equal(page.totalRows,expected[i],`${i} count`);assert.equal(page.rows.length,expected[i]);
 for(const row of page.rows){assert.equal(row.farmId,process.env.FARM_ACTIVE_ID);for(const col of required[i])assert(row[col]!==null && row[col]!==undefined,`${i} empty ${col} ${row.primaryIdentifier}`);}
 if(i===1)assert.equal(page.rows.filter(r=>r.saleReadiness==='Готов').length,2);
 if(i===3)assert.deepEqual(page.rows.map(r=>Number(r.exitDaysInMilk)).sort((a,b)=>a-b),[12,31,44,55]);
 if([0,4,6].includes(i))assert.equal(c.view.groupBy[0].field,({0:'groupCode',4:'lastBull',6:'ageBand'} as any)[i]);
 c.verifiedRows=page.rows;c.passed=true;console.log(JSON.stringify({prompt:c.prompt,rows:page.totalRows,columns:c.view.columns,passed:true}));}
 writeFileSync('/tmp/eight-scenarios-verified.json',JSON.stringify(cases,null,2));
 }finally{await getFarmClient().end();await productClient.end();}
}main().catch(e=>{console.error(e);process.exitCode=1;});

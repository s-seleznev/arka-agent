import {config} from 'dotenv';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
config({path:'.env.local',quiet:true});
async function main(){
 const {createFarmTools}=await import('../lib/ai/tools/farm');const {productClient}=await import('../lib/db/client');const {getFarmClient}=await import('../lib/farm/scope');const {getSavedViewForChat}=await import('../lib/farm/views');const {deleteChatById}=await import('../lib/db/queries');const {configureTableSchema,compileSemanticView}=await import('../lib/farm/semantic-view');
 const chatId=randomUUID();const writes:any[]=[];
 const typed=compileSemanticView(configureTableSchema.parse({expectedRevision:null,filters:{combinator:'and',children:[{field:'birthDate',operator:'gte',value:'2025-01-01'},{field:'ageDays',operator:'between',value:[12,20]},{field:'sex',operator:'in',value:['FEMALE','MALE']},{field:'isExited',operator:'eq',value:false}]}}),randomUUID(),field=>field==='birthDate'?'date':'text');
 const nodes=(typed.filters!.children[1] as any).children;
 assert.deepEqual(nodes.map((n:any)=>n.value.type),['date','range','list','boolean']);
 try{const [user]=await productClient<{id:string}[]>`SELECT id FROM "User" ORDER BY "createdAt" DESC LIMIT 1`;
 const t=createFarmTools({chatId,userId:user.id,dataStream:{write(x:any){writes.push(x);}} as any});
 const call=async(x:any)=>await (t.configureAnimalTable.execute as any)(configureTableSchema.parse(x),{});
 const initial:any=await (t.getFarmSkill.execute as any)({skillId:'youngstock'},{});assert.equal(initial.workspace.revision,null);assert(initial.context.fields.some((x:any)=>x.id==='dailyGainG'));assert(initial.context.fields.length<107);
 const result=await call({expectedRevision:null,filters:{combinator:'or',children:[{combinator:'and',children:[{field:'sex',operator:'eq',value:{type:'string',value:'FEMALE'}},{field:'isExited',operator:'eq',value:{type:'boolean',value:false}}]},{field:'sex',operator:'eq',value:{type:'string',value:'MALE'}}]},columns:['primaryIdentifier','sex'],groupBy:[{field:'sex',direction:'asc'}],sort:[{field:'primaryIdentifier',direction:'asc'}]});
 assert.equal(result.verification.totalRows,165);assert.equal(result.view.filters.combinator,'and');assert.equal(result.view.filters.children[0].field,'farmId');assert.equal(result.view.filters.children[1].combinator,'or');
 const conflict=await call({expectedRevision:0,columns:['primaryIdentifier']});assert.equal(conflict.error,'VIEW_REVISION_CONFLICT');
 const revision=result.view.revision;
 await assert.rejects(()=>call({expectedRevision:revision,filters:{combinator:'and',children:[{field:'farmId',operator:'eq',value:{type:'string',value:randomUUID()}}]}}),/FARM_SCOPE_IS_SERVER_MANAGED/);
 await assert.rejects(()=>call({expectedRevision:revision,columns:['nonexistentField']}));
 assert.equal((await getSavedViewForChat({chatId,userId:user.id}))?.revision,revision);
 const update=await call({expectedRevision:revision,columns:['primaryIdentifier','ageDays']});assert.deepEqual(update.view.groupBy,result.view.groupBy);assert.deepEqual(update.view.sort,result.view.sort);assert.deepEqual(update.view.filters,result.view.filters);assert.equal(writes.filter(x=>x.type==='data-view-state').length,2);
 console.log(JSON.stringify({passed:true,nestedOrAnd:true,tenantGuard:true,revisionConflict:true,invalidRequestPreservesView:true,omittedSettingsPreserved:true,skillFields:initial.context.fields.length}));
 }finally{await deleteChatById({id:chatId});await getFarmClient().end();await productClient.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

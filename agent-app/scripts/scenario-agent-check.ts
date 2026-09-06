import { writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { tool } from 'ai';
import { z } from 'zod';
config({ path: '.env.local', quiet: true });
async function runCase(prompt:string) {
 const {productClient}=await import('../lib/db/client');
 const {getFarmClient}=await import('../lib/farm/scope');
 const {createFarmTools}=await import('../lib/ai/tools/farm');
 const {createDefaultView}=await import('../lib/farm/views');
 const {systemPrompt}=await import('../lib/ai/prompts');
 const {runCodexAppServerTurn}=await import('../lib/ai/codex-app-server');
 const events:{tool:string;durationMs:number;error:string|null}[]=[];
 const chatId=randomUUID();let answer='';let latest:any;const traces:any[]=[];
 const writer={write(event:any){if(event.type==='data-rule-trace')traces.push(event.data);if(event.type==='data-view-state')latest=event.data;}} as any;
 try {
  const [user]=await productClient<{id:string}[]>`SELECT id FROM "User" ORDER BY "createdAt" DESC LIMIT 1`;
  const tools = {
    ...createFarmTools({ userId: user.id, dataStream: writer, chatId }),
    openAnimalTable: tool({
      description: 'Open table for this chat with an authorized farm ID; returns its view and revision.',
      inputSchema: z.object({ farmId: z.uuid() }),
      execute: async ({ farmId }) => ({ view: await createDefaultView({ chatId, farmId, userId: user.id }) }),
    }),
  };
  const start=Date.now();
  await runCodexAppServerTurn({instructions:systemPrompt({supportsTools:true, requestHints: {latitude: undefined, longitude: undefined, city: undefined, country: undefined}}),prompt,tools,onTextDelta:t=>{answer+=t;},onToolComplete:e=>{events.push(e);}});
  const ms=Date.now()-start;
  if(!latest) throw new Error('No applied view: '+answer);

  assert(events.some(e=>e.tool==='getFarmSkill'));

  const { queryAnimals } = await import('../lib/farm/queries');
  const verified = await queryAnimals({userId:user.id,filters:latest.filters,columns:latest.columns,groupBy:latest.groupBy,sort:latest.sort});

  return {prompt,durationMs:ms,events,traces,answer,totalRows:verified.totalRows,view:latest,sample:verified};
 } finally { const {deleteChatById}=await import("../lib/db/queries"); await deleteChatById({id:chatId});  }
}
const prompts=['Кого нужно проверить на стельность?','Покажи бычков на продажу','Покажи новотельных для контроля','Кто выбыл до 60-го дня лактации?','Покажи коров с осеменениями по быкам','Кого пора запускать в сухостой?','Покажи тёлок старше 12 месяцев','Покажи животных в работе'];
async function main(){
 const selected=process.argv[2]? [prompts[Number(process.argv[2])]]:prompts;
 const output=process.argv[3] || '/tmp/scenario-agent-results.json';const results=[];
 for(const prompt of selected){try{const r=await runCase(prompt);results.push(r);console.log(JSON.stringify({prompt,total:r.totalRows,ms:r.durationMs,answer:r.answer}));}catch(e){results.push({prompt,error:String(e)});console.log(String(e));}writeFileSync(output,JSON.stringify(results,null,2));}
 const {getFarmClient}=await import('../lib/farm/scope');const {productClient}=await import('../lib/db/client');await getFarmClient().end();await productClient.end();
}
main().catch(e=>{console.error(e);process.exitCode=1;});

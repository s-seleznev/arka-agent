import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { tool } from 'ai';
import { z } from 'zod';
config({ path: '.env.local', quiet: true });
async function main() {
 const {productClient}=await import('../lib/db/client');
 const {getFarmClient}=await import('../lib/farm/scope');
 const {createFarmTools}=await import('../lib/ai/tools/farm');
 const {createDefaultView}=await import('../lib/farm/views');
 const {systemPrompt}=await import('../lib/ai/prompts');
 const {runCodexAppServerTurn}=await import('../lib/ai/codex-app-server');
 const events:{tool:string;durationMs:number;error:string|null}[]=[];
 const chatId=randomUUID();let answer='';let latest:any;
 const writer={write(event:any){if(event.type==='data-view-state')latest=event.data;}} as any;
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
  await runCodexAppServerTurn({instructions:systemPrompt({supportsTools:true, requestHints: {latitude: undefined, longitude: undefined, city: undefined, country: undefined}}),prompt:'Покажи животных на первую проверку стельности, сгруппируй по группе содержания',tools,onTextDelta:t=>{answer+=t;},onToolComplete:e=>{events.push(e);}});
  const ms=Date.now()-start;
  assert(latest,'No applied view');
  assert.equal(events.filter(e=>e.tool==='configureAnimalTable'&&!e.error).length,1,'Repeated mutations');
  assert(events.some(e=>e.tool==='getFarmSkill'));
  assert(ms<119000,'No latency improvement');
  const { queryAnimals } = await import('../lib/farm/queries');
  const verified = await queryAnimals({userId:user.id,filters:latest.filters,columns:latest.columns,groupBy:latest.groupBy,sort:latest.sort});
  assert(verified.totalRows > 0, 'Expected positive scenario animals');
  console.log(JSON.stringify({passed:true,durationMs:ms,events,answer,chatId,totalRows:verified.totalRows,revision:latest.revision},null,2));
 } finally { const {deleteChatById}=await import("../lib/db/queries"); await deleteChatById({id:chatId}); await getFarmClient().end();await productClient.end(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

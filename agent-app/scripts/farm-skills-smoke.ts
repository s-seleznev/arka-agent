import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
async function main() {
  const { productClient } = await import("../lib/db/client");
  const { getAccessibleFarms, queryAnimals } = await import("../lib/farm/queries");
  const { createDefaultView, getSavedView } = await import("../lib/farm/views");
  const { createFarmTools } = await import("../lib/ai/tools/farm");
  const { runCodexAppServerTurn } = await import("../lib/ai/codex-app-server");
  const { systemPrompt } = await import("../lib/ai/prompts");
  const [user] = await productClient<{ id: string }[]>`SELECT id FROM "User" ORDER BY "createdAt" DESC LIMIT 1`;
  assert(user);
  const farms = await getAccessibleFarms(user.id);
  assert(farms.length);
  if (process.argv.includes("--configure-local-profile")) {
    const p = ".env.local";
    const old = readFileSync(p,"utf8").replace(/^FARM_SKILL_PROFILE_(ID|FARM_IDS)=.*\n?/gm, "");
    writeFileSync(p, `${old.trimEnd()}\nFARM_SKILL_PROFILE_ID=lactis-prime-8\nFARM_SKILL_PROFILE_FARM_IDS=${farms.map(f=>f.id).join(",")}\n`);
    console.log(JSON.stringify({configuredProfile:"lactis-prime-8",farmCount:farms.length}));
    await productClient.end(); process.exit(0);
  }
  if (process.argv.includes("--verify-recorded")) {
    const reportPath="../analysis/lactis-prime-8/skill-smoke.json";
    const report=JSON.parse(readFileSync(reportPath,"utf8"));
    const farm=report.filters.children.find((x: {field?:string})=>x.field==="farmId").value.value;
    assert(farms.some(x=>x.id===farm));
    const {getFarmClient}=await import("../lib/farm/scope");
    const sql=getFarmClient();
    const [row]=await sql`SELECT count(*)::int AS count FROM animal_state_query WHERE farm_id=${farm} AND last_weight_kg>=500 AND last_weight_kg<=600`;
    assert.equal(row.count,report.totalRows);
    report.independentSqlCount=row.count;
    writeFileSync(reportPath,JSON.stringify(report,null,2));
    await sql.end();await productClient.end();
    console.log(JSON.stringify({independentSqlCount:row.count,passed:true}));process.exit(0);
  }
  const chatId = randomUUID();
  const calls: {name:string;input:unknown}[] = [];
  try {
    const view = await createDefaultView({chatId,farmId:farms[0].id,userId:user.id});
    const writer = { write: (_event: unknown) => {} };
    const farmTools = createFarmTools({userId:user.id,dataStream:writer as never,chatId});
    const tools = Object.fromEntries(Object.entries(farmTools).map(([name,value])=>[name,{
      ...value,
      execute:async(input:unknown, options:unknown)=>{
        calls.push({name,input});
        return (value.execute as Function)(input,options);
      },
    }]));
    let answer="";
    await runCodexAppServerTurn({
      instructions:systemPrompt({requestHints:{latitude:undefined,longitude:undefined,city:undefined,country:undefined},supportsTools:false,farmContext:JSON.stringify({view})}),
      prompt:"Покажи животных с последним весом от 500 до 600 кг включительно в текущей таблице. Сохрани ферму и прочие настройки. Выполни запрос, сообщи точное количество.",
      tools,onTextDelta:(s)=>{answer+=s;},
    });
    assert(calls.some(x=>x.name==="getFarmSkill"));
    assert(!calls.some(x=>x.name==="searchListRules"));
    assert(calls.some(x=>x.name==="updateView"));
    const saved = await getSavedView({id:view.id,userId:user.id}); assert(saved);
    assert.match(JSON.stringify(saved.filters),/lastWeightKg/);
    const result = await queryAnimals({columns:saved.columns,filters:saved.filters,userId:user.id,viewId:saved.id,ruleContext:saved.ruleContext});
    writeFileSync("../analysis/lactis-prime-8/skill-smoke.json",JSON.stringify({passed:true,calls,answer,totalRows:result.totalRows,filters:saved.filters},null,2));
    console.log(JSON.stringify({passed:true,calls:calls.map(x=>x.name),totalRows:result.totalRows}));
  } finally {
    await productClient`DELETE FROM "ReportView" WHERE "chatId"=${chatId}`;
    await productClient`DELETE FROM "Chat" WHERE id=${chatId}`;
    await productClient.end();
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e instanceof Error ? e.message : "SMOKE_FAILED");process.exit(1);});

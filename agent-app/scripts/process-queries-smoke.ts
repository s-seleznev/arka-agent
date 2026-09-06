import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import type { FilterCondition, FilterGroup, FilterOperator, FilterScalar, FilterValue } from "../lib/farm/types";

config({ path: ".env.local", quiet: true });

async function main() {
  const { productClient } = await import("../lib/db/client");
  const { getFarmClient } = await import("../lib/farm/scope");
  const { queryAnimals, summarizeAnimals } = await import("../lib/farm/queries");
  const { createFarmTools } = await import("../lib/ai/tools/farm");
  const sql = getFarmClient();
  try {
    const [user] = await productClient<{ id: string }[]>`SELECT id FROM "User" ORDER BY "createdAt" DESC LIMIT 1`;
    assert(user, "No local test user");
    const tools = createFarmTools({ userId: user.id, dataStream: { write() {} } as never });
    const invoke = async (name: keyof typeof tools, input: object) =>
      (tools[name].execute as Function)(input, { toolCallId: randomUUID(), messages: [] });
    const context = await invoke("getFarmContext", {});
    const farmId = context.farms[0]?.id;
    assert(farmId);
    const field = (code: string): string => {
      const found = context.fields.find((f: { sourceCode?: string }) => f.sourceCode === code);
      assert(found, `Missing dynamic field ${code}`);
      return found.id;
    };
    const c = (name: string, operator: FilterOperator, value?: FilterValue): FilterCondition =>
      ({ id: randomUUID(), kind: "condition", negated: false, field: name, operator, ...(value ? { value } : {}) });
    const n = (value: number): FilterScalar => ({ type: "number", value });
    const b = (value: boolean): FilterValue => ({ type: "boolean", value });
    const text = (value: string): FilterValue => ({ type: "string", value });
    // Each SQL oracle is written independently of the filter compiler.
    const cases = [
      { skill: "herd", scenario: "Female animals before first lactation", conditions: [c("sex", "eq", text("FEMALE")), c("lactationNumber", "eq", n(0))], where: "sex='FEMALE' AND lactation_number=0" },
      { skill: "reproduction", scenario: "Ovsynch day 10, not pregnant or barred, AI not completed", conditions: [c(field("CURRENT_OVSYNCH_DAY"), "eq", n(10)), c("isPregnant", "eq", b(false)), c("statusCode", "neq", text("DO_NOT_INSEMINATE")), c(field("CURRENT_OVSYNCH_AI_DATE"), "is_empty"), c("isExited", "eq", b(false))], where: "(rule_values->>'CURRENT_OVSYNCH_DAY')::numeric=10 AND NOT is_pregnant AND status_code<>'DO_NOT_INSEMINATE' AND rule_values->>'CURRENT_OVSYNCH_AI_DATE' IS NULL AND NOT is_exited" },
      { skill: "dry-off-calving", scenario: "Animals with an expected calving date", conditions: [c("expectedCalvingDate", "is_not_empty")], where: "expected_calving_date IS NOT NULL" },
      { skill: "vaccination", scenario: "Recorded BASE vaccination history (not a branded stage queue)", conditions: [c(field("LAST_BASE_VACCINATION_DATE"), "is_not_empty")], where: "rule_values->>'LAST_BASE_VACCINATION_DATE' IS NOT NULL" },
      { skill: "health", scenario: "Recorded mastitis history (not treatment prescription)", conditions: [c(field("LAST_MASTITIS_DIAGNOSIS_DATE"), "is_not_empty")], where: "rule_values->>'LAST_MASTITIS_DIAGNOSIS_DATE' IS NOT NULL" },
      { skill: "youngstock", scenario: "Last weight between 500 and 600 kg inclusive", conditions: [c("lastWeightKg", "between", { type: "range", lower: n(500), upper: n(600) })], where: "last_weight_kg BETWEEN 500 AND 600" },
      { skill: "culling", scenario: "Exited animals with recorded exit date", conditions: [c("isExited", "eq", b(true)), c(field("EXIT_DATE"), "is_not_empty")], where: "is_exited AND rule_values->>'EXIT_DATE' IS NOT NULL" },
      { skill: "milk", scenario: "Urea >=20 on the last two milk tests", conditions: [c(field("LAST_MILK_TEST_UREA"), "gte", n(20)), c(field("PREVIOUS_MILK_TEST_UREA"), "gte", n(20))], where: "(rule_values->>'LAST_MILK_TEST_UREA')::numeric>=20 AND (rule_values->>'PREVIOUS_MILK_TEST_UREA')::numeric>=20" },
    ];
    const results = [];
    for (const item of cases) {
      const skill = await invoke("getFarmSkill", { skillId: item.skill });
      assert.equal(skill.skill?.id, item.skill, JSON.stringify(skill));
      const filters: FilterGroup = { id: randomUUID(), kind: "group", negated: false, combinator: "and", children: [c("farmId", "eq", text(farmId)), ...item.conditions] };
      const page = await queryAnimals({ userId: user.id, filters, columns: ["primaryIdentifier"], limit: 50 });
      const summary = await summarizeAnimals({ userId: user.id, filters });
      const [oracle] = await sql.unsafe(`SELECT count(*)::int AS count FROM animal_state_query WHERE farm_id=$1 AND (${item.where})`, [farmId]);
      assert.equal(page.totalRows, oracle.count, item.skill);
      assert.equal(Number(summary.totalRows), oracle.count, `${item.skill}: summary`);
      results.push({ skill: item.skill, scenario: item.scenario, passed: true, count: oracle.count, filters });
    }
    const forbidden: FilterGroup = { id: randomUUID(), kind: "group", negated: false, combinator: "and", children: [c("farmId", "eq", text(randomUUID()))] };
    await assert.rejects(() => queryAnimals({ userId: user.id, filters: forbidden, columns: ["primaryIdentifier"] }), /FARM_ACCESS_DENIED/);
    const [countParity] = await sql`WITH snapshot AS (
      SELECT as_of,knowledge_at FROM animal_rule_projection_snapshot WHERE singleton
    ), events AS MATERIALIZED (
      SELECT e.* FROM snapshot p CROSS JOIN LATERAL effective_animal_events(p.as_of,p.knowledge_at) e
    ), calvings AS (
      SELECT animal_id,max(occurred_at) start FROM events WHERE event_code='CALVED' GROUP BY animal_id
    ), counts AS (
      SELECT e.animal_id,count(*) n FROM events e JOIN calvings c ON c.animal_id=e.animal_id
      WHERE e.event_code='INSEMINATED' AND e.occurred_at>=c.start GROUP BY e.animal_id
    ) SELECT count(*)::int animals,
      count(*) FILTER(WHERE (s.rule_values->>'INSEMINATION_COUNT_CURRENT_LACTATION')::numeric
        IS DISTINCT FROM coalesce(c.n,0))::int mismatches
      FROM animal_state_query s LEFT JOIN counts c ON c.animal_id=s.animal_id`;
    assert.equal(countParity.mismatches, 0, "Insemination counts disagree with source events");
    const report = { checkedAt: new Date().toISOString(), layer: "Skill tool + dynamic catalog + server query + independent projection SQL; NOT LLM e2e or complete business coverage", farmId, passed: true, deniedForeignFarm: true, sourceEventCountParity: countParity, results };
    writeFileSync("../analysis/lactis-prime-8/process-queries-smoke.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ passed: true, results: results.map(({ skill, count }) => ({ skill, count })), deniedForeignFarm: true }));
  } finally {
    await sql.end();
    await productClient.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "PROCESS_SMOKE_FAILED"); process.exitCode = 1; });

// biome-ignore-all lint/performance/noAwaitInLoops: Sequential requests measure concurrency one and warm-up order.
import { writeFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const { getAccessibleFarms, queryAnimals } = await import(
    "../lib/farm/queries"
  );
  const { searchListRules, getListRule } = await import("../lib/rules/store");
  const { compileListRule } = await import("../lib/rules/compiler");
  const { getAuthorizedFieldRegistry } = await import("../lib/farm/registry");
  const { createEmptyFilterGroup } = await import("../lib/farm/view-model");
  const userId = process.env.FARM_DEMO_SUBJECT_ID ?? "test-manager";
  const farms = await getAccessibleFarms(userId);
  const asOf = new Date().toISOString();
  const registry = await getAuthorizedFieldRegistry(userId, asOf);
  const cases = [
    {
      columns: ["primaryIdentifier", "lastWeightKg", "lastMilkKg"],
      filters: createEmptyFilterGroup(),
      groupBy: [],
      name: "all-authorized-farms",
      sort: [],
    },
  ] as Array<{
    name: string;
    columns: string[];
    filters: import("../lib/farm/types").FilterGroup;
    sort: import("../lib/farm/types").SortRule[];
    groupBy: import("../lib/farm/types").GroupRule[];
  }>;
  for (const listId of ["541", "4153", "1971"]) {
    const candidates = await searchListRules({ query: listId, userId });
    const candidate = candidates.find((c) => c.compileReady);
    if (!candidate) {
      throw new Error(`BENCHMARK_RULE_UNAVAILABLE:${listId}`);
    }
    const details = await getListRule({ ruleId: candidate.ruleId, userId });
    if (!details) {
      throw new Error("BENCHMARK_RULE_UNAVAILABLE");
    }
    const compiled = compileListRule(
      details.rule,
      details.bindings[0].config,
      registry
    );
    if (!compiled.patch?.columns || !compiled.patch.filters) {
      throw new Error("BENCHMARK_RULE_BLOCKED");
    }
    cases.push({
      columns: compiled.patch.columns,
      filters: compiled.patch.filters,
      groupBy: compiled.patch.groupBy ?? [],
      name: `source-${listId}`,
      sort: compiled.patch.sort ?? [],
    });
  }
  const results: Array<{
    name: string;
    totalRows: number;
    iterations: number;
    warmups: number;
    initialMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    withinOneSecond: boolean;
  }> = [];
  let snapshot: string | undefined;
  for (const sample of cases) {
    const durations: number[] = [];
    let totalRows = 0;
    let initialMs = 0;
    for (let iteration = 0; iteration < 45; iteration += 1) {
      const started = performance.now();
      const page = await queryAnimals({
        ...sample,
        asOf,
        fieldRegistry: registry,
        limit: 50,
        userId,
      });
      const elapsed = performance.now() - started;
      if (snapshot && snapshot !== page.snapshot) {
        throw new Error("BENCHMARK_SNAPSHOT_CHANGED");
      }
      ({ snapshot, totalRows } = page);
      if (iteration === 0) {
        initialMs = elapsed;
      }
      if (iteration >= 5) {
        durations.push(elapsed);
      }
    }
    durations.sort((a, b) => a - b);
    results.push({
      initialMs,
      iterations: 40,
      maxMs: durations[39],
      name: sample.name,
      p50Ms: durations[19],
      p95Ms: durations[37],
      totalRows,
      warmups: 5,
      withinOneSecond: durations[37] <= 1000,
    });
  }
  const report = {
    asOf,
    concurrency: 1,
    farms: farms.length,
    hardware: {
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      memoryBytes: os.totalmem(),
    },
    results,
    scope:
      "Local warm first-page/count/group query. Initial sample is not a guaranteed cold database cache. Not every blocked source family is representable.",
    snapshot,
  };
  writeFileSync(
    "../rules/benchmark.json",
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(JSON.stringify(results));
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "BENCHMARK_FAILED");
    process.exit(1);
  });

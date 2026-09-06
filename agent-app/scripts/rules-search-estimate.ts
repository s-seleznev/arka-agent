// biome-ignore-all lint/performance/noAwaitInLoops: bounded worker concurrency is intentional.
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { config } from "dotenv";
import Papa from "papaparse";

config({ path: ".env.local", quiet: true });
Object.assign(process.env, { NODE_ENV: "production" });
async function main() {
  const { searchListRules } = await import("../lib/rules/store");
  const { productClient } = await import("../lib/db/client");
  const { getFarmClient } = await import("../lib/farm/scope");
  const userId = process.env.FARM_DEMO_SUBJECT_ID;
  if (!userId) {
    throw new Error("QA_SUBJECT_REQUIRED");
  }
  const sourceRows = Papa.parse<Record<string, string>>(
    readFileSync("../data/lists.csv", "utf8"),
    { header: true, skipEmptyLines: true }
  ).data;
  const samples = Array.from({ length: 10 }, (_, i) => {
    const row = sourceRows[Math.round((i * (sourceRows.length - 1)) / 9)];
    return { companyId: row.company_id, listId: row.list_id };
  });
  const start = performance.now();
  const results: {
    companyId: string;
    listId: string;
    ms: number;
    found: boolean;
  }[] = [];
  try {
    for (let i = 0; i < samples.length; i += 4) {
      results.push(
        ...(await Promise.all(
          samples.slice(i, i + 4).map(async (s) => {
            const t = performance.now();
            const rows = await searchListRules({
              limit: 10,
              query: `${s.companyId}:${s.listId}`,
              userId,
            });
            return {
              ...s,
              found: rows.some(
                (r) =>
                  r.sourceCompanyId === s.companyId &&
                  r.sourceListId === s.listId
              ),
              ms: performance.now() - t,
            };
          })
        ))
      );
    }
    const elapsedMs = performance.now() - start;
    const report = {
      concurrency: 4,
      elapsedMs,
      estimated6735At4Ms: (elapsedMs / 10) * 6735,
      estimated6735At8Ms: ((elapsedMs / 10) * 6735) / 2,
      results,
      sampleCount: 10,
    };
    writeFileSync(
      "../rules/qa/search-exhaustive-estimate.json",
      `${JSON.stringify(report, null, 2)}\n`
    );
    console.log(JSON.stringify(report));
  } finally {
    await productClient.end();
    await getFarmClient().end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

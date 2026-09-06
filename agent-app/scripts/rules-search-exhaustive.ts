// biome-ignore-all lint/performance/noAwaitInLoops: bounded worker concurrency is intentional.
import { createHash } from "node:crypto";
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
  const raw = readFileSync("../data/lists.csv", "utf8");
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    throw new Error("CSV_PARSE_FAILED");
  }
  const source = parsed.data;
  const normal = (s: string) =>
    s.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru").replaceAll("ё", "е");
  const counts = new Map<string, number>();
  for (const row of source) {
    const n = normal(row.list_name);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const cases = [
    ...source.map((r) => ({
      companyId: r.company_id,
      kind: "exact_key",
      listId: r.list_id,
      query: `${r.company_id}:${r.list_id}`,
    })),
    ...source
      .filter(
        (r) => normal(r.list_name) && counts.get(normal(r.list_name)) === 1
      )
      .map((r) => ({
        companyId: r.company_id,
        kind: "unique_exact_name",
        listId: r.list_id,
        query: r.list_name,
      })),
  ];
  const start = performance.now();
  let next = 0;
  const results: Record<string, unknown>[] = [];
  const deadline = 110_000;
  try {
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next < cases.length && performance.now() - start < deadline) {
          const c = cases[next];
          next += 1;
          const t = performance.now();
          try {
            const rows = await searchListRules({
              limit: 20,
              query: c.query,
              userId,
            });
            results.push({
              ...c,
              first: rows[0]
                ? {
                    companyId: rows[0].sourceCompanyId,
                    listId: rows[0].sourceListId,
                  }
                : null,
              found: (c.kind === "exact_key" ? rows.slice(0, 1) : rows).some(
                (r) =>
                  r.sourceCompanyId === c.companyId &&
                  r.sourceListId === c.listId
              ),
              ms: performance.now() - t,
              returned: rows.length,
            });
          } catch (e) {
            results.push({
              ...c,
              error: e instanceof Error ? e.message : "unknown",
              found: false,
            });
          }
          if (results.length % 1000 === 0) {
            console.log(
              JSON.stringify({
                completed: results.length,
                elapsedMs: performance.now() - start,
                planned: cases.length,
              })
            );
          }
        }
      })
    );
    const failures = results.filter((r) => !r.found);
    const summary = {
      checked: results.length,
      concurrency: 8,
      elapsedMs: performance.now() - start,
      exactKeys: results.filter((r) => r.kind === "exact_key").length,
      failed: failures.length,
      planned: cases.length,
      sourceRows: source.length,
      uniqueNames: results.filter((r) => r.kind === "unique_exact_name").length,
      unrun: cases.length - results.length,
    };
    writeFileSync(
      "../rules/search-exhaustive-audit.json",
      `${JSON.stringify(
        {
          failures,
          results,
          scope:
            "Actual shared searchListRules calls with real farm grants; no SQL-count surrogate or LLM",
          sourceSha256: createHash("sha256").update(raw).digest("hex"),
          storeSha256: createHash("sha256")
            .update(readFileSync("lib/rules/store.ts"))
            .digest("hex"),
          summary,
          verifiedAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    );
    console.log(JSON.stringify(summary));
  } finally {
    await productClient.end();
    await getFarmClient().end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

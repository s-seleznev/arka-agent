/** Run with NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/rules-query-audit.ts. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { config } from "dotenv";
import postgres from "postgres";
import { queryAnimals, summarizeAnimals } from "../lib/farm/queries";
import { getAuthorizedFieldRegistry } from "../lib/farm/registry";
import type { FilterGroup, RuleContext } from "../lib/farm/types";
import { compileListRule } from "../lib/rules/compiler";
import type { NormalizedRule, RuleBinding } from "../lib/rules/source-types";

config({ path: ".env.local", quiet: true });
const controls = new Set(["20/541", "3/197", "22/4153", "17/3785"]);
const controlsOnly = process.argv.includes("--controls");
const output = resolve(
  process.cwd(),
  `../rules/query-coverage${controlsOnly ? "-controls" : ""}.json`
);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const implementationHashes = () =>
  Object.fromEntries(
    [
      "lib/rules/compiler.ts",
      "lib/rules/mapping.ts",
      "lib/farm/queries.ts",
      "lib/farm/sql.ts",
      "lib/farm/fields.ts",
      "lib/farm/registry.ts",
      "lib/farm/scope.ts",
    ].map((path) => [
      path,
      hash(readFileSync(resolve(process.cwd(), path), "utf8")),
    ])
  );
const implementationAtStart = implementationHashes();
const auditUuid = (value: string) => {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const safeError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message : "UNKNOWN_QUERY_FAILURE";
  // Report errors without leaking a connection URL or credentials.
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database URL redacted]")
    .slice(0, 1000);
};

type DemoBindings = {
  version: string;
  provenance: string;
  policies: Pick<
    RuleBinding,
    | "rootPolicy"
    | "vitalityPolicy"
    | "nullPolicy"
    | "emptySelectionPolicy"
    | "emptyColumnsPolicy"
  >;
  companyFarms: Record<string, string>;
  fieldBindings?: Record<string, string>;
};
type Result = {
  companyId: string;
  listId: string;
  definitionId: string;
  farmId: string;
  compiled: boolean;
  execution: "blocked" | "passed" | "failed";
  diagnostics: string[];
  totalRows?: number;
  summaryRows?: number;
  durationMs?: number;
  pageKind?: string;
  totalGroups?: number;
  snapshot?: string;
  independentCount?: number;
  independentScope?: string;
  error?: string;
};

async function main() {
  assert(process.env.FARM_DATABASE_URL, "FARM_DATABASE_NOT_CONFIGURED");
  const db = postgres(process.env.FARM_DATABASE_URL, {
    idle_timeout: 5,
    max: 1,
  });
  try {
    const normalizedText = readFileSync(
      resolve(process.cwd(), "../rules/normalized.jsonl"),
      "utf8"
    );
    const records = normalizedText
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as NormalizedRule);
    const configText = readFileSync(
      resolve(process.cwd(), "../rules/demo-bindings.json"),
      "utf8"
    );
    const demo = JSON.parse(configText) as DemoBindings;
    assert(
      demo.provenance.startsWith("SIMULATION:"),
      "EXPLICIT_DEMO_PROVENANCE_REQUIRED"
    );
    const userId = process.env.FARM_DEMO_SUBJECT_ID ?? "test-manager";
    const [marker] = await db<
      { asOf: string; stale: boolean; formulaVersion: string }[]
    >`
      SELECT as_of::text AS "asOf", stale, formula_version AS "formulaVersion"
      FROM animal_rule_projection_snapshot WHERE singleton`;
    assert(marker && !marker.stale, "RULE_PROJECTION_STALE");
    const asOf = new Date(marker.asOf).toISOString();
    const registry = await getAuthorizedFieldRegistry(userId, asOf);
    const results: Result[] = [];
    const nullChecks: Array<{
      name: string;
      expected: number;
      actual: number;
      passed: boolean;
    }> = [];
    let commonSnapshot: string | undefined;
    const independent = async (
      independentFarmId: string,
      predicate: string
    ) => {
      // These predicates are hand-written below, never taken from CSV or the compiler.
      const [row] = await db.unsafe<{ count: string }[]>(
        `SELECT count(*)::text AS count FROM animal_state_query s JOIN farm f ON f.id=s.farm_id WHERE s.farm_id=$1::uuid AND (${predicate})`,
        [independentFarmId, asOf].slice(0, predicate.includes("$2") ? 2 : 1)
      );
      return Number(row.count);
    };
    const independentControls: Record<
      string,
      { predicate: string; scope: string }
    > = {
      "3/197": {
        predicate:
          "s.lactation_number>0 AND (s.rule_values->>'SECOND_INSEMINATION_DATE_CURRENT_LACTATION')::date >= ($2::timestamptz AT TIME ZONE f.timezone)::date-365",
        scope:
          "Selection conditions only; unmapped lactation-group column still blocks the full rule.",
      },
      "20/541": {
        predicate:
          "s.rule_values->>'LIFE_STATE'='ACTIVE' AND (((s.rule_values->>'DAYS_ON_PRESYNCH')::integer=36 AND s.status_code IN('FRESH','READY_FOR_INSEMINATION')) OR ((s.rule_values->>'DAYS_SINCE_INSEMINATION')::integer BETWEEN 42 AND 48 AND s.status_code IN('READY_FOR_INSEMINATION','FRESH')))",
        scope:
          "Full source predicate, including both OR branches and explicit demo ACTIVE policy.",
      },
      "22/4153": {
        predicate:
          "s.rule_values->>'LIFE_STATE'='ACTIVE' AND s.rule_values->>'GENOMIC_EVALUATION_DATE' IS NOT NULL",
        scope: "Full source predicate and explicit demo ACTIVE policy.",
      },
    };
    const context = (
      record: NormalizedRule,
      snapshot: string
    ): RuleContext => ({
      asOf,
      bindingId: randomUUID(),
      bindingVersion: demo.version,
      modified: false,
      parameters: {},
      ruleId: auditUuid(record.source.definitionId),
      ruleVersion: record.source.snapshotSha256,
      snapshot,
    });
    const writeReport = (complete: boolean) => {
      const report = {
        asOf,
        bindingConfigSha256: hash(configText),
        bindingProvenance: demo.provenance,
        bindingVersion: demo.version,
        blocked: results.filter((r) => r.execution === "blocked").length,
        compiled: results.filter((r) => r.compiled).length,
        complete,
        controls: results.filter((r) =>
          controls.has(`${r.companyId}/${r.listId}`)
        ),
        customFieldCoverage:
          "Migration 016 projects all effective registered custom fields and resolves calculated FIELD dependencies; six existing farm-specific TEMPERAMENT_SCORE values independently validated.",
        executionFailed: results.filter((r) => r.execution === "failed").length,
        executionPassed: results.filter((r) => r.execution === "passed").length,
        executionTimingMs: (() => {
          const rows = results
            .filter((r) => r.execution === "passed")
            .sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0));
          const at = (p: number) =>
            rows[Math.max(0, Math.ceil(rows.length * p) - 1)];
          return { max: rows.at(-1), p50: at(0.5), p95: at(0.95) };
        })(),
        formulaVersion: marker.formulaVersion,
        implementationChangedDuringRun:
          JSON.stringify(implementationHashes()) !==
          JSON.stringify(implementationAtStart),
        implementationSha256: implementationAtStart,
        normalizedSha256: hash(normalizedText),
        nullChecks,
        openGaps: [
          "Original-source day origin, life-state meaning, unresolved source fields and segment semantics remain open; demo policies are explicit assumptions.",
        ],
        processedRecords: results.length,
        results,
        scope:
          "Read-only execution audit on synthetic farm facts. Count/page/summary agreement is not exhaustive independent semantic or visual validation.",
        selectedRecords: controlsOnly ? 4 : records.length,
        snapshot: commonSnapshot,
        totalSourceRecords: records.length,
      };
      writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
      return report;
    };
    // Prioritize controls, then retain source row order for the rest.
    const selected = records
      .filter(
        (r) =>
          !controlsOnly ||
          controls.has(`${r.source.companyId}/${r.source.listId}`)
      )
      .sort(
        (a, b) =>
          Number(controls.has(`${b.source.companyId}/${b.source.listId}`)) -
          Number(controls.has(`${a.source.companyId}/${a.source.listId}`))
      );
    for (const record of selected) {
      const key = `${record.source.companyId}/${record.source.listId}`;
      const farmId = demo.companyFarms[record.source.companyId];
      const binding: RuleBinding = {
        ...demo.policies,
        farmId,
        fieldBindings: demo.fieldBindings,
        parameters: {},
        sourceCompanyId: record.source.companyId,
        version: demo.version,
      };
      const compiled = compileListRule(record, binding, registry);
      const result: Result = {
        companyId: record.source.companyId,
        compiled: !!compiled.patch,
        definitionId: record.source.definitionId,
        diagnostics: [...new Set(compiled.diagnostics.map((d) => d.code))],
        execution: "blocked",
        farmId,
        listId: record.source.listId,
      };
      if (independentControls[key]) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential audit avoids load-dependent timing bias.
        result.independentCount = await independent(
          farmId,
          independentControls[key].predicate
        );
        result.independentScope = independentControls[key].scope;
      }
      if (compiled.patch) {
        const start = performance.now();
        try {
          assert(compiled.patch.filters && compiled.patch.columns);
          const page = await queryAnimals({
            asOf,
            columns: compiled.patch.columns,
            filters: compiled.patch.filters,
            groupBy: compiled.patch.groupBy ?? [],
            limit: 1,
            sort: compiled.patch.sort ?? [],
            userId,
          });
          const summary = await summarizeAnimals({
            filters: compiled.patch.filters,
            ruleContext: context(record, page.snapshot),
            userId,
          });
          commonSnapshot ??= page.snapshot;
          assert.equal(page.snapshot, commonSnapshot, "AUDIT_SNAPSHOT_CHANGED");
          assert.equal(page.asOf, asOf, "QUERY_AS_OF_CHANGED");
          assert.equal(
            page.totalRows,
            summary.totalRows,
            "PAGE_SUMMARY_COUNT_MISMATCH"
          );
          if (result.independentCount !== undefined) {
            assert.equal(
              page.totalRows,
              result.independentCount,
              "INDEPENDENT_SQL_COUNT_MISMATCH"
            );
          }
          Object.assign(result, {
            execution: "passed",
            pageKind: page.kind,
            snapshot: page.snapshot,
            summaryRows: summary.totalRows,
            totalGroups: page.totalGroups,
            totalRows: page.totalRows,
          });
        } catch (error) {
          result.execution = "failed";
          result.error = safeError(error);
        }
        result.durationMs = Number((performance.now() - start).toFixed(2));
      }
      results.push(result);
      if (results.length % 100 === 0) {
        writeReport(false);
        console.log(
          JSON.stringify({
            failed: results.filter((r) => r.execution === "failed").length,
            passed: results.filter((r) => r.execution === "passed").length,
            processed: results.length,
          })
        );
      }
    }
    const farmId = demo.companyFarms["17"];
    for (const test of [
      {
        name: "neq excludes NULL",
        negated: false,
        operator: "neq" as const,
        predicate:
          "(s.rule_values->>'FORECAST_305M_CURRENT_LACTATION')::numeric<>5000",
      },
      {
        name: "NOT eq excludes NULL",
        negated: true,
        operator: "eq" as const,
        predicate:
          "NOT ((s.rule_values->>'FORECAST_305M_CURRENT_LACTATION')::numeric=5000)",
      },
      {
        name: "is_empty includes only NULL",
        negated: false,
        operator: "is_empty" as const,
        predicate: "s.rule_values->>'FORECAST_305M_CURRENT_LACTATION' IS NULL",
      },
    ]) {
      const filters: FilterGroup = {
        children: [
          {
            field: "farmId",
            id: randomUUID(),
            kind: "condition",
            negated: false,
            operator: "eq",
            value: { type: "string", value: farmId },
          },
          {
            field: "forecast305M",
            id: randomUUID(),
            kind: "condition",
            negated: test.negated,
            operator: test.operator,
            ...(test.operator === "is_empty"
              ? {}
              : { value: { type: "decimal" as const, value: "5000" } }),
          },
        ],
        combinator: "and",
        id: randomUUID(),
        kind: "group",
        negated: false,
      };
      // biome-ignore lint/performance/noAwaitInLoops: compare each independent SQL case before its application query.
      const expected = await independent(farmId, test.predicate);
      const page = await queryAnimals({
        asOf,
        columns: ["primaryIdentifier", "forecast305M"],
        filters,
        limit: 1,
        userId,
      });
      nullChecks.push({
        actual: page.totalRows,
        expected,
        name: test.name,
        passed: page.totalRows === expected,
      });
    }
    const report = writeReport(true);
    console.log(
      JSON.stringify({
        blocked: report.blocked,
        compiled: report.compiled,
        failed: report.executionFailed,
        nullChecks,
        output,
        passed: report.executionPassed,
      })
    );
    if (
      report.executionFailed ||
      report.implementationChangedDuringRun ||
      nullChecks.some((c) => !c.passed)
    ) {
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});

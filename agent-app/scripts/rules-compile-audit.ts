import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

import { compileListRule } from "../lib/rules/compiler";
import type { NormalizedRule, RuleBinding } from "../lib/rules/source-types";

async function main() {
  const { getAuthorizedFieldRegistry } = await import("../lib/farm/registry");
  const { getFarmClient } = await import("../lib/farm/scope");
  try {
    if (!process.env.FARM_DEMO_SUBJECT_ID) {
      throw new Error("DEMO_SUBJECT_REQUIRED");
    }
    const registry = await getAuthorizedFieldRegistry(
      process.env.FARM_DEMO_SUBJECT_ID
    );
    const demoText = readFileSync("../rules/demo-bindings.json", "utf8");
    const demo = JSON.parse(demoText);
    const source = readFileSync(
      resolve(process.cwd(), "../rules/normalized.jsonl"),
      "utf8"
    );
    const records = source
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as NormalizedRule);
    const rows = [
      "snapshot_sha256,company_id,list_id,compile_only,query_verified,diagnostic_codes",
    ];
    const counts: Record<string, number> = {};
    let compiled = 0;
    for (const record of records) {
      const binding: RuleBinding = {
        ...demo.policies,
        farmId: demo.companyFarms[record.source.companyId],
        fieldBindings: demo.fieldBindings,
        parameters: {},
        sourceCompanyId: record.source.companyId,
        version: demo.version,
      };
      const result = compileListRule(record, binding, registry);
      if (result.patch) {
        compiled += 1;
      }
      const codes = [...new Set(result.diagnostics.map((d) => d.code))].sort();
      for (const code of codes) {
        counts[code] = (counts[code] ?? 0) + 1;
      }
      rows.push(
        [
          record.source.snapshotSha256,
          record.source.companyId,
          record.source.listId,
          result.patch ? "true" : "false",
          "false",
          `"${JSON.stringify(codes).replaceAll('"', '""')}"`,
        ].join(",")
      );
    }
    writeFileSync(
      resolve(process.cwd(), "../rules/compiler-coverage.csv"),
      `${rows.join("\n")}\n`
    );
    const report = {
      bindingConfigSha256: createHash("sha256").update(demoText).digest("hex"),
      bindingVersion: demo.version,
      compiled,
      diagnosticRecordCounts: Object.fromEntries(Object.entries(counts).sort()),
      displayVerified: 0,
      implementationSha256: Object.fromEntries(
        [
          "lib/rules/compiler.ts",
          "lib/rules/mapping.ts",
          "lib/farm/view-model.ts",
          "lib/farm/types.ts",
          "lib/farm/fields.ts",
          "lib/farm/registry.ts",
        ].map((path) => [
          path,
          createHash("sha256")
            .update(readFileSync(resolve(process.cwd(), path)))
            .digest("hex"),
        ])
      ),
      normalizedSha256: createHash("sha256").update(source).digest("hex"),
      queryVerified: 0,
      records: records.length,
      registrySha256: createHash("sha256")
        .update(JSON.stringify(registry))
        .digest("hex"),
      scope:
        "compile-only with authorized dynamic registry; synthetic binding policies are not confirmed source semantics",
    };
    writeFileSync(
      resolve(process.cwd(), "../rules/compiler-audit.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    console.log(JSON.stringify(report));
  } finally {
    await getFarmClient().end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "COMPILE_AUDIT_FAILED"
  );
  process.exitCode = 1;
});

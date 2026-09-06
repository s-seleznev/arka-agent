import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import type { NormalizedRule } from "../lib/rules/source-types";

config({ path: ".env.local", quiet: true });
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function stableId(value: string) {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function main() {
  if (process.argv.slice(2).join(" ") !== "--verify-idempotency") {
    throw new Error("EXPLICIT_VERIFY_IDEMPOTENCY_FLAG_REQUIRED");
  }
  // Reuses the transactional importer; conflicts never overwrite immutable data.
  const repeat = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/rules-import.ts",
        "--write",
      ],
      { encoding: "utf8" }
    ).trim()
  );
  if (
    repeat.definitionsBefore !== 6735 ||
    repeat.definitionsAfter !== 6735 ||
    repeat.bindingsAfter !== 6735
  ) {
    throw new Error("IDEMPOTENCY_FAILED");
  }
  const { productClient } = await import("../lib/db/client");
  try {
    const results: Array<{
      snapshotId: string;
      parserVersion: string;
      sourceSha256: string;
      normalizedSha256: string;
      definitions: number;
      bindings: number;
      bindingVersions: Record<string, number>;
      exactDefinitionReadback: boolean;
      definitionDigestSha256: string;
      retained: boolean;
    }> = [];
    for (const [parserVersion, path] of [
      ["csv-rules-text/v1", "../.local/rules-parser-v1/normalized.jsonl"],
      ["csv-rules-text/v2", "../rules/normalized.jsonl"],
    ]) {
      const bytes = readFileSync(path);
      const records: NormalizedRule[] = bytes
        .toString("utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
      const sourceSha256 = records[0].source.snapshotSha256;
      const snapshotId = stableId(
        `RuleSourceSnapshot:${sourceSha256}:${parserVersion}`
      );
      const expected = new Map(
        records.map((record) => [
          stableId(
            `RuleDefinition:${snapshotId}:${record.source.companyId}:${record.source.listId}`
          ),
          hash(canonical(record)),
        ])
      );
      const snapshots =
        // biome-ignore lint/performance/noAwaitInLoops: Snapshot readback stays sequential.
        await productClient`SELECT sha256,"parserVersion","rowCount" FROM "RuleSourceSnapshot" WHERE id=${snapshotId}`;
      const rows =
        await productClient`SELECT id,"contentHash",normalized FROM "RuleDefinition" WHERE "snapshotId"=${snapshotId} ORDER BY id`;
      const counts =
        await productClient`SELECT b.version,count(*)::int AS count FROM "RuleBinding" b JOIN "RuleDefinition" d ON d.id=b."ruleId" WHERE d."snapshotId"=${snapshotId} GROUP BY b.version ORDER BY b.version`;
      if (
        snapshots.length !== 1 ||
        snapshots[0].sha256 !== sourceSha256 ||
        snapshots[0].parserVersion !== parserVersion ||
        snapshots[0].rowCount !== 6735 ||
        rows.length !== expected.size ||
        counts.length === 0 ||
        counts.some((row) => row.count !== 6735) ||
        rows.some(
          (row) =>
            expected.get(row.id) !== row.contentHash ||
            hash(canonical(row.normalized)) !== row.contentHash
        )
      ) {
        throw new Error("SNAPSHOT_READBACK_MISMATCH");
      }
      results.push({
        bindings: counts.reduce((n, row) => n + row.count, 0),
        bindingVersions: Object.fromEntries(
          counts.map((row) => [row.version, row.count])
        ),
        definitionDigestSha256: hash(
          rows.map((row) => `${row.id}:${row.contentHash}`).join("\n")
        ),
        definitions: rows.length,
        exactDefinitionReadback: true,
        normalizedSha256: hash(bytes),
        parserVersion,
        retained: true,
        snapshotId,
        sourceSha256,
      });
    }
    const result = {
      scope:
        "Local product database import and immutable content readback only. Does not establish query, original-source semantic or UI verification.",
      snapshots: results,
      totalBindings: results.reduce((n, row) => n + row.bindings, 0),
      totalDefinitions: results.reduce((n, row) => n + row.definitions, 0),
      v2Idempotency: { passed: true, ...repeat },
      verifiedAt: new Date().toISOString(),
    };
    writeFileSync(
      "../rules/import-verification.json",
      `${JSON.stringify(result, null, 2)}\n`
    );
    console.log(JSON.stringify(result));
  } finally {
    await productClient.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "IMPORT_VERIFICATION_FAILED"
  );
  process.exitCode = 1;
});

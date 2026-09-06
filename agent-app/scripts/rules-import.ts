import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import Papa from "papaparse";
import postgres from "postgres";
import { z } from "zod";
import type { FieldRegistry } from "../lib/farm/fields";
import { compileListRule } from "../lib/rules/compiler";
import type { NormalizedRule, RuleBinding } from "../lib/rules/source-types";

loadEnv({ path: ".env.local", quiet: true });
const EXPECTED_SHA =
  "5718a05d135123c7f9eaafb8ac5039494fe1b2d60abac86c1159ecb224749d0e";
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
const demoSchema = z.object({
  companyFarms: z.record(z.string(), z.uuid()),
  fieldBindings: z.record(z.string(), z.string()).optional(),
  policies: z.object({
    emptyColumnsPolicy: z
      .literal("mandatory_identity_if_source_empty")
      .optional(),
    emptySelectionPolicy: z.literal("no_predicate"),
    nullPolicy: z.literal("sql_null"),
    rootPolicy: z.literal("flat_and"),
    vitalityPolicy: z.literal("life_state"),
  }),
  provenance: z.string().startsWith("SIMULATION:"),
  version: z.string().min(1),
});

function prepare(registry: FieldRegistry) {
  const source = readFileSync(resolve(process.cwd(), "../data/lists.csv"));
  if (hash(source) !== EXPECTED_SHA) {
    throw new Error("SOURCE_CHECKSUM_MISMATCH");
  }
  const manifest = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../rules/source-manifest.json"),
      "utf8"
    )
  );
  const normalizedText = readFileSync(
    resolve(process.cwd(), "../rules/normalized.jsonl"),
    "utf8"
  );
  if (hash(normalizedText) !== manifest.artifacts["normalized.jsonl"].sha256) {
    throw new Error("NORMALIZED_CHECKSUM_MISMATCH");
  }
  const parsedCsv = Papa.parse<Record<string, string>>(
    source.toString("utf8"),
    { header: true, skipEmptyLines: true }
  );
  if (
    parsedCsv.errors.length ||
    parsedCsv.data.length !== 6735 ||
    parsedCsv.meta.fields?.length !== 18
  ) {
    throw new Error("SOURCE_CSV_INVALID");
  }
  const records: NormalizedRule[] = normalizedText
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (records.length !== 6735 || manifest.recordCount !== records.length) {
    throw new Error("SOURCE_RECORD_COUNT_MISMATCH");
  }
  const demo = demoSchema.parse(
    JSON.parse(
      readFileSync(
        resolve(process.cwd(), "../rules/demo-bindings.json"),
        "utf8"
      )
    )
  );
  const parserVersion = manifest.parserVersion as string;
  const snapshotId = stableId(
    `RuleSourceSnapshot:${EXPECTED_SHA}:${parserVersion}`
  );
  const version = `${EXPECTED_SHA}:${parserVersion}`;
  const sourceKeys = new Set<string>();
  const definitions = records.map((record, index) => {
    if (
      canonical(record.raw) !== canonical(parsedCsv.data[index]) ||
      record.source.snapshotSha256 !== EXPECTED_SHA ||
      record.parserVersion !== parserVersion ||
      record.source.rowNumber !== index + 1 ||
      record.source.companyId !== record.raw.company_id ||
      record.source.listId !== record.raw.list_id ||
      record.source.definitionId !==
        `${EXPECTED_SHA}:${record.raw.company_id}:${record.raw.list_id}`
    ) {
      throw new Error("NORMALIZED_SOURCE_MISMATCH");
    }
    const key = `${record.source.companyId}:${record.source.listId}`;
    if (sourceKeys.has(key)) {
      throw new Error("DUPLICATE_SOURCE_KEY");
    }
    sourceKeys.add(key);
    return {
      contentHash: hash(canonical(record)),
      description: record.raw.description,
      id: stableId(`RuleDefinition:${snapshotId}:${key}`),
      name: record.raw.list_name,
      normalized: record,
      snapshotId,
      sourceCompanyId: record.source.companyId,
      sourceListId: record.source.listId,
      version,
    };
  });
  let compileReady = 0;
  const bindings = definitions.map((definition) => {
    const farmId = demo.companyFarms[definition.sourceCompanyId];
    if (!farmId) {
      throw new Error("MISSING_EXPLICIT_COMPANY_BINDING");
    }
    const config: RuleBinding = {
      farmId,
      sourceCompanyId: definition.sourceCompanyId,
      version: demo.version,
      ...demo.policies,
      fieldBindings: demo.fieldBindings,
      parameters: {},
    };
    const compiled = compileListRule(definition.normalized, config, registry);
    if (compiled.patch) {
      compileReady += 1;
    }
    return {
      config,
      diagnostics: compiled.diagnostics,
      enabled: true,
      farmId,
      id: stableId(`RuleBinding:${definition.id}:${farmId}:${demo.version}`),
      provenance: demo.provenance,
      ruleId: definition.id,
      version: demo.version,
    };
  });
  const companies = new Set(
    definitions.map((definition) => definition.sourceCompanyId)
  );
  if (
    Object.keys(demo.companyFarms).some((company) => !companies.has(company))
  ) {
    throw new Error("UNKNOWN_SOURCE_COMPANY_BINDING");
  }
  return { bindings, compileReady, definitions, parserVersion, snapshotId };
}

async function main() {
  const flags = process.argv.slice(2);
  if (
    flags.some((flag) => !["--dry-run", "--write"].includes(flag)) ||
    (flags.includes("--dry-run") && flags.includes("--write"))
  ) {
    throw new Error("USE_DRY_RUN_OR_WRITE");
  }
  const { getAuthorizedFieldRegistry } = await import("../lib/farm/registry");
  if (!process.env.FARM_DEMO_SUBJECT_ID) {
    throw new Error("DEMO_SUBJECT_REQUIRED");
  }
  const { getFarmClient } = await import("../lib/farm/scope");
  let registry: FieldRegistry;
  try {
    registry = await getAuthorizedFieldRegistry(
      process.env.FARM_DEMO_SUBJECT_ID
    );
  } finally {
    await getFarmClient().end();
  }
  const prepared = prepare(registry);
  const summary = {
    bindings: prepared.bindings.length,
    compileReady: prepared.compileReady,
    definitions: prepared.definitions.length,
    mode: flags.includes("--write") ? "write" : "dry-run",
    queryVerified: 0,
    snapshotId: prepared.snapshotId,
    sourceSha256: EXPECTED_SHA,
  };
  if (!flags.includes("--write")) {
    console.log(JSON.stringify(summary));
    return;
  }
  if (!process.env.POSTGRES_URL || !process.env.FARM_DATABASE_URL) {
    throw new Error("DATABASE_CONFIGURATION_REQUIRED");
  }
  // Cross-database foreign keys do not exist: validate all explicit test farm IDs.
  const farmsClient = postgres(process.env.FARM_DATABASE_URL, { max: 1 });
  try {
    const required = [
      ...new Set(prepared.bindings.map((binding) => binding.farmId)),
    ];
    const farms = await farmsClient<
      { id: string }[]
    >`SELECT id FROM farm WHERE id=ANY(${required}::uuid[]) AND status='ACTIVE'`;
    if (farms.length !== required.length) {
      throw new Error("BINDING_FARM_NOT_FOUND");
    }
  } finally {
    await farmsClient.end();
  }
  // Import after dotenv initialization; use the same product client as the app.
  const { productClient } = await import("../lib/db/client");
  try {
    const result = await productClient.begin(async (transaction) => {
      await transaction`INSERT INTO "RuleSourceSnapshot"(id,sha256,"parserVersion","rowCount") VALUES(${prepared.snapshotId},${EXPECTED_SHA},${prepared.parserVersion},${prepared.definitions.length}) ON CONFLICT DO NOTHING`;
      const snapshots = await transaction<
        {
          id: string;
          sha256: string;
          parserVersion: string;
          rowCount: number;
        }[]
      >`SELECT id,sha256,"parserVersion","rowCount" FROM "RuleSourceSnapshot" WHERE id=${prepared.snapshotId} FOR UPDATE`;
      const [snapshot] = snapshots;
      if (
        !snapshot ||
        snapshot.sha256 !== EXPECTED_SHA ||
        snapshot.parserVersion !== prepared.parserVersion ||
        snapshot.rowCount !== prepared.definitions.length
      ) {
        throw new Error("IMMUTABLE_SNAPSHOT_CONFLICT");
      }
      const before = await transaction<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM "RuleDefinition" WHERE "snapshotId"=${prepared.snapshotId}`;
      for (
        let offset = 0;
        offset < prepared.definitions.length;
        offset += 100
      ) {
        const definitions = prepared.definitions.slice(offset, offset + 100);
        // biome-ignore lint/performance/noAwaitInLoops: Batches share one atomic transaction and bound memory.
        await transaction`INSERT INTO "RuleDefinition"(id,"snapshotId","sourceCompanyId","sourceListId",version,name,description,"contentHash",normalized)
          SELECT id,"snapshotId","sourceCompanyId","sourceListId",version,name,description,"contentHash",normalized
          FROM jsonb_to_recordset(${JSON.stringify(definitions)}::jsonb) AS x(id uuid,"snapshotId" uuid,"sourceCompanyId" text,"sourceListId" text,version text,name text,description text,"contentHash" text,normalized jsonb)
          ON CONFLICT DO NOTHING`;
      }
      const existing = await transaction<
        { id: string; contentHash: string; normalized: NormalizedRule }[]
      >`SELECT id,"contentHash",normalized FROM "RuleDefinition" WHERE "snapshotId"=${prepared.snapshotId}`;
      const expected = new Map(
        prepared.definitions.map((definition) => [
          definition.id,
          definition.contentHash,
        ])
      );
      if (
        existing.length !== expected.size ||
        existing.some(
          (row) =>
            expected.get(row.id) !== row.contentHash ||
            hash(canonical(row.normalized)) !== row.contentHash
        )
      ) {
        throw new Error("IMMUTABLE_DEFINITION_CONFLICT");
      }
      for (let offset = 0; offset < prepared.bindings.length; offset += 100) {
        const bindings = prepared.bindings.slice(offset, offset + 100);
        // biome-ignore lint/performance/noAwaitInLoops: Bindings share one atomic transaction and bounded batches.
        await transaction`INSERT INTO "RuleBinding"(id,"ruleId","farmId",version,enabled,config,diagnostics,provenance)
          SELECT id,"ruleId","farmId",version,enabled,config,diagnostics,provenance
          FROM jsonb_to_recordset(${JSON.stringify(bindings)}::jsonb) AS x(id uuid,"ruleId" uuid,"farmId" uuid,version text,enabled boolean,config jsonb,diagnostics jsonb,provenance text)
          ON CONFLICT DO NOTHING`;
      }
      const ids = prepared.bindings.map((binding) => binding.id);
      const storedBindings = await transaction<
        { id: string; config: RuleBinding; provenance: string }[]
      >`SELECT id,config,provenance FROM "RuleBinding" WHERE id=ANY(${ids}::uuid[])`;
      const expectedBindings = new Map(
        prepared.bindings.map((binding) => [binding.id, binding])
      );
      if (
        storedBindings.length !== expectedBindings.size ||
        storedBindings.some((row) => {
          const expectedBinding = expectedBindings.get(row.id);
          return (
            !expectedBinding ||
            canonical(row.config) !== canonical(expectedBinding.config) ||
            row.provenance !== expectedBinding.provenance
          );
        })
      ) {
        throw new Error("IMMUTABLE_BINDING_CONFLICT");
      }
      return {
        bindingsAfter: storedBindings.length,
        definitionsAfter: existing.length,
        definitionsBefore: Number(before[0].count),
      };
    });
    const readback = await productClient<
      { definitions: string; bindings: string }[]
    >`SELECT
      (SELECT count(*)::text FROM "RuleDefinition" WHERE "snapshotId"=${prepared.snapshotId}) AS definitions,
      (SELECT count(*)::text FROM "RuleBinding" b JOIN "RuleDefinition" d ON d.id=b."ruleId" WHERE d."snapshotId"=${prepared.snapshotId}) AS bindings`;
    if (
      Number(readback[0].definitions) !== prepared.definitions.length ||
      Number(readback[0].bindings) < prepared.bindings.length
    ) {
      throw new Error("IMPORT_READBACK_FAILED");
    }
    console.log(
      JSON.stringify({ ...summary, ...result, readback: readback[0] })
    );
  } finally {
    await productClient.end();
  }
}

main().catch((error) => {
  // Do not print connection strings, source contents or SQL parameter values.
  console.error(error instanceof Error ? error.message : "RULE_IMPORT_FAILED");
  process.exitCode = 1;
});

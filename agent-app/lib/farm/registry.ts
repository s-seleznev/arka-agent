import "server-only";
import type postgres from "postgres";
import { z } from "zod";
import {
  type FarmFieldDefinition,
  type FieldRegistry,
  farmFields,
} from "./fields";
import { getAccessibleFarms, getFarmClient } from "./scope";

const databaseUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const definitionSchema = z.object({
  code: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/),
  definition_version: z.number().int().positive(),
  farm_id: databaseUuid,
  farm_name: z.string(),
  id: databaseUuid,
  is_filterable: z.boolean(),
  is_groupable: z.boolean(),
  name: z.string().min(1).max(500),
  unit_code: z.string().max(100).nullable(),
  value_type: z.enum([
    "TEXT",
    "ENUM",
    "INTEGER",
    "NUMERIC",
    "BOOLEAN",
    "DATE",
    "TIMESTAMP",
    "REFERENCE",
  ]),
});

/** Request-local metadata, loaded only after resolving the caller's farm grants. */
export async function getAuthorizedFieldRegistry(
  userId: string,
  asOf = new Date().toISOString()
): Promise<FieldRegistry> {
  const farms = await getAccessibleFarms(userId);
  if (!farms.length) {
    throw new Error("FARM_ACCESS_DENIED");
  }
  return readFieldRegistry(
    farms.map((f) => f.id),
    asOf,
    getFarmClient()
  );
}

async function readFieldRegistry(
  farmIds: string[],
  asOf: string,
  client: postgres.Sql | postgres.TransactionSql<Record<string, unknown>>
): Promise<FieldRegistry> {
  const rows = await client.unsafe(
    `
    SELECT selected.id,f.id AS farm_id,f.name AS farm_name,selected.code,selected.name,selected.value_type,selected.unit_code,selected.definition_version,selected.is_filterable,selected.is_groupable
    FROM farm f CROSS JOIN LATERAL (
      SELECT DISTINCT ON(fd.code) fd.* FROM field_definition fd
      WHERE fd.is_active AND (fd.farm_id IS NULL OR fd.farm_id=f.id)
        AND fd.valid_from<=$1::timestamptz AND (fd.valid_to IS NULL OR fd.valid_to>$1::timestamptz)
        AND (fd.source_kind IN ('CALCULATED','CUSTOM_EVENT_VALUE') OR fd.source_ast IS NOT NULL)
      ORDER BY fd.code,fd.farm_id NULLS LAST,fd.valid_from DESC,fd.id DESC
    ) selected WHERE f.id=ANY($2::uuid[]) ORDER BY selected.id,f.id`,
    [asOf, farmIds]
  );
  const registry: Record<string, FarmFieldDefinition> = { ...farmFields };
  const selected = new Map<
    string,
    { definition: z.infer<typeof definitionSchema>; farms: string[] }
  >();
  for (const raw of rows) {
    const definition = definitionSchema.parse(raw);
    const entry = selected.get(definition.id);
    if (entry) {
      entry.farms.push(definition.farm_id);
    } else {
      selected.set(definition.id, { definition, farms: [definition.farm_id] });
    }
  }
  for (const { definition: d, farms: ids } of selected.values()) {
    const id = `registered_${d.id}`;
    const type =
      d.value_type === "BOOLEAN"
        ? "boolean"
        : ["DATE", "TIMESTAMP"].includes(d.value_type)
          ? "date"
          : ["INTEGER", "NUMERIC"].includes(d.value_type)
            ? "number"
            : "text";
    const template =
      farmFields[
        type === "boolean"
          ? "isPregnant"
          : type === "date"
            ? "birthDate"
            : type === "number"
              ? "lastMilkKg"
              : "name"
      ];
    const cast =
      type === "boolean"
        ? "::boolean"
        : type === "date"
          ? d.value_type === "TIMESTAMP"
            ? "::timestamptz"
            : "::date"
          : type === "number"
            ? "::numeric"
            : "";
    // Only validated UUIDs/code and a closed cast vocabulary enter SQL, never source_ast.
    const guard = ids.map((farmId) => `'${farmId}'::uuid`).join(",");
    registry[id] = {
      ...template,
      definitionId: d.id,
      definitionVersion: d.definition_version,
      editor:
        type === "boolean"
          ? "boolean"
          : type === "date"
            ? "date"
            : type === "number"
              ? "number"
              : "text",
      farmIds: ids,
      groupable: d.is_groupable,
      id,
      label: farmIds.length > 1 && ids.length === 1 ? `${d.name} · ${d.farm_name}` : d.name,
      operators: d.is_filterable ? [...template.operators] : [],
      sourceCode: d.code,
      sourceName: d.name,
      sql: `(CASE WHEN s.farm_id IN (${guard}) THEN (s.rule_values->>'${d.code}')${cast} ELSE NULL END)`,
      timestamp: d.value_type === "TIMESTAMP",
      type,
      unit: d.unit_code
        ? (({ day: "дней", days: "дней", kg: "кг" } as Record<string, string>)[
            d.unit_code.toLowerCase()
          ] ?? d.unit_code)
        : undefined,
      valueSource: type === "boolean" ? "boolean" : "freeform",
    };
  }
  return registry;
}

/** Reject metadata changes between compilation and the repeatable-read facts cut. */
export async function assertRegistrySnapshot(
  transaction: postgres.TransactionSql<Record<string, unknown>>,
  registry: FieldRegistry,
  farmIds: string[],
  asOf: string
) {
  const current = await readFieldRegistry(farmIds, asOf, transaction);
  if (JSON.stringify(current) !== JSON.stringify(registry)) {
    throw new Error("FIELD_REGISTRY_STALE");
  }
}

import "server-only";

import type postgres from "postgres";
import {
  assertCursorMatches,
  decodeFarmCursor,
  encodeFarmCursor,
  groupPathKey,
  hashSnapshotMarker,
  reportQueryFingerprint,
} from "./cursor";
import { type FieldRegistry, requireFarmField } from "./fields";
import { assertRegistrySnapshot, getAuthorizedFieldRegistry } from "./registry";
import { getAccessibleFarms, getFarmClient } from "./scope";
import {
  compileFilter,
  compileGroupPath,
  cursorSelections,
  keysetAfterSql,
  type OrderKey,
  orderBySql,
  rowOrderKeys,
  type SqlParameters,
} from "./sql";
import {
  type AnimalGroupNode,
  type AnimalPage,
  type AnimalRow,
  type FilterGroup,
  type FilterNode,
  type FilterScalar,
  type GroupPath,
  type GroupRule,
  groupPathSchema,
  groupRuleListSchema,
  MAX_VIEW_COLUMNS,
  type RuleContext,
  type SortRule,
  sortRuleSchema,
} from "./types";
import { validateFilterGroup } from "./view-model";

export { getAccessibleFarms } from "./scope";

export async function assertFarmAccess(userId: string, farmId: string) {
  const farm = (await getAccessibleFarms(userId)).find(
    (item) => item.id === farmId
  );
  if (!farm) {
    throw new Error("FARM_ACCESS_DENIED");
  }
  return farm;
}

function referencedFarmIds(filters: FilterGroup) {
  const ids = new Set<string>();
  const visit = (condition: FilterNode) => {
    if (condition.kind === "group") {
      condition.children.forEach(visit);
      return;
    }
    if (condition.field !== "farmId" || !condition.value) {
      return;
    }
    if (condition.value.type === "list") {
      for (const value of condition.value.values) {
        ids.add(String(value.value));
      }
    } else if (
      condition.value.type !== "range" &&
      condition.value.type !== "relative_date" &&
      condition.value.type !== "relative_day" &&
      condition.value.type !== "field"
    ) {
      ids.add(String(condition.value.value));
    }
  };
  visit(filters);
  return ids;
}

export async function assertFilterFarmAccess(
  userId: string,
  filters: FilterGroup,
  asOf?: string
) {
  const registry = await getAuthorizedFieldRegistry(userId, asOf);
  const validated = validateFilterGroup(filters, registry);
  const farms = await getAccessibleFarms(userId);
  if (farms.length === 0) {
    throw new Error("FARM_ACCESS_DENIED");
  }
  const allowed = new Set(farms.map((farm) => farm.id));
  for (const farmId of referencedFarmIds(validated)) {
    if (!allowed.has(farmId)) {
      throw new Error("FARM_ACCESS_DENIED");
    }
  }
  return farms;
}

async function setFarmScope(
  transaction: postgres.TransactionSql<Record<string, unknown>>,
  farmIds: string[]
) {
  await transaction`SELECT set_config('arka.farm_id', ${farmIds[0]}, true)`;
  await transaction`SELECT set_config('arka.farm_ids', ${farmIds.join(",")}, true)`;
}

function serializeValue(value: unknown): boolean | number | string | null {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function validateGroupPath(
  path: GroupPath,
  groupBy: GroupRule[],
  registry: FieldRegistry
) {
  const parsed = groupPathSchema.parse(path);
  if (parsed.length > groupBy.length) {
    throw new Error("INVALID_GROUP_PATH");
  }
  parsed.forEach((item, index) => {
    const rule = groupBy[index];
    if (!rule || rule.field !== item.field) {
      throw new Error("INVALID_GROUP_PATH");
    }
    if (item.value === null) {
      if (rule.hideEmpty) {
        throw new Error("INVALID_GROUP_PATH_VALUE");
      }
      return;
    }
    const { type } = requireFarmField(item.field, registry);
    if (
      (type === "boolean" && typeof item.value !== "boolean") ||
      (type === "number" && typeof item.value !== "number") ||
      ((type === "text" || type === "date") && typeof item.value !== "string")
    ) {
      throw new Error("INVALID_GROUP_PATH_VALUE");
    }
  });
  return parsed;
}

function validateQueryRules(
  sort: SortRule[],
  groupBy: GroupRule[],
  registry: FieldRegistry
) {
  const parsedSort = sortRuleSchema.array().max(5).parse(sort);
  const parsedGroups = groupRuleListSchema.parse(groupBy);
  if (
    new Set(parsedSort.map((rule) => rule.field)).size !== parsedSort.length
  ) {
    throw new Error("DUPLICATE_VIEW_SORT");
  }
  if (
    new Set(parsedGroups.map((rule) => rule.field)).size !== parsedGroups.length
  ) {
    throw new Error("DUPLICATE_VIEW_GROUP");
  }
  for (const rule of parsedGroups) {
    if (!requireFarmField(rule.field, registry).groupable) {
      throw new Error(`UNGROUPABLE_FARM_FIELD:${rule.field}`);
    }
  }
  return { groupBy: parsedGroups, sort: parsedSort };
}

async function readSnapshot(
  transaction: postgres.TransactionSql<Record<string, unknown>>
) {
  const rows = await transaction.unsafe<
    Array<{ refreshedAt: Date | string; revision: string }>
  >(
    'SELECT revision::text AS revision, refreshed_at AS "refreshedAt" FROM animal_state_query_snapshot WHERE singleton = true'
  );
  const [marker] = rows;
  if (!marker) {
    throw new Error("FARM_SNAPSHOT_UNAVAILABLE");
  }
  const [ruleMarker] = await transaction.unsafe<Array<{ version: string }>>(
    "SELECT concat(as_of, ':', knowledge_at, ':', formula_version, ':', refreshed_at, ':', stale) AS version FROM animal_rule_projection_snapshot WHERE singleton = true"
  );
  if (!ruleMarker) {
    throw new Error("FARM_SNAPSHOT_UNAVAILABLE");
  }
  return hashSnapshotMarker({
    ...marker,
    revision: `${marker.revision}:${ruleMarker.version}`,
  });
}

/** Refresh derived projections on demand, never farm facts or scheduled jobs. */
async function ensureFreshProjection(farmIds: string[], asOf: string) {
  const client = getFarmClient();
  const isFresh = async (
    sql: postgres.Sql | postgres.TransactionSql<Record<string, unknown>>
  ) => {
    const [row] = await sql.unsafe<Array<{ fresh: boolean }>>(
      `SELECT NOT p.stale AND NOT EXISTS (SELECT 1 FROM farm f
         WHERE f.id = ANY($1::uuid[]) AND
         (p.as_of AT TIME ZONE f.timezone)::date <> ($2::timestamptz AT TIME ZONE f.timezone)::date
       ) AS fresh FROM animal_rule_projection_snapshot p WHERE singleton = true`,
      [farmIds, asOf]
    );
    return row?.fresh === true;
  };
  if (await isFresh(client)) {
    return;
  }
  const [requestDay] = await client.unsafe<Array<{ current: boolean }>>(
    `SELECT NOT EXISTS (SELECT 1 FROM farm WHERE id = ANY($1::uuid[]) AND
      ($2::timestamptz AT TIME ZONE timezone)::date <> (clock_timestamp() AT TIME ZONE timezone)::date) AS current`,
    [farmIds, asOf]
  );
  // A saved historical context must fail explicitly; refreshing now cannot recreate it.
  if (!requestDay?.current) {
    return;
  }
  await client.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL statement_timeout = '60s'");
    await transaction.unsafe(
      "SELECT pg_advisory_xact_lock(hashtext('arka-rule-projection-refresh'))"
    );
    if (await isFresh(transaction)) {
      return;
    }
    await transaction.unsafe("SELECT refresh_animal_state_query()");
  });
}

async function assertRuleSnapshot(
  transaction: postgres.TransactionSql<Record<string, unknown>>,
  farmIds: string[],
  asOf: string,
  snapshot: string,
  expectedSnapshot?: string
) {
  if (expectedSnapshot && expectedSnapshot !== snapshot) {
    throw new Error("RULE_SNAPSHOT_STALE");
  }
  const [marker] = await transaction.unsafe<Array<{ fresh: boolean }>>(
    `SELECT NOT p.stale AND NOT EXISTS (
       SELECT 1 FROM farm f WHERE f.id = ANY($1::uuid[])
       AND (p.as_of AT TIME ZONE f.timezone)::date <> ($2::timestamptz AT TIME ZONE f.timezone)::date
     ) AS fresh FROM animal_rule_projection_snapshot p WHERE singleton = true`,
    [farmIds, asOf]
  );
  if (!marker?.fresh) {
    throw new Error("RULE_PROJECTION_STALE");
  }
}

function queryCursorContext(input: {
  asOf?: string;
  columns: string[];
  cursor?: string | null;
  farmIds: string[];
  filters: FilterGroup;
  groupBy: GroupRule[];
  groupPath: GroupPath;
  revision: number;
  sort: SortRule[];
  viewId: string;
}) {
  const kind =
    input.groupBy.length > input.groupPath.length ? "groups" : "rows";
  const fingerprint = reportQueryFingerprint({
    columns: input.columns,
    farmIds: input.farmIds,
    filters: input.filters,
    groupBy: input.groupBy,
    groupPath: input.groupPath,
    kind,
    revision: input.revision,
    sort: input.sort,
    viewId: input.viewId,
  });
  const decoded = input.cursor ? decodeFarmCursor(input.cursor) : null;
  if (input.asOf && decoded && input.asOf !== decoded.asOf) {
    throw new Error("CURSOR_STALE");
  }
  return {
    asOf: input.asOf ?? decoded?.asOf ?? new Date().toISOString(),
    decoded,
    fingerprint,
    kind,
  } as const;
}

function makeNextCursor(input: {
  after: Array<boolean | number | string | null>;
  asOf: string;
  fingerprint: string;
  kind: "groups" | "rows";
  level: number;
  revision: number;
  snapshot: string;
  viewId: string;
}) {
  return encodeFarmCursor(input);
}

function rowFromResult(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !key.startsWith("__cursor"))
      .map(([key, value]) => [key, serializeValue(value)])
  ) as AnimalRow;
}

function cursorValues(row: Record<string, unknown>, keyCount: number) {
  return Array.from({ length: keyCount }, (_, index) =>
    serializeValue(row[`__cursor${index}`])
  );
}

export async function queryAnimals({
  fieldRegistry,
  asOf,
  ruleContext,
  columns,
  cursor,
  filters,
  groupBy = [],
  groupPath = [],
  limit = 50,
  revision = 0,
  sort = [],
  userId,
  viewId = "00000000-0000-0000-0000-000000000000",
}: {
  asOf?: string;
  ruleContext?: RuleContext | null;
  columns: string[];
  cursor?: string | null;
  filters: FilterGroup;
  groupBy?: GroupRule[];
  groupPath?: GroupPath;
  limit?: number;
  revision?: number;
  sort?: SortRule[];
  userId: string;
  viewId?: string;
  fieldRegistry?: FieldRegistry;
}): Promise<AnimalPage> {
  const farms = await assertFilterFarmAccess(
    userId,
    filters,
    ruleContext?.asOf ?? asOf
  );
  const farmIds = farms.map((farm) => farm.id).sort();
  const registry =
    fieldRegistry ??
    (await getAuthorizedFieldRegistry(userId, ruleContext?.asOf ?? asOf));
  const validatedFilters = validateFilterGroup(filters, registry);
  const rules = validateQueryRules(sort, groupBy, registry);
  const validatedPath = validateGroupPath(groupPath, rules.groupBy, registry);
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const requestedColumns = Array.from(new Set(columns));
  if (
    requestedColumns.length === 0 ||
    requestedColumns.length > MAX_VIEW_COLUMNS
  ) {
    throw new Error("INVALID_COLUMN_COUNT");
  }
  const selectedColumns = Array.from(
    new Set([
      "primaryIdentifier",
      ...rules.groupBy.map((rule) => rule.field),
      ...requestedColumns,
    ])
  );
  const selections = selectedColumns.map((id) => {
    const field = requireFarmField(id, registry);
    if (!field.column) {
      throw new Error(`NON_COLUMN_FARM_FIELD:${id}`);
    }
    return `${field.sql} AS "${id}"`;
  });
  const context = queryCursorContext({
    asOf: ruleContext?.asOf ?? asOf,
    columns: selectedColumns,
    cursor,
    farmIds,
    filters: validatedFilters,
    groupBy: rules.groupBy,
    groupPath: validatedPath,
    revision,
    sort: rules.sort,
    viewId,
  });
  await ensureFreshProjection(farmIds, context.asOf);
  const client = getFarmClient();

  return client.begin(async (transaction) => {
    await transaction.unsafe(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
    );
    await transaction.unsafe("SET LOCAL ROLE arka_reader");
    await setFarmScope(transaction, farmIds);
    await transaction.unsafe("SET LOCAL statement_timeout = '5s'");

    await assertRegistrySnapshot(transaction, registry, farmIds, context.asOf);
    const snapshot = await readSnapshot(transaction);
    await assertRuleSnapshot(
      transaction,
      farmIds,
      context.asOf,
      snapshot,
      ruleContext?.snapshot
    );
    if (context.decoded) {
      assertCursorMatches(context.decoded, {
        fingerprint: context.fingerprint,
        kind: context.kind,
        level: validatedPath.length,
        revision,
        snapshot,
        viewId,
      });
    }

    const baseParameters: SqlParameters = [farmIds];
    const filterSql = compileFilter(validatedFilters, baseParameters, {
      asOf: context.asOf,
      registry,
      timezoneSql: "f.timezone",
    });
    const pathSql = compileGroupPath(validatedPath, baseParameters, registry);
    const where = `s.farm_id = ANY($1::uuid[]) AND (${filterSql}) AND (${pathSql})`;

    if (context.kind === "groups") {
      const [rule] = rules.groupBy;
      if (!rule) {
        throw new Error("INVALID_GROUP_STATE");
      }
      const field = requireFarmField(rule.field, registry);
      const notEmptySql = rule.hideEmpty ? ` AND ${field.sql} IS NOT NULL` : "";
      const orderKeys: OrderKey[] = [
        { direction: rule.direction, sql: field.sql },
      ];
      const totals = await transaction.unsafe<
        Array<{ totalGroups: string; totalRows: string }>
      >(
        'SELECT count(*)::text AS "totalRows", ' +
          "(count(DISTINCT " +
          field.sql +
          ") + CASE WHEN count(*) FILTER (WHERE " +
          field.sql +
          " IS NULL) > 0 AND " +
          (rule.hideEmpty ? "FALSE" : "TRUE") +
          ' THEN 1 ELSE 0 END)::text AS "totalGroups" ' +
          "FROM animal_state_query s JOIN farm f ON f.id = s.farm_id WHERE " +
          where +
          notEmptySql,
        baseParameters as never[]
      );

      const dataParameters = [...baseParameters];
      const afterSql = context.decoded
        ? " AND " +
          keysetAfterSql(orderKeys, context.decoded.after, dataParameters)
        : "";
      dataParameters.push(safeLimit + 1);
      const result = await transaction.unsafe<
        Array<{ count: string; value: unknown }>
      >(
        "SELECT " +
          field.sql +
          " AS value, count(*)::text AS count FROM animal_state_query s JOIN farm f ON f.id = s.farm_id " +
          "WHERE " +
          where +
          notEmptySql +
          afterSql +
          " GROUP BY " +
          field.sql +
          " ORDER BY " +
          orderBySql(orderKeys) +
          " LIMIT $" +
          dataParameters.length,
        dataParameters as never[]
      );
      const hasMore = result.length > safeLimit;
      const visible = hasMore ? result.slice(0, safeLimit) : result;
      const groups: AnimalGroupNode[] = visible.map((row) => {
        const value = serializeValue(row.value);
        const path = [
          ...validatedPath,
          { field: rule.field, value },
        ] as GroupPath;
        return {
          count: Number(row.count),
          field: rule.field,
          key: groupPathKey(path),
          kind: "group",
          path,
          value,
        };
      });
      const last = visible.at(-1);
      return {
        asOf: context.asOf,
        end: !hasMore,
        groups,
        kind: "groups",
        nextCursor:
          hasMore && last
            ? makeNextCursor({
                after: [serializeValue(last.value)],
                asOf: context.asOf,
                fingerprint: context.fingerprint,
                kind: "groups",
                level: validatedPath.length,
                revision,
                snapshot,
                viewId,
              })
            : null,
        rows: [],
        snapshot,
        totalGroups: Number(totals[0]?.totalGroups ?? 0),
        totalRows: Number(totals[0]?.totalRows ?? 0),
      };
    }

    const orderKeys = rowOrderKeys(rules.sort, registry);
    const totals = await transaction.unsafe<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM animal_state_query s JOIN farm f ON f.id = s.farm_id WHERE ${where}`,
      baseParameters as never[]
    );
    const dataParameters = [...baseParameters];
    const afterSql = context.decoded
      ? " AND " +
        keysetAfterSql(orderKeys, context.decoded.after, dataParameters)
      : "";
    dataParameters.push(safeLimit + 1);
    const result = await transaction.unsafe<Record<string, unknown>[]>(
      'SELECT s.animal_id AS "animalId", s.farm_id AS "farmId", ' +
        selections.join(", ") +
        ", " +
        cursorSelections(orderKeys).join(", ") +
        " FROM animal_state_query s JOIN farm f ON f.id = s.farm_id WHERE " +
        where +
        afterSql +
        " ORDER BY " +
        orderBySql(orderKeys) +
        " LIMIT $" +
        dataParameters.length,
      dataParameters as never[]
    );
    const hasMore = result.length > safeLimit;
    const visible = hasMore ? result.slice(0, safeLimit) : result;
    const last = visible.at(-1);
    return {
      asOf: context.asOf,
      end: !hasMore,
      groups: [],
      kind: "rows",
      nextCursor:
        hasMore && last
          ? makeNextCursor({
              after: cursorValues(last, orderKeys.length),
              asOf: context.asOf,
              fingerprint: context.fingerprint,
              kind: "rows",
              level: validatedPath.length,
              revision,
              snapshot,
              viewId,
            })
          : null,
      rows: visible.map(rowFromResult),
      snapshot,
      totalGroups: 0,
      totalRows: Number(totals[0]?.count ?? 0),
    };
  });
}

export async function getAnimalById({
  animalId,
  farmId,
  userId,
}: {
  animalId: string;
  farmId?: string;
  userId: string;
}) {
  const farms = await getAccessibleFarms(userId);
  if (farms.length === 0) {
    throw new Error("FARM_ACCESS_DENIED");
  }
  const allowedFarmIds = new Set(farms.map((farm) => farm.id));
  if (farmId && !allowedFarmIds.has(farmId)) {
    throw new Error("FARM_ACCESS_DENIED");
  }
  const farmIds = farmId ? [farmId] : [...allowedFarmIds].sort();
  const client = getFarmClient();
  return client.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE arka_reader");
    await setFarmScope(transaction, farmIds);
    await transaction.unsafe("SET LOCAL statement_timeout = '5s'");
    const rows = await transaction<Record<string, unknown>[]>`
      SELECT * FROM animal_state_query
      WHERE farm_id = ANY(${farmIds}::uuid[]) AND animal_id = ${animalId}
      LIMIT 1`;
    return rows[0] ?? null;
  });
}

export async function summarizeAnimals({
  ruleContext,
  filters,
  userId,
}: {
  ruleContext?: RuleContext | null;
  filters: FilterGroup;
  userId: string;
}) {
  const farms = await assertFilterFarmAccess(
    userId,
    filters,
    ruleContext?.asOf
  );
  const farmIds = farms.map((farm) => farm.id).sort();
  const registry = await getAuthorizedFieldRegistry(userId, ruleContext?.asOf);
  const validated = validateFilterGroup(filters, registry);
  const asOf = ruleContext?.asOf ?? new Date().toISOString();
  await ensureFreshProjection(farmIds, asOf);
  const parameters: SqlParameters = [farmIds];
  const where = compileFilter(validated, parameters, {
    asOf,
    registry,
    timezoneSql: "f.timezone",
  });
  const client = getFarmClient();
  return client.begin(async (transaction) => {
    await transaction.unsafe(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
    );
    await transaction.unsafe("SET LOCAL ROLE arka_reader");
    await setFarmScope(transaction, farmIds);
    await transaction.unsafe("SET LOCAL statement_timeout = '5s'");
    await assertRegistrySnapshot(transaction, registry, farmIds, asOf);
    const snapshot = await readSnapshot(transaction);
    await assertRuleSnapshot(
      transaction,
      farmIds,
      asOf,
      snapshot,
      ruleContext?.snapshot
    );
    const rows = await transaction.unsafe<
      Array<{
        averageMilkKg: string | null;
        averageWeightKg: string | null;
        pregnantCount: string;
        totalRows: string;
      }>
    >(
      'SELECT count(*)::text AS "totalRows", ' +
        'count(*) FILTER (WHERE s.is_pregnant)::text AS "pregnantCount", ' +
        'avg(s.last_milk_kg)::text AS "averageMilkKg", ' +
        'avg(s.last_weight_kg)::text AS "averageWeightKg" ' +
        "FROM animal_state_query s JOIN farm f ON f.id = s.farm_id " +
        "WHERE s.farm_id = ANY($1::uuid[]) AND " +
        where,
      parameters as never[]
    );
    const [row] = rows;
    return {
      averageMilkKg: row?.averageMilkKg ? Number(row.averageMilkKg) : null,
      averageWeightKg: row?.averageWeightKg
        ? Number(row.averageWeightKg)
        : null,
      pregnantCount: Number(row?.pregnantCount ?? 0),
      totalRows: Number(row?.totalRows ?? 0),
    };
  });
}

function escapeLikeSearch(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function getFarmFieldValues({
  fieldId,
  limit = 50,
  search,
  userId,
}: {
  fieldId: string;
  limit?: number;
  search?: string;
  userId: string;
}) {
  const farms = await getAccessibleFarms(userId);
  if (farms.length === 0) {
    throw new Error("FARM_ACCESS_DENIED");
  }
  if (fieldId === "farmId") {
    return farms
      .slice(0, limit)
      .map((farm): FilterScalar => ({ type: "string", value: farm.id }));
  }
  const farmIds = farms.map((farm) => farm.id).sort();
  const registry = await getAuthorizedFieldRegistry(userId);
  const field = requireFarmField(fieldId, registry);
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const parameters: SqlParameters = [farmIds];
  let searchSql = "";
  if (search && field.type === "text") {
    parameters.push(`%${escapeLikeSearch(search)}%`);
    searchSql = ` AND ${field.sql} ILIKE $${parameters.length} ESCAPE '\\'`;
  }
  parameters.push(safeLimit);
  const client = getFarmClient();
  return client.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE arka_reader");
    await setFarmScope(transaction, farmIds);
    await transaction.unsafe("SET LOCAL statement_timeout = '5s'");
    const rows = await transaction.unsafe<Array<{ value: unknown }>>(
      "SELECT DISTINCT " +
        field.sql +
        " AS value FROM animal_state_query s JOIN farm f ON f.id = s.farm_id " +
        "WHERE s.farm_id = ANY($1::uuid[]) AND " +
        field.sql +
        " IS NOT NULL" +
        searchSql +
        " ORDER BY " +
        field.sql +
        " ASC NULLS LAST LIMIT $" +
        parameters.length,
      parameters as never[]
    );
    return rows.map((row): FilterScalar => {
      const serialized = serializeValue(row.value);
      if (serialized === null) {
        throw new Error("INVALID_FIELD_VALUE");
      }
      if (field.type === "boolean") {
        return { type: "boolean", value: Boolean(serialized) };
      }
      if (field.type === "number") {
        return { type: "number", value: Number(serialized) };
      }
      if (field.type === "date") {
        return { type: "date", value: String(serialized).slice(0, 10) };
      }
      return { type: "string", value: String(serialized) };
    });
  });
}

export async function getFarmFieldCatalog(userId: string) {
  const registry = await getAuthorizedFieldRegistry(userId);
  return Object.values(registry).map(({ sql: _sql, ...field }) => field);
}

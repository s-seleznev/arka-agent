import { type FieldRegistry, farmFields, requireFarmField } from "./fields";
import type {
  FilterCondition,
  FilterGroup,
  FilterScalar,
  GroupPath,
  SortRule,
} from "./types";
import { validateFilterGroup } from "./view-model";

export type SqlParameters = Array<boolean | number | string | string[] | null>;

export type OrderKey = {
  direction: "asc" | "desc";
  sql: string;
};

function addParameter(parameters: SqlParameters, value: SqlParameters[number]) {
  parameters.push(value);
  return `$${parameters.length}`;
}

function scalarValue(value: FilterScalar) {
  return value.value;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function booleanPredicate(sql: string) {
  // Preserve UNKNOWN through every NOT/AND/OR; WHERE excludes it at the end.
  return `(${sql})`;
}

function buildCondition(
  condition: FilterCondition,
  parameters: SqlParameters,
  context: {
    asOf: string;
    timezone?: string;
    timezoneSql?: string;
    registry?: FieldRegistry;
  }
) {
  const field = requireFarmField(condition.field, context.registry);
  const rawExpression = field.sql;
  const timezone =
    context.timezoneSql ?? addParameter(parameters, context.timezone ?? "UTC");
  const expression =
    field.type === "date" &&
    (field.timestamp ||
      condition.field === "lastCalvingAt" ||
      condition.field === "lastInseminationAt")
      ? `(${rawExpression} AT TIME ZONE ${timezone})::date`
      : rawExpression;
  const { value } = condition;
  const scalarParameter = (scalar: FilterScalar) =>
    `${addParameter(parameters, scalarValue(scalar))}${scalar.type === "decimal" ? "::numeric" : ""}`;
  const operand = () => {
    if (value?.type === "relative_day") {
      return `(((${addParameter(parameters, context.asOf)}::timestamptz AT TIME ZONE ${timezone})::date) + ${addParameter(parameters, value.offset)}::integer)`;
    }
    if (value?.type === "field") {
      const reference = requireFarmField(value.field, context.registry);
      return reference.type === "date" &&
        (reference.timestamp ||
          ["lastCalvingAt", "lastInseminationAt"].includes(value.field))
        ? `(${reference.sql} AT TIME ZONE ${timezone})::date`
        : reference.sql;
    }
    return scalarParameter(value as FilterScalar);
  };
  let sql: string;

  switch (condition.operator) {
    case "is_empty":
      sql = `${expression} IS NULL`;
      break;
    case "is_not_empty":
      sql = `${expression} IS NOT NULL`;
      break;
    case "today": {
      const asOf = addParameter(parameters, context.asOf);
      sql = `${expression} = ((${asOf}::timestamptz AT TIME ZONE ${timezone})::date)`;
      break;
    }
    case "eq": {
      sql = `${expression} = ${operand()}`;
      break;
    }
    case "neq": {
      sql = `${expression} <> ${operand()}`;
      break;
    }
    case "contains":
    case "not_contains":
    case "starts_with":
    case "ends_with": {
      const raw = String(scalarValue(value as FilterScalar));
      const escaped = escapeLike(raw);
      const pattern =
        condition.operator === "starts_with"
          ? `${escaped}%`
          : condition.operator === "ends_with"
            ? `%${escaped}`
            : `%${escaped}%`;
      const match = booleanPredicate(
        `${expression} ILIKE ${addParameter(parameters, pattern)} ESCAPE '\\'`
      );
      sql = condition.operator === "not_contains" ? `NOT (${match})` : match;
      break;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const operator = {
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<=",
      }[condition.operator];
      sql = booleanPredicate(`${expression} ${operator} ${operand()}`);
      break;
    }
    case "in":
    case "not_in": {
      if (value?.type !== "list") {
        throw new Error("FILTER_LIST_REQUIRED");
      }
      const placeholders = value.values.map(scalarParameter);
      const included = booleanPredicate(
        `${expression} IN (${placeholders.join(", ")})`
      );
      sql = condition.operator === "not_in" ? `NOT (${included})` : included;
      break;
    }
    case "between": {
      if (value?.type !== "range") {
        throw new Error("FILTER_RANGE_REQUIRED");
      }
      sql = booleanPredicate(
        `${expression} BETWEEN ${scalarParameter(value.lower)} AND ${scalarParameter(value.upper)}`
      );
      break;
    }
    case "in_last":
    case "in_next": {
      if (value?.type !== "relative_date") {
        throw new Error("FILTER_RELATIVE_DATE_REQUIRED");
      }
      const asOf = addParameter(parameters, context.asOf);
      const amount = addParameter(parameters, value.amount);
      const anchor = `((${asOf}::timestamptz AT TIME ZONE ${timezone})::date)`;
      const interval =
        value.unit === "day"
          ? `((${amount} - 1) * INTERVAL '1 day')`
          : value.unit === "week"
            ? `(((${amount} * 7) - 1) * INTERVAL '1 day')`
            : `(${amount} * INTERVAL '1 month')`;
      const shifted = `(${anchor} ${condition.operator === "in_last" ? "-" : "+"} ${interval})`;
      sql =
        condition.operator === "in_last"
          ? booleanPredicate(`${expression} BETWEEN ${shifted} AND ${anchor}`)
          : booleanPredicate(`${expression} BETWEEN ${anchor} AND ${shifted}`);
      break;
    }
    default:
      throw new Error("UNSUPPORTED_FILTER_OPERATOR");
  }
  return condition.negated ? `NOT (${sql})` : `(${sql})`;
}

function buildGroup(
  group: FilterGroup,
  parameters: SqlParameters,
  context: {
    asOf: string;
    timezone?: string;
    timezoneSql?: string;
    registry?: FieldRegistry;
  }
): string {
  if (group.children.length === 0) {
    return group.negated ? "FALSE" : "TRUE";
  }
  const parts = group.children.map((node) =>
    node.kind === "group"
      ? buildGroup(node, parameters, context)
      : buildCondition(node, parameters, context)
  );
  const joined = `(${parts.join(group.combinator === "and" ? " AND " : " OR ")})`;
  return group.negated ? `NOT (${joined})` : joined;
}

export function compileFilter(
  filters: FilterGroup,
  parameters: SqlParameters,
  context: {
    asOf: string;
    timezone?: string;
    timezoneSql?: string;
    registry?: FieldRegistry;
  }
) {
  const validated = validateFilterGroup(filters, context.registry);
  return buildGroup(validated, parameters, context);
}

export function compileGroupPath(
  path: GroupPath,
  parameters: SqlParameters,
  registry: FieldRegistry = farmFields
) {
  if (path.length === 0) {
    return "TRUE";
  }
  return path
    .map(({ field, value }) => {
      const expression = requireFarmField(field, registry).sql;
      return `${expression} IS NOT DISTINCT FROM ${addParameter(parameters, value)}`;
    })
    .map((part) => `(${part})`)
    .join(" AND ");
}

export function rowOrderKeys(
  sort: SortRule[],
  registry: FieldRegistry = farmFields
): OrderKey[] {
  const selected = sort.length
    ? sort
    : [
        {
          direction: "asc" as const,
          field: "primaryIdentifier",
          id: "00000000-0000-0000-0000-000000000000",
        },
      ];
  const seen = new Set<string>();
  const keys: OrderKey[] = [];
  for (const rule of selected) {
    if (seen.has(rule.field)) {
      continue;
    }
    seen.add(rule.field);
    const field = requireFarmField(rule.field, registry);
    if (!field.sortable) {
      throw new Error(`UNSORTABLE_FARM_FIELD:${rule.field}`);
    }
    keys.push({ direction: rule.direction, sql: field.sql });
  }
  keys.push({ direction: "asc", sql: "s.animal_id" });
  return keys;
}

export function orderBySql(keys: OrderKey[]) {
  return keys
    .map((key) => `${key.sql} ${key.direction.toUpperCase()} NULLS LAST`)
    .join(", ");
}

function valueAfter(
  key: OrderKey,
  value: SqlParameters[number],
  parameters: SqlParameters
) {
  if (value === null) {
    return "FALSE";
  }
  const comparison = key.direction === "asc" ? ">" : "<";
  return `(${key.sql} IS NULL OR ${key.sql} ${comparison} ${addParameter(parameters, value)})`;
}

export function keysetAfterSql(
  keys: OrderKey[],
  after: SqlParameters[number][],
  parameters: SqlParameters
) {
  if (after.length !== keys.length) {
    throw new Error("CURSOR_INVALID");
  }
  const alternatives: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const equalPrefix = keys.slice(0, index).map((key, prefixIndex) => {
      const value = after[prefixIndex];
      return `${key.sql} IS NOT DISTINCT FROM ${addParameter(parameters, value)}`;
    });
    alternatives.push(
      `(${[...equalPrefix, valueAfter(keys[index], after[index], parameters)].join(" AND ")})`
    );
  }
  return `(${alternatives.join(" OR ")})`;
}

export function cursorSelections(keys: OrderKey[]) {
  return keys.map((key, index) => `${key.sql} AS "__cursor${index}"`);
}

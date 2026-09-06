import { z } from "zod";
import { compareDecimals } from "./decimal";
import { type FieldRegistry, farmFields, requireFarmField } from "./fields";
import {
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterScalar,
  type FilterValue,
  filterGroupSchema,
  groupRuleSchema,
  type LegacyFilterCondition,
  type LegacyFilterGroup,
  type LegacyFlatFilterCondition,
  type LegacyReportViewPatch,
  legacyFilterGroupSchema,
  legacyFilterListSchema,
  MAX_FILTER_CONDITIONS,
  MAX_FILTER_DEPTH,
  MAX_GROUP_RULES,
  MAX_SORT_RULES,
  REPORT_VIEW_SCHEMA_VERSION,
  type ReportViewPatch,
  type ReportViewState,
  reportViewStateSchema,
  sortRuleSchema,
  type ViewOperation,
  viewOperationsSchema,
} from "./types";

export class ViewValidationError extends Error {
  code: string;
  path: string;

  constructor(code: string, path = "") {
    super(code);
    this.code = code;
    this.path = path;
  }
}

function fail(code: string, path = ""): never {
  throw new ViewValidationError(code, path);
}

function scalarTypeForField(
  fieldId: string,
  registry: FieldRegistry = farmFields
): FilterScalar["type"] {
  const { type } = requireFarmField(fieldId, registry);
  return type === "text" ? "string" : type;
}

function scalarValue(value: FilterScalar) {
  return value.value;
}

function validateScalar(
  scalar: FilterScalar,
  field: string,
  path: string,
  registry: FieldRegistry = farmFields
): void {
  if (
    scalar.type !== scalarTypeForField(field, registry) &&
    !(
      scalar.type === "decimal" &&
      scalarTypeForField(field, registry) === "number"
    )
  ) {
    fail("FILTER_VALUE_TYPE_MISMATCH", path);
  }
  if (
    field === "farmId" &&
    (scalar.type !== "string" || !z.uuid().safeParse(scalar.value).success)
  ) {
    fail("INVALID_FARM_FILTER_VALUE", path);
  }
}

function validateConditionValue(
  condition: FilterCondition,
  path: string,
  registry: FieldRegistry = farmFields
): void {
  let field: ReturnType<typeof requireFarmField>;
  try {
    field = requireFarmField(condition.field, registry);
  } catch {
    fail("UNKNOWN_FARM_FIELD", `${path}.field`);
  }
  if (!field.operators.includes(condition.operator)) {
    fail("INVALID_FILTER_OPERATOR", `${path}.operator`);
  }

  const noValueOperators = new Set(["is_empty", "is_not_empty", "today"]);
  if (noValueOperators.has(condition.operator)) {
    if (condition.value !== undefined) {
      fail("FILTER_VALUE_FORBIDDEN", `${path}.value`);
    }
    return;
  }
  if (condition.value === undefined) {
    fail("FILTER_VALUE_REQUIRED", `${path}.value`);
  }
  const value = condition.value as FilterValue;

  if (condition.operator === "in" || condition.operator === "not_in") {
    if (value.type !== "list") {
      fail("FILTER_LIST_REQUIRED", `${path}.value`);
    }
    value.values.forEach((item, index) => {
      validateScalar(
        item,
        condition.field,
        `${path}.value.values.${index}`,
        registry
      );
    });
    return;
  }
  if (condition.operator === "between") {
    if (value.type !== "range") {
      fail("FILTER_RANGE_REQUIRED", `${path}.value`);
    }
    validateScalar(
      value.lower,
      condition.field,
      `${path}.value.lower`,
      registry
    );
    validateScalar(
      value.upper,
      condition.field,
      `${path}.value.upper`,
      registry
    );
    const reversed =
      field.type === "number"
        ? compareDecimals(
            String(scalarValue(value.lower)),
            String(scalarValue(value.upper))
          ) > 0
        : scalarValue(value.lower) > scalarValue(value.upper);
    if (reversed) {
      fail("FILTER_RANGE_REVERSED", `${path}.value`);
    }
    return;
  }
  if (condition.operator === "in_last" || condition.operator === "in_next") {
    if (value.type !== "relative_date" || field.type !== "date") {
      fail("FILTER_RELATIVE_DATE_REQUIRED", `${path}.value`);
    }
    return;
  }
  if (
    condition.operator === "contains" ||
    condition.operator === "not_contains" ||
    condition.operator === "starts_with" ||
    condition.operator === "ends_with"
  ) {
    if (value.type !== "string" || field.type !== "text") {
      fail("FILTER_STRING_REQUIRED", `${path}.value`);
    }
    return;
  }
  if (value.type === "relative_day") {
    if (field.type !== "date") {
      fail("FILTER_VALUE_TYPE_MISMATCH", `${path}.value`);
    }
    return;
  }
  if (value.type === "field") {
    const referenced = requireFarmField(value.field, registry);
    if (
      condition.field === "farmId" ||
      value.field === "farmId" ||
      referenced.type !== field.type ||
      referenced.unit !== field.unit
    ) {
      fail("FILTER_FIELD_TYPE_MISMATCH", `${path}.value`);
    }
    return;
  }
  if (
    value.type === "list" ||
    value.type === "range" ||
    value.type === "relative_date"
  ) {
    fail("FILTER_SCALAR_REQUIRED", `${path}.value`);
  }
  validateScalar(value, condition.field, `${path}.value`, registry);
}

function validateFilterTree(
  root: FilterGroup,
  seenIds: Set<string>,
  depth = 1,
  path = "filters",
  registry: FieldRegistry = farmFields
): number {
  if (depth > MAX_FILTER_DEPTH) {
    fail("FILTER_DEPTH_EXCEEDED", path);
  }
  if (seenIds.has(root.id)) {
    fail("DUPLICATE_VIEW_NODE_ID", `${path}.id`);
  }
  seenIds.add(root.id);

  let conditionCount = 0;
  for (const [index, node] of root.children.entries()) {
    const nodePath = `${path}.children.${index}`;
    if (node.kind === "group") {
      if (node.children.length === 0) {
        fail("EMPTY_FILTER_GROUP", nodePath);
      }
      conditionCount += validateFilterTree(
        node,
        seenIds,
        depth + 1,
        nodePath,
        registry
      );
    } else {
      if (seenIds.has(node.id)) {
        fail("DUPLICATE_VIEW_NODE_ID", `${nodePath}.id`);
      }
      seenIds.add(node.id);
      validateConditionValue(node, nodePath, registry);
      conditionCount += 1;
    }
    if (conditionCount > MAX_FILTER_CONDITIONS) {
      fail("FILTER_COUNT_EXCEEDED", path);
    }
  }
  return conditionCount;
}

export function validateFilterGroup(
  input: FilterGroup,
  registry: FieldRegistry = farmFields
): FilterGroup {
  const parsed = filterGroupSchema.safeParse(input);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    fail("INVALID_FILTER_TREE", issue?.path.join(".") ?? "filters");
  }
  validateFilterTree(parsed.data, new Set<string>(), 1, "filters", registry);
  return parsed.data;
}

export function validateReportViewState(
  input: unknown,
  registry: FieldRegistry = farmFields
): ReportViewState {
  const parsed = reportViewStateSchema.safeParse(input);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    fail("INVALID_REPORT_VIEW", issue?.path.join(".") ?? "");
  }
  const view = parsed.data;
  validateFilterGroup(view.filters, registry);
  const seenIds = new Set<string>();
  const collectFilterIds = (node: FilterNode) => {
    seenIds.add(node.id);
    if (node.kind === "group") {
      node.children.forEach(collectFilterIds);
    }
  };
  collectFilterIds(view.filters);

  if (new Set(view.columns).size !== view.columns.length) {
    fail("DUPLICATE_VIEW_COLUMN", "columns");
  }
  for (const [index, column] of view.columns.entries()) {
    let field: ReturnType<typeof requireFarmField>;
    try {
      field = requireFarmField(column, registry);
    } catch {
      fail("UNKNOWN_FARM_FIELD", `columns.${index}`);
    }
    if (!field.column) {
      fail("NON_COLUMN_FARM_FIELD", `columns.${index}`);
    }
  }

  if (view.sort.length > MAX_SORT_RULES) {
    fail("SORT_COUNT_EXCEEDED", "sort");
  }
  if (new Set(view.sort.map((rule) => rule.field)).size !== view.sort.length) {
    fail("DUPLICATE_VIEW_SORT", "sort");
  }
  for (const [index, rule] of view.sort.entries()) {
    if (seenIds.has(rule.id)) {
      fail("DUPLICATE_VIEW_NODE_ID", `sort.${index}.id`);
    }
    seenIds.add(rule.id);
    let field: ReturnType<typeof requireFarmField>;
    try {
      field = requireFarmField(rule.field, registry);
    } catch {
      fail("UNKNOWN_FARM_FIELD", `sort.${index}.field`);
    }
    if (!field.sortable) {
      fail("UNSORTABLE_FARM_FIELD", `sort.${index}.field`);
    }
  }

  if (view.groupBy.length > MAX_GROUP_RULES) {
    fail("GROUP_COUNT_EXCEEDED", "groupBy");
  }
  if (
    new Set(view.groupBy.map((rule) => rule.field)).size !== view.groupBy.length
  ) {
    fail("DUPLICATE_VIEW_GROUP", "groupBy");
  }
  for (const [index, rule] of view.groupBy.entries()) {
    if (seenIds.has(rule.id)) {
      fail("DUPLICATE_VIEW_NODE_ID", `groupBy.${index}.id`);
    }
    seenIds.add(rule.id);
    let field: ReturnType<typeof requireFarmField>;
    try {
      field = requireFarmField(rule.field, registry);
    } catch {
      fail("UNKNOWN_FARM_FIELD", `groupBy.${index}.field`);
    }
    if (!field.groupable) {
      fail("UNGROUPABLE_FARM_FIELD", `groupBy.${index}.field`);
    }
  }
  return view;
}

function legacyScalar(fieldId: string, value: boolean | number | string) {
  const type = scalarTypeForField(fieldId);
  if (type === "number") {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      fail("FILTER_VALUE_TYPE_MISMATCH", "filters");
    }
    return { type, value: numeric } as const;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") {
      fail("FILTER_VALUE_TYPE_MISMATCH", "filters");
    }
    return { type, value } as const;
  }
  if (type === "date") {
    if (typeof value !== "string") {
      fail("FILTER_VALUE_TYPE_MISMATCH", "filters");
    }
    return { type, value } as const;
  }
  return { type, value: String(value) } as const;
}

function migrateLegacyCondition(
  condition: LegacyFilterCondition
): FilterCondition {
  let { operator } = condition;
  let value: FilterValue | undefined;
  if (condition.value === null) {
    if (operator === "eq") {
      operator = "is_empty";
    } else if (operator === "neq") {
      operator = "is_not_empty";
    } else {
      fail("FILTER_VALUE_TYPE_MISMATCH", "filters");
    }
  } else if (condition.value !== undefined) {
    if (operator === "between") {
      if (!Array.isArray(condition.value) || condition.value.length !== 2) {
        fail("FILTER_RANGE_REQUIRED", "filters");
      }
      value = {
        lower: legacyScalar(condition.field, condition.value[0]),
        type: "range",
        upper: legacyScalar(condition.field, condition.value[1]),
      };
    } else if (operator === "in" || operator === "not_in") {
      if (!Array.isArray(condition.value) || condition.value.length === 0) {
        fail("FILTER_LIST_REQUIRED", "filters");
      }
      value = {
        type: "list",
        values: condition.value.map((item) =>
          legacyScalar(condition.field, item)
        ),
      };
    } else {
      if (Array.isArray(condition.value)) {
        fail("FILTER_SCALAR_REQUIRED", "filters");
      }
      value = legacyScalar(condition.field, condition.value);
    }
  }
  return {
    field: condition.field,
    id: crypto.randomUUID(),
    kind: "condition",
    negated: false,
    operator,
    ...(value === undefined ? {} : { value }),
  };
}

export function migrateLegacyFilterGroup(
  group: LegacyFilterGroup
): FilterGroup {
  return {
    children: group.conditions.map((node) =>
      "conditions" in node
        ? migrateLegacyFilterGroup(node)
        : migrateLegacyCondition(node)
    ),
    combinator: group.combinator,
    id: crypto.randomUUID(),
    kind: "group",
    negated: false,
  };
}

function migrateFlatCondition(
  condition: LegacyFlatFilterCondition
): FilterCondition {
  return { ...condition, kind: "condition", negated: false };
}

function treeFromFlat(filters: LegacyFlatFilterCondition[]): FilterGroup {
  return {
    children: filters.map(migrateFlatCondition),
    combinator: "and",
    id: crypto.randomUUID(),
    kind: "group",
    negated: false,
  };
}

export function createFarmFilter(farmId: string): FilterCondition {
  return {
    field: "farmId",
    id: crypto.randomUUID(),
    kind: "condition",
    negated: false,
    operator: "eq",
    value: { type: "string", value: farmId },
  };
}

function treeContainsField(node: FilterNode, field: string): boolean {
  return node.kind === "condition"
    ? node.field === field
    : node.children.some((child) => treeContainsField(child, field));
}

function withLegacyFarmFilter(filters: FilterGroup, farmId: string) {
  if (treeContainsField(filters, "farmId")) {
    return filters;
  }
  const farm = createFarmFilter(farmId);
  if (filters.combinator === "and" && !filters.negated) {
    return { ...filters, children: [farm, ...filters.children] };
  }
  return {
    children: [farm, filters],
    combinator: "and" as const,
    id: crypto.randomUUID(),
    kind: "group" as const,
    negated: false,
  };
}

type StoredReportView = {
  chatId: string;
  columns: unknown;
  entityType: unknown;
  farmId: string;
  filters: unknown;
  groupBy: unknown;
  id: string;
  revision: number;
  ruleContext?: ReportViewState["ruleContext"];
  schemaVersion?: number;
  sort: unknown;
};

function normalizeRules(view: StoredReportView) {
  const sort = Array.isArray(view.sort)
    ? view.sort.map((rule, index) => {
        const parsed = sortRuleSchema.safeParse(rule);
        if (parsed.success) {
          return parsed.data;
        }
        const legacy = zSortLegacy(rule);
        if (!legacy) {
          fail("INVALID_STORED_REPORT_VIEW", `sort.${index}`);
        }
        return { ...legacy, id: crypto.randomUUID() };
      })
    : fail("INVALID_STORED_REPORT_VIEW", "sort");
  const groupBy = Array.isArray(view.groupBy)
    ? view.groupBy.slice(0, MAX_GROUP_RULES).map((rule, index) => {
        const parsed = groupRuleSchema.safeParse(rule);
        if (parsed.success) {
          return parsed.data;
        }
        if (typeof rule !== "string") {
          fail("INVALID_STORED_REPORT_VIEW", `groupBy.${index}`);
        }
        return {
          direction: "asc" as const,
          field: rule,
          hideEmpty: false,
          id: crypto.randomUUID(),
        };
      })
    : fail("INVALID_STORED_REPORT_VIEW", "groupBy");
  return { groupBy, sort };
}

export function normalizeStoredReportView(
  view: StoredReportView,
  registry: FieldRegistry = farmFields
): {
  migrated: boolean;
  view: ReportViewState;
} {
  if (
    view.schemaVersion !== undefined &&
    ![1, 2, 3, 4, 5, REPORT_VIEW_SCHEMA_VERSION].includes(view.schemaVersion)
  ) {
    fail("UNSUPPORTED_REPORT_VIEW_VERSION", "schemaVersion");
  }
  const base = {
    chatId: view.chatId,
    columns: view.columns,
    entityType: view.entityType,
    id: view.id,
    revision: view.revision,
    ...(view.ruleContext ? { ruleContext: view.ruleContext } : {}),
    schemaVersion: REPORT_VIEW_SCHEMA_VERSION,
  };
  if (
    view.schemaVersion === REPORT_VIEW_SCHEMA_VERSION ||
    view.schemaVersion === 5
  ) {
    return {
      migrated: view.schemaVersion !== REPORT_VIEW_SCHEMA_VERSION,
      view: validateReportViewState(
        {
          ...base,
          filters: view.filters,
          groupBy: view.groupBy,
          sort: view.sort,
        },
        registry
      ),
    };
  }

  const rules = normalizeRules(view);
  if (view.schemaVersion === 3 || view.schemaVersion === 4) {
    const filters = legacyFilterListSchema.safeParse(view.filters);
    if (!filters.success) {
      fail("INVALID_STORED_REPORT_VIEW", "filters");
    }
    return {
      migrated: true,
      view: validateReportViewState(
        {
          ...base,
          filters: treeFromFlat(filters.data),
          ...rules,
        },
        registry
      ),
    };
  }
  const v2 = filterGroupSchema.safeParse(view.filters);
  const v1 = legacyFilterGroupSchema.safeParse(view.filters);
  const filters = v2.success
    ? v2.data
    : v1.success
      ? migrateLegacyFilterGroup(v1.data)
      : fail("INVALID_STORED_REPORT_VIEW", "filters");
  return {
    migrated: true,
    view: validateReportViewState(
      {
        ...base,
        filters: withLegacyFarmFilter(filters, view.farmId),
        ...rules,
      },
      registry
    ),
  };
}

function zSortLegacy(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !(value as { field?: unknown }).field ||
    typeof (value as { field?: unknown }).field !== "string" ||
    !["asc", "desc"].includes(
      String((value as { direction?: unknown }).direction)
    )
  ) {
    return null;
  }
  return {
    direction: (value as { direction: "asc" | "desc" }).direction,
    field: (value as { field: string }).field,
  };
}

function cloneFilter(node: FilterNode): FilterNode {
  return node.kind === "condition"
    ? structuredClone(node)
    : { ...node, children: node.children.map(cloneFilter) };
}

function findFilterNode(
  group: FilterGroup,
  id: string,
  parent: FilterGroup | null = null
): { index: number; node: FilterNode; parent: FilterGroup | null } | null {
  if (group.id === id) {
    return { index: -1, node: group, parent };
  }
  for (const [index, node] of group.children.entries()) {
    if (node.id === id) {
      return { index, node, parent: group };
    }
    if (node.kind === "group") {
      const nested = findFilterNode(node, id, group);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function pruneEmptyFilterGroups(group: FilterGroup): void {
  group.children = group.children.filter((node) => {
    if (node.kind === "condition") {
      return true;
    }
    pruneEmptyFilterGroups(node);
    return node.children.length > 0;
  });
}

function insertAt<T>(items: T[], index: number, item: T, path: string) {
  if (index > items.length) {
    fail("VIEW_OPERATION_INDEX_OUT_OF_RANGE", path);
  }
  items.splice(index, 0, item);
}

function moveRule<T extends { id: string }>(
  rules: T[],
  id: string,
  index: number,
  path: string
) {
  const source = rules.findIndex((candidate) => candidate.id === id);
  if (source < 0) {
    fail("VIEW_OPERATION_TARGET_NOT_FOUND", path);
  }
  const [movedRule] = rules.splice(source, 1);
  insertAt(rules, index, movedRule, path);
}

export function applyViewOperations(
  current: ReportViewState,
  input: ViewOperation[],
  registry: FieldRegistry = farmFields
): ReportViewState {
  const operations = viewOperationsSchema.parse(input);
  const next: ReportViewState = {
    ...current,
    columns: [...current.columns],
    filters: cloneFilter(current.filters) as FilterGroup,
    groupBy: current.groupBy.length === 0 ? [] : [{ ...current.groupBy[0] }],
    sort: current.sort.map((rule) => ({ ...rule })),
  };

  for (const [operationIndex, operation] of operations.entries()) {
    const path = `operations.${operationIndex}`;
    switch (operation.type) {
      case "filter.add": {
        const target = findFilterNode(next.filters, operation.parentId);
        if (target?.node.kind !== "group") {
          fail("VIEW_OPERATION_PARENT_NOT_FOUND", `${path}.parentId`);
        }
        insertAt(
          target.node.children,
          operation.index,
          cloneFilter(operation.node),
          `${path}.index`
        );
        break;
      }
      case "filter.update": {
        const target = findFilterNode(next.filters, operation.nodeId);
        if (!target) {
          fail("VIEW_OPERATION_TARGET_NOT_FOUND", `${path}.nodeId`);
        }
        if (
          operation.node.id !== operation.nodeId ||
          operation.node.kind !== target.node.kind
        ) {
          fail("VIEW_OPERATION_IDENTITY_MISMATCH", `${path}.node`);
        }
        if (target.parent) {
          target.parent.children[target.index] = cloneFilter(operation.node);
        } else {
          next.filters = cloneFilter(operation.node) as FilterGroup;
        }
        break;
      }
      case "filter.remove": {
        const target = findFilterNode(next.filters, operation.nodeId);
        if (!target) {
          fail("VIEW_OPERATION_TARGET_NOT_FOUND", `${path}.nodeId`);
        }
        if (!target.parent) {
          fail("VIEW_OPERATION_ROOT_FORBIDDEN", `${path}.nodeId`);
        }
        target.parent.children.splice(target.index, 1);
        pruneEmptyFilterGroups(next.filters);
        break;
      }
      case "filter.replace":
        if (operation.root.id !== next.filters.id) {
          fail("VIEW_OPERATION_IDENTITY_MISMATCH", `${path}.root.id`);
        }
        next.filters = cloneFilter(operation.root) as FilterGroup;
        break;
      case "filter.move": {
        const target = findFilterNode(next.filters, operation.nodeId);
        if (!target) {
          fail("VIEW_OPERATION_TARGET_NOT_FOUND", `${path}.nodeId`);
        }
        if (!target.parent) {
          fail("VIEW_OPERATION_ROOT_FORBIDDEN", `${path}.nodeId`);
        }
        const sourceParent = target.parent;
        const [moving] = sourceParent.children.splice(target.index, 1);
        if (sourceParent.id !== operation.parentId) {
          pruneEmptyFilterGroups(next.filters);
        }
        const parent = findFilterNode(next.filters, operation.parentId);
        if (parent?.node.kind !== "group") {
          fail("VIEW_OPERATION_PARENT_NOT_FOUND", `${path}.parentId`);
        }
        insertAt(
          parent.node.children,
          operation.index,
          moving,
          `${path}.index`
        );
        break;
      }
      case "sort.add":
        insertAt(
          next.sort,
          operation.index,
          { ...operation.rule },
          `${path}.index`
        );
        break;
      case "sort.update": {
        const index = next.sort.findIndex(
          (rule) => rule.id === operation.ruleId
        );
        if (index < 0) {
          fail("VIEW_OPERATION_TARGET_NOT_FOUND", `${path}.ruleId`);
        }
        if (operation.rule.id !== operation.ruleId) {
          fail("VIEW_OPERATION_IDENTITY_MISMATCH", `${path}.rule`);
        }
        next.sort[index] = { ...operation.rule };
        break;
      }
      case "sort.remove": {
        const index = next.sort.findIndex(
          (rule) => rule.id === operation.ruleId
        );
        if (index < 0) {
          fail("VIEW_OPERATION_TARGET_NOT_FOUND", `${path}.ruleId`);
        }
        next.sort.splice(index, 1);
        break;
      }
      case "sort.move":
        moveRule(next.sort, operation.ruleId, operation.index, path);
        break;
      case "group.add":
        insertAt(
          next.groupBy,
          operation.index,
          { ...operation.rule },
          `${path}.index`
        );
        break;
      case "group.update": {
        const index = next.groupBy.findIndex(
          (rule) => rule.id === operation.ruleId
        );
        if (index < 0) {
          fail("VIEW_OPERATION_TARGET_NOT_FOUND", `${path}.ruleId`);
        }
        if (operation.rule.id !== operation.ruleId) {
          fail("VIEW_OPERATION_IDENTITY_MISMATCH", `${path}.rule`);
        }
        next.groupBy[index] = { ...operation.rule };
        break;
      }
      case "group.remove": {
        const index = next.groupBy.findIndex(
          (rule) => rule.id === operation.ruleId
        );
        if (index < 0) {
          fail("VIEW_OPERATION_TARGET_NOT_FOUND", `${path}.ruleId`);
        }
        next.groupBy.splice(index, 1);
        break;
      }
      case "view.update":
        Object.assign(next, operation.patch);
        break;
      default:
        throw new ViewValidationError(
          "UNSUPPORTED_VIEW_OPERATION",
          `${path}.type`
        );
    }
  }
  if (current.ruleContext && !sameReportViewContent(current, next)) {
    next.ruleContext = { ...current.ruleContext, modified: true };
  }
  return validateReportViewState(next, registry);
}

export function migrateLegacyPatch(
  patch: LegacyReportViewPatch
): ReportViewPatch {
  const { farmId, filters, groupBy, sort, ...rest } = patch;
  const migratedFilters = filters
    ? migrateLegacyFilterGroup(filters)
    : createEmptyFilterGroup();
  return {
    ...rest,
    ...(filters || farmId
      ? {
          filters: farmId
            ? withLegacyFarmFilter(migratedFilters, farmId)
            : migratedFilters,
        }
      : {}),
    ...(groupBy
      ? {
          groupBy:
            groupBy.length === 0
              ? ([] as const)
              : ([
                  {
                    direction: "asc" as const,
                    field: groupBy[0],
                    hideEmpty: false,
                    id: crypto.randomUUID(),
                  },
                ] as const),
        }
      : {}),
    ...(sort
      ? { sort: sort.map((rule) => ({ ...rule, id: crypto.randomUUID() })) }
      : {}),
  };
}

export function createEmptyFilterGroup(): FilterGroup {
  return {
    children: [],
    combinator: "and",
    id: crypto.randomUUID(),
    kind: "group",
    negated: false,
  };
}

export function createDefaultFilterTree(farmId: string): FilterGroup {
  return {
    ...createEmptyFilterGroup(),
    children: [createFarmFilter(farmId)],
  };
}

export function createDefaultSortRule() {
  return {
    direction: "asc" as const,
    field: "primaryIdentifier",
    id: crypto.randomUUID(),
  };
}

export function sameReportViewContent(
  left: ReportViewState,
  right: ReportViewState
) {
  const strip = ({ revision: _revision, ...value }: ReportViewState) => value;
  return JSON.stringify(strip(left)) === JSON.stringify(strip(right));
}

import { z } from "zod";

export const REPORT_VIEW_SCHEMA_VERSION = 6 as const;
export const MAX_FILTER_DEPTH = 8;
// The source corpus has 119 predicates; leave room for farm/vitality guards.
export const MAX_FILTER_CONDITIONS = 128;
export const MAX_VIEW_COLUMNS = 64;
export const MAX_SORT_RULES = 5;
export const MAX_GROUP_RULES = 1;

export const filterOperatorSchema = z.enum([
  "eq",
  "neq",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "today",
  "in_last",
  "in_next",
  "is_empty",
  "is_not_empty",
]);

export type FilterOperator = z.infer<typeof filterOperatorSchema>;

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    },
    { message: "INVALID_FILTER_DATE" }
  );

export const filterScalarSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), value: z.string().max(500) }).strict(),
  z.object({ type: z.literal("number"), value: z.number().finite() }).strict(),
  z
    .object({
      type: z.literal("decimal"),
      value: z
        .string()
        .max(256)
        .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/),
    })
    .strict(),
  z.object({ type: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("date"), value: dateStringSchema }).strict(),
]);

export type FilterScalar = z.infer<typeof filterScalarSchema>;

export const filterValueSchema = z.discriminatedUnion("type", [
  ...filterScalarSchema.options,
  z
    .object({ field: z.string().min(1).max(80), type: z.literal("field") })
    .strict(),
  z
    .object({
      offset: z.number().int().min(-36_500).max(36_500),
      type: z.literal("relative_day"),
    })
    .strict(),
  z
    .object({
      type: z.literal("list"),
      values: z.array(filterScalarSchema).min(1).max(100),
    })
    .strict(),
  z
    .object({
      lower: filterScalarSchema,
      type: z.literal("range"),
      upper: filterScalarSchema,
    })
    .strict(),
  z
    .object({
      amount: z.number().int().min(1).max(3650),
      type: z.literal("relative_date"),
      unit: z.enum(["day", "week", "month"]),
    })
    .strict(),
]);

export type FilterValue = z.infer<typeof filterValueSchema>;

export type FilterCondition = {
  field: string;
  id: string;
  kind: "condition";
  negated: boolean;
  operator: FilterOperator;
  value?: FilterValue;
};

export type FilterGroup = {
  children: FilterNode[];
  combinator: "and" | "or";
  id: string;
  kind: "group";
  negated: boolean;
};

export type FilterNode = FilterCondition | FilterGroup;

export const filterConditionSchema: z.ZodType<FilterCondition> = z
  .object({
    field: z.string().min(1).max(80),
    id: z.uuid(),
    kind: z.literal("condition"),
    negated: z.boolean(),
    operator: filterOperatorSchema,
    value: filterValueSchema.optional(),
  })
  .strict();

export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z
    .object({
      children: z.array(filterNodeSchema).max(MAX_FILTER_CONDITIONS * 2),
      combinator: z.enum(["and", "or"]),
      id: z.uuid(),
      kind: z.literal("group"),
      negated: z.boolean(),
    })
    .strict()
);

export const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([filterConditionSchema, filterGroupSchema])
);

export const legacyFlatFilterConditionSchema = z
  .object({
    field: z.string().min(1).max(80),
    id: z.uuid(),
    operator: filterOperatorSchema,
    value: filterValueSchema.optional(),
  })
  .strict();

export type LegacyFlatFilterCondition = z.infer<
  typeof legacyFlatFilterConditionSchema
>;

export const legacyFilterListSchema = z
  .array(legacyFlatFilterConditionSchema)
  .max(MAX_FILTER_CONDITIONS);

export const sortRuleSchema = z
  .object({
    direction: z.enum(["asc", "desc"]),
    field: z.string().min(1).max(80),
    id: z.uuid(),
  })
  .strict();

export type SortRule = z.infer<typeof sortRuleSchema>;
/** @deprecated Use SortRule. */
export type SortSpec = SortRule;

export const groupRuleSchema = z
  .object({
    direction: z.enum(["asc", "desc"]),
    field: z.string().min(1).max(80),
    hideEmpty: z.boolean(),
    id: z.uuid(),
  })
  .strict();

export type GroupRule = z.infer<typeof groupRuleSchema>;

export type GroupRuleList = [] | [GroupRule];

export const groupRuleListSchema: z.ZodType<GroupRuleList> = z.union([
  z.tuple([]),
  z.tuple([groupRuleSchema]),
]);

export const reportViewPatchSchema = z
  .object({
    columns: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(MAX_VIEW_COLUMNS)
      .optional(),
    filters: filterGroupSchema.optional(),
    groupBy: groupRuleListSchema.optional(),
    sort: z.array(sortRuleSchema).max(MAX_SORT_RULES).optional(),
  })
  .strict();

export type ReportViewPatch = z.infer<typeof reportViewPatchSchema>;

export type LegacyFilterValue =
  | boolean
  | number
  | string
  | null
  | Array<boolean | number | string>;

export type LegacyFilterCondition = {
  field: string;
  operator: FilterOperator;
  value?: LegacyFilterValue;
};

export type LegacyFilterGroup = {
  combinator: "and" | "or";
  conditions: Array<LegacyFilterCondition | LegacyFilterGroup>;
};

export const legacyFilterConditionSchema: z.ZodType<LegacyFilterCondition> = z
  .object({
    field: z.string().min(1).max(80),
    operator: filterOperatorSchema,
    value: z
      .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.string(), z.number(), z.boolean()])).max(100),
      ])
      .optional(),
  })
  .strict();

export const legacyFilterGroupSchema: z.ZodType<LegacyFilterGroup> = z.lazy(
  () =>
    z
      .object({
        combinator: z.enum(["and", "or"]),
        conditions: z
          .array(
            z.union([legacyFilterConditionSchema, legacyFilterGroupSchema])
          )
          .max(MAX_FILTER_CONDITIONS * 2),
      })
      .strict()
);

export const legacyReportViewPatchSchema = z
  .object({
    columns: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(MAX_VIEW_COLUMNS)
      .optional(),
    farmId: z.uuid().optional(),
    filters: legacyFilterGroupSchema.optional(),
    groupBy: z.array(z.string().min(1).max(80)).max(MAX_GROUP_RULES).optional(),
    sort: z
      .array(
        z
          .object({
            direction: z.enum(["asc", "desc"]),
            field: z.string().min(1).max(80),
          })
          .strict()
      )
      .max(MAX_SORT_RULES)
      .optional(),
  })
  .strict();

export type LegacyReportViewPatch = z.infer<typeof legacyReportViewPatchSchema>;

const indexedOperationSchema = z.object({
  index: z.number().int().nonnegative(),
});

export const viewOperationSchema = z.discriminatedUnion("type", [
  indexedOperationSchema
    .extend({
      node: filterNodeSchema,
      parentId: z.uuid(),
      type: z.literal("filter.add"),
    })
    .strict(),
  z
    .object({
      node: filterNodeSchema,
      nodeId: z.uuid(),
      type: z.literal("filter.update"),
    })
    .strict(),
  z.object({ nodeId: z.uuid(), type: z.literal("filter.remove") }).strict(),
  z
    .object({ root: filterGroupSchema, type: z.literal("filter.replace") })
    .strict(),
  indexedOperationSchema
    .extend({
      nodeId: z.uuid(),
      parentId: z.uuid(),
      type: z.literal("filter.move"),
    })
    .strict(),
  indexedOperationSchema
    .extend({ rule: sortRuleSchema, type: z.literal("sort.add") })
    .strict(),
  z
    .object({
      rule: sortRuleSchema,
      ruleId: z.uuid(),
      type: z.literal("sort.update"),
    })
    .strict(),
  z.object({ ruleId: z.uuid(), type: z.literal("sort.remove") }).strict(),
  indexedOperationSchema
    .extend({ ruleId: z.uuid(), type: z.literal("sort.move") })
    .strict(),
  z
    .object({
      index: z.literal(0),
      rule: groupRuleSchema,
      type: z.literal("group.add"),
    })
    .strict(),
  z
    .object({
      rule: groupRuleSchema,
      ruleId: z.uuid(),
      type: z.literal("group.update"),
    })
    .strict(),
  z.object({ ruleId: z.uuid(), type: z.literal("group.remove") }).strict(),
  z
    .object({
      patch: z
        .object({
          columns: z
            .array(z.string().min(1).max(80))
            .min(1)
            .max(MAX_VIEW_COLUMNS)
            .optional(),
        })
        .strict(),
      type: z.literal("view.update"),
    })
    .strict(),
]);

export type ViewOperation = z.infer<typeof viewOperationSchema>;

export const viewOperationsSchema = z.array(viewOperationSchema).min(1).max(50);

export type FarmSummary = {
  id: string;
  name: string;
  role: string;
  timezone: string;
};

export type AnimalRow = Record<string, boolean | number | string | null> & {
  animalId: string;
  farmId: string;
};

export type GroupPathItem = {
  field: string;
  value: boolean | number | string | null;
};

export type GroupPath = [] | [GroupPathItem];

export const groupPathItemSchema = z
  .object({
    field: z.string().min(1).max(80),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })
  .strict();

export const groupPathSchema: z.ZodType<GroupPath> = z.union([
  z.tuple([]),
  z.tuple([groupPathItemSchema]),
]);

export type AnimalGroupNode = {
  count: number;
  field: string;
  key: string;
  kind: "group";
  path: GroupPath;
  value: boolean | number | string | null;
};

type AnimalPageBase = {
  asOf?: string;
  end: boolean;
  nextCursor: string | null;
  snapshot: string;
  totalRows: number;
};

export type AnimalRowsPage = AnimalPageBase & {
  groups: [];
  kind: "rows";
  rows: AnimalRow[];
  totalGroups: 0;
};

export type AnimalGroupsPage = AnimalPageBase & {
  groups: AnimalGroupNode[];
  kind: "groups";
  rows: [];
  totalGroups: number;
};

export type AnimalPage = AnimalRowsPage | AnimalGroupsPage;

export const ruleContextSchema = z
  .object({
    asOf: z.iso.datetime(),
    bindingId: z.uuid(),
    bindingVersion: z.string().min(1).max(128),
    modified: z.boolean(),
    parameters: z.record(z.string().max(80), filterScalarSchema),
    ruleId: z.uuid(),
    ruleVersion: z.string().min(1).max(128),
    snapshot: z.string().min(1).max(128),
  })
  .strict();
export type RuleContext = z.infer<typeof ruleContextSchema>;

export type ReportViewState = {
  chatId: string;
  columns: string[];
  entityType: "animal";
  filters: FilterGroup;
  groupBy: GroupRuleList;
  id: string;
  revision: number;
  ruleContext?: RuleContext | null;
  schemaVersion: typeof REPORT_VIEW_SCHEMA_VERSION;
  sort: SortRule[];
};

export const reportViewStateSchema: z.ZodType<ReportViewState> = z
  .object({
    chatId: z.uuid(),
    columns: z.array(z.string().min(1).max(80)).min(1).max(MAX_VIEW_COLUMNS),
    entityType: z.literal("animal"),
    filters: filterGroupSchema,
    groupBy: groupRuleListSchema,
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
    ruleContext: ruleContextSchema.nullish(),
    schemaVersion: z.literal(REPORT_VIEW_SCHEMA_VERSION),
    sort: z.array(sortRuleSchema).max(MAX_SORT_RULES),
  })
  .strict();

export type ViewContext = {
  expandedGroupPaths: GroupPath[];
  revision: number;
  selectedIds: string[];
  viewId: string;
  viewportRowIds: string[];
};

export const viewContextSchema = z.object({
  expandedGroupPaths: z.array(groupPathSchema).max(100).default([]),
  revision: z.number().int().nonnegative(),
  selectedIds: z.array(z.uuid()).max(200).default([]),
  viewId: z.uuid(),
  viewportRowIds: z.array(z.uuid()).max(200).default([]),
});

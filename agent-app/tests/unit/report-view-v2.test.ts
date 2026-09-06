import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertCursorMatches,
  decodeFarmCursor,
  encodeFarmCursor,
  reportQueryFingerprint,
} from "../../lib/farm/cursor";
import { compileFilter, keysetAfterSql } from "../../lib/farm/sql";
import { REPORT_VIEW_SCHEMA_VERSION } from "../../lib/farm/types";
import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  GroupRule,
  ReportViewState,
  ViewOperation,
} from "../../lib/farm/types";
import {
  applyViewOperations,
  normalizeStoredReportView,
  ViewValidationError,
  validateReportViewState,
} from "../../lib/farm/view-model";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const ids = {
  chat: id(1),
  condition: id(2),
  farm: id(3),
  group: id(4),
  group2: id(5),
  sort: id(6),
  view: id(7),
};

function condition(overrides: Partial<FilterCondition> = {}): FilterCondition {
  return {
    field: "lastWeightKg",
    id: ids.condition,
    kind: "condition",
    negated: false,
    operator: "between",
    value: {
      lower: { type: "number", value: 500 },
      type: "range",
      upper: { type: "number", value: 650 },
    },
    ...overrides,
  };
}

function group(
  children: FilterNode[] = [],
  overrides: Partial<FilterGroup> = {}
): FilterGroup {
  return {
    children,
    combinator: "and",
    id: ids.group,
    kind: "group",
    negated: false,
    ...overrides,
  };
}

function baseView(filters: FilterGroup = group()): ReportViewState {
  return {
    chatId: ids.chat,
    columns: ["primaryIdentifier", "lastWeightKg"],
    entityType: "animal",
    filters,
    groupBy: [],
    id: ids.view,
    revision: 3,
    schemaVersion: REPORT_VIEW_SCHEMA_VERSION,
    sort: [{ direction: "asc", field: "primaryIdentifier", id: ids.sort }],
  };
}

function groupRule(overrides: Partial<GroupRule> = {}): GroupRule {
  return {
    direction: "asc",
    field: "sex",
    hideEmpty: false,
    id: id(20),
    ...overrides,
  };
}

function flat(conditionNode: FilterCondition) {
  const { kind: _kind, negated: _negated, ...legacy } = conditionNode;
  return legacy;
}

describe("ReportView version migration", () => {
  test("keeps current version stable and wraps flat v4 filters in an AND root", () => {
    const current = baseView(group([condition()]));
    const stable = normalizeStoredReportView({ ...current, farmId: ids.farm });
    assert.equal(stable.migrated, false);
    assert.deepEqual(stable.view, current);

    const migrated = normalizeStoredReportView({
      ...current,
      farmId: ids.farm,
      filters: [flat(condition())],
      schemaVersion: 4,
    });
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.view.schemaVersion, REPORT_VIEW_SCHEMA_VERSION);
    assert.equal(migrated.view.filters.combinator, "and");
    assert.equal(migrated.view.filters.children[0]?.kind, "condition");
  });

  test("migrates legacy v5 while preserving its complete tree", () => {
    const filters = group([condition({ negated: true })], { combinator: "or" });
    const migrated = normalizeStoredReportView({
      ...baseView(filters),
      farmId: ids.farm,
      schemaVersion: 5,
    });
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.view.schemaVersion, REPORT_VIEW_SCHEMA_VERSION);
    assert.deepEqual(migrated.view.filters, filters);
  });

  test("preserves a v2 OR/NOT tree and adds the legacy farm as an outer AND", () => {
    const legacyTree = group(
      [
        condition({
          negated: true,
          operator: "gte",
          value: { type: "number", value: 550 },
        }),
        condition({
          field: "statusCode",
          id: id(8),
          operator: "eq",
          value: { type: "string", value: "HEIFER" },
        }),
      ],
      { combinator: "or", negated: true }
    );
    const migrated = normalizeStoredReportView({
      ...baseView(),
      farmId: ids.farm,
      filters: legacyTree,
      schemaVersion: 2,
    });
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.view.filters.combinator, "and");
    assert.equal(migrated.view.filters.children[0]?.kind, "condition");
    const [, restored] = migrated.view.filters.children;
    assert.equal(restored?.kind, "group");
    assert.equal(restored?.kind === "group" && restored.combinator, "or");
    assert.equal(restored?.negated, true);
  });

  test("rejects future versions instead of guessing their shape", () => {
    assert.throws(
      () =>
        normalizeStoredReportView({
          ...baseView(),
          farmId: ids.farm,
          schemaVersion: REPORT_VIEW_SCHEMA_VERSION + 1,
        }),
      (error) =>
        error instanceof ViewValidationError &&
        error.code === "UNSUPPORTED_REPORT_VIEW_VERSION"
    );
  });
});

describe("ReportView validation and operations", () => {
  test("rejects impossible calendar dates", () => {
    assert.throws(
      () =>
        validateReportViewState(
          baseView(
            group([
              condition({
                field: "expectedCalvingDate",
                operator: "eq",
                value: { type: "date", value: "2026-02-31" },
              }),
            ])
          )
        ),
      (error) =>
        error instanceof ViewValidationError &&
        error.code === "INVALID_REPORT_VIEW"
    );
  });

  test("applies tree add, update and remove without mutating input", () => {
    const current = baseView();
    const added = condition();
    const operations: ViewOperation[] = [
      {
        index: 0,
        node: added,
        parentId: current.filters.id,
        type: "filter.add",
      },
      {
        node: {
          ...added,
          operator: "gte",
          value: { type: "number", value: 500 },
        },
        nodeId: added.id,
        type: "filter.update",
      },
    ];
    const next = applyViewOperations(current, operations);
    assert.equal(next.filters.children.length, 1);
    const [updated] = next.filters.children;
    assert.equal(updated?.kind === "condition" && updated.operator, "gte");
    assert.equal(current.filters.children.length, 0);

    const removed = applyViewOperations(next, [
      { nodeId: added.id, type: "filter.remove" },
    ]);
    assert.deepEqual(removed.filters.children, []);
  });

  test("rejects a second grouping rule", () => {
    const current: ReportViewState = {
      ...baseView(),
      groupBy: [groupRule()],
    };
    assert.throws(
      () =>
        applyViewOperations(current, [
          {
            index: 0,
            rule: groupRule({ field: "statusCode", id: ids.group2 }),
            type: "group.add",
          },
        ]),
      (error) =>
        error instanceof ViewValidationError &&
        error.code === "INVALID_REPORT_VIEW"
    );
  });
});

describe("nested filter SQL", () => {
  test("compiles (A AND B) OR (C AND NOT D) without flattening", () => {
    const filters = group(
      [
        group(
          [
            condition(),
            condition({
              field: "statusCode",
              id: id(11),
              operator: "eq",
              value: { type: "string", value: "LACTATING" },
            }),
          ],
          { id: id(12) }
        ),
        group(
          [
            condition({
              field: "isPregnant",
              id: id(13),
              operator: "eq",
              value: { type: "boolean", value: true },
            }),
            condition({
              field: "name",
              id: id(14),
              negated: true,
              operator: "contains",
              value: { type: "string", value: "100%_sure" },
            }),
          ],
          { id: id(15) }
        ),
      ],
      { combinator: "or" }
    );
    const parameters: Array<boolean | number | string | string[] | null> = [];
    const sql = compileFilter(filters, parameters, {
      asOf: "2026-09-03T12:00:00.000Z",
      timezone: "America/Argentina/Buenos_Aires",
    });
    assert.match(sql, / OR /);
    assert.match(sql, / AND /);
    assert.match(sql, /NOT/);
    assert.equal(parameters.at(-1), "%100\\%\\_sure%");
  });
});

describe("signed keyset cursor", () => {
  test("binds the cursor to the effective farm scope", () => {
    process.env.CURSOR_SECRET = "unit-test-cursor-secret";
    const fingerprint = reportQueryFingerprint({
      columns: ["primaryIdentifier"],
      farmIds: [ids.farm],
      filters: baseView().filters,
      groupBy: [],
      groupPath: [],
      kind: "rows",
      revision: 3,
      sort: baseView().sort,
      viewId: ids.view,
    });
    const changedFarmFingerprint = reportQueryFingerprint({
      columns: ["primaryIdentifier"],
      farmIds: [ids.farm, id(12)],
      filters: baseView().filters,
      groupBy: [],
      groupPath: [],
      kind: "rows",
      revision: 3,
      sort: baseView().sort,
      viewId: ids.view,
    });
    assert.notEqual(changedFarmFingerprint, fingerprint);

    const token = encodeFarmCursor({
      after: ["T1-0050", ids.condition],
      asOf: "2026-09-03T12:00:00.000Z",
      fingerprint,
      kind: "rows",
      level: 0,
      revision: 3,
      snapshot: "snapshot-a",
      viewId: ids.view,
    });
    const decoded = decodeFarmCursor(token);
    assert.deepEqual(decoded.after, ["T1-0050", ids.condition]);
    assert.throws(() => decodeFarmCursor(`${token.slice(0, -1)}x`), {
      message: "CURSOR_TAMPERED",
    });
    assert.throws(
      () =>
        assertCursorMatches(decoded, {
          fingerprint: changedFarmFingerprint,
          kind: "rows",
          level: 0,
          revision: 3,
          snapshot: "snapshot-a",
          viewId: ids.view,
        }),
      { message: "CURSOR_STALE" }
    );
  });

  test("builds mixed-direction keyset logic with NULL tie handling", () => {
    const parameters: Array<boolean | number | string | string[] | null> = [];
    const sql = keysetAfterSql(
      [
        { direction: "asc", sql: "s.status_code" },
        { direction: "desc", sql: "s.last_weight_kg" },
        { direction: "asc", sql: "s.animal_id" },
      ],
      [null, 650, ids.condition],
      parameters
    );
    assert.match(sql, /IS NOT DISTINCT FROM/);
    assert.match(sql, /last_weight_kg </);
    assert.match(sql, /animal_id >/);
    assert.ok(parameters.includes(null));
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canRebaseViewOperations } from "../../components/chat/table-view/rebase";
import { REPORT_VIEW_SCHEMA_VERSION } from "../../lib/farm/types";
import type { ReportViewState, ViewOperation } from "../../lib/farm/types";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function view(): ReportViewState {
  return {
    chatId: id(1),
    columns: ["primaryIdentifier", "name"],
    entityType: "animal",
    filters: {
      children: [
        {
          field: "statusCode",
          id: id(5),
          kind: "condition",
          negated: false,
          operator: "eq",
          value: { type: "string", value: "LACTATING" },
        },
      ],
      combinator: "and",
      id: id(4),
      kind: "group",
      negated: false,
    },
    groupBy: [],
    id: id(3),
    revision: 4,
    schemaVersion: REPORT_VIEW_SCHEMA_VERSION,
    sort: [{ direction: "asc", field: "primaryIdentifier", id: id(6) }],
  };
}

describe("view operation rebase", () => {
  test("replays an independent column edit over a filter change", () => {
    const base = view();
    const current = structuredClone(base);
    current.revision += 1;
    const [currentCondition] = current.filters.children;
    if (currentCondition?.kind === "condition") {
      current.filters.children[0] = { ...currentCondition, operator: "neq" };
    }
    const operations: ViewOperation[] = [
      {
        patch: { columns: ["primaryIdentifier", "statusCode"] },
        type: "view.update",
      },
    ];
    assert.equal(canRebaseViewOperations(base, current, operations), true);
  });

  test("does not replay over a concurrent edit of the same property", () => {
    const base = view();
    const current = {
      ...base,
      columns: ["primaryIdentifier", "statusCode"],
      revision: 5,
    };
    const operations: ViewOperation[] = [
      {
        patch: { columns: ["primaryIdentifier", "lastWeightKg"] },
        type: "view.update",
      },
    ];
    assert.equal(canRebaseViewOperations(base, current, operations), false);
  });

  test("replays an ID-addressed filter update when its condition is unchanged", () => {
    const base = view();
    const current = {
      ...base,
      revision: 5,
      sort: [{ ...base.sort[0], direction: "desc" as const }],
    };
    const [condition] = base.filters.children;
    assert.equal(condition?.kind, "condition");
    if (condition?.kind !== "condition") {
      return;
    }
    const operations: ViewOperation[] = [
      {
        node: { ...condition, operator: "neq" },
        nodeId: condition.id,
        type: "filter.update",
      },
    ];
    assert.equal(canRebaseViewOperations(base, current, operations), true);
  });

  test("does not replay a filter add after the list changed", () => {
    const base = view();
    const current = structuredClone(base);
    current.revision += 1;
    current.filters.children = [];
    const operations: ViewOperation[] = [
      {
        index: 1,
        node: {
          field: "isPregnant",
          id: id(7),
          kind: "condition",
          negated: false,
          operator: "eq",
          value: { type: "boolean", value: true },
        },
        parentId: base.filters.id,
        type: "filter.add",
      },
    ];
    assert.equal(canRebaseViewOperations(base, current, operations), false);
  });

  test("does not replay an update when the target filter was removed", () => {
    const base = view();
    const current = {
      ...base,
      filters: { ...base.filters, children: [] },
      revision: 5,
    };
    const [condition] = base.filters.children;
    assert.equal(condition?.kind, "condition");
    if (condition?.kind !== "condition") {
      return;
    }
    const operations: ViewOperation[] = [
      {
        node: { ...condition, operator: "neq" },
        nodeId: condition.id,
        type: "filter.update",
      },
    ];
    assert.equal(canRebaseViewOperations(base, current, operations), false);
  });
});

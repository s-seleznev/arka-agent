import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { canRebaseViewOperations } from "../../components/chat/table-view/rebase";
import { REPORT_VIEW_SCHEMA_VERSION } from "../../lib/farm/types";
import type {
  FilterCondition,
  FilterGroup,
  ReportViewState,
  ViewOperation,
} from "../../lib/farm/types";

function fixture() {
  const target: FilterCondition = {
    id: randomUUID(),
    kind: "condition",
    field: "ageDays",
    operator: "gt",
    negated: false,
    value: { type: "number", value: 10 },
  };
  const sibling: FilterCondition = {
    ...target,
    id: randomUUID(),
    value: { type: "number", value: 20 },
  };
  const nested: FilterGroup = {
    id: randomUUID(),
    kind: "group",
    combinator: "and",
    negated: false,
    children: [target, sibling],
  };
  const base: ReportViewState = {
    id: randomUUID(),
    chatId: randomUUID(),
    revision: 1,
    schemaVersion: REPORT_VIEW_SCHEMA_VERSION,
    entityType: "animal",
    columns: ["primaryIdentifier"],
    sort: [],
    groupBy: [],
    filters: {
      id: randomUUID(),
      kind: "group",
      combinator: "and",
      negated: false,
      children: [nested],
    },
  };
  const current = structuredClone(base);
  current.revision += 1;
  const operations: ViewOperation[] = [
    {
      type: "filter.update",
      nodeId: target.id,
      node: { ...target, operator: "gte" },
    },
  ];
  return { base, current, target, nested, operations };
}

test("rebase rejects changed AND/OR or NOT ancestry even when leaf is identical", () => {
  for (const change of ["combinator", "negated"] as const) {
    const { base, current, operations } = fixture();
    const nested = current.filters.children[0] as FilterGroup;
    if (change === "combinator") nested.combinator = "or";
    else nested.negated = true;
    assert.equal(
      canRebaseViewOperations(base, current, operations),
      false,
      change
    );
  }
});

test("rebase rejects a leaf moved to another logical parent", () => {
  const { base, current, operations, target } = fixture();
  const nested = current.filters.children[0] as FilterGroup;
  nested.children.shift();
  current.filters.children.push({
    ...nested,
    id: randomUUID(),
    children: [structuredClone(target)],
  });
  assert.equal(canRebaseViewOperations(base, current, operations), false);
});

test("rebase permits an independent sibling value edit in unchanged group context", () => {
  const { base, current, operations } = fixture();
  const nested = current.filters.children[0] as FilterGroup;
  const sibling = nested.children[1] as FilterCondition;
  sibling.value = { type: "number", value: 30 };
  assert.equal(canRebaseViewOperations(base, current, operations), true);
});

test("rebase rejects root NOT changes for filter removal and nested adds", () => {
  const { base, current, target, nested } = fixture();
  current.filters.negated = true;
  const remove: ViewOperation = { type: "filter.remove", nodeId: target.id };
  const add: ViewOperation = {
    type: "filter.add",
    parentId: nested.id,
    index: 2,
    node: { ...target, id: randomUUID() },
  };
  assert.equal(canRebaseViewOperations(base, current, [remove]), false);
  assert.equal(canRebaseViewOperations(base, current, [add]), false);
});

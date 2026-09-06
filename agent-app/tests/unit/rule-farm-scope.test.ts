import assert from "node:assert/strict";
import test from "node:test";
import type { FilterGroup } from "../../lib/farm/types";
import { farmMayMatch } from "../../lib/rules/farm-scope";

test("empty AND and OR use the same unfiltered scope as query SQL", () => {
  for (const combinator of ["and", "or"] as const) {
    const root: FilterGroup = {
      children: [],
      combinator,
      id: "scope",
      kind: "group",
      negated: false,
    };
    assert.deepEqual(farmMayMatch(root, "farm-a"), [true, false]);
    assert.deepEqual(farmMayMatch({ ...root, negated: true }, "farm-a"), [
      false,
      true,
    ]);
  }
});

test("a non-farm OR branch does not incorrectly exclude a bound farm", () => {
  const root: FilterGroup = {
    children: [
      {
        field: "farmId",
        id: "farm",
        kind: "condition",
        negated: false,
        operator: "eq",
        value: { type: "string", value: "farm-b" },
      },
      {
        field: "name",
        id: "name",
        kind: "condition",
        negated: false,
        operator: "eq",
        value: { type: "string", value: "A" },
      },
    ],
    combinator: "or",
    id: "scope",
    kind: "group",
    negated: false,
  };
  assert.equal(farmMayMatch(root, "farm-a")[0], true);
  assert.equal(
    farmMayMatch({ ...root, combinator: "and" }, "farm-a")[0],
    false
  );
});

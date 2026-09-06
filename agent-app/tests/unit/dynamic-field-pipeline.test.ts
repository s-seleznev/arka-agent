import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { farmFields } from "../../lib/farm/fields";
import { compileFilter } from "../../lib/farm/sql";
import { validateFilterGroup } from "../../lib/farm/view-model";
import { compileListRule } from "../../lib/rules/compiler";
import type { NormalizedRule, RuleBinding } from "../../lib/rules/source-types";

const registeredId = `registered_${randomUUID()}`;
const registry = {
  ...farmFields,
  [registeredId]: {
    ...farmFields.lastMilkKg,
    id: registeredId,
    label: "Registered score",
    sql: "(s.rule_values->>'SAFE_SCORE')::numeric",
  },
};
const span = { column: "filters_text", end: 1, start: 0 };
const source: NormalizedRule = {
  columns: [{ label: "Registered score", span }],
  diagnostics: [],
  groupBy: [],
  parserVersion: "qa",
  raw: { filters_text: "fixture" },
  selection: {
    rootCombination: "SINGLE",
    roots: [
      {
        fieldLabel: "Registered score",
        fieldSpan: span,
        kind: "predicate",
        operand: { kind: "decimal", raw: "4", value: "4" },
        operator: "=",
        span,
      },
    ],
  },
  source: {
    companyId: "3",
    definitionId: "qa-dynamic",
    listId: "qa",
    rowNumber: 1,
    snapshotSha256: "a".repeat(64),
  },
  status: { parsed: true, semanticResolved: false },
  vitality: { raw: "Все", value: "all" },
};
const binding: RuleBinding = {
  emptySelectionPolicy: "no_predicate",
  farmId: "00000000-0000-4000-8000-000000000001",
  fieldBindings: { "Registered score": registeredId },
  nullPolicy: "sql_null",
  parameters: {},
  rootPolicy: "flat_and",
  sourceCompanyId: "3",
  version: "qa/v1",
  vitalityPolicy: "life_state",
};
test("explicit registered mapping compiles columns and predicates through the same validator", () => {
  assert.equal(compileListRule(source, binding).patch, undefined);
  const compiled = compileListRule(source, binding, registry);
  assert.deepEqual(compiled.diagnostics, []);
  assert.ok(compiled.patch?.filters);
  assert.deepEqual(compiled.patch.columns, [registeredId]);
  validateFilterGroup(compiled.patch.filters, registry);
  const sql = compileFilter(compiled.patch.filters, [], {
    asOf: "2026-09-04T12:00:00Z",
    registry,
  });
  assert.match(sql, /SAFE_SCORE/);
  assert.equal(
    compileListRule(source, { ...binding, fieldBindings: {} }, registry).patch,
    undefined,
    "labels are never guessed"
  );
});
test("registered timestamp operands normalize both sides to the farm local day", () => {
  const timestampId = `registered_${randomUUID()}`;
  const timestamps = {
    ...registry,
    [timestampId]: {
      ...farmFields.birthDate,
      id: timestampId,
      sql: "(s.rule_values->>'SAFE_TIMESTAMP')::timestamptz",
      timestamp: true,
    },
  };
  const filters = {
    children: [
      {
        field: timestampId,
        id: randomUUID(),
        kind: "condition" as const,
        negated: false,
        operator: "gte" as const,
        value: { offset: -365, type: "relative_day" as const },
      },
    ],
    combinator: "and" as const,
    id: randomUUID(),
    kind: "group" as const,
    negated: false,
  };
  const sql = compileFilter(filters, [], {
    asOf: "2026-09-04T12:00:00Z",
    registry: timestamps,
    timezoneSql: "f.timezone",
  });
  assert.match(sql, /SAFE_TIMESTAMP.*AT TIME ZONE f.timezone\)::date/);
  assert.match(sql, /\+ \$\d+::integer/);
});

test("registered field binding cannot borrow another authorized farm's definition", () => {
  const otherFarmRegistry = {
    ...registry,
    [registeredId]: {
      ...registry[registeredId],
      farmIds: ["00000000-0000-4000-8000-000000000002"],
    },
  };
  const compiled = compileListRule(source, binding, otherFarmRegistry);
  assert.equal(compiled.patch, undefined);
  assert.ok(compiled.diagnostics.some((item) => item.code === "FIELD_UNMAPPED"));
});

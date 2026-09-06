import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { compileListRule } from "../../lib/rules/compiler";
import type {
  NormalizedRule,
  RuleBinding,
  SourceNode,
} from "../../lib/rules/source-types";

const span = { column: "filters_text", end: 10, start: 0 };
const binding: RuleBinding = {
  emptySelectionPolicy: "no_predicate",
  farmId: "00000000-0000-4000-8000-000000000001",
  nullPolicy: "sql_null",
  parameters: {},
  rootPolicy: "flat_and",
  sourceCompanyId: "3",
  version: "simulation/v1",
  vitalityPolicy: "life_state",
};
function predicate(fieldLabel: string, operator = "=", raw = "2"): SourceNode {
  return {
    fieldLabel,
    fieldSpan: span,
    kind: "predicate",
    operand: /^\d/.test(raw)
      ? { kind: "decimal", raw, value: raw }
      : { kind: "unresolved", raw },
    operator,
    span,
  };
}
function source(roots: SourceNode[]): NormalizedRule {
  return {
    columns: [{ label: "Номер животного", span }],
    diagnostics: [],
    groupBy: [],
    parserVersion: "csv-rules-text/v1",
    raw: { filters_text: "fixture", vitality_filter: "Все" },
    selection: { rootCombination: roots.length === 1 ? "SINGLE" : null, roots },
    source: {
      companyId: "3",
      definitionId: "fixture",
      listId: "fixture",
      rowNumber: 1,
      snapshotSha256: "a".repeat(64),
    },
    status: { parsed: true, semanticResolved: false },
    vitality: { raw: "Все", value: "all" },
  };
}
test("source OR stays enclosed by farm AND; decimal and IDs are exact", () => {
  const record = source([
    {
      children: [
        predicate("Лактация", "≥", "2.0000000000000001"),
        predicate("Лактация"),
      ],
      kind: "group",
      name: null,
      operator: "OR",
      span,
    },
  ]);
  const result = compileListRule(record, binding);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.patch?.filters);
  const root = result.patch.filters;
  assert.equal(root.combinator, "and");
  assert.equal(root.children[0].kind, "condition");
  const [, nested] = root.children;
  assert.equal(nested.kind, "group");
  if (nested.kind === "group") {
    assert.equal(nested.combinator, "or");
    const [leaf] = nested.children;
    assert.equal(
      leaf.kind === "condition" &&
        leaf.value?.type === "decimal" &&
        leaf.value.value,
      "2.0000000000000001"
    );
  }
  assert.deepEqual(compileListRule(record, binding), result);
});
test("flat roots require policy; named multiple roots block", () => {
  const record = source([
    predicate("Лактация"),
    predicate("Лактация", "≤", "5"),
  ]);
  assert.ok(compileListRule(record, binding).patch);
  assert.equal(
    compileListRule(record, { ...binding, rootPolicy: "explicit_only" }).patch,
    undefined
  );
  record.selection.roots = record.selection.roots.map((n, i) => ({
    children: [n],
    kind: "group",
    name: `segment${i}`,
    operator: "AND",
    span,
  }));
  assert.equal(compileListRule(record, binding).patch, undefined);
});
test("unknown column blocks entire rule", () => {
  const record = source([predicate("Лактация")]);
  record.columns.push({ label: "unknown", span });
  const result = compileListRule(record, binding);
  assert.equal(result.patch, undefined);
  assert.ok(result.diagnostics.some((d) => d.code === "COLUMN_UNMAPPED"));
});
test("only explicit parameter binding can resolve bare operand", () => {
  const record = source([predicate("Лактация", "≥", "от")]);
  assert.equal(compileListRule(record, binding).patch, undefined);
  const parameterBinding: RuleBinding = {
    ...binding,
    operandBindings: { от: { id: "min", kind: "parameter", type: "decimal" } },
  };
  const missing = compileListRule(record, parameterBinding);
  assert.equal(missing.patch, undefined);
  assert.equal(missing.parameters[0].id, "min");
  assert.ok(missing.diagnostics.some((d) => d.code === "PARAMETER_REQUIRED"));
  assert.ok(
    compileListRule(record, {
      ...parameterBinding,
      parameters: { min: { type: "decimal", value: "2" } },
    }).patch
  );
  assert.equal(
    compileListRule(record, {
      ...parameterBinding,
      parameters: { min: { type: "string", value: "2; DROP TABLE animal" } },
    }).patch,
    undefined
  );
});
test("relative dates keep comparison direction; field references check types", () => {
  const node = predicate("Дата рождения", "≥", "Сегодня - 7 дней");
  if (node.kind === "predicate") {
    node.operand = {
      kind: "relativeDate",
      offsetDays: -7,
      raw: "Сегодня - 7 дней",
    };
  }
  const result = compileListRule(source([node]), binding);
  assert.ok(result.patch);
  assert.ok(result.patch.filters);
  const [, leaf] = result.patch.filters.children;
  assert.equal(leaf.kind === "condition" && leaf.operator, "gte");
  assert.deepEqual(leaf.kind === "condition" && leaf.value, {
    offset: -7,
    type: "relative_day",
  });
  const other = source([predicate("Дата рождения", "<", "calving")]);
  assert.ok(
    compileListRule(other, {
      ...binding,
      operandBindings: { calving: { field: "lastCalvingAt", kind: "field" } },
    }).patch
  );
  assert.equal(
    compileListRule(other, {
      ...binding,
      operandBindings: { calving: { field: "lactationNumber", kind: "field" } },
    }).patch,
    undefined
  );
});
test("null and company policies enforced", () => {
  const node = predicate("Дата рождения", "NOT_NULL", "");
  if (node.kind === "predicate") {
    node.operand = { kind: "none", raw: "" };
  }
  const record = source([node]);
  assert.ok(compileListRule(record, binding).patch);
  assert.equal(
    compileListRule(record, { ...binding, nullPolicy: "unresolved" }).patch,
    undefined
  );
  assert.equal(
    compileListRule(record, { ...binding, sourceCompanyId: "20" }).patch,
    undefined
  );
});
test("all corpus parser blockers remain blocked", () => {
  const records = readFileSync(
    resolve(process.cwd(), "../rules/normalized.jsonl"),
    "utf8"
  )
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as NormalizedRule);
  assert.equal(records.length, 6735);
  let syntaxBlocked = 0;
  for (const record of records) {
    const result = compileListRule(record, {
      ...binding,
      sourceCompanyId: record.source.companyId,
    });
    if (!record.status.parsed) {
      syntaxBlocked += 1;
      assert.equal(result.patch, undefined, record.source.definitionId);
    }
    if (result.patch) {
      assert.equal(result.diagnostics.length, 0);
    }
  }
  assert.equal(syntaxBlocked, 33);
});

test("exact seeded status and explicit last weight aliases compile", () => {
  const record = source([predicate("Статус животного", "=", "Не осеменять")]);
  record.columns.push({ label: "Посл. вес", span });
  const result = compileListRule(record, binding);
  assert.ok(result.patch?.filters);
  assert.deepEqual(result.patch.columns, ["primaryIdentifier", "lastWeightKg"]);
  const [, condition] = result.patch.filters.children;
  assert.deepEqual(condition.kind === "condition" && condition.value, {
    type: "string",
    value: "DO_NOT_INSEMINATE",
  });
});

test("milk control, history and lactation groups never alias to nearby facts", () => {
  for (const label of [
    "Надой посл. КД",
    "Надой сегодня",
    "Посл. вес 0 лактации",
    "Лакт. группа",
    "Вес при рождении",
  ]) {
    const record = source([predicate("Лактация")]);
    record.columns.push({ label, span });
    assert.equal(compileListRule(record, binding).patch, undefined, label);
  }
});

test("shared semantic validator enforces depth and disallows farm field comparison", () => {
  let node = predicate("Лактация");
  for (let i = 0; i < 10; i += 1) {
    node = {
      children: [node],
      kind: "group",
      name: null,
      operator: "AND",
      span,
    };
  }
  const deep = compileListRule(source([node]), binding);
  assert.equal(deep.patch, undefined);
  assert.ok(deep.diagnostics.some((d) => d.code === "FILTER_DEPTH_EXCEEDED"));
  const farmRef = compileListRule(
    source([predicate("Номер животного", "=", "farm")]),
    {
      ...binding,
      operandBindings: { farm: { field: "farmId", kind: "field" } },
    }
  );
  assert.equal(farmRef.patch, undefined);
  assert.ok(
    farmRef.diagnostics.some((d) => d.code === "FILTER_FIELD_TYPE_MISMATCH")
  );
});

test("synthetic vitality policy uses ACTIVE/DEAD and never exited or archived", () => {
  for (const [sourceValue, expected] of [
    ["alive", "ACTIVE"],
    ["dead", "DEAD"],
    ["all", null],
  ] as const) {
    const record = source([predicate("Лактация")]);
    record.vitality.value = sourceValue;
    const result = compileListRule(record, binding);
    assert.ok(result.patch?.filters);
    const nodes = result.patch.filters.children.filter(
      (n) => n.kind === "condition"
    );
    const life = nodes.find((n) => n.field === "lifeState");
    assert.deepEqual(
      life?.value,
      expected ? { type: "string", value: expected } : undefined
    );
    assert.equal(
      nodes.some((n) => ["isExited", "isArchived"].includes(n.field)),
      false
    );
  }
});

test("empty-source display policy preserves raw and never hides unmapped columns", () => {
  const record = source([]);
  record.columns = [];
  record.raw.column_names = "";
  record.raw.columns_count = "0";
  const before = JSON.stringify(record);
  assert.equal(compileListRule(record, binding).patch, undefined);
  const explicit: RuleBinding = {
    ...binding,
    emptyColumnsPolicy: "mandatory_identity_if_source_empty",
    version: "simulation/v2",
  };
  assert.deepEqual(compileListRule(record, explicit).patch?.columns, [
    "primaryIdentifier",
  ]);
  assert.equal(JSON.stringify(record), before);
  for (const changed of [
    { ...record, raw: { ...record.raw, columns_count: "1" } },
    { ...record, raw: { ...record.raw, column_names: "Unknown" } },
    { ...record, columns: [{ label: "Unknown", span }] },
  ]) {
    assert.equal(compileListRule(changed, explicit).patch, undefined);
  }
});

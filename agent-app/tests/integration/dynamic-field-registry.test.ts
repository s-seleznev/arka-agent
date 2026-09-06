import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { config } from "dotenv";
import { queryAnimals } from "../../lib/farm/queries";
import { getAuthorizedFieldRegistry } from "../../lib/farm/registry";
import type { FilterGroup } from "../../lib/farm/types";
import { validateFilterGroup } from "../../lib/farm/view-model";

config({ path: ".env.local", quiet: true });

test("registered custom fields use authorized registry, typed validation and scoped SQL", {
  skip: !process.env.QA_USER_ID,
}, async () => {
  const userId = process.env.QA_USER_ID;
  assert.ok(userId, "QA_USER_ID must identify the explicit QA account");
  const registry = await getAuthorizedFieldRegistry(userId);
  const custom = Object.values(registry).filter(
    (f) => f.sourceCode === "TEMPERAMENT_SCORE"
  );
  assert.equal(custom.length, 6);
  const birth = Object.values(registry).find(
    (field) => field.sourceCode === "BIRTH_WEIGHT_KG"
  );
  assert.ok(birth, "additional typed birth fact is registered");
  assert.equal(
    birth.unit,
    registry.lastWeightKg.unit,
    "KG and kg represent the same known unit"
  );
  validateFilterGroup(
    {
      children: [
        {
          field: birth.id,
          id: randomUUID(),
          kind: "condition",
          negated: false,
          operator: "lte",
          value: { field: "lastWeightKg", type: "field" },
        },
      ],
      combinator: "and",
      id: randomUUID(),
      kind: "group",
      negated: false,
    },
    registry
  );
  const [selected] = custom;
  assert.equal(selected.type, "number");
  const filters: FilterGroup = {
    children: [
      {
        field: selected.id,
        id: randomUUID(),
        kind: "condition",
        negated: false,
        operator: "eq",
        value: { type: "number", value: 4 },
      },
    ],
    combinator: "and",
    id: randomUUID(),
    kind: "group",
    negated: false,
  };
  assert.throws(() => validateFilterGroup(filters));
  assert.deepEqual(validateFilterGroup(filters, registry), filters);
  const page = await queryAnimals({
    columns: ["primaryIdentifier", selected.id],
    fieldRegistry: registry,
    filters,
    userId,
  });
  assert.equal(page.totalRows, 1);
  assert.equal(page.kind, "rows");
  if (page.kind === "rows") {
    assert.equal(String(page.rows[0][selected.id]), "4");
  }
  const mismatched = {
    ...registry,
    [selected.id]: { ...selected, label: "different metadata revision" },
  };
  await assert.rejects(
    queryAnimals({
      columns: ["primaryIdentifier", selected.id],
      fieldRegistry: mismatched,
      filters,
      userId,
    }),
    /FIELD_REGISTRY_STALE/
  );
  console.log(
    JSON.stringify({
      dynamicFields: custom.length,
      selectedField: selected.id,
      totalRows: page.totalRows,
    })
  );
});

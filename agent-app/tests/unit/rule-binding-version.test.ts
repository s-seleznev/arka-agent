import assert from "node:assert/strict";
import test from "node:test";
import { currentBindings } from "../../lib/rules/binding-version";

test("latest synthetic binding is selected independently per farm; unknown families remain ambiguous", () => {
  const rows = [
    { farmId: "a", version: "synthetic-policy/v1" },
    { farmId: "a", version: "synthetic-policy/v2" },
    { farmId: "a", version: "synthetic-policy/v10" },
    { farmId: "b", version: "synthetic-policy/v1" },
  ];
  assert.deepEqual(currentBindings(rows), [rows[2], rows[3]]);
  const unknown = [...rows, { farmId: "a", version: "custom/v3" }];
  assert.equal(currentBindings(unknown).length, 5);
  assert.equal(rows.length, 4);
});

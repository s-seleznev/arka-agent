import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { config } from "dotenv";
import postgres from "postgres";
import { compileFilter, type SqlParameters } from "../../lib/farm/sql";
import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
} from "../../lib/farm/types";

config({ path: ".env.local", quiet: true });
const url = process.env.FARM_DATABASE_URL;
const db = url ? postgres(url, { max: 1, connect_timeout: 5 }) : null;
after(async () => {
  await db?.end();
});
const options = { skip: !db, timeout: 10_000 };

function condition(overrides: Partial<FilterCondition> = {}): FilterCondition {
  return {
    id: randomUUID(),
    kind: "condition",
    field: "lastWeightKg",
    operator: "eq",
    negated: false,
    value: { type: "number", value: 10 },
    ...overrides,
  };
}
function group(
  children: FilterNode[],
  combinator: "and" | "or" = "and",
  negated = false
): FilterGroup {
  return { id: randomUUID(), kind: "group", children, combinator, negated };
}

// Only synthetic SQL VALUES are read. No farm tables, temp tables or writes.
const rows = `WITH s(id,last_weight_kg,last_milk_kg,name,birth_date) AS (VALUES
  (1,NULL::numeric,NULL::numeric,NULL::text,NULL::date),
  (2,10::numeric,10::numeric,'alpha'::text,'2025-09-04'::date),
  (3,20::numeric,15::numeric,'beta'::text,'2025-09-03'::date),
  (4,9007199254740993.0000000000000001::numeric,0::numeric,'gamma'::text,'2026-09-05'::date),
  (5,9007199254740993.0000000000000002::numeric,0::numeric,'delta'::text,'2026-09-04'::date)
)`;

async function evaluate(root: FilterGroup) {
  assert.ok(db);
  const parameters: SqlParameters = [];
  const predicate = compileFilter(root, parameters, {
    asOf: "2026-09-04T12:00:00Z",
    timezoneSql: "'UTC'",
  });
  const truth = await db.unsafe(
    `${rows} SELECT id, (${predicate}) AS result FROM s ORDER BY id`,
    parameters
  );
  const members = await db.unsafe(
    `${rows} SELECT id FROM s WHERE ${predicate} ORDER BY id`,
    parameters
  );
  return { truth: truth.map((r) => r.result), ids: members.map((r) => r.id) };
}

test(
  "NULL stays UNKNOWN under negated scalar, range, list and text predicates",
  options,
  async () => {
    const variants: FilterCondition[] = [
      condition({ negated: true }),
      condition({ operator: "neq" }),
      condition({
        operator: "between",
        negated: true,
        value: {
          type: "range",
          lower: { type: "number", value: 5 },
          upper: { type: "number", value: 15 },
        },
      }),
      condition({
        operator: "in",
        negated: true,
        value: { type: "list", values: [{ type: "number", value: 10 }] },
      }),
      condition({
        operator: "not_in",
        value: { type: "list", values: [{ type: "number", value: 10 }] },
      }),
      condition({
        field: "name",
        operator: "contains",
        negated: true,
        value: { type: "string", value: "alpha" },
      }),
      condition({
        field: "name",
        operator: "not_contains",
        value: { type: "string", value: "alpha" },
      }),
    ];
    for (const variant of variants) {
      const actual = await evaluate(group([variant]));
      assert.deepEqual(
        actual,
        { truth: [null, false, true, true, true], ids: [3, 4, 5] },
        variant.operator
      );
    }
  }
);

test(
  "nested NOT preserves UNKNOWN while UNKNOWN OR TRUE is TRUE",
  options,
  async () => {
    const unknown = () => condition();
    const empty = () => condition({ operator: "is_empty", value: undefined });
    const present = () =>
      condition({ operator: "is_not_empty", value: undefined });
    const cases: Array<[FilterGroup, boolean | null]> = [
      [group([unknown(), empty()], "or"), true],
      [group([unknown(), present()], "or"), null],
      [group([unknown(), empty()], "and"), null],
      [group([unknown(), present()], "and"), false],
      [group([group([unknown(), empty()], "and")], "and", true), null],
      [group([group([unknown(), empty()], "or")], "and", true), false],
      [group([group([unknown()], "and", true)], "and", true), null],
    ];
    for (const [root, expected] of cases) {
      const actual = await evaluate(root);
      assert.equal(actual.truth[0], expected);
      assert.equal(actual.ids.includes(1), expected === true);
    }
  }
);

test(
  "empty predicates intentionally remain two-valued under NOT",
  options,
  async () => {
    const empty = await evaluate(
      group([condition({ operator: "is_empty", value: undefined })])
    );
    assert.deepEqual(empty, {
      truth: [true, false, false, false, false],
      ids: [1],
    });
    const notEmpty = await evaluate(
      group([
        condition({ operator: "is_empty", value: undefined, negated: true }),
      ])
    );
    assert.deepEqual(notEmpty, {
      truth: [false, true, true, true, true],
      ids: [2, 3, 4, 5],
    });
  }
);

test(
  "relative lower date bound includes its boundary and future dates",
  options,
  async () => {
    const actual = await evaluate(
      group([
        condition({
          field: "birthDate",
          operator: "gte",
          value: { type: "relative_day", offset: -365 },
        }),
      ])
    );
    assert.deepEqual(actual, {
      truth: [null, true, false, true, true],
      ids: [2, 4, 5],
    });
  }
);

test(
  "decimal operands preserve precision beyond IEEE-754",
  options,
  async () => {
    const actual = await evaluate(
      group([
        condition({
          value: {
            type: "decimal",
            value: "9007199254740993.0000000000000001",
          },
        }),
      ])
    );
    assert.deepEqual(actual, {
      truth: [null, false, false, true, false],
      ids: [4],
    });
  }
);

test(
  "field operands compare row values and keep NULL unknown",
  options,
  async () => {
    const actual = await evaluate(
      group([condition({ value: { type: "field", field: "lastMilkKg" } })])
    );
    assert.deepEqual(actual, {
      truth: [null, true, false, false, false],
      ids: [2],
    });
  }
);

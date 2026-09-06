import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "dotenv";
import type {
  FilterCondition,
  FilterGroup,
  GroupRule,
  SortRule,
} from "../../lib/farm/types";

config({ path: ".env.local", quiet: true });
process.env.CURSOR_SECRET ??= "local-integration-cursor-secret";

const sort: SortRule[] = [
  {
    direction: "asc",
    field: "primaryIdentifier",
    id: "20000000-0000-4000-8000-000000000002",
  },
];
const viewId = "20000000-0000-4000-8000-000000000003";
const userId = "20000000-0000-4000-8000-000000000004";

function farmFilter(farmId: string): FilterCondition {
  return {
    field: "farmId",
    id: "20000000-0000-4000-8000-000000000001",
    kind: "condition",
    negated: false,
    operator: "eq",
    value: { type: "string", value: farmId },
  };
}

function filterGroup(children: FilterCondition[] = []): FilterGroup {
  return {
    children,
    combinator: "and",
    id: "20000000-0000-4000-8000-000000000010",
    kind: "group",
    negated: false,
  };
}

test("absence of a farm filter queries every farm_access farm", {
  timeout: 30_000,
}, async (context) => {
  if (!process.env.FARM_DATABASE_URL) {
    context.skip("FARM_DATABASE_URL is not configured");
    return;
  }
  const { getAccessibleFarms, getFarmFieldValues, queryAnimals } = await import(
    "../../lib/farm/queries"
  );
  const farms = await getAccessibleFarms(userId);
  assert.ok(farms.length > 1);
  const allowedIds = new Set(farms.map((farm) => farm.id));

  const all = await queryAnimals({
    columns: ["primaryIdentifier", "statusCode"],
    filters: filterGroup(),
    limit: 200,
    revision: 8,
    sort,
    userId,
    viewId,
  });
  assert.equal(all.kind, "rows");
  assert.ok(all.totalRows > 0);
  assert.ok(all.rows.every((row) => allowedIds.has(row.farmId)));

  let farmTotal = 0;
  let largestFarm = 0;
  for (const farm of farms) {
    // biome-ignore lint/performance/noAwaitInLoops: totals intentionally verify every authorized scope.
    const page = await queryAnimals({
      columns: ["primaryIdentifier"],
      filters: filterGroup([farmFilter(farm.id)]),
      limit: 1,
      revision: 8,
      sort,
      userId,
      viewId,
    });
    assert.ok(page.totalRows > 0, `${farm.name} must contain test animals`);
    farmTotal += page.totalRows;
    largestFarm = Math.max(largestFarm, page.totalRows);
    assert.ok(page.rows.every((row) => row.farmId === farm.id));
  }
  assert.equal(all.totalRows, farmTotal);
  assert.ok(all.totalRows > largestFarm);

  const farmValues = await getFarmFieldValues({
    fieldId: "farmId",
    limit: 200,
    userId,
  });
  assert.deepEqual(
    new Set(farmValues.map((value) => String(value.value))),
    allowedIds
  );
});

test("a foreign farm condition is rejected before query execution", async (context) => {
  if (!process.env.FARM_DATABASE_URL) {
    context.skip("FARM_DATABASE_URL is not configured");
    return;
  }
  const { getAccessibleFarms, queryAnimals } = await import(
    "../../lib/farm/queries"
  );
  const farms = await getAccessibleFarms(userId);
  assert.ok(farms.length > 0);
  const inaccessibleFarmId = "20000000-0000-4000-8000-000000000099";
  assert.equal(
    farms.some((farm) => farm.id === inaccessibleFarmId),
    false
  );

  await assert.rejects(
    queryAnimals({
      columns: ["primaryIdentifier"],
      filters: filterGroup([farmFilter(inaccessibleFarmId)]),
      limit: 1,
      revision: 8,
      sort,
      userId,
      viewId,
    }),
    { message: "FARM_ACCESS_DENIED" }
  );
});

test("row farmId scopes the animal card query", async (context) => {
  if (!process.env.FARM_DATABASE_URL) {
    context.skip("FARM_DATABASE_URL is not configured");
    return;
  }
  const { getAnimalById, queryAnimals } = await import(
    "../../lib/farm/queries"
  );
  const page = await queryAnimals({
    columns: ["primaryIdentifier"],
    filters: filterGroup(),
    limit: 1,
    revision: 8,
    sort,
    userId,
    viewId,
  });
  assert.equal(page.kind, "rows");
  const [row] = page.rows;
  assert.ok(row);

  const animal = await getAnimalById({
    animalId: row.animalId,
    farmId: row.farmId,
    userId,
  });
  assert.ok(animal);
  assert.equal(String(animal.farm_id), row.farmId);
  await assert.rejects(
    getAnimalById({
      animalId: row.animalId,
      farmId: "20000000-0000-4000-8000-000000000099",
      userId,
    }),
    { message: "FARM_ACCESS_DENIED" }
  );
});

test("row projection includes the identifier and grouping field without changing view columns", async (context) => {
  if (!process.env.FARM_DATABASE_URL) {
    context.skip("FARM_DATABASE_URL is not configured");
    return;
  }
  const { queryAnimals } = await import("../../lib/farm/queries");
  const columns = ["name"];
  const groupBy: GroupRule[] = [
    {
      direction: "asc",
      field: "sex",
      hideEmpty: true,
      id: "20000000-0000-4000-8000-000000000005",
    },
  ];
  const groupsPage = await queryAnimals({
    columns,
    filters: filterGroup(),
    groupBy,
    limit: 10,
    revision: 8,
    sort,
    userId,
    viewId,
  });
  assert.equal(groupsPage.kind, "groups");
  const [group] = groupsPage.groups;
  assert.ok(group);

  const rowsPage = await queryAnimals({
    columns,
    filters: filterGroup(),
    groupBy,
    groupPath: group.path,
    limit: 10,
    revision: 8,
    sort,
    userId,
    viewId,
  });
  assert.equal(rowsPage.kind, "rows");
  assert.ok(rowsPage.rows.length > 0);
  for (const row of rowsPage.rows) {
    assert.ok(
      typeof row.primaryIdentifier === "string" &&
        row.primaryIdentifier.length > 0
    );
    assert.equal(row.sex, group.value);
  }
  assert.deepEqual(columns, ["name"]);
});

test("cursor is bound to the effective farm scope", async (context) => {
  if (!process.env.FARM_DATABASE_URL) {
    context.skip("FARM_DATABASE_URL is not configured");
    return;
  }
  const { getAccessibleFarms, queryAnimals } = await import(
    "../../lib/farm/queries"
  );
  const [farm] = await getAccessibleFarms(userId);
  assert.ok(farm);
  const all = await queryAnimals({
    columns: ["primaryIdentifier"],
    filters: filterGroup(),
    limit: 5,
    revision: 8,
    sort,
    userId,
    viewId,
  });
  assert.ok(all.nextCursor);

  await assert.rejects(
    queryAnimals({
      columns: ["primaryIdentifier"],
      cursor: all.nextCursor,
      filters: filterGroup([farmFilter(farm.id)]),
      limit: 5,
      revision: 8,
      sort,
      userId,
      viewId,
    }),
    { message: "CURSOR_STALE" }
  );
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const { productClient } = await import("../lib/db/client");
  const { createDefaultView, getSavedView, applySavedViewOperations } =
    await import("../lib/farm/views");
  const { searchListRules, getListRule } = await import("../lib/rules/store");
  const { applyListRule } = await import("../lib/rules/apply");
  const { queryAnimals } = await import("../lib/farm/queries");
  const [user] = await productClient<
    { id: string }[]
  >`SELECT id FROM "User" ORDER BY "createdAt" DESC LIMIT 1`;
  assert(user, "Local stand user required");
  const chatId = randomUUID();
  try {
    const [candidate] = await searchListRules({
      query: "541",
      userId: user.id,
    });
    assert(candidate);
    const details = await getListRule({
      ruleId: candidate.ruleId,
      userId: user.id,
    });
    assert(details);
    const [binding] = details.bindings;
    const initial = await createDefaultView({
      chatId,
      farmId: binding.farmId,
      userId: user.id,
    });
    const input = {
      bindingId: binding.id,
      bindingVersion: binding.version,
      expectedRevision: initial.revision,
      parameters: {},
      ruleId: candidate.ruleId,
      ruleVersion: candidate.version,
      userId: user.id,
      viewId: initial.id,
    };
    const invalidParameters = await applyListRule({
      ...input,
      parameters: { invented: { type: "number", value: 42 } },
    });
    assert.equal(
      "error" in invalidParameters && invalidParameters.error,
      "RULE_PARAMETER_UNKNOWN"
    );
    assert.equal(
      (await getSavedView({ id: initial.id, userId: user.id }))?.revision,
      initial.revision
    );
    const result = await applyListRule(input);
    assert("view" in result && result.view, JSON.stringify(result));
    const saved = await getSavedView({ id: initial.id, userId: user.id });
    assert(saved?.ruleContext);
    const savedContext = saved.ruleContext;
    assert.equal(saved.ruleContext.ruleId, candidate.ruleId);
    assert.equal(saved.ruleContext.modified, false);
    const page = await queryAnimals({
      columns: saved.columns,
      filters: saved.filters,
      groupBy: saved.groupBy,
      limit: 20,
      revision: saved.revision,
      ruleContext: saved.ruleContext,
      sort: saved.sort,
      userId: user.id,
      viewId: saved.id,
    });
    assert.equal(page.totalRows, result.totalRows);
    assert.equal(page.snapshot, result.snapshot);
    await assert.rejects(() => applyListRule(input), /VIEW_REVISION_CONFLICT/);
    const [blocked] = await searchListRules({ query: "197", userId: user.id });
    const blockedDetails = await getListRule({
      ruleId: blocked.ruleId,
      userId: user.id,
    });
    assert(blockedDetails);
    // A different farm is rejected rather than silently switching the table.
    const reject = await applyListRule({
      ...input,
      bindingId: blockedDetails.bindings[0].id,
      bindingVersion: blockedDetails.bindings[0].version,
      expectedRevision: saved.revision,
      ruleId: blocked.ruleId,
      ruleVersion: blocked.version,
    });
    assert("error" in reject);
    assert.equal(
      (await getSavedView({ id: saved.id, userId: user.id }))?.revision,
      saved.revision
    );
    const manual = await applySavedViewOperations({
      expectedRevision: saved.revision,
      id: saved.id,
      operations: [
        {
          index: 0,
          rule: {
            direction: "desc",
            field: "primaryIdentifier",
            id: randomUUID(),
          },
          type: "sort.add",
        },
      ],
      userId: user.id,
    });
    assert.equal(manual.ruleContext?.modified, true);
    await assert.rejects(
      () =>
        queryAnimals({
          columns: manual.columns,
          filters: manual.filters,
          ruleContext: { ...savedContext, snapshot: "wrong-snapshot" },
          userId: user.id,
          viewId: manual.id,
        }),
      /RULE_SNAPSHOT_STALE/
    );
    console.log(
      JSON.stringify({
        checks: 11,
        groupCount: page.totalGroups,
        passed: true,
        ruleId: candidate.ruleId,
        totalRows: page.totalRows,
      })
    );
  } finally {
    await productClient`DELETE FROM "ReportView" WHERE "chatId"=${chatId}`;
    await productClient`DELETE FROM "Chat" WHERE id=${chatId}`;
    await productClient.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
const targetChat = process.env.QA_RECOVERY_CHAT_ID;
const sourceChat = process.env.QA_SOURCE_CHAT_ID;

// Opt-in only: this test changes exclusively the explicitly designated QA chat.
test("refresh and manual edits recover stale source views without losing provenance", {
  skip: !targetChat || !sourceChat,
  timeout: 60_000,
}, async () => {
  assert.ok(targetChat && sourceChat);
  assert.notEqual(targetChat, sourceChat);
  const db = postgres(process.env.POSTGRES_URL ?? "", { max: 1 });
  try {
    const {
      applyRuleView,
      applySavedViewOperations,
      getSavedView,
      refreshSavedViewSnapshot,
      ViewRevisionConflictError,
    } = await import("../../lib/farm/views");
    const { queryAnimals } = await import("../../lib/farm/queries");
    const rows = await db<{ id: string; userId: string; chatId: string }[]>`
      SELECT id,"userId","chatId" FROM "ReportView" WHERE "chatId"=ANY(${[targetChat, sourceChat]}::uuid[])`;
    const target = rows.find((row) => row.chatId === targetChat);
    const source = rows.find((row) => row.chatId === sourceChat);
    assert.ok(target && source);
    const original = await getSavedView({
      id: source.id,
      userId: source.userId,
    });
    const current = await getSavedView({
      id: target.id,
      userId: target.userId,
    });
    assert.ok(original?.ruleContext && current);
    const sourceIdentity = ({
      asOf: _asOf,
      snapshot: _snapshot,
      modified: _modified,
      ...identity
    }: NonNullable<typeof original.ruleContext>) => identity;
    const stale = await applyRuleView({
      context: { ...original.ruleContext, snapshot: "0".repeat(64) },
      expectedRevision: current.revision,
      id: target.id,
      patch: {
        columns: original.columns,
        filters: original.filters,
        groupBy: original.groupBy,
        sort: original.sort,
      },
      userId: target.userId,
    });
    await assert.rejects(
      queryAnimals({
        columns: stale.columns,
        filters: stale.filters,
        groupBy: stale.groupBy,
        limit: 1,
        ruleContext: stale.ruleContext,
        sort: stale.sort,
        userId: target.userId,
        viewId: target.id,
      }),
      /RULE_SNAPSHOT_STALE/
    );
    const fresh = await refreshSavedViewSnapshot({
      expectedRevision: stale.revision,
      id: target.id,
      userId: target.userId,
    });
    assert.deepEqual(fresh.filters, stale.filters);
    assert.deepEqual(fresh.columns, stale.columns);
    assert.deepEqual(fresh.sort, stale.sort);
    assert.deepEqual(fresh.groupBy, stale.groupBy);
    assert.ok(fresh.ruleContext);
    assert.deepEqual(
      sourceIdentity(fresh.ruleContext),
      sourceIdentity(original.ruleContext)
    );
    assert.equal(fresh.ruleContext.modified, false);
    assert.notEqual(fresh.ruleContext.snapshot, stale.ruleContext?.snapshot);
    await assert.rejects(
      refreshSavedViewSnapshot({
        expectedRevision: stale.revision,
        id: target.id,
        userId: target.userId,
      }),
      ViewRevisionConflictError
    );

    const staleAgain = await applyRuleView({
      context: { ...fresh.ruleContext, snapshot: "0".repeat(64) },
      expectedRevision: fresh.revision,
      id: target.id,
      patch: {},
      userId: target.userId,
    });
    const changedColumns = [...staleAgain.columns].reverse();
    const edited = await applySavedViewOperations({
      expectedRevision: staleAgain.revision,
      id: target.id,
      operations: [{ patch: { columns: changedColumns }, type: "view.update" }],
      userId: target.userId,
    });
    assert.deepEqual(edited.columns, changedColumns);
    assert.deepEqual(edited.filters, original.filters);
    assert.ok(edited.ruleContext?.modified);
    assert.deepEqual(
      sourceIdentity(edited.ruleContext),
      sourceIdentity(original.ruleContext)
    );
    assert.notEqual(edited.ruleContext.snapshot, "0".repeat(64));
    const stored = await getSavedView({ id: target.id, userId: target.userId });
    assert.deepEqual(stored, edited);
  } finally {
    await db.end();
    await (await import("../../lib/db/client")).productClient.end();
  }
});

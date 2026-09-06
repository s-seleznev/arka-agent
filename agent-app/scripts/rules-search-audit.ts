import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
// Exercise actual grants rather than the development demo-subject substitution.
Object.assign(process.env, { NODE_ENV: "production" });
async function main() {
  const { searchListRules, getListRule, getRuleBinding, prepareRuleSearch } =
    await import("../lib/rules/store");
  const { productClient } = await import("../lib/db/client");
  const userId = process.env.FARM_DEMO_SUBJECT_ID;
  assert.ok(userId, "FARM_DEMO_SUBJECT_ID_REQUIRED_FOR_AUDIT");
  const cases = [
    {
      expectedFirst: "225",
      query: "123123",
      source: "exact numeric title regression",
    },
    {
      expectedFirst: "71",
      query: "71",
      source: "numeric ID and title ambiguity regression",
    },
    {
      expectedFirst: "4929",
      query: "Количество мастита ",
      source: "trailing source title whitespace regression",
    },
    {
      expectedFirst: null,
      query: "cows for insemination",
      source: "English LLM retrieval regression",
    },
    {
      expectedFirst: null,
      query: "insemination",
      source: "English LLM retrieval regression",
    },
    {
      expectedFirst: null,
      query: "genomic evaluation",
      source: "English LLM retrieval regression",
    },

    { expectedFirst: "541", query: "541", source: "source list ID" },
    { expectedFirst: "541", query: "20:541", source: "source compound key" },
    {
      expectedFirst: "541",
      query: "Список на осеменение по синхронизации",
      source: "exact source list name",
    },
    {
      expectedFirst: null,
      query: "осеменение",
      source: "requested search test",
    },
    {
      expectedFirst: null,
      query: "какие коровы у меня на осеменение",
      source: "requested conversational test",
    },
    {
      expectedFirst: null,
      query: "на семя",
      source:
        "requested ambiguous colloquial test; no historical source phrase found",
    },
    {
      expectedFirst: null,
      query: "геномная оценка",
      source: "requested search test",
    },
    {
      expectedFirst: null,
      query: "сделай мне список не осемененных коров",
      source: "chat_messages.csv message 3382; no historical list relationship",
    },
    {
      expectedFirst: null,
      query: "Сделай список коров с пропущеным осеменением за прошлую неделю",
      source: "chat_messages.csv message 199; no historical list relationship",
    },
  ];
  try {
    const results = await Promise.all(
      cases.map(async (example) => {
        const start = performance.now();
        const candidates = await searchListRules({
          limit: 20,
          query: example.query,
          userId,
        });
        assert.ok(candidates.length > 0, example.query);
        if (example.expectedFirst) {
          assert.equal(candidates[0].sourceListId, example.expectedFirst);
        } else {
          assert.ok(
            candidates.length > 1,
            `Ambiguous retrieval must retain alternatives: ${example.query}`
          );
        }
        if (
          [
            "какие коровы у меня на осеменение",
            "на семя",
            "cows for insemination",
          ].includes(example.query)
        ) {
          assert.ok(
            candidates.some((candidate) => candidate.sourceListId === "541"),
            "Action phrase should retrieve the source 541 candidate, not select it automatically"
          );
        }
        if (["геномная оценка", "genomic evaluation"].includes(example.query)) {
          assert.ok(
            candidates.some((candidate) => candidate.sourceListId === "4153")
          );
        }
        if (example.query === "71") {
          assert.ok(
            candidates.some(
              (candidate) =>
                candidate.sourceCompanyId === "2" &&
                candidate.sourceListId === "2692"
            )
          );
          assert.ok(
            candidates.some((candidate) => candidate.sourceListId === "71")
          );
          assert.ok(
            candidates.length > 1,
            "Numeric ID/title collision must stay ambiguous"
          );
        }
        return {
          ...example,
          autoSelected: false,
          candidates: candidates.map((candidate) => ({
            companyId: candidate.sourceCompanyId,
            compileReady: candidate.compileReady,
            listId: candidate.sourceListId,
            name: candidate.name,
          })),
          elapsedMs: Math.round(performance.now() - start),
          returned: candidates.length,
          terms: prepareRuleSearch(example.query),
        };
      })
    );
    const current = await searchListRules({ query: "541", userId });
    assert.equal(
      current.length,
      1,
      "Default search must hide superseded parser snapshots"
    );
    assert.ok(current[0].version.endsWith(":csv-rules-text/v2"));
    const previous = await getListRule({
      ruleId: "feaa24d3-eb40-56f2-a5b3-a16f9716e24e",
      userId,
    });
    assert.ok(
      previous?.rule.version.endsWith(":csv-rules-text/v1"),
      "Pinned prior snapshot remains accessible"
    );
    const stranger = "00000000-0000-4000-8000-000000000099";
    assert.deepEqual(
      await searchListRules({ query: "осеменение", userId: stranger }),
      []
    );
    const exact = await searchListRules({ query: "541", userId });
    const currentBinding = await getRuleBinding({
      ruleId: exact[0].ruleId,
      userId,
    });
    const historical = await getRuleBinding({
      ruleId: exact[0].ruleId,
      userId,
      version: "synthetic-policy/v1",
    });
    assert.equal(currentBinding?.binding.version, "synthetic-policy/v2");
    assert.equal(historical?.binding.version, "synthetic-policy/v1");
    assert.notEqual(currentBinding?.binding.id, historical?.binding.id);
    assert.equal(
      (
        await getRuleBinding({
          bindingId: historical?.binding.id,
          ruleId: exact[0].ruleId,
          userId,
        })
      )?.binding.version,
      "synthetic-policy/v1"
    );
    assert.equal(
      await getListRule({ ruleId: exact[0].ruleId, userId: stranger }),
      null
    );
    assert.deepEqual(
      await searchListRules({ query: "' OR true --", userId }),
      []
    );
    const report = {
      accessChecks: "passed",
      bindingVersionChecks: "default v2, explicit v1 and pinned v1 ID passed",
      cases: results,
      implementationSha256: createHash("sha256")
        .update(readFileSync(resolve(process.cwd(), "lib/rules/store.ts")))
        .digest("hex"),
      injectionLikeText: "treated as search terms; no SQL execution",
      scope:
        "retrieval checks only; no historical chat-to-list linkage, no rule execution and no automatic choice",
      searchHelperSha256: createHash("sha256")
        .update(readFileSync(resolve(process.cwd(), "lib/rules/search.ts")))
        .digest("hex"),
    };
    writeFileSync(
      resolve(process.cwd(), "../rules/search-audit.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    console.log(
      JSON.stringify({
        accessChecks: "passed",
        autoSelected: false,
        cases: results.map((result) => ({
          elapsedMs: result.elapsedMs,
          first: result.candidates[0].listId,
          query: result.query,
          returned: result.returned,
        })),
      })
    );
  } finally {
    await productClient.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "RULE_SEARCH_AUDIT_FAILED"
    );
    process.exit(1);
  });

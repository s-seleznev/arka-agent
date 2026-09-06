import assert from "node:assert/strict";
import test from "node:test";
import { prepareRuleSearch } from "../../lib/rules/search";

test("conversational noise does not become required matching terms", () => {
  const search = prepareRuleSearch("Какие коровы у меня на осеменение?");
  assert.equal(search.tsquery, "осеменение");
  assert.ok(search.fullTsquery.includes("коровы"));
  assert.equal(search.expansions.length, 0);
});

test("colloquial request broadens retrieval without choosing a rule", () => {
  const search = prepareRuleSearch("на семя");
  assert.equal(search.tsquery, "семя | осеменение");
  assert.equal(search.expansions.length, 1);
  assert.equal(prepareRuleSearch("сексированное семя").expansions.length, 0);
});

test("full phrase and negation retained while query operators are generated", () => {
  const search = prepareRuleSearch("Сделай мне список не осемененных коров");
  assert.ok(search.phrase.includes("не осемененных"));
  assert.ok(search.terms.includes("не"));
  const hostile = prepareRuleSearch("' | !:* -- OR (1=1); SELECT");
  assert.match(hostile.tsquery, /^[\p{L}\p{N} |]+$/u);
  assert.equal(
    prepareRuleSearch("ГЕНОМНАЯ   оценка").phrase,
    "геномная оценка"
  );
  assert.equal(prepareRuleSearch("20:541").phrase, "20:541");
});

test("English retrieval vocabulary maps only search terms", () => {
  const simple = prepareRuleSearch("cows for insemination");
  assert.equal(simple.tsquery, "осеменение");
  assert.ok(simple.phrases.includes("на осеменение"));
  assert.equal(prepareRuleSearch("insemination").tsquery, "осеменение");
  assert.equal(
    prepareRuleSearch("genomic evaluation").tsquery,
    "геномная | оценка"
  );
  assert.equal(prepareRuleSearch("dry off").tsquery, "запуск");
  assert.equal(prepareRuleSearch("milk yield").tsquery, "надой");
  for (const [english, russian] of [
    ["cow", "корова"],
    ["heifer", "телка"],
    ["pregnancy", "стельность"],
    ["calving", "отел"],
    ["milk", "молоко"],
    ["weight", "вес"],
  ]) {
    assert.ok(prepareRuleSearch(english).terms.includes(russian));
  }
  assert.ok(prepareRuleSearch("not inseminated cows").terms.includes("не"));
});

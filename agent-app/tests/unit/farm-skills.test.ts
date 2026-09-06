import assert from "node:assert/strict";
import test from "node:test";
import { canUseLactisProfile, farmSkillIndex, getFarmSkill, farmSkillRoutingPrompt } from "../../lib/ai/farm-skills";

test("unknown skill identifiers cannot resolve arbitrary files or inherited keys", () => {
  for (const id of ["../common", "../../.env.local", "constructor", "toString", "", "HERD"]) {
    assert.equal(getFarmSkill(id), null);
  }
});

test("all advertised skills load with shared scope and no farm identity substitution", () => {
  assert.equal(new Set(farmSkillIndex.map(x => x.id)).size, 8);
  for (const entry of farmSkillIndex) {
    const skill = getFarmSkill(entry.id);
    assert.ok(skill);
    assert.ok(skill.instructions.includes(`name: ${entry.id}`));
    assert.equal(skill.profile.sourceCompanyId, "8");
    assert.ok(!("farmId" in skill.profile));
    assert.match(skill.common, /getFarmContext/);
    assert.match(skill.common, /expectedRevision/);
  }
});

test("process routing does not require catalog selection for ordinary requests", () => {
  assert.match(farmSkillRoutingPrompt, /For explicit saved-list requests only/);
  assert.match(farmSkillRoutingPrompt, /getFarmSkill/);
  assert.doesNotMatch(farmSkillRoutingPrompt, /For a business list request, searchListRules first/);
});

test("simulation decisions remain explicit and do not claim source-company provenance", () => {
  const skill = getFarmSkill("reproduction")!;
  const assumption = skill.profile.decisions.find(x => x.id === "ovsynch-insemination")!;
  assert.match(assumption.origin, /not an exported company8 rule/);
  assert.match(skill.instructions, /activeProtocolCount не заменяет/);
});

test("profile scope fails closed for unconfigured or unrelated farms", () => {
  const config = {id:"lactis-prime-8",farmIds:"farm-a,farm-b"};
  assert.equal(canUseLactisProfile(["farm-a"],config),true);
  assert.equal(canUseLactisProfile(["farm-a","foreign"],config),false);
  assert.equal(canUseLactisProfile(["farm-a"],{}),false);
  assert.equal(canUseLactisProfile([],config),false);
  assert.equal(canUseLactisProfile(["farm-a"],{...config,id:"other"}),false);
});

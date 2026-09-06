import bundle from "./bundle.json";

export const farmSkillIndex = bundle.skills.map(
  ({ id, title, description, version }) => ({ id, title, description, version })
);

/** Static bundle: model input never becomes a filesystem path. */
export function getFarmSkill(skillId: string) {
  const skill = bundle.skills.find(({ id }) => id === skillId);
  if (!skill) return null;
  return {
    ...skill,
    common: bundle.common,
    profile: bundle.profile,
    nextStep: "Use the accompanying context.fields and workspace.revision with configureAnimalTable. Submit semantic conditions without UUIDs. Do not substitute a missing field.",
  };
}

export const farmSkillRoutingPrompt = `
For a work request, load the relevant process instructions with getFarmSkill before composing filters. Available skills:
${farmSkillIndex.map(({ id, description }) => `- ${id}: ${description}`).join("\n")}
Routing: bull calves for sale and heifers aged 12+ months -> youngstock; fresh-cow control and animals in work/active protocols -> health; pregnancy checks and insemination reports -> reproduction; early exits -> culling; dry-off queue -> dry-off-calving. These ordinary report intents have complete defaults in the relevant skill; load it and apply its report instructions, not an improvised status/group search.
These are process instructions, not a requirement to select a saved CSV list. For explicit saved-list requests only, use searchListRules, inspect getListRule, then applyListRule. Never silently repair or approximate a blocked exact source rule. For ordinary requests use the skill and live field catalog to compose a view. Never claim a missing field or unsupported aggregation is available. The Lactis profile is simulation policy for the current authorized view, not a farm UUID or permission to change farm scope.
`;

/** Fail closed: a profile must be explicitly enabled for every accessible farm. */
export function canUseLactisProfile(
  farmIds: string[],
  configuration: { id?: string; farmIds?: string }
) {
  if (configuration.id !== bundle.profile.id || farmIds.length === 0) return false;
  const allowed = new Set((configuration.farmIds ?? "").split(",").map(x => x.trim()).filter(Boolean));
  return allowed.size > 0 && farmIds.every(id => allowed.has(id));
}

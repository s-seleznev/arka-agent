/** Once a report skill is selected, expose its next action rather than unrelated tools. */
export function prepareFarmReportStep({ steps }: {
  steps: { toolResults: { toolName: string; output: unknown }[] }[];
}): { toolChoice?: "none"; activeTools: ("configureAnimalTable" | "getFarmContext" | "getFarmSkill")[] } | undefined {
  const results = steps.flatMap(step => step.toolResults);
  const configured = results.findLast(result => result.toolName === "configureAnimalTable");
  const output = configured?.output as Record<string, unknown> | undefined;
  if (output?.view && output.verification && !output.error) {
    return { toolChoice: "none", activeTools: [] };
  }
  const loaded = results.findLast(result => result.toolName === "getFarmSkill");
  const skill = loaded?.output as Record<string, unknown> | undefined;
  if (skill?.skill && skill.context && !skill.error) {
    return {
      activeTools: ["configureAnimalTable", "getFarmContext", "getFarmSkill"],
    };
  }
}

import type { LanguageModelV4ToolCall } from "@ai-sdk/provider";
import { configureTableSchema } from "@/lib/farm/semantic-view";

/** Some compatible providers double-encode structured tool arguments. */
export async function repairTableToolCall({ toolCall }: { toolCall: LanguageModelV4ToolCall }) {
  if (toolCall.toolName !== "configureAnimalTable" || toolCall.input.length > 100_000) return null;
  try {
    const input = JSON.parse(toolCall.input);
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    let changed = false;
    for (const field of ["filters", "columns", "sort", "groupBy"]) {
      if (typeof input[field] === "string") {
        input[field] = JSON.parse(input[field]);
        changed = true;
      }
    }
    // Decode only: do not infer fields, defaults, IDs or permissions.
    if (!changed || !configureTableSchema.safeParse(input).success) return null;
    console.info("[agent] decoded-tool-arguments", { tool: toolCall.toolName, toolCallId: toolCall.toolCallId });
    return { ...toolCall, input: JSON.stringify(input) };
  } catch {
    return null;
  }
}

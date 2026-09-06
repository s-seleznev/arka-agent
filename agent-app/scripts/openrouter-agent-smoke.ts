import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ToolLoopAgent, isStepCount } from "ai";
import { getLanguageModel } from "../lib/ai/providers";
import { prepareFarmReportStep } from "../lib/ai/farm-report-step";
import { repairTableToolCall } from "../lib/ai/repair-table-tool-call";
import { systemPrompt } from "../lib/ai/prompts";
import { createFarmTools } from "../lib/ai/tools/farm";
import { productClient } from "../lib/db/client";
import { saveChat, deleteChatById } from "../lib/db/queries";
import { getFarmClient, getAccessibleFarms } from "../lib/farm/scope";
import { queryAnimals } from "../lib/farm/queries";
import type { ReportViewState } from "../lib/farm/types";

async function main() {
  const userId = process.env.SMOKE_USER_ID;
  assert(userId, "Supply a dedicated smoke-test guest ID");
  assert.equal(process.env.AI_RUNTIME, "openrouter");
  const chatId = randomUUID();
  let view: ReportViewState | undefined;
  const startedAt = Date.now();
  const tools = createFarmTools({
    userId, chatId,
    dataStream: { write(event: any) { if (event.type === "data-view-state") view = event.data; } } as any,
  });
  try {
    assert((await getAccessibleFarms(userId)).length === 1, "Initialize this guest through /api/demo-workspace first");
    await saveChat({ id: chatId, userId, title: "Проверка агента", visibility: "private" });
    const agent = new ToolLoopAgent({
      model: getLanguageModel("arkasha"), tools, maxRetries: 0, maxOutputTokens: 4096,
      prepareStep: prepareFarmReportStep,
      experimental_repairToolCall: repairTableToolCall,
      instructions: systemPrompt({ supportsTools: true, requestHints: { city: undefined, country: undefined, latitude: undefined, longitude: undefined } }),
      stopWhen: isStepCount(8),
      onStepStart({ stepNumber }) { console.log("step-start", stepNumber, Date.now() - startedAt); },
      onToolExecutionEnd({ toolCall, toolExecutionMs, toolOutput }) { console.log("tool-end", toolCall.toolName, toolExecutionMs, toolOutput.type); },
      onStepEnd({ stepNumber, finishReason, usage }) { console.log("step-end", stepNumber, finishReason, usage, Date.now() - startedAt); },
    });
    const result = await agent.stream({ prompt: "Кого нужно проверить на стельность?", timeout: { totalMs: 240_000, stepMs: 90_000, chunkMs: 60_000, toolMs: 30_000 } });
    let text = "";
    for await (const part of result.stream) {
      if (part.type === "tool-error") console.log("tool-error", part.toolName, String(part.error));
      if (part.type === "error") throw part.error;
      if (part.type === "abort") throw new Error("Agent timed out");
      if (part.type === "text-delta") text += part.text;
    }
    assert(view, `Agent did not configure the table: ${text}`);
    assert(text.trim(), "Agent returned no text");
    const rows = await queryAnimals({ userId, filters: view.filters, columns: view.columns, sort: view.sort, groupBy: view.groupBy });
    assert(rows.totalRows > 0, "Pregnancy-check report is empty");
    console.log(JSON.stringify({ passed: true, durationMs: Date.now() - startedAt, totalRows: rows.totalRows, text, filters: view.filters, columns: view.columns }));
  } finally {
    await deleteChatById({ id: chatId });
    await getFarmClient().end();
    await productClient.end();
  }
}
main().catch(error => { console.error(error instanceof Error ? { name: error.name, message: error.message } : "Agent check failed"); process.exitCode = 1; });

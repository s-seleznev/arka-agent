import type { LanguageModel } from "ai";

const mockResponses: Record<string, string> = {
  default: "This is a mock response for testing.",
  greeting: "Hello! How can I help you today?",
  weather: "The weather in San Francisco is sunny and 72°F.",
};

const mockUsage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
  outputTokens: { reasoning: 0, text: 20, total: 20 },
};

function getResponseForPrompt(prompt: unknown): string {
  const promptStr = JSON.stringify(prompt).toLowerCase();

  if (promptStr.includes("weather") || promptStr.includes("temperature")) {
    return mockResponses.weather;
  }
  if (
    promptStr.includes("hello") ||
    promptStr.includes("hi") ||
    promptStr.includes("hey")
  ) {
    return mockResponses.greeting;
  }

  return mockResponses.default;
}

function collectStrings(value: unknown, result: string[] = []): string[] {
  if (typeof value === "string") {
    result.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, result);
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, result);
    }
  }
  return result;
}

function hasToolResult(value: unknown, toolName: string): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (
    "type" in value &&
    value.type === "tool-result" &&
    "toolName" in value &&
    value.toolName === toolName
  ) {
    return true;
  }
  return Object.values(value).some((item) => hasToolResult(item, toolName));
}

function getFarmViewContext(prompt: unknown) {
  for (const value of collectStrings(prompt)) {
    const match = value.match(/Current farm workspace:\n(\{[^\n]+\})/);
    if (match?.[1]) {
      return JSON.parse(match[1]) as {
        filters?: {
          children?: unknown[];
          id?: string;
        };
        revision: number;
        viewId: string;
      };
    }
  }
  return null;
}

type MockFarmView = {
  filters?: {
    children?: unknown[];
    id?: string;
  };
  id?: string;
  revision: number;
  viewId?: string;
};

function findFarmView(value: unknown): MockFarmView | null {
  if (!(value && typeof value === "object")) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.revision === "number" &&
    candidate.filters !== null &&
    typeof candidate.filters === "object" &&
    (typeof candidate.id === "string" || typeof candidate.viewId === "string")
  ) {
    return candidate as MockFarmView;
  }

  for (const child of Object.values(candidate)) {
    const found = findFarmView(child);
    if (found) {
      return found;
    }
  }

  return null;
}

function findMockFilter(
  node: unknown,
  field: string
): { field?: string; id?: string } | null {
  if (!(node && typeof node === "object")) {
    return null;
  }
  const candidate = node as {
    children?: unknown[];
    field?: string;
    id?: string;
  };
  if (candidate.field === field) {
    return candidate;
  }
  for (const child of candidate.children ?? []) {
    const found = findMockFilter(child, field);
    if (found) {
      return found;
    }
  }
  return null;
}

const createMockModel = (): LanguageModel =>
  ({
    defaultObjectGenerationMode: "tool",
    doGenerate: async ({ prompt }: { prompt: unknown }) => ({
      content: [{ text: getResponseForPrompt(prompt), type: "text" }],
      finishReason: { raw: undefined, unified: "stop" },
      usage: mockUsage,
      warnings: [],
    }),
    doStream: ({ prompt }: { prompt: unknown }) => {
      const promptText = collectStrings(prompt).join("\n");
      const farmContext = getFarmViewContext(prompt);
      const shouldUpdateFarmView = promptText.includes(
        "TEST_AGENT_VIEW_UPDATE"
      );
      const targetFarmId = promptText.match(
        /TARGET_FARM_ID=([0-9a-f-]{36})/i
      )?.[1];
      const shouldReadView =
        shouldUpdateFarmView &&
        farmContext &&
        !hasToolResult(prompt, "getViewState");
      const shouldCallUpdate =
        shouldUpdateFarmView &&
        farmContext &&
        hasToolResult(prompt, "getViewState") &&
        !hasToolResult(prompt, "updateView");
      const response = getResponseForPrompt(prompt);

      return {
        stream: new ReadableStream({
          async start(controller) {
            if (shouldReadView) {
              controller.enqueue({
                input: JSON.stringify({ viewId: farmContext.viewId }),
                toolCallId: "mock-get-view-state",
                toolName: "getViewState",
                type: "tool-call",
              });
              controller.enqueue({
                finishReason: { raw: undefined, unified: "tool-calls" },
                type: "finish",
                usage: mockUsage,
              });
              controller.close();
              return;
            }
            if (shouldCallUpdate) {
              const liveView = findFarmView(prompt) ?? farmContext;
              const currentFarmFilter = findMockFilter(
                liveView.filters,
                "farmId"
              );
              const rootId = liveView.filters?.id;
              const rootLength = liveView.filters?.children?.length ?? 0;
              const targetFarmOperation = targetFarmId
                ? currentFarmFilter?.id
                  ? {
                      node: {
                        field: "farmId",
                        id: currentFarmFilter.id,
                        kind: "condition",
                        negated: false,
                        operator: "eq",
                        value: { type: "string", value: targetFarmId },
                      },
                      nodeId: currentFarmFilter.id,
                      type: "filter.update",
                    }
                  : {
                      index: rootLength,
                      node: {
                        field: "farmId",
                        id: "10000000-0000-4000-8000-000000000004",
                        kind: "condition",
                        negated: false,
                        operator: "eq",
                        value: { type: "string", value: targetFarmId },
                      },
                      parentId: rootId,
                      type: "filter.add",
                    }
                : null;
              controller.enqueue({
                input: JSON.stringify({
                  expectedRevision: liveView.revision,
                  operations: [
                    {
                      patch: {
                        columns: [
                          "primaryIdentifier",
                          "name",
                          "statusCode",
                          "isPregnant",
                        ],
                      },
                      type: "view.update",
                    },
                    {
                      index: rootLength,
                      node: {
                        field: "isPregnant",
                        id: "10000000-0000-4000-8000-000000000003",
                        kind: "condition",
                        negated: false,
                        operator: "eq",
                        value: { type: "boolean", value: true },
                      },
                      parentId: rootId,
                      type: "filter.add",
                    },
                    ...(targetFarmOperation ? [targetFarmOperation] : []),
                    {
                      index: 0,
                      rule: {
                        direction: "asc",
                        field: "statusCode",
                        hideEmpty: false,
                        id: "20000000-0000-4000-8000-000000000001",
                      },
                      type: "group.add",
                    },
                    {
                      index: 0,
                      rule: {
                        direction: "desc",
                        field: "name",
                        id: "30000000-0000-4000-8000-000000000001",
                      },
                      type: "sort.add",
                    },
                    {
                      index: 1,
                      rule: {
                        direction: "asc",
                        field: "primaryIdentifier",
                        id: "30000000-0000-4000-8000-000000000002",
                      },
                      type: "sort.add",
                    },
                  ],
                  viewId:
                    ("id" in liveView ? liveView.id : undefined) ??
                    liveView.viewId,
                }),
                toolCallId: "mock-update-view",
                toolName: "updateView",
                type: "tool-call",
              });
              controller.enqueue({
                finishReason: { raw: undefined, unified: "tool-calls" },
                type: "finish",
                usage: mockUsage,
              });
              controller.close();
              return;
            }
            const finalResponse = shouldUpdateFarmView
              ? "Таблица обновлена по данным фермы."
              : response;
            const finalWords = finalResponse.split(" ");
            controller.enqueue({ id: "t1", type: "text-start" });
            await finalWords.reduce<Promise<void>>(async (previous, word) => {
              await previous;
              controller.enqueue({
                delta: `${word} `,
                id: "t1",
                type: "text-delta",
              });
              await new Promise((resolve) => {
                setTimeout(resolve, 10);
              });
            }, Promise.resolve());
            controller.enqueue({ id: "t1", type: "text-end" });
            controller.enqueue({
              finishReason: { raw: undefined, unified: "stop" },
              type: "finish",
              usage: mockUsage,
            });
            controller.close();
          },
        }),
      };
    },
    modelId: "mock-model",
    provider: "mock",
    specificationVersion: "v3",
    supportedUrls: {},
  }) as unknown as LanguageModel;

const createMockTitleModel = (): LanguageModel =>
  ({
    defaultObjectGenerationMode: "tool",
    doGenerate: async () => ({
      content: [{ text: "Test Conversation", type: "text" }],
      finishReason: { raw: undefined, unified: "stop" },
      usage: {
        inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 5, total: 5 },
        outputTokens: { reasoning: 0, text: 5, total: 5 },
      },
      warnings: [],
    }),
    doStream: () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ id: "t1", type: "text-start" });
          controller.enqueue({
            delta: "Test Conversation",
            id: "t1",
            type: "text-delta",
          });
          controller.enqueue({ id: "t1", type: "text-end" });
          controller.enqueue({
            finishReason: { raw: undefined, unified: "stop" },
            type: "finish",
            usage: {
              inputTokens: {
                cacheRead: 0,
                cacheWrite: 0,
                noCache: 5,
                total: 5,
              },
              outputTokens: { reasoning: 0, text: 5, total: 5 },
            },
          });
          controller.close();
        },
      }),
    }),
    modelId: "mock-title-model",
    provider: "mock",
    specificationVersion: "v3",
    supportedUrls: {},
  }) as unknown as LanguageModel;

export const chatModel = createMockModel();
export const titleModel = createMockTitleModel();

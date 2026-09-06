import { get as getBlob } from "@vercel/blob";
import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  ToolLoopAgent,
  tool,
  toUIMessageStream,
} from "ai";
import { z } from "zod";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { runCodexAppServerTurn } from "@/lib/ai/codex-app-server";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
  getModelAvailability,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { prepareFarmReportStep } from "@/lib/ai/farm-report-step";
import { repairTableToolCall } from "@/lib/ai/repair-table-tool-call";
import { createDocument } from "@/lib/ai/tools/create-document";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { createFarmTools } from "@/lib/ai/tools/farm";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment, isTestEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getKnowledgeContextForUser,
  getMessageCountByUserId,
  getMessagesByChatId,
  getUploadedFileById,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { createDefaultView, getSavedViewForChat, getSavedView } from "@/lib/farm/views";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage, WaitingStatusData } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 300;

const HEALTH_CHECK_DELAY_MS = 9000;
const useCodexAppServer =
  !isTestEnvironment && process.env.AI_RUNTIME === "codex-app-server";

function getMessageText(chatMessage: ChatMessage) {
  return chatMessage.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function makeLocalChatTitle(chatMessage: ChatMessage) {
  const text = getMessageText(chatMessage).replace(/\s+/g, " ").trim();
  if (!text) {
    return "Новая задача";
  }
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function serializeConversation(messages: ChatMessage[]) {
  const transcript = messages
    .map((chatMessage) => {
      const text = getMessageText(chatMessage);
      const attachments = chatMessage.parts
        .filter((part) => part.type === "file")
        .map((part) => `[Прикреплён файл: ${part.filename ?? "без имени"}]`)
        .join("\n");
      const content = [text, attachments].filter(Boolean).join("\n");
      if (!content) {
        return null;
      }
      const role = chatMessage.role === "user" ? "Пользователь" : "Аркаша";
      return `${role}: ${content}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return `История текущего чата:\n\n${transcript}\n\nОтветь на последнюю реплику пользователя. Не пересказывай историю.`;
}

async function resolvePrivateFilesForModel(
  messages: ChatMessage[],
  userId: string
): Promise<ChatMessage[]> {
  const resolved: ChatMessage[] = messages.map((message) => ({
    ...message,
    parts: [...message.parts],
  }));
  const pending: Promise<void>[] = [];
  for (const message of resolved) {
    message.parts.forEach((part, index) => {
      if (part.type !== "file" || !part.url.startsWith("/api/files/")) {
        return;
      }
      pending.push(
        (async () => {
          const id = part.url.split("/").at(-1)?.split("?")[0];
          if (!id) {
            return;
          }
          const file = await getUploadedFileById({ id });
          if (!file || file.userId !== userId) {
            return;
          }
          const result = await getBlob(file.pathname, { access: "private" });
          if (result?.statusCode !== 200) {
            return;
          }
          const bytes = await new Response(result.stream).arrayBuffer();
          message.parts[index] = {
            ...part,
            url: `data:${file.contentType};base64,${Buffer.from(bytes).toString("base64")}`,
          };
        })()
      );
    });
  }
  await Promise.all(pending);
  return resolved;
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch {
    return null;
  }
}


export async function POST(request: Request) {
  const startedAt = Date.now();
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const {
      id,
      message,
      messages,
      selectedChatModel,
      selectedVisibilityType,
      viewContext,
    } = requestBody;

    const [botIdResult, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (botIdResult?.isBot) {
      return new ChatbotError("forbidden:api").toResponse();
    }

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      differenceInHours: 1,
      id: session.user.id,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
      if (
        chat.title === "Новая задача" &&
        messagesFromDb.length === 0 &&
        message?.role === "user" &&
        !isToolApprovalFlow
      ) {
        titlePromise = Promise.resolve(makeLocalChatTitle(message));
      }
    } else if (message?.role === "user") {
      await saveChat({
        id,
        title: "Новая задача",
        userId: session.user.id,
        visibility: selectedVisibilityType,
      });
      titlePromise = Promise.resolve(makeLocalChatTitle(message));
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      // A retry reuses the user message ID; do not insert or send it twice.
      const retryIndex = messagesFromDb.findIndex((item) => item.id === message?.id);
      uiMessages = [
        ...convertToUIMessages(retryIndex < 0 ? messagesFromDb : messagesFromDb.slice(0, retryIndex)),
        message as ChatMessage,
      ];
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      city,
      country,
      latitude,
      longitude,
    };

    if (message?.role === "user" && !messagesFromDb.some((item) => item.id === message.id)) {
      await saveMessages({
        messages: [
          {
            attachments: [],
            chatId: id,
            createdAt: new Date(),
            id: message.id,
            parts: message.parts,
            role: "user",
          },
        ],
      });
    }

    const modelConfig = chatModels.find((m) => m.id === chatModel);
    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;

    const messagesForModel = await resolvePrivateFilesForModel(
      uiMessages,
      session.user.id
    );
    const modelMessages = await convertToModelMessages(messagesForModel);
    const latestText =
      message?.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ") ?? "";
    const knowledgeContext = await getKnowledgeContextForUser({
      query: latestText,
      userId: session.user.id,
    });
    const activeView = viewContext
      ? await getSavedView({ id: viewContext.viewId, userId: session.user.id })
      : null;
    const farmContext = activeView
      ? JSON.stringify({
          columns: activeView.columns,
          expandedGroupPaths: viewContext?.expandedGroupPaths ?? [],
          filters: activeView.filters,
          groupBy: activeView.groupBy,
          revision: activeView.revision,
          schemaVersion: activeView.schemaVersion,
          selectedIds: viewContext?.selectedIds ?? [],
          sort: activeView.sort,
          viewId: activeView.id,
          viewportRowIds: viewContext?.viewportRowIds ?? [],
        })
      : undefined;

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const modelName = modelConfig?.name ?? chatModel;
        let hasModelActivity = false;
        let healthCheckTimer: ReturnType<typeof setTimeout> | undefined;

        const clearHealthCheckTimer = () => {
          if (healthCheckTimer) {
            clearTimeout(healthCheckTimer);
          }
        };

        const writeWaitingStatus = (
          phase: WaitingStatusData["phase"],
          messageText: string
        ) => {
          if (hasModelActivity && phase !== "thinking") {
            return;
          }
          dataStream.write({
            data: {
              message: messageText,
              modelId: chatModel,
              modelName,
              phase,
            },
            transient: true,
            type: "data-waiting-status",
          });
        };

        writeWaitingStatus("waiting", "Ждём ответ...");

        healthCheckTimer = setTimeout(() => {
          getModelAvailability(chatModel)
            .then((availability) => {
              if (availability === "impacted") {
                writeWaitingStatus(
                  "health",
                  `${modelName} сейчас отвечает медленнее обычного...`
                );
              } else {
                writeWaitingStatus("still-waiting", "Ответ ещё формируется...");
              }
            })
            .catch(() => {
              writeWaitingStatus("still-waiting", "Ответ ещё формируется...");
            });
        }, HEALTH_CHECK_DELAY_MS);

        const markModelActive = () => {
          if (hasModelActivity) {
            return;
          }
          hasModelActivity = true;
          clearHealthCheckTimer();
          writeWaitingStatus("thinking", "Формируем ответ...");
        };

        const stopWaitingStatus = () => {
          hasModelActivity = true;
          clearHealthCheckTimer();
        };

        const farmTools = {
          ...createFarmTools({ dataStream, userId: session.user.id, chatId: id }),
          openAnimalTable: tool({
            description: "Open the animal table in the right panel for this chat, returning its view ID and revision. Call this before configuring a table when no current view exists. Get authorized farm IDs from getFarmContext; never invent IDs.",
            inputSchema: z.object({ farmId: z.uuid() }),
            execute: async ({ farmId }) => {
              const view = await getSavedViewForChat({ chatId: id, userId: session.user.id })
                ?? await createDefaultView({ chatId: id, farmId, userId: session.user.id });
              dataStream.write({ type: "data-view-state", data: view });
              return { view };
            },
          }),
        };

        if (useCodexAppServer) {
          const textId = generateUUID();
          let textStarted = false;
          markModelActive();
          await runCodexAppServerTurn({
            abortSignal: request.signal,
            images:
              messagesForModel
                .at(-1)
                ?.parts.flatMap((part) =>
                  part.type === "file" && part.mediaType.startsWith("image/")
                    ? [part.url]
                    : []
                ) ?? [],
            instructions: systemPrompt({
              farmContext,
              knowledgeContext,
              requestHints,
              supportsTools: false,
            }),
            onToolComplete({ tool, durationMs, error }) {
              dataStream.write({ type: "data-rule-trace", data: {
                at: new Date().toISOString(), tool, detail: { durationMs, error },
              } });
            },
            onTextDelta(delta) {
              if (!textStarted) {
                dataStream.write({ id: textId, type: "text-start" });
                textStarted = true;
              }
              dataStream.write({ delta, id: textId, type: "text-delta" });
            },
            prompt: serializeConversation(messagesForModel),
            tools: farmTools,
          });
          if (textStarted) {
            dataStream.write({ id: textId, type: "text-end" });
          }
          stopWaitingStatus();

          if (titlePromise) {
            const title = await titlePromise;
            dataStream.write({ data: title, type: "data-chat-title" });
            updateChatTitleById({ chatId: id, title }).catch(() => undefined);
          }
          return;
        }

        const tools = {
          createDocument: createDocument({
            dataStream,
            modelId: chatModel,
            session,
          }),
          editDocument: editDocument({ dataStream, session }),
          getWeather,
          requestSuggestions: requestSuggestions({
            dataStream,
            modelId: chatModel,
            session,
          }),
          updateDocument: updateDocument({
            dataStream,
            modelId: chatModel,
            session,
          }),
          ...farmTools,
        };
        const activeTools = supportsTools
          ? (Object.keys(tools) as Array<keyof typeof tools>)
          : [];
        const arkashaAgent = new ToolLoopAgent({
          activeTools,
          maxRetries: 0,
          maxOutputTokens: 4096,
          prepareStep: prepareFarmReportStep,
          experimental_repairToolCall: repairTableToolCall,
          onStepStart({ stepNumber }) {
            console.info("[agent] step-start", { chatId: id, stepNumber, elapsedMs: Date.now() - startedAt });
          },
          onStepEnd({ stepNumber, finishReason, usage, toolCalls }) {
            console.info("[agent] step-end", { chatId: id, stepNumber, finishReason, usage, tools: toolCalls.map(call => ({ name: call.toolName, invalid: call.invalid })), elapsedMs: Date.now() - startedAt });
          },
          onToolExecutionEnd({ toolCall, toolExecutionMs, toolOutput }) {
            console.info("[agent] tool-end", { chatId: id, tool: toolCall.toolName, durationMs: toolExecutionMs, resultType: toolOutput.type });
          },
          instructions: systemPrompt({
            farmContext,
            knowledgeContext,
            requestHints,
            supportsTools,
          }),
          model: getLanguageModel(chatModel),
          onEnd() {
            stopWaitingStatus();
          },
          providerOptions: {
            ...(modelConfig?.gatewayOrder && {
              gateway: { order: modelConfig.gatewayOrder },
            }),
            ...(modelConfig?.reasoningEffort && {
              openai: { reasoningEffort: modelConfig.reasoningEffort },
            }),
          },
          stopWhen: isStepCount(8),
          telemetry: {
            functionId: "arkasha-agent",
            isEnabled: isProductionEnvironment,
            recordInputs: false,
            recordOutputs: false,
          },
          tools,
        });

        markModelActive();
        console.info("[agent] context-ready", { chatId: id, elapsedMs: Date.now() - startedAt });
        const result = await arkashaAgent.stream({
          messages: modelMessages,
          abortSignal: request.signal,
          timeout: { totalMs: 240_000, stepMs: 90_000, chunkMs: 60_000, toolMs: 30_000 },
        });

        dataStream.merge(
          toUIMessageStream({
            sendReasoning: isReasoningModel,
            onError(error) {
              console.error("[agent] stream-error", { chatId: id, name: error instanceof Error ? error.name : "UnknownError", elapsedMs: Date.now() - startedAt });
              if (error instanceof Error && error.message === "AGENT_TIMEOUT") {
                return "Модель не успела ответить. Повторите запрос.";
              }
              return "Не удалось получить ответ модели. Повторите запрос.";
            },
            stream: result.stream.pipeThrough(new TransformStream({
              transform(part, controller) {
                if (part.type === "abort" && !request.signal.aborted) {
                  console.error("[agent] timeout", { chatId: id, elapsedMs: Date.now() - startedAt });
                  controller.enqueue({ type: "error", error: new Error("AGENT_TIMEOUT") });
                } else {
                  controller.enqueue(part);
                }
              },
            })),
          })
        );

        if (titlePromise) {
          try {
            const title = await titlePromise;
            dataStream.write({ data: title, type: "data-chat-title" });
            await updateChatTitleById({ chatId: id, title });
          } catch {
            /* non-fatal */
          }
        }
      },
      generateId: generateUUID,
      onEnd: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          await Promise.all(
            finishedMessages.map(async (finishedMsg) => {
              const existingMsg = uiMessages.find(
                (m) => m.id === finishedMsg.id
              );
              if (existingMsg) {
                await updateMessage({
                  id: finishedMsg.id,
                  parts: finishedMsg.parts,
                });
                return;
              }

              await saveMessages({
                messages: [
                  {
                    attachments: [],
                    chatId: id,
                    createdAt: new Date(),
                    id: finishedMsg.id,
                    parts: finishedMsg.parts,
                    role: finishedMsg.role,
                  },
                ],
              });
            })
          );
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              attachments: [],
              chatId: id,
              createdAt: new Date(),
              id: currentMessage.id,
              parts: currentMessage.parts,
              role: currentMessage.role,
            })),
          });
        }
      },
      onError: (error) => {
        console.error("[agent] request-error", { chatId: requestBody.id, name: error instanceof Error ? error.name : "UnknownError", elapsedMs: Date.now() - startedAt });
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "Модель не подключена. Настройте нашу модель или активируйте Vercel AI Gateway.";
        }
        return "Не удалось получить ответ модели.";
      },
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
    });

    return createUIMessageStreamResponse({
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ chatId: id, streamId });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch {
          /* non-critical */
        }
      },
      stream,
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const body = (await request.json()) as { id?: string; title?: string };
  const id = body.id?.trim();
  const title = body.title?.trim();
  if (!id || !title || title.length > 120) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const chat = await getChatById({ id });
  if (!chat || chat.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  await updateChatTitleById({ chatId: id, title });
  return Response.json({ id, title }, { status: 200 });
}

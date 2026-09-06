import { spawn } from "node:child_process";
import readline from "node:readline";
import { z } from "zod";

type JsonRpcId = number | string;

type JsonRpcMessage = {
  error?: { code?: number; message?: string };
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

type ExecutableTool = {
  description?: string;
  execute?: (
    input: unknown,
    options: { messages: never[]; toolCallId: string }
  ) => PromiseLike<unknown> | unknown;
  inputSchema: unknown;
};

type RunCodexTurnOptions = {
  abortSignal?: AbortSignal;
  images?: string[];
  instructions: string;
  onTextDelta: (delta: string) => void;
  onToolComplete?: (event: { tool: string; durationMs: number; error: string | null }) => void;
  prompt: string;
  tools: Record<string, unknown>;
};

const TURN_TIMEOUT_MS = 120_000;

function stringifyToolResult(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item
  );
}

async function validateToolInput(tool: ExecutableTool, input: unknown) {
  const standardSchema = tool.inputSchema as {
    "~standard"?: {
      validate: (
        value: unknown
      ) =>
        | Promise<{ issues?: unknown[]; value?: unknown }>
        | { issues?: unknown[]; value?: unknown };
    };
  };
  const validator = standardSchema["~standard"]?.validate;
  if (!validator) {
    return input;
  }
  const result = await validator(input);
  if (result.issues?.length) {
    throw new Error(
      `Invalid tool input: ${stringifyToolResult(result.issues)}`
    );
  }
  return result.value;
}

function jsonSchemaFor(tool: ExecutableTool) {
  return z.toJSONSchema(tool.inputSchema as z.ZodType);
}

export async function runCodexAppServerTurn({
  abortSignal,
  images = [],
  instructions,
  onTextDelta,
  onToolComplete,
  prompt,
  tools,
}: RunCodexTurnOptions) {
  const codexPath = process.env.CODEX_CLI_PATH || "codex";
  const child = spawn(codexPath, ["app-server", "--stdio"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map<
    JsonRpcId,
    {
      reject: (error: Error) => void;
      resolve: (value: Record<string, unknown>) => void;
    }
  >();
  let nextId = 0;
  let stderr = "";
  let lastTextItem: string | undefined;
  let settled = false;
  let turnResolve: (() => void) | undefined;
  let turnReject: ((error: Error) => void) | undefined;

  const turnComplete = new Promise<void>((resolve, reject) => {
    turnResolve = resolve;
    turnReject = reject;
  });

  const write = (message: Record<string, unknown>) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const request = (
    method: string,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    nextId += 1;
    const id = nextId;
    write({ id, method, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { reject, resolve });
    });
  };

  const respondToToolCall = async (message: JsonRpcMessage) => {
    const params = message.params ?? {};
    const toolName = String(params.tool ?? "");
    const tool = tools[toolName] as ExecutableTool | undefined;
    if (!tool?.execute) {
      write({
        id: message.id,
        result: {
          contentItems: [
            { text: `Unknown tool: ${toolName}`, type: "inputText" },
          ],
          success: false,
        },
      });
      return;
    }
    const startedAt = Date.now();
    try {
      console.info("[agent-tool]", toolName, "started");
      const input = await validateToolInput(tool, params.arguments);
      const output = await tool.execute(input, {
        messages: [],
        toolCallId: String(params.callId ?? message.id ?? toolName),
      });
      const durationMs = Date.now() - startedAt;
      console.info("[agent-tool]", toolName, "completed", { durationMs });
      onToolComplete?.({ tool: toolName, durationMs, error: null });
      write({
        id: message.id,
        result: {
          contentItems: [
            { text: stringifyToolResult(output), type: "inputText" },
          ],
          success: true,
        },
      });
    } catch (error) {
      onToolComplete?.({ tool: toolName, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "Tool failed" });
      write({
        id: message.id,
        result: {
          contentItems: [
            {
              text: error instanceof Error ? error.message : "Tool failed",
              type: "inputText",
            },
          ],
          success: false,
        },
      });
    }
  };

  lines.on("line", (line) => {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (
      message.id !== undefined &&
      message.method === undefined &&
      (message.result !== undefined || message.error !== undefined)
    ) {
      const waiter = pending.get(message.id);
      if (!waiter) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        waiter.reject(
          new Error(message.error.message ?? "Codex app-server request failed")
        );
      } else {
        waiter.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method === "item/tool/call" && message.id !== undefined) {
      respondToToolCall(message).catch((error) => turnReject?.(error));
      return;
    }

    if (message.method === "item/agentMessage/delta") {
      const delta = message.params?.delta;
      if (typeof delta === "string") {
        const itemId = String(message.params?.itemId ?? "");
        if (lastTextItem !== undefined && itemId !== lastTextItem) onTextDelta("\n\n");
        lastTextItem = itemId;
        onTextDelta(delta);
      }
      return;
    }

    if (message.method === "turn/completed") {
      const turn = message.params?.turn as
        | { error?: { message?: string }; status?: string }
        | undefined;
      if (turn?.status === "failed") {
        turnReject?.(
          new Error(turn.error?.message ?? "Codex app-server turn failed")
        );
      } else {
        turnResolve?.();
      }
      return;
    }

    if (message.method === "error") {
      const error = message.params?.error as { message?: string } | undefined;
      turnReject?.(new Error(error?.message ?? "Codex app-server error"));
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-4000);
  });

  child.once("error", (error) => {
    turnReject?.(error);
    for (const waiter of pending.values()) {
      waiter.reject(error);
    }
    pending.clear();
  });

  child.once("exit", (code) => {
    if (!settled && code !== 0) {
      const error = new Error(
        stderr.trim() || `Codex app-server exited with code ${code}`
      );
      turnReject?.(error);
      for (const waiter of pending.values()) {
        waiter.reject(error);
      }
      pending.clear();
    }
  });

  const stop = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };
  abortSignal?.addEventListener("abort", stop, { once: true });

  const timer = setTimeout(() => {
    turnReject?.(new Error("Codex app-server turn timed out"));
    stop();
  }, TURN_TIMEOUT_MS);

  try {
    await request("initialize", {
      capabilities: { experimentalApi: true },
      clientInfo: {
        name: "arkasha_local",
        title: "Arkasha local stand",
        version: "1.0.0",
      },
    });
    write({ method: "initialized", params: {} });

    const account = await request("account/read", { refreshToken: false });
    const accountInfo = account.account as { type?: string } | null | undefined;
    if (accountInfo?.type !== "chatgpt") {
      throw new Error("Codex CLI is not signed in with ChatGPT");
    }

    let model = process.env.CODEX_MODEL;
    if (!model) {
      const result = await request("model/list", {
        includeHidden: false,
        limit: 50,
      });
      const models = (result.data ?? []) as Array<{
        isDefault?: boolean;
        model?: string;
      }>;
      model = models.find((item) => item.isDefault)?.model ?? models[0]?.model;
    }
    if (!model) {
      throw new Error("Codex app-server returned no available model");
    }

    const dynamicTools = Object.entries(tools).map(([name, value]) => {
      const tool = value as ExecutableTool;
      return {
        description: tool.description ?? name,
        inputSchema: jsonSchemaFor(tool),
        name,
        type: "function",
      };
    });

    const started = await request("thread/start", {
      approvalPolicy: "never",
      baseInstructions: instructions,
      config: {
        features: { shell_tool: false, unified_exec: false, apps: false, plugins: false, multi_agent: false, memories: false },
        web_search: "disabled",
      },
      cwd: process.cwd(),
      dynamicTools,
      ephemeral: true,
      model,
      sandbox: "read-only",
      serviceName: "arkasha-local",
    });
    const thread = started.thread as { id?: string } | undefined;
    if (!thread?.id) {
      throw new Error("Codex app-server did not create a thread");
    }

    await request("turn/start", {
      effort: process.env.CODEX_REASONING_EFFORT || "medium",
      input: [
        { text: prompt, type: "text" },
        ...images.map((url) => ({ type: "image", url })),
      ],
      threadId: thread.id,
    });
    await turnComplete;
    settled = true;
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener("abort", stop);
    lines.close();
    stop();
  }
}

export const DEFAULT_CHAT_MODEL = "arkasha";

export const titleModel = {
  description: "Fast model for title generation",
  // This endpoint stops serving when the promotion ends; it never becomes paid.
  id: "inclusionai/ling-3.0-flash-sante-free",
  name: "Ling 3.0 Flash Sante (Free)",
  provider: "inclusionai",
};

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  gatewayOrder?: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
};

export const chatModels: ChatModel[] = [
  {
    description: "Модель ассистента",
    id: "arkasha",
    name: "Ассистент",
    provider: "arkasha",
  },
];

export async function getCapabilities(): Promise<
  Record<string, ModelCapabilities>
> {
  const results = await Promise.all(
    chatModels.map(async (model) => {
      if (model.id === "arkasha") {
        return [
          model.id,
          {
            reasoning: true,
            tools: true,
            vision:
              process.env.AI_MODEL_VISION !== "false" &&
              (process.env.AI_RUNTIME === "codex-app-server" ||
                Boolean(
                  process.env.AI_PROVIDER_API_KEY &&
                    process.env.AI_PROVIDER_BASE_URL &&
                    process.env.AI_MODEL_ID
                )),
          },
        ];
      }
      try {
        const res = await fetch(
          `https://ai-gateway.vercel.sh/v1/models/${model.id}/endpoints`,
          { next: { revalidate: 86_400 } }
        );
        if (!res.ok) {
          return [model.id, { reasoning: false, tools: false, vision: false }];
        }

        const json = await res.json();
        const endpoints = json.data?.endpoints ?? [];
        const params = new Set(
          endpoints.flatMap(
            (e: { supported_parameters?: string[] }) =>
              e.supported_parameters ?? []
          )
        );
        const inputModalities = new Set(
          json.data?.architecture?.input_modalities ?? []
        );

        return [
          model.id,
          {
            reasoning: params.has("reasoning"),
            tools: params.has("tools"),
            vision: inputModalities.has("image"),
          },
        ];
      } catch {
        return [model.id, { reasoning: false, tools: false, vision: false }];
      }
    })
  );

  return Object.fromEntries(results);
}

export const isDemo = process.env.IS_DEMO === "1";

type GatewayModel = {
  id: string;
  name: string;
  type?: string;
  tags?: string[];
};

export type GatewayModelWithCapabilities = ChatModel & {
  capabilities: ModelCapabilities;
};

export async function getAllGatewayModels(): Promise<
  GatewayModelWithCapabilities[]
> {
  try {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      next: { revalidate: 86_400 },
    });
    if (!res.ok) {
      return [];
    }

    const json = await res.json();
    return (json.data ?? [])
      .filter((m: GatewayModel) => m.type === "language")
      .map((m: GatewayModel) => ({
        capabilities: {
          reasoning: m.tags?.includes("reasoning") ?? false,
          tools: m.tags?.includes("tool-use") ?? false,
          vision: m.tags?.includes("vision") ?? false,
        },
        description: "",
        id: m.id,
        name: m.name,
        provider: m.id.split("/")[0],
      }));
  } catch {
    return [];
  }
}

export function getActiveModels(): ChatModel[] {
  return chatModels;
}

export const allowedModelIds = new Set(chatModels.map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);

export type ModelAvailability = "healthy" | "impacted" | "unknown";

type GatewayEndpoint = {
  provider_name?: string;
  status?: number;
  uptime_last_15m?: number;
  uptime_last_1h?: number;
  latency_last_1h?: {
    p50?: number;
    p95?: number;
  };
};

const PROVIDER_IMPACTED_UPTIME_THRESHOLD = 99;
const PROVIDER_IMPACTED_P50_MS = 10_000;
const PROVIDER_IMPACTED_P95_MS = 30_000;

function isEndpointImpacted(endpoint: GatewayEndpoint) {
  return (
    (endpoint.status !== undefined && endpoint.status !== 0) ||
    (endpoint.uptime_last_15m !== undefined &&
      endpoint.uptime_last_15m < PROVIDER_IMPACTED_UPTIME_THRESHOLD) ||
    (endpoint.uptime_last_1h !== undefined &&
      endpoint.uptime_last_1h < PROVIDER_IMPACTED_UPTIME_THRESHOLD) ||
    (endpoint.latency_last_1h?.p50 !== undefined &&
      endpoint.latency_last_1h.p50 > PROVIDER_IMPACTED_P50_MS) ||
    (endpoint.latency_last_1h?.p95 !== undefined &&
      endpoint.latency_last_1h.p95 > PROVIDER_IMPACTED_P95_MS)
  );
}

export async function getModelAvailability(
  modelId: string
): Promise<ModelAvailability> {
  const model = chatModels.find((item) => item.id === modelId);

  if (!model) {
    return "unknown";
  }

  try {
    const res = await fetch(
      `https://ai-gateway.vercel.sh/v1/models/${model.id}/endpoints`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) {
      return "unknown";
    }

    const json = await res.json();
    const endpoints = (json.data?.endpoints ?? []) as GatewayEndpoint[];

    if (endpoints.length === 0) {
      return "unknown";
    }

    return endpoints.some(isEndpointImpacted) ? "impacted" : "healthy";
  } catch {
    return "unknown";
  }
}

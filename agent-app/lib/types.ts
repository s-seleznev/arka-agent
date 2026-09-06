import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { createDocument } from "./ai/tools/create-document";
import type { createFarmTools } from "./ai/tools/farm";
import type { getWeather } from "./ai/tools/get-weather";
import type { requestSuggestions } from "./ai/tools/request-suggestions";
import type { updateDocument } from "./ai/tools/update-document";
import type { Suggestion } from "./db/schema";
import type { ReportViewState } from "./farm/types";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;
type FarmTools = ReturnType<typeof createFarmTools>;

export type ChatTools = {
  getFarmSkill: InferUITool<FarmTools["getFarmSkill"]>;
  refreshView: InferUITool<FarmTools["refreshView"]>;
  searchListRules: InferUITool<FarmTools["searchListRules"]>;
  getListRule: InferUITool<FarmTools["getListRule"]>;
  applyListRule: InferUITool<FarmTools["applyListRule"]>;
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  getFarmContext: InferUITool<FarmTools["getFarmContext"]>;
  getViewState: InferUITool<FarmTools["getViewState"]>;
  openAnimal: InferUITool<FarmTools["openAnimal"]>;
  queryAnimals: InferUITool<FarmTools["queryAnimals"]>;
  summarizeAnimals: InferUITool<FarmTools["summarizeAnimals"]>;
  updateView: InferUITool<FarmTools["updateView"]>;
};

export type WaitingStatusData = {
  phase: "waiting" | "still-waiting" | "health" | "thinking";
  message: string;
  modelId: string;
  modelName: string;
};

export type CustomUIDataTypes = {
  "rule-trace": {
    tool: string;
    at: string;
    detail: Record<string, string | number | boolean | null>;
  };
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
  "waiting-status": WaitingStatusData;
  "view-state": ReportViewState;
  "animal-card": { animal: Record<string, unknown>; viewId: string };
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  id?: string;
  name: string;
  url: string;
  contentType: string;
};

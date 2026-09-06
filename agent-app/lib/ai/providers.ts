import { createOpenAI } from "@ai-sdk/openai";
import { customProvider, gateway } from "ai";
import { isTestEnvironment } from "../constants";
import { titleModel } from "./models";

function getOpenRouterModel() {
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  const modelId = process.env.AI_MODEL_ID || "openrouter/free";
  if (!apiKey) {
    throw new Error("OpenRouter requires AI_PROVIDER_API_KEY in the server environment.");
  }
  if (modelId !== "openrouter/free" && !modelId.endsWith(":free")) {
    throw new Error("OpenRouter demo only permits free models.");
  }
  return createOpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    name: "openrouter",
  }).chat(modelId);
}

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        chatModel,
        titleModel: mockTitleModel,
      } = require("./models.mock");
      return customProvider({
        languageModels: {
          arkasha: chatModel,
          "chat-model": chatModel,
          "title-model": mockTitleModel,
        },
      });
    })()
  : null;

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  if (modelId === "arkasha" && process.env.AI_RUNTIME === "openrouter") {
    return getOpenRouterModel();
  }

  if (
    modelId === "arkasha" &&
    process.env.AI_PROVIDER_API_KEY &&
    process.env.AI_PROVIDER_BASE_URL &&
    process.env.AI_MODEL_ID
  ) {
    return createOpenAI({
      apiKey: process.env.AI_PROVIDER_API_KEY,
      baseURL: process.env.AI_PROVIDER_BASE_URL,
      name: "arkasha",
    }).chat(process.env.AI_MODEL_ID);
  }

  return gateway.languageModel(modelId === "arkasha" ? titleModel.id : modelId);
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }
  if (process.env.AI_RUNTIME === "openrouter") {
    return getOpenRouterModel();
  }
  if (
    process.env.AI_PROVIDER_API_KEY &&
    process.env.AI_PROVIDER_BASE_URL &&
    process.env.AI_MODEL_ID
  ) {
    return createOpenAI({
      apiKey: process.env.AI_PROVIDER_API_KEY,
      baseURL: process.env.AI_PROVIDER_BASE_URL,
      name: "arkasha",
    }).chat(process.env.AI_MODEL_ID);
  }
  return gateway.languageModel(titleModel.id);
}

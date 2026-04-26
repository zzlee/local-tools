import { AIProvider } from "./provider.js";
import { GeminiProvider } from "./gemini.js";
import { OpenRouterProvider } from "./openrouter.js";
import { OllamaProvider } from "./ollama.js";

export * from "./types.js";
export * from "./provider.js";
export * from "./gemini.js";
export * from "./openrouter.js";
export * from "./ollama.js";

export type AIProviderName = "gemini" | "openrouter" | "ollama";

export function createAIProvider(providerName: AIProviderName | string): AIProvider {
  switch (providerName.toLowerCase()) {
    case "gemini":
      return new GeminiProvider();
    case "openrouter":
      return new OpenRouterProvider();
    case "ollama":
      return new OllamaProvider();
    default:
      throw new Error(`Unsupported AI provider: ${providerName}`);
  }
}

import { GoogleGenAI } from "@google/genai";
import { AIProvider } from "./provider.js";
import { GenerateContentOptions, GenerateContentResponse, Message, MessagePart, ToolCall } from "./types.js";

export class GeminiProvider extends AIProvider {
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    super();
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateContent(options: GenerateContentOptions): Promise<GenerateContentResponse> {
    const contents: any[] = options.messages.map((msg) => {
      const parts = msg.parts.map((p) => {
        if (p.text) return { text: p.text };
        if (p.functionResponse) return {
          functionResponse: {
            name: p.functionResponse.name,
            response: p.functionResponse.response
          }
        };
        // Remove thought blocks from input to model as it doesn't accept it
        if (p.toolCalls) {
          // Input tool calls are from previous assistant responses. Map them to functionCall in parts.
          // In @google/genai, function calls are placed inside parts as { functionCall: { name, args } }
          return p.toolCalls.map(tc => ({
            functionCall: {
              name: tc.name,
              args: tc.args
            }
          }));
        }
        return undefined;
      }).flat().filter(Boolean);

      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts: parts,
      };
    });

    const config: any = {
      tools: options.tools,
    };
    if (options.systemInstruction) {
      config.systemInstruction = { parts: [{ text: options.systemInstruction }] };
    }

    const response = await this.ai.models.generateContent({
      model: options.model,
      contents,
      config,
    });

    const candidate = response.candidates![0]!;
    const content = candidate.content!;

    const parts: MessagePart[] = [];

    // Extract parts from the content
    for (const p of content.parts || []) {
      if ((p as any).thought) {
        parts.push({ thought: (p as any).thought });
      }
      if (p.text) {
        parts.push({ text: p.text });
      }
      // functionCall is returned in content.parts in gemini genai SDK 1.x? Actually it returns it in functionCall
    }

    // Process functionCalls
    if (response.functionCalls && response.functionCalls.length > 0) {
      const toolCalls = response.functionCalls.map((fc: any) => ({
        id: crypto.randomUUID(),
        name: fc.name,
        args: fc.args || {},
      }));
      parts.push({ toolCalls });
    } else if (content.parts) {
       const functionCallsPart = content.parts.find(p => (p as any).functionCall);
       if (functionCallsPart) {
         const toolCalls = content.parts.filter(p => (p as any).functionCall).map((p: any) => ({
            id: crypto.randomUUID(),
            name: p.functionCall.name,
            args: p.functionCall.args || {}
         }));
         parts.push({ toolCalls });
       }
    }

    return {
      message: {
        role: "assistant",
        parts,
      },
      usageMetadata: response.usageMetadata ? {
        promptTokenCount: response.usageMetadata.promptTokenCount || 0,
        candidatesTokenCount: response.usageMetadata.candidatesTokenCount || 0,
        totalTokenCount: response.usageMetadata.totalTokenCount || 0,
      } : undefined,
    };
  }
}

import { AIProvider } from "./provider.js";
import { GenerateContentOptions, GenerateContentResponse, Message, MessagePart, ToolCall } from "./types.js";
import { Ollama } from "ollama";
import * as crypto from "node:crypto";

export class OllamaProvider extends AIProvider {
  private ai: Ollama;

  constructor(host: string = "http://127.0.0.1:11434") {
    super();
    this.ai = new Ollama({ host: process.env.OLLAMA_HOST || host });
  }

  async generateContent(options: GenerateContentOptions): Promise<GenerateContentResponse> {
    const messages: any[] = [];

    if (options.systemInstruction) {
      messages.push({
        role: "system",
        content: options.systemInstruction
      });
    }

    for (const msg of options.messages) {
      // Map back tool responses
      const toolResponses = msg.parts.filter(p => p.functionResponse);
      if (toolResponses.length > 0) {
         for (const tr of toolResponses) {
           messages.push({
             role: "tool",
             content: JSON.stringify(tr.functionResponse!.response)
           });
         }
         continue;
      }

      // Handle standard parts
      const content = msg.parts.map(p => p.text).filter(Boolean).join("\n");
      const toolCallsPart = msg.parts.find(p => p.toolCalls);

      const ollamaMsg: any = {
        role: msg.role === "assistant" ? "assistant" : "user",
        content: content || "" // Ollama often requires content to be a string, not null
      };

      if (toolCallsPart && toolCallsPart.toolCalls) {
        ollamaMsg.tool_calls = toolCallsPart.toolCalls.map(tc => ({
          function: {
            name: tc.name,
            arguments: tc.args
          }
        }));
      }

      messages.push(ollamaMsg);
    }

    // Convert tools to Ollama format
    const tools = options.tools?.[0]?.functionDeclarations?.map((t: any) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const payload: any = {
      model: options.model,
      messages,
      stream: false
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    const response = await this.ai.chat(payload) as any;

    const parts: MessagePart[] = [];
    const content = response.message.content;

    if (content) {
      // Check for <think> blocks
      const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        parts.push({ thought: thinkMatch[1].trim() });
        const textContent = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
        if (textContent) {
          parts.push({ text: textContent });
        }
      } else {
        parts.push({ text: content });
      }
    }

    // Parse tool calls
    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
      const toolCalls = response.message.tool_calls.map((tc: any) => ({
         id: crypto.randomUUID(), // Ollama tool calls don't have ids natively in SDK usually but standard needs it
         name: tc.function.name,
         args: tc.function.arguments || {}
      }));
      parts.push({ toolCalls });
    }

    return {
      message: {
        role: "assistant",
        parts
      },
      usageMetadata: {
        promptTokenCount: response.prompt_eval_count || 0,
        candidatesTokenCount: response.eval_count || 0,
        totalTokenCount: (response.prompt_eval_count || 0) + (response.eval_count || 0),
      }
    };
  }
}

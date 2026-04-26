import { AIProvider } from "./provider.js";
import { GenerateContentOptions, GenerateContentResponse, Message, MessagePart, ToolCall } from "./types.js";
import * as crypto from "node:crypto";

export class OpenRouterProvider extends AIProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl: string = "https://openrouter.ai/api/v1/chat/completions") {
    super();
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("Missing OPENROUTER_API_KEY environment variable");
    }
    this.baseUrl = baseUrl;
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
             tool_call_id: tr.functionResponse!.id || tr.functionResponse!.name,
             name: tr.functionResponse!.name,
             content: JSON.stringify(tr.functionResponse!.response)
           });
         }
         continue;
      }

      // Handle standard parts
      const content = msg.parts.map(p => p.text).filter(Boolean).join("\n");
      const toolCallsPart = msg.parts.find(p => p.toolCalls);

      const openAiMsg: any = {
        role: msg.role === "assistant" ? "assistant" : "user",
        content: content || null
      };

      if (toolCallsPart && toolCallsPart.toolCalls) {
        openAiMsg.tool_calls = toolCallsPart.toolCalls.map(tc => ({
          id: tc.id || crypto.randomUUID(), // OpenRouter needs an ID.
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args)
          }
        }));
      }

      messages.push(openAiMsg);
    }

    // Convert tools to OpenAI format
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
      include_reasoning: true, // Specific to OpenRouter / certain models
    };
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/opencode-tool",
        "X-Title": "OpenCode Tool"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;

    const parts: MessagePart[] = [];

    // Parse reasoning/thought
    // OpenRouter may return it in message.reasoning or message.content with <think>
    if (message.reasoning) {
       parts.push({ thought: message.reasoning });
    }

    if (message.content) {
      // Check for <think> blocks natively inside content (some models do this even on OR)
      const thinkMatch = message.content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        parts.push({ thought: thinkMatch[1].trim() });
        const textContent = message.content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
        if (textContent) {
          parts.push({ text: textContent });
        }
      } else {
        parts.push({ text: message.content });
      }
    }

    // Parse tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCalls = message.tool_calls.map((tc: any) => {
         let args = {};
         try {
           args = JSON.parse(tc.function.arguments);
         } catch(e) {
           // ignore
         }
         return {
           id: tc.id,
           name: tc.function.name,
           args
         };
      });
      parts.push({ toolCalls });
    }

    return {
      message: {
        role: "assistant",
        parts
      },
      usageMetadata: data.usage ? {
        promptTokenCount: data.usage.prompt_tokens || 0,
        candidatesTokenCount: data.usage.completion_tokens || 0,
        totalTokenCount: data.usage.total_tokens || 0,
      } : undefined
    };
  }
}

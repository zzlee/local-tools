export type Role = "user" | "assistant";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface MessagePart {
  text?: string;
  thought?: string;
  toolCalls?: ToolCall[];
  functionResponse?: {
    id?: string;
    name: string;
    response: {
      output?: string;
      error?: string;
    };
  };
}

export interface Message {
  role: Role;
  parts: MessagePart[];
}

export interface GenerateContentOptions {
  model: string;
  messages: Message[];
  tools?: any[]; // Reusing existing tool definitions
  systemInstruction?: string;
}

export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export interface GenerateContentResponse {
  message: Message;
  usageMetadata?: UsageMetadata;
}

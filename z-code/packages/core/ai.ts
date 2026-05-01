import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, tool } from "ai";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import ora from "ora";
import chalk from "chalk";
import { ToolRegistry } from "../tools/registry.js";
import { ToolContext } from "../tools/index.js";
import { CliOptions } from "./cli.js";

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | any[];
  toolCalls?: any[];
};

export class AiClient {
  private google: ReturnType<typeof createGoogleGenerativeAI>;
  private modelName: string;
  private totalPromptTokens = 0;
  private totalCandidatesTokens = 0;
  private totalTokens = 0;

  constructor(apiKey: string, modelName: string) {
    this.google = createGoogleGenerativeAI({
      apiKey,
      ...(process.env.GEMINI_BASE_URL ? { baseURL: process.env.GEMINI_BASE_URL } : {})
    });
    this.modelName = modelName;
  }

  async generateResponse(
    messages: Message[],
    systemPrompt: string, 
    activeTools: any[],
    options: CliOptions,
    ctx: ToolContext,
    sessionDir: string,
    registry: ToolRegistry,
    onFinalOutput: (text: string) => void
  ) {
    let finalOutputBuffer = "";
    let messagesCopy = [...messages];

    const vTools: Record<string, any> = {};
    for (const t of activeTools) {
      vTools[t.id] = {
        description: t.description,
        parameters: t.parameters as any
      };
    }

    while (true) {
      let response: any;
      let retries = 0;
      const maxRetries = 3;

      while (true) {
        let thinkingSpinner;
        try {
          if (options.verbosity === 0 || options.verbosity >= 2) {
            thinkingSpinner = ora("Thinking...").start();
          }
          
          response = await generateText({
            model: this.google(this.modelName),
            messages: messagesCopy as any,
            system: systemPrompt,
            tools: vTools
          });

          if (thinkingSpinner) thinkingSpinner.stop();
          
          if (response.usage) {
            this.totalPromptTokens += response.usage.promptTokens || 0;
            this.totalCandidatesTokens += response.usage.completionTokens || 0;
            this.totalTokens += response.usage.totalTokens || 0;
          }
          break;
        } catch (e: any) {
          if (thinkingSpinner) thinkingSpinner.fail("Thinking failed");

          if (e.status && retries < maxRetries) {
            retries++;
            console.log(chalk.yellow(`API Error ${e.status}, retrying in 3s... (${retries}/${maxRetries})`));
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
          }
          if (e.status) {
            try {
              const parsed = JSON.parse(e.message);
              console.error(chalk.red(`API Error ${parsed.error.code}: ${parsed.error.message}`));
            } catch {
              console.error(chalk.red(`API Error ${e.status}: ${e.message}`));
            }
          } else {
            console.error(chalk.red(`Error: ${e.message}`));
          }
          process.exit(1);
        }
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: []
      };

      if (response.text) {
        (assistantMessage.content as any[]).push({ type: "text", text: response.text });
      }

      const toolCalls = response.toolCalls || [];
      for (const tc of toolCalls) {
        (assistantMessage.content as any[]).push({
          type: "tool-call",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args
        });
      }

      messagesCopy.push(assistantMessage);
      await fs.writeFile(path.join(sessionDir, "history.json"), JSON.stringify(messagesCopy, null, 2));

      if (response.text) {
        if (toolCalls.length === 0) {
          finalOutputBuffer += response.text + "\n";
          onFinalOutput(response.text);
        }
        if (toolCalls.length > 0) {
          console.log(chalk.yellow(response.text));
        } else {
          console.log(response.text);
        }
      }

      if (toolCalls.length === 0) {
        break;
      }

      const functionResponseParts: any[] = [];

      for (const toolCall of toolCalls) {
        const toolId = toolCall.toolName;
        const args = toolCall.args || {};
        
        const spinner = ora(`Executing ${chalk.cyan(toolId)}...`).start();
        try {
          const result = await registry.execute(toolId, args as any, ctx);
          if (spinner) spinner.succeed(`Executed ${chalk.cyan(toolId)}`);
          if (options.verbosity > 1) {
            console.log(chalk.blue(`${result.output.substring(0, 500)}${result.output.length > 500 ? "..." : ""}`));
          }
          
          functionResponseParts.push({
            type: "tool-result",
            toolCallId: toolCall.toolCallId,
            toolName: toolId,
            result: result.output
          });
        } catch (e: any) {
          if (spinner) spinner.fail(`Error executing ${chalk.cyan(toolId)}`);
          if (options.verbosity > 1) {
            console.log(chalk.red(`Error: ${e.message}`));
          }
          
          functionResponseParts.push({
            type: "tool-result",
            toolCallId: toolCall.toolCallId,
            toolName: toolId,
            isError: true,
            result: e.message
          });
        }
      }

      if (functionResponseParts.length > 0) {
        messagesCopy.push({
          role: "tool",
          content: functionResponseParts,
        });
        await fs.writeFile(path.join(sessionDir, "history.json"), JSON.stringify(messagesCopy, null, 2));
      }
    }

    return {
      messages: messagesCopy,
      finalOutput: finalOutputBuffer,
      tokens: {
        prompt: this.totalPromptTokens,
        candidates: this.totalCandidatesTokens,
        total: this.totalTokens
      }
    };
  }
}

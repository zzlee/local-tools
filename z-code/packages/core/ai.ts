import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import ora from "ora";
import chalk from "chalk";
import { ToolRegistry } from "../tools/registry.js";
import { ToolContext } from "../tools/index.js";
import { CliOptions } from "./cli.js";

export class AiClient {
  private ai: GoogleGenAI;
  private modelName: string;
  private totalPromptTokens = 0;
  private totalCandidatesTokens = 0;
  private totalTokens = 0;

  constructor(apiKey: string, modelName: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async generateResponse(
    messages: any[], 
    systemPrompt: string, 
    tools: any[], 
    options: CliOptions,
    ctx: ToolContext,
    sessionDir: string,
    registry: ToolRegistry,
    onFinalOutput: (text: string) => void
  ) {
    let finalOutputBuffer = "";
    let messagesCopy = [...messages];

    while (true) {
      let response;
      let retries = 0;
      const maxRetries = 3;

      while (true) {
        let thinkingSpinner;
        try {
          if (options.verbosity === 0 || options.verbosity >= 2) {
            thinkingSpinner = ora("Thinking...").start();
          }
          
          response = await this.ai.models.generateContent({
            model: this.modelName,
            contents: messagesCopy,
            config: {
              tools: tools,
              systemInstruction: { parts: [{ text: systemPrompt }] }
            }
          });

          if (thinkingSpinner) thinkingSpinner.stop();
          
          if (response.usageMetadata) {
            this.totalPromptTokens += response.usageMetadata.promptTokenCount || 0;
            this.totalCandidatesTokens += response.usageMetadata.candidatesTokenCount || 0;
            this.totalTokens += response.usageMetadata.totalTokenCount || 0;
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

      const message = response.candidates![0].content!;
      messagesCopy.push(message);
      await fs.writeFile(path.join(sessionDir, "history.json"), JSON.stringify(messagesCopy, null, 2));

      const toolCalls = response.functionCalls || [];

      for (const part of message.parts || []) {
        if (part.text) {
          if (toolCalls.length === 0 && !part.thought) {
            finalOutputBuffer += part.text + "\n";
            onFinalOutput(part.text);
          }
          if (part.thought) {
            if (options.verbosity > 0) {
              console.log(chalk.gray(part.text));
            }
          } else if (toolCalls.length > 0) {
            console.log(chalk.yellow(part.text));
          } else {
            console.log(part.text);
          }
        }
      }

      if (!toolCalls || toolCalls.length === 0) {
        break;
      }

      const functionResponseParts: any[] = [];

      for (const toolCall of toolCalls) {
        const toolId = toolCall.name!;
        const args = toolCall.args || {};
        
        const spinner = ora(`Executing ${chalk.cyan(toolId)}...`).start();
        try {
          const result = await registry.execute(toolId, args as any, ctx);
          if (spinner) spinner.succeed(`Executed ${chalk.cyan(toolId)}`);
          if (options.verbosity > 1) {
            console.log(chalk.blue(`${result.output.substring(0, 500)}${result.output.length > 500 ? "..." : ""}`));
          }
          
          functionResponseParts.push({
            functionResponse: {
              name: toolId,
              response: { output: result.output }
            }
          });
        } catch (e: any) {
          if (spinner) spinner.fail(`Error executing ${chalk.cyan(toolId)}`);
          if (options.verbosity > 1) {
            console.log(chalk.red(`Error: ${e.message}`));
          }
          
          functionResponseParts.push({
            functionResponse: {
              name: toolId,
              response: { error: e.message }
            }
          });
        }
      }

      if (functionResponseParts.length > 0) {
        messagesCopy.push({
          role: "user",
          parts: functionResponseParts,
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

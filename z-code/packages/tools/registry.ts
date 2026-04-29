import z from "zod";
import type { ChildProcess } from "node:child_process";
import type { ToolDef, ToolContext, ExecuteResult, Metadata } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  private children = new Set<ChildProcess>();

  register(tool: ToolDef) {
    this.tools.set(tool.id, tool);
  }

  registerChild(child: ChildProcess) {
    this.children.add(child);
  }

  unregisterChild(child: ChildProcess) {
    this.children.delete(child);
  }

  async killAllChildren() {
    const kills = Array.from(this.children).map(child => {
      return new Promise<void>((resolve) => {
        child.kill("SIGKILL");
        child.on("exit", resolve);
      });
    });
    await Promise.all(kills);
    this.children.clear();
  }

  async execute<M extends Metadata>(
    id: string,
    args: any,
    ctx: ToolContext
  ): Promise<ExecuteResult<M>> {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new Error(`Tool ${id} not found`);
    }

    try {
      const parsedArgs = tool.parameters.parse(args);
      return await tool.execute(parsedArgs, ctx) as ExecuteResult<M>;
    } catch (error) {
      if (error instanceof z.ZodError) {
        if (tool.formatValidationError) {
          throw new Error(tool.formatValidationError(error));
        }
        throw new Error(
          `The ${id} tool was called with invalid arguments: ${error.message}. Please rewrite the input so it satisfies the expected schema.`
        );
      }
      throw error;
    }
  }

  getTool(id: string) {
    return this.tools.get(id);
  }

  listTools() {
    return Array.from(this.tools.values()).map(t => ({
      id: t.id,
      description: t.description,
      parameters: t.parameters
    }));
  }
}

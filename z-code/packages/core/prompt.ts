import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { CliOptions } from "./cli.js";
import { ToolRegistry } from "../tools/registry.js";

export interface Prompt {
  metadata: any;
  body: string;
}

export interface Skill {
  name: string;
  description?: string;
  body: string;
}

export function resolvePromptPath(promptPath: string, baseDir: string): string {
  if (promptPath.startsWith("/") || path.isAbsolute(promptPath)) {
    return promptPath;
  }
  return path.join(baseDir, promptPath);
}

export async function loadPrompt(filePath: string): Promise<Prompt> {
  const content = await fs.readFile(filePath, "utf8");
  const match = content.match(/^---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: content };
  }
  const metadata = yaml.load(match[1]) as any;
  const body = match[2].trim();
  return { metadata, body };
}

export async function loadSkill(skillPathOrName: string): Promise<Skill> {
  let skillFilePath = skillPathOrName;
  if (!path.isAbsolute(skillPathOrName)) {
    const localSkillPath = path.join(process.cwd(), "skills", skillPathOrName, "SKILL.md");
    try {
      await fs.access(localSkillPath);
      skillFilePath = localSkillPath;
    } catch {
      skillFilePath = path.resolve(process.cwd(), skillPathOrName);
      try {
        const stats = await fs.stat(skillFilePath);
        if (stats.isDirectory()) {
          skillFilePath = path.join(skillFilePath, "SKILL.md");
        }
      } catch {
        // Fallback
      }
    }
  } else {
    try {
      const stats = await fs.stat(skillFilePath);
      if (stats.isDirectory()) {
        skillFilePath = path.join(skillFilePath, "SKILL.md");
      }
    } catch {
      // Fallback
    }
  }

  try {
    const { metadata, body } = await loadPrompt(skillFilePath);
    return { name: metadata.name || skillPathOrName, description: metadata.description, body };
  } catch (e: any) {
    throw new Error(`Failed to load skill '${skillPathOrName}': ${e.message}`);
  }
}

export async function loadAgentsMd(): Promise<string> {
  try {
    const agentsMdPath = path.join(process.cwd(), "AGENTS.md");
    await fs.access(agentsMdPath);
    const content = await fs.readFile(agentsMdPath, "utf8");
    return `\n\n## Project-Specific Information (AGENTS.md)\n\n${content}`;
  } catch {
    return "";
  }
}

export function expandTemplate(content: string, args: string[], argumentsDef: any[] = []) {
  let expanded = content;
  if (argumentsDef && argumentsDef.length > 0) {
    for (let i = 0; i < argumentsDef.length; i++) {
      const argName = argumentsDef[i].name;
      const argValue = args[i] || "";
      expanded = expanded.replaceAll(`{{${argName}}}`, argValue);
    }
  } else {
    for (let i = 0; i < args.length; i++) {
      expanded = expanded.replaceAll(`{{arg${i}}}`, args[i]);
    }
  }
  return expanded;
}

export async function assembleSystemPrompt(
  options: CliOptions,
  registry: ToolRegistry,
  basePrompt: Prompt,
  agentArgs: string[] = [],
  allowedTools: string[] | null = null
): Promise<string> {
  const agentsMdContent = await loadAgentsMd();
  
  const activeTools = registry.listTools().filter(t => {
    if (!allowedTools) return true;
    if (allowedTools.includes('*')) return true;
    return allowedTools.includes(t.id);
  });

  const toolDescriptions = activeTools
    .map(t => `${t.id}: ${t.description}`)
    .join("\n");
  const toolsSection = toolDescriptions ? `\n\nAvailable Tools:\n${toolDescriptions}` : "";

  let skillsSection = "";
  if (options.skills && options.skills.length > 0) {
    skillsSection += "\n\n<skills>\n";
    for (const skillName of options.skills) {
      const skill = await loadSkill(skillName);
      skillsSection += `  <skill name="${skill.name}">\n`;
      if (skill.description) {
        skillsSection += `    <description>${skill.description}</description>\n`;
      }
      skillsSection += `    <instructions>\n${skill.body}\n    </instructions>\n`;
      skillsSection += `  </skill>\n`;
    }
    skillsSection += "</skills>\n";
  }

  return `${expandTemplate(basePrompt.body, agentArgs, basePrompt.metadata.arguments)}${agentsMdContent}${toolsSection}${skillsSection}`;
}

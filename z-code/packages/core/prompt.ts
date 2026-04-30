import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
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
  const candidates: string[] = [];

  if (path.isAbsolute(skillPathOrName)) {
    candidates.push(skillPathOrName);
  } else {
    // 1. Local Project: skills/<name>/SKILL.md
    candidates.push(path.join(process.cwd(), "skills", skillPathOrName));
    // 2. Local Project: <name>/SKILL.md
    candidates.push(path.join(process.cwd(), skillPathOrName));
    // 3. Global Config: ~/.config/z-code/skills/<name>/SKILL.md
    candidates.push(path.join(os.homedir(), ".config", "z-code", "skills", skillPathOrName));
  }

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        const skillFile = path.join(candidate, "SKILL.md");
        try {
          await fs.access(skillFile);
          const { metadata, body } = await loadPrompt(skillFile);
          return { name: metadata.name || skillPathOrName, description: metadata.description, body };
        } catch {
          // Directory exists but SKILL.md doesn't
        }
      } else if (stats.isFile()) {
        const { metadata, body } = await loadPrompt(candidate);
        return { name: metadata.name || skillPathOrName, description: metadata.description, body };
      }
    } catch {
      // Candidate path doesn't exist
    }
  }

  throw new Error(
    `Failed to locate skill '${skillPathOrName}'. Checked paths:\n` +
    candidates.map(c => `- ${c}`).join("\n")
  );
}

export async function listSkills(): Promise<Skill[]> {
  const searchDirs = [
    path.join(process.cwd(), "skills"),
    path.join(os.homedir(), ".config", "z-code", "skills"),
  ];

  const skillsMap = new Map<string, Skill>();

  for (const dir of searchDirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        try {
          const skill = await loadSkill(entry);
          skillsMap.set(skill.name, skill);
        } catch {
          // Skip entries that aren't valid skills
        }
      }
    } catch {
      // Skip directories that don't exist
    }
  }

  return Array.from(skillsMap.values());
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
    const toolsList = Array.isArray(allowedTools) ? allowedTools : [allowedTools];
    if (toolsList.includes('*')) return true;
    return toolsList.includes(t.id);
  });

  const toolDescriptions = activeTools
    .map(t => `${t.id}: ${t.description}`)
    .join("\n");
  const toolsSection = toolDescriptions ? `\n\nAvailable Tools:\n${toolDescriptions}` : "";

  let skillsSection = "";
  if (options.skills && options.skills.length > 0) {
    skillsSection += "\n\n<skills>\n";
    skillsSection += "Use the `load_skill` tool to retrieve full instructions for a specific skill if you need them.\n";
    for (const skillName of options.skills) {
      const skill = await loadSkill(skillName);
      skillsSection += `  <skill name="${skill.name}">\n`;
      if (skill.description) {
        skillsSection += `    <description>${skill.description}</description>\n`;
      }
      skillsSection += `  </skill>\n`;
    }
    skillsSection += "</skills>\n";
  }

  return `${expandTemplate(basePrompt.body, agentArgs, basePrompt.metadata.arguments)}${agentsMdContent}${toolsSection}${skillsSection}`;
}

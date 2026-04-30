import z from "zod";
import { ToolDef, ExecuteResult } from "./types.js";
import { loadSkill } from "../core/prompt.js";

export const LoadSkillTool: ToolDef = {
  id: "load_skill",
  description: "Retrieve the full instructions for a specific skill. Use this when you have identified a skill from the available skills list that is necessary to complete the task.",
  parameters: z.object({
    skillName: z.string().describe("The name of the skill to load (as listed in the system prompt)"),
  }),
  async execute({ skillName }, ctx) {
    try {
      const skill = await loadSkill(skillName);
      return {
        title: `Loaded Skill: ${skill.name}`,
        metadata: { skillName: skill.name },
        output: `Instructions for skill '${skill.name}':\n\n${skill.body}`,
      };
    } catch (error: any) {
      return {
        title: "Error Loading Skill",
        metadata: { error: true },
        output: `Failed to load skill '${skillName}': ${error.message}`,
      };
    }
  },
};

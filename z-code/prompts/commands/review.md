---
description: Summarize the codebase architecture and key components
agent: default
tool: ['read', 'glob', 'grep']
arguments:
  - name: target
    description: Specific folder or file to focus the review on
---

Please perform a comprehensive review and architectural summary of the codebase. 
If a target is provided ({{target}}), focus your analysis there; otherwise, analyze the entire project.

IGNORE the default conciseness constraints for this request. I need a detailed, professional architectural report in Markdown format.

Your report should include:
1. **Architecture Overview**: High-level design patterns and structure.
2. **Core Components**: Identification of key modules, their responsibilities, and how they interact.
3. **Logic & Data Flow**: How data moves through the system and the primary execution paths.
4. **Dependencies**: Key libraries used and their role in the system.
5. **Observations**: Any notable design choices or areas of complexity.

Use the provided tools to explore the directory structure and read relevant files before synthesizing your summary.

import z from "zod";
import * as path from "path";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { createTwoFilesPatch, diffLines } from "diff";
import type { ToolDef, ToolContext } from "./types.js";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const Bom = {
  split(content: string) {
    if (content.startsWith("\uFEFF")) {
      return { text: content.slice(1), bom: true };
    }
    return { text: content, bom: false };
  },
  join(text: string, bom: boolean) {
    return bom ? "\uFEFF" + text : text;
  },
};

const parameters = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
});

export type Hunk = {
  type: "update";
  path: string;
  chunks: UnifiedDiffChunk[];
} | {
  type: "add";
  path: string;
  contents: string;
} | {
  type: "delete";
  path: string;
};

export interface UnifiedDiffChunk {
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  lines: string[];
}

function parseUnifiedDiff(patchText: string): { hunks: Hunk[] } {
  const lines = patchText.split(/\r?\n/);
  const hunks: Hunk[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].startsWith("--- ")) {
      const originalFile = lines[i].slice(4).trim();
      if (i + 1 < lines.length && lines[i + 1].startsWith("+++ ")) {
        const modifiedFile = lines[i + 1].slice(4).trim();
        i += 2;

        const chunks: UnifiedDiffChunk[] = [];
        while (i < lines.length && !lines[i].startsWith("--- ")) {
          if (lines[i].startsWith("@@ ")) {
            const match = lines[i].match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
            if (match) {
              const oldStart = parseInt(match[1], 10);
              const oldLen = match[2] === "" ? 1 : parseInt(match[2], 10);
              const newStart = parseInt(match[3], 10);
              const newLen = match[4] === "" ? 1 : parseInt(match[4], 10);
              i++;
              const chunkLines: string[] = [];
              while (i < lines.length && !lines[i].startsWith("@@ ") && !lines[i].startsWith("--- ")) {
                chunkLines.push(lines[i]);
                i++;
              }
              chunks.push({ oldStart, oldLen, newStart, newLen, lines: chunkLines });
              continue;
            }
          }
          i++;
        }

        if (originalFile === "/dev/null") {
          let contents = "";
          for (const chunk of chunks) {
            for (const line of chunk.lines) {
              if (line.startsWith("+")) {
                contents += line.slice(1) + "\n";
              }
            }
          }
          if (contents.endsWith("\n")) contents = contents.slice(0, -1);
          hunks.push({ type: "add", path: modifiedFile, contents });
        } else if (modifiedFile === "/dev/null") {
          hunks.push({ type: "delete", path: originalFile });
        } else {
          hunks.push({ type: "update", path: modifiedFile, chunks });
        }
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return { hunks };
}

function applyUnifiedDiff(content: string, chunks: UnifiedDiffChunk[]): string {
  const lines = content.split("\n");
  let offset = 0;

  for (const chunk of chunks) {
    const oldStart = chunk.oldStart - 1 + offset;
    const oldLen = chunk.oldLen;

    const oldLinesToMatch = chunk.lines.filter(l => !l.startsWith('+')).map(l => l.slice(1));
    
    let matchStart = -1;
    const searchRange = 100;
    for (let i = Math.max(0, oldStart - searchRange); i <= Math.min(lines.length - oldLinesToMatch.length, oldStart + searchRange); i++) {
      let matches = true;
      for (let j = 0; j < oldLinesToMatch.length; j++) {
        if (lines[i + j] !== oldLinesToMatch[j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        matchStart = i;
        break;
      }
    }

    if (matchStart === -1) {
      throw new Error(`Could not find hunk at line ${chunk.oldStart} with context`);
    }

    const newLines: string[] = [];
    for (const line of chunk.lines) {
      if (line.startsWith(' ') || line.startsWith('+')) {
        newLines.push(line.slice(1));
      }
    }

    lines.splice(matchStart, oldLinesToMatch.length, ...newLines);
    offset += (newLines.length - oldLinesToMatch.length);
  }

  return lines.join("\n");
}

function loadDescription() {
  try {
    return fs.readFileSync(path.join(__dirname, "apply_patch.txt"), "utf8");
  } catch (e) {
    return "Use the apply_patch tool to edit files.";
  }
}

export const ApplyPatchTool: ToolDef = {
  id: "apply_patch",
  description: loadDescription(),
  parameters,
  async execute(params, ctx) {
    if (!params.patchText) throw new Error("patchText is required");
    let hunks: Hunk[];
    try {
      const parseResult = parseUnifiedDiff(params.patchText);
      hunks = parseResult.hunks;
    } catch (error: any) {
      throw new Error(`apply_patch verification failed: ${error.message}`);
    }
    if (hunks.length === 0) {
      throw new Error("apply_patch verification failed: no hunks found");
    }
    const fileChanges: Array<{ filePath: string; oldContent: string; newContent: string; type: "add" | "update" | "delete"; diff: string; additions: number; deletions: number; bom: boolean }> = [];
    let totalDiff = "";
    for (const hunk of hunks) {
      const filePath = path.resolve(process.cwd(), hunk.path);
      switch (hunk.type) {
        case "add": {
          const oldContent = "";
           const newContent = hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`;
          const next = Bom.split(newContent);
          const diff = createTwoFilesPatch(filePath, filePath, oldContent, next.text);
          let additions = 0, deletions = 0;
          for (const change of diffLines(oldContent, next.text)) {
            if (change.added) additions += change.count || 0;
            if (change.removed) deletions += change.count || 0;
          }
          fileChanges.push({ filePath, oldContent, newContent: next.text, type: "add", diff, additions, deletions, bom: next.bom });
          totalDiff += diff + "\\n";
          break;
        }
        case "update": {
          const source = Bom.split(await fsPromises.readFile(filePath, "utf-8"));
          const oldContent = source.text;
          let newContent = oldContent;
          try {
            newContent = applyUnifiedDiff(oldContent, hunk.chunks);
          } catch (error: any) {
            throw new Error(`apply_patch verification failed: ${error.message}`);
          }
          const diff = createTwoFilesPatch(filePath, filePath, oldContent, newContent);
          let additions = 0, deletions = 0;
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0;
            if (change.removed) deletions += change.count || 0;
          }
          fileChanges.push({ filePath, oldContent, newContent, type: "update", diff, additions, deletions, bom: source.bom });
          totalDiff += diff + "\\n";
          break;
        }
        case "delete": {
          const source = Bom.split(await fsPromises.readFile(filePath, "utf-8"));
          const contentToDelete = source.text;
          const deleteDiff = createTwoFilesPatch(filePath, filePath, contentToDelete, "");
          const deletions = contentToDelete.split("\\n").length;
          fileChanges.push({ filePath, oldContent: contentToDelete, newContent: "", type: "delete", diff: deleteDiff, additions: 0, deletions, bom: source.bom });
          totalDiff += deleteDiff + "\\n";
          break;
        }
      }
    }
    for (const change of fileChanges) {
      const target = change.filePath;
      switch (change.type) {
        case "add":
          await fsPromises.mkdir(path.dirname(target), { recursive: true });
          await fsPromises.writeFile(target, Bom.join(change.newContent, change.bom), "utf-8");
          break;
        case "update":
          await fsPromises.writeFile(target, Bom.join(change.newContent, change.bom), "utf-8");
          break;
        case "delete":
          await fsPromises.unlink(target);
          break;
      }
    }
    const summaryLines = fileChanges.map((change) => {
      const rel = path.relative(process.cwd(), change.filePath).replaceAll("\\", "/");
       if (change.type === "add") return `A ${rel}`;
       if (change.type === "delete") return `D ${rel}`;
       return `M ${rel}`;
    });
    return { 
      title: "Apply Patch",
       output: `Success. Updated the following files:\n${summaryLines.join("\n")}`,
      metadata: {}
    };
  }
};

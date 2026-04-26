The current state reveals a significant discrepancy between the `apply_patch` implementations of `opencode` and `z-code`. 

*   **`opencode` (`~/opencode/packages/opencode/src/tool/apply_patch.ts` & `~/opencode/packages/opencode/src/patch/index.ts`)**: Implements a custom, high-level "envelope" patch format (`*** Begin Patch` / `*** End Patch`). It supports complex operations including file additions, deletions, in-place updates, and file renaming (moves). It features a robust context-seeking algorithm for applying updates and integrates with a system-wide Bus and LSP for diagnostics.
*   **`z-code` (`/home/zzlee/local-tools/z-code/packages/tools/apply_patch.ts`)**: Implements a standard Unified Diff parser. The logic is simpler, lacking support for file moves and integration with external services like LSP. It uses `zod` for parameter validation and `node:fs/promises` for I/O.

The migration requires replacing the Unified Diff logic in `z-code` with the custom patch logic from `opencode`, while adapting the functional `Effect`-based implementation of `opencode` to the `async/await` pattern used in `z-code`.

## 🛠️ Core Implementation Logic

The migrated tool will shift from parsing standard diffs to parsing a structured command-based patch format.

1.  **Parsing Flow**:
    *   Strip heredocs from the input text.
    *   Locate `*** Begin Patch` and `*** End Patch` markers.
    *   Iterate through the content to identify headers: `*** Add File`, `*** Delete File`, and `*** Update File`.
    *   For updates, parse "chunks" consisting of a context line (`@@`) followed by added (`+`), removed (`-`), or unchanged (` `) lines.
    *   For updates, identify optional `*** Move to` directives.

2.  **Content Derivation Logic**:
    *   Instead of simple line splicing, the system will use a "seek sequence" approach.
    *   It will attempt to match the expected "old lines" of a chunk in the target file using multiple passes: exact match $\rightarrow$ rstrip match $\rightarrow$ trim match $\rightarrow$ normalized Unicode match.
    *   This ensures higher resilience to whitespace or encoding differences.

3.  **Execution Flow**:
    *   **Add**: Create parent directories recursively and write the new content.
    *   **Update**: Derive new content using the seek-sequence logic and overwrite the file.
    *   **Move**: Derive new content, write to the destination path, and unlink the source path.
    *   **Delete**: Unlink the target file.

## 📋 Detailed Development Plan

### 1. Documentation Update
**File**: `/home/zzlee/local-tools/z-code/packages/tools/apply_patch.txt`
*   Replace current Unified Diff instructions with the content from `~/opencode/packages/opencode/src/tool/apply_patch.txt`.
*   Clearly define the `*** Begin Patch` / `*** End Patch` envelope and the three supported headers (`Add File`, `Delete File`, `Update File`).

### 2. Type and Interface Migration
**File**: `/home/zzlee/local-tools/z-code/packages/tools/apply_patch.ts`
*   Remove `UnifiedDiffChunk` interface.
*   Implement `Hunk` and `UpdateFileChunk` types based on `opencode/src/patch/index.ts:24-34`.

### 3. Parser and Logic Migration
**File**: `/home/zzlee/local-tools/z-code/packages/tools/apply_patch.ts`
*   **Remove**: `parseUnifiedDiff` and `applyUnifiedDiff` functions.
*   **Implement Helpers**: Migrate the following functions from `opencode/src/patch/index.ts`:
    *   `stripHeredoc`: To handle input wrapped in shell-style heredocs.
    *   `parsePatch`: The main entry point for parsing the custom format.
    *   `parsePatchHeader`, `parseUpdateFileChunks`, `parseAddFileContent`: Specialized parsers for the custom headers.
*   **Implement Content Derivation**: Migrate the core application logic:
    *   `deriveNewContentsFromChunks`: The main logic to calculate the new file state.
    *   `computeReplacements` & `applyReplacements`: The logic for managing multiple chunks within one file.
    *   `seekSequence`, `tryMatch`, `normalizeUnicode`: The resilient matching system.
    *   `generateUnifiedDiff`: To provide a diff summary of the change.

### 4. Tool Execution Update
**File**: `/home/zzlee/local-tools/z-code/packages/tools/apply_patch.ts`
*   **Parameter Validation**: Maintain the `zod` schema but ensure it aligns with the expected `patchText` input.
*   **Execution Logic**:
    *   Update the `execute` loop to handle the `Hunk` types (`add`, `update`, `delete`).
    *   Integrate the "Move" logic: if `hunk.move_path` is present during an `update`, perform a write-then-unlink operation.
    *   Update the summary generation to use the `A` (Added), `M` (Modified/Moved), and `D` (Deleted) prefixes for the output string.
    *   Utilize `fsPromises.mkdir(..., { recursive: true })` to ensure directory structures exist before writing.

## ⚠️ Potential Risks & Considerations

*   **Missing Dependencies**: `opencode` relies on a `Bus` and `LSP` service. Since `z-code` lacks these, these integrations will be omitted. The tool will perform the file operations but will not provide real-time LSP diagnostics in the final output.
*   **Working Directory**: `opencode` uses `Instance.directory` and `Instance.worktree`. In `z-code`, `process.cwd()` should be used as the base for path resolution, but this must be verified against how `z-code` handles multi-project environments.
*   **BOM Handling**: Both systems handle BOM, but ensure the `Bom` utility in `z-code` is functionally equivalent to the one in `opencode` to prevent corrupting files with non-UTF-8 signatures.


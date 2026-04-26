### 1. Triggering Mechanism
*   **Prefix Trigger**: Introduce a `/` prefix to distinguish custom commands from general queries.
*   **Behavior**: If the first positional argument starts with `/` (e.g., `z-code /refactor file.ts`), it will be treated as a custom command call.

### 2. Template Format (Markdown + YAML)
*   **File Extension**: Change command templates from `.txt` to `.md`.
*   **Structure**: Use YAML front matter to define metadata and argument mappings.
*   **Example Template** (`prompts/commands/refactor.md`):
    ```markdown
    ---
    description: Refactor code for better quality
    arguments:
      - name: filePath
        description: Path to the file
      - name: focus
        description: Specific area to improve
    ---
    Please refactor {{filePath}}, focusing on {{focus}}.
    ```

### 3. Implementation Details
*   **Dependencies**: Add `js-yaml` for parsing front matter.
*   **Logic Updates**:
    *   **Detection**: Update `main()` to detect the `/` prefix and strip it to find the command name.
    *   **Expansion**: Replace the index-based `{{0}}` logic with named expansion. Map positional arguments to the `arguments` list defined in the YAML front matter.
    *   **Listing**: Update `z-code command list` to parse and display the `description` from the YAML front matter.

### 4. Verification
*   Migrate existing `.txt` templates to `.md`.
*   Verify named argument expansion with various template configurations.
*   Confirm that `command list` correctly displays metadata.


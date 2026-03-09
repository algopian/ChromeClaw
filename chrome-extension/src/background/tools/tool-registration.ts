/**
 * Background-only tool registration types.
 *
 * Each tool file exports a `ToolImplRegistration` that pairs its configKey
 * with the tool entries (schema + execute). The central registry collects
 * these and the tools/index.ts iterates them.
 */

interface ToolContext {
  chatId?: string;
}

interface ToolEntry {
  /** LLM-facing tool name, e.g. 'web_search', 'create_document' */
  name: string;
  /** Tool description shown to the LLM */
  description: string;
  /** Input schema (TypeBox TSchema or compatible) */
  inputSchema: unknown;
  /** Execute function */
  execute: (args: unknown, context?: ToolContext) => Promise<unknown>;
  /** Exclude this tool when the given condition is active, e.g. 'headless' */
  excludeWhen?: string;
}

interface ToolImplRegistration {
  /** Matches ToolGroupMeta.groupKey (for organizational reference only) */
  configKey: string;
  /** Tool entries in this group */
  tools: ToolEntry[];
}

export type { ToolContext, ToolEntry, ToolImplRegistration };

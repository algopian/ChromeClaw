/**
 * Per-provider tool-calling strategies for web LLM providers.
 * Each strategy controls: tool prompt format, prompt assembly,
 * conversation ID extraction, and history serialization.
 */

import { buildToolPrompt as buildDefaultToolPrompt } from './tool-prompt';
import type { ToolDef } from './tool-prompt';
import type { WebProviderId } from './types';

interface SimpleMessage {
  role: string;
  content: string;
}

interface ContentPart {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface WebProviderToolStrategy {
  /** Build the tool prompt section. */
  buildToolPrompt(tools: ToolDef[]): string;

  /**
   * Build the final system prompt and messages to pass to the provider's buildRequest().
   * Strategy controls how system prompt, tool prompt, and messages are combined.
   */
  buildPrompt(opts: {
    systemPrompt: string;
    toolPrompt: string;
    messages: SimpleMessage[];
    conversationId?: string;
  }): { systemPrompt: string; messages: SimpleMessage[] };

  /** Extract conversation/session ID from SSE response data. */
  extractConversationId?(data: unknown): string | undefined;

  /** Serialize assistant message content parts to string for history. */
  serializeAssistantContent?(content: ContentPart[]): string;
}

// ── Conversation ID Cache ────────────────────────

const conversationIdCache = new Map<string, string>();

const getConversationId = (key: string): string | undefined => conversationIdCache.get(key);

const setConversationId = (key: string, id: string): void => {
  conversationIdCache.set(key, id);
};

// ── Default Strategy ─────────────────────────────
// For Claude, ChatGPT, Grok, GLM, Kimi, Doubao — delegates to existing XML tool prompt.

const defaultToolStrategy: WebProviderToolStrategy = {
  buildToolPrompt: tools => buildDefaultToolPrompt(tools),

  buildPrompt: ({ systemPrompt, toolPrompt, messages }) => ({
    systemPrompt: toolPrompt ? `${systemPrompt}\n\n${toolPrompt}` : systemPrompt,
    messages,
  }),
};

// ── Shared Markdown Tool Prompt ──────────────────
// Used by Qwen, DeepSeek, and Kimi strategies — markdown tool listing with XML call format.

const buildMarkdownToolPrompt = (tools: ToolDef[]): string => {
  if (tools.length === 0) return '';

  const toolDefs = tools
    .map(t => `#### ${t.name}\n${t.description}\nParameters: ${JSON.stringify(t.parameters)}`)
    .join('\n\n');

  return `## Tool Use Instructions
You are equipped with specialized tools to perform actions or retrieve information.
To use a tool, output a specific XML tag: <tool_call id="unique_id" name="tool_name">{"arg": "value"}</tool_call>.
Rules for tool use:
1. ALWAYS think before calling a tool. Explain your reasoning inside <think> tags.
2. The 'id' attribute should be a unique 8-character string for each call.
3. Wait for the tool result before proceeding with further analysis.

After a tool executes, the result will be provided as:
<tool_response id="call_id" name="tool_name">
result text
</tool_response>

### Available Tools
${toolDefs}`;
};

// ── Qwen Strategy ────────────────────────────────
// Matches zero-token's proven format with markdown tool listing, conversation ID
// reuse, and first-turn vs continuation prompt building.

const QWEN_TOOL_CALL_HINT =
  '\n\n[SYSTEM HINT]: Remember to use the XML format for tool calls: <tool_call id="unique_id" name="tool_name">{"arg": "value"}</tool_call>';

const qwenToolStrategy: WebProviderToolStrategy = {
  buildToolPrompt: buildMarkdownToolPrompt,

  buildPrompt: ({ systemPrompt, toolPrompt, messages, conversationId }) => {
    if (!conversationId) {
      // First turn: full history with role labels
      const parts: string[] = [];
      parts.push(`System: ${systemPrompt}${toolPrompt ? `\n\n${toolPrompt}` : ''}`);
      for (const m of messages) {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        parts.push(`${role}: ${m.content}`);
      }
      return {
        systemPrompt: '',
        messages: [{ role: 'user', content: parts.join('\n\n') }],
      };
    }

    // Continuation: send only the last message
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) {
      return { systemPrompt: '', messages: [{ role: 'user', content: '' }] };
    }

    // If last message contains tool_response, send just the response + hint
    if (lastMsg.content.includes('<tool_response')) {
      const content = `${lastMsg.content}\n\nPlease proceed based on this tool result.${toolPrompt ? QWEN_TOOL_CALL_HINT : ''}`;
      return {
        systemPrompt: '',
        messages: [{ role: 'user', content }],
      };
    }

    // Regular continuation: just the last user message + hint if tools present
    const content = `${lastMsg.content}${toolPrompt ? QWEN_TOOL_CALL_HINT : ''}`;
    return {
      systemPrompt: '',
      messages: [{ role: 'user', content }],
    };
  },

  extractConversationId: data => {
    const obj = data as Record<string, unknown>;
    return (obj.sessionId ?? obj.conversationId ?? obj.chat_id) as string | undefined;
  },

  serializeAssistantContent: content => {
    const parts: string[] = [];
    for (const c of content) {
      if (c.type === 'thinking' && c.thinking) {
        parts.push(`<think>\n${c.thinking}\n</think>\n`);
      }
      if (c.type === 'toolCall' && c.name) {
        parts.push(
          `<tool_call id="${c.id ?? ''}" name="${c.name}">${JSON.stringify(c.arguments ?? {})}</tool_call>`,
        );
      }
      if (c.type === 'text' && c.text) {
        parts.push(c.text);
      }
    }
    return parts.join('');
  },
};

// ── Kimi Strategy ───────────────────────────────
// Kimi uses Connect Protocol — stateless (no conversation ID), always aggregates full history.

const kimiToolStrategy: WebProviderToolStrategy = {
  buildToolPrompt: buildMarkdownToolPrompt,

  buildPrompt: ({ systemPrompt, toolPrompt, messages }) => {
    // Always aggregate — Kimi is stateless (no conversation ID)
    const parts: string[] = [];
    parts.push(`System: ${systemPrompt}${toolPrompt ? `\n\n${toolPrompt}` : ''}`);
    for (const m of messages) {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      parts.push(`${role}: ${m.content}`);
    }
    return {
      systemPrompt: '',
      messages: [{ role: 'user', content: parts.join('\n\n') }],
    };
  },

  serializeAssistantContent: content => {
    const parts: string[] = [];
    for (const c of content) {
      if (c.type === 'thinking' && c.thinking) parts.push(`<think>\n${c.thinking}\n</think>\n`);
      if (c.type === 'toolCall' && c.name) {
        parts.push(
          `<tool_call id="${c.id ?? ''}" name="${c.name}">${JSON.stringify(c.arguments ?? {})}</tool_call>`,
        );
      }
      if (c.type === 'text' && c.text) parts.push(c.text);
    }
    return parts.join('');
  },
};

// ── GLM Strategy ────────────────────────────────
// GLM uses conversation_id for stateful conversations. First turn aggregates
// full history; continuation sends only the last message with tool hint.

const GLM_TOOL_CALL_HINT =
  '\n\n[SYSTEM HINT]: Remember to use the XML format for tool calls: <tool_call id="unique_id" name="tool_name">{"arg": "value"}</tool_call>';

const glmToolStrategy: WebProviderToolStrategy = {
  buildToolPrompt: buildMarkdownToolPrompt,

  buildPrompt: ({ systemPrompt, toolPrompt, messages, conversationId }) => {
    if (!conversationId) {
      // First turn: aggregate all history with role labels into a single user message
      const parts: string[] = [];
      parts.push(`System: ${systemPrompt}${toolPrompt ? `\n\n${toolPrompt}` : ''}`);
      for (const m of messages) {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        parts.push(`${role}: ${m.content}`);
      }
      return {
        systemPrompt: '',
        messages: [{ role: 'user', content: parts.join('\n\n') }],
      };
    }

    // Continuation: send only the last message
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) {
      return { systemPrompt: '', messages: [{ role: 'user', content: '' }] };
    }

    // If last message contains tool_response, send just the response + hint
    if (lastMsg.content.includes('<tool_response')) {
      const content = `${lastMsg.content}\n\nPlease proceed based on this tool result.${toolPrompt ? GLM_TOOL_CALL_HINT : ''}`;
      return {
        systemPrompt: '',
        messages: [{ role: 'user', content }],
      };
    }

    // Regular continuation: just the last user message + hint if tools present
    const content = `${lastMsg.content}${toolPrompt ? GLM_TOOL_CALL_HINT : ''}`;
    return {
      systemPrompt: '',
      messages: [{ role: 'user', content }],
    };
  },

  extractConversationId: data => {
    const obj = data as Record<string, unknown>;
    return obj.conversation_id as string | undefined;
  },

  serializeAssistantContent: content => {
    const parts: string[] = [];
    for (const c of content) {
      if (c.type === 'thinking' && c.thinking) {
        parts.push(`<think>\n${c.thinking}\n</think>\n`);
      }
      if (c.type === 'toolCall' && c.name) {
        parts.push(
          `<tool_call id="${c.id ?? ''}" name="${c.name}">${JSON.stringify(c.arguments ?? {})}</tool_call>`,
        );
      }
      if (c.type === 'text' && c.text) {
        parts.push(c.text);
      }
    }
    return parts.join('');
  },
};

// ── Factory ──────────────────────────────────────

const getToolStrategy = (providerId: WebProviderId): WebProviderToolStrategy => {
  switch (providerId) {
    case 'qwen-web':
    case 'qwen-cn-web':
      return qwenToolStrategy;
    case 'kimi-web':
      return kimiToolStrategy;
    case 'glm-web':
    case 'glm-intl-web':
      return glmToolStrategy;
    default:
      return defaultToolStrategy;
  }
};

export {
  getToolStrategy,
  getConversationId,
  setConversationId,
  defaultToolStrategy,
  qwenToolStrategy,
  kimiToolStrategy,
  glmToolStrategy,
};
export type { WebProviderToolStrategy, SimpleMessage, ContentPart };

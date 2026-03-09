/**
 * StreamFn bridge: uses pi-ai's native streamSimple() to produce
 * AssistantMessageEventStream compatible with pi-agent's agent loop.
 *
 * streamSimple() natively handles provider routing, message conversion,
 * tool definitions, and event emission — no manual bridging needed.
 */

import { streamSimple, completeSimple, createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { chatModelToPiModel } from './model-adapter';
import { createLogger } from '../logging/logger-buffer';
import { requestLocalGeneration } from '../local-llm-bridge';
import type { Context, Model, SimpleStreamOptions, TextContent } from '@mariozechner/pi-ai';
import type { StreamFn } from '@mariozechner/pi-agent-core';
import type { ChatModel } from '@extension/shared';

const bridgeLog = createLogger('stream');

/**
 * Create a StreamFn using pi-mono's native streaming.
 * For cloud providers, streamSimple() already returns AssistantMessageEventStream.
 * For local models, routes to the offscreen document via local-llm-bridge.
 */
export const createStreamFn = (modelConfig: ChatModel): StreamFn => {
  if (modelConfig.provider === 'local') {
    return (_model: Model<any>, context: Context) => {
      try {
        // Convert pi-agent Context to simple message array for the offscreen worker.
        // Preserve tool-call and tool-result structure for Qwen3's chat template.
        const messages = context.messages.map(m => {
          if (m.role === 'toolResult') {
            // Format tool results as text for the model
            const resultText = (m.content ?? [])
              .filter(c => c.type === 'text')
              .map(c => (c as TextContent).text)
              .join('');
            return { role: 'user' as const, content: resultText };
          }
          if (m.role === 'assistant' && Array.isArray(m.content)) {
            // Preserve tool calls in assistant messages as <tool_call> tags
            const parts: string[] = [];
            for (const c of m.content) {
              if (c.type === 'text') parts.push((c as TextContent).text);
              else if (c.type === 'toolCall') {
                parts.push(
                  `<tool_call>\n${JSON.stringify({ name: c.name, arguments: c.arguments })}\n</tool_call>`,
                );
              }
            }
            return { role: 'assistant' as const, content: parts.join('') };
          }
          return {
            role: m.role as string,
            content:
              typeof m.content === 'string'
                ? m.content
                : (m.content ?? [])
                    .filter(c => c.type === 'text')
                    .map(c => (c as TextContent).text)
                    .join(''),
          };
        });

        // Convert pi-agent tool definitions to OpenAI function schema for apply_chat_template
        const tools = (context.tools ?? []).map(t => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));

        // Validate device preference — only pass recognized values
        const device =
          modelConfig.baseUrl === 'webgpu' || modelConfig.baseUrl === 'wasm'
            ? modelConfig.baseUrl
            : undefined;

        bridgeLog.trace('Local provider call', {
          modelId: modelConfig.id,
          device,
          messageCount: messages.length,
          toolCount: tools.length,
          systemPromptLength: (context.systemPrompt ?? '').length,
        });

        return requestLocalGeneration({
          modelId: modelConfig.id,
          messages,
          systemPrompt: context.systemPrompt ?? '',
          device,
          tools: tools.length > 0 ? tools : undefined,
          supportsReasoning: modelConfig.supportsReasoning,
        });
      } catch (err) {
        // Return an error stream instead of throwing — throwing causes the agent loop
        // to complete with an error that surfaces to the UI.
        console.error('[stream-bridge] Local LLM streamFn error:', err);
        const errorStream = createAssistantMessageEventStream();
        const errorMsg = err instanceof Error ? err.message : String(err);
        errorStream.push({
          type: 'error',
          reason: 'error',
          error: {
            role: 'assistant',
            content: [{ type: 'text', text: '' }],
            api: 'local-transformers',
            provider: 'local',
            model: modelConfig.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'error',
            errorMessage: `Local LLM error: ${errorMsg}`,
            timestamp: Date.now(),
          },
        });
        return errorStream;
      }
    };
  }

  const { model, apiKey } = chatModelToPiModel(modelConfig);

  return (_model: Model<any>, context: Context, options?: SimpleStreamOptions) => {
    bridgeLog.trace('Provider call', {
      modelId: model.id,
      provider: model.provider,
      api: model.api,
      baseUrl: model.baseUrl,
      hasApiKey: !!apiKey || !!options?.apiKey,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    });
    return streamSimple(model, context, { ...options, apiKey });
  };
};

/**
 * Non-streaming completion helper for summarizer/journal.
 * Not supported for local models — they only support streaming via the offscreen document.
 */
export const completeText = async (
  modelConfig: ChatModel,
  systemPrompt: string,
  userContent: string,
  opts?: { maxTokens?: number },
): Promise<string> => {
  if (modelConfig.provider === 'local') {
    throw new Error(
      'completeText is not supported for local models. Use streaming via createStreamFn instead.',
    );
  }

  const { model, apiKey } = chatModelToPiModel(modelConfig);
  const context: Context = {
    systemPrompt,
    messages: [{ role: 'user', content: userContent, timestamp: Date.now() }],
  };
  const result = await completeSimple(model, context, {
    maxTokens: opts?.maxTokens,
    apiKey,
  });
  return result.content
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('');
};

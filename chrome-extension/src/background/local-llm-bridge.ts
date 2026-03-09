/**
 * Local LLM Bridge — IPC between background service worker and offscreen document.
 * Returns an AssistantMessageEventStream so local models plug into the existing
 * agent loop without changes.
 *
 * Parses raw token stream from the worker for <think> and <tool_call> blocks,
 * emitting structured pi-ai events (thinking_delta, toolcall_start/end, text_delta).
 *
 * Follows the kokoro-bridge.ts pattern (requestId-based listener, settle guard, timeout).
 */

import { ensureOffscreenDocument } from './channels/offscreen-manager';
import { createAssistantMessageEventStream } from './agents';
import { createLogger } from './logging/logger-buffer';
import type { AssistantMessage, AssistantMessageEventStream, TextContent } from './agents';

const bridgeLog = createLogger('local-llm');

/** Default timeout for local generation (5 minutes). */
const LOCAL_LLM_TIMEOUT_MS = 300_000;

export const requestLocalGeneration = (opts: {
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  systemPrompt: string;
  maxTokens?: number;
  temperature?: number;
  device?: 'webgpu' | 'wasm';
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }>;
  supportsReasoning?: boolean;
}): AssistantMessageEventStream => {
  const stream = createAssistantMessageEventStream();
  const requestId = crypto.randomUUID();

  // Build a partial AssistantMessage that gets updated as tokens arrive
  const textContent: TextContent = { type: 'text', text: '' };
  const partial: AssistantMessage = {
    role: 'assistant',
    content: [textContent],
    api: 'local-transformers',
    provider: 'local',
    model: opts.modelId,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };

  let fullText = '';

  // State for parsing structured output from raw tokens
  let parseState: 'text' | 'thinking' | 'tool_call' = 'text';
  let tokenBuffer = '';
  let toolCallBuffer = '';
  let hasToolCalls = false;

  // Settle guard — prevents double-cleanup and event processing after stream is terminated
  let settled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    chrome.runtime.onMessage.removeListener(listener);
  };

  const emitError = (errorMsg: string) => {
    cleanup();
    bridgeLog.error('Generation error', { requestId, error: errorMsg });
    const errorMessage: AssistantMessage = {
      ...partial,
      stopReason: 'error',
      errorMessage: errorMsg,
    };
    stream.push({ type: 'error', reason: 'error', error: errorMessage });
  };

  // Timeout — prevents stream from hanging forever if offscreen document dies
  const timeout = setTimeout(() => {
    emitError(`Local generation timed out after ${LOCAL_LLM_TIMEOUT_MS / 1000}s`);
  }, LOCAL_LLM_TIMEOUT_MS);

  /** Process buffered tokens, parsing <think> and <tool_call> tags. */
  const processTokenBuffer = () => {
    while (tokenBuffer.length > 0) {
      if (parseState === 'text') {
        const thinkIdx = tokenBuffer.indexOf('<think>');
        const toolIdx = tokenBuffer.indexOf('<tool_call>');

        if (thinkIdx === 0) {
          parseState = 'thinking';
          tokenBuffer = tokenBuffer.slice(7); // len('<think>')
          stream.push({
            type: 'thinking_start',
            contentIndex: partial.content.length,
            partial,
          });
          partial.content.push({ type: 'thinking', thinking: '' });
          continue;
        }
        if (toolIdx === 0) {
          parseState = 'tool_call';
          tokenBuffer = tokenBuffer.slice(11); // len('<tool_call>')
          toolCallBuffer = '';
          continue;
        }

        // Partial tag at buffer start — wait for more tokens
        if (tokenBuffer.startsWith('<') && tokenBuffer.length < 12) break;

        // Emit text up to next tag (or all remaining)
        const nextTag = Math.min(
          thinkIdx >= 0 ? thinkIdx : Infinity,
          toolIdx >= 0 ? toolIdx : Infinity,
        );
        const chunk = nextTag === Infinity ? tokenBuffer : tokenBuffer.slice(0, nextTag);
        // Strip special tokens like <|im_end|>, <|im_start|>, etc.
        const cleaned = chunk.replace(/<\|[^|]+\|>/g, '');
        if (cleaned) {
          fullText += cleaned;
          textContent.text = fullText;
          stream.push({ type: 'text_delta', contentIndex: 0, delta: cleaned, partial });
        }
        tokenBuffer = nextTag === Infinity ? '' : tokenBuffer.slice(nextTag);
      } else if (parseState === 'thinking') {
        const end = tokenBuffer.indexOf('</think>');
        if (end >= 0) {
          const chunk = tokenBuffer.slice(0, end);
          if (chunk) {
            const tc = partial.content.find(c => c.type === 'thinking');
            if (tc && tc.type === 'thinking') tc.thinking += chunk;
            stream.push({
              type: 'thinking_delta',
              contentIndex: partial.content.length - 1,
              delta: chunk,
              partial,
            });
          }
          stream.push({
            type: 'thinking_end',
            contentIndex: partial.content.length - 1,
            content: '',
            partial,
          });
          tokenBuffer = tokenBuffer.slice(end + 8); // len('</think>')
          parseState = 'text';
        } else {
          // Stream thinking incrementally — emit what we have
          const tc = partial.content.find(c => c.type === 'thinking');
          if (tc && tc.type === 'thinking') tc.thinking += tokenBuffer;
          stream.push({
            type: 'thinking_delta',
            contentIndex: partial.content.length - 1,
            delta: tokenBuffer,
            partial,
          });
          tokenBuffer = '';
        }
      } else if (parseState === 'tool_call') {
        const end = tokenBuffer.indexOf('</tool_call>');
        if (end >= 0) {
          toolCallBuffer += tokenBuffer.slice(0, end);
          try {
            const parsed = JSON.parse(toolCallBuffer.trim());
            const toolCall = {
              type: 'toolCall' as const,
              id: crypto.randomUUID(),
              name: parsed.name,
              arguments:
                typeof parsed.arguments === 'string'
                  ? JSON.parse(parsed.arguments)
                  : parsed.arguments,
            };
            partial.content.push(toolCall);
            hasToolCalls = true;
            stream.push({
              type: 'toolcall_start',
              contentIndex: partial.content.length - 1,
              partial,
            });
            stream.push({
              type: 'toolcall_end',
              contentIndex: partial.content.length - 1,
              toolCall,
              partial,
            });
          } catch {
            // Malformed tool call JSON — emit as text
            fullText += toolCallBuffer;
            textContent.text = fullText;
            stream.push({
              type: 'text_delta',
              contentIndex: 0,
              delta: toolCallBuffer,
              partial,
            });
          }
          toolCallBuffer = '';
          tokenBuffer = tokenBuffer.slice(end + 12); // len('</tool_call>')
          parseState = 'text';
        } else {
          toolCallBuffer += tokenBuffer;
          tokenBuffer = '';
        }
      }
    }
  };

  const listener = (message: Record<string, unknown>) => {
    if (message.requestId !== requestId || settled) return;

    switch (message.type) {
      case 'LOCAL_LLM_TOKEN': {
        const token = message.token;
        if (typeof token !== 'string') return;
        tokenBuffer += token;
        processTokenBuffer();
        break;
      }

      case 'LOCAL_LLM_END': {
        const usage = message.usage as { inputTokens: number; outputTokens: number } | undefined;
        if (usage) {
          partial.usage = {
            input: usage.inputTokens,
            output: usage.outputTokens,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: usage.inputTokens + usage.outputTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
        }

        // Flush any remaining state based on parseState
        if (parseState === 'thinking') {
          // Close unclosed <think> block
          if (tokenBuffer.length > 0) {
            const tc = partial.content.find(c => c.type === 'thinking');
            if (tc && tc.type === 'thinking') tc.thinking += tokenBuffer;
            stream.push({
              type: 'thinking_delta',
              contentIndex: partial.content.length - 1,
              delta: tokenBuffer,
              partial,
            });
            tokenBuffer = '';
          }
          stream.push({
            type: 'thinking_end',
            contentIndex: partial.content.length - 1,
            content: '',
            partial,
          });
          parseState = 'text';
        } else if (parseState === 'tool_call') {
          // Flush incomplete tool_call buffer as text fallback
          toolCallBuffer += tokenBuffer;
          tokenBuffer = '';
          if (toolCallBuffer.length > 0) {
            fullText += toolCallBuffer;
            textContent.text = fullText;
            stream.push({ type: 'text_delta', contentIndex: 0, delta: toolCallBuffer, partial });
            toolCallBuffer = '';
          }
          parseState = 'text';
        } else if (tokenBuffer.length > 0) {
          // Force-flush: treat remaining buffer as text
          const cleaned = tokenBuffer.replace(/<\|[^|]+\|>/g, '');
          if (cleaned) {
            fullText += cleaned;
            textContent.text = fullText;
            stream.push({ type: 'text_delta', contentIndex: 0, delta: cleaned, partial });
          }
          tokenBuffer = '';
        }

        textContent.text = fullText;

        cleanup();
        stream.push({
          type: 'text_end',
          contentIndex: 0,
          content: fullText,
          partial,
        });
        stream.push({
          type: 'done',
          reason: hasToolCalls ? 'toolUse' : 'stop',
          message: partial,
        });
        bridgeLog.debug('Generation complete', {
          requestId,
          tokens: usage?.outputTokens,
          hasToolCalls,
        });
        break;
      }

      case 'LOCAL_LLM_ERROR': {
        const errorMsg =
          typeof message.error === 'string'
            ? message.error
            : String(message.error ?? 'Unknown error');
        emitError(errorMsg);
        break;
      }
    }
  };

  chrome.runtime.onMessage.addListener(listener);

  // Fire-and-forget: ensure offscreen document and send request
  ensureOffscreenDocument()
    .then(() => {
      if (settled) return;
      stream.push({ type: 'start', partial });
      stream.push({ type: 'text_start', contentIndex: 0, partial });

      chrome.runtime
        .sendMessage({
          type: 'LOCAL_LLM_GENERATE',
          requestId,
          modelId: opts.modelId,
          messages: opts.messages,
          systemPrompt: opts.systemPrompt,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          device: opts.device,
          tools: opts.tools,
          supportsReasoning: opts.supportsReasoning,
        })
        .then(response => {
          const resp = response as Record<string, unknown> | undefined;
          if (!resp || !resp.ok) {
            emitError(
              `Offscreen document rejected LOCAL_LLM_GENERATE: ${resp?.error ?? 'no response'}`,
            );
          }
        })
        .catch(err => {
          emitError(
            `Failed to send LOCAL_LLM_GENERATE: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

      bridgeLog.debug('Generation request sent', { requestId, modelId: opts.modelId });
    })
    .catch(err => {
      emitError(err instanceof Error ? err.message : String(err));
    });

  return stream;
};

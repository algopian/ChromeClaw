import { describe, it, expect } from 'vitest';
import type {
  LLMStreamChunk,
  LLMStreamEnd,
  LLMStreamError,
  LLMRequestMessage,
} from './chat-types';

describe('Streaming protocol message validation', () => {
  describe('LLMStreamChunk', () => {
    it('represents a text delta', () => {
      const chunk: LLMStreamChunk = {
        type: 'LLM_STREAM_CHUNK',
        chatId: 'chat-1',
        delta: 'Hello, ',
      };
      expect(chunk.type).toBe('LLM_STREAM_CHUNK');
      expect(chunk.delta).toBe('Hello, ');
      expect(chunk.reasoning).toBeUndefined();
      expect(chunk.toolCall).toBeUndefined();
    });

    it('represents a reasoning delta', () => {
      const chunk: LLMStreamChunk = {
        type: 'LLM_STREAM_CHUNK',
        chatId: 'chat-1',
        reasoning: 'Let me think...',
      };
      expect(chunk.reasoning).toBe('Let me think...');
      expect(chunk.delta).toBeUndefined();
    });

    it('represents a tool call', () => {
      const chunk: LLMStreamChunk = {
        type: 'LLM_STREAM_CHUNK',
        chatId: 'chat-1',
        toolCall: { id: 'tc-1', name: 'web_search', args: { city: 'SF' } },
        state: 'input-available',
      };
      expect(chunk.toolCall?.name).toBe('web_search');
      expect(chunk.state).toBe('input-available');
    });

    it('represents a tool result', () => {
      const chunk: LLMStreamChunk = {
        type: 'LLM_STREAM_CHUNK',
        chatId: 'chat-1',
        toolResult: { id: 'tc-1', result: { temperature: 72 } },
        state: 'output-available',
      };
      expect(chunk.toolResult?.id).toBe('tc-1');
      expect(chunk.state).toBe('output-available');
    });
  });

  describe('LLMStreamEnd', () => {
    it('includes finish reason and usage', () => {
      const end: LLMStreamEnd = {
        type: 'LLM_STREAM_END',
        chatId: 'chat-1',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
      expect(end.finishReason).toBe('stop');
      expect(end.usage?.totalTokens).toBe(150);
    });

    it('works without usage', () => {
      const end: LLMStreamEnd = {
        type: 'LLM_STREAM_END',
        chatId: 'chat-1',
        finishReason: 'length',
      };
      expect(end.usage).toBeUndefined();
    });
  });

  describe('LLMStreamError', () => {
    it('includes error message', () => {
      const error: LLMStreamError = {
        type: 'LLM_STREAM_ERROR',
        chatId: 'chat-1',
        error: 'Rate limit exceeded',
      };
      expect(error.error).toBe('Rate limit exceeded');
    });
  });

  describe('LLMRequestMessage', () => {
    it('includes all required fields for an LLM request', () => {
      const req: LLMRequestMessage = {
        type: 'LLM_REQUEST',
        chatId: 'chat-1',
        messages: [
          {
            id: 'msg-1',
            chatId: 'chat-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Hello' }],
            createdAt: Date.now(),
          },
        ],
        model: {
          id: 'gpt-4o',
          name: 'GPT-4o',
          provider: 'openai',
          routingMode: 'direct',
          apiKey: 'sk-test',
        },
        assistantMessageId: 'asst-msg-1',
      };
      expect(req.type).toBe('LLM_REQUEST');
      expect(req.messages).toHaveLength(1);
      expect(req.model.provider).toBe('openai');
      expect(req.assistantMessageId).toBe('asst-msg-1');
    });
  });
});

/**
 * Tests for use-llm-stream.ts — async onStreamComplete awaiting
 *
 * Verifies that handleEnd and handleError await onStreamComplete so that
 * IndexedDB persistence finishes before the callbacks return. This prevents
 * assistant messages from being lost on extension reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── React hooks mock ──────────────────────────────────────
// We mock React to run hooks outside a component. useCallback captures the raw
// functions so we can invoke handleEnd / handleError directly.

let useStateIndex = 0;
const stateSlots: Array<{ value: unknown; setter: (v: unknown) => void }> = [];
const capturedCallbacks: Array<(...args: any[]) => any> = [];
const capturedRefs: Array<{ current: any }> = [];

vi.mock('react', () => ({
  useState: (init: unknown) => {
    const idx = useStateIndex++;
    if (!stateSlots[idx]) {
      const slot: { value: unknown; setter: (v: unknown) => void } = {
        value: init,
        setter: () => {},
      };
      slot.setter = (update: unknown) => {
        slot.value = typeof update === 'function' ? (update as (prev: unknown) => unknown)(slot.value) : update;
      };
      stateSlots[idx] = slot;
    }
    return [stateSlots[idx].value, stateSlots[idx].setter];
  },
  useRef: (init: unknown) => {
    const ref = { current: init };
    capturedRefs.push(ref);
    return ref;
  },
  useCallback: (fn: (...args: any[]) => any, _deps: unknown[]) => {
    capturedCallbacks.push(fn);
    return fn;
  },
  useEffect: vi.fn(),
}));

// ── Chrome runtime mock ───────────────────────────────────

Object.defineProperty(globalThis, 'chrome', {
  value: {
    runtime: {
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
      })),
    },
  },
  writable: true,
  configurable: true,
});

// ── Import AFTER mocks ───────────────────────────────────

import { useLLMStream } from './use-llm-stream';
import type { ChatMessage } from '../chat-types.js';

// ── Fixtures ─────────────────────────────────────────────

const mockAssistantMessage: ChatMessage = {
  id: 'msg-1',
  chatId: 'test-chat',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Hello world' }],
  createdAt: Date.now(),
  model: 'test-model',
};

const mockModel = {
  id: 'test-model',
  name: 'Test Model',
  provider: 'openai' as const,
  routingMode: 'direct' as const,
};

// useCallback capture order inside useLLMStream:
// 0: updateAssistantPart  1: handleChunk  2: handleEnd  3: handleError  4: sendMessage  5: stop
const HANDLE_END_IDX = 2;
const HANDLE_ERROR_IDX = 3;

// useRef capture order: 0: portRef  1: abortedRef  2: assistantMessageRef  3: isFirstMessageRef
const ASSISTANT_MSG_REF_IDX = 2;

// ── Tests ────────────────────────────────────────────────

describe('useLLMStream — handleEnd awaits onStreamComplete', () => {
  beforeEach(() => {
    useStateIndex = 0;
    stateSlots.length = 0;
    capturedCallbacks.length = 0;
    capturedRefs.length = 0;
    vi.clearAllMocks();
  });

  it('returns a promise that resolves only after async onStreamComplete finishes', async () => {
    const order: string[] = [];
    const onStreamComplete = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push('persist-done');
    });

    useLLMStream({ chatId: 'test-chat', model: mockModel as any, onStreamComplete });

    const handleEnd = capturedCallbacks[HANDLE_END_IDX];
    capturedRefs[ASSISTANT_MSG_REF_IDX].current = mockAssistantMessage;

    const promise = handleEnd({
      type: 'LLM_STREAM_END',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    expect(promise).toBeInstanceOf(Promise);
    expect(order).not.toContain('persist-done');

    await promise;

    expect(order).toContain('persist-done');
    expect(onStreamComplete).toHaveBeenCalledWith(mockAssistantMessage, expect.anything());
  });

  it('passes usage with wasCompacted and contextUsage to onStreamComplete', async () => {
    const onStreamComplete = vi.fn(async () => {});

    useLLMStream({ chatId: 'test-chat', model: mockModel as any, onStreamComplete });

    const handleEnd = capturedCallbacks[HANDLE_END_IDX];
    capturedRefs[ASSISTANT_MSG_REF_IDX].current = mockAssistantMessage;

    await handleEnd({
      type: 'LLM_STREAM_END',
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50 },
      wasCompacted: true,
      contextUsage: { used: 1000, limit: 4096 },
    });

    expect(onStreamComplete).toHaveBeenCalledWith(mockAssistantMessage, {
      promptTokens: 100,
      completionTokens: 50,
      wasCompacted: true,
      contextUsage: { used: 1000, limit: 4096 },
    });
  });

  it('skips onStreamComplete when no assistant message exists', async () => {
    const onStreamComplete = vi.fn();

    useLLMStream({ chatId: 'test-chat', model: mockModel as any, onStreamComplete });

    const handleEnd = capturedCallbacks[HANDLE_END_IDX];
    // assistantMessageRef.current stays null (default)

    await handleEnd({ type: 'LLM_STREAM_END', finishReason: 'stop' });

    expect(onStreamComplete).not.toHaveBeenCalled();
  });

  it('works when onStreamComplete returns void (not a promise)', async () => {
    const onStreamComplete = vi.fn(); // returns undefined

    useLLMStream({ chatId: 'test-chat', model: mockModel as any, onStreamComplete });

    const handleEnd = capturedCallbacks[HANDLE_END_IDX];
    capturedRefs[ASSISTANT_MSG_REF_IDX].current = mockAssistantMessage;

    await handleEnd({
      type: 'LLM_STREAM_END',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    expect(onStreamComplete).toHaveBeenCalledOnce();
  });
});

describe('useLLMStream — handleError awaits onStreamComplete', () => {
  beforeEach(() => {
    useStateIndex = 0;
    stateSlots.length = 0;
    capturedCallbacks.length = 0;
    capturedRefs.length = 0;
    vi.clearAllMocks();
  });

  it('returns a promise that resolves only after async onStreamComplete finishes', async () => {
    const order: string[] = [];
    const onStreamComplete = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push('persist-done');
    });

    useLLMStream({ chatId: 'test-chat', model: mockModel as any, onStreamComplete });

    const handleError = capturedCallbacks[HANDLE_ERROR_IDX];
    capturedRefs[ASSISTANT_MSG_REF_IDX].current = mockAssistantMessage;

    const promise = handleError({ type: 'LLM_STREAM_ERROR', error: 'Test error' });

    expect(promise).toBeInstanceOf(Promise);
    expect(order).not.toContain('persist-done');

    await promise;

    expect(order).toContain('persist-done');
    expect(onStreamComplete).toHaveBeenCalledWith(mockAssistantMessage);
  });

  it('skips onStreamComplete when no assistant message exists', async () => {
    const onStreamComplete = vi.fn();

    useLLMStream({ chatId: 'test-chat', model: mockModel as any, onStreamComplete });

    const handleError = capturedCallbacks[HANDLE_ERROR_IDX];
    // assistantMessageRef.current stays null

    await handleError({ type: 'LLM_STREAM_ERROR', error: 'Some error' });

    expect(onStreamComplete).not.toHaveBeenCalled();
  });

  it('persists the partial message captured before the error text is appended', async () => {
    const onStreamComplete = vi.fn(async () => {});

    useLLMStream({ chatId: 'test-chat', model: mockModel as any, onStreamComplete });

    const handleError = capturedCallbacks[HANDLE_ERROR_IDX];
    capturedRefs[ASSISTANT_MSG_REF_IDX].current = mockAssistantMessage;

    await handleError({ type: 'LLM_STREAM_ERROR', error: 'Something broke' });

    // onStreamComplete receives the original message (without the error text appended)
    expect(onStreamComplete).toHaveBeenCalledWith(mockAssistantMessage);
    expect((onStreamComplete.mock.calls[0][0] as ChatMessage).parts).toEqual([
      { type: 'text', text: 'Hello world' },
    ]);
  });
});

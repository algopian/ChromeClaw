import { describe, it, expect } from 'vitest';
import {
  stripToolResultDetails,
  repairToolUseResultPairing,
  MAX_RESULT_CHARS,
  MAX_ARGS_CHARS,
} from './tool-result-sanitization';
import type { ChatMessage } from '@extension/shared';

const makeMessage = (role: 'user' | 'assistant', parts: ChatMessage['parts']): ChatMessage => ({
  id: 'msg-1',
  chatId: 'chat-1',
  role,
  parts,
  createdAt: Date.now(),
});

describe('stripToolResultDetails', () => {
  it('passes through messages without tool parts', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: 'hello' }]),
      makeMessage('assistant', [{ type: 'text', text: 'world' }]),
    ];
    const result = stripToolResultDetails(messages);
    expect(result).toEqual(messages);
  });

  it('truncates large tool-result values', () => {
    const largeResult = 'x'.repeat(2000);
    const messages = [
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'web_search',
          result: largeResult,
        },
      ]),
    ];
    const result = stripToolResultDetails(messages);
    const part = result[0]!.parts[0]! as { type: 'tool-result'; result: string };
    expect(part.result.length).toBeLessThan(largeResult.length);
    expect(part.result).toContain('truncated');
  });

  it('removes state field from tool-result parts', () => {
    const messages = [
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'test',
          result: 'ok',
          state: 'completed',
        } as any,
      ]),
    ];
    const result = stripToolResultDetails(messages);
    const part = result[0]!.parts[0]!;
    expect('state' in part).toBe(false);
    expect('details' in part).toBe(false);
  });

  it('truncates large tool-call args', () => {
    const largeArgs = { data: 'x'.repeat(2000) };
    const messages = [
      makeMessage('assistant', [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'test',
          args: largeArgs,
        },
      ]),
    ];
    const result = stripToolResultDetails(messages);
    const part = result[0]!.parts[0]! as { type: 'tool-call'; args: Record<string, unknown> };
    expect(part.args._truncated).toBeDefined();
  });

  it('is non-mutating', () => {
    const original = [
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'test',
          result: 'x'.repeat(2000),
        },
      ]),
    ];
    const originalPart = original[0]!.parts[0]! as { type: 'tool-result'; result: string };
    const originalResult = originalPart.result;

    stripToolResultDetails(original);

    // Original should be unchanged
    expect((original[0]!.parts[0]! as { type: 'tool-result'; result: string }).result).toBe(
      originalResult,
    );
  });

  it('preserves small tool results unchanged', () => {
    const messages = [
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'test',
          result: 'small result',
        },
      ]),
    ];
    const result = stripToolResultDetails(messages);
    expect((result[0]!.parts[0]! as any).result).toBe('small result');
  });
});

describe('repairToolUseResultPairing', () => {
  it('preserves paired tool-call and tool-result', () => {
    const messages = [
      makeMessage('assistant', [
        { type: 'tool-call', toolCallId: 'tc-1', toolName: 'test', args: {} },
      ]),
      makeMessage('assistant', [
        { type: 'tool-result', toolCallId: 'tc-1', toolName: 'test', result: 'ok' },
      ]),
    ];
    const result = repairToolUseResultPairing(messages);
    expect(result[1]!.parts).toHaveLength(1);
    expect(result[1]!.parts[0]!.type).toBe('tool-result');
  });

  it('removes orphaned tool-result parts', () => {
    const messages = [
      makeMessage('assistant', [
        { type: 'tool-result', toolCallId: 'tc-orphan', toolName: 'test', result: 'dangling' },
      ]),
    ];
    const result = repairToolUseResultPairing(messages);
    // Should have placeholder text instead of orphaned tool-result
    expect(result[0]!.parts[0]!.type).toBe('text');
  });

  it('keeps non-tool-result parts even when removing orphans', () => {
    const messages = [
      makeMessage('assistant', [
        { type: 'text', text: 'some context' },
        { type: 'tool-result', toolCallId: 'tc-orphan', toolName: 'test', result: 'orphaned' },
      ]),
    ];
    const result = repairToolUseResultPairing(messages);
    expect(result[0]!.parts).toHaveLength(1);
    expect(result[0]!.parts[0]!.type).toBe('text');
    expect((result[0]!.parts[0]! as any).text).toBe('some context');
  });

  it('passes through messages without tool-result parts', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: 'hello' }]),
      makeMessage('assistant', [{ type: 'text', text: 'world' }]),
    ];
    const result = repairToolUseResultPairing(messages);
    expect(result).toEqual(messages);
  });

  it('is non-mutating', () => {
    const messages = [
      makeMessage('assistant', [
        { type: 'tool-result', toolCallId: 'tc-orphan', toolName: 'test', result: 'dangling' },
      ]),
    ];
    const originalLength = messages[0]!.parts.length;
    repairToolUseResultPairing(messages);
    expect(messages[0]!.parts.length).toBe(originalLength);
  });
});

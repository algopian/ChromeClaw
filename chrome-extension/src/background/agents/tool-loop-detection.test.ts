import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectToolCallLoop,
  recordToolCall,
  createToolLoopState,
  stableJsonSerialize,
  hashToolCall,
} from './tool-loop-detection';
import type { ToolLoopConfig, ToolLoopState } from './tool-loop-detection';

const smallConfig: ToolLoopConfig = {
  enabled: true,
  warningThreshold: 3,
  criticalThreshold: 5,
  breakerThreshold: 7,
  pingPongThreshold: 4,
  maxTotalCalls: 15,
  windowSize: 20,
};

describe('tool-loop-detection', () => {
  let state: ToolLoopState;

  beforeEach(() => {
    state = createToolLoopState();
  });

  it('returns none for empty state', async () => {
    const result = await detectToolCallLoop(state, 'web_search', { query: 'hello' });
    expect(result.severity).toBe('none');
    expect(result.shouldBlock).toBe(false);
  });

  it('passes through when disabled', async () => {
    // Fill up state to trigger a breaker
    for (let i = 0; i < 40; i++) {
      await recordToolCall(state, 'test', { a: 1 }, smallConfig);
    }
    const result = await detectToolCallLoop(state, 'test', { a: 1 }, {
      ...smallConfig,
      enabled: false,
    });
    expect(result.severity).toBe('none');
    expect(result.shouldBlock).toBe(false);
  });

  it('triggers warning at warningThreshold', async () => {
    for (let i = 0; i < smallConfig.warningThreshold; i++) {
      await recordToolCall(state, 'web_search', { query: 'test' }, smallConfig);
    }
    const result = await detectToolCallLoop(state, 'web_search', { query: 'test' }, smallConfig);
    expect(result.severity).toBe('warning');
    expect(result.shouldBlock).toBe(false);
  });

  it('triggers critical at criticalThreshold', async () => {
    for (let i = 0; i < smallConfig.criticalThreshold; i++) {
      await recordToolCall(state, 'web_search', { query: 'test' }, smallConfig);
    }
    const result = await detectToolCallLoop(state, 'web_search', { query: 'test' }, smallConfig);
    expect(result.severity).toBe('critical');
    expect(result.shouldBlock).toBe(false);
  });

  it('triggers circuit breaker at breakerThreshold', async () => {
    for (let i = 0; i < smallConfig.breakerThreshold; i++) {
      await recordToolCall(state, 'web_search', { query: 'test' }, smallConfig);
    }
    const result = await detectToolCallLoop(state, 'web_search', { query: 'test' }, smallConfig);
    expect(result.severity).toBe('circuit_breaker');
    expect(result.shouldBlock).toBe(true);
  });

  it('triggers global circuit breaker at maxTotalCalls', async () => {
    // Record many different calls to hit global limit without repeat threshold
    for (let i = 0; i < smallConfig.maxTotalCalls; i++) {
      await recordToolCall(state, 'tool', { unique: i }, smallConfig);
    }
    const result = await detectToolCallLoop(state, 'tool', { unique: 999 }, smallConfig);
    expect(result.severity).toBe('circuit_breaker');
    expect(result.shouldBlock).toBe(true);
    expect(result.reason).toContain('Global circuit breaker');
  });

  it('detects ping-pong pattern', async () => {
    const config = { ...smallConfig, pingPongThreshold: 4 };
    // A-B-A-B pattern
    await recordToolCall(state, 'tool_a', { x: 1 }, config);
    await recordToolCall(state, 'tool_b', { y: 2 }, config);
    await recordToolCall(state, 'tool_a', { x: 1 }, config);
    await recordToolCall(state, 'tool_b', { y: 2 }, config);

    // Next call would be tool_a again — but detection looks at window
    const result = await detectToolCallLoop(state, 'tool_a', { x: 1 }, config);
    // The window has the alternating pattern
    expect(result.severity).toBe('warning');
    expect(result.reason).toContain('Ping-pong');
  });

  it('different args produce different hashes', async () => {
    const hash1 = await hashToolCall('web_search', { query: 'hello' });
    const hash2 = await hashToolCall('web_search', { query: 'world' });
    expect(hash1).not.toBe(hash2);
  });

  it('same args with different key order produce same hash', async () => {
    const hash1 = await hashToolCall('test', { a: 1, b: 2 });
    const hash2 = await hashToolCall('test', { b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it('trims entries to windowSize', async () => {
    const config = { ...smallConfig, windowSize: 5 };
    for (let i = 0; i < 10; i++) {
      await recordToolCall(state, 'tool', { i }, config);
    }
    expect(state.entries.length).toBe(5);
    expect(state.totalCalls).toBe(10);
  });

  it('does not count calls outside the sliding window', async () => {
    const config = { ...smallConfig, windowSize: 5, warningThreshold: 3 };
    // Fill window with one call type
    for (let i = 0; i < 3; i++) {
      await recordToolCall(state, 'old_tool', { q: 'old' }, config);
    }
    // Push them out of window with different calls
    for (let i = 0; i < 5; i++) {
      await recordToolCall(state, 'new_tool', { q: i }, config);
    }
    // Old calls should be evicted from window
    const result = await detectToolCallLoop(state, 'old_tool', { q: 'old' }, config);
    expect(result.severity).toBe('none');
  });
});

describe('stableJsonSerialize', () => {
  it('sorts object keys', () => {
    const a = stableJsonSerialize({ b: 2, a: 1 });
    const b = stableJsonSerialize({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('handles nested objects', () => {
    const result = stableJsonSerialize({ b: { d: 4, c: 3 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"c":3,"d":4}}');
  });

  it('handles arrays', () => {
    expect(stableJsonSerialize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles null and undefined', () => {
    expect(stableJsonSerialize(null)).toBe('null');
    expect(stableJsonSerialize(undefined)).toBe('null');
  });

  it('handles primitives', () => {
    expect(stableJsonSerialize('hello')).toBe('"hello"');
    expect(stableJsonSerialize(42)).toBe('42');
    expect(stableJsonSerialize(true)).toBe('true');
  });
});

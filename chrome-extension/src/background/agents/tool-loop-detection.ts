/**
 * Tool loop detection — detects and breaks infinite tool-call loops.
 *
 * Detection strategies:
 * 1. Generic repeat: same tool+args hash repeated ≥ thresholds → warning/critical/block
 * 2. Ping-pong: alternating A-B-A-B pattern ≥ 6 → warning
 * 3. Global circuit breaker: total calls ≥ maxTotalCalls → block
 */

interface ToolLoopConfig {
  enabled: boolean;
  /** Number of identical calls before warning. Default 10 */
  warningThreshold: number;
  /** Number of identical calls before critical. Default 20 */
  criticalThreshold: number;
  /** Number of identical calls before circuit breaker. Default 30 */
  breakerThreshold: number;
  /** Ping-pong pattern length to detect. Default 6 */
  pingPongThreshold: number;
  /** Maximum total tool calls per run. Default 30 */
  maxTotalCalls: number;
  /** Sliding window size. Default 30 */
  windowSize: number;
}

const DEFAULT_TOOL_LOOP_CONFIG: ToolLoopConfig = {
  enabled: true,
  warningThreshold: 10,
  criticalThreshold: 20,
  breakerThreshold: 30,
  pingPongThreshold: 6,
  maxTotalCalls: 30,
  windowSize: 30,
};

type LoopSeverity = 'none' | 'warning' | 'critical' | 'circuit_breaker';

interface LoopDetectionResult {
  severity: LoopSeverity;
  shouldBlock: boolean;
  reason?: string;
}

interface ToolCallEntry {
  hash: string;
  toolName: string;
}

interface ToolLoopState {
  entries: ToolCallEntry[];
  totalCalls: number;
}

const createToolLoopState = (): ToolLoopState => ({
  entries: [],
  totalCalls: 0,
});

/**
 * Produce a stable JSON string for hashing.
 * Sorts object keys recursively for deterministic output.
 */
const stableJsonSerialize = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableJsonSerialize).join(',') + ']';
  }
  const sorted = Object.keys(value as Record<string, unknown>).sort();
  const parts = sorted.map(k => JSON.stringify(k) + ':' + stableJsonSerialize((value as Record<string, unknown>)[k]));
  return '{' + parts.join(',') + '}';
};

/**
 * Hash a tool call for identity comparison.
 * Uses SHA-256 via Web Crypto API.
 */
const hashToolCall = async (toolName: string, params: unknown): Promise<string> => {
  const input = `${toolName}:${stableJsonSerialize(params)}`;
  const encoded = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Detect if the upcoming tool call would trigger a loop detection.
 * Does NOT modify state — call recordToolCall() after execution.
 */
const detectToolCallLoop = async (
  state: ToolLoopState,
  toolName: string,
  params: unknown,
  config: ToolLoopConfig = DEFAULT_TOOL_LOOP_CONFIG,
): Promise<LoopDetectionResult> => {
  if (!config.enabled) return { severity: 'none', shouldBlock: false };

  // Global circuit breaker
  if (state.totalCalls >= config.maxTotalCalls) {
    return {
      severity: 'circuit_breaker',
      shouldBlock: true,
      reason: `Global circuit breaker: ${state.totalCalls} total tool calls exceeded limit of ${config.maxTotalCalls}`,
    };
  }

  const hash = await hashToolCall(toolName, params);

  // Count occurrences of this exact call in the sliding window
  const window = state.entries.slice(-config.windowSize);
  const count = window.filter(e => e.hash === hash).length;

  // Generic repeat detection
  if (count >= config.breakerThreshold) {
    return {
      severity: 'circuit_breaker',
      shouldBlock: true,
      reason: `Tool ${toolName} called with same arguments ${count} times — circuit breaker triggered`,
    };
  }

  if (count >= config.criticalThreshold) {
    return {
      severity: 'critical',
      shouldBlock: false,
      reason: `Tool ${toolName} called with same arguments ${count} times — critical warning`,
    };
  }

  if (count >= config.warningThreshold) {
    return {
      severity: 'warning',
      shouldBlock: false,
      reason: `Tool ${toolName} called with same arguments ${count} times — warning`,
    };
  }

  // Ping-pong detection: A-B-A-B pattern
  if (window.length >= config.pingPongThreshold) {
    const recent = window.slice(-config.pingPongThreshold);
    const isAlternating = recent.every((entry, i) => entry.hash === recent[i % 2]!.hash);
    const hasTwoDistinct = recent[0]!.hash !== recent[1]!.hash;

    if (isAlternating && hasTwoDistinct) {
      return {
        severity: 'warning',
        shouldBlock: false,
        reason: `Ping-pong pattern detected: ${recent[0]!.toolName} ↔ ${recent[1]!.toolName}`,
      };
    }
  }

  return { severity: 'none', shouldBlock: false };
};

/**
 * Record a tool call in the state. Call after tool execution.
 */
const recordToolCall = async (
  state: ToolLoopState,
  toolName: string,
  params: unknown,
  config: ToolLoopConfig = DEFAULT_TOOL_LOOP_CONFIG,
): Promise<void> => {
  const hash = await hashToolCall(toolName, params);
  state.entries.push({ hash, toolName });
  state.totalCalls++;

  // Trim to window size
  if (state.entries.length > config.windowSize) {
    state.entries = state.entries.slice(-config.windowSize);
  }
};

export {
  detectToolCallLoop,
  recordToolCall,
  createToolLoopState,
  stableJsonSerialize,
  hashToolCall,
  DEFAULT_TOOL_LOOP_CONFIG,
};
export type { ToolLoopConfig, ToolLoopState, LoopDetectionResult, LoopSeverity };

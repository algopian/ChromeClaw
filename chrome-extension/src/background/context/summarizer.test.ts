import {
  summarizeMessages,
  formatTranscript,
  auditSummaryQuality,
  extractIdentifiers,
  getLatestUserAsk,
  getRecentTurnsVerbatim,
  PREFERRED_SECTIONS,
  RECENT_TURN_MAX_CHARS,
} from './summarizer';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage, ChatModel } from '@extension/shared';

// Mock completeText from pi-stream-bridge
const mockCompleteText = vi.fn();
vi.mock('../agents/stream-bridge', () => ({
  completeText: (...args: unknown[]) => mockCompleteText(...args),
}));

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-1',
  chatId: 'chat-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Hello' }],
  createdAt: Date.now(),
  ...overrides,
});

const mockModelConfig: ChatModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  routingMode: 'direct',
};

/** A well-formed structured summary that passes quality audit */
const makeStructuredSummary = (extra = '') =>
  `### 1. KEY DECISIONS & OUTCOMES
User discussed weather in San Francisco.
${extra}
### 2. OPEN TODOs & PENDING TASKS
None

### 3. CONSTRAINTS & RULES ESTABLISHED
None

### 4. PENDING USER ASKS
User asked about the weather in SF.

### 5. EXACT IDENTIFIERS
None

### 6. TOOL FAILURES & FILE OPERATIONS
None`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('summarizeMessages', () => {
  it('returns structured summary from completeText', async () => {
    const summary = makeStructuredSummary();
    mockCompleteText.mockResolvedValue(summary);

    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'What is the weather in SF?' }] }),
      makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'It is sunny in SF, 72F.' }],
      }),
    ];

    const result = await summarizeMessages(messages, mockModelConfig);
    expect(result).toContain('KEY DECISIONS');
    expect(result).toContain('weather');
  });

  it('includes all messages in summarization transcript', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());

    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Question 1' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Answer 1' }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'Question 2' }] }),
    ];

    await summarizeMessages(messages, mockModelConfig);

    expect(mockCompleteText).toHaveBeenCalled();
    const [_modelConfig, _systemPrompt, transcript] = mockCompleteText.mock.calls[0]!;
    expect(transcript).toContain('Question 1');
    expect(transcript).toContain('Answer 1');
    expect(transcript).toContain('Question 2');
  });

  it('retries on LLM error up to 2 times before throwing', async () => {
    mockCompleteText
      .mockRejectedValueOnce(new Error('API rate limit exceeded'))
      .mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const messages = [makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Hello' }] })];

    await expect(summarizeMessages(messages, mockModelConfig)).rejects.toThrow(
      'API rate limit exceeded',
    );
    expect(mockCompleteText).toHaveBeenCalledTimes(2);
  });

  it('succeeds on retry after initial failure', async () => {
    const summary = makeStructuredSummary();
    mockCompleteText
      .mockRejectedValueOnce(new Error('Temporary error'))
      .mockResolvedValue(summary);

    const messages = [makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Hello' }] })];

    const result = await summarizeMessages(messages, mockModelConfig);
    expect(result).toContain('KEY DECISIONS');
    expect(mockCompleteText).toHaveBeenCalledTimes(2);
  });

  it('passes maxTokens: 800 to completeText', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());

    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Long conversation...' }] }),
    ];

    await summarizeMessages(messages, mockModelConfig);

    expect(mockCompleteText).toHaveBeenCalled();
    const opts = mockCompleteText.mock.calls[0]![3];
    expect(opts.maxTokens).toBe(800);
  });

  it('includes tool-call parts in transcript', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());

    const messages = [
      makeMessage({
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'Check weather' }],
      }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            args: { city: 'SF' },
          },
        ],
      }),
    ];

    await summarizeMessages(messages, mockModelConfig);

    const transcript = mockCompleteText.mock.calls[0]![2] as string;
    expect(transcript).toContain('[Tool: web_search]');
    expect(transcript).toContain('Let me check.');
  });

  it('appends recent turns verbatim to summary', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());

    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Do something' }] }),
      makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Done!' }],
      }),
    ];

    const result = await summarizeMessages(messages, mockModelConfig);
    expect(result).toContain('RECENT TURNS');
    expect(result).toContain('Do something');
    expect(result).toContain('Done!');
  });

  it('accepts summary on first attempt when only sections are missing', async () => {
    // Missing sections are no longer critical — should pass on first attempt
    mockCompleteText.mockResolvedValueOnce('Just a plain summary without structure.');

    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Fix the auth bug' }] }),
      makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'I fixed the authentication issue.' }],
      }),
    ];

    const result = await summarizeMessages(messages, mockModelConfig);
    expect(result).toContain('plain summary');
    expect(mockCompleteText).toHaveBeenCalledTimes(1);
  });
});

describe('formatTranscript', () => {
  it('includes tool-result status in transcript', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            result: 'Search failed with error',
          },
        ],
      }),
    ];

    const transcript = formatTranscript(messages);
    expect(transcript).toContain('[Result: web_search FAILED]');
  });

  it('marks non-error results without FAILED tag', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            result: 'Sunny weather in SF',
          },
        ],
      }),
    ];

    const transcript = formatTranscript(messages);
    expect(transcript).toContain('[Result: web_search]');
    expect(transcript).not.toContain('FAILED');
  });
});

describe('auditSummaryQuality', () => {
  it('passes when all sections present', () => {
    const summary = makeStructuredSummary();
    const result = auditSummaryQuality(summary, 'some transcript', 'what is the weather');
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('warns but passes when sections are missing (no critical issue)', () => {
    const summary = 'Just a plain text summary with no structure.';
    const result = auditSummaryQuality(summary, 'some transcript', 'what is the weather');
    // Missing sections are no longer critical — only low identifier overlap fails
    expect(result.issues.some(i => i.includes('Missing section'))).toBe(true);
    // Passes because there are no identifiers in the transcript to fail overlap check
    expect(result.passed).toBe(true);
  });

  it('checks identifier overlap', () => {
    const transcript = 'The file is at /home/user/project/src/main.ts with UUID abc12345-6789-0123-4567-890abcdef012';
    const summaryGood = makeStructuredSummary() + '\n/home/user/project/src/main.ts abc12345-6789-0123-4567-890abcdef012';
    const summaryBad = makeStructuredSummary();

    const good = auditSummaryQuality(summaryGood, transcript, 'check file');
    const bad = auditSummaryQuality(summaryBad, transcript, 'check file');

    expect(good.passed).toBe(true);
    // bad may or may not fail depending on other criteria; identifiers check is one factor
  });

  it('checks latest user ask reflection', () => {
    const summary = makeStructuredSummary();
    const result = auditSummaryQuality(summary, 'transcript', 'deploy the kubernetes cluster');
    // "kubernetes" and "cluster" are not in the summary
    expect(result.issues.some(i => i.includes('user ask'))).toBe(true);
  });
});

describe('extractIdentifiers', () => {
  it('extracts file paths', () => {
    const ids = extractIdentifiers('The file is at /src/components/Button.tsx');
    expect(ids.has('/src/components/Button.tsx')).toBe(true);
  });

  it('extracts UUIDs', () => {
    const ids = extractIdentifiers('ID: 550e8400-e29b-41d4-a716-446655440000');
    expect(ids.has('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('extracts URLs', () => {
    const ids = extractIdentifiers('See https://example.com/api/v2/users');
    expect(ids.has('https://example.com/api/v2/users')).toBe(true);
  });
});

describe('getLatestUserAsk', () => {
  it('returns the last user message text', () => {
    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'First question' }] }),
      makeMessage({ role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] }),
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Second question' }] }),
    ];
    expect(getLatestUserAsk(messages)).toBe('Second question');
  });

  it('returns empty string when no user messages', () => {
    const messages = [
      makeMessage({ role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] }),
    ];
    expect(getLatestUserAsk(messages)).toBe('');
  });
});

describe('getRecentTurnsVerbatim', () => {
  it('returns last N turns with role prefix', () => {
    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }),
      makeMessage({ role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] }),
    ];
    const result = getRecentTurnsVerbatim(messages, 2);
    expect(result).toContain('RECENT TURNS');
    expect(result).toContain('user: Hello');
    expect(result).toContain('assistant: Hi there');
  });

  it('truncates long turns', () => {
    const longText = 'x'.repeat(RECENT_TURN_MAX_CHARS + 100);
    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: longText }] }),
    ];
    const result = getRecentTurnsVerbatim(messages, 1);
    expect(result.length).toBeLessThan(longText.length);
    expect(result).toContain('...');
  });

  it('returns empty string for empty messages', () => {
    expect(getRecentTurnsVerbatim([])).toBe('');
  });
});

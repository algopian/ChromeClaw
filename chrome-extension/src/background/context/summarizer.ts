import { completeText } from '../agents/stream-bridge';
import { shouldUseAdaptiveCompaction, computePartCount, splitMessagesByTokenShare } from './adaptive-compaction';
import { createLogger } from '../logging/logger-buffer';
import type { ChatMessage, ChatModel } from '@extension/shared';

const summarizerLog = createLogger('stream');

// ── Structured summarization prompt ─────────────

const SUMMARY_PROMPT = `Summarize this conversation history into the following structured sections. Be thorough and precise — this summary will REPLACE the original messages.

## Required Sections

### 1. KEY DECISIONS & OUTCOMES
List all decisions made, conclusions reached, and outcomes of tool calls. Include specific results.

### 2. OPEN TODOs & PENDING TASKS
List any tasks that were started but not completed, or explicitly mentioned as next steps.

### 3. CONSTRAINTS & RULES ESTABLISHED
Any rules, constraints, preferences, or conventions the user specified during the conversation.

### 4. PENDING USER ASKS
What was the user's most recent request or question? What are they waiting for?

### 5. EXACT IDENTIFIERS
Preserve ALL of the following verbatim (do not paraphrase):
- File paths, URLs, API endpoints
- UUIDs, IDs, hashes, version numbers
- Variable names, function names, class names
- Configuration keys and values
- Error messages and error codes

### 6. TOOL FAILURES & FILE OPERATIONS
- List any tool calls that failed, with the error message
- List files that were read, created, or modified

## Rules
- If a section has no content, write "None" — do not omit the section
- Prefer exact quotes over paraphrasing for technical content
- Keep the total summary under 800 tokens`;

const MERGE_PROMPT = `You are given multiple partial summaries of a single conversation. Merge them into one cohesive structured summary using the same section format.

## Required Sections
1. KEY DECISIONS & OUTCOMES
2. OPEN TODOs & PENDING TASKS
3. CONSTRAINTS & RULES ESTABLISHED
4. PENDING USER ASKS
5. EXACT IDENTIFIERS
6. TOOL FAILURES & FILE OPERATIONS

## Rules
- Merge overlapping content, removing duplicates
- Preserve all exact identifiers from all parts
- If sections conflict, prefer the later part (more recent)
- Keep the total under 800 tokens
- Do not add information not present in the partial summaries`;

/** Max chars per recent turn to embed verbatim in the summary */
const RECENT_TURN_MAX_CHARS = 600;

/** Number of recent turns to preserve verbatim */
const RECENT_TURNS_TO_PRESERVE = 3;

/** Max summarization retry attempts */
const MAX_SUMMARY_RETRIES = 2;

/** Base delay for retry backoff (ms) */
const RETRY_BASE_DELAY_MS = 500;

// ── Quality audit ───────────────────────────────

/** Preferred section headers — missing sections warn but don't fail the audit */
const PREFERRED_SECTIONS = [
  'KEY DECISIONS',
  'OPEN TODO',
  'CONSTRAINTS',
  'PENDING USER',
  'EXACT IDENTIFIERS',
  'TOOL FAILURES',
];

/**
 * Extract identifiers from text: file paths, UUIDs, URLs, function names, etc.
 */
const extractIdentifiers = (text: string): Set<string> => {
  const identifiers = new Set<string>();

  // File paths (Unix and Windows)
  const paths = text.match(/(?:\/[\w.-]+){2,}|(?:[A-Z]:\\[\w.-\\]+)/g);
  if (paths) paths.forEach(p => identifiers.add(p));

  // UUIDs
  const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  if (uuids) uuids.forEach(u => identifiers.add(u.toLowerCase()));

  // URLs
  const urls = text.match(/https?:\/\/[^\s)>"']+/g);
  if (urls) urls.forEach(u => identifiers.add(u));

  // Error codes (e.g., E1234, ERR_NOT_FOUND)
  const errors = text.match(/\b(?:ERR_[A-Z_]+|E\d{4,}|[A-Z][A-Z0-9_]{3,}Error)\b/g);
  if (errors) errors.forEach(e => identifiers.add(e));

  return identifiers;
};

interface QualityAuditResult {
  passed: boolean;
  issues: string[];
}

/**
 * Validate a summary against quality criteria.
 * Missing sections are warned but don't cause failure.
 * Only critically low identifier overlap causes failure.
 */
const auditSummaryQuality = (
  summary: string,
  transcript: string,
  latestUserAsk: string,
): QualityAuditResult => {
  const issues: string[] = [];
  const upperSummary = summary.toUpperCase();

  // Sections are preferred but not required — only warn
  const missingSections = PREFERRED_SECTIONS.filter(s => !upperSummary.includes(s));
  if (missingSections.length > 0) {
    issues.push(`Missing section: ${missingSections.join(', ')}`);
  }

  // Lower identifier threshold: 20% instead of 50%
  const sourceIds = extractIdentifiers(transcript);
  if (sourceIds.size > 0) {
    const summaryIds = extractIdentifiers(summary);
    let overlapCount = 0;
    for (const id of sourceIds) {
      if (summaryIds.has(id) || summary.includes(id)) overlapCount++;
    }
    const overlapRatio = overlapCount / sourceIds.size;
    if (overlapRatio < 0.2) {
      issues.push(
        `Low identifier overlap: ${overlapCount}/${sourceIds.size} (${Math.round(overlapRatio * 100)}%)`,
      );
    }
  }

  // Check that the latest user ask is reflected
  if (latestUserAsk.length > 10) {
    const askTerms = latestUserAsk
      .toLowerCase()
      .match(/[a-z0-9_]+/g)
      ?.filter(t => t.length >= 3) ?? [];
    const matchedTerms = askTerms.filter(t => summary.toLowerCase().includes(t));
    if (askTerms.length > 0 && matchedTerms.length < Math.min(2, askTerms.length)) {
      issues.push('Latest user ask not reflected in summary');
    }
  }

  // Pass if no critical issue (only low identifier overlap is critical)
  const hasCriticalIssue = issues.some(i => i.startsWith('Low identifier'));
  return { passed: !hasCriticalIssue, issues };
};

// ── Transcript formatting ───────────────────────

/**
 * Format messages into a readable transcript for summarization.
 * Includes tool-call names, tool-result status, and failure indicators.
 */
const formatTranscript = (messages: ChatMessage[]): string =>
  messages
    .map(m => {
      const textParts = m.parts
        .filter(p => p.type === 'text')
        .map(p => (p as { type: 'text'; text: string }).text)
        .join('');
      const toolParts = m.parts
        .filter(p => p.type === 'tool-call')
        .map(p => `[Tool: ${(p as { type: 'tool-call'; toolName: string }).toolName}]`)
        .join(' ');
      const toolResults = m.parts
        .filter(p => p.type === 'tool-result')
        .map(p => {
          const tr = p as { type: 'tool-result'; toolName: string; result: unknown };
          const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
          const isError = resultStr.toLowerCase().includes('error') || resultStr.toLowerCase().includes('failed');
          return `[Result: ${tr.toolName}${isError ? ' FAILED' : ''}]`;
        })
        .join(' ');
      const content = [textParts, toolParts, toolResults].filter(Boolean).join(' ');
      return `${m.role}: ${content}`;
    })
    .join('\n');

/**
 * Extract the latest user ask from messages (searching from the end).
 */
const getLatestUserAsk = (messages: ChatMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'user') {
      return msg.parts
        .filter(p => p.type === 'text')
        .map(p => (p as { type: 'text'; text: string }).text)
        .join(' ');
    }
  }
  return '';
};

/**
 * Get recent turns as verbatim text for preservation across compaction.
 * Returns the last N turns, each truncated to RECENT_TURN_MAX_CHARS.
 */
const getRecentTurnsVerbatim = (messages: ChatMessage[], count: number = RECENT_TURNS_TO_PRESERVE): string => {
  const recent = messages.slice(-count);
  if (recent.length === 0) return '';

  const lines = recent.map(m => {
    const text = m.parts
      .filter(p => p.type === 'text')
      .map(p => (p as { type: 'text'; text: string }).text)
      .join(' ');
    const truncated = text.length > RECENT_TURN_MAX_CHARS
      ? text.slice(0, RECENT_TURN_MAX_CHARS) + '...'
      : text;
    return `${m.role}: ${truncated}`;
  });

  return '\n\n## RECENT TURNS (verbatim)\n' + lines.join('\n');
};

// ── Retry with backoff ──────────────────────────

/**
 * Sleep with exponential backoff + jitter.
 */
const backoffDelay = (attempt: number): Promise<void> => {
  const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * delay * 0.3;
  return new Promise(resolve => setTimeout(resolve, delay + jitter));
};

// ── Summarization functions ─────────────────────

/** Max chars for the LLM-generated summary (before appending recent turns) */
const MAX_SUMMARY_CHARS = 6000;

/** Timeout for the entire summarization process (ms) */
const SUMMARIZATION_TIMEOUT_MS = 30_000;

/**
 * Internal implementation of summarizeMessages with quality audit and retry.
 */
const summarizeMessagesImpl = async (
  messages: ChatMessage[],
  modelConfig: ChatModel,
): Promise<string> => {
  const transcript = formatTranscript(messages);
  const latestUserAsk = getLatestUserAsk(messages);
  const recentTurns = getRecentTurnsVerbatim(messages);

  let lastSummary = '';
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < MAX_SUMMARY_RETRIES; attempt++) {
    if (attempt > 0) {
      await backoffDelay(attempt - 1);
      summarizerLog.trace('summarizeMessages: retry', { attempt, issues: lastIssues });
    }

    try {
      const prompt = attempt > 0
        ? `${SUMMARY_PROMPT}\n\nIMPORTANT: Your previous summary had these issues:\n${lastIssues.map(i => `- ${i}`).join('\n')}\nPlease fix them.`
        : SUMMARY_PROMPT;

      lastSummary = await completeText(modelConfig, prompt, transcript, {
        maxTokens: 800,
      });

      // Cap LLM output before appending recent turns
      if (lastSummary.length > MAX_SUMMARY_CHARS) {
        lastSummary = lastSummary.slice(0, MAX_SUMMARY_CHARS);
      }

      // Append recent turns verbatim
      lastSummary += recentTurns;

      // Quality audit
      const audit = auditSummaryQuality(lastSummary, transcript, latestUserAsk);
      if (audit.passed) {
        summarizerLog.trace('summarizeMessages: quality audit passed', { attempt });
        return lastSummary;
      }

      lastIssues = audit.issues;
      summarizerLog.trace('summarizeMessages: quality audit failed', {
        attempt,
        issues: audit.issues,
      });
    } catch (err) {
      // On the last attempt, throw. Otherwise retry.
      if (attempt === MAX_SUMMARY_RETRIES - 1) throw err;
      summarizerLog.trace('summarizeMessages: LLM error, will retry', {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Exhausted retries — return the last summary with a warning
  summarizerLog.trace('summarizeMessages: exhausted retries, using best effort', {
    issues: lastIssues,
  });
  return lastSummary;
};

/**
 * Summarize a set of messages using the LLM with structured prompt.
 * Includes quality audit with retry and a 30s timeout.
 * On timeout, the caller's catch block falls back to sliding-window compaction.
 */
const summarizeMessages = async (
  messages: ChatMessage[],
  modelConfig: ChatModel,
): Promise<string> =>
  Promise.race([
    summarizeMessagesImpl(messages, modelConfig),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Summarization timeout')), SUMMARIZATION_TIMEOUT_MS),
    ),
  ]);

/**
 * Multi-stage summarization for very long histories.
 *
 * Stage 1: Split messages into parts, summarize each independently (parallel).
 * Stage 2: Merge partial summaries into a final cohesive summary.
 */
const summarizeInStages = async (
  messages: ChatMessage[],
  modelConfig: ChatModel,
  modelId: string,
  contextWindowOverride?: number,
): Promise<string> => {
  const partCount = computePartCount(messages, modelId, contextWindowOverride);
  const parts = splitMessagesByTokenShare(messages, partCount);

  summarizerLog.trace('summarizeInStages: splitting', {
    totalMessages: messages.length,
    partCount,
    messageCounts: parts.map(p => p.length),
  });

  // Stage 1: Summarize each part in parallel
  const partialSummaries = await Promise.all(
    parts.map(async (part, i) => {
      const transcript = formatTranscript(part);
      return completeText(
        modelConfig,
        `${SUMMARY_PROMPT}\n\nThis is part ${i + 1} of ${parts.length} of the conversation.`,
        transcript,
        { maxTokens: 800 },
      );
    }),
  );

  summarizerLog.trace('summarizeInStages: partials done', {
    partCount,
    summaryLengths: partialSummaries.map(s => s.length),
  });

  // Stage 2: Merge partial summaries
  const mergeInput = partialSummaries
    .map((summary, i) => `--- Part ${i + 1} ---\n${summary}`)
    .join('\n\n');

  let finalSummary = await completeText(modelConfig, MERGE_PROMPT, mergeInput, {
    maxTokens: 1000,
  });

  // Append recent turns from the last part
  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    finalSummary += getRecentTurnsVerbatim(lastPart);
  }

  summarizerLog.trace('summarizeInStages: merge done', {
    finalLength: finalSummary.length,
  });

  return finalSummary;
};

export {
  summarizeMessages,
  summarizeInStages,
  shouldUseAdaptiveCompaction,
  formatTranscript,
  auditSummaryQuality,
  extractIdentifiers,
  getLatestUserAsk,
  getRecentTurnsVerbatim,
  PREFERRED_SECTIONS,
  MAX_SUMMARY_RETRIES,
  RECENT_TURN_MAX_CHARS,
  RECENT_TURNS_TO_PRESERVE,
};

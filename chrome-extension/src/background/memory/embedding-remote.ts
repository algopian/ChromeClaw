import { sanitizeAndNormalizeEmbedding } from './embedding-normalize';
import { createLogger } from '../logging/logger-buffer';
import type { EmbeddingProvider } from './embedding-types';

const embLog = createLogger('embedding');

// ── Constants ──
const MAX_RETRIES = 2; // 1 initial + up to 2 retries = 3 total attempts
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8000;
const RETRYABLE_PATTERN = /rate[_ ]limit|too many requests|\b429\b|\b5\d\d\b|cloudflare/i;
const FETCH_TIMEOUT_MS = 60_000;

// ── Known model token limits ──
const MAX_INPUT_TOKENS: Record<string, number> = {
  'text-embedding-3-small': 8192,
  'text-embedding-3-large': 8192,
  'text-embedding-ada-002': 8191,
};

interface RemoteEmbeddingOptions {
  baseUrl: string; // e.g. 'http://localhost:4141/v1'
  apiKey: string; // Bearer token (can be empty)
  model: string; // e.g. 'text-embedding-3-small'
}

/**
 * Call the /embeddings endpoint and return normalized vectors.
 * Retries on rate-limit/5xx errors with exponential backoff + jitter.
 *
 */
const fetchEmbeddings = async (
  url: string,
  headers: Record<string, string>,
  model: string,
  input: string[],
): Promise<number[][]> => {
  let delayMs = RETRY_BASE_DELAY_MS;

  embLog.trace('fetchEmbeddings called', { url, model, inputCount: input.length });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = `Embedding API error ${response.status}: ${body.slice(0, 200)}`;
        // Only retry on retryable errors
        if (RETRYABLE_PATTERN.test(error) && attempt < MAX_RETRIES) {
          embLog.warn('Retrying embedding request', { attempt, error });
          const waitMs = Math.min(RETRY_MAX_DELAY_MS, Math.round(delayMs * (1 + Math.random() * 0.2)));
          await new Promise(r => setTimeout(r, waitMs));
          delayMs *= 2;
          continue;
        }
        throw new Error(error);
      }

      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const vectors = (payload.data ?? []).map(entry => entry.embedding ?? []);
      embLog.trace('fetchEmbeddings success', {
        vectorCount: vectors.length,
        dims: vectors[0]?.length ?? 0,
        attempt,
      });
      // L2-normalize all vectors for consistent cosine similarity
      return vectors.map(sanitizeAndNormalizeEmbedding);
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!RETRYABLE_PATTERN.test(msg)) throw err;
      embLog.warn('Retrying after error', { attempt, error: msg });
      const waitMs = Math.min(RETRY_MAX_DELAY_MS, Math.round(delayMs * (1 + Math.random() * 0.2)));
      await new Promise(r => setTimeout(r, waitMs));
      delayMs *= 2;
    }
  }
  throw new Error('Embedding request failed after retries');
};

const createRemoteEmbeddingProvider = (options: RemoteEmbeddingOptions): EmbeddingProvider => {
  const url = `${options.baseUrl.replace(/\/$/, '')}/embeddings`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
  };

  return {
    id: 'openai-compatible',
    model: options.model,
    maxInputTokens: MAX_INPUT_TOKENS[options.model],

    embedQuery: async (text: string) => {
      const [vec] = await fetchEmbeddings(url, headers, options.model, [text]);
      return vec ?? [];
    },

    embedBatch: (texts: string[]) =>
      texts.length === 0 ? Promise.resolve([]) : fetchEmbeddings(url, headers, options.model, texts),
  };
};

export { createRemoteEmbeddingProvider };
export type { RemoteEmbeddingOptions };

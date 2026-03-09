import { beforeEach, describe, it, expect, vi } from 'vitest';

// ── Mocks ──
vi.mock('./embedding-provider', () => ({
  resolveEmbeddingProvider: vi.fn(async () => null), // default: no provider
}));

vi.mock('@extension/storage', () => ({
  embeddingConfigStorage: {
    get: vi.fn(async () => ({
      provider: 'none',
      search: { vectorWeight: 0.7, bm25Weight: 0.3, candidateMultiplier: 4 },
    })),
  },
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

import { hybridSearch } from './hybrid-search';
import { resolveEmbeddingProvider } from './embedding-provider';
import { buildIndex } from './memory-search';
import type { DbMemoryChunk } from '@extension/storage';

// ── Helpers ──
const makeChunk = (id: string, text: string, embedding?: number[]): DbMemoryChunk => ({
  id,
  fileId: 'file-1',
  filePath: 'MEMORY.md',
  startLine: 1,
  endLine: 5,
  text,
  fileUpdatedAt: Date.now(),
  contentHash: id,
  ...(embedding ? { embedding, embeddingProvider: 'test', embeddingModel: 'test' } : {}),
});

describe('hybridSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to pure BM25 when no embedding provider', async () => {
    vi.mocked(resolveEmbeddingProvider).mockResolvedValue(null);

    const chunks = [makeChunk('c1', 'hello world testing')];
    const index = buildIndex(chunks);
    const results = await hybridSearch(index, 'hello', chunks);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bm25Score).toBeGreaterThan(0);
    expect(results[0].vectorScore).toBe(0);
  });

  it('merges BM25 and vector scores when provider is available', async () => {
    const mockProvider = {
      id: 'test',
      model: 'test',
      embedQuery: vi.fn(async () => [1, 0, 0]),
      embedBatch: vi.fn(async () => []),
    };
    vi.mocked(resolveEmbeddingProvider).mockResolvedValue(mockProvider);

    const chunks = [
      makeChunk('c1', 'hello world', [1, 0, 0]), // cosine = 1.0
      makeChunk('c2', 'goodbye world', [0, 1, 0]), // cosine = 0.0
    ];
    const index = buildIndex(chunks);
    const results = await hybridSearch(index, 'hello', chunks);

    // c1 should rank higher (both BM25 match + vector match)
    expect(results[0].path).toBe('MEMORY.md');
    expect(results[0].vectorScore).toBeGreaterThan(0);
  });

  it('respects maxResults', async () => {
    vi.mocked(resolveEmbeddingProvider).mockResolvedValue(null);

    const chunks = Array.from({ length: 20 }, (_, i) =>
      makeChunk(`c${i}`, `test content number ${i}`),
    );
    const index = buildIndex(chunks);
    const results = await hybridSearch(index, 'test content', chunks, { maxResults: 3 });

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('respects minScore filter', async () => {
    vi.mocked(resolveEmbeddingProvider).mockResolvedValue(null);

    const chunks = [makeChunk('c1', 'hello world')];
    const index = buildIndex(chunks);
    const results = await hybridSearch(index, 'hello', chunks, { minScore: 999 });

    expect(results).toHaveLength(0);
  });

  it('handles chunks with missing embeddings gracefully', async () => {
    const mockProvider = {
      id: 'test',
      model: 'test',
      embedQuery: vi.fn(async () => [1, 0]),
      embedBatch: vi.fn(async () => []),
    };
    vi.mocked(resolveEmbeddingProvider).mockResolvedValue(mockProvider);

    const chunks = [
      makeChunk('c1', 'hello world'), // no embedding
      makeChunk('c2', 'hello there', [0.7, 0.7]), // has embedding
    ];
    const index = buildIndex(chunks);
    const results = await hybridSearch(index, 'hello', chunks);

    // Both should appear (c1 via BM25 only, c2 via both)
    expect(results.length).toBeGreaterThan(0);
  });
});

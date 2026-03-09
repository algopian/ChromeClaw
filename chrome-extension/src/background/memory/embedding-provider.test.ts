import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('@extension/storage', () => ({
  embeddingConfigStorage: {
    get: vi.fn(),
  },
}));

vi.mock('./embedding-remote', () => ({
  createRemoteEmbeddingProvider: vi.fn(() => ({
    id: 'openai-compatible',
    model: 'test-model',
    embedQuery: vi.fn(),
    embedBatch: vi.fn(),
  })),
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

import {
  resolveEmbeddingProvider,
  invalidateEmbeddingProvider,
} from './embedding-provider';
import { embeddingConfigStorage } from '@extension/storage';
import { createRemoteEmbeddingProvider } from './embedding-remote';

describe('resolveEmbeddingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateEmbeddingProvider();
  });

  it('returns null when provider is "none"', async () => {
    vi.mocked(embeddingConfigStorage.get).mockResolvedValue({
      provider: 'none',
      openaiCompatible: { baseUrl: '', apiKey: '', model: '' },
      local: { model: '' },
      search: { vectorWeight: 0.7, bm25Weight: 0.3, candidateMultiplier: 4 },
    });

    const result = await resolveEmbeddingProvider();
    expect(result).toBeNull();
  });

  it('creates remote provider for "openai-compatible"', async () => {
    vi.mocked(embeddingConfigStorage.get).mockResolvedValue({
      provider: 'openai-compatible',
      openaiCompatible: {
        baseUrl: 'http://localhost:4141/v1',
        apiKey: 'key',
        model: 'text-embedding-3-small',
      },
      local: { model: '' },
      search: { vectorWeight: 0.7, bm25Weight: 0.3, candidateMultiplier: 4 },
    });

    const result = await resolveEmbeddingProvider();
    expect(result).not.toBeNull();
    expect(createRemoteEmbeddingProvider).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:4141/v1',
      apiKey: 'key',
      model: 'text-embedding-3-small',
    });
  });

  it('returns null for "openai-compatible" with empty baseUrl', async () => {
    vi.mocked(embeddingConfigStorage.get).mockResolvedValue({
      provider: 'openai-compatible',
      openaiCompatible: { baseUrl: '', apiKey: '', model: '' },
      local: { model: '' },
      search: { vectorWeight: 0.7, bm25Weight: 0.3, candidateMultiplier: 4 },
    });

    const result = await resolveEmbeddingProvider();
    expect(result).toBeNull();
  });

  it('returns null for "local" with warning (v2 stub)', async () => {
    vi.mocked(embeddingConfigStorage.get).mockResolvedValue({
      provider: 'local',
      openaiCompatible: { baseUrl: '', apiKey: '', model: '' },
      local: { model: 'Xenova/all-MiniLM-L6-v2' },
      search: { vectorWeight: 0.7, bm25Weight: 0.3, candidateMultiplier: 4 },
    });

    const result = await resolveEmbeddingProvider();
    expect(result).toBeNull();
  });

  it('caches provider instance across calls', async () => {
    vi.mocked(embeddingConfigStorage.get).mockResolvedValue({
      provider: 'openai-compatible',
      openaiCompatible: { baseUrl: 'http://test.com/v1', apiKey: '', model: 'test' },
      local: { model: '' },
      search: { vectorWeight: 0.7, bm25Weight: 0.3, candidateMultiplier: 4 },
    });

    const result1 = await resolveEmbeddingProvider();
    const result2 = await resolveEmbeddingProvider();

    expect(result1).toBe(result2); // same instance
    expect(createRemoteEmbeddingProvider).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache when config changes', async () => {
    vi.mocked(embeddingConfigStorage.get)
      .mockResolvedValueOnce({
        provider: 'openai-compatible',
        openaiCompatible: { baseUrl: 'http://a.com/v1', apiKey: '', model: 'a' },
        local: { model: '' },
        search: { vectorWeight: 0.7, bm25Weight: 0.3, candidateMultiplier: 4 },
      })
      .mockResolvedValueOnce({
        provider: 'openai-compatible',
        openaiCompatible: { baseUrl: 'http://b.com/v1', apiKey: '', model: 'b' },
        local: { model: '' },
        search: { vectorWeight: 0.7, bm25Weight: 0.3, candidateMultiplier: 4 },
      });

    await resolveEmbeddingProvider();
    await resolveEmbeddingProvider();

    expect(createRemoteEmbeddingProvider).toHaveBeenCalledTimes(2);
  });
});

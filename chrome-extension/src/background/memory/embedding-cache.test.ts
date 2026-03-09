import { beforeEach, describe, it, expect, vi } from 'vitest';

// This test requires the Dexie/fake-indexeddb setup from packages/storage/tests/setup.ts
// which is already configured in vitest.config.ts setupFiles.

import {
  loadCachedEmbeddings,
  cacheEmbeddings,
  pruneEmbeddingCache,
} from './embedding-cache';

describe('embedding-cache', () => {
  beforeEach(async () => {
    // Clear embeddingCache table before each test
    const { chatDb } = await import('@extension/storage');
    await chatDb.embeddingCache.clear();
  });

  it('stores and retrieves cached embeddings', async () => {
    await cacheEmbeddings('openai', 'text-embedding-3-small', [
      { contentHash: 'hash-1', embedding: [0.1, 0.2], dims: 2 },
      { contentHash: 'hash-2', embedding: [0.3, 0.4], dims: 2 },
    ]);

    const result = await loadCachedEmbeddings('openai', 'text-embedding-3-small', [
      'hash-1',
      'hash-2',
      'hash-missing',
    ]);

    expect(result.size).toBe(2);
    expect(result.get('hash-1')).toEqual([0.1, 0.2]);
    expect(result.get('hash-2')).toEqual([0.3, 0.4]);
    expect(result.has('hash-missing')).toBe(false);
  });

  it('isolates by provider and model', async () => {
    await cacheEmbeddings('openai', 'model-a', [
      { contentHash: 'hash-1', embedding: [1, 0], dims: 2 },
    ]);

    // Same hash but different model → should NOT match
    const result = await loadCachedEmbeddings('openai', 'model-b', ['hash-1']);
    expect(result.size).toBe(0);
  });

  it('returns empty map for empty input', async () => {
    const result = await loadCachedEmbeddings('openai', 'model', []);
    expect(result.size).toBe(0);
  });

  it('prunes oldest entries when exceeding max', async () => {
    // Insert 5 entries with staggered timestamps
    for (let i = 0; i < 5; i++) {
      await cacheEmbeddings('openai', 'model', [
        { contentHash: `hash-${i}`, embedding: [i], dims: 1 },
      ]);
      // Small delay to ensure different updatedAt
      await new Promise(r => setTimeout(r, 10));
    }

    await pruneEmbeddingCache(3); // keep only 3

    const { chatDb } = await import('@extension/storage');
    const count = await chatDb.embeddingCache.count();
    expect(count).toBe(3);
  });

  it('does nothing when count is within limit', async () => {
    await cacheEmbeddings('openai', 'model', [
      { contentHash: 'hash-1', embedding: [1], dims: 1 },
    ]);

    await pruneEmbeddingCache(100); // well within limit

    const { chatDb } = await import('@extension/storage');
    const count = await chatDb.embeddingCache.count();
    expect(count).toBe(1);
  });
});

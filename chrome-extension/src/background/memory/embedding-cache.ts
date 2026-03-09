/**
 * Persistent embedding cache — avoids re-embedding unchanged chunks.
 * Keyed by (provider, model, contentHash). Uses LRU eviction.
 *
 */
import { chatDb } from '@extension/storage';
import { createLogger } from '../logging/logger-buffer';
import type { DbEmbeddingCache } from '@extension/storage';

const cacheLog = createLogger('embedding');

const MAX_CACHE_ENTRIES = 2000;

const makeCacheId = (provider: string, model: string, contentHash: string): string =>
  `${provider}:${model}:${contentHash}`;

/** Load cached embeddings for a batch of content hashes */
const loadCachedEmbeddings = async (
  provider: string,
  model: string,
  hashes: string[],
): Promise<Map<string, number[]>> => {
  const result = new Map<string, number[]>();
  if (hashes.length === 0) return result;

  const ids = hashes.map(h => makeCacheId(provider, model, h));
  const entries = await chatDb.embeddingCache.where('id').anyOf(ids).toArray();

  for (const entry of entries) {
    result.set(entry.contentHash, entry.embedding);
  }
  cacheLog.trace('Cache lookup', { requested: hashes.length, hits: result.size });

  // Touch loaded entries to keep them fresh for LRU eviction (fire-and-forget)
  if (entries.length > 0) {
    const now = Date.now();
    chatDb.embeddingCache
      .where('id')
      .anyOf(entries.map(e => e.id))
      .modify({ updatedAt: now })
      .catch(() => {});
  }

  return result;
};

/** Store embeddings in cache */
const cacheEmbeddings = async (
  provider: string,
  model: string,
  entries: Array<{ contentHash: string; embedding: number[]; dims: number }>,
): Promise<void> => {
  if (entries.length === 0) return;

  const now = Date.now();
  const records: DbEmbeddingCache[] = entries.map(e => ({
    id: makeCacheId(provider, model, e.contentHash),
    provider,
    model,
    contentHash: e.contentHash,
    embedding: e.embedding,
    dims: e.dims,
    updatedAt: now,
  }));

  await chatDb.embeddingCache.bulkPut(records);
  cacheLog.trace('Cache store', { count: entries.length, provider, model });
};

/** Prune oldest entries when cache exceeds maxEntries (LRU by updatedAt) */
const pruneEmbeddingCache = async (maxEntries: number = MAX_CACHE_ENTRIES): Promise<void> => {
  const count = await chatDb.embeddingCache.count();
  if (count <= maxEntries) return;

  const excess = count - maxEntries;
  const oldest = await chatDb.embeddingCache.orderBy('updatedAt').limit(excess).primaryKeys();

  await chatDb.embeddingCache.bulkDelete(oldest);
  cacheLog.trace('Cache pruned', { removed: excess, remaining: maxEntries });
};

export { loadCachedEmbeddings, cacheEmbeddings, pruneEmbeddingCache };

import { embeddingConfigStorage } from '@extension/storage';
import { createRemoteEmbeddingProvider } from './embedding-remote';
import { createLogger } from '../logging/logger-buffer';
import type { EmbeddingProvider } from './embedding-types';

const embLog = createLogger('embedding');

// ── Cached provider (invalidated when config changes) ──
let cachedProvider: EmbeddingProvider | null = null;
let cachedConfigSnapshot: string | null = null;

const resolveEmbeddingProvider = async (): Promise<EmbeddingProvider | null> => {
  const config = await embeddingConfigStorage.get();

  // Snapshot only the fields that affect provider creation
  const snapshot = JSON.stringify({
    provider: config.provider,
    openaiCompatible: config.openaiCompatible,
    local: config.local,
  });

  // Return cached if config hasn't changed
  if (cachedProvider && cachedConfigSnapshot === snapshot) {
    embLog.trace('Returning cached embedding provider', { provider: config.provider });
    return cachedProvider;
  }

  cachedProvider = null;
  cachedConfigSnapshot = null;

  switch (config.provider) {
    case 'none':
      return null;

    case 'openai-compatible': {
      const { baseUrl, apiKey, model } = config.openaiCompatible;
      if (!baseUrl) {
        embLog.warn('OpenAI-compatible embedding: no baseUrl configured');
        return null;
      }
      cachedProvider = createRemoteEmbeddingProvider({ baseUrl, apiKey, model });
      embLog.trace('Created OpenAI-compatible embedding provider', { baseUrl, model });
      break;
    }

    case 'local':
      // v2: will call createLocalEmbeddingProvider() here
      // For now, log a message and fall back to null (BM25-only)
      embLog.warn('Local embedding provider not yet implemented. Use OpenAI-compatible instead.');
      return null;
  }

  cachedConfigSnapshot = snapshot;
  return cachedProvider;
};

/** Call when embedding config changes to force re-resolution */
const invalidateEmbeddingProvider = (): void => {
  cachedProvider = null;
  cachedConfigSnapshot = null;
};

export { resolveEmbeddingProvider, invalidateEmbeddingProvider };

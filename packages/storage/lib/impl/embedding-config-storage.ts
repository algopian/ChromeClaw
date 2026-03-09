import { createMergingStorage } from './create-merging-storage.js';
import { createStorage, StorageEnum } from '../base/index.js';

type EmbeddingProviderType = 'none' | 'openai-compatible' | 'local';

interface EmbeddingConfig {
  provider: EmbeddingProviderType;
  openaiCompatible: {
    baseUrl: string; // e.g. 'http://localhost:4141/v1' or 'https://api.openai.com/v1'
    apiKey: string; // Bearer token (can be empty for proxy)
    model: string; // e.g. 'text-embedding-3-small'
  };
  local: {
    model: string; // v2: HuggingFace model ID
  };
  search: {
    vectorWeight: number; // default 0.7 — how much to weight vector similarity
    bm25Weight: number; // default 0.3 — how much to weight keyword match
    candidateMultiplier: number; // default 4 — fetch N*maxResults from each source
  };
  mmr: {
    enabled: boolean; // default true — enable MMR re-ranking for diversity
    lambda: number; // default 0.7 — trade-off: 1.0 = pure relevance, 0.0 = max diversity
  };
  temporalDecay: {
    enabled: boolean; // default true — newer memories score higher
    halfLifeDays: number; // default 30 — score halves after this many days
  };
}

const defaultEmbeddingConfig: EmbeddingConfig = {
  provider: 'none',
  openaiCompatible: {
    baseUrl: '',
    apiKey: '',
    model: 'text-embedding-3-small',
  },
  local: {
    model: 'Xenova/all-MiniLM-L6-v2',
  },
  search: {
    vectorWeight: 0.7,
    bm25Weight: 0.3,
    candidateMultiplier: 4,
  },
  mmr: {
    enabled: true,
    lambda: 0.7,
  },
  temporalDecay: {
    enabled: true,
    halfLifeDays: 30,
  },
};

const rawEmbeddingConfigStorage = createStorage<EmbeddingConfig>(
  'embedding-config',
  defaultEmbeddingConfig,
  { storageEnum: StorageEnum.Local, liveUpdate: true },
);

const embeddingConfigStorage = createMergingStorage(rawEmbeddingConfigStorage, defaultEmbeddingConfig, [
  'openaiCompatible',
  'local',
  'search',
  'mmr',
  'temporalDecay',
]);

export type { EmbeddingConfig, EmbeddingProviderType };
export { embeddingConfigStorage, defaultEmbeddingConfig };

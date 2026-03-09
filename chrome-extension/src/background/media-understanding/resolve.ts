import { DEFAULT_LOCAL_MODEL } from './defaults';
import { getProvider } from './providers';
import { sttConfigStorage, customModelsStorage } from '@extension/storage';
import type { MediaEngine, TranscribeOptions } from './types';
import type { SttConfig } from '@extension/storage';

/** Pick the best engine based on config and available credentials. */
const resolveTranscription = async (audio: ArrayBuffer, mimeType: string): Promise<string> => {
  const config = await sttConfigStorage.get();

  if (config.engine === 'off') {
    throw new Error('Audio transcription is disabled');
  }

  const engine: MediaEngine =
    config.engine === 'auto' ? await detectBestEngine(config) : config.engine;

  const provider = getProvider(engine);
  if (!provider) throw new Error(`Unknown media engine: ${engine}`);

  const options: TranscribeOptions = { language: config.language };

  if (engine === 'openai') {
    options.apiKey = await resolveOpenAIKey(config);
    options.model = config.openai.model;
    options.baseUrl = config.openai.baseUrl;
  } else {
    options.model = config.localModel || DEFAULT_LOCAL_MODEL;
  }

  console.debug('[media-understanding] resolveTranscription', {
    engine,
    configEngine: config.engine,
    language: config.language,
    localModel: config.localModel,
    optionsModel: options.model,
    optionsLanguage: options.language,
  });

  return provider.transcribe(audio, mimeType, options);
};

/** Auto-detect the best available engine. */
const detectBestEngine = async (config: SttConfig): Promise<MediaEngine> => {
  // Prefer cloud if an API key is reachable
  try {
    await resolveOpenAIKey(config);
    return 'openai';
  } catch {
    // No key available — fall through to local
  }

  // transformers works without SharedArrayBuffer
  return 'transformers';
};

/** Resolve an OpenAI-compatible API key from multiple sources. */
const resolveOpenAIKey = async (config: SttConfig): Promise<string> => {
  // 1. Explicit STT key takes priority
  if (config.openai.apiKey) return config.openai.apiKey;

  // 2. Reuse first OpenAI model's API key from model configs
  const models = await customModelsStorage.get();
  const openaiModel = models?.find(m => m.provider === 'openai' && m.apiKey);
  if (openaiModel?.apiKey) return openaiModel.apiKey;

  throw new Error('No API key available for OpenAI STT');
};

export { resolveTranscription, resolveOpenAIKey, detectBestEngine };

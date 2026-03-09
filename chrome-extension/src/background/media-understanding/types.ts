type MediaEngine = 'auto' | 'off' | 'openai' | 'transformers';

interface TranscribeOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  language?: string;
}

interface MediaProvider {
  id: string;
  transcribe: (audio: ArrayBuffer, mimeType: string, options: TranscribeOptions) => Promise<string>;
}

export type { MediaEngine, TranscribeOptions, MediaProvider };
export type { SttConfig } from '@extension/storage';

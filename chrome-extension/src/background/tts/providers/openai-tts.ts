import { OPENAI_TTS_DEFAULT_MODEL, OPENAI_TTS_DEFAULT_VOICE } from '../defaults';
import type { TtsProviderImpl, TtsSynthesizeOptions, TtsSynthesizeResult } from '../types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const synthesize = async (
  text: string,
  options: TtsSynthesizeOptions,
): Promise<TtsSynthesizeResult> => {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error('OpenAI TTS: no API key');

  const baseUrl = options.baseUrl?.replace(/\/+$/, '') || DEFAULT_BASE_URL;
  const model = options.model || OPENAI_TTS_DEFAULT_MODEL;
  const voice = options.voice || OPENAI_TTS_DEFAULT_VOICE;

  const resp = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      response_format: 'opus',
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`OpenAI TTS API error (${resp.status}): ${body.slice(0, 200)}`);
  }

  return {
    audio: await resp.arrayBuffer(),
    contentType: 'audio/ogg',
    voiceCompatible: true,
    sampleRate: 24000,
  };
};

const openaiTtsProvider: TtsProviderImpl = { id: 'openai', synthesize };

export { openaiTtsProvider };

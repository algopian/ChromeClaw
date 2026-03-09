import { DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL } from '../defaults';
import type { MediaProvider, TranscribeOptions } from '../types';

const transcribe = async (
  audio: ArrayBuffer,
  mimeType: string,
  options: TranscribeOptions,
): Promise<string> => {
  const {
    apiKey,
    baseUrl = DEFAULT_OPENAI_BASE_URL,
    model = DEFAULT_OPENAI_MODEL,
    language,
  } = options;
  if (!apiKey) throw new Error('No API key for OpenAI STT');

  const ext = mimeType.includes('ogg')
    ? 'ogg'
    : mimeType.includes('mp3') || mimeType.includes('mpeg')
      ? 'mp3'
      : 'webm';
  const blob = new Blob([audio], { type: mimeType });
  const form = new FormData();
  form.append('file', blob, `audio.${ext}`);
  form.append('model', model);
  if (language) form.append('language', language);

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI STT failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text;
};

const openaiProvider: MediaProvider = { id: 'openai', transcribe };

export { openaiProvider };

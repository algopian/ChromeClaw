/** Default local Whisper model — multilingual for language auto-detect. */
const DEFAULT_LOCAL_MODEL = 'tiny';

/** Default OpenAI Whisper model. */
const DEFAULT_OPENAI_MODEL = 'whisper-1';

/** Default OpenAI API base URL. */
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Timeout for transcription requests (covers first model download + WASM compilation). */
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 300_000;

export {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
};

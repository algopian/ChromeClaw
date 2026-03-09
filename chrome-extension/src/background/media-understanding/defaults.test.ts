/**
 * Tests for media-understanding/defaults.ts
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
} from './defaults';

describe('STT defaults', () => {
  it('DEFAULT_LOCAL_MODEL is "tiny"', () => {
    expect(DEFAULT_LOCAL_MODEL).toBe('tiny');
  });

  it('DEFAULT_OPENAI_MODEL is "whisper-1"', () => {
    expect(DEFAULT_OPENAI_MODEL).toBe('whisper-1');
  });

  it('DEFAULT_OPENAI_BASE_URL points to OpenAI', () => {
    expect(DEFAULT_OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
  });

  it('DEFAULT_TRANSCRIPTION_TIMEOUT_MS is 5 minutes', () => {
    expect(DEFAULT_TRANSCRIPTION_TIMEOUT_MS).toBe(300_000);
  });
});

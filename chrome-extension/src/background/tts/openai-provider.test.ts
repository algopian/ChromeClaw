import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { openaiTtsProvider } from './providers/openai-tts';

describe('tts/providers/openai-tts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has id "openai"', () => {
    expect(openaiTtsProvider.id).toBe('openai');
  });

  it('throws when no API key is provided', async () => {
    await expect(openaiTtsProvider.synthesize('Hello', {})).rejects.toThrow(
      'OpenAI TTS: no API key',
    );
  });

  it('sends correct request to OpenAI API', async () => {
    const fakeAudio = new ArrayBuffer(50);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio),
    });

    const result = await openaiTtsProvider.synthesize('Hello world', {
      apiKey: 'sk-test-key',
      model: 'tts-1',
      voice: 'nova',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test-key',
          'Content-Type': 'application/json',
        },
      }),
    );

    // Verify body
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({
      model: 'tts-1',
      input: 'Hello world',
      voice: 'nova',
      response_format: 'opus',
    });

    expect(result.audio).toBe(fakeAudio);
    expect(result.contentType).toBe('audio/ogg');
    expect(result.voiceCompatible).toBe(true);
  });

  it('uses custom base URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    });

    await openaiTtsProvider.synthesize('Test', {
      apiKey: 'key',
      baseUrl: 'http://localhost:4141/v1/',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4141/v1/audio/speech',
      expect.any(Object),
    );
  });

  it('uses default model and voice when not specified', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    });

    await openaiTtsProvider.synthesize('Test', { apiKey: 'key' });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('tts-1');
    expect(callBody.voice).toBe('nova');
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(openaiTtsProvider.synthesize('Hello', { apiKey: 'bad-key' })).rejects.toThrow(
      'OpenAI TTS API error (401)',
    );
  });

  it('handles error body truncation', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('x'.repeat(300)),
    });

    await expect(openaiTtsProvider.synthesize('Hello', { apiKey: 'key' })).rejects.toThrow(
      /OpenAI TTS API error \(500\)/,
    );
  });
});

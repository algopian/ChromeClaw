import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

describe('openai provider — transcribe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let openaiProvider: any;

  beforeEach(async () => {
    globalThis.fetch = vi.fn();
    const mod = await import('./providers/openai');
    openaiProvider = mod.openaiProvider;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const options = {
    apiKey: 'sk-test-key',
    model: 'whisper-1',
    baseUrl: 'https://api.openai.com/v1',
  };
  const audio = new ArrayBuffer(100);

  it('sends correct FormData with model and file', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'hello world' }),
    });

    await openaiProvider.transcribe(audio, 'audio/webm', options);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://api.openai.com/v1/audio/transcriptions');

    const body = call[1].body as FormData;
    expect(body.get('model')).toBe('whisper-1');
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  it('sends Authorization header with API key', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'test' }),
    });

    await openaiProvider.transcribe(audio, 'audio/webm', options);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers.Authorization).toBe('Bearer sk-test-key');
  });

  it('returns transcript text on success', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'transcribed text here' }),
    });

    const result = await openaiProvider.transcribe(audio, 'audio/webm', options);
    expect(result).toBe('transcribed text here');
  });

  it('throws on non-ok response with body', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Invalid API key'),
    });

    await expect(openaiProvider.transcribe(audio, 'audio/webm', options)).rejects.toThrow(
      'OpenAI STT failed (401): Invalid API key',
    );
  });

  it('throws when no API key provided', async () => {
    await expect(
      openaiProvider.transcribe(audio, 'audio/webm', { model: 'whisper-1' }),
    ).rejects.toThrow('No API key for OpenAI STT');
  });

  it('uses ogg extension for audio/ogg mime type', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'ogg' }),
    });

    await openaiProvider.transcribe(audio, 'audio/ogg', options);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1].body as FormData;
    const file = body.get('file') as File;
    expect(file.name).toBe('audio.ogg');
  });

  it('uses mp3 extension for audio/mpeg mime type', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'mp3' }),
    });

    await openaiProvider.transcribe(audio, 'audio/mpeg', options);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1].body as FormData;
    const file = body.get('file') as File;
    expect(file.name).toBe('audio.mp3');
  });

  it('uses webm extension for unknown mime types', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'webm' }),
    });

    await openaiProvider.transcribe(audio, 'audio/wav', options);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1].body as FormData;
    const file = body.get('file') as File;
    expect(file.name).toBe('audio.webm');
  });

  it('works with custom base URL', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'custom' }),
    });

    await openaiProvider.transcribe(audio, 'audio/ogg', {
      ...options,
      baseUrl: 'https://custom.api.com/v1',
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://custom.api.com/v1/audio/transcriptions');
  });

  it('appends language to FormData when provided', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'chinese' }),
    });

    await openaiProvider.transcribe(audio, 'audio/ogg', { ...options, language: 'zh' });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1].body as FormData;
    expect(body.get('language')).toBe('zh');
  });

  it('does not append language when empty', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'auto' }),
    });

    await openaiProvider.transcribe(audio, 'audio/ogg', { ...options, language: '' });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1].body as FormData;
    expect(body.get('language')).toBeNull();
  });
});

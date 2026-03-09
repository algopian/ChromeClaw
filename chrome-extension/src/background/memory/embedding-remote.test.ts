import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

import { createRemoteEmbeddingProvider } from './embedding-remote';

const originalFetch = globalThis.fetch;

describe('createRemoteEmbeddingProvider', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends correct POST body to /embeddings endpoint', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
    });

    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://localhost:4141/v1',
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
    });

    await provider.embedQuery('hello');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:4141/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: ['hello'],
        }),
      }),
    );
  });

  it('sets Authorization header when apiKey provided', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [1] }] }),
    });

    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://test.com/v1',
      apiKey: 'sk-test',
      model: 'test',
    });
    await provider.embedQuery('test');

    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer sk-test');
  });

  it('omits Authorization header when apiKey is empty', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [1] }] }),
    });

    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://test.com/v1',
      apiKey: '',
      model: 'test',
    });
    await provider.embedQuery('test');

    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it('returns L2-normalized vectors', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [3, 4] }] }),
    });

    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://test.com/v1',
      apiKey: '',
      model: 'test',
    });
    const vec = await provider.embedQuery('test');

    // [3,4] normalized → [0.6, 0.8]
    expect(vec[0]).toBeCloseTo(0.6);
    expect(vec[1]).toBeCloseTo(0.8);
  });

  it('throws on non-ok response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://test.com/v1',
      apiKey: 'bad',
      model: 'test',
    });

    await expect(provider.embedQuery('test')).rejects.toThrow('Embedding API error 401');
  });

  it('retries on 429 rate limit', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limit exceeded'),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [1, 0] }] }),
    });

    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://test.com/v1',
      apiKey: '',
      model: 'test',
    });
    const vec = await provider.embedQuery('test');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vec.length).toBe(2);
  });

  it('embedBatch returns empty array for empty input', async () => {
    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://test.com/v1',
      apiKey: '',
      model: 'test',
    });
    const result = await provider.embedBatch([]);
    expect(result).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('embedBatch returns multiple vectors', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: [1, 0] }, { embedding: [0, 1] }],
        }),
    });

    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://test.com/v1',
      apiKey: '',
      model: 'test',
    });
    const result = await provider.embedBatch(['hello', 'world']);
    expect(result).toHaveLength(2);
  });

  it('has maxInputTokens for known models', () => {
    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://test.com/v1',
      apiKey: '',
      model: 'text-embedding-3-small',
    });
    expect(provider.maxInputTokens).toBe(8192);
  });

  it('has undefined maxInputTokens for unknown models', () => {
    const provider = createRemoteEmbeddingProvider({
      baseUrl: 'http://test.com/v1',
      apiKey: '',
      model: 'custom-model',
    });
    expect(provider.maxInputTokens).toBeUndefined();
  });
});

/**
 * Tests for web-search.ts — pure utilities, Tavily provider, and dispatcher.
 */
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────

vi.mock('./browser', () => ({
  executeBrowser: vi.fn(),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

vi.mock('@extension/storage', () => ({
  toolConfigStorage: {
    get: vi.fn(),
  },
}));

// Import after mocks
import {
  buildSearchUrl,
  sanitizeQuery,
  simplifyQuery,
  runTavilySearch,
  resolveApiKey,
  executeWebSearch,
  SEARCH_CACHE,
} from './web-search';

import { toolConfigStorage } from '@extension/storage';
import type { WebSearchProviderConfig } from '@extension/storage';

// ── Tests ────────────────────────────────────────────────

describe('web-search utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SEARCH_CACHE.clear();
  });

  // ── buildSearchUrl ──

  describe('buildSearchUrl', () => {
    it('returns Google search URL', () => {
      const url = buildSearchUrl('google', 'hello world');
      expect(url).toBe('https://www.google.com/search?q=hello%20world');
    });

    it('returns Bing search URL', () => {
      const url = buildSearchUrl('bing', 'test query');
      expect(url).toBe('https://www.bing.com/search?q=test%20query');
    });

    it('returns DuckDuckGo search URL', () => {
      const url = buildSearchUrl('duckduckgo', 'privacy search');
      expect(url).toBe('https://html.duckduckgo.com/html/?q=privacy%20search');
    });
  });

  // ── sanitizeQuery ──

  describe('sanitizeQuery', () => {
    it('replaces smart quotes with regular quotes', () => {
      const result = sanitizeQuery('\u201chello\u201d \u2018world\u2019');
      expect(result).toBe('"hello" "world"');
    });

    it('removes excess quoted phrases (keeps max 2)', () => {
      const result = sanitizeQuery('"one" "two" "three" "four"');
      expect(result).toBe('"one" "two" three four');
    });

    it('truncates at word boundary when >200 chars', () => {
      const longQuery = 'word '.repeat(50); // 250 chars
      const result = sanitizeQuery(longQuery);
      expect(result.length).toBeLessThanOrEqual(200);
      // Should end with a complete word (no trailing space after truncation)
      expect(result).toBe(result.trim());
    });

    it('returns trimmed result', () => {
      expect(sanitizeQuery('  hello  ')).toBe('hello');
    });
  });

  // ── simplifyQuery ──

  describe('simplifyQuery', () => {
    it('removes quotes from quoted phrases', () => {
      const result = simplifyQuery('"hello world" test');
      expect(result).toBe('hello world test');
    });

    it('strips special characters (keeps word chars, spaces, hyphens)', () => {
      const result = simplifyQuery('hello!@#$% world-test');
      expect(result).toBe('hello world-test');
    });

    it('truncates to ~100 chars at word boundary', () => {
      const longQuery = 'word '.repeat(25); // 125 chars
      const result = simplifyQuery(longQuery);
      expect(result.length).toBeLessThanOrEqual(100);
    });

    it('collapses whitespace', () => {
      const result = simplifyQuery('hello   world');
      expect(result).toBe('hello world');
    });
  });

  // ── resolveApiKey ──

  describe('resolveApiKey', () => {
    it('returns tavily API key when provider is tavily', () => {
      const config: WebSearchProviderConfig = {
        provider: 'tavily',
        tavily: { apiKey: 'tvly-test-key' },
        browser: { engine: 'google' },
      };
      expect(resolveApiKey(config)).toBe('tvly-test-key');
    });

    it('returns empty string when provider is browser', () => {
      const config: WebSearchProviderConfig = {
        provider: 'browser',
        tavily: { apiKey: '' },
        browser: { engine: 'google' },
      };
      expect(resolveApiKey(config)).toBe('');
    });
  });

  // ── runTavilySearch ──

  describe('runTavilySearch', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns mapped results on success', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { title: 'Result 1', url: 'https://example.com/1', content: 'Snippet 1' },
              { title: 'Result 2', url: 'https://example.com/2', content: 'Snippet 2' },
            ],
          }),
      });

      const results = await runTavilySearch('test query', 5, 'tvly-key');
      expect(results).toEqual([
        { title: 'Result 1', url: 'https://example.com/1', snippet: 'Snippet 1' },
        { title: 'Result 2', url: 'https://example.com/2', snippet: 'Snippet 2' },
      ]);
    });

    it('throws on non-ok response', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid API key'),
      });

      await expect(runTavilySearch('query', 5, 'bad-key')).rejects.toThrow(
        'Tavily Search API error',
      );
    });

    it('returns empty array when results field is missing', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const results = await runTavilySearch('query', 5, 'key');
      expect(results).toEqual([]);
    });
  });

  // ── executeWebSearch ──

  describe('executeWebSearch', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns cached results on cache hit', async () => {
      // Pre-populate cache
      const cacheKey = 'tavily:test query:5';
      const cachedResults = [{ title: 'Cached', url: 'https://cached.com', snippet: 'cached' }];
      SEARCH_CACHE.set(cacheKey, { data: cachedResults, timestamp: Date.now() });

      vi.mocked(toolConfigStorage.get).mockResolvedValue({
        enabledTools: {},
        webSearchConfig: {
          provider: 'tavily',
          tavily: { apiKey: 'key' },
          browser: { engine: 'google' },
        },
      });

      const results = await executeWebSearch({ query: 'test query' });
      expect(results).toEqual(cachedResults);
      // fetch should NOT have been called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('dispatches to tavily when provider is tavily', async () => {
      vi.mocked(toolConfigStorage.get).mockResolvedValue({
        enabledTools: {},
        webSearchConfig: {
          provider: 'tavily',
          tavily: { apiKey: 'tvly-test' },
          browser: { engine: 'google' },
        },
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'T', url: 'https://t.com', content: 'S' }],
          }),
      });

      const results = await executeWebSearch({ query: 'tavily test' });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('T');

      // Verify Tavily API was called
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.tavily.com/search',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws when tavily has no API key', async () => {
      vi.mocked(toolConfigStorage.get).mockResolvedValue({
        enabledTools: {},
        webSearchConfig: {
          provider: 'tavily',
          tavily: { apiKey: '' },
          browser: { engine: 'google' },
        },
      });

      await expect(executeWebSearch({ query: 'no key' })).rejects.toThrow(
        'Tavily API key not configured',
      );
    });

    it('does not cache empty results', async () => {
      vi.mocked(toolConfigStorage.get).mockResolvedValue({
        enabledTools: {},
        webSearchConfig: {
          provider: 'tavily',
          tavily: { apiKey: 'tvly-test' },
          browser: { engine: 'google' },
        },
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });

      const results = await executeWebSearch({ query: 'empty results test' });
      expect(results).toEqual([]);
      expect(SEARCH_CACHE.size).toBe(0);
    });
  });
});

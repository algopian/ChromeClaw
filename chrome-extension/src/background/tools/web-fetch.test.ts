import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('./web-shared', () => ({
  normalizeCacheKey: vi.fn((key: string) => key),
  readCache: vi.fn(() => null),
  writeCache: vi.fn(),
  withTimeout: vi.fn(() => AbortSignal.timeout(30000)),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

const { decodeEntities, extractText, executeWebFetch, FETCH_CACHE } = await import(
  './web-fetch'
);

// ---------------------------------------------------------------------------
// decodeEntities
// ---------------------------------------------------------------------------

describe('decodeEntities', () => {
  it('decodes &amp; &lt; &gt; &quot; &#39;', () => {
    const input = '&amp; &lt; &gt; &quot; &#39;';
    const result = decodeEntities(input);
    expect(result).toBe('& < > " \'');
  });

  it('decodes numeric entities &#123;', () => {
    // &#123; is '{'
    const result = decodeEntities('&#123;');
    expect(result).toBe('{');
  });

  it('decodes hex entities &#x41;', () => {
    // &#x41; is 'A'
    const result = decodeEntities('&#x41;');
    expect(result).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// extractText
// ---------------------------------------------------------------------------

describe('extractText', () => {
  it('strips script/style/nav tags', () => {
    const html = `
      <div>
        <script>alert("xss")</script>
        <style>.red { color: red; }</style>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <p>This is visible content that should remain in the output.</p>
      </div>
    `;
    const result = extractText(html, 50000);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('.red');
    expect(result).not.toContain('Home');
    expect(result).toContain('This is visible content that should remain in the output.');
  });

  it('converts block elements to newlines', () => {
    const html = '<p>Paragraph one content here</p><p>Paragraph two content here</p>';
    const result = extractText(html, 50000);
    expect(result).toContain('Paragraph one content here');
    expect(result).toContain('Paragraph two content here');
    // The paragraphs should be separated by newlines
    expect(result).toMatch(/Paragraph one content here\n+\s*Paragraph two content here/);
  });

  it('respects maxChars limit', () => {
    const html = '<p>' + 'a'.repeat(500) + ' long content that extends</p>';
    const result = extractText(html, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('filters short lines (<15 chars)', () => {
    const html = `
      <div>Short</div>
      <div>This is a long enough line to survive filtering</div>
      <div>Tiny</div>
      <div>Another sufficiently long line that will not be filtered out</div>
    `;
    const result = extractText(html, 50000);
    expect(result).not.toContain('Short');
    expect(result).not.toContain('Tiny');
    expect(result).toContain('This is a long enough line to survive filtering');
    expect(result).toContain('Another sufficiently long line that will not be filtered out');
  });
});

// ---------------------------------------------------------------------------
// executeWebFetch
// ---------------------------------------------------------------------------

describe('executeWebFetch', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    FETCH_CACHE.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches URL and returns text result', async () => {
    const mockHtml = `
      <html>
        <head><title>Test Page Title</title></head>
        <body>
          <p>This is the main content of the test page for extraction.</p>
        </body>
      </html>
    `;
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(mockHtml),
    } as unknown as Response);

    const result = await executeWebFetch({ url: 'https://example.com' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.status).toBe(200);
    expect(result.title).toBe('Test Page Title');
    expect(result.text).toContain('This is the main content of the test page for extraction.');
  });

  it('returns cached result on cache hit', async () => {
    const { readCache } = await import('./web-shared');
    const cachedResult = {
      text: 'cached content that was previously fetched',
      title: 'Cached',
      status: 200,
    };
    vi.mocked(readCache).mockReturnValueOnce(cachedResult);

    const result = await executeWebFetch({ url: 'https://example.com' });

    expect(result).toBe(cachedResult);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('uses html mode when extractMode is html', async () => {
    const rawHtml =
      '<html><head><title>Raw HTML Page</title></head><body><p>Raw paragraph content for testing</p></body></html>';
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(rawHtml),
    } as unknown as Response);

    const result = await executeWebFetch({
      url: 'https://example.com',
      extractMode: 'html',
    });

    expect(result.status).toBe(200);
    // In html mode, the raw HTML is returned (not stripped)
    expect(result.text).toContain('<p>');
    expect(result.text).toContain('Raw paragraph content for testing');
    expect(result.title).toBe('Raw HTML Page');
  });
});

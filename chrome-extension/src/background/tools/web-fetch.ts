// ---------------------------------------------------------------------------
// web_fetch tool — fetch and extract content from a URL.
// ---------------------------------------------------------------------------

import { normalizeCacheKey, readCache, writeCache, withTimeout } from './web-shared';
import { createLogger } from '../logging/logger-buffer';
import { Type } from '@sinclair/typebox';
import type { CacheEntry } from './web-shared';
import type { Static } from '@sinclair/typebox';

const log = createLogger('tool');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const webFetchSchema = Type.Object({
  url: Type.String({ description: 'The URL to fetch content from' }),
  extractMode: Type.Optional(
    Type.Union([Type.Literal('text'), Type.Literal('html')], {
      description: 'Extraction mode: "text" strips HTML (default), "html" returns raw',
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({ description: 'Maximum characters to return (default: 30000)' }),
  ),
});

type WebFetchArgs = Static<typeof webFetchSchema>;

interface WebFetchResult {
  text: string;
  title?: string;
  status: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const FETCH_CACHE = new Map<string, CacheEntry<WebFetchResult>>();
const CACHE_TTL_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHARS = 30_000;

// ---------------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ndash;': '\u2013',
  '&mdash;': '\u2014',
  '&hellip;': '\u2026',
};

const decodeEntities = (text: string): string =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(
      /&(?:amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash|hellip);/g,
      match => HTML_ENTITIES[match] ?? match,
    );

// ---------------------------------------------------------------------------
// HTML → text extraction
// ---------------------------------------------------------------------------

const extractText = (html: string, maxChars: number): string => {
  let text = html;

  // Remove non-content elements entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert block elements to newlines for structure
  text = text.replace(/<\/(?:p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode entities
  text = decodeEntities(text);

  // Normalize whitespace
  text = text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 15) // Filter short lines (nav items, labels)
    .join('\n');

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text.slice(0, maxChars);
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

const executeWebFetch = async (args: WebFetchArgs): Promise<WebFetchResult> => {
  const { url, extractMode, maxChars = DEFAULT_MAX_CHARS } = args;
  log.trace('[webFetch] fetching', { url, extractMode, maxChars });

  // Check cache
  const cacheKey = normalizeCacheKey(`${url}:${extractMode ?? 'text'}:${maxChars}`);
  const cached = readCache(FETCH_CACHE, cacheKey, CACHE_TTL_MS);
  if (cached) {
    log.trace('[webFetch] cache hit', { url });
    return cached;
  }

  const response = await fetch(url, { signal: withTimeout(30) });
  const html = await response.text();

  // Extract title from <title> tag
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1]?.trim() ? decodeEntities(titleMatch[1].trim()) : undefined;

  let text: string;
  if (extractMode === 'html') {
    text = html.slice(0, maxChars);
  } else {
    text = extractText(html, maxChars);
  }

  const result: WebFetchResult = { text, title, status: response.status };

  // Cache successful results
  if (response.ok && text.length > 0) {
    writeCache(FETCH_CACHE, cacheKey, result);
  }

  return result;
};

export { webFetchSchema, executeWebFetch, FETCH_CACHE, extractText, decodeEntities };
export type { WebFetchArgs, WebFetchResult };

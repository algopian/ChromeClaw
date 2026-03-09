/**
 * Tests for media-understanding/providers/index.ts — provider registry.
 * We mock the individual provider modules to avoid chrome.* dependency chains.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the individual providers before importing the registry
vi.mock('./providers/openai', () => ({
  openaiProvider: { id: 'openai', transcribe: vi.fn() },
}));

vi.mock('./providers/transformers', () => ({
  transformersProvider: { id: 'transformers', transcribe: vi.fn() },
}));

const { getProvider, PROVIDERS } = await import('./providers');

describe('STT provider registry', () => {
  it('registers openai and transformers providers', () => {
    expect(PROVIDERS).toHaveLength(2);
    expect(PROVIDERS.map(p => p.id).sort()).toEqual(['openai', 'transformers']);
  });

  it('getProvider("openai") returns the openai provider', () => {
    const provider = getProvider('openai');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('openai');
    expect(typeof provider!.transcribe).toBe('function');
  });

  it('getProvider("transformers") returns the transformers provider', () => {
    const provider = getProvider('transformers');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('transformers');
    expect(typeof provider!.transcribe).toBe('function');
  });

  it('getProvider returns undefined for unknown engine', () => {
    expect(getProvider('whisper-local')).toBeUndefined();
    expect(getProvider('')).toBeUndefined();
    expect(getProvider('google')).toBeUndefined();
  });
});

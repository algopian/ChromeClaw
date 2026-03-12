/**
 * Tests for model-compat.ts
 * Verifies URL-based developer-role compatibility detection.
 */
import { describe, it, expect } from 'vitest';
import type { Api, Model } from '@mariozechner/pi-ai';
import { normalizeModelCompat } from './model-compat';

// ── Helpers ──────────────────────────────────────────────

const makeModel = (overrides: Partial<Model<Api>> = {}): Model<Api> =>
  ({
    id: 'gpt-4o',
    name: 'GPT-4o',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
    ...overrides,
  }) as Model<Api>;

// ── normalizeModelCompat ─────────────────────────────────

describe('normalizeModelCompat', () => {
  // ── Non-openai-completions APIs are untouched ──────────

  it('returns model unchanged for anthropic-messages api', () => {
    const model = makeModel({ api: 'anthropic-messages' });
    expect(normalizeModelCompat(model)).toBe(model);
  });

  it('returns model unchanged for google-generative-ai api', () => {
    const model = makeModel({ api: 'google-generative-ai' });
    expect(normalizeModelCompat(model)).toBe(model);
  });

  it('returns model unchanged for openai-responses api', () => {
    const model = makeModel({ api: 'openai-responses' });
    expect(normalizeModelCompat(model)).toBe(model);
  });

  // ── Native OpenAI endpoint → untouched ─────────────────

  it('leaves native api.openai.com untouched', () => {
    const model = makeModel({ baseUrl: 'https://api.openai.com/v1' });
    expect(normalizeModelCompat(model)).toBe(model);
  });

  it('leaves native api.openai.com with path untouched', () => {
    const model = makeModel({ baseUrl: 'https://api.openai.com/v1/chat/completions' });
    expect(normalizeModelCompat(model)).toBe(model);
  });

  // ── Empty baseUrl → untouched (pi-ai defaults to openai) ──

  it('leaves empty baseUrl untouched', () => {
    const model = makeModel({ baseUrl: '' });
    expect(normalizeModelCompat(model)).toBe(model);
  });

  it('leaves undefined baseUrl untouched', () => {
    const model = makeModel({});
    delete (model as Record<string, unknown>).baseUrl;
    expect(normalizeModelCompat(model)).toBe(model);
  });

  // ── Non-native URLs → forced off ──────────────────────

  it('forces supportsDeveloperRole=false for OpenRouter', () => {
    const model = makeModel({ baseUrl: 'https://openrouter.ai/api/v1' });
    const result = normalizeModelCompat(model);

    expect(result).not.toBe(model);
    expect(result.compat).toEqual({ supportsDeveloperRole: false });
  });

  it('forces supportsDeveloperRole=false for custom proxy', () => {
    const model = makeModel({ baseUrl: 'https://my-proxy.example.com/v1' });
    const result = normalizeModelCompat(model);

    expect(result.compat).toEqual({ supportsDeveloperRole: false });
  });

  it('forces supportsDeveloperRole=false for Azure endpoint', () => {
    const model = makeModel({
      baseUrl: 'https://my-resource.openai.azure.com/openai/deployments/gpt-4o',
    });
    const result = normalizeModelCompat(model);

    expect(result.compat).toEqual({ supportsDeveloperRole: false });
  });

  it('forces supportsDeveloperRole=false for Z.AI', () => {
    const model = makeModel({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4' });
    const result = normalizeModelCompat(model);

    expect(result.compat).toEqual({ supportsDeveloperRole: false });
  });

  it('forces supportsDeveloperRole=false for Moonshot', () => {
    const model = makeModel({ baseUrl: 'https://api.moonshot.cn/v1' });
    const result = normalizeModelCompat(model);

    expect(result.compat).toEqual({ supportsDeveloperRole: false });
  });

  it('forces supportsDeveloperRole=false for DashScope', () => {
    const model = makeModel({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
    const result = normalizeModelCompat(model);

    expect(result.compat).toEqual({ supportsDeveloperRole: false });
  });

  // ── Malformed URLs → forced off ────────────────────────

  it('forces supportsDeveloperRole=false for malformed URL', () => {
    const model = makeModel({ baseUrl: 'not-a-url' });
    const result = normalizeModelCompat(model);

    expect(result.compat).toEqual({ supportsDeveloperRole: false });
  });

  // ── Explicit compat overrides ──────────────────────────

  it('overrides explicit supportsDeveloperRole=true on non-native URL', () => {
    const model = makeModel({
      baseUrl: 'https://my-proxy.example.com/v1',
      compat: { supportsDeveloperRole: true },
    } as Partial<Model<Api>>);
    const result = normalizeModelCompat(model);

    expect(result.compat).toEqual({ supportsDeveloperRole: false });
  });

  it('short-circuits when supportsDeveloperRole is already false', () => {
    const model = makeModel({
      baseUrl: 'https://my-proxy.example.com/v1',
      compat: { supportsDeveloperRole: false },
    } as Partial<Model<Api>>);

    expect(normalizeModelCompat(model)).toBe(model);
  });

  // ── Non-mutation guarantee ─────────────────────────────

  it('does not mutate the original model', () => {
    const model = makeModel({ baseUrl: 'https://my-proxy.example.com/v1' });
    const originalCompat = model.compat;
    normalizeModelCompat(model);

    expect(model.compat).toBe(originalCompat);
  });

  it('preserves existing compat fields when adding supportsDeveloperRole', () => {
    const model = makeModel({
      baseUrl: 'https://my-proxy.example.com/v1',
      compat: { supportsDeveloperRole: true, someOtherField: 'value' },
    } as Partial<Model<Api>>);
    const result = normalizeModelCompat(model);

    expect(result.compat).toEqual({
      supportsDeveloperRole: false,
      someOtherField: 'value',
    });
  });
});

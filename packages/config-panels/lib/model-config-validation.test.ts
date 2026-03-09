import { validateModelForm } from './model-config';
import { describe, expect, it } from 'vitest';

describe('validateModelForm', () => {
  const validForm = {
    name: 'GPT-4o',
    modelId: 'gpt-4o',
    provider: 'openai',
    routingMode: 'direct' as const,
    apiKey: 'sk-1234567890',
  };

  it('accepts a valid form', () => {
    expect(validateModelForm(validForm)).toBeNull();
  });

  it('rejects empty name', () => {
    expect(validateModelForm({ ...validForm, name: '' })).toBe('Name is required');
    expect(validateModelForm({ ...validForm, name: '  ' })).toBe('Name is required');
  });

  it('rejects empty modelId', () => {
    expect(validateModelForm({ ...validForm, modelId: '' })).toBe('Model ID is required');
    expect(validateModelForm({ ...validForm, modelId: '  ' })).toBe('Model ID is required');
  });

  it('rejects empty provider', () => {
    expect(validateModelForm({ ...validForm, provider: '' })).toBe('Provider is required');
  });

  it('rejects direct mode without API key or base URL', () => {
    expect(validateModelForm({ ...validForm, apiKey: '' })).toBe(
      'API key is required (or set a Base URL for auth-free proxies)',
    );
    expect(validateModelForm({ ...validForm, apiKey: undefined })).toBe(
      'API key is required (or set a Base URL for auth-free proxies)',
    );
  });

  it('allows direct mode without API key when base URL is set', () => {
    expect(
      validateModelForm({ ...validForm, apiKey: '', baseUrl: 'http://localhost:4141/v1' }),
    ).toBeNull();
    expect(
      validateModelForm({ ...validForm, apiKey: undefined, baseUrl: 'http://localhost:11434/v1' }),
    ).toBeNull();
  });

  it('accepts local provider without API key or base URL', () => {
    expect(
      validateModelForm({
        name: 'Local Model',
        modelId: 'onnx-community/Qwen3-0.6B-ONNX',
        provider: 'local',
        routingMode: 'direct',
      }),
    ).toBeNull();
    expect(
      validateModelForm({
        name: 'Local Model',
        modelId: 'onnx-community/Qwen3-0.6B-ONNX',
        provider: 'local',
        routingMode: 'direct',
        apiKey: '',
        baseUrl: '',
      }),
    ).toBeNull();
  });

  it('validates base URL format', () => {
    expect(validateModelForm({ ...validForm, baseUrl: 'not-a-url' })).toBe(
      'Base URL must start with http:// or https://',
    );
    expect(validateModelForm({ ...validForm, baseUrl: 'https://api.openai.com/v1' })).toBeNull();
    expect(validateModelForm({ ...validForm, baseUrl: '' })).toBeNull();
  });
});

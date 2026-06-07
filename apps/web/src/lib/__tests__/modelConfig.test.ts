import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearModelConfig,
  getModelConfig,
  getModelConfigValidationError,
  normalizeModelConfig,
  saveModelConfig,
} from '../modelConfig';

describe('modelConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('normalizes a valid hosted provider config', () => {
    expect(
      normalizeModelConfig({
        baseUrl: 'https://openrouter.ai/api/v1/',
        apiKey: ' sk-test ',
        model: ' qwen/qwen3 ',
      }),
    ).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      model: 'qwen/qwen3',
    });
  });

  it('allows plain http for localhost providers', () => {
    expect(
      normalizeModelConfig({
        baseUrl: 'http://localhost:11434/v1/',
        apiKey: '',
        model: 'qwen2.5:14b',
      }),
    ).toEqual({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5:14b',
    });
  });

  it('rejects remote plain-http providers', () => {
    expect(
      getModelConfigValidationError({
        baseUrl: 'http://example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-compat',
      }),
    ).toBe('Use https for remote providers. Plain http is only allowed for local endpoints.');
  });

  it('rejects URLs with embedded credentials or query strings', () => {
    expect(
      getModelConfigValidationError({
        baseUrl: 'https://user:pass@example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-compat',
      }),
    ).toBe('Provider URLs cannot include embedded usernames or passwords.');

    expect(
      getModelConfigValidationError({
        baseUrl: 'https://example.com/v1?foo=bar',
        apiKey: 'sk-test',
        model: 'gpt-compat',
      }),
    ).toBe('Provider base URLs cannot include query strings or fragments.');
  });

  it('persists normalized configs and ignores invalid stored data', () => {
    const saved = saveModelConfig({
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-test',
      model: 'qwen/qwen3',
    });
    expect(saved.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(getModelConfig()).toEqual(saved);

    localStorage.setItem(
      'declaw_model_config',
      JSON.stringify({
        baseUrl: 'http://example.com/v1',
        apiKey: 'sk-test',
        model: 'bad',
      }),
    );
    expect(getModelConfig()).toBeNull();

    clearModelConfig();
    expect(getModelConfig()).toBeNull();
  });
});

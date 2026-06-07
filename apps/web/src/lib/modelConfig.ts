/**
 * @fileoverview User-configurable LLM endpoint settings.
 *
 * Persists the user's chosen API endpoint, key, and model name in
 * localStorage so any OpenAI-compatible inference server (Ollama,
 * OpenRouter, LM Studio, etc.) can be used for analysis.
 */

const STORAGE_KEY = 'declaw_model_config';

/** Settings that describe a user-configured LLM provider. */
export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.endsWith('.local')
  ) {
    return true;
  }

  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map(Number);
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error('Enter a provider base URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid http or https URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https provider URLs are supported.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Provider URLs cannot include embedded usernames or passwords.');
  }

  if (parsed.search || parsed.hash) {
    throw new Error('Provider base URLs cannot include query strings or fragments.');
  }

  if (parsed.protocol === 'http:' && !isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error(
      'Use https for remote providers. Plain http is only allowed for local endpoints.',
    );
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${normalizedPath}`;
}

/**
 * Normalizes and validates a browser-direct model config.
 *
 * @param config - User-entered provider settings.
 * @returns A trimmed, validated configuration safe to persist locally.
 */
export function normalizeModelConfig(config: Partial<ModelConfig>): ModelConfig {
  const model = config.model?.trim();
  if (!model) {
    throw new Error('Enter a model name.');
  }

  return {
    baseUrl: normalizeBaseUrl(config.baseUrl ?? ''),
    apiKey: config.apiKey?.trim() ?? '',
    model,
  };
}

/**
 * Returns a user-facing validation error for a draft config, or null when valid.
 *
 * @param config - User-entered provider settings.
 * @returns The validation error, if any.
 */
export function getModelConfigValidationError(config: Partial<ModelConfig>): string | null {
  try {
    normalizeModelConfig(config);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid model configuration.';
  }
}

/** A named preset the user can click to auto-fill the form. */
export interface ModelPreset {
  label: string;
  baseUrl: string;
  model: string;
  /** Placeholder API key shown in the field (never a real secret). */
  apiKeyPlaceholder: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:14b',
    apiKeyPlaceholder: 'ollama',
  },
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'qwen/qwen3-235b-a22b:free',
    apiKeyPlaceholder: 'sk-or-...',
  },
  {
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: 'qwen2.5-14b-instruct',
    apiKeyPlaceholder: 'lm-studio',
  },
];

/**
 * Returns the saved ModelConfig from localStorage, or null if none exists.
 *
 * @returns The parsed config, or null on missing or malformed data.
 */
export function getModelConfig(): ModelConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeModelConfig(JSON.parse(raw) as Partial<ModelConfig>);
  } catch {
    return null;
  }
}

/**
 * Persists a ModelConfig to localStorage.
 *
 * @param config - The config to save.
 */
export function saveModelConfig(config: ModelConfig): ModelConfig {
  const normalizedConfig = normalizeModelConfig(config);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedConfig));
  return normalizedConfig;
}

/** Removes any saved ModelConfig from localStorage. */
export function clearModelConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

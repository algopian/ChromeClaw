/**
 * URL-based developer-role compatibility detection.
 *
 * Many OpenAI-compatible providers (GLM, vLLM, LMStudio, proxies)
 * reject the "developer" role. Rather than checking the provider label,
 * we inspect the actual baseUrl to decide.
 */

import type { Api, Model, OpenAICompletionsCompat } from '@mariozechner/pi-ai';

const isOpenAINativeEndpoint = (baseUrl: string): boolean => {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
};

export const normalizeModelCompat = (model: Model<Api>): Model<Api> => {
  if (model.api !== 'openai-completions') return model;

  const compat = (model.compat ?? undefined) as OpenAICompletionsCompat | undefined;
  if (compat?.supportsDeveloperRole === false) return model;

  const baseUrl = model.baseUrl ?? '';
  // Empty baseUrl → pi-ai defaults to api.openai.com, so leave untouched
  const needsForce = baseUrl ? !isOpenAINativeEndpoint(baseUrl) : false;
  if (!needsForce) return model;

  return {
    ...model,
    compat: compat
      ? { ...compat, supportsDeveloperRole: false }
      : { supportsDeveloperRole: false },
  } as typeof model;
};

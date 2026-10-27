import { createGoogle } from '@ai-sdk/google';
import type { ProviderOptions } from '@tqc/core';
import type { LanguageModel } from 'ai';

export type ModelEnv = Record<string, string | undefined>;

export interface ModelConfig {
  model: LanguageModel;
  providerOptions: ProviderOptions;
}

const SUPPORTED_PROVIDERS = ['google'] as const;

function required(env: ModelEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === '') throw new Error(`ต้องตั้งค่า ${name}`);
  return value;
}

/**
 * Builds the language model from environment values (passed in explicitly so tests stay hermetic):
 * AI_PROVIDER (default "google"), AI_MODEL, and the provider's own key.
 */
export function getModelConfig(env: ModelEnv): ModelConfig {
  const provider = env.AI_PROVIDER?.trim() || 'google';
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`AI_PROVIDER "${provider}" ไม่รองรับ ค่าที่รองรับ: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }
  const modelId = required(env, 'AI_MODEL');

  const apiKey = required(env, 'GOOGLE_GENERATIVE_AI_API_KEY');
  return { model: createGoogle({ apiKey })(modelId), providerOptions: {} };
}

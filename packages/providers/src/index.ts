import { createGoogle } from '@ai-sdk/google';
import type { ProviderOptions } from '@tqc/core';
import { createGateway, gateway, type LanguageModel } from 'ai';

export type ModelEnv = Record<string, string | undefined>;

export interface ModelConfig {
  model: LanguageModel;
  providerOptions: ProviderOptions;
}

const SUPPORTED_PROVIDERS = ['google', 'gateway'] as const;

function required(env: ModelEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === '') throw new Error(`ต้องตั้งค่า ${name}`);
  return value;
}

/**
 * Builds the language model from environment values (passed in explicitly so tests stay hermetic):
 * AI_PROVIDER ("google" default, or "gateway"), AI_MODEL, and the provider's own key.
 */
export function getModelConfig(env: ModelEnv): ModelConfig {
  const provider = env.AI_PROVIDER?.trim() || 'google';
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`AI_PROVIDER "${provider}" ไม่รองรับ ค่าที่รองรับ: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }
  const modelId = required(env, 'AI_MODEL');

  if (provider === 'gateway') {
    // Vercel AI Gateway authenticates with AI_GATEWAY_API_KEY (the verified path), or with a Vercel OIDC token.
    // An explicit key is passed through. On Vercel (VERCEL is set) the OIDC token may arrive via the
    // x-vercel-oidc-token request header rather than env, so we skip the guard there and let the gateway SDK
    // raise its own auth error. Locally we fail early with a readable message.
    const gatewayKey = env.AI_GATEWAY_API_KEY?.trim() ?? '';
    const onVercel = (env.VERCEL?.trim() ?? '') !== '';
    const hasOidc = (env.VERCEL_OIDC_TOKEN?.trim() ?? '') !== '';
    if (gatewayKey === '' && !hasOidc && !onVercel) {
      throw new Error('ต้องตั้งค่า AI_GATEWAY_API_KEY (หรือ deploy บน Vercel ที่มี OIDC)');
    }
    // disallowPromptTraining: only route to providers that do not train on prompt data.
    const model = gatewayKey !== '' ? createGateway({ apiKey: gatewayKey })(modelId) : gateway(modelId);
    return { model, providerOptions: { gateway: { disallowPromptTraining: true } } };
  }

  const apiKey = required(env, 'GOOGLE_GENERATIVE_AI_API_KEY');
  return { model: createGoogle({ apiKey })(modelId), providerOptions: {} };
}

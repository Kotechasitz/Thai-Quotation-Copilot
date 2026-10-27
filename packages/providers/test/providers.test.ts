import { runMatch } from '@tqc/core';
import { describe, expect, it } from 'vitest';
import { getModelConfig } from '../src/index.ts';

describe('getModelConfig', () => {
  it('defaults AI_PROVIDER to google', () => {
    const cfg = getModelConfig({ AI_MODEL: 'gemini-2.5-flash', GOOGLE_GENERATIVE_AI_API_KEY: 'test-key' });
    expect(cfg.model).toMatchObject({ provider: expect.stringContaining('google'), modelId: 'gemini-2.5-flash' });
  });

  it('accepts AI_PROVIDER=google explicitly and gives empty providerOptions', () => {
    const cfg = getModelConfig({
      AI_PROVIDER: 'google',
      AI_MODEL: 'gemini-2.5-flash',
      GOOGLE_GENERATIVE_AI_API_KEY: 'test-key',
    });
    expect(cfg.providerOptions).toEqual({});
  });

  it('throws a Thai error when AI_MODEL is missing or blank', () => {
    const base = { GOOGLE_GENERATIVE_AI_API_KEY: 'test-key' };
    expect(() => getModelConfig(base)).toThrow('ต้องตั้งค่า AI_MODEL');
    expect(() => getModelConfig({ ...base, AI_MODEL: '  ' })).toThrow('ต้องตั้งค่า AI_MODEL');
  });

  it('throws listing the supported providers for an unknown AI_PROVIDER', () => {
    expect(() => getModelConfig({ AI_PROVIDER: 'foo', AI_MODEL: 'x' })).toThrow(/foo/);
    expect(() => getModelConfig({ AI_PROVIDER: 'foo', AI_MODEL: 'x' })).toThrow(/google, gateway/);
  });

  it('throws when the google API key is missing or blank', () => {
    expect(() => getModelConfig({ AI_MODEL: 'gemini-2.5-flash' })).toThrow(
      'ต้องตั้งค่า GOOGLE_GENERATIVE_AI_API_KEY',
    );
    expect(() => getModelConfig({ AI_MODEL: 'gemini-2.5-flash', GOOGLE_GENERATIVE_AI_API_KEY: ' ' })).toThrow(
      'ต้องตั้งค่า GOOGLE_GENERATIVE_AI_API_KEY',
    );
  });
});

describe('getModelConfig gateway provider', () => {
  const base = { AI_PROVIDER: 'gateway', AI_MODEL: 'anthropic/claude-haiku-5.5' };

  it('builds a gateway model and opts out of prompt training', () => {
    const cfg = getModelConfig({ ...base, AI_GATEWAY_API_KEY: 'test-key' });
    expect(cfg.model).toMatchObject({ provider: expect.stringContaining('gateway'), modelId: 'anthropic/claude-haiku-5.5' });
    expect(cfg.providerOptions).toEqual({ gateway: { disallowPromptTraining: true } });
  });

  it('accepts a Vercel OIDC token instead of an API key', () => {
    const cfg = getModelConfig({ ...base, VERCEL_OIDC_TOKEN: 'oidc-token' });
    expect(cfg.providerOptions.gateway?.disallowPromptTraining).toBe(true);
  });

  it('throws a Thai error when neither AI_GATEWAY_API_KEY nor VERCEL_OIDC_TOKEN is set', () => {
    const message = 'ต้องตั้งค่า AI_GATEWAY_API_KEY (หรือ deploy บน Vercel ที่มี OIDC)';
    expect(() => getModelConfig(base)).toThrow(message);
    expect(() => getModelConfig({ ...base, AI_GATEWAY_API_KEY: ' ', VERCEL_OIDC_TOKEN: '' })).toThrow(message);
  });

  it('on Vercel (VERCEL set) does not require a key or env token: the gateway SDK resolves OIDC itself', () => {
    const cfg = getModelConfig({ ...base, VERCEL: '1' });
    expect(cfg.model).toMatchObject({ modelId: 'anthropic/claude-haiku-5.5' });
    expect(cfg.providerOptions).toEqual({ gateway: { disallowPromptTraining: true } });
  });

  it('on Vercel an explicit AI_GATEWAY_API_KEY is still used', () => {
    const cfg = getModelConfig({ ...base, VERCEL: '1', AI_GATEWAY_API_KEY: 'test-key' });
    expect(cfg.model).toMatchObject({ provider: expect.stringContaining('gateway') });
  });

  it('still requires AI_MODEL', () => {
    expect(() => getModelConfig({ AI_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: 'k' })).toThrow('ต้องตั้งค่า AI_MODEL');
  });
});

describe('getModelConfig output feeds runMatch', () => {
  it('is directly assignable to runMatch args (compile-time drift guard)', () => {
    const cfg = getModelConfig({
      AI_PROVIDER: 'google',
      AI_MODEL: 'x',
      GOOGLE_GENERATIVE_AI_API_KEY: 'test-key',
    });
    const args: Parameters<typeof runMatch>[0] = { ...cfg, inquiry: 'x', catalog: [] };
    expect(args.providerOptions).toEqual({});
    expect(args.model).toBe(cfg.model);
  });
});

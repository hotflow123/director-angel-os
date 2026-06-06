import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "./adapters/openai-compatible.js";

export interface OpenAICompatibleProviderEnvConfig {
  providerId: string;
  baseUrl: string;
  apiKey?: string;
}

export interface ResolveOpenAICompatibleProviderEnvOptions {
  env?: NodeJS.ProcessEnv;
}

export interface CreateOpenAICompatibleProviderFromEnvOptions
  extends ResolveOpenAICompatibleProviderEnvOptions {
  fetchImpl?: OpenAICompatibleProviderOptions["fetchImpl"];
}

function readEnvVar(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function resolveOpenAICompatibleProviderEnv(
  options: ResolveOpenAICompatibleProviderEnvOptions = {},
): OpenAICompatibleProviderEnvConfig | undefined {
  const env = options.env ?? process.env;
  const baseUrl = readEnvVar(env, "HOTFLOW_OPENAI_BASE_URL");
  if (!baseUrl) {
    return undefined;
  }

  const apiKey = readEnvVar(env, "HOTFLOW_OPENAI_API_KEY");
  return {
    providerId: readEnvVar(env, "HOTFLOW_OPENAI_PROVIDER_ID") ?? "openai-compatible",
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
  };
}

export function createOpenAICompatibleProviderFromEnv(
  options: CreateOpenAICompatibleProviderFromEnvOptions = {},
): OpenAICompatibleProvider | undefined {
  const config = resolveOpenAICompatibleProviderEnv(options);
  if (!config) {
    return undefined;
  }

  return new OpenAICompatibleProvider({
    id: config.providerId,
    baseUrl: config.baseUrl,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

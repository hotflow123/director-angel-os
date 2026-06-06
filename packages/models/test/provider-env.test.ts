import { describe, expect, it } from "vitest";

import {
  createOpenAICompatibleProviderFromEnv,
  resolveOpenAICompatibleProviderEnv,
} from "../src/provider-env.js";

describe("resolveOpenAICompatibleProviderEnv", () => {
  it("returns undefined when base URL is not configured", () => {
    expect(resolveOpenAICompatibleProviderEnv({ env: {} })).toBeUndefined();
  });

  it("returns normalized config with defaults", () => {
    const config = resolveOpenAICompatibleProviderEnv({
      env: {
        HOTFLOW_OPENAI_BASE_URL: " https://example.invalid/v1 ",
      },
    });

    expect(config).toEqual({
      providerId: "openai-compatible",
      baseUrl: "https://example.invalid/v1",
    });
  });

  it("uses optional provider id and api key", () => {
    const config = resolveOpenAICompatibleProviderEnv({
      env: {
        HOTFLOW_OPENAI_BASE_URL: "https://example.invalid/v1",
        HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
        HOTFLOW_OPENAI_API_KEY: "secret",
      },
    });

    expect(config).toEqual({
      providerId: "openai-live",
      baseUrl: "https://example.invalid/v1",
      apiKey: "secret",
    });
  });
});

describe("createOpenAICompatibleProviderFromEnv", () => {
  it("returns undefined when env is incomplete", () => {
    const provider = createOpenAICompatibleProviderFromEnv({
      env: {
        HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
      },
    });

    expect(provider).toBeUndefined();
  });

  it("creates provider using env configuration", () => {
    const provider = createOpenAICompatibleProviderFromEnv({
      env: {
        HOTFLOW_OPENAI_BASE_URL: "https://example.invalid/v1",
        HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
      },
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    expect(provider?.id).toBe("openai-live");
  });
});

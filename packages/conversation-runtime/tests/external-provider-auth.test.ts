import { describe, expect, it } from "vitest";

import {
  createBuiltinExternalProviderManifests,
  createExternalProviderAuthRegistry,
  planExternalProviderFallback,
} from "../src/index.js";

describe("external provider auth SecretRefs", () => {
  it("declares MemeFast as a built-in external API provider without exposing secrets", () => {
    const registry = createExternalProviderAuthRegistry({
      manifests: createBuiltinExternalProviderManifests(),
      env: {},
      nowMs: () => 1_778_000_000_000,
    });
    const manifest = registry.getManifest("memefast-api");
    const status = registry.getStatus("memefast-api");

    expect(manifest).toMatchObject({
      id: "memefast-api",
      label: "MemeFast API",
      capabilities: expect.arrayContaining([
        "model.chat",
        "model.vision",
        "media.generate_image",
        "media.generate_video",
        "provider.memefast",
      ]),
      auth: {
        methods: ["api-key"],
        envVars: ["MEMEFAST_API_KEY"],
        apiKeyConfigKeys: ["apiKey"],
      },
      contracts: {
        modelProviders: ["memefast-api"],
        mediaGenerationProviders: ["memefast-api"],
      },
      configFields: expect.arrayContaining([
        expect.objectContaining({ key: "apiKey", kind: "secret", sensitive: true }),
        expect.objectContaining({ key: "baseUrl", kind: "url" }),
        expect.objectContaining({ key: "defaultTextModel", kind: "string" }),
        expect.objectContaining({ key: "defaultImageModel", kind: "string" }),
        expect.objectContaining({ key: "defaultVideoModel", kind: "string" }),
      ]),
      metadata: {
        providerFamily: "model-and-media-generation",
        apiProviderId: "memefast-api",
        defaultBaseUrl: "https://memefast.top",
      },
    });
    expect(status).toMatchObject({
      id: "memefast-api",
      status: "needs-auth",
      configuredSecret: false,
      missingEnvVars: ["MEMEFAST_API_KEY"],
      activeSurface: true,
    });
    expect(JSON.stringify(status)).not.toContain("sk-");
  });

  it("resolves exec SecretRefs through Agent OS host sandbox command runner", () => {
    const runnerCalls: unknown[] = [];
    const runnerMetadata: unknown[] = [];
    const registry = createExternalProviderAuthRegistry({
      manifests: [
        {
          id: "x-twitter",
          label: "X/Twitter",
          description: "X search provider.",
          capabilities: ["x.search"],
          auth: {
            methods: ["api-key"],
            apiKeyConfigKeys: ["bearerToken"],
          },
        },
      ],
      config: {
        providers: {
          "x-twitter": {
            values: {
              bearerToken: {
                source: "exec",
                provider: "localexec",
                id: "x/twitter",
                command: "/usr/bin/vault",
                args: ["read", "x/twitter"],
              },
            },
          },
        },
      },
      execSecretSandbox: {
        cwd: "/workspace/project",
        readableRoots: ["/workspace/project"],
        commandRunner: (request) => {
          runnerCalls.push(request);
          const metadata = { request };
          runnerMetadata.push(metadata);
          return { exitCode: 0, stdout: "sandbox-token\n", metadata };
        },
      },
      now: () => 1_778_000_000_000,
    });

    expect(registry.resolveSecret("x-twitter")).toMatchObject({
      configured: true,
      source: "exec",
      refSource: "exec",
      refProvider: "localexec",
      value: "sandbox-token",
      masked: "sand...oken",
    });
    expect(runnerCalls).toEqual([
      expect.objectContaining({
        backend: "host",
        executable: "/usr/bin/vault",
        argv: ["read", "x/twitter"],
        cwd: "/workspace/project",
      }),
    ]);
    expect(runnerMetadata).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          backend: "host",
          executable: "/usr/bin/vault",
          argv: ["read", "x/twitter"],
          metadata: expect.objectContaining({
            sandboxEvidence: expect.objectContaining({
              backendConfig: expect.objectContaining({
                commandPattern: {
                  executable: "/usr/bin/vault",
                  argv: ["read", "x/twitter"],
                  operationId: "x/twitter",
                },
              }),
            }),
          }),
        }),
      }),
    ]);
    expect(
      (
        runnerMetadata[0] as {
          readonly request?: {
            readonly metadata?: { readonly sandboxEvidence?: { readonly backendConfig?: unknown } };
          };
        }
      ).request?.metadata?.sandboxEvidence?.backendConfig,
    ).not.toHaveProperty("commandPrefix");
  });

  it("binds default exec SecretRef admission to exact executable, argv, and operation id", () => {
    const registry = createExternalProviderAuthRegistry({
      manifests: [
        {
          id: "x-twitter",
          label: "X/Twitter",
          description: "X search provider.",
          capabilities: ["x.search"],
          auth: {
            methods: ["api-key"],
            apiKeyConfigKeys: ["bearerToken"],
          },
        },
      ],
      config: {
        providers: {
          "x-twitter": {
            values: {
              bearerToken: {
                source: "exec",
                provider: "localexec",
                id: "x/twitter",
                command: "/usr/bin/vault",
                args: ["read", "x/twitter"],
              },
            },
          },
        },
      },
      execSecretSandbox: {
        cwd: "/workspace/project",
        readableRoots: ["/workspace/project"],
        allowedCommandPatterns: [
          {
            executable: "/usr/bin/vault",
            argv: ["read", "other-secret"],
            operationId: "x/twitter",
          },
        ],
        commandRunner: () => ({ exitCode: 0, stdout: "should-not-run\n" }),
      },
    });

    expect(registry.resolveSecret("x-twitter")).toMatchObject({
      configured: false,
      source: "exec",
      refSource: "exec",
      refProvider: "localexec",
      error:
        'exec SecretRef provider "localexec" failed sandbox admission: Host sandbox command is not allowed by configured argv patterns',
    });
  });

  it("fails closed when exec SecretRef sandbox options use legacy command prefixes", () => {
    const runnerCalls: unknown[] = [];
    const registry = createExternalProviderAuthRegistry({
      manifests: [
        {
          id: "x-twitter",
          label: "X/Twitter",
          description: "X search provider.",
          capabilities: ["x.search"],
          auth: {
            methods: ["api-key"],
            apiKeyConfigKeys: ["bearerToken"],
          },
        },
      ],
      config: {
        providers: {
          "x-twitter": {
            values: {
              bearerToken: {
                source: "exec",
                provider: "localexec",
                id: "x/twitter",
                command: "/tmp/untrusted-vault",
                args: ["read", "x/twitter"],
              },
            },
          },
        },
      },
      execSecretSandbox: {
        cwd: "/workspace/project",
        readableRoots: ["/workspace/project"],
        allowedCommandPrefixes: ["/usr/bin/vault"],
        commandRunner: (request) => {
          runnerCalls.push(request);
          return { exitCode: 0, stdout: "should-not-run\n" };
        },
      },
    });

    expect(registry.resolveSecret("x-twitter")).toMatchObject({
      configured: false,
      source: "exec",
      refSource: "exec",
      refProvider: "localexec",
      error:
        'exec SecretRef provider "localexec" command prefixes are no longer supported; use allowedCommandPatterns with executable, argv, and operationId',
    });
    expect(runnerCalls).toEqual([]);
  });
});

describe("external provider fallback planning", () => {
  it("selects the first ready fallback without exposing provider secrets", () => {
    const registry = createExternalProviderAuthRegistry({
      manifests: [
        {
          id: "primary-provider",
          label: "Primary Provider",
          description: "Primary model provider.",
          capabilities: ["model.chat"],
          auth: {
            methods: ["api-key"],
            envVars: ["PRIMARY_PROVIDER_API_KEY"],
            apiKeyConfigKeys: ["apiKey"],
          },
        },
        {
          id: "fallback-disabled",
          label: "Fallback Disabled",
          description: "Disabled fallback provider.",
          capabilities: ["model.chat"],
          auth: { methods: ["none"] },
        },
        {
          id: "fallback-ready",
          label: "Fallback Ready",
          description: "Ready fallback provider.",
          capabilities: ["model.chat"],
          auth: {
            methods: ["api-key"],
            envVars: ["FALLBACK_READY_API_KEY"],
            apiKeyConfigKeys: ["apiKey"],
          },
        },
      ],
      config: {
        providers: {
          "fallback-disabled": { enabled: false },
        },
      },
      env: {
        FALLBACK_READY_API_KEY: "sk-ready-provider-secret",
      },
      nowMs: () => 1_778_000_000_000,
    });

    const plan = planExternalProviderFallback(registry, {
      requestedProviderId: "primary-provider",
      fallbackProviderIds: ["fallback-disabled", "fallback-ready"],
    });

    expect(plan).toMatchObject({
      schemaVersion: "conversation-runtime.external-provider-fallback-plan.v1",
      status: "ready",
      requestedProviderId: "primary-provider",
      selectedProviderId: "fallback-ready",
      selectedAttemptIndex: 2,
      usedFallback: true,
      reasonCodes: expect.arrayContaining([
        "requested_provider_not_ready",
        "fallback_provider_ready",
        "used_fallback_provider",
      ]),
    });
    expect(plan.attempts.map((attempt) => attempt.providerId)).toEqual([
      "primary-provider",
      "fallback-disabled",
      "fallback-ready",
    ]);
    expect(plan.attempts.map((attempt) => attempt.status)).toEqual([
      "needs-auth",
      "disabled",
      "ready",
    ]);
    expect(plan.attempts[0]).toMatchObject({
      role: "requested",
      ready: false,
      missingEnvVars: ["PRIMARY_PROVIDER_API_KEY"],
      reasonCodes: expect.arrayContaining(["provider_status_needs-auth"]),
    });
    expect(plan.attempts[2]).toMatchObject({
      role: "fallback",
      ready: true,
      configuredSecret: true,
      configuredSecretSource: "env",
      missingEnvVars: [],
      reasonCodes: expect.arrayContaining(["provider_status_ready"]),
    });
    expect(JSON.stringify(plan)).not.toContain("sk-ready-provider-secret");
    expect(JSON.stringify(plan)).not.toContain("masked");
  });

  it("fails closed with operator next actions when no provider is ready", () => {
    const registry = createExternalProviderAuthRegistry({
      manifests: [
        {
          id: "primary-provider",
          label: "Primary Provider",
          description: "Primary model provider.",
          capabilities: ["model.chat"],
          auth: {
            methods: ["api-key"],
            envVars: ["PRIMARY_PROVIDER_API_KEY"],
            apiKeyConfigKeys: ["apiKey"],
          },
        },
        {
          id: "fallback-provider",
          label: "Fallback Provider",
          description: "Fallback model provider.",
          capabilities: ["model.chat"],
          auth: {
            methods: ["api-key"],
            envVars: ["FALLBACK_PROVIDER_API_KEY"],
            apiKeyConfigKeys: ["apiKey"],
          },
        },
      ],
      env: {},
      nowMs: () => 1_778_000_000_000,
    });

    const plan = planExternalProviderFallback(registry, {
      requestedProviderId: "primary-provider",
      fallbackProviderIds: ["fallback-provider", "missing-provider"],
    });

    expect(plan).toMatchObject({
      schemaVersion: "conversation-runtime.external-provider-fallback-plan.v1",
      status: "blocked",
      requestedProviderId: "primary-provider",
      selectedProviderId: undefined,
      selectedAttemptIndex: undefined,
      usedFallback: false,
      reasonCodes: expect.arrayContaining([
        "requested_provider_not_ready",
        "fallback_provider_not_ready",
        "no_ready_provider",
      ]),
      nextActions: expect.arrayContaining([
        "configure or enable at least one provider before invoking matching tools",
      ]),
    });
    expect(plan.attempts.map((attempt) => attempt.providerId)).toEqual([
      "primary-provider",
      "fallback-provider",
      "missing-provider",
    ]);
    expect(plan.attempts.map((attempt) => attempt.status)).toEqual([
      "needs-auth",
      "needs-auth",
      "missing",
    ]);
    expect(plan.attempts.every((attempt) => attempt.ready === false)).toBe(true);
  });
});

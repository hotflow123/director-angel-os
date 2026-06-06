import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  type AgentOsSandboxAllowedCommandPattern,
  admitAgentOsSandboxExecutionSync,
  createAgentOsHostSandboxBackendAdapter,
  createAgentOsSandboxBackendRegistry,
  executeAgentOsSandboxCommandSync,
  planAgentOsSandboxExecution,
} from "@hotflow/agent-os-sandbox";
import type {
  AgentOsSandboxCommandRunner,
  AgentOsSandboxNetworkPolicy,
} from "@hotflow/agent-os-sandbox";

import type { ExternalToolDoctorResult, ExternalToolDoctorStatus } from "./external-tools.js";

export type ExternalProviderAuthMethod = "api-key" | "oauth" | "none" | (string & {});

export type ExternalProviderConfigValue =
  | string
  | boolean
  | number
  | ExternalProviderSecretRef
  | null
  | undefined;

export interface ExternalProviderSecretRef {
  readonly source: "env" | "exec" | "file" | "inline";
  readonly provider?: string;
  readonly id: string;
  readonly path?: string;
  readonly command?: string;
  readonly args?: readonly string[];
}

export interface ExternalProviderSecretProviderConfig {
  readonly source: "env" | "exec" | "file";
  readonly path?: string;
  readonly mode?: "json" | "singleValue";
  readonly command?: string;
  readonly args?: readonly string[];
}

export interface ExternalProviderAuthManifest {
  readonly methods?: readonly ExternalProviderAuthMethod[];
  readonly envVars?: readonly string[];
  readonly optionalEnvVars?: readonly string[];
  readonly apiKeyConfigKeys?: readonly string[];
}

export interface ExternalProviderUiHint {
  readonly label: string;
  readonly help?: string;
  readonly sensitive?: boolean;
  readonly placeholder?: string;
}

export interface ExternalProviderConfigField {
  readonly key: string;
  readonly label: string;
  readonly kind: "boolean" | "secret" | "string" | "url";
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly placeholder?: string;
  readonly help?: string;
}

export interface ExternalProviderManifest {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly enabledByDefault?: boolean;
  readonly capabilities: readonly string[];
  readonly auth?: ExternalProviderAuthManifest;
  readonly contracts?: Readonly<Record<string, readonly string[]>>;
  readonly configSchema?: Readonly<Record<string, unknown>>;
  readonly configFields?: readonly ExternalProviderConfigField[];
  readonly uiHints?: Readonly<Record<string, ExternalProviderUiHint>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalProviderManifestLoadIssue {
  readonly path?: string;
  readonly id?: string;
  readonly code: string;
  readonly message: string;
}

export interface ExternalProviderStoredConfig {
  readonly enabled?: boolean;
  readonly values?: Readonly<Record<string, ExternalProviderConfigValue>>;
}

export interface ExternalProviderAuthConfig {
  readonly providers?: Readonly<Record<string, ExternalProviderStoredConfig>>;
  readonly secrets?: {
    readonly providers?: Readonly<Record<string, ExternalProviderSecretProviderConfig>>;
    readonly defaults?: Partial<Record<ExternalProviderSecretRef["source"], string>>;
  };
}

export interface ExternalProviderAuthEnvironment {
  readonly get?: (key: string) => string | undefined;
}

export interface ExternalProviderExecSecretSandboxOptions {
  readonly cwd?: string;
  readonly readableRoots?: readonly string[];
  readonly writableRoots?: readonly string[];
  readonly allowedCommandPatterns?: readonly AgentOsSandboxAllowedCommandPattern[];
  readonly networkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly commandRunner?: AgentOsSandboxCommandRunner;
  readonly now?: () => string;
}

export interface ExternalProviderAuthRegistryOptions {
  readonly manifests: readonly ExternalProviderManifest[];
  readonly config?: ExternalProviderAuthConfig;
  readonly env?: ExternalProviderAuthEnvironment | Readonly<Record<string, string | undefined>>;
  readonly execSecretSandbox?: ExternalProviderExecSecretSandboxOptions;
  readonly nowMs?: () => number;
}

export interface ExternalProviderResolvedSecret {
  readonly configured: boolean;
  readonly source?: "config" | "env" | "exec" | "file" | "inline";
  readonly refSource?: ExternalProviderSecretRef["source"];
  readonly refProvider?: string;
  readonly envVar?: string;
  readonly value?: string;
  readonly masked?: string;
  readonly error?: string;
}

export interface ExternalProviderStatus {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly status: ExternalToolDoctorStatus;
  readonly summary: string;
  readonly checkedAtMs: number;
  readonly capabilities: readonly string[];
  readonly configuredSecret: boolean;
  readonly configuredSecretSource?: "config" | "env" | "exec" | "file" | "inline";
  readonly configuredSecretRefSource?: ExternalProviderSecretRef["source"];
  readonly configuredSecretRefProvider?: string;
  readonly configuredSecretEnvVar?: string;
  readonly activeSurface: boolean;
  readonly diagnostics: readonly string[];
  readonly missingEnvVars: readonly string[];
  readonly nextActions: readonly string[];
  readonly uiHints?: Readonly<Record<string, ExternalProviderUiHint>>;
  readonly configFields?: readonly ExternalProviderConfigField[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExternalProviderFallbackPlanStatus = "ready" | "blocked";
export type ExternalProviderFallbackAttemptRole = "requested" | "fallback";

export interface ExternalProviderFallbackPlanInput {
  readonly requestedProviderId: string;
  readonly fallbackProviderIds?: readonly string[];
}

export interface ExternalProviderFallbackAttempt {
  readonly index: number;
  readonly role: ExternalProviderFallbackAttemptRole;
  readonly providerId: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly status: ExternalToolDoctorStatus;
  readonly ready: boolean;
  readonly summary: string;
  readonly checkedAtMs: number;
  readonly capabilities: readonly string[];
  readonly configuredSecret: boolean;
  readonly configuredSecretSource?: ExternalProviderStatus["configuredSecretSource"];
  readonly configuredSecretRefSource?: ExternalProviderStatus["configuredSecretRefSource"];
  readonly configuredSecretRefProvider?: string;
  readonly configuredSecretEnvVar?: string;
  readonly activeSurface: boolean;
  readonly diagnostics: readonly string[];
  readonly missingEnvVars: readonly string[];
  readonly nextActions: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface ExternalProviderFallbackPlan {
  readonly schemaVersion: "conversation-runtime.external-provider-fallback-plan.v1";
  readonly status: ExternalProviderFallbackPlanStatus;
  readonly requestedProviderId: string;
  readonly attempts: readonly ExternalProviderFallbackAttempt[];
  readonly selectedProviderId: string | undefined;
  readonly selectedAttemptIndex: number | undefined;
  readonly usedFallback: boolean;
  readonly reasonCodes: readonly string[];
  readonly nextActions: readonly string[];
}

export class ExternalProviderAuthRegistry {
  readonly #manifests = new Map<string, ExternalProviderManifest>();
  readonly #config: ExternalProviderAuthConfig;
  readonly #env: ExternalProviderAuthEnvironment | Readonly<Record<string, string | undefined>>;
  readonly #execSecretSandbox: ExternalProviderExecSecretSandboxOptions | undefined;
  readonly #nowMs: () => number;

  constructor(options: ExternalProviderAuthRegistryOptions) {
    for (const manifest of options.manifests) {
      this.#manifests.set(manifest.id, normalizeExternalProviderManifest(manifest));
    }
    this.#config = options.config ?? {};
    this.#env = options.env ?? {};
    this.#execSecretSandbox = options.execSecretSandbox;
    this.#nowMs = options.nowMs ?? (() => Date.now());
  }

  listManifests(): readonly ExternalProviderManifest[] {
    return [...this.#manifests.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  getManifest(providerId: string): ExternalProviderManifest | undefined {
    return this.#manifests.get(providerId);
  }

  isEnabled(providerId: string): boolean {
    const manifest = this.#manifests.get(providerId);
    if (manifest === undefined) {
      return false;
    }
    const config = this.#config.providers?.[providerId];
    return config?.enabled ?? manifest.enabledByDefault ?? true;
  }

  resolveValue(providerId: string, key: string): string | undefined {
    const config = this.#config.providers?.[providerId];
    const raw = config?.values?.[key];
    return resolveConfigValue(raw, {
      env: this.#env,
      secrets: this.#config.secrets,
      execSecretSandbox: this.#execSecretSandbox,
    }).value;
  }

  resolveSecret(providerId: string): ExternalProviderResolvedSecret {
    const manifest = this.#manifests.get(providerId);
    if (manifest === undefined) {
      return { configured: false };
    }
    const config = this.#config.providers?.[providerId];
    const configKeys = manifest.auth?.apiKeyConfigKeys ?? ["apiKey"];
    for (const key of configKeys) {
      const raw = config?.values?.[key];
      const resolved = resolveConfigValue(raw, {
        env: this.#env,
        secrets: this.#config.secrets,
        execSecretSandbox: this.#execSecretSandbox,
      });
      if (resolved.error !== undefined) {
        return {
          configured: false,
          ...(resolved.source === undefined ? {} : { source: resolved.source }),
          ...(resolved.refSource === undefined ? {} : { refSource: resolved.refSource }),
          ...(resolved.refProvider === undefined ? {} : { refProvider: resolved.refProvider }),
          error: resolved.error,
        };
      }
      if (resolved.value !== undefined) {
        return {
          configured: true,
          source: resolved.source ?? "config",
          ...(resolved.refSource === undefined ? {} : { refSource: resolved.refSource }),
          ...(resolved.refProvider === undefined ? {} : { refProvider: resolved.refProvider }),
          ...(resolved.envVar === undefined ? {} : { envVar: resolved.envVar }),
          value: resolved.value,
          masked: maskExternalProviderSecret(resolved.value),
        };
      }
    }
    for (const envVar of manifest.auth?.envVars ?? []) {
      const value = readEnvironmentValue(this.#env, envVar);
      if (value !== undefined) {
        return {
          configured: true,
          source: "env",
          envVar,
          value,
          masked: maskExternalProviderSecret(value),
        };
      }
    }
    return { configured: false };
  }

  diagnose(providerId: string): ExternalToolDoctorResult {
    const status = this.getStatus(providerId);
    return {
      status: status.status,
      summary: status.summary,
      checkedAtMs: status.checkedAtMs,
      nextActions: status.nextActions,
      details: {
        providerId: status.id,
        capabilities: status.capabilities,
        configuredSecret: status.configuredSecret,
        configuredSecretSource: status.configuredSecretSource ?? null,
        configuredSecretRefSource: status.configuredSecretRefSource ?? null,
        configuredSecretRefProvider: status.configuredSecretRefProvider ?? null,
        configuredSecretEnvVar: status.configuredSecretEnvVar ?? null,
        activeSurface: status.activeSurface,
        missingEnvVars: status.missingEnvVars,
        diagnostics: status.diagnostics,
      },
    };
  }

  getStatus(providerId: string): ExternalProviderStatus {
    const manifest = this.#manifests.get(providerId);
    const checkedAtMs = this.#nowMs();
    if (manifest === undefined) {
      return {
        id: providerId,
        label: providerId,
        enabled: false,
        status: "missing",
        summary: `External provider ${providerId} is not registered.`,
        checkedAtMs,
        capabilities: [],
        configuredSecret: false,
        activeSurface: false,
        diagnostics: ["provider manifest missing"],
        missingEnvVars: [],
        nextActions: ["register a provider manifest before using this provider"],
      };
    }
    const enabled = this.isEnabled(providerId);
    const activeSurface = enabled;
    const secret = activeSurface
      ? this.resolveSecret(providerId)
      : this.peekConfiguredSecret(providerId, manifest);
    const requiredEnvVars = manifest.auth?.envVars ?? [];
    const missingEnvVars =
      !activeSurface || requiredEnvVars.length === 0 || secret.configured
        ? []
        : requiredEnvVars.filter((envVar) => readEnvironmentValue(this.#env, envVar) === undefined);
    const needsSecret = (manifest.auth?.methods ?? []).some((method) => method !== "none");
    const status: ExternalToolDoctorStatus =
      enabled === false
        ? "disabled"
        : secret.error !== undefined
          ? "misconfigured"
          : needsSecret && !secret.configured
            ? "needs-auth"
            : "ready";
    const diagnostics = createExternalProviderDiagnostics({
      activeSurface,
      missingEnvVars,
      secret,
    });
    const summary =
      status === "disabled"
        ? `${manifest.label} provider is disabled.`
        : status === "misconfigured"
          ? `${manifest.label} provider credential reference is invalid.`
          : status === "needs-auth"
            ? `${manifest.label} provider needs credentials.`
            : `${manifest.label} provider is configured.`;
    return {
      id: manifest.id,
      label: manifest.label,
      enabled,
      status,
      summary,
      checkedAtMs,
      capabilities: manifest.capabilities,
      configuredSecret: secret.configured,
      ...(secret.source === undefined ? {} : { configuredSecretSource: secret.source }),
      ...(secret.refSource === undefined ? {} : { configuredSecretRefSource: secret.refSource }),
      ...(secret.refProvider === undefined
        ? {}
        : { configuredSecretRefProvider: secret.refProvider }),
      ...(secret.envVar === undefined ? {} : { configuredSecretEnvVar: secret.envVar }),
      activeSurface,
      diagnostics,
      missingEnvVars,
      nextActions:
        status === "ready"
          ? ["provider can be used by matching runtime tools"]
          : status === "disabled"
            ? ["enable the provider before invoking matching tools"]
            : status === "misconfigured"
              ? ["fix the provider SecretRef or replace it with env/file/exec/inline config"]
              : createNeedsAuthNextActions(manifest, missingEnvVars),
      ...(manifest.uiHints === undefined ? {} : { uiHints: manifest.uiHints }),
      ...(manifest.configFields === undefined ? {} : { configFields: manifest.configFields }),
      ...(manifest.metadata === undefined ? {} : { metadata: manifest.metadata }),
    };
  }

  listStatuses(): readonly ExternalProviderStatus[] {
    return this.listManifests().map((manifest) => this.getStatus(manifest.id));
  }

  private peekConfiguredSecret(
    providerId: string,
    manifest: ExternalProviderManifest,
  ): ExternalProviderResolvedSecret {
    const config = this.#config.providers?.[providerId];
    const configKeys = manifest.auth?.apiKeyConfigKeys ?? ["apiKey"];
    for (const key of configKeys) {
      const raw = config?.values?.[key];
      const peek = peekConfigSecretValue(raw);
      if (peek.configured) {
        return peek;
      }
    }
    return { configured: false };
  }
}

export function createExternalProviderAuthRegistry(
  options: ExternalProviderAuthRegistryOptions,
): ExternalProviderAuthRegistry {
  return new ExternalProviderAuthRegistry(options);
}

export function planExternalProviderFallback(
  registry: ExternalProviderAuthRegistry,
  input: ExternalProviderFallbackPlanInput,
): ExternalProviderFallbackPlan {
  const providerIds = createOrderedExternalProviderFallbackIds(input);
  const attempts = providerIds.map((providerId, index) =>
    createExternalProviderFallbackAttempt({
      status: registry.getStatus(providerId),
      index,
      role: index === 0 ? "requested" : "fallback",
    }),
  );
  const selectedAttempt = attempts.find((attempt) => attempt.ready);
  const requestedAttempt = attempts[0];
  const usedFallback = selectedAttempt !== undefined && selectedAttempt.index > 0;
  const reasonCodes = createExternalProviderFallbackPlanReasonCodes({
    attempts,
    selectedAttempt,
    requestedAttempt,
  });
  return {
    schemaVersion: "conversation-runtime.external-provider-fallback-plan.v1",
    status: selectedAttempt === undefined ? "blocked" : "ready",
    requestedProviderId: input.requestedProviderId,
    attempts,
    selectedProviderId: selectedAttempt?.providerId,
    selectedAttemptIndex: selectedAttempt?.index,
    usedFallback,
    reasonCodes,
    nextActions:
      selectedAttempt === undefined
        ? createBlockedExternalProviderFallbackNextActions(attempts)
        : selectedAttempt.nextActions,
  };
}

export function createBuiltinExternalProviderManifests(): readonly ExternalProviderManifest[] {
  return [
    {
      id: "duckduckgo",
      label: "DuckDuckGo",
      description: "Built-in no-key public web search fallback.",
      enabledByDefault: true,
      capabilities: ["web.search"],
      auth: {
        methods: ["none"],
      },
      contracts: {
        webSearchProviders: ["duckduckgo"],
      },
      metadata: {
        localDefault: true,
        providerFamily: "web-search",
      },
    },
    {
      id: "sogou-weixin",
      label: "Sogou Weixin",
      description: "Built-in WeChat public account article search provider.",
      enabledByDefault: true,
      capabilities: ["web.search", "weixin.article.search"],
      auth: {
        methods: ["none"],
      },
      contracts: {
        webSearchProviders: ["sogou-weixin"],
      },
      metadata: {
        localDefault: true,
        providerFamily: "web-search",
      },
    },
    {
      id: "x-twitter",
      label: "X/Twitter",
      description: "Read-only X/Twitter recent post search provider.",
      enabledByDefault: true,
      capabilities: ["x.search", "social.search"],
      auth: {
        methods: ["api-key"],
        envVars: ["X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN"],
        apiKeyConfigKeys: ["bearerToken", "apiKey"],
      },
      contracts: {
        socialSearchProviders: ["x-twitter"],
      },
      configFields: [
        {
          key: "enabled",
          label: "启用",
          kind: "boolean",
        },
        {
          key: "bearerToken",
          label: "Bearer Token",
          kind: "secret",
          sensitive: true,
          placeholder: "env:X_BEARER_TOKEN",
          help: "用于只读 recent search；建议优先使用环境变量或 SecretRef。",
        },
      ],
      uiHints: {
        "xSearch.bearerToken": {
          label: "X/Twitter Bearer Token",
          help: "X API v2 app-only bearer token. Fallback: X_BEARER_TOKEN or TWITTER_BEARER_TOKEN.",
          sensitive: true,
          placeholder: "AAAAAAAA...",
        },
      },
      metadata: {
        providerFamily: "social-search",
        readOnlyDefault: true,
      },
    },
    {
      id: "memefast-api",
      label: "MemeFast API",
      description: "MemeFast OpenAI-compatible model, image, and video generation provider.",
      enabledByDefault: true,
      capabilities: [
        "model.chat",
        "model.vision",
        "media.generate_image",
        "media.generate_video",
        "provider.memefast",
      ],
      auth: {
        methods: ["api-key"],
        envVars: ["MEMEFAST_API_KEY"],
        apiKeyConfigKeys: ["apiKey"],
      },
      contracts: {
        modelProviders: ["memefast-api"],
        mediaGenerationProviders: ["memefast-api"],
      },
      configFields: [
        {
          key: "enabled",
          label: "启用",
          kind: "boolean",
        },
        {
          key: "apiKey",
          label: "API Key",
          kind: "secret",
          required: true,
          sensitive: true,
          placeholder: "env:MEMEFAST_API_KEY",
          help: "用于 MemeFast Authorization Bearer；建议优先使用环境变量或 SecretRef。",
        },
        {
          key: "baseUrl",
          label: "Base URL",
          kind: "url",
          placeholder: "https://memefast.top",
        },
        {
          key: "defaultTextModel",
          label: "默认文本模型",
          kind: "string",
          placeholder: "gemini-2.5-flash",
        },
        {
          key: "defaultImageModel",
          label: "默认图片模型",
          kind: "string",
          placeholder: "从 Moyin/供应方配置中选择",
        },
        {
          key: "defaultVideoModel",
          label: "默认视频模型",
          kind: "string",
          placeholder: "从 Moyin/供应方配置中选择",
        },
      ],
      uiHints: {
        "memefast.apiKey": {
          label: "MemeFast API Key",
          help: "MemeFast API key. Fallback: MEMEFAST_API_KEY.",
          sensitive: true,
          placeholder: "使用环境变量或 SecretRef",
        },
      },
      metadata: {
        providerFamily: "model-and-media-generation",
        apiProviderId: "memefast-api",
        defaultBaseUrl: "https://memefast.top",
      },
    },
  ];
}

export function createExternalProviderManifestFromOpenClawPlugin(
  plugin: unknown,
): ExternalProviderManifest | undefined {
  if (!isRecord(plugin) || typeof plugin.id !== "string" || plugin.id.trim().length === 0) {
    return undefined;
  }
  const id = plugin.id.trim();
  const setupProviders = Array.isArray(plugin.setup)
    ? []
    : isRecord(plugin.setup) && Array.isArray(plugin.setup.providers)
      ? plugin.setup.providers
      : [];
  const providerAuthEnvVars = isRecord(plugin.providerAuthEnvVars)
    ? plugin.providerAuthEnvVars
    : {};
  const setupProvider = setupProviders.find((provider) => isRecord(provider) && provider.id === id);
  const envVars = normalizeStringList([
    ...readStringArray(providerAuthEnvVars[id]),
    ...readStringArray(isRecord(setupProvider) ? setupProvider.envVars : undefined),
  ]);
  const authMethods = normalizeStringList(
    readStringArray(isRecord(setupProvider) ? setupProvider.authMethods : undefined),
  );
  const contracts = isRecord(plugin.contracts)
    ? normalizeExternalProviderContracts(plugin.contracts)
    : undefined;
  const uiHints = isRecord(plugin.uiHints)
    ? normalizeExternalProviderUiHints(plugin.uiHints)
    : undefined;
  const configFields = inferExternalProviderConfigFields({
    id,
    envVars,
    ...(uiHints === undefined ? {} : { uiHints }),
  });
  return normalizeExternalProviderManifest({
    id,
    label: formatExternalProviderLabel(id),
    description: `${formatExternalProviderLabel(id)} external provider loaded from provider manifest.`,
    enabledByDefault: false,
    capabilities: inferExternalProviderCapabilities(contracts),
    auth: {
      methods: authMethods.length > 0 ? authMethods : envVars.length > 0 ? ["api-key"] : ["none"],
      ...(envVars.length === 0 ? {} : { envVars }),
      apiKeyConfigKeys: ["apiKey", "bearerToken"],
    },
    ...(contracts === undefined ? {} : { contracts }),
    ...(isRecord(plugin.configSchema) ? { configSchema: plugin.configSchema } : {}),
    ...(configFields.length === 0 ? {} : { configFields }),
    ...(uiHints === undefined ? {} : { uiHints }),
    metadata: {
      providerFamily: inferExternalProviderFamily(contracts),
      manifestFormat: "openclaw.plugin",
      localDefault: false,
    },
  });
}

export function validateExternalProviderManifest(
  manifest: ExternalProviderManifest,
): readonly ExternalProviderManifestLoadIssue[] {
  const issues: ExternalProviderManifestLoadIssue[] = [];
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(manifest.id)) {
    issues.push({
      id: manifest.id,
      code: "invalid-provider-id",
      message: `Provider id "${manifest.id}" must match ^[a-z][a-z0-9_-]{0,63}$.`,
    });
  }
  if (manifest.capabilities.length === 0) {
    issues.push({
      id: manifest.id,
      code: "missing-capabilities",
      message: `Provider "${manifest.id}" must declare at least one capability.`,
    });
  }
  for (const envVar of manifest.auth?.envVars ?? []) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(envVar)) {
      issues.push({
        id: manifest.id,
        code: "invalid-env-var",
        message: `Provider "${manifest.id}" env var "${envVar}" is invalid.`,
      });
    }
  }
  return issues;
}

export function maskExternalProviderSecret(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return "";
  }
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function normalizeExternalProviderManifest(
  manifest: ExternalProviderManifest,
): ExternalProviderManifest {
  return {
    ...manifest,
    id: manifest.id.trim(),
    label: manifest.label.trim() || manifest.id.trim(),
    description: manifest.description.trim(),
    capabilities: normalizeStringList(manifest.capabilities),
    ...(manifest.auth === undefined
      ? {}
      : {
          auth: {
            ...(manifest.auth.methods === undefined
              ? {}
              : { methods: normalizeStringList(manifest.auth.methods) }),
            ...(manifest.auth.envVars === undefined
              ? {}
              : { envVars: normalizeStringList(manifest.auth.envVars) }),
            ...(manifest.auth.optionalEnvVars === undefined
              ? {}
              : { optionalEnvVars: normalizeStringList(manifest.auth.optionalEnvVars) }),
            ...(manifest.auth.apiKeyConfigKeys === undefined
              ? {}
              : { apiKeyConfigKeys: normalizeStringList(manifest.auth.apiKeyConfigKeys) }),
          },
        }),
  };
}

function createOrderedExternalProviderFallbackIds(
  input: ExternalProviderFallbackPlanInput,
): readonly string[] {
  const ids: string[] = [];
  for (const id of [input.requestedProviderId, ...(input.fallbackProviderIds ?? [])]) {
    const normalized = id.trim();
    if (normalized.length === 0 || ids.includes(normalized)) {
      continue;
    }
    ids.push(normalized);
  }
  return ids;
}

function createExternalProviderFallbackAttempt(input: {
  readonly status: ExternalProviderStatus;
  readonly index: number;
  readonly role: ExternalProviderFallbackAttemptRole;
}): ExternalProviderFallbackAttempt {
  const ready = input.status.status === "ready";
  const reasonCodes = [`provider_status_${input.status.status}`];
  return {
    index: input.index,
    role: input.role,
    providerId: input.status.id,
    label: input.status.label,
    enabled: input.status.enabled,
    status: input.status.status,
    ready,
    summary: input.status.summary,
    checkedAtMs: input.status.checkedAtMs,
    capabilities: input.status.capabilities,
    configuredSecret: input.status.configuredSecret,
    ...(input.status.configuredSecretSource === undefined
      ? {}
      : { configuredSecretSource: input.status.configuredSecretSource }),
    ...(input.status.configuredSecretRefSource === undefined
      ? {}
      : { configuredSecretRefSource: input.status.configuredSecretRefSource }),
    ...(input.status.configuredSecretRefProvider === undefined
      ? {}
      : { configuredSecretRefProvider: input.status.configuredSecretRefProvider }),
    ...(input.status.configuredSecretEnvVar === undefined
      ? {}
      : { configuredSecretEnvVar: input.status.configuredSecretEnvVar }),
    activeSurface: input.status.activeSurface,
    diagnostics: input.status.diagnostics,
    missingEnvVars: input.status.missingEnvVars,
    nextActions: input.status.nextActions,
    reasonCodes,
  };
}

function createExternalProviderFallbackPlanReasonCodes(input: {
  readonly attempts: readonly ExternalProviderFallbackAttempt[];
  readonly selectedAttempt: ExternalProviderFallbackAttempt | undefined;
  readonly requestedAttempt: ExternalProviderFallbackAttempt | undefined;
}): readonly string[] {
  const codes = new Set<string>();
  if (input.requestedAttempt?.ready === true) {
    codes.add("requested_provider_ready");
  } else {
    codes.add("requested_provider_not_ready");
  }
  if (input.attempts.slice(1).some((attempt) => attempt.ready)) {
    codes.add("fallback_provider_ready");
  }
  if (input.attempts.slice(1).some((attempt) => !attempt.ready)) {
    codes.add("fallback_provider_not_ready");
  }
  if (input.selectedAttempt === undefined) {
    codes.add("no_ready_provider");
  } else if (input.selectedAttempt.index > 0) {
    codes.add("used_fallback_provider");
  }
  return [...codes];
}

function createBlockedExternalProviderFallbackNextActions(
  attempts: readonly ExternalProviderFallbackAttempt[],
): readonly string[] {
  const actions = new Set<string>([
    "configure or enable at least one provider before invoking matching tools",
  ]);
  for (const attempt of attempts) {
    for (const action of attempt.nextActions) {
      actions.add(`${attempt.providerId}: ${action}`);
    }
  }
  return [...actions];
}

interface ResolvedConfigValue {
  readonly value?: string;
  readonly source?: ExternalProviderResolvedSecret["source"];
  readonly refSource?: ExternalProviderSecretRef["source"];
  readonly refProvider?: string;
  readonly envVar?: string;
  readonly error?: string;
}

interface ResolveConfigValueContext {
  readonly env: ExternalProviderAuthEnvironment | Readonly<Record<string, string | undefined>>;
  readonly secrets?: ExternalProviderAuthConfig["secrets"];
  readonly execSecretSandbox?: ExternalProviderExecSecretSandboxOptions | undefined;
}

function resolveConfigValue(
  value: ExternalProviderConfigValue,
  context: ResolveConfigValueContext,
): ResolvedConfigValue {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return {};
    }
    if (normalized.startsWith("env:")) {
      const envVar = normalized.slice("env:".length).trim();
      const envValue = readEnvironmentValue(context.env, envVar);
      return {
        ...(envValue === undefined ? {} : { value: envValue }),
        source: "env",
        refSource: "env",
        refProvider: "default",
        envVar,
      };
    }
    return { value: normalized, source: "config", refSource: "inline", refProvider: "inline" };
  }
  if (isEnvSecretRef(value)) {
    const validationError = validateEnvSecretRef(value);
    if (validationError !== undefined) {
      return createSecretRefError(value, validationError);
    }
    const envValue = readEnvironmentValue(context.env, value.id);
    return {
      ...(envValue === undefined ? {} : { value: envValue }),
      source: "env",
      refSource: "env",
      refProvider: value.provider ?? "default",
      envVar: value.id,
    };
  }
  if (isInlineSecretRef(value)) {
    const inlineValue = value.id.trim();
    return {
      ...(inlineValue.length === 0 ? {} : { value: inlineValue }),
      source: "inline",
      refSource: "inline",
      refProvider: value.provider ?? "inline",
    };
  }
  if (isFileSecretRef(value)) {
    return resolveFileSecretRef(value, context.secrets);
  }
  if (isExecSecretRef(value)) {
    return resolveExecSecretRef(value, context.secrets, context.execSecretSandbox);
  }
  return {};
}

function peekConfigSecretValue(value: ExternalProviderConfigValue): ExternalProviderResolvedSecret {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return { configured: false };
    }
    if (normalized.startsWith("env:")) {
      const envVar = normalized.slice("env:".length).trim();
      return {
        configured: true,
        source: "env",
        refSource: "env",
        refProvider: "default",
        envVar,
      };
    }
    return {
      configured: true,
      source: "config",
      refSource: "inline",
      refProvider: "inline",
    };
  }
  if (
    isEnvSecretRef(value) ||
    isInlineSecretRef(value) ||
    isFileSecretRef(value) ||
    isExecSecretRef(value)
  ) {
    return {
      configured: true,
      source: value.source === "inline" ? "inline" : value.source,
      refSource: value.source,
      refProvider: value.provider ?? "default",
      ...(value.source === "env" ? { envVar: value.id } : {}),
    };
  }
  return { configured: false };
}

function readEnvironmentValue(
  env: ExternalProviderAuthEnvironment | Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const normalizedKey = key.trim();
  if (normalizedKey.length === 0) {
    return undefined;
  }
  const value =
    typeof (env as ExternalProviderAuthEnvironment).get === "function"
      ? (env as ExternalProviderAuthEnvironment).get?.(normalizedKey)
      : (env as Readonly<Record<string, string | undefined>>)[normalizedKey];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isEnvSecretRef(value: unknown): value is ExternalProviderSecretRef & { source: "env" } {
  return isRecord(value) && value.source === "env" && typeof value.id === "string";
}

function isInlineSecretRef(
  value: unknown,
): value is ExternalProviderSecretRef & { source: "inline" } {
  return isRecord(value) && value.source === "inline" && typeof value.id === "string";
}

function isFileSecretRef(value: unknown): value is ExternalProviderSecretRef & { source: "file" } {
  return isRecord(value) && value.source === "file" && typeof value.id === "string";
}

function isExecSecretRef(value: unknown): value is ExternalProviderSecretRef & { source: "exec" } {
  return isRecord(value) && value.source === "exec" && typeof value.id === "string";
}

function resolveFileSecretRef(
  ref: ExternalProviderSecretRef & { source: "file" },
  secrets: ExternalProviderAuthConfig["secrets"],
): ResolvedConfigValue {
  const validationError = validateFileSecretRef(ref);
  if (validationError !== undefined) {
    return createSecretRefError(ref, validationError);
  }
  const provider = ref.provider ?? secrets?.defaults?.file ?? "default";
  const providerConfig = readSecretProviderConfig(secrets, provider, "file");
  const path = ref.path?.trim() || providerConfig?.path?.trim();
  if (path === undefined || path.length === 0) {
    return createSecretRefError(
      ref,
      `file SecretRef provider "${provider}" needs an absolute path`,
    );
  }
  if (!isAbsolute(path)) {
    return createSecretRefError(ref, `file SecretRef provider "${provider}" path must be absolute`);
  }
  try {
    const body = readFileSync(path, "utf8");
    const mode =
      ref.id === "value"
        ? (providerConfig?.mode ?? "singleValue")
        : (providerConfig?.mode ?? "json");
    const value =
      mode === "singleValue" ? body.trim() : readJsonPointerSecret(JSON.parse(body), ref.id);
    const normalized = value.trim();
    return {
      ...(normalized.length === 0 ? {} : { value: normalized }),
      source: "file",
      refSource: "file",
      refProvider: provider,
    };
  } catch (error) {
    return createSecretRefError(
      ref,
      `file SecretRef provider "${provider}" failed to resolve: ${toSafeErrorMessage(error)}`,
    );
  }
}

function resolveExecSecretRef(
  ref: ExternalProviderSecretRef & { source: "exec" },
  secrets: ExternalProviderAuthConfig["secrets"],
  sandboxOptions: ExternalProviderExecSecretSandboxOptions | undefined,
): ResolvedConfigValue {
  const validationError = validateExecSecretRef(ref);
  if (validationError !== undefined) {
    return createSecretRefError(ref, validationError);
  }
  const provider = ref.provider ?? secrets?.defaults?.exec ?? "default";
  const providerConfig = readSecretProviderConfig(secrets, provider, "exec");
  const command = ref.command?.trim() || providerConfig?.command?.trim();
  const args = ref.args ?? providerConfig?.args ?? [ref.id];
  if (command === undefined || command.length === 0) {
    return createSecretRefError(
      ref,
      `exec SecretRef provider "${provider}" needs an absolute command`,
    );
  }
  if (!isAbsolute(command)) {
    return createSecretRefError(
      ref,
      `exec SecretRef provider "${provider}" command must be absolute`,
    );
  }
  if (!args.every((arg) => typeof arg === "string")) {
    return createSecretRefError(ref, `exec SecretRef provider "${provider}" args must be strings`);
  }
  return resolveExecSecretRefWithSandbox({
    ref,
    provider,
    command,
    args,
    sandboxOptions: {
      ...(sandboxOptions ?? {}),
      commandRunner: sandboxOptions?.commandRunner ?? createDefaultExecSecretSandboxCommandRunner(),
    },
  });
}

function resolveExecSecretRefWithSandbox(input: {
  readonly ref: ExternalProviderSecretRef & { source: "exec" };
  readonly provider: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly sandboxOptions: ExternalProviderExecSecretSandboxOptions;
}): ResolvedConfigValue {
  const legacyAllowedCommandPrefixes = readLegacyExecSecretAllowedCommandPrefixes(
    input.sandboxOptions,
  );
  if (legacyAllowedCommandPrefixes !== undefined) {
    return createSecretRefError(
      input.ref,
      `exec SecretRef provider "${input.provider}" command prefixes are no longer supported; use allowedCommandPatterns with executable, argv, and operationId`,
    );
  }
  const cwd = input.sandboxOptions.cwd ?? process.cwd();
  const readableRoots =
    input.sandboxOptions.readableRoots ?? (cwd.trim().length === 0 ? [] : [cwd]);
  const networkPolicy = input.sandboxOptions.networkPolicy ?? "none";
  const commandText = formatExecSecretSandboxCommand(input.command, input.args);
  const commandRunner =
    input.sandboxOptions.commandRunner ?? createDefaultExecSecretSandboxCommandRunner();
  const allowedCommandPatterns =
    input.sandboxOptions.allowedCommandPatterns === undefined ||
    input.sandboxOptions.allowedCommandPatterns.length === 0
      ? [
          {
            executable: input.command,
            argv: input.args,
            operationId: input.ref.id,
          },
        ]
      : input.sandboxOptions.allowedCommandPatterns;
  const registry = createAgentOsSandboxBackendRegistry({
    enabledBackends: ["host"],
    adapters: [
      createAgentOsHostSandboxBackendAdapter({
        allowHostExecution: true,
        allowedCommandPatterns,
        networkPolicy,
        commandRunner,
        includeSandboxEvidenceInRunnerRequest: true,
      }),
    ],
  });
  const now = input.sandboxOptions.now ?? (() => new Date().toISOString());
  const plan = planAgentOsSandboxExecution({
    toolName: "external-provider-secretref.exec",
    operationId: input.ref.id,
    providerId: `external-provider-auth:${input.provider}`,
    cwd,
    command: commandText,
    argv: input.args,
    requestedNetworkPolicy: networkPolicy,
    preflight: {
      verdict: "allow",
      sandboxMode: "host",
      checkedAt: now(),
      providerId: `external-provider-auth:${input.provider}`,
      reason: "External provider exec SecretRef is routed through Agent OS host sandbox backend.",
    },
    policy: {
      enabledBackends: ["host"],
      readableRoots,
      writableRoots: input.sandboxOptions.writableRoots ?? [],
      networkPolicy,
    },
  });
  const admission = admitAgentOsSandboxExecutionSync(plan, { registry, now });
  if (!admission.ok) {
    return createSecretRefError(
      input.ref,
      `exec SecretRef provider "${input.provider}" failed sandbox admission: ${
        admission.reason ?? admission.error ?? "unknown sandbox admission failure"
      }`,
    );
  }
  const execution = executeAgentOsSandboxCommandSync(plan, admission, { registry, now });
  if (!execution.ok || execution.exitCode !== 0) {
    return createSecretRefError(
      input.ref,
      `exec SecretRef provider "${input.provider}" failed sandbox execution: ${
        execution.reason ??
        execution.stderr?.trim() ??
        execution.error ??
        `exit ${execution.exitCode ?? "unknown"}`
      }`,
    );
  }
  const value = (execution.stdout ?? "").trim();
  return {
    ...(value.length === 0 ? {} : { value }),
    source: "exec",
    refSource: "exec",
    refProvider: input.provider,
  };
}

function readLegacyExecSecretAllowedCommandPrefixes(
  sandboxOptions: ExternalProviderExecSecretSandboxOptions,
): readonly string[] | undefined {
  const value = (sandboxOptions as { readonly allowedCommandPrefixes?: unknown })
    .allowedCommandPrefixes;
  return Array.isArray(value) && value.length > 0 ? value.map(String) : undefined;
}

function createDefaultExecSecretSandboxCommandRunner(): AgentOsSandboxCommandRunner {
  return (request) => {
    try {
      const stdout = execFileSync(request.executable, [...request.argv], {
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        ...(request.env === undefined ? {} : { env: { ...process.env, ...request.env } }),
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return {
        exitCode: 0,
        stdout,
        stderr: "",
      };
    } catch (error) {
      return {
        exitCode: readChildProcessExitCode(error),
        stdout:
          typeof (error as { readonly stdout?: unknown })?.stdout === "string"
            ? (error as { readonly stdout: string }).stdout
            : "",
        stderr:
          typeof (error as { readonly stderr?: unknown })?.stderr === "string"
            ? (error as { readonly stderr: string }).stderr
            : toSafeErrorMessage(error),
      };
    }
  };
}

function formatExecSecretSandboxCommand(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(" ");
}

function readChildProcessExitCode(error: unknown): number {
  const record = isRecord(error) ? error : {};
  const status = record.status;
  const code = record.code;
  return typeof status === "number" && Number.isFinite(status)
    ? status
    : typeof code === "number" && Number.isFinite(code)
      ? code
      : 1;
}

function readSecretProviderConfig(
  secrets: ExternalProviderAuthConfig["secrets"],
  provider: string,
  source: "file" | "exec",
): ExternalProviderSecretProviderConfig | undefined {
  const config = secrets?.providers?.[provider];
  return config?.source === source ? config : undefined;
}

function validateEnvSecretRef(
  ref: ExternalProviderSecretRef & { source: "env" },
): string | undefined {
  const provider = ref.provider ?? "default";
  if (!isValidSecretProviderName(provider)) {
    return `env SecretRef provider "${provider}" is invalid`;
  }
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(ref.id.trim())) {
    return `env SecretRef id "${ref.id}" must be an uppercase environment variable name`;
  }
  return undefined;
}

function validateFileSecretRef(
  ref: ExternalProviderSecretRef & { source: "file" },
): string | undefined {
  const provider = ref.provider ?? "default";
  if (!isValidSecretProviderName(provider)) {
    return `file SecretRef provider "${provider}" is invalid`;
  }
  const id = ref.id.trim();
  if (id !== "value" && !id.startsWith("/")) {
    return `file SecretRef id "${ref.id}" must be "value" or an absolute JSON pointer`;
  }
  return undefined;
}

function validateExecSecretRef(
  ref: ExternalProviderSecretRef & { source: "exec" },
): string | undefined {
  const provider = ref.provider ?? "default";
  if (!isValidSecretProviderName(provider)) {
    return `exec SecretRef provider "${provider}" is invalid`;
  }
  const id = ref.id.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(id)) {
    return `exec SecretRef id "${ref.id}" is invalid`;
  }
  if (id.split("/").some((segment) => segment === "." || segment === "..")) {
    return `exec SecretRef id "${ref.id}" must not contain relative path segments`;
  }
  return undefined;
}

function isValidSecretProviderName(value: string): boolean {
  return /^[a-z][a-z0-9_-]{0,63}$/u.test(value);
}

function readJsonPointerSecret(value: unknown, pointer: string): string {
  let cursor = value;
  for (const rawSegment of pointer.split("/").slice(1)) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(cursor) || !(segment in cursor)) {
      throw new Error("JSON pointer was not found");
    }
    cursor = cursor[segment];
  }
  if (typeof cursor !== "string") {
    throw new Error("JSON pointer did not resolve to a string");
  }
  return cursor;
}

function createSecretRefError(ref: ExternalProviderSecretRef, error: string): ResolvedConfigValue {
  return {
    source: ref.source,
    refSource: ref.source,
    refProvider: ref.provider ?? "default",
    ...(ref.source === "env" ? { envVar: ref.id } : {}),
    error,
  };
}

function createExternalProviderDiagnostics(input: {
  readonly activeSurface: boolean;
  readonly missingEnvVars: readonly string[];
  readonly secret: ExternalProviderResolvedSecret;
}): readonly string[] {
  const diagnostics: string[] = [];
  diagnostics.push(input.activeSurface ? "active-surface: true" : "active-surface: false");
  if (!input.activeSurface) {
    diagnostics.push("inactive provider surfaces do not block runtime startup");
  }
  if (input.secret.error !== undefined) {
    diagnostics.push(`credential-ref-error: ${input.secret.error}`);
  }
  if (input.missingEnvVars.length > 0) {
    diagnostics.push(`missing-env: ${input.missingEnvVars.join(" or ")}`);
  }
  if (input.secret.configured) {
    const source = input.secret.refSource ?? input.secret.source ?? "config";
    const provider = input.secret.refProvider ? `:${input.secret.refProvider}` : "";
    diagnostics.push(`credential-source: ${source}${provider}`);
  }
  return diagnostics;
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof SyntaxError) {
    return "invalid JSON";
  }
  if (isRecord(error) && typeof error.code === "string") {
    return error.code;
  }
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }
  return "resolution failed";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeExternalProviderContracts(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, readonly string[]>> | undefined {
  const entries = Object.entries(value)
    .map(([key, raw]) => [key, normalizeStringList(readStringArray(raw))] as const)
    .filter(([, values]) => values.length > 0);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function normalizeExternalProviderUiHints(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, ExternalProviderUiHint>> | undefined {
  const entries: Array<readonly [string, ExternalProviderUiHint]> = [];
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || typeof raw.label !== "string") {
      continue;
    }
    entries.push([
      key,
      {
        label: raw.label.trim() || key,
        ...(typeof raw.help === "string" ? { help: raw.help } : {}),
        ...(typeof raw.sensitive === "boolean" ? { sensitive: raw.sensitive } : {}),
        ...(typeof raw.placeholder === "string" ? { placeholder: raw.placeholder } : {}),
      },
    ]);
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function inferExternalProviderConfigFields(input: {
  readonly id: string;
  readonly envVars: readonly string[];
  readonly uiHints?: Readonly<Record<string, ExternalProviderUiHint>>;
}): readonly ExternalProviderConfigField[] {
  const fields: ExternalProviderConfigField[] = [
    {
      key: "enabled",
      label: "启用",
      kind: "boolean",
    },
  ];
  const apiKeyHint = Object.entries(input.uiHints ?? {}).find(
    ([key, hint]) => hint.sensitive === true || /apiKey|bearerToken|token|key/iu.test(key),
  )?.[1];
  if (input.envVars.length > 0 || apiKeyHint !== undefined) {
    fields.push({
      key: inferExternalProviderApiKeyConfigKey(input.id),
      label: apiKeyHint?.label ?? `${formatExternalProviderLabel(input.id)} API Key`,
      kind: "secret",
      sensitive: true,
      placeholder:
        apiKeyHint?.placeholder ??
        (input.envVars[0] ? `env:${input.envVars[0]}` : "env:PROVIDER_API_KEY"),
      help: apiKeyHint?.help ?? "建议优先使用环境变量或 SecretRef。",
    });
  }
  return fields;
}

function inferExternalProviderApiKeyConfigKey(id: string): string {
  return id === "x-twitter" ? "bearerToken" : "apiKey";
}

function inferExternalProviderCapabilities(
  contracts: Readonly<Record<string, readonly string[]>> | undefined,
): readonly string[] {
  const capabilities = new Set<string>();
  const contractKeys = Object.keys(contracts ?? {});
  if (contractKeys.some((key) => /webSearch/iu.test(key))) {
    capabilities.add("web.search");
  }
  if (contractKeys.some((key) => /socialSearch/iu.test(key))) {
    capabilities.add("social.search");
  }
  for (const values of Object.values(contracts ?? {})) {
    for (const value of values) {
      capabilities.add(value.includes(".") ? value : `provider.${value}`);
    }
  }
  return capabilities.size === 0 ? ["provider.invoke"] : [...capabilities].sort();
}

function inferExternalProviderFamily(
  contracts: Readonly<Record<string, readonly string[]>> | undefined,
): string {
  const keys = Object.keys(contracts ?? {});
  if (keys.some((key) => /webSearch/iu.test(key))) {
    return "web-search";
  }
  if (keys.some((key) => /socialSearch/iu.test(key))) {
    return "social-search";
  }
  return "external";
}

function formatExternalProviderLabel(id: string): string {
  return id
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeStringList(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function createNeedsAuthNextActions(
  manifest: ExternalProviderManifest,
  missingEnvVars: readonly string[],
): string[] {
  const envText =
    missingEnvVars.length > 0
      ? missingEnvVars.join(" or ")
      : (manifest.auth?.envVars ?? []).join(" or ");
  return [
    envText.length > 0
      ? `configure ${envText} or save a provider SecretRef`
      : "configure provider credentials",
    "retry the same user request after the provider status becomes ready",
  ];
}

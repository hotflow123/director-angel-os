export type PluginRuntimeManifestKind =
  | "provider"
  | "tool"
  | "memory"
  | "knowledge-connector"
  | "mixed";

export type PluginRuntimeManifestSource = "bundled" | "workspace" | "user";

export type PluginRuntimeSourceTrustStatus =
  | "official"
  | "verified"
  | "local"
  | "community"
  | "untrusted";

export interface PluginRuntimeManifestOrigin {
  readonly kind: PluginRuntimeManifestSource | (string & {});
  readonly path?: string;
  readonly specifier?: string;
}

export interface PluginRuntimeActivationManifest {
  readonly onStartup?: boolean;
  readonly capabilities?: readonly string[];
  readonly tools?: readonly string[];
  readonly providers?: readonly string[];
  readonly configPaths?: readonly string[];
}

export interface PluginRuntimeProviderSetupManifest {
  readonly id: string;
  readonly authMethods?: readonly string[];
  readonly envVars?: readonly string[];
  readonly configKeys?: readonly string[];
  readonly endpoints?: readonly string[];
}

export interface PluginRuntimeSetupManifest {
  readonly providers?: readonly PluginRuntimeProviderSetupManifest[];
}

export interface PluginRuntimeToolManifest {
  readonly name: string;
  readonly readOnly: boolean;
  readonly requiresApproval?: boolean;
  readonly destructive?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PluginRuntimeSandboxPolicyManifest {
  readonly filesystem?: "none" | "read-only" | "workspace-write" | (string & {});
  readonly network?: "none" | "configured" | "open" | (string & {});
  readonly allowedCommands?: readonly string[];
}

export interface PluginRuntimeManifestV1 {
  readonly schemaVersion: "hotflow.plugin-manifest.v1" | (string & {});
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly kind: PluginRuntimeManifestKind;
  readonly description?: string;
  readonly enabledByDefault?: boolean;
  readonly origin?: PluginRuntimeManifestOrigin;
  readonly sourceTrust?: {
    readonly status: PluginRuntimeSourceTrustStatus;
    readonly reason?: string;
    readonly label?: string;
  };
  readonly activation?: PluginRuntimeActivationManifest;
  readonly setup?: PluginRuntimeSetupManifest;
  readonly providerAuthChoices?: readonly PluginRuntimeProviderSetupManifest[];
  readonly tools?: readonly PluginRuntimeToolManifest[];
  readonly contracts?: Readonly<Record<string, readonly string[]>>;
  readonly configSchema?: Readonly<Record<string, unknown>>;
  readonly uiHints?: Readonly<Record<string, unknown>>;
  readonly sandboxPolicy?: PluginRuntimeSandboxPolicyManifest;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly directStoreAccess?: boolean;
  readonly internalStores?: readonly string[];
  readonly storeImports?: readonly string[];
}

export interface PluginRuntimeManifestRecord {
  readonly source: PluginRuntimeManifestSource;
  readonly manifest: PluginRuntimeManifestV1;
  readonly issues: readonly PluginRuntimeManifestIssue[];
}

export interface PluginRuntimeManifestIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path?: string;
}

export interface PluginRuntimeManifestRegistry {
  readonly schemaVersion: "hotflow.plugin-manifest-registry.v1";
  readonly records: readonly PluginRuntimeManifestRecord[];
  readonly disabledPluginIds: readonly string[];
}

export type PluginRuntimeEffectiveCatalogItemStatus = "active" | "disabled" | "blocked";

export interface PluginRuntimeEffectiveCatalogItem {
  readonly pluginId: string;
  readonly status: PluginRuntimeEffectiveCatalogItemStatus;
  readonly effectiveSource: PluginRuntimeManifestSource;
  readonly manifest: PluginRuntimeManifestV1;
  readonly overriddenSources: readonly PluginRuntimeManifestSource[];
  readonly issues: readonly PluginRuntimeManifestIssue[];
  readonly activation?: PluginRuntimeActivationManifest;
  readonly setup?: PluginRuntimeSetupManifest;
  readonly providerAuthChoices?: readonly PluginRuntimeProviderSetupManifest[];
  readonly contracts?: Readonly<Record<string, readonly string[]>>;
  readonly configSchema?: Readonly<Record<string, unknown>>;
  readonly uiHints?: Readonly<Record<string, unknown>>;
  readonly sandboxPolicy?: PluginRuntimeSandboxPolicyManifest;
  readonly sourceTrust?: PluginRuntimeManifestV1["sourceTrust"];
}

export interface PluginRuntimeEffectiveCatalog {
  readonly schemaVersion: "hotflow.plugin-effective-catalog.v1";
  readonly items: readonly PluginRuntimeEffectiveCatalogItem[];
  readonly activeItems: readonly PluginRuntimeEffectiveCatalogItem[];
}

export type PluginRuntimeActivationPlanItemStatus =
  | "ready"
  | "needs_setup"
  | "disabled"
  | "blocked";

export interface PluginRuntimeMissingSetup {
  readonly providerId: string;
  readonly envVars: readonly string[];
  readonly configKeys: readonly string[];
}

export interface PluginRuntimeActivationPlanItem {
  readonly pluginId: string;
  readonly status: PluginRuntimeActivationPlanItemStatus;
  readonly canActivate: boolean;
  readonly effectiveSource: PluginRuntimeManifestSource;
  readonly manifest: PluginRuntimeManifestV1;
  readonly activation?: PluginRuntimeActivationManifest;
  readonly setup?: PluginRuntimeSetupManifest;
  readonly sourceTrust?: PluginRuntimeManifestV1["sourceTrust"];
  readonly missingSetup: readonly PluginRuntimeMissingSetup[];
  readonly reasonCodes: readonly string[];
}

export interface PluginRuntimeActivationPlan {
  readonly schemaVersion: "hotflow.plugin-activation-plan.v1";
  readonly items: readonly PluginRuntimeActivationPlanItem[];
  readonly activatableItems: readonly PluginRuntimeActivationPlanItem[];
}

export interface PluginRuntimeActivationPlanInput {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface CreatePluginManifestRegistryInput {
  readonly bundled?: readonly PluginRuntimeManifestV1[];
  readonly workspace?: readonly PluginRuntimeManifestV1[];
  readonly user?: readonly PluginRuntimeManifestV1[];
  readonly disabledPluginIds?: readonly string[];
}

const PLUGIN_MANIFEST_SOURCE_PRIORITY: readonly PluginRuntimeManifestSource[] = [
  "user",
  "workspace",
  "bundled",
];

export function createPluginManifestRegistry(
  input: CreatePluginManifestRegistryInput,
): PluginRuntimeManifestRegistry {
  const records: PluginRuntimeManifestRecord[] = [];
  for (const source of ["bundled", "workspace", "user"] as const) {
    for (const manifest of input[source] ?? []) {
      records.push({
        source,
        manifest: attachDefaultOrigin(manifest, source),
        issues: validatePluginRuntimeManifest(manifest),
      });
    }
  }
  return {
    schemaVersion: "hotflow.plugin-manifest-registry.v1",
    records,
    disabledPluginIds: [...(input.disabledPluginIds ?? [])],
  };
}

export function resolveEffectivePluginCatalog(
  registry: PluginRuntimeManifestRegistry,
): PluginRuntimeEffectiveCatalog {
  const recordsByPluginId = groupManifestRecordsByPluginId(registry.records);
  const disabled = new Set(registry.disabledPluginIds);
  const items = [...recordsByPluginId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pluginId, records]) => {
      const effective = selectEffectiveManifestRecord(records);
      const blocked = effective.issues.some((issue) => issue.severity === "error");
      const status: PluginRuntimeEffectiveCatalogItemStatus = blocked
        ? "blocked"
        : disabled.has(pluginId)
          ? "disabled"
          : "active";
      return {
        pluginId,
        status,
        effectiveSource: effective.source,
        manifest: effective.manifest,
        overriddenSources: records
          .filter((record) => record !== effective)
          .sort(
            (left, right) =>
              PLUGIN_MANIFEST_SOURCE_PRIORITY.indexOf(left.source) -
              PLUGIN_MANIFEST_SOURCE_PRIORITY.indexOf(right.source),
          )
          .map((record) => record.source),
        issues: effective.issues,
        ...(effective.manifest.activation === undefined
          ? {}
          : { activation: effective.manifest.activation }),
        ...(effective.manifest.setup === undefined ? {} : { setup: effective.manifest.setup }),
        ...(effective.manifest.providerAuthChoices === undefined
          ? {}
          : { providerAuthChoices: effective.manifest.providerAuthChoices }),
        ...(effective.manifest.contracts === undefined
          ? {}
          : { contracts: effective.manifest.contracts }),
        ...(effective.manifest.configSchema === undefined
          ? {}
          : { configSchema: effective.manifest.configSchema }),
        ...(effective.manifest.uiHints === undefined
          ? {}
          : { uiHints: effective.manifest.uiHints }),
        ...(effective.manifest.sandboxPolicy === undefined
          ? {}
          : { sandboxPolicy: effective.manifest.sandboxPolicy }),
        ...(effective.manifest.sourceTrust === undefined
          ? {}
          : { sourceTrust: effective.manifest.sourceTrust }),
      };
    });
  return {
    schemaVersion: "hotflow.plugin-effective-catalog.v1",
    items,
    activeItems: items.filter((item) => item.status === "active"),
  };
}

export function planPluginCatalogActivation(
  catalog: PluginRuntimeEffectiveCatalog,
  input: PluginRuntimeActivationPlanInput = {},
): PluginRuntimeActivationPlan {
  const items = catalog.items.map((item) => planPluginCatalogActivationItem(item, input));
  return {
    schemaVersion: "hotflow.plugin-activation-plan.v1",
    items,
    activatableItems: items.filter((item) => item.canActivate),
  };
}

export function validatePluginRuntimeManifest(
  manifest: PluginRuntimeManifestV1,
): readonly PluginRuntimeManifestIssue[] {
  const issues: PluginRuntimeManifestIssue[] = [];
  if (!/^[a-z][a-z0-9_.-]{0,127}$/u.test(manifest.id)) {
    issues.push({
      code: "invalid-plugin-id",
      severity: "error",
      path: "id",
      message: `Plugin id "${manifest.id}" must match ^[a-z][a-z0-9_.-]{0,127}$.`,
    });
  }
  if (manifest.directStoreAccess === true || (manifest.internalStores ?? []).length > 0) {
    issues.push({
      code: "direct-store-access-forbidden",
      severity: "error",
      path: "directStoreAccess",
      message: "Plugins must use runtime contracts instead of direct internal store access.",
    });
  }
  if ((manifest.storeImports ?? []).length > 0) {
    issues.push({
      code: "internal-store-import-forbidden",
      severity: "error",
      path: "storeImports",
      message: "Plugins must not import internal stores directly.",
    });
  }
  return issues;
}

function planPluginCatalogActivationItem(
  item: PluginRuntimeEffectiveCatalogItem,
  input: PluginRuntimeActivationPlanInput,
): PluginRuntimeActivationPlanItem {
  if (item.status === "blocked") {
    return createPluginRuntimeActivationPlanItem(item, "blocked", ["blocked"], []);
  }
  if (item.status === "disabled") {
    return createPluginRuntimeActivationPlanItem(item, "disabled", ["disabled"], []);
  }

  const missingSetup = collectMissingSetup(item.setup, input);
  const reasonCodes = collectMissingSetupReasonCodes(missingSetup);
  if (missingSetup.length > 0) {
    return createPluginRuntimeActivationPlanItem(item, "needs_setup", reasonCodes, missingSetup);
  }

  return createPluginRuntimeActivationPlanItem(item, "ready", [], []);
}

function createPluginRuntimeActivationPlanItem(
  item: PluginRuntimeEffectiveCatalogItem,
  status: PluginRuntimeActivationPlanItemStatus,
  reasonCodes: readonly string[],
  missingSetup: readonly PluginRuntimeMissingSetup[],
): PluginRuntimeActivationPlanItem {
  return {
    pluginId: item.pluginId,
    status,
    canActivate: status === "ready",
    effectiveSource: item.effectiveSource,
    manifest: item.manifest,
    ...(item.activation === undefined ? {} : { activation: item.activation }),
    ...(item.setup === undefined ? {} : { setup: item.setup }),
    ...(item.sourceTrust === undefined ? {} : { sourceTrust: item.sourceTrust }),
    missingSetup,
    reasonCodes,
  };
}

function collectMissingSetup(
  setup: PluginRuntimeSetupManifest | undefined,
  input: PluginRuntimeActivationPlanInput,
): readonly PluginRuntimeMissingSetup[] {
  const missing: PluginRuntimeMissingSetup[] = [];
  for (const provider of setup?.providers ?? []) {
    const envVars = (provider.envVars ?? []).filter(
      (name) => !hasNonEmptyEnvValue(input.env, name),
    );
    const configKeys = (provider.configKeys ?? []).filter(
      (key) => !hasPresentConfigValue(input.config, key),
    );
    if (envVars.length > 0 || configKeys.length > 0) {
      missing.push({
        providerId: provider.id,
        envVars,
        configKeys,
      });
    }
  }
  return missing;
}

function collectMissingSetupReasonCodes(
  missingSetup: readonly PluginRuntimeMissingSetup[],
): readonly string[] {
  const reasons: string[] = [];
  if (missingSetup.some((missing) => missing.envVars.length > 0)) {
    reasons.push("missing_env");
  }
  if (missingSetup.some((missing) => missing.configKeys.length > 0)) {
    reasons.push("missing_config");
  }
  return reasons;
}

function hasNonEmptyEnvValue(
  env: Readonly<Record<string, string | undefined>> | undefined,
  name: string,
): boolean {
  return typeof env?.[name] === "string" && env[name].trim().length > 0;
}

function hasPresentConfigValue(
  config: Readonly<Record<string, unknown>> | undefined,
  key: string,
): boolean {
  return config?.[key] !== undefined;
}

function attachDefaultOrigin(
  manifest: PluginRuntimeManifestV1,
  source: PluginRuntimeManifestSource,
): PluginRuntimeManifestV1 {
  return manifest.origin === undefined ? { ...manifest, origin: { kind: source } } : manifest;
}

function groupManifestRecordsByPluginId(
  records: readonly PluginRuntimeManifestRecord[],
): Map<string, PluginRuntimeManifestRecord[]> {
  const grouped = new Map<string, PluginRuntimeManifestRecord[]>();
  for (const record of records) {
    const bucket = grouped.get(record.manifest.id) ?? [];
    bucket.push(record);
    grouped.set(record.manifest.id, bucket);
  }
  return grouped;
}

function selectEffectiveManifestRecord(
  records: readonly PluginRuntimeManifestRecord[],
): PluginRuntimeManifestRecord {
  const sorted = [...records].sort(
    (left, right) =>
      PLUGIN_MANIFEST_SOURCE_PRIORITY.indexOf(left.source) -
      PLUGIN_MANIFEST_SOURCE_PRIORITY.indexOf(right.source),
  );
  const effective = sorted[0];
  if (effective === undefined) {
    throw new Error("Cannot resolve effective plugin manifest from an empty record set.");
  }
  return effective;
}

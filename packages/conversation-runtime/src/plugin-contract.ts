import type { AgentOsExtensionSourceTrustStatus } from "@hotflow/agent-os-extensions";
import type {
  ExternalKnowledgeConnectorManifest,
  ExternalKnowledgeTargetKind,
} from "./external-knowledge-connectors.js";
import type {
  ExternalProviderAuthManifest,
  ExternalProviderManifest,
} from "./external-provider-auth.js";
import { createExternalProviderManifestFromOpenClawPlugin } from "./external-provider-auth.js";
import type {
  ExternalToolApprovalBoundary,
  ExternalToolInstallPolicy,
  ExternalToolManifest,
  ExternalToolProviderCapability,
  ExternalToolSourceTrust,
} from "./external-tools.js";

export interface ConversationRuntimePluginCapability {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly readOnly: boolean;
  readonly requiresApproval?: boolean;
  readonly destructive?: boolean;
  readonly openWorld?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimePluginTool {
  readonly name: string;
  readonly capabilityId: string;
  readonly readOnly: boolean;
  readonly requiresApproval?: boolean;
  readonly destructive?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimePluginProvider {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly contracts?: Readonly<Record<string, readonly string[]>>;
  readonly auth?: ExternalProviderAuthManifest;
  readonly uiHints?: ExternalProviderManifest["uiHints"];
  readonly configSchema?: ExternalProviderManifest["configSchema"];
  readonly configFields?: ExternalProviderManifest["configFields"];
  readonly capabilities?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimePluginMemoryProviderContract {
  readonly id: string;
  readonly kind: "episodic-memory" | "semantic-memory" | "vector-memory" | (string & {});
  readonly sessionScoped: boolean;
  readonly directStoreAccessAllowed: false;
  readonly contracts?: Readonly<Record<string, readonly string[]>>;
  readonly requiresAuth?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeExternalKnowledgePluginConnector {
  readonly id: string;
  readonly targetKind: ExternalKnowledgeTargetKind;
  readonly stableApi: boolean;
  readonly requiresAuth?: boolean;
  readonly uploadPackageRequired?: boolean;
  readonly contracts?: ExternalKnowledgeConnectorManifest["contracts"];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimePluginManifest {
  readonly schemaVersion?: "conversation-runtime.plugin-manifest.v1" | (string & {});
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description?: string;
  readonly sourceTrust?: {
    readonly status: AgentOsExtensionSourceTrustStatus;
    readonly label?: string;
    readonly reason?: string;
  };
  readonly capabilities?: readonly ConversationRuntimePluginCapability[];
  readonly tools?: readonly ConversationRuntimePluginTool[];
  readonly providers?: readonly ConversationRuntimePluginProvider[];
  readonly memory?: {
    readonly providers?: readonly ConversationRuntimePluginMemoryProviderContract[];
  };
  readonly externalKnowledge?: {
    readonly connectors?: readonly ConversationRuntimeExternalKnowledgePluginConnector[];
  };
  readonly installPolicy?: ExternalToolInstallPolicy;
  readonly approvalBoundary?: ExternalToolApprovalBoundary;
  readonly contracts?: Readonly<Record<string, readonly string[]>>;
  readonly configSchema?: Readonly<Record<string, unknown>>;
  readonly uiHints?: ExternalProviderManifest["uiHints"];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly internalStores?: readonly string[];
  readonly storeImports?: readonly string[];
  readonly directStoreAccess?: boolean;
}

export type ConversationRuntimePluginSourceManifestKind =
  | "conversation-runtime-plugin"
  | "internal-plugin"
  | "openclaw-adapter"
  | (string & {});

export interface ConversationRuntimePluginSdkSourceManifest {
  readonly id: string;
  readonly kind?: "provider" | "tool" | "model" | "memory" | (string & {});
  readonly version: string;
  readonly entrypoint?: string;
  readonly displayName?: string;
  readonly label?: string;
  readonly description?: string;
  readonly capabilities?: readonly string[];
  readonly contracts?: Readonly<Record<string, readonly string[]>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateConversationRuntimePluginSdkRegistrationInput {
  readonly manifest: ConversationRuntimePluginSdkSourceManifest;
  readonly sourceManifestKind?: ConversationRuntimePluginSourceManifestKind;
  readonly capabilities?: readonly ConversationRuntimePluginCapability[];
  readonly tools?: readonly ConversationRuntimePluginTool[];
  readonly providers?: readonly ConversationRuntimePluginProvider[];
  readonly memoryProviders?: readonly ConversationRuntimePluginMemoryProviderContract[];
  readonly externalKnowledgeConnectors?: readonly ConversationRuntimeExternalKnowledgePluginConnector[];
  readonly installPolicy?: ExternalToolInstallPolicy;
  readonly approvalBoundary?: ExternalToolApprovalBoundary;
  readonly sourceTrust?: ConversationRuntimePluginManifest["sourceTrust"];
  readonly contracts?: ConversationRuntimePluginManifest["contracts"];
  readonly configSchema?: ConversationRuntimePluginManifest["configSchema"];
  readonly uiHints?: ConversationRuntimePluginManifest["uiHints"];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly internalStores?: readonly string[];
  readonly storeImports?: readonly string[];
  readonly directStoreAccess?: boolean;
}

export type ConversationRuntimePluginHotLoadPlanStatus = "ready" | "requires-approval" | "blocked";

export type ConversationRuntimePluginRegistryTarget =
  | "tool-registry"
  | "provider-registry"
  | "knowledge-connector"
  | "memory-port";

export interface ConversationRuntimePluginHotLoadBlocker {
  readonly code: string;
  readonly message: string;
}

export interface ConversationRuntimePluginHotLoadPlan {
  readonly schemaVersion: "conversation-runtime.plugin-hot-load-plan.v1";
  readonly pluginId: string;
  readonly status: ConversationRuntimePluginHotLoadPlanStatus;
  readonly mode: "hot-load";
  readonly entrypoint?: string;
  readonly requiresOperatorApproval: boolean;
  readonly approvalReasons: readonly string[];
  readonly registryTargets: readonly ConversationRuntimePluginRegistryTarget[];
  readonly directCodeExecutionAllowed: false;
  readonly blockers: readonly ConversationRuntimePluginHotLoadBlocker[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimePluginSdkRegistration {
  readonly schemaVersion: "conversation-runtime.plugin-sdk-registration.v1";
  readonly pluginId: string;
  readonly sourceManifestKind: ConversationRuntimePluginSourceManifestKind;
  readonly entrypoint?: string;
  readonly manifest: ConversationRuntimePluginManifest;
  readonly contractPlan: ConversationRuntimePluginContractPlan;
  readonly loadPlan: ConversationRuntimePluginHotLoadPlan;
}

export interface ConversationRuntimeExecutablePluginContext {
  readonly directStoreAccessAllowed: false;
  readonly registerTool: (tool: ConversationRuntimePluginTool) => void;
  readonly registerProvider: (provider: ConversationRuntimePluginProvider) => void;
  readonly registerMemoryProvider: (
    provider: ConversationRuntimePluginMemoryProviderContract,
  ) => void;
  readonly registerExternalKnowledgeConnector: (
    connector: ConversationRuntimeExternalKnowledgePluginConnector,
  ) => void;
}

export interface ConversationRuntimeExecutablePluginModule {
  readonly register?: (
    context: ConversationRuntimeExecutablePluginContext,
  ) =>
    | undefined
    | CreateConversationRuntimePluginSdkRegistrationInput
    | Promise<undefined | CreateConversationRuntimePluginSdkRegistrationInput>;
}

export interface CreateConversationRuntimeExecutablePluginLoaderInput {
  readonly trustedEntrypointRoots: readonly string[];
  readonly loadModule: (
    entrypoint: string,
  ) =>
    | Promise<ConversationRuntimeExecutablePluginModule>
    | ConversationRuntimeExecutablePluginModule;
}

export interface ConversationRuntimeExecutablePluginRegistryPatch {
  readonly toolManifests: readonly ExternalToolManifest[];
  readonly providerManifests: readonly ExternalProviderManifest[];
  readonly memoryProviders: readonly ConversationRuntimePluginMemoryProviderContract[];
  readonly externalKnowledgeConnectors: readonly ConversationRuntimeExternalKnowledgePluginConnectorContract[];
}

export interface ConversationRuntimeExecutablePluginSandboxBoundary {
  readonly directStoreAccessAllowed: false;
  readonly allowedRegistryTargets: readonly ConversationRuntimePluginRegistryTarget[];
  readonly trustedEntrypoint: boolean;
}

export interface ConversationRuntimeExecutablePluginLoadBlocker {
  readonly code: string;
  readonly message: string;
}

export interface ConversationRuntimeExecutablePluginLoadResult {
  readonly schemaVersion: "conversation-runtime.executable-plugin-load-result.v1";
  readonly ok: boolean;
  readonly pluginId: string;
  readonly entrypoint?: string;
  readonly registration: ConversationRuntimePluginSdkRegistration;
  readonly registryPatch: ConversationRuntimeExecutablePluginRegistryPatch;
  readonly sandboxBoundary: ConversationRuntimeExecutablePluginSandboxBoundary;
  readonly blockers: readonly ConversationRuntimeExecutablePluginLoadBlocker[];
}

export interface ConversationRuntimePluginContractIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly path?: string;
}

export type ConversationRuntimePluginContractPlanStatus = "admissible" | "blocked";

export interface ConversationRuntimePluginContractBoundaries {
  readonly directStoreAccessAllowed: false;
  readonly requiresPolicyGate: boolean;
  readonly requiresApprovalForWrites: boolean;
  readonly allowedSurfaces: readonly string[];
}

export interface ConversationRuntimeExternalKnowledgePluginConnectorContract
  extends ConversationRuntimeExternalKnowledgePluginConnector {
  readonly uploadPackageRequired: boolean;
  readonly directStoreAccessAllowed: false;
}

export interface ConversationRuntimePluginContractPlan {
  readonly schemaVersion: "conversation-runtime.plugin-contract-plan.v1";
  readonly pluginId: string;
  readonly status: ConversationRuntimePluginContractPlanStatus;
  readonly summary: string;
  readonly issueCount: number;
  readonly issues: readonly ConversationRuntimePluginContractIssue[];
  readonly boundaries: ConversationRuntimePluginContractBoundaries;
  readonly externalToolManifests: readonly ExternalToolManifest[];
  readonly externalProviderManifests: readonly ExternalProviderManifest[];
  readonly memoryProviderContracts: readonly ConversationRuntimePluginMemoryProviderContract[];
  readonly externalKnowledgeConnectorContracts: readonly ConversationRuntimeExternalKnowledgePluginConnectorContract[];
}

export function validateConversationRuntimePluginManifest(
  manifest: ConversationRuntimePluginManifest,
): readonly ConversationRuntimePluginContractIssue[] {
  const issues: ConversationRuntimePluginContractIssue[] = [];
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(manifest.id)) {
    issues.push({
      code: "invalid-plugin-id",
      severity: "error",
      path: "id",
      message: `Plugin id "${manifest.id}" must match ^[a-z][a-z0-9_-]{0,63}$.`,
    });
  }
  if (manifest.directStoreAccess === true || (manifest.internalStores ?? []).length > 0) {
    issues.push({
      code: "direct-store-access-forbidden",
      severity: "error",
      path: "internalStores",
      message: "Plugins must use runtime contracts instead of direct internal store access.",
    });
  }
  if ((manifest.storeImports ?? []).length > 0) {
    issues.push({
      code: "internal-store-import-forbidden",
      severity: "error",
      path: "storeImports",
      message: "Plugins must not import renderer/main-process stores directly.",
    });
  }
  for (const tool of manifest.tools ?? []) {
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(tool.name)) {
      issues.push({
        code: "invalid-tool-name",
        severity: "error",
        path: `tools.${tool.name}`,
        message: `Tool name "${tool.name}" is invalid.`,
      });
    }
  }
  return issues;
}

export function createConversationRuntimePluginContractPlan(
  manifest: ConversationRuntimePluginManifest,
): ConversationRuntimePluginContractPlan {
  const issues = validateConversationRuntimePluginManifest(manifest);
  const blocked = issues.some((issue) => issue.severity === "error");
  const memoryContracts = normalizeMemoryProviderContracts(manifest);
  const knowledgeContracts = normalizeExternalKnowledgeConnectorContracts(manifest);
  const boundaries = createPluginContractBoundaries(manifest);
  const externalToolManifests = blocked ? [] : [createPluginExternalToolManifest(manifest)];
  const externalProviderManifests = blocked ? [] : createPluginExternalProviderManifests(manifest);
  return {
    schemaVersion: "conversation-runtime.plugin-contract-plan.v1",
    pluginId: manifest.id,
    status: blocked ? "blocked" : "admissible",
    summary: createPluginContractSummary({
      manifest,
      externalToolManifests,
      externalProviderManifests,
      memoryContracts,
      knowledgeContracts,
    }),
    issueCount: issues.length,
    issues,
    boundaries,
    externalToolManifests,
    externalProviderManifests,
    memoryProviderContracts: blocked ? [] : memoryContracts,
    externalKnowledgeConnectorContracts: blocked ? [] : knowledgeContracts,
  };
}

export function createConversationRuntimePluginSdkRegistration(
  input: CreateConversationRuntimePluginSdkRegistrationInput,
): ConversationRuntimePluginSdkRegistration {
  const manifest = createConversationRuntimePluginManifestFromSdkInput(input);
  const contractPlan = createConversationRuntimePluginContractPlan(manifest);
  const loadPlan = createConversationRuntimePluginHotLoadPlan(contractPlan, {
    ...(input.manifest.entrypoint === undefined ? {} : { entrypoint: input.manifest.entrypoint }),
    metadata: {
      sourceManifestId: input.manifest.id,
      sourceManifestKind: input.sourceManifestKind ?? "internal-plugin",
    },
  });
  return {
    schemaVersion: "conversation-runtime.plugin-sdk-registration.v1",
    pluginId: manifest.id,
    sourceManifestKind: input.sourceManifestKind ?? "internal-plugin",
    ...(input.manifest.entrypoint === undefined ? {} : { entrypoint: input.manifest.entrypoint }),
    manifest,
    contractPlan,
    loadPlan,
  };
}

export function createConversationRuntimePluginHotLoadPlan(
  contractPlan: ConversationRuntimePluginContractPlan,
  options: {
    readonly entrypoint?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  } = {},
): ConversationRuntimePluginHotLoadPlan {
  const registryTargets = inferPluginRegistryTargets(contractPlan);
  const approvalReasons = inferPluginHotLoadApprovalReasons(contractPlan);
  const blockers = createPluginHotLoadBlockers(contractPlan);
  const blocked = blockers.length > 0;
  const requiresOperatorApproval = !blocked && approvalReasons.length > 0;
  return {
    schemaVersion: "conversation-runtime.plugin-hot-load-plan.v1",
    pluginId: contractPlan.pluginId,
    status: blocked ? "blocked" : requiresOperatorApproval ? "requires-approval" : "ready",
    mode: "hot-load",
    ...(options.entrypoint === undefined ? {} : { entrypoint: options.entrypoint }),
    requiresOperatorApproval,
    approvalReasons,
    registryTargets: blocked ? [] : registryTargets,
    directCodeExecutionAllowed: false,
    blockers,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

export function createConversationRuntimeExecutablePluginLoader(
  input: CreateConversationRuntimeExecutablePluginLoaderInput,
): {
  readonly load: (
    registrationInput: CreateConversationRuntimePluginSdkRegistrationInput,
  ) => Promise<ConversationRuntimeExecutablePluginLoadResult>;
} {
  const trustedRoots = normalizeTrustedEntrypointRoots(input.trustedEntrypointRoots);
  return {
    load: async (registrationInput) => {
      const initialRegistration = createConversationRuntimePluginSdkRegistration(registrationInput);
      const entrypoint = registrationInput.manifest.entrypoint;
      const trustedEntrypoint = isTrustedPluginEntrypoint(entrypoint, trustedRoots);
      const preflightBlockers = [
        ...(trustedEntrypoint
          ? []
          : [
              {
                code: "untrusted-entrypoint",
                message: "Executable plugin entrypoint is outside trusted plugin roots.",
              },
            ]),
        ...initialRegistration.loadPlan.blockers,
      ];
      if (preflightBlockers.length > 0) {
        return createExecutablePluginLoadResult({
          registration: initialRegistration,
          trustedEntrypoint,
          blockers: preflightBlockers,
        });
      }
      const captured = createExecutablePluginRegistrationCapture();
      try {
        const module = await input.loadModule(entrypoint ?? "");
        if (typeof module.register !== "function") {
          return createExecutablePluginLoadResult({
            registration: initialRegistration,
            trustedEntrypoint,
            blockers: [
              {
                code: "missing-register",
                message: "Executable plugin module must export a register(context) function.",
              },
            ],
          });
        }
        const returned = await module.register(captured.context);
        const mergedInput = mergeExecutablePluginRegistrationInput(
          registrationInput,
          returned,
          captured,
        );
        const registration = createConversationRuntimePluginSdkRegistration(mergedInput);
        return createExecutablePluginLoadResult({
          registration,
          trustedEntrypoint,
          blockers: registration.loadPlan.blockers,
        });
      } catch (error) {
        return createExecutablePluginLoadResult({
          registration: initialRegistration,
          trustedEntrypoint,
          blockers: [
            {
              code: "register-failed",
              message: `Executable plugin register failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        });
      }
    },
  };
}

function createConversationRuntimePluginManifestFromSdkInput(
  input: CreateConversationRuntimePluginSdkRegistrationInput,
): ConversationRuntimePluginManifest {
  const pluginId = normalizePluginId(input.manifest.id);
  const inferredCapabilities = inferSdkManifestCapabilities(input.manifest);
  return {
    schemaVersion: "conversation-runtime.plugin-manifest.v1",
    id: pluginId,
    version: input.manifest.version,
    displayName: input.manifest.displayName ?? input.manifest.label ?? formatTitle(pluginId),
    ...(input.manifest.description === undefined
      ? {}
      : { description: input.manifest.description }),
    ...(input.sourceTrust === undefined ? {} : { sourceTrust: input.sourceTrust }),
    capabilities: [
      ...normalizePluginSdkCapabilities(inferredCapabilities),
      ...(input.capabilities ?? []),
    ],
    ...(input.tools === undefined ? {} : { tools: input.tools }),
    ...(input.providers === undefined ? {} : { providers: input.providers }),
    ...(input.memoryProviders === undefined
      ? {}
      : { memory: { providers: input.memoryProviders } }),
    ...(input.externalKnowledgeConnectors === undefined
      ? {}
      : { externalKnowledge: { connectors: input.externalKnowledgeConnectors } }),
    ...(input.installPolicy === undefined ? {} : { installPolicy: input.installPolicy }),
    ...(input.approvalBoundary === undefined ? {} : { approvalBoundary: input.approvalBoundary }),
    ...((input.contracts ?? input.manifest.contracts) === undefined
      ? {}
      : { contracts: input.contracts ?? input.manifest.contracts }),
    ...(input.configSchema === undefined ? {} : { configSchema: input.configSchema }),
    ...(input.uiHints === undefined ? {} : { uiHints: input.uiHints }),
    metadata: {
      ...(input.manifest.metadata ?? {}),
      ...(input.metadata ?? {}),
      sourceManifestId: input.manifest.id,
      sourceManifestKind: input.sourceManifestKind ?? "internal-plugin",
      ...(input.manifest.kind === undefined
        ? {}
        : { sourceManifestPluginKind: input.manifest.kind }),
      ...(input.manifest.entrypoint === undefined ? {} : { entrypoint: input.manifest.entrypoint }),
    },
    ...(input.internalStores === undefined ? {} : { internalStores: input.internalStores }),
    ...(input.storeImports === undefined ? {} : { storeImports: input.storeImports }),
    ...(input.directStoreAccess === undefined
      ? {}
      : { directStoreAccess: input.directStoreAccess }),
  };
}

function createExecutablePluginLoadResult(input: {
  readonly registration: ConversationRuntimePluginSdkRegistration;
  readonly trustedEntrypoint: boolean;
  readonly blockers: readonly ConversationRuntimeExecutablePluginLoadBlocker[];
}): ConversationRuntimeExecutablePluginLoadResult {
  const registryPatch =
    input.blockers.length === 0
      ? createExecutablePluginRegistryPatch(input.registration.contractPlan)
      : {
          toolManifests: [],
          providerManifests: [],
          memoryProviders: [],
          externalKnowledgeConnectors: [],
        };
  return {
    schemaVersion: "conversation-runtime.executable-plugin-load-result.v1",
    ok: input.blockers.length === 0,
    pluginId: input.registration.pluginId,
    ...(input.registration.entrypoint === undefined
      ? {}
      : { entrypoint: input.registration.entrypoint }),
    registration: input.registration,
    registryPatch,
    sandboxBoundary: {
      directStoreAccessAllowed: false,
      allowedRegistryTargets:
        input.blockers.length === 0 ? input.registration.loadPlan.registryTargets : [],
      trustedEntrypoint: input.trustedEntrypoint,
    },
    blockers: input.blockers,
  };
}

function createExecutablePluginRegistryPatch(
  contractPlan: ConversationRuntimePluginContractPlan,
): ConversationRuntimeExecutablePluginRegistryPatch {
  return {
    toolManifests: contractPlan.externalToolManifests,
    providerManifests: contractPlan.externalProviderManifests,
    memoryProviders: contractPlan.memoryProviderContracts,
    externalKnowledgeConnectors: contractPlan.externalKnowledgeConnectorContracts,
  };
}

function createExecutablePluginRegistrationCapture(): {
  readonly context: ConversationRuntimeExecutablePluginContext;
  readonly tools: ConversationRuntimePluginTool[];
  readonly providers: ConversationRuntimePluginProvider[];
  readonly memoryProviders: ConversationRuntimePluginMemoryProviderContract[];
  readonly externalKnowledgeConnectors: ConversationRuntimeExternalKnowledgePluginConnector[];
} {
  const tools: ConversationRuntimePluginTool[] = [];
  const providers: ConversationRuntimePluginProvider[] = [];
  const memoryProviders: ConversationRuntimePluginMemoryProviderContract[] = [];
  const externalKnowledgeConnectors: ConversationRuntimeExternalKnowledgePluginConnector[] = [];
  return {
    tools,
    providers,
    memoryProviders,
    externalKnowledgeConnectors,
    context: {
      directStoreAccessAllowed: false,
      registerTool: (tool) => {
        tools.push(tool);
      },
      registerProvider: (provider) => {
        providers.push(provider);
      },
      registerMemoryProvider: (provider) => {
        memoryProviders.push({
          ...provider,
          directStoreAccessAllowed: false,
        });
      },
      registerExternalKnowledgeConnector: (connector) => {
        externalKnowledgeConnectors.push(connector);
      },
    },
  };
}

function mergeExecutablePluginRegistrationInput(
  base: CreateConversationRuntimePluginSdkRegistrationInput,
  returned: undefined | CreateConversationRuntimePluginSdkRegistrationInput,
  captured: {
    readonly tools: readonly ConversationRuntimePluginTool[];
    readonly providers: readonly ConversationRuntimePluginProvider[];
    readonly memoryProviders: readonly ConversationRuntimePluginMemoryProviderContract[];
    readonly externalKnowledgeConnectors: readonly ConversationRuntimeExternalKnowledgePluginConnector[];
  },
): CreateConversationRuntimePluginSdkRegistrationInput {
  const returnedInput: Partial<CreateConversationRuntimePluginSdkRegistrationInput> =
    returned ?? {};
  const sourceTrust = returnedInput.sourceTrust ?? base.sourceTrust;
  const sourceManifestKind = returnedInput.sourceManifestKind ?? base.sourceManifestKind;
  const installPolicy = returnedInput.installPolicy ?? base.installPolicy;
  const approvalBoundary = returnedInput.approvalBoundary ?? base.approvalBoundary;
  const contracts = returnedInput.contracts ?? base.contracts;
  const configSchema = returnedInput.configSchema ?? base.configSchema;
  const uiHints = returnedInput.uiHints ?? base.uiHints;
  const metadata = {
    ...(base.metadata ?? {}),
    ...(returnedInput.metadata ?? {}),
  };
  return {
    manifest: returnedInput.manifest ?? base.manifest,
    capabilities: [...(base.capabilities ?? []), ...(returnedInput.capabilities ?? [])],
    tools: [...(base.tools ?? []), ...(returnedInput.tools ?? []), ...captured.tools],
    providers: [
      ...(base.providers ?? []),
      ...(returnedInput.providers ?? []),
      ...captured.providers,
    ],
    memoryProviders: [
      ...(base.memoryProviders ?? []),
      ...(returnedInput.memoryProviders ?? []),
      ...captured.memoryProviders,
    ],
    externalKnowledgeConnectors: [
      ...(base.externalKnowledgeConnectors ?? []),
      ...(returnedInput.externalKnowledgeConnectors ?? []),
      ...captured.externalKnowledgeConnectors,
    ],
    internalStores: [...(base.internalStores ?? []), ...(returnedInput.internalStores ?? [])],
    storeImports: [...(base.storeImports ?? []), ...(returnedInput.storeImports ?? [])],
    directStoreAccess: base.directStoreAccess === true || returnedInput.directStoreAccess === true,
    ...(sourceTrust === undefined ? {} : { sourceTrust }),
    ...(sourceManifestKind === undefined ? {} : { sourceManifestKind }),
    ...(installPolicy === undefined ? {} : { installPolicy }),
    ...(approvalBoundary === undefined ? {} : { approvalBoundary }),
    ...(contracts === undefined ? {} : { contracts }),
    ...(configSchema === undefined ? {} : { configSchema }),
    ...(uiHints === undefined ? {} : { uiHints }),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

function normalizeTrustedEntrypointRoots(roots: readonly string[]): readonly string[] {
  return roots.map(normalizeEntrypointPath).filter((root) => root.length > 0);
}

function isTrustedPluginEntrypoint(
  entrypoint: string | undefined,
  trustedRoots: readonly string[],
): boolean {
  if (entrypoint === undefined || !entrypoint.startsWith("/")) {
    return false;
  }
  const normalized = normalizeEntrypointPath(entrypoint);
  return trustedRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function normalizeEntrypointPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/\/+/gu, "/").replace(/\/$/u, "");
}

function createPluginExternalToolManifest(
  manifest: ConversationRuntimePluginManifest,
): ExternalToolManifest {
  return {
    id: manifest.id,
    label: manifest.displayName,
    description: manifest.description ?? `${manifest.displayName} plugin tool source.`,
    source: "plugin",
    kind: "tool-source",
    providerId: manifest.id,
    enabled: true,
    capabilities: [
      ...normalizePluginCapabilities(manifest.capabilities ?? []),
      ...normalizePluginToolCapabilities(manifest.tools ?? []),
    ],
    sourceTrust: normalizePluginSourceTrust(manifest),
    installPolicy: manifest.installPolicy ?? {
      supported: false,
      defaultMode: "manual",
      requiresApproval: true,
      requiresExplicitExecute: true,
      refuses: ["silent-install", "direct-store-access"],
    },
    approvalBoundary: manifest.approvalBoundary ?? {
      mode: "runtime-policy",
      requiresOperator: hasWriteCapability(manifest),
      riskLevel: hasWriteCapability(manifest) ? "medium" : "low",
    },
    ...(manifest.contracts === undefined ? {} : { contracts: manifest.contracts }),
    ...(manifest.configSchema === undefined ? {} : { configSchema: manifest.configSchema }),
    ...(manifest.uiHints === undefined ? {} : { uiHints: manifest.uiHints }),
    metadata: {
      ...(manifest.metadata ?? {}),
      pluginId: manifest.id,
      pluginVersion: manifest.version,
      pluginManifestSchemaVersion:
        manifest.schemaVersion ?? "conversation-runtime.plugin-manifest.v1",
      pluginToolNames: normalizeStringList((manifest.tools ?? []).map((tool) => tool.name)),
      directStoreAccessAllowed: false,
    },
  };
}

function createPluginExternalProviderManifests(
  manifest: ConversationRuntimePluginManifest,
): readonly ExternalProviderManifest[] {
  const providerManifests = (manifest.providers ?? []).map((provider) =>
    normalizePluginProviderManifest(provider, manifest),
  );
  if (
    (manifest.providers ?? []).length === 0 &&
    manifest.metadata?.sourceManifestKind === "internal-plugin"
  ) {
    return [];
  }
  const openClawProvider = createExternalProviderManifestFromOpenClawPlugin({
    id: manifest.id,
    contracts: manifest.contracts,
    configSchema: manifest.configSchema,
    uiHints: manifest.uiHints,
  });
  if (providerManifests.length > 0 || openClawProvider === undefined) {
    return providerManifests;
  }
  return [openClawProvider];
}

function normalizePluginProviderManifest(
  provider: ConversationRuntimePluginProvider,
  manifest: ConversationRuntimePluginManifest,
): ExternalProviderManifest {
  return {
    id: provider.id,
    label: provider.label ?? formatTitle(provider.id),
    description:
      provider.description ??
      `${provider.label ?? formatTitle(provider.id)} provider from plugin ${manifest.id}.`,
    enabledByDefault: false,
    capabilities:
      provider.capabilities === undefined
        ? inferCapabilitiesFromContracts(provider.contracts)
        : normalizeStringList(provider.capabilities),
    ...(provider.auth === undefined ? {} : { auth: provider.auth }),
    ...(provider.contracts === undefined
      ? {}
      : { contracts: normalizeContracts(provider.contracts) }),
    ...(provider.configSchema === undefined ? {} : { configSchema: provider.configSchema }),
    ...(provider.configFields === undefined ? {} : { configFields: provider.configFields }),
    ...(provider.uiHints === undefined ? {} : { uiHints: provider.uiHints }),
    metadata: {
      ...(provider.metadata ?? {}),
      pluginId: manifest.id,
      pluginVersion: manifest.version,
      manifestFormat: "conversation-runtime.plugin",
      localDefault: false,
    },
  };
}

function normalizeMemoryProviderContracts(
  manifest: ConversationRuntimePluginManifest,
): readonly ConversationRuntimePluginMemoryProviderContract[] {
  return (manifest.memory?.providers ?? []).map((provider) => ({
    id: provider.id,
    kind: provider.kind,
    sessionScoped: provider.sessionScoped,
    directStoreAccessAllowed: false,
    ...(provider.contracts === undefined
      ? {}
      : { contracts: normalizeContracts(provider.contracts) }),
    ...(provider.requiresAuth === undefined ? {} : { requiresAuth: provider.requiresAuth }),
    metadata: {
      ...(provider.metadata ?? {}),
      pluginId: manifest.id,
      directStoreAccessAllowed: false,
    },
  }));
}

function normalizeExternalKnowledgeConnectorContracts(
  manifest: ConversationRuntimePluginManifest,
): readonly ConversationRuntimeExternalKnowledgePluginConnectorContract[] {
  return (manifest.externalKnowledge?.connectors ?? []).map((connector) => ({
    id: connector.id,
    targetKind: connector.targetKind,
    stableApi: connector.stableApi,
    requiresAuth: connector.requiresAuth ?? connector.targetKind === "external_api",
    uploadPackageRequired:
      connector.uploadPackageRequired ?? connector.targetKind === "export_package",
    directStoreAccessAllowed: false,
    ...(connector.contracts === undefined ? {} : { contracts: connector.contracts }),
    metadata: {
      ...(connector.metadata ?? {}),
      pluginId: manifest.id,
    },
  }));
}

function createPluginContractBoundaries(
  manifest: ConversationRuntimePluginManifest,
): ConversationRuntimePluginContractBoundaries {
  return {
    directStoreAccessAllowed: false,
    requiresPolicyGate:
      hasWriteCapability(manifest) ||
      (manifest.externalKnowledge?.connectors ?? []).some(
        (connector) => connector.targetKind !== "export_package",
      ),
    requiresApprovalForWrites: hasWriteCapability(manifest),
    allowedSurfaces: ["tool-registry", "provider-registry", "knowledge-connector", "memory-port"],
  };
}

function normalizePluginCapabilities(
  capabilities: readonly ConversationRuntimePluginCapability[],
): readonly ExternalToolProviderCapability[] {
  return capabilities.map((capability) => ({
    id: capability.id,
    label: capability.label,
    ...(capability.description === undefined ? {} : { description: capability.description }),
    readOnly: capability.readOnly,
    ...(capability.requiresApproval === undefined
      ? {}
      : { requiresApproval: capability.requiresApproval }),
    ...(capability.destructive === undefined ? {} : { destructive: capability.destructive }),
    ...(capability.openWorld === undefined ? {} : { openWorld: capability.openWorld }),
    ...(capability.metadata === undefined ? {} : { metadata: capability.metadata }),
  }));
}

function normalizePluginToolCapabilities(
  tools: readonly ConversationRuntimePluginTool[],
): readonly ExternalToolProviderCapability[] {
  return tools.map((tool) => ({
    id: tool.capabilityId,
    label: tool.capabilityId,
    readOnly: tool.readOnly,
    ...(tool.requiresApproval === undefined ? {} : { requiresApproval: tool.requiresApproval }),
    ...(tool.destructive === undefined ? {} : { destructive: tool.destructive }),
    metadata: {
      ...(tool.metadata ?? {}),
      pluginToolName: tool.name,
    },
  }));
}

function normalizePluginSourceTrust(
  manifest: ConversationRuntimePluginManifest,
): ExternalToolSourceTrust {
  return {
    status: manifest.sourceTrust?.status ?? "unverified",
    label: manifest.sourceTrust?.label ?? "Plugin manifest",
    ...(manifest.sourceTrust?.reason === undefined ? {} : { reason: manifest.sourceTrust.reason }),
  };
}

function createPluginContractSummary(input: {
  readonly manifest: ConversationRuntimePluginManifest;
  readonly externalToolManifests: readonly ExternalToolManifest[];
  readonly externalProviderManifests: readonly ExternalProviderManifest[];
  readonly memoryContracts: readonly ConversationRuntimePluginMemoryProviderContract[];
  readonly knowledgeContracts: readonly ConversationRuntimeExternalKnowledgePluginConnectorContract[];
}): string {
  return [
    `plugin=${input.manifest.id}`,
    `tools=${input.manifest.tools?.length ?? 0}`,
    `providers=${input.externalProviderManifests.length}`,
    `memory=${input.memoryContracts.length}`,
    `knowledge=${input.knowledgeContracts.length}`,
  ].join("; ");
}

function inferPluginRegistryTargets(
  contractPlan: ConversationRuntimePluginContractPlan,
): readonly ConversationRuntimePluginRegistryTarget[] {
  const targets: ConversationRuntimePluginRegistryTarget[] = [];
  if (
    contractPlan.externalToolManifests.some((manifest) => hasPluginToolNames(manifest.metadata))
  ) {
    targets.push("tool-registry");
  }
  if (contractPlan.externalProviderManifests.length > 0) {
    targets.push("provider-registry");
  }
  if (contractPlan.memoryProviderContracts.length > 0) {
    targets.push("memory-port");
  }
  if (contractPlan.externalKnowledgeConnectorContracts.length > 0) {
    targets.push("knowledge-connector");
  }
  return targets;
}

function inferPluginHotLoadApprovalReasons(
  contractPlan: ConversationRuntimePluginContractPlan,
): readonly string[] {
  const reasons: string[] = [];
  if (contractPlan.boundaries.requiresApprovalForWrites) {
    reasons.push("write-capability");
  }
  if (
    contractPlan.boundaries.requiresPolicyGate &&
    !contractPlan.boundaries.requiresApprovalForWrites
  ) {
    reasons.push("policy-gated-capability");
  }
  if (
    contractPlan.externalProviderManifests.some(
      (manifest) => (manifest.auth?.envVars ?? []).length > 0,
    )
  ) {
    reasons.push("provider-auth-required");
  }
  if (
    contractPlan.externalKnowledgeConnectorContracts.some(
      (connector) => connector.requiresAuth === true,
    )
  ) {
    reasons.push("knowledge-auth-required");
  }
  return normalizeStringList(reasons);
}

function createPluginHotLoadBlockers(
  contractPlan: ConversationRuntimePluginContractPlan,
): readonly ConversationRuntimePluginHotLoadBlocker[] {
  if (contractPlan.status === "admissible") {
    return [];
  }
  return [
    {
      code: "contract-blocked",
      message: "Plugin contract has blocking issues and cannot be hot-loaded.",
    },
    ...contractPlan.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => ({
        code: issue.code,
        message: issue.message,
      })),
  ];
}

function hasPluginToolNames(metadata: Readonly<Record<string, unknown>> | undefined): boolean {
  const value = metadata?.pluginToolNames;
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.length > 0);
}

function inferSdkManifestCapabilities(
  manifest: ConversationRuntimePluginSdkSourceManifest,
): readonly string[] {
  const values = normalizeStringList(manifest.capabilities ?? []);
  if (values.length > 0) {
    return values;
  }
  if (manifest.kind === "provider" || manifest.kind === "model") {
    return ["provider.register"];
  }
  if (manifest.kind === "tool") {
    return ["tool.register"];
  }
  if (manifest.kind === "memory") {
    return ["memory.read"];
  }
  return [];
}

function normalizePluginSdkCapabilities(
  capabilities: readonly string[],
): readonly ConversationRuntimePluginCapability[] {
  return capabilities.map((capability) => ({
    id: capability,
    label: capability,
    readOnly: inferSdkCapabilityReadOnly(capability),
    requiresApproval: inferSdkCapabilityRequiresApproval(capability),
  }));
}

function inferSdkCapabilityReadOnly(capability: string): boolean {
  if (/(^|[.:_-])register($|[.:_-])/iu.test(capability)) {
    return true;
  }
  return !/(^|[.:_-])(write|delete|remove|mutate|execute|register|sync|publish)($|[.:_-])/iu.test(
    capability,
  );
}

function inferSdkCapabilityRequiresApproval(capability: string): boolean {
  return !inferSdkCapabilityReadOnly(capability);
}

function normalizePluginId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (/^[a-z][a-z0-9_-]{0,63}$/u.test(normalized)) {
    return normalized;
  }
  return `plugin-${normalized}`.slice(0, 64).replace(/-+$/u, "");
}

function hasWriteCapability(manifest: ConversationRuntimePluginManifest): boolean {
  return (
    (manifest.capabilities ?? []).some((capability) => capability.readOnly === false) ||
    (manifest.tools ?? []).some((tool) => tool.readOnly === false) ||
    (manifest.externalKnowledge?.connectors ?? []).some(
      (connector) => connector.targetKind !== "export_package",
    )
  );
}

function inferCapabilitiesFromContracts(
  contracts: Readonly<Record<string, readonly string[]>> | undefined,
): readonly string[] {
  const capabilities = new Set<string>();
  for (const key of Object.keys(contracts ?? {})) {
    if (/webSearch/iu.test(key)) {
      capabilities.add("web.search");
    }
    if (/mediaGeneration/iu.test(key)) {
      capabilities.add("media.generate");
    }
  }
  for (const value of Object.values(contracts ?? {}).flat()) {
    capabilities.add(value.includes(".") ? value : `provider.${value}`);
  }
  return capabilities.size === 0 ? ["provider.invoke"] : [...capabilities].sort();
}

function normalizeContracts(
  contracts: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(contracts)
      .map(([key, values]) => [key, normalizeStringList(values)] as const)
      .filter(([, values]) => values.length > 0),
  );
}

function normalizeStringList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatTitle(id: string): string {
  return id
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

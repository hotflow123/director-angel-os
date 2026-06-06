import type {
  ExternalToolArtifact,
  ExternalToolDoctorResult,
  ExternalToolHandlerInvokeOutput,
  ExternalToolHandlerInvokeRequest,
  ExternalToolInvokeStatus,
  ExternalToolRegistration,
} from "./external-tools.js";
import { createExternalToolProviderManifest } from "./external-tools.js";
import type {
  WorkflowInteropArtifact,
  WorkflowInteropEdge,
  WorkflowInteropNode,
  WorkflowInteropPackage,
} from "./workflow-interop.js";
import {
  createWorkflowInteropPackage,
  explainWorkflowInteropConversion,
  validateWorkflowInteropPackage,
} from "./workflow-interop.js";

const COMFYUI_PROVIDER_SCHEMA_VERSION = "director.comfyui-provider.v1" as const;
const DIRECTOR_EXTERNAL_TOOL_SCHEMA_VERSION = "director.external-tool.v1" as const;

export type ComfyUiProviderOperation =
  | "artifact.fetch"
  | "dependency.fix"
  | "health"
  | "interop.buildSimple"
  | "interop.draft"
  | "lifecycle.install"
  | "workflow.inspect"
  | "workflow.run"
  | "workflow.watch";

export interface CreateComfyUiProviderRegistrationOptions {
  readonly toolId?: string;
  readonly label?: string;
  readonly description?: string;
  readonly adapter?: ComfyUiProviderAdapter;
  readonly enabled?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderAdapter {
  readonly health?: (
    input: ComfyUiProviderHealthInput,
  ) => ComfyUiProviderHealthResult | Promise<ComfyUiProviderHealthResult>;
  readonly inspectWorkflow?: (
    input: ComfyUiProviderWorkflowInspectInput,
  ) => ComfyUiProviderWorkflowInspectResult | Promise<ComfyUiProviderWorkflowInspectResult>;
  readonly runWorkflow?: (
    input: ComfyUiProviderWorkflowRunInput,
  ) => ComfyUiProviderWorkflowRunResult | Promise<ComfyUiProviderWorkflowRunResult>;
  readonly watchWorkflow?: (
    input: ComfyUiProviderWorkflowWatchInput,
  ) => ComfyUiProviderWorkflowWatchResult | Promise<ComfyUiProviderWorkflowWatchResult>;
  readonly fetchArtifact?: (
    input: ComfyUiProviderArtifactFetchInput,
  ) => ComfyUiProviderArtifactFetchResult | Promise<ComfyUiProviderArtifactFetchResult>;
  readonly install?: (
    input: ComfyUiProviderLifecycleInstallInput,
  ) => ComfyUiProviderLifecycleResult | Promise<ComfyUiProviderLifecycleResult>;
  readonly fixDependencies?: (
    input: ComfyUiProviderDependencyFixInput,
  ) => ComfyUiProviderLifecycleResult | Promise<ComfyUiProviderLifecycleResult>;
}

export interface ComfyUiProviderHealthInput {
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderHealthResult {
  readonly ok: boolean;
  readonly status: ExternalToolDoctorResult["status"];
  readonly summary: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly nextActions?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderWorkflowInspectInput {
  readonly workflowJson?: unknown;
  readonly workflowPath?: string;
  readonly objectInfo?: unknown;
  readonly installedModels?: Readonly<Record<string, readonly string[]>>;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderWorkflowInspectResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly report?: unknown;
  readonly output?: unknown;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderWorkflowRunInput {
  readonly prompt: string;
  readonly workflowJson?: unknown;
  readonly workflowPath?: string;
  readonly outputConfig?: Readonly<Record<string, unknown>>;
  readonly outputDir?: string;
  readonly clientId?: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderWorkflowRunResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly promptId?: string;
  readonly progressEvents?: readonly unknown[];
  readonly output?: unknown;
  readonly artifacts?: readonly ComfyUiProviderArtifact[];
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderWorkflowWatchInput {
  readonly promptId: string;
  readonly timeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly resumeToken?: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderWorkflowWatchResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly promptId?: string;
  readonly status?: string;
  readonly events?: readonly unknown[];
  readonly partial?: boolean;
  readonly resumeToken?: string;
  readonly output?: unknown;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderArtifactFetchInput {
  readonly promptId?: string;
  readonly filename?: string;
  readonly subfolder?: string;
  readonly type?: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderArtifactFetchResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly artifact?: ComfyUiProviderArtifact;
  readonly artifacts?: readonly ComfyUiProviderArtifact[];
  readonly output?: unknown;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderLifecycleInstallInput {
  readonly dryRun?: boolean;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderDependencyFixInput {
  readonly workflowJson?: unknown;
  readonly workflowPath?: string;
  readonly dryRun?: boolean;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderLifecycleResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly output?: unknown;
  readonly artifacts?: readonly ComfyUiProviderArtifact[];
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderArtifact {
  readonly id?: string;
  readonly kind: string;
  readonly path?: string;
  readonly localPath?: string;
  readonly url?: string;
  readonly filename?: string;
  readonly subfolder?: string;
  readonly type?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface ComfyUiWorkflowRunReadinessReport {
  readonly schemaVersion: "director.comfyui-workflow-run-readiness.v1";
  readonly ready: boolean;
  readonly workflow: {
    readonly provided: boolean;
    readonly source: "json" | "path" | "none";
    readonly nodeCount?: number;
    readonly outputNodeIds: readonly string[];
  };
  readonly dependencies: {
    readonly missingDependencies: readonly string[];
  };
  readonly output: {
    readonly configured: boolean;
    readonly outputDir?: string;
    readonly outputConfig?: Readonly<Record<string, unknown>>;
    readonly outputNodeIds: readonly string[];
  };
  readonly blockers: readonly ComfyUiWorkflowRunReadinessBlocker[];
  readonly nextActions: readonly string[];
}

interface ComfyUiWorkflowRunReadinessBlocker {
  readonly code:
    | "missing_dependencies"
    | "output_config_required"
    | "output_nodes_required"
    | "workflow_empty"
    | "workflow_required";
  readonly message: string;
  readonly path?: string;
  readonly items?: readonly string[];
  readonly recoverable: boolean;
}

export interface ComfyUiProviderEnvelope {
  readonly schemaVersion: typeof DIRECTOR_EXTERNAL_TOOL_SCHEMA_VERSION;
  readonly status: "error" | "success" | "unavailable";
  readonly provider: "comfyui";
  readonly operation: string;
  readonly summary: string;
  readonly output?: unknown;
  readonly error?: ComfyUiProviderErrorEnvelope | null;
  readonly nextActions: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ComfyUiProviderErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly rootCauseHint: string;
  readonly safeRetry: {
    readonly strategy: "manual" | "policy.exponential_backoff";
    readonly executor: "operator" | "orchestrator";
    readonly maxAttemptsRef?: string;
    readonly initialDelayMsRef?: string;
    readonly instruction?: string;
  };
  readonly stopCondition: {
    readonly type: "operator_action_required" | "policy.max_attempts_reached";
    readonly action: "return_error_to_brain" | "wait_for_operator";
  };
  readonly retryHistory: readonly unknown[];
}

export function createComfyUiProviderRegistration(
  options: CreateComfyUiProviderRegistrationOptions = {},
): ExternalToolRegistration {
  const toolId = options.toolId ?? "comfyui.provider";
  const adapter = options.adapter ?? createMissingComfyUiProviderAdapter();
  return {
    manifest: createExternalToolProviderManifest({
      id: toolId,
      label: options.label ?? "ComfyUI",
      description:
        options.description ??
        "External ComfyUI workflow provider exposed through the shared Director Angel external-tool boundary.",
      source: "external",
      providerId: "comfyui",
      enabled: options.enabled ?? true,
      capabilities: createComfyUiProviderCapabilities(),
      sourceTrust: {
        status: "trusted-local-config",
        label: "Local or configured ComfyUI endpoint",
        reason: "ComfyUI is controlled through the shared provider/orchestrator contract.",
      },
      approvalBoundary: {
        mode: "runtime-policy",
        actionLabels: ["确认", "拒绝"],
        requiresOperator: true,
        riskLevel: "high",
      },
      metadata: {
        ...(options.metadata ?? {}),
        schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
        providerFamily: "workflow-production",
        outputContract: "external-artifact",
      },
    }),
    check: async () => checkComfyUiProviderHealth(adapter),
    invoke: async (request) => invokeComfyUiProvider(request, adapter),
    allowInvokeWhenUnavailable: true,
  };
}

function createComfyUiProviderCapabilities() {
  return [
    {
      id: "health",
      label: "ComfyUI health",
      description: "Check ComfyUI endpoint, queue, model, and workflow readiness.",
      readOnly: true,
      metadata: { capability: "comfyui.health" },
    },
    {
      id: "workflow.inspect",
      label: "ComfyUI workflow inspect",
      description: "Inspect a ComfyUI workflow graph without submitting generation.",
      readOnly: true,
      metadata: { capability: "comfyui.workflow.inspect" },
    },
    {
      id: "interop.draft",
      label: "ComfyUI interop draft",
      description:
        "Convert a Director workflow interop package into a ComfyUI draft conversion report without execution.",
      readOnly: true,
      metadata: { capability: "comfyui.interop.draft" },
    },
    {
      id: "interop.buildSimple",
      label: "ComfyUI simple interop build",
      description:
        "Build an executable ComfyUI API workflow object only for lossless simple linear image interop packages without submitting execution.",
      readOnly: true,
      metadata: { capability: "comfyui.interop.build_simple" },
    },
    {
      id: "workflow.run",
      label: "ComfyUI workflow run",
      description:
        "Submit an approved, workflow-driven ComfyUI run after explicit graph, dependency, and output readiness checks.",
      readOnly: false,
      requiresApproval: true,
      metadata: {
        capability: "comfyui.workflow.run",
        riskLevel: "high",
        workflowDriven: true,
        requiredInputs: ["workflowJson|workflowPath", "outputDir|outputConfig"],
        preflight: "director.comfyui-workflow-run-readiness.v1",
      },
    },
    {
      id: "workflow.watch",
      label: "ComfyUI workflow watch",
      description: "Watch ComfyUI prompt progress through the orchestrator lifecycle.",
      readOnly: true,
      metadata: {
        capability: "comfyui.workflow.watch",
        lifecycle: "orchestrator-watch",
      },
    },
    {
      id: "artifact.fetch",
      label: "ComfyUI artifact fetch",
      description: "Fetch a ComfyUI output artifact by structured output reference.",
      readOnly: true,
      metadata: {
        capability: "comfyui.artifact.fetch",
        argAdmission: {
          blockedStringPatterns: ["(^|/)\\.\\.(?:/|$)", "[;&|`$]"],
        },
      },
    },
    {
      id: "lifecycle.install",
      label: "ComfyUI lifecycle install",
      description: "Install or prepare local ComfyUI through an approved sandbox-owned runner.",
      readOnly: false,
      requiresApproval: true,
      metadata: {
        capability: "comfyui.lifecycle.install",
        riskLevel: "high",
        argAdmission: {
          blockedStringPatterns: ["(^|/)\\.\\.(?:/|$)", "[;&|`$]"],
        },
      },
    },
    {
      id: "dependency.fix",
      label: "ComfyUI dependency fix",
      description: "Plan or apply approved ComfyUI workflow dependency fixes.",
      readOnly: false,
      requiresApproval: true,
      metadata: {
        capability: "comfyui.dependency.fix",
        riskLevel: "high",
        argAdmission: {
          blockedStringPatterns: ["(^|/)\\.\\.(?:/|$)", "[;&|`$]"],
        },
      },
    },
  ] as const;
}

async function checkComfyUiProviderHealth(
  adapter: ComfyUiProviderAdapter,
): Promise<ExternalToolDoctorResult> {
  const health = await adapter.health?.({ args: {} });
  if (health === undefined) {
    return {
      status: "misconfigured",
      summary: "ComfyUI provider adapter is not configured.",
      nextActions: ["Register a ComfyUI provider adapter before invoking workflow operations."],
      details: {
        schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
      },
    };
  }
  return {
    status: health.status,
    summary: health.summary,
    nextActions: health.nextActions ?? [],
    details: {
      schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
      ...sanitizeComfyUiProviderValue(health.details),
    },
    metadata: {
      schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
      ...(sanitizeComfyUiProviderValue(health.metadata) ?? {}),
    },
  };
}

async function invokeComfyUiProvider(
  request: ExternalToolHandlerInvokeRequest,
  adapter: ComfyUiProviderAdapter,
): Promise<ExternalToolHandlerInvokeOutput> {
  const operation = normalizeComfyUiOperation(request.operationId);
  if (operation === null) {
    const errorEnvelope = createComfyUiProviderErrorEnvelope({
      code: "COMFYUI_OPERATION_UNSUPPORTED",
      message: `Unsupported ComfyUI operation: ${String(request.operationId ?? "")}`,
      rootCauseHint: "The requested operation is not part of the ComfyUI provider surface.",
      retryExecutor: "operator",
      retryInstruction: "Choose an operation declared by the ComfyUI provider manifest.",
    });
    return createComfyUiProviderInvokeError({
      operation: String(request.operationId ?? "unknown"),
      errorEnvelope,
      status: "error",
    });
  }

  switch (operation) {
    case "health":
      return invokeComfyUiHealth(adapter);
    case "workflow.inspect":
      return invokeComfyUiWorkflowInspect(adapter, request);
    case "interop.draft":
      return invokeComfyUiInteropDraft(request);
    case "interop.buildSimple":
      return invokeComfyUiInteropBuildSimple(request);
    case "workflow.run":
      return invokeComfyUiWorkflowRun(adapter, request);
    case "workflow.watch":
      return invokeComfyUiWorkflowWatch(adapter, request);
    case "artifact.fetch":
      return invokeComfyUiArtifactFetch(adapter, request);
    case "lifecycle.install":
      return invokeComfyUiLifecycleInstall(adapter, request);
    case "dependency.fix":
      return invokeComfyUiDependencyFix(adapter, request);
  }
}

async function invokeComfyUiHealth(
  adapter: ComfyUiProviderAdapter,
): Promise<ExternalToolHandlerInvokeOutput> {
  if (adapter.health === undefined) {
    return createComfyUiOperationUnavailable("health");
  }
  const health = await adapter.health({ args: {} });
  const success = health.ok && health.status === "ready";
  return {
    ok: success,
    status: success ? "success" : mapComfyUiStatusToInvokeStatus(health.status),
    content: health.summary,
    output: createComfyUiProviderEnvelope({
      status: success ? "success" : mapComfyUiStatusToEnvelopeStatus(health.status),
      operation: "health",
      summary: health.summary,
      output: {
        status: health.status,
        details: sanitizeComfyUiProviderValue(health.details),
      },
      ...(health.nextActions === undefined ? {} : { nextActions: health.nextActions }),
      ...optionalRecordField("metadata", sanitizeComfyUiProviderValue(health.metadata)),
    }),
    metadata: {
      schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
      operation: "health",
    },
  };
}

async function invokeComfyUiWorkflowInspect(
  adapter: ComfyUiProviderAdapter,
  request: ExternalToolHandlerInvokeRequest,
): Promise<ExternalToolHandlerInvokeOutput> {
  if (adapter.inspectWorkflow === undefined) {
    return createComfyUiOperationUnavailable("workflow.inspect");
  }
  const args = request.args ?? {};
  const workflowPath = readOptionalString(args.workflowPath);
  const installedModels = readInstalledModels(args.installedModels);
  const result = await adapter.inspectWorkflow({
    workflowJson: args.workflowJson,
    objectInfo: args.objectInfo,
    ...(workflowPath === undefined ? {} : { workflowPath }),
    ...(installedModels === undefined ? {} : { installedModels }),
    args,
  });
  return createComfyUiGenericResult({
    operation: "workflow.inspect",
    result,
    output: result.output ?? { report: result.report },
  });
}

function invokeComfyUiInteropDraft(
  request: ExternalToolHandlerInvokeRequest,
): ExternalToolHandlerInvokeOutput {
  const input = request.args?.interopPackage ?? request.args?.package ?? request.args;
  const validation = validateWorkflowInteropPackage(input);
  if (!validation.ok || validation.package === undefined) {
    const errorEnvelope = createComfyUiProviderErrorEnvelope({
      code: "COMFYUI_INTEROP_PACKAGE_INVALID",
      message: `ComfyUI interop draft requires a valid workflow package: ${validation.errors.join("; ")}`,
      rootCauseHint: "The input must be a director.workflow-interop.v1 package.",
      retryExecutor: "operator",
      retryInstruction: "Pass a valid workflow interop package, then retry interop.draft.",
    });
    return createComfyUiProviderInvokeError({
      operation: "interop.draft",
      errorEnvelope,
      status: "error",
    });
  }
  const draft = createComfyUiInteropDraftReport(validation.package);
  return {
    ok: true,
    status: "success",
    content: "ComfyUI interop draft report created.",
    output: createComfyUiProviderEnvelope({
      status: "success",
      operation: "interop.draft",
      summary: "ComfyUI interop draft report created.",
      output: draft,
    }),
    metadata: {
      schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
      operation: "interop.draft",
      interopPackageId: validation.package.id,
    },
    artifacts: draft.artifacts,
  };
}

function invokeComfyUiInteropBuildSimple(
  request: ExternalToolHandlerInvokeRequest,
): ExternalToolHandlerInvokeOutput {
  const input = request.args?.interopPackage ?? request.args?.package ?? request.args;
  const validation = validateWorkflowInteropPackage(input);
  if (!validation.ok || validation.package === undefined) {
    const errorEnvelope = createComfyUiProviderErrorEnvelope({
      code: "COMFYUI_INTEROP_PACKAGE_INVALID",
      message: `ComfyUI simple build requires a valid workflow package: ${validation.errors.join("; ")}`,
      rootCauseHint: "The input must be a director.workflow-interop.v1 package.",
      retryExecutor: "operator",
      retryInstruction: "Pass a valid workflow interop package, then retry interop.buildSimple.",
    });
    return createComfyUiProviderInvokeError({
      operation: "interop.buildSimple",
      errorEnvelope,
      status: "error",
    });
  }

  const build = createComfyUiSimpleInteropBuild(validation.package);
  if (build.executable !== true) {
    const errorEnvelope = createComfyUiProviderErrorEnvelope({
      code: "COMFYUI_INTEROP_BUILD_BLOCKED",
      message: "ComfyUI simple API workflow build is blocked by conversion or graph requirements.",
      rootCauseHint:
        "Only lossless simple linear image packages with mapped prompt and checkpoint can be built.",
      retryExecutor: "operator",
      retryInstruction:
        "Inspect the blocked report, resolve missing dependencies/unmapped fields, then retry.",
    });
    return {
      ok: false,
      status: "error",
      content: "ComfyUI simple API workflow build blocked.",
      error: errorEnvelope.code,
      output: createComfyUiProviderEnvelope({
        status: "error",
        operation: "interop.buildSimple",
        summary: "ComfyUI simple API workflow build blocked.",
        output: build,
        error: errorEnvelope,
      }),
      metadata: {
        schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
        operation: "interop.buildSimple",
        interopPackageId: validation.package.id,
      },
    };
  }

  return {
    ok: true,
    status: "success",
    content: "ComfyUI simple API workflow built.",
    output: createComfyUiProviderEnvelope({
      status: "success",
      operation: "interop.buildSimple",
      summary: "ComfyUI simple API workflow built.",
      output: build,
    }),
    metadata: {
      schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
      operation: "interop.buildSimple",
      interopPackageId: validation.package.id,
    },
  };
}

async function invokeComfyUiWorkflowRun(
  adapter: ComfyUiProviderAdapter,
  request: ExternalToolHandlerInvokeRequest,
): Promise<ExternalToolHandlerInvokeOutput> {
  if (adapter.runWorkflow === undefined) {
    return createComfyUiOperationUnavailable("workflow.run");
  }
  const args = request.args ?? {};
  const workflowPath = readOptionalString(args.workflowPath);
  const outputConfig = readOptionalRecord(args.outputConfig);
  const outputDir = readOptionalString(args.outputDir);
  const clientId = readOptionalString(args.clientId);
  const timeoutMs = readOptionalNumber(args.timeoutMs);
  const pollIntervalMs = readOptionalNumber(args.pollIntervalMs);
  const readiness = createComfyUiWorkflowRunReadiness({
    workflowJson: args.workflowJson,
    ...(workflowPath === undefined ? {} : { workflowPath }),
    ...(outputConfig === undefined ? {} : { outputConfig }),
    ...(outputDir === undefined ? {} : { outputDir }),
    args,
  });
  if (!readiness.ready) {
    const errorEnvelope = createComfyUiProviderErrorEnvelope({
      code: "COMFYUI_WORKFLOW_RUN_NOT_READY",
      message:
        "ComfyUI workflow.run is blocked until workflow, dependency, and output readiness pass.",
      rootCauseHint:
        "ComfyUI execution must start from an explicit API workflow graph or path, verified dependencies, and traceable output configuration.",
      retryExecutor: "operator",
      retryInstruction:
        "Run workflow.inspect/check_deps, resolve blockers, provide outputDir or outputConfig, then request approval again.",
    });
    return {
      ok: false,
      status: "error",
      content: "ComfyUI workflow.run readiness check failed.",
      error: errorEnvelope.code,
      output: createComfyUiProviderEnvelope({
        status: "error",
        operation: "workflow.run",
        summary: "ComfyUI workflow.run readiness check failed.",
        output: { readiness },
        error: errorEnvelope,
      }),
      metadata: {
        schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
        operation: "workflow.run",
        readiness,
      },
    };
  }
  const result = await adapter.runWorkflow({
    prompt:
      readOptionalString(args.prompt) ??
      `ComfyUI workflow ${workflowPath === undefined ? "json" : workflowPath}`,
    workflowJson: args.workflowJson,
    ...(workflowPath === undefined ? {} : { workflowPath }),
    ...(outputConfig === undefined ? {} : { outputConfig }),
    ...(outputDir === undefined ? {} : { outputDir }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    args,
  });
  const artifacts = createComfyUiExternalToolArtifacts(
    result.artifacts,
    result.promptId === undefined ? {} : { promptId: result.promptId },
  );
  return {
    ...createComfyUiGenericResult({
      operation: "workflow.run",
      result,
      output: {
        ...(isRecord(result.output) ? result.output : {}),
        ...(result.promptId === undefined ? {} : { promptId: result.promptId }),
        ...(result.progressEvents === undefined ? {} : { progressEvents: result.progressEvents }),
        workflowRunReadiness: readiness,
      },
    }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
  };
}

function createComfyUiWorkflowRunReadiness(input: {
  readonly workflowJson?: unknown;
  readonly workflowPath?: string;
  readonly outputConfig?: Readonly<Record<string, unknown>>;
  readonly outputDir?: string;
  readonly args: Readonly<Record<string, unknown>>;
}): ComfyUiWorkflowRunReadinessReport {
  const blockers: ComfyUiWorkflowRunReadinessBlocker[] = [];
  const workflowInfo = inspectComfyUiWorkflowInput(input.workflowJson, input.workflowPath);
  const missingDependencies = collectComfyUiMissingDependencies(input.args);
  const outputNodeIds = workflowInfo.outputNodeIds;
  const outputConfigured =
    input.outputDir !== undefined || hasComfyUiOutputConfig(input.outputConfig);
  if (!workflowInfo.provided) {
    blockers.push({
      code: "workflow_required",
      message: "ComfyUI workflow.run requires workflowJson or workflowPath.",
      path: "workflowJson",
      recoverable: true,
    });
  } else if (workflowInfo.source === "json" && workflowInfo.nodeCount === 0) {
    blockers.push({
      code: "workflow_empty",
      message: "ComfyUI workflowJson must contain at least one API-format node.",
      path: "workflowJson",
      recoverable: true,
    });
  }
  if (missingDependencies.length > 0) {
    blockers.push({
      code: "missing_dependencies",
      message: "ComfyUI workflow dependencies are not fully installed or resolved.",
      path: "missingDependencies",
      items: missingDependencies,
      recoverable: true,
    });
  }
  if (!outputConfigured) {
    blockers.push({
      code: "output_config_required",
      message: "ComfyUI workflow.run requires outputDir or outputConfig for traceable artifacts.",
      path: "outputDir",
      recoverable: true,
    });
  }
  if (
    workflowInfo.source === "json" &&
    outputNodeIds.length === 0 &&
    !hasComfyUiOutputNodeConfig(input.outputConfig)
  ) {
    blockers.push({
      code: "output_nodes_required",
      message:
        "ComfyUI workflowJson must expose a Save/VideoCombine output node or outputConfig.outputNodeIds.",
      path: "workflowJson",
      recoverable: true,
    });
  }
  return {
    schemaVersion: "director.comfyui-workflow-run-readiness.v1",
    ready: blockers.length === 0,
    workflow: workflowInfo,
    dependencies: { missingDependencies },
    output: {
      configured: outputConfigured,
      ...(input.outputDir === undefined ? {} : { outputDir: input.outputDir }),
      ...(input.outputConfig === undefined
        ? {}
        : { outputConfig: sanitizeComfyUiProviderValue(input.outputConfig) ?? input.outputConfig }),
      outputNodeIds,
    },
    blockers,
    nextActions:
      blockers.length === 0
        ? ["Request explicit approval before executing workflow.run."]
        : [
            "Provide workflowJson or workflowPath in API format.",
            "Run workflow.inspect/check_deps and resolve missing dependencies.",
            "Provide outputDir or outputConfig and ensure output nodes are traceable.",
          ],
  };
}

function inspectComfyUiWorkflowInput(
  workflowJson: unknown,
  workflowPath: string | undefined,
): ComfyUiWorkflowRunReadinessReport["workflow"] {
  if (isRecord(workflowJson)) {
    const entries = Object.entries(workflowJson).flatMap(([id, value]) =>
      isRecord(value) ? [{ id, value }] : [],
    );
    return {
      provided: true,
      source: "json",
      nodeCount: entries.length,
      outputNodeIds: entries.flatMap(({ id, value }) =>
        isComfyUiOutputClass(readOptionalString(value.class_type)) ? [id] : [],
      ),
    };
  }
  if (workflowPath !== undefined) {
    return { provided: true, source: "path", outputNodeIds: [] };
  }
  return { provided: false, source: "none", outputNodeIds: [] };
}

function isComfyUiOutputClass(classType: string | undefined): boolean {
  if (classType === undefined) {
    return false;
  }
  const normalized = classType.toLowerCase();
  return (
    normalized.startsWith("save") ||
    normalized.includes("saveimage") ||
    normalized.includes("imagesave") ||
    normalized.includes("videocombine") ||
    normalized.includes("saveaudio") ||
    normalized.includes("savevideo")
  );
}

function collectComfyUiMissingDependencies(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  return uniqueStrings([
    ...readStringArray(args.missingDependencies),
    ...readStringArray(readNestedValue(args.readiness, "missingDependencies")),
    ...readStringArray(readNestedValue(args.dependencyReport, "missingDependencies")),
    ...readStringArray(readNestedValue(args.inspectReport, "missingDependencies")),
  ]);
}

function hasComfyUiOutputConfig(value: Readonly<Record<string, unknown>> | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return (
    readOptionalString(value.outputDir) !== undefined ||
    readOptionalString(value.targetDirectory) !== undefined ||
    readStringArray(value.expectedArtifacts).length > 0 ||
    hasComfyUiOutputNodeConfig(value)
  );
}

function hasComfyUiOutputNodeConfig(value: Readonly<Record<string, unknown>> | undefined): boolean {
  return value !== undefined && readStringArray(value.outputNodeIds).length > 0;
}

async function invokeComfyUiWorkflowWatch(
  adapter: ComfyUiProviderAdapter,
  request: ExternalToolHandlerInvokeRequest,
): Promise<ExternalToolHandlerInvokeOutput> {
  if (adapter.watchWorkflow === undefined) {
    return createComfyUiOperationUnavailable("workflow.watch");
  }
  const args = request.args ?? {};
  const timeoutMs = readOptionalNumber(args.timeoutMs);
  const heartbeatIntervalMs = readOptionalNumber(args.heartbeatIntervalMs);
  const resumeToken = readOptionalString(args.resumeToken);
  const result = await adapter.watchWorkflow({
    promptId: readRequiredString(args.promptId, "promptId"),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs }),
    ...(resumeToken === undefined ? {} : { resumeToken }),
    args,
  });
  return {
    ...createComfyUiGenericResult({
      operation: "workflow.watch",
      result,
      output: {
        ...(isRecord(result.output) ? result.output : {}),
        ...(result.promptId === undefined ? {} : { promptId: result.promptId }),
        ...(result.status === undefined ? {} : { status: result.status }),
        ...(result.events === undefined ? {} : { events: result.events }),
        ...(result.partial === undefined ? {} : { partial: result.partial }),
        ...(result.resumeToken === undefined ? {} : { resumeToken: result.resumeToken }),
      },
    }),
    metadata: {
      schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
      operation: "workflow.watch",
      lifecycle: "orchestrator-watch",
      resumable: true,
      ...(result.resumeToken === undefined ? {} : { resumeToken: result.resumeToken }),
      ...(sanitizeComfyUiProviderValue(result.metadata) ?? {}),
    },
  };
}

async function invokeComfyUiArtifactFetch(
  adapter: ComfyUiProviderAdapter,
  request: ExternalToolHandlerInvokeRequest,
): Promise<ExternalToolHandlerInvokeOutput> {
  if (adapter.fetchArtifact === undefined) {
    return createComfyUiOperationUnavailable("artifact.fetch");
  }
  const args = request.args ?? {};
  const promptId = readOptionalString(args.promptId);
  const filename = readOptionalString(args.filename);
  const subfolder = readOptionalString(args.subfolder);
  const type = readOptionalString(args.type);
  const result = await adapter.fetchArtifact({
    ...(promptId === undefined ? {} : { promptId }),
    ...(filename === undefined ? {} : { filename }),
    ...(subfolder === undefined ? {} : { subfolder }),
    ...(type === undefined ? {} : { type }),
    args,
  });
  const artifacts = createComfyUiExternalToolArtifacts(
    result.artifacts ?? (result.artifact === undefined ? [] : [result.artifact]),
    promptId === undefined ? {} : { promptId },
  );
  return {
    ...createComfyUiGenericResult({
      operation: "artifact.fetch",
      result,
      output: result.output ?? { artifactCount: artifacts.length },
    }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
  };
}

async function invokeComfyUiLifecycleInstall(
  adapter: ComfyUiProviderAdapter,
  request: ExternalToolHandlerInvokeRequest,
): Promise<ExternalToolHandlerInvokeOutput> {
  if (adapter.install === undefined) {
    return createComfyUiOperationUnavailable("lifecycle.install");
  }
  const args = request.args ?? {};
  const result = await adapter.install({
    dryRun: request.dryRun === true || readOptionalBoolean(args.dryRun) === true,
    args,
  });
  const artifacts = createComfyUiExternalToolArtifacts(result.artifacts);
  return {
    ...createComfyUiGenericResult({
      operation: "lifecycle.install",
      result,
      output: result.output,
    }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
  };
}

async function invokeComfyUiDependencyFix(
  adapter: ComfyUiProviderAdapter,
  request: ExternalToolHandlerInvokeRequest,
): Promise<ExternalToolHandlerInvokeOutput> {
  if (adapter.fixDependencies === undefined) {
    return createComfyUiOperationUnavailable("dependency.fix");
  }
  const args = request.args ?? {};
  const workflowPath = readOptionalString(args.workflowPath);
  const result = await adapter.fixDependencies({
    workflowJson: args.workflowJson,
    ...(workflowPath === undefined ? {} : { workflowPath }),
    dryRun: request.dryRun === true || readOptionalBoolean(args.dryRun) === true,
    args,
  });
  const artifacts = createComfyUiExternalToolArtifacts(result.artifacts);
  return {
    ...createComfyUiGenericResult({
      operation: "dependency.fix",
      result,
      output: result.output,
    }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
  };
}

function createComfyUiGenericResult(input: {
  readonly operation: ComfyUiProviderOperation;
  readonly result: {
    readonly ok: boolean;
    readonly summary: string;
    readonly error?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly output?: unknown;
}): ExternalToolHandlerInvokeOutput {
  const errorEnvelope =
    input.result.ok || input.result.error === undefined
      ? undefined
      : createComfyUiProviderErrorEnvelope({
          code: input.result.error,
          message: input.result.summary,
          rootCauseHint: createComfyUiRootCauseHint(input.result.error),
        });
  return {
    ok: input.result.ok,
    status: input.result.ok ? "success" : "error",
    content: input.result.summary,
    output: createComfyUiProviderEnvelope({
      status: input.result.ok ? "success" : "error",
      operation: input.operation,
      summary: input.result.summary,
      output: sanitizeComfyUiProviderValue(input.output),
      ...(errorEnvelope === undefined ? {} : { error: errorEnvelope }),
      ...optionalRecordField("metadata", sanitizeComfyUiProviderValue(input.result.metadata)),
    }),
    ...(input.result.error === undefined ? {} : { error: input.result.error }),
    metadata: {
      schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
      operation: input.operation,
      ...(sanitizeComfyUiProviderValue(input.result.metadata) ?? {}),
    },
  };
}

function createComfyUiProviderInvokeError(input: {
  readonly operation: string;
  readonly errorEnvelope: ComfyUiProviderErrorEnvelope;
  readonly status: ExternalToolInvokeStatus;
}): ExternalToolHandlerInvokeOutput {
  return {
    ok: false,
    status: input.status,
    content: input.errorEnvelope.message,
    error: input.errorEnvelope.code,
    output: createComfyUiProviderEnvelope({
      status: input.status === "unavailable" ? "unavailable" : "error",
      operation: input.operation,
      summary: input.errorEnvelope.message,
      error: input.errorEnvelope,
    }),
    metadata: {
      schemaVersion: COMFYUI_PROVIDER_SCHEMA_VERSION,
      retryHistory: [],
    },
  };
}

function createComfyUiOperationUnavailable(
  operation: ComfyUiProviderOperation,
): ExternalToolHandlerInvokeOutput {
  const errorEnvelope = createComfyUiProviderErrorEnvelope({
    code: "COMFYUI_OPERATION_UNAVAILABLE",
    message: `ComfyUI operation ${operation} has no configured adapter handler.`,
    rootCauseHint:
      "The shared provider is registered, but the host adapter did not bind this operation.",
    retryExecutor: "operator",
    retryInstruction: "Bind the ComfyUI host adapter operation, then retry.",
  });
  return createComfyUiProviderInvokeError({
    operation,
    errorEnvelope,
    status: "error",
  });
}

function createComfyUiProviderEnvelope(input: {
  readonly status: ComfyUiProviderEnvelope["status"];
  readonly operation: string;
  readonly summary: string;
  readonly output?: unknown;
  readonly error?: ComfyUiProviderErrorEnvelope | null;
  readonly nextActions?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}): ComfyUiProviderEnvelope {
  return {
    schemaVersion: DIRECTOR_EXTERNAL_TOOL_SCHEMA_VERSION,
    status: input.status,
    provider: "comfyui",
    operation: input.operation,
    summary: input.summary,
    ...(input.output === undefined ? {} : { output: input.output }),
    error: input.error ?? null,
    nextActions: input.nextActions ?? [],
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

function createComfyUiProviderErrorEnvelope(input: {
  readonly code: string;
  readonly message: string;
  readonly rootCauseHint: string;
  readonly retryExecutor?: "operator" | "orchestrator";
  readonly retryInstruction?: string;
}): ComfyUiProviderErrorEnvelope {
  const retryExecutor = input.retryExecutor ?? "orchestrator";
  return {
    code: input.code,
    message: input.message,
    rootCauseHint: input.rootCauseHint,
    safeRetry:
      retryExecutor === "orchestrator"
        ? {
            strategy: "policy.exponential_backoff",
            executor: "orchestrator",
            maxAttemptsRef: "providerPolicy.comfyui.retry.maxAttempts",
            initialDelayMsRef: "providerPolicy.comfyui.retry.initialDelayMs",
          }
        : {
            strategy: "manual",
            executor: "operator",
            instruction: input.retryInstruction ?? "Check ComfyUI state and retry manually.",
          },
    stopCondition:
      retryExecutor === "orchestrator"
        ? {
            type: "policy.max_attempts_reached",
            action: "return_error_to_brain",
          }
        : {
            type: "operator_action_required",
            action: "wait_for_operator",
          },
    retryHistory: [],
  };
}

function createComfyUiExternalToolArtifacts(
  artifacts: readonly ComfyUiProviderArtifact[] | undefined,
  metadata: Readonly<Record<string, unknown>> = {},
): readonly ExternalToolArtifact[] {
  return (artifacts ?? []).map((artifact, index) => {
    const path = artifact.localPath ?? artifact.path;
    return {
      id: artifact.id ?? createComfyUiArtifactId(artifact, index),
      kind: artifact.kind,
      ...(path === undefined ? {} : { path }),
      ...(artifact.url === undefined ? {} : { url: artifact.url }),
      metadata: {
        provider: "comfyui",
        ...sanitizeComfyUiProviderValue(metadata),
        ...(artifact.filename === undefined ? {} : { filename: artifact.filename }),
        ...(artifact.subfolder === undefined ? {} : { subfolder: artifact.subfolder }),
        ...(artifact.type === undefined ? {} : { type: artifact.type }),
        ...(sanitizeComfyUiProviderValue(artifact.metadata) ?? {}),
      },
    };
  });
}

function createComfyUiArtifactId(artifact: ComfyUiProviderArtifact, index: number): string {
  const base = artifact.filename ?? artifact.url ?? artifact.path ?? artifact.localPath;
  if (base === undefined || base.trim().length === 0) {
    return `comfyui-artifact-${index + 1}`;
  }
  return `comfyui-${base.replace(/[^a-zA-Z0-9._-]+/gu, "-").slice(0, 96)}`;
}

function createComfyUiInteropDraftReport(interopPackage: WorkflowInteropPackage): {
  readonly schemaVersion: "director.comfyui-interop-draft.v1";
  readonly status: "draft";
  readonly executable: false;
  readonly interopPackage: WorkflowInteropPackage;
  readonly draftWorkflow: Readonly<Record<string, unknown>>;
  readonly conversion: ReturnType<typeof explainWorkflowInteropConversion>;
  readonly nextActions: readonly string[];
  readonly artifacts: readonly ExternalToolArtifact[];
} {
  const targetPackage = createWorkflowInteropPackage({
    ...interopPackage,
    target: { provider: "comfyui", format: "comfyui.api-workflow.draft" },
    conversion: {
      executable: false,
      lossiness: interopPackage.conversion.lossiness,
      unmappedFields: interopPackage.conversion.unmappedFields,
      missingDependencies: interopPackage.conversion.missingDependencies,
      logs: [
        ...interopPackage.conversion.logs,
        "ComfyUI draft conversion report only; run workflow.inspect/checkDeps before execution.",
      ],
    },
  });
  const conversion = explainWorkflowInteropConversion(targetPackage);
  const draftWorkflow = createComfyUiDraftWorkflowObject(targetPackage);
  return {
    schemaVersion: "director.comfyui-interop-draft.v1",
    status: "draft",
    executable: false,
    interopPackage: targetPackage,
    draftWorkflow,
    conversion,
    nextActions: [
      "Run ComfyUI workflow.inspect against the draft workflow.",
      "Resolve missingDependencies before considering workflow.run.",
      "Only mark executable after dependency checks and an explicit conversion adapter pass.",
    ],
    artifacts: createComfyUiInteropDraftArtifacts(targetPackage),
  };
}

function createComfyUiDraftWorkflowObject(
  interopPackage: WorkflowInteropPackage,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "comfyui.api-workflow.draft",
    sourcePackageId: interopPackage.id,
    nodes: interopPackage.graph.nodes.map(formatComfyUiDraftNode),
    edges: interopPackage.graph.edges.map(formatComfyUiDraftEdge),
    artifacts: interopPackage.artifacts.map(formatComfyUiDraftArtifact),
    executable: false,
    conversion: interopPackage.conversion,
  };
}

function formatComfyUiDraftNode(node: WorkflowInteropNode): Readonly<Record<string, unknown>> {
  return {
    id: node.id,
    class_type: `DirectorInterop.${node.kind}`,
    ...(node.label === undefined ? {} : { label: node.label }),
    inputs: {
      sourceKind: node.kind,
      ...(node.payload === undefined ? {} : { payload: node.payload }),
    },
  };
}

function formatComfyUiDraftEdge(edge: WorkflowInteropEdge): Readonly<Record<string, unknown>> {
  return {
    from: edge.from,
    to: edge.to,
    ...(edge.label === undefined ? {} : { label: edge.label }),
  };
}

function formatComfyUiDraftArtifact(
  artifact: WorkflowInteropArtifact,
): Readonly<Record<string, unknown>> {
  return {
    id: artifact.id,
    kind: artifact.kind,
    ...(artifact.localPath === undefined ? {} : { localPath: artifact.localPath }),
    ...(artifact.uri === undefined ? {} : { uri: artifact.uri }),
    ...(artifact.metadata === undefined ? {} : { metadata: artifact.metadata }),
  };
}

function createComfyUiInteropDraftArtifacts(
  interopPackage: WorkflowInteropPackage,
): readonly ExternalToolArtifact[] {
  return interopPackage.artifacts.map((artifact) => ({
    id: `comfyui-draft-${artifact.id}`,
    kind: artifact.kind,
    ...(artifact.localPath === undefined ? {} : { path: artifact.localPath }),
    ...(artifact.uri === undefined ? {} : { url: artifact.uri }),
    metadata: {
      provider: "comfyui",
      role: "interop-draft-source",
      sourcePackageId: interopPackage.id,
      sourceArtifactId: artifact.id,
      ...(artifact.metadata ?? {}),
    },
  }));
}

function createComfyUiSimpleInteropBuild(interopPackage: WorkflowInteropPackage): {
  readonly schemaVersion: "director.comfyui-simple-build.v1";
  readonly status: "executable" | "blocked";
  readonly executable: boolean;
  readonly interopPackageId: string;
  readonly workflowJson?: Readonly<Record<string, unknown>>;
  readonly conversion: ReturnType<typeof explainWorkflowInteropConversion>;
  readonly reasons: readonly string[];
  readonly nextActions: readonly string[];
} {
  const conversion = explainWorkflowInteropConversion(interopPackage);
  const reasons: string[] = [];
  if (!conversion.executable) {
    reasons.push(conversion.reason);
  }
  if (interopPackage.target !== undefined && interopPackage.target.provider !== "comfyui") {
    reasons.push(`target provider is ${interopPackage.target.provider}, not comfyui`);
  }
  const simpleInputs = extractComfyUiSimpleImageInputs(interopPackage.graph.nodes);
  if (simpleInputs.prompt === undefined) {
    reasons.push("simple image prompt is missing");
  }
  if (simpleInputs.checkpoint === undefined) {
    reasons.push("ComfyUI checkpoint is missing");
  }
  if (
    reasons.length > 0 ||
    simpleInputs.prompt === undefined ||
    simpleInputs.checkpoint === undefined
  ) {
    return {
      schemaVersion: "director.comfyui-simple-build.v1",
      status: "blocked",
      executable: false,
      interopPackageId: interopPackage.id,
      conversion,
      reasons,
      nextActions: [
        "Run interop.draft to inspect mapped nodes.",
        "Resolve conversion lossiness, missing dependencies, unmapped fields, prompt, and checkpoint.",
        "Run workflow.inspect/checkDeps before any workflow.run request.",
      ],
    };
  }
  const buildInputs = {
    ...simpleInputs,
    prompt: simpleInputs.prompt,
    checkpoint: simpleInputs.checkpoint,
  };
  return {
    schemaVersion: "director.comfyui-simple-build.v1",
    status: "executable",
    executable: true,
    interopPackageId: interopPackage.id,
    workflowJson: createComfyUiSimpleApiWorkflow(buildInputs),
    conversion,
    reasons: [],
    nextActions: [
      "Run ComfyUI workflow.inspect/checkDeps against workflowJson.",
      "Require operator approval before passing workflowJson to workflow.run.",
    ],
  };
}

function extractComfyUiSimpleImageInputs(nodes: readonly WorkflowInteropNode[]): {
  readonly prompt?: string;
  readonly negativePrompt?: string;
  readonly checkpoint?: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly cfg: number;
  readonly seed: number;
  readonly samplerName: string;
  readonly scheduler: string;
  readonly filenamePrefix: string;
} {
  let prompt: string | undefined;
  let negativePrompt: string | undefined;
  let checkpoint: string | undefined;
  let width = 1024;
  let height = 1024;
  let steps = 20;
  let cfg = 7;
  let seed = 1;
  let samplerName = "euler";
  let scheduler = "normal";
  let filenamePrefix = "director_angel";

  for (const node of nodes) {
    const payload = isRecord(node.payload) ? node.payload : {};
    const kind = normalizeComfyUiInteropKind(node.kind);
    const payloadPrompt = readFirstString(payload, ["prompt", "positivePrompt", "text"]);
    const payloadNegative = readFirstString(payload, [
      "negativePrompt",
      "negative",
      "negativeText",
    ]);
    const payloadCheckpoint = readFirstString(payload, [
      "checkpoint",
      "ckptName",
      "ckpt_name",
      "model",
      "modelName",
    ]);

    if (prompt === undefined && payloadPrompt !== undefined && !kind.includes("negative")) {
      prompt = payloadPrompt;
    }
    if (negativePrompt === undefined && payloadNegative !== undefined) {
      negativePrompt = payloadNegative;
    }
    if (negativePrompt === undefined && kind.includes("negative") && payloadPrompt !== undefined) {
      negativePrompt = payloadPrompt;
    }
    if (checkpoint === undefined && payloadCheckpoint !== undefined) {
      checkpoint = payloadCheckpoint;
    }
    if (kind.includes("checkpoint") || kind.includes("model")) {
      checkpoint = checkpoint ?? payloadPrompt;
    }
    width = readFirstNumber(payload, ["width", "imageWidth"]) ?? width;
    height = readFirstNumber(payload, ["height", "imageHeight"]) ?? height;
    steps = readFirstNumber(payload, ["steps", "samplingSteps"]) ?? steps;
    cfg = readFirstNumber(payload, ["cfg", "cfgScale"]) ?? cfg;
    seed = readFirstNumber(payload, ["seed"]) ?? seed;
    samplerName = readFirstString(payload, ["samplerName", "sampler_name"]) ?? samplerName;
    scheduler = readFirstString(payload, ["scheduler"]) ?? scheduler;
    filenamePrefix =
      readFirstString(payload, ["filenamePrefix", "filename_prefix"]) ?? filenamePrefix;
  }

  return {
    ...(prompt === undefined ? {} : { prompt }),
    ...(negativePrompt === undefined ? {} : { negativePrompt }),
    ...(checkpoint === undefined ? {} : { checkpoint }),
    width,
    height,
    steps,
    cfg,
    seed,
    samplerName,
    scheduler,
    filenamePrefix,
  };
}

function createComfyUiSimpleApiWorkflow(input: {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly checkpoint: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly cfg: number;
  readonly seed: number;
  readonly samplerName: string;
  readonly scheduler: string;
  readonly filenamePrefix: string;
}): Readonly<Record<string, unknown>> {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: input.checkpoint },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.prompt, clip: ["1", 1] },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.negativePrompt ?? "", clip: ["1", 1] },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width: input.width, height: input.height, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: input.steps,
        cfg: input.cfg,
        sampler_name: input.samplerName,
        scheduler: input.scheduler,
        denoise: 1,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: { images: ["6", 0], filename_prefix: input.filenamePrefix },
    },
  };
}

function normalizeComfyUiInteropKind(kind: string): string {
  return kind.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function readFirstString(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = readOptionalString(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readFirstNumber(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = readOptionalNumber(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeComfyUiOperation(
  operationId: string | undefined,
): ComfyUiProviderOperation | null {
  const normalized = (operationId ?? "health").trim();
  return isComfyUiProviderOperation(normalized) ? normalized : null;
}

function isComfyUiProviderOperation(value: string): value is ComfyUiProviderOperation {
  return (
    value === "health" ||
    value === "interop.buildSimple" ||
    value === "interop.draft" ||
    value === "workflow.inspect" ||
    value === "workflow.run" ||
    value === "workflow.watch" ||
    value === "artifact.fetch" ||
    value === "lifecycle.install" ||
    value === "dependency.fix"
  );
}

function mapComfyUiStatusToInvokeStatus(
  status: ExternalToolDoctorResult["status"],
): ExternalToolInvokeStatus {
  return status === "unreachable" || status === "missing" ? "unavailable" : "error";
}

function mapComfyUiStatusToEnvelopeStatus(
  status: ExternalToolDoctorResult["status"],
): ComfyUiProviderEnvelope["status"] {
  return status === "unreachable" || status === "missing" ? "unavailable" : "error";
}

function createComfyUiRootCauseHint(code: string): string {
  if (code === "COMFYUI_OPERATION_UNAVAILABLE") {
    return "The ComfyUI host adapter did not expose the requested operation.";
  }
  if (code === "COMFYUI_ARGS_INVALID") {
    return "The ComfyUI provider request is missing a required structured argument.";
  }
  return "The ComfyUI provider operation failed before producing a successful result.";
}

function readRequiredString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${key}.`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

function readNestedValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? uniqueStrings(value.filter((item): item is string => typeof item === "string"))
    : [];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function readInstalledModels(
  value: unknown,
): Readonly<Record<string, readonly string[]>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const output: Record<string, readonly string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!Array.isArray(item)) {
      continue;
    }
    output[key] = item.filter((model): model is string => typeof model === "string");
  }
  return output;
}

function sanitizeComfyUiProviderValue<T>(value: T): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeComfyUiProviderValue(item)) as T;
  }
  if (!isRecord(value)) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveComfyUiKey(key)) {
      continue;
    }
    output[key] = sanitizeComfyUiProviderValue(item);
  }
  return output as T;
}

function isSensitiveComfyUiKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (
    normalized.endsWith("masked") ||
    normalized.endsWith("envvar") ||
    normalized.endsWith("ref")
  ) {
    return false;
  }
  return (
    normalized.includes("apikey") ||
    normalized.includes("api_key") ||
    normalized.includes("authorization") ||
    normalized.includes("bearer") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("token")
  );
}

function optionalRecordField<K extends string, T extends Readonly<Record<string, unknown>>>(
  key: K,
  value: T | undefined,
): { readonly [P in K]?: T } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: T });
}

function createMissingComfyUiProviderAdapter(): ComfyUiProviderAdapter {
  return {
    health: () => ({
      ok: false,
      status: "misconfigured",
      summary: "ComfyUI provider adapter is not configured.",
      details: {
        configured: false,
      },
      nextActions: ["Bind a ComfyUI host adapter before invoking workflow operations."],
    }),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type {
  ComfyUiProviderAdapter,
  ComfyUiProviderArtifact,
  ComfyUiProviderHealthResult,
  ComfyUiProviderLifecycleResult,
  ExternalToolHandlerInvokeRequest,
  ExternalToolRegistration,
} from "@hotflow/conversation-runtime";
import { createComfyUiProviderRegistration } from "@hotflow/conversation-runtime";

import {
  fetchDirectorComfyUiArtifact,
  inspectDirectorComfyUiHealth,
  inspectDirectorComfyUiWorkflow,
  loadDirectorComfyUiConfig,
  planDirectorComfyUiDependencyFix,
  planDirectorComfyUiInstall,
  runDirectorComfyUiDependencyFix,
  runDirectorComfyUiInstall,
  runDirectorComfyUiWorkflow,
} from "./comfyui-adapter.js";
import type {
  DirectorComfyUiCommandRunner,
  DirectorComfyUiDependencyFixInput,
  DirectorComfyUiHealthInspectInput,
  DirectorComfyUiInstallInput,
  DirectorComfyUiSandboxCommandRunner,
  DirectorComfyUiWebSocketFactory,
  DirectorComfyUiWorkflowRunInput,
} from "./comfyui-adapter.js";

type DirectorRuntimeComfyUiFetch = NonNullable<DirectorComfyUiWorkflowRunInput["fetchImpl"]>;

export interface DirectorRuntimeComfyUiProviderBridgeOptions {
  readonly now?: () => string;
  readonly fetchImpl?: DirectorRuntimeComfyUiFetch;
  readonly webSocketFactory?: DirectorComfyUiWebSocketFactory;
  readonly commandExists?: (command: string) => boolean | Promise<boolean>;
  readonly commandRunner?: DirectorComfyUiCommandRunner;
  readonly sandboxCommandRunner?: DirectorComfyUiSandboxCommandRunner;
  readonly unsafeAllowRawCommandRunner?: boolean;
}

export function createDirectorRuntimeComfyUiProviderRegistration(
  rootPath: string,
  options: DirectorRuntimeComfyUiProviderBridgeOptions = {},
): ExternalToolRegistration {
  const registration = createComfyUiProviderRegistration({
    adapter: createDirectorRuntimeComfyUiProviderAdapter(rootPath, options),
  });
  if (registration.invoke === undefined) {
    return registration;
  }
  const invoke = registration.invoke;
  return {
    ...registration,
    invoke: (request) => invoke(enrichComfyUiWorkflowRunRequest(rootPath, request)),
  };
}

export function createDirectorRuntimeComfyUiProviderAdapter(
  rootPath: string,
  options: DirectorRuntimeComfyUiProviderBridgeOptions = {},
): ComfyUiProviderAdapter {
  return {
    health: async () => mapDirectorComfyUiHealthResult(await inspectHealth(rootPath, options)),
    inspectWorkflow: async (input) => {
      const report = inspectDirectorComfyUiWorkflow(input.workflowJson, {
        ...(input.objectInfo === undefined ? {} : { objectInfo: input.objectInfo }),
        ...(input.installedModels === undefined ? {} : { installedModels: input.installedModels }),
      });
      return {
        ok: report.ok,
        summary: report.ok
          ? "ComfyUI workflow inspected."
          : "ComfyUI workflow inspected with missing dependencies.",
        report,
        metadata: {
          promptNodeCount: report.summary.promptNodeCount,
          outputNodeCount: report.summary.outputNodeCount,
          missingNodeCount: report.summary.missingNodeCount,
          missingModelCount: report.summary.missingModelCount,
        },
      };
    },
    runWorkflow: async (input) => {
      const result = await runDirectorComfyUiWorkflow(rootPath, {
        prompt: input.prompt,
        ...optionalStringField("workflowPath", input.workflowPath),
        ...(input.workflowJson === undefined ? {} : { workflowJson: input.workflowJson }),
        ...optionalStringField("outputDir", input.outputDir),
        ...optionalStringField("clientId", input.clientId),
        ...optionalNumberField("timeoutMs", input.timeoutMs),
        ...optionalNumberField("pollIntervalMs", input.pollIntervalMs),
        ...optionalStringField("now", options.now?.()),
        ...optionalBridgeField("fetchImpl", options.fetchImpl),
        ...optionalBridgeField("webSocketFactory", options.webSocketFactory),
      } satisfies DirectorComfyUiWorkflowRunInput);
      return {
        ok: result.ok,
        summary: result.message,
        ...(result.promptId === undefined ? {} : { promptId: result.promptId }),
        ...(result.progressEvents === undefined ? {} : { progressEvents: result.progressEvents }),
        output: {
          endpoint: result.endpoint,
          readiness: result.readiness,
          promptApplied: result.promptApplied,
          diagnostics: result.diagnostics,
          workflowDiagnostics: result.workflowDiagnostics,
          artifactCount: result.artifactCount,
          ...(result.progressMode === undefined ? {} : { progressMode: result.progressMode }),
        },
        artifacts: result.artifacts.map((artifact) =>
          mapDirectorComfyUiArtifact(artifact, result.promptId),
        ),
        ...optionalErrorField(result.ok, result.message),
        metadata: {
          endpoint: result.endpoint,
          readiness: result.readiness,
          artifactCount: result.artifactCount,
        },
      };
    },
    watchWorkflow: async (input) => {
      const health = await inspectHealth(rootPath, options, { promptId: input.promptId });
      const history = health.history;
      return {
        ok: history?.ok === true,
        summary:
          history?.ok === true
            ? "ComfyUI workflow watch completed."
            : (history?.error ?? "ComfyUI workflow watch did not find completed history."),
        promptId: input.promptId,
        status: history?.completed === true ? "completed" : (history?.statusStr ?? "unknown"),
        events: history?.executionLog ?? [],
        partial: history?.completed !== true,
        metadata: {
          lifecycle: "orchestrator-watch",
          queue: health.queue,
        },
      };
    },
    fetchArtifact: async (input) => {
      const result = await fetchDirectorComfyUiArtifact(rootPath, {
        ...optionalStringField("promptId", input.promptId),
        filename: requireComfyUiArtifactFilename(input.filename),
        ...optionalStringField("subfolder", input.subfolder),
        ...optionalStringField("type", input.type),
        ...optionalNumberField("timeoutMs", readNumberArg(input.args.timeoutMs)),
        ...optionalStringField("now", options.now?.()),
        ...optionalBridgeField("fetchImpl", options.fetchImpl),
      });
      return {
        ok: result.ok,
        summary: result.message,
        artifacts: result.artifacts.map((artifact) =>
          mapDirectorComfyUiArtifact(artifact, input.promptId),
        ),
        output: {
          endpoint: result.endpoint,
          artifactCount: result.artifacts.length,
          ...(result.status === undefined ? {} : { status: result.status }),
          ...(result.statusText === undefined ? {} : { statusText: result.statusText }),
          ...(result.error === undefined ? {} : { error: result.error }),
        },
        ...(result.error === undefined
          ? optionalErrorField(result.ok, result.message)
          : { error: result.error }),
        metadata: {
          endpoint: result.endpoint,
          artifactCount: result.artifacts.length,
        },
      };
    },
    install: async (input) =>
      mapDirectorComfyUiLifecycleResult(
        input.dryRun === true
          ? await planDirectorComfyUiInstall(rootPath, createInstallInput(options, true))
          : await runDirectorComfyUiInstall(rootPath, createInstallInput(options, false)),
      ),
    fixDependencies: async (input) =>
      mapDirectorComfyUiLifecycleResult(
        input.dryRun === true
          ? await planDirectorComfyUiDependencyFix(
              rootPath,
              createDependencyFixInput(options, input, true),
            )
          : await runDirectorComfyUiDependencyFix(
              rootPath,
              createDependencyFixInput(options, input, false),
            ),
      ),
  };
}

async function inspectHealth(
  rootPath: string,
  options: DirectorRuntimeComfyUiProviderBridgeOptions,
  extra: Pick<DirectorComfyUiHealthInspectInput, "promptId"> = {},
) {
  return inspectDirectorComfyUiHealth(rootPath, {
    ...extra,
    ...optionalStringField("now", options.now?.()),
    ...optionalBridgeField("fetchImpl", options.fetchImpl),
    ...optionalBridgeField("commandExists", options.commandExists),
  });
}

function createInstallInput(
  options: DirectorRuntimeComfyUiProviderBridgeOptions,
  dryRun: boolean,
): DirectorComfyUiInstallInput {
  return {
    dryRun,
    ...optionalStringField("now", options.now?.()),
    ...optionalBridgeField("commandExists", options.commandExists),
    ...optionalBridgeField("commandRunner", options.commandRunner),
    ...optionalBridgeField("sandboxCommandRunner", options.sandboxCommandRunner),
    ...optionalBooleanField("unsafeAllowRawCommandRunner", options.unsafeAllowRawCommandRunner),
  };
}

function createDependencyFixInput(
  options: DirectorRuntimeComfyUiProviderBridgeOptions,
  input: {
    readonly workflowJson?: unknown;
    readonly workflowPath?: string;
  },
  dryRun: boolean,
): DirectorComfyUiDependencyFixInput {
  return {
    ...(input.workflowJson === undefined ? {} : { workflowJson: input.workflowJson }),
    ...optionalStringField("workflowPath", input.workflowPath),
    ...optionalStringField("now", options.now?.()),
    ...optionalBridgeField("fetchImpl", options.fetchImpl),
    ...optionalBridgeField("commandExists", options.commandExists),
    ...optionalBridgeField("commandRunner", options.commandRunner),
    ...optionalBridgeField("sandboxCommandRunner", options.sandboxCommandRunner),
    ...optionalBooleanField("unsafeAllowRawCommandRunner", options.unsafeAllowRawCommandRunner),
  };
}

function enrichComfyUiWorkflowRunRequest(
  rootPath: string,
  request: ExternalToolHandlerInvokeRequest,
): ExternalToolHandlerInvokeRequest {
  if (request.operationId !== "workflow.run") {
    return request;
  }
  const args = request.args ?? {};
  const hasWorkflow =
    args.workflowJson !== undefined || readNonEmptyStringArg(args.workflowPath) !== undefined;
  const hasOutput =
    readNonEmptyStringArg(args.outputDir) !== undefined || isNonEmptyRecord(args.outputConfig);
  if (hasWorkflow && hasOutput) {
    return request;
  }

  const adapter = loadDirectorComfyUiConfig(rootPath).document.adapter;
  const defaultWorkflowPath = adapter.defaultWorkflowPath.trim();
  const defaultOutputDir = adapter.outputDir.trim();
  const enrichedArgs = {
    ...args,
    ...(hasWorkflow || defaultWorkflowPath.length === 0
      ? {}
      : { workflowPath: defaultWorkflowPath }),
    ...(hasOutput || defaultOutputDir.length === 0 ? {} : { outputDir: defaultOutputDir }),
  };
  return { ...request, args: enrichedArgs };
}

function mapDirectorComfyUiHealthResult(
  input: Awaited<ReturnType<typeof inspectHealth>>,
): ComfyUiProviderHealthResult {
  return {
    ok: input.ok,
    status: input.status,
    summary: input.ok
      ? "ComfyUI server is ready."
      : (input.nextActions[0] ?? "ComfyUI is not ready."),
    nextActions: input.nextActions,
    details: {
      mode: input.adapter.mode,
      baseUrl: input.adapter.baseUrl,
      apiKeyConfigured: input.adapter.apiKeyConfigured,
      apiKeyMasked: input.adapter.apiKeyMasked,
      lifecycle: input.lifecycle,
      queue: input.queue,
      workflow: input.workflow,
      notes: input.notes,
    },
  };
}

function mapDirectorComfyUiLifecycleResult(input: {
  readonly ok: boolean;
  readonly message: string;
  readonly error?: string;
  readonly plan?: readonly unknown[];
  readonly results?: readonly unknown[];
  readonly status?: string;
  readonly dryRun?: boolean;
}): ComfyUiProviderLifecycleResult {
  return {
    ok: input.ok,
    summary: input.message,
    output: {
      status: input.status,
      dryRun: input.dryRun,
      plan: input.plan ?? [],
      results: input.results ?? [],
    },
    ...(input.error === undefined
      ? optionalErrorField(input.ok, input.message)
      : { error: input.error }),
  };
}

function mapDirectorComfyUiArtifact(
  artifact: {
    readonly kind: "image" | "video";
    readonly filename: string;
    readonly subfolder: string;
    readonly type: string;
    readonly url: string;
    readonly localPath?: string;
  },
  promptId: string | undefined,
): ComfyUiProviderArtifact {
  return {
    id: ["comfyui", promptId, artifact.filename].filter(Boolean).join("-"),
    kind: artifact.kind,
    filename: artifact.filename,
    subfolder: artifact.subfolder,
    type: artifact.type,
    url: artifact.url,
    ...optionalStringField("localPath", artifact.localPath),
    metadata: {
      ...optionalStringField("promptId", promptId),
      filename: artifact.filename,
      subfolder: artifact.subfolder,
      type: artifact.type,
    },
  };
}

function optionalErrorField(ok: boolean, message: string): { readonly error?: string } {
  return ok ? {} : { error: message };
}

function requireComfyUiArtifactFilename(value: string | undefined): string {
  const filename = value?.trim();
  if (!filename) {
    throw new Error("ComfyUI artifact.fetch requires filename.");
  }
  return filename;
}

function readNumberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonEmptyStringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isNonEmptyRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function optionalStringField<K extends string>(
  key: K,
  value: string | undefined,
): { readonly [P in K]?: string } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: string });
}

function optionalNumberField<K extends string>(
  key: K,
  value: number | undefined,
): { readonly [P in K]?: number } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: number });
}

function optionalBooleanField<K extends string>(
  key: K,
  value: boolean | undefined,
): { readonly [P in K]?: boolean } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: boolean });
}

function optionalBridgeField<K extends string, T>(
  key: K,
  value: T | undefined,
): { readonly [P in K]?: T } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: T });
}

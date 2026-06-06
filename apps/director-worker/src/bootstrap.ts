import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  ExecutionRunService,
  type ExecutionSafetyPolicy,
  FileSystemRunStore,
  type HttpJsonExecutionBridgeTarget,
  type MockAssignmentExecutor,
  buildExecutionRunDelegations,
  executeAssignmentViaHttpJsonBridge,
} from "@hotflow/director-execution";
import type {
  AssignmentResult,
  AssignmentRun,
  ExecutionBridgeFailure,
  ExecutionRun,
  ExecutionRunReport,
} from "@hotflow/director-execution-contracts";
import {
  type DirectorAdapterManifestDocument,
  type DirectorSwitchState,
  FileSystemDirectorAdapterRegistryStore,
  loadDirectorApiProviderConfig,
  loadDirectorSwitchState,
} from "@hotflow/director-runtime";
import { type DirectorWorkspacePaths, ensureDirectorWorkspace } from "@hotflow/director-workspace";
import { SessionStore } from "@hotflow/sessions";
import { SessionStoreTaskPlanePort } from "@hotflow/tasks-core";

import { ingestDirectorRunMemory } from "./memory-ingest.js";
import { type MockExecutorOptions, createDeterministicMockExecutor } from "./mock-executor.js";
import { ingestDirectorTraceProposal } from "./proposal-ingest.js";

const SIDE_EFFECT_ACTION_CLASSES = new Set<AssignmentRun["actionClass"]>([
  "generate",
  "write",
  "publish",
]);
const OPERATOR_APPROVAL_NOTE_PREFIX = "Approved by operator at ";

export interface DirectorWorkerConfig {
  readonly workspaceRoot: string;
  readonly dataDir: string;
}

export interface BootstrapDirectorWorkerOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly mockExecutor?: MockAssignmentExecutor;
  readonly mockExecutorOptions?: MockExecutorOptions;
}

export interface RunDirectorWorkerOnceInput {
  readonly runId: string;
  readonly workerId: string;
}

export interface DirectorWorkerRunOnceResult {
  readonly run: ExecutionRun;
  readonly report: ExecutionRunReport;
  readonly executedAssignments: readonly string[];
}

export interface DirectorWorkerRuntime {
  readonly config: DirectorWorkerConfig;
  readonly workspacePaths: DirectorWorkspacePaths;
  readonly executionService: ExecutionRunService;
  readonly mockExecutor: MockAssignmentExecutor;
  runOnce(input: RunDirectorWorkerOnceInput): Promise<DirectorWorkerRunOnceResult>;
  close(): void;
}

export function bootstrapDirectorWorker(
  options: BootstrapDirectorWorkerOptions = {},
): DirectorWorkerRuntime {
  const config = resolveDirectorWorkerConfig(options);
  const workspacePaths = ensureDirectorWorkspace({ root: config.workspaceRoot });
  const executionService = new ExecutionRunService({
    store: new FileSystemRunStore({
      rootPath: join(workspacePaths.runtime, "execution"),
    }),
  });
  const switchPath = join(workspacePaths.runtime, "switches.json");
  const mockExecutor =
    options.mockExecutor ?? createDeterministicMockExecutor(options.mockExecutorOptions);

  return {
    config,
    workspacePaths,
    executionService,
    mockExecutor,
    async runOnce(input: RunDirectorWorkerOnceInput): Promise<DirectorWorkerRunOnceResult> {
      let currentRun = await executionService.getRun(input.runId);
      if (!currentRun) {
        throw new Error(`Unknown execution run: ${input.runId}`);
      }
      const executedAssignments: string[] = [];

      while (true) {
        currentRun = await reconcileRunWithSafetyPolicy({
          executionService,
          runId: input.runId,
          switchPath,
        });
        if (currentRun.status !== "running") {
          break;
        }

        const claimed = await executionService.claimNextReadyAssignment(
          input.runId,
          input.workerId,
        );
        if (!claimed) {
          currentRun = (await executionService.getRun(input.runId)) ?? currentRun;
          break;
        }
        executedAssignments.push(claimed.assignment.assignmentId);
        await syncWorkerAssignmentDelegationStatus({
          workspacePaths,
          run: claimed.run,
          assignment: claimed.assignment,
          status: "running",
        });
        const switchState = loadDirectorSwitchState(switchPath);
        const result = await executeClaimedAssignment({
          assignment: claimed.assignment,
          workerId: input.workerId,
          workspacePaths,
          runSideEffectsAllowed: claimed.run.sideEffectsAllowed,
          sideEffectsEnabled: switchState.features["execution.sideEffects.enabled"],
          env: options.env ?? process.env,
          mockExecutor,
        });
        currentRun = await executionService.completeAssignment(
          input.runId,
          claimed.assignment.assignmentId,
          result,
        );
        await syncWorkerAssignmentDelegationStatus({
          workspacePaths,
          run: currentRun,
          assignment:
            currentRun.assignments.find(
              (assignment) => assignment.assignmentId === claimed.assignment.assignmentId,
            ) ?? claimed.assignment,
          status: result.status === "completed" ? "completed" : "failed",
          resultSummary: result.summary,
          ...(result.status === "failed" ? { error: result.summary } : {}),
        });
      }

      const finalRun = (await executionService.getRun(input.runId)) ?? currentRun;
      const report = await executionService.collectRunReport(input.runId);
      const ingestResult = await ingestDirectorRunMemory({
        workspacePaths,
        report,
      });
      if (ingestResult?.recordId) {
        await ingestDirectorTraceProposal({
          workspacePaths,
          recordId: ingestResult.recordId,
        });
      }

      return {
        run: finalRun,
        report,
        executedAssignments,
      };
    },
    close() {
      // No long-lived resources yet; keep a symmetric API for future worker runtime wiring.
    },
  };
}

export type { AssignmentRun, ExecutionRun, ExecutionRunReport };

async function executeClaimedAssignment(input: {
  readonly assignment: AssignmentRun;
  readonly workerId: string;
  readonly workspacePaths: DirectorWorkspacePaths;
  readonly runSideEffectsAllowed: boolean;
  readonly sideEffectsEnabled: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly mockExecutor: MockAssignmentExecutor;
}): Promise<AssignmentResult> {
  if (!input.runSideEffectsAllowed || !input.sideEffectsEnabled) {
    return input.mockExecutor.execute(input.assignment, {
      workerId: input.workerId,
    });
  }

  const bridgeResolution = await resolveBridgeTarget(
    input.assignment,
    input.workspacePaths,
    input.env,
  );
  if (bridgeResolution.status === "not-found") {
    return input.mockExecutor.execute(input.assignment, {
      workerId: input.workerId,
    });
  }
  if (bridgeResolution.status === "policy-blocked") {
    return buildBridgePolicyBlockedResult({
      assignment: input.assignment,
      target: bridgeResolution.target,
      workerId: input.workerId,
      message: bridgeResolution.message,
    });
  }

  return executeAssignmentViaHttpJsonBridge(input.assignment, bridgeResolution.target, {
    workerId: input.workerId,
    env: input.env,
  });
}

async function reconcileRunWithSafetyPolicy(input: {
  readonly executionService: ExecutionRunService;
  readonly runId: string;
  readonly switchPath: string;
}): Promise<ExecutionRun> {
  let currentRun = await input.executionService.getRun(input.runId);
  if (!currentRun) {
    throw new Error(`Unknown execution run: ${input.runId}`);
  }

  const policy = loadExecutionSafetyPolicy(input.switchPath);
  if (currentRun.status === "created") {
    if (policy.executionEnabled === false || policy.pauseAll === true) {
      return currentRun;
    }
    currentRun = await input.executionService.startRun(input.runId);
  }

  return input.executionService.applySafetyPolicy(input.runId, policy);
}

function resolveDirectorWorkerConfig(
  options: Pick<BootstrapDirectorWorkerOptions, "cwd" | "env">,
): DirectorWorkerConfig {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const workspaceRoot = resolve(env.HOTFLOW_WORKSPACE_ROOT ?? detectWorkspaceRoot(cwd));
  const dataDir = resolve(env.HOTFLOW_DATA_DIR ?? join(workspaceRoot, ".hotflow"));
  return {
    workspaceRoot,
    dataDir,
  };
}

function detectWorkspaceRoot(startCwd: string): string {
  let current = resolve(startCwd);

  while (true) {
    if (hasWorkspaceMarkers(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return startCwd;
    }
    current = parent;
  }
}

function hasWorkspaceMarkers(directory: string): boolean {
  return (
    existsSync(join(directory, "pnpm-workspace.yaml")) ||
    (existsSync(join(directory, "package.json")) && existsSync(join(directory, "turbo.json")))
  );
}

function loadExecutionSafetyPolicy(switchPath: string): ExecutionSafetyPolicy {
  return toExecutionSafetyPolicy(loadDirectorSwitchState(switchPath));
}

function toExecutionSafetyPolicy(state: DirectorSwitchState): ExecutionSafetyPolicy {
  return {
    executionEnabled: state.features["execution.enabled"],
    pauseAll: state.features["execution.pause_all"],
    disabledRoles: Object.entries(state.roleOverrides)
      .filter(([, enabled]) => enabled === false)
      .map(([role]) => role as AssignmentRun["role"]),
    disabledAdapters: Object.entries(state.adapterOverrides)
      .filter(([, enabled]) => enabled === false)
      .map(([adapterId]) => adapterId),
  };
}

async function syncWorkerAssignmentDelegationStatus(input: {
  readonly workspacePaths: DirectorWorkspacePaths;
  readonly run: ExecutionRun;
  readonly assignment: AssignmentRun;
  readonly status: "running" | "completed" | "failed";
  readonly resultSummary?: string;
  readonly error?: string;
}): Promise<void> {
  const delegation = buildExecutionRunDelegations(
    {
      ...input.run,
      assignments: [input.assignment],
    },
    {
      sourceAgent: "director-worker",
      includePending: true,
    },
  )[0];
  if (delegation === undefined) {
    return;
  }

  const dbPath = resolveWorkerSessionDbPath(input.workspacePaths);
  const store = new SessionStore({ dbPath });
  try {
    if (store.getSession(input.run.runId) === null) {
      store.createSession({
        sessionId: input.run.runId,
        metadata: {
          owner: "director-worker",
          purpose: "execution run delegation mailbox",
          runId: input.run.runId,
        },
      });
    }
    const taskPlane = new SessionStoreTaskPlanePort(store, input.run.runId, {
      createIfMissing: true,
    });
    const existing = (await taskPlane.status()).delegation.some(
      (record) => record.id === delegation.id,
    );
    if (!existing) {
      await taskPlane.enqueueDelegation(delegation);
    }
    await taskPlane.setDelegationStatus({
      id: delegation.id,
      status: input.status,
      ...(input.resultSummary === undefined ? {} : { resultSummary: input.resultSummary }),
      ...(input.error === undefined ? {} : { error: input.error }),
    });
  } finally {
    store.close();
  }
}

function resolveWorkerSessionDbPath(workspacePaths: DirectorWorkspacePaths): string {
  const override = process.env.HOTFLOW_WORKER_SESSION_DB_PATH?.trim();
  return override || join(workspacePaths.root, "sessions", "worker-jobs.sqlite");
}

async function resolveBridgeTarget(
  assignment: AssignmentRun,
  workspacePaths: DirectorWorkspacePaths,
  env: NodeJS.ProcessEnv,
): Promise<BridgeTargetResolution> {
  const persistedTarget = await resolvePersistedBridgeTarget(assignment, workspacePaths);
  if (persistedTarget.status !== "not-found") {
    return persistedTarget;
  }

  return resolveConfiguredApiProviderBridgeTarget(assignment, workspacePaths, env);
}

type BridgeTargetResolution =
  | {
      readonly status: "ok";
      readonly target: HttpJsonExecutionBridgeTarget;
    }
  | {
      readonly status: "policy-blocked";
      readonly target: HttpJsonExecutionBridgeTarget;
      readonly message: string;
    }
  | {
      readonly status: "not-found";
    };

async function resolvePersistedBridgeTarget(
  assignment: AssignmentRun,
  workspacePaths: DirectorWorkspacePaths,
): Promise<BridgeTargetResolution> {
  if (!assignment.selectedAdapter) {
    return { status: "not-found" };
  }

  const store = new FileSystemDirectorAdapterRegistryStore({
    rootPath: workspacePaths.adaptersRegistry,
  });
  const manifest = await store.getManifest(assignment.selectedAdapter);
  if (
    manifest === null ||
    manifest.enabled === false ||
    manifest.mockOnly ||
    manifest.bridge === undefined ||
    manifest.bridge.kind !== "http-json"
  ) {
    return { status: "not-found" };
  }

  const target: HttpJsonExecutionBridgeTarget = {
    kind: "http-json",
    adapterId: manifest.adapterId,
    provider: manifest.provider,
    baseUrl: manifest.bridge.baseUrl,
    submitPath: manifest.bridge.submitPath,
    timeoutMs: manifest.bridge.timeoutMs ?? 30_000,
    ...(manifest.bridge.authEnvVar === undefined ? {} : { authEnvVar: manifest.bridge.authEnvVar }),
    ...(manifest.bridge.headers === undefined ? {} : { headers: manifest.bridge.headers }),
  };
  const policyBlockReason = resolvePersistedBridgePolicyBlockReason(assignment, manifest);
  if (policyBlockReason !== null) {
    return {
      status: "policy-blocked",
      target,
      message: policyBlockReason,
    };
  }

  return {
    status: "ok",
    target,
  };
}

function resolveConfiguredApiProviderBridgeTarget(
  assignment: AssignmentRun,
  workspacePaths: DirectorWorkspacePaths,
  env: NodeJS.ProcessEnv,
): BridgeTargetResolution {
  if (!assignment.selectedAdapter) {
    return { status: "not-found" };
  }

  const config = loadDirectorApiProviderConfig(join(workspacePaths.root, "providers"));
  const provider = config.document.providers.find(
    (candidate) => candidate.id === assignment.selectedAdapter,
  );
  if (
    provider === undefined ||
    provider.enabled === false ||
    provider.apiKeyConfigured === false ||
    (!provider.capabilities.includes("image_generation") &&
      !provider.capabilities.includes("video_generation"))
  ) {
    return { status: "not-found" };
  }

  return {
    status: "ok",
    target: {
      kind: "http-json",
      adapterId: provider.id,
      provider: provider.id,
      baseUrl: resolveApiProviderBridgeBaseUrl(env),
      submitPath: "/v1/bridges/api-provider/media-submit",
      timeoutMs: 120_000,
    },
  };
}

function resolvePersistedBridgePolicyBlockReason(
  assignment: AssignmentRun,
  manifest: DirectorAdapterManifestDocument,
): string | null {
  if (!SIDE_EFFECT_ACTION_CLASSES.has(assignment.actionClass)) {
    return null;
  }
  if (!manifest.supportedActionClasses.includes(assignment.actionClass)) {
    return `Bridge adapter ${manifest.adapterId} does not support action class ${assignment.actionClass}.`;
  }
  if (manifest.approvalMode !== "operator_approve") {
    return `Bridge adapter ${manifest.adapterId} is not configured for operator approval.`;
  }
  if (!hasOperatorApprovalEvidence(assignment)) {
    return `Bridge adapter ${manifest.adapterId} requires operator approval evidence before real ${assignment.actionClass} execution.`;
  }
  return null;
}

function hasOperatorApprovalEvidence(assignment: AssignmentRun): boolean {
  return (assignment.notes ?? []).some((note) => note.startsWith(OPERATOR_APPROVAL_NOTE_PREFIX));
}

function buildBridgePolicyBlockedResult(input: {
  readonly assignment: AssignmentRun;
  readonly target: HttpJsonExecutionBridgeTarget;
  readonly workerId: string;
  readonly message: string;
}): AssignmentResult {
  const failure: ExecutionBridgeFailure = {
    reason: "policy_blocked",
    message: input.message,
    retryable: false,
  };
  const url = new URL(input.target.submitPath, input.target.baseUrl);

  return {
    runId: input.assignment.runId,
    assignmentId: input.assignment.assignmentId,
    status: "failed",
    recordedAt: new Date().toISOString(),
    workerId: input.workerId,
    summary: `Bridge policy blocked ${input.assignment.role} assignment "${input.assignment.assignmentId}" via ${input.target.adapterId}.`,
    adapterId: input.target.adapterId,
    bridgeExecution: {
      kind: "http-json",
      request: {
        endpointOrigin: url.origin,
        endpointPath: url.pathname,
        method: "POST",
        timeoutMs: input.target.timeoutMs,
        authMode: resolveBridgeAuthMode(input.target),
        ...(resolveBridgeHeaderKeys(input.target.headers).length === 0
          ? {}
          : { headerKeys: resolveBridgeHeaderKeys(input.target.headers) }),
      },
      failure,
    },
    notes: ["external-bridge", "bridge:http-json", "bridge-failure:policy_blocked"],
  };
}

function resolveBridgeAuthMode(
  target: HttpJsonExecutionBridgeTarget,
): NonNullable<AssignmentResult["bridgeExecution"]>["request"]["authMode"] {
  if (target.authEnvVar !== undefined) {
    return "env";
  }
  if (target.headers && Object.keys(target.headers).length > 0) {
    return "static";
  }
  return "none";
}

function resolveBridgeHeaderKeys(headers: Readonly<Record<string, string>> | undefined): string[] {
  if (headers === undefined) {
    return [];
  }
  return Object.keys(headers).sort((left, right) => left.localeCompare(right));
}

function resolveApiProviderBridgeBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.DIRECTOR_API_PROVIDER_BRIDGE_BASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const host = env.DIRECTOR_HOST_API_HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(env.DIRECTOR_HOST_API_PORT ?? "", 10);
  return `http://${host}:${Number.isSafeInteger(port) && port > 0 ? port : 3201}`;
}

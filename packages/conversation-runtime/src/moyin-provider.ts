import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  ExternalToolArtifact,
  ExternalToolDoctorResult,
  ExternalToolHandlerInvokeOutput,
  ExternalToolHandlerInvokeRequest,
  ExternalToolRegistration,
} from "./external-tools.js";
import { createExternalToolProviderManifest } from "./external-tools.js";
import {
  type ConversationRuntimeUserFacingFailureKind,
  classifyConversationRuntimeFailure,
} from "./failure-taxonomy.js";
import type {
  WorkflowInteropArtifact,
  WorkflowInteropEdge,
  WorkflowInteropLossiness,
  WorkflowInteropNode,
} from "./workflow-interop.js";
import { createWorkflowInteropPackage } from "./workflow-interop.js";

const execFileAsync = promisify(execFile);
const DEFAULT_MOYIN_BINARY = "moyin";
const DEFAULT_MOYIN_TIMEOUT_MS = 30_000;
const MOYIN_PROVIDER_SCHEMA_VERSION = "director.moyin-provider.v1" as const;
const DIRECTOR_EXTERNAL_TOOL_SCHEMA_VERSION = "director.external-tool.v1" as const;
const REQUIRED_MOYIN_CLI_VERSION = "0.5.0";
const REQUIRED_MOYIN_CONTROL_PLANE_VERSION = "0.13.0";
const RECOMMENDED_MOYIN_CLI_VERSION = "0.5.2";
const RECOMMENDED_MOYIN_CONTROL_PLANE_VERSION = "0.13.0";
const MOYIN_SOURCE_OWNED_ARTIFACT_RETENTION = "user_controlled";
const MOYIN_SOURCE_OWNED_ARTIFACT_SENSITIVITY = "internal";
const MOYIN_SOURCE_OWNED_ARTIFACT_CLEANUP_POLICY =
  "artifactPolicy.moyin.source-owned.user-controlled";
const MOYIN_RESULT_BUDGET_ARTIFACT_RETENTION = "ephemeral";
const MOYIN_RESULT_BUDGET_ARTIFACT_SENSITIVITY = "internal";
const MOYIN_RESULT_BUDGET_ARTIFACT_CLEANUP_POLICY = "artifactPolicy.moyin.result-budget.ephemeral";

export interface MoyinProviderRunnerInput {
  readonly binary: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
}

export interface MoyinProviderRunnerOutput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorCode?: string;
  readonly signal?: NodeJS.Signals | null;
}

export type MoyinProviderRunner = (
  input: MoyinProviderRunnerInput,
) => Promise<MoyinProviderRunnerOutput> | MoyinProviderRunnerOutput;

export interface CreateMoyinProviderRegistrationOptions {
  readonly toolId?: string;
  readonly label?: string;
  readonly description?: string;
  readonly binary?: string;
  readonly timeoutMs?: number;
  readonly runner?: MoyinProviderRunner;
  readonly enabled?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type MoyinProviderOperation =
  | "health"
  | "capabilities.handshake"
  | "adapter.resolve"
  | "adapter.script-execution"
  | "adapter.image-execution"
  | "adapter.video-execution"
  | "discover.templates"
  | "discover.projects"
  | "project.list"
  | "project.get"
  | "project.store.get"
  | "project.create"
  | "discover.providers"
  | "discover.models"
  | "discover.workflows"
  | "sealed.image.preview"
  | "sealed.video.preview"
  | "sealed.get"
  | "sealed.submit"
  | "task.list"
  | "task.watch"
  | "task.cancel"
  | "task.submit"
  | "task.template.get"
  | "task.template.build"
  | "prompt.schema"
  | "prompt.list"
  | "prompt.create"
  | "prompt.resolve"
  | "prompt.get"
  | "prompt.delete"
  | "memory.get"
  | "memory.upsert"
  | "memory.diff"
  | "memory.approve"
  | "memory.reject"
  | "artifact.list"
  | "artifact.get"
  | "artifact.backfill"
  | "artifact.attach"
  | "artifact.delete"
  | "workflow-run.artifacts"
  | "workflow-run.list"
  | "workflow-run.create"
  | "workflow-run.get"
  | "workflow-run.steps"
  | "workflow-run.advance"
  | "workflow-run.attach-artifact"
  | "workflow-run.cancel"
  | "workflow.draft"
  | "workflow.schema"
  | "workflow.list"
  | "workflow.create"
  | "workflow.export"
  | "workflow.get"
  | "workflow.build"
  | "workflow.import"
  | "workflow.validate"
  | "workflow.delete";

interface MoyinOperationPolicy {
  readonly riskLevel: "low" | "medium" | "high";
  readonly approvalPolicy: "none" | "operator-confirm";
  readonly retryPolicy: Readonly<Record<string, unknown>>;
  readonly concurrencyKey: string;
  readonly outputPolicy: "structured-json" | "preview-or-artifact-ref";
  readonly artifactPolicy: "none" | "read-only-artifact-ref" | "external-artifact-store";
  readonly referencePatterns: readonly string[];
}

const MOYIN_READ_ONLY_REFERENCE_PATTERNS = [
  "hermes.tool-executor",
  "openclaw.provider-contract",
  "openclaw.tool-policy",
] as const;

const MOYIN_WATCH_REFERENCE_PATTERNS = [
  "hermes.tool-executor-heartbeat",
  "hermes.tool-guardrails",
  "openclaw.event-stream",
] as const;

const MOYIN_MUTATION_REFERENCE_PATTERNS = [
  "hermes.approval-queue",
  "openclaw.exec-approvals",
  "openclaw.tool-policy",
] as const;

const MOYIN_OPERATION_MANIFEST: Readonly<Record<MoyinProviderOperation, MoyinOperationPolicy>> = {
  health: createMoyinReadOnlyPolicy("moyin:health", "structured-json", "none"),
  "capabilities.handshake": createMoyinReadOnlyPolicy("moyin:handshake", "structured-json", "none"),
  "adapter.resolve": createMoyinReadOnlyPolicy("moyin:adapter", "preview-or-artifact-ref", "none"),
  "adapter.script-execution": createMoyinReadOnlyPolicy(
    "moyin:adapter",
    "preview-or-artifact-ref",
    "none",
  ),
  "adapter.image-execution": createMoyinReadOnlyPolicy(
    "moyin:adapter",
    "preview-or-artifact-ref",
    "none",
  ),
  "adapter.video-execution": createMoyinReadOnlyPolicy(
    "moyin:adapter",
    "preview-or-artifact-ref",
    "none",
  ),
  "discover.templates": createMoyinReadOnlyPolicy("moyin:discover", "structured-json", "none"),
  "discover.projects": createMoyinReadOnlyPolicy("moyin:discover", "structured-json", "none"),
  "project.list": createMoyinReadOnlyPolicy("moyin:project", "structured-json", "none"),
  "project.get": createMoyinReadOnlyPolicy("moyin:project", "structured-json", "none"),
  "project.store.get": createMoyinReadOnlyPolicy("moyin:project-store", "structured-json", "none"),
  "project.create": createMoyinMutationPolicy("moyin:project-mutation", "medium", "none"),
  "discover.providers": createMoyinReadOnlyPolicy("moyin:discover", "structured-json", "none"),
  "discover.models": createMoyinReadOnlyPolicy("moyin:discover", "structured-json", "none"),
  "discover.workflows": createMoyinReadOnlyPolicy("moyin:discover", "structured-json", "none"),
  "sealed.image.preview": createMoyinReadOnlyPolicy(
    "moyin:sealed-preview",
    "preview-or-artifact-ref",
    "none",
  ),
  "sealed.video.preview": createMoyinReadOnlyPolicy(
    "moyin:sealed-preview",
    "preview-or-artifact-ref",
    "none",
  ),
  "sealed.get": createMoyinReadOnlyPolicy(
    "moyin:sealed-read",
    "preview-or-artifact-ref",
    "read-only-artifact-ref",
  ),
  "sealed.submit": createMoyinMutationPolicy("moyin:submit", "high", "external-artifact-store"),
  "task.list": createMoyinReadOnlyPolicy("moyin:task-read", "structured-json", "none"),
  "task.watch": createMoyinWatchPolicy("moyin:watch", "external-artifact-store"),
  "task.cancel": createMoyinMutationPolicy("moyin:cancel", "medium", "none"),
  "task.submit": createMoyinMutationPolicy("moyin:submit", "high", "external-artifact-store"),
  "task.template.get": createMoyinReadOnlyPolicy(
    "moyin:template",
    "preview-or-artifact-ref",
    "none",
  ),
  "task.template.build": createMoyinReadOnlyPolicy(
    "moyin:template",
    "preview-or-artifact-ref",
    "none",
  ),
  "prompt.schema": createMoyinReadOnlyPolicy("moyin:prompt", "structured-json", "none"),
  "prompt.list": createMoyinReadOnlyPolicy("moyin:prompt", "preview-or-artifact-ref", "none"),
  "prompt.create": createMoyinMutationPolicy("moyin:prompt-mutation", "high", "none"),
  "prompt.resolve": createMoyinReadOnlyPolicy("moyin:prompt", "preview-or-artifact-ref", "none"),
  "prompt.get": createMoyinReadOnlyPolicy("moyin:prompt", "preview-or-artifact-ref", "none"),
  "prompt.delete": createMoyinMutationPolicy("moyin:prompt-mutation", "high", "none"),
  "memory.get": createMoyinReadOnlyPolicy("moyin:memory", "preview-or-artifact-ref", "none"),
  "memory.upsert": createMoyinMutationPolicy("moyin:memory-mutation", "high", "none"),
  "memory.diff": createMoyinReadOnlyPolicy("moyin:memory", "preview-or-artifact-ref", "none"),
  "memory.approve": createMoyinMutationPolicy("moyin:memory-review", "high", "none"),
  "memory.reject": createMoyinMutationPolicy("moyin:memory-review", "high", "none"),
  "artifact.list": createMoyinReadOnlyPolicy(
    "moyin:artifact-read",
    "preview-or-artifact-ref",
    "read-only-artifact-ref",
  ),
  "artifact.get": createMoyinReadOnlyPolicy(
    "moyin:artifact-read",
    "preview-or-artifact-ref",
    "read-only-artifact-ref",
  ),
  "artifact.backfill": createMoyinReadOnlyPolicy(
    "moyin:artifact-recovery",
    "preview-or-artifact-ref",
    "external-artifact-store",
  ),
  "artifact.attach": createMoyinMutationPolicy(
    "moyin:artifact-mutation",
    "high",
    "external-artifact-store",
  ),
  "artifact.delete": createMoyinMutationPolicy("moyin:artifact-mutation", "high", "none"),
  "workflow-run.artifacts": createMoyinReadOnlyPolicy(
    "moyin:workflow-run-read",
    "preview-or-artifact-ref",
    "read-only-artifact-ref",
  ),
  "workflow-run.list": createMoyinReadOnlyPolicy(
    "moyin:workflow-run-read",
    "structured-json",
    "none",
  ),
  "workflow-run.create": createMoyinReadOnlyPolicy(
    "moyin:workflow-run-draft",
    "preview-or-artifact-ref",
    "external-artifact-store",
  ),
  "workflow-run.get": createMoyinReadOnlyPolicy(
    "moyin:workflow-run-read",
    "preview-or-artifact-ref",
    "none",
  ),
  "workflow-run.steps": createMoyinReadOnlyPolicy(
    "moyin:workflow-run-read",
    "preview-or-artifact-ref",
    "read-only-artifact-ref",
  ),
  "workflow-run.advance": createMoyinMutationPolicy(
    "moyin:workflow-run-advance",
    "high",
    "external-artifact-store",
  ),
  "workflow-run.attach-artifact": createMoyinMutationPolicy(
    "moyin:workflow-run-artifact-mutation",
    "high",
    "external-artifact-store",
  ),
  "workflow-run.cancel": createMoyinMutationPolicy("moyin:cancel", "medium", "none"),
  "workflow.draft": createMoyinReadOnlyPolicy(
    "moyin:workflow-draft",
    "preview-or-artifact-ref",
    "external-artifact-store",
  ),
  "workflow.schema": createMoyinReadOnlyPolicy("moyin:workflow", "structured-json", "none"),
  "workflow.list": createMoyinReadOnlyPolicy("moyin:workflow", "structured-json", "none"),
  "workflow.create": createMoyinMutationPolicy("moyin:workflow-import", "high", "none"),
  "workflow.export": createMoyinReadOnlyPolicy(
    "moyin:workflow-export",
    "preview-or-artifact-ref",
    "external-artifact-store",
  ),
  "workflow.get": createMoyinReadOnlyPolicy("moyin:workflow", "preview-or-artifact-ref", "none"),
  "workflow.build": createMoyinReadOnlyPolicy(
    "moyin:workflow",
    "preview-or-artifact-ref",
    "external-artifact-store",
  ),
  "workflow.import": createMoyinMutationPolicy("moyin:workflow-import", "high", "none"),
  "workflow.validate": createMoyinReadOnlyPolicy("moyin:workflow", "structured-json", "none"),
  "workflow.delete": createMoyinMutationPolicy("moyin:workflow-import", "high", "none"),
};

function createMoyinReadOnlyPolicy(
  concurrencyKey: string,
  outputPolicy: MoyinOperationPolicy["outputPolicy"],
  artifactPolicy: MoyinOperationPolicy["artifactPolicy"],
): MoyinOperationPolicy {
  return {
    riskLevel: "low",
    approvalPolicy: "none",
    retryPolicy: {
      strategy: "policy.exponential_backoff",
      executor: "orchestrator",
      maxAttemptsRef: "providerPolicy.moyin.retry.maxAttempts",
      initialDelayMsRef: "providerPolicy.moyin.retry.initialDelayMs",
    },
    concurrencyKey,
    outputPolicy,
    artifactPolicy,
    referencePatterns: MOYIN_READ_ONLY_REFERENCE_PATTERNS,
  };
}

function createMoyinWatchPolicy(
  concurrencyKey: string,
  artifactPolicy: MoyinOperationPolicy["artifactPolicy"],
): MoyinOperationPolicy {
  return {
    ...createMoyinReadOnlyPolicy(concurrencyKey, "preview-or-artifact-ref", artifactPolicy),
    referencePatterns: MOYIN_WATCH_REFERENCE_PATTERNS,
  };
}

function createMoyinMutationPolicy(
  concurrencyKey: string,
  riskLevel: MoyinOperationPolicy["riskLevel"],
  artifactPolicy: MoyinOperationPolicy["artifactPolicy"],
): MoyinOperationPolicy {
  return {
    riskLevel,
    approvalPolicy: "operator-confirm",
    retryPolicy: {
      strategy: "manual",
      executor: "operator",
      instruction: "Rebuild the preview or request after operator approval expires or fails.",
    },
    concurrencyKey,
    outputPolicy: "preview-or-artifact-ref",
    artifactPolicy,
    referencePatterns: MOYIN_MUTATION_REFERENCE_PATTERNS,
  };
}

export interface MoyinProviderEnvelope {
  readonly schemaVersion: typeof DIRECTOR_EXTERNAL_TOOL_SCHEMA_VERSION;
  readonly status: "success" | "error" | "unavailable";
  readonly provider: "moyin";
  readonly operation: string;
  readonly summary: string;
  readonly events?: readonly Readonly<Record<string, unknown>>[];
  readonly output?: unknown;
  readonly error?: MoyinProviderErrorEnvelope | null;
  readonly nextActions: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MoyinProviderErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly rootCauseHint: string;
  readonly failureKind: ConversationRuntimeUserFacingFailureKind;
  readonly recoverable: boolean;
  readonly providerRawErrorSummary: string;
  readonly safeRetry: {
    readonly strategy: "policy.exponential_backoff" | "manual";
    readonly executor: "orchestrator" | "operator";
    readonly maxAttemptsRef?: string;
    readonly initialDelayMsRef?: string;
    readonly instruction?: string;
  };
  readonly stopCondition: {
    readonly type: "policy.max_attempts_reached" | "operator_action_required";
    readonly action: "return_error_to_brain" | "wait_for_operator";
  };
  readonly retryHistory: readonly unknown[];
  readonly diagnostics: Readonly<{
    readonly provider: "moyin";
    readonly rawSummaryHash: string;
    readonly redacted: true;
    readonly suggestedOwner: "orchestrator" | "operator";
  }>;
}

export function createMoyinProviderRegistration(
  options: CreateMoyinProviderRegistrationOptions = {},
): ExternalToolRegistration {
  const toolId = options.toolId ?? "moyin.provider";
  const binary = options.binary ?? DEFAULT_MOYIN_BINARY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_MOYIN_TIMEOUT_MS;
  const runner = options.runner ?? createDefaultMoyinProviderRunner();
  return {
    manifest: createExternalToolProviderManifest({
      id: toolId,
      label: options.label ?? "Moyin",
      description:
        options.description ??
        "External Moyin production control-plane provider exposed through the Moyin CLI.",
      source: "external",
      providerId: "moyin",
      enabled: options.enabled ?? true,
      capabilities: createMoyinProviderCapabilities(),
      sourceTrust: {
        status: "trusted-local-config",
        label: "本地 Moyin CLI",
        reason: "Moyin is controlled through the local CLI/control-plane boundary.",
      },
      approvalBoundary: {
        mode: "runtime-policy",
        actionLabels: ["确认", "拒绝"],
        requiresOperator: true,
        riskLevel: "medium",
      },
      metadata: {
        ...(options.metadata ?? {}),
        schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
        providerFamily: "workflow-production",
        binary,
        phase: "p0-alpha",
        p0MvpOnly: false,
        supportsSubmit: true,
        operationManifest: MOYIN_OPERATION_MANIFEST,
      },
    }),
    check: async () => checkMoyinProviderHealth({ binary, timeoutMs, runner }),
    invoke: async (request) => invokeMoyinProvider(request, { binary, timeoutMs, runner }),
    allowInvokeWhenUnavailable: true,
  };
}

function createMoyinProviderCapabilities() {
  const capabilities = [
    {
      id: "health",
      label: "Moyin health",
      description: "Check Moyin CLI and control-plane readiness.",
      readOnly: true,
      metadata: { capability: "moyin.health" },
    },
    {
      id: "capabilities.handshake",
      label: "Moyin capability handshake",
      description: "Probe Moyin CLI/control-plane capabilities through read-only JSON commands.",
      readOnly: true,
      metadata: { capability: "moyin.capabilities.handshake" },
    },
    {
      id: "adapter.resolve",
      label: "Moyin adapter resolve",
      description: "Resolve Moyin provider/model binding for a panel, media kind, and feature.",
      readOnly: true,
      metadata: { capability: "moyin.adapter.resolve" },
    },
    {
      id: "adapter.image-execution",
      label: "Moyin image execution draft",
      description: "Build a Moyin image execution draft without submitting it.",
      readOnly: true,
      metadata: { capability: "moyin.adapter.image_execution" },
    },
    {
      id: "adapter.script-execution",
      label: "Moyin script execution draft",
      description: "Build a Moyin script execution draft without submitting it.",
      readOnly: true,
      metadata: { capability: "moyin.adapter.script_execution" },
    },
    {
      id: "adapter.video-execution",
      label: "Moyin video execution draft",
      description: "Build a Moyin video execution draft without submitting it.",
      readOnly: true,
      metadata: { capability: "moyin.adapter.video_execution" },
    },
    {
      id: "discover.templates",
      label: "Moyin task templates",
      description: "List Moyin task templates.",
      readOnly: true,
      metadata: { capability: "moyin.discover.templates" },
    },
    {
      id: "discover.projects",
      label: "Moyin projects",
      description: "List Moyin projects.",
      readOnly: true,
      metadata: { capability: "moyin.discover.projects" },
    },
    {
      id: "project.list",
      label: "Moyin project list",
      description: "List Moyin projects as first-class production anchors.",
      readOnly: true,
      metadata: { capability: "moyin.project.list" },
    },
    {
      id: "project.get",
      label: "Moyin project get",
      description: "Read one Moyin project by id before binding a production run.",
      readOnly: true,
      metadata: { capability: "moyin.project.get" },
    },
    {
      id: "project.store.get",
      label: "Moyin project store get",
      description: "Read one Moyin project scoped store for content-level readiness checks.",
      readOnly: true,
      metadata: { capability: "moyin.project.store.get" },
    },
    {
      id: "project.create",
      label: "Moyin project create",
      description: "Create a Moyin project after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.project.create" },
    },
    {
      id: "workflow.export",
      label: "Moyin workflow export",
      description: "Export a Moyin workflow run package for audit or interop.",
      readOnly: true,
      metadata: { capability: "moyin.workflow.export" },
    },
    {
      id: "sealed.image.preview",
      label: "Moyin sealed image preview",
      description: "Create a sealed image request preview without submitting execution.",
      readOnly: true,
      metadata: { capability: "moyin.sealed.image.preview", effect: "preview-only" },
    },
    {
      id: "sealed.video.preview",
      label: "Moyin sealed video preview",
      description: "Create a sealed video request preview without submitting execution.",
      readOnly: true,
      metadata: { capability: "moyin.sealed.video.preview", effect: "preview-only" },
    },
    {
      id: "sealed.get",
      label: "Moyin sealed request read",
      description: "Read a sealed Moyin request before approval or execution.",
      readOnly: true,
      metadata: { capability: "moyin.sealed.get" },
    },
    {
      id: "sealed.submit",
      label: "Moyin sealed request submit",
      description: "Submit an approved sealed Moyin request for execution.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.sealed.submit" },
    },
    {
      id: "task.list",
      label: "Moyin task list",
      description: "List Moyin tasks without watching or mutating execution.",
      readOnly: true,
      metadata: { capability: "moyin.task.list" },
    },
    {
      id: "task.template.get",
      label: "Moyin task template get",
      description: "Read a single Moyin task template by id.",
      readOnly: true,
      metadata: { capability: "moyin.task.template.get" },
    },
    {
      id: "task.template.build",
      label: "Moyin task template build",
      description: "Build a Moyin task request from a template without submitting it.",
      readOnly: true,
      metadata: { capability: "moyin.task.template.build" },
    },
    {
      id: "task.watch",
      label: "Moyin task watch",
      description: "Watch a Moyin task and return its structured JSON progress/result.",
      readOnly: true,
      metadata: { capability: "moyin.task.watch", lifecycle: "orchestrator-watch" },
    },
    {
      id: "task.cancel",
      label: "Moyin task cancel",
      description: "Cancel an in-flight Moyin task through the provider boundary.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.task.cancel" },
    },
    {
      id: "task.submit",
      label: "Moyin task submit",
      description: "Submit a prepared Moyin task request after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.task.submit" },
    },
    {
      id: "artifact.list",
      label: "Moyin artifact list",
      description: "List Moyin artifacts for a project, run, step, or artifact type.",
      readOnly: true,
      metadata: { capability: "moyin.artifact.list" },
    },
    {
      id: "artifact.get",
      label: "Moyin artifact get",
      description: "Read Moyin artifact metadata by id.",
      readOnly: true,
      metadata: { capability: "moyin.artifact.get" },
    },
    {
      id: "artifact.backfill",
      label: "Moyin artifact backfill",
      description: "Recover Moyin artifacts from completed task summaries without submitting jobs.",
      readOnly: true,
      metadata: {
        capability: "moyin.artifact.backfill",
        effect: "recover-existing-artifacts",
      },
    },
    {
      id: "artifact.attach",
      label: "Moyin artifact attach",
      description: "Attach external artifact metadata to a Moyin project, run, or step.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.artifact.attach" },
    },
    {
      id: "artifact.delete",
      label: "Moyin artifact delete",
      description: "Delete a Moyin artifact reference after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.artifact.delete" },
    },
    {
      id: "prompt.schema",
      label: "Moyin prompt schema",
      description: "Read the Moyin prompt snapshot schema.",
      readOnly: true,
      metadata: { capability: "moyin.prompt.schema" },
    },
    {
      id: "prompt.list",
      label: "Moyin prompt list",
      description: "List Moyin prompt snapshots for a project.",
      readOnly: true,
      metadata: { capability: "moyin.prompt.list" },
    },
    {
      id: "prompt.create",
      label: "Moyin prompt create",
      description: "Create a Moyin prompt snapshot after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.prompt.create" },
    },
    {
      id: "prompt.resolve",
      label: "Moyin prompt resolve",
      description: "Resolve a Moyin prompt snapshot or overlay without mutating canonical prompts.",
      readOnly: true,
      metadata: { capability: "moyin.prompt.resolve" },
    },
    {
      id: "prompt.get",
      label: "Moyin prompt get",
      description: "Read one Moyin prompt snapshot.",
      readOnly: true,
      metadata: { capability: "moyin.prompt.get" },
    },
    {
      id: "prompt.delete",
      label: "Moyin prompt delete",
      description: "Delete a Moyin prompt snapshot after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.prompt.delete" },
    },
    {
      id: "memory.get",
      label: "Moyin memory get",
      description: "Read Moyin project memory.",
      readOnly: true,
      metadata: { capability: "moyin.memory.get" },
    },
    {
      id: "memory.upsert",
      label: "Moyin memory upsert",
      description: "Write Moyin project memory after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.memory.upsert" },
    },
    {
      id: "memory.diff",
      label: "Moyin memory diff",
      description: "Read a Moyin workflow-run memory draft diff.",
      readOnly: true,
      metadata: { capability: "moyin.memory.diff" },
    },
    {
      id: "memory.approve",
      label: "Moyin memory approve",
      description: "Approve a Moyin workflow-run memory draft after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.memory.approve" },
    },
    {
      id: "memory.reject",
      label: "Moyin memory reject",
      description: "Reject a Moyin workflow-run memory draft after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.memory.reject" },
    },
    {
      id: "workflow-run.artifacts",
      label: "Moyin workflow run artifacts",
      description: "List artifacts attached to a Moyin workflow run.",
      readOnly: true,
      metadata: { capability: "moyin.workflow_run.artifacts" },
    },
    {
      id: "workflow-run.list",
      label: "Moyin workflow run list",
      description: "List Moyin workflow runs for a project without advancing execution.",
      readOnly: true,
      metadata: { capability: "moyin.workflow_run.list" },
    },
    {
      id: "workflow-run.create",
      label: "Moyin workflow run create",
      description: "Create a local Moyin workflow run draft without submitting tasks.",
      readOnly: true,
      metadata: { capability: "moyin.workflow_run.create", effect: "draft-only" },
    },
    {
      id: "workflow-run.get",
      label: "Moyin workflow run get",
      description: "Read one Moyin workflow run by id without advancing execution.",
      readOnly: true,
      metadata: { capability: "moyin.workflow_run.get" },
    },
    {
      id: "workflow-run.steps",
      label: "Moyin workflow run steps",
      description: "Read normalized Moyin workflow run step state.",
      readOnly: true,
      metadata: { capability: "moyin.workflow_run.steps" },
    },
    {
      id: "workflow-run.advance",
      label: "Moyin workflow run advance",
      description: "Advance one Moyin workflow run step through an approved provider action.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.workflow_run.advance" },
    },
    {
      id: "workflow-run.attach-artifact",
      label: "Moyin workflow run attach artifact",
      description: "Attach artifact metadata to a Moyin workflow-run step after approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.workflow_run.attach_artifact" },
    },
    {
      id: "workflow-run.cancel",
      label: "Moyin workflow run cancel",
      description: "Cancel an in-flight Moyin workflow run through the provider boundary.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.workflow_run.cancel" },
    },
    {
      id: "workflow.draft",
      label: "Moyin workflow draft",
      description: "Create a Moyin draft workflow package from an external workflow graph.",
      readOnly: true,
      metadata: { capability: "moyin.workflow.draft" },
    },
    {
      id: "workflow.schema",
      label: "Moyin workflow schema",
      description: "Read the Moyin workflow schema.",
      readOnly: true,
      metadata: { capability: "moyin.workflow.schema" },
    },
    {
      id: "workflow.list",
      label: "Moyin workflow list",
      description: "List Moyin workflows for a project.",
      readOnly: true,
      metadata: { capability: "moyin.workflow.list" },
    },
    {
      id: "workflow.create",
      label: "Moyin workflow create",
      description: "Create a Moyin workflow after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.workflow.create" },
    },
    {
      id: "workflow.import",
      label: "Moyin workflow import",
      description: "Create a Moyin draft workflow from an imported package.",
      readOnly: false,
      requiresApproval: true,
      metadata: {
        capability: "moyin.workflow.import",
        argAdmission: {
          blockedStringPatterns: ["(^|/)\\.\\.(?:/|$)", "[;&|`$]"],
        },
      },
    },
    {
      id: "workflow.get",
      label: "Moyin workflow get",
      description: "Read a Moyin workflow by id.",
      readOnly: true,
      metadata: { capability: "moyin.workflow.get" },
    },
    {
      id: "workflow.build",
      label: "Moyin workflow build",
      description: "Build Moyin workflow step request drafts without submitting them.",
      readOnly: true,
      metadata: { capability: "moyin.workflow.build" },
    },
    {
      id: "workflow.validate",
      label: "Moyin workflow validate",
      description: "Validate a Moyin workflow before execution.",
      readOnly: true,
      metadata: { capability: "moyin.workflow.validate" },
    },
    {
      id: "workflow.delete",
      label: "Moyin workflow delete",
      description: "Delete a Moyin workflow after explicit operator approval.",
      readOnly: false,
      requiresApproval: true,
      metadata: { capability: "moyin.workflow.delete" },
    },
  ] as const;
  return capabilities.map((capability) => ({
    ...capability,
    metadata: createMoyinCapabilityMetadata(
      capability.id as MoyinProviderOperation,
      capability.metadata,
    ),
  }));
}

function createMoyinCapabilityMetadata(
  operation: MoyinProviderOperation,
  metadata: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    ...metadata,
    ...MOYIN_OPERATION_MANIFEST[operation],
  };
}

async function checkMoyinProviderHealth(input: {
  readonly binary: string;
  readonly timeoutMs: number;
  readonly runner: MoyinProviderRunner;
}): Promise<ExternalToolDoctorResult> {
  const result = await runMoyinJsonCommand(input, ["status", "--json"]);
  if (!result.ok) {
    return {
      status: result.doctorStatus,
      summary: result.summary,
      nextActions: result.nextActions,
      details: {
        schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
        error: result.errorEnvelope,
      },
    };
  }
  const version = extractMoyinVersionStatus(result.payload);
  if (version.compatibility === "incompatible") {
    return {
      status: "failed",
      summary: "Moyin CLI/control-plane version is incompatible with Director Angel.",
      nextActions: [
        `Upgrade Moyin CLI to >=${REQUIRED_MOYIN_CLI_VERSION} and control-plane/protocol to >=${REQUIRED_MOYIN_CONTROL_PLANE_VERSION}.`,
      ],
      details: {
        schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
        version,
        payload: redactMoyinProviderValue(result.payload),
      },
    };
  }
  return {
    status: version.compatibility === "degraded" ? "misconfigured" : "ready",
    summary:
      version.compatibility === "degraded"
        ? "Moyin CLI/control-plane did not report a complete version contract."
        : "Moyin CLI/control-plane is ready.",
    nextActions:
      version.compatibility === "degraded"
        ? [
            "Upgrade Moyin CLI/control-plane so status --json reports cliVersion and protocolVersion.",
          ]
        : [],
    details: {
      schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
      version,
      payload: redactMoyinProviderValue(result.payload),
    },
  };
}

async function invokeMoyinProvider(
  request: ExternalToolHandlerInvokeRequest,
  input: {
    readonly binary: string;
    readonly timeoutMs: number;
    readonly runner: MoyinProviderRunner;
  },
): Promise<ExternalToolHandlerInvokeOutput> {
  const operation = normalizeMoyinOperation(request.operationId);
  if (operation === null) {
    const errorEnvelope = createMoyinProviderErrorEnvelope({
      code: "MOYIN_OPERATION_UNSUPPORTED",
      message: `Unsupported Moyin operation: ${String(request.operationId ?? "")}`,
      rootCauseHint: "The requested operation is not part of the Moyin provider surface.",
      retryExecutor: "operator",
      retryInstruction: "Choose an operation declared by the Moyin provider manifest.",
    });
    return {
      ok: false,
      status: "error",
      content: errorEnvelope.message,
      error: errorEnvelope.code,
      output: createMoyinProviderEnvelope({
        status: "error",
        operation: String(request.operationId ?? "unknown"),
        summary: errorEnvelope.message,
        error: errorEnvelope,
      }),
    };
  }

  if (operation === "workflow.draft") {
    const draft = createMoyinWorkflowDraftFromArgs(request.args ?? {});
    return {
      ok: true,
      status: "success",
      content: "Moyin workflow draft package created.",
      output: createMoyinProviderEnvelope({
        status: "success",
        operation,
        summary: "Moyin workflow draft package created.",
        output: draft,
      }),
      metadata: {
        schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
        operation,
      },
      artifacts: draft.artifacts,
    };
  }

  if (operation === "capabilities.handshake") {
    return invokeMoyinCapabilityHandshake(request.args ?? {}, input);
  }

  let preparedCommand: MoyinPreparedCommand;
  try {
    preparedCommand = await createMoyinPreparedCommand(operation, request.args ?? {});
  } catch (error) {
    const errorEnvelope = createMoyinProviderErrorEnvelope({
      code: "MOYIN_INVALID_ARGUMENTS",
      message: error instanceof Error ? error.message : String(error),
      rootCauseHint: "The Moyin provider request is missing a required structured argument.",
      retryExecutor: "operator",
      retryInstruction: "Fix the provider args and retry the same operation.",
    });
    return {
      ok: false,
      status: "error",
      content: errorEnvelope.message,
      error: errorEnvelope.code,
      output: createMoyinProviderEnvelope({
        status: "error",
        operation,
        summary: errorEnvelope.message,
        error: errorEnvelope,
      }),
    };
  }
  const result = await runMoyinCommand(
    {
      ...input,
      timeoutMs: resolveMoyinCommandTimeoutMs(input.timeoutMs, operation, request.args ?? {}),
    },
    preparedCommand.args,
    operation,
  );
  if (!result.ok) {
    return {
      ok: false,
      status: result.invokeStatus,
      content: result.summary,
      error: result.errorEnvelope.code,
      output: createMoyinProviderEnvelope({
        status: result.envelopeStatus,
        operation,
        summary: result.summary,
        error: result.errorEnvelope,
        nextActions: result.nextActions,
      }),
      metadata: {
        schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
        retryHistory: [],
      },
    };
  }
  const validationError = createMoyinWorkflowValidationError(operation, result.payload);
  if (validationError !== undefined) {
    return {
      ok: false,
      status: "error",
      content: validationError.message,
      error: validationError.code,
      output: createMoyinProviderEnvelope({
        status: "error",
        operation,
        summary: validationError.message,
        output: redactMoyinProviderValue(result.payload),
        error: validationError,
      }),
      metadata: {
        schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
        operation,
      },
    };
  }
  const workflowRunAdvanceError = createMoyinWorkflowRunAdvanceFailureError(
    operation,
    result.payload,
  );
  if (workflowRunAdvanceError !== undefined) {
    return {
      ok: false,
      status: "error",
      content: workflowRunAdvanceError.message,
      error: workflowRunAdvanceError.code,
      output: createMoyinProviderEnvelope({
        status: "error",
        operation,
        summary: workflowRunAdvanceError.message,
        output: createMoyinProviderOutput(operation, request.args ?? {}, result.payload),
        error: workflowRunAdvanceError,
      }),
      metadata: {
        schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
        operation,
      },
    };
  }
  const buildReadinessError = createMoyinBuildReadinessError(operation, result.payload);
  if (buildReadinessError !== undefined) {
    return {
      ok: false,
      status: "error",
      content: buildReadinessError.message,
      error: buildReadinessError.code,
      output: createMoyinProviderEnvelope({
        status: "error",
        operation,
        summary: buildReadinessError.message,
        output: createMoyinProviderOutput(operation, request.args ?? {}, result.payload),
        error: buildReadinessError,
      }),
      metadata: {
        schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
        operation,
      },
    };
  }
  const previewReadinessError = createMoyinSealedPreviewReadinessError(operation, result.payload);
  if (previewReadinessError !== undefined) {
    return {
      ok: false,
      status: "error",
      content: previewReadinessError.message,
      error: previewReadinessError.code,
      output: createMoyinProviderEnvelope({
        status: "error",
        operation,
        summary: previewReadinessError.message,
        output: redactMoyinProviderValue(result.payload),
        error: previewReadinessError,
      }),
      metadata: {
        schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
        operation,
      },
    };
  }

  const providerOutput = createMoyinProviderOutput(operation, request.args ?? {}, result.payload);
  const budgetedOutput = await createMoyinResultBudgetedOutput({
    operation,
    output: providerOutput,
    requestMetadata: request.metadata,
  });
  const externalArtifacts = createMoyinExternalToolArtifactsOutput(operation, result.payload);
  const artifacts = [...(externalArtifacts.artifacts ?? []), ...budgetedOutput.artifacts];
  const successSummary = createMoyinSuccessSummary(operation, result.payload);
  return {
    ok: true,
    status: "success",
    content: successSummary,
    output: createMoyinProviderEnvelope({
      status: "success",
      operation,
      summary: successSummary,
      events: createMoyinProviderEvents(operation, request.args ?? {}, result.payload),
      output: budgetedOutput.output,
      metadata: {
        version: extractMoyinVersionStatus(result.payload),
        ...(preparedCommand.metadata ?? {}),
        ...(result.metadata ?? {}),
        ...(budgetedOutput.metadata ?? {}),
      },
    }),
    metadata: {
      schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
      operation,
    },
    ...(artifacts.length === 0 ? {} : { artifacts }),
  };
}

async function invokeMoyinCapabilityHandshake(
  args: Readonly<Record<string, unknown>>,
  input: {
    readonly binary: string;
    readonly timeoutMs: number;
    readonly runner: MoyinProviderRunner;
  },
): Promise<ExternalToolHandlerInvokeOutput> {
  const checks: Array<Readonly<Record<string, unknown>>> = [];
  for (const probe of createMoyinCapabilityHandshakeProbes(args)) {
    const result = await runMoyinJsonCommand(input, probe.args);
    if (!result.ok) {
      if (probe.required === true) {
        return {
          ok: false,
          status: result.invokeStatus,
          content: result.summary,
          error: result.errorEnvelope.code,
          output: createMoyinProviderEnvelope({
            status: result.envelopeStatus,
            operation: "capabilities.handshake",
            summary: result.summary,
            error: result.errorEnvelope,
            nextActions: result.nextActions,
          }),
          metadata: {
            schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
            retryHistory: [],
          },
        };
      }
      checks.push({
        capability: probe.capability,
        status: "degraded",
        command: { binary: input.binary, args: probe.args },
        error: result.errorEnvelope,
      });
      continue;
    }
    checks.push({
      capability: probe.capability,
      status: "available",
      command: { binary: input.binary, args: probe.args },
      payload: redactMoyinProviderValue(result.payload),
    });
  }

  const availableCapabilities = checks.flatMap((check) =>
    check.status === "available" && typeof check.capability === "string" ? [check.capability] : [],
  );
  const missingCapabilities = checks.flatMap((check) =>
    check.status === "degraded" && typeof check.capability === "string" ? [check.capability] : [],
  );
  const status = missingCapabilities.length === 0 ? "ready" : "degraded";
  const summary =
    status === "ready"
      ? "Moyin capability handshake ready."
      : "Moyin capability handshake degraded.";
  const healthPayload = checks.find((check) => check.capability === "health")?.payload;
  const output = {
    schemaVersion: "director.moyin-capability-handshake.v1",
    provider: "moyin",
    status,
    version: extractMoyinVersionStatus(healthPayload),
    availableCapabilities,
    missingCapabilities,
    checks,
  };

  return {
    ok: true,
    status: "success",
    content: summary,
    output: createMoyinProviderEnvelope({
      status: "success",
      operation: "capabilities.handshake",
      summary,
      output,
      metadata: {
        version: output.version,
      },
    }),
    metadata: {
      schemaVersion: MOYIN_PROVIDER_SCHEMA_VERSION,
      operation: "capabilities.handshake",
    },
  };
}

function createMoyinCapabilityHandshakeProbes(
  args: Readonly<Record<string, unknown>>,
): readonly MoyinCapabilityHandshakeProbe[] {
  const projectId = readNonEmptyString(args.projectId);
  const baseProbes: MoyinCapabilityHandshakeProbe[] = [
    { capability: "health", args: ["status", "--json"], required: true },
    { capability: "discover.projects", args: ["project", "list", "--json"] },
    { capability: "discover.providers", args: ["config", "providers", "--json"] },
    { capability: "discover.models", args: ["config", "models", "--json"] },
    { capability: "discover.templates", args: ["task", "template", "list", "--json"] },
  ];
  if (projectId === undefined) {
    return baseProbes;
  }
  return [
    ...baseProbes,
    {
      capability: "discover.workflows",
      args: ["workflow", "list", "--project", projectId, "--json"],
    },
    { capability: "task.list", args: ["task", "list", "--project", projectId, "--json"] },
    {
      capability: "workflow-run.list",
      args: ["workflow-run", "list", "--project", projectId, "--json"],
    },
    { capability: "prompt.list", args: ["prompt", "list", "--project", projectId, "--json"] },
    { capability: "memory.get", args: ["memory", "get", "--project", projectId, "--json"] },
  ];
}

function createMoyinWorkflowValidationError(
  operation: MoyinProviderOperation,
  payload: unknown,
): MoyinProviderErrorEnvelope | undefined {
  if (operation !== "workflow.validate" || !isRecord(payload)) {
    return undefined;
  }
  if (payload.valid !== false && payload.ok !== false) {
    return undefined;
  }
  const messages = readMoyinValidationMessages(payload.errors ?? payload.issues);
  return createMoyinProviderErrorEnvelope({
    code: "MOYIN_WORKFLOW_VALIDATION_FAILED",
    message:
      messages.length === 0
        ? "Moyin workflow validation failed."
        : `Moyin workflow validation failed: ${messages.join("; ")}`,
    rootCauseHint:
      "Moyin reported the workflow as invalid; do not build or execute this workflow until validation passes.",
    retryExecutor: "operator",
    retryInstruction: "Fix the workflow draft or dependencies, then run workflow.validate again.",
  });
}

function createMoyinWorkflowRunAdvanceFailureError(
  operation: MoyinProviderOperation,
  payload: unknown,
): MoyinProviderErrorEnvelope | undefined {
  if (operation !== "workflow-run.advance" || !isRecord(payload)) {
    return undefined;
  }

  const step = isRecord(payload.step)
    ? payload.step
    : isRecord(payload.currentStep)
      ? payload.currentStep
      : undefined;
  const run = isRecord(payload.run) ? payload.run : undefined;
  const stepStatus = step === undefined ? undefined : readRecordString(step, "status");
  const runStatus =
    readRecordString(payload, "status") ??
    (run === undefined ? undefined : readRecordString(run, "status"));
  if (stepStatus !== "failed" && runStatus !== "failed") {
    return undefined;
  }

  const stepError = step === undefined ? undefined : readMoyinWorkflowRunStepError(step.error);
  const code = stepError === undefined ? undefined : readRecordString(stepError, "code");
  const message = stepError === undefined ? undefined : readRecordString(stepError, "message");
  const warnings = readStringArray(
    payload.warnings ?? (step === undefined ? undefined : step.warnings),
  );
  const stepId =
    readRecordString(payload, "stepId") ??
    (step === undefined ? undefined : readRecordString(step, "stepId")) ??
    "unknown-step";
  const action = readRecordString(payload, "action") ?? "unknown-action";
  const details = [
    `step:${stepId}`,
    `action:${action}`,
    ...(stepStatus === undefined ? [] : [`stepStatus:${stepStatus}`]),
    ...(runStatus === undefined ? [] : [`runStatus:${runStatus}`]),
    ...(code === undefined ? [] : [`code:${code}`]),
    ...(message === undefined ? [] : [message]),
    ...warnings,
  ];

  return createMoyinProviderErrorEnvelope({
    code: code ?? "MOYIN_WORKFLOW_RUN_ADVANCE_FAILED",
    message: `Moyin workflow-run advance failed: ${details.join("; ")}.`,
    rootCauseHint:
      "Moyin accepted the advance command but marked the workflow-run or target step as failed; do not treat this mutation as successful.",
    retryExecutor: "operator",
    retryInstruction:
      "Inspect the step error, then retry or skip through a fresh workflow-run approval packet if the step is retryable.",
  });
}

function createMoyinBuildReadinessError(
  operation: MoyinProviderOperation,
  payload: unknown,
): MoyinProviderErrorEnvelope | undefined {
  if (!isMoyinBuildReadinessOperation(operation) || !isRecord(payload)) {
    return undefined;
  }

  const missing = readMoyinReadinessStrings(payload.missing, payload.missingRequired);
  const blockers = readMoyinReadinessStrings(payload.blockers, payload.blockingIssues);
  const issueMessages = readMoyinValidationMessages(payload.errors ?? payload.issues);
  const adapterExecutionOperation =
    operation === "adapter.script-execution" ||
    operation === "adapter.image-execution" ||
    operation === "adapter.video-execution";
  const adapterDraftAvailable =
    adapterExecutionOperation && (isRecord(payload.executionDraft) || isRecord(payload.execution));
  const executableBlocked = payload.executable === false && !adapterDraftAvailable;
  const validityBlocked = payload.valid === false || payload.ok === false;
  const adapterDraftMissing = adapterExecutionOperation && !adapterDraftAvailable;

  if (
    missing.length === 0 &&
    blockers.length === 0 &&
    issueMessages.length === 0 &&
    !executableBlocked &&
    !validityBlocked &&
    !adapterDraftMissing
  ) {
    return undefined;
  }

  const details = [
    ...missing.map((item) => `missing:${item}`),
    ...blockers.map((item) => `blocker:${item}`),
    ...issueMessages,
    ...(adapterDraftMissing ? ["executionDraft missing"] : []),
  ];
  return createMoyinProviderErrorEnvelope({
    code: "MOYIN_BUILD_NOT_EXECUTABLE",
    message:
      details.length === 0
        ? `Moyin ${operation} result is not executable.`
        : `Moyin ${operation} result is not executable: ${details.join("; ")}.`,
    rootCauseHint:
      "Moyin reported missing prerequisites, blockers, invalid workflow issues, or no executable draft. Do not submit until the build result is executable.",
    retryExecutor: "operator",
    retryInstruction:
      "Resolve the Moyin provider/model/API key binding or required request fields, then rebuild before approval.",
  });
}

function isMoyinBuildReadinessOperation(operation: MoyinProviderOperation): boolean {
  return (
    operation === "adapter.script-execution" ||
    operation === "adapter.image-execution" ||
    operation === "adapter.video-execution" ||
    operation === "task.template.build" ||
    operation === "workflow.build"
  );
}

function readMoyinReadinessStrings(primary: unknown, secondary: unknown): readonly string[] {
  return [...new Set([...readStringArray(primary), ...readStringArray(secondary)])];
}

function createMoyinSealedPreviewReadinessError(
  operation: MoyinProviderOperation,
  payload: unknown,
): MoyinProviderErrorEnvelope | undefined {
  if (operation !== "sealed.image.preview" && operation !== "sealed.video.preview") {
    return undefined;
  }
  if (!isRecord(payload)) {
    return undefined;
  }

  const sealedRequestId = readRecordString(payload, "sealedRequestId");
  const executable = payload.executable;
  if (sealedRequestId !== undefined && executable !== false) {
    return undefined;
  }

  const missing = readStringArray(payload.missing);
  const blockers = readStringArray(payload.blockers);
  const details = [...missing, ...blockers].join(", ");
  const mediaKind = operation === "sealed.image.preview" ? "image" : "video";
  const reason = details.length > 0 ? ` Missing or blocked: ${details}.` : "";
  return createMoyinProviderErrorEnvelope({
    code: "MOYIN_SEALED_PREVIEW_NOT_EXECUTABLE",
    message: `Moyin sealed ${mediaKind} preview is not executable.${reason}`,
    rootCauseHint:
      "Moyin did not create a sealed request. Check provider/model/API key binding and required task values before submitting.",
    retryExecutor: "operator",
    retryInstruction:
      "Configure the missing Moyin provider/model/API key binding or required task values, then create the sealed preview again.",
  });
}

interface MoyinCommandSuccess {
  readonly ok: true;
  readonly payload: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface MoyinCommandFailure {
  readonly ok: false;
  readonly summary: string;
  readonly doctorStatus: ExternalToolDoctorResult["status"];
  readonly invokeStatus: "error" | "unavailable";
  readonly envelopeStatus: "error" | "unavailable";
  readonly errorEnvelope: MoyinProviderErrorEnvelope;
  readonly nextActions: readonly string[];
}

interface MoyinPreparedCommand {
  readonly args: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface MoyinCapabilityHandshakeProbe {
  readonly capability: MoyinProviderOperation;
  readonly args: readonly string[];
  readonly required?: boolean;
}

async function runMoyinJsonCommand(
  input: {
    readonly binary: string;
    readonly timeoutMs: number;
    readonly runner: MoyinProviderRunner;
  },
  args: readonly string[],
): Promise<MoyinCommandSuccess | MoyinCommandFailure> {
  try {
    const result = await input.runner({
      binary: input.binary,
      args,
      timeoutMs: input.timeoutMs,
    });
    if (result.exitCode !== 0) {
      return createMoyinCommandFailure({
        code: classifyMoyinCliErrorCode(result),
        message: normalizeCommandFailureMessage(result),
      });
    }
    const parsed = parseMoyinJson(result.stdout);
    if (!parsed.ok) {
      return createMoyinCommandFailure({
        code: "MOYIN_JSON_PARSE_FAILED",
        message: parsed.error,
        rootCauseHint: "Moyin CLI did not return valid JSON on stdout.",
      });
    }
    return { ok: true, payload: parsed.value };
  } catch (error) {
    return createMoyinCommandFailure({
      code: "MOYIN_CLI_EXEC_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runMoyinCommand(
  input: {
    readonly binary: string;
    readonly timeoutMs: number;
    readonly runner: MoyinProviderRunner;
  },
  args: readonly string[],
  operation: MoyinProviderOperation,
): Promise<MoyinCommandSuccess | MoyinCommandFailure> {
  if (operation !== "task.watch") {
    return runMoyinJsonCommand(input, args);
  }
  const result = await runMoyinJsonOrNdjsonCommand(input, args);
  if (!result.ok || result.metadata?.stdoutFormat !== "ndjson") {
    return result;
  }
  return {
    ...result,
    payload: createMoyinTaskWatchOutputFromNdjson(result.payload),
  };
}

async function runMoyinJsonOrNdjsonCommand(
  input: {
    readonly binary: string;
    readonly timeoutMs: number;
    readonly runner: MoyinProviderRunner;
  },
  args: readonly string[],
): Promise<MoyinCommandSuccess | MoyinCommandFailure> {
  try {
    const result = await input.runner({
      binary: input.binary,
      args,
      timeoutMs: input.timeoutMs,
    });
    if (result.exitCode !== 0) {
      return createMoyinCommandFailure({
        code: classifyMoyinCliErrorCode(result),
        message: normalizeCommandFailureMessage(result),
      });
    }
    const parsedJson = parseMoyinJson(result.stdout);
    if (parsedJson.ok) {
      return { ok: true, payload: parsedJson.value, metadata: { stdoutFormat: "json" } };
    }
    const parsedNdjson = parseMoyinNdjson(result.stdout);
    if (parsedNdjson.ok) {
      return { ok: true, payload: parsedNdjson.value, metadata: { stdoutFormat: "ndjson" } };
    }
    return createMoyinCommandFailure({
      code: "MOYIN_JSON_PARSE_FAILED",
      message: parsedJson.error,
      rootCauseHint: "Moyin CLI did not return valid JSON or NDJSON on stdout.",
    });
  } catch (error) {
    return createMoyinCommandFailure({
      code: "MOYIN_CLI_EXEC_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function createMoyinCommandFailure(input: {
  readonly code: string;
  readonly message: string;
  readonly rootCauseHint?: string;
}): MoyinCommandFailure {
  const summary = redactMoyinProviderErrorSummary(input.message);
  const unavailable =
    input.code === "CONTROL_PLANE_NOT_FOUND" ||
    input.code === "MOYIN_CLI_EXEC_FAILED" ||
    input.code === "MOYIN_CLI_NOT_FOUND";
  const errorEnvelope = createMoyinProviderErrorEnvelope({
    code: input.code,
    message: summary,
    rootCauseHint: input.rootCauseHint ?? createMoyinRootCauseHint(input.code),
    retryExecutor: selectMoyinRetryExecutor(input.code),
    retryInstruction: createMoyinRetryInstruction(input.code),
  });
  return {
    ok: false,
    summary,
    doctorStatus: unavailable ? "unreachable" : "failed",
    invokeStatus: unavailable ? "unavailable" : "error",
    envelopeStatus: unavailable ? "unavailable" : "error",
    errorEnvelope,
    nextActions: createMoyinNextActions(input.code),
  };
}

function createMoyinProviderEnvelope(input: {
  readonly status: MoyinProviderEnvelope["status"];
  readonly operation: string;
  readonly summary: string;
  readonly events?: readonly Readonly<Record<string, unknown>>[];
  readonly output?: unknown;
  readonly error?: MoyinProviderErrorEnvelope | null;
  readonly nextActions?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}): MoyinProviderEnvelope {
  return {
    schemaVersion: DIRECTOR_EXTERNAL_TOOL_SCHEMA_VERSION,
    status: input.status,
    provider: "moyin",
    operation: input.operation,
    summary: input.summary,
    ...(input.events === undefined || input.events.length === 0 ? {} : { events: input.events }),
    ...(input.output === undefined ? {} : { output: input.output }),
    error: input.error ?? null,
    nextActions: input.nextActions ?? [],
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

function createMoyinProviderErrorEnvelope(input: {
  readonly code: string;
  readonly message: string;
  readonly rootCauseHint: string;
  readonly retryExecutor?: "orchestrator" | "operator";
  readonly retryInstruction?: string;
}): MoyinProviderErrorEnvelope {
  const retryExecutor = input.retryExecutor ?? "orchestrator";
  const providerRawErrorSummary = redactMoyinProviderErrorSummary(input.message);
  const failure = classifyConversationRuntimeFailure({
    code: classifyMoyinFailureTaxonomyCode(input.code, providerRawErrorSummary),
    message: providerRawErrorSummary,
  });
  return {
    code: input.code,
    message: providerRawErrorSummary,
    rootCauseHint: input.rootCauseHint,
    failureKind: failure.kind,
    recoverable: failure.recoverable,
    providerRawErrorSummary,
    safeRetry:
      retryExecutor === "orchestrator"
        ? {
            strategy: "policy.exponential_backoff",
            executor: "orchestrator",
            maxAttemptsRef: "providerPolicy.moyin.retry.maxAttempts",
            initialDelayMsRef: "providerPolicy.moyin.retry.initialDelayMs",
          }
        : {
            strategy: "manual",
            executor: "operator",
            instruction: input.retryInstruction ?? "Check Moyin state and retry manually.",
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
    diagnostics: {
      provider: "moyin",
      rawSummaryHash: createMoyinErrorSummaryHash(providerRawErrorSummary),
      redacted: true,
      suggestedOwner: retryExecutor,
    },
  };
}

function createMoyinCommandArgs(
  operation: MoyinProviderOperation,
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  switch (operation) {
    case "health":
      return ["status", "--json"];
    case "capabilities.handshake":
      return ["status", "--json"];
    case "adapter.resolve":
      return createMoyinAdapterResolveArgs(args);
    case "adapter.script-execution":
      return createMoyinAdapterExecutionArgs("script", args);
    case "adapter.image-execution":
      return createMoyinAdapterExecutionArgs("image", args);
    case "adapter.video-execution":
      return createMoyinAdapterExecutionArgs("video", args);
    case "discover.templates": {
      const panel = readNonEmptyString(args.panel);
      return panel === undefined
        ? ["task", "template", "list", "--json"]
        : ["task", "template", "list", "--panel", panel, "--json"];
    }
    case "discover.projects":
      return ["project", "list", "--json"];
    case "project.list":
      return ["project", "list", "--json"];
    case "project.get":
      return [
        "project",
        "get",
        readRequiredString(args.projectId ?? args.id, "projectId"),
        "--json",
      ];
    case "project.store.get":
      return createMoyinProjectStoreGetArgs(args);
    case "project.create":
      return createMoyinProjectCreateArgs(args);
    case "discover.providers":
      return ["config", "providers", "--json"];
    case "discover.models":
      return ["config", "models", "--json"];
    case "discover.workflows": {
      const projectId = readRequiredString(args.projectId, "projectId");
      return ["workflow", "list", "--project", projectId, "--json"];
    }
    case "sealed.image.preview":
      return createMoyinSealedPreviewArgs("image", args);
    case "sealed.video.preview":
      return createMoyinSealedPreviewArgs("video", args);
    case "sealed.get":
      return [
        "sealed",
        "get",
        readRequiredString(args.sealedRequestId, "sealedRequestId"),
        "--json",
      ];
    case "sealed.submit":
      return [
        "sealed",
        "submit",
        readRequiredString(args.sealedRequestId, "sealedRequestId"),
        "--confirm",
        "SUBMIT",
        "--json",
      ];
    case "task.list":
      return createMoyinTaskListArgs(args);
    case "task.watch":
      return createMoyinTaskWatchArgs(args);
    case "task.cancel":
      return createMoyinTaskCancelArgs(args);
    case "task.submit":
      return createMoyinTaskSubmitArgs(args);
    case "task.template.get":
      return [
        "task",
        "template",
        "get",
        readRequiredString(args.templateId, "templateId"),
        "--json",
      ];
    case "task.template.build":
      return createMoyinTaskTemplateBuildArgs(args);
    case "prompt.schema":
      return ["prompt", "schema", "--json"];
    case "prompt.list":
      return createMoyinPromptListArgs(args);
    case "prompt.create":
      return createMoyinPromptCreateArgs(args);
    case "prompt.resolve":
      return createMoyinPromptResolveArgs(args);
    case "prompt.get":
      return createMoyinPromptGetArgs(args);
    case "prompt.delete":
      return createMoyinPromptDeleteArgs(args);
    case "memory.get":
      return [
        "memory",
        "get",
        "--project",
        readRequiredString(args.projectId, "projectId"),
        "--json",
      ];
    case "memory.upsert":
      return createMoyinMemoryUpsertArgs(args);
    case "memory.diff":
      return createMoyinMemoryReviewArgs("diff", args);
    case "memory.approve":
      return createMoyinMemoryReviewArgs("approve", args);
    case "memory.reject":
      return createMoyinMemoryReviewArgs("reject", args);
    case "artifact.list":
      return createMoyinArtifactListArgs(args);
    case "artifact.get":
      return [
        "artifact",
        "get",
        readRequiredString(args.artifactId, "artifactId"),
        "--project",
        readRequiredString(args.projectId, "projectId"),
        "--json",
      ];
    case "artifact.backfill":
      return createMoyinArtifactBackfillArgs(args);
    case "artifact.attach":
      return createMoyinArtifactAttachArgs(args);
    case "artifact.delete":
      return createMoyinArtifactDeleteArgs(args);
    case "workflow-run.artifacts":
      return createMoyinWorkflowRunArtifactsArgs(args);
    case "workflow-run.list":
      return createMoyinWorkflowRunListArgs(args);
    case "workflow-run.create":
      return createMoyinWorkflowRunCreateArgs(args);
    case "workflow-run.get":
      return createMoyinWorkflowRunGetArgs(args);
    case "workflow-run.steps":
      return createMoyinWorkflowRunStepsArgs(args);
    case "workflow-run.advance":
      return createMoyinWorkflowRunAdvanceArgs(args);
    case "workflow-run.attach-artifact":
      return createMoyinWorkflowRunAttachArtifactArgs(args);
    case "workflow-run.cancel":
      return createMoyinWorkflowRunCancelArgs(args);
    case "workflow.draft":
      return [];
    case "workflow.schema":
      return ["workflow", "schema", "--json"];
    case "workflow.list":
      return [
        "workflow",
        "list",
        "--project",
        readRequiredString(args.projectId, "projectId"),
        "--json",
      ];
    case "workflow.create":
      return createMoyinWorkflowCreateArgs(args);
    case "workflow.export":
      return createMoyinWorkflowExportArgs(args);
    case "workflow.get":
      return createMoyinWorkflowGetArgs(args);
    case "workflow.build":
      return createMoyinWorkflowBuildArgs(args);
    case "workflow.import":
      return createMoyinWorkflowImportArgs(args);
    case "workflow.validate":
      return createMoyinWorkflowValidateArgs(args);
    case "workflow.delete":
      return createMoyinWorkflowDeleteArgs(args);
  }
}

async function createMoyinPreparedCommand(
  operation: MoyinProviderOperation,
  args: Readonly<Record<string, unknown>>,
): Promise<MoyinPreparedCommand> {
  if (
    (operation === "sealed.image.preview" || operation === "sealed.video.preview") &&
    readNonEmptyString(args.file ?? args.requestPath) === undefined
  ) {
    const requestJson = readOptionalRecord(args.requestJson ?? args.request ?? args.sealedRequest);
    if (requestJson !== undefined) {
      return createMoyinPreparedSealedPreviewCommand(
        operation === "sealed.image.preview" ? "image" : "video",
        args,
        requestJson,
      );
    }
  }
  return { args: createMoyinCommandArgs(operation, args) };
}

async function createMoyinPreparedSealedPreviewCommand(
  mediaKind: "image" | "video",
  args: Readonly<Record<string, unknown>>,
  requestJson: Readonly<Record<string, unknown>>,
): Promise<MoyinPreparedCommand> {
  const scratchRoot = readNonEmptyString(args.scratchDir) ?? tmpdir();
  const workDir = await mkdtemp(join(scratchRoot, "director-moyin-preview-"));
  const requestPath = join(workDir, "request.json");
  const previewPath =
    readNonEmptyString(args.out ?? args.outputPath ?? args.previewPath) ??
    join(workDir, "preview.json");
  await writeFile(requestPath, `${JSON.stringify(requestJson, null, 2)}\n`, "utf-8");
  return {
    args: ["sealed", mediaKind, "--file", requestPath, "--out", previewPath, "--json"],
    metadata: {
      preparedRequest: {
        source: "requestJson",
        requestPath,
        previewPath,
        scratchDir: workDir,
      },
    },
  };
}

function normalizeMoyinOperation(operationId: string | undefined): MoyinProviderOperation | null {
  const normalized = (operationId ?? "health").trim();
  if (isMoyinProviderOperation(normalized)) {
    return normalized;
  }
  return null;
}

function isMoyinProviderOperation(value: string): value is MoyinProviderOperation {
  return (
    value === "health" ||
    value === "capabilities.handshake" ||
    value === "adapter.resolve" ||
    value === "adapter.script-execution" ||
    value === "adapter.image-execution" ||
    value === "adapter.video-execution" ||
    value === "discover.templates" ||
    value === "discover.projects" ||
    value === "project.list" ||
    value === "project.get" ||
    value === "project.store.get" ||
    value === "project.create" ||
    value === "discover.providers" ||
    value === "discover.models" ||
    value === "discover.workflows" ||
    value === "sealed.image.preview" ||
    value === "sealed.video.preview" ||
    value === "sealed.get" ||
    value === "sealed.submit" ||
    value === "task.list" ||
    value === "task.watch" ||
    value === "task.cancel" ||
    value === "task.submit" ||
    value === "task.template.get" ||
    value === "task.template.build" ||
    value === "prompt.schema" ||
    value === "prompt.list" ||
    value === "prompt.create" ||
    value === "prompt.resolve" ||
    value === "prompt.get" ||
    value === "prompt.delete" ||
    value === "memory.get" ||
    value === "memory.upsert" ||
    value === "memory.diff" ||
    value === "memory.approve" ||
    value === "memory.reject" ||
    value === "artifact.list" ||
    value === "artifact.get" ||
    value === "artifact.backfill" ||
    value === "artifact.attach" ||
    value === "artifact.delete" ||
    value === "workflow-run.artifacts" ||
    value === "workflow-run.list" ||
    value === "workflow-run.create" ||
    value === "workflow-run.get" ||
    value === "workflow-run.steps" ||
    value === "workflow-run.advance" ||
    value === "workflow-run.attach-artifact" ||
    value === "workflow-run.cancel" ||
    value === "workflow.draft" ||
    value === "workflow.schema" ||
    value === "workflow.list" ||
    value === "workflow.create" ||
    value === "workflow.export" ||
    value === "workflow.get" ||
    value === "workflow.build" ||
    value === "workflow.import" ||
    value === "workflow.validate" ||
    value === "workflow.delete"
  );
}

function createMoyinAdapterResolveArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = [
    "adapter",
    "resolve",
    "--panel",
    readRequiredString(args.panel, "panel"),
    "--media",
    readRequiredString(args.media, "media"),
  ];
  appendOptionalArg(commandArgs, "--feature", args.feature);
  appendOptionalArg(commandArgs, "--model", args.model);
  appendOptionalArg(commandArgs, "--provider", args.provider ?? args.providerId);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinAdapterExecutionArgs(
  mediaKind: "image" | "script" | "video",
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  const commandArgs = [
    "adapter",
    `${mediaKind}-execution`,
    "--file",
    readRequiredString(args.file ?? args.requestPath, "file"),
  ];
  appendOptionalArg(commandArgs, "--out", args.out ?? args.outputPath ?? args.draftPath);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinSealedPreviewArgs(
  mediaKind: "image" | "video",
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  const commandArgs = [
    "sealed",
    mediaKind,
    "--file",
    readRequiredString(args.file ?? args.requestPath, "file"),
  ];
  const out = readNonEmptyString(args.out);
  if (out !== undefined) {
    commandArgs.push("--out", out);
  }
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinTaskListArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = ["task", "list"];
  appendOptionalArg(commandArgs, "--project", args.projectId);
  appendOptionalArg(commandArgs, "--status", args.status);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinProjectCreateArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const projectName = readRequiredString(args.name ?? args.projectName, "name");
  const commandArgs = ["project", "create", "--name", projectName];
  appendOptionalBooleanArg(commandArgs, "--set-active", args.setActive ?? args.active);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinProjectStoreGetArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [
    "project",
    "store",
    "get",
    "--project",
    readRequiredString(args.projectId ?? args.id, "projectId"),
    "--store",
    readRequiredString(args.storeName ?? args.store, "storeName"),
    "--json",
  ];
}

function createMoyinTaskTemplateBuildArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  const commandArgs = [
    "task",
    "template",
    "build",
    readRequiredString(args.templateId, "templateId"),
  ];
  appendOptionalArg(commandArgs, "--project", args.projectId);
  appendOptionalArg(commandArgs, "--values", args.values ?? args.valuesPath);
  appendOptionalArg(commandArgs, "--overrides", args.overrides ?? args.overridesPath);
  appendOptionalArg(commandArgs, "--out", args.out ?? args.outputPath ?? args.requestPath);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinTaskWatchArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = ["task", "watch"];
  const taskId = readNonEmptyString(args.taskId);
  if (taskId !== undefined) {
    commandArgs.push(taskId);
  }
  const projectId = readNonEmptyString(args.projectId);
  if (projectId !== undefined) {
    commandArgs.push("--project", projectId);
  }
  commandArgs.push("--json");
  return commandArgs;
}

function resolveMoyinCommandTimeoutMs(
  defaultTimeoutMs: number,
  operation: MoyinProviderOperation,
  args: Readonly<Record<string, unknown>>,
): number {
  if (operation !== "task.watch") {
    return defaultTimeoutMs;
  }
  return (
    readPositiveNumber(args.timeoutMs) ??
    readPositiveNumber(args.watchTimeoutMs) ??
    defaultTimeoutMs
  );
}

function createMoyinTaskCancelArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = ["task", "cancel", readRequiredString(args.taskId, "taskId")];
  appendOptionalArg(commandArgs, "--project", args.projectId);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinTaskSubmitArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return [
    "task",
    "submit",
    "--file",
    readRequiredString(args.file ?? args.requestPath, "file"),
    "--json",
  ];
}

function createMoyinPromptListArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return ["prompt", "list", "--project", readRequiredString(args.projectId, "projectId"), "--json"];
}

function createMoyinPromptCreateArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = [
    "prompt",
    "create",
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--base",
    readRequiredString(args.base ?? args.baseId, "base"),
  ];
  appendOptionalArg(commandArgs, "--text", args.text ?? args.textPath);
  appendOptionalArg(commandArgs, "--overlay", args.overlay ?? args.overlayPath);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinPromptResolveArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = [
    "prompt",
    "resolve",
    "--project",
    readRequiredString(args.projectId, "projectId"),
  ];
  appendOptionalArg(commandArgs, "--snapshot", args.snapshot ?? args.snapshotId);
  appendOptionalArg(commandArgs, "--base-text", args.baseText ?? args.baseTextPath);
  appendOptionalArg(commandArgs, "--overlay", args.overlay ?? args.overlayPath);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinPromptGetArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return [
    "prompt",
    "get",
    readRequiredString(args.snapshotId, "snapshotId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function createMoyinPromptDeleteArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return [
    "prompt",
    "delete",
    readRequiredString(args.snapshotId, "snapshotId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function createMoyinMemoryUpsertArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = [
    "memory",
    "upsert",
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--file",
    readRequiredString(args.file ?? args.entriesPath, "file"),
  ];
  appendOptionalBooleanArg(commandArgs, "--replace", args.replace);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinMemoryReviewArgs(
  action: "diff" | "approve" | "reject",
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  const commandArgs = [
    "memory",
    action,
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--run",
    readRequiredString(args.runId, "runId"),
  ];
  appendOptionalArg(commandArgs, "--reviewer", args.reviewer);
  appendOptionalArg(commandArgs, "--note", args.note);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinArtifactListArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = [
    "artifact",
    "list",
    "--project",
    readRequiredString(args.projectId, "projectId"),
  ];
  appendOptionalArg(commandArgs, "--run", args.runId);
  appendOptionalArg(commandArgs, "--step", args.stepId);
  appendOptionalArg(commandArgs, "--type", args.type);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinArtifactBackfillArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  const commandArgs = [
    "artifact",
    "backfill",
    "--project",
    readRequiredString(args.projectId, "projectId"),
  ];
  appendOptionalArg(commandArgs, "--task", args.taskId);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinArtifactAttachArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = [
    "artifact",
    "attach",
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--file",
    readRequiredString(args.file ?? args.artifactsPath, "file"),
  ];
  appendOptionalArg(commandArgs, "--run", args.runId);
  appendOptionalArg(commandArgs, "--step", args.stepId);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinArtifactDeleteArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return [
    "artifact",
    "delete",
    readRequiredString(args.artifactId, "artifactId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function createMoyinWorkflowRunArtifactsArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  const commandArgs = [
    "workflow-run",
    "artifacts",
    readRequiredString(args.runId, "runId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
  ];
  appendOptionalArg(commandArgs, "--step", args.stepId);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinWorkflowRunListArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [
    "workflow-run",
    "list",
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function createMoyinWorkflowRunCreateArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [
    "workflow-run",
    "create",
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--file",
    readRequiredString(args.file ?? args.runPath ?? args.workflowRunPath, "file"),
    "--json",
  ];
}

function createMoyinWorkflowRunGetArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return [
    "workflow-run",
    "get",
    readRequiredString(args.runId, "runId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function createMoyinWorkflowRunStepsArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [
    "workflow-run",
    "steps",
    readRequiredString(args.runId, "runId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function createMoyinWorkflowRunAdvanceArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  const commandArgs = [
    "workflow-run",
    "advance",
    readRequiredString(args.runId, "runId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--step",
    readRequiredString(args.stepId, "stepId"),
    "--action",
    readRequiredString(args.action, "action"),
  ];
  appendOptionalArg(commandArgs, "--file", args.file ?? args.values ?? args.valuesPath);
  appendOptionalArg(commandArgs, "--confirm", args.confirmSubmit ?? args.confirm);
  appendOptionalArg(commandArgs, "--execution", args.execution ?? args.executionPath);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinWorkflowRunAttachArtifactArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [
    "workflow-run",
    "attach-artifact",
    readRequiredString(args.runId, "runId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--step",
    readRequiredString(args.stepId, "stepId"),
    "--file",
    readRequiredString(args.file ?? args.artifactsPath, "file"),
    "--json",
  ];
}

function createMoyinWorkflowRunCancelArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [
    "workflow-run",
    "cancel",
    readRequiredString(args.runId, "runId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function createMoyinWorkflowExportArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = [
    "workflow-run",
    "export",
    readRequiredString(args.runId, "runId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--target",
    readRequiredString(args.target, "target"),
  ];
  appendOptionalArg(commandArgs, "--out", args.out ?? args.outputPath);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinWorkflowCreateArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return [
    "workflow",
    "create",
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--file",
    readRequiredString(args.file ?? args.workflowPath, "file"),
    "--json",
  ];
}

function createMoyinWorkflowGetArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return [
    "workflow",
    "get",
    readRequiredString(args.workflowId, "workflowId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function createMoyinWorkflowBuildArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  const commandArgs = [
    "workflow",
    "build",
    readRequiredString(args.workflowId, "workflowId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
  ];
  appendOptionalArg(commandArgs, "--values", args.values ?? args.valuesPath);
  appendOptionalArg(commandArgs, "--overrides", args.overrides ?? args.overridesPath);
  appendOptionalArg(commandArgs, "--out-dir", args.outDir ?? args.outputDir);
  commandArgs.push("--json");
  return commandArgs;
}

function createMoyinWorkflowImportArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return createMoyinWorkflowCreateArgs(args);
}

function createMoyinWorkflowValidateArgs(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [
    "workflow",
    "validate",
    readRequiredString(args.workflowId, "workflowId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function createMoyinWorkflowDeleteArgs(args: Readonly<Record<string, unknown>>): readonly string[] {
  return [
    "workflow",
    "delete",
    readRequiredString(args.workflowId, "workflowId"),
    "--project",
    readRequiredString(args.projectId, "projectId"),
    "--json",
  ];
}

function appendOptionalArg(commandArgs: string[], flag: string, value: unknown): void {
  const item = readNonEmptyString(value);
  if (item !== undefined) {
    commandArgs.push(flag, item);
  }
}

function appendOptionalBooleanArg(commandArgs: string[], flag: string, value: unknown): void {
  if (value === true) {
    commandArgs.push(flag);
  }
}

function createMoyinSuccessSummary(operation: MoyinProviderOperation, payload: unknown): string {
  const count = readPayloadItemsCount(payload);
  if (operation === "health") {
    return "Moyin CLI/control-plane is ready.";
  }
  if (operation === "adapter.resolve") {
    return "Moyin adapter resolved.";
  }
  if (operation === "adapter.script-execution") {
    return "Moyin script execution draft built.";
  }
  if (operation === "adapter.image-execution") {
    return "Moyin image execution draft built.";
  }
  if (operation === "adapter.video-execution") {
    return "Moyin video execution draft built.";
  }
  if (operation === "discover.templates") {
    return count === undefined ? "Moyin task templates discovered." : `Moyin templates: ${count}.`;
  }
  if (operation === "discover.projects") {
    return count === undefined ? "Moyin projects discovered." : `Moyin projects: ${count}.`;
  }
  if (operation === "project.list") {
    return count === undefined ? "Moyin projects discovered." : `Moyin projects: ${count}.`;
  }
  if (operation === "project.get") {
    return "Moyin project retrieved.";
  }
  if (operation === "project.store.get") {
    return "Moyin project store retrieved.";
  }
  if (operation === "project.create") {
    return "Moyin project created.";
  }
  if (operation === "discover.providers") {
    return "Moyin providers discovered.";
  }
  if (operation === "discover.models") {
    return "Moyin models discovered.";
  }
  if (operation === "discover.workflows") {
    return count === undefined ? "Moyin workflows discovered." : `Moyin workflows: ${count}.`;
  }
  if (operation === "sealed.image.preview") {
    return "Moyin sealed image preview created.";
  }
  if (operation === "sealed.video.preview") {
    return "Moyin sealed video preview created.";
  }
  if (operation === "sealed.get") {
    return "Moyin sealed request retrieved.";
  }
  if (operation === "sealed.submit") {
    return "Moyin sealed request submitted.";
  }
  if (operation === "task.list") {
    return count === undefined ? "Moyin tasks discovered." : `Moyin tasks: ${count}.`;
  }
  if (operation === "task.watch") {
    return "Moyin task watch completed.";
  }
  if (operation === "task.cancel") {
    return "Moyin task cancelled.";
  }
  if (operation === "task.submit") {
    return "Moyin task submitted.";
  }
  if (operation === "task.template.get") {
    return "Moyin task template retrieved.";
  }
  if (operation === "task.template.build") {
    return "Moyin task request built.";
  }
  if (operation === "prompt.schema") {
    return "Moyin prompt schema retrieved.";
  }
  if (operation === "prompt.list") {
    return count === undefined
      ? "Moyin prompt snapshots discovered."
      : `Moyin prompt snapshots: ${count}.`;
  }
  if (operation === "prompt.create") {
    return "Moyin prompt snapshot created.";
  }
  if (operation === "prompt.resolve") {
    return "Moyin prompt snapshot resolved.";
  }
  if (operation === "prompt.get") {
    return "Moyin prompt snapshot retrieved.";
  }
  if (operation === "prompt.delete") {
    return "Moyin prompt snapshot deleted.";
  }
  if (operation === "memory.get") {
    return "Moyin project memory retrieved.";
  }
  if (operation === "memory.upsert") {
    return "Moyin memory upsert completed.";
  }
  if (operation === "memory.diff") {
    return "Moyin memory diff retrieved.";
  }
  if (operation === "memory.approve") {
    return "Moyin memory draft approved.";
  }
  if (operation === "memory.reject") {
    return "Moyin memory draft rejected.";
  }
  if (operation === "artifact.list") {
    return count === undefined ? "Moyin artifacts discovered." : `Moyin artifacts: ${count}.`;
  }
  if (operation === "artifact.get") {
    return "Moyin artifact retrieved.";
  }
  if (operation === "artifact.backfill") {
    return count === undefined
      ? "Moyin artifact backfill completed."
      : `Moyin artifact backfill recovered ${count} artifact${count === 1 ? "" : "s"}.`;
  }
  if (operation === "artifact.attach") {
    return "Moyin artifact attached.";
  }
  if (operation === "artifact.delete") {
    return "Moyin artifact deleted.";
  }
  if (operation === "workflow-run.artifacts") {
    return count === undefined
      ? "Moyin workflow run artifacts discovered."
      : `Moyin workflow run artifacts: ${count}.`;
  }
  if (operation === "workflow-run.list") {
    return count === undefined
      ? "Moyin workflow runs discovered."
      : `Moyin workflow runs: ${count}.`;
  }
  if (operation === "workflow-run.create") {
    return "Moyin workflow run created.";
  }
  if (operation === "workflow-run.get") {
    return "Moyin workflow run retrieved.";
  }
  if (operation === "workflow-run.steps") {
    return "Moyin workflow run steps retrieved.";
  }
  if (operation === "workflow-run.advance") {
    return "Moyin workflow run advanced.";
  }
  if (operation === "workflow-run.attach-artifact") {
    return "Moyin workflow run artifact attached.";
  }
  if (operation === "workflow-run.cancel") {
    return "Moyin workflow run cancelled.";
  }
  if (operation === "workflow.schema") {
    return "Moyin workflow schema retrieved.";
  }
  if (operation === "workflow.list") {
    return count === undefined ? "Moyin workflows discovered." : `Moyin workflows: ${count}.`;
  }
  if (operation === "workflow.create") {
    return "Moyin workflow created.";
  }
  if (operation === "workflow.export") {
    return "Moyin workflow export completed.";
  }
  if (operation === "workflow.get") {
    return "Moyin workflow retrieved.";
  }
  if (operation === "workflow.build") {
    return "Moyin workflow build completed.";
  }
  if (operation === "workflow.import") {
    return "Moyin workflow import completed.";
  }
  if (operation === "workflow.validate") {
    return "Moyin workflow validate completed.";
  }
  if (operation === "workflow.delete") {
    return "Moyin workflow deleted.";
  }
  return `Moyin ${operation} completed.`;
}

function createMoyinProviderEvents(
  operation: MoyinProviderOperation,
  args: Readonly<Record<string, unknown>>,
  payload: unknown,
): readonly Readonly<Record<string, unknown>>[] {
  if (operation === "workflow-run.advance") {
    return createMoyinWorkflowRunAdvanceEvents(args, payload);
  }
  if (operation !== "task.cancel" && operation !== "workflow-run.cancel") {
    return [];
  }
  const record = isRecord(payload) ? payload : {};
  const taskId =
    operation === "task.cancel"
      ? (readRecordString(record, "taskId") ?? readNonEmptyString(args.taskId))
      : readRecordString(record, "taskId");
  const runId =
    operation === "workflow-run.cancel"
      ? (readRecordString(record, "runId") ?? readNonEmptyString(args.runId))
      : readRecordString(record, "runId");
  return [
    {
      kind: "external.provider.cancelled",
      providerId: "moyin",
      toolId: "moyin.provider",
      operationId: operation,
      status: readRecordString(record, "status") ?? "cancelled",
      ...optionalStringField(
        "projectId",
        readRecordString(record, "projectId") ?? readNonEmptyString(args.projectId),
      ),
      ...optionalStringField("taskId", taskId),
      ...optionalStringField("runId", runId),
      ...optionalStringField(
        "reason",
        readRecordString(record, "reason") ?? readNonEmptyString(args.reason),
      ),
    },
  ];
}

function createMoyinWorkflowRunAdvanceEvents(
  args: Readonly<Record<string, unknown>>,
  payload: unknown,
): readonly Readonly<Record<string, unknown>>[] {
  const record = isRecord(payload) ? payload : {};
  const step = isRecord(record.step) ? record.step : {};
  const warnings = readStringArray(record.warnings ?? step.warnings);
  const artifacts = extractMoyinWorkflowRunArtifacts(payload);
  return [
    {
      kind: "external.provider.workflow_run_advanced",
      providerId: "moyin",
      toolId: "moyin.provider",
      operationId: "workflow-run.advance",
      ...optionalStringField(
        "projectId",
        readRecordString(record, "projectId") ?? readNonEmptyString(args.projectId),
      ),
      ...optionalStringField(
        "runId",
        readRecordString(record, "runId") ?? readNonEmptyString(args.runId),
      ),
      ...optionalStringField(
        "stepId",
        readRecordString(record, "stepId") ??
          readRecordString(step, "stepId") ??
          readNonEmptyString(args.stepId),
      ),
      ...optionalStringField(
        "action",
        readRecordString(record, "action") ?? readNonEmptyString(args.action),
      ),
      ...optionalStringField(
        "status",
        readRecordString(record, "status") ?? readRecordString(step, "status"),
      ),
      ...optionalStringField(
        "sealedRequestId",
        readRecordString(record, "sealedRequestId") ?? readRecordString(step, "sealedRequestId"),
      ),
      ...optionalStringField(
        "taskId",
        readRecordString(record, "taskId") ?? readRecordString(step, "taskId"),
      ),
      ...(warnings.length === 0 ? {} : { warnings }),
      ...(artifacts.length === 0 ? {} : { artifactCount: artifacts.length }),
    },
  ];
}

function createMoyinWorkflowDraftFromArgs(args: Readonly<Record<string, unknown>>): {
  readonly schemaVersion: "director.moyin-workflow-draft.v1";
  readonly status: "draft";
  readonly executable: false;
  readonly workflow: Readonly<Record<string, unknown>>;
  readonly interopPackage: ReturnType<typeof createWorkflowInteropPackage>;
  readonly conversion: ReturnType<typeof createWorkflowInteropPackage>["conversion"];
  readonly nextActions: readonly string[];
  readonly artifacts: readonly ExternalToolArtifact[];
} {
  const projectId = readRequiredString(args.projectId, "projectId");
  const workflowJson = readRequiredRecord(
    args.workflowJson ?? args.comfyuiWorkflow,
    "workflowJson",
  );
  const workflowId = readNonEmptyString(args.workflowId) ?? `comfyui-draft-${projectId}`;
  const graph = createMoyinDraftGraphFromComfyUiWorkflow(workflowJson);
  const missingDependencies = readStringArray(args.missingDependencies);
  const unmappedFields = [
    ...readStringArray(args.unmappedFields),
    ...inferMoyinDraftUnmappedFields(workflowJson),
  ];
  const interopPackage = createWorkflowInteropPackage({
    id: `${workflowId}-interop`,
    source: {
      provider: "comfyui",
      format: "comfyui.api-workflow",
      ...optionalStringField("uri", readNonEmptyString(args.workflowPath)),
    },
    target: {
      provider: "moyin",
      format: "moyin.workflow.draft",
    },
    graph,
    artifacts: createMoyinDraftInteropArtifacts(args),
    conversion: {
      executable: false,
      lossiness:
        missingDependencies.length === 0 && unmappedFields.length === 0 ? "lossless" : "lossy",
      unmappedFields,
      missingDependencies,
      logs: [
        "ComfyUI API workflow converted to Moyin draft workflow package; validate before import.",
      ],
    },
    metadata: {
      projectId,
      workflowId,
      sourceProvider: "comfyui",
    },
  });
  return {
    schemaVersion: "director.moyin-workflow-draft.v1",
    status: "draft",
    executable: false,
    workflow: {
      schemaVersion: "moyin.workflow.draft.v1",
      id: workflowId,
      projectId,
      source: {
        provider: "comfyui",
        format: "comfyui.api-workflow",
      },
      nodes: graph.nodes,
      edges: graph.edges,
      executable: false,
      validationRequired: true,
    },
    interopPackage,
    conversion: interopPackage.conversion,
    nextActions: [
      "Write this draft package to a file only after operator approval.",
      "Import through workflow.import, which remains approval-gated.",
      "Run workflow.validate before any Moyin workflow execution.",
    ],
    artifacts: createMoyinDraftExternalArtifacts(interopPackage),
  };
}

function createMoyinDraftGraphFromComfyUiWorkflow(
  workflowJson: Readonly<Record<string, unknown>>,
): {
  readonly nodes: readonly WorkflowInteropNode[];
  readonly edges: readonly WorkflowInteropEdge[];
} {
  const nodes = Object.entries(workflowJson).flatMap(([id, value]): WorkflowInteropNode[] => {
    if (!isRecord(value)) {
      return [];
    }
    const classType = readRecordString(value, "class_type") ?? "UnknownComfyUINode";
    return [
      {
        id,
        kind: classType,
        label: classType,
        payload: value,
      },
    ];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Object.entries(workflowJson).flatMap(([to, value]): WorkflowInteropEdge[] => {
    if (!isRecord(value) || !isRecord(value.inputs)) {
      return [];
    }
    return Object.entries(value.inputs).flatMap(([label, input]): WorkflowInteropEdge[] => {
      if (!Array.isArray(input) || typeof input[0] !== "string" || !nodeIds.has(input[0])) {
        return [];
      }
      return [{ from: input[0], to, label }];
    });
  });
  return { nodes, edges };
}

function inferMoyinDraftUnmappedFields(
  workflowJson: Readonly<Record<string, unknown>>,
): readonly string[] {
  const fields: string[] = [];
  for (const [nodeId, node] of Object.entries(workflowJson)) {
    if (!isRecord(node)) {
      continue;
    }
    const classType = readRecordString(node, "class_type") ?? "unknown";
    if (classType.includes("KSampler") || classType.includes("Sampler")) {
      fields.push(`node.${nodeId}.sampler.runtime`);
    }
  }
  return [...new Set(fields)];
}

function createMoyinDraftInteropArtifacts(
  args: Readonly<Record<string, unknown>>,
): readonly WorkflowInteropArtifact[] {
  const workflowPath = readNonEmptyString(args.workflowPath);
  return workflowPath === undefined
    ? []
    : [
        {
          id: "comfyui-api-workflow",
          kind: "json",
          localPath: workflowPath,
        },
      ];
}

function createMoyinDraftExternalArtifacts(
  interopPackage: ReturnType<typeof createWorkflowInteropPackage>,
): readonly ExternalToolArtifact[] {
  return interopPackage.artifacts.map((artifact) => ({
    id: `moyin-draft-${artifact.id}`,
    kind: artifact.kind,
    ...(artifact.localPath === undefined ? {} : { path: artifact.localPath }),
    ...(artifact.uri === undefined ? {} : { url: artifact.uri }),
    metadata: {
      provider: "moyin",
      role: "workflow-draft-source",
      sourcePackageId: interopPackage.id,
      sourceArtifactId: artifact.id,
      ...(artifact.metadata ?? {}),
    },
  }));
}

async function createMoyinResultBudgetedOutput(input: {
  readonly operation: MoyinProviderOperation;
  readonly output: unknown;
  readonly requestMetadata: Readonly<Record<string, unknown>> | undefined;
}): Promise<{
  readonly output: unknown;
  readonly artifacts: readonly ExternalToolArtifact[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}> {
  const resultBudget = readMoyinResultBudget(input.requestMetadata);
  if (resultBudget === undefined) {
    return { output: input.output, artifacts: [] };
  }
  const serialized = JSON.stringify(input.output, null, 2);
  if (serialized.length <= resultBudget.maxInlineOutputChars) {
    return {
      output: input.output,
      artifacts: [],
      metadata: {
        resultBudget: {
          applied: false,
          maxInlineOutputChars: resultBudget.maxInlineOutputChars,
          originalSizeChars: serialized.length,
        },
      },
    };
  }
  const artifact = await writeMoyinResultBudgetArtifact({
    operation: input.operation,
    serialized,
  });
  const preview = serialized.slice(0, resultBudget.maxInlineOutputChars);
  return {
    output: {
      schemaVersion: "director.moyin.output-preview.v1",
      truncated: true,
      preview,
      originalSizeChars: serialized.length,
      artifactRef: {
        id: artifact.id,
        kind: artifact.kind,
        ...(artifact.path === undefined ? {} : { path: artifact.path }),
      },
    },
    artifacts: [artifact],
    metadata: {
      resultBudget: {
        applied: true,
        maxInlineOutputChars: resultBudget.maxInlineOutputChars,
        originalSizeChars: serialized.length,
        previewSizeChars: preview.length,
        artifactId: artifact.id,
      },
    },
  };
}

async function writeMoyinResultBudgetArtifact(input: {
  readonly operation: MoyinProviderOperation;
  readonly serialized: string;
}): Promise<ExternalToolArtifact> {
  const hash = createHash("sha256").update(input.serialized).digest("hex").slice(0, 12);
  const safeOperation = input.operation.replace(/[^a-z0-9.-]/gi, "-");
  const artifactId = `moyin-result-${safeOperation}-${hash}`;
  const directory = await mkdtemp(join(tmpdir(), "director-angel-moyin-result-"));
  const filePath = join(directory, `${artifactId}.json`);
  await writeFile(filePath, input.serialized, "utf8");
  return {
    id: artifactId,
    kind: "json",
    path: filePath,
    metadata: {
      provider: "moyin",
      role: "moyin-result-output",
      operationId: input.operation,
      retention: MOYIN_RESULT_BUDGET_ARTIFACT_RETENTION,
      sensitivity: MOYIN_RESULT_BUDGET_ARTIFACT_SENSITIVITY,
      cleanupPolicyRef: MOYIN_RESULT_BUDGET_ARTIFACT_CLEANUP_POLICY,
      lifecycle: {
        owner: "director-angel",
        sourceOfTruth: "conversation-runtime",
        storage: "ephemeral-result-budget-artifact",
      },
    },
  };
}

function readMoyinResultBudget(
  metadata: Readonly<Record<string, unknown>> | undefined,
): { readonly maxInlineOutputChars: number } | undefined {
  if (metadata === undefined || !isRecord(metadata.resultBudget)) {
    return undefined;
  }
  const maxInlineOutputChars = metadata.resultBudget.maxInlineOutputChars;
  return typeof maxInlineOutputChars === "number" &&
    Number.isFinite(maxInlineOutputChars) &&
    maxInlineOutputChars > 0
    ? { maxInlineOutputChars: Math.floor(maxInlineOutputChars) }
    : undefined;
}

function redactMoyinProviderValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactMoyinProviderValue(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isMoyinSensitiveFieldName(key) ? "[redacted]" : redactMoyinProviderValue(item),
    ]),
  );
}

function isMoyinSensitiveFieldName(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return (
    normalized === "token" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken" ||
    normalized === "idtoken" ||
    normalized === "bearertoken" ||
    normalized === "authorization" ||
    normalized === "apikey" ||
    normalized === "password" ||
    normalized === "secret" ||
    normalized === "clientsecret"
  );
}

function createMoyinProviderOutput(
  operation: MoyinProviderOperation,
  args: Readonly<Record<string, unknown>>,
  payload: unknown,
): unknown {
  if (isMoyinWorkflowRunOrchestrationOperation(operation)) {
    return createMoyinWorkflowRunOperationOutput(args, payload);
  }
  if (isMoyinBuildReadinessOperation(operation) && isRecord(payload)) {
    return createMoyinBuildOperationOutput(payload);
  }
  if (operation !== "workflow.export") {
    return payload;
  }
  return {
    payload,
    interopPackage: createMoyinWorkflowInteropPackage(args, payload),
  };
}

function createMoyinTaskWatchOutputFromNdjson(payload: unknown): Readonly<Record<string, unknown>> {
  const events = Array.isArray(payload) ? payload.filter(isRecord) : [];
  const lastTask = [...events].reverse().flatMap((event) => {
    const eventPayload = isRecord(event.payload) ? event.payload : undefined;
    const task = isRecord(eventPayload?.task)
      ? eventPayload.task
      : isRecord(event.task)
        ? event.task
        : undefined;
    return task === undefined ? [] : [task];
  })[0];
  if (lastTask === undefined) {
    return {
      events,
      eventCount: events.length,
    };
  }
  return {
    ...lastTask,
    payload: lastTask,
    events,
    eventCount: events.length,
    ...optionalStringField(
      "taskId",
      readRecordString(lastTask, "taskId") ?? readRecordString(lastTask, "id"),
    ),
  };
}

function createMoyinBuildOperationOutput(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const missing = readMoyinReadinessStrings(payload.missing, payload.missingRequired);
  const blockers = readMoyinReadinessStrings(payload.blockers, payload.blockingIssues);
  const warnings = readStringArray(payload.warnings);
  return {
    ...payload,
    payload,
    readiness: {
      executable: payload.executable === true,
      valid: !(payload.valid === false || payload.ok === false),
      missing,
      blockers,
      warnings,
    },
  };
}

function isMoyinWorkflowRunOrchestrationOperation(operation: MoyinProviderOperation): boolean {
  return (
    operation === "workflow-run.create" ||
    operation === "workflow-run.get" ||
    operation === "workflow-run.steps" ||
    operation === "workflow-run.advance"
  );
}

function createMoyinWorkflowRunOperationOutput(
  args: Readonly<Record<string, unknown>>,
  payload: unknown,
): Readonly<Record<string, unknown>> {
  const record = isRecord(payload) ? payload : {};
  const step = readMoyinWorkflowRunStep(record.step ?? record.currentStep);
  const steps = readMoyinWorkflowRunSteps(record.items ?? record.steps);
  const warnings = readStringArray(record.warnings);
  const artifacts = extractMoyinWorkflowRunArtifacts(payload);
  return {
    payload,
    ...optionalStringField(
      "projectId",
      readRecordString(record, "projectId") ?? readNonEmptyString(args.projectId),
    ),
    ...optionalStringField(
      "runId",
      readRecordString(record, "runId") ?? readNonEmptyString(args.runId),
    ),
    ...optionalStringField("status", readRecordString(record, "status")),
    ...optionalStringField(
      "stepId",
      readRecordString(record, "stepId") ??
        (step === undefined ? undefined : readRecordString(step, "stepId")),
    ),
    ...optionalStringField("action", readRecordString(record, "action")),
    ...(step === undefined ? {} : { step }),
    ...(steps.length === 0 ? {} : { steps }),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
  };
}

function readMoyinWorkflowRunSteps(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const step = readMoyinWorkflowRunStep(item);
        return step === undefined ? [] : [step];
      })
    : [];
}

function readMoyinWorkflowRunStep(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const stepId = readRecordString(value, "stepId") ?? readRecordString(value, "id");
  const status = readRecordString(value, "status");
  if (stepId === undefined && status === undefined) {
    return undefined;
  }
  const warnings = readStringArray(value.warnings);
  const artifacts = extractMoyinWorkflowRunArtifacts(value);
  const requiresApproval = readRecordBoolean(value, "requiresApproval");
  const retryable = readRecordBoolean(value, "retryable");
  const attempt = readRecordNumber(value, "attempt");
  const maxAttempts = readRecordNumber(value, "maxAttempts");
  const error = readMoyinWorkflowRunStepError(value.error);
  return {
    ...(stepId === undefined ? {} : { stepId }),
    ...(status === undefined ? {} : { status }),
    ...optionalStringField("action", readRecordString(value, "action")),
    ...optionalStringField("sealedRequestId", readRecordString(value, "sealedRequestId")),
    ...optionalStringField("taskId", readRecordString(value, "taskId")),
    ...optionalBooleanField("requiresApproval", requiresApproval),
    ...optionalBooleanField("retryable", retryable),
    ...(attempt === undefined ? {} : { attempt }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(error === undefined ? {} : { error }),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
    payload: value,
  };
}

function readMoyinWorkflowRunStepError(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const code = readRecordString(value, "code");
  const message = readRecordString(value, "message");
  const recoverable = readRecordBoolean(value, "recoverable");
  if (code === undefined && message === undefined && recoverable === undefined) {
    return undefined;
  }
  return {
    ...optionalStringField("code", code),
    ...optionalStringField("message", message),
    ...optionalBooleanField("recoverable", recoverable),
  };
}

function createMoyinExternalToolArtifactsOutput(
  operation: MoyinProviderOperation,
  payload: unknown,
): { readonly artifacts?: readonly ExternalToolArtifact[] } {
  if (
    operation !== "artifact.list" &&
    operation !== "artifact.get" &&
    operation !== "artifact.backfill" &&
    operation !== "artifact.attach" &&
    operation !== "workflow-run.artifacts" &&
    operation !== "workflow-run.create" &&
    operation !== "workflow-run.steps" &&
    operation !== "workflow-run.advance" &&
    operation !== "workflow-run.attach-artifact" &&
    operation !== "workflow.export"
  ) {
    return {};
  }
  const artifacts = isMoyinWorkflowRunOrchestrationOperation(operation)
    ? extractMoyinWorkflowRunArtifacts(payload)
    : extractMoyinExternalToolArtifacts(payload);
  return artifacts.length === 0 ? {} : { artifacts };
}

function createMoyinWorkflowInteropPackage(
  args: Readonly<Record<string, unknown>>,
  payload: unknown,
) {
  const record = isRecord(payload) ? payload : {};
  const projectId = readRequiredString(args.projectId, "projectId");
  const runId = readRequiredString(args.runId, "runId");
  const target = readRequiredString(args.target, "target");
  const graph = readMoyinInteropGraph(record.workflow ?? record.graph);
  const artifacts = extractMoyinInteropArtifacts(record);
  const conversion = readMoyinInteropConversion(record.conversion);
  return createWorkflowInteropPackage({
    id: readRecordString(record, "id") ?? `moyin-${projectId}-${runId}-${target}`,
    source: {
      provider: "moyin",
      format: "moyin.workflow-run.export",
      ...optionalStringField("artifactId", readRecordString(record, "artifactId")),
      ...optionalStringField("uri", readRecordString(record, "packagePath")),
    },
    target: {
      provider: target.startsWith("comfyui") ? "comfyui" : target,
      format: target,
    },
    graph,
    artifacts,
    conversion,
    metadata: {
      projectId,
      runId,
      target,
    },
  });
}

function readMoyinInteropGraph(value: unknown) {
  if (!isRecord(value)) {
    return { nodes: [], edges: [] };
  }
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.flatMap((node) => {
        if (!isRecord(node)) {
          return [];
        }
        const id = readRecordString(node, "id");
        const kind = readRecordString(node, "kind") ?? readRecordString(node, "type");
        if (id === undefined || kind === undefined) {
          return [];
        }
        return [
          {
            id,
            kind,
            ...optionalStringField("label", readRecordString(node, "label")),
            payload: node,
          },
        ];
      })
    : [];
  const edges = Array.isArray(value.edges)
    ? value.edges.flatMap((edge) => {
        if (!isRecord(edge)) {
          return [];
        }
        const from = readRecordString(edge, "from");
        const to = readRecordString(edge, "to");
        if (from === undefined || to === undefined) {
          return [];
        }
        return [{ from, to, ...optionalStringField("label", readRecordString(edge, "label")) }];
      })
    : [];
  return { nodes, edges };
}

function extractMoyinInteropArtifacts(payload: Readonly<Record<string, unknown>>) {
  return extractMoyinExternalToolArtifacts(payload).map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    ...(artifact.url === undefined ? {} : { uri: artifact.url }),
    ...(artifact.path === undefined ? {} : { localPath: artifact.path }),
    ...(artifact.metadata === undefined ? {} : { metadata: artifact.metadata }),
  }));
}

function readMoyinInteropConversion(value: unknown) {
  const record = isRecord(value) ? value : {};
  const lossiness: WorkflowInteropLossiness =
    record.lossiness === "lossless" ||
    record.lossiness === "lossy" ||
    record.lossiness === "unsupported"
      ? record.lossiness
      : "unsupported";
  return {
    executable: record.executable === true,
    lossiness,
    unmappedFields: readStringArray(record.unmappedFields),
    missingDependencies: readStringArray(record.missingDependencies),
    logs: readStringArray(record.logs),
  };
}

function extractMoyinExternalToolArtifacts(payload: unknown): readonly ExternalToolArtifact[] {
  if (!isRecord(payload)) {
    return [];
  }
  const candidates = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.artifacts)
      ? payload.artifacts
      : [payload];
  return candidates.flatMap((item) => {
    const artifact = createMoyinExternalToolArtifact(item);
    return artifact === undefined ? [] : [artifact];
  });
}

function extractMoyinWorkflowRunArtifacts(payload: unknown): readonly ExternalToolArtifact[] {
  if (!isRecord(payload)) {
    return [];
  }
  const artifacts = [
    ...extractMoyinExternalToolArtifacts(payload),
    ...extractMoyinNestedArtifacts(payload.artifacts),
    ...extractMoyinNestedArtifacts(payload.step),
    ...extractMoyinNestedArtifacts(payload.currentStep),
    ...extractMoyinNestedArtifacts(payload.items),
    ...extractMoyinNestedArtifacts(payload.steps),
  ];
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.id)) {
      return false;
    }
    seen.add(artifact.id);
    return true;
  });
}

function extractMoyinNestedArtifacts(value: unknown): readonly ExternalToolArtifact[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractMoyinNestedArtifacts(item));
  }
  if (!isRecord(value)) {
    return [];
  }
  const direct = createMoyinExternalToolArtifact(value);
  const nested = Array.isArray(value.artifacts)
    ? value.artifacts.flatMap((artifact) => {
        const parsed = createMoyinExternalToolArtifact(artifact);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
  return direct === undefined ? nested : [direct, ...nested];
}

function createMoyinExternalToolArtifact(value: unknown): ExternalToolArtifact | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id =
    readRecordString(value, "artifactId") ??
    readRecordString(value, "id") ??
    readRecordString(value, "artifact_id");
  if (id === undefined) {
    return undefined;
  }
  const kind = readRecordString(value, "type") ?? readRecordString(value, "kind") ?? "file";
  const path = readRecordString(value, "localPath") ?? readRecordString(value, "path");
  const url = readRecordString(value, "uri") ?? readRecordString(value, "url");
  return {
    id,
    kind,
    ...(path === undefined ? {} : { path }),
    ...(url === undefined ? {} : { url }),
    metadata: {
      provider: "moyin",
      retention: MOYIN_SOURCE_OWNED_ARTIFACT_RETENTION,
      sensitivity: MOYIN_SOURCE_OWNED_ARTIFACT_SENSITIVITY,
      cleanupPolicyRef: MOYIN_SOURCE_OWNED_ARTIFACT_CLEANUP_POLICY,
      lifecycle: {
        owner: "moyin",
        sourceOfTruth: "moyin-control-plane",
        storage: "source-owned-reference",
      },
      raw: value,
      ...optionalArtifactMetadata(value, "role"),
      ...optionalArtifactMetadata(value, "projectId"),
      ...optionalArtifactMetadata(value, "runId"),
      ...optionalArtifactMetadata(value, "stepId"),
      ...optionalArtifactMetadata(value, "taskId"),
      ...optionalArtifactMetadata(value, "sealedRequestId"),
      ...optionalArtifactMetadata(value, "source"),
    },
  };
}

function optionalArtifactMetadata(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, string>> {
  const item = readRecordString(value, key);
  return item === undefined ? {} : { [key]: item };
}

function createDefaultMoyinProviderRunner(): MoyinProviderRunner {
  return async (input) => {
    try {
      const result = await execFileAsync(input.binary, [...input.args], {
        timeout: input.timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      const failure = error as {
        readonly code?: string;
        readonly signal?: NodeJS.Signals;
        readonly stdout?: string | Buffer;
        readonly stderr?: string | Buffer;
      };
      return {
        exitCode: typeof failure.code === "number" ? failure.code : null,
        stdout: bufferOrStringToString(failure.stdout),
        stderr:
          bufferOrStringToString(failure.stderr) || (error instanceof Error ? error.message : ""),
        ...(typeof failure.code === "string" ? { errorCode: failure.code } : {}),
        signal: failure.signal ?? null,
      };
    }
  };
}

function parseMoyinJson(stdout: string):
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly error: string;
    } {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Moyin CLI returned empty stdout; expected JSON." };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (error) {
    return {
      ok: false,
      error: `Moyin CLI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function parseMoyinNdjson(stdout: string):
  | { readonly ok: true; readonly value: readonly unknown[] }
  | {
      readonly ok: false;
      readonly error: string;
    } {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { ok: false, error: "Moyin CLI returned empty stdout; expected NDJSON." };
  }
  const events: unknown[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      return {
        ok: false,
        error: `Moyin CLI returned invalid NDJSON at line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
  return { ok: true, value: events };
}

function classifyMoyinCliErrorCode(result: MoyinProviderRunnerOutput): string {
  const text = `${result.stderr}\n${result.stdout}`.trim();
  if (result.errorCode === "ENOENT") {
    return "MOYIN_CLI_NOT_FOUND";
  }
  if (isMoyinControlPlaneUnavailableMessage(text)) {
    return "CONTROL_PLANE_NOT_FOUND";
  }
  if (/Unsupported control-plane|Invalid control-plane|control-plane/iu.test(text)) {
    return "MOYIN_CONTROL_PLANE_INVALID";
  }
  if (looksLikeMoyinProviderBindingFailure(text)) {
    return "MOYIN_PROVIDER_BINDING_MISSING";
  }
  if (
    /sealed[_ -]?request.*(?:not\s+found|missing|expired|unreadable|invalid)|sealed request.*(?:not found|missing|expired|unreadable|invalid)/iu.test(
      text,
    )
  ) {
    return "MOYIN_SEALED_REQUEST_UNREADABLE";
  }
  if (
    /rate\s*limit|too\s+many\s+requests|\b429\b|quota|insufficient\s+credits|余额不足|额度不足/iu.test(
      text,
    )
  ) {
    return "MOYIN_PROVIDER_RATE_LIMITED";
  }
  if (
    /timeout|timed\s*out|network|fetch\s+failed|econnreset|econnrefused|enotfound|etimedout|\b5\d\d\b/iu.test(
      text,
    )
  ) {
    return "MOYIN_PROVIDER_UPSTREAM_FAILED";
  }
  return "MOYIN_CLI_COMMAND_FAILED";
}

function isMoyinControlPlaneUnavailableMessage(text: string): boolean {
  return (
    /No running Moyin control plane was found/iu.test(text) ||
    /\bconnect\s+(?:ECONNREFUSED|EPERM)\s+127\.0\.0\.1:\d+/iu.test(text) ||
    /\bconnect\s+(?:ECONNREFUSED|EPERM)\s+localhost:\d+/iu.test(text)
  );
}

function normalizeCommandFailureMessage(result: MoyinProviderRunnerOutput): string {
  const text = `${result.stderr}\n${result.stdout}`.trim();
  if (text.length > 0) {
    return text.split(/\r?\n/u)[0] ?? text;
  }
  if (result.errorCode === "ENOENT") {
    return "Moyin CLI was not found.";
  }
  return "Moyin CLI command failed.";
}

function createMoyinRootCauseHint(code: string): string {
  if (code === "CONTROL_PLANE_NOT_FOUND") {
    return "Moyin desktop may not be running, or the control-plane session file is missing.";
  }
  if (code === "MOYIN_CLI_NOT_FOUND") {
    return "The moyin executable is not on PATH or the configured binary path is invalid.";
  }
  if (code === "MOYIN_JSON_PARSE_FAILED") {
    return "The Moyin CLI stdout contract is not machine-readable JSON for this command.";
  }
  if (code === "MOYIN_CONTROL_PLANE_INVALID") {
    return "The discovered Moyin control-plane file is invalid or points to an unsupported service.";
  }
  if (code === "MOYIN_PROVIDER_BINDING_MISSING") {
    return "Moyin could not resolve the provider/model/API key binding required for this operation.";
  }
  if (code === "MOYIN_SEALED_REQUEST_UNREADABLE") {
    return "The sealed request referenced by this workflow step is missing, expired, invalid, or no longer readable.";
  }
  if (code === "MOYIN_PROVIDER_RATE_LIMITED") {
    return "The upstream media provider rejected the request because of quota, credits, or rate limits.";
  }
  if (code === "MOYIN_PROVIDER_UPSTREAM_FAILED") {
    return "The upstream provider or network failed while Moyin was handling the request.";
  }
  return "The Moyin CLI command failed before producing a valid provider result.";
}

function createMoyinNextActions(code: string): readonly string[] {
  if (code === "CONTROL_PLANE_NOT_FOUND") {
    return ["Start Moyin desktop, then retry the Moyin provider health check."];
  }
  if (code === "MOYIN_CLI_NOT_FOUND") {
    return ["Install or link the Moyin CLI, then configure the provider binary path."];
  }
  if (code === "MOYIN_JSON_PARSE_FAILED") {
    return ["Run the same Moyin command with --json and fix the CLI stdout contract."];
  }
  if (code === "MOYIN_PROVIDER_BINDING_MISSING") {
    return [
      "Configure the Moyin provider/model/API key binding, then rebuild the execution draft or sealed preview.",
    ];
  }
  if (code === "MOYIN_SEALED_REQUEST_UNREADABLE") {
    return ["Rebuild the sealed request through workflow-run.advance build_sealed_request."];
  }
  if (code === "MOYIN_PROVIDER_RATE_LIMITED") {
    return [
      "Wait for provider quota/rate-limit recovery or switch to an available Moyin provider.",
    ];
  }
  if (code === "MOYIN_PROVIDER_UPSTREAM_FAILED") {
    return [
      "Retry after the upstream provider/network recovers; do not resubmit paid steps blindly.",
    ];
  }
  return ["Inspect Moyin CLI stderr and retry after the underlying issue is fixed."];
}

function selectMoyinRetryExecutor(code: string): "orchestrator" | "operator" {
  if (
    code === "CONTROL_PLANE_NOT_FOUND" ||
    code === "MOYIN_CLI_EXEC_FAILED" ||
    code === "MOYIN_PROVIDER_UPSTREAM_FAILED" ||
    code === "MOYIN_PROVIDER_RATE_LIMITED"
  ) {
    return "orchestrator";
  }
  return "operator";
}

function createMoyinRetryInstruction(code: string): string {
  if (code === "MOYIN_CLI_NOT_FOUND") {
    return "Install or link the Moyin CLI, then retry the provider operation.";
  }
  if (code === "MOYIN_JSON_PARSE_FAILED") {
    return "Fix the Moyin CLI JSON stdout contract, then retry the same command.";
  }
  if (code === "MOYIN_CONTROL_PLANE_INVALID") {
    return "Restart or upgrade Moyin so Director Angel discovers a compatible control-plane.";
  }
  if (code === "MOYIN_PROVIDER_BINDING_MISSING") {
    return "Configure the Moyin provider/model/API key binding, then rebuild the request.";
  }
  if (code === "MOYIN_SEALED_REQUEST_UNREADABLE") {
    return "Rebuild the sealed request before approving execution.";
  }
  return "Check Moyin state and retry manually.";
}

function classifyMoyinFailureTaxonomyCode(code: string, message: string): string {
  if (code === "MOYIN_PROVIDER_BINDING_MISSING" || looksLikeMoyinProviderBindingFailure(message)) {
    return "provider_missing_key";
  }
  if (code === "MOYIN_PROVIDER_RATE_LIMITED" || code === "MOYIN_PROVIDER_UPSTREAM_FAILED") {
    return "provider_upstream_failed";
  }
  if (code === "MOYIN_SEALED_REQUEST_UNREADABLE") {
    return "permission_denied";
  }
  return "tool_failed";
}

function looksLikeMoyinProviderBindingFailure(text: string): boolean {
  return /provider[_ -]?model[_ -]?binding|missing[_ -]?provider|missing[_ -]?model|missing[_ -]?(?:api[_ -]?)?key|api\s*key\s*(?:missing|not\s+configured|required)|未配置.*(?:key|模型|供应方)|没有可用的\s*API\s*Key/iu.test(
    text,
  );
}

function redactMoyinProviderErrorSummary(message: string): string {
  const redacted = redactMoyinProviderValue({ message: redactMoyinSensitiveString(message) });
  return isRecord(redacted) && typeof redacted.message === "string"
    ? redacted.message
    : "[redacted]";
}

function createMoyinErrorSummaryHash(summary: string): string {
  return createHash("sha256").update(summary).digest("hex");
}

function redactMoyinSensitiveString(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[redacted]")
    .replace(
      /\b(api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|authorization)\s*[:=]\s*["']?([^"',\s;&]{3,})["']?/giu,
      "$1=[redacted]",
    );
}

function extractMoyinVersionStatus(payload: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(payload)) {
    return {
      compatibility: "degraded",
      missingCapabilities: ["structured-status-payload"],
      required: createMoyinVersionRequirement(),
      recommended: createMoyinVersionRecommendation(),
    };
  }
  const health = isRecord(payload.health) ? payload.health : undefined;
  const cli =
    readRecordString(payload, "cliVersion") ??
    (health === undefined ? undefined : readRecordString(health, "cliVersion")) ??
    readRecordString(payload, "version") ??
    readRecordString(payload, "cli");
  const app =
    readRecordString(payload, "appVersion") ??
    (health === undefined ? undefined : readRecordString(health, "appVersion")) ??
    readRecordString(payload, "app");
  const controlPlane =
    readRecordString(payload, "controlPlaneVersion") ??
    (health === undefined ? undefined : readRecordString(health, "controlPlaneVersion")) ??
    readRecordString(payload, "protocolVersion") ??
    (health === undefined ? undefined : readRecordString(health, "protocolVersion")) ??
    readRecordString(payload, "contract");
  const cliCompatible =
    cli === undefined || compareSemverLikeVersions(cli, REQUIRED_MOYIN_CLI_VERSION) >= 0;
  const controlPlaneCompatible =
    controlPlane !== undefined &&
    compareSemverLikeVersions(controlPlane, REQUIRED_MOYIN_CONTROL_PLANE_VERSION) >= 0;
  const missingCapabilities = [
    ...(cli === undefined && app === undefined ? ["cliVersion-or-appVersion"] : []),
    ...(controlPlane === undefined ? ["protocolVersion"] : []),
  ];
  const incompatibleReasons = [
    ...(cli !== undefined && !cliCompatible
      ? [`cliVersion ${cli} < ${REQUIRED_MOYIN_CLI_VERSION}`]
      : []),
    ...(controlPlane !== undefined && !controlPlaneCompatible
      ? [`protocolVersion ${controlPlane} < ${REQUIRED_MOYIN_CONTROL_PLANE_VERSION}`]
      : []),
  ];
  return {
    ...(cli === undefined ? {} : { cli }),
    ...(app === undefined ? {} : { app }),
    ...(controlPlane === undefined ? {} : { controlPlane }),
    compatibility:
      incompatibleReasons.length > 0
        ? "incompatible"
        : missingCapabilities.length > 0
          ? "degraded"
          : "compatible",
    required: createMoyinVersionRequirement(),
    recommended: createMoyinVersionRecommendation(),
    ...(missingCapabilities.length === 0 ? {} : { missingCapabilities }),
    ...(incompatibleReasons.length === 0 ? {} : { incompatibleReasons }),
  };
}

function createMoyinVersionRequirement(): Readonly<Record<string, string>> {
  return {
    cli: `>=${REQUIRED_MOYIN_CLI_VERSION}`,
    controlPlane: `>=${REQUIRED_MOYIN_CONTROL_PLANE_VERSION}`,
  };
}

function createMoyinVersionRecommendation(): Readonly<Record<string, string>> {
  return {
    cli: `>=${RECOMMENDED_MOYIN_CLI_VERSION}`,
    controlPlane: `>=${RECOMMENDED_MOYIN_CONTROL_PLANE_VERSION}`,
  };
}

function compareSemverLikeVersions(left: string, right: string): number {
  const leftParts = parseSemverLikeVersion(left);
  const rightParts = parseSemverLikeVersion(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }
  return 0;
}

function parseSemverLikeVersion(value: string): readonly number[] {
  const normalized = value.trim().replace(/^[^\d]*/u, "");
  return normalized
    .split(/[^\d]+/u)
    .filter((part) => part.length > 0)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function readRequiredString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${key}.`);
  }
  return value.trim();
}

function readRequiredRecord(value: unknown, key: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`Missing ${key}.`);
  }
  return value;
}

function readOptionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? [...new Set(value.flatMap((item) => (typeof item === "string" ? [item.trim()] : [])))].filter(
        (item) => item.length > 0,
      )
    : [];
}

function readMoyinValidationMessages(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.flatMap((item) => {
        if (typeof item === "string") {
          return [item.trim()];
        }
        if (!isRecord(item)) {
          return [];
        }
        return [readRecordString(item, "message") ?? readRecordString(item, "code") ?? ""];
      }),
    ),
  ].filter((item) => item.length > 0);
}

function optionalStringField<K extends string>(
  key: K,
  value: string | undefined,
): { readonly [P in K]?: string } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: string });
}

function optionalBooleanField<K extends string>(
  key: K,
  value: boolean | undefined,
): { readonly [P in K]?: boolean } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: boolean });
}

function readPayloadItemsCount(payload: unknown): number | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const items = payload.items;
  if (Array.isArray(items)) {
    return items.length;
  }
  const total = payload.total;
  return typeof total === "number" && Number.isFinite(total) ? total : undefined;
}

function readRecordString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item.trim() : undefined;
}

function readRecordBoolean(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const item = value[key];
  return typeof item === "boolean" ? item : undefined;
}

function readRecordNumber(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bufferOrStringToString(value: string | Buffer | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf-8");
  }
  return "";
}

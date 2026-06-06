import type { PolicyRuntime, ToolApprovalContext } from "@hotflow/policy-runtime";

import type {
  ExternalToolControlPlane,
  ExternalToolInvokeRequest,
  ExternalToolInvokeResult,
} from "./external-tools.js";
import type {
  ConversationRuntimeMediaAuthorizationCostTier,
  ConversationRuntimeMediaAuthorizationMode,
  ConversationRuntimeMediaAuthorizationRequest,
  ConversationRuntimeMediaEvidenceRef,
} from "./learning-artifact.js";
import { createMediaEvidenceRef } from "./learning-artifact.js";
import type {
  ConversationRuntimeDiscoveredMediaAsset,
  ConversationRuntimeMediaInventory,
} from "./media-inventory.js";
import type { ConversationRuntimePolicyDecisionEnvelope } from "./policy-envelope.js";
import { createMediaUnderstandingPolicyEnvelope } from "./policy-envelope.js";

export type ConversationRuntimeMediaUnderstandingWorkflowStatus =
  | "authorization_required"
  | "authorized"
  | "empty";

export type ConversationRuntimeMediaUnderstandingStatus =
  | "not_found"
  | "not_understood"
  | "scheduled";

export interface ConversationRuntimeMediaUnderstandingWorkflowAuthorizationInput {
  readonly mode: ConversationRuntimeMediaAuthorizationMode;
  readonly authorized?: boolean;
  readonly tokenLimit?: number;
  readonly fileCountLimit?: number;
  readonly videoMinuteLimit?: number;
  readonly audioMinuteLimit?: number;
}

export interface ConversationRuntimeMediaProviderCostProfileRateCard {
  readonly imageMinorUnits?: number;
  readonly posterMinorUnits?: number;
  readonly videoMinuteMinorUnits?: number;
  readonly audioMinuteMinorUnits?: number;
  readonly unknownMinorUnits?: number;
}

export interface ConversationRuntimeMediaProviderCostProfile {
  readonly providerId: string;
  readonly currency: string;
  readonly pricingSource?: string;
  readonly lowCost?: ConversationRuntimeMediaProviderCostProfileRateCard;
  readonly deepMultimodal?: ConversationRuntimeMediaProviderCostProfileRateCard;
}

export interface CreateConversationRuntimeMediaUnderstandingWorkflowInput {
  readonly inventory: ConversationRuntimeMediaInventory;
  readonly sourceUrl?: string;
  readonly textRead?: boolean;
  readonly authorization?: ConversationRuntimeMediaUnderstandingWorkflowAuthorizationInput;
  readonly providerCostProfile?: ConversationRuntimeMediaProviderCostProfile;
  readonly evidencePrefix?: string;
  readonly observedAtMs?: number;
}

export interface ConversationRuntimeMediaUnderstandingWorkflow {
  readonly schemaVersion: "conversation-runtime.media-understanding-workflow.v1";
  readonly status: ConversationRuntimeMediaUnderstandingWorkflowStatus;
  readonly sourceUrl?: string;
  readonly textEvidenceStatus: "read" | "not_read";
  readonly mediaUnderstandingStatus: ConversationRuntimeMediaUnderstandingStatus;
  readonly authorization: ConversationRuntimeMediaUnderstandingWorkflowAuthorization;
  readonly admission: ConversationRuntimeMediaUnderstandingAdmission;
  readonly unauthorizedDisclosure?: string;
  readonly executionPlan: readonly ConversationRuntimeMediaUnderstandingExecutionPlanStep[];
  readonly evidenceBackfill: ConversationRuntimeMediaUnderstandingEvidenceBackfill;
}

export interface ConversationRuntimeMediaUnderstandingWorkflowAuthorization {
  readonly mode: ConversationRuntimeMediaAuthorizationMode;
  readonly question: string;
  readonly request: ConversationRuntimeMediaAuthorizationRequest;
  readonly budget: ConversationRuntimeMediaUnderstandingBudget;
}

export interface ConversationRuntimeMediaUnderstandingBudget {
  readonly tokenLimit: number;
  readonly fileCountLimit: number;
  readonly videoMinuteLimit: number;
  readonly audioMinuteLimit: number;
  readonly estimatedCostTier: ConversationRuntimeMediaAuthorizationCostTier;
  readonly costEstimate?: ConversationRuntimeMediaUnderstandingCostEstimate;
}

export interface ConversationRuntimeMediaUnderstandingCostEstimate {
  readonly providerId: string;
  readonly currency: string;
  readonly pricingSource?: string;
  readonly mode: ConversationRuntimeMediaAuthorizationMode;
  readonly estimatedMinorUnits: number;
  readonly imageCount: number;
  readonly posterCount: number;
  readonly videoMinuteCount: number;
  readonly audioMinuteCount: number;
  readonly unknownCount: number;
}

export interface ConversationRuntimeMediaUnderstandingExecutionPlanStep {
  readonly stepId: string;
  readonly toolName: "media_understanding";
  readonly mode: Extract<ConversationRuntimeMediaAuthorizationMode, "low_cost" | "deep_multimodal">;
  readonly sourceRef: string;
  readonly mediaId: string;
  readonly kind: "image" | "video" | "audio" | "unknown";
  readonly evidenceBackfillStatus: "pending";
  readonly budget: ConversationRuntimeMediaUnderstandingBudget;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMediaUnderstandingEvidenceBackfill {
  readonly admissible: boolean;
  readonly mediaPublishable: boolean;
  readonly evidenceRefs: readonly ConversationRuntimeMediaEvidenceRef[];
  readonly pendingUnderstandingCount: number;
}

export type ConversationRuntimeMediaUnderstandingAdmissionStatus =
  | "no_media"
  | "text_admissible_media_list_only"
  | "media_understanding_pending";

export type ConversationRuntimeMediaUnderstandingRequiredNextAction =
  | "none"
  | "request_user_authorization"
  | "run_media_understanding_plan";

export interface ConversationRuntimeMediaUnderstandingAdmission {
  readonly status: ConversationRuntimeMediaUnderstandingAdmissionStatus;
  readonly reason: string;
  readonly canAdmitTextEvidence: boolean;
  readonly canAdmitMediaContent: boolean;
  readonly requiredNextAction: ConversationRuntimeMediaUnderstandingRequiredNextAction;
  readonly budget: ConversationRuntimeMediaUnderstandingBudget;
  readonly evidenceRefIds: readonly string[];
}

export type ConversationRuntimeMediaUnderstandingBackfillStatus =
  | "complete"
  | "empty"
  | "failed"
  | "partial"
  | "skipped";

export type ConversationRuntimeMediaUnderstandingStepBackfillStatus =
  | "failed"
  | "skipped"
  | "understood_metadata_only"
  | "understood_semantic";

export interface ConversationRuntimeMediaUnderstandingToolInvokeInput {
  readonly step: ConversationRuntimeMediaUnderstandingExecutionPlanStep;
  readonly artifact: ConversationRuntimeMediaUnderstandingToolArtifact;
}

export interface ConversationRuntimeMediaUnderstandingToolArtifact {
  readonly id: string;
  readonly kind: "image" | "video" | "audio" | "unknown";
  readonly url: string;
  readonly mimeType?: string;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMediaUnderstandingToolInvokeOutput {
  readonly ok: boolean;
  readonly status?: string;
  readonly summary: string;
  readonly output?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

export type ConversationRuntimeMediaUnderstandingToolInvoker = (
  input: ConversationRuntimeMediaUnderstandingToolInvokeInput,
) =>
  | Promise<ConversationRuntimeMediaUnderstandingToolInvokeOutput>
  | ConversationRuntimeMediaUnderstandingToolInvokeOutput;

export type ConversationRuntimeSemanticMediaProviderOperation =
  | "keyframes"
  | "multimodal_summary"
  | "ocr"
  | "transcription";

export interface ConversationRuntimeSemanticMediaProviderAdapterInput {
  readonly operation: ConversationRuntimeSemanticMediaProviderOperation;
  readonly step: ConversationRuntimeMediaUnderstandingExecutionPlanStep;
  readonly artifact: ConversationRuntimeMediaUnderstandingToolArtifact;
}

export interface ConversationRuntimeSemanticMediaProviderAdapterOutput {
  readonly ok: boolean;
  readonly summary: string;
  readonly text?: string;
  readonly transcript?: string;
  readonly observations?: readonly unknown[];
  readonly keyframes?: readonly unknown[];
  readonly segments?: readonly unknown[];
  readonly output?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

export type ConversationRuntimeSemanticMediaProviderAdapter = (
  input: ConversationRuntimeSemanticMediaProviderAdapterInput,
) =>
  | Promise<ConversationRuntimeSemanticMediaProviderAdapterOutput>
  | ConversationRuntimeSemanticMediaProviderAdapterOutput;

export interface ConversationRuntimeSemanticMediaProviderAdapters {
  readonly keyframes?: ConversationRuntimeSemanticMediaProviderAdapter;
  readonly multimodalSummary?: ConversationRuntimeSemanticMediaProviderAdapter;
  readonly ocr?: ConversationRuntimeSemanticMediaProviderAdapter;
  readonly transcription?: ConversationRuntimeSemanticMediaProviderAdapter;
}

export interface CreateSemanticMediaUnderstandingProviderInvokerInput {
  readonly providerId: string;
  readonly adapters: ConversationRuntimeSemanticMediaProviderAdapters;
  readonly approval?: ToolApprovalContext;
  readonly policyRuntime?: Pick<PolicyRuntime, "decide">;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly nowMs?: () => number;
}

export interface RunConversationRuntimeMediaUnderstandingExecutionPlanInput {
  readonly workflow: ConversationRuntimeMediaUnderstandingWorkflow;
  readonly inventory: ConversationRuntimeMediaInventory;
  readonly invokeTool: ConversationRuntimeMediaUnderstandingToolInvoker;
  readonly nowMs?: () => number;
}

export interface CreateExternalToolMediaUnderstandingInvokerInput {
  readonly invoke: ExternalToolControlPlane["invoke"];
  readonly toolId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly cwd?: string;
  readonly approval?: ToolApprovalContext;
  readonly policyRuntime?: Pick<PolicyRuntime, "decide">;
  readonly sandboxRuntimePolicy?: ExternalToolInvokeRequest["sandboxRuntimePolicy"];
  readonly requestedNetworkPolicy?: ExternalToolInvokeRequest["requestedNetworkPolicy"];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly nowMs?: () => number;
}

export interface ConversationRuntimeMediaUnderstandingStepBackfillResult {
  readonly stepId: string;
  readonly mediaId: string;
  readonly sourceRef: string;
  readonly status: ConversationRuntimeMediaUnderstandingStepBackfillStatus;
  readonly reason?: string;
  readonly summary?: string;
  readonly evidenceRef: ConversationRuntimeMediaEvidenceRef;
  readonly toolOutput?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMediaUnderstandingBackfillResult {
  readonly schemaVersion: "conversation-runtime.media-understanding-backfill.v1";
  readonly status: ConversationRuntimeMediaUnderstandingBackfillStatus;
  readonly canAdmitMediaContent: boolean;
  readonly understoodCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly results: readonly ConversationRuntimeMediaUnderstandingStepBackfillResult[];
}

export interface ConversationRuntimeMediaUnderstandingAdmissionBlockedItem {
  readonly evidenceRefId: string;
  readonly sourceRef: string;
  readonly reasons: readonly string[];
}

export interface ConversationRuntimeMediaUnderstandingAdmissionReport {
  readonly schemaVersion: "conversation-runtime.media-understanding-admission.v1";
  readonly canAdmitMediaContent: boolean;
  readonly admittedCount: number;
  readonly blockedCount: number;
  readonly requiredDisclosure: string;
  readonly admittedEvidenceRefIds: readonly string[];
  readonly blocked: readonly ConversationRuntimeMediaUnderstandingAdmissionBlockedItem[];
}

const UNAUTHORIZED_MEDIA_DISCLOSURE =
  "文本已读；媒体仅完成清单记录，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。";
const ADMITTED_MEDIA_DISCLOSURE =
  "媒体已在授权、预算和策略准入后完成语义理解，可引用对应媒体证据。";
const BLOCKED_SEMANTIC_MEDIA_DISCLOSURE =
  "媒体工具返回了语义内容，但缺少策略准入或来源证据，不能把媒体内容当成结论。";
const NO_SEMANTIC_MEDIA_DISCLOSURE =
  "文本已读；媒体未完成可准入的语义理解，不能把媒体内容当成结论。";

export function createMediaUnderstandingWorkflow(
  input: CreateConversationRuntimeMediaUnderstandingWorkflowInput,
): ConversationRuntimeMediaUnderstandingWorkflow {
  const evidenceRefs = createMediaEvidenceRefs(input);
  const request = createMediaAuthorizationRequestFromInventory(input.inventory);
  const requestedMode = input.authorization?.mode ?? request.defaultMode;
  const budget = applyMediaUnderstandingBudgetOverrides(request.budget, input.authorization, {
    inventory: input.inventory,
    mode: requestedMode,
    ...(input.providerCostProfile === undefined
      ? {}
      : { providerCostProfile: input.providerCostProfile }),
  });
  const authorized =
    input.authorization?.authorized === true &&
    (requestedMode === "low_cost" || requestedMode === "deep_multimodal");
  const executionPlan = authorized
    ? createMediaUnderstandingExecutionPlan({
        inventory: input.inventory,
        mode: requestedMode,
        budget,
      })
    : [];
  const status: ConversationRuntimeMediaUnderstandingWorkflowStatus =
    input.inventory.assetCount === 0
      ? "empty"
      : authorized
        ? "authorized"
        : "authorization_required";
  const mediaUnderstandingStatus: ConversationRuntimeMediaUnderstandingStatus =
    input.inventory.assetCount === 0 ? "not_found" : authorized ? "scheduled" : "not_understood";
  return {
    schemaVersion: "conversation-runtime.media-understanding-workflow.v1",
    status,
    ...((input.sourceUrl ?? input.inventory.sourceUrl)
      ? { sourceUrl: input.sourceUrl ?? input.inventory.sourceUrl }
      : {}),
    textEvidenceStatus: input.textRead === false ? "not_read" : "read",
    mediaUnderstandingStatus,
    authorization: {
      mode: requestedMode,
      question: createMediaAuthorizationQuestion(request),
      request,
      budget,
    },
    admission: createMediaUnderstandingAdmission({
      status,
      budget,
      evidenceRefs,
    }),
    ...(authorized || input.inventory.assetCount === 0
      ? {}
      : { unauthorizedDisclosure: UNAUTHORIZED_MEDIA_DISCLOSURE }),
    executionPlan,
    evidenceBackfill: {
      admissible: !authorized,
      mediaPublishable: false,
      evidenceRefs,
      pendingUnderstandingCount: authorized ? executionPlan.length : 0,
    },
  };
}

export async function runMediaUnderstandingExecutionPlan(
  input: RunConversationRuntimeMediaUnderstandingExecutionPlanInput,
): Promise<ConversationRuntimeMediaUnderstandingBackfillResult> {
  if (input.workflow.executionPlan.length === 0) {
    return {
      schemaVersion: "conversation-runtime.media-understanding-backfill.v1",
      status: "empty",
      canAdmitMediaContent: false,
      understoodCount: 0,
      skippedCount: 0,
      failedCount: 0,
      results: [],
    };
  }
  const assetsById = new Map(input.inventory.assets.map((asset) => [asset.id, asset]));
  const results: ConversationRuntimeMediaUnderstandingStepBackfillResult[] = [];
  for (const step of input.workflow.executionPlan) {
    const asset = assetsById.get(step.mediaId);
    if (asset === undefined) {
      results.push(
        createSkippedMediaUnderstandingBackfillResult({
          step,
          reason: "media_asset_not_found_in_inventory",
          ...createObservedAtMsPatch(input.nowMs?.()),
        }),
      );
      continue;
    }
    if (asset.isBlobReference) {
      results.push(
        createSkippedMediaUnderstandingBackfillResult({
          step,
          asset,
          reason: "blob_reference_requires_browser_capture_before_media_understanding",
          ...createObservedAtMsPatch(input.nowMs?.()),
        }),
      );
      continue;
    }
    const artifact = createMediaUnderstandingToolArtifact(step, asset);
    try {
      const output = await input.invokeTool({ step, artifact });
      if (!output.ok) {
        results.push(
          createFailedMediaUnderstandingBackfillResult({
            step,
            asset,
            output,
            ...createObservedAtMsPatch(input.nowMs?.()),
          }),
        );
        continue;
      }
      results.push(
        createSuccessfulMediaUnderstandingBackfillResult({
          step,
          asset,
          output,
          ...createObservedAtMsPatch(input.nowMs?.()),
        }),
      );
    } catch (error) {
      results.push(
        createFailedMediaUnderstandingBackfillResult({
          step,
          asset,
          output: {
            ok: false,
            summary: error instanceof Error ? error.message : String(error),
            error: error instanceof Error ? error.message : String(error),
          },
          ...createObservedAtMsPatch(input.nowMs?.()),
        }),
      );
    }
  }
  const understoodCount = results.filter(
    (result) =>
      result.status === "understood_metadata_only" || result.status === "understood_semantic",
  ).length;
  const skippedCount = results.filter((result) => result.status === "skipped").length;
  const failedCount = results.filter((result) => result.status === "failed").length;
  const admissionReport = createAdmittedMediaUnderstandingEvidenceFromResults(results);
  return {
    schemaVersion: "conversation-runtime.media-understanding-backfill.v1",
    status: resolveMediaUnderstandingBackfillStatus({
      understoodCount,
      skippedCount,
      failedCount,
      totalCount: results.length,
    }),
    canAdmitMediaContent: admissionReport.canAdmitMediaContent,
    understoodCount,
    skippedCount,
    failedCount,
    results,
  };
}

export function createAdmittedMediaUnderstandingEvidence(
  result: ConversationRuntimeMediaUnderstandingBackfillResult,
): ConversationRuntimeMediaUnderstandingAdmissionReport {
  return createAdmittedMediaUnderstandingEvidenceFromResults(result.results);
}

export function createExternalToolMediaUnderstandingInvoker(
  input: CreateExternalToolMediaUnderstandingInvokerInput,
): ConversationRuntimeMediaUnderstandingToolInvoker {
  const toolId = input.toolId ?? "media-understanding.local";
  return async ({ step, artifact }) => {
    const operationId = resolveMediaUnderstandingOperationId(step.kind);
    const policyEnvelope =
      input.policyRuntime === undefined
        ? undefined
        : await createMediaUnderstandingPolicyEnvelope({
            actionId: operationId,
            resourceRef: step.sourceRef,
            mode: step.mode,
            toolName: toolId,
            budget: step.budget,
            evidenceRefIds: [createMediaEvidenceRefIdFromStep(step)],
            ...(input.approval === undefined ? {} : { approval: input.approval }),
            policyRuntime: input.policyRuntime,
            ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
          });
    if (policyEnvelope !== undefined && policyEnvelope.decision.verdict !== "allow") {
      return createPolicyBlockedMediaUnderstandingOutput(policyEnvelope);
    }
    const result = await input.invoke({
      toolId,
      operationId,
      args: {
        artifact,
      },
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      ...(input.sandboxRuntimePolicy === undefined
        ? {}
        : { sandboxRuntimePolicy: input.sandboxRuntimePolicy }),
      requestedNetworkPolicy: input.requestedNetworkPolicy ?? "none",
      metadata: {
        mediaUnderstandingStepId: step.stepId,
        mediaUnderstandingMode: step.mode,
        semanticUnderstanding: false,
        ...(policyEnvelope === undefined ? {} : { policyEnvelope }),
        ...(input.metadata ?? {}),
      },
    });
    return mapExternalToolMediaUnderstandingResult(result, policyEnvelope);
  };
}

export function createSemanticMediaUnderstandingProviderInvoker(
  input: CreateSemanticMediaUnderstandingProviderInvokerInput,
): ConversationRuntimeMediaUnderstandingToolInvoker {
  return async ({ step, artifact }) => {
    const operations = resolveSemanticMediaProviderOperations(step);
    const outputs: ConversationRuntimeSemanticMediaProviderAdapterOutput[] = [];
    for (const operation of operations) {
      const adapter = resolveSemanticMediaProviderAdapter(input.adapters, operation);
      if (adapter === undefined) {
        return createSemanticProviderAdapterMissingOutput(operation);
      }
      const output = await adapter({ operation, step, artifact });
      if (!output.ok) {
        return createFailedSemanticProviderOutput(input.providerId, operation, output);
      }
      outputs.push(output);
    }
    const policyEnvelope =
      input.policyRuntime === undefined
        ? undefined
        : await createMediaUnderstandingPolicyEnvelope({
            actionId: `semantic_media.${operations.join("+")}`,
            resourceRef: step.sourceRef,
            mode: step.mode,
            toolName: input.providerId,
            budget: step.budget,
            evidenceRefIds: [createMediaEvidenceRefIdFromStep(step)],
            ...(input.approval === undefined ? {} : { approval: input.approval }),
            policyRuntime: input.policyRuntime,
            ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
          });
    if (policyEnvelope !== undefined && policyEnvelope.decision.verdict !== "allow") {
      return createPolicyBlockedMediaUnderstandingOutput(policyEnvelope);
    }
    return createSemanticProviderInvokeOutput({
      providerId: input.providerId,
      step,
      artifact,
      operations,
      outputs,
      ...(policyEnvelope === undefined ? {} : { policyEnvelope }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
  };
}

function createMediaUnderstandingAdmission(input: {
  readonly status: ConversationRuntimeMediaUnderstandingWorkflowStatus;
  readonly budget: ConversationRuntimeMediaUnderstandingBudget;
  readonly evidenceRefs: readonly ConversationRuntimeMediaEvidenceRef[];
}): ConversationRuntimeMediaUnderstandingAdmission {
  const evidenceRefIds = input.evidenceRefs.map((evidence) => evidence.id);
  if (input.status === "empty") {
    return {
      status: "no_media",
      reason: "no_media_discovered",
      canAdmitTextEvidence: true,
      canAdmitMediaContent: false,
      requiredNextAction: "none",
      budget: input.budget,
      evidenceRefIds,
    };
  }
  if (input.status === "authorized") {
    return {
      status: "media_understanding_pending",
      reason: "authorized_media_understanding_must_backfill_evidence_before_admission",
      canAdmitTextEvidence: true,
      canAdmitMediaContent: false,
      requiredNextAction: "run_media_understanding_plan",
      budget: input.budget,
      evidenceRefIds,
    };
  }
  return {
    status: "text_admissible_media_list_only",
    reason: "media_not_understood_without_user_authorization",
    canAdmitTextEvidence: true,
    canAdmitMediaContent: false,
    requiredNextAction: "request_user_authorization",
    budget: input.budget,
    evidenceRefIds,
  };
}

function createMediaUnderstandingToolArtifact(
  step: ConversationRuntimeMediaUnderstandingExecutionPlanStep,
  asset: ConversationRuntimeDiscoveredMediaAsset,
): ConversationRuntimeMediaUnderstandingToolArtifact {
  return {
    id: asset.id,
    kind: step.kind,
    url: asset.sourceRef,
    ...(asset.mimeType === undefined ? {} : { mimeType: asset.mimeType }),
    ...(asset.width === undefined ? {} : { width: asset.width }),
    ...(asset.height === undefined ? {} : { height: asset.height }),
    ...(asset.durationMs === undefined
      ? asset.durationSeconds === undefined
        ? {}
        : { durationMs: Math.round(asset.durationSeconds * 1000) }
      : { durationMs: asset.durationMs }),
    metadata: {
      sourceUrl: asset.sourceUrl ?? "",
      origin: asset.origin,
      scope: asset.scope,
      inventoryKind: asset.kind,
      mediaUnderstandingMode: step.mode,
      semanticUnderstanding: false,
    },
  };
}

function resolveMediaUnderstandingOperationId(
  kind: ConversationRuntimeMediaUnderstandingExecutionPlanStep["kind"],
): string {
  if (kind === "video") {
    return "media.understand_video";
  }
  if (kind === "audio") {
    return "media.understand_audio";
  }
  return "media.understand_image";
}

function mapExternalToolMediaUnderstandingResult(
  result: ExternalToolInvokeResult,
  policyEnvelope?: ConversationRuntimePolicyDecisionEnvelope,
): ConversationRuntimeMediaUnderstandingToolInvokeOutput {
  const metadata =
    result.metadata === undefined && policyEnvelope === undefined
      ? undefined
      : {
          ...(result.metadata ?? {}),
          ...(policyEnvelope === undefined ? {} : { policyEnvelope }),
        };
  return {
    ok: result.ok,
    status: result.status,
    summary: result.content,
    ...(result.output === undefined ? {} : { output: result.output }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

function createPolicyBlockedMediaUnderstandingOutput(
  policyEnvelope: ConversationRuntimePolicyDecisionEnvelope,
): ConversationRuntimeMediaUnderstandingToolInvokeOutput {
  return {
    ok: false,
    status: `policy_verdict_${policyEnvelope.decision.verdict}`,
    summary: `Media understanding blocked by policy: ${policyEnvelope.decision.reason}`,
    error: `policy_verdict_${policyEnvelope.decision.verdict}`,
    metadata: {
      policyEnvelope,
    },
  };
}

function resolveSemanticMediaProviderOperations(
  step: ConversationRuntimeMediaUnderstandingExecutionPlanStep,
): readonly ConversationRuntimeSemanticMediaProviderOperation[] {
  if (step.kind === "image") {
    return step.mode === "deep_multimodal" ? ["ocr", "multimodal_summary"] : ["ocr"];
  }
  if (step.kind === "video") {
    return step.mode === "deep_multimodal" ? ["keyframes", "multimodal_summary"] : ["keyframes"];
  }
  if (step.kind === "audio") {
    return ["transcription"];
  }
  return ["multimodal_summary"];
}

function resolveSemanticMediaProviderAdapter(
  adapters: ConversationRuntimeSemanticMediaProviderAdapters,
  operation: ConversationRuntimeSemanticMediaProviderOperation,
): ConversationRuntimeSemanticMediaProviderAdapter | undefined {
  if (operation === "multimodal_summary") {
    return adapters.multimodalSummary;
  }
  return adapters[operation];
}

function createSemanticProviderAdapterMissingOutput(
  operation: ConversationRuntimeSemanticMediaProviderOperation,
): ConversationRuntimeMediaUnderstandingToolInvokeOutput {
  return {
    ok: false,
    status: `semantic_provider_adapter_missing:${operation}`,
    summary: `Semantic media provider adapter missing: ${operation}`,
    error: `semantic_provider_adapter_missing:${operation}`,
  };
}

function createFailedSemanticProviderOutput(
  providerId: string,
  operation: ConversationRuntimeSemanticMediaProviderOperation,
  output: ConversationRuntimeSemanticMediaProviderAdapterOutput,
): ConversationRuntimeMediaUnderstandingToolInvokeOutput {
  return {
    ok: false,
    status: output.error ?? `semantic_provider_${operation}_failed`,
    summary: output.summary,
    ...(output.output === undefined ? {} : { output: output.output }),
    metadata: {
      providerId,
      operation,
      ...(output.metadata ?? {}),
    },
    ...(output.error === undefined ? {} : { error: output.error }),
  };
}

function createSemanticProviderInvokeOutput(input: {
  readonly providerId: string;
  readonly step: ConversationRuntimeMediaUnderstandingExecutionPlanStep;
  readonly artifact: ConversationRuntimeMediaUnderstandingToolArtifact;
  readonly operations: readonly ConversationRuntimeSemanticMediaProviderOperation[];
  readonly outputs: readonly ConversationRuntimeSemanticMediaProviderAdapterOutput[];
  readonly policyEnvelope?: ConversationRuntimePolicyDecisionEnvelope;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): ConversationRuntimeMediaUnderstandingToolInvokeOutput {
  const merged = mergeSemanticProviderOutputs(input);
  return {
    ok: true,
    status: "success",
    summary: input.outputs
      .map((output) => output.summary)
      .filter(Boolean)
      .join("\n"),
    output: merged,
    metadata: {
      providerId: input.providerId,
      operations: [...input.operations],
      semanticUnderstanding: true,
      ...(input.policyEnvelope === undefined ? {} : { policyEnvelope: input.policyEnvelope }),
      ...(input.metadata ?? {}),
    },
  };
}

function mergeSemanticProviderOutputs(input: {
  readonly providerId: string;
  readonly step: ConversationRuntimeMediaUnderstandingExecutionPlanStep;
  readonly artifact: ConversationRuntimeMediaUnderstandingToolArtifact;
  readonly operations: readonly ConversationRuntimeSemanticMediaProviderOperation[];
  readonly outputs: readonly ConversationRuntimeSemanticMediaProviderAdapterOutput[];
}): Readonly<Record<string, unknown>> {
  const ocrTexts = input.outputs
    .map((output) => output.text)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const transcripts = input.outputs
    .map((output) => output.transcript)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const observations = input.outputs.flatMap((output) => [...(output.observations ?? [])]);
  const keyframes = input.outputs.flatMap((output) => [...(output.keyframes ?? [])]);
  const segments = input.outputs.flatMap((output) => [...(output.segments ?? [])]);
  return {
    providerId: input.providerId,
    semanticUnderstanding: true,
    understandingKind: createSemanticProviderUnderstandingKind(input.operations),
    sourceRefs: [input.step.sourceRef],
    evidenceRefIds: [createMediaEvidenceRefIdFromStep(input.step)],
    mediaId: input.step.mediaId,
    mediaKind: input.step.kind,
    operations: [...input.operations],
    ...(ocrTexts.length === 0 ? {} : { ocrText: ocrTexts.join("\n") }),
    ...(transcripts.length === 0 ? {} : { transcript: transcripts.join("\n") }),
    ...(observations.length === 0 ? {} : { observations }),
    ...(keyframes.length === 0 ? {} : { keyframes }),
    ...(segments.length === 0 ? {} : { segments }),
    adapterOutputs: input.outputs.map((output, index) => ({
      operation: input.operations[index],
      summary: output.summary,
      ...(output.output === undefined ? {} : { output: output.output }),
      ...(output.metadata === undefined ? {} : { metadata: output.metadata }),
    })),
  };
}

function createSemanticProviderUnderstandingKind(
  operations: readonly ConversationRuntimeSemanticMediaProviderOperation[],
): string {
  return operations.join("_");
}

function createSuccessfulMediaUnderstandingBackfillResult(input: {
  readonly step: ConversationRuntimeMediaUnderstandingExecutionPlanStep;
  readonly asset: ConversationRuntimeDiscoveredMediaAsset;
  readonly output: ConversationRuntimeMediaUnderstandingToolInvokeOutput;
  readonly observedAtMs?: number;
}): ConversationRuntimeMediaUnderstandingStepBackfillResult {
  const semanticUnderstanding = hasSemanticMediaUnderstanding(input.output);
  const admissionReasons = createSemanticMediaAdmissionBlockReasons(input.output);
  return {
    stepId: input.step.stepId,
    mediaId: input.step.mediaId,
    sourceRef: input.step.sourceRef,
    status: semanticUnderstanding ? "understood_semantic" : "understood_metadata_only",
    summary: input.output.summary,
    evidenceRef: createBackfilledMediaEvidenceRef({
      step: input.step,
      asset: input.asset,
      status: "vision_analyzed",
      publishable: semanticUnderstanding && admissionReasons.length === 0,
      ...createObservedAtMsPatch(input.observedAtMs),
      metadata: {
        semanticUnderstanding,
        ...(semanticUnderstanding
          ? { understandingKind: readSemanticMediaUnderstandingKind(input.output) }
          : {}),
        ...(admissionReasons.length === 0 ? {} : { admissionBlockReasons: admissionReasons }),
        mediaUnderstandingMode: input.step.mode,
        observations: readMediaUnderstandingObservations(input.output.output),
        sandbox: readRecordField(input.output.output, "sandbox"),
        runnerMetadata: input.output.metadata ?? {},
      },
    }),
    toolOutput: input.output.output,
    ...(input.output.metadata === undefined ? {} : { metadata: input.output.metadata }),
  };
}

function createSkippedMediaUnderstandingBackfillResult(input: {
  readonly step: ConversationRuntimeMediaUnderstandingExecutionPlanStep;
  readonly asset?: ConversationRuntimeDiscoveredMediaAsset;
  readonly reason: string;
  readonly observedAtMs?: number;
}): ConversationRuntimeMediaUnderstandingStepBackfillResult {
  return {
    stepId: input.step.stepId,
    mediaId: input.step.mediaId,
    sourceRef: input.step.sourceRef,
    status: "skipped",
    reason: input.reason,
    evidenceRef: createBackfilledMediaEvidenceRef({
      step: input.step,
      ...(input.asset === undefined ? {} : { asset: input.asset }),
      status: "blocked",
      ...createObservedAtMsPatch(input.observedAtMs),
      metadata: {
        semanticUnderstanding: false,
        mediaUnderstandingMode: input.step.mode,
        reason: input.reason,
      },
    }),
  };
}

function createFailedMediaUnderstandingBackfillResult(input: {
  readonly step: ConversationRuntimeMediaUnderstandingExecutionPlanStep;
  readonly asset?: ConversationRuntimeDiscoveredMediaAsset;
  readonly output: ConversationRuntimeMediaUnderstandingToolInvokeOutput;
  readonly observedAtMs?: number;
}): ConversationRuntimeMediaUnderstandingStepBackfillResult {
  return {
    stepId: input.step.stepId,
    mediaId: input.step.mediaId,
    sourceRef: input.step.sourceRef,
    status: "failed",
    reason: input.output.error ?? input.output.status ?? "media_understanding_tool_failed",
    summary: input.output.summary,
    evidenceRef: createBackfilledMediaEvidenceRef({
      step: input.step,
      ...(input.asset === undefined ? {} : { asset: input.asset }),
      status: "blocked",
      ...createObservedAtMsPatch(input.observedAtMs),
      metadata: {
        semanticUnderstanding: false,
        mediaUnderstandingMode: input.step.mode,
        error: input.output.error ?? "",
        toolStatus: input.output.status ?? "",
        ...(input.output.metadata === undefined ? {} : { runnerMetadata: input.output.metadata }),
      },
    }),
    toolOutput: input.output.output,
    ...(input.output.metadata === undefined ? {} : { metadata: input.output.metadata }),
  };
}

function createBackfilledMediaEvidenceRef(input: {
  readonly step: ConversationRuntimeMediaUnderstandingExecutionPlanStep;
  readonly asset?: ConversationRuntimeDiscoveredMediaAsset;
  readonly status: "blocked" | "vision_analyzed";
  readonly publishable?: boolean;
  readonly observedAtMs?: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}): ConversationRuntimeMediaEvidenceRef {
  const index = parseMediaUnderstandingStepIndex(input.step.stepId);
  return createMediaEvidenceRef({
    id: `media-evidence-${index}`,
    sourceRef: input.step.sourceRef,
    status: input.status,
    publishable: input.publishable ?? false,
    ...(input.observedAtMs === undefined ? {} : { observedAtMs: input.observedAtMs }),
    metadata: {
      mediaType: input.step.kind,
      ...(input.asset === undefined
        ? {}
        : {
            inventoryKind: input.asset.kind,
            origin: input.asset.origin,
            scope: input.asset.scope,
            ...(input.asset.sourceUrl === undefined ? {} : { sourceUrl: input.asset.sourceUrl }),
            ...(input.asset.mimeType === undefined ? {} : { mimeType: input.asset.mimeType }),
            ...(input.asset.width === undefined ? {} : { width: input.asset.width }),
            ...(input.asset.height === undefined ? {} : { height: input.asset.height }),
            ...(input.asset.durationSeconds === undefined
              ? {}
              : { durationSeconds: input.asset.durationSeconds }),
            ...(input.asset.durationMs === undefined ? {} : { durationMs: input.asset.durationMs }),
            ...(input.asset.isBlobReference ? { isBlobReference: true } : {}),
          }),
      ...input.metadata,
    },
  });
}

function parseMediaUnderstandingStepIndex(stepId: string): number {
  const match = /(\d+)$/u.exec(stepId);
  const value = match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function createMediaEvidenceRefIdFromStep(
  step: ConversationRuntimeMediaUnderstandingExecutionPlanStep,
): string {
  return `media-evidence-${parseMediaUnderstandingStepIndex(step.stepId)}`;
}

function createAdmittedMediaUnderstandingEvidenceFromResults(
  results: readonly ConversationRuntimeMediaUnderstandingStepBackfillResult[],
): ConversationRuntimeMediaUnderstandingAdmissionReport {
  const semanticResults = results.filter((result) => result.status === "understood_semantic");
  const blocked = semanticResults.flatMap((result) => {
    const reasons = createSemanticEvidenceBlockReasons(result);
    return reasons.length === 0
      ? []
      : [
          {
            evidenceRefId: result.evidenceRef.id,
            sourceRef: result.sourceRef,
            reasons,
          },
        ];
  });
  const blockedIds = new Set(blocked.map((item) => item.evidenceRefId));
  const admittedEvidenceRefIds = semanticResults
    .map((result) => result.evidenceRef.id)
    .filter((id) => !blockedIds.has(id));
  const canAdmitMediaContent =
    admittedEvidenceRefIds.length > 0 && blocked.length === 0 && semanticResults.length > 0;

  return {
    schemaVersion: "conversation-runtime.media-understanding-admission.v1",
    canAdmitMediaContent,
    admittedCount: admittedEvidenceRefIds.length,
    blockedCount: blocked.length,
    requiredDisclosure: canAdmitMediaContent
      ? ADMITTED_MEDIA_DISCLOSURE
      : semanticResults.length > 0
        ? BLOCKED_SEMANTIC_MEDIA_DISCLOSURE
        : NO_SEMANTIC_MEDIA_DISCLOSURE,
    admittedEvidenceRefIds,
    blocked,
  };
}

function hasSemanticMediaUnderstanding(
  output: ConversationRuntimeMediaUnderstandingToolInvokeOutput,
): boolean {
  const record = isRecord(output.output) ? output.output : undefined;
  return (
    readRecordBoolean(record, "semanticUnderstanding") === true ||
    readRecordBoolean(record, "semantic_understanding") === true ||
    readRecordString(record, "understandingKind") !== undefined ||
    readRecordString(record, "understanding_kind") !== undefined ||
    readRecordString(record, "transcript") !== undefined ||
    readRecordString(record, "ocrText") !== undefined ||
    readRecordString(record, "ocr_text") !== undefined ||
    Array.isArray(record?.keyframes) ||
    Array.isArray(record?.segments)
  );
}

function readSemanticMediaUnderstandingKind(
  output: ConversationRuntimeMediaUnderstandingToolInvokeOutput,
): string {
  const record = isRecord(output.output) ? output.output : undefined;
  return (
    readRecordString(record, "understandingKind") ??
    readRecordString(record, "understanding_kind") ??
    (readRecordString(record, "transcript") === undefined ? undefined : "transcription") ??
    (readRecordString(record, "ocrText") === undefined &&
    readRecordString(record, "ocr_text") === undefined
      ? undefined
      : "ocr") ??
    (Array.isArray(record?.keyframes) ? "keyframes" : undefined) ??
    (Array.isArray(record?.segments) ? "audio_segments" : undefined) ??
    "semantic_summary"
  );
}

function createSemanticMediaAdmissionBlockReasons(
  output: ConversationRuntimeMediaUnderstandingToolInvokeOutput,
): readonly string[] {
  const policyEnvelope = readPolicyEnvelope(output.metadata);
  const sourceRefs = readSemanticSourceRefs(output);
  const evidenceRefs = readSemanticEvidenceRefs(output);
  const policySourceRefs = policyEnvelope?.evidence?.sourceRefs ?? [];
  const policyEvidenceRefIds = policyEnvelope?.evidence?.evidenceRefIds ?? [];
  const reasons = [
    policyEnvelope?.decision?.verdict === "allow" &&
    policyEnvelope.evidence?.admission?.canAdmitResult === true
      ? undefined
      : "policy_admission_missing",
    sourceRefs.length > 0 || policySourceRefs.length > 0 ? undefined : "source_refs_missing",
    evidenceRefs.length > 0 || policyEvidenceRefIds.length > 0
      ? undefined
      : "evidence_refs_missing",
  ];
  return uniqueStrings(reasons.filter((reason): reason is string => reason !== undefined));
}

function createSemanticEvidenceBlockReasons(
  result: ConversationRuntimeMediaUnderstandingStepBackfillResult,
): readonly string[] {
  const metadata = result.evidenceRef.metadata;
  const reasons = readStringArray(metadata?.admissionBlockReasons);
  if (reasons.length > 0) {
    return reasons;
  }
  return result.evidenceRef.publishable ? [] : ["media_evidence_not_publishable"];
}

function readPolicyEnvelope(metadata: Readonly<Record<string, unknown>> | undefined):
  | {
      readonly decision?: { readonly verdict?: string };
      readonly evidence?: {
        readonly evidenceRefIds?: readonly string[];
        readonly sourceRefs?: readonly string[];
        readonly admission?: { readonly canAdmitResult?: boolean };
      };
    }
  | undefined {
  const value = metadata?.policyEnvelope;
  return isRecord(value) ? value : undefined;
}

function readSemanticEvidenceRefs(
  output: ConversationRuntimeMediaUnderstandingToolInvokeOutput,
): readonly string[] {
  const record = isRecord(output.output) ? output.output : undefined;
  return uniqueStrings([
    ...readStringArray(record?.evidenceRefIds),
    ...readStringArray(record?.evidence_refs),
    ...readObservationStringArrays(record?.observations, "evidenceRefIds"),
    ...readObservationStringArrays(record?.observations, "evidence_refs"),
  ]);
}

function readSemanticSourceRefs(
  output: ConversationRuntimeMediaUnderstandingToolInvokeOutput,
): readonly string[] {
  const record = isRecord(output.output) ? output.output : undefined;
  return uniqueStrings([
    ...readStringArray(record?.sourceRefs),
    ...readStringArray(record?.source_refs),
    ...readObservationStringArrays(record?.observations, "sourceRefs"),
    ...readObservationStringArrays(record?.observations, "source_refs"),
  ]);
}

function readObservationStringArrays(observations: unknown, key: string): readonly string[] {
  if (!Array.isArray(observations)) {
    return [];
  }
  return observations.flatMap((observation) => {
    if (!isRecord(observation)) {
      return [];
    }
    return readStringArray(observation[key]);
  });
}

function createObservedAtMsPatch(observedAtMs: number | undefined): {
  readonly observedAtMs?: number;
} {
  return observedAtMs === undefined ? {} : { observedAtMs };
}

function readMediaUnderstandingObservations(output: unknown): readonly unknown[] {
  const record = isRecord(output) ? output : undefined;
  return Array.isArray(record?.observations) ? record.observations : [];
}

function readRecordField(
  output: unknown,
  field: string,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(output)) {
    return undefined;
  }
  const value = output[field];
  return isRecord(value) ? value : undefined;
}

function readRecordBoolean(
  record: Readonly<Record<string, unknown>> | undefined,
  field: string,
): boolean | undefined {
  const value = record?.[field];
  return typeof value === "boolean" ? value : undefined;
}

function readRecordString(
  record: Readonly<Record<string, unknown>> | undefined,
  field: string,
): string | undefined {
  const value = record?.[field];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.filter((item): item is string => typeof item === "string"));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function resolveMediaUnderstandingBackfillStatus(input: {
  readonly understoodCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly totalCount: number;
}): ConversationRuntimeMediaUnderstandingBackfillStatus {
  if (input.totalCount === 0) {
    return "empty";
  }
  if (input.understoodCount === input.totalCount) {
    return "complete";
  }
  if (input.failedCount === input.totalCount) {
    return "failed";
  }
  if (input.skippedCount === input.totalCount) {
    return "skipped";
  }
  return "partial";
}

function createMediaEvidenceRefs(
  input: CreateConversationRuntimeMediaUnderstandingWorkflowInput,
): readonly ConversationRuntimeMediaEvidenceRef[] {
  return input.inventory.assets.map((asset, index) =>
    createMediaEvidenceRef({
      id: `${input.evidencePrefix ?? "media-evidence"}-${index + 1}`,
      sourceRef: asset.sourceRef,
      status: "listed_only",
      publishable: false,
      ...(input.observedAtMs === undefined ? {} : { observedAtMs: input.observedAtMs }),
      metadata: {
        mediaType: normalizeInventoryMediaKind(asset),
        inventoryKind: asset.kind,
        origin: asset.origin,
        scope: asset.scope,
        ...(asset.sourceUrl === undefined ? {} : { sourceUrl: asset.sourceUrl }),
        ...(asset.poster === undefined ? {} : { poster: asset.poster }),
        ...(asset.mimeType === undefined ? {} : { mimeType: asset.mimeType }),
        ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
        ...(asset.durationMs === undefined ? {} : { durationMs: asset.durationMs }),
        ...(asset.width === undefined ? {} : { width: asset.width }),
        ...(asset.height === undefined ? {} : { height: asset.height }),
        ...(asset.isBlobReference ? { isBlobReference: true } : {}),
      },
    }),
  );
}

function createMediaAuthorizationRequestFromInventory(
  inventory: ConversationRuntimeMediaInventory,
): ConversationRuntimeMediaAuthorizationRequest {
  const estimatedCostTier = estimateInventoryAuthorizationCostTier(inventory);
  const lowCostTokenBudget =
    inventory.imageCount * 1_200 +
    inventory.posterCount * 600 +
    inventory.videoCount * 6_000 +
    inventory.audioCount * 3_000 +
    inventory.unknownCount * 1_500;
  const deepMultimodalTokenBudget =
    inventory.imageCount * 4_000 +
    inventory.posterCount * 1_200 +
    inventory.videoCount * 24_000 +
    inventory.audioCount * 8_000 +
    inventory.unknownCount * 5_000;
  const estimatedTokenBudget = {
    mediaInventory: 0,
    lowCost: lowCostTokenBudget,
    deepMultimodal: Math.max(deepMultimodalTokenBudget, lowCostTokenBudget + 1_000),
  };
  const budget = {
    tokenLimit: estimatedTokenBudget.deepMultimodal,
    fileCountLimit: inventory.assetCount,
    videoMinuteLimit: estimateInventoryMinuteLimit(inventory.assets, "video"),
    audioMinuteLimit: estimateInventoryMinuteLimit(inventory.assets, "audio"),
    estimatedCostTier,
  };
  return {
    required: inventory.assetCount > 0,
    reason:
      inventory.assetCount > 0
        ? "media_requires_user_authorization_and_budget_before_understanding"
        : "no_media_discovered",
    assetCount: inventory.assetCount,
    imageCount: inventory.imageCount,
    videoCount: inventory.videoCount,
    audioCount: inventory.audioCount,
    unknownCount: inventory.unknownCount,
    defaultMode: "media_inventory",
    recommendedMode: estimatedCostTier === "high" ? "media_inventory" : "low_cost",
    estimatedTokenBudget,
    budget,
    estimatedCostTier,
    privacy: inventory.assetCount > 0 ? "pii_potential" : "public",
    options: [
      {
        mode: "text_only",
        label: "只学习正文",
        description: "不解析图片、视频或音频，媒体内容不会作为已学经验入库。",
        requiresUserAuthorization: false,
        estimatedTokenBudget: 0,
        estimatedCostTier: "none",
      },
      {
        mode: "media_inventory",
        label: "只记录媒体清单",
        description: "保留媒体链接、尺寸和来源，用于后续人工确认或追加处理。",
        requiresUserAuthorization: false,
        estimatedTokenBudget: estimatedTokenBudget.mediaInventory,
        estimatedCostTier: "none",
      },
      {
        mode: "low_cost",
        label: "低成本视觉理解",
        description: "对图片做 OCR/视觉摘要，对视频优先抽关键帧或转录，再回填证据。",
        requiresUserAuthorization: true,
        estimatedTokenBudget: estimatedTokenBudget.lowCost,
        estimatedCostTier,
      },
      {
        mode: "deep_multimodal",
        label: "深度视频理解",
        description: "对图片、视频和音频做更完整理解，适合高价值来源但成本更高。",
        requiresUserAuthorization: true,
        estimatedTokenBudget: estimatedTokenBudget.deepMultimodal,
        estimatedCostTier: promoteCostTier(estimatedCostTier),
      },
    ],
  };
}

function createMediaAuthorizationQuestion(
  request: ConversationRuntimeMediaAuthorizationRequest,
): string {
  return [
    `发现 ${request.assetCount} 个媒体资源。请选择授权范围：`,
    "只记录媒体清单",
    "低成本视觉理解",
    "深度视频理解",
    `预算上限：tokens=${request.budget.tokenLimit} files=${request.budget.fileCountLimit} video_minutes=${request.budget.videoMinuteLimit} audio_minutes=${request.budget.audioMinuteLimit} cost=${request.budget.estimatedCostTier}`,
  ].join(" / ");
}

function applyMediaUnderstandingBudgetOverrides(
  budget: ConversationRuntimeMediaUnderstandingBudget,
  authorization: ConversationRuntimeMediaUnderstandingWorkflowAuthorizationInput | undefined,
  costInput?: {
    readonly inventory: ConversationRuntimeMediaInventory;
    readonly mode: ConversationRuntimeMediaAuthorizationMode;
    readonly providerCostProfile?: ConversationRuntimeMediaProviderCostProfile;
  },
): ConversationRuntimeMediaUnderstandingBudget {
  return {
    tokenLimit: boundedInteger(authorization?.tokenLimit, budget.tokenLimit),
    fileCountLimit: boundedInteger(authorization?.fileCountLimit, budget.fileCountLimit),
    videoMinuteLimit: boundedInteger(authorization?.videoMinuteLimit, budget.videoMinuteLimit),
    audioMinuteLimit: boundedInteger(authorization?.audioMinuteLimit, budget.audioMinuteLimit),
    estimatedCostTier: budget.estimatedCostTier,
    ...(costInput?.providerCostProfile === undefined
      ? budget.costEstimate === undefined
        ? {}
        : { costEstimate: budget.costEstimate }
      : {
          costEstimate: estimateMediaUnderstandingProviderCost({
            inventory: costInput.inventory,
            mode: costInput.mode,
            providerCostProfile: costInput.providerCostProfile,
          }),
        }),
  };
}

function estimateMediaUnderstandingProviderCost(input: {
  readonly inventory: ConversationRuntimeMediaInventory;
  readonly mode: ConversationRuntimeMediaAuthorizationMode;
  readonly providerCostProfile: ConversationRuntimeMediaProviderCostProfile;
}): ConversationRuntimeMediaUnderstandingCostEstimate {
  const rateCard =
    input.mode === "deep_multimodal"
      ? input.providerCostProfile.deepMultimodal
      : input.providerCostProfile.lowCost;
  const videoMinuteCount = estimateInventoryMinuteLimit(input.inventory.assets, "video");
  const audioMinuteCount = estimateInventoryMinuteLimit(input.inventory.assets, "audio");
  const estimatedMinorUnits =
    input.inventory.imageCount * (rateCard?.imageMinorUnits ?? 0) +
    input.inventory.posterCount * (rateCard?.posterMinorUnits ?? rateCard?.imageMinorUnits ?? 0) +
    videoMinuteCount * (rateCard?.videoMinuteMinorUnits ?? 0) +
    audioMinuteCount * (rateCard?.audioMinuteMinorUnits ?? 0) +
    input.inventory.unknownCount * (rateCard?.unknownMinorUnits ?? 0);
  return {
    providerId: input.providerCostProfile.providerId,
    currency: input.providerCostProfile.currency,
    ...(input.providerCostProfile.pricingSource === undefined
      ? {}
      : { pricingSource: input.providerCostProfile.pricingSource }),
    mode: input.mode,
    estimatedMinorUnits,
    imageCount: input.inventory.imageCount,
    posterCount: input.inventory.posterCount,
    videoMinuteCount,
    audioMinuteCount,
    unknownCount: input.inventory.unknownCount,
  };
}

function createMediaUnderstandingExecutionPlan(input: {
  readonly inventory: ConversationRuntimeMediaInventory;
  readonly mode: "low_cost" | "deep_multimodal";
  readonly budget: ConversationRuntimeMediaUnderstandingBudget;
}): readonly ConversationRuntimeMediaUnderstandingExecutionPlanStep[] {
  const limits = createExecutionLimitTracker(input.budget);
  const steps: ConversationRuntimeMediaUnderstandingExecutionPlanStep[] = [];
  for (const asset of input.inventory.assets) {
    if (!limits.canAccept(asset)) {
      continue;
    }
    limits.accept(asset);
    steps.push({
      stepId: `media-understanding-${steps.length + 1}`,
      toolName: "media_understanding",
      mode: input.mode,
      sourceRef: asset.sourceRef,
      mediaId: asset.id,
      kind: normalizeInventoryMediaKind(asset),
      evidenceBackfillStatus: "pending",
      budget: input.budget,
      metadata: {
        inventoryKind: asset.kind,
        origin: asset.origin,
        scope: asset.scope,
        ...(asset.isBlobReference ? { isBlobReference: true } : {}),
        ...(asset.poster === undefined ? {} : { poster: asset.poster }),
      },
    });
  }
  return steps;
}

function createExecutionLimitTracker(budget: ConversationRuntimeMediaUnderstandingBudget): {
  readonly canAccept: (asset: ConversationRuntimeDiscoveredMediaAsset) => boolean;
  readonly accept: (asset: ConversationRuntimeDiscoveredMediaAsset) => void;
} {
  let fileCount = 0;
  let videoMinutes = 0;
  let audioMinutes = 0;
  return {
    canAccept(asset) {
      if (fileCount >= budget.fileCountLimit) {
        return false;
      }
      const kind = normalizeInventoryMediaKind(asset);
      const minutes = estimateAssetMinutes(asset);
      if (kind === "video" && videoMinutes + Math.max(1, minutes) > budget.videoMinuteLimit) {
        return false;
      }
      if (kind === "audio" && audioMinutes + Math.max(1, minutes) > budget.audioMinuteLimit) {
        return false;
      }
      return true;
    },
    accept(asset) {
      fileCount += 1;
      const kind = normalizeInventoryMediaKind(asset);
      const minutes = Math.max(1, estimateAssetMinutes(asset));
      if (kind === "video") {
        videoMinutes += minutes;
      } else if (kind === "audio") {
        audioMinutes += minutes;
      }
    },
  };
}

function estimateInventoryMinuteLimit(
  assets: readonly ConversationRuntimeDiscoveredMediaAsset[],
  mediaType: "audio" | "video",
): number {
  let count = 0;
  let seconds = 0;
  for (const asset of assets) {
    const kind = normalizeInventoryMediaKind(asset);
    if (kind !== mediaType) {
      continue;
    }
    count += 1;
    const duration =
      asset.durationSeconds ??
      (asset.durationMs === undefined ? undefined : asset.durationMs / 1000);
    if (duration !== undefined && duration > 0) {
      seconds += duration;
    }
  }
  return Math.max(count, Math.ceil(seconds / 60));
}

function estimateAssetMinutes(asset: ConversationRuntimeDiscoveredMediaAsset): number {
  const seconds =
    asset.durationSeconds ?? (asset.durationMs === undefined ? undefined : asset.durationMs / 1000);
  return seconds === undefined || seconds <= 0 ? 0 : Math.ceil(seconds / 60);
}

function normalizeInventoryMediaKind(
  asset: ConversationRuntimeDiscoveredMediaAsset,
): "image" | "video" | "audio" | "unknown" {
  if (asset.kind === "image" || asset.kind === "poster") {
    return "image";
  }
  if (asset.kind === "video" || asset.kind === "blob") {
    return "video";
  }
  if (asset.kind === "audio") {
    return "audio";
  }
  return "unknown";
}

function estimateInventoryAuthorizationCostTier(
  inventory: ConversationRuntimeMediaInventory,
): ConversationRuntimeMediaAuthorizationCostTier {
  if (inventory.assetCount === 0) {
    return "none";
  }
  if (inventory.videoCount + inventory.audioCount >= 3 || inventory.assetCount >= 5) {
    return "high";
  }
  if (inventory.videoCount > 0 || inventory.audioCount > 0 || inventory.assetCount >= 4) {
    return "medium";
  }
  return "low";
}

function promoteCostTier(
  tier: ConversationRuntimeMediaAuthorizationCostTier,
): ConversationRuntimeMediaAuthorizationCostTier {
  if (tier === "none") {
    return "low";
  }
  if (tier === "low") {
    return "medium";
  }
  return "high";
}

function boundedInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

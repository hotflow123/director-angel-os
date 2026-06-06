import { createHash } from "node:crypto";
import { type Dirent, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { dirname, join } from "node:path";
import {
  type AgentOsQueueDirective,
  type AgentOsTimelineEvent,
  appendAgentOsTimelineEvent,
  projectAgentOsTimelineSummary,
} from "@hotflow/agent-os-kernel-contracts";
import { createAgentOsTurnEnvelopeFromChannelTransport } from "@hotflow/agent-os-runtime-mapping";
import {
  type AgentOsProcessCapabilityRunnerKind,
  type AgentOsSandboxCommandExecutionEvidence,
  summarizeAgentOsProcessCapabilityLedger,
} from "@hotflow/agent-os-sandbox";
import {
  type ChannelCommandSurface,
  cleanUserFacingCommandText,
  createChannelTransportEnvelope,
  getChannelCommandDefinitions,
  getChannelCommandDefinitionsForSurface,
  orchestrateConversationTurn,
  resolveChannelSessionTarget,
} from "@hotflow/channels-core";
import {
  type ExperienceCandidate,
  type ExperiencePrivacyClassification,
  type ExperienceQuarantineRecord,
  type ExperienceReviewDecisionStatus,
  type ExperienceSourceArtifact,
  type ProposalRecord,
  type ProposalStatus,
  createExperienceCandidate,
  createExperienceReviewDecision,
} from "@hotflow/contracts";
import {
  type ConversationRuntimeToolEvidenceIndexEntry,
  type ConversationRuntimeToolExecutionInput,
  type ExternalToolApprovalDecisionStatus,
  type ExternalToolInvokeRequest,
  createBuiltinWebToolExecutors,
  createExternalToolsCatalogRpcResult,
  createExternalToolsEffectiveRpcResult,
  createFileConversationRuntimeToolEvidenceStore,
  createMemoryEvidenceRecord,
  createSourceEvidenceRef,
  invokeExternalToolControlPlane,
  orchestrateConversationRuntimeUrlLearningRead,
} from "@hotflow/conversation-runtime";
import {
  DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SCHEMA_ID,
  DIRECTOR_ENTRY_API_VERSION,
  type DirectorEntryAgentOsProjection,
  type DirectorEntryMessageRequest,
  type DirectorEntrySession,
  isDirectorEntryIntakeRequest,
  isDirectorEntryMessageRequest,
} from "@hotflow/director-entry-contracts";
import {
  DIRECTOR_HTTP_JSON_BRIDGE_REQUEST_SCHEMA_ID,
  ExecutionRunService,
  FileSystemRunStore,
  buildExecutionRunDelegations,
} from "@hotflow/director-execution";
import type {
  AssignmentRun,
  ExecutionEvent,
  ExecutionRun,
  ExecutionRunReport,
} from "@hotflow/director-execution-contracts";
import {
  DIRECTOR_HOST_API_VERSION,
  type DirectorBlueprintRequest,
  type DirectorBlueprintResponse,
  isDirectorBlueprintRequest,
  isDirectorBlueprintResponse,
  isDirectorClarifyRequest,
  isDirectorEvaluateRequest,
  isDirectorIntakeRequest,
  isDirectorOutcomeRequest,
} from "@hotflow/director-host-contracts";
import {
  type DirectorDailySelfReflectionInput,
  DirectorKnowledgeLifecycleService,
  type DirectorKnowledgeRecallQuery,
  type DirectorReflectionReport,
  type DirectorSoulCandidate,
  type DirectorSoulDecision,
  type DirectorSoulDocument,
  ExperiencePromotionService,
  FileExperienceStore,
  FileExperienceTaxonomyStore,
  FileKnowledgeStore,
  LocalDirectoryExperienceAdapter,
  type MaterializedRunOutputExperience,
  PastedTextExperienceAdapter,
  type RunOutputExperienceIntent,
  type RunOutputExperienceSource,
  SelfLearningOrchestrator,
  type WebExperienceFetchText,
  WebExperienceSourceAdapter,
  WebSearchExperienceAdapter,
  applyDirectorMaintenance,
  assessExperienceSourceAccess,
  formatDirectorDailySelfReflectionReport,
  formatDirectorHeartbeatSnapshot,
  inspectDirectorMaintenance,
  materializeDirectorReflectionReport,
  materializeDirectorSoulCandidateFromReflection,
  materializeDirectorSoulDecision,
  materializeDirectorSoulDocumentFromCandidate,
  materializeReflectionExperienceCandidates,
  materializeRunOutputExperience,
  recallPublishedKnowledge,
  renderDirectorSoulMarkdown,
  runDirectorDailySelfReflection,
  runDirectorHeartbeatStructured,
} from "@hotflow/director-knowledge";
import { FileSystemDirectorMemoryStore } from "@hotflow/director-memory";
import {
  DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
  type DirectorMemoryRecord,
  type DirectorRecallQuery,
  isDirectorRecallQuery,
} from "@hotflow/director-memory-contracts";
import { FileSystemDirectorProposalStore } from "@hotflow/director-proposals";
import {
  AppendOnlyFileLearningObservationSink,
  type DirectorAdapterManifest,
  type DirectorSwitchState,
  loadDirectorApiProviderConfig,
  loadDirectorSwitchState,
  runDirectorApiProviderImageGeneration,
  runDirectorApiProviderTextCompletion,
} from "@hotflow/director-runtime";
import {
  type CrewRole,
  type DirectorLongTermMemoryPort,
  type DirectorRuntimeAdapterDescriptor,
  type DirectorRuntimeMatcherPort,
  type DirectorRuntimeRegistryPort,
  type DirectorRuntimeSwitchesPort,
  DirectorService,
} from "@hotflow/director-service";
import { ensureDirectorWorkspace } from "@hotflow/director-workspace";
import { SessionStore } from "@hotflow/sessions";
import {
  FileBackedSkillRepository,
  FileSkillTaxonomyStore,
  SKILL_SNAPSHOT_UPSERT_KIND,
  type SkillCuratorWriteActionKind,
  type SkillDoctorResult,
  SkillManagementStore,
  SkillPromptIndex,
  SkillProposalReviewer,
  SkillSafeApplyService,
  type SkillSnapshot,
  SkillSnapshotFileStore,
  type SkillToolDoctorIndex,
  SkillUsageStore,
  createEmptySkillToolDoctorIndex,
  createSkillExplanationSurface,
  createSkillToolDoctorIndex,
  decodeSkillProposal,
  deriveSkillDoctor,
  generateSkillProposalFromExperienceCandidate,
  guardSkillCuratorWriteRequest,
  resolveApprovedSkillSnapshotPath,
  resolveSkillManagementPath,
  resolveSkillRuntimeContract,
  resolveSkillUsagePath,
  summarizeSkillRuntimeStatuses,
} from "@hotflow/skills";
import {
  SessionStoreTaskPlanePort,
  projectSubagentRunsFromTaskState,
  projectSubagentSchedulerDispatchPlanFromSubagentRuns,
  projectSubagentSchedulerDispatchPlanFromTaskState,
  projectSubagentSchedulerHeartbeatFromSubagentRuns,
  projectSubagentSchedulerHeartbeatFromTaskState,
  projectSubagentSchedulerRecoveryPlanFromSubagentRuns,
  projectSubagentSchedulerRecoveryPlanFromTaskState,
  projectSubagentSchedulerTickFromTaskState,
} from "@hotflow/tasks-core";
import type {
  TaskBackedSubagentRun,
  TaskBackedSubagentSchedulerTick,
  TaskBackedSubagentSchedulerTickIntent,
} from "@hotflow/tasks-core";
import { runSchedulerExecutorJob, runSchedulerRecoveryJob } from "@hotflow/worker-jobs";

import {
  createBlueprintResponse,
  createClarifyResponse,
  createEvaluateResponse,
  createIntakeResponse,
  createOutcomeResponse,
  createRuntimeSnapshotResponse,
} from "./beta1.js";
import {
  type BootstrapDirectorHostApiOptions,
  type DirectorHostRuntime,
  bootstrapDirectorHostApi,
  createDirectorObservationSinkOptions,
  summarizeDirectorHostApiProviders,
} from "./bootstrap.js";
import {
  FileSystemDirectorEntryStore,
  buildEntryIntakeRequestFromMessage,
} from "./director-entry.js";
import {
  type LongTermMemoryAdmitInput,
  type LongTermMemoryTarget,
  admitLongTermMemory,
} from "./long-term-memory.js";
import { FileSystemDirectorMemoryRecallPort } from "./memory.js";
import {
  createRuntimePreflightHandoff,
  createRuntimePreflightResponse,
} from "./runtime-preflight.js";

export interface DirectorHostApiApp {
  readonly runtime: DirectorHostRuntime;
  start(options?: { host?: string; port?: number }): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

interface RetryAssignmentRequest {
  readonly assignmentId: string;
}

interface RerouteAssignmentRequest extends RetryAssignmentRequest {
  readonly adapterId: string;
}

type ReviewAction = "accept" | "reject";
type ExperienceCandidateAction = ReviewAction | "promote";
type KnowledgeCandidateAction = ReviewAction | "publish";
type SkillProposalAction = ReviewAction | "apply";

const DIRECTOR_SKILL_SESSION_ID = "director-angel-desktop";
const SKILL_PROPOSAL_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "applied",
  "expired",
] as const satisfies readonly ProposalStatus[];

interface DirectorHostOperatorRequest {
  readonly actor?: string;
  readonly note?: string;
  readonly now?: string;
  readonly nowMs?: number;
}

type DirectorMemoryPublicationGovernanceStatus =
  | "published"
  | "retracted"
  | "demoted"
  | "quarantined";
type DirectorMemoryPublicationAction = "retract" | "demote" | "quarantine" | "restore";

interface HostMemoryPublicationProjection {
  readonly recordId: string;
  readonly candidateId: string;
  readonly publishedAt: string;
  readonly actor?: string;
  readonly note?: string;
  readonly summary: string;
  readonly evidenceRefs: readonly HostMemoryEvidenceRefProjection[];
  readonly governanceStatus: DirectorMemoryPublicationGovernanceStatus;
  readonly governanceAudit: readonly HostMemoryGovernanceAuditProjection[];
}

interface HostMemoryEvidenceRefProjection {
  readonly evidenceId: string;
  readonly sourceKind?: string;
  readonly sourceRef: string;
  readonly sourceSnapshotId?: string;
  readonly summary?: string;
}

interface HostMemoryGovernanceAuditProjection {
  readonly actor?: string;
  readonly note?: string;
  readonly reason?: string;
  readonly decidedAt: string;
  readonly previousStatus: DirectorMemoryPublicationGovernanceStatus;
  readonly nextStatus: DirectorMemoryPublicationGovernanceStatus;
}

interface DirectorHostSkillCuratorWriteGuardRequest extends DirectorHostOperatorRequest {
  readonly action: SkillCuratorWriteActionKind;
  readonly skillId: string;
  readonly canonicalSkillId?: string;
  readonly duplicateSkillIds?: readonly string[];
  readonly scopes?: readonly string[];
}

interface DirectorHostLearningTextSource {
  readonly title?: string;
  readonly content: string;
  readonly sourceRef?: string;
  readonly contentType?: string;
}

interface DirectorHostLearningTextRequest {
  readonly sourceId: string;
  readonly texts: readonly DirectorHostLearningTextSource[];
  readonly privacy?: ExperiencePrivacyClassification;
  readonly nowMs?: number;
}

interface DirectorHostLearningAdmitSource {
  readonly title?: string;
  readonly body: string;
  readonly sourceRef?: string;
  readonly contentType?: string;
}

interface DirectorHostLearningAdmitRequest {
  readonly sourceId: string;
  readonly sources: readonly DirectorHostLearningAdmitSource[];
  readonly privacy?: ExperiencePrivacyClassification;
  readonly nowMs?: number;
}

interface DirectorHostLearningDirectoryRequest {
  readonly sourceId: string;
  readonly directory: string;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly nowMs?: number;
  readonly maxDepth?: number;
  readonly maxFiles?: number;
  readonly maxBytesPerFile?: number;
  readonly includeExtensions?: readonly string[];
}

interface DirectorHostLearningUrlRequest {
  readonly sourceId: string;
  readonly urls: readonly string[];
  readonly privacy?: ExperiencePrivacyClassification;
  readonly nowMs?: number;
  readonly maxBytesPerPage?: number;
}

interface DirectorHostLearningQueryRequest {
  readonly sourceId: string;
  readonly queries: readonly string[];
  readonly privacy?: ExperiencePrivacyClassification;
  readonly nowMs?: number;
  readonly maxResultsPerQuery?: number;
  readonly maxBytesPerPage?: number;
}

interface DirectorHostClientBinding {
  readonly bindingId: string;
  readonly clientId: string;
  readonly displayName?: string;
  readonly channel: string;
  readonly hostId: string;
  readonly agentId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface DirectorHostV1Session {
  readonly sessionId: string;
  readonly bindingId: string;
  readonly clientId: string;
  readonly channel: string;
  readonly hostId: string;
  readonly agentId: string;
  readonly peerId: string;
  readonly title?: string;
  readonly sessionKey: string;
  readonly entrySessionId?: string;
  readonly latestTaskId?: string;
  readonly messageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface DirectorHostV1SessionMessage {
  readonly messageId: string;
  readonly sessionId: string;
  readonly text: string;
  readonly receivedAtMs: number;
  readonly receivedAt: string;
  readonly entrySessionId: string;
  readonly entryTurnId?: string;
}

type DirectorHostV1TaskStatus =
  | "created"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "aborted";

interface DirectorHostV1Task {
  readonly taskId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly entrySessionId: string;
  readonly text: string;
  readonly status: DirectorHostV1TaskStatus;
  readonly blueprintId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type DirectorHostLearningJobKind = "text" | "directory" | "url" | "query";
type DirectorHostLearningJobStatus = "created" | "running" | "succeeded" | "failed";

interface DirectorHostLearningJob {
  readonly jobId: string;
  readonly kind: DirectorHostLearningJobKind;
  readonly status: DirectorHostLearningJobStatus;
  readonly request: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly result?: Record<string, unknown>;
  readonly error?: string;
}

interface DirectorHostSkillProposalFromExperienceRequest {
  readonly candidateId: string;
  readonly author?: string;
  readonly nowMs?: number;
}

interface DirectorHostSkillEnablementRequest extends DirectorHostOperatorRequest {
  readonly enabled: boolean;
  readonly nowMs?: number;
}

interface DirectorHostSkillUpdateRequest {
  readonly title?: string;
  readonly description?: string;
  readonly content?: string;
  readonly version?: string;
  readonly tags?: readonly string[];
  readonly toolNames?: readonly string[];
  readonly priority?: number;
  readonly actor?: string;
  readonly nowMs?: number;
}

interface DirectorHostSkillCatalogQuery {
  readonly query?: string;
  readonly limit?: number;
  readonly includeDisabled?: boolean;
}

interface DirectorHostExperienceCandidateUpdateRequest {
  readonly title?: string;
  readonly summary?: string;
  readonly applicability?: string;
  readonly risks?: readonly string[];
  readonly tags?: readonly string[];
  readonly author?: string;
}

interface DirectorHostRunExperienceRequest {
  readonly intent?: RunOutputExperienceIntent;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly now?: string;
}

interface DirectorHostTraceProposalExperienceRequest extends DirectorHostRunExperienceRequest {}

interface DirectorHostRunReflectionRequest {
  readonly privacy?: ExperiencePrivacyClassification;
  readonly now?: string;
  readonly writeExperienceCandidate?: boolean;
  readonly writeSoulCandidate?: boolean;
}

interface DirectorHostMaintenanceRequest {
  readonly nowMs?: number;
  readonly policy?: {
    readonly logRetentionDays?: number;
    readonly logMaxBytes?: number;
    readonly archivePromotedExperienceAfterDays?: number;
    readonly archiveRejectedExperienceAfterDays?: number;
    readonly archiveQuarantineAfterDays?: number;
    readonly archiveUnreferencedArtifactsAfterDays?: number;
    readonly staleUnreviewedExperienceDays?: number;
    readonly staleUnreviewedMinimumScore?: number;
    readonly archiveRejectedKnowledgeAfterDays?: number;
    readonly staleUnreviewedKnowledgeDays?: number;
    readonly archiveOrphanKnowledgeReviewsAfterDays?: number;
    readonly knowledgeHistoryRetentionVersions?: number;
    readonly archiveKnowledgeRollbackAfterDays?: number;
  };
}

interface DirectorHostKnowledgeRecallPreviewRequest extends DirectorKnowledgeRecallQuery {}

interface DirectorMemoryIndexEntry {
  readonly recordId: string;
  readonly recordedAt: string;
}

interface DirectorMemoryIndexDocument {
  readonly entries?: readonly DirectorMemoryIndexEntry[];
}

interface DirectorHostTaxonomyCategoryRequest {
  readonly categoryId?: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly color?: string;
  readonly nowMs?: number;
}

interface DirectorHostExternalToolInvokeBody {
  readonly toolId: string;
  readonly name?: string;
  readonly operationId?: string;
  readonly action?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly dryRun?: boolean;
  readonly idempotencyKey?: string;
  readonly approval?: {
    readonly status: ExternalToolApprovalDecisionStatus;
    readonly operatorId?: string;
    readonly reason?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface DirectorHostTaxonomyTagRequest {
  readonly tagId?: string;
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
  readonly nowMs?: number;
}

interface DirectorHostTaxonomyBindingRequest {
  readonly categoryId?: string;
  readonly tagIds: readonly string[];
  readonly updatedBy?: string;
  readonly nowMs?: number;
}

interface DirectorApiProviderBridgeConstraint {
  readonly field: string;
  readonly requirement: string;
  readonly priority: string;
  readonly rationale?: string;
}

interface DirectorApiProviderBridgeEnvelope {
  readonly schemaId: typeof DIRECTOR_HTTP_JSON_BRIDGE_REQUEST_SCHEMA_ID;
  readonly runId: string;
  readonly assignmentId: string;
  readonly workerId: string;
  readonly adapterId: string;
  readonly provider: string;
  readonly role: string;
  readonly actionClass: string;
  readonly approvalMode: string;
  readonly objective: string;
  readonly deliverable: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly DirectorApiProviderBridgeConstraint[];
  readonly dependsOn: readonly string[];
}

interface DirectorHostRouteHint {
  readonly method: "GET" | "POST";
  readonly path: string;
}

interface DirectorHostConflictGuidance {
  readonly blockedRoute: DirectorHostRouteHint;
  readonly recommendedAction: string;
  readonly nextRoute?: DirectorHostRouteHint;
}

async function normalizeEntryMessageRequest(
  entryStore: FileSystemDirectorEntryStore,
  request: DirectorEntryMessageRequest,
): Promise<DirectorEntryMessageRequest> {
  const text = request.message.text?.trim();
  if (text === undefined || text.length === 0) {
    return request;
  }

  const target = resolveChannelSessionTarget(request.message.routingHint);
  const existing = await entryStore.loadSessionBySessionKey(target.sessionKey);
  const latestTurn = existing?.turns.find((turn) => turn.entryTurnId === existing.latestTurnId);
  const previousObjective = cleanUserFacingCommandText(latestTurn?.summary ?? "").trim();
  const turn = orchestrateConversationTurn({
    text,
    surface: inferConversationTurnSurface(request.message.channel),
    channel: request.message.channel,
    agentId: request.message.agentId,
    peerId: request.message.peerId,
    sessionKey: target.sessionKey,
    activeSession: {
      hasActiveSession: previousObjective.length > 0,
      sessionKey: target.sessionKey,
      ...(previousObjective.length > 0 ? { objective: previousObjective } : {}),
    },
  });
  if (turn.intent.kind !== "production-confirm" && turn.intent.kind !== "production-supplement") {
    return request;
  }

  const supplement = turn.intent.supplement;
  const nextText =
    supplement === undefined || supplement.trim().length === 0
      ? previousObjective
      : [
          previousObjective,
          `补充内容：${supplement.trim()}`,
          "执行意图：这是对上一条任务的确认或补充，不要把确认话术当作新的制作目标。",
        ].join("\n");

  return {
    ...request,
    message: {
      ...request.message,
      text: nextText,
    },
  };
}

function inferConversationTurnSurface(channel: string): "desktop" | "weixin" | "cli" | "api" {
  const normalized = channel.trim().toLowerCase();
  if (normalized.includes("desktop")) {
    return "desktop";
  }
  if (normalized.includes("weixin") || normalized.includes("wechat")) {
    return "weixin";
  }
  if (normalized.includes("cli")) {
    return "cli";
  }
  return "api";
}

export function createDirectorHostApiApp(
  options: BootstrapDirectorHostApiOptions = {},
): DirectorHostApiApp {
  const runtime = bootstrapDirectorHostApi(options);
  const hostEnv = options.env ?? process.env;
  const hostApiBearerToken = resolveHostApiBearerToken(hostEnv);
  const experienceFetchText =
    options.experienceFetchText ?? createConfiguredLearningFetchText(hostEnv);
  const workspacePaths = ensureDirectorWorkspace({ root: runtime.config.workspaceRoot });
  const executionService = new ExecutionRunService({
    store: new FileSystemRunStore({
      rootPath: join(workspacePaths.runtime, "execution"),
    }),
  });
  const entryStore = new FileSystemDirectorEntryStore({
    rootPath: join(workspacePaths.runtime, "entry"),
  });
  const knowledgeStore = new FileKnowledgeStore({ knowledgeDir: workspacePaths.knowledge });
  const experienceStore = new FileExperienceStore({
    experienceDir: join(workspacePaths.knowledge, "experience"),
  });
  const experienceTaxonomyStore = new FileExperienceTaxonomyStore({
    experienceDir: join(workspacePaths.knowledge, "experience"),
  });
  const memoryRecall = new FileSystemDirectorMemoryRecallPort({
    store: new FileSystemDirectorMemoryStore({
      rootPath: join(workspacePaths.runtime, "memory"),
    }),
  });
  const skillRepository = new FileBackedSkillRepository(
    new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath(runtime.config)),
  );
  const skillManagementStore = new SkillManagementStore(resolveSkillManagementPath(runtime.config));
  const skillTaxonomyStore = new FileSkillTaxonomyStore({
    skillsDir: join(runtime.config.dataDir, "skills"),
  });
  const skillPromptIndex = new SkillPromptIndex(skillRepository, {
    isSkillEnabled: (skill) => skillManagementStore.isSkillEnabled(skill.id),
  });
  const learningSink = new AppendOnlyFileLearningObservationSink(
    createDirectorObservationSinkOptions(runtime),
  );
  const server = createServer(async (request, response) => {
    try {
      assertHostApiRequestAuthorized(request, hostApiBearerToken);
      const requestRuntime = createActiveDirectorHostRuntime(runtime);
      const service = createDirectorServiceForRequest({
        runtime: requestRuntime,
        knowledgeStore,
        memoryRecall,
        skillPromptIndex,
        learningSink,
      });
      await handleRequest(
        request,
        response,
        requestRuntime,
        service,
        executionService,
        entryStore,
        knowledgeStore,
        experienceStore,
        experienceTaxonomyStore,
        skillRepository,
        skillManagementStore,
        skillTaxonomyStore,
        hostEnv,
        experienceFetchText,
        workspacePaths.runtime,
      );
    } catch (error) {
      const statusCode = error instanceof DirectorHostHttpError ? error.statusCode : 500;
      const body =
        error instanceof DirectorHostHttpError
          ? { code: error.code, message: error.message, metadata: error.metadata }
          : { code: "INTERNAL_ERROR", message: "Unexpected error" };
      writeJson(response, statusCode, body);
    }
  });

  return {
    runtime,
    async start(listenOptions: { host?: string; port?: number } = {}): Promise<{
      host: string;
      port: number;
    }> {
      const host = listenOptions.host ?? "127.0.0.1";
      const port = listenOptions.port ?? 3201;
      assertHostApiListenAuthBoundary(host, hostApiBearerToken);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Director host API server did not expose a TCP address.");
      }
      return {
        host: address.address,
        port: address.port,
      };
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }).catch((error: unknown) => {
        /* ignore */
      });
      runtime.sessionStore.close();
    },
  };
}

function createActiveDirectorHostRuntime(runtime: DirectorHostRuntime): DirectorHostRuntime {
  const apiProviderConfig = loadDirectorApiProviderConfig(
    join(runtime.config.workspaceRoot, ".director-angel", "providers"),
  );
  return {
    ...runtime,
    switchState: loadDirectorSwitchState(runtime.switchPath),
    apiProviders: summarizeDirectorHostApiProviders(apiProviderConfig.document.providers),
  };
}

function createDirectorServiceForRequest(input: {
  readonly runtime: DirectorHostRuntime;
  readonly knowledgeStore: FileKnowledgeStore;
  readonly memoryRecall: FileSystemDirectorMemoryRecallPort;
  readonly skillPromptIndex: SkillPromptIndex;
  readonly learningSink: AppendOnlyFileLearningObservationSink;
}): DirectorService {
  const { runtime, knowledgeStore, memoryRecall, skillPromptIndex, learningSink } = input;

  return new DirectorService({
    knowledgeStore,
    knowledgeRecall: {
      enabled: runtime.switchState.features["knowledgeRecall.enabled"],
    },
    skillPromptIndex,
    runtimeRegistry: createRuntimeRegistryPort(runtime),
    switches: createRuntimeSwitchesPort(runtime.switchState),
    runtimeMatcher: createRuntimeMatcherPort(runtime),
    ...(runtime.switchState.features["memory.enabled"]
      ? {
          memoryRecall,
          longTermMemory: createFileBackedLongTermMemoryPort(runtime.config.workspaceRoot),
        }
      : {}),
    learningSink,
  });
}

function createFileBackedLongTermMemoryPort(workspaceRoot: string): DirectorLongTermMemoryPort {
  const memoryDir = join(workspaceRoot, ".director-angel", "memory");

  return {
    load() {
      const signals = [
        readLongTermMemorySignal({
          path: join(memoryDir, "MEMORY.md"),
          id: "long-term-memory:memory",
          label: "MEMORY.md",
          tag: "memory",
          confidence: 0.78,
        }),
        readLongTermMemorySignal({
          path: join(memoryDir, "USER.md"),
          id: "long-term-memory:user",
          label: "USER.md",
          tag: "user",
          confidence: 0.72,
        }),
      ].filter((signal): signal is NonNullable<typeof signal> => signal !== null);

      return {
        status: signals.length > 0 ? "hit" : "miss",
        signals,
        notes:
          signals.length > 0
            ? [`Loaded ${signals.length} compact long-term memory signal(s).`]
            : ["No long-term memory files found in .director-angel/memory."],
      };
    },
  };
}

function readLongTermMemorySignal(input: {
  readonly path: string;
  readonly id: string;
  readonly label: string;
  readonly tag: string;
  readonly confidence: number;
}) {
  if (!existsSync(input.path)) {
    return null;
  }

  const compact = compactMarkdownMemory(readFileSync(input.path, "utf8"));
  if (compact.length === 0) {
    return null;
  }

  return {
    id: input.id,
    description: `${input.label}: ${compact}`,
    confidence: input.confidence,
    tags: ["long-term-memory", input.tag],
  };
}

function compactMarkdownMemory(content: string): string {
  return truncateText(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => line.replace(/^[-*]\s+/u, ""))
      .join(" "),
    420,
  );
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

async function createLongTermMemoryStatusResponse(
  runtime: DirectorHostRuntime,
): Promise<Record<string, unknown>> {
  const enabled = runtime.switchState.features["memory.enabled"] === true;
  const memoryDir = join(runtime.config.workspaceRoot, ".director-angel", "memory");
  const files = [
    inspectLongTermMemoryFile(memoryDir, "MEMORY.md", 2200),
    inspectLongTermMemoryFile(memoryDir, "USER.md", 1375),
  ];
  const port = createFileBackedLongTermMemoryPort(runtime.config.workspaceRoot);
  const recall = enabled
    ? await port.load({ normalizedInput: {} as Parameters<typeof port.load>[0]["normalizedInput"] })
    : {
        status: "disabled" as const,
        signals: [],
        notes: ["Long-term memory files exist, but memory.enabled is disabled."],
      };
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.long-term-memory-status.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    memoryDir,
    enabled,
    status: recall.status,
    files,
    signals: recall.signals,
    notes: [
      ...(enabled ? [] : ["memory.enabled is disabled; signals will not enter production recall."]),
      ...recall.notes,
    ],
  };
}

async function createMemoryStatusResponse(
  runtime: DirectorHostRuntime,
): Promise<Record<string, unknown>> {
  const enabled = runtime.switchState.features["memory.enabled"] === true;
  const memoryRoot = join(runtime.config.workspaceRoot, ".director-angel", "runtime", "memory");
  const store = new FileSystemDirectorMemoryStore({ rootPath: memoryRoot });
  const [status, latestRecord, longTerm] = await Promise.all([
    store.getStatus(),
    readLatestMemoryRecord(memoryRoot),
    createLongTermMemoryStatusResponse(runtime),
  ]);
  const storeStatus = status.status;
  const topStatus = enabled ? storeStatus : "disabled";

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.memory-status.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    enabled,
    status: topStatus,
    runtimeMemory: {
      enabled,
      memoryRoot,
      storeStatus,
      recordCount: status.recordCount,
      ...(status.lastRecordedAt === undefined ? {} : { lastRecordedAt: status.lastRecordedAt }),
      notes: [
        ...(enabled ? [] : ["memory.enabled is disabled; runtime memory will not be recalled."]),
        ...status.notes,
      ],
      latestRecord: latestRecord === null ? null : summarizeMemoryRecord(latestRecord),
    },
    longTerm,
  };
}

async function createMemoryRecallPreviewResponse(
  runtime: DirectorHostRuntime,
  query: DirectorRecallQuery,
): Promise<Record<string, unknown>> {
  const enabled = runtime.switchState.features["memory.enabled"] === true;
  const memoryRoot = join(runtime.config.workspaceRoot, ".director-angel", "runtime", "memory");
  const store = new FileSystemDirectorMemoryStore({ rootPath: memoryRoot });
  const [status, packet] = await Promise.all([
    store.getStatus(),
    enabled
      ? store.recall(query)
      : Promise.resolve({
          schemaVersion: DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
          queryId: "recall-disabled",
          status: "disabled" as const,
          recordedAt: new Date().toISOString(),
          notes: ["Director memory recall is disabled by switch."],
          hits: [],
          query,
          truncated: false,
        }),
  ]);

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.memory-recall-preview.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    enabled,
    runtimeMemory: {
      enabled,
      memoryRoot,
      storeStatus: status.status,
      recordCount: status.recordCount,
      ...(status.lastRecordedAt === undefined ? {} : { lastRecordedAt: status.lastRecordedAt }),
      notes: status.notes,
    },
    packet,
  };
}

async function createMemoryPublicationGovernanceResponse(
  runtime: DirectorHostRuntime,
  route: { readonly recordId: string; readonly action: DirectorMemoryPublicationAction },
  input: DirectorHostOperatorRequest,
): Promise<Record<string, unknown>> {
  const memoryRoot = join(runtime.config.workspaceRoot, ".director-angel", "runtime", "memory");
  const store = new FileSystemDirectorMemoryStore({ rootPath: memoryRoot });
  const governanceInput = {
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.note === undefined ? {} : { reason: input.note }),
    ...(input.now === undefined ? {} : { decidedAt: input.now }),
  };
  const result =
    route.action === "retract"
      ? await store.retractPublication(route.recordId, governanceInput)
      : route.action === "demote"
        ? await store.demotePublication(route.recordId, governanceInput)
        : route.action === "quarantine"
          ? await store.quarantinePublication(route.recordId, governanceInput)
          : await store.restorePublication(route.recordId, governanceInput);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.memory-publication-governance.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    memoryRoot,
    action: route.action,
    recordId: route.recordId,
    result,
    text: formatMemoryPublicationGovernanceText(route.action, result),
  };
}

async function createMemoryPublicationsResponse(
  runtime: DirectorHostRuntime,
  url: URL,
): Promise<Record<string, unknown>> {
  const memoryRoot = join(runtime.config.workspaceRoot, ".director-angel", "runtime", "memory");
  const status = parseOptionalMemoryPublicationGovernanceStatus(url.searchParams.get("status"));
  const limit =
    parseOptionalUrlPositiveInteger(
      url.searchParams.get("limit"),
      "limit",
      "INVALID_MEMORY_PUBLICATIONS_REQUEST",
    ) ?? 100;
  const publications = await listRuntimeMemoryPublications(memoryRoot);
  const filtered =
    status === undefined
      ? publications
      : publications.filter((publication) => publication.governanceStatus === status);
  const items = [...filtered]
    .sort(
      (left, right) =>
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
        left.recordId.localeCompare(right.recordId),
    )
    .slice(0, limit)
    .map(formatHostMemoryPublication);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.memory-publications.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    memoryRoot,
    ...(status === undefined ? {} : { status }),
    count: items.length,
    totalMatching: filtered.length,
    items,
  };
}

function createLearningArtifactsResponse(
  runtime: DirectorHostRuntime,
  url: URL,
): Record<string, unknown> {
  const storePath = resolveHostLearningArtifactStorePath(runtime);
  const sessionKey = normalizeOptionalUrlSearchParam(url.searchParams.get("sessionKey"));
  const status = normalizeOptionalUrlSearchParam(url.searchParams.get("status"));
  const limit =
    parseOptionalUrlPositiveInteger(
      url.searchParams.get("limit"),
      "limit",
      "INVALID_LEARNING_ARTIFACTS_REQUEST",
    ) ?? 50;
  const document = readHostLearningArtifactDocument(storePath);
  const artifacts = document.artifacts
    .filter((artifact) => sessionKey === undefined || artifact.sessionKey === sessionKey)
    .filter((artifact) => status === undefined || artifact.status === status);
  const items = [...artifacts]
    .sort(
      (left, right) =>
        readHostLearningTimestamp(right, "createdAtMs") -
          readHostLearningTimestamp(left, "createdAtMs") ||
        readHostLearningString(left, "artifactId").localeCompare(
          readHostLearningString(right, "artifactId"),
        ),
    )
    .slice(0, limit);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.learning-artifacts.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    storePath,
    filters: {
      ...(sessionKey === undefined ? {} : { sessionKey }),
      ...(status === undefined ? {} : { status }),
    },
    count: items.length,
    totalMatching: artifacts.length,
    items,
  };
}

function createLearningConfirmationsResponse(
  runtime: DirectorHostRuntime,
  url: URL,
): Record<string, unknown> {
  const storePath = resolveHostLearningArtifactStorePath(runtime);
  const sessionKey = normalizeOptionalUrlSearchParam(url.searchParams.get("sessionKey"));
  const status = normalizeOptionalUrlSearchParam(url.searchParams.get("status")) ?? "pending";
  const limit =
    parseOptionalUrlPositiveInteger(
      url.searchParams.get("limit"),
      "limit",
      "INVALID_LEARNING_CONFIRMATIONS_REQUEST",
    ) ?? 50;
  if (sessionKey === undefined && status === "pending") {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_CONFIRMATIONS_REQUEST",
      "Query parameter sessionKey is required when listing pending learning confirmations.",
    );
  }
  const document = readHostLearningArtifactDocument(storePath);
  const confirmations = document.confirmations
    .filter((confirmation) => sessionKey === undefined || confirmation.sessionKey === sessionKey)
    .filter((confirmation) => confirmation.status === status);
  const items = [...confirmations]
    .sort(
      (left, right) =>
        readHostLearningTimestamp(right, "createdAtMs") -
          readHostLearningTimestamp(left, "createdAtMs") ||
        readHostLearningString(left, "confirmationId").localeCompare(
          readHostLearningString(right, "confirmationId"),
        ),
    )
    .slice(0, limit);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.learning-confirmations.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    storePath,
    filters: {
      ...(sessionKey === undefined ? {} : { sessionKey }),
      status,
    },
    count: items.length,
    totalMatching: confirmations.length,
    items,
  };
}

function resolveHostLearningArtifactStorePath(runtime: DirectorHostRuntime): string {
  return join(runtime.config.dataDir, "conversation-runtime", "learning-artifacts.json");
}

function readHostLearningString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readHostLearningTimestamp(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readHostLearningArtifactDocument(path: string): {
  readonly artifacts: readonly Record<string, unknown>[];
  readonly confirmations: readonly Record<string, unknown>[];
} {
  if (!existsSync(path)) {
    return {
      artifacts: [],
      confirmations: [],
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return {
        artifacts: [],
        confirmations: [],
      };
    }
    return {
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.filter(isRecord) : [],
      confirmations: Array.isArray(parsed.confirmations)
        ? parsed.confirmations.filter(isRecord)
        : [],
    };
  } catch {
    return {
      artifacts: [],
      confirmations: [],
    };
  }
}

type HostEvidenceKind = "source" | "memory" | "artifact-content" | "tool-result";

interface HostEvidenceProjection {
  readonly evidenceId: string;
  readonly kind: HostEvidenceKind;
  readonly sourceKind: string;
  readonly sourceRef: string;
  readonly sourceSnapshotId?: string;
  readonly sourceAccessStatus: string;
  readonly sourceAccessError?: string;
  readonly publishable: boolean;
  readonly privacy: string;
  readonly observedAtMs: number;
  readonly preview: string;
  readonly contentLength: number;
  readonly evidenceRefs: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly content?: string;
}

async function createEvidenceListResponse(
  runtime: DirectorHostRuntime,
  url: URL,
  experienceStore: FileExperienceStore,
): Promise<Record<string, unknown>> {
  const scope = parseEvidenceScopeFromUrl(url);
  const records = await listHostEvidenceRecords(runtime, experienceStore);
  const filtered = filterHostEvidenceByScope(records, scope);
  const limit =
    parseOptionalUrlPositiveInteger(
      url.searchParams.get("limit"),
      "limit",
      "INVALID_EVIDENCE_REQUEST",
    ) ?? 50;
  const items = [...filtered]
    .sort(
      (left, right) =>
        right.observedAtMs - left.observedAtMs || left.evidenceId.localeCompare(right.evidenceId),
    )
    .slice(0, limit)
    .map(formatHostEvidenceSummary);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.evidence-list.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    scope,
    count: items.length,
    totalMatching: filtered.length,
    items,
  };
}

async function createEvidenceDetailResponse(
  runtime: DirectorHostRuntime,
  evidenceId: string,
  experienceStore: FileExperienceStore,
): Promise<Record<string, unknown>> {
  const record = await findHostEvidenceRecord(runtime, experienceStore, evidenceId);
  if (record === null) {
    throw new DirectorHostHttpError(
      404,
      "EVIDENCE_NOT_FOUND",
      `没有找到这条 evidence：${evidenceId}`,
    );
  }
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.evidence-detail.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    evidence: formatHostEvidenceSummary(record),
  };
}

async function createEvidenceContentResponse(
  runtime: DirectorHostRuntime,
  evidenceId: string,
  experienceStore: FileExperienceStore,
  url: URL,
): Promise<Record<string, unknown>> {
  const record = await findHostEvidenceRecord(runtime, experienceStore, evidenceId);
  if (record === null) {
    throw new DirectorHostHttpError(
      404,
      "EVIDENCE_NOT_FOUND",
      `没有找到这条 evidence：${evidenceId}`,
    );
  }
  const maxChars =
    parseOptionalUrlPositiveInteger(
      url.searchParams.get("maxChars"),
      "maxChars",
      "INVALID_EVIDENCE_REQUEST",
    ) ?? 4000;
  const content = record.content ?? record.preview;
  const truncated = content.length > maxChars;
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.evidence-content.v1",
    workspaceRoot: runtime.config.workspaceRoot,
    evidenceId: record.evidenceId,
    sourceRef: record.sourceRef,
    content: truncated ? content.slice(0, maxChars) : content,
    truncated,
    contentLength: content.length,
    privacy: record.privacy,
  };
}

async function listHostEvidenceRecords(
  runtime: DirectorHostRuntime,
  experienceStore: FileExperienceStore,
): Promise<readonly HostEvidenceProjection[]> {
  const memoryRoot = join(runtime.config.workspaceRoot, ".director-angel", "runtime", "memory");
  const [artifacts, quarantines, memoryEvidence, toolEvidence] = await Promise.all([
    experienceStore.listSourceArtifacts(),
    experienceStore.listQuarantineRecords(),
    listRuntimeMemoryPublicationEvidence(memoryRoot),
    listConversationRuntimeToolEvidence(runtime.config.dataDir),
  ]);
  const artifactIds = new Set(artifacts.map((artifact) => artifact.artifactId));
  return [
    ...artifacts.map((artifact) => projectExperienceArtifactEvidence(artifact, undefined)),
    ...quarantines
      .filter((record) => !artifactIds.has(record.artifact.artifactId))
      .map((record) => projectExperienceArtifactEvidence(record.artifact, record)),
    ...memoryEvidence,
    ...toolEvidence,
  ];
}

async function findHostEvidenceRecord(
  runtime: DirectorHostRuntime,
  experienceStore: FileExperienceStore,
  evidenceId: string,
): Promise<HostEvidenceProjection | null> {
  const records = await listHostEvidenceRecords(runtime, experienceStore);
  return records.find((record) => record.evidenceId === evidenceId) ?? null;
}

function parseEvidenceScopeFromUrl(url: URL): Record<string, string> {
  const sessionKey = normalizeOptionalUrlSearchParam(url.searchParams.get("sessionKey"));
  const turnId = normalizeOptionalUrlSearchParam(url.searchParams.get("turnId"));
  const turnRunId = normalizeOptionalUrlSearchParam(url.searchParams.get("turnRunId"));
  const toolName = normalizeOptionalUrlSearchParam(url.searchParams.get("toolName"));
  const runId = normalizeOptionalUrlSearchParam(url.searchParams.get("runId"));
  const taskId = normalizeOptionalUrlSearchParam(url.searchParams.get("taskId"));
  const sourceRef = normalizeOptionalUrlSearchParam(url.searchParams.get("sourceRef"));
  const sourceSnapshotId = normalizeOptionalUrlSearchParam(
    url.searchParams.get("sourceSnapshotId"),
  );
  if (
    sessionKey === undefined &&
    turnId === undefined &&
    turnRunId === undefined &&
    toolName === undefined &&
    runId === undefined &&
    taskId === undefined &&
    sourceRef === undefined &&
    sourceSnapshotId === undefined
  ) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_EVIDENCE_SCOPE",
      "查看 evidence 必须带一个范围：sessionKey、turnId、turnRunId、toolName、runId、taskId、sourceRef 或 sourceSnapshotId。",
    );
  }
  return {
    ...(sessionKey === undefined ? {} : { sessionKey }),
    ...(turnId === undefined ? {} : { turnId }),
    ...(turnRunId === undefined ? {} : { turnRunId }),
    ...(toolName === undefined ? {} : { toolName }),
    ...(runId === undefined ? {} : { runId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(sourceRef === undefined ? {} : { sourceRef }),
    ...(sourceSnapshotId === undefined ? {} : { sourceSnapshotId }),
  };
}

function filterHostEvidenceByScope(
  records: readonly HostEvidenceProjection[],
  scope: Record<string, string>,
): readonly HostEvidenceProjection[] {
  return records.filter((record) =>
    Object.entries(scope).every(([key, value]) => matchHostEvidenceScope(record, key, value)),
  );
}

function matchHostEvidenceScope(
  record: HostEvidenceProjection,
  key: string,
  value: string,
): boolean {
  if (key === "sourceRef") {
    return record.sourceRef === value;
  }
  if (key === "sourceSnapshotId") {
    return record.sourceSnapshotId === value || record.evidenceRefs.includes(value);
  }
  const metadataValue = record.metadata[key];
  if (typeof metadataValue === "string") {
    return metadataValue === value;
  }
  if (Array.isArray(metadataValue)) {
    return metadataValue.some((entry) => entry === value);
  }
  return false;
}

function projectExperienceArtifactEvidence(
  artifact: ExperienceSourceArtifact,
  quarantine: ExperienceQuarantineRecord | undefined,
): HostEvidenceProjection {
  const accessStatus = resolveLearningSourceAccessStatus(artifact, quarantine?.reason);
  const content = artifact.readableContent ?? artifact.rawContent ?? artifact.textPreview;
  const evidenceId = `source-evidence-${shortHash(`${artifact.artifactId}:${artifact.sourceRef}`)}`;
  const metadata = compactEvidenceMetadata({
    family: "learning-source",
    artifactId: artifact.artifactId,
    qualityScore: artifact.quality.score,
    qualityVerdict: artifact.quality.verdict,
    provenance: artifact.provenance,
    contentType: artifact.contentType,
    path: artifact.path,
    ...(quarantine === undefined
      ? {}
      : {
          quarantineId: quarantine.quarantineId,
          quarantineReason: quarantine.reason,
        }),
  });
  return {
    evidenceId,
    kind: "source",
    sourceKind: mapLearningSourceKind(artifact.sourceKind),
    sourceRef: artifact.sourceRef,
    sourceSnapshotId: artifact.artifactId,
    sourceAccessStatus: accessStatus,
    ...(accessStatus === "available"
      ? {}
      : {
          sourceAccessError: quarantine?.reason ?? artifact.quality.reasons[0] ?? "source limited",
        }),
    publishable: artifact.quality.verdict === "usable" && accessStatus === "available",
    privacy: mapExperiencePrivacyToEvidencePrivacy(artifact.privacy),
    observedAtMs: artifact.capturedAtMs,
    preview: truncateText(artifact.textPreview || content, 1200),
    contentLength: content.length,
    evidenceRefs: [artifact.artifactId],
    metadata,
    content,
  };
}

async function listRuntimeMemoryPublicationEvidence(
  memoryRoot: string,
): Promise<readonly HostEvidenceProjection[]> {
  const publications = await listRuntimeMemoryPublications(memoryRoot);
  return publications.map(projectRuntimeMemoryPublicationEvidence);
}

async function listRuntimeMemoryPublications(
  memoryRoot: string,
): Promise<readonly HostMemoryPublicationProjection[]> {
  const publicationsRoot = join(memoryRoot, "publications");
  const entries = await readDirectoryEntries(publicationsRoot);
  const records: HostMemoryPublicationProjection[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith("._")) {
      continue;
    }
    try {
      const value = JSON.parse(
        await readFile(join(publicationsRoot, entry.name), "utf8"),
      ) as unknown;
      const record = projectRuntimeMemoryPublication(value);
      if (record !== null) {
        records.push(record);
      }
    } catch {}
  }
  return records;
}

async function readDirectoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function projectRuntimeMemoryPublication(value: unknown): HostMemoryPublicationProjection | null {
  if (!isRecord(value)) {
    return null;
  }
  const recordId = readStringProperty(value, "recordId");
  const candidateId = readStringProperty(value, "candidateId");
  const publishedAt = readStringProperty(value, "publishedAt");
  if (recordId === null || candidateId === null || publishedAt === null) {
    return null;
  }
  const sourceRefs = Array.isArray(value.evidenceRefs)
    ? value.evidenceRefs.flatMap((ref): HostMemoryEvidenceRefProjection[] => {
        if (!isRecord(ref)) {
          return [];
        }
        const evidenceId = readStringProperty(ref, "evidenceId");
        const sourceRef = readStringProperty(ref, "sourceRef");
        if (evidenceId === null || sourceRef === null) {
          return [];
        }
        const sourceKind = readStringProperty(ref, "sourceKind");
        const sourceSnapshotId = readStringProperty(ref, "sourceSnapshotId");
        const summary = readStringProperty(ref, "summary");
        return [
          {
            evidenceId,
            ...(sourceKind === null ? {} : { sourceKind }),
            sourceRef,
            ...(sourceSnapshotId === null ? {} : { sourceSnapshotId }),
            ...(summary === null ? {} : { summary }),
          },
        ];
      })
    : [];
  const summary = readStringProperty(value, "summary") ?? `Published memory ${recordId}`;
  const governanceStatus = readMemoryPublicationGovernanceStatus(value.governanceStatus);
  const governanceAudit = Array.isArray(value.governanceAudit)
    ? value.governanceAudit.flatMap(projectMemoryGovernanceAudit)
    : [];
  const actor = readStringProperty(value, "actor");
  const note = readStringProperty(value, "note");
  return {
    recordId,
    candidateId,
    publishedAt,
    ...(actor === null ? {} : { actor }),
    ...(note === null ? {} : { note }),
    summary,
    evidenceRefs: sourceRefs,
    governanceStatus,
    governanceAudit,
  };
}

function projectRuntimeMemoryPublicationEvidence(
  publication: HostMemoryPublicationProjection,
): HostEvidenceProjection {
  const firstRef = publication.evidenceRefs[0];
  return {
    evidenceId: `memory-publication-${slugifyRouteToken(publication.recordId)}`,
    kind: "memory",
    sourceKind: firstRef?.sourceKind ?? "memory",
    sourceRef: firstRef?.sourceRef ?? `memory://${publication.recordId}`,
    ...(firstRef?.sourceSnapshotId === undefined
      ? {}
      : { sourceSnapshotId: firstRef.sourceSnapshotId }),
    sourceAccessStatus: "available",
    publishable: false,
    privacy: "private",
    observedAtMs: Date.parse(publication.publishedAt) || 0,
    preview: truncateText(publication.summary, 1200),
    contentLength: publication.summary.length,
    evidenceRefs: publication.evidenceRefs.map((ref) => ref.evidenceId),
    metadata: compactEvidenceMetadata({
      family: "runtime-memory-publication",
      recordId: publication.recordId,
      candidateId: publication.candidateId,
      publishedAt: publication.publishedAt,
      governanceStatus: publication.governanceStatus,
      sourceRefs: publication.evidenceRefs,
    }),
    content: publication.summary,
  };
}

async function listConversationRuntimeToolEvidence(
  dataDir: string,
): Promise<readonly HostEvidenceProjection[]> {
  const store = createConversationRuntimeToolEvidenceStoreForDataDir(dataDir);
  return store
    .listToolResultEvidence()
    .map((entry) => projectConversationRuntimeToolEvidence(store, entry));
}

function createConversationRuntimeToolEvidenceStoreForDataDir(dataDir: string) {
  return createFileConversationRuntimeToolEvidenceStore({
    rootPath: join(dataDir, "conversation-runtime", "tool-evidence"),
  });
}

function projectConversationRuntimeToolEvidence(
  store: ReturnType<typeof createFileConversationRuntimeToolEvidenceStore>,
  entry: ConversationRuntimeToolEvidenceIndexEntry,
): HostEvidenceProjection {
  const record = store.readToolResultEvidence(entry.evidenceId);
  const content = store.readToolResultEvidenceContent(entry.evidenceId)?.content;
  const preview =
    readStringProperty(record?.evidence.metadata, "preview") ?? truncateText(content ?? "", 1200);
  return {
    evidenceId: entry.evidenceId,
    kind: "tool-result",
    sourceKind: entry.sourceKind,
    sourceRef: entry.sourceRef,
    sourceAccessStatus: entry.sourceAccessStatus,
    publishable: entry.publishable,
    privacy: record?.evidence.privacy ?? "pii_potential",
    observedAtMs: entry.observedAtMs,
    preview,
    contentLength: content?.length ?? entry.contentSizeBytes,
    evidenceRefs: [entry.evidenceId],
    metadata: compactEvidenceMetadata({
      family: "conversation-runtime-tool-result",
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      turnId: entry.turnId,
      turnRunId: entry.turnRunId,
      sessionKey: entry.sessionKey,
      contentRef: entry.contentRef,
      ...(record?.evidence.metadata ?? {}),
    }),
    ...(content === undefined ? {} : { content }),
  };
}

function projectMemoryGovernanceAudit(value: unknown): HostMemoryGovernanceAuditProjection[] {
  if (!isRecord(value)) {
    return [];
  }
  const decidedAt = readStringProperty(value, "decidedAt");
  const previousStatus = readMemoryPublicationGovernanceStatus(value.previousStatus);
  const nextStatus = readMemoryPublicationGovernanceStatus(value.nextStatus);
  if (decidedAt === null) {
    return [];
  }
  const actor = readStringProperty(value, "actor");
  const note = readStringProperty(value, "note");
  const reason = readStringProperty(value, "reason");
  return [
    {
      ...(actor === null ? {} : { actor }),
      ...(note === null ? {} : { note }),
      ...(reason === null ? {} : { reason }),
      decidedAt,
      previousStatus,
      nextStatus,
    },
  ];
}

function formatHostMemoryPublication(
  publication: HostMemoryPublicationProjection,
): Record<string, unknown> {
  return {
    recordId: publication.recordId,
    candidateId: publication.candidateId,
    publishedAt: publication.publishedAt,
    ...(publication.actor === undefined ? {} : { actor: publication.actor }),
    ...(publication.note === undefined ? {} : { note: publication.note }),
    summary: publication.summary,
    governanceStatus: publication.governanceStatus,
    governanceAudit: publication.governanceAudit.map((entry) => ({ ...entry })),
    evidenceRefs: publication.evidenceRefs.map((ref) => ({ ...ref })),
    evidenceIds: publication.evidenceRefs.map((ref) => ref.evidenceId),
    text: formatMemoryPublicationStatusText(publication),
  };
}

function formatMemoryPublicationStatusText(publication: HostMemoryPublicationProjection): string {
  return `${formatMemoryGovernanceStatusChinese(publication.governanceStatus)}：${
    publication.recordId
  }，证据 ${publication.evidenceRefs.length} 条`;
}

function readMemoryPublicationGovernanceStatus(
  value: unknown,
): DirectorMemoryPublicationGovernanceStatus {
  return isMemoryPublicationGovernanceStatus(value) ? value : "published";
}

function parseOptionalMemoryPublicationGovernanceStatus(
  value: string | null,
): DirectorMemoryPublicationGovernanceStatus | undefined {
  const normalized = normalizeOptionalUrlSearchParam(value);
  if (normalized === undefined) {
    return undefined;
  }
  if (!isMemoryPublicationGovernanceStatus(normalized)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_MEMORY_PUBLICATIONS_REQUEST",
      "记忆发布列表的 status 只能是 published、retracted、demoted 或 quarantined。",
    );
  }
  return normalized;
}

function isMemoryPublicationGovernanceStatus(
  value: unknown,
): value is DirectorMemoryPublicationGovernanceStatus {
  return (
    value === "published" || value === "retracted" || value === "demoted" || value === "quarantined"
  );
}

function formatHostEvidenceSummary(record: HostEvidenceProjection): Record<string, unknown> {
  return {
    evidenceId: record.evidenceId,
    kind: record.kind,
    sourceKind: record.sourceKind,
    sourceRef: record.sourceRef,
    ...(record.sourceSnapshotId === undefined ? {} : { sourceSnapshotId: record.sourceSnapshotId }),
    sourceAccessStatus: record.sourceAccessStatus,
    ...(record.sourceAccessError === undefined
      ? {}
      : { sourceAccessError: record.sourceAccessError }),
    publishable: record.publishable,
    privacy: record.privacy,
    observedAtMs: record.observedAtMs,
    preview: record.preview,
    contentLength: record.contentLength,
    evidenceRefs: [...record.evidenceRefs],
    metadata: record.metadata,
  };
}

function compactEvidenceMetadata(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      metadata[key] = value;
    }
  }
  return metadata;
}

function mapExperiencePrivacyToEvidencePrivacy(privacy: ExperiencePrivacyClassification): string {
  return privacy === "public" ? "public" : privacy === "internal" ? "pii_potential" : "private";
}

function createV1CapabilitiesResponse(runtime: DirectorHostRuntime): Record<string, unknown> {
  const adapters = runtime.adapterRegistry.listAll();
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-capabilities.v1",
    runtimeId: runtime.runtimeCapabilitySnapshot.runtimeId,
    resources: [
      "/v1/client-bindings",
      "/v1/sessions",
      "/v1/sessions/{id}/messages",
      "/v1/tasks",
      "/v1/tasks/{id}",
      "/v1/tasks/{id}/cancel",
      "/v1/tasks/{id}/events",
      "/v1/client-runtime",
      "/v1/client-runtime/tasks/{id}",
      "/v1/client-runtime/tasks/{id}/stop",
      "/v1/client-runtime/tasks/{id}/followup",
      "/v1/client-runtime/tasks/{id}/steer",
      "/v1/capabilities",
      "/v1/catalog/model-adapters",
      "/v1/catalog/knowledge-packs",
      "/v1/tools/catalog",
      "/v1/tools/effective",
      "/v1/tools/invoke",
      "/v1/learning/jobs",
      "/v1/learning/jobs/{id}/run",
      "/v1/learning/artifacts",
      "/v1/learning/confirmations",
      "/v1/maintenance",
      "/v1/evidence",
      "/v1/evidence/{id}",
      "/v1/evidence/{id}/content",
      "/v1/memory/publications",
      "/v1/memory/publications/{recordId}/{action}",
    ],
    streaming: {
      sse: true,
      contentType: "text/event-stream",
      eventResources: ["/v1/tasks/{id}/events"],
    },
    taskLifecycle: {
      submit: true,
      status: true,
      cancel: true,
      events: true,
    },
    learningJobs: {
      supportedKinds: ["text", "directory", "url", "query"],
    },
    adapters: {
      total: adapters.length,
      media: adapters.filter((adapter) => adapter.adapterKind === "media").length,
      execution: adapters.filter((adapter) => adapter.adapterKind === "execution").length,
    },
    tools: {
      catalog: runtime.externalToolControlPlane !== undefined,
      effective: runtime.externalToolControlPlane !== undefined,
      invoke: runtime.externalToolControlPlane !== undefined,
      source:
        runtime.externalToolControlPlane === undefined
          ? "not-configured"
          : "external-tool-control-plane",
    },
  };
}

async function createHostClientRuntimeListResponse(
  executionService: ExecutionRunService,
  runtimeRoot: string,
  url: URL,
): Promise<Record<string, unknown>> {
  const clientSurface = normalizeOptionalUrlSearchParam(url.searchParams.get("clientSurface"));
  const clientRuntime = await inspectHostClientRuntime(executionService, runtimeRoot, {
    activeOnly:
      parseOptionalUrlBoolean(
        url.searchParams.get("activeOnly"),
        "activeOnly",
        "INVALID_CLIENT_RUNTIME_REQUEST",
      ) ?? false,
    ...(clientSurface === undefined ? {} : { clientSurface }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.client-runtime.v1",
    clientRuntime,
  };
}

async function createHostClientRuntimeTaskResponse(
  executionService: ExecutionRunService,
  taskId: string,
  url: URL,
): Promise<Record<string, unknown>> {
  const run = await executionService.getRun(taskId);
  if (run === null) {
    throw new DirectorHostHttpError(
      404,
      "CLIENT_RUNTIME_TASK_NOT_FOUND",
      `Unknown task: ${taskId}`,
    );
  }
  const clientSurface = normalizeOptionalUrlSearchParam(url.searchParams.get("clientSurface"));
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.client-runtime-task.v1",
    clientRuntimeTask: formatHostClientRuntimeTask(run, {
      ...(clientSurface === undefined ? {} : { clientSurface }),
      detail: true,
    }),
    run,
  };
}

async function stopHostClientRuntimeTask(
  executionService: ExecutionRunService,
  taskId: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const input = parseHostClientRuntimeStopRequest(value);
  const before = await executionService.getRun(taskId);
  if (before === null) {
    throw new DirectorHostHttpError(
      404,
      "CLIENT_RUNTIME_TASK_NOT_FOUND",
      `Unknown task: ${taskId}`,
    );
  }
  const alreadyTerminal = !isStoppableHostExecutionRunStatus(before.status);
  const run = alreadyTerminal ? before : await executionService.abortRun(taskId);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.client-runtime-stop.v1",
    clientRuntimeStop: {
      schemaVersion: "director.client-runtime.stop.v1",
      clientSurface: input.clientSurface ?? "host",
      originRuntime: "host.executionRun",
      stopped: alreadyTerminal ? 0 : 1,
      taskIds: [taskId],
      sessionIds: [],
      conversationTaskIds: [],
      conversationTurnRunIds: [],
      conversationSubagentRunIds: [],
      errors: [],
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    },
    run,
  };
}

async function followupHostClientRuntimeTask(
  executionService: ExecutionRunService,
  entryStore: FileSystemDirectorEntryStore,
  taskId: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const input = parseHostClientRuntimeFollowupRequest(value);
  const before = await executionService.getRun(taskId);
  if (before === null) {
    throw new DirectorHostHttpError(
      404,
      "CLIENT_RUNTIME_TASK_NOT_FOUND",
      `Unknown task: ${taskId}`,
    );
  }

  const approvedAssignmentIds: string[] = [];
  let run = before;
  if (isTerminalHostExecutionRunStatus(run.status)) {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.client-runtime-followup.v1",
      clientRuntimeFollowup: {
        schemaVersion: "director.client-runtime.followup.v1",
        clientSurface: input.clientSurface ?? "host",
        originRuntime: "host.executionRun",
        accepted: false,
        status: "terminal",
        continued: 0,
        taskIds: [taskId],
        approvedAssignmentIds,
        reason: "这个运行已经结束，不能继续推进。",
        ...(input.reason === undefined ? {} : { operatorReason: input.reason }),
      },
      run,
    };
  }

  for (const assignment of selectHostPendingOperatorAssignments(run)) {
    run = await executionService.approveAssignment(taskId, assignment.assignmentId);
    approvedAssignmentIds.push(assignment.assignmentId);
  }

  if (run.status === "created") {
    run = await executionService.startRun(taskId);
  } else if (run.status === "paused") {
    run = await executionService.resumeRun(taskId);
  }

  await syncHostEntryRunProjection(entryStore, input.entrySessionId, run);

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.client-runtime-followup.v1",
    clientRuntimeFollowup: {
      schemaVersion: "director.client-runtime.followup.v1",
      clientSurface: input.clientSurface ?? "host",
      originRuntime: "host.executionRun",
      accepted: true,
      status: run.status,
      continued: 1,
      taskIds: [taskId],
      approvedAssignmentIds,
      ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    },
    run,
  };
}

async function steerHostClientRuntimeTask(
  executionService: ExecutionRunService,
  taskId: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const input = parseHostClientRuntimeSteerRequest(value);
  const run = await executionService.getRun(taskId);
  if (run === null) {
    throw new DirectorHostHttpError(
      404,
      "CLIENT_RUNTIME_TASK_NOT_FOUND",
      `Unknown task: ${taskId}`,
    );
  }
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.client-runtime-steer.v1",
    clientRuntimeSteer: {
      schemaVersion: "director.client-runtime.steer.v1",
      clientSurface: input.clientSurface ?? "host",
      originRuntime: "host.executionRun",
      accepted: false,
      status: "unsupported",
      taskIds: [taskId],
      reason: "当前运行体不支持中途改指令；要改目标，请用 followup 补充生成新一轮或重新创建运行。",
      ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
    },
    run,
  };
}

function parseHostClientRuntimeStopRequest(value: unknown): {
  readonly reason?: string;
  readonly clientSurface?: string;
} {
  const record = isRecord(value) ? value : {};
  const reason = parseOptionalTrimmedStringWithCode(record.reason, "reason", {
    code: "INVALID_CLIENT_RUNTIME_STOP_REQUEST",
  });
  const clientSurface = parseOptionalTrimmedStringWithCode(record.clientSurface, "clientSurface", {
    code: "INVALID_CLIENT_RUNTIME_STOP_REQUEST",
  });
  return {
    ...(reason === undefined ? {} : { reason }),
    ...(clientSurface === undefined ? {} : { clientSurface }),
  };
}

function parseHostClientRuntimeFollowupRequest(value: unknown): {
  readonly reason?: string;
  readonly instruction?: string;
  readonly entrySessionId?: string;
  readonly clientSurface?: string;
} {
  const record = isRecord(value) ? value : {};
  const reason = parseOptionalTrimmedStringWithCode(record.reason, "reason", {
    code: "INVALID_CLIENT_RUNTIME_FOLLOWUP_REQUEST",
  });
  const instruction = parseOptionalTrimmedStringWithCode(record.instruction, "instruction", {
    code: "INVALID_CLIENT_RUNTIME_FOLLOWUP_REQUEST",
  });
  const entrySessionId = parseOptionalTrimmedStringWithCode(
    record.entrySessionId,
    "entrySessionId",
    {
      code: "INVALID_CLIENT_RUNTIME_FOLLOWUP_REQUEST",
    },
  );
  const clientSurface = parseOptionalTrimmedStringWithCode(record.clientSurface, "clientSurface", {
    code: "INVALID_CLIENT_RUNTIME_FOLLOWUP_REQUEST",
  });
  return {
    ...(reason === undefined ? {} : { reason }),
    ...(instruction === undefined ? {} : { instruction }),
    ...(entrySessionId === undefined ? {} : { entrySessionId }),
    ...(clientSurface === undefined ? {} : { clientSurface }),
  };
}

function parseHostClientRuntimeSteerRequest(value: unknown): {
  readonly instruction?: string;
  readonly clientSurface?: string;
} {
  const record = isRecord(value) ? value : {};
  const instruction = parseOptionalTrimmedStringWithCode(record.instruction, "instruction", {
    code: "INVALID_CLIENT_RUNTIME_STEER_REQUEST",
  });
  const clientSurface = parseOptionalTrimmedStringWithCode(record.clientSurface, "clientSurface", {
    code: "INVALID_CLIENT_RUNTIME_STEER_REQUEST",
  });
  return {
    ...(instruction === undefined ? {} : { instruction }),
    ...(clientSurface === undefined ? {} : { clientSurface }),
  };
}

async function createHostExternalToolsCatalogResponse(
  runtime: DirectorHostRuntime,
  url: URL,
): Promise<unknown> {
  const controlPlane = requireHostExternalToolControlPlane(runtime);
  const agentId = normalizeOptionalUrlSearchParam(url.searchParams.get("agentId"));
  return createExternalToolsCatalogRpcResult(controlPlane, {
    ...(agentId === undefined ? {} : { agentId }),
  });
}

async function createHostExternalToolsEffectiveResponse(
  runtime: DirectorHostRuntime,
  url: URL,
): Promise<unknown> {
  const controlPlane = requireHostExternalToolControlPlane(runtime);
  const agentId = normalizeOptionalUrlSearchParam(url.searchParams.get("agentId"));
  const sessionKey = normalizeOptionalUrlSearchParam(url.searchParams.get("sessionKey"));
  const profile = normalizeOptionalUrlSearchParam(url.searchParams.get("profile"));
  return createExternalToolsEffectiveRpcResult(controlPlane, {
    ...(agentId === undefined ? {} : { agentId }),
    ...(sessionKey === undefined ? {} : { sessionKey }),
    ...(profile === undefined ? {} : { profile }),
    includeUnavailable:
      parseOptionalUrlBoolean(
        url.searchParams.get("includeUnavailable"),
        "includeUnavailable",
        "INVALID_TOOLS_EFFECTIVE_REQUEST",
      ) ?? true,
  });
}

async function invokeHostExternalTool(
  runtime: DirectorHostRuntime,
  value: unknown,
): Promise<unknown> {
  const controlPlane = requireHostExternalToolControlPlane(runtime);
  const request = parseHostExternalToolInvokeRequest(value);
  return invokeExternalToolControlPlane(controlPlane, request);
}

function requireHostExternalToolControlPlane(runtime: DirectorHostRuntime) {
  if (runtime.externalToolControlPlane === undefined) {
    throw new DirectorHostHttpError(
      503,
      "TOOLS_CONTROL_PLANE_UNAVAILABLE",
      "Host API external tool control plane is not configured.",
      {
        nextActions: [
          "启动桌面端托管 Host API，或注入 externalToolControlPlane。",
          "外部工具不要在各通道重复实现；应复用统一 Host API 工具控制面。",
        ],
      },
    );
  }
  return runtime.externalToolControlPlane;
}

function parseHostExternalToolInvokeRequest(value: unknown): ExternalToolInvokeRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_TOOLS_INVOKE_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const toolId =
    parseOptionalTrimmedStringWithCode(value.toolId, "toolId", {
      code: "INVALID_TOOLS_INVOKE_REQUEST",
    }) ??
    parseOptionalTrimmedStringWithCode(value.name, "name", {
      code: "INVALID_TOOLS_INVOKE_REQUEST",
    }) ??
    parseOptionalTrimmedStringWithCode(value.tool, "tool", {
      code: "INVALID_TOOLS_INVOKE_REQUEST",
    });
  if (toolId === undefined) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_TOOLS_INVOKE_REQUEST",
      "Request body field toolId or name must be a non-empty string.",
    );
  }
  const operationId =
    parseOptionalTrimmedStringWithCode(value.operationId, "operationId", {
      code: "INVALID_TOOLS_INVOKE_REQUEST",
    }) ??
    parseOptionalTrimmedStringWithCode(value.action, "action", {
      code: "INVALID_TOOLS_INVOKE_REQUEST",
    });
  const args = parseOptionalRecord(value.args, "args", "INVALID_TOOLS_INVOKE_REQUEST");
  const metadata = parseOptionalRecord(value.metadata, "metadata", "INVALID_TOOLS_INVOKE_REQUEST");
  const sandboxPolicy = parseOptionalRecord(
    value.sandboxPolicy,
    "sandboxPolicy",
    "INVALID_TOOLS_INVOKE_REQUEST",
  );
  const sandboxRuntimePolicy = parseOptionalRecord(
    value.sandboxRuntimePolicy,
    "sandboxRuntimePolicy",
    "INVALID_TOOLS_INVOKE_REQUEST",
  );
  const approval = parseOptionalHostExternalToolApproval(value.approval);
  const turnId = parseOptionalTrimmedStringWithCode(value.turnId, "turnId", {
    code: "INVALID_TOOLS_INVOKE_REQUEST",
  });
  const command = parseOptionalTrimmedStringWithCode(value.command, "command", {
    code: "INVALID_TOOLS_INVOKE_REQUEST",
  });
  const cwd = parseOptionalTrimmedStringWithCode(value.cwd, "cwd", {
    code: "INVALID_TOOLS_INVOKE_REQUEST",
  });
  const requestedNetworkPolicy = parseOptionalTrimmedStringWithCode(
    value.requestedNetworkPolicy,
    "requestedNetworkPolicy",
    {
      code: "INVALID_TOOLS_INVOKE_REQUEST",
    },
  );
  const parsedRequestedNetworkPolicy =
    requestedNetworkPolicy === undefined
      ? undefined
      : parseExternalToolRequestedNetworkPolicy(requestedNetworkPolicy);
  const sessionKey = parseOptionalTrimmedStringWithCode(value.sessionKey, "sessionKey", {
    code: "INVALID_TOOLS_INVOKE_REQUEST",
  });
  const idempotencyKey = parseOptionalTrimmedStringWithCode(
    value.idempotencyKey,
    "idempotencyKey",
    {
      code: "INVALID_TOOLS_INVOKE_REQUEST",
    },
  );
  const dryRun = parseOptionalBoolean(value.dryRun, "dryRun", {
    code: "INVALID_TOOLS_INVOKE_REQUEST",
  });
  return {
    toolId,
    ...(operationId === undefined ? {} : { operationId }),
    ...(args === undefined ? {} : { args }),
    ...(command === undefined ? {} : { command }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(turnId === undefined ? {} : { turnId }),
    ...(sessionKey === undefined ? {} : { sessionKey }),
    ...(dryRun === undefined ? {} : { dryRun }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(approval === undefined ? {} : { approval }),
    ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
    ...(sandboxRuntimePolicy === undefined ? {} : { sandboxRuntimePolicy }),
    ...(parsedRequestedNetworkPolicy === undefined
      ? {}
      : { requestedNetworkPolicy: parsedRequestedNetworkPolicy }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function parseExternalToolRequestedNetworkPolicy(value: string): "none" | "limited" | "full" {
  if (value === "none" || value === "limited" || value === "full") {
    return value;
  }
  throw new DirectorHostHttpError(
    400,
    "INVALID_TOOLS_INVOKE_REQUEST",
    "Request body field requestedNetworkPolicy must be one of none, limited, or full.",
  );
}

function createV1ModelAdaptersCatalogResponse(
  runtime: DirectorHostRuntime,
): Record<string, unknown> {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-model-adapters.v1",
    adapters: runtime.adapterRegistry.listAll().map(formatV1ModelAdapter),
  };
}

function formatV1ModelAdapter(adapter: DirectorAdapterManifest): Record<string, unknown> {
  return {
    adapterId: adapter.adapterId,
    adapterKind: adapter.adapterKind,
    provider: adapter.provider,
    displayName: adapter.displayName ?? adapter.adapterId,
    bindingId: adapter.bindingId ?? null,
    enabled: adapter.enabled ?? true,
    healthStatus: adapter.healthStatus,
    dryRunSupported: adapter.dryRunSupported,
    mockOnly: adapter.mockOnly,
    supportedActionClasses: [...(adapter.supportedActionClasses ?? [])],
    mediaCapability: adapter.mediaCapability ?? null,
    bridge: adapter.bridge ?? null,
    notes: [...(adapter.notes ?? [])],
  };
}

async function listV1ClientBindings(runtimeRoot: string): Promise<Record<string, unknown>> {
  const bindings = await readV1ClientBindings(runtimeRoot);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-client-bindings.v1",
    bindings,
  };
}

async function createV1ClientBinding(
  runtimeRoot: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const input = parseV1ClientBindingRequest(value);
  const binding: DirectorHostClientBinding = {
    bindingId: input.bindingId,
    clientId: input.clientId,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    channel: input.channel,
    hostId: input.hostId,
    agentId: input.agentId,
    createdAt: now,
    updatedAt: now,
  };
  const bindings = await readV1ClientBindings(runtimeRoot);
  await writeV1ClientBindings(runtimeRoot, upsertById(bindings, binding, "bindingId"));
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-client-binding.v1",
    binding,
  };
}

async function getV1ClientBinding(
  runtimeRoot: string,
  bindingId: string,
): Promise<Record<string, unknown>> {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-client-binding.v1",
    binding: await loadV1ClientBindingOrThrow(runtimeRoot, bindingId),
  };
}

async function updateV1ClientBinding(
  runtimeRoot: string,
  bindingId: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const current = await loadV1ClientBindingOrThrow(runtimeRoot, bindingId);
  const input = parseV1ClientBindingRequest({ ...(isRecord(value) ? value : {}), bindingId });
  const updated: DirectorHostClientBinding = {
    ...current,
    clientId: input.clientId,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    channel: input.channel,
    hostId: input.hostId,
    agentId: input.agentId,
    updatedAt: new Date().toISOString(),
  };
  const bindings = await readV1ClientBindings(runtimeRoot);
  await writeV1ClientBindings(runtimeRoot, upsertById(bindings, updated, "bindingId"));
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-client-binding.v1",
    binding: updated,
  };
}

async function deleteV1ClientBinding(runtimeRoot: string, bindingId: string): Promise<void> {
  const bindings = await readV1ClientBindings(runtimeRoot);
  const next = bindings.filter((binding) => binding.bindingId !== bindingId);
  if (next.length === bindings.length) {
    throw new DirectorHostHttpError(
      404,
      "CLIENT_BINDING_NOT_FOUND",
      `Unknown client binding: ${bindingId}`,
    );
  }
  await writeV1ClientBindings(runtimeRoot, next);
}

async function listV1Sessions(runtimeRoot: string): Promise<Record<string, unknown>> {
  const sessions = await readV1Sessions(runtimeRoot);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-sessions.v1",
    sessions,
  };
}

async function createV1Session(
  runtimeRoot: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const input = parseV1SessionRequest(value);
  const binding =
    input.bindingId === undefined
      ? createEphemeralV1Binding(input)
      : await loadV1ClientBindingOrThrow(runtimeRoot, input.bindingId);
  const target = resolveChannelSessionTarget({
    agentId: binding.agentId,
    channel: binding.channel,
    routeKind: "direct",
    peerId: input.peerId,
  });
  const now = new Date().toISOString();
  const session: DirectorHostV1Session = {
    sessionId: input.sessionId ?? createV1Id("session", [binding.bindingId, target.sessionKey]),
    bindingId: binding.bindingId,
    clientId: binding.clientId,
    channel: target.ownership.channel,
    hostId: binding.hostId,
    agentId: target.ownership.agentId,
    peerId: target.ownership.peerId,
    ...(input.title === undefined ? {} : { title: input.title }),
    sessionKey: target.sessionKey,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const sessions = await readV1Sessions(runtimeRoot);
  await writeV1Sessions(runtimeRoot, upsertById(sessions, session, "sessionId"));
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-session.v1",
    session,
  };
}

async function getV1Session(
  runtimeRoot: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-session.v1",
    session: await loadV1SessionOrThrow(runtimeRoot, sessionId),
  };
}

async function deleteV1Session(runtimeRoot: string, sessionId: string): Promise<void> {
  const sessions = await readV1Sessions(runtimeRoot);
  const session = sessions.find((candidate) => candidate.sessionId === sessionId);
  if (session === undefined) {
    throw new DirectorHostHttpError(404, "SESSION_NOT_FOUND", `Unknown V1 session: ${sessionId}`);
  }
  const messages = await readV1SessionMessages(runtimeRoot);
  await writeV1JsonDocument(v1ArchivePath(runtimeRoot, createV1SessionArchiveFileName(sessionId)), {
    schemaVersion: "director.host.v1-session-archive.v1",
    archivedAt: new Date().toISOString(),
    reason: "deleted",
    sessionId,
    session,
    messages: messages.filter((message) => message.sessionId === sessionId),
  });
  await writeV1Sessions(
    runtimeRoot,
    sessions.filter((candidate) => candidate.sessionId !== sessionId),
  );
  await writeV1SessionMessages(
    runtimeRoot,
    messages.filter((message) => message.sessionId !== sessionId),
  );
}

async function createV1SessionMessage(
  runtimeRoot: string,
  runtime: DirectorHostRuntime,
  service: DirectorService,
  entryStore: FileSystemDirectorEntryStore,
  sessionId: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const result = await recordV1SessionMessage(
    runtimeRoot,
    runtime,
    service,
    entryStore,
    sessionId,
    value,
  );
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-session-message.v1",
    session: result.session,
    message: result.message,
    entry: result.entry,
  };
}

async function listV1Tasks(runtimeRoot: string): Promise<Record<string, unknown>> {
  const tasks = await readV1Tasks(runtimeRoot);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-tasks.v1",
    tasks,
  };
}

async function createV1Task(
  runtimeRoot: string,
  runtime: DirectorHostRuntime,
  service: DirectorService,
  executionService: ExecutionRunService,
  entryStore: FileSystemDirectorEntryStore,
  value: unknown,
): Promise<Record<string, unknown>> {
  const input = parseV1TaskRequest(value);
  const message = await recordV1SessionMessage(
    runtimeRoot,
    runtime,
    service,
    entryStore,
    input.sessionId,
    {
      messageId: input.messageId,
      receivedAtMs: input.receivedAtMs,
      text: input.text,
    },
  );
  const entrySessionId = message.entry.session.entrySessionId;
  let entrySession = message.entry.session;
  let blueprint: DirectorBlueprintResponse | undefined;

  if (entrySession.nextAction === "blueprint") {
    const blueprintRequest = await invokeEntrySessionOperation(
      () => entryStore.loadBlueprintRequest(entrySessionId),
      runtime,
    );
    blueprint = await createDirectorBlueprint(runtime, service, blueprintRequest);
    entrySession = await invokeEntrySessionOperation(
      () => entryStore.recordBlueprint(entrySessionId, blueprint as DirectorBlueprintResponse),
      runtime,
    );
  }

  if (entrySession.nextAction !== "run") {
    throw new DirectorHostHttpError(
      409,
      "SESSION_NOT_READY_FOR_TASK",
      `V1 session ${input.sessionId} is not ready for task creation.`,
    );
  }

  const runSource = await invokeEntrySessionOperation(
    () => entryStore.loadRunSource(entrySessionId),
    runtime,
  );
  let run = await invokeRunOperation(
    () => createExecutionRun(executionService, runSource, runtime.config.dataDir),
    runtime,
  );
  entrySession = await invokeEntrySessionOperation(
    () => entryStore.recordRun(entrySessionId, run),
    runtime,
  );

  if (input.start) {
    run = await invokeRunOperation(() => executionService.startRun(run.runId), runtime);
    entrySession = await invokeEntrySessionOperation(
      () => entryStore.syncRunProjection(entrySessionId, run),
      runtime,
    );
  }

  const now = new Date().toISOString();
  const task: DirectorHostV1Task = {
    taskId: run.runId,
    runId: run.runId,
    sessionId: input.sessionId,
    entrySessionId,
    text: input.text,
    status: run.status,
    ...(blueprint === undefined ? {} : { blueprintId: blueprint.blueprintId }),
    createdAt: run.createdAt ?? now,
    updatedAt: run.updatedAt ?? now,
  };
  await writeV1Tasks(runtimeRoot, upsertById(await readV1Tasks(runtimeRoot), task, "taskId"));
  await replaceV1Session(runtimeRoot, {
    ...message.session,
    entrySessionId: entrySession.entrySessionId,
    latestTaskId: task.taskId,
    updatedAt: entrySession.updatedAt,
  });

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-task.v1",
    task,
    run,
    session: entrySession,
  };
}

async function getV1Task(
  runtimeRoot: string,
  executionService: ExecutionRunService,
  taskId: string,
): Promise<Record<string, unknown>> {
  const task = await loadV1TaskOrThrow(runtimeRoot, taskId);
  const run = await executionService.getRun(task.runId);
  const syncedTask =
    run === null
      ? task
      : {
          ...task,
          status: run.status,
          updatedAt: run.updatedAt,
        };
  if (
    run !== null &&
    (syncedTask.status !== task.status || syncedTask.updatedAt !== task.updatedAt)
  ) {
    await writeV1Tasks(
      runtimeRoot,
      upsertById(await readV1Tasks(runtimeRoot), syncedTask, "taskId"),
    );
  }
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-task.v1",
    task: syncedTask,
    run,
  };
}

async function cancelV1Task(
  runtimeRoot: string,
  runtime: DirectorHostRuntime,
  executionService: ExecutionRunService,
  entryStore: FileSystemDirectorEntryStore,
  taskId: string,
): Promise<Record<string, unknown>> {
  const task = await loadV1TaskOrThrow(runtimeRoot, taskId);
  const run = await invokeRunOperation(() => executionService.abortRun(task.runId), runtime);
  await invokeEntrySessionOperation(
    () => entryStore.syncRunProjection(task.entrySessionId, run),
    runtime,
  );
  const nextTask: DirectorHostV1Task = {
    ...task,
    status: run.status,
    updatedAt: run.updatedAt,
  };
  await writeV1Tasks(runtimeRoot, upsertById(await readV1Tasks(runtimeRoot), nextTask, "taskId"));
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-task.v1",
    task: nextTask,
    run,
  };
}

async function writeV1TaskEvents(
  response: ServerResponse,
  runtimeRoot: string,
  executionService: ExecutionRunService,
  taskId: string,
): Promise<void> {
  const task = await loadV1TaskOrThrow(runtimeRoot, taskId);
  const run = await executionService.getRun(task.runId);
  const events = run?.events ?? [];
  response.statusCode = 200;
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  response.setHeader("cache-control", "no-cache");
  response.write(
    formatSseEvent("task.status", {
      taskId: task.taskId,
      runId: task.runId,
      sessionId: task.sessionId,
      status: run?.status ?? task.status,
      updatedAt: run?.updatedAt ?? task.updatedAt,
    }),
  );
  for (const event of events) {
    response.write(
      formatSseEvent("task.event", {
        taskId: task.taskId,
        runId: task.runId,
        event: formatExecutionEventSummary(event),
      }),
    );
  }
  response.end();
}

async function listV1LearningJobs(runtimeRoot: string): Promise<Record<string, unknown>> {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-learning-jobs.v1",
    jobs: await readV1LearningJobs(runtimeRoot),
  };
}

async function createV1LearningJob(
  runtimeRoot: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const input = parseV1LearningJobRequest(value);
  const now = new Date().toISOString();
  const job: DirectorHostLearningJob = {
    jobId: input.jobId ?? createV1Id("learning-job", [input.kind, input.sourceId]),
    kind: input.kind,
    status: "created",
    request: input.request,
    createdAt: now,
    updatedAt: now,
  };
  await writeV1LearningJobs(
    runtimeRoot,
    upsertById(await readV1LearningJobs(runtimeRoot), job, "jobId"),
  );
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-learning-job.v1",
    job,
  };
}

async function getV1LearningJob(
  runtimeRoot: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.v1-learning-job.v1",
    job: await loadV1LearningJobOrThrow(runtimeRoot, jobId),
  };
}

async function deleteV1LearningJob(runtimeRoot: string, jobId: string): Promise<void> {
  const jobs = await readV1LearningJobs(runtimeRoot);
  const next = jobs.filter((job) => job.jobId !== jobId);
  if (next.length === jobs.length) {
    throw new DirectorHostHttpError(
      404,
      "LEARNING_JOB_NOT_FOUND",
      `Unknown learning job: ${jobId}`,
    );
  }
  await writeV1LearningJobs(runtimeRoot, next);
}

async function runV1LearningJob(
  runtimeRoot: string,
  experienceStore: FileExperienceStore,
  env: NodeJS.ProcessEnv | undefined,
  fetchText: WebExperienceFetchText | undefined,
  jobId: string,
): Promise<Record<string, unknown>> {
  const job = await loadV1LearningJobOrThrow(runtimeRoot, jobId);
  const running: DirectorHostLearningJob = {
    ...job,
    status: "running",
    updatedAt: new Date().toISOString(),
  };
  await writeV1LearningJobs(
    runtimeRoot,
    upsertById(await readV1LearningJobs(runtimeRoot), running, "jobId"),
  );

  try {
    const result = await runV1LearningJobRequest(running, experienceStore, env, fetchText);
    const succeeded: DirectorHostLearningJob = {
      ...running,
      status: "succeeded",
      result,
      updatedAt: new Date().toISOString(),
    };
    await writeV1LearningJobs(
      runtimeRoot,
      upsertById(await readV1LearningJobs(runtimeRoot), succeeded, "jobId"),
    );
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.v1-learning-job-run.v1",
      job: succeeded,
      result,
    };
  } catch (error) {
    const failed: DirectorHostLearningJob = {
      ...running,
      status: "failed",
      error: toErrorMessage(error),
      updatedAt: new Date().toISOString(),
    };
    await writeV1LearningJobs(
      runtimeRoot,
      upsertById(await readV1LearningJobs(runtimeRoot), failed, "jobId"),
    );
    throw error;
  }
}

async function runV1LearningJobRequest(
  job: DirectorHostLearningJob,
  experienceStore: FileExperienceStore,
  env: NodeJS.ProcessEnv | undefined,
  fetchText: WebExperienceFetchText | undefined,
): Promise<Record<string, unknown>> {
  if (job.kind === "text") {
    return learnFromPastedText(parseLearningTextRequest(job.request), experienceStore);
  }
  if (job.kind === "directory") {
    return learnFromLocalDirectory(parseLearningDirectoryRequest(job.request), experienceStore);
  }
  if (job.kind === "url") {
    return learnFromUrls(parseLearningUrlRequest(job.request), experienceStore, fetchText);
  }
  return learnFromQueries(parseLearningQueryRequest(job.request), experienceStore, env, fetchText);
}

async function recordV1SessionMessage(
  runtimeRoot: string,
  runtime: DirectorHostRuntime,
  service: DirectorService,
  entryStore: FileSystemDirectorEntryStore,
  sessionId: string,
  value: unknown,
): Promise<{
  readonly session: DirectorHostV1Session;
  readonly message: DirectorHostV1SessionMessage;
  readonly entry: Awaited<ReturnType<FileSystemDirectorEntryStore["recordIntake"]>>;
}> {
  const session = await loadV1SessionOrThrow(runtimeRoot, sessionId);
  const input = parseV1SessionMessageRequest(value);
  const receivedAtMs = input.receivedAtMs ?? Date.now();
  const messageId = input.messageId ?? createV1Id("message", [sessionId, input.text]);
  const body = {
    apiVersion: DIRECTOR_ENTRY_API_VERSION,
    hostId: session.hostId,
    message: createChannelTransportEnvelope({
      channel: session.channel,
      agentId: session.agentId,
      peerId: session.peerId,
      messageId,
      receivedAtMs,
      text: input.text,
      routingHint: {
        agentId: session.agentId,
        channel: session.channel,
        routeKind: "direct",
        peerId: session.peerId,
      },
      metadata: {
        source: "director-host-api-v1",
        v1SessionId: session.sessionId,
        bindingId: session.bindingId,
      },
    }),
  } satisfies DirectorEntryMessageRequest;
  const normalizedBody = await normalizeEntryMessageRequest(entryStore, body);
  assertEntryAdmissionText(input.text, {
    channel: normalizedBody.message.channel,
    peerId: normalizedBody.message.peerId,
  });
  const intakeRequest = buildEntryIntakeRequestFromMessage(runtime, normalizedBody);
  const evaluateRequest = {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    snapshot: intakeRequest.snapshot,
    intake: intakeRequest.intake,
  } as const;
  const evaluation = await service.evaluateSnapshot(evaluateRequest);
  const intakeResponse = createIntakeResponse(runtime, evaluateRequest, evaluation);
  const entry = await entryStore.recordIntake(intakeRequest, intakeResponse);
  const nextSession: DirectorHostV1Session = {
    ...session,
    entrySessionId: entry.session.entrySessionId,
    messageCount: session.messageCount + 1,
    updatedAt: entry.session.updatedAt,
  };
  const message: DirectorHostV1SessionMessage = {
    messageId,
    sessionId,
    text: input.text,
    receivedAtMs,
    receivedAt: new Date(receivedAtMs).toISOString(),
    entrySessionId: entry.session.entrySessionId,
    ...(entry.turn.entryTurnId === undefined ? {} : { entryTurnId: entry.turn.entryTurnId }),
  };
  await replaceV1Session(runtimeRoot, nextSession);
  await writeV1SessionMessages(runtimeRoot, [
    ...(await readV1SessionMessages(runtimeRoot)).filter(
      (candidate) => candidate.messageId !== message.messageId,
    ),
    message,
  ]);

  return {
    session: nextSession,
    message,
    entry,
  };
}

function parseV1ClientBindingRequest(value: unknown): {
  readonly bindingId: string;
  readonly clientId: string;
  readonly displayName?: string;
  readonly channel: string;
  readonly hostId: string;
  readonly agentId: string;
} {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_CLIENT_BINDING_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const bindingId = parseOptionalTrimmedStringWithCode(value.bindingId, "bindingId", {
    code: "INVALID_CLIENT_BINDING_REQUEST",
  });
  const clientId = parseOptionalTrimmedStringWithCode(value.clientId, "clientId", {
    code: "INVALID_CLIENT_BINDING_REQUEST",
  });
  const resolvedId = bindingId ?? clientId ?? createV1Id("binding", ["client"]);
  const displayName = parseOptionalTrimmedStringWithCode(value.displayName, "displayName", {
    code: "INVALID_CLIENT_BINDING_REQUEST",
  });
  const channel =
    parseOptionalTrimmedStringWithCode(value.channel, "channel", {
      code: "INVALID_CLIENT_BINDING_REQUEST",
    }) ?? "desktop";
  const hostId =
    parseOptionalTrimmedStringWithCode(value.hostId, "hostId", {
      code: "INVALID_CLIENT_BINDING_REQUEST",
    }) ?? `director-${channel}`;
  const agentId =
    parseOptionalTrimmedStringWithCode(value.agentId, "agentId", {
      code: "INVALID_CLIENT_BINDING_REQUEST",
    }) ?? "director";
  return {
    bindingId: resolvedId,
    clientId: clientId ?? resolvedId,
    ...(displayName === undefined ? {} : { displayName }),
    channel,
    hostId,
    agentId,
  };
}

function parseV1SessionRequest(value: unknown): {
  readonly sessionId?: string;
  readonly bindingId?: string;
  readonly clientId?: string;
  readonly channel: string;
  readonly hostId: string;
  readonly agentId: string;
  readonly peerId: string;
  readonly title?: string;
} {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_SESSION_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const sessionId = parseOptionalTrimmedStringWithCode(value.sessionId, "sessionId", {
    code: "INVALID_SESSION_REQUEST",
  });
  const bindingId = parseOptionalTrimmedStringWithCode(value.bindingId, "bindingId", {
    code: "INVALID_SESSION_REQUEST",
  });
  const clientId = parseOptionalTrimmedStringWithCode(value.clientId, "clientId", {
    code: "INVALID_SESSION_REQUEST",
  });
  const channel =
    parseOptionalTrimmedStringWithCode(value.channel, "channel", {
      code: "INVALID_SESSION_REQUEST",
    }) ?? "desktop";
  const hostId =
    parseOptionalTrimmedStringWithCode(value.hostId, "hostId", {
      code: "INVALID_SESSION_REQUEST",
    }) ?? `director-${channel}`;
  const agentId =
    parseOptionalTrimmedStringWithCode(value.agentId, "agentId", {
      code: "INVALID_SESSION_REQUEST",
    }) ?? "director";
  const peerId = parseRequiredTrimmedString(value.peerId, "peerId", {
    code: "INVALID_SESSION_REQUEST",
  });
  const title = parseOptionalTrimmedStringWithCode(value.title, "title", {
    code: "INVALID_SESSION_REQUEST",
  });
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(bindingId === undefined ? {} : { bindingId }),
    ...(clientId === undefined ? {} : { clientId }),
    channel,
    hostId,
    agentId,
    peerId,
    ...(title === undefined ? {} : { title }),
  };
}

function parseV1SessionMessageRequest(value: unknown): {
  readonly messageId?: string;
  readonly receivedAtMs?: number;
  readonly text: string;
} {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_SESSION_MESSAGE_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const messageId = parseOptionalTrimmedStringWithCode(value.messageId, "messageId", {
    code: "INVALID_SESSION_MESSAGE_REQUEST",
  });
  const receivedAtMs = parseOptionalNumber(value.receivedAtMs, "receivedAtMs", {
    code: "INVALID_SESSION_MESSAGE_REQUEST",
  });
  const text = parseRequiredTrimmedString(value.text, "text", {
    code: "INVALID_SESSION_MESSAGE_REQUEST",
  });
  return {
    ...(messageId === undefined ? {} : { messageId }),
    ...(receivedAtMs === undefined ? {} : { receivedAtMs }),
    text,
  };
}

function parseV1TaskRequest(value: unknown): {
  readonly sessionId: string;
  readonly messageId?: string;
  readonly receivedAtMs?: number;
  readonly text: string;
  readonly start: boolean;
} {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_TASK_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const sessionId = parseRequiredTrimmedString(value.sessionId, "sessionId", {
    code: "INVALID_TASK_REQUEST",
  });
  const messageId = parseOptionalTrimmedStringWithCode(value.messageId, "messageId", {
    code: "INVALID_TASK_REQUEST",
  });
  const receivedAtMs = parseOptionalNumber(value.receivedAtMs, "receivedAtMs", {
    code: "INVALID_TASK_REQUEST",
  });
  const text = parseRequiredTrimmedString(value.text, "text", {
    code: "INVALID_TASK_REQUEST",
  });
  const start =
    parseOptionalBoolean(value.start, "start", { code: "INVALID_TASK_REQUEST" }) ?? true;
  return {
    sessionId,
    ...(messageId === undefined ? {} : { messageId }),
    ...(receivedAtMs === undefined ? {} : { receivedAtMs }),
    text,
    start,
  };
}

function parseV1LearningJobRequest(value: unknown): {
  readonly jobId?: string;
  readonly kind: DirectorHostLearningJobKind;
  readonly sourceId: string;
  readonly request: Record<string, unknown>;
} {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_JOB_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const kind = parseRequiredTrimmedString(value.kind, "kind", {
    code: "INVALID_LEARNING_JOB_REQUEST",
  });
  if (!isV1LearningJobKind(kind)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_JOB_REQUEST",
      "Request body field kind must be one of: text, directory, url, query.",
    );
  }
  const jobId = parseOptionalTrimmedStringWithCode(value.jobId, "jobId", {
    code: "INVALID_LEARNING_JOB_REQUEST",
  });
  const sourceId = parseRequiredTrimmedString(value.sourceId, "sourceId", {
    code: "INVALID_LEARNING_JOB_REQUEST",
  });
  return {
    ...(jobId === undefined ? {} : { jobId }),
    kind,
    sourceId,
    request: { ...value },
  };
}

function isV1LearningJobKind(value: string): value is DirectorHostLearningJobKind {
  return value === "text" || value === "directory" || value === "url" || value === "query";
}

function createEphemeralV1Binding(input: {
  readonly bindingId?: string;
  readonly clientId?: string;
  readonly channel: string;
  readonly hostId: string;
  readonly agentId: string;
}): DirectorHostClientBinding {
  const now = new Date().toISOString();
  const bindingId = input.bindingId ?? input.clientId ?? `implicit-${input.channel}`;
  return {
    bindingId,
    clientId: input.clientId ?? bindingId,
    channel: input.channel,
    hostId: input.hostId,
    agentId: input.agentId,
    createdAt: now,
    updatedAt: now,
  };
}

async function loadV1ClientBindingOrThrow(
  runtimeRoot: string,
  bindingId: string,
): Promise<DirectorHostClientBinding> {
  const binding = (await readV1ClientBindings(runtimeRoot)).find(
    (candidate) => candidate.bindingId === bindingId,
  );
  if (binding === undefined) {
    throw new DirectorHostHttpError(
      404,
      "CLIENT_BINDING_NOT_FOUND",
      `Unknown client binding: ${bindingId}`,
    );
  }
  return binding;
}

async function loadV1SessionOrThrow(
  runtimeRoot: string,
  sessionId: string,
): Promise<DirectorHostV1Session> {
  const session = (await readV1Sessions(runtimeRoot)).find(
    (candidate) => candidate.sessionId === sessionId,
  );
  if (session === undefined) {
    throw new DirectorHostHttpError(404, "SESSION_NOT_FOUND", `Unknown V1 session: ${sessionId}`);
  }
  return session;
}

async function loadV1TaskOrThrow(runtimeRoot: string, taskId: string): Promise<DirectorHostV1Task> {
  const task = (await readV1Tasks(runtimeRoot)).find((candidate) => candidate.taskId === taskId);
  if (task === undefined) {
    throw new DirectorHostHttpError(404, "TASK_NOT_FOUND", `Unknown V1 task: ${taskId}`);
  }
  return task;
}

async function loadV1LearningJobOrThrow(
  runtimeRoot: string,
  jobId: string,
): Promise<DirectorHostLearningJob> {
  const job = (await readV1LearningJobs(runtimeRoot)).find(
    (candidate) => candidate.jobId === jobId,
  );
  if (job === undefined) {
    throw new DirectorHostHttpError(
      404,
      "LEARNING_JOB_NOT_FOUND",
      `Unknown learning job: ${jobId}`,
    );
  }
  return job;
}

async function replaceV1Session(
  runtimeRoot: string,
  session: DirectorHostV1Session,
): Promise<void> {
  await writeV1Sessions(
    runtimeRoot,
    upsertById(await readV1Sessions(runtimeRoot), session, "sessionId"),
  );
}

async function readV1ClientBindings(runtimeRoot: string): Promise<DirectorHostClientBinding[]> {
  return readV1Collection<DirectorHostClientBinding>(
    runtimeRoot,
    "client-bindings.json",
    "bindings",
  );
}

async function writeV1ClientBindings(
  runtimeRoot: string,
  bindings: readonly DirectorHostClientBinding[],
): Promise<void> {
  await writeV1Collection(runtimeRoot, "client-bindings.json", "bindings", bindings);
}

async function readV1Sessions(runtimeRoot: string): Promise<DirectorHostV1Session[]> {
  return readV1Collection<DirectorHostV1Session>(runtimeRoot, "sessions.json", "sessions");
}

async function writeV1Sessions(
  runtimeRoot: string,
  sessions: readonly DirectorHostV1Session[],
): Promise<void> {
  await writeV1Collection(runtimeRoot, "sessions.json", "sessions", sessions);
}

async function readV1SessionMessages(runtimeRoot: string): Promise<DirectorHostV1SessionMessage[]> {
  return readV1Collection<DirectorHostV1SessionMessage>(
    runtimeRoot,
    "session-messages.json",
    "messages",
  );
}

async function writeV1SessionMessages(
  runtimeRoot: string,
  messages: readonly DirectorHostV1SessionMessage[],
): Promise<void> {
  await writeV1Collection(runtimeRoot, "session-messages.json", "messages", messages);
}

async function readV1Tasks(runtimeRoot: string): Promise<DirectorHostV1Task[]> {
  return readV1Collection<DirectorHostV1Task>(runtimeRoot, "tasks.json", "tasks");
}

async function writeV1Tasks(
  runtimeRoot: string,
  tasks: readonly DirectorHostV1Task[],
): Promise<void> {
  await writeV1Collection(runtimeRoot, "tasks.json", "tasks", tasks);
}

async function readV1LearningJobs(runtimeRoot: string): Promise<DirectorHostLearningJob[]> {
  return readV1Collection<DirectorHostLearningJob>(runtimeRoot, "learning-jobs.json", "jobs");
}

async function writeV1LearningJobs(
  runtimeRoot: string,
  jobs: readonly DirectorHostLearningJob[],
): Promise<void> {
  await writeV1Collection(runtimeRoot, "learning-jobs.json", "jobs", jobs);
}

async function readV1Collection<T>(
  runtimeRoot: string,
  fileName: string,
  key: string,
): Promise<T[]> {
  const document = await readV1JsonDocument(v1StorePath(runtimeRoot, fileName));
  const value = document[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

async function writeV1Collection<T>(
  runtimeRoot: string,
  fileName: string,
  key: string,
  items: readonly T[],
): Promise<void> {
  await writeV1JsonDocument(v1StorePath(runtimeRoot, fileName), {
    schemaVersion: "director.host.v1-store.v1",
    updatedAt: new Date().toISOString(),
    [key]: items,
  });
}

async function readV1JsonDocument(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeV1JsonDocument(path: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function v1StorePath(runtimeRoot: string, fileName: string): string {
  return join(runtimeRoot, "v1", fileName);
}

function v1ArchivePath(runtimeRoot: string, fileName: string): string {
  return join(runtimeRoot, "v1", "session-archives", fileName);
}

function createV1SessionArchiveFileName(sessionId: string): string {
  return `${encodeURIComponent(sessionId)}.json`;
}

function upsertById<T, K extends keyof T>(items: readonly T[], item: T, key: K): T[] {
  const itemId = item[key];
  const next = items.filter((candidate) => candidate[key] !== itemId);
  next.push(item);
  return next;
}

function createV1Id(prefix: string, parts: readonly string[]): string {
  const digest = createHash("sha256")
    .update([prefix, Date.now().toString(), Math.random().toString(36), ...parts].join("\n"))
    .digest("hex")
    .slice(0, 12);
  return `${prefix}-${digest}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function matchV1ClientBindingRoute(pathname: string): { readonly bindingId: string } | null {
  const match = /^\/v1\/client-bindings\/([^/]+)$/u.exec(pathname);
  return match ? { bindingId: decodeURIComponent(match[1] ?? "") } : null;
}

function matchV1SessionMessagesRoute(pathname: string): { readonly sessionId: string } | null {
  const match = /^\/v1\/sessions\/([^/]+)\/messages$/u.exec(pathname);
  return match ? { sessionId: decodeURIComponent(match[1] ?? "") } : null;
}

function matchV1SessionRoute(pathname: string): { readonly sessionId: string } | null {
  const match = /^\/v1\/sessions\/([^/]+)$/u.exec(pathname);
  return match ? { sessionId: decodeURIComponent(match[1] ?? "") } : null;
}

function matchV1TaskEventsRoute(pathname: string): { readonly taskId: string } | null {
  const match = /^\/v1\/tasks\/([^/]+)\/events$/u.exec(pathname);
  return match ? { taskId: decodeURIComponent(match[1] ?? "") } : null;
}

function matchV1TaskCancelRoute(pathname: string): { readonly taskId: string } | null {
  const match = /^\/v1\/tasks\/([^/]+)\/cancel$/u.exec(pathname);
  return match ? { taskId: decodeURIComponent(match[1] ?? "") } : null;
}

function matchV1TaskRoute(pathname: string): { readonly taskId: string } | null {
  const match = /^\/v1\/tasks\/([^/]+)$/u.exec(pathname);
  return match ? { taskId: decodeURIComponent(match[1] ?? "") } : null;
}

function matchV1LearningJobRunRoute(pathname: string): { readonly jobId: string } | null {
  const match = /^\/v1\/learning\/jobs\/([^/]+)\/run$/u.exec(pathname);
  return match ? { jobId: decodeURIComponent(match[1] ?? "") } : null;
}

function matchV1LearningJobRoute(pathname: string): { readonly jobId: string } | null {
  const match = /^\/v1\/learning\/jobs\/([^/]+)$/u.exec(pathname);
  return match ? { jobId: decodeURIComponent(match[1] ?? "") } : null;
}

function matchEvidenceRoute(pathname: string): { readonly evidenceId: string } | null {
  const match = /^\/v1\/evidence\/([^/]+)$/u.exec(pathname);
  return match ? { evidenceId: decodeURIComponent(match[1] ?? "") } : null;
}

function matchEvidenceContentRoute(pathname: string): { readonly evidenceId: string } | null {
  const match = /^\/v1\/evidence\/([^/]+)\/content$/u.exec(pathname);
  return match ? { evidenceId: decodeURIComponent(match[1] ?? "") } : null;
}

async function readLatestMemoryRecord(memoryRoot: string): Promise<DirectorMemoryRecord | null> {
  try {
    const index = JSON.parse(await readFile(join(memoryRoot, "index.json"), "utf8")) as
      | DirectorMemoryIndexDocument
      | undefined;
    const latest = [...(Array.isArray(index?.entries) ? index.entries : [])].sort(
      compareMemoryIndexEntries,
    )[0];
    if (latest?.recordId === undefined) {
      return null;
    }
    return JSON.parse(
      await readFile(join(memoryRoot, "records", `${latest.recordId}.json`), "utf8"),
    ) as DirectorMemoryRecord;
  } catch {
    return null;
  }
}

function compareMemoryIndexEntries(
  left: DirectorMemoryIndexEntry,
  right: DirectorMemoryIndexEntry,
): number {
  return Date.parse(right.recordedAt) - Date.parse(left.recordedAt);
}

function summarizeMemoryRecord(record: DirectorMemoryRecord): Record<string, unknown> {
  return {
    recordId: record.recordId,
    digestId: record.digestId,
    projectId: record.projectId,
    groupId: record.groupId,
    anchorIds: [...record.anchorIds],
    selectedAdapters: [...record.selectedAdapters],
    tags: [...(record.tags ?? [])],
    status: record.status,
    recordedAt: record.recordedAt,
    runId: record.digest.runId,
    reportId: record.digest.reportId,
    goal: record.digest.goal,
    previewSummary: truncateText(record.digest.previewSummary, 240),
  };
}

function inspectLongTermMemoryFile(
  memoryDir: string,
  file: "MEMORY.md" | "USER.md",
  maxChars: number,
): Record<string, unknown> {
  const path = join(memoryDir, file);
  if (!existsSync(path)) {
    return {
      file,
      path,
      exists: false,
      entryCount: 0,
      budget: {
        maxChars,
        usedChars: 0,
        remainingChars: maxChars,
      },
      preview: [],
    };
  }

  const content = readFileSync(path, "utf8");
  const entries = parseLongTermMemoryEntries(content);
  return {
    file,
    path,
    exists: true,
    entryCount: entries.length,
    budget: {
      maxChars,
      usedChars: content.length,
      remainingChars: Math.max(0, maxChars - content.length),
    },
    preview: entries.slice(-3).map((entry) => truncateText(entry, 180)),
  };
}

function parseLongTermMemoryEntries(content: string): string[] {
  return content
    .split("§")
    .map((entry) =>
      entry
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .join(" "),
    )
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

class DirectorHostHttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly metadata: Record<string, unknown> | undefined;

  public constructor(
    statusCode: number,
    code: string,
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.metadata = metadata;
  }
}

const LEGACY_HOST_API_SUNSET = "Wed, 30 Sep 2026 00:00:00 GMT";
const DEFAULT_HOST_API_MAX_JSON_BODY_BYTES = 1_000_000;

function resolveHostApiBearerToken(env: NodeJS.ProcessEnv | undefined): string | undefined {
  const token = env?.DIRECTOR_HOST_API_BEARER_TOKEN?.trim();
  return token === undefined || token.length === 0 ? undefined : token;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "127.0.0.1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(normalized)
  );
}

function assertHostApiListenAuthBoundary(host: string, token: string | undefined): void {
  if (isLoopbackHost(host) || token !== undefined) {
    return;
  }
  throw new Error(
    "DIRECTOR_HOST_API_BEARER_TOKEN is required when Director Host API listens on a non-loopback host.",
  );
}

function assertHostApiRequestAuthorized(request: IncomingMessage, token: string | undefined): void {
  if (token === undefined) {
    return;
  }
  const authorization = request.headers.authorization ?? "";
  if (authorization === `Bearer ${token}`) {
    return;
  }
  throw new DirectorHostHttpError(401, "UNAUTHORIZED", "Director Host API bearer token required.");
}

function isLegacyHostApiRoute(pathname: string): boolean {
  return (
    /^\/v1\/entry(?:\/|$)/u.test(pathname) ||
    /^\/v1\/runs(?:\/|$)/u.test(pathname) ||
    /^\/v1\/learning\/(?:text|directory|url|query)$/u.test(pathname)
  );
}

function applyLegacyDeprecationHeaders(response: ServerResponse): void {
  response.setHeader("deprecation", "true");
  response.setHeader("sunset", LEGACY_HOST_API_SUNSET);
  response.setHeader("link", '</v1/capabilities>; rel="successor-version"');
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: DirectorHostRuntime,
  service: DirectorService,
  executionService: ExecutionRunService,
  entryStore: FileSystemDirectorEntryStore,
  knowledgeStore: FileKnowledgeStore,
  experienceStore: FileExperienceStore,
  experienceTaxonomyStore: FileExperienceTaxonomyStore,
  skillRepository: FileBackedSkillRepository,
  skillManagementStore: SkillManagementStore,
  skillTaxonomyStore: FileSkillTaxonomyStore,
  hostEnv: NodeJS.ProcessEnv | undefined,
  experienceFetchText: WebExperienceFetchText | undefined,
  runtimeRoot: string,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://director.local");
  if (isLegacyHostApiRoute(url.pathname)) {
    applyLegacyDeprecationHeaders(response);
  }

  if (url.pathname === "/health") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed for /health.");
    }
    const healthRuntime =
      runtime.apiProviders.length === 0 ? createActiveDirectorHostRuntime(runtime) : runtime;
    writeJson(response, 200, createHealthResponse(healthRuntime));
    return;
  }

  if (url.pathname === "/v1/commands") {
    if (method === "GET") {
      writeJson(response, 200, createCommandsResponse(url));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/commands.",
    );
  }

  if (url.pathname === "/v1/runtime") {
    if (method === "GET") {
      writeJson(response, 200, await createRuntimeResponse(runtime, service));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/runtime.",
    );
  }

  if (url.pathname === "/v1/runtime/preflight") {
    if (method === "GET") {
      writeJson(response, 200, createRuntimePreflightResponse(runtime));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/runtime/preflight.",
    );
  }

  if (url.pathname === "/v1/runtime/snapshot") {
    if (method === "GET") {
      writeJson(response, 200, await createRuntimeSnapshot(runtime, service, runtimeRoot));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/runtime/snapshot.",
    );
  }

  if (url.pathname === "/v1/client-runtime") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/client-runtime.",
      );
    }
    writeJson(
      response,
      200,
      await createHostClientRuntimeListResponse(executionService, runtimeRoot, url),
    );
    return;
  }

  const clientRuntimeTaskRoute = matchClientRuntimeTaskRoute(url.pathname);
  if (clientRuntimeTaskRoute !== null) {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/client-runtime/tasks/:taskId.",
      );
    }
    writeJson(
      response,
      200,
      await createHostClientRuntimeTaskResponse(
        executionService,
        decodeURIComponent(clientRuntimeTaskRoute.taskId),
        url,
      ),
    );
    return;
  }

  const clientRuntimeStopRoute = matchClientRuntimeStopRoute(url.pathname);
  if (clientRuntimeStopRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/client-runtime/tasks/:taskId/stop.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await stopHostClientRuntimeTask(
        executionService,
        decodeURIComponent(clientRuntimeStopRoute.taskId),
        body,
      ),
    );
    return;
  }

  const clientRuntimeFollowupRoute = matchClientRuntimeFollowupRoute(url.pathname);
  if (clientRuntimeFollowupRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/client-runtime/tasks/:taskId/followup.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await followupHostClientRuntimeTask(
        executionService,
        entryStore,
        decodeURIComponent(clientRuntimeFollowupRoute.taskId),
        body,
      ),
    );
    return;
  }

  const clientRuntimeSteerRoute = matchClientRuntimeSteerRoute(url.pathname);
  if (clientRuntimeSteerRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/client-runtime/tasks/:taskId/steer.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await steerHostClientRuntimeTask(
        executionService,
        decodeURIComponent(clientRuntimeSteerRoute.taskId),
        body,
      ),
    );
    return;
  }

  if (url.pathname === "/v1/capabilities") {
    if (method === "GET") {
      writeJson(response, 200, createV1CapabilitiesResponse(runtime));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/capabilities.",
    );
  }

  if (url.pathname === "/v1/maintenance") {
    if (method === "GET") {
      writeJson(
        response,
        200,
        await createMaintenanceResponse(
          runtimeRoot,
          parseMaintenanceRequestFromUrl(url),
          "preview",
        ),
      );
      return;
    }
    if (method === "POST") {
      const body = await readJsonBody<unknown>(request);
      writeJson(
        response,
        200,
        await createMaintenanceResponse(runtimeRoot, parseMaintenanceRequest(body), "apply"),
      );
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/maintenance.",
    );
  }

  if (url.pathname === "/v1/self-reflection/daily") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/self-reflection/daily.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await createDailySelfReflectionResponse(
        runtime.config.workspaceRoot,
        runtime.config.dataDir,
        parseDailySelfReflectionRequest(body),
      ),
    );
    return;
  }

  if (url.pathname === "/v1/client-bindings") {
    if (method === "GET") {
      writeJson(response, 200, await listV1ClientBindings(runtimeRoot));
      return;
    }
    if (method === "POST") {
      const body = await readJsonBody<unknown>(request);
      writeJson(response, 201, await createV1ClientBinding(runtimeRoot, body));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/client-bindings.",
    );
  }

  const clientBindingRoute = matchV1ClientBindingRoute(url.pathname);
  if (clientBindingRoute !== null) {
    if (method === "GET") {
      writeJson(response, 200, await getV1ClientBinding(runtimeRoot, clientBindingRoute.bindingId));
      return;
    }
    if (method === "PUT" || method === "PATCH") {
      const body = await readJsonBody<unknown>(request);
      writeJson(
        response,
        200,
        await updateV1ClientBinding(runtimeRoot, clientBindingRoute.bindingId, body),
      );
      return;
    }
    if (method === "DELETE") {
      await deleteV1ClientBinding(runtimeRoot, clientBindingRoute.bindingId);
      response.statusCode = 204;
      response.end();
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/client-bindings/:bindingId.",
    );
  }

  if (url.pathname === "/v1/sessions") {
    if (method === "GET") {
      writeJson(response, 200, await listV1Sessions(runtimeRoot));
      return;
    }
    if (method === "POST") {
      const body = await readJsonBody<unknown>(request);
      writeJson(response, 201, await createV1Session(runtimeRoot, body));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/sessions.",
    );
  }

  const sessionMessagesRoute = matchV1SessionMessagesRoute(url.pathname);
  if (sessionMessagesRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/sessions/:sessionId/messages.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await createV1SessionMessage(
        runtimeRoot,
        runtime,
        service,
        entryStore,
        sessionMessagesRoute.sessionId,
        body,
      ),
    );
    return;
  }

  const sessionRoute = matchV1SessionRoute(url.pathname);
  if (sessionRoute !== null) {
    if (method === "GET") {
      writeJson(response, 200, await getV1Session(runtimeRoot, sessionRoute.sessionId));
      return;
    }
    if (method === "DELETE") {
      await deleteV1Session(runtimeRoot, sessionRoute.sessionId);
      response.statusCode = 204;
      response.end();
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/sessions/:sessionId.",
    );
  }

  if (url.pathname === "/v1/tasks") {
    if (method === "GET") {
      writeJson(response, 200, await listV1Tasks(runtimeRoot));
      return;
    }
    if (method === "POST") {
      const body = await readJsonBody<unknown>(request);
      writeJson(
        response,
        201,
        await createV1Task(runtimeRoot, runtime, service, executionService, entryStore, body),
      );
      return;
    }
    throw new DirectorHostHttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed for /v1/tasks.");
  }

  const taskEventsRoute = matchV1TaskEventsRoute(url.pathname);
  if (taskEventsRoute !== null) {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/tasks/:taskId/events.",
      );
    }
    await writeV1TaskEvents(response, runtimeRoot, executionService, taskEventsRoute.taskId);
    return;
  }

  const taskCancelRoute = matchV1TaskCancelRoute(url.pathname);
  if (taskCancelRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/tasks/:taskId/cancel.",
      );
    }
    writeJson(
      response,
      200,
      await cancelV1Task(
        runtimeRoot,
        runtime,
        executionService,
        entryStore,
        taskCancelRoute.taskId,
      ),
    );
    return;
  }

  const taskRoute = matchV1TaskRoute(url.pathname);
  if (taskRoute !== null) {
    if (method === "GET") {
      writeJson(response, 200, await getV1Task(runtimeRoot, executionService, taskRoute.taskId));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/tasks/:taskId.",
    );
  }

  if (url.pathname === "/v1/catalog/model-adapters") {
    if (method === "GET") {
      writeJson(response, 200, createV1ModelAdaptersCatalogResponse(runtime));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/catalog/model-adapters.",
    );
  }

  if (url.pathname === "/v1/tools/catalog") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/tools/catalog.",
      );
    }
    writeJson(response, 200, await createHostExternalToolsCatalogResponse(runtime, url));
    return;
  }

  if (url.pathname === "/v1/tools/effective") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/tools/effective.",
      );
    }
    writeJson(response, 200, await createHostExternalToolsEffectiveResponse(runtime, url));
    return;
  }

  if (url.pathname === "/v1/tools/invoke") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/tools/invoke.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(response, 200, await invokeHostExternalTool(runtime, body));
    return;
  }

  if (url.pathname === "/v1/evidence") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/evidence.",
      );
    }
    writeJson(response, 200, await createEvidenceListResponse(runtime, url, experienceStore));
    return;
  }

  const evidenceContentRoute = matchEvidenceContentRoute(url.pathname);
  if (evidenceContentRoute !== null) {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/evidence/:evidenceId/content.",
      );
    }
    writeJson(
      response,
      200,
      await createEvidenceContentResponse(
        runtime,
        evidenceContentRoute.evidenceId,
        experienceStore,
        url,
      ),
    );
    return;
  }

  const evidenceRoute = matchEvidenceRoute(url.pathname);
  if (evidenceRoute !== null) {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/evidence/:evidenceId.",
      );
    }
    writeJson(
      response,
      200,
      await createEvidenceDetailResponse(runtime, evidenceRoute.evidenceId, experienceStore),
    );
    return;
  }

  if (url.pathname === "/v1/learning/jobs") {
    if (method === "GET") {
      writeJson(response, 200, await listV1LearningJobs(runtimeRoot));
      return;
    }
    if (method === "POST") {
      const body = await readJsonBody<unknown>(request);
      writeJson(response, 201, await createV1LearningJob(runtimeRoot, body));
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/learning/jobs.",
    );
  }

  const learningJobRunRoute = matchV1LearningJobRunRoute(url.pathname);
  if (learningJobRunRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/learning/jobs/:jobId/run.",
      );
    }
    writeJson(
      response,
      200,
      await runV1LearningJob(
        runtimeRoot,
        experienceStore,
        hostEnv,
        experienceFetchText,
        learningJobRunRoute.jobId,
      ),
    );
    return;
  }

  const learningJobRoute = matchV1LearningJobRoute(url.pathname);
  if (learningJobRoute !== null) {
    if (method === "GET") {
      writeJson(response, 200, await getV1LearningJob(runtimeRoot, learningJobRoute.jobId));
      return;
    }
    if (method === "DELETE") {
      await deleteV1LearningJob(runtimeRoot, learningJobRoute.jobId);
      response.statusCode = 204;
      response.end();
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/learning/jobs/:jobId.",
    );
  }

  if (url.pathname === "/v1/learning/artifacts") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/learning/artifacts.",
      );
    }
    writeJson(response, 200, createLearningArtifactsResponse(runtime, url));
    return;
  }

  if (url.pathname === "/v1/learning/confirmations") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/learning/confirmations.",
      );
    }
    writeJson(response, 200, createLearningConfirmationsResponse(runtime, url));
    return;
  }

  if (url.pathname === "/v1/memory/long-term/admit") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/memory/long-term/admit.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      admitLongTermMemory(runtime.config.workspaceRoot, parseLongTermMemoryAdmitRequest(body)),
    );
    return;
  }

  if (url.pathname === "/v1/memory/long-term/status") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/memory/long-term/status.",
      );
    }
    writeJson(response, 200, await createLongTermMemoryStatusResponse(runtime));
    return;
  }

  if (url.pathname === "/v1/memory/status") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/memory/status.",
      );
    }
    writeJson(response, 200, await createMemoryStatusResponse(runtime));
    return;
  }

  if (url.pathname === "/v1/memory/recall-preview") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/memory/recall-preview.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await createMemoryRecallPreviewResponse(runtime, parseMemoryRecallPreviewRequest(body)),
    );
    return;
  }

  if (url.pathname === "/v1/memory/publications") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/memory/publications.",
      );
    }
    writeJson(response, 200, await createMemoryPublicationsResponse(runtime, url));
    return;
  }

  const memoryPublicationGovernanceRoute = matchMemoryPublicationGovernanceRoute(url.pathname);
  if (memoryPublicationGovernanceRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/memory/publications/:recordId/:action.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await createMemoryPublicationGovernanceResponse(
        runtime,
        memoryPublicationGovernanceRoute,
        parseDirectorHostOperatorRequest(body),
      ),
    );
    return;
  }

  if (url.pathname === "/v1/bridges/api-provider/media-submit") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/bridges/api-provider/media-submit.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    if (!isDirectorApiProviderBridgeEnvelope(body)) {
      throw new DirectorHostHttpError(
        400,
        "INVALID_BRIDGE_REQUEST",
        "Request body must be a valid Director HTTP JSON bridge envelope.",
      );
    }
    const bridgeResult = await submitApiProviderBridge(runtime, body);
    writeJson(response, bridgeResult.statusCode, bridgeResult.body);
    return;
  }

  if (url.pathname === "/v1/learning/text") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/learning/text.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await learnFromPastedText(parseLearningTextRequest(body), experienceStore),
    );
    return;
  }

  if (url.pathname === "/v1/learning/admit") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/learning/admit.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await admitExtractedLearningSources(parseLearningAdmitRequest(body), experienceStore),
    );
    return;
  }

  if (url.pathname === "/v1/learning/directory") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/learning/directory.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await learnFromLocalDirectory(parseLearningDirectoryRequest(body), experienceStore),
    );
    return;
  }

  if (url.pathname === "/v1/learning/url") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/learning/url.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await learnFromUrls(parseLearningUrlRequest(body), experienceStore, experienceFetchText),
    );
    return;
  }

  if (url.pathname === "/v1/learning/query") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/learning/query.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await learnFromQueries(
        parseLearningQueryRequest(body),
        experienceStore,
        hostEnv,
        experienceFetchText,
      ),
    );
    return;
  }

  if (url.pathname === "/v1/intake") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/intake.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    if (!isDirectorIntakeRequest(body)) {
      throw new DirectorHostHttpError(
        400,
        "INVALID_INTAKE_REQUEST",
        "Request body must be a valid Director intake request.",
      );
    }
    const evaluation = await service.evaluateSnapshot(body);
    writeJson(response, 200, createIntakeResponse(runtime, body, evaluation));
    return;
  }

  if (url.pathname === "/v1/entry/intake") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/entry/intake.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    if (!isDirectorEntryIntakeRequest(body)) {
      throw new DirectorHostHttpError(
        400,
        "INVALID_ENTRY_INTAKE_REQUEST",
        "Request body must be a valid Director entry intake request.",
      );
    }
    assertEntryAdmissionText(body.intake.objective, {
      channel: body.entry.channel,
      peerId: body.entry.sessionKey,
    });
    const intakeRequest = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: body.snapshot,
      intake: body.intake,
    } as const;
    const evaluation = await service.evaluateSnapshot(intakeRequest);
    const intakeResponse = createIntakeResponse(runtime, intakeRequest, evaluation);
    writeJson(response, 200, await entryStore.recordIntake(body, intakeResponse));
    return;
  }

  if (url.pathname === "/v1/entry/message") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/entry/message.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    if (!isDirectorEntryMessageRequest(body)) {
      throw new DirectorHostHttpError(
        400,
        "INVALID_ENTRY_MESSAGE_REQUEST",
        "Request body must be a valid Director entry message request.",
      );
    }
    const normalizedBody = await normalizeEntryMessageRequest(entryStore, body);
    const messageText = normalizedBody.message.text;
    if (typeof messageText !== "string") {
      throw new DirectorHostHttpError(
        400,
        "INVALID_ENTRY_MESSAGE_REQUEST",
        "Request body must include message text.",
      );
    }
    assertEntryAdmissionText(messageText, {
      channel: normalizedBody.message.channel,
      peerId: normalizedBody.message.peerId,
    });
    const intakeRequest = buildEntryIntakeRequestFromMessage(runtime, normalizedBody);
    const evaluateRequest = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: intakeRequest.snapshot,
      intake: intakeRequest.intake,
    } as const;
    const evaluation = await service.evaluateSnapshot(evaluateRequest);
    const intakeResponse = createIntakeResponse(
      runtime,
      {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshot: intakeRequest.snapshot,
        intake: intakeRequest.intake,
      },
      evaluation,
    );
    const recordedIntake = await entryStore.recordIntake(intakeRequest, intakeResponse);
    const agentOsProjection = createEntryAgentOsProjectionFromMessage(
      runtime,
      normalizedBody,
      recordedIntake.session,
    );
    writeJson(response, 200, withEntryAgentOsProjection(recordedIntake, agentOsProjection));
    return;
  }

  const entrySessionRoute = matchEntrySessionRoute(url.pathname);
  if (entrySessionRoute !== null) {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/entry/sessions/:entrySessionId.",
      );
    }
    const session = await entryStore.loadSession(
      decodeURIComponent(entrySessionRoute.entrySessionId),
    );
    if (session === null) {
      throw new DirectorHostHttpError(
        404,
        "ENTRY_SESSION_NOT_FOUND",
        `Unknown entry session: ${entrySessionRoute.entrySessionId}`,
      );
    }
    writeJson(response, 200, session);
    return;
  }

  const entrySessionActionRoute = matchEntrySessionActionRoute(url.pathname);
  if (entrySessionActionRoute !== null) {
    const entrySessionId = decodeURIComponent(entrySessionActionRoute.entrySessionId);

    if (entrySessionActionRoute.action === "blueprint") {
      if (method !== "POST") {
        throw new DirectorHostHttpError(
          405,
          "METHOD_NOT_ALLOWED",
          "Method not allowed for /v1/entry/sessions/:entrySessionId/blueprint.",
        );
      }
      const blueprintRequest = await invokeEntrySessionOperation(
        () => entryStore.loadBlueprintRequest(entrySessionId),
        runtime,
        {
          blockedRoute: {
            method: "POST",
            path: `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/blueprint`,
          },
          nextRoute: {
            method: "GET",
            path: `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}`,
          },
          recommendedAction:
            "Inspect the entry session, resolve clarification or missing intake state, then create the blueprint again.",
        },
      );
      const blueprint = await createDirectorBlueprint(runtime, service, blueprintRequest);
      const session = await invokeEntrySessionOperation(
        () => entryStore.recordBlueprint(entrySessionId, blueprint),
        runtime,
      );
      writeJson(response, 200, {
        apiVersion: DIRECTOR_ENTRY_API_VERSION,
        directorApiVersion: DIRECTOR_HOST_API_VERSION,
        session,
        blueprint,
      });
      return;
    }

    if (entrySessionActionRoute.action === "runs") {
      if (method !== "POST") {
        throw new DirectorHostHttpError(
          405,
          "METHOD_NOT_ALLOWED",
          "Method not allowed for /v1/entry/sessions/:entrySessionId/runs.",
        );
      }
      const blueprint = await invokeEntrySessionOperation(
        () => entryStore.loadRunSource(entrySessionId),
        runtime,
        {
          blockedRoute: {
            method: "POST",
            path: `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/runs`,
          },
          nextRoute: {
            method: "GET",
            path: `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}`,
          },
          recommendedAction:
            "Inspect the entry session and ensure a blueprint exists before creating a run.",
        },
      );
      const run = await createExecutionRun(executionService, blueprint, runtime.config.dataDir);
      const session = await invokeEntrySessionOperation(
        () => entryStore.recordRun(entrySessionId, run),
        runtime,
      );
      writeJson(response, 201, {
        apiVersion: DIRECTOR_ENTRY_API_VERSION,
        directorApiVersion: DIRECTOR_HOST_API_VERSION,
        session,
        run,
      });
      return;
    }

    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/entry/sessions/:entrySessionId/status.",
      );
    }
    const session = await invokeEntrySessionOperation(
      () => entryStore.loadSession(entrySessionId),
      runtime,
    );
    if (session === null) {
      throw new DirectorHostHttpError(
        404,
        "ENTRY_SESSION_NOT_FOUND",
        `Unknown entry session: ${entrySessionId}`,
      );
    }
    if (session.latestRun === undefined) {
      const agentOsProjection = createEntryAgentOsProjectionFromSession(session);
      writeJson(response, 200, {
        apiVersion: DIRECTOR_ENTRY_API_VERSION,
        directorApiVersion: DIRECTOR_HOST_API_VERSION,
        session: withSessionAgentOsProjection(session, agentOsProjection),
        agentOsProjection,
      });
      return;
    }
    const latestRun = session.latestRun;
    const report = await invokeRunOperation(
      () => executionService.collectRunReport(latestRun.runId),
      runtime,
    );
    const syncedSession = await invokeEntrySessionOperation(
      () => entryStore.syncRunProjection(entrySessionId, report.run, report),
      runtime,
    );
    const agentOsProjection = createEntryAgentOsProjectionFromSession(syncedSession);
    writeJson(response, 200, {
      apiVersion: DIRECTOR_ENTRY_API_VERSION,
      directorApiVersion: DIRECTOR_HOST_API_VERSION,
      session: withSessionAgentOsProjection(syncedSession, agentOsProjection),
      run: report.run,
      report,
      agentOsProjection,
    });
    return;
  }

  if (url.pathname === "/v1/clarify") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/clarify.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    if (!isDirectorClarifyRequest(body)) {
      throw new DirectorHostHttpError(
        400,
        "INVALID_CLARIFY_REQUEST",
        "Request body must be a valid Director clarify request.",
      );
    }
    const evaluation = await service.evaluateSnapshot(body);
    writeJson(response, 200, createClarifyResponse(runtime, body, evaluation));
    return;
  }

  if (url.pathname === "/v1/blueprint") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/blueprint.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    if (!isDirectorBlueprintRequest(body)) {
      throw new DirectorHostHttpError(
        400,
        "INVALID_BLUEPRINT_REQUEST",
        "Request body must be a valid Director blueprint request.",
      );
    }
    writeJson(response, 200, await createDirectorBlueprint(runtime, service, body));
    return;
  }

  if (url.pathname === "/v1/runs") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/runs.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    if (!isDirectorBlueprintResponse(body)) {
      throw new DirectorHostHttpError(
        400,
        "INVALID_RUN_CREATE_REQUEST",
        "Request body must be a valid Director blueprint response.",
      );
    }
    writeJson(
      response,
      201,
      await createExecutionRun(executionService, body, runtime.config.dataDir),
    );
    return;
  }

  const runControlRoute = matchRunControlRoute(url.pathname);
  if (runControlRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        `Method not allowed for /v1/runs/:runId/${runControlRoute.action}.`,
      );
    }
    const runId = decodeURIComponent(runControlRoute.runId);
    if (runControlRoute.action === "retry") {
      const body = await readJsonBody<unknown>(request);
      if (!isRetryAssignmentRequest(body)) {
        throw new DirectorHostHttpError(
          400,
          "INVALID_RETRY_REQUEST",
          "Request body must contain a non-empty assignmentId.",
        );
      }
      writeJson(
        response,
        200,
        await invokeRunOperation(
          () => executionService.retryAssignment(runId, body.assignmentId),
          runtime,
          {
            blockedRoute: {
              method: "POST",
              path: `/v1/runs/${encodeURIComponent(runId)}/retry`,
            },
            nextRoute: {
              method: "GET",
              path: `/v1/runs/${encodeURIComponent(runId)}/report`,
            },
            recommendedAction:
              "Inspect the run report before retrying, rerouting, or starting a replacement bounded run.",
          },
        ),
      );
      return;
    }
    if (runControlRoute.action === "approve") {
      const body = await readJsonBody<unknown>(request);
      if (!isApproveAssignmentRequest(body)) {
        throw new DirectorHostHttpError(
          400,
          "INVALID_APPROVE_REQUEST",
          "Request body must contain a non-empty assignmentId.",
        );
      }
      writeJson(
        response,
        200,
        await invokeRunOperation(
          () => executionService.approveAssignment(runId, body.assignmentId),
          runtime,
          {
            blockedRoute: {
              method: "POST",
              path: `/v1/runs/${encodeURIComponent(runId)}/approve`,
            },
            nextRoute: {
              method: "GET",
              path: `/v1/runs/${encodeURIComponent(runId)}/report`,
            },
            recommendedAction:
              "Inspect the run report before approving another operator-gated assignment.",
          },
        ),
      );
      return;
    }
    if (runControlRoute.action === "reroute") {
      const body = await readJsonBody<unknown>(request);
      if (!isRerouteAssignmentRequest(body)) {
        throw new DirectorHostHttpError(
          400,
          "INVALID_REROUTE_REQUEST",
          "Request body must contain non-empty assignmentId and adapterId fields.",
        );
      }
      writeJson(
        response,
        200,
        await invokeRunOperation(
          () => executionService.rerouteAssignment(runId, body.assignmentId, body.adapterId),
          runtime,
          {
            blockedRoute: {
              method: "POST",
              path: `/v1/runs/${encodeURIComponent(runId)}/reroute`,
            },
            nextRoute: {
              method: "GET",
              path: `/v1/runs/${encodeURIComponent(runId)}/report`,
            },
            recommendedAction:
              "Inspect the run report and adapter state before attempting another reroute.",
          },
        ),
      );
      return;
    }

    const run = await invokeRunOperation(
      () => {
        if (runControlRoute.action === "start") {
          return executionService.startRun(runId);
        }
        if (runControlRoute.action === "pause") {
          return executionService.pauseRun(runId);
        }
        if (runControlRoute.action === "resume") {
          return executionService.resumeRun(runId);
        }
        return executionService.abortRun(runId);
      },
      runtime,
      {
        blockedRoute: {
          method: "POST",
          path: `/v1/runs/${encodeURIComponent(runId)}/${runControlRoute.action}`,
        },
        nextRoute: {
          method: "GET",
          path: `/v1/runs/${encodeURIComponent(runId)}`,
        },
        recommendedAction: "Inspect the run status before repeating this run control action.",
      },
    );
    writeJson(response, 200, run);
    return;
  }

  const runReportRoute = matchRunReportRoute(url.pathname);
  if (runReportRoute !== null) {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/runs/:runId/report.",
      );
    }
    const report = await invokeRunOperation(
      () => executionService.collectRunReport(decodeURIComponent(runReportRoute.runId)),
      runtime,
    );
    writeJson(response, 200, report);
    return;
  }

  const runDelegationsRoute = matchRunDelegationsRoute(url.pathname);
  if (runDelegationsRoute !== null) {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/runs/:runId/delegations.",
      );
    }
    const runId = decodeURIComponent(runDelegationsRoute.runId);
    const run = await executionService.getRun(runId);
    if (run === null) {
      throw new DirectorHostHttpError(404, "RUN_NOT_FOUND", `Unknown execution run: ${runId}`);
    }
    writeJson(response, 200, await createRunDelegationSnapshot(runtime.config.dataDir, run));
    return;
  }

  const runSchedulerExecutorRoute = matchRunSchedulerExecutorRoute(url.pathname);
  if (runSchedulerExecutorRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/runs/:runId/scheduler-executor.",
      );
    }
    const runId = decodeURIComponent(runSchedulerExecutorRoute.runId);
    const run = await executionService.getRun(runId);
    if (run === null) {
      throw new DirectorHostHttpError(404, "RUN_NOT_FOUND", `Unknown execution run: ${runId}`);
    }
    const body = await readJsonBody<unknown>(request);
    const executorRequest = parseRunSchedulerExecutorRequest(body);
    const schedulerExecutor = await runSchedulerExecutorJob({
      sessionId: runId,
      ...(executorRequest.maxDispatches === undefined
        ? {}
        : { maxDispatches: executorRequest.maxDispatches }),
      env: createDirectorWorkerJobsEnv(runtime.config),
    });
    writeJson(response, 200, {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.run-scheduler-executor.v1",
      runId,
      schedulerExecutor,
      runDelegations: await createRunDelegationSnapshot(runtime.config.dataDir, run),
    });
    return;
  }

  const runSchedulerRecoveryRoute = matchRunSchedulerRecoveryRoute(url.pathname);
  if (runSchedulerRecoveryRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/runs/:runId/scheduler-recovery.",
      );
    }
    const runId = decodeURIComponent(runSchedulerRecoveryRoute.runId);
    const run = await executionService.getRun(runId);
    if (run === null) {
      throw new DirectorHostHttpError(404, "RUN_NOT_FOUND", `Unknown execution run: ${runId}`);
    }
    const body = await readJsonBody<unknown>(request);
    const recoveryRequest = parseRunSchedulerRecoveryRequest(body);
    const schedulerRecovery = await runSchedulerRecoveryJob({
      sessionId: runId,
      ...(recoveryRequest.actionId === undefined ? {} : { actionId: recoveryRequest.actionId }),
      ...(recoveryRequest.confirmCancelObservedDrift === undefined
        ? {}
        : { confirmCancelObservedDrift: recoveryRequest.confirmCancelObservedDrift }),
      env: createDirectorWorkerJobsEnv(runtime.config),
    });
    writeJson(response, 200, {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.run-scheduler-recovery.v1",
      runId,
      schedulerRecovery,
      runDelegations: await createRunDelegationSnapshot(runtime.config.dataDir, run),
    });
    return;
  }

  const runExperienceRoute = matchRunExperienceRoute(url.pathname);
  if (runExperienceRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/runs/:runId/experience.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    const report = await invokeRunOperation(
      () => executionService.collectRunReport(decodeURIComponent(runExperienceRoute.runId)),
      runtime,
    );
    writeJson(
      response,
      201,
      await createRunExperienceCandidate(
        runtime.config.workspaceRoot,
        report,
        parseRunExperienceRequest(body),
      ),
    );
    return;
  }

  const runReflectionRoute = matchRunReflectionRoute(url.pathname);
  if (runReflectionRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/runs/:runId/reflection.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    const report = await invokeRunOperation(
      () => executionService.collectRunReport(decodeURIComponent(runReflectionRoute.runId)),
      runtime,
    );
    writeJson(
      response,
      201,
      await createRunReflection(
        runtime.config.workspaceRoot,
        report,
        parseRunReflectionRequest(body),
      ),
    );
    return;
  }

  const runDetailRoute = matchRunDetailRoute(url.pathname);
  if (runDetailRoute !== null) {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/runs/:runId.",
      );
    }
    const runId = decodeURIComponent(runDetailRoute.runId);
    const run = await executionService.getRun(runId);
    if (run === null) {
      throw new DirectorHostHttpError(404, "RUN_NOT_FOUND", `Unknown execution run: ${runId}`);
    }
    writeJson(response, 200, run);
    return;
  }

  if (url.pathname === "/v1/evaluate") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/evaluate.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    if (!isDirectorEvaluateRequest(body)) {
      throw new DirectorHostHttpError(
        400,
        "INVALID_EVALUATE_REQUEST",
        "Request body must be a valid Director evaluate request.",
      );
    }
    const evaluation = await service.evaluateSnapshot(body);
    writeJson(response, 200, createEvaluateResponse(runtime, body, evaluation));
    return;
  }

  if (url.pathname === "/v1/outcome") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/outcome.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    if (!isDirectorOutcomeRequest(body)) {
      throw new DirectorHostHttpError(
        400,
        "INVALID_OUTCOME_REQUEST",
        "Request body must be a valid Director outcome request.",
      );
    }
    await service.recordOutcome(body, {
      runtimeId: runtime.runtimeCapabilitySnapshot.runtimeId,
    });
    writeJson(response, 200, createOutcomeResponse(body));
    return;
  }

  if (url.pathname === "/v1/knowledge/packs") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/knowledge/packs.",
      );
    }
    writeJson(response, 200, await createKnowledgePacksCatalogResponse(knowledgeStore));
    return;
  }

  if (url.pathname === "/v1/knowledge/candidates") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/knowledge/candidates.",
      );
    }
    writeJson(response, 200, await createKnowledgeCandidatesCatalogResponse(knowledgeStore));
    return;
  }

  if (url.pathname === "/v1/knowledge/recall-preview") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/knowledge/recall-preview.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await createKnowledgeRecallPreviewResponse(
        knowledgeStore,
        parseKnowledgeRecallPreviewRequest(body),
      ),
    );
    return;
  }

  if (url.pathname === "/v1/experience/candidates") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/experience/candidates.",
      );
    }
    writeJson(
      response,
      200,
      await createExperienceCandidatesCatalogResponse(experienceStore, experienceTaxonomyStore),
    );
    return;
  }

  if (url.pathname === "/v1/experience/categories") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/experience/categories.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await upsertExperienceCategory(
        experienceTaxonomyStore,
        parseTaxonomyCategoryRequest(body, "INVALID_EXPERIENCE_CATEGORY_REQUEST"),
      ),
    );
    return;
  }

  if (url.pathname === "/v1/experience/tags") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/experience/tags.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await upsertExperienceTag(
        experienceTaxonomyStore,
        parseTaxonomyTagRequest(body, "INVALID_EXPERIENCE_TAG_REQUEST"),
      ),
    );
    return;
  }

  const experienceTaxonomyRoute = matchExperienceCandidateTaxonomyRoute(url.pathname);
  if (experienceTaxonomyRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/experience/candidates/:candidateId/taxonomy.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await updateExperienceCandidateTaxonomy(
        experienceTaxonomyStore,
        experienceStore,
        experienceTaxonomyRoute.candidateId,
        parseTaxonomyBindingRequest(body, "INVALID_EXPERIENCE_TAXONOMY_REQUEST"),
      ),
    );
    return;
  }

  const experienceCandidateRoute = matchExperienceCandidateRoute(url.pathname);
  if (experienceCandidateRoute !== null) {
    if (method !== "PATCH") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/experience/candidates/:candidateId.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await updateExperienceCandidate(
        experienceStore,
        experienceCandidateRoute.candidateId,
        parseExperienceCandidateUpdateRequest(body),
      ),
    );
    return;
  }

  const experienceCandidateActionRoute = matchExperienceCandidateActionRoute(url.pathname);
  if (experienceCandidateActionRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/experience/candidates/:candidateId/:action.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    const operatorRequest = parseDirectorHostOperatorRequest(body);
    writeJson(
      response,
      200,
      await handleExperienceCandidateAction(
        experienceCandidateActionRoute,
        operatorRequest,
        experienceStore,
        knowledgeStore,
        experienceTaxonomyStore,
      ),
    );
    return;
  }

  if (url.pathname === "/v1/skills") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills.",
      );
    }
    writeJson(
      response,
      200,
      await createApprovedSkillsCatalogResponse(
        skillRepository,
        skillManagementStore,
        runtime.config.dataDir,
        skillTaxonomyStore,
        parseSkillCatalogQueryFromUrl(url),
        runtime,
      ),
    );
    return;
  }

  if (url.pathname === "/v1/skills/proposals") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/proposals.",
      );
    }
    writeJson(response, 200, await createSkillProposalsCatalogResponse(runtime.config.dataDir));
    return;
  }

  if (url.pathname === "/v1/skills/proposals/from-experience") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/proposals/from-experience.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await createSkillProposalFromExperience(
        parseSkillProposalFromExperienceRequest(body),
        runtime.config.dataDir,
        experienceStore,
      ),
    );
    return;
  }

  if (url.pathname === "/v1/skills/curator/actions/guard") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/curator/actions/guard.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      createSkillCuratorWriteGuardResponse(parseSkillCuratorWriteGuardRequest(body)),
    );
    return;
  }

  const traceProposalExperienceRoute = matchTraceProposalExperienceRoute(url.pathname);
  if (traceProposalExperienceRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/trace-proposals/:proposalId/experience.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await createTraceProposalExperienceCandidate(
        runtime.config.workspaceRoot,
        runtimeRoot,
        traceProposalExperienceRoute.proposalId,
        parseTraceProposalExperienceRequest(body),
      ),
    );
    return;
  }

  if (url.pathname === "/v1/heartbeat/status") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/heartbeat/status.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await createHeartbeatStatusResponse(
        runtime.config.workspaceRoot,
        runtime.config.dataDir,
        parseHeartbeatStatusRequest(body),
      ),
    );
    return;
  }

  if (url.pathname === "/v1/soul/candidates") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/soul/candidates.",
      );
    }
    writeJson(response, 200, await createSoulCandidatesResponse(runtime.config.workspaceRoot));
    return;
  }

  if (url.pathname === "/v1/soul") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/soul.",
      );
    }
    writeJson(response, 200, await createSoulViewResponse(runtime.config.workspaceRoot));
    return;
  }

  const soulCandidateActionRoute = matchSoulCandidateActionRoute(url.pathname);
  if (soulCandidateActionRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/soul/candidates/:candidateId/:action.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await decideSoulCandidate(
        runtime.config.workspaceRoot,
        soulCandidateActionRoute.candidateId,
        soulCandidateActionRoute.action,
        parseDirectorHostOperatorRequest(body),
      ),
    );
    return;
  }

  const soulCandidateRoute = matchSoulCandidateRoute(url.pathname);
  if (soulCandidateRoute !== null) {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/soul/candidates/:candidateId.",
      );
    }
    writeJson(
      response,
      200,
      await createSoulCandidateResponse(
        runtime.config.workspaceRoot,
        soulCandidateRoute.candidateId,
      ),
    );
    return;
  }

  if (url.pathname === "/v1/experience/taxonomy") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/experience/taxonomy.",
      );
    }
    writeJson(response, 200, {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.experience-taxonomy.v1",
      taxonomy: await experienceTaxonomyStore.inspectTaxonomy(),
    });
    return;
  }

  if (url.pathname === "/v1/skills/taxonomy") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/taxonomy.",
      );
    }
    writeJson(response, 200, {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.skill-taxonomy.v1",
      taxonomy: await skillTaxonomyStore.inspectTaxonomy(),
    });
    return;
  }

  if (url.pathname === "/v1/skills/taxonomy/categories") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/taxonomy/categories.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await upsertSkillCategory(
        skillTaxonomyStore,
        parseTaxonomyCategoryRequest(body, "INVALID_SKILL_CATEGORY_REQUEST"),
      ),
    );
    return;
  }

  if (url.pathname === "/v1/skills/taxonomy/tags") {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/taxonomy/tags.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      201,
      await upsertSkillTag(
        skillTaxonomyStore,
        parseTaxonomyTagRequest(body, "INVALID_SKILL_TAG_REQUEST"),
      ),
    );
    return;
  }

  const skillTaxonomyRoute = matchSkillTaxonomyRoute(url.pathname);
  if (skillTaxonomyRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/:skillId/taxonomy.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await updateSkillTaxonomy(
        skillTaxonomyStore,
        skillRepository,
        skillTaxonomyRoute.skillId,
        parseTaxonomyBindingRequest(body, "INVALID_SKILL_TAXONOMY_REQUEST"),
      ),
    );
    return;
  }

  const skillEnablementRoute = matchSkillEnablementRoute(url.pathname);
  if (skillEnablementRoute !== null) {
    if (method !== "PUT") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/:skillId/enabled.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await setSkillEnablement(
        skillRepository,
        skillManagementStore,
        skillEnablementRoute.skillId,
        parseSkillEnablementRequest(body),
      ),
    );
    return;
  }

  const skillUseRoute = matchSkillUseRoute(url.pathname);
  if (skillUseRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/:skillId/use.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await recordSkillUse(
        skillRepository,
        skillManagementStore,
        runtime.config.dataDir,
        skillUseRoute.skillId,
        parseDirectorHostOperatorRequest(body),
        runtime,
      ),
    );
    return;
  }

  const skillViewRoute = matchSkillViewRoute(url.pathname);
  if (skillViewRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/:skillId/view.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await recordSkillView(
        skillRepository,
        skillManagementStore,
        runtime.config.dataDir,
        skillViewRoute.skillId,
        parseDirectorHostOperatorRequest(body),
        runtime,
      ),
    );
    return;
  }

  const skillManagementRoute = matchSkillManagementRoute(url.pathname);
  if (skillManagementRoute !== null) {
    if (method === "GET") {
      writeJson(
        response,
        200,
        await createApprovedSkillViewResponse(
          skillRepository,
          skillManagementStore,
          runtime.config.dataDir,
          skillManagementRoute.skillId,
          runtime,
        ),
      );
      return;
    }
    if (method === "PATCH") {
      const body = await readJsonBody<unknown>(request);
      writeJson(
        response,
        200,
        await updateApprovedSkill(
          skillRepository,
          skillManagementStore,
          skillManagementRoute.skillId,
          runtime.config.dataDir,
          parseSkillUpdateRequest(body),
        ),
      );
      return;
    }
    if (method === "DELETE") {
      const body = await readJsonBody<unknown>(request);
      writeJson(
        response,
        200,
        await deleteApprovedSkill(
          skillRepository,
          skillManagementStore,
          skillManagementRoute.skillId,
          runtime.config.dataDir,
          parseDirectorHostOperatorRequest(body),
        ),
      );
      return;
    }
    throw new DirectorHostHttpError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for /v1/skills/:skillId.",
    );
  }

  const skillProposalActionRoute = matchSkillProposalActionRoute(url.pathname);
  if (skillProposalActionRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/skills/proposals/:proposalId/:action.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(
      response,
      200,
      await handleSkillProposalAction(
        skillProposalActionRoute,
        parseDirectorHostOperatorRequest(body),
        runtime.config.dataDir,
      ),
    );
    return;
  }

  const knowledgeCandidateActionRoute = matchKnowledgeCandidateActionRoute(url.pathname);
  if (knowledgeCandidateActionRoute !== null) {
    if (method !== "POST") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/knowledge/candidates/:packId/:action.",
      );
    }
    const body = await readJsonBody<unknown>(request);
    const operatorRequest = parseDirectorHostOperatorRequest(body);
    writeJson(
      response,
      200,
      await handleKnowledgeCandidateAction(
        knowledgeCandidateActionRoute,
        operatorRequest,
        knowledgeStore,
      ),
    );
    return;
  }

  if (url.pathname === "/v1/catalog") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/catalog.",
      );
    }
    writeJson(
      response,
      200,
      await createUnifiedCatalogResponse(
        knowledgeStore,
        experienceStore,
        experienceTaxonomyStore,
        skillRepository,
        skillTaxonomyStore,
        runtime.config.dataDir,
        executionService,
        runtime.config.dataDir,
        runtimeRoot,
        runtime,
      ),
    );
    return;
  }

  if (url.pathname === "/v1/catalog/knowledge-packs") {
    if (method !== "GET") {
      throw new DirectorHostHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for /v1/catalog/knowledge-packs.",
      );
    }
    const includeDraft =
      url.searchParams.get("includeDraft") === "1" ||
      url.searchParams.get("includeDraft") === "true";
    const catalog = await service.listKnowledgePacks({
      apiVersion: DIRECTOR_HOST_API_VERSION,
      ...(includeDraft ? { includeDraft } : {}),
    });
    writeJson(response, 200, catalog);
    return;
  }

  throw new DirectorHostHttpError(404, "NOT_FOUND", `Route ${method} ${url.pathname} not found.`);
}

function matchEntrySessionRoute(pathname: string): { readonly entrySessionId: string } | null {
  const match = /^\/v1\/entry\/sessions\/([^/]+)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return { entrySessionId: match[1] ?? "" };
}

function matchEntrySessionActionRoute(
  pathname: string,
): { readonly entrySessionId: string; readonly action: "blueprint" | "runs" | "status" } | null {
  const match = /^\/v1\/entry\/sessions\/([^/]+)\/(blueprint|runs|status)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  const action = match[2];
  if (action !== "blueprint" && action !== "runs" && action !== "status") {
    return null;
  }
  return {
    entrySessionId: match[1] ?? "",
    action,
  };
}

function matchClientRuntimeTaskRoute(pathname: string): { readonly taskId: string } | null {
  const match = /^\/v1\/client-runtime\/tasks\/([^/]+)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return { taskId: match[1] ?? "" };
}

function matchClientRuntimeStopRoute(pathname: string): { readonly taskId: string } | null {
  const match = /^\/v1\/client-runtime\/tasks\/([^/]+)\/stop$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return { taskId: match[1] ?? "" };
}

function matchClientRuntimeFollowupRoute(pathname: string): { readonly taskId: string } | null {
  const match = /^\/v1\/client-runtime\/tasks\/([^/]+)\/followup$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return { taskId: match[1] ?? "" };
}

function matchClientRuntimeSteerRoute(pathname: string): { readonly taskId: string } | null {
  const match = /^\/v1\/client-runtime\/tasks\/([^/]+)\/steer$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return { taskId: match[1] ?? "" };
}

function withEntryAgentOsProjection<
  T extends {
    readonly session: DirectorEntrySession;
  },
>(
  body: T,
  agentOsProjection: DirectorEntryAgentOsProjection,
): T & {
  readonly session: DirectorEntrySession;
  readonly agentOsProjection: DirectorEntryAgentOsProjection;
} {
  return {
    ...body,
    session: withSessionAgentOsProjection(body.session, agentOsProjection),
    agentOsProjection,
  };
}

function withSessionAgentOsProjection(
  session: DirectorEntrySession,
  agentOsProjection: DirectorEntryAgentOsProjection,
): DirectorEntrySession {
  return {
    ...session,
    agentOsProjection,
  };
}

function createEntryAgentOsProjectionFromMessage(
  runtime: DirectorHostRuntime,
  request: DirectorEntryMessageRequest,
  session: DirectorEntrySession,
): DirectorEntryAgentOsProjection {
  const turnId = session.latestTurnId;
  const envelope = createAgentOsTurnEnvelopeFromChannelTransport({
    hostId: request.hostId,
    surface: resolveEntryAgentOsSurface(request.message.channel),
    message: request.message,
    workspaceRoot: runtime.config.workspaceRoot,
    dataDir: runtime.config.dataDir,
    turnId,
  });
  const timeline = createEntryAgentOsReceivedTimeline(turnId, session.updatedAt);
  const summary = projectAgentOsTimelineSummary(timeline);
  const latestEvent = timeline.at(-1);
  const queueDirective: AgentOsQueueDirective = envelope.queueDirective ?? {
    lane: "session",
    mode: "enqueue",
    dropPolicy: "summarize",
  };

  return {
    schemaId: DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SCHEMA_ID,
    source: "channel-transport",
    turnId,
    sessionKey: envelope.sessionKey,
    latestLineage: session.latestLineage,
    actorTrustLevel: envelope.actor.trustLevel,
    turnKind: envelope.turnKind,
    channel: {
      adapterId: envelope.channel.adapterId,
      channel: envelope.channel.channel,
      routeKind: normalizeEntryRouteKind(envelope.channel.routeKind),
      sourceId: envelope.channel.sourceId,
      ...(envelope.channel.threadId === undefined ? {} : { threadId: envelope.channel.threadId }),
      deliveryTargetKind: envelope.channel.deliveryTarget.kind,
      deliveryTargetId: envelope.channel.deliveryTarget.targetId,
    },
    permission: {
      mode: envelope.permissionContext.mode,
      approvalBoundary: envelope.permissionContext.approvalBoundary,
      remoteUnsafeCommandPolicy: envelope.permissionContext.remoteUnsafeCommandPolicy,
    },
    sandbox: {
      verdict: envelope.sandboxPreflight.verdict,
      sandboxMode: envelope.sandboxPreflight.sandboxMode,
      ...(envelope.sandboxPreflight.reason === undefined
        ? {}
        : { reason: envelope.sandboxPreflight.reason }),
    },
    memory: {
      lane: envelope.memoryScope.lane,
      localOnly: envelope.memoryScope.localOnly,
      enabledLayers: [...envelope.memoryScope.enabledLayers],
      evidenceRequired: envelope.memoryScope.evidenceRequired,
    },
    queue: {
      lane: queueDirective.lane,
      mode: queueDirective.mode,
      dropPolicy: queueDirective.dropPolicy ?? "none",
    },
    timelineSummary: {
      ...summary,
      totalEvents: timeline.length,
      ...(latestEvent === undefined ? {} : { latestEventType: latestEvent.eventType }),
    },
  };
}

function createEntryAgentOsProjectionFromSession(
  session: DirectorEntrySession,
): DirectorEntryAgentOsProjection {
  const timeline = createEntryAgentOsSessionTimeline(session);
  const summary = projectAgentOsTimelineSummary(timeline);
  const latestEvent = timeline.at(-1);

  return {
    schemaId: DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SCHEMA_ID,
    source: "entry-session",
    turnId: session.latestTurnId,
    sessionKey: session.sessionKey,
    latestLineage: session.latestLineage,
    actorTrustLevel: session.channel === "weixin" ? "paired-channel" : "untrusted-remote",
    turnKind: "user-message",
    channel: {
      adapterId: `${session.channel}-adapter`,
      channel: session.channel,
      routeKind: session.routeKind,
      sourceId: session.sessionKey,
      deliveryTargetKind: "channel",
      deliveryTargetId: session.sessionKey,
    },
    permission: {
      mode: "ask",
      approvalBoundary: "all-tools",
      remoteUnsafeCommandPolicy: "block",
    },
    sandbox: {
      verdict: "blocked",
      sandboxMode: "disabled",
      reason:
        "Entry session projection is read-only; execution requires runtime sandbox admission.",
    },
    memory: {
      lane: "user",
      localOnly: true,
      enabledLayers: ["L0", "L1"],
      evidenceRequired: true,
    },
    queue: {
      lane: "session",
      mode: "enqueue",
      dropPolicy: "summarize",
    },
    timelineSummary: {
      ...summary,
      totalEvents: timeline.length,
      ...(latestEvent === undefined ? {} : { latestEventType: latestEvent.eventType }),
    },
  };
}

function createEntryAgentOsReceivedTimeline(
  turnId: string,
  createdAt: string,
): readonly AgentOsTimelineEvent[] {
  return [
    {
      sequence: 1,
      turnId,
      eventId: `${turnId}:entry-received`,
      eventType: "state.transition",
      createdAt,
      payload: {
        to: "received",
        source: "director-entry",
      },
    },
  ];
}

function createEntryAgentOsSessionTimeline(
  session: DirectorEntrySession,
): readonly AgentOsTimelineEvent[] {
  const firstTurn = session.turns[0];
  const startedAt = firstTurn?.receivedAt ?? session.createdAt;
  const latestState = mapEntryStateToAgentOsState(session.state);
  let timeline = createEntryAgentOsReceivedTimeline(session.latestTurnId, startedAt);
  timeline = appendAgentOsTimelineEvent(timeline, {
    sequence: 2,
    turnId: session.latestTurnId,
    eventId: `${session.latestTurnId}:entry-session-state`,
    eventType: "state.transition",
    createdAt: session.updatedAt,
    payload: {
      from: "received",
      to: latestState,
      entryState: session.state,
      nextAction: session.nextAction,
    },
  });
  return timeline;
}

function mapEntryStateToAgentOsState(state: DirectorEntrySession["state"]) {
  if (state === "run_in_progress") {
    return "delegating";
  }
  if (state === "run_completed") {
    return "completed";
  }
  if (state === "run_failed" || state === "blocked") {
    return "blocked";
  }
  if (state === "ready_for_blueprint" || state === "ready_for_run") {
    return "context_resolved";
  }
  if (state === "clarification_required") {
    return "awaiting_approval";
  }
  return "received";
}

function normalizeEntryRouteKind(routeKind: string): "direct" | "thread" {
  return routeKind === "thread" ? "thread" : "direct";
}

function resolveEntryAgentOsSurface(channel: string): "weixin" | "api" {
  return channel === "weixin" ? "weixin" : "api";
}

function matchExperienceCandidateActionRoute(
  pathname: string,
): { readonly candidateId: string; readonly action: ExperienceCandidateAction } | null {
  const match = /^\/v1\/experience\/candidates\/([^/]+)\/(accept|reject|promote)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  const action = match[2];
  if (action !== "accept" && action !== "reject" && action !== "promote") {
    return null;
  }
  return {
    candidateId: decodeURIComponent(match[1] ?? ""),
    action,
  };
}

function matchMemoryPublicationGovernanceRoute(
  pathname: string,
): { readonly recordId: string; readonly action: DirectorMemoryPublicationAction } | null {
  const match = /^\/v1\/memory\/publications\/([^/]+)\/(retract|demote|quarantine|restore)$/u.exec(
    pathname,
  );
  if (match === null) {
    return null;
  }
  const action = match[2];
  if (
    action !== "retract" &&
    action !== "demote" &&
    action !== "quarantine" &&
    action !== "restore"
  ) {
    return null;
  }
  return {
    recordId: decodeURIComponent(match[1] ?? ""),
    action,
  };
}

function matchExperienceCandidateRoute(pathname: string): { readonly candidateId: string } | null {
  const match = /^\/v1\/experience\/candidates\/([^/]+)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    candidateId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchExperienceCandidateTaxonomyRoute(
  pathname: string,
): { readonly candidateId: string } | null {
  const match = /^\/v1\/experience\/candidates\/([^/]+)\/taxonomy$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    candidateId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchKnowledgeCandidateActionRoute(
  pathname: string,
): { readonly packId: string; readonly action: KnowledgeCandidateAction } | null {
  const match = /^\/v1\/knowledge\/candidates\/([^/]+)\/(accept|reject|publish)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  const action = match[2];
  if (action !== "accept" && action !== "reject" && action !== "publish") {
    return null;
  }
  return {
    packId: decodeURIComponent(match[1] ?? ""),
    action,
  };
}

function matchTraceProposalExperienceRoute(
  pathname: string,
): { readonly proposalId: string } | null {
  const match = /^\/v1\/trace-proposals\/([^/]+)\/experience$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    proposalId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchSoulCandidateActionRoute(
  pathname: string,
): { readonly candidateId: string; readonly action: ReviewAction } | null {
  const match = /^\/v1\/soul\/candidates\/([^/]+)\/(accept|reject)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  const action = match[2];
  if (action !== "accept" && action !== "reject") {
    return null;
  }
  return {
    candidateId: decodeURIComponent(match[1] ?? ""),
    action,
  };
}

function matchSoulCandidateRoute(pathname: string): { readonly candidateId: string } | null {
  const match = /^\/v1\/soul\/candidates\/([^/]+)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    candidateId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchSkillProposalActionRoute(
  pathname: string,
): { readonly proposalId: string; readonly action: SkillProposalAction } | null {
  const match = /^\/v1\/skills\/proposals\/([^/]+)\/(accept|reject|apply)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  const action = match[2];
  if (action !== "accept" && action !== "reject" && action !== "apply") {
    return null;
  }
  return {
    proposalId: decodeURIComponent(match[1] ?? ""),
    action,
  };
}

function matchSkillEnablementRoute(pathname: string): { readonly skillId: string } | null {
  const match = /^\/v1\/skills\/([^/]+)\/enabled$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    skillId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchSkillUseRoute(pathname: string): { readonly skillId: string } | null {
  const match = /^\/v1\/skills\/([^/]+)\/use$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    skillId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchSkillViewRoute(pathname: string): { readonly skillId: string } | null {
  const match = /^\/v1\/skills\/([^/]+)\/view$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    skillId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchSkillTaxonomyRoute(pathname: string): { readonly skillId: string } | null {
  const match = /^\/v1\/skills\/([^/]+)\/taxonomy$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    skillId: decodeURIComponent(match[1] ?? ""),
  };
}

function matchSkillManagementRoute(pathname: string): { readonly skillId: string } | null {
  const match = /^\/v1\/skills\/([^/]+)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    skillId: decodeURIComponent(match[1] ?? ""),
  };
}

function createHealthResponse(
  runtime: ReturnType<typeof bootstrapDirectorHostApi>,
): Record<string, unknown> {
  return {
    status: "ok",
    app: "@hotflow/director-host-api",
    apiVersion: DIRECTOR_HOST_API_VERSION,
    defaultProvider: runtime.config.defaultProvider,
    defaultModel: runtime.config.defaultModel,
    apiProviders: runtime.apiProviders.map((provider) => ({
      id: provider.id,
      platform: provider.platform,
      name: provider.name,
      enabled: provider.enabled,
      apiKeyConfigured: provider.apiKeyConfigured,
      modelCount: provider.modelCount,
      metadataCount: provider.metadataCount,
      capabilities: [...provider.capabilities],
      defaultModels: { ...provider.defaultModels },
    })),
    workspaceRoot: runtime.config.workspaceRoot,
    dataDir: runtime.config.dataDir,
  };
}

function createCommandsResponse(url: URL): Record<string, unknown> {
  const surface = parseCommandSurface(url.searchParams.get("surface"));
  const commands =
    surface === null
      ? getChannelCommandDefinitions()
      : getChannelCommandDefinitionsForSurface(surface);

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.commands.v1",
    surface: surface ?? "all",
    commands: commands.map((command) => ({
      id: command.id,
      canonicalName: command.canonicalName,
      aliases: [...command.aliases],
      surfaces: [...command.surfaces],
      description: command.description,
      argsHint: command.argsHint,
      outputPolicy: command.outputPolicy,
      memoryPolicy: command.memoryPolicy,
      activeSessionPolicy: command.activeSessionPolicy,
    })),
  };
}

function parseCommandSurface(value: string | null): ChannelCommandSurface | null {
  if (value === null || value.trim().length === 0 || value === "all") {
    return null;
  }
  if (value === "desktop" || value === "weixin" || value === "cli") {
    return value;
  }
  throw new DirectorHostHttpError(
    400,
    "INVALID_COMMAND_SURFACE",
    "Command surface must be one of: desktop, weixin, cli, all.",
  );
}

function assertEntryAdmissionText(
  text: string,
  metadata: { readonly channel: string; readonly peerId: string },
): void {
  const turn = orchestrateConversationTurn({
    text,
    surface: inferConversationTurnSurface(metadata.channel),
    channel: metadata.channel,
    peerId: metadata.peerId,
  });
  if (turn.memoryDecision.action !== "never-store" || turn.intent.kind !== "chat") {
    return;
  }
  throw new DirectorHostHttpError(
    422,
    "LOW_VALUE_ENTRY_MESSAGE",
    "Entry message ignored because it is low-value chatter or a casual self-report, not a Director task or learning source.",
    {
      action: "ignored",
      memoryPolicy: "never-store",
      channel: metadata.channel,
      peerId: metadata.peerId,
    },
  );
}

async function createRuntimeResponse(
  runtime: DirectorHostRuntime,
  service: DirectorService,
): Promise<Awaited<ReturnType<DirectorService["getRuntimeSummary"]>>> {
  return service.getRuntimeSummary({
    runtimeId: "director-host-api",
    workspaceRoot: runtime.config.workspaceRoot,
    dataDir: runtime.config.dataDir,
    defaultProvider: runtime.config.defaultProvider,
    defaultModel: runtime.config.defaultModel,
    availableProviders: runtime.providerIds,
    ...(runtime.providerIds.length > 0
      ? { status: "ready" as const }
      : { status: "degraded" as const }),
    notes:
      runtime.providerIds.length > 0
        ? ["Director host runtime is ready for Alpha preflight."]
        : [
            "No external providers are registered yet, but deterministic preflight is still available.",
          ],
  });
}

async function createRuntimeSnapshot(
  runtime: DirectorHostRuntime,
  service: DirectorService,
  runtimeRoot: string,
): Promise<ReturnType<typeof createRuntimeSnapshotResponse>> {
  const summary = await createRuntimeResponse(runtime, service);
  return createRuntimeSnapshotResponse(runtime, summary, {
    agentOsProcessCapabilityLedger: createHostApiProcessCapabilityLedger(runtime),
    agentOsExtensionMatrix: await createHostApiAgentOsExtensionMatrix(runtime),
    agentOsSubagentRuns: await createHostApiAgentOsSubagentRuns(
      runtime.config.dataDir,
      runtimeRoot,
    ),
  });
}

async function createHostApiAgentOsExtensionMatrix(runtime: DirectorHostRuntime) {
  if (runtime.externalToolControlPlane === undefined) {
    return undefined;
  }
  const effective = await createExternalToolsEffectiveRpcResult(runtime.externalToolControlPlane, {
    includeUnavailable: true,
  });
  return effective.agentOsExtensionMatrix;
}

async function createHostApiAgentOsSubagentRuns(dataDir: string, runtimeRoot: string) {
  const runIds = new Set<string>();
  const executionRunRoot = join(runtimeRoot, "execution", "runs");
  try {
    for (const entry of await readdir(executionRunRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        runIds.add(entry.name);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return summarizeHostApiAgentOsSubagentRuns([]);
    }
  }

  for (const sessionId of discoverDirectorWorkerTaskPlaneSessionIds(dataDir)) {
    runIds.add(sessionId);
  }
  const subagentRuns: TaskBackedSubagentRun[] = [];
  const schedulerTicks: TaskBackedSubagentSchedulerTick[] = [];
  for (const runId of runIds) {
    try {
      const taskState = await withDirectorRunTaskPlane(
        dataDir,
        runId,
        { createIfMissing: false },
        (taskPlane) => taskPlane.status(),
      );
      subagentRuns.push(...projectSubagentRunsFromTaskState(taskState));
      schedulerTicks.push(
        projectSubagentSchedulerTickFromTaskState(taskState, {
          sessionId: runId,
          latestTurnId: null,
        }),
      );
    } catch {
      // Runtime snapshots are best-effort operator surfaces; unreadable task planes
      // must not block health/capability visibility.
    }
  }

  subagentRuns.sort((left, right) => {
    if (left.updatedAtMs !== right.updatedAtMs) {
      return right.updatedAtMs - left.updatedAtMs;
    }
    return left.subagentId.localeCompare(right.subagentId);
  });
  return summarizeHostApiAgentOsSubagentRuns(subagentRuns, schedulerTicks);
}

function discoverDirectorWorkerTaskPlaneSessionIds(dataDir: string): readonly string[] {
  const dbPath = resolveDirectorWorkerSessionDbPath(dataDir);
  if (!existsSync(dbPath)) {
    return [];
  }

  const store = new SessionStore({ dbPath });
  try {
    const hits = store.search({
      query: "tasks.delegation",
      eventTypes: ["tasks.delegation_upserted", "tasks.delegation_status_set"],
      limit: 200,
      status: "all",
    }).hits;
    const sessionIds = new Set<string>();
    for (const hit of hits) {
      sessionIds.add(hit.session.sessionId);
    }
    return [...sessionIds];
  } finally {
    store.close();
  }
}

function summarizeHostApiAgentOsSubagentRuns(
  subagentRuns: readonly TaskBackedSubagentRun[],
  schedulerTicks: readonly TaskBackedSubagentSchedulerTick[] = [],
) {
  const summary = {
    total: subagentRuns.length,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    verifiedPass: 0,
    verifiedFail: 0,
    verifiedPartial: 0,
  };

  for (const run of subagentRuns) {
    summary[run.status] += 1;
    if (run.verification?.verdict === "pass") {
      summary.verifiedPass += 1;
    } else if (run.verification?.verdict === "fail") {
      summary.verifiedFail += 1;
    } else if (run.verification?.verdict === "partial") {
      summary.verifiedPartial += 1;
    }
  }

  return {
    summary,
    schedulerHeartbeat: projectSubagentSchedulerHeartbeatFromSubagentRuns(subagentRuns),
    schedulerDispatchPlan: projectSubagentSchedulerDispatchPlanFromSubagentRuns(subagentRuns),
    ...optionalSchedulerTick(mergeHostApiAgentOsSubagentSchedulerTicks(schedulerTicks)),
    schedulerRecoveryPlan: projectSubagentSchedulerRecoveryPlanFromSubagentRuns(subagentRuns),
    entries: subagentRuns.map(formatHostApiAgentOsSubagentRun),
  };
}

function mergeHostApiAgentOsSubagentSchedulerTicks(
  schedulerTicks: readonly TaskBackedSubagentSchedulerTick[],
):
  | {
      readonly schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1";
      readonly sessionId: string;
      readonly latestTurnId: string | null;
      readonly dispatchIntents: readonly TaskBackedSubagentSchedulerTickIntent[];
      readonly claimDryRun: true;
    }
  | undefined {
  const nonEmptyTicks = schedulerTicks.filter((tick) => tick.dispatchIntents.length > 0);
  if (nonEmptyTicks.length === 0) {
    return undefined;
  }
  if (nonEmptyTicks.length === 1) {
    return nonEmptyTicks[0];
  }
  const firstSessionId = nonEmptyTicks[0]?.sessionId ?? "multi-session";
  return {
    schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
    sessionId: firstSessionId,
    latestTurnId: null,
    dispatchIntents: nonEmptyTicks.flatMap((tick) => tick.dispatchIntents),
    claimDryRun: true,
  };
}

function optionalSchedulerTick(
  schedulerTick: ReturnType<typeof mergeHostApiAgentOsSubagentSchedulerTicks>,
):
  | {
      readonly schedulerTick: NonNullable<
        ReturnType<typeof mergeHostApiAgentOsSubagentSchedulerTicks>
      >;
    }
  | Record<string, never> {
  return schedulerTick === undefined ? {} : { schedulerTick };
}

function formatHostApiAgentOsSubagentRun(run: TaskBackedSubagentRun) {
  return {
    subagentId: run.subagentId,
    parentTurnId: run.parentTurnId,
    profileId: run.profileId,
    workerId: run.workerId,
    ...(run.taskId === undefined ? {} : { taskId: run.taskId }),
    status: run.status,
    role: run.role,
    ...(run.targetAgent === undefined ? {} : { targetAgent: run.targetAgent }),
    isolatedContext: run.isolatedContext,
    instruction: run.instruction,
    ...(run.contextSnapshot === undefined ? {} : { contextSnapshot: run.contextSnapshot }),
    ...(run.resultSummary === undefined ? {} : { resultSummary: run.resultSummary }),
    ...(run.observedWriteSet === undefined ? {} : { observedWriteSet: run.observedWriteSet }),
    ...(run.observedWriteSetSource === undefined
      ? {}
      : { observedWriteSetSource: run.observedWriteSetSource }),
    createdAtMs: run.createdAtMs,
    updatedAtMs: run.updatedAtMs,
    ...(run.completedAtMs === undefined ? {} : { completedAtMs: run.completedAtMs }),
    ...(run.error === undefined ? {} : { error: run.error }),
    ...(run.verification === undefined ? {} : { verification: run.verification }),
    parentVisibleResult: run.parentVisibleResult,
    ...(run.scheduling === undefined ? {} : { scheduling: run.scheduling }),
  };
}

function createHostApiProcessCapabilityLedger(runtime: DirectorHostRuntime) {
  const executions =
    typeof runtime.externalToolExecutionQueue?.list === "function"
      ? runtime.externalToolExecutionQueue.list()
      : [];
  const entries = [];
  for (const execution of executions) {
    for (const evidence of collectAgentOsSandboxEvidence(execution.result)) {
      if (!isHostApiProcessCapabilitySandboxEvidence(evidence)) {
        continue;
      }
      entries.push({
        owner: "director-host-api",
        runnerKind: inferHostApiProcessRunnerKind(execution.toolId, evidence),
        execution: {
          ok:
            evidence.exitCode === undefined
              ? execution.status !== "failed"
              : evidence.exitCode === 0,
          status:
            evidence.exitCode === undefined
              ? mapHostApiExternalToolStatusToSandboxStatus(execution.status)
              : evidence.exitCode === 0
                ? "completed"
                : "failed",
          evidence,
          ...(evidence.exitCode === undefined ? {} : { exitCode: evidence.exitCode }),
        },
      });
    }
  }
  return summarizeAgentOsProcessCapabilityLedger({ entries });
}

function isHostApiProcessCapabilitySandboxEvidence(
  evidence: AgentOsSandboxCommandExecutionEvidence,
): boolean {
  const processEnforcement = evidence.enforcement?.process;
  return (
    processEnforcement === "host-process" ||
    processEnforcement === "container" ||
    processEnforcement === "remote-session"
  );
}

function inferHostApiProcessRunnerKind(
  toolId: string | undefined,
  evidence: AgentOsSandboxCommandExecutionEvidence,
): AgentOsProcessCapabilityRunnerKind {
  const provider = evidence.providerId.toLowerCase();
  const tool = (toolId ?? "").toLowerCase();
  if (provider.includes("mcp") || tool.includes("mcp")) {
    return "mcp-stdio";
  }
  if (provider.includes("browser") || tool.includes("browser")) {
    return "browser";
  }
  if (provider.includes("comfy") || tool.includes("comfy")) {
    return "comfyui-cli";
  }
  return "exec-file";
}

function mapHostApiExternalToolStatusToSandboxStatus(
  status: string | undefined,
): "blocked" | "completed" | "failed" {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "blocked";
  }
}

function collectAgentOsSandboxEvidence(
  value: unknown,
  seen = new Set<object>(),
): AgentOsSandboxCommandExecutionEvidence[] {
  if (value === null || typeof value !== "object") {
    return [];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  const directEvidence = readAgentOsSandboxEvidence(value);
  const nested: AgentOsSandboxCommandExecutionEvidence[] = [];
  if (directEvidence !== null) {
    nested.push(directEvidence);
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    nested.push(...collectAgentOsSandboxEvidence(item, seen));
  }
  return dedupeAgentOsSandboxEvidence(nested);
}

function readAgentOsSandboxEvidence(value: unknown): AgentOsSandboxCommandExecutionEvidence | null {
  if (!isRecord(value)) {
    return null;
  }
  if (isHostApiSandboxCommandExecutionEvidenceRecord(value)) {
    return value as unknown as AgentOsSandboxCommandExecutionEvidence;
  }
  if (isRecord(value.sandbox) && isRecord(value.sandbox.evidence)) {
    return readAgentOsSandboxEvidence(value.sandbox.evidence);
  }
  if (isRecord(value.evidence)) {
    return readAgentOsSandboxEvidence(value.evidence);
  }
  return null;
}

function isHostApiSandboxCommandExecutionEvidenceRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value.backend === "string" &&
    typeof value.providerId === "string" &&
    typeof value.planHash === "string" &&
    (typeof value.commandHash === "string" ||
      typeof value.exitCode === "number" ||
      typeof value.startedAt === "string" ||
      typeof value.completedAt === "string" ||
      isRecord(value.process) ||
      Array.isArray(value.artifacts))
  );
}

function dedupeAgentOsSandboxEvidence(
  items: readonly AgentOsSandboxCommandExecutionEvidence[],
): AgentOsSandboxCommandExecutionEvidence[] {
  const seen = new Set<string>();
  const deduped = [];
  for (const item of items) {
    const key = [
      item.planHash,
      item.commandHash ?? "",
      item.startedAt ?? "",
      item.completedAt ?? "",
    ].join(":");
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }
  return deduped;
}

async function createKnowledgePacksCatalogResponse(
  knowledgeStore: FileKnowledgeStore,
): Promise<Record<string, unknown>> {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.knowledge-packs.v1",
    knowledgePacks: await knowledgeStore.listPublishedDocuments(),
  };
}

async function createKnowledgeCandidatesCatalogResponse(
  knowledgeStore: FileKnowledgeStore,
): Promise<Record<string, unknown>> {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.knowledge-candidates.v1",
    knowledgeCandidates: await knowledgeStore.listCandidateDocuments(),
  };
}

async function createKnowledgeRecallPreviewResponse(
  knowledgeStore: FileKnowledgeStore,
  input: DirectorHostKnowledgeRecallPreviewRequest,
): Promise<Record<string, unknown>> {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.knowledge-recall-preview.v1",
    recall: recallPublishedKnowledge(await knowledgeStore.listPublishedDocuments(), input),
  };
}

async function createExperienceCandidatesCatalogResponse(
  experienceStore: FileExperienceStore,
  taxonomyStore?: FileExperienceTaxonomyStore,
): Promise<Record<string, unknown>> {
  const experienceCandidates = await experienceStore.listCandidates();
  const taxonomy = taxonomyStore === undefined ? undefined : await taxonomyStore.inspectTaxonomy();
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.experience-candidates.v1",
    experienceCandidates,
    ...(taxonomy === undefined ? {} : { taxonomy }),
  };
}

async function createMaintenanceResponse(
  runtimeRoot: string,
  input: DirectorHostMaintenanceRequest,
  mode: "preview" | "apply",
): Promise<Record<string, unknown>> {
  const maintenanceInput = {
    runtimeRoot,
    experienceDir: join(dirname(runtimeRoot), "knowledge", "experience"),
    knowledgeDir: join(dirname(runtimeRoot), "knowledge"),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    ...(input.policy === undefined ? {} : { policy: input.policy }),
  };
  const report =
    mode === "apply"
      ? await applyDirectorMaintenance(maintenanceInput)
      : await inspectDirectorMaintenance(maintenanceInput);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    ...report,
    schemaId: "director.host.maintenance.v1",
    reportSchemaId: report.schemaId,
  };
}

async function createApprovedSkillsCatalogResponse(
  skillRepository: FileBackedSkillRepository,
  skillManagementStore: SkillManagementStore,
  dataDir: string,
  skillTaxonomyStore?: FileSkillTaxonomyStore,
  query: DirectorHostSkillCatalogQuery = {},
  runtime?: DirectorHostRuntime,
): Promise<Record<string, unknown>> {
  const taxonomy =
    skillTaxonomyStore === undefined ? undefined : await skillTaxonomyStore.inspectTaxonomy();
  const management = skillManagementStore.readDocument();
  const skillUsage = new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readDocument();
  const toolDoctor = await createHostSkillToolDoctorIndex(runtime);
  const allSkills = decorateSkillsWithManagement(
    skillRepository.listApproved(),
    skillManagementStore,
    skillUsage.records,
    toolDoctor,
  );
  const skillIndex = buildApprovedSkillCatalogIndex({
    skillRepository,
    skillManagementStore,
    query,
  });
  const skills =
    skillIndex === undefined
      ? allSkills
      : skillIndex.skillIds
          .map((skillId) => allSkills.find((skill) => skill.id === skillId))
          .filter((skill): skill is SkillSnapshot & Record<string, unknown> => skill !== undefined);
  const summary = summarizeSkillRuntimeStatuses(allSkills);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skills.v1",
    skills,
    summary,
    management,
    skillUsage,
    ...(skillIndex === undefined ? {} : { skillIndex }),
    ...(taxonomy === undefined ? {} : { taxonomy }),
  };
}

function buildApprovedSkillCatalogIndex(input: {
  readonly skillRepository: FileBackedSkillRepository;
  readonly skillManagementStore: SkillManagementStore;
  readonly query: DirectorHostSkillCatalogQuery;
}):
  | {
      readonly query: string;
      readonly limit: number;
      readonly includeDisabled: boolean;
      readonly skillIds: readonly string[];
    }
  | undefined {
  const query = input.query.query?.trim();
  const limit = input.query.limit;
  const includeDisabled = input.query.includeDisabled === true;
  if (query === undefined && limit === undefined && !includeDisabled) {
    return undefined;
  }
  const effectiveLimit = Math.max(0, limit ?? 8);
  const index = new SkillPromptIndex(input.skillRepository, {
    isSkillEnabled: (skill) =>
      (includeDisabled || input.skillManagementStore.isSkillEnabled(skill.id)) &&
      isHostSkillModelInvocable(skill),
  });
  const skillIds =
    query === undefined
      ? input.skillRepository
          .listApproved()
          .filter(
            (skill) =>
              (includeDisabled || input.skillManagementStore.isSkillEnabled(skill.id)) &&
              isHostSkillModelInvocable(skill),
          )
          .slice(0, effectiveLimit)
          .map((skill) => skill.id)
      : index
          .buildSections({ userText: query, limit: effectiveLimit })
          .map((section) => String(section.metadata?.skillId ?? "").trim())
          .filter((skillId) => skillId.length > 0);
  return {
    query: query ?? "",
    limit: effectiveLimit,
    includeDisabled,
    skillIds,
  };
}

async function createApprovedSkillViewResponse(
  skillRepository: FileBackedSkillRepository,
  skillManagementStore: SkillManagementStore,
  dataDir: string,
  skillId: string,
  runtime?: DirectorHostRuntime,
): Promise<Record<string, unknown>> {
  const skill = findApprovedSkillByIdOrTitle(skillRepository.listApproved(), skillId);
  if (skill === undefined) {
    throw new DirectorHostHttpError(404, "SKILL_NOT_FOUND", `Unknown approved Skill: ${skillId}`);
  }
  const usage = new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readRecord(skill.id);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-view.v1",
    skill: decorateSkillWithManagement(
      skill,
      skillManagementStore,
      usage,
      await createHostSkillToolDoctorIndex(runtime),
    ),
  };
}

async function createUnifiedCatalogResponse(
  knowledgeStore: FileKnowledgeStore,
  experienceStore: FileExperienceStore,
  experienceTaxonomyStore: FileExperienceTaxonomyStore,
  skillRepository: FileBackedSkillRepository,
  skillTaxonomyStore: FileSkillTaxonomyStore,
  dataDir: string,
  executionService: ExecutionRunService,
  workerDataDir: string,
  runtimeRoot: string,
  runtime?: DirectorHostRuntime,
): Promise<Record<string, unknown>> {
  const [
    knowledgePacks,
    knowledgeCandidates,
    knowledgeReviewDecisions,
    experienceCandidates,
    experienceReviewDecisions,
    experiencePromotions,
    experienceArtifacts,
    experienceQuarantines,
    experienceTaxonomy,
    skillTaxonomy,
    skillProposals,
    execution,
  ] = await Promise.all([
    knowledgeStore.listPublishedDocuments(),
    knowledgeStore.listCandidateDocuments(),
    knowledgeStore.listReviewDecisions(),
    experienceStore.listCandidates(),
    experienceStore.listReviewDecisions(),
    experienceStore.listPromotions(),
    experienceStore.listSourceArtifacts(),
    experienceStore.listQuarantineRecords(),
    experienceTaxonomyStore.inspectTaxonomy(),
    skillTaxonomyStore.inspectTaxonomy(),
    listDirectorSkillProposalRecords(dataDir),
    inspectHostExecutionRunAssets(executionService, runtimeRoot, workerDataDir),
  ]);
  const skillManagementStore = new SkillManagementStore(resolveSkillManagementPath({ dataDir }));
  const skillUsage = new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readDocument();
  const toolDoctor = await createHostSkillToolDoctorIndex(runtime);
  const decoratedSkills = decorateSkillsWithManagement(
    skillRepository.listApproved(),
    skillManagementStore,
    skillUsage.records,
    toolDoctor,
  );
  const skillSummary = summarizeSkillRuntimeStatuses(decoratedSkills);
  const knowledgeDecisionMap = new Map(
    knowledgeReviewDecisions.map((decision) => [decision.packId, decision]),
  );
  const experienceTaxonomyMap = new Map(
    experienceTaxonomy.candidates.map((entry) => [entry.candidateId, entry] as const),
  );

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.catalog.v1",
    knowledgePacks,
    knowledgeCandidates,
    knowledgeCandidateInspections: knowledgeCandidates.map((candidate) => ({
      candidate,
      latestReview: knowledgeDecisionMap.get(candidate.metadata.id) ?? null,
      status: resolveKnowledgeCandidateReviewStatus(
        candidate,
        knowledgeDecisionMap.get(candidate.metadata.id),
      ),
    })),
    experienceCandidates,
    experienceCandidateInspections: experienceCandidates.map((candidate) =>
      inspectExperienceCandidateForHostCatalog(
        candidate,
        experienceReviewDecisions,
        experiencePromotions,
        experienceTaxonomyMap.get(candidate.candidateId) ?? null,
      ),
    ),
    experienceArtifacts,
    experienceQuarantines,
    experienceTaxonomy,
    skills: decoratedSkills,
    skillSummary,
    skillManagement: skillManagementStore.readDocument(),
    skillUsage,
    skillTaxonomy,
    skillProposals: skillProposals.map(formatSkillProposalAsset),
    ...execution,
  };
}

async function createSkillProposalsCatalogResponse(
  dataDir: string,
): Promise<Record<string, unknown>> {
  const proposals = await listDirectorSkillProposalRecords(dataDir);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-proposals.v1",
    sessionId: DIRECTOR_SKILL_SESSION_ID,
    proposalQueuePath: resolveDirectorSkillSessionDbPath(dataDir),
    proposals: proposals.map(formatSkillProposalAsset),
  };
}

function createSkillCuratorWriteGuardResponse(
  input: DirectorHostSkillCuratorWriteGuardRequest,
): Record<string, unknown> {
  const guard = guardSkillCuratorWriteRequest({
    action: {
      kind: input.action,
      skillId: input.skillId,
      ...(input.note === undefined ? {} : { reason: input.note }),
      ...(input.canonicalSkillId === undefined ? {} : { canonicalSkillId: input.canonicalSkillId }),
      ...(input.duplicateSkillIds === undefined
        ? {}
        : { duplicateSkillIds: input.duplicateSkillIds }),
    },
    operator: {
      actor: input.actor ?? "director-host-api",
      surface: "host-api",
      scopes: input.scopes ?? [],
    },
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-curator-write-guard.v1",
    status: guard.status,
    applied: false,
    guard,
  };
}

function parseSkillCuratorWriteGuardRequest(
  value: unknown,
): DirectorHostSkillCuratorWriteGuardRequest {
  const code = "INVALID_SKILL_CURATOR_WRITE_GUARD_REQUEST";
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(400, code, "Request body must be a JSON object.");
  }
  const rawAction = parseRequiredTrimmedString(value.action, "action", { code });
  if (rawAction !== "patch" && rawAction !== "archive" && rawAction !== "merge") {
    throw new DirectorHostHttpError(
      400,
      code,
      "Request body field action must be patch, archive, or merge.",
    );
  }
  const skillId = parseRequiredTrimmedString(value.skillId, "skillId", { code });
  const operator = parseDirectorHostOperatorRequest(value);
  const canonicalSkillId = parseOptionalTrimmedStringWithCode(
    value.canonicalSkillId,
    "canonicalSkillId",
    {
      code,
    },
  );
  const duplicateSkillIds = parseOptionalStringArray(value.duplicateSkillIds, "duplicateSkillIds", {
    code,
  });
  const scopes = parseOptionalStringArray(value.scopes, "scopes", { code });
  return {
    ...operator,
    action: rawAction,
    skillId,
    ...(canonicalSkillId === undefined ? {} : { canonicalSkillId }),
    ...(duplicateSkillIds === undefined ? {} : { duplicateSkillIds }),
    ...(scopes === undefined ? {} : { scopes }),
  };
}

function decorateSkillsWithManagement(
  skills: readonly SkillSnapshot[],
  skillManagementStore: SkillManagementStore,
  usageRecords: Readonly<Record<string, unknown>> = {},
  toolDoctor: SkillToolDoctorIndex = createEmptySkillToolDoctorIndex(),
): ReadonlyArray<SkillSnapshot & Record<string, unknown>> {
  return skills.map((skill) =>
    decorateSkillWithManagement(
      skill,
      skillManagementStore,
      usageRecords[skill.id] ?? null,
      toolDoctor,
    ),
  );
}

function decorateSkillWithManagement(
  skill: SkillSnapshot,
  skillManagementStore: SkillManagementStore,
  usage: unknown = null,
  toolDoctor: SkillToolDoctorIndex = createEmptySkillToolDoctorIndex(),
): SkillSnapshot & Record<string, unknown> {
  const management = skillManagementStore.readDocument();
  const decisions = new Map(management.decisions.map((decision) => [decision.skillId, decision]));
  const decision = decisions.get(skill.id) ?? null;
  const configuredEnabled = !management.disabledSkillIds.includes(skill.id);
  const modelInvocable = isHostSkillModelInvocable(skill);
  const doctor = deriveSkillDoctor({
    toolNames: skill.toolNames ?? [],
    enabled: configuredEnabled,
    modelInvocable,
    toolDoctor,
  });
  const runtimeContract = resolveSkillRuntimeContract({
    skill,
    availableTools: doctor.availableToolNames,
    operator: {
      actor: "director-host-api",
      surface: "host-api",
      scopes: ["skills.use"],
    },
  });
  const eligible =
    configuredEnabled &&
    modelInvocable &&
    doctor.status !== "needs-setup" &&
    runtimeContract.loadable;
  const disabledReason = resolveHostSkillUnavailableReason(skill, skillManagementStore, doctor);
  const runtimeStatus = eligible ? "ready" : resolveHostSkillRuntimeStatus(doctor, runtimeContract);
  const explanationSurface = createSkillExplanationSurface({
    skill: {
      ...skill,
      enabled: eligible,
      configuredEnabled,
      eligible,
      modelInvocable,
      modelVisible: eligible,
      runtimeStatus,
      permissionStatus: deriveHostSkillPermissionStatus({ eligible, doctor }),
      doctorStatus: doctor.status,
      doctorSummary: doctor.summary,
      missingToolNames: doctor.missingToolNames,
      availableToolNames: doctor.availableToolNames,
      uncheckedToolNames: doctor.uncheckedToolNames,
      nextActions: doctor.nextActions,
      disabledReason,
    },
  });
  return {
    ...skill,
    enabled: eligible,
    configuredEnabled,
    eligible,
    modelInvocable,
    modelVisible: eligible,
    userInvocable: configuredEnabled,
    commandVisible: true,
    enablementStatus: configuredEnabled ? "enabled" : "disabled",
    runtimeStatus,
    permissionStatus: deriveHostSkillPermissionStatus({ eligible, doctor }),
    doctorStatus: doctor.status,
    doctorSummary: doctor.summary,
    missingToolNames: doctor.missingToolNames,
    availableToolNames: doctor.availableToolNames,
    uncheckedToolNames: doctor.uncheckedToolNames,
    nextActions: doctor.nextActions,
    runtimeContract,
    setupOnLoad: runtimeContract.setupOnLoad,
    fallback: runtimeContract.fallback,
    guard: runtimeContract.guard,
    disabledReason,
    explanationSurface,
    ...(decision === null ? {} : { enablementDecision: decision }),
    usage,
  };
}

function isHostSkillModelInvocable(skill: SkillSnapshot): boolean {
  return skill.disableModelInvocation !== true && skill.metadata?.disableModelInvocation !== true;
}

function resolveHostSkillUnavailableReason(
  skill: SkillSnapshot,
  skillManagementStore: SkillManagementStore,
  doctor?: SkillDoctorResult | null,
): string {
  if (!skillManagementStore.isSkillEnabled(skill.id)) {
    return skillManagementStore.getDecision(skill.id)?.note ?? "已被操作员关闭";
  }
  if (!isHostSkillModelInvocable(skill)) {
    return "该 Skill 标记为 disableModelInvocation，不能由模型在对话中直接调用。";
  }
  if (doctor?.status === "needs-setup") {
    return doctor.summary;
  }
  return "";
}

function resolveHostSkillRuntimeStatus(
  doctor: SkillDoctorResult,
  runtimeContract: ReturnType<typeof resolveSkillRuntimeContract>,
): string {
  if (!runtimeContract.guard.allowed) {
    return "blocked";
  }
  if (runtimeContract.status === "needs_setup") {
    return "needs-setup";
  }
  if (doctor.status === "needs-setup") {
    return "needs-setup";
  }
  return doctor.status;
}

async function createHostSkillToolDoctorIndex(
  runtime: DirectorHostRuntime | undefined,
): Promise<SkillToolDoctorIndex> {
  if (runtime?.externalToolControlPlane === undefined) {
    return createEmptySkillToolDoctorIndex();
  }
  const effective = await createExternalToolsEffectiveRpcResult(runtime.externalToolControlPlane, {
    includeUnavailable: true,
  });
  return createSkillToolDoctorIndex({
    externalToolBus: {
      items: readHostExternalToolItems(effective),
    },
  });
}

function readHostExternalToolItems(value: unknown): readonly unknown[] {
  if (!isRecord(value)) {
    return [];
  }
  return Array.isArray(value.tools) ? value.tools : [];
}

function deriveHostSkillPermissionStatus(input: {
  readonly eligible: boolean;
  readonly doctor: SkillDoctorResult;
}): string {
  if (input.eligible) {
    return "allowed";
  }
  if (input.doctor.status === "needs-setup") {
    return "needs-setup";
  }
  return input.doctor.status;
}

function formatHostSkillToolStatus(skill: Readonly<Record<string, unknown>>): string {
  if (skill.eligible === true || skill.enabled === true) {
    return "success";
  }
  if (skill.doctorStatus === "needs-setup" || skill.runtimeStatus === "needs-setup") {
    return "needs_setup";
  }
  return skill.modelInvocable === false ? "model_invocation_disabled" : "disabled";
}

function findApprovedSkillByIdOrTitle(
  skills: readonly SkillSnapshot[],
  skillIdOrTitle: string,
): SkillSnapshot | undefined {
  const normalized = normalizeSkillLookupText(skillIdOrTitle);
  return skills.find((skill) => {
    const aliases = [skill.id, skill.title, skill.description ?? ""].map(normalizeSkillLookupText);
    return aliases.includes(normalized);
  });
}

function normalizeSkillLookupText(value: string): string {
  return value.trim().toLowerCase();
}

async function inspectHostExecutionRunAssets(
  executionService: ExecutionRunService,
  runtimeRoot: string,
  workerDataDir: string,
): Promise<Record<string, unknown>> {
  const executionRunRoot = join(runtimeRoot, "execution", "runs");
  let entries: Array<{ readonly name: string; isDirectory(): boolean }>;

  try {
    entries = await readdir(executionRunRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyHostExecutionAssets(executionRunRoot);
    }
    return {
      ...createEmptyHostExecutionAssets(executionRunRoot),
      executionStatus: "degraded",
      unreadableExecutionArtifacts: 1,
      runAttentionCount: 1,
      executionIssues: [`Failed to read execution runs: ${toErrorMessage(error)}.`],
    };
  }

  const runs: ExecutionRun[] = [];
  const reports: ExecutionRunReport[] = [];
  const issues: string[] = [];
  let unreadableExecutionArtifacts = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const [runResult, reportResult] = await Promise.all([
      readHostExecutionStoreArtifact(() => executionService.getRun(entry.name)),
      readHostExecutionStoreArtifact(() => executionService.collectRunReport(entry.name)),
    ]);

    if (runResult.unreadable) {
      unreadableExecutionArtifacts += 1;
      issues.push(`Run ${entry.name} could not be read: ${runResult.issue}.`);
    } else if (runResult.value !== null) {
      runs.push(runResult.value);
    }

    if (reportResult.unreadable) {
      unreadableExecutionArtifacts += 1;
      issues.push(`Run report ${entry.name} could not be read: ${reportResult.issue}.`);
    } else if (reportResult.value !== null) {
      reports.push(reportResult.value);
    }
  }

  runs.sort((left, right) => compareIsoDesc(left.updatedAt, right.updatedAt));
  reports.sort((left, right) => compareIsoDesc(left.recordedAt, right.recordedAt));
  const statusCounts = countExecutionRunStatuses(runs);
  const runAttentionCount =
    statusCounts.failed +
    statusCounts.paused +
    statusCounts.created +
    statusCounts.aborted +
    unreadableExecutionArtifacts;

  return {
    executionRunRoot,
    executionStatus: issues.length > 0 ? "degraded" : "ok",
    executionRunCount: runs.length,
    executionReportCount: reports.length,
    unreadableExecutionArtifacts,
    runAttentionCount,
    createdRunCount: statusCounts.created,
    runningRunCount: statusCounts.running,
    pausedRunCount: statusCounts.paused,
    completedRunCount: statusCounts.completed,
    failedRunCount: statusCounts.failed,
    abortedRunCount: statusCounts.aborted,
    latestRun:
      runs[0] === undefined
        ? null
        : await formatExecutionRunSummaryWithDelegations(runs[0], workerDataDir),
    latestReport: reports[0] === undefined ? null : formatExecutionReportSummary(reports[0]),
    executionIssues: issues,
    executionItems: await Promise.all(
      runs.map((run) => formatExecutionRunSummaryWithDelegations(run, workerDataDir)),
    ),
    executionReportItems: reports.map(formatExecutionReportSummary),
  };
}

function createEmptyHostExecutionAssets(executionRunRoot: string): Record<string, unknown> {
  return {
    executionRunRoot,
    executionStatus: "ok",
    executionRunCount: 0,
    executionReportCount: 0,
    unreadableExecutionArtifacts: 0,
    runAttentionCount: 0,
    createdRunCount: 0,
    runningRunCount: 0,
    pausedRunCount: 0,
    completedRunCount: 0,
    failedRunCount: 0,
    abortedRunCount: 0,
    latestRun: null,
    latestReport: null,
    executionIssues: [],
    executionItems: [],
    executionReportItems: [],
  };
}

async function inspectHostClientRuntime(
  executionService: ExecutionRunService,
  runtimeRoot: string,
  options: {
    readonly activeOnly?: boolean;
    readonly clientSurface?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const executionRunRoot = join(runtimeRoot, "execution", "runs");
  let entries: Dirent[];

  try {
    entries = await readdir(executionRunRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createHostClientRuntimeSnapshot([], {
        status: "ok",
        ...(options.clientSurface === undefined ? {} : { clientSurface: options.clientSurface }),
      });
    }
    return createHostClientRuntimeSnapshot([], {
      status: "degraded",
      errors: [`Failed to read execution runs: ${toErrorMessage(error)}.`],
      ...(options.clientSurface === undefined ? {} : { clientSurface: options.clientSurface }),
    });
  }

  const runs: ExecutionRun[] = [];
  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const result = await readHostExecutionStoreArtifact(() => executionService.getRun(entry.name));
    if (result.unreadable) {
      errors.push(`Run ${entry.name} could not be read: ${result.issue}.`);
    } else if (result.value !== null) {
      runs.push(result.value);
    }
  }

  const filteredRuns = (
    options.activeOnly === true
      ? runs.filter((run) => isActiveHostExecutionRunStatus(run.status))
      : runs
  ).sort((left, right) => compareIsoDesc(left.updatedAt, right.updatedAt));
  return createHostClientRuntimeSnapshot(filteredRuns, {
    status: errors.length > 0 ? "degraded" : "ok",
    errors,
    ...(options.clientSurface === undefined ? {} : { clientSurface: options.clientSurface }),
  });
}

function createHostClientRuntimeSnapshot(
  runs: readonly ExecutionRun[],
  options: {
    readonly status: string;
    readonly clientSurface?: string;
    readonly errors?: readonly string[];
  },
): Record<string, unknown> {
  const tasks = runs.map((run) => formatHostClientRuntimeTaskRecord(run));
  const completedCount = runs.filter((run) => run.status === "completed").length;
  const cancelledCount = runs.filter((run) => run.status === "aborted").length;
  const failedCount = runs.filter((run) => run.status === "failed").length;
  const activeCount = runs.filter((run) => isActiveHostExecutionRunStatus(run.status)).length;
  return {
    schemaVersion: "director.client-runtime.v1",
    clientSurface: options.clientSurface ?? "host",
    originRuntime: "host.executionRun",
    status: options.status,
    taskCount: tasks.length,
    activeCount,
    completedCount,
    cancelledCount,
    failedCount,
    latestTask: tasks[0] ?? null,
    tasks,
    history: tasks,
    errors: [...(options.errors ?? [])],
  };
}

function formatHostClientRuntimeTask(
  run: ExecutionRun,
  options: {
    readonly clientSurface?: string;
    readonly detail?: boolean;
  } = {},
): Record<string, unknown> {
  return {
    ...(options.detail === true
      ? {
          schemaVersion: "director.client-runtime.task.v1",
          clientSurface: options.clientSurface ?? "host",
        }
      : {}),
    ...formatHostClientRuntimeTaskRecord(run),
  };
}

function formatHostClientRuntimeTaskRecord(run: ExecutionRun): Record<string, unknown> {
  const assignmentCounts = countExecutionAssignmentStatuses(run.assignments ?? []);
  return {
    id: run.runId,
    taskId: run.runId,
    category: "host-execution-run",
    label: run.goal,
    moduleSource: "host-api",
    lane: "production",
    provider: "director-host-api",
    model: null,
    artifactType: "execution-run",
    artifactId: run.runId,
    artifactLabel: run.previewSummary,
    routeTab: "runs",
    routeLabel: "运行中心",
    externalTaskId: run.runId,
    progress: estimateHostClientRuntimeProgress(run),
    progressMode: isActiveHostExecutionRunStatus(run.status) ? "indeterminate" : "determinate",
    cancellable: isStoppableHostExecutionRunStatus(run.status),
    status: run.status,
    error: run.status === "failed" || run.status === "aborted" ? run.previewSummary : undefined,
    summary: {
      runtimeId: run.runtimeId,
      blueprintId: run.blueprintId,
      handoffId: run.handoffId,
      actionGraphId: run.actionGraphId,
      assignmentCount: run.assignments?.length ?? 0,
      assignmentCounts,
      eventCount: run.events?.length ?? 0,
    },
    payload: {
      hostRunId: run.runId,
      originRuntime: "host.executionRun",
      goal: run.goal,
      previewSummary: run.previewSummary,
      sideEffectsAllowed: run.sideEffectsAllowed,
    },
    attemptCount: 0,
    createdAt: Date.parse(run.createdAt) || 0,
    startedAt: run.startedAt === undefined ? undefined : Date.parse(run.startedAt) || 0,
    updatedAt: Date.parse(run.updatedAt) || 0,
    completedAt: run.completedAt === undefined ? undefined : Date.parse(run.completedAt) || 0,
    originRuntime: "host.executionRun",
    controls: {
      read: true,
      stop: isStoppableHostExecutionRunStatus(run.status),
      steer: false,
      followup: isFollowupHostExecutionRunStatus(run.status),
    },
  };
}

function isActiveHostExecutionRunStatus(status: string): boolean {
  return status === "created" || status === "running" || status === "paused";
}

function isStoppableHostExecutionRunStatus(status: string): boolean {
  return status === "created" || status === "running" || status === "paused";
}

function isTerminalHostExecutionRunStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

function isFollowupHostExecutionRunStatus(status: string): boolean {
  return isActiveHostExecutionRunStatus(status);
}

function selectHostPendingOperatorAssignments(run: ExecutionRun): readonly AssignmentRun[] {
  return (run.assignments ?? []).filter(
    (assignment) =>
      assignment.status === "pending" &&
      assignment.approvalMode === "operator_approve" &&
      assignment.assignmentId.trim().length > 0,
  );
}

async function syncHostEntryRunProjection(
  entryStore: FileSystemDirectorEntryStore,
  entrySessionId: string | undefined,
  run: ExecutionRun,
): Promise<void> {
  if (entrySessionId === undefined) {
    return;
  }
  try {
    await entryStore.syncRunProjection(entrySessionId, run);
  } catch (_error) {
    // A future client runtime caller may only know the task id. Followup must still advance
    // the run even when there is no entry-session projection to refresh.
  }
}

function estimateHostClientRuntimeProgress(run: ExecutionRun): number {
  if (run.status === "completed" || run.status === "failed" || run.status === "aborted") {
    return 100;
  }
  if (run.status === "running") {
    const assignments = run.assignments ?? [];
    if (assignments.length === 0) {
      return 50;
    }
    const terminal = assignments.filter(
      (assignment) =>
        assignment.status === "completed" ||
        assignment.status === "failed" ||
        assignment.status === "aborted" ||
        assignment.status === "skipped",
    ).length;
    return Math.max(5, Math.min(95, Math.round((terminal / assignments.length) * 100)));
  }
  return 0;
}

async function formatExecutionRunSummaryWithDelegations(
  run: ExecutionRun,
  dataDir: string,
): Promise<Record<string, unknown>> {
  const summary = formatExecutionRunSummary(run);
  const delegationSnapshot = await createRunDelegationSnapshot(dataDir, run);
  return {
    ...summary,
    delegationSnapshot: summarizeRunDelegationSnapshot(delegationSnapshot),
  };
}

function summarizeRunDelegationSnapshot(
  snapshot: Awaited<ReturnType<typeof createRunDelegationSnapshot>>,
) {
  return {
    schemaId: snapshot.schemaId,
    runId: snapshot.runId,
    sessionId: snapshot.sessionId,
    delegationCount: snapshot.delegationCount,
    verificationCount: snapshot.verificationCount,
    notificationCount: snapshot.notificationCount,
    pendingDelegationCount: snapshot.pendingDelegationCount,
    runningDelegationCount: snapshot.runningDelegationCount,
    completedDelegationCount: snapshot.completedDelegationCount,
    failedDelegationCount: snapshot.failedDelegationCount,
    workerIds: snapshot.workerIds,
    verifierIds: snapshot.verifierIds,
    delegations: snapshot.delegations.map((record) => formatRunDelegationRecord(record)),
    verification: snapshot.verification.map((record) => formatRunVerificationRecord(record)),
  };
}

function formatRunDelegationRecord(
  record: Awaited<ReturnType<typeof createRunDelegationSnapshot>>["delegations"][number],
): Record<string, unknown> {
  return {
    id: record.id,
    taskId: record.taskId,
    workerId: record.workerId,
    targetAgent: record.targetAgent,
    specialization: record.specialization,
    status: record.status,
    fromAgent: record.fromAgent,
    instruction: record.instruction,
    resultSummary: record.resultSummary,
    error: record.error,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    completedAtMs: record.completedAtMs,
    verificationRequest: record.verificationRequest,
  };
}

function formatRunVerificationRecord(
  record: Awaited<ReturnType<typeof createRunDelegationSnapshot>>["verification"][number],
): Record<string, unknown> {
  return {
    id: record.id,
    taskId: record.taskId,
    verifierId: record.verifierId,
    requirement: record.requirement,
    status: record.status,
    verdict: record.verdict,
    verdictSummary: record.verdictSummary,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
  };
}

async function readHostExecutionStoreArtifact<T>(
  loader: () => Promise<T | null>,
): Promise<
  | { readonly value: T | null; readonly unreadable: false; readonly issue: null }
  | { readonly value: null; readonly unreadable: true; readonly issue: string }
> {
  try {
    return {
      value: await loader(),
      unreadable: false,
      issue: null,
    };
  } catch (error) {
    return {
      value: null,
      unreadable: true,
      issue: toErrorMessage(error),
    };
  }
}

function formatExecutionRunSummary(run: ExecutionRun): Record<string, unknown> {
  return {
    runId: run.runId,
    snapshotId: run.snapshotId,
    runtimeId: run.runtimeId,
    blueprintId: run.blueprintId,
    handoffId: run.handoffId,
    actionGraphId: run.actionGraphId,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt ?? null,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt ?? null,
    goal: run.goal,
    previewSummary: run.previewSummary,
    sideEffectsAllowed: run.sideEffectsAllowed,
    notes: [...(run.notes ?? [])],
    assignmentCounts: countExecutionAssignmentStatuses(run.assignments ?? []),
    assignmentCount: run.assignments?.length ?? 0,
    assignments: (run.assignments ?? []).map(formatExecutionAssignmentSummary),
    eventCount: run.events?.length ?? 0,
    events: (run.events ?? []).map(formatExecutionEventSummary),
  };
}

function formatExecutionReportSummary(report: ExecutionRunReport): Record<string, unknown> {
  const operatorSurface = report.operatorSurface;
  const runSummary = formatExecutionRunSummary(report.run);
  const primaryAssignment = selectPrimaryReportAssignment(report.run.assignments ?? []);
  const primaryBridgeExecution = primaryAssignment?.result?.bridgeExecution;
  const primaryAdapter =
    primaryAssignment?.result?.adapterId ?? primaryAssignment?.selectedAdapter ?? null;
  const primaryRerouteCandidates =
    primaryAssignment === null
      ? []
      : collectExecutionRerouteCandidates(primaryAssignment, primaryAdapter);
  return {
    runId: report.runId,
    reportId: report.reportId,
    recordedAt: report.recordedAt,
    runStatus: report.run.status,
    summary: [...(report.summary ?? [])],
    flags: [...(report.flags ?? [])],
    directorGoal: operatorSurface?.directorGoal ?? report.run.goal,
    operatorSummary: operatorSurface?.operatorSummary ?? report.run.previewSummary,
    objective: operatorSurface?.objective ?? primaryAssignment?.objective ?? null,
    deliverable: operatorSurface?.deliverable ?? primaryAssignment?.deliverable ?? null,
    adapterRoute: operatorSurface?.adapterRoute ?? primaryAdapter,
    lastBridgeRoute: operatorSurface?.lastBridgeRoute ?? primaryAdapter,
    bridgeVerdict: operatorSurface?.bridgeVerdict ?? null,
    bridgeFailureReason:
      operatorSurface?.bridgeFailureReason ?? primaryBridgeExecution?.failure?.reason ?? null,
    bridgeFailureMessage: primaryBridgeExecution?.failure?.message ?? null,
    bridgeStatus:
      operatorSurface?.bridgeStatus ??
      primaryBridgeExecution?.failure?.statusCode ??
      primaryBridgeExecution?.response?.statusCode ??
      null,
    requestId: operatorSurface?.requestId ?? primaryBridgeExecution?.response?.requestId ?? null,
    requestAccepted:
      operatorSurface?.requestAccepted ?? primaryBridgeExecution?.response?.accepted ?? null,
    retryable: operatorSurface?.retryable ?? primaryBridgeExecution?.failure?.retryable ?? null,
    retryAllowed:
      operatorSurface?.retryAllowed ??
      operatorSurface?.retryable ??
      primaryBridgeExecution?.failure?.retryable ??
      null,
    rerouteCandidates: [...(operatorSurface?.rerouteCandidates ?? primaryRerouteCandidates)],
    bridgeAttempts: operatorSurface?.bridgeAttempts ?? null,
    nextAction: operatorSurface?.nextAction ?? null,
    assignmentCounts: runSummary.assignmentCounts,
    assignmentCount: runSummary.assignmentCount,
    assignments: runSummary.assignments,
    eventCount: report.events?.length ?? 0,
    events: (report.events ?? []).map(formatExecutionEventSummary),
  };
}

function formatExecutionAssignmentSummary(assignment: AssignmentRun): Record<string, unknown> {
  const bridgeExecution = assignment.result?.bridgeExecution;
  const adapterId = assignment.result?.adapterId ?? assignment.selectedAdapter ?? null;
  return {
    runId: assignment.runId,
    assignmentId: assignment.assignmentId,
    role: assignment.role,
    objective: assignment.objective,
    deliverable: assignment.deliverable,
    actionClass: assignment.actionClass,
    approvalMode: assignment.approvalMode,
    dependsOn: [...(assignment.dependsOn ?? [])],
    status: assignment.status,
    selectedAdapter: assignment.selectedAdapter ?? null,
    adapterId,
    allowedAdapters: [...(assignment.allowedAdapters ?? [])],
    rerouteCandidates: collectExecutionRerouteCandidates(assignment, adapterId),
    blockingReason: assignment.blockingReason ?? null,
    timeoutMs: assignment.timeoutMs ?? null,
    createdAt: assignment.createdAt,
    startedAt: assignment.startedAt ?? null,
    completedAt: assignment.completedAt ?? null,
    notes: [...(assignment.notes ?? [])],
    resultStatus: assignment.result?.status ?? null,
    resultSummary: assignment.result?.summary ?? null,
    bridgeVerdict:
      bridgeExecution === undefined
        ? null
        : bridgeExecution.failure !== undefined
          ? "failed"
          : bridgeExecution.response?.accepted === true
            ? "accepted"
            : "responded",
    bridgeFailureReason: bridgeExecution?.failure?.reason ?? null,
    bridgeFailureMessage: bridgeExecution?.failure?.message ?? null,
    bridgeStatus:
      bridgeExecution?.failure?.statusCode ?? bridgeExecution?.response?.statusCode ?? null,
    bridgeRetryable: bridgeExecution?.failure?.retryable ?? null,
    retryAllowed:
      bridgeExecution?.failure?.retryable === undefined
        ? assignment.status === "failed" || assignment.status === "blocked"
        : bridgeExecution.failure.retryable,
  };
}

function formatExecutionEventSummary(event: ExecutionEvent): Record<string, unknown> {
  return {
    eventId: event.eventId ?? null,
    type: event.type ?? "unknown",
    at: event.occurredAt ?? null,
    assignmentId:
      typeof event.metadata?.assignmentId === "string" ? event.metadata.assignmentId : null,
    summary: event.message ?? event.type ?? "event",
  };
}

function countExecutionRunStatuses(runs: readonly ExecutionRun[]): {
  readonly created: number;
  readonly running: number;
  readonly paused: number;
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
} {
  const counts = {
    created: 0,
    running: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    aborted: 0,
  };

  for (const run of runs) {
    if (run.status in counts) {
      counts[run.status as keyof typeof counts] += 1;
    }
  }

  return counts;
}

function countExecutionAssignmentStatuses(assignments: readonly AssignmentRun[]): {
  readonly ready: number;
  readonly pending: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly skipped: number;
  readonly aborted: number;
} {
  const counts = {
    ready: 0,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    aborted: 0,
  };
  for (const assignment of assignments) {
    if (assignment.status in counts) {
      counts[assignment.status as keyof typeof counts] += 1;
    }
  }
  return counts;
}

function collectExecutionRerouteCandidates(
  assignment: AssignmentRun,
  currentAdapter: string | null,
): string[] {
  return dedupeStrings(
    (assignment.allowedAdapters ?? []).filter((adapterId) => adapterId !== currentAdapter),
  );
}

function selectPrimaryReportAssignment(
  assignments: readonly AssignmentRun[],
): AssignmentRun | null {
  return (
    assignments.find((assignment) => assignment.result?.bridgeExecution !== undefined) ??
    assignments.find((assignment) => assignment.actionClass === "generate") ??
    assignments[0] ??
    null
  );
}

function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveKnowledgeCandidateReviewStatus(
  candidate: { readonly metadata: { readonly version: number } },
  review: { readonly candidateVersion: number; readonly decision: string } | null | undefined,
): "pending" | "accepted" | "rejected" | "stale" {
  if (review === undefined || review === null) {
    return "pending";
  }
  if (review.candidateVersion !== candidate.metadata.version) {
    return "stale";
  }
  return review.decision === "accepted" || review.decision === "rejected"
    ? review.decision
    : "pending";
}

function inspectExperienceCandidateForHostCatalog(
  candidate: ExperienceCandidate,
  reviews: readonly {
    readonly candidateId: string;
    readonly decision: ExperienceReviewDecisionStatus;
    readonly decidedAtMs: number;
    readonly decisionId: string;
  }[],
  promotions: readonly {
    readonly candidateId: string;
    readonly promotionId: string;
    readonly promotedAtMs: number;
  }[],
  taxonomy: unknown,
): Record<string, unknown> {
  const latestReview = selectLatestExperienceReviewDecision(
    reviews.filter((review) => review.candidateId === candidate.candidateId),
  );
  const candidatePromotions = promotions.filter(
    (promotion) => promotion.candidateId === candidate.candidateId,
  );
  const latestPromotion = selectLatestExperiencePromotion(candidatePromotions);

  return {
    candidate,
    status: latestReview?.decision ?? "pending",
    latestReview,
    promotions: candidatePromotions,
    latestPromotion,
    promoted: latestPromotion !== null,
    taxonomy,
  };
}

function selectLatestExperiencePromotion<
  T extends {
    readonly promotionId: string;
    readonly promotedAtMs: number;
  },
>(promotions: readonly T[]): T | null {
  if (promotions.length === 0) {
    return null;
  }
  return (
    [...promotions].sort(
      (left, right) =>
        right.promotedAtMs - left.promotedAtMs || right.promotionId.localeCompare(left.promotionId),
    )[0] ?? null
  );
}

async function createSkillProposalFromExperience(
  input: DirectorHostSkillProposalFromExperienceRequest,
  dataDir: string,
  experienceStore: FileExperienceStore,
): Promise<Record<string, unknown>> {
  const candidate = await experienceStore.getCandidate(input.candidateId);
  if (candidate === null) {
    throw new DirectorHostHttpError(
      404,
      "EXPERIENCE_CANDIDATE_NOT_FOUND",
      `Unknown experience candidate: ${input.candidateId}`,
    );
  }
  const latestReview = selectLatestExperienceReviewDecision(
    await experienceStore.listReviewDecisions(input.candidateId),
  );
  if (latestReview?.decision !== "accepted") {
    throw new DirectorHostHttpError(
      409,
      "EXPERIENCE_CANDIDATE_STATE_CONFLICT",
      `Experience candidate ${input.candidateId} must be accepted before proposing a Skill.`,
    );
  }

  const nowMs = input.nowMs ?? Date.now();
  const proposal = createSkillProposalQueueInputFromExperience(candidate, {
    ...(input.author === undefined ? {} : { author: input.author }),
    nowMs,
  });
  await withDirectorSkillTaskPlane(dataDir, { createIfMissing: true }, async (taskPlane) => {
    await taskPlane.enqueueProposal(proposal);
  });
  const stored = await readDirectorSkillProposalFromDataDir(dataDir, proposal.id);

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-proposal-created.v1",
    proposal: formatSkillProposalAsset(stored),
  };
}

async function learnFromPastedText(
  input: DirectorHostLearningTextRequest,
  experienceStore: FileExperienceStore,
): Promise<Record<string, unknown>> {
  const nowMs = input.nowMs;
  const adapter = new PastedTextExperienceAdapter({
    sourceId: input.sourceId,
    texts: input.texts,
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(nowMs === undefined ? {} : { nowMs: () => nowMs }),
  });
  const orchestrator = new SelfLearningOrchestrator({
    store: experienceStore,
    adapters: [adapter],
  });
  return runLearningOrchestrator("director.host.learning-text.v1", orchestrator, experienceStore);
}

async function admitExtractedLearningSources(
  input: DirectorHostLearningAdmitRequest,
  experienceStore: FileExperienceStore,
): Promise<Record<string, unknown>> {
  const textInput: DirectorHostLearningTextRequest = {
    sourceId: input.sourceId,
    texts: input.sources.map((source, index) => ({
      title: source.title ?? source.sourceRef ?? `Extracted source ${index + 1}`,
      content: source.body,
      ...(source.sourceRef === undefined ? {} : { sourceRef: source.sourceRef }),
      ...(source.contentType === undefined ? {} : { contentType: source.contentType }),
    })),
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  };
  const result = await learnFromPastedText(textInput, experienceStore);
  return {
    ...result,
    schemaId: "director.host.learning-admit.v1",
  };
}

async function learnFromLocalDirectory(
  input: DirectorHostLearningDirectoryRequest,
  experienceStore: FileExperienceStore,
): Promise<Record<string, unknown>> {
  const nowMs = input.nowMs;
  const adapter = new LocalDirectoryExperienceAdapter({
    sourceId: input.sourceId,
    directoryRoot: input.directory,
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(nowMs === undefined ? {} : { nowMs: () => nowMs }),
    ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
    ...(input.maxFiles === undefined ? {} : { maxFiles: input.maxFiles }),
    ...(input.maxBytesPerFile === undefined ? {} : { maxBytesPerFile: input.maxBytesPerFile }),
    ...(input.includeExtensions === undefined
      ? {}
      : { includeExtensions: input.includeExtensions }),
  });
  const orchestrator = new SelfLearningOrchestrator({
    store: experienceStore,
    adapters: [adapter],
  });
  return runLearningOrchestrator(
    "director.host.learning-directory.v1",
    orchestrator,
    experienceStore,
  );
}

async function learnFromUrls(
  input: DirectorHostLearningUrlRequest,
  experienceStore: FileExperienceStore,
  fetchText: WebExperienceFetchText | undefined,
): Promise<Record<string, unknown>> {
  const nowMs = input.nowMs;
  const trustedSources: Array<{
    readonly title: string;
    readonly content: string;
    readonly sourceRef: string;
    readonly contentType: string;
  }> = [];
  const trustedSourceByUrl = new Map<
    string,
    {
      readonly title: string;
      readonly content: string;
      readonly sourceRef: string;
      readonly contentType: string;
    }
  >();
  const blockedReads: Array<
    Awaited<ReturnType<typeof orchestrateConversationRuntimeUrlLearningRead>>
  > = [];
  const webExecutors = createBuiltinWebToolExecutors({
    ...(fetchText === undefined
      ? {}
      : {
          extract: async ({ url, maxBytes }) => {
            const fetched = await fetchText(url);
            return {
              url: fetched.url,
              body: fetched.body.slice(0, maxBytes),
              ...(fetched.contentType === undefined ? {} : { contentType: fetched.contentType }),
              ...(isRecord(fetched.structuredContent)
                ? { structuredContent: fetched.structuredContent }
                : {}),
              ...(fetched.structuredContent === undefined || isRecord(fetched.structuredContent)
                ? {}
                : {
                    extractionReport: {
                      structuredContentIgnored: true,
                    },
                  }),
            };
          },
        }),
    ...(fetchText === undefined ? {} : { fetchImpl: createLearningFetchTextFetchImpl(fetchText) }),
  });
  const webExtract = webExecutors.get("web_extract");
  if (webExtract === undefined) {
    throw new Error("Built-in web_extract executor is unavailable.");
  }
  for (const [index, url] of input.urls.entries()) {
    const read = await orchestrateConversationRuntimeUrlLearningRead({
      url,
      turnId: `${input.sourceId}-url-${index + 1}`,
      sessionKey: `director-host-api:${input.sourceId}`,
      browserFallback: false,
      ...(input.maxBytesPerPage === undefined ? {} : { maxBytes: input.maxBytesPerPage }),
      executeTool: async (toolInput: ConversationRuntimeToolExecutionInput) => {
        if (toolInput.call.name !== "web_extract") {
          return {
            callId: toolInput.call.id,
            toolName: toolInput.call.name,
            ok: false,
            content:
              "status: error\nsummary: Host API URL learning has no browser provider.\nnext_actions: retry from desktop/weixin runtime when browser fallback is required",
            output: {
              status: "error",
              summary: "Host API URL learning has no browser provider.",
              failures: ["browser provider unavailable"],
              candidate_count: 0,
              next_actions: ["retry from desktop/weixin runtime when browser fallback is required"],
            },
            error: "browser provider unavailable",
          };
        }
        return await webExtract(toolInput);
      },
    });
    if (read.status === "trusted" && read.source !== undefined) {
      const trustedSource = {
        title: read.source.title,
        content: read.source.body,
        sourceRef: read.source.url,
        contentType: read.source.contentType,
      };
      trustedSources.push(trustedSource);
      trustedSourceByUrl.set(url, trustedSource);
      trustedSourceByUrl.set(read.source.url, trustedSource);
    } else {
      blockedReads.push(read);
    }
  }
  if (trustedSources.length === 0) {
    return createUrlLearningBlockedResult({
      schemaId: "director.host.learning-url.v1",
      sourceId: input.sourceId,
      urls: input.urls,
      nowMs: nowMs ?? Date.now(),
      reads: blockedReads,
      ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    });
  }
  const adapter = new WebExperienceSourceAdapter({
    sourceId: input.sourceId,
    urls: trustedSources.map((source) => source.sourceRef),
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(nowMs === undefined ? {} : { nowMs: () => nowMs }),
    ...(input.maxBytesPerPage === undefined ? {} : { maxBytesPerPage: input.maxBytesPerPage }),
    fetchText: async (url) => {
      const trusted = trustedSourceByUrl.get(url);
      if (trusted === undefined) {
        throw new Error(`Trusted URL source was not prepared for ${url}.`);
      }
      return {
        url: trusted.sourceRef,
        body: trusted.content,
        contentType: trusted.contentType,
      };
    },
  });
  const orchestrator = new SelfLearningOrchestrator({
    store: experienceStore,
    adapters: [adapter],
  });
  const result = await runLearningOrchestrator(
    "director.host.learning-url.v1",
    orchestrator,
    experienceStore,
  );
  return {
    ...result,
    urlRead: {
      status: blockedReads.length === 0 ? "trusted" : "partial",
      trustedCount: trustedSources.length,
      blockedCount: blockedReads.length,
      attempts: blockedReads.flatMap((read) => read.attempts),
      failures: dedupeStrings(blockedReads.flatMap((read) => read.failures)),
      nextActions: dedupeStrings(blockedReads.flatMap((read) => read.nextActions)),
    },
  };
}

async function learnFromQueries(
  input: DirectorHostLearningQueryRequest,
  experienceStore: FileExperienceStore,
  env: NodeJS.ProcessEnv | undefined,
  fetchText: WebExperienceFetchText | undefined,
): Promise<Record<string, unknown>> {
  const nowMs = input.nowMs;
  const adapter = new WebSearchExperienceAdapter({
    sourceId: input.sourceId,
    queries: input.queries,
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(nowMs === undefined ? {} : { nowMs: () => nowMs }),
    ...(input.maxResultsPerQuery === undefined
      ? {}
      : { maxResultsPerQuery: input.maxResultsPerQuery }),
    ...(input.maxBytesPerPage === undefined ? {} : { maxBytesPerPage: input.maxBytesPerPage }),
    ...(fetchText === undefined ? {} : { fetchText }),
    ...(env?.DIRECTOR_LEARNING_SEARCH_URL === undefined
      ? {}
      : { search: createTemplateSearch(env.DIRECTOR_LEARNING_SEARCH_URL) }),
  });
  const orchestrator = new SelfLearningOrchestrator({
    store: experienceStore,
    adapters: [adapter],
  });
  return runLearningOrchestrator("director.host.learning-query.v1", orchestrator, experienceStore);
}

function createUrlLearningBlockedResult(input: {
  readonly schemaId: string;
  readonly sourceId: string;
  readonly urls: readonly string[];
  readonly privacy?: ExperiencePrivacyClassification;
  readonly nowMs: number;
  readonly reads: readonly Awaited<
    ReturnType<typeof orchestrateConversationRuntimeUrlLearningRead>
  >[];
}): Record<string, unknown> {
  const failures = dedupeStrings(input.reads.flatMap((read) => read.failures));
  const nextActions = dedupeStrings(input.reads.flatMap((read) => read.nextActions));
  const quarantines = input.urls.map((url, index) => ({
    quarantineId: `url_learning_blocked_${shortHash(`${input.sourceId}:${url}:${input.nowMs}`)}`,
    reason: failures[index] ?? failures[0] ?? "source access limited",
    artifact: {
      artifactId: `url_learning_source_${shortHash(`${input.sourceId}:${url}`)}`,
      sourceKind: "web-page",
      sourceRef: url,
      title: url,
      textPreview: "",
      capturedAtMs: input.nowMs,
      privacy: input.privacy ?? "public",
      quality: {
        score: 0,
        verdict: "quarantine",
        reasons: failures,
      },
    },
    notes: nextActions,
  }));
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: input.schemaId,
    result: {
      status: "degraded",
      candidateCount: 0,
      artifactCount: 0,
      quarantineCount: quarantines.length,
      candidateIds: [],
      artifactIds: [],
      quarantineIds: quarantines.map((item) => item.quarantineId),
      nextCursors: {},
      adapterReports: [
        {
          adapterId: `url_learning_read_${slugifyRouteToken(input.sourceId)}`,
          sourceKind: "web-page",
          cursor: "",
          artifactCount: 0,
          storedArtifactCount: 0,
          candidateCount: 0,
          storedCount: 0,
          candidateIds: [],
          quarantineCount: quarantines.length,
          storedQuarantineCount: 0,
          artifactIds: [],
          quarantineIds: quarantines.map((item) => item.quarantineId),
          notes: failures,
        },
      ],
      notes: failures,
    },
    candidates: [],
    artifacts: [],
    quarantines,
    sourceEvidenceRefs: input.urls.map((url) =>
      createSourceEvidenceRef({
        id: `source-evidence-${shortHash(`${input.sourceId}:${url}:blocked`)}`,
        sourceKind: "url",
        sourceRef: url,
        sourceSnapshotId: `url_learning_source_${shortHash(`${input.sourceId}:${url}`)}`,
        sourceAccessStatus: "source_access_limited",
        sourceAccessError: failures[0] ?? "source access limited",
        publishable: false,
        privacy: input.privacy === "public" ? "public" : "pii_potential",
        observedAtMs: input.nowMs,
        metadata: {
          schemaId: input.schemaId,
          sourceId: input.sourceId,
        },
      }),
    ),
    memoryEvidenceRecords: input.urls.map((url) =>
      createMemoryEvidenceRecord({
        id: `memory-evidence-${shortHash(`${input.sourceId}:${url}:blocked`)}`,
        sourceKind: "url",
        sourceRef: url,
        sourceSnapshotId: `url_learning_source_${shortHash(`${input.sourceId}:${url}`)}`,
        sourceAccessStatus: "source_access_limited",
        sourceAccessError: failures[0] ?? "source access limited",
        confidence: "low",
        publishable: false,
        privacy: input.privacy === "public" ? "public" : "pii_potential",
        provenance: ["director-host-api-learning", input.schemaId, "url-learning-read"],
        evidenceRefs: [],
        failureTaxonomy: ["url_access_limited"],
        userConfirmed: false,
        observedAtMs: input.nowMs,
        metadata: {
          schemaId: input.schemaId,
          sourceId: input.sourceId,
          candidateIds: [],
        },
      }),
    ),
    urlRead: {
      status: "blocked",
      trustedCount: 0,
      blockedCount: input.reads.length,
      attempts: input.reads.flatMap((read) => read.attempts),
      failures,
      nextActions,
    },
  };
}

function createLearningFetchTextFetchImpl(fetchText: WebExperienceFetchText): typeof fetch {
  return (async (url: Parameters<typeof fetch>[0]) => {
    const fetched = await fetchText(String(url));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      url: fetched.url,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type"
            ? (fetched.contentType ?? "text/plain; charset=utf-8")
            : null,
      },
      text: async () => fetched.body,
    } as Response;
  }) as typeof fetch;
}

function createTemplateSearch(template: string) {
  return async (query: string, options: { readonly maxResults: number }) => {
    const url = template.includes("{query}")
      ? template.replaceAll("{query}", encodeURIComponent(query))
      : `${template}${template.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        "user-agent": "DirectorAngelSelfLearning/0.1",
      },
    });
    if (!response.ok) {
      throw new Error(`Web search failed for "${query}": HTTP ${response.status}.`);
    }
    return parseSearchResultHtml(await response.text(), url).slice(0, options.maxResults);
  };
}

function createConfiguredLearningFetchText(
  env: NodeJS.ProcessEnv | undefined,
): WebExperienceFetchText | undefined {
  const template = env?.DIRECTOR_LEARNING_FETCH_URL?.trim();
  if (template === undefined || template.length === 0) {
    return undefined;
  }
  return createTemplateFetchText(template);
}

function createTemplateFetchText(template: string): WebExperienceFetchText {
  return async (targetUrl: string) => {
    const endpoint = template.includes("{url}")
      ? template.replaceAll("{url}", encodeURIComponent(targetUrl))
      : template;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "DirectorAngelSelfLearning/0.1",
      },
      body: JSON.stringify({ url: targetUrl }),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Learning fetch extractor failed for ${targetUrl}: HTTP ${response.status}.`);
    }
    const payload = parseLearningFetchPayload(raw, targetUrl);
    return {
      url: payload.url,
      body: payload.body,
      ...(payload.contentType === undefined ? {} : { contentType: payload.contentType }),
      ...(payload.structuredContent === undefined
        ? {}
        : { structuredContent: payload.structuredContent }),
    };
  };
}

function parseLearningFetchPayload(
  raw: string,
  fallbackUrl: string,
): {
  readonly url: string;
  readonly body: string;
  readonly contentType?: string;
  readonly structuredContent?: import("@hotflow/contracts").CanonicalJsonValue;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      url: fallbackUrl,
      body: raw,
      contentType: "text/plain",
    };
  }
  if (!isRecord(parsed)) {
    throw new Error("Learning fetch extractor response must be a JSON object.");
  }
  const body =
    readOptionalString(parsed.body) ??
    readOptionalString(parsed.text) ??
    readOptionalString(parsed.markdown);
  if (body === undefined) {
    throw new Error("Learning fetch extractor response must include body, text, or markdown.");
  }
  const url = readOptionalString(parsed.url) ?? readOptionalString(parsed.finalUrl) ?? fallbackUrl;
  const contentType = readOptionalString(parsed.contentType) ?? readOptionalString(parsed.mimeType);
  const structuredContent = isJsonLike(parsed.structuredContent)
    ? parsed.structuredContent
    : isJsonLike(parsed.extraction)
      ? parsed.extraction
      : undefined;
  return {
    url,
    body,
    ...(contentType === undefined ? {} : { contentType }),
    ...(structuredContent === undefined ? {} : { structuredContent }),
  };
}

function isJsonLike(value: unknown): value is import("@hotflow/contracts").CanonicalJsonValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    (typeof value === "object" && value !== null)
  );
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseSearchResultHtml(
  html: string,
  baseUrl: string,
): readonly { readonly url: string; readonly title: string }[] {
  const results: Array<{ url: string; title: string }> = [];
  const anchorPattern =
    /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtmlEntity(match[1] ?? "");
    const title = normalizeHtmlText(match[2] ?? "");
    if (href.length === 0 || title.length === 0) {
      continue;
    }
    try {
      const url = new URL(href, baseUrl);
      const redirected = url.searchParams.get("uddg");
      results.push({
        url: redirected ?? url.href,
        title,
      });
    } catch {}
  }
  return dedupeSearchResults(results);
}

function dedupeSearchResults(
  results: readonly { readonly url: string; readonly title: string }[],
): readonly { readonly url: string; readonly title: string }[] {
  const byUrl = new Map<string, { url: string; title: string }>();
  for (const result of results) {
    if (!byUrl.has(result.url)) {
      byUrl.set(result.url, result);
    }
  }
  return [...byUrl.values()];
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

function normalizeHtmlText(value: string): string {
  return decodeHtmlEntity(value.replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

async function runLearningOrchestrator(
  schemaId: string,
  orchestrator: SelfLearningOrchestrator,
  experienceStore: FileExperienceStore,
): Promise<Record<string, unknown>> {
  const result = await orchestrator.learn();
  const candidateIds = new Set(result.candidateIds);
  const artifactIds = new Set(result.artifactIds);
  const quarantineIds = new Set(result.quarantineIds);
  const [candidates, artifacts, quarantines] = await Promise.all([
    experienceStore.listCandidates(),
    experienceStore.listSourceArtifacts(),
    experienceStore.listQuarantineRecords(),
  ]);

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId,
    result,
    candidates: candidates.filter((candidate) => candidateIds.has(candidate.candidateId)),
    artifacts: artifacts.filter((artifact) => artifactIds.has(artifact.artifactId)),
    quarantines: quarantines.filter((record) => quarantineIds.has(record.quarantineId)),
    ...buildLearningEvidenceProjection({
      schemaId,
      candidates: candidates.filter((candidate) => candidateIds.has(candidate.candidateId)),
      artifacts: artifacts.filter((artifact) => artifactIds.has(artifact.artifactId)),
      quarantines: quarantines.filter((record) => quarantineIds.has(record.quarantineId)),
    }),
  };
}

function buildLearningEvidenceProjection(input: {
  readonly schemaId: string;
  readonly candidates: readonly ExperienceCandidate[];
  readonly artifacts: readonly import("@hotflow/contracts").ExperienceSourceArtifact[];
  readonly quarantines: readonly import("@hotflow/contracts").ExperienceQuarantineRecord[];
}): {
  readonly sourceEvidenceRefs: readonly ReturnType<typeof createSourceEvidenceRef>[];
  readonly memoryEvidenceRecords: readonly ReturnType<typeof createMemoryEvidenceRecord>[];
} {
  const artifactsById = new Map(input.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const candidateIdsByArtifactId = new Map<string, string[]>();
  for (const candidate of input.candidates) {
    if (candidate.sourceArtifactId === undefined) {
      continue;
    }
    const existing = candidateIdsByArtifactId.get(candidate.sourceArtifactId) ?? [];
    existing.push(candidate.candidateId);
    candidateIdsByArtifactId.set(candidate.sourceArtifactId, existing);
  }
  const sourceEvidenceRefs = input.artifacts.map((artifact) =>
    createLearningSourceEvidenceRef({
      schemaId: input.schemaId,
      artifact,
      publishable: artifact.quality.verdict === "usable",
    }),
  );
  const sourceEvidenceBySnapshotId = new Map(
    sourceEvidenceRefs
      .filter((ref) => ref.sourceSnapshotId !== undefined)
      .map((ref) => [ref.sourceSnapshotId as string, ref]),
  );
  const quarantineSourceEvidenceRefs = input.quarantines
    .filter((record) => !artifactsById.has(record.artifact.artifactId))
    .map((record) =>
      createLearningSourceEvidenceRef({
        schemaId: input.schemaId,
        artifact: record.artifact,
        quarantineReason: record.reason,
        publishable: false,
      }),
    );
  const allSourceEvidenceRefs = [...sourceEvidenceRefs, ...quarantineSourceEvidenceRefs];
  const memoryEvidenceRecords = [
    ...input.artifacts.map((artifact) => {
      const sourceEvidenceId = sourceEvidenceBySnapshotId.get(artifact.artifactId)?.id;
      return createLearningMemoryEvidenceRecord({
        schemaId: input.schemaId,
        artifact,
        ...(sourceEvidenceId === undefined ? {} : { sourceEvidenceId }),
        candidateIds: candidateIdsByArtifactId.get(artifact.artifactId) ?? [],
      });
    }),
    ...input.quarantines
      .filter((record) => !artifactsById.has(record.artifact.artifactId))
      .map((record) => {
        const sourceEvidenceId = allSourceEvidenceRefs.find(
          (ref) => ref.sourceSnapshotId === record.artifact.artifactId,
        )?.id;
        return createLearningMemoryEvidenceRecord({
          schemaId: input.schemaId,
          artifact: record.artifact,
          ...(sourceEvidenceId === undefined ? {} : { sourceEvidenceId }),
          quarantineReason: record.reason,
          candidateIds: [],
        });
      }),
  ];
  return {
    sourceEvidenceRefs: allSourceEvidenceRefs,
    memoryEvidenceRecords,
  };
}

function createLearningSourceEvidenceRef(input: {
  readonly schemaId: string;
  readonly artifact: import("@hotflow/contracts").ExperienceSourceArtifact;
  readonly quarantineReason?: string;
  readonly publishable: boolean;
}): ReturnType<typeof createSourceEvidenceRef> {
  const accessStatus = resolveLearningSourceAccessStatus(input.artifact, input.quarantineReason);
  return createSourceEvidenceRef({
    id: `source-evidence-${shortHash(`${input.artifact.artifactId}:${input.artifact.sourceRef}`)}`,
    sourceKind: mapLearningSourceKind(input.artifact.sourceKind),
    sourceRef: input.artifact.sourceRef,
    sourceSnapshotId: input.artifact.artifactId,
    sourceAccessStatus: accessStatus,
    ...(accessStatus === "available"
      ? {}
      : { sourceAccessError: input.quarantineReason ?? input.artifact.quality.reasons[0] }),
    publishable: input.publishable && accessStatus === "available",
    privacy:
      input.artifact.privacy === "public"
        ? "public"
        : input.artifact.privacy === "restricted" || input.artifact.privacy === "confidential"
          ? "private"
          : "pii_potential",
    observedAtMs: input.artifact.capturedAtMs,
    metadata: {
      schemaId: input.schemaId,
      artifactId: input.artifact.artifactId,
      qualityScore: input.artifact.quality.score,
      qualityVerdict: input.artifact.quality.verdict,
    },
  });
}

function createLearningMemoryEvidenceRecord(input: {
  readonly schemaId: string;
  readonly artifact: import("@hotflow/contracts").ExperienceSourceArtifact;
  readonly sourceEvidenceId?: string;
  readonly quarantineReason?: string;
  readonly candidateIds: readonly string[];
}): ReturnType<typeof createMemoryEvidenceRecord> {
  const accessStatus = resolveLearningSourceAccessStatus(input.artifact, input.quarantineReason);
  return createMemoryEvidenceRecord({
    id: `memory-evidence-${shortHash(`${input.artifact.artifactId}:${input.artifact.digest}`)}`,
    sourceKind: mapLearningSourceKind(input.artifact.sourceKind),
    sourceRef: input.artifact.sourceRef,
    sourceSnapshotId: input.artifact.artifactId,
    sourceAccessStatus: accessStatus,
    ...(accessStatus === "available"
      ? {}
      : { sourceAccessError: input.quarantineReason ?? input.artifact.quality.reasons[0] }),
    confidence:
      accessStatus !== "available" || input.artifact.quality.verdict === "quarantine"
        ? "low"
        : "medium",
    publishable: false,
    privacy:
      input.artifact.privacy === "public"
        ? "public"
        : input.artifact.privacy === "restricted" || input.artifact.privacy === "confidential"
          ? "private"
          : "pii_potential",
    provenance: ["director-host-api-learning", input.schemaId],
    evidenceRefs: [
      ...(input.sourceEvidenceId === undefined ? [] : [input.sourceEvidenceId]),
      input.artifact.artifactId,
      ...input.candidateIds,
    ],
    failureTaxonomy: accessStatus === "available" ? [] : ["url_access_limited"],
    userConfirmed: false,
    observedAtMs: input.artifact.capturedAtMs,
    metadata: {
      schemaId: input.schemaId,
      artifactId: input.artifact.artifactId,
      digest: input.artifact.digest,
      qualityScore: input.artifact.quality.score,
      qualityVerdict: input.artifact.quality.verdict,
      candidateIds: [...input.candidateIds],
    },
  });
}

function resolveLearningSourceAccessStatus(
  artifact: import("@hotflow/contracts").ExperienceSourceArtifact,
  quarantineReason: string | undefined,
): "available" | "source_access_limited" {
  const assessment = assessExperienceSourceAccess({
    sourceRef: artifact.sourceRef,
    content: artifact.readableContent ?? artifact.textPreview,
    qualityReasons: artifact.quality.reasons,
    ...(artifact.rawContent === undefined ? {} : { rawContent: artifact.rawContent }),
    ...(artifact.extractionReport?.notes === undefined
      ? {}
      : { notes: artifact.extractionReport.notes }),
    ...(quarantineReason === undefined ? {} : { quarantineReason }),
  });
  return assessment.status;
}

function mapLearningSourceKind(
  sourceKind: import("@hotflow/contracts").ExperienceSourceKind,
): "url" | "weixin-article" | "file" | "chat" | "tool-result" | string {
  if (sourceKind === "web-page" || sourceKind === "web-search") {
    return "url";
  }
  if (
    sourceKind === "local-directory" ||
    sourceKind === "document" ||
    sourceKind === "local-repository"
  ) {
    return "file";
  }
  if (sourceKind === "pasted-text" || sourceKind === "manual") {
    return "chat";
  }
  return sourceKind;
}

async function handleExperienceCandidateAction(
  route: { readonly candidateId: string; readonly action: ExperienceCandidateAction },
  input: DirectorHostOperatorRequest,
  experienceStore: FileExperienceStore,
  knowledgeStore: FileKnowledgeStore,
  experienceTaxonomyStore: FileExperienceTaxonomyStore,
): Promise<Record<string, unknown>> {
  if (route.action === "promote") {
    const service = new ExperiencePromotionService({
      experienceStore,
      knowledgeStore,
      taxonomyStore: experienceTaxonomyStore,
    });
    const result = await service.promoteAcceptedExperienceCandidate({
      candidateId: route.candidateId,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.experience-promotion.v1",
      ...result,
    };
  }

  const candidate = await experienceStore.getCandidate(route.candidateId);
  if (candidate === null) {
    throw new Error(`Unknown experience candidate: ${route.candidateId}`);
  }
  const decidedAtMs = toEpochMs(input.now);
  const review = createExperienceReviewDecision({
    decisionId: `experience_review_${route.action}_${slugifyRouteToken(route.candidateId)}_${decidedAtMs}`,
    candidateId: route.candidateId,
    gate: "human",
    decision: route.action === "accept" ? "accepted" : "rejected",
    decidedAtMs,
    ...(input.actor === undefined ? {} : { reviewerId: input.actor }),
    ...(input.note === undefined ? {} : { note: input.note }),
  });
  const write = await experienceStore.writeReviewDecision(review);

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.experience-review.v1",
    candidate,
    review,
    write,
  };
}

async function updateExperienceCandidate(
  experienceStore: FileExperienceStore,
  candidateId: string,
  input: DirectorHostExperienceCandidateUpdateRequest,
): Promise<Record<string, unknown>> {
  const candidate = await experienceStore.getCandidate(candidateId);
  if (candidate === null) {
    throw new DirectorHostHttpError(
      404,
      "EXPERIENCE_CANDIDATE_NOT_FOUND",
      `Unknown experience candidate: ${candidateId}`,
    );
  }

  const [reviews, promotions] = await Promise.all([
    experienceStore.listReviewDecisions(candidateId),
    experienceStore.listPromotions(candidateId),
  ]);
  const latestReview = selectLatestExperienceReviewDecision(
    reviews.filter((review) => review.candidateId === candidateId),
  );
  if (latestReview?.decision === "accepted" || promotions.length > 0) {
    throw new DirectorHostHttpError(
      409,
      "EXPERIENCE_CANDIDATE_STATE_CONFLICT",
      `Experience candidate ${candidateId} can only be edited before acceptance or promotion.`,
    );
  }

  const updated = createExperienceCandidate({
    candidateId: candidate.candidateId,
    sourceAdapter: candidate.sourceAdapter,
    title: input.title ?? candidate.title,
    summary: input.summary ?? candidate.summary,
    applicability: input.applicability ?? candidate.applicability,
    risks: input.risks ?? candidate.risks,
    tags: input.tags ?? candidate.tags,
    evidence: candidate.evidence,
    ...(candidate.sourceArtifactId === undefined
      ? {}
      : { sourceArtifactId: candidate.sourceArtifactId }),
    ...(candidate.sourceDigest === undefined ? {} : { sourceDigest: candidate.sourceDigest }),
    ...(candidate.evidencePreview === undefined
      ? {}
      : { evidencePreview: candidate.evidencePreview }),
    ...(candidate.quality === undefined ? {} : { quality: candidate.quality }),
    privacy: candidate.privacy,
    provenance:
      input.author === undefined
        ? candidate.provenance
        : `${candidate.provenance}; experience edited by ${input.author}`,
    createdAtMs: candidate.createdAtMs,
  });
  const write = await experienceStore.writeCandidate(updated);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.experience-candidate-update.v1",
    previous: candidate,
    updated,
    write,
  };
}

async function createRunExperienceCandidate(
  workspaceRoot: string,
  report: ExecutionRunReport,
  input: DirectorHostRunExperienceRequest,
): Promise<Record<string, unknown>> {
  const materialized = materializeRunOutputExperience({
    source: createRunOutputSourceFromReport(report),
    intent: input.intent ?? "positive-experience",
    privacy: input.privacy ?? "confidential",
    ...(input.now === undefined ? {} : { nowMs: toEpochMs(input.now) }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.run-experience.v1",
    materialized,
    write: await writeMaterializedRunOutputExperience(workspaceRoot, materialized),
  };
}

async function createTraceProposalExperienceCandidate(
  workspaceRoot: string,
  runtimeRoot: string,
  proposalId: string,
  input: DirectorHostTraceProposalExperienceRequest,
): Promise<Record<string, unknown>> {
  const proposalStore = new FileSystemDirectorProposalStore({
    rootPath: join(runtimeRoot, "proposals"),
  });
  const proposal = await proposalStore.getProposal(proposalId);
  if (proposal === null) {
    throw new DirectorHostHttpError(
      404,
      "TRACE_PROPOSAL_NOT_FOUND",
      `Unknown Director trace proposal: ${proposalId}`,
    );
  }

  const materialized = materializeRunOutputExperience({
    source: {
      runId: proposal.runId,
      reportId: proposal.reportId,
      status: proposal.sourceRecord.digest.status,
      goal: proposal.sourceRecord.digest.goal || proposal.title,
      projectId: proposal.projectId,
      groupId: proposal.groupId,
      roles: proposal.roles,
      selectedAdapters: proposal.selectedAdapters,
      anchorIds: proposal.sourceRecord.anchorIds,
      flags: proposal.sourceRecord.digest.flags,
      summary: [
        proposal.summary,
        proposal.evidenceSummary,
        proposal.explanation,
        proposal.sourceRecord.digest.previewSummary,
      ],
      evidenceText: [
        proposal.title,
        proposal.summary,
        proposal.trigger,
        proposal.evidenceSummary,
        proposal.explanation,
        `confidence=${proposal.confidence} risk=${proposal.riskLevel}`,
      ].join("\n"),
      recordedAt: proposal.updatedAt,
    },
    intent:
      input.intent ?? (proposal.riskLevel === "high" ? "failure-lesson" : "positive-experience"),
    privacy: input.privacy ?? "confidential",
    ...(input.now === undefined ? {} : { nowMs: toEpochMs(input.now) }),
  });

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.trace-proposal-experience.v1",
    proposal,
    materialized,
    write: await writeMaterializedRunOutputExperience(workspaceRoot, materialized),
  };
}

async function createRunReflection(
  workspaceRoot: string,
  report: ExecutionRunReport,
  input: DirectorHostRunReflectionRequest,
): Promise<Record<string, unknown>> {
  const source = createRunOutputSourceFromReport(report);
  const nowMs = input.now === undefined ? undefined : toEpochMs(input.now);
  const draftReflection = materializeDirectorReflectionReport({
    source,
    ...(nowMs === undefined ? {} : { nowMs }),
  });
  const experience = materializeReflectionExperienceCandidates({
    reflection: draftReflection,
    source,
    privacy: input.privacy ?? "confidential",
    ...(nowMs === undefined ? {} : { nowMs }),
  });
  const shouldWriteExperience = input.writeExperienceCandidate ?? true;
  const experienceWrite =
    shouldWriteExperience && experience.recommended !== null
      ? await writeMaterializedRunOutputExperience(
          workspaceRoot,
          experience.recommended.materialized,
        )
      : null;
  const reflection: DirectorReflectionReport =
    experienceWrite === null
      ? draftReflection
      : { ...draftReflection, status: "candidate_generated" };
  const reflectionWrite = await writeDirectorReflectionReport(workspaceRoot, reflection);
  const soulCandidate = materializeDirectorSoulCandidateFromReflection({
    reflection,
    ...(nowMs === undefined ? {} : { nowMs }),
  });
  const shouldWriteSoul = input.writeSoulCandidate ?? true;
  const soulWrite =
    shouldWriteSoul && soulCandidate !== null
      ? await writeDirectorSoulCandidate(workspaceRoot, soulCandidate)
      : null;

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.run-reflection.v1",
    reflection,
    reflectionWrite,
    experience,
    experienceWrite,
    soulCandidate,
    soulWrite,
  };
}

function createRunOutputSourceFromReport(report: ExecutionRunReport): RunOutputExperienceSource {
  const run = report.run;
  const operatorSurface = report.operatorSurface;
  const selectedAdapters = dedupeStrings(
    run.assignments
      .map((assignment) => assignment.selectedAdapter)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const roles = dedupeStrings(run.assignments.map((assignment) => assignment.role));
  return {
    runId: report.runId,
    reportId: report.reportId,
    status: run.status,
    goal: operatorSurface?.directorGoal ?? run.goal,
    projectId: "runtime-production",
    groupId: "director-run",
    roles,
    selectedAdapters,
    anchorIds: [run.snapshotId, run.blueprintId],
    flags: report.flags,
    summary: report.summary,
    evidenceText: buildRunReportEvidenceText(report),
    recordedAt: report.recordedAt,
  };
}

function buildRunReportEvidenceText(report: ExecutionRunReport): string {
  const run = report.run;
  const operatorSurface = report.operatorSurface;
  const assignmentEvidence = run.assignments.flatMap((assignment) => [
    `Assignment ${assignment.assignmentId} role=${assignment.role} status=${assignment.status}`,
    `Objective: ${assignment.objective}`,
    `Deliverable: ${assignment.deliverable}`,
    ...(assignment.blockingReason === undefined
      ? []
      : [`Blocking reason: ${assignment.blockingReason}`]),
    ...(assignment.result?.summary === undefined ? [] : [`Result: ${assignment.result.summary}`]),
    ...(assignment.result?.notes ?? []).map((note) => `Result note: ${note}`),
  ]);
  return [
    `Goal: ${operatorSurface?.directorGoal ?? run.goal}`,
    `Run preview: ${run.previewSummary}`,
    ...(operatorSurface?.operatorSummary === undefined
      ? []
      : [`Operator summary: ${operatorSurface.operatorSummary}`]),
    ...(operatorSurface?.objective === undefined
      ? []
      : [`Objective: ${operatorSurface.objective}`]),
    ...(operatorSurface?.deliverable === undefined
      ? []
      : [`Deliverable: ${operatorSurface.deliverable}`]),
    ...(operatorSurface?.bridgeVerdict === undefined
      ? []
      : [`Bridge verdict: ${operatorSurface.bridgeVerdict}`]),
    ...(operatorSurface?.bridgeFailureReason === undefined
      ? []
      : [`Bridge failure reason: ${operatorSurface.bridgeFailureReason}`]),
    ...(operatorSurface?.nextAction === undefined
      ? []
      : [`Next action: ${operatorSurface.nextAction}`]),
    ...report.summary.map((entry) => `Report summary: ${entry}`),
    ...(report.flags.length === 0 ? [] : [`Report flags: ${report.flags.join(", ")}`]),
    ...assignmentEvidence,
  ].join("\n");
}

async function writeMaterializedRunOutputExperience(
  workspaceRoot: string,
  materialized: MaterializedRunOutputExperience,
): Promise<{ readonly status: "ok" | "degraded"; readonly notes: readonly string[] }> {
  const workspace = ensureDirectorWorkspace({ root: workspaceRoot });
  const store = new FileExperienceStore({
    experienceDir: join(workspace.knowledge, "experience"),
  });
  const artifactWrite = await store.writeSourceArtifact(materialized.artifact);
  const secondWrite =
    materialized.status === "candidate"
      ? await store.writeCandidate(materialized.candidate)
      : await store.writeQuarantineRecord(materialized.quarantine);
  return {
    status: artifactWrite.status === "ok" && secondWrite.status === "ok" ? "ok" : "degraded",
    notes: [...artifactWrite.notes, ...secondWrite.notes],
  };
}

async function writeDirectorReflectionReport(
  workspaceRoot: string,
  reflection: DirectorReflectionReport,
): Promise<{ readonly status: "ok"; readonly path: string; readonly notes: readonly string[] }> {
  const workspace = ensureDirectorWorkspace({ root: workspaceRoot });
  const reflectionRoot = join(workspace.knowledge, "reflection", "report");
  const path = join(reflectionRoot, `${reflection.reflectionId}.json`);
  await mkdir(reflectionRoot, { recursive: true });
  await writeFile(path, `${JSON.stringify(reflection, null, 2)}\n`, "utf8");
  return {
    status: "ok",
    path,
    notes: [`wrote ${path}`],
  };
}

async function writeDirectorSoulCandidate(
  workspaceRoot: string,
  candidate: DirectorSoulCandidate,
): Promise<{ readonly status: "ok"; readonly path: string; readonly notes: readonly string[] }> {
  const workspace = ensureDirectorWorkspace({ root: workspaceRoot });
  const soulCandidateRoot = join(workspace.root, "soul", "candidates");
  const path = join(soulCandidateRoot, `${candidate.candidateId}.json`);
  await mkdir(soulCandidateRoot, { recursive: true });
  await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  return {
    status: "ok",
    path,
    notes: [`wrote ${path}`],
  };
}

async function createHeartbeatStatusResponse(
  workspaceRoot: string,
  dataDir: string,
  input: { readonly now?: string },
): Promise<Record<string, unknown>> {
  const result = await runDirectorHeartbeatStructured(workspaceRoot, {
    dataDir,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.heartbeat-status.v1",
    ...result,
    text: formatDirectorHeartbeatSnapshot(result),
  };
}

async function createDailySelfReflectionResponse(
  workspaceRoot: string,
  dataDir: string,
  input: DirectorDailySelfReflectionInput,
): Promise<Record<string, unknown>> {
  const result = await runDirectorDailySelfReflection(workspaceRoot, {
    ...input,
    dataDir,
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.daily-self-reflection.v1",
    ...result,
    text: formatDirectorDailySelfReflectionReport(result.report, result.reportPath),
  };
}

async function createSoulCandidatesResponse(
  workspaceRoot: string,
): Promise<Record<string, unknown>> {
  const candidates = await listSoulCandidates(workspaceRoot);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.soul-candidates.v1",
    candidates,
    text: renderSoulCandidatesText(candidates),
  };
}

async function createSoulCandidateResponse(
  workspaceRoot: string,
  candidateId: string,
): Promise<Record<string, unknown>> {
  const candidate = await getSoulCandidate(workspaceRoot, candidateId);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.soul-candidate.v1",
    candidate,
    text: renderSoulCandidateText(candidate),
  };
}

async function createSoulViewResponse(workspaceRoot: string): Promise<Record<string, unknown>> {
  const soul = await readDirectorSoulDocument(workspaceRoot);
  const markdown = soul === null ? null : renderDirectorSoulMarkdown(soul);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.soul-view.v1",
    soul,
    markdown,
    text: soul === null ? "Director Soul:\n  status: empty\n  SOUL.md: (not created)" : markdown,
  };
}

async function decideSoulCandidate(
  workspaceRoot: string,
  candidateId: string,
  action: ReviewAction,
  input: DirectorHostOperatorRequest,
): Promise<Record<string, unknown>> {
  const candidate = await getSoulCandidate(workspaceRoot, candidateId);
  if (candidate.status !== "pending") {
    throw new DirectorHostHttpError(
      409,
      "SOUL_CANDIDATE_STATE_CONFLICT",
      `Director Soul candidate ${candidateId} is already ${candidate.status}.`,
    );
  }
  const decision = materializeDirectorSoulDecision({
    candidate,
    decision: action === "accept" ? "accepted" : "rejected",
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.now === undefined ? {} : { nowMs: toEpochMs(input.now) }),
  });
  const updatedCandidate: DirectorSoulCandidate = {
    ...candidate,
    status: action === "accept" ? "accepted" : "rejected",
  };
  const candidateWrite = await writeDirectorSoulCandidate(workspaceRoot, updatedCandidate);
  const decisionPath = await writeDirectorSoulDecision(workspaceRoot, decision);

  if (decision.decision === "rejected") {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.soul-decision.v1",
      candidate: updatedCandidate,
      decision,
      candidateWrite,
      decisionPath,
      soul: null,
      soulPath: null,
      soulMarkdownPath: null,
      text: renderSoulDecisionText({
        candidate: updatedCandidate,
        decision,
        decisionPath,
        soulPath: null,
        soulMarkdownPath: null,
      }),
    };
  }

  const soul = materializeDirectorSoulDocumentFromCandidate({
    candidate: updatedCandidate,
    decision,
    current: await readDirectorSoulDocument(workspaceRoot),
    ...(input.now === undefined ? {} : { nowMs: toEpochMs(input.now) }),
  });
  const soulWrite = await writeDirectorSoulDocument(workspaceRoot, soul);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.soul-decision.v1",
    candidate: updatedCandidate,
    decision,
    candidateWrite,
    decisionPath,
    soul,
    soulPath: soulWrite.soulPath,
    soulMarkdownPath: soulWrite.markdownPath,
    text: renderSoulDecisionText({
      candidate: updatedCandidate,
      decision,
      decisionPath,
      soulPath: soulWrite.soulPath,
      soulMarkdownPath: soulWrite.markdownPath,
    }),
  };
}

async function listSoulCandidates(workspaceRoot: string): Promise<DirectorSoulCandidate[]> {
  const candidateRoot = join(
    ensureDirectorWorkspace({ root: workspaceRoot }).root,
    "soul",
    "candidates",
  );
  let entries: Dirent[];
  try {
    entries = await readdir(candidateRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const candidates: DirectorSoulCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    candidates.push(await readSoulCandidateFile(join(candidateRoot, entry.name)));
  }
  return candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function getSoulCandidate(
  workspaceRoot: string,
  candidateId: string,
): Promise<DirectorSoulCandidate> {
  const candidate = await readSoulCandidateFile(
    join(
      ensureDirectorWorkspace({ root: workspaceRoot }).root,
      "soul",
      "candidates",
      `${candidateId}.json`,
    ),
  );
  if (candidate.candidateId !== candidateId) {
    throw new DirectorHostHttpError(
      409,
      "SOUL_CANDIDATE_ID_MISMATCH",
      `Director Soul candidate id mismatch: ${candidateId}.`,
    );
  }
  return candidate;
}

async function readSoulCandidateFile(path: string): Promise<DirectorSoulCandidate> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isSoulCandidate(parsed)) {
      throw new Error(`Invalid Director Soul candidate document: ${path}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DirectorHostHttpError(
        404,
        "SOUL_CANDIDATE_NOT_FOUND",
        `Unknown Director Soul candidate: ${path}`,
      );
    }
    throw error;
  }
}

async function readDirectorSoulDocument(
  workspaceRoot: string,
): Promise<DirectorSoulDocument | null> {
  try {
    const parsed = JSON.parse(
      await readFile(
        join(ensureDirectorWorkspace({ root: workspaceRoot }).root, "soul", "soul.json"),
        "utf8",
      ),
    ) as unknown;
    if (!isSoulDocument(parsed)) {
      throw new Error("Invalid Director Soul document.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeDirectorSoulDecision(
  workspaceRoot: string,
  decision: DirectorSoulDecision,
): Promise<string> {
  const root = join(ensureDirectorWorkspace({ root: workspaceRoot }).root, "soul", "decisions");
  const path = join(root, `${decision.decisionId}.json`);
  await mkdir(root, { recursive: true });
  await writeFile(path, `${JSON.stringify(decision, null, 2)}\n`, "utf8");
  return path;
}

async function writeDirectorSoulDocument(
  workspaceRoot: string,
  soul: DirectorSoulDocument,
): Promise<{ readonly soulPath: string; readonly markdownPath: string }> {
  const root = join(ensureDirectorWorkspace({ root: workspaceRoot }).root, "soul");
  const soulPath = join(root, "soul.json");
  const markdownPath = join(root, "SOUL.md");
  await mkdir(root, { recursive: true });
  await writeFile(soulPath, `${JSON.stringify(soul, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderDirectorSoulMarkdown(soul), "utf8");
  return { soulPath, markdownPath };
}

function renderSoulCandidatesText(candidates: readonly DirectorSoulCandidate[]): string {
  const lines = ["Director Soul candidates:", `  total: ${candidates.length}`];
  if (candidates.length === 0) {
    lines.push("  candidates: (none)");
    return lines.join("\n");
  }
  for (const candidate of candidates) {
    lines.push(
      `  - ${candidate.candidateId} status=${candidate.status} risk=${candidate.riskLevel} source=${candidate.sourceId}`,
    );
    lines.push(`    summary: ${candidate.patchSummary}`);
  }
  return lines.join("\n");
}

function renderSoulCandidateText(candidate: DirectorSoulCandidate): string {
  const lines = [
    "Director Soul candidate:",
    `  candidate id: ${candidate.candidateId}`,
    `  status: ${candidate.status}`,
    `  risk: ${candidate.riskLevel}`,
    `  source reflection: ${candidate.sourceReflectionId}`,
    `  source: ${candidate.sourceKind}/${candidate.sourceId}`,
    `  summary: ${candidate.patchSummary}`,
    "  proposed sections:",
  ];
  for (const [section, body] of Object.entries(candidate.proposedSections)) {
    lines.push(`  - ${section}: ${String(body).replace(/\s+/gu, " ").trim()}`);
  }
  lines.push(`  evidence: ${candidate.evidenceRefs.join(" | ") || "(none)"}`);
  return lines.join("\n");
}

function renderSoulDecisionText(result: {
  readonly candidate: DirectorSoulCandidate;
  readonly decision: DirectorSoulDecision;
  readonly decisionPath: string;
  readonly soulPath: string | null;
  readonly soulMarkdownPath: string | null;
}): string {
  return [
    "Director Soul decision:",
    `  candidate id: ${result.candidate.candidateId}`,
    `  decision: ${result.decision.decision}`,
    `  decision file: ${result.decisionPath}`,
    `  soul.json: ${result.soulPath ?? "(unchanged)"}`,
    `  SOUL.md: ${result.soulMarkdownPath ?? "(unchanged)"}`,
  ].join("\n");
}

function isSoulCandidate(value: unknown): value is DirectorSoulCandidate {
  return (
    isRecord(value) &&
    value.schemaVersion === "director.soul.candidate.v1" &&
    typeof value.candidateId === "string" &&
    typeof value.sourceReflectionId === "string" &&
    typeof value.sourceId === "string" &&
    isRecord(value.proposedSections) &&
    Array.isArray(value.evidenceRefs) &&
    (value.status === "pending" || value.status === "accepted" || value.status === "rejected")
  );
}

function isSoulDocument(value: unknown): value is DirectorSoulDocument {
  return (
    isRecord(value) &&
    value.schemaVersion === "director.soul.v1" &&
    typeof value.sourceCandidateId === "string" &&
    typeof value.sourceReflectionId === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.evidenceRefs) &&
    isRecord(value.sections)
  );
}

async function upsertExperienceCategory(
  store: FileExperienceTaxonomyStore,
  input: DirectorHostTaxonomyCategoryRequest,
): Promise<Record<string, unknown>> {
  const category = await store.upsertCategory(input);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.experience-category-upsert.v1",
    category,
    taxonomy: await store.inspectTaxonomy(),
  };
}

async function upsertExperienceTag(
  store: FileExperienceTaxonomyStore,
  input: DirectorHostTaxonomyTagRequest,
): Promise<Record<string, unknown>> {
  const tag = await store.upsertTag(input);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.experience-tag-upsert.v1",
    tag,
    taxonomy: await store.inspectTaxonomy(),
  };
}

async function updateExperienceCandidateTaxonomy(
  taxonomyStore: FileExperienceTaxonomyStore,
  experienceStore: FileExperienceStore,
  candidateId: string,
  input: DirectorHostTaxonomyBindingRequest,
): Promise<Record<string, unknown>> {
  const candidate = await experienceStore.getCandidate(candidateId);
  if (candidate === null) {
    throw new DirectorHostHttpError(
      404,
      "EXPERIENCE_CANDIDATE_NOT_FOUND",
      `Unknown experience candidate: ${candidateId}`,
    );
  }
  const binding = await taxonomyStore.updateCandidateTaxonomy({
    candidateId,
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    tagIds: input.tagIds,
    ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.experience-taxonomy-update.v1",
    candidate,
    binding,
    taxonomy: await taxonomyStore.inspectTaxonomy(),
  };
}

async function upsertSkillCategory(
  store: FileSkillTaxonomyStore,
  input: DirectorHostTaxonomyCategoryRequest,
): Promise<Record<string, unknown>> {
  const category = await store.upsertCategory(input);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-category-upsert.v1",
    category,
    taxonomy: await store.inspectTaxonomy(),
  };
}

async function upsertSkillTag(
  store: FileSkillTaxonomyStore,
  input: DirectorHostTaxonomyTagRequest,
): Promise<Record<string, unknown>> {
  const tag = await store.upsertTag(input);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-tag-upsert.v1",
    tag,
    taxonomy: await store.inspectTaxonomy(),
  };
}

async function updateSkillTaxonomy(
  taxonomyStore: FileSkillTaxonomyStore,
  skillRepository: FileBackedSkillRepository,
  skillId: string,
  input: DirectorHostTaxonomyBindingRequest,
): Promise<Record<string, unknown>> {
  const skill = skillRepository.getApproved(skillId);
  if (skill === undefined) {
    throw new DirectorHostHttpError(404, "SKILL_NOT_FOUND", `Unknown approved Skill: ${skillId}`);
  }
  await ensureSkillTaxonomyCategory(taxonomyStore, input.categoryId);
  await ensureSkillTaxonomyTags(taxonomyStore, input.tagIds);
  const binding = await taxonomyStore.updateSkillTaxonomy({
    skillId,
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    tagIds: input.tagIds,
    ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-taxonomy-update.v1",
    skill,
    binding,
    taxonomy: await taxonomyStore.inspectTaxonomy(),
  };
}

async function setSkillEnablement(
  skillRepository: FileBackedSkillRepository,
  skillManagementStore: SkillManagementStore,
  skillId: string,
  input: DirectorHostSkillEnablementRequest,
): Promise<Record<string, unknown>> {
  const skill = skillRepository.getApproved(skillId);
  if (skill === undefined) {
    throw new DirectorHostHttpError(404, "SKILL_NOT_FOUND", `Unknown approved Skill: ${skillId}`);
  }
  const decision = skillManagementStore.setSkillEnabled(skillId, input.enabled, {
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-management.v1",
    skill: {
      ...skill,
      enabled: input.enabled,
      enablementStatus: input.enabled ? "enabled" : "disabled",
      enablementDecision: decision,
    },
    management: skillManagementStore.readDocument(),
  };
}

async function recordSkillUse(
  skillRepository: FileBackedSkillRepository,
  skillManagementStore: SkillManagementStore,
  dataDir: string,
  skillId: string,
  input: DirectorHostOperatorRequest,
  runtime?: DirectorHostRuntime,
): Promise<Record<string, unknown>> {
  const skill = skillRepository.getApproved(skillId);
  if (skill === undefined) {
    return createMissingHostSkillResult("director.host.skill-use.v1", skillId);
  }
  const decoratedSkill = decorateSkillWithManagement(
    skill,
    skillManagementStore,
    null,
    await createHostSkillToolDoctorIndex(runtime),
  );
  if (decoratedSkill.eligible !== true) {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.skill-use.v1",
      skill: decoratedSkill,
      status: formatHostSkillToolStatus(decoratedSkill),
      usage: new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readRecord(skill.id),
    };
  }
  const usage = new SkillUsageStore(resolveSkillUsagePath({ dataDir })).recordUse(skill.id, {
    actor: input.actor ?? "director-host-api",
    ...(input.note === undefined ? {} : { reason: input.note }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-use.v1",
    skill: decoratedSkill,
    status: "used",
    usage,
  };
}

async function recordSkillView(
  skillRepository: FileBackedSkillRepository,
  skillManagementStore: SkillManagementStore,
  dataDir: string,
  skillId: string,
  input: DirectorHostOperatorRequest,
  runtime?: DirectorHostRuntime,
): Promise<Record<string, unknown>> {
  const skill = findApprovedSkillByIdOrTitle(skillRepository.listApproved(), skillId);
  if (skill === undefined) {
    return createMissingHostSkillResult("director.host.skill-view.v1", skillId);
  }
  const decoratedSkill = decorateSkillWithManagement(
    skill,
    skillManagementStore,
    null,
    await createHostSkillToolDoctorIndex(runtime),
  );
  const usageStore = new SkillUsageStore(resolveSkillUsagePath({ dataDir }));
  const usage =
    decoratedSkill.eligible === true
      ? usageStore.recordView(skill.id, {
          actor: input.actor ?? "director-host-api",
          ...(input.note === undefined ? {} : { reason: input.note }),
          ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
        })
      : usageStore.readRecord(skill.id);
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-view.v1",
    skill: { ...decoratedSkill, usage },
    status: decoratedSkill.eligible === true ? "viewed" : formatHostSkillToolStatus(decoratedSkill),
    usage,
  };
}

function createMissingHostSkillResult(schemaId: string, skillId: string): Record<string, unknown> {
  const title = skillId.trim().length > 0 ? skillId.trim() : "unknown-skill";
  const baseSkill = {
    id: title,
    title,
    runtimeStatus: "missing-skill",
    doctorStatus: "missing-skill",
    doctorSummary: "Skill 不存在或已从当前已批准快照移除。",
    disabledReason: "Skill 不存在或已从当前已批准快照移除。",
    nextActions: [
      "重新调用 director.skills.list 刷新 Skill 索引。",
      "当前轮不要假装已经读取、应用或执行这个 Skill。",
    ],
  };
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId,
    status: "missing_skill",
    skill: {
      id: title,
      title,
      description: "",
      content: "",
      enabled: false,
      configuredEnabled: false,
      eligible: false,
      modelInvocable: false,
      modelVisible: false,
      userInvocable: false,
      commandVisible: false,
      enablementStatus: "missing-skill",
      runtimeStatus: baseSkill.runtimeStatus,
      permissionStatus: "missing-skill",
      doctorStatus: baseSkill.doctorStatus,
      doctorSummary: baseSkill.doctorSummary,
      disabledReason: baseSkill.disabledReason,
      missingToolNames: [],
      availableToolNames: [],
      uncheckedToolNames: [],
      nextActions: baseSkill.nextActions,
      explanationSurface: createSkillExplanationSurface({
        requestedSkillId: title,
        skill: baseSkill,
      }),
      tags: [],
      toolNames: [],
      metadata: {},
      usage: null,
    },
    usage: null,
  };
}

async function updateApprovedSkill(
  skillRepository: FileBackedSkillRepository,
  skillManagementStore: SkillManagementStore,
  skillId: string,
  dataDir: string,
  input: DirectorHostSkillUpdateRequest,
): Promise<Record<string, unknown>> {
  const current = skillRepository.getApproved(skillId);
  if (current === undefined) {
    throw new DirectorHostHttpError(404, "SKILL_NOT_FOUND", `Unknown approved Skill: ${skillId}`);
  }
  const nextSkill: SkillSnapshot = {
    ...current,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(input.version === undefined ? {} : { version: input.version }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.toolNames === undefined ? {} : { toolNames: input.toolNames }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    updatedAtMs: input.nowMs ?? Date.now(),
    metadata: {
      ...(current.metadata ?? {}),
      updatedBy: input.actor ?? "director-host-api",
    },
  };
  const snapshot = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }));
  const approved = new Map(
    skillRepository.listApproved().map((skill) => [skill.id, skill] as const),
  );
  approved.set(skillId, nextSkill);
  const written = snapshot.writeApproved([...approved.values()], { changeKind: "manual" });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-update.v1",
    skill: {
      ...nextSkill,
      enabled: skillManagementStore.isSkillEnabled(skillId),
      enablementStatus: skillManagementStore.isSkillEnabled(skillId) ? "enabled" : "disabled",
      enablementDecision: skillManagementStore.getDecision(skillId),
    },
    snapshot: written,
    management: skillManagementStore.readDocument(),
  };
}

async function deleteApprovedSkill(
  skillRepository: FileBackedSkillRepository,
  skillManagementStore: SkillManagementStore,
  skillId: string,
  dataDir: string,
  input: DirectorHostOperatorRequest,
): Promise<Record<string, unknown>> {
  const current = skillRepository.getApproved(skillId);
  if (current === undefined) {
    throw new DirectorHostHttpError(404, "SKILL_NOT_FOUND", `Unknown approved Skill: ${skillId}`);
  }
  const snapshot = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }));
  const written = snapshot.writeApproved(
    skillRepository.listApproved().filter((skill) => skill.id !== skillId),
    { changeKind: "manual" },
  );
  const nowMs = input.now === undefined ? undefined : Date.parse(input.now);
  const management = skillManagementStore.removeSkill(skillId, {
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(nowMs === undefined ? {} : { nowMs }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-delete.v1",
    deletedSkillId: skillId,
    deletedSkill: current,
    snapshot: written,
    management,
  };
}

async function ensureSkillTaxonomyCategory(
  store: FileSkillTaxonomyStore,
  categoryId: string | undefined,
): Promise<void> {
  if (categoryId === undefined || categoryId.trim().length === 0) {
    return;
  }
  const categories = await store.listCategories();
  if (categories.some((category) => category.categoryId === categoryId)) {
    return;
  }
  await store.upsertCategory({
    categoryId,
    name: formatGeneratedTaxonomyName(categoryId),
  });
}

async function ensureSkillTaxonomyTags(
  store: FileSkillTaxonomyStore,
  tagIds: readonly string[],
): Promise<void> {
  const existingTags = new Set((await store.listTags()).map((tag) => tag.tagId));
  for (const tagId of tagIds) {
    if (existingTags.has(tagId)) {
      continue;
    }
    await store.upsertTag({
      tagId,
      name: formatGeneratedTaxonomyName(tagId),
    });
    existingTags.add(tagId);
  }
}

function formatGeneratedTaxonomyName(value: string): string {
  return value
    .split(/[-_:]+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

async function handleKnowledgeCandidateAction(
  route: { readonly packId: string; readonly action: KnowledgeCandidateAction },
  input: DirectorHostOperatorRequest,
  knowledgeStore: FileKnowledgeStore,
): Promise<Record<string, unknown>> {
  const service = new DirectorKnowledgeLifecycleService(knowledgeStore);

  if (route.action === "publish") {
    const result = await service.publishReviewedCandidate({
      packId: route.packId,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.knowledge-publish.v1",
      ...result,
    };
  }

  const result = await service.reviewCandidate({
    packId: route.packId,
    decision: route.action === "accept" ? "accepted" : "rejected",
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.knowledge-review.v1",
    ...result,
  };
}

async function handleSkillProposalAction(
  route: { readonly proposalId: string; readonly action: SkillProposalAction },
  input: DirectorHostOperatorRequest,
  dataDir: string,
): Promise<Record<string, unknown>> {
  if (route.action === "apply") {
    const result = await applyDirectorSkillProposal(dataDir, route.proposalId);
    const proposal = await readDirectorSkillProposalFromDataDir(dataDir, route.proposalId);
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.skill-proposal-apply.v1",
      apply: result,
      proposal: formatSkillProposalAsset(proposal),
      skills: new SkillSnapshotFileStore(
        resolveApprovedSkillSnapshotPath({ dataDir }),
      ).readApproved(),
    };
  }

  const proposal = await transitionDirectorSkillProposal(dataDir, {
    proposalId: route.proposalId,
    status: route.action === "accept" ? "accepted" : "rejected",
    ...(input.note === undefined ? {} : { note: input.note }),
  });
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.skill-proposal-review.v1",
    proposal: formatSkillProposalAsset(proposal),
  };
}

async function listDirectorSkillProposalRecords(
  dataDir: string,
): Promise<readonly ProposalRecord[]> {
  const dbPath = resolveDirectorSkillSessionDbPath(dataDir);
  if (!existsSync(dbPath)) {
    return [];
  }
  const store = new SessionStore({ dbPath });
  try {
    if (store.getSession(DIRECTOR_SKILL_SESSION_ID) === null) {
      return [];
    }
    const taskPlane = new SessionStoreTaskPlanePort(store, DIRECTOR_SKILL_SESSION_ID, {
      createIfMissing: false,
    });
    return (await taskPlane.listProposals({ statuses: [...SKILL_PROPOSAL_STATUSES] })).filter(
      (proposal) => proposal.kind === SKILL_SNAPSHOT_UPSERT_KIND,
    );
  } finally {
    store.close();
  }
}

async function transitionDirectorSkillProposal(
  dataDir: string,
  input: {
    readonly proposalId: string;
    readonly status: "accepted" | "rejected";
    readonly note?: string;
  },
): Promise<ProposalRecord> {
  return withDirectorSkillTaskPlane(dataDir, { createIfMissing: false }, async (taskPlane) => {
    await readDirectorSkillProposal(taskPlane, input.proposalId);
    await taskPlane.transitionProposal({
      proposalId: input.proposalId,
      status: input.status,
      ...(input.note === undefined || input.note.trim().length === 0
        ? {}
        : { decisionNote: input.note }),
    });
    return readDirectorSkillProposal(taskPlane, input.proposalId);
  });
}

async function applyDirectorSkillProposal(
  dataDir: string,
  proposalId: string,
): Promise<ReturnType<SkillSafeApplyService["applyAcceptedProposal"]>> {
  return withDirectorSkillTaskPlane(dataDir, { createIfMissing: false }, async (taskPlane) => {
    const proposal = await readDirectorSkillProposal(taskPlane, proposalId);
    if (proposal.status !== "accepted") {
      throw new DirectorHostHttpError(
        409,
        "SKILL_PROPOSAL_STATE_CONFLICT",
        `Skill proposal ${proposalId} must be accepted before apply.`,
      );
    }
    const applyService = new SkillSafeApplyService(
      new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir })),
    );
    const applyResult = applyService.applyAcceptedProposal(proposal);
    try {
      await taskPlane.transitionProposal({ proposalId, status: "applied" });
    } catch (error) {
      applyService.revertAppliedProposal(applyResult);
      throw error;
    }
    return applyResult;
  });
}

async function readDirectorSkillProposalFromDataDir(
  dataDir: string,
  proposalId: string,
): Promise<ProposalRecord> {
  return withDirectorSkillTaskPlane(dataDir, { createIfMissing: false }, (taskPlane) =>
    readDirectorSkillProposal(taskPlane, proposalId),
  );
}

async function readDirectorSkillProposal(
  taskPlane: SessionStoreTaskPlanePort,
  proposalId: string,
): Promise<ProposalRecord> {
  const proposal = await taskPlane.getProposal(proposalId);
  if (proposal === null) {
    throw new DirectorHostHttpError(
      404,
      "SKILL_PROPOSAL_NOT_FOUND",
      `Unknown skill proposal: ${proposalId}`,
    );
  }
  if (proposal.kind !== SKILL_SNAPSHOT_UPSERT_KIND) {
    throw new DirectorHostHttpError(
      409,
      "UNSUPPORTED_SKILL_PROPOSAL_KIND",
      `Unsupported skill proposal kind: ${proposal.kind}`,
    );
  }
  return proposal;
}

async function withDirectorSkillTaskPlane<T>(
  dataDir: string,
  options: { readonly createIfMissing: boolean },
  callback: (taskPlane: SessionStoreTaskPlanePort) => Promise<T>,
): Promise<T> {
  const dbPath = resolveDirectorSkillSessionDbPath(dataDir);
  const store = new SessionStore({ dbPath });
  try {
    if (store.getSession(DIRECTOR_SKILL_SESSION_ID) === null) {
      if (!options.createIfMissing) {
        throw new DirectorHostHttpError(
          404,
          "SKILL_PROPOSAL_QUEUE_NOT_FOUND",
          "Director Skill proposal queue is empty.",
        );
      }
      store.createSession({
        sessionId: DIRECTOR_SKILL_SESSION_ID,
        metadata: {
          owner: "director-angel",
          purpose: "review-gated Skill proposal lifecycle",
        },
      });
    }
    return await callback(
      new SessionStoreTaskPlanePort(store, DIRECTOR_SKILL_SESSION_ID, {
        createIfMissing: options.createIfMissing,
      }),
    );
  } finally {
    store.close();
  }
}

async function submitApiProviderBridge(
  runtime: DirectorHostRuntime,
  envelope: DirectorApiProviderBridgeEnvelope,
): Promise<{
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
}> {
  const providersRoot = join(
    ensureDirectorWorkspace({ root: runtime.config.workspaceRoot }).root,
    "providers",
  );
  const prompt = buildApiProviderBridgePrompt(envelope);
  if (shouldUseImageGenerationBridge(envelope)) {
    const result = await runDirectorApiProviderImageGeneration(providersRoot, {
      providerId: envelope.provider,
      prompt,
      now: new Date().toISOString(),
    });
    return {
      statusCode: result.ok ? 200 : 502,
      body: {
        accepted: result.ok,
        requestId: `${envelope.assignmentId}:${result.providerId}:${Date.now()}`,
        providerId: result.providerId,
        mode: "image_generation",
        model: result.model,
        message: result.message,
        imageCount: result.images.length,
        ...(result.output === undefined ? {} : { output: result.output }),
      },
    };
  }

  const result = await runDirectorApiProviderTextCompletion(providersRoot, {
    providerId: envelope.provider,
    prompt,
    systemPrompt:
      "你是 Director Angel 的本地执行桥。把 Director assignment 转换为可审查的制作交付内容，直接输出结果。",
    now: new Date().toISOString(),
  });
  return {
    statusCode: result.ok ? 200 : 502,
    body: {
      accepted: result.ok,
      requestId: `${envelope.assignmentId}:${result.providerId}:${Date.now()}`,
      providerId: result.providerId,
      mode: "text",
      model: result.model,
      message: result.message,
      ...(result.output === undefined ? {} : { output: result.output }),
    },
  };
}

function shouldUseImageGenerationBridge(envelope: DirectorApiProviderBridgeEnvelope): boolean {
  return envelope.role === "asset-router" && envelope.actionClass === "generate";
}

function buildApiProviderBridgePrompt(envelope: DirectorApiProviderBridgeEnvelope): string {
  return [
    "Director assignment:",
    `runId: ${envelope.runId}`,
    `assignmentId: ${envelope.assignmentId}`,
    `role: ${envelope.role}`,
    `actionClass: ${envelope.actionClass}`,
    `objective: ${envelope.objective}`,
    `deliverable: ${envelope.deliverable}`,
    envelope.inputs.length === 0 ? undefined : `inputs: ${envelope.inputs.join(" | ")}`,
    envelope.outputs.length === 0 ? undefined : `outputs: ${envelope.outputs.join(" | ")}`,
    envelope.acceptanceCriteria.length === 0
      ? undefined
      : `acceptanceCriteria: ${envelope.acceptanceCriteria.join(" | ")}`,
    envelope.constraints.length === 0
      ? undefined
      : `constraints:\n${envelope.constraints
          .map(
            (constraint) =>
              `- ${constraint.field} (${constraint.priority}): ${constraint.requirement}${
                constraint.rationale === undefined ? "" : ` (${constraint.rationale})`
              }`,
          )
          .join("\n")}`,
    "",
    shouldUseImageGenerationBridge(envelope)
      ? "请生成适合作为制作首帧、概念图或素材路由参考的画面提示。"
      : "请完成该 assignment 的可审查文本交付结果。",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

async function createDirectorBlueprint(
  runtime: DirectorHostRuntime,
  service: DirectorService,
  request: DirectorBlueprintRequest,
): Promise<DirectorBlueprintResponse> {
  const evaluation = await service.evaluateSnapshot(request);
  return createBlueprintResponse(runtime, request, evaluation);
}

async function createExecutionRun(
  executionService: ExecutionRunService,
  source: DirectorBlueprintResponse,
  dataDir: string,
) {
  const run = await executionService.createRunFromBlueprint(source);
  await syncExecutionRunDelegationsToTaskPlane(dataDir, run, "host-api");
  return run;
}

async function syncExecutionRunDelegationsToTaskPlane(
  dataDir: string,
  run: ExecutionRun,
  sourceAgent: string,
): Promise<void> {
  const delegations = buildExecutionRunDelegations(run, {
    sourceAgent,
    includePending: true,
  });
  if (delegations.length === 0) {
    return;
  }

  await withDirectorRunTaskPlane(
    dataDir,
    run.runId,
    { createIfMissing: true },
    async (taskPlane) => {
      const existing = new Set((await taskPlane.status()).delegation.map((record) => record.id));
      for (const delegation of delegations) {
        if (existing.has(delegation.id)) {
          continue;
        }
        await taskPlane.enqueueDelegation(delegation);
        if (delegation.verificationRequest !== undefined) {
          await taskPlane.upsertVerification({
            id: delegation.verificationRequest.verificationId ?? `${delegation.id}-verification`,
            verifierId: delegation.verificationRequest.verifierId,
            requirement: delegation.verificationRequest.requirement,
            ...(delegation.taskId === undefined ? {} : { taskId: delegation.taskId }),
          });
        }
      }
    },
  );
}

async function createRunDelegationSnapshot(dataDir: string, run: ExecutionRun) {
  return withDirectorRunTaskPlane(
    dataDir,
    run.runId,
    { createIfMissing: false },
    async (taskPlane) => {
      const taskState = await taskPlane.status();
      const notifications = taskState.notifications ?? [];
      const subagentRuns = projectSubagentRunsFromTaskState(taskState, {
        parentTurnId: run.runId,
      });
      const subagentAnnounces = createHostApiRunSubagentAnnounces(subagentRuns);
      return {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.run-delegations.v1",
        runId: run.runId,
        sessionId: run.runId,
        status: run.status,
        delegationCount: taskState.delegation.length,
        verificationCount: taskState.verification.length,
        notificationCount: notifications.length,
        pendingDelegationCount: taskState.delegation.filter((record) => record.status === "queued")
          .length,
        runningDelegationCount: taskState.delegation.filter((record) => record.status === "running")
          .length,
        completedDelegationCount: taskState.delegation.filter(
          (record) => record.status === "completed",
        ).length,
        failedDelegationCount: taskState.delegation.filter((record) => record.status === "failed")
          .length,
        subagentRunCount: subagentRuns.length,
        subagentAnnounceCount: subagentAnnounces.length,
        queuedSubagentRunCount: subagentRuns.filter((record) => record.status === "queued").length,
        runningSubagentRunCount: subagentRuns.filter((record) => record.status === "running")
          .length,
        completedSubagentRunCount: subagentRuns.filter((record) => record.status === "completed")
          .length,
        failedSubagentRunCount: subagentRuns.filter((record) => record.status === "failed").length,
        subagentSchedulerHeartbeat: projectSubagentSchedulerHeartbeatFromTaskState(taskState, {
          parentTurnId: run.runId,
        }),
        subagentSchedulerDispatchPlan: projectSubagentSchedulerDispatchPlanFromTaskState(
          taskState,
          {
            parentTurnId: run.runId,
          },
        ),
        subagentSchedulerTick: projectSubagentSchedulerTickFromTaskState(taskState, {
          parentTurnId: run.runId,
          sessionId: run.runId,
          latestTurnId: null,
        }),
        subagentSchedulerRecoveryPlan: projectSubagentSchedulerRecoveryPlanFromTaskState(
          taskState,
          {
            parentTurnId: run.runId,
          },
        ),
        workerIds: [...new Set(taskState.delegation.map((record) => record.workerId))],
        verifierIds: [...new Set(taskState.verification.map((record) => record.verifierId))],
        subagentRuns,
        subagentAnnounces,
        delegations: taskState.delegation,
        verification: taskState.verification,
        notifications,
        lifecycle: taskState.lifecycle,
      };
    },
  ).catch((error: unknown) => {
    if (error instanceof DirectorHostHttpError && error.statusCode === 404) {
      return {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.run-delegations.v1",
        runId: run.runId,
        sessionId: run.runId,
        status: run.status,
        delegationCount: 0,
        verificationCount: 0,
        notificationCount: 0,
        pendingDelegationCount: 0,
        runningDelegationCount: 0,
        completedDelegationCount: 0,
        failedDelegationCount: 0,
        subagentRunCount: 0,
        subagentAnnounceCount: 0,
        queuedSubagentRunCount: 0,
        runningSubagentRunCount: 0,
        completedSubagentRunCount: 0,
        failedSubagentRunCount: 0,
        subagentSchedulerHeartbeat: null,
        subagentSchedulerDispatchPlan: null,
        subagentSchedulerTick: null,
        subagentSchedulerRecoveryPlan: null,
        workerIds: [],
        verifierIds: [],
        subagentRuns: [],
        subagentAnnounces: [],
        delegations: [],
        verification: [],
        notifications: [],
        lifecycle: [],
      };
    }
    throw error;
  });
}

function createHostApiRunSubagentAnnounces(subagentRuns: readonly TaskBackedSubagentRun[]) {
  return subagentRuns
    .map(createHostApiRunSubagentAnnounce)
    .filter((announce): announce is NonNullable<typeof announce> => announce !== null)
    .sort((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0));
}

function createHostApiRunSubagentAnnounce(run: TaskBackedSubagentRun) {
  if (!isTerminalHostApiDelegationStatus(run.status)) {
    return null;
  }
  const contextSnapshot = typeof run.contextSnapshot === "string" ? run.contextSnapshot : "";
  const announceMode = extractSemicolonContextField(contextSnapshot, "announceMode");
  const topLevelRequester = extractSemicolonContextField(contextSnapshot, "topLevelRequester");
  const requesterSessionKey = extractSemicolonContextField(contextSnapshot, "requesterSessionKey");
  const requesterOrigin = extractSemicolonContextField(contextSnapshot, "requesterOrigin");
  if (
    announceMode !== "task-notification" ||
    topLevelRequester !== "true" ||
    requesterSessionKey === undefined ||
    requesterOrigin === undefined
  ) {
    return null;
  }
  const deliveryTarget = extractSemicolonContextField(contextSnapshot, "deliveryTarget");
  const childSessionKey = extractSemicolonContextField(contextSnapshot, "childSessionKey");
  const summary =
    run.parentVisibleResult?.summary ?? run.resultSummary ?? run.error ?? "后台子代理已结束。";
  return {
    announceId: `announce_${run.subagentId}`,
    subagentId: run.subagentId,
    requesterSessionKey,
    requesterOrigin,
    ...(deliveryTarget === undefined ? {} : { deliveryTarget }),
    ...(childSessionKey === undefined ? {} : { childSessionKey }),
    status: run.status,
    summary,
    userFacingText: renderHostApiSubagentAnnounceText(run, summary),
    createdAtMs: run.createdAtMs,
    updatedAtMs: run.updatedAtMs,
    ...(run.completedAtMs === undefined ? {} : { completedAtMs: run.completedAtMs }),
  };
}

function renderHostApiSubagentAnnounceText(run: TaskBackedSubagentRun, summary: string): string {
  if (run.status === "completed") {
    return `后台子代理已完成：${run.instruction}\n结果：${summary}`;
  }
  if (run.status === "cancelled") {
    return `后台子代理已停止：${run.instruction}\n原因：${summary}`;
  }
  return `后台子代理执行失败：${run.instruction}\n原因：${summary}`;
}

function isTerminalHostApiDelegationStatus(status: TaskBackedSubagentRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function extractSemicolonContextField(snapshot: string, key: string): string | undefined {
  if (snapshot.length === 0) {
    return undefined;
  }
  for (const part of snapshot.split(";")) {
    const [rawKey, ...rawValue] = part.split("=");
    if (rawKey?.trim() === key) {
      const value = rawValue.join("=").trim();
      return value.length === 0 ? undefined : value;
    }
  }
  return undefined;
}

async function withDirectorRunTaskPlane<T>(
  dataDir: string,
  runId: string,
  options: { readonly createIfMissing: boolean },
  callback: (taskPlane: SessionStoreTaskPlanePort) => Promise<T>,
): Promise<T> {
  const dbPath = resolveDirectorWorkerSessionDbPath(dataDir);
  const store = new SessionStore({ dbPath });
  try {
    if (store.getSession(runId) === null) {
      if (!options.createIfMissing) {
        throw new DirectorHostHttpError(
          404,
          "RUN_TASK_PLANE_NOT_FOUND",
          `Task plane is empty for run ${runId}.`,
        );
      }
      store.createSession({
        sessionId: runId,
        metadata: {
          owner: "director-angel",
          purpose: "execution run delegation mailbox",
          runId,
        },
      });
    }
    return await callback(
      new SessionStoreTaskPlanePort(store, runId, {
        createIfMissing: options.createIfMissing,
      }),
    );
  } finally {
    store.close();
  }
}

function resolveDirectorWorkerSessionDbPath(dataDir: string): string {
  const override = process.env.HOTFLOW_WORKER_SESSION_DB_PATH?.trim();
  return override || join(dataDir, "sessions", "worker-jobs.sqlite");
}

function createDirectorWorkerJobsEnv(config: {
  readonly workspaceRoot: string;
  readonly dataDir: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: config.workspaceRoot,
    HOTFLOW_DATA_DIR: config.dataDir,
    HOTFLOW_WORKER_SESSION_DB_PATH: resolveDirectorWorkerSessionDbPath(config.dataDir),
  };
}

const DIRECTOR_CREW_ROLES: readonly CrewRole[] = [
  "researcher",
  "script-planner",
  "shot-planner",
  "asset-router",
  "qc-reviewer",
];

function createRuntimeRegistryPort(runtime: DirectorHostRuntime): DirectorRuntimeRegistryPort {
  return {
    async listAdapters(): Promise<readonly DirectorRuntimeAdapterDescriptor[]> {
      return runtime.adapterRegistry.listAll().map((manifest) => ({
        adapterId: manifest.adapterId,
        adapterKind: manifest.adapterKind,
        ...(manifest.adapterKind !== "media"
          ? {}
          : { bindingId: manifest.bindingId ?? manifest.adapterId }),
        ...(manifest.enabled === undefined ? {} : { enabled: manifest.enabled }),
        healthy: manifest.healthStatus !== "offline",
        dryRunOnly: manifest.dryRunSupported,
        mockOnly: manifest.mockOnly,
        ...(manifest.bridge === undefined ? {} : { bridgeKind: manifest.bridge.kind }),
        ...(manifest.approvalMode === undefined
          ? {}
          : {
              approvalMode:
                manifest.approvalMode === "operator_approve"
                  ? "operator-approve"
                  : manifest.approvalMode === "forbidden_in_beta1"
                    ? "forbidden-in-beta1"
                    : "auto-allow",
            }),
        ...(manifest.supportedActionClasses === undefined
          ? {}
          : { supportedActionClasses: [...manifest.supportedActionClasses] }),
        ...(manifest.mediaCapability === undefined
          ? {}
          : { mediaModes: deriveMediaModes(manifest.mediaCapability.supportedModes) }),
        ...(manifest.notes === undefined ? {} : { reason: manifest.notes.join(" | ") }),
      }));
    },
  };
}

function createRuntimeSwitchesPort(state: DirectorSwitchState): DirectorRuntimeSwitchesPort {
  return {
    async snapshot() {
      return {
        autoRouteEnabled: state.features["autoRoute.enabled"],
        disabledRoles: DIRECTOR_CREW_ROLES.filter((role) => !state.roleOverrides[role]),
        disabledAdapters: Object.entries(state.adapterOverrides)
          .filter(([, enabled]) => enabled === false)
          .map(([adapterId]) => adapterId),
      };
    },
  };
}

function createRuntimeMatcherPort(runtime: DirectorHostRuntime): DirectorRuntimeMatcherPort {
  return {
    async match({ normalizedInput }) {
      const imageMatch = runtime.adapterRegistry.matchMediaRoute({
        mode: "image",
        bindingPolicy: normalizedInput.context.intent.bindingPolicy,
        ...(normalizedInput.context.intent.requiredImageBinding === undefined
          ? {}
          : { requiredBinding: normalizedInput.context.intent.requiredImageBinding }),
        ...(normalizedInput.context.intent.preferredImageBinding === undefined
          ? {}
          : { preferredBinding: normalizedInput.context.intent.preferredImageBinding }),
        ...(normalizedInput.context.intent.fallbackBindings === undefined
          ? {}
          : { fallbackBindings: normalizedInput.context.intent.fallbackBindings }),
        switchState: runtime.switchState,
        actionClass: "route",
      });
      const videoMatch = normalizedInput.context.runtime.supportsVideo
        ? runtime.adapterRegistry.matchMediaRoute({
            mode: "video",
            bindingPolicy: normalizedInput.context.intent.bindingPolicy,
            ...(normalizedInput.context.intent.requiredVideoBinding === undefined
              ? {}
              : { requiredBinding: normalizedInput.context.intent.requiredVideoBinding }),
            ...(normalizedInput.context.intent.preferredVideoBinding === undefined
              ? {}
              : { preferredBinding: normalizedInput.context.intent.preferredVideoBinding }),
            ...(normalizedInput.context.intent.fallbackBindings === undefined
              ? {}
              : { fallbackBindings: normalizedInput.context.intent.fallbackBindings }),
            switchState: runtime.switchState,
            actionClass: "route",
          })
        : null;
      const prefersVideo =
        normalizedInput.context.group.generationStyle === "immersive" &&
        normalizedInput.context.runtime.supportsVideo;

      return {
        eligibleImageAdapters: [...imageMatch.eligibleAdapterIds],
        eligibleVideoAdapters: videoMatch === null ? [] : [...videoMatch.eligibleAdapterIds],
        selectedImageAdapterId: imageMatch.selectedAdapterId,
        selectedVideoAdapterId: videoMatch === null ? null : videoMatch.selectedAdapterId,
        selectedImageBinding: imageMatch.selectedBindingId,
        selectedVideoBinding: videoMatch === null ? null : videoMatch.selectedBindingId,
        blockedReasons: dedupeStrings([
          ...collectRelevantMatchMessages(
            imageMatch,
            !prefersVideo || normalizedInput.context.intent.requiredImageBinding !== undefined,
            true,
          ),
          ...collectRelevantMatchMessages(
            videoMatch,
            prefersVideo || normalizedInput.context.intent.requiredVideoBinding !== undefined,
            true,
          ),
        ]),
        warnings: dedupeStrings([
          ...collectRelevantMatchMessages(
            imageMatch,
            !prefersVideo || normalizedInput.context.intent.requiredImageBinding !== undefined,
            false,
          ),
          ...collectRelevantMatchMessages(
            videoMatch,
            prefersVideo || normalizedInput.context.intent.requiredVideoBinding !== undefined,
            false,
          ),
        ]),
      };
    },
  };
}

function deriveMediaModes(
  supportedModes: readonly ("text_to_image" | "text_to_video" | "image_to_video")[],
): readonly ("image" | "video")[] {
  const modes = new Set<"image" | "video">();
  for (const mode of supportedModes) {
    if (mode === "text_to_image") {
      modes.add("image");
      continue;
    }
    modes.add("video");
  }
  return [...modes];
}

function collectRelevantMatchMessages(
  match: ReturnType<DirectorHostRuntime["adapterRegistry"]["matchMediaRoute"]> | null,
  relevant: boolean,
  blocked: boolean,
): readonly string[] {
  if (match === null || !relevant) {
    return [];
  }
  if (blocked) {
    return match.status === "blocked" || match.status === "no_match" ? [...match.reasons] : [];
  }
  return match.status === "partial" ? [...match.reasons] : [];
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setOptionalNumberPolicy<
  K extends keyof NonNullable<DirectorHostMaintenanceRequest["policy"]>,
>(
  policy: NonNullable<DirectorHostMaintenanceRequest["policy"]>,
  key: K,
  value: NonNullable<DirectorHostMaintenanceRequest["policy"]>[K] | undefined,
): void {
  if (value !== undefined) {
    policy[key] = value;
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isDirectorApiProviderBridgeEnvelope(
  value: unknown,
): value is DirectorApiProviderBridgeEnvelope {
  return (
    isRecord(value) &&
    value.schemaId === DIRECTOR_HTTP_JSON_BRIDGE_REQUEST_SCHEMA_ID &&
    typeof value.runId === "string" &&
    value.runId.trim().length > 0 &&
    typeof value.assignmentId === "string" &&
    value.assignmentId.trim().length > 0 &&
    typeof value.workerId === "string" &&
    value.workerId.trim().length > 0 &&
    typeof value.adapterId === "string" &&
    value.adapterId.trim().length > 0 &&
    typeof value.provider === "string" &&
    value.provider.trim().length > 0 &&
    typeof value.role === "string" &&
    value.role.trim().length > 0 &&
    typeof value.actionClass === "string" &&
    value.actionClass.trim().length > 0 &&
    typeof value.approvalMode === "string" &&
    value.approvalMode.trim().length > 0 &&
    typeof value.objective === "string" &&
    value.objective.trim().length > 0 &&
    typeof value.deliverable === "string" &&
    value.deliverable.trim().length > 0 &&
    isStringArray(value.inputs) &&
    isStringArray(value.outputs) &&
    isStringArray(value.acceptanceCriteria) &&
    Array.isArray(value.constraints) &&
    value.constraints.every(isDirectorBridgeConstraint) &&
    isStringArray(value.dependsOn)
  );
}

function parseDirectorHostOperatorRequest(value: unknown): DirectorHostOperatorRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_OPERATOR_REQUEST",
      "Request body must be a JSON object.",
    );
  }

  const actor = parseOptionalTrimmedString(value.actor, "actor");
  const author = parseOptionalTrimmedString(value.author, "author");
  const reviewerId = parseOptionalTrimmedString(value.reviewerId, "reviewerId");
  const resolvedActor = actor ?? author ?? reviewerId;
  const note = parseOptionalTrimmedString(value.note, "note");
  const reason = parseOptionalTrimmedString(value.reason, "reason");
  const resolvedNote = note ?? reason;
  const now = parseOptionalTrimmedString(value.now, "now");
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", { code: "INVALID_OPERATOR_REQUEST" });
  return {
    ...(resolvedActor === undefined ? {} : { actor: resolvedActor }),
    ...(resolvedNote === undefined ? {} : { note: resolvedNote }),
    ...(now === undefined ? {} : { now }),
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseHeartbeatStatusRequest(value: unknown): { readonly now?: string } {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_HEARTBEAT_STATUS_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const now = parseOptionalTrimmedString(value.now, "now");
  return {
    ...(now === undefined ? {} : { now }),
  };
}

function parseDailySelfReflectionRequest(value: unknown): DirectorDailySelfReflectionInput {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_DAILY_SELF_REFLECTION_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const date = parseOptionalTrimmedString(value.date, "date");
  const now = parseOptionalTrimmedString(value.now, "now");
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_DAILY_SELF_REFLECTION_REQUEST",
      "date must use YYYY-MM-DD.",
    );
  }
  return {
    ...(date === undefined ? {} : { date }),
    ...(now === undefined ? {} : { now }),
  };
}

function parseMaintenanceRequestFromUrl(url: URL): DirectorHostMaintenanceRequest {
  const value: Record<string, unknown> = {};
  for (const field of [
    "nowMs",
    "logRetentionDays",
    "logMaxBytes",
    "archivePromotedExperienceAfterDays",
    "archiveRejectedExperienceAfterDays",
    "archiveQuarantineAfterDays",
    "archiveUnreferencedArtifactsAfterDays",
    "staleUnreviewedExperienceDays",
    "staleUnreviewedMinimumScore",
    "archiveRejectedKnowledgeAfterDays",
    "staleUnreviewedKnowledgeDays",
    "archiveOrphanKnowledgeReviewsAfterDays",
    "knowledgeHistoryRetentionVersions",
    "archiveKnowledgeRollbackAfterDays",
  ] as const) {
    const raw = url.searchParams.get(field);
    if (raw !== null && raw.trim().length > 0) {
      value[field] = Number(raw);
    }
  }
  return parseMaintenanceRequest(value);
}

function parseSkillCatalogQueryFromUrl(url: URL): DirectorHostSkillCatalogQuery {
  const query = normalizeOptionalUrlSearchParam(url.searchParams.get("query"));
  const limit = parseOptionalUrlPositiveInteger(
    url.searchParams.get("limit"),
    "limit",
    "INVALID_SKILL_CATALOG_QUERY",
  );
  const includeDisabled = parseOptionalUrlBoolean(
    url.searchParams.get("includeDisabled"),
    "includeDisabled",
    "INVALID_SKILL_CATALOG_QUERY",
  );
  return {
    ...(query === undefined ? {} : { query }),
    ...(limit === undefined ? {} : { limit }),
    ...(includeDisabled === undefined ? {} : { includeDisabled }),
  };
}

function parseMaintenanceRequest(value: unknown): DirectorHostMaintenanceRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_MAINTENANCE_REQUEST",
      "Request body must be a JSON object.",
    );
  }

  const sourcePolicy = isRecord(value.policy) ? value.policy : value;
  const policy: DirectorHostMaintenanceRequest["policy"] = {};
  setOptionalNumberPolicy(
    policy,
    "logRetentionDays",
    parseOptionalNumber(sourcePolicy.logRetentionDays, "logRetentionDays", {
      code: "INVALID_MAINTENANCE_REQUEST",
    }),
  );
  setOptionalNumberPolicy(
    policy,
    "logMaxBytes",
    parseOptionalNumber(sourcePolicy.logMaxBytes, "logMaxBytes", {
      code: "INVALID_MAINTENANCE_REQUEST",
    }),
  );
  setOptionalNumberPolicy(
    policy,
    "archivePromotedExperienceAfterDays",
    parseOptionalNumber(
      sourcePolicy.archivePromotedExperienceAfterDays,
      "archivePromotedExperienceAfterDays",
      { code: "INVALID_MAINTENANCE_REQUEST" },
    ),
  );
  setOptionalNumberPolicy(
    policy,
    "archiveRejectedExperienceAfterDays",
    parseOptionalNumber(
      sourcePolicy.archiveRejectedExperienceAfterDays,
      "archiveRejectedExperienceAfterDays",
      { code: "INVALID_MAINTENANCE_REQUEST" },
    ),
  );
  setOptionalNumberPolicy(
    policy,
    "archiveQuarantineAfterDays",
    parseOptionalNumber(sourcePolicy.archiveQuarantineAfterDays, "archiveQuarantineAfterDays", {
      code: "INVALID_MAINTENANCE_REQUEST",
    }),
  );
  setOptionalNumberPolicy(
    policy,
    "archiveUnreferencedArtifactsAfterDays",
    parseOptionalNumber(
      sourcePolicy.archiveUnreferencedArtifactsAfterDays,
      "archiveUnreferencedArtifactsAfterDays",
      { code: "INVALID_MAINTENANCE_REQUEST" },
    ),
  );
  setOptionalNumberPolicy(
    policy,
    "staleUnreviewedExperienceDays",
    parseOptionalNumber(
      sourcePolicy.staleUnreviewedExperienceDays,
      "staleUnreviewedExperienceDays",
      {
        code: "INVALID_MAINTENANCE_REQUEST",
      },
    ),
  );
  setOptionalNumberPolicy(
    policy,
    "staleUnreviewedMinimumScore",
    parseOptionalNumber(sourcePolicy.staleUnreviewedMinimumScore, "staleUnreviewedMinimumScore", {
      code: "INVALID_MAINTENANCE_REQUEST",
    }),
  );
  setOptionalNumberPolicy(
    policy,
    "archiveRejectedKnowledgeAfterDays",
    parseOptionalNumber(
      sourcePolicy.archiveRejectedKnowledgeAfterDays,
      "archiveRejectedKnowledgeAfterDays",
      { code: "INVALID_MAINTENANCE_REQUEST" },
    ),
  );
  setOptionalNumberPolicy(
    policy,
    "staleUnreviewedKnowledgeDays",
    parseOptionalNumber(sourcePolicy.staleUnreviewedKnowledgeDays, "staleUnreviewedKnowledgeDays", {
      code: "INVALID_MAINTENANCE_REQUEST",
    }),
  );
  setOptionalNumberPolicy(
    policy,
    "archiveOrphanKnowledgeReviewsAfterDays",
    parseOptionalNumber(
      sourcePolicy.archiveOrphanKnowledgeReviewsAfterDays,
      "archiveOrphanKnowledgeReviewsAfterDays",
      { code: "INVALID_MAINTENANCE_REQUEST" },
    ),
  );
  setOptionalNumberPolicy(
    policy,
    "knowledgeHistoryRetentionVersions",
    parseOptionalNumber(
      sourcePolicy.knowledgeHistoryRetentionVersions,
      "knowledgeHistoryRetentionVersions",
      { code: "INVALID_MAINTENANCE_REQUEST" },
    ),
  );
  setOptionalNumberPolicy(
    policy,
    "archiveKnowledgeRollbackAfterDays",
    parseOptionalNumber(
      sourcePolicy.archiveKnowledgeRollbackAfterDays,
      "archiveKnowledgeRollbackAfterDays",
      { code: "INVALID_MAINTENANCE_REQUEST" },
    ),
  );
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", {
    code: "INVALID_MAINTENANCE_REQUEST",
  });
  return {
    ...(nowMs === undefined ? {} : { nowMs }),
    policy,
  };
}

function parseLearningTextRequest(value: unknown): DirectorHostLearningTextRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_TEXT_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const sourceId = parseRequiredTrimmedString(value.sourceId, "sourceId", {
    code: "INVALID_LEARNING_TEXT_REQUEST",
  });
  if (!Array.isArray(value.texts)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_TEXT_REQUEST",
      "Request body field texts must be an array.",
    );
  }
  const texts = value.texts.map((entry, index) => parseLearningTextSource(entry, index));
  if (texts.length === 0) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_TEXT_REQUEST",
      "Request body field texts must contain at least one text source.",
    );
  }
  const privacy = parseOptionalPrivacy(value.privacy, "INVALID_LEARNING_TEXT_REQUEST");
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", {
    code: "INVALID_LEARNING_TEXT_REQUEST",
  });

  return {
    sourceId,
    texts,
    ...(privacy === undefined ? {} : { privacy }),
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseLearningAdmitRequest(value: unknown): DirectorHostLearningAdmitRequest {
  const code = "INVALID_LEARNING_ADMIT_REQUEST";
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(400, code, "Request body must be a JSON object.");
  }
  const sourceId =
    parseOptionalTrimmedStringWithCode(value.source_id, "source_id", { code }) ??
    parseRequiredTrimmedString(value.sourceId, "sourceId", { code });
  if (!Array.isArray(value.sources)) {
    throw new DirectorHostHttpError(
      400,
      code,
      "Request body field sources must be an array of extracted source snapshots.",
    );
  }
  const sources = value.sources.map((entry, index) => parseLearningAdmitSource(entry, index));
  if (sources.length === 0) {
    throw new DirectorHostHttpError(
      400,
      code,
      "Request body field sources must contain at least one extracted source snapshot.",
    );
  }
  const privacy = parseOptionalPrivacy(value.privacy, code);
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", { code });

  return {
    sourceId,
    sources,
    ...(privacy === undefined ? {} : { privacy }),
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseLearningDirectoryRequest(value: unknown): DirectorHostLearningDirectoryRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_DIRECTORY_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const sourceId = parseRequiredTrimmedString(value.sourceId, "sourceId", {
    code: "INVALID_LEARNING_DIRECTORY_REQUEST",
  });
  const directory = parseRequiredTrimmedString(value.directory, "directory", {
    code: "INVALID_LEARNING_DIRECTORY_REQUEST",
  });
  const privacy = parseOptionalPrivacy(value.privacy, "INVALID_LEARNING_DIRECTORY_REQUEST");
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", {
    code: "INVALID_LEARNING_DIRECTORY_REQUEST",
  });
  const maxDepth = parseOptionalPositiveInteger(value.maxDepth, "maxDepth", {
    code: "INVALID_LEARNING_DIRECTORY_REQUEST",
  });
  const maxFiles = parseOptionalPositiveInteger(value.maxFiles, "maxFiles", {
    code: "INVALID_LEARNING_DIRECTORY_REQUEST",
  });
  const maxBytesPerFile = parseOptionalPositiveInteger(value.maxBytesPerFile, "maxBytesPerFile", {
    code: "INVALID_LEARNING_DIRECTORY_REQUEST",
  });
  const includeExtensions = parseOptionalStringArray(value.includeExtensions, "includeExtensions", {
    code: "INVALID_LEARNING_DIRECTORY_REQUEST",
  });

  return {
    sourceId,
    directory,
    ...(privacy === undefined ? {} : { privacy }),
    ...(nowMs === undefined ? {} : { nowMs }),
    ...(maxDepth === undefined ? {} : { maxDepth }),
    ...(maxFiles === undefined ? {} : { maxFiles }),
    ...(maxBytesPerFile === undefined ? {} : { maxBytesPerFile }),
    ...(includeExtensions === undefined ? {} : { includeExtensions }),
  };
}

function parseLearningUrlRequest(value: unknown): DirectorHostLearningUrlRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_URL_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const sourceId = parseRequiredTrimmedString(value.sourceId, "sourceId", {
    code: "INVALID_LEARNING_URL_REQUEST",
  });
  const urls = parseRequiredStringArray(value.urls, "urls", {
    code: "INVALID_LEARNING_URL_REQUEST",
  });
  const privacy = parseOptionalPrivacy(value.privacy, "INVALID_LEARNING_URL_REQUEST");
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", {
    code: "INVALID_LEARNING_URL_REQUEST",
  });
  const maxBytesPerPage = parseOptionalPositiveInteger(value.maxBytesPerPage, "maxBytesPerPage", {
    code: "INVALID_LEARNING_URL_REQUEST",
  });

  return {
    sourceId,
    urls,
    ...(privacy === undefined ? {} : { privacy }),
    ...(nowMs === undefined ? {} : { nowMs }),
    ...(maxBytesPerPage === undefined ? {} : { maxBytesPerPage }),
  };
}

function parseLearningQueryRequest(value: unknown): DirectorHostLearningQueryRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_QUERY_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const sourceId = parseRequiredTrimmedString(value.sourceId, "sourceId", {
    code: "INVALID_LEARNING_QUERY_REQUEST",
  });
  const queries = parseRequiredStringArray(value.queries, "queries", {
    code: "INVALID_LEARNING_QUERY_REQUEST",
  });
  const privacy = parseOptionalPrivacy(value.privacy, "INVALID_LEARNING_QUERY_REQUEST");
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", {
    code: "INVALID_LEARNING_QUERY_REQUEST",
  });
  const maxResultsPerQuery = parseOptionalPositiveInteger(
    value.maxResultsPerQuery,
    "maxResultsPerQuery",
    {
      code: "INVALID_LEARNING_QUERY_REQUEST",
    },
  );
  const maxBytesPerPage = parseOptionalPositiveInteger(value.maxBytesPerPage, "maxBytesPerPage", {
    code: "INVALID_LEARNING_QUERY_REQUEST",
  });

  return {
    sourceId,
    queries,
    ...(privacy === undefined ? {} : { privacy }),
    ...(nowMs === undefined ? {} : { nowMs }),
    ...(maxResultsPerQuery === undefined ? {} : { maxResultsPerQuery }),
    ...(maxBytesPerPage === undefined ? {} : { maxBytesPerPage }),
  };
}

function parseKnowledgeRecallPreviewRequest(
  value: unknown,
): DirectorHostKnowledgeRecallPreviewRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_KNOWLEDGE_RECALL_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const projectId = parseOptionalTrimmedStringWithCode(value.projectId, "projectId", {
    code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
  });
  const groupId = parseOptionalTrimmedStringWithCode(value.groupId, "groupId", {
    code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
  });
  const anchorIds = parseOptionalStringArray(value.anchorIds, "anchorIds", {
    code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
  });
  const tags = parseOptionalStringArray(value.tags, "tags", {
    code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
  });
  const preferredAdapters = parseOptionalStringArray(value.preferredAdapters, "preferredAdapters", {
    code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
  });
  const generationType = parseOptionalTrimmedStringWithCode(
    value.generationType,
    "generationType",
    {
      code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
    },
  );
  const generationStyle = parseOptionalTrimmedStringWithCode(
    value.generationStyle,
    "generationStyle",
    {
      code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
    },
  );
  const includeGlobalExperience = parseOptionalBoolean(
    value.includeGlobalExperience,
    "includeGlobalExperience",
    {
      code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
    },
  );
  const maxHits = parseOptionalPositiveInteger(value.maxHits, "maxHits", {
    code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
  });
  const maxChars = parseOptionalPositiveInteger(value.maxChars, "maxChars", {
    code: "INVALID_KNOWLEDGE_RECALL_REQUEST",
  });

  return {
    ...(projectId === undefined ? {} : { projectId }),
    ...(groupId === undefined ? {} : { groupId }),
    ...(anchorIds === undefined ? {} : { anchorIds }),
    ...(tags === undefined ? {} : { tags }),
    ...(preferredAdapters === undefined ? {} : { preferredAdapters }),
    ...(generationType === undefined ? {} : { generationType }),
    ...(generationStyle === undefined ? {} : { generationStyle }),
    ...(includeGlobalExperience === undefined ? {} : { includeGlobalExperience }),
    ...(maxHits === undefined ? {} : { maxHits }),
    ...(maxChars === undefined ? {} : { maxChars }),
  };
}

function parseExperienceCandidateUpdateRequest(
  value: unknown,
): DirectorHostExperienceCandidateUpdateRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_EXPERIENCE_CANDIDATE_UPDATE_REQUEST",
      "Request body must be a JSON object.",
    );
  }

  const code = "INVALID_EXPERIENCE_CANDIDATE_UPDATE_REQUEST";
  const title = parseOptionalTrimmedStringWithCode(value.title, "title", { code });
  const summary = parseOptionalTrimmedStringWithCode(value.summary, "summary", { code });
  const applicability = parseOptionalTrimmedStringWithCode(value.applicability, "applicability", {
    code,
  });
  const risks = parseOptionalStringArray(value.risks, "risks", { code });
  const tags = parseOptionalStringArray(value.tags, "tags", { code });
  const actor = parseOptionalTrimmedStringWithCode(value.actor, "actor", { code });
  const author = parseOptionalTrimmedStringWithCode(value.author, "author", { code });
  const updatedBy = parseOptionalTrimmedStringWithCode(value.updatedBy, "updatedBy", { code });
  const resolvedAuthor = author ?? actor ?? updatedBy;

  if (
    title === undefined &&
    summary === undefined &&
    applicability === undefined &&
    risks === undefined &&
    tags === undefined
  ) {
    throw new DirectorHostHttpError(
      400,
      code,
      "Request body must include at least one editable experience candidate field.",
    );
  }

  return {
    ...(title === undefined ? {} : { title }),
    ...(summary === undefined ? {} : { summary }),
    ...(applicability === undefined ? {} : { applicability }),
    ...(risks === undefined ? {} : { risks }),
    ...(tags === undefined ? {} : { tags }),
    ...(resolvedAuthor === undefined ? {} : { author: resolvedAuthor }),
  };
}

function parseRunExperienceRequest(value: unknown): DirectorHostRunExperienceRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_RUN_EXPERIENCE_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const intent = parseOptionalRunOutputExperienceIntent(value.intent);
  const privacy = parseOptionalPrivacy(value.privacy, "INVALID_RUN_EXPERIENCE_REQUEST");
  const now = parseOptionalTrimmedStringWithCode(value.now, "now", {
    code: "INVALID_RUN_EXPERIENCE_REQUEST",
  });
  return {
    ...(intent === undefined ? {} : { intent }),
    ...(privacy === undefined ? {} : { privacy }),
    ...(now === undefined ? {} : { now }),
  };
}

function parseTraceProposalExperienceRequest(
  value: unknown,
): DirectorHostTraceProposalExperienceRequest {
  return parseRunExperienceRequest(value);
}

function parseRunReflectionRequest(value: unknown): DirectorHostRunReflectionRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_RUN_REFLECTION_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const privacy = parseOptionalPrivacy(value.privacy, "INVALID_RUN_REFLECTION_REQUEST");
  const now = parseOptionalTrimmedStringWithCode(value.now, "now", {
    code: "INVALID_RUN_REFLECTION_REQUEST",
  });
  const writeExperienceCandidate = parseOptionalBoolean(
    value.writeExperienceCandidate,
    "writeExperienceCandidate",
    {
      code: "INVALID_RUN_REFLECTION_REQUEST",
    },
  );
  const writeSoulCandidate = parseOptionalBoolean(value.writeSoulCandidate, "writeSoulCandidate", {
    code: "INVALID_RUN_REFLECTION_REQUEST",
  });
  return {
    ...(privacy === undefined ? {} : { privacy }),
    ...(now === undefined ? {} : { now }),
    ...(writeExperienceCandidate === undefined ? {} : { writeExperienceCandidate }),
    ...(writeSoulCandidate === undefined ? {} : { writeSoulCandidate }),
  };
}

function parseOptionalRunOutputExperienceIntent(
  value: unknown,
): RunOutputExperienceIntent | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "positive-experience" || value === "failure-lesson") {
    return value;
  }
  throw new DirectorHostHttpError(
    400,
    "INVALID_RUN_EXPERIENCE_REQUEST",
    "Request body field intent must be one of: positive-experience, failure-lesson.",
  );
}

function parseMemoryRecallPreviewRequest(value: unknown): DirectorRecallQuery {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_MEMORY_RECALL_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const groupId = parseOptionalTrimmedStringWithCode(value.groupId, "groupId", {
    code: "INVALID_MEMORY_RECALL_REQUEST",
  });
  const anchorIds = parseOptionalStringArray(value.anchorIds, "anchorIds", {
    code: "INVALID_MEMORY_RECALL_REQUEST",
  });
  const selectedAdapters = parseOptionalStringArray(value.selectedAdapters, "selectedAdapters", {
    code: "INVALID_MEMORY_RECALL_REQUEST",
  });
  const generationType = parseOptionalTrimmedStringWithCode(
    value.generationType,
    "generationType",
    {
      code: "INVALID_MEMORY_RECALL_REQUEST",
    },
  );
  const generationStyle = parseOptionalTrimmedStringWithCode(
    value.generationStyle,
    "generationStyle",
    {
      code: "INVALID_MEMORY_RECALL_REQUEST",
    },
  );
  const knowledgeSignalTags = parseOptionalStringArray(
    value.knowledgeSignalTags,
    "knowledgeSignalTags",
    {
      code: "INVALID_MEMORY_RECALL_REQUEST",
    },
  );
  const maxHits =
    parseOptionalPositiveInteger(value.maxHits, "maxHits", {
      code: "INVALID_MEMORY_RECALL_REQUEST",
    }) ?? 3;
  const query = {
    projectId: parseRequiredTrimmedString(value.projectId, "projectId", {
      code: "INVALID_MEMORY_RECALL_REQUEST",
    }),
    ...(groupId === undefined ? {} : { groupId }),
    ...(anchorIds === undefined ? {} : { anchorIds }),
    ...(selectedAdapters === undefined ? {} : { selectedAdapters }),
    ...(generationType === undefined ? {} : { generationType }),
    ...(generationStyle === undefined ? {} : { generationStyle }),
    ...(knowledgeSignalTags === undefined ? {} : { knowledgeSignalTags }),
    maxHits,
  };

  if (!isDirectorRecallQuery(query)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_MEMORY_RECALL_REQUEST",
      "Request body must be a valid Director memory recall query.",
    );
  }
  return query;
}

function formatMemoryPublicationGovernanceText(
  action: DirectorMemoryPublicationAction,
  result: {
    readonly status: string;
    readonly recordId: string;
    readonly governanceStatus?: string;
  },
): string {
  const actionLabel: Record<DirectorMemoryPublicationAction, string> = {
    retract: "已撤回",
    demote: "已降权",
    quarantine: "已隔离",
    restore: "已恢复",
  };
  if (result.status !== "ok") {
    return `记忆治理没有完成：${result.recordId}`;
  }
  return `${actionLabel[action]}记忆：${result.recordId}，当前状态：${formatMemoryGovernanceStatusChinese(
    result.governanceStatus,
  )}`;
}

function formatMemoryGovernanceStatusChinese(status: unknown): string {
  switch (status) {
    case "published":
      return "已发布";
    case "retracted":
      return "已撤回";
    case "demoted":
      return "已降权";
    case "quarantined":
      return "已隔离";
    default:
      return "未知";
  }
}

function parseTaxonomyCategoryRequest(
  value: unknown,
  code: string,
): DirectorHostTaxonomyCategoryRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(400, code, "Request body must be a JSON object.");
  }
  const categoryId = parseOptionalTrimmedStringWithCode(value.categoryId, "categoryId", { code });
  const name = parseRequiredTrimmedString(value.name, "name", { code });
  const description = parseOptionalTrimmedStringWithCode(value.description, "description", {
    code,
  });
  const parentId = parseOptionalTrimmedStringWithCode(value.parentId, "parentId", { code });
  const color = parseOptionalTrimmedStringWithCode(value.color, "color", { code });
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", { code });

  return {
    ...(categoryId === undefined ? {} : { categoryId }),
    name,
    ...(description === undefined ? {} : { description }),
    ...(parentId === undefined ? {} : { parentId }),
    ...(color === undefined ? {} : { color }),
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseTaxonomyTagRequest(value: unknown, code: string): DirectorHostTaxonomyTagRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(400, code, "Request body must be a JSON object.");
  }
  const tagId = parseOptionalTrimmedStringWithCode(value.tagId, "tagId", { code });
  const name = parseRequiredTrimmedString(value.name, "name", { code });
  const description = parseOptionalTrimmedStringWithCode(value.description, "description", {
    code,
  });
  const color = parseOptionalTrimmedStringWithCode(value.color, "color", { code });
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", { code });

  return {
    ...(tagId === undefined ? {} : { tagId }),
    name,
    ...(description === undefined ? {} : { description }),
    ...(color === undefined ? {} : { color }),
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseTaxonomyBindingRequest(
  value: unknown,
  code: string,
): DirectorHostTaxonomyBindingRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(400, code, "Request body must be a JSON object.");
  }
  const categoryId = parseOptionalTrimmedStringWithCode(value.categoryId, "categoryId", { code });
  const tagIds = parseOptionalStringArray(value.tagIds, "tagIds", { code }) ?? [];
  const updatedBy = parseOptionalTrimmedStringWithCode(value.updatedBy, "updatedBy", { code });
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", { code });

  return {
    ...(categoryId === undefined ? {} : { categoryId }),
    tagIds,
    ...(updatedBy === undefined ? {} : { updatedBy }),
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseSkillEnablementRequest(value: unknown): DirectorHostSkillEnablementRequest {
  const code = "INVALID_SKILL_ENABLEMENT_REQUEST";
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(400, code, "Request body must be a JSON object.");
  }
  const enabled = parseOptionalBoolean(value.enabled, "enabled", { code });
  if (enabled === undefined) {
    throw new DirectorHostHttpError(400, code, "Request body field enabled must be a boolean.");
  }
  const operator = parseDirectorHostOperatorRequest(value);
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", { code });
  return {
    ...operator,
    enabled,
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseSkillUpdateRequest(value: unknown): DirectorHostSkillUpdateRequest {
  const code = "INVALID_SKILL_UPDATE_REQUEST";
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(400, code, "Request body must be a JSON object.");
  }
  const title = parseOptionalTrimmedStringWithCode(value.title, "title", { code });
  const description = parseOptionalTrimmedStringWithCode(value.description, "description", {
    code,
  });
  const content = parseOptionalTrimmedStringWithCode(value.content, "content", { code });
  const version = parseOptionalTrimmedStringWithCode(value.version, "version", { code });
  const tags = parseOptionalStringArray(value.tags, "tags", { code });
  const toolNames = parseOptionalStringArray(value.toolNames, "toolNames", { code });
  const priority = parseOptionalNumber(value.priority, "priority", { code });
  const actor =
    parseOptionalTrimmedStringWithCode(value.actor, "actor", { code }) ??
    parseOptionalTrimmedStringWithCode(value.author, "author", { code }) ??
    parseOptionalTrimmedStringWithCode(value.updatedBy, "updatedBy", { code });
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", { code });
  if (
    title === undefined &&
    description === undefined &&
    content === undefined &&
    version === undefined &&
    tags === undefined &&
    toolNames === undefined &&
    priority === undefined
  ) {
    throw new DirectorHostHttpError(
      400,
      code,
      "Request body must include at least one editable Skill field.",
    );
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(content === undefined ? {} : { content }),
    ...(version === undefined ? {} : { version }),
    ...(tags === undefined ? {} : { tags }),
    ...(toolNames === undefined ? {} : { toolNames }),
    ...(priority === undefined ? {} : { priority }),
    ...(actor === undefined ? {} : { actor }),
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseLongTermMemoryAdmitRequest(value: unknown): LongTermMemoryAdmitInput {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LONG_TERM_MEMORY_ADMIT_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const text = parseRequiredTrimmedString(value.text, "text", {
    code: "INVALID_LONG_TERM_MEMORY_ADMIT_REQUEST",
  });
  const target = parseOptionalLongTermMemoryTarget(value.target);
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", {
    code: "INVALID_LONG_TERM_MEMORY_ADMIT_REQUEST",
  });

  return {
    text,
    ...(target === undefined ? {} : { target }),
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseOptionalLongTermMemoryTarget(value: unknown): LongTermMemoryTarget | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "auto" || value === "memory" || value === "user") {
    return value;
  }
  throw new DirectorHostHttpError(
    400,
    "INVALID_LONG_TERM_MEMORY_ADMIT_REQUEST",
    "Request body field target must be one of: auto, memory, user.",
  );
}

function parseSkillProposalFromExperienceRequest(
  value: unknown,
): DirectorHostSkillProposalFromExperienceRequest {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_SKILL_PROPOSAL_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const candidateId = parseRequiredTrimmedString(value.candidateId, "candidateId", {
    code: "INVALID_SKILL_PROPOSAL_REQUEST",
  });
  const author = parseOptionalTrimmedStringWithCode(value.author, "author", {
    code: "INVALID_SKILL_PROPOSAL_REQUEST",
  });
  const nowMs = parseOptionalNumber(value.nowMs, "nowMs", {
    code: "INVALID_SKILL_PROPOSAL_REQUEST",
  });

  return {
    candidateId,
    ...(author === undefined ? {} : { author }),
    ...(nowMs === undefined ? {} : { nowMs }),
  };
}

function parseLearningTextSource(value: unknown, index: number): DirectorHostLearningTextSource {
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_LEARNING_TEXT_REQUEST",
      `Request body texts[${index}] must be a JSON object.`,
    );
  }
  const content = parseRequiredTrimmedString(value.content, `texts[${index}].content`, {
    code: "INVALID_LEARNING_TEXT_REQUEST",
  });
  const title = parseOptionalTrimmedStringWithCode(value.title, `texts[${index}].title`, {
    code: "INVALID_LEARNING_TEXT_REQUEST",
  });
  const sourceRef = parseOptionalTrimmedStringWithCode(
    value.sourceRef,
    `texts[${index}].sourceRef`,
    {
      code: "INVALID_LEARNING_TEXT_REQUEST",
    },
  );
  const contentType = parseOptionalTrimmedStringWithCode(
    value.contentType,
    `texts[${index}].contentType`,
    {
      code: "INVALID_LEARNING_TEXT_REQUEST",
    },
  );

  return {
    ...(title === undefined ? {} : { title }),
    content,
    ...(sourceRef === undefined ? {} : { sourceRef }),
    ...(contentType === undefined ? {} : { contentType }),
  };
}

function parseLearningAdmitSource(value: unknown, index: number): DirectorHostLearningAdmitSource {
  const code = "INVALID_LEARNING_ADMIT_REQUEST";
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      code,
      `Request body sources[${index}] must be a JSON object.`,
    );
  }
  const body =
    parseOptionalTrimmedStringWithCode(value.body, `sources[${index}].body`, { code }) ??
    parseOptionalTrimmedStringWithCode(value.content, `sources[${index}].content`, { code }) ??
    parseOptionalTrimmedStringWithCode(value.text, `sources[${index}].text`, { code });
  if (body === undefined) {
    throw new DirectorHostHttpError(
      400,
      code,
      `Request body sources[${index}] must include extracted body content.`,
    );
  }
  const title = parseOptionalTrimmedStringWithCode(value.title, `sources[${index}].title`, {
    code,
  });
  const sourceRef =
    parseOptionalTrimmedStringWithCode(value.url, `sources[${index}].url`, { code }) ??
    parseOptionalTrimmedStringWithCode(value.sourceRef, `sources[${index}].sourceRef`, { code }) ??
    parseOptionalTrimmedStringWithCode(value.source_ref, `sources[${index}].source_ref`, { code });
  const contentType =
    parseOptionalTrimmedStringWithCode(value.content_type, `sources[${index}].content_type`, {
      code,
    }) ??
    parseOptionalTrimmedStringWithCode(value.contentType, `sources[${index}].contentType`, {
      code,
    });

  return {
    ...(title === undefined ? {} : { title }),
    body,
    ...(sourceRef === undefined ? {} : { sourceRef }),
    ...(contentType === undefined ? {} : { contentType }),
  };
}

function parseOptionalPrivacy(
  value: unknown,
  code: string,
): ExperiencePrivacyClassification | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "public" ||
    value === "internal" ||
    value === "confidential" ||
    value === "restricted"
  ) {
    return value;
  }
  throw new DirectorHostHttpError(
    400,
    code,
    "Request body field privacy must be one of: public, internal, confidential, restricted.",
  );
}

function createSkillProposalQueueInputFromExperience(
  candidate: ExperienceCandidate,
  input: { readonly author?: string; readonly nowMs: number },
) {
  return generateSkillProposalFromExperienceCandidate({
    candidate,
    sourceSessionId: DIRECTOR_SKILL_SESSION_ID,
    ...(input.author === undefined ? {} : { author: input.author }),
    nowMs: input.nowMs,
  }).proposal;
}

function formatSkillProposalAsset(proposal: ProposalRecord): Record<string, unknown> {
  const decoded = decodeSkillProposal(proposal);
  const review = new SkillProposalReviewer().reviewProposal(proposal);
  const snapshot = decoded?.snapshot;
  const metadata = isRecord(snapshot?.metadata) ? snapshot.metadata : {};
  const evidenceRef =
    readStringProperty(metadata, "sourceExperienceRef") ??
    readStringProperty(metadata, "evidenceRef") ??
    decoded?.trajectoryRef ??
    "";

  return {
    id: proposal.id,
    kind: proposal.kind,
    sessionId: DIRECTOR_SKILL_SESSION_ID,
    status: proposal.status,
    source: "self",
    skillId: snapshot?.id ?? proposal.id,
    title: snapshot?.title ?? proposal.id,
    version: snapshot?.version ?? "0.1.0",
    description: snapshot?.description ?? "",
    content: snapshot?.content ?? "",
    tags: [...(snapshot?.tags ?? [])],
    toolNames: [...(snapshot?.toolNames ?? [])],
    riskLevel: decoded?.riskLevel ?? readSkillRiskLevel(metadata) ?? "medium",
    confidence: typeof decoded?.confidence === "number" ? decoded.confidence : null,
    trigger: decoded?.trigger ?? readStringProperty(metadata, "trigger") ?? "",
    evidenceSummary:
      decoded?.evidenceSummary ?? readStringProperty(metadata, "evidenceSummary") ?? "",
    evidenceRef,
    explanation: decoded?.explanation ?? readStringProperty(metadata, "explanation") ?? "",
    reviewVerdict: review.verdict,
    reviewDecisionNote: review.decisionNote,
    reviewIssues: review.issues.map((issue) => ({
      code: issue.code,
      field: issue.field,
      message: issue.message,
      severity: issue.severity,
    })),
    provenance: proposal.provenance,
    trajectoryRef: decoded?.trajectoryRef ?? "",
    sourceSessionId: proposal.sourceSessionId,
    sourceTurnId: proposal.sourceTurnId,
    createdAtMs: proposal.createdAtMs,
    updatedAtMs: proposal.updatedAtMs,
    ...(proposal.decisionNote === undefined ? {} : { decisionNote: proposal.decisionNote }),
    metadata,
  };
}

function selectLatestExperienceReviewDecision(
  decisions: readonly {
    readonly decision: ExperienceReviewDecisionStatus;
    readonly decidedAtMs: number;
    readonly decisionId: string;
  }[],
): (typeof decisions)[number] | null {
  if (decisions.length === 0) {
    return null;
  }
  return (
    [...decisions].sort(
      (left, right) =>
        right.decidedAtMs - left.decidedAtMs || right.decisionId.localeCompare(left.decisionId),
    )[0] ?? null
  );
}

function resolveDirectorSkillSessionDbPath(dataDir: string): string {
  const override = process.env.HOTFLOW_CLI_SESSION_DB_PATH?.trim();
  return override || join(dataDir, "sessions", "cli.sqlite");
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return typeof value[key] === "string" ? value[key] : null;
}

function readSkillRiskLevel(value: unknown): "low" | "medium" | "high" | null {
  const riskLevel = readStringProperty(value, "riskLevel") ?? readStringProperty(value, "risk");
  return riskLevel === "low" || riskLevel === "medium" || riskLevel === "high" ? riskLevel : null;
}

function parseOptionalNumber(
  value: unknown,
  field: string,
  options: { readonly code: string },
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DirectorHostHttpError(
      400,
      options.code,
      `Request body field ${field} must be a finite number when provided.`,
    );
  }
  return value;
}

function parseOptionalPositiveInteger(
  value: unknown,
  field: string,
  options: { readonly code: string },
): number | undefined {
  const parsed = parseOptionalNumber(value, field, options);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DirectorHostHttpError(
      400,
      options.code,
      `Request body field ${field} must be a positive integer when provided.`,
    );
  }
  return parsed;
}

function parseRunSchedulerExecutorRequest(value: unknown): { readonly maxDispatches?: number } {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_RUN_SCHEDULER_EXECUTOR_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const maxDispatches = parseOptionalPositiveInteger(value.maxDispatches, "maxDispatches", {
    code: "INVALID_RUN_SCHEDULER_EXECUTOR_REQUEST",
  });
  if (maxDispatches !== undefined && maxDispatches > 10) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_RUN_SCHEDULER_EXECUTOR_REQUEST",
      "Request body field maxDispatches must be at most 10.",
    );
  }
  return {
    ...(maxDispatches === undefined ? {} : { maxDispatches }),
  };
}

function parseRunSchedulerRecoveryRequest(value: unknown): {
  readonly actionId?: string;
  readonly confirmCancelObservedDrift?: boolean;
} {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_RUN_SCHEDULER_RECOVERY_REQUEST",
      "Request body must be a JSON object.",
    );
  }
  const actionId = parseOptionalTrimmedStringWithCode(value.actionId, "actionId", {
    code: "INVALID_RUN_SCHEDULER_RECOVERY_REQUEST",
  });
  const confirmCancelObservedDrift = parseOptionalBoolean(
    value.confirmCancelObservedDrift,
    "confirmCancelObservedDrift",
    {
      code: "INVALID_RUN_SCHEDULER_RECOVERY_REQUEST",
    },
  );
  return {
    ...(actionId === undefined ? {} : { actionId }),
    ...(confirmCancelObservedDrift === undefined ? {} : { confirmCancelObservedDrift }),
  };
}

function parseOptionalBoolean(
  value: unknown,
  field: string,
  options: { readonly code: string },
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new DirectorHostHttpError(
      400,
      options.code,
      `Request body field ${field} must be a boolean when provided.`,
    );
  }
  return value;
}

function parseOptionalRecord(
  value: unknown,
  field: string,
  code: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      code,
      `Request body field ${field} must be an object when provided.`,
    );
  }
  return value;
}

function parseOptionalHostExternalToolApproval(
  value: unknown,
): ExternalToolInvokeRequest["approval"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_TOOLS_INVOKE_REQUEST",
      "Request body field approval must be an object when provided.",
    );
  }
  const status = parseRequiredTrimmedString(value.status, "approval.status", {
    code: "INVALID_TOOLS_INVOKE_REQUEST",
  });
  if (status !== "approved" && status !== "rejected") {
    throw new DirectorHostHttpError(
      400,
      "INVALID_TOOLS_INVOKE_REQUEST",
      "Request body field approval.status must be approved or rejected.",
    );
  }
  const operatorId = parseOptionalTrimmedStringWithCode(value.operatorId, "approval.operatorId", {
    code: "INVALID_TOOLS_INVOKE_REQUEST",
  });
  const reason = parseOptionalTrimmedStringWithCode(value.reason, "approval.reason", {
    code: "INVALID_TOOLS_INVOKE_REQUEST",
  });
  const metadata = parseOptionalRecord(
    value.metadata,
    "approval.metadata",
    "INVALID_TOOLS_INVOKE_REQUEST",
  );
  return {
    status,
    ...(operatorId === undefined ? {} : { operatorId }),
    ...(reason === undefined ? {} : { reason }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function normalizeOptionalUrlSearchParam(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function parseOptionalUrlPositiveInteger(
  value: string | null,
  field: string,
  code: string,
): number | undefined {
  const normalized = normalizeOptionalUrlSearchParam(value);
  if (normalized === undefined) {
    return undefined;
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DirectorHostHttpError(
      400,
      code,
      `Query parameter ${field} must be a positive integer.`,
    );
  }
  return parsed;
}

function parseOptionalUrlBoolean(
  value: string | null,
  field: string,
  code: string,
): boolean | undefined {
  const normalized = normalizeOptionalUrlSearchParam(value)?.toLowerCase();
  if (normalized === undefined) {
    return undefined;
  }
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  throw new DirectorHostHttpError(400, code, `Query parameter ${field} must be true or false.`);
}

function parseRequiredStringArray(
  value: unknown,
  field: string,
  options: { readonly code: string },
): readonly string[] {
  const values = parseOptionalStringArray(value, field, options);
  if (values === undefined || values.length === 0) {
    throw new DirectorHostHttpError(
      400,
      options.code,
      `Request body field ${field} must contain at least one non-empty string.`,
    );
  }
  return values;
}

function parseOptionalStringArray(
  value: unknown,
  field: string,
  options: { readonly code: string },
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new DirectorHostHttpError(
      400,
      options.code,
      `Request body field ${field} must be an array of strings when provided.`,
    );
  }
  const parsed = value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new DirectorHostHttpError(
        400,
        options.code,
        `Request body field ${field}[${index}] must be a string.`,
      );
    }
    return entry.trim();
  });
  const filtered = parsed.filter((entry) => entry.length > 0);
  return filtered.length === 0 ? undefined : filtered;
}

function parseRequiredTrimmedString(
  value: unknown,
  field: string,
  options: { readonly code: string },
): string {
  const parsed = parseOptionalTrimmedStringWithCode(value, field, options);
  if (parsed === undefined) {
    throw new DirectorHostHttpError(
      400,
      options.code,
      `Request body field ${field} must be a non-empty string.`,
    );
  }
  return parsed;
}

function parseOptionalTrimmedStringWithCode(
  value: unknown,
  field: string,
  options: { readonly code: string },
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DirectorHostHttpError(
      400,
      options.code,
      `Request body field ${field} must be a string when provided.`,
    );
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function parseOptionalTrimmedString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DirectorHostHttpError(
      400,
      "INVALID_OPERATOR_REQUEST",
      `Request body field ${field} must be a string when provided.`,
    );
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function toEpochMs(value: string | undefined): number {
  if (value === undefined) {
    return Date.now();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new DirectorHostHttpError(
      400,
      "INVALID_OPERATOR_REQUEST",
      `Request body field now must be a valid ISO timestamp: ${value}`,
    );
  }
  return parsed;
}

function slugifyRouteToken(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  return normalized.length > 0 ? normalized : "item";
}

function isDirectorBridgeConstraint(value: unknown): value is DirectorApiProviderBridgeConstraint {
  return (
    isRecord(value) &&
    typeof value.field === "string" &&
    value.field.trim().length > 0 &&
    typeof value.requirement === "string" &&
    value.requirement.trim().length > 0 &&
    typeof value.priority === "string" &&
    value.priority.trim().length > 0 &&
    (value.rationale === undefined || typeof value.rationale === "string")
  );
}

function isRetryAssignmentRequest(value: unknown): value is RetryAssignmentRequest {
  return (
    isRecord(value) &&
    typeof value.assignmentId === "string" &&
    value.assignmentId.trim().length > 0
  );
}

function isApproveAssignmentRequest(value: unknown): value is RetryAssignmentRequest {
  return isRetryAssignmentRequest(value);
}

function isRerouteAssignmentRequest(value: unknown): value is RerouteAssignmentRequest {
  return (
    isRecord(value) &&
    typeof value.assignmentId === "string" &&
    value.assignmentId.trim().length > 0 &&
    typeof value.adapterId === "string" &&
    value.adapterId.trim().length > 0
  );
}

type RunControlAction = "start" | "pause" | "resume" | "abort" | "retry" | "approve" | "reroute";

function matchRunControlRoute(
  pathname: string,
): { readonly runId: string; readonly action: RunControlAction } | null {
  const match = /^\/v1\/runs\/([^/]+)\/(start|pause|resume|abort|retry|approve|reroute)$/u.exec(
    pathname,
  );
  if (!match) {
    return null;
  }
  return {
    runId: match[1] ?? "",
    action: (match[2] ?? "start") as RunControlAction,
  };
}

function matchRunReportRoute(pathname: string): { readonly runId: string } | null {
  const match = /^\/v1\/runs\/([^/]+)\/report$/u.exec(pathname);
  if (!match) {
    return null;
  }
  return {
    runId: match[1] ?? "",
  };
}

function matchRunDelegationsRoute(pathname: string): { readonly runId: string } | null {
  const match = /^\/v1\/runs\/([^/]+)\/delegations$/u.exec(pathname);
  if (!match) {
    return null;
  }
  return {
    runId: match[1] ?? "",
  };
}

function matchRunSchedulerExecutorRoute(pathname: string): { readonly runId: string } | null {
  const match = /^\/v1\/runs\/([^/]+)\/scheduler-executor$/u.exec(pathname);
  if (!match) {
    return null;
  }
  return {
    runId: match[1] ?? "",
  };
}

function matchRunSchedulerRecoveryRoute(pathname: string): { readonly runId: string } | null {
  const match = /^\/v1\/runs\/([^/]+)\/scheduler-recovery$/u.exec(pathname);
  if (!match) {
    return null;
  }
  return {
    runId: match[1] ?? "",
  };
}

function matchRunExperienceRoute(pathname: string): { readonly runId: string } | null {
  const match = /^\/v1\/runs\/([^/]+)\/experience$/u.exec(pathname);
  if (!match) {
    return null;
  }
  return {
    runId: match[1] ?? "",
  };
}

function matchRunReflectionRoute(pathname: string): { readonly runId: string } | null {
  const match = /^\/v1\/runs\/([^/]+)\/reflection$/u.exec(pathname);
  if (!match) {
    return null;
  }
  return {
    runId: match[1] ?? "",
  };
}

function matchRunDetailRoute(pathname: string): { readonly runId: string } | null {
  const match = /^\/v1\/runs\/([^/]+)$/u.exec(pathname);
  if (!match) {
    return null;
  }
  return {
    runId: match[1] ?? "",
  };
}

async function invokeRunOperation<T>(
  operation: () => Promise<T>,
  runtime: DirectorHostRuntime,
  guidance?: DirectorHostConflictGuidance,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw attachDirectorHostConflictGuidance(mapRunOperationError(error), runtime, guidance);
  }
}

async function invokeEntrySessionOperation<T>(
  operation: () => Promise<T>,
  runtime: DirectorHostRuntime,
  guidance?: DirectorHostConflictGuidance,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw attachDirectorHostConflictGuidance(mapEntrySessionError(error), runtime, guidance);
  }
}

function attachDirectorHostConflictGuidance(
  error: DirectorHostHttpError | Error,
  runtime: DirectorHostRuntime,
  guidance: DirectorHostConflictGuidance | undefined,
): DirectorHostHttpError | Error {
  if (
    !(error instanceof DirectorHostHttpError) ||
    guidance === undefined ||
    (error.code !== "ENTRY_SESSION_STATE_CONFLICT" && error.code !== "RUN_STATE_CONFLICT")
  ) {
    return error;
  }

  const handoff = createRuntimePreflightHandoff(runtime);
  return new DirectorHostHttpError(error.statusCode, error.code, error.message, {
    ...(error.metadata ?? {}),
    blockedRoute: guidance.blockedRoute,
    recommendedAction: guidance.recommendedAction,
    ...(guidance.nextRoute === undefined ? {} : { nextRoute: guidance.nextRoute }),
    ...handoff,
  });
}

function mapRunOperationError(error: unknown): DirectorHostHttpError | Error {
  if (error instanceof DirectorHostHttpError) {
    return error;
  }
  if (!(error instanceof Error)) {
    return new DirectorHostHttpError(500, "INTERNAL_ERROR", "Unexpected error");
  }
  if (error.message.startsWith("Unknown execution run:")) {
    return new DirectorHostHttpError(404, "RUN_NOT_FOUND", error.message);
  }
  if (error.message.includes("does not contain assignment")) {
    return new DirectorHostHttpError(404, "ASSIGNMENT_NOT_FOUND", error.message);
  }
  if (
    error.message.includes("already terminal") ||
    error.message.includes("cannot retry assignments") ||
    error.message.includes("cannot be retried") ||
    error.message.includes("cannot be rerouted") ||
    error.message.includes("cannot reroute") ||
    error.message.includes("already routed") ||
    error.message.includes("approved adapter set") ||
    error.message.includes("approved alternate adapter") ||
    error.message.includes("cannot be resumed") ||
    error.message.includes("Use startRun()") ||
    error.message.includes("Use resumeRun()")
  ) {
    return new DirectorHostHttpError(409, "RUN_STATE_CONFLICT", error.message);
  }
  return error;
}

function mapEntrySessionError(error: unknown): DirectorHostHttpError | Error {
  if (error instanceof DirectorHostHttpError) {
    return error;
  }
  if (!(error instanceof Error)) {
    return new DirectorHostHttpError(500, "INTERNAL_ERROR", "Unexpected error");
  }
  if (error.message.startsWith("Unknown entry session:")) {
    return new DirectorHostHttpError(404, "ENTRY_SESSION_NOT_FOUND", error.message);
  }
  if (
    error.message.includes("does not have an intake context") ||
    error.message.includes("is not ready for blueprint creation") ||
    error.message.includes("does not have a blueprint yet")
  ) {
    return new DirectorHostHttpError(409, "ENTRY_SESSION_STATE_CONFLICT", error.message);
  }
  return error;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const declaredBytes = readHostApiContentLength(request);
  if (declaredBytes > DEFAULT_HOST_API_MAX_JSON_BODY_BYTES) {
    throw createHostApiPayloadTooLargeError();
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.byteLength;
    if (totalBytes > DEFAULT_HOST_API_MAX_JSON_BODY_BYTES) {
      throw createHostApiPayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new DirectorHostHttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function readHostApiContentLength(request: IncomingMessage): number {
  const raw = request.headers["content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim().length === 0) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function createHostApiPayloadTooLargeError(): DirectorHostHttpError {
  return new DirectorHostHttpError(
    413,
    "PAYLOAD_TOO_LARGE",
    `Request body exceeds ${DEFAULT_HOST_API_MAX_JSON_BODY_BYTES} bytes.`,
  );
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

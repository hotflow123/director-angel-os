import { createChannelTransportEnvelope } from "@hotflow/contracts";
import type {
  ExternalToolsCatalogRpcResult,
  ExternalToolsEffectiveRpcResult,
  ExternalToolsInvokeRpcResult,
} from "@hotflow/conversation-runtime";
import type { DirectorRuntimeCapabilitySnapshotResponse } from "@hotflow/director-host-contracts";

import type { FetchLike } from "./types.js";

export interface DirectorGatewayOptions {
  readonly hostApiUrl: string;
  readonly hostId: string;
  readonly agentId: string;
  readonly channel: string;
  readonly autoAdvance: boolean;
  readonly autoStartRun: boolean;
  readonly fetchFn?: FetchLike;
}

export interface DirectorGatewayMessage {
  readonly peerId: string;
  readonly messageId: string;
  readonly receivedAtMs: number;
  readonly text: string;
}

interface EntrySessionShape {
  readonly entrySessionId: string;
  readonly state: string;
  readonly nextAction: string;
  readonly latestLineage?: {
    readonly blueprintId?: string;
    readonly runId?: string;
    readonly reportId?: string;
  };
  readonly latestRun?: {
    readonly runId: string;
    readonly status: string;
  };
  readonly latestReport?: {
    readonly reportId: string;
    readonly operatorSummary?: string;
  };
}

interface EntryIntakePayloadShape {
  readonly session: EntrySessionShape;
  readonly turn?: {
    readonly summary?: string;
  };
  readonly intake?: {
    readonly intakeId?: string;
    readonly alignmentLock?: {
      readonly objective?: string;
      readonly notes?: readonly string[];
    } | null;
  };
}

interface EntryBlueprintPayloadShape {
  readonly session: EntrySessionShape;
  readonly blueprint?: {
    readonly blueprintId?: string;
    readonly review?: {
      readonly overallDecision?: string;
      readonly blockingReasons?: readonly string[];
      readonly requiredFixes?: readonly string[];
    };
    readonly preview?: {
      readonly warnings?: readonly string[];
      readonly requiredApprovals?: readonly string[];
    };
    readonly actionGraph?: {
      readonly goal?: string;
      readonly nodes?: readonly {
        readonly assignmentId?: string;
        readonly role?: string;
        readonly objective?: string;
        readonly deliverable?: string;
        readonly approvalMode?: string;
        readonly selectedAdapter?: string;
        readonly status?: string;
      }[];
    };
    readonly handoff?: {
      readonly handoffId?: string;
      readonly expectedArtifacts?: readonly {
        readonly title?: string;
        readonly inlineText?: string;
      }[];
    };
  };
}

interface EntryRunPayloadShape {
  readonly session: EntrySessionShape;
  readonly run?: {
    readonly runId?: string;
    readonly status?: string;
    readonly assignments?: readonly ExecutionAssignmentShape[];
  };
}

interface EntryStatusPayloadShape {
  readonly session: EntrySessionShape;
  readonly run?: {
    readonly runId?: string;
    readonly status?: string;
  };
  readonly report?: {
    readonly reportId?: string;
    readonly operatorSurface?: {
      readonly operatorSummary?: string;
      readonly flags?: readonly string[];
      readonly nextAction?: string;
    };
  };
}

export interface DirectorGatewayResult {
  readonly intake: EntryIntakePayloadShape;
  readonly blueprint?: EntryBlueprintPayloadShape;
  readonly run?: EntryRunPayloadShape;
  readonly status?: EntryStatusPayloadShape;
}

export interface ExecutionAssignmentShape {
  readonly assignmentId?: string;
  readonly role?: string;
  readonly status?: string;
  readonly approvalMode?: string;
}

export interface ExecutionRunShape {
  readonly runId?: string;
  readonly status?: string;
  readonly assignments?: readonly ExecutionAssignmentShape[];
}

export interface DirectorGatewaySessionSnapshot {
  readonly entrySessionId?: string;
  readonly blueprintId?: string;
  readonly runId?: string;
  readonly lastObjective?: string;
  readonly pendingApprovalAssignmentIds: readonly string[];
}

export interface DirectorRunConfirmationResult {
  readonly runId: string;
  readonly approvedAssignmentIds: readonly string[];
  readonly run?: ExecutionRunShape;
  readonly status?: EntryStatusPayloadShape;
}

export type DirectorRunControlAction = "pause" | "resume" | "abort";

export interface DirectorRunControlResult {
  readonly runId: string;
  readonly action: DirectorRunControlAction;
  readonly run: ExecutionRunShape;
}

export interface DirectorRunSubagentAnnounceShape {
  readonly announceId?: string;
  readonly subagentId?: string;
  readonly requesterSessionKey?: string;
  readonly requesterOrigin?: string;
  readonly deliveryTarget?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly userFacingText?: string;
  readonly updatedAtMs?: number;
}

export interface DirectorRunDelegationsShape {
  readonly runId?: string;
  readonly sessionId?: string;
  readonly subagentAnnounceCount?: number;
  readonly subagentAnnounces?: readonly DirectorRunSubagentAnnounceShape[];
}

export interface DirectorClientRuntimeTaskShape {
  readonly schemaVersion?: string;
  readonly id?: string;
  readonly taskId?: string;
  readonly label?: string;
  readonly artifactLabel?: string | null;
  readonly status?: string;
  readonly originRuntime?: string;
  readonly payload?: {
    readonly previewSummary?: string;
    readonly goal?: string;
    readonly statusWarningSummary?: string;
  };
  readonly controls?: {
    readonly read?: boolean;
    readonly stop?: boolean;
    readonly steer?: boolean;
    readonly followup?: boolean;
  };
}

export interface DirectorClientRuntimeTaskResult {
  readonly apiVersion?: string;
  readonly schemaId?: string;
  readonly clientRuntimeTask?: DirectorClientRuntimeTaskShape | null;
  readonly run?: ExecutionRunShape;
}

export interface DirectorClientRuntimeStopResult {
  readonly apiVersion?: string;
  readonly schemaId?: string;
  readonly clientRuntimeStop?: {
    readonly schemaVersion?: string;
    readonly stopped?: number;
    readonly taskIds?: readonly string[];
    readonly originRuntime?: string;
    readonly errors?: readonly unknown[];
  };
  readonly run?: ExecutionRunShape;
}

export interface DirectorClientRuntimeFollowupResult {
  readonly apiVersion?: string;
  readonly schemaId?: string;
  readonly clientRuntimeFollowup?: {
    readonly schemaVersion?: string;
    readonly accepted?: boolean;
    readonly status?: string;
    readonly continued?: number;
    readonly taskIds?: readonly string[];
    readonly approvedAssignmentIds?: readonly string[];
    readonly originRuntime?: string;
    readonly reason?: string;
  };
  readonly run?: ExecutionRunShape;
}

export type DirectorExperienceAction = "accept" | "reject" | "promote";
export type DirectorKnowledgeAction = "accept" | "reject" | "publish";
export type DirectorSkillProposalAction = "accept" | "reject" | "apply";

export interface DirectorToolsCatalogInput {
  readonly agentId?: string;
}

export interface DirectorToolsEffectiveInput {
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly profile?: string;
  readonly includeUnavailable?: boolean;
}

export interface DirectorToolsInvokeInput {
  readonly toolId?: string;
  readonly name?: string;
  readonly tool?: string;
  readonly operationId?: string;
  readonly action?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly command?: string;
  readonly cwd?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly dryRun?: boolean;
  readonly idempotencyKey?: string;
  readonly sandboxPolicy?: Readonly<Record<string, unknown>>;
  readonly sandboxRuntimePolicy?: Readonly<Record<string, unknown>>;
  readonly requestedNetworkPolicy?: string;
  readonly approval?: {
    readonly status: "approved" | "rejected";
    readonly operatorId?: string;
    readonly reason?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function getFetch(fetchFn?: FetchLike): FetchLike {
  return fetchFn ?? ((url, init) => fetch(url, init));
}

function buildUrl(hostApiUrl: string, path: string): string {
  return new URL(path, `${hostApiUrl.replace(/\/+$/u, "")}/`).toString();
}

async function postJson<T>(
  hostApiUrl: string,
  path: string,
  body: unknown | undefined,
  fetchFn?: FetchLike,
): Promise<T> {
  const response = await getFetch(fetchFn)(buildUrl(hostApiUrl, path), {
    method: "POST",
    headers: createDirectorHostApiRequestHeaders({ "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Director Host API ${path} HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(raw) as T;
}

async function putJson<T>(
  hostApiUrl: string,
  path: string,
  body: unknown | undefined,
  fetchFn?: FetchLike,
): Promise<T> {
  const response = await getFetch(fetchFn)(buildUrl(hostApiUrl, path), {
    method: "PUT",
    headers: createDirectorHostApiRequestHeaders({ "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Director Host API ${path} HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(raw) as T;
}

async function getJson<T>(hostApiUrl: string, path: string, fetchFn?: FetchLike): Promise<T> {
  const response = await getFetch(fetchFn)(buildUrl(hostApiUrl, path), {
    method: "GET",
    headers: createDirectorHostApiRequestHeaders(),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Director Host API ${path} HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(raw) as T;
}

function createDirectorHostApiRequestHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  const token = readDirectorHostApiBearerToken();
  return token === undefined
    ? headers
    : {
        ...headers,
        authorization: `Bearer ${token}`,
      };
}

function readDirectorHostApiBearerToken(): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  const token = process.env?.DIRECTOR_HOST_API_BEARER_TOKEN?.trim();
  return token === undefined || token.length === 0 ? undefined : token;
}

export async function sendMessageToDirector(
  options: DirectorGatewayOptions,
  message: DirectorGatewayMessage,
): Promise<DirectorGatewayResult> {
  const intake = await postJson<EntryIntakePayloadShape>(
    options.hostApiUrl,
    "/v1/entry/message",
    {
      apiVersion: "director-entry.v1",
      hostId: options.hostId,
      message: createChannelTransportEnvelope({
        channel: options.channel,
        agentId: options.agentId,
        peerId: message.peerId,
        messageId: message.messageId,
        receivedAtMs: message.receivedAtMs,
        text: message.text,
        routingHint: {
          agentId: options.agentId,
          channel: options.channel,
          routeKind: "direct",
          peerId: message.peerId,
        },
        metadata: {
          source: "director-weixin-gateway",
        },
      }),
    },
    options.fetchFn,
  );

  if (!options.autoAdvance) {
    return { intake };
  }

  let blueprint: EntryBlueprintPayloadShape | undefined;
  if (intake.session.nextAction === "blueprint") {
    blueprint = await postJson<EntryBlueprintPayloadShape>(
      options.hostApiUrl,
      `/v1/entry/sessions/${encodeURIComponent(intake.session.entrySessionId)}/blueprint`,
      undefined,
      options.fetchFn,
    );
  }

  const sessionAfterBlueprint = blueprint?.session ?? intake.session;
  let run: EntryRunPayloadShape | undefined;
  if (sessionAfterBlueprint.nextAction === "run") {
    run = await postJson<EntryRunPayloadShape>(
      options.hostApiUrl,
      `/v1/entry/sessions/${encodeURIComponent(sessionAfterBlueprint.entrySessionId)}/runs`,
      undefined,
      options.fetchFn,
    );
  }

  const runId = run?.run?.runId;
  if (options.autoStartRun && runId !== undefined && runId.length > 0) {
    await postJson(
      options.hostApiUrl,
      `/v1/runs/${encodeURIComponent(runId)}/start`,
      undefined,
      options.fetchFn,
    );
  }

  const latestSession = run?.session ?? blueprint?.session ?? intake.session;
  const status =
    run?.run?.runId === undefined
      ? undefined
      : await getJson<EntryStatusPayloadShape>(
          options.hostApiUrl,
          `/v1/entry/sessions/${encodeURIComponent(latestSession.entrySessionId)}/status`,
          options.fetchFn,
        );

  return {
    intake,
    ...(blueprint === undefined ? {} : { blueprint }),
    ...(run === undefined ? {} : { run }),
    ...(status === undefined ? {} : { status }),
  };
}

export async function confirmDirectorRun(
  options: DirectorGatewayOptions,
  input: {
    readonly runId: string;
    readonly entrySessionId?: string;
    readonly preferredAssignmentIds?: readonly string[];
  },
): Promise<DirectorRunConfirmationResult> {
  const currentRun = await getJson<ExecutionRunShape>(
    options.hostApiUrl,
    `/v1/runs/${encodeURIComponent(input.runId)}`,
    options.fetchFn,
  );
  const pendingAssignmentIds = collectPendingApprovalAssignmentIds(currentRun);
  const fallbackAssignmentIds = input.preferredAssignmentIds ?? [];
  const runReturnedAssignments = (currentRun.assignments?.length ?? 0) > 0;
  const assignmentIds =
    pendingAssignmentIds.length > 0
      ? pendingAssignmentIds
      : runReturnedAssignments
        ? []
        : fallbackAssignmentIds.filter((assignmentId) => assignmentId.length > 0);

  let latestRun: ExecutionRunShape | undefined = currentRun;
  const approvedAssignmentIds: string[] = [];
  for (const assignmentId of assignmentIds) {
    latestRun = await postJson<ExecutionRunShape>(
      options.hostApiUrl,
      `/v1/runs/${encodeURIComponent(input.runId)}/approve`,
      { assignmentId },
      options.fetchFn,
    );
    approvedAssignmentIds.push(assignmentId);
  }

  if (latestRun?.status === "created") {
    latestRun = await postJson<ExecutionRunShape>(
      options.hostApiUrl,
      `/v1/runs/${encodeURIComponent(input.runId)}/start`,
      undefined,
      options.fetchFn,
    );
  }

  const status =
    input.entrySessionId === undefined
      ? undefined
      : await getJson<EntryStatusPayloadShape>(
          options.hostApiUrl,
          `/v1/entry/sessions/${encodeURIComponent(input.entrySessionId)}/status`,
          options.fetchFn,
        );

  return {
    runId: input.runId,
    approvedAssignmentIds,
    ...(latestRun === undefined ? {} : { run: latestRun }),
    ...(status === undefined ? {} : { status }),
  };
}

export async function getDirectorEntrySessionStatus(
  options: DirectorGatewayOptions,
  entrySessionId: string,
): Promise<EntryStatusPayloadShape> {
  return getJson<EntryStatusPayloadShape>(
    options.hostApiUrl,
    `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/status`,
    options.fetchFn,
  );
}

export async function getDirectorRun(
  options: DirectorGatewayOptions,
  runId: string,
): Promise<ExecutionRunShape> {
  return getJson<ExecutionRunShape>(
    options.hostApiUrl,
    `/v1/runs/${encodeURIComponent(runId)}`,
    options.fetchFn,
  );
}

export async function controlDirectorRun(
  options: DirectorGatewayOptions,
  input: {
    readonly runId: string;
    readonly action: DirectorRunControlAction;
  },
): Promise<DirectorRunControlResult> {
  const run = await postJson<ExecutionRunShape>(
    options.hostApiUrl,
    `/v1/runs/${encodeURIComponent(input.runId)}/${input.action}`,
    undefined,
    options.fetchFn,
  );
  return {
    runId: input.runId,
    action: input.action,
    run,
  };
}

export async function getDirectorRunDelegations(
  options: DirectorGatewayOptions,
  runId: string,
): Promise<DirectorRunDelegationsShape> {
  return getJson<DirectorRunDelegationsShape>(
    options.hostApiUrl,
    `/v1/runs/${encodeURIComponent(runId)}/delegations`,
    options.fetchFn,
  );
}

export async function getDirectorClientRuntimeTask(
  options: DirectorGatewayOptions,
  taskId: string,
  input: { readonly clientSurface?: string } = {},
): Promise<DirectorClientRuntimeTaskResult> {
  const query =
    input.clientSurface === undefined
      ? ""
      : `?clientSurface=${encodeURIComponent(input.clientSurface)}`;
  return getJson<DirectorClientRuntimeTaskResult>(
    options.hostApiUrl,
    `/v1/client-runtime/tasks/${encodeURIComponent(taskId)}${query}`,
    options.fetchFn,
  );
}

export async function stopDirectorClientRuntimeTask(
  options: DirectorGatewayOptions,
  input: {
    readonly taskId: string;
    readonly reason?: string;
    readonly clientSurface?: string;
  },
): Promise<DirectorClientRuntimeStopResult> {
  return postJson<DirectorClientRuntimeStopResult>(
    options.hostApiUrl,
    `/v1/client-runtime/tasks/${encodeURIComponent(input.taskId)}/stop`,
    {
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.clientSurface === undefined ? {} : { clientSurface: input.clientSurface }),
    },
    options.fetchFn,
  );
}

export async function followupDirectorClientRuntimeTask(
  options: DirectorGatewayOptions,
  input: {
    readonly taskId: string;
    readonly reason?: string;
    readonly instruction?: string;
    readonly entrySessionId?: string;
    readonly clientSurface?: string;
  },
): Promise<DirectorClientRuntimeFollowupResult> {
  return postJson<DirectorClientRuntimeFollowupResult>(
    options.hostApiUrl,
    `/v1/client-runtime/tasks/${encodeURIComponent(input.taskId)}/followup`,
    {
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
      ...(input.entrySessionId === undefined ? {} : { entrySessionId: input.entrySessionId }),
      ...(input.clientSurface === undefined ? {} : { clientSurface: input.clientSurface }),
    },
    options.fetchFn,
  );
}

export async function learnDirectorFromUrl(
  options: DirectorGatewayOptions,
  input: {
    readonly sourceId: string;
    readonly urls: readonly string[];
    readonly nowMs?: number;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/learning/url",
    {
      sourceId: input.sourceId,
      urls: input.urls,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
    options.fetchFn,
  );
}

export async function learnDirectorFromQuery(
  options: DirectorGatewayOptions,
  input: {
    readonly sourceId: string;
    readonly queries: readonly string[];
    readonly nowMs?: number;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/learning/query",
    {
      sourceId: input.sourceId,
      queries: input.queries,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
    options.fetchFn,
  );
}

export async function learnDirectorFromDirectory(
  options: DirectorGatewayOptions,
  input: {
    readonly sourceId: string;
    readonly directory: string;
    readonly nowMs?: number;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/learning/directory",
    {
      sourceId: input.sourceId,
      directory: input.directory,
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
    options.fetchFn,
  );
}

export async function learnDirectorFromText(
  options: DirectorGatewayOptions,
  input: {
    readonly sourceId: string;
    readonly title: string;
    readonly content: string;
    readonly sourceRef?: string;
    readonly nowMs?: number;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/learning/text",
    {
      sourceId: input.sourceId,
      texts: [
        {
          title: input.title,
          content: input.content,
          ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
        },
      ],
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
    options.fetchFn,
  );
}

export async function listDirectorExperienceCandidates(
  options: DirectorGatewayOptions,
): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/experience/candidates",
    options.fetchFn,
  );
}

export async function actOnDirectorExperienceCandidate(
  options: DirectorGatewayOptions,
  input: {
    readonly candidateId: string;
    readonly action: DirectorExperienceAction;
    readonly actor?: string;
    readonly note?: string;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    `/v1/experience/candidates/${encodeURIComponent(input.candidateId)}/${input.action}`,
    createOperatorBody(input),
    options.fetchFn,
  );
}

export async function listDirectorKnowledgeCandidates(
  options: DirectorGatewayOptions,
): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/knowledge/candidates",
    options.fetchFn,
  );
}

export async function actOnDirectorKnowledgeCandidate(
  options: DirectorGatewayOptions,
  input: {
    readonly packId: string;
    readonly action: DirectorKnowledgeAction;
    readonly actor?: string;
    readonly note?: string;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    `/v1/knowledge/candidates/${encodeURIComponent(input.packId)}/${input.action}`,
    createOperatorBody(input),
    options.fetchFn,
  );
}

export async function previewDirectorKnowledgeRecall(
  options: DirectorGatewayOptions,
  input: {
    readonly tags?: readonly string[];
    readonly projectId?: string;
    readonly groupId?: string;
    readonly includeGlobalExperience?: boolean;
    readonly maxHits?: number;
    readonly maxChars?: number;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/knowledge/recall-preview",
    {
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
      ...(input.includeGlobalExperience === undefined
        ? {}
        : { includeGlobalExperience: input.includeGlobalExperience }),
      ...(input.maxHits === undefined ? {} : { maxHits: input.maxHits }),
      ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars }),
    },
    options.fetchFn,
  );
}

export async function readDirectorMemoryStatus(
  options: DirectorGatewayOptions,
): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(options.hostApiUrl, "/v1/memory/status", options.fetchFn);
}

export type DirectorMemoryPublicationAction = "retract" | "demote" | "quarantine" | "restore";

export async function governDirectorMemoryPublication(
  options: DirectorGatewayOptions,
  input: {
    readonly recordId: string;
    readonly action: DirectorMemoryPublicationAction;
    readonly actor?: string;
    readonly note?: string;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    `/v1/memory/publications/${encodeURIComponent(input.recordId)}/${input.action}`,
    createOperatorBody({
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
    }),
    options.fetchFn,
  );
}

export async function readDirectorToolsCatalog(
  options: DirectorGatewayOptions,
  input: DirectorToolsCatalogInput = {},
): Promise<ExternalToolsCatalogRpcResult> {
  const query = createToolsCatalogQuery(input);
  return getJson<ExternalToolsCatalogRpcResult>(
    options.hostApiUrl,
    query.length === 0 ? "/v1/tools/catalog" : `/v1/tools/catalog?${query}`,
    options.fetchFn,
  );
}

export async function readDirectorToolsEffective(
  options: DirectorGatewayOptions,
  input: DirectorToolsEffectiveInput = {},
): Promise<ExternalToolsEffectiveRpcResult> {
  const query = createToolsEffectiveQuery(input);
  return getJson<ExternalToolsEffectiveRpcResult>(
    options.hostApiUrl,
    query.length === 0 ? "/v1/tools/effective" : `/v1/tools/effective?${query}`,
    options.fetchFn,
  );
}

export async function readDirectorRuntimeCapabilitySnapshot(
  options: DirectorGatewayOptions,
): Promise<DirectorRuntimeCapabilitySnapshotResponse> {
  return getJson<DirectorRuntimeCapabilitySnapshotResponse>(
    options.hostApiUrl,
    "/v1/runtime/snapshot",
    options.fetchFn,
  );
}

export async function invokeDirectorTool(
  options: DirectorGatewayOptions,
  input: DirectorToolsInvokeInput,
): Promise<ExternalToolsInvokeRpcResult> {
  return postJson<ExternalToolsInvokeRpcResult>(
    options.hostApiUrl,
    "/v1/tools/invoke",
    input,
    options.fetchFn,
  );
}

export async function previewDirectorMemoryRecall(
  options: DirectorGatewayOptions,
  input: {
    readonly projectId: string;
    readonly groupId?: string;
    readonly anchorIds?: readonly string[];
    readonly selectedAdapters?: readonly string[];
    readonly generationType?: string;
    readonly generationStyle?: string;
    readonly knowledgeSignalTags?: readonly string[];
    readonly maxHits?: number;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/memory/recall-preview",
    {
      projectId: input.projectId,
      ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
      ...(input.anchorIds === undefined ? {} : { anchorIds: input.anchorIds }),
      ...(input.selectedAdapters === undefined ? {} : { selectedAdapters: input.selectedAdapters }),
      ...(input.generationType === undefined ? {} : { generationType: input.generationType }),
      ...(input.generationStyle === undefined ? {} : { generationStyle: input.generationStyle }),
      ...(input.knowledgeSignalTags === undefined
        ? {}
        : { knowledgeSignalTags: input.knowledgeSignalTags }),
      ...(input.maxHits === undefined ? {} : { maxHits: input.maxHits }),
    },
    options.fetchFn,
  );
}

export interface DirectorMaintenanceInput {
  readonly nowMs?: number;
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
}

export async function previewDirectorMaintenance(
  options: DirectorGatewayOptions,
  input: DirectorMaintenanceInput = {},
): Promise<Record<string, unknown>> {
  const query = createMaintenanceQuery(input);
  return getJson<Record<string, unknown>>(
    options.hostApiUrl,
    query.length > 0 ? `/v1/maintenance?${query}` : "/v1/maintenance",
    options.fetchFn,
  );
}

export async function applyDirectorMaintenanceFromGateway(
  options: DirectorGatewayOptions,
  input: DirectorMaintenanceInput = {},
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/maintenance",
    createMaintenanceBody(input),
    options.fetchFn,
  );
}

export async function listDirectorSkills(
  options: DirectorGatewayOptions,
  input: {
    readonly query?: string;
    readonly limit?: number;
    readonly includeDisabled?: boolean;
  } = {},
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  if (input.query !== undefined && input.query.trim().length > 0) {
    params.set("query", input.query.trim());
  }
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  if (input.includeDisabled !== undefined) {
    params.set("includeDisabled", String(input.includeDisabled));
  }
  const query = params.toString();
  return getJson<Record<string, unknown>>(
    options.hostApiUrl,
    query.length === 0 ? "/v1/skills" : `/v1/skills?${query}`,
    options.fetchFn,
  );
}

export async function viewDirectorSkill(
  options: DirectorGatewayOptions,
  input:
    | string
    | {
        readonly skillId: string;
        readonly actor?: string;
        readonly reason?: string;
        readonly nowMs?: number;
      },
): Promise<Record<string, unknown>> {
  if (typeof input !== "string") {
    return postJson<Record<string, unknown>>(
      options.hostApiUrl,
      `/v1/skills/${encodeURIComponent(input.skillId)}/view`,
      {
        ...(input.actor === undefined ? {} : { actor: input.actor }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
      },
      options.fetchFn,
    );
  }
  return getJson<Record<string, unknown>>(
    options.hostApiUrl,
    `/v1/skills/${encodeURIComponent(input)}`,
    options.fetchFn,
  );
}

export async function useDirectorSkill(
  options: DirectorGatewayOptions,
  input: {
    readonly skillId: string;
    readonly actor?: string;
    readonly reason?: string;
    readonly nowMs?: number;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    `/v1/skills/${encodeURIComponent(input.skillId)}/use`,
    {
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
    options.fetchFn,
  );
}

export async function setDirectorSkillEnablement(
  options: DirectorGatewayOptions,
  input: {
    readonly skillId: string;
    readonly enabled: boolean;
    readonly actor?: string;
    readonly note?: string;
    readonly nowMs?: number;
  },
): Promise<Record<string, unknown>> {
  return putJson<Record<string, unknown>>(
    options.hostApiUrl,
    `/v1/skills/${encodeURIComponent(input.skillId)}/enabled`,
    {
      enabled: input.enabled,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
    options.fetchFn,
  );
}

export async function checkDirectorSkillCuratorWriteGuard(
  options: DirectorGatewayOptions,
  input: {
    readonly action: "patch" | "archive" | "merge";
    readonly skillId: string;
    readonly actor?: string;
    readonly reason?: string;
    readonly canonicalSkillId?: string;
    readonly duplicateSkillIds?: readonly string[];
    readonly scopes?: readonly string[];
    readonly nowMs?: number;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/skills/curator/actions/guard",
    {
      action: input.action,
      skillId: input.skillId,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.canonicalSkillId === undefined ? {} : { canonicalSkillId: input.canonicalSkillId }),
      ...(input.duplicateSkillIds === undefined
        ? {}
        : { duplicateSkillIds: input.duplicateSkillIds }),
      ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
    options.fetchFn,
  );
}

export async function listDirectorSkillProposals(
  options: DirectorGatewayOptions,
): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/skills/proposals",
    options.fetchFn,
  );
}

export async function proposeDirectorSkillFromExperience(
  options: DirectorGatewayOptions,
  input: {
    readonly candidateId: string;
    readonly author?: string;
    readonly nowMs?: number;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    "/v1/skills/proposals/from-experience",
    {
      candidateId: input.candidateId,
      ...(input.author === undefined ? {} : { author: input.author }),
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
    options.fetchFn,
  );
}

export async function actOnDirectorSkillProposal(
  options: DirectorGatewayOptions,
  input: {
    readonly proposalId: string;
    readonly action: DirectorSkillProposalAction;
    readonly actor?: string;
    readonly note?: string;
  },
): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>(
    options.hostApiUrl,
    `/v1/skills/proposals/${encodeURIComponent(input.proposalId)}/${input.action}`,
    createOperatorBody(input),
    options.fetchFn,
  );
}

export function extractDirectorGatewaySessionSnapshot(
  result: DirectorGatewayResult,
): DirectorGatewaySessionSnapshot {
  const latestSession =
    result.status?.session ??
    result.run?.session ??
    result.blueprint?.session ??
    result.intake.session;
  const objective = cleanObjective(
    result.intake.intake?.alignmentLock?.objective ??
      result.intake.turn?.summary ??
      result.blueprint?.blueprint?.actionGraph?.goal ??
      "",
  );
  const runId =
    result.run?.run?.runId ??
    result.status?.run?.runId ??
    latestSession.latestRun?.runId ??
    latestSession.latestLineage?.runId;
  const blueprintId =
    result.blueprint?.blueprint?.blueprintId ?? latestSession.latestLineage?.blueprintId;
  const pendingApprovalAssignmentIds = [
    ...collectPendingApprovalAssignmentIds(result.run?.run),
    ...collectPendingApprovalAssignmentIdsFromBlueprint(result.blueprint?.blueprint),
  ];

  return {
    entrySessionId: latestSession.entrySessionId,
    ...(blueprintId === undefined ? {} : { blueprintId }),
    ...(runId === undefined ? {} : { runId }),
    ...(objective.length === 0 ? {} : { lastObjective: objective }),
    pendingApprovalAssignmentIds: dedupeStrings(pendingApprovalAssignmentIds),
  };
}

export function formatDirectorConfirmationReply(
  result: DirectorRunConfirmationResult,
  options: { readonly supplementMerged?: boolean } = {},
): string {
  const summary = result.status?.report?.operatorSurface?.operatorSummary;
  if (summary !== undefined && summary.trim().length > 0) {
    return stripProcessLanguage(summary.trim());
  }
  if (options.supplementMerged) {
    return "已按你的补充继续整理。";
  }
  return "已继续处理。";
}

export function formatDirectorGatewayReply(result: DirectorGatewayResult): string {
  const objective = cleanObjective(
    result.intake.intake?.alignmentLock?.objective ??
      result.intake.turn?.summary ??
      "已创建入口任务",
  );
  const warnings = [
    ...(result.blueprint?.blueprint?.review?.requiredFixes ?? []),
    ...(result.blueprint?.blueprint?.preview?.warnings ?? []),
  ];
  const readableWarnings = dedupeStrings(warnings.map(translateWarning).filter(Boolean));
  const lines: string[] = [`制作入口已记录：${objective}`];
  if (readableWarnings.length > 0) {
    lines.push("还缺：");
    for (const warning of readableWarnings.slice(0, 3)) {
      lines.push(`- ${warning}`);
    }
  }
  if (readableWarnings.length === 0) {
    lines.push("等待模型或执行端生成结果；不会用本地模板冒充成品。");
  }
  return lines.join("\n");
}

function stripProcessLanguage(value: string): string {
  return value
    .replace(/\bRun[:：]?\s*[\w.-]+/giu, "")
    .replace(/蓝图[:：]?\s*[\w.-]+/giu, "")
    .replace(/assignment-[\w-]+/giu, "")
    .replace(/\s*needs operator review before execution handoff\.?/giu, "")
    .replace(
      /\s*Review recalled run [\w-]+ before changing continuity-sensitive decisions\.?/giu,
      "",
    )
    .replace(
      /\s*Review published knowledge pack [\w.-]+ before changing continuity-sensitive decisions\.?/giu,
      "",
    )
    .replace(/\s*Recall matched \d+ prior run\(s\)[^.。]*[.。]?/giu, "")
    .replace(/\s*Published knowledge matched \d+ pack\(s\)[^.。]*[.。]?/giu, "")
    .replace(/\s*Matched \d+ approved Skill\(s\)[^.。]*[.。]?/giu, "")
    .replace(/本地预览|自动批准|待审环节|执行环节|worker/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function cleanObjective(value: string): string {
  const cleaned = value
    .replace(/^\/(?:制作|生产|创建|生成)\s*/u, "")
    .replace(/\s+needs operator review before execution handoff\.?$/iu, "")
    .trim();
  return cleaned.split(/\n(?:补充内容|执行意图|安全边界)[:：]/u)[0]?.trim() ?? cleaned;
}

function collectPendingApprovalAssignmentIds(run: ExecutionRunShape | undefined): string[] {
  return (run?.assignments ?? [])
    .filter(
      (assignment) =>
        assignment.approvalMode === "operator_approve" &&
        assignment.status === "pending" &&
        assignment.assignmentId !== undefined &&
        assignment.assignmentId.length > 0,
    )
    .map((assignment) => assignment.assignmentId ?? "");
}

function collectPendingApprovalAssignmentIdsFromBlueprint(
  blueprint: EntryBlueprintPayloadShape["blueprint"] | undefined,
): string[] {
  return (blueprint?.actionGraph?.nodes ?? [])
    .filter(
      (node) =>
        node.approvalMode === "operator_approve" &&
        node.assignmentId !== undefined &&
        node.assignmentId.length > 0,
    )
    .map((node) => node.assignmentId ?? "");
}

function shortId(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function translateStatus(status: string): string {
  const map: Record<string, string> = {
    created: "已创建",
    running: "运行中",
    pending: "待处理",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    aborted: "已中止",
    ready_for_blueprint: "可创建蓝图",
    ready_for_run: "可创建运行",
    run_in_progress: "运行中",
    wait: "等待",
  };
  return map[status] ?? status;
}

function translateAction(action: string): string {
  const map: Record<string, string> = {
    await_input: "等待输入",
    clarify: "需要澄清",
    blueprint: "创建蓝图",
    run: "创建运行",
    wait: "等待执行",
    review_report: "查看报告",
    none: "无",
  };
  return map[action] ?? action;
}

function translateRole(role: string): string {
  const map: Record<string, string> = {
    researcher: "资料研究",
    "script-planner": "剧本规划",
    "shot-planner": "分镜规划",
    "asset-router": "素材/工具路由",
    "qc-reviewer": "质量审查",
  };
  return map[role] ?? role;
}

function translateDeliverable(deliverable: string): string {
  const map: Record<string, string> = {
    "Research brief": "研究简报",
    "Story outline": "故事大纲",
    "Shot plan": "分镜方案",
    "Adapter route receipt": "工具路由记录",
    "Quality gate review": "质量检查",
  };
  return map[deliverable] ?? (deliverable || "待产出");
}

function translateApproval(approvalMode: string): string {
  const map: Record<string, string> = {
    auto_allow: "自动允许",
    operator_approve: "需你批准",
  };
  return map[approvalMode] ?? "";
}

function translateWarning(warning: string): string {
  const normalized = warning.trim();
  if (isInternalProcessWarning(normalized)) {
    return "";
  }
  const map: Record<string, string> = {
    "Add at least one anchor so the director can preserve continuity.":
      "缺少连续性锚点，比如主角、场景、风格或约束；可以补充，也可以确认按默认空设定继续。",
    "Operator approval is required before execution handoff can continue.":
      "进入执行交接前需要你确认。",
  };
  return map[normalized] ?? normalized;
}

function isInternalProcessWarning(value: string): boolean {
  return /(?:needs operator review before execution handoff|Review recalled run|Review published knowledge pack|Recall matched \d+ prior run|Published knowledge matched \d+ pack|Matched \d+ approved Skill)/iu.test(
    value,
  );
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function createOperatorBody(input: {
  readonly actor?: string;
  readonly note?: string;
}): Record<string, string> {
  return {
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

function createMaintenanceBody(input: DirectorMaintenanceInput): Record<string, unknown> {
  return {
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    ...(createMaintenancePolicy(input) === undefined
      ? {}
      : { policy: createMaintenancePolicy(input) }),
  };
}

function createMaintenanceQuery(input: DirectorMaintenanceInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    ...(createMaintenancePolicy(input) ?? {}),
  })) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

function createToolsCatalogQuery(input: DirectorToolsCatalogInput): string {
  const params = new URLSearchParams();
  appendOptionalQueryString(params, "agentId", input.agentId);
  return params.toString();
}

function createToolsEffectiveQuery(input: DirectorToolsEffectiveInput): string {
  const params = new URLSearchParams();
  appendOptionalQueryString(params, "agentId", input.agentId);
  appendOptionalQueryString(params, "sessionKey", input.sessionKey);
  appendOptionalQueryString(params, "profile", input.profile);
  if (input.includeUnavailable !== undefined) {
    params.set("includeUnavailable", input.includeUnavailable ? "true" : "false");
  }
  return params.toString();
}

function appendOptionalQueryString(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
): void {
  if (typeof value === "string" && value.trim().length > 0) {
    params.set(key, value.trim());
  }
}

function createMaintenancePolicy(
  input: DirectorMaintenanceInput,
): Record<string, number> | undefined {
  const policy: Record<string, number> = {};
  for (const key of [
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
    if (input[key] !== undefined) {
      policy[key] = input[key];
    }
  }
  return Object.keys(policy).length === 0 ? undefined : policy;
}

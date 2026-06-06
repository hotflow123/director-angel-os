import type {
  AgentOsAgentToolDelegationRequest,
  AgentOsMemoryLayer,
  AgentOsSubagentEnvelope,
  AgentOsSubagentProfile,
} from "@hotflow/agent-os-kernel-contracts";
import { createAgentToolDelegationEnvelope } from "@hotflow/agent-os-kernel-contracts";
import type {
  ConversationRuntimeModelCallPort,
  ConversationRuntimeModelToolDefinition,
  ConversationRuntimeToolExecutionInput,
  ConversationRuntimeToolExecutionOutput,
  ConversationRuntimeToolExecutorPort,
} from "./model-tool-loop.js";
import { runConversationRuntimeModelToolLoop } from "./model-tool-loop.js";

export const AGENT_DELEGATE_TOOL_NAME = "agent.delegate";
export const RUN_SUBAGENT_TOOL_NAME = "run_subagent";
export const SPAWN_SUBAGENT_TOOL_NAME = "spawn_subagent";

export type AgentDelegateDelegationSpecialization = "explore" | "plan" | "verify" | "general";
export type AgentDelegateDelegationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentDelegateDelegationVerificationRequest {
  readonly verifierId: string;
  readonly requirement: string;
  readonly verificationId?: string;
}

export interface AgentDelegateDelegationRecordInput {
  readonly id: string;
  readonly taskId?: string;
  readonly workerId: string;
  readonly instruction: string;
  readonly fromAgent?: string;
  readonly contextSnapshot?: string;
  readonly specialization?: AgentDelegateDelegationSpecialization;
  readonly targetAgent?: string;
  readonly verificationRequest?: AgentDelegateDelegationVerificationRequest;
  readonly resultSummary?: string;
  readonly status?: AgentDelegateDelegationStatus;
  readonly error?: string;
}

export interface AgentDelegateDelegationRecord extends AgentDelegateDelegationRecordInput {
  readonly status: AgentDelegateDelegationStatus;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly completedAtMs?: number;
}

export interface AgentDelegateVerificationRecord {
  readonly id: string;
  readonly taskId?: string;
  readonly verifierId: string;
  readonly requirement: string;
  readonly status: string;
  readonly verdict?: string;
  readonly verdictSummary?: string;
  readonly checks?: readonly unknown[];
}

export interface AgentDelegateTaskOperationsState {
  readonly schemaVersion: string;
  readonly todos: unknown;
  readonly delegation: readonly AgentDelegateDelegationRecord[];
  readonly verification: readonly AgentDelegateVerificationRecord[];
  readonly proposalQueue?: readonly unknown[];
  readonly proposalOutbox?: readonly unknown[];
  readonly notifications?: readonly unknown[];
  readonly lifecycle?: readonly unknown[];
  readonly updatedAtMs?: number;
}

export interface AgentDelegateTaskBackedSubagentRun {
  readonly subagentId: string;
  readonly parentTurnId: string;
  readonly profileId: string;
  readonly workerId: string;
  readonly taskId?: string;
  readonly status: AgentDelegateDelegationStatus;
  readonly role: AgentDelegateDelegationSpecialization;
  readonly targetAgent?: string;
  readonly isolatedContext: boolean;
  readonly instruction: string;
  readonly contextSnapshot?: string;
  readonly resultSummary?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly completedAtMs?: number;
  readonly error?: string;
  readonly verification?: AgentDelegateVerificationRecord;
  readonly parentVisibleResult: {
    readonly status: AgentDelegateDelegationStatus;
    readonly summary?: string;
    readonly verificationVerdict?: string;
  };
  readonly scheduling?: AgentDelegateSubagentScheduling;
}

export interface AgentDelegateSubagentScheduling {
  readonly parallelGroup?: string;
  readonly writeSet: readonly string[];
  readonly writeSetSource?: "explicit" | "inferred";
  readonly canRunInParallel: boolean;
  readonly conflictsWith: readonly string[];
  readonly conflictReason?: string;
  readonly parallelBatch: number;
  readonly scheduleOrder: number;
  readonly readyToStart: boolean;
  readonly blockedBy: readonly string[];
}

export interface AgentDelegateTaskPlanePort {
  status?(): Promise<AgentDelegateTaskOperationsState>;
  enqueueDelegation(
    input: AgentDelegateDelegationRecordInput,
  ): Promise<AgentDelegateTaskOperationsState>;
}

export interface CreateAgentDelegateTaskBackedToolExecutorOptions {
  readonly parentEnvelope: AgentOsSubagentEnvelope;
  readonly profiles: readonly AgentOsSubagentProfile[];
  readonly taskPlane: AgentDelegateTaskPlanePort;
  readonly nowMs?: () => number;
  readonly nowIso?: () => string;
  readonly defaultProfileId?: string;
  readonly parentAgentId?: string;
  readonly taskId?: string;
}

export interface SpawnSubagentRequester {
  readonly requesterSessionKey: string;
  readonly requesterOrigin: string;
  readonly deliveryTarget?: string;
  readonly topLevelRequester?: boolean;
  readonly parentSubagentId?: string;
}

export interface CreateSpawnSubagentTaskBackedToolExecutorOptions
  extends CreateAgentDelegateTaskBackedToolExecutorOptions {
  readonly requester: SpawnSubagentRequester;
}

export interface CreateRunSubagentSynchronousToolExecutorOptions
  extends Pick<
    CreateAgentDelegateTaskBackedToolExecutorOptions,
    | "parentEnvelope"
    | "profiles"
    | "nowMs"
    | "nowIso"
    | "defaultProfileId"
    | "parentAgentId"
    | "taskId"
  > {
  readonly parentTools?: readonly ConversationRuntimeModelToolDefinition[];
  readonly callSubagentModel: ConversationRuntimeModelCallPort;
  readonly executeSubagentTool: ConversationRuntimeToolExecutorPort;
}

export function createAgentDelegateModelTool(): ConversationRuntimeModelToolDefinition {
  return {
    name: AGENT_DELEGATE_TOOL_NAME,
    description:
      "Delegate a bounded research, planning, implementation, or verification task to an isolated Agent OS subagent. The call only enqueues task-plane work for a worker and never starts a local process by itself.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        profileId: {
          type: "string",
          description:
            "Subagent profile id to use, such as researcher, planner, implementer, or verifier.",
        },
        task: {
          type: "string",
          description: "Single bounded task for the child agent.",
        },
        expectedOutput: {
          type: "string",
          description: "What the parent agent expects back before continuing.",
        },
        allowedTools: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of the selected profile tools allowed for this child.",
        },
        allowedPermissions: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional subset of the selected profile permissions allowed for this child.",
        },
        writableRoots: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of writable roots allowed for this child.",
        },
        memoryLayers: {
          type: "array",
          items: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
          description: "Optional subset of memory layers allowed for this child.",
        },
        maxTurns: {
          type: "integer",
          description:
            "Optional child-agent turn cap; cannot exceed the selected profile or parent envelope.",
        },
        workerId: {
          type: "string",
          description:
            "Optional explicit worker mailbox id. When provided, it must match the selected profileId.",
        },
        specialization: {
          type: "string",
          enum: ["explore", "plan", "verify", "general"],
          description: "Optional task-plane specialization.",
        },
        verification: {
          type: "object",
          properties: {
            verifierId: { type: "string" },
            requirement: { type: "string" },
            verificationId: { type: "string" },
          },
          required: ["verifierId", "requirement"],
          additionalProperties: false,
        },
        parallelGroup: {
          type: "string",
          description:
            "Optional scheduling group used to show independent subagent workstreams in the parent task plane.",
        },
        writeSet: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional explicit files or workspace resources this child may write; overlapping active write sets are blocked before enqueue.",
        },
      },
      required: ["task", "expectedOutput"],
      additionalProperties: false,
    },
    metadata: {
      source: "agent-os",
      agentTool: true,
      taskBacked: true,
      capability: "agent.subagent.delegate",
      reviewGated: true,
      risk: "subagent-delegation",
    },
  };
}

export function createSpawnSubagentModelTool(): ConversationRuntimeModelToolDefinition {
  return {
    name: SPAWN_SUBAGENT_TOOL_NAME,
    description:
      "Start a long-running background Agent OS subagent without blocking the current conversation. Returns accepted immediately; completion must be announced later through the task runtime.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        profileId: {
          type: "string",
          description:
            "Background subagent profile id to use, such as researcher, planner, implementer, or verifier.",
        },
        task: {
          type: "string",
          description: "Single bounded background task for the child agent.",
        },
        expectedOutput: {
          type: "string",
          description: "What should be announced back when the background subagent completes.",
        },
        allowedTools: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of the selected profile tools allowed for this child.",
        },
        allowedPermissions: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional subset of the selected profile permissions allowed for this child.",
        },
        writableRoots: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of writable roots allowed for this child.",
        },
        memoryLayers: {
          type: "array",
          items: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
          description: "Optional subset of memory layers allowed for this child.",
        },
        maxTurns: {
          type: "integer",
          description:
            "Optional child-agent turn cap; cannot exceed the selected profile or parent envelope.",
        },
        workerId: {
          type: "string",
          description:
            "Optional explicit worker mailbox id. When provided, it must match the selected profileId.",
        },
        specialization: {
          type: "string",
          enum: ["explore", "plan", "verify", "general"],
          description: "Optional task-plane specialization.",
        },
        parallelGroup: {
          type: "string",
          description: "Optional scheduling group for independent background workstreams.",
        },
        writeSet: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional explicit files or workspace resources this child may write; overlapping active write sets are blocked before enqueue.",
        },
      },
      required: ["task", "expectedOutput"],
      additionalProperties: false,
    },
    metadata: {
      source: "agent-os",
      agentTool: true,
      asyncSubagent: true,
      taskBacked: true,
      capability: "agent.subagent.spawn",
      reviewGated: true,
      risk: "background-subagent",
    },
  };
}

export function createRunSubagentModelTool(): ConversationRuntimeModelToolDefinition {
  return {
    name: RUN_SUBAGENT_TOOL_NAME,
    description:
      "Run a short isolated Agent OS subagent synchronously and return only its final parent-visible summary. Use for bounded research, planning, or verification that the current turn must wait for.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        profileId: {
          type: "string",
          description:
            "Subagent profile id to use, such as researcher, planner, implementer, or verifier.",
        },
        task: {
          type: "string",
          description: "Single bounded task for the short child agent.",
        },
        expectedOutput: {
          type: "string",
          description: "What final summary the parent agent expects back.",
        },
        allowedTools: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional subset of this child profile's tools. The runtime also intersects it with parent-visible tools.",
        },
        allowedPermissions: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of permissions allowed for this child.",
        },
        writableRoots: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of writable roots allowed for this child.",
        },
        memoryLayers: {
          type: "array",
          items: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
          description: "Optional subset of memory layers allowed for this child.",
        },
        maxTurns: {
          type: "integer",
          description:
            "Optional child-agent turn cap; cannot exceed the selected profile or parent envelope.",
        },
      },
      required: ["task", "expectedOutput"],
      additionalProperties: false,
    },
    metadata: {
      source: "agent-os",
      agentTool: true,
      syncSubagent: true,
      taskBacked: false,
      capability: "agent.subagent.run",
      risk: "sync-subagent",
    },
  };
}

export function createAgentDelegateTaskBackedToolExecutor(
  options: CreateAgentDelegateTaskBackedToolExecutorOptions,
): ConversationRuntimeToolExecutorPort {
  const profilesById = new Map(options.profiles.map((profile) => [profile.profileId, profile]));
  return async (
    input: ConversationRuntimeToolExecutionInput,
  ): Promise<ConversationRuntimeToolExecutionOutput> => {
    if (input.call.name !== AGENT_DELEGATE_TOOL_NAME) {
      return createAgentDelegateErrorResult(input, {
        error: "agent-delegate-unsupported-tool",
        message: `${AGENT_DELEGATE_TOOL_NAME} executor cannot run ${input.call.name}.`,
      });
    }

    try {
      const profile = selectAgentDelegateProfile(input.call.args, profilesById, options);
      if (profile === undefined) {
        return createAgentDelegateErrorResult(input, {
          error: "agent-delegate-profile-unavailable",
          message: "No matching Agent OS subagent profile is available for this delegation.",
        });
      }

      const now = options.nowIso?.() ?? new Date().toISOString();
      const request = createAgentDelegateRequest(input, profile);
      const envelope = createAgentToolDelegationEnvelope({
        parent: {
          ...options.parentEnvelope,
          parentTurnId: input.turnId,
        },
        profile,
        request,
        now,
      });
      const delegation = createTaskBackedDelegationRecord({
        input,
        envelope,
        profile,
        options,
      });
      const conflict = await detectAgentDelegateWriteSetConflict({
        input,
        taskPlane: options.taskPlane,
        delegation,
        nowMs: options.nowMs?.() ?? Date.now(),
      });
      if (conflict !== undefined) {
        return createAgentDelegateErrorResult(input, {
          error: "agent-delegate-write-set-conflict",
          message: `${conflict.conflictReason}; conflicts_with=${conflict.conflictsWith.join(", ")}`,
          blocked: true,
        });
      }
      const state = await options.taskPlane.enqueueDelegation(delegation);
      const subagentRun = projectAgentDelegateSubagentRunForDelegation({
        state,
        delegation,
        parentTurnId: input.turnId,
        nowMs: options.nowMs?.() ?? Date.now(),
      });

      return {
        callId: input.call.id,
        toolName: input.call.name,
        ok: true,
        content: [
          "status: queued",
          `summary: Agent OS subagent ${delegation.id} was queued for worker ${delegation.workerId}.`,
          `subagent_id: ${delegation.id}`,
          `profile_id: ${profile.profileId}`,
          `worker_id: ${delegation.workerId}`,
          `role: ${delegation.specialization ?? "general"}`,
          "next_actions: Wait for worker-jobs run-delegation or the task runtime to complete the child run; do not claim the delegated work is finished yet.",
        ].join("\n"),
        output: {
          envelope,
          delegation,
          ...(subagentRun === undefined ? {} : { subagentRun }),
        },
        metadata: {
          source: "agent-os",
          agentTool: true,
          taskBacked: true,
          parentTurnId: input.turnId,
          delegationId: delegation.id,
          profileId: profile.profileId,
          workerId: delegation.workerId,
          ...(subagentRun === undefined ? {} : { subagentRun }),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createAgentDelegateErrorResult(input, {
        error: resolveAgentDelegateErrorCode(message),
        message,
        blocked: true,
      });
    }
  };
}

export function createSpawnSubagentTaskBackedToolExecutor(
  options: CreateSpawnSubagentTaskBackedToolExecutorOptions,
): ConversationRuntimeToolExecutorPort {
  const profilesById = new Map(options.profiles.map((profile) => [profile.profileId, profile]));
  return async (
    input: ConversationRuntimeToolExecutionInput,
  ): Promise<ConversationRuntimeToolExecutionOutput> => {
    if (input.call.name !== SPAWN_SUBAGENT_TOOL_NAME) {
      return createAgentDelegateErrorResult(input, {
        error: "spawn-subagent-unsupported-tool",
        message: `${SPAWN_SUBAGENT_TOOL_NAME} executor cannot run ${input.call.name}.`,
      });
    }

    try {
      const profile = selectAgentDelegateProfile(input.call.args, profilesById, options);
      if (profile === undefined) {
        return createAgentDelegateErrorResult(input, {
          error: "spawn-subagent-profile-unavailable",
          message: "No matching Agent OS subagent profile is available for this background task.",
        });
      }

      const now = options.nowIso?.() ?? new Date().toISOString();
      const request = createAgentDelegateRequest(input, profile);
      const envelope = createAgentToolDelegationEnvelope({
        parent: {
          ...options.parentEnvelope,
          parentTurnId: input.turnId,
        },
        profile,
        request,
        now,
      });
      const childSessionKey = createSpawnSubagentChildSessionKey(envelope.subagentId);
      const topLevelRequester = options.requester.topLevelRequester !== false;
      const delegation = createTaskBackedDelegationRecord({
        input,
        envelope,
        profile,
        options,
        toolName: SPAWN_SUBAGENT_TOOL_NAME,
        contextExtras: {
          requesterSessionKey: options.requester.requesterSessionKey,
          requesterOrigin: options.requester.requesterOrigin,
          deliveryTarget: options.requester.deliveryTarget,
          parentSubagentId: options.requester.parentSubagentId,
          childSessionKey,
          announceMode: "task-notification",
          topLevelRequester: String(topLevelRequester),
        },
        resultSummary: topLevelRequester
          ? `Accepted background Agent OS subagent ${envelope.subagentId}; completion will be announced to ${options.requester.requesterSessionKey}.`
          : `Accepted nested background Agent OS subagent ${envelope.subagentId}; completion will be returned to parent ${options.requester.requesterSessionKey}.`,
      });
      const conflict = await detectAgentDelegateWriteSetConflict({
        input,
        taskPlane: options.taskPlane,
        delegation,
        nowMs: options.nowMs?.() ?? Date.now(),
      });
      if (conflict !== undefined) {
        return createAgentDelegateErrorResult(input, {
          error: "spawn-subagent-write-set-conflict",
          message: `${conflict.conflictReason}; conflicts_with=${conflict.conflictsWith.join(", ")}`,
          blocked: true,
        });
      }

      const state = await options.taskPlane.enqueueDelegation(delegation);
      const subagentRun = projectAgentDelegateSubagentRunForDelegation({
        state,
        delegation,
        parentTurnId: input.turnId,
        nowMs: options.nowMs?.() ?? Date.now(),
      });

      return {
        callId: input.call.id,
        toolName: input.call.name,
        ok: true,
        content: [
          "status: accepted",
          `summary: Background Agent OS subagent ${delegation.id} accepted for worker ${delegation.workerId}.`,
          `subagent_id: ${delegation.id}`,
          `child_session_key: ${childSessionKey}`,
          `requester_session_key: ${options.requester.requesterSessionKey}`,
          `requester_origin: ${options.requester.requesterOrigin}`,
          topLevelRequester
            ? "next_actions: Continue the main conversation now; do not wait for this child. Its final result will arrive as a task notification."
            : "next_actions: Continue the parent agent now; do not wait for this child. Its final result is reserved for the direct parent agent.",
        ].join("\n"),
        output: {
          envelope,
          delegation,
          childSessionKey,
          requester: options.requester,
          ...(subagentRun === undefined ? {} : { subagentRun }),
        },
        metadata: {
          source: "agent-os",
          agentTool: true,
          asyncSubagent: true,
          taskBacked: true,
          parentTurnId: input.turnId,
          delegationId: delegation.id,
          profileId: profile.profileId,
          workerId: delegation.workerId,
          childSessionKey,
          requesterSessionKey: options.requester.requesterSessionKey,
          requesterOrigin: options.requester.requesterOrigin,
          topLevelRequester,
          ...(options.requester.parentSubagentId === undefined
            ? {}
            : { parentSubagentId: options.requester.parentSubagentId }),
          ...(options.requester.deliveryTarget === undefined
            ? {}
            : { deliveryTarget: options.requester.deliveryTarget }),
          ...(subagentRun === undefined ? {} : { subagentRun }),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createAgentDelegateErrorResult(input, {
        error: resolveSpawnSubagentErrorCode(message),
        message,
        blocked: true,
      });
    }
  };
}

export function createRunSubagentSynchronousToolExecutor(
  options: CreateRunSubagentSynchronousToolExecutorOptions,
): ConversationRuntimeToolExecutorPort {
  const profilesById = new Map(options.profiles.map((profile) => [profile.profileId, profile]));
  return async (
    input: ConversationRuntimeToolExecutionInput,
  ): Promise<ConversationRuntimeToolExecutionOutput> => {
    if (input.call.name !== RUN_SUBAGENT_TOOL_NAME) {
      return createAgentDelegateErrorResult(input, {
        error: "run-subagent-unsupported-tool",
        message: `${RUN_SUBAGENT_TOOL_NAME} executor cannot run ${input.call.name}.`,
      });
    }

    try {
      const profile = selectAgentDelegateProfile(input.call.args, profilesById, options);
      if (profile === undefined) {
        return createAgentDelegateErrorResult(input, {
          error: "run-subagent-profile-unavailable",
          message: "No matching Agent OS subagent profile is available for this short task.",
        });
      }
      const now = options.nowIso?.() ?? new Date().toISOString();
      const request = createAgentDelegateRequest(input, profile);
      const envelope = createAgentToolDelegationEnvelope({
        parent: {
          ...options.parentEnvelope,
          parentTurnId: input.turnId,
        },
        profile,
        request,
        now,
      });
      const childTurnId = `${input.turnId}:subagent:${envelope.subagentId}`;
      const childSessionKey = createSpawnSubagentChildSessionKey(envelope.subagentId);
      const childTools = resolveRunSubagentTools({
        callArgs: input.call.args,
        profile,
        ...(options.parentTools === undefined ? {} : { parentTools: options.parentTools }),
      });
      const childMaxTurns = resolveRunSubagentMaxTurns(input.call.args, profile);
      const childResult = await runConversationRuntimeModelToolLoop({
        turnId: childTurnId,
        sessionKey: childSessionKey,
        messages: [
          {
            role: "system",
            content: [
              profile.instructions,
              "Return only the final result needed by the parent agent.",
              "Do not expose intermediate tool logs unless the parent explicitly asked for them.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [`Task: ${request.task}`, `Expected output: ${request.expectedOutput}`].join(
              "\n",
            ),
          },
        ],
        tools: childTools,
        maxTurns: childMaxTurns,
        ...(input.signal === undefined ? {} : { abortSignal: input.signal }),
        metadata: {
          source: "agent-os",
          syncSubagent: true,
          parentTurnId: input.turnId,
          parentSessionKey: input.sessionKey,
          subagentId: envelope.subagentId,
          profileId: profile.profileId,
        },
        callModel: options.callSubagentModel,
        executeTool: async (toolInput) =>
          options.executeSubagentTool({
            ...toolInput,
            turnId: childTurnId,
            sessionKey: childSessionKey,
          }),
      });
      const finalSummary = childResult.finalText?.trim();
      if (finalSummary === undefined || finalSummary.length === 0) {
        return createAgentDelegateErrorResult(input, {
          error: `run-subagent-${childResult.stoppedReason ?? "no-final-summary"}`,
          message: `Synchronous subagent ${envelope.subagentId} ended without a final summary.`,
          blocked: true,
        });
      }
      const completedAtMs = options.nowMs?.() ?? Date.now();
      const subagentRun: AgentDelegateTaskBackedSubagentRun = {
        subagentId: envelope.subagentId,
        parentTurnId: input.turnId,
        profileId: profile.profileId,
        workerId: profile.profileId,
        status: "completed",
        role: inferDelegationSpecialization(profile.role),
        targetAgent: profile.profileId,
        isolatedContext: envelope.isolatedContext !== false,
        instruction: request.task,
        contextSnapshot: createAgentDelegateContextSnapshot({
          turnId: input.turnId,
          sessionKey: input.sessionKey,
          envelope,
          profile,
          writableRoots: envelope.writableRoots,
          extras: {
            childSessionKey,
            executionMode: "sync",
          },
        }),
        resultSummary: finalSummary,
        createdAtMs: completedAtMs,
        updatedAtMs: completedAtMs,
        completedAtMs,
        parentVisibleResult: {
          status: "completed",
          summary: finalSummary,
        },
      };

      return {
        callId: input.call.id,
        toolName: input.call.name,
        ok: true,
        content: finalSummary,
        output: {
          envelope,
          subagentRun,
          childSessionKey,
          childStoppedReason: childResult.stoppedReason ?? null,
        },
        metadata: {
          source: "agent-os",
          agentTool: true,
          syncSubagent: true,
          parentTurnId: input.turnId,
          subagentId: envelope.subagentId,
          profileId: profile.profileId,
          childSessionKey,
          childTurnId,
          childToolCount: childTools.length,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createAgentDelegateErrorResult(input, {
        error: resolveRunSubagentErrorCode(message),
        message,
        blocked: true,
      });
    }
  };
}

function selectAgentDelegateProfile(
  args: Readonly<Record<string, unknown>>,
  profilesById: ReadonlyMap<string, AgentOsSubagentProfile>,
  options: Pick<CreateAgentDelegateTaskBackedToolExecutorOptions, "profiles" | "defaultProfileId">,
): AgentOsSubagentProfile | undefined {
  const profileId =
    readStringArg(args, "profileId") ?? options.defaultProfileId ?? options.profiles[0]?.profileId;
  return profileId === undefined ? undefined : profilesById.get(profileId);
}

function createAgentDelegateRequest(
  input: ConversationRuntimeToolExecutionInput,
  profile: AgentOsSubagentProfile,
): AgentOsAgentToolDelegationRequest {
  const task = readRequiredStringArg(input.call.args, "task");
  const expectedOutput = readRequiredStringArg(input.call.args, "expectedOutput");
  const maxTurns = readPositiveIntegerArg(input.call.args, "maxTurns");
  const allowedTools = readStringArrayArg(input.call.args, "allowedTools");
  const allowedPermissions = readStringArrayArg(input.call.args, "allowedPermissions");
  const writableRoots = readStringArrayArg(input.call.args, "writableRoots");
  const memoryLayers = readMemoryLayersArg(input.call.args, "memoryLayers");
  const artifactsRequested = readStringArrayArg(input.call.args, "artifactsRequested");
  const request: AgentOsAgentToolDelegationRequest = {
    requestId: input.call.id,
    parentTurnId: input.turnId,
    task,
    expectedOutput,
    ...(allowedTools === undefined ? {} : { allowedTools }),
    ...(allowedPermissions === undefined ? {} : { allowedPermissions }),
    ...(writableRoots === undefined ? {} : { writableRoots }),
    ...(memoryLayers === undefined ? {} : { memoryLayers }),
    ...(maxTurns === undefined ? {} : { maxTurns: Math.min(maxTurns, profile.maxTurns) }),
    ...(artifactsRequested === undefined ? {} : { artifactsRequested }),
  };
  return request;
}

function createTaskBackedDelegationRecord(input: {
  readonly input: ConversationRuntimeToolExecutionInput;
  readonly envelope: AgentOsSubagentEnvelope;
  readonly profile: AgentOsSubagentProfile;
  readonly options: CreateAgentDelegateTaskBackedToolExecutorOptions;
  readonly toolName?: string;
  readonly contextExtras?: Readonly<Record<string, string | undefined>>;
  readonly resultSummary?: string;
}): AgentDelegateDelegationRecordInput {
  const nowMs = input.options.nowMs?.() ?? Date.now();
  const workerId = resolveAgentDelegateWorkerId(input.input.call.args, input.profile);
  const specialization =
    readDelegationSpecializationArg(input.input.call.args, "specialization") ??
    inferDelegationSpecialization(input.profile.role);
  const verification = readDelegationVerification(input.input.call.args);
  const parallelGroup = readStringArg(input.input.call.args, "parallelGroup");
  const writeSet = readStringArrayArg(input.input.call.args, "writeSet");
  return {
    id: input.envelope.subagentId,
    ...(input.options.taskId === undefined ? {} : { taskId: input.options.taskId }),
    workerId,
    instruction: input.envelope.task ?? readRequiredStringArg(input.input.call.args, "task"),
    fromAgent: input.options.parentAgentId ?? input.toolName ?? AGENT_DELEGATE_TOOL_NAME,
    contextSnapshot: createAgentDelegateContextSnapshot({
      turnId: input.input.turnId,
      sessionKey: input.input.sessionKey,
      envelope: input.envelope,
      profile: input.profile,
      ...(parallelGroup === undefined ? {} : { parallelGroup }),
      ...(writeSet === undefined ? {} : { writeSet }),
      writableRoots: input.envelope.writableRoots,
      ...(input.contextExtras === undefined ? {} : { extras: input.contextExtras }),
    }),
    specialization,
    targetAgent: input.profile.profileId,
    status: "queued",
    ...(verification === undefined ? {} : { verificationRequest: verification }),
    resultSummary:
      input.resultSummary ?? `Queued Agent OS subagent ${input.envelope.subagentId} at ${nowMs}.`,
  };
}

function createAgentDelegateContextSnapshot(input: {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly envelope: AgentOsSubagentEnvelope;
  readonly profile: AgentOsSubagentProfile;
  readonly parallelGroup?: string;
  readonly writeSet?: readonly string[];
  readonly writableRoots?: readonly string[];
  readonly extras?: Readonly<Record<string, string | undefined>>;
}): string {
  const extraParts = Object.entries(input.extras ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].length > 0)
    .map(([key, value]) => `${key}=${value}`);
  return [
    `parentTurnId=${input.turnId}`,
    `sessionKey=${input.sessionKey}`,
    `delegationRequestId=${input.envelope.delegationRequestId ?? ""}`,
    `profileId=${input.profile.profileId}`,
    `isolatedContext=${String(input.envelope.isolatedContext !== false)}`,
    `tools=${input.envelope.tools.join(",")}`,
    `permissions=${input.envelope.permissions.join(",")}`,
    `memoryLayers=${input.envelope.memoryLayers.join(",")}`,
    `maxTurns=${input.envelope.maxTurns}`,
    input.parallelGroup === undefined ? null : `parallelGroup=${input.parallelGroup}`,
    input.writeSet === undefined ? null : `writeSet=${input.writeSet.join(",")}`,
    input.writableRoots === undefined ? null : `writableRoots=${input.writableRoots.join(",")}`,
    ...extraParts,
  ]
    .filter((part): part is string => part !== null)
    .join(";");
}

function resolveAgentDelegateWorkerId(
  args: Readonly<Record<string, unknown>>,
  profile: AgentOsSubagentProfile,
): string {
  const workerId = readStringArg(args, "workerId");
  if (workerId === undefined) {
    return profile.profileId;
  }
  if (workerId !== profile.profileId) {
    throw new Error(
      `agent.delegate cannot target worker ${workerId} outside selected profile ${profile.profileId}`,
    );
  }
  return workerId;
}

function resolveAgentDelegateErrorCode(message: string): string {
  if (message.includes("Subagent scope escalation blocked")) {
    return "agent-delegate-scope-escalation";
  }
  if (message.includes("cannot target worker")) {
    return "agent-delegate-worker-route-blocked";
  }
  if (message.includes("write-set-overlap")) {
    return "agent-delegate-write-set-conflict";
  }
  return "agent-delegate-invalid-request";
}

function resolveSpawnSubagentErrorCode(message: string): string {
  if (message.includes("Subagent scope escalation blocked")) {
    return "spawn-subagent-scope-escalation";
  }
  if (message.includes("cannot target worker")) {
    return "spawn-subagent-worker-route-blocked";
  }
  if (message.includes("write-set-overlap")) {
    return "spawn-subagent-write-set-conflict";
  }
  return "spawn-subagent-invalid-request";
}

function resolveRunSubagentErrorCode(message: string): string {
  if (message.includes("Subagent scope escalation blocked")) {
    return "run-subagent-scope-escalation";
  }
  if (message.includes("cannot use tool")) {
    return "run-subagent-tool-scope-blocked";
  }
  return "run-subagent-invalid-request";
}

function createSpawnSubagentChildSessionKey(subagentId: string): string {
  return `subagent:${subagentId}`;
}

function resolveRunSubagentMaxTurns(
  args: Readonly<Record<string, unknown>>,
  profile: AgentOsSubagentProfile,
): number {
  const requested = readPositiveIntegerArg(args, "maxTurns");
  return requested === undefined ? profile.maxTurns : Math.min(requested, profile.maxTurns);
}

function resolveRunSubagentTools(input: {
  readonly callArgs: Readonly<Record<string, unknown>>;
  readonly profile: AgentOsSubagentProfile;
  readonly parentTools?: readonly ConversationRuntimeModelToolDefinition[];
}): readonly ConversationRuntimeModelToolDefinition[] {
  const profileToolNames = new Set(input.profile.tools);
  const parentToolsByName =
    input.parentTools === undefined
      ? undefined
      : new Map(input.parentTools.map((tool) => [tool.name, tool]));
  const requestedToolNames = readStringArrayArg(input.callArgs, "allowedTools");
  const selectedNames = requestedToolNames ?? input.profile.tools;
  const tools: ConversationRuntimeModelToolDefinition[] = [];

  for (const toolName of selectedNames) {
    if (!profileToolNames.has(toolName)) {
      throw new Error(`run_subagent cannot use tool ${toolName} outside selected profile.`);
    }
    const parentTool = parentToolsByName?.get(toolName);
    if (parentToolsByName !== undefined && parentTool === undefined) {
      throw new Error(`run_subagent cannot use tool ${toolName} outside parent tool set.`);
    }
    tools.push(
      parentTool ?? {
        name: toolName,
        description: `Parent-approved subagent tool: ${toolName}`,
        readOnly: true,
        metadata: {
          source: "agent-os",
          subagentTool: true,
        },
      },
    );
  }

  return mergeUniqueRunSubagentTools(tools);
}

function mergeUniqueRunSubagentTools(
  tools: readonly ConversationRuntimeModelToolDefinition[],
): readonly ConversationRuntimeModelToolDefinition[] {
  const seen = new Set<string>();
  const result: ConversationRuntimeModelToolDefinition[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      continue;
    }
    seen.add(tool.name);
    result.push(tool);
  }
  return result;
}

function readDelegationVerification(
  args: Readonly<Record<string, unknown>>,
): AgentDelegateDelegationRecordInput["verificationRequest"] | undefined {
  const value = args.verification;
  if (!isRecord(value)) {
    return undefined;
  }
  const verifierId = readStringArg(value, "verifierId");
  const requirement = readStringArg(value, "requirement");
  if (verifierId === undefined || requirement === undefined) {
    return undefined;
  }
  const verificationId = readStringArg(value, "verificationId");
  return {
    verifierId,
    requirement,
    ...(verificationId === undefined ? {} : { verificationId }),
  };
}

function inferDelegationSpecialization(role: string): AgentDelegateDelegationSpecialization {
  const normalized = role.toLowerCase();
  if (normalized.includes("verify") || normalized.includes("review")) {
    return "verify";
  }
  if (normalized.includes("plan") || normalized.includes("design")) {
    return "plan";
  }
  if (normalized.includes("research") || normalized.includes("explore")) {
    return "explore";
  }
  return "general";
}

function readDelegationSpecializationArg(
  args: Readonly<Record<string, unknown>>,
  key: string,
): AgentDelegateDelegationSpecialization | undefined {
  const value = readStringArg(args, key);
  return value === "explore" || value === "plan" || value === "verify" || value === "general"
    ? value
    : undefined;
}

function readRequiredStringArg(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = readStringArg(args, key);
  if (value === undefined) {
    throw new Error(`agent.delegate requires ${key}`);
  }
  return value;
}

function readStringArg(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArrayArg(
  args: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  const value = args[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return strings.length === 0 ? undefined : [...new Set(strings)];
}

function readMemoryLayersArg(
  args: Readonly<Record<string, unknown>>,
  key: string,
): readonly AgentOsMemoryLayer[] | undefined {
  const values = readStringArrayArg(args, key);
  if (values === undefined) {
    return undefined;
  }
  const layers = values.filter(isAgentOsMemoryLayer);
  if (layers.length !== values.length) {
    throw new Error("agent.delegate memoryLayers may only include L0, L1, L2, or L3");
  }
  return layers;
}

function readPositiveIntegerArg(
  args: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const integer = Math.trunc(value);
  return integer > 0 ? integer : undefined;
}

function createAgentDelegateErrorResult(
  input: ConversationRuntimeToolExecutionInput,
  error: { readonly error: string; readonly message: string; readonly blocked?: boolean },
): ConversationRuntimeToolExecutionOutput {
  return {
    callId: input.call.id,
    toolName: input.call.name,
    ok: false,
    content: [
      "status: blocked",
      `summary: ${error.message}`,
      "next_actions: Use a narrower subagent profile, fewer tools/permissions, or configure a task-plane backed AgentTool executor.",
    ].join("\n"),
    error: error.error,
    metadata: {
      source: "agent-os",
      agentTool: true,
      taskBacked: true,
      blocked: error.blocked === true,
    },
  };
}

function isAgentOsMemoryLayer(value: string): value is AgentOsMemoryLayer {
  return value === "L0" || value === "L1" || value === "L2" || value === "L3";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectAgentDelegateSubagentRunForDelegation(input: {
  readonly state: AgentDelegateTaskOperationsState;
  readonly delegation: AgentDelegateDelegationRecordInput;
  readonly parentTurnId: string;
  readonly nowMs: number;
}): AgentDelegateTaskBackedSubagentRun | undefined {
  const projected = projectAgentDelegateSubagentRunsFromTaskState(input.state, {
    parentTurnId: input.parentTurnId,
  }).find((run) => run.subagentId === input.delegation.id);
  if (projected !== undefined) {
    return projected;
  }

  const fallbackRecord = createAgentDelegateFallbackDelegationRecord({
    delegation: input.delegation,
    nowMs: input.nowMs,
  });
  return projectAgentDelegateSubagentRunsFromTaskState(
    {
      ...input.state,
      delegation: [fallbackRecord],
    },
    { parentTurnId: input.parentTurnId },
  )[0];
}

function createAgentDelegateFallbackDelegationRecord(input: {
  readonly delegation: AgentDelegateDelegationRecordInput;
  readonly nowMs: number;
}): AgentDelegateDelegationRecord {
  return {
    id: input.delegation.id,
    workerId: input.delegation.workerId,
    instruction: input.delegation.instruction,
    status: input.delegation.status ?? "queued",
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    ...(input.delegation.taskId === undefined ? {} : { taskId: input.delegation.taskId }),
    ...(input.delegation.fromAgent === undefined ? {} : { fromAgent: input.delegation.fromAgent }),
    ...(input.delegation.contextSnapshot === undefined
      ? {}
      : { contextSnapshot: input.delegation.contextSnapshot }),
    ...(input.delegation.specialization === undefined
      ? {}
      : { specialization: input.delegation.specialization }),
    ...(input.delegation.targetAgent === undefined
      ? {}
      : { targetAgent: input.delegation.targetAgent }),
    ...(input.delegation.verificationRequest === undefined
      ? {}
      : { verificationRequest: input.delegation.verificationRequest }),
    ...(input.delegation.resultSummary === undefined
      ? {}
      : { resultSummary: input.delegation.resultSummary }),
    ...(input.delegation.error === undefined ? {} : { error: input.delegation.error }),
  };
}

function projectAgentDelegateSubagentRunsFromTaskState(
  state: AgentDelegateTaskOperationsState,
  options: { readonly parentTurnId?: string } = {},
): readonly AgentDelegateTaskBackedSubagentRun[] {
  const verificationById = new Map(state.verification.map((record) => [record.id, record]));
  const verificationByTaskId = new Map(
    state.verification.flatMap((record) =>
      record.taskId === undefined ? [] : [[record.taskId, record] as const],
    ),
  );
  const schedulingByDelegationId = createAgentDelegateSchedulingByDelegationId(state.delegation);
  return state.delegation.map((record) => {
    const verification =
      (record.verificationRequest?.verificationId === undefined
        ? undefined
        : verificationById.get(record.verificationRequest.verificationId)) ??
      (record.taskId === undefined ? undefined : verificationByTaskId.get(record.taskId));
    const parentTurnId =
      options.parentTurnId ??
      extractContextField(record.contextSnapshot, "parentTurnId") ??
      "unknown";
    const profileId = record.targetAgent ?? record.specialization ?? record.workerId;
    const summary = record.resultSummary ?? record.error;
    const verificationVerdict =
      typeof verification?.verdict === "string" ? verification.verdict : undefined;
    const parentVisibleResult: AgentDelegateTaskBackedSubagentRun["parentVisibleResult"] = {
      status: record.status,
      ...(summary === undefined ? {} : { summary }),
      ...(verificationVerdict === undefined ? {} : { verificationVerdict }),
    };
    return {
      subagentId: record.id,
      parentTurnId,
      profileId,
      workerId: record.workerId,
      ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
      status: record.status,
      role: record.specialization ?? "general",
      ...(record.targetAgent === undefined ? {} : { targetAgent: record.targetAgent }),
      isolatedContext: extractContextField(record.contextSnapshot, "isolatedContext") !== "false",
      instruction: record.instruction,
      ...(record.contextSnapshot === undefined ? {} : { contextSnapshot: record.contextSnapshot }),
      ...(record.resultSummary === undefined ? {} : { resultSummary: record.resultSummary }),
      createdAtMs: record.createdAtMs,
      updatedAtMs: record.updatedAtMs,
      ...(record.completedAtMs === undefined ? {} : { completedAtMs: record.completedAtMs }),
      ...(record.error === undefined ? {} : { error: record.error }),
      ...(verification === undefined ? {} : { verification }),
      parentVisibleResult,
      ...optionalAgentDelegateScheduling(schedulingByDelegationId.get(record.id)),
    };
  });
}

async function detectAgentDelegateWriteSetConflict(input: {
  readonly input: ConversationRuntimeToolExecutionInput;
  readonly taskPlane: AgentDelegateTaskPlanePort;
  readonly delegation: AgentDelegateDelegationRecordInput;
  readonly nowMs: number;
}): Promise<AgentDelegateSubagentScheduling | undefined> {
  if (input.taskPlane.status === undefined) {
    return undefined;
  }
  const state = await input.taskPlane.status();
  const candidate: AgentDelegateDelegationRecord = {
    id: input.delegation.id,
    workerId: input.delegation.workerId,
    instruction: input.delegation.instruction,
    status: input.delegation.status ?? "queued",
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    ...(input.delegation.taskId === undefined ? {} : { taskId: input.delegation.taskId }),
    ...(input.delegation.fromAgent === undefined ? {} : { fromAgent: input.delegation.fromAgent }),
    ...(input.delegation.contextSnapshot === undefined
      ? {}
      : { contextSnapshot: input.delegation.contextSnapshot }),
    ...(input.delegation.specialization === undefined
      ? {}
      : { specialization: input.delegation.specialization }),
    ...(input.delegation.targetAgent === undefined
      ? {}
      : { targetAgent: input.delegation.targetAgent }),
    ...(input.delegation.verificationRequest === undefined
      ? {}
      : { verificationRequest: input.delegation.verificationRequest }),
    ...(input.delegation.resultSummary === undefined
      ? {}
      : { resultSummary: input.delegation.resultSummary }),
    ...(input.delegation.error === undefined ? {} : { error: input.delegation.error }),
  };
  const scheduling = createAgentDelegateSchedulingByDelegationId([
    ...state.delegation,
    candidate,
  ]).get(input.delegation.id);
  return scheduling?.canRunInParallel === false ? scheduling : undefined;
}

function createAgentDelegateSchedulingByDelegationId(
  delegations: readonly AgentDelegateDelegationRecord[],
): ReadonlyMap<string, AgentDelegateSubagentScheduling> {
  const candidates = delegations
    .filter((record) => record.status === "queued" || record.status === "running")
    .map((record) => ({
      record,
      parallelGroup: extractContextField(record.contextSnapshot, "parallelGroup"),
      ...resolveAgentDelegateSchedulingWriteSet(record.contextSnapshot),
    }))
    .filter((entry) => entry.parallelGroup !== undefined || entry.writeSet.length > 0)
    .sort(compareAgentDelegateSchedulingCandidates)
    .map((entry, scheduleOrder) => ({
      ...entry,
      scheduleOrder,
    }));
  const scheduling = new Map<string, AgentDelegateSubagentScheduling>();
  const assigned: {
    readonly id: string;
    readonly writeSet: readonly string[];
    readonly batch: number;
  }[] = [];

  for (const candidate of candidates) {
    const conflicts = candidates
      .filter((entry) => entry.record.id !== candidate.record.id)
      .map((entry) => ({
        id: entry.record.id,
        overlap: intersect(candidate.writeSet, entry.writeSet),
      }))
      .filter((entry) => entry.overlap.length > 0);
    const blockedBy = assigned
      .filter((entry) => intersect(candidate.writeSet, entry.writeSet).length > 0)
      .map((entry) => entry.id);
    const blockedBatches = new Set(
      assigned
        .filter((entry) => intersect(candidate.writeSet, entry.writeSet).length > 0)
        .map((entry) => entry.batch),
    );
    const parallelBatch = selectFirstAvailableAgentDelegateParallelBatch(blockedBatches);
    const conflictReason =
      conflicts.length === 0
        ? undefined
        : `write-set-overlap: ${uniqueStrings(conflicts.flatMap((entry) => entry.overlap)).join(", ")}`;
    scheduling.set(candidate.record.id, {
      ...(candidate.parallelGroup === undefined ? {} : { parallelGroup: candidate.parallelGroup }),
      writeSet: candidate.writeSet,
      ...(candidate.writeSetSource === undefined
        ? {}
        : { writeSetSource: candidate.writeSetSource }),
      canRunInParallel: conflicts.length === 0,
      conflictsWith: conflicts.map((entry) => entry.id),
      ...(conflictReason === undefined ? {} : { conflictReason }),
      parallelBatch,
      scheduleOrder: candidate.scheduleOrder,
      readyToStart: parallelBatch === 0,
      blockedBy,
    });
    assigned.push({
      id: candidate.record.id,
      writeSet: candidate.writeSet,
      batch: parallelBatch,
    });
  }

  return scheduling;
}

function resolveAgentDelegateSchedulingWriteSet(snapshot: string | undefined): {
  readonly writeSet: readonly string[];
  readonly writeSetSource?: "explicit" | "inferred";
} {
  const explicitWriteSet = normalizeWriteSet(extractContextField(snapshot, "writeSet"));
  if (explicitWriteSet.length > 0) {
    return {
      writeSet: explicitWriteSet,
      writeSetSource: "explicit",
    };
  }
  const inferredWriteSet = normalizeWriteSet(extractContextField(snapshot, "writableRoots"));
  if (inferredWriteSet.length > 0) {
    return {
      writeSet: inferredWriteSet,
      writeSetSource: "inferred",
    };
  }
  return { writeSet: [] };
}

function compareAgentDelegateSchedulingCandidates(
  left: {
    readonly record: AgentDelegateDelegationRecord;
    readonly parallelGroup: string | undefined;
    readonly writeSet: readonly string[];
  },
  right: {
    readonly record: AgentDelegateDelegationRecord;
    readonly parallelGroup: string | undefined;
    readonly writeSet: readonly string[];
  },
): number {
  const leftRunningRank = left.record.status === "running" ? 0 : 1;
  const rightRunningRank = right.record.status === "running" ? 0 : 1;
  if (leftRunningRank !== rightRunningRank) {
    return leftRunningRank - rightRunningRank;
  }
  if (left.record.createdAtMs !== right.record.createdAtMs) {
    return left.record.createdAtMs - right.record.createdAtMs;
  }
  return left.record.id.localeCompare(right.record.id);
}

function selectFirstAvailableAgentDelegateParallelBatch(
  blockedBatches: ReadonlySet<number>,
): number {
  let batch = 0;
  while (blockedBatches.has(batch)) {
    batch += 1;
  }
  return batch;
}

function extractContextField(snapshot: string | undefined, key: string): string | undefined {
  if (snapshot === undefined) {
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

function normalizeWriteSet(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return uniqueStrings(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function intersect(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return left.filter((entry) => rightSet.has(entry));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function optionalAgentDelegateScheduling(
  scheduling: AgentDelegateSubagentScheduling | undefined,
): { readonly scheduling: AgentDelegateSubagentScheduling } | Record<string, never> {
  return scheduling === undefined ? {} : { scheduling };
}

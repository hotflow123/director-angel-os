import type { ToolCapability } from "@hotflow/policy-runtime";

import type { AgentDelegateTaskBackedSubagentRun } from "./agent-delegate-tool.js";
import {
  type ConversationRuntimeBackgroundJobRecord,
  createConversationRuntimeBackgroundJobTask,
  transitionConversationRuntimeBackgroundJob,
} from "./background-job-runtime.js";

export type AgentDelegateBackgroundJobProjectionAction = "create" | "transition" | "noop";

export interface CreateAgentDelegateBackgroundJobProjectionInput {
  readonly run: AgentDelegateTaskBackedSubagentRun;
  readonly previous?: ConversationRuntimeBackgroundJobRecord;
  readonly nowMs?: () => number;
}

export interface AgentDelegateBackgroundJobProjection {
  readonly schemaVersion: "conversation-runtime.agent-delegate-background-job-projection.v1";
  readonly action: AgentDelegateBackgroundJobProjectionAction;
  readonly subagentId: string;
  readonly backgroundJob: ConversationRuntimeBackgroundJobRecord;
}

export function createAgentDelegateBackgroundJobProjection(
  input: CreateAgentDelegateBackgroundJobProjectionInput,
): AgentDelegateBackgroundJobProjection {
  const timestamp = input.nowMs?.() ?? Date.now();
  const baseline = input.previous ?? createBackgroundJobForSubagentRun(input.run, timestamp);
  const transitioned = transitionBackgroundJobForSubagentRun(baseline, input.run, timestamp);

  return {
    schemaVersion: "conversation-runtime.agent-delegate-background-job-projection.v1",
    action:
      input.previous === undefined ? "create" : transitioned === baseline ? "noop" : "transition",
    subagentId: input.run.subagentId,
    backgroundJob: transitioned,
  };
}

function createBackgroundJobForSubagentRun(
  run: AgentDelegateTaskBackedSubagentRun,
  timestamp: number,
): ConversationRuntimeBackgroundJobRecord {
  const context = parseContextSnapshot(run.contextSnapshot);
  const parentJobId = context.get("parentJobId");
  const maxAttempts = resolveMaxTurns(context.get("maxTurns"));
  const task = createConversationRuntimeBackgroundJobTask({
    jobId: createAgentDelegateBackgroundJobId(run.subagentId),
    sessionKey: context.get("requesterSessionKey") ?? context.get("sessionKey") ?? run.parentTurnId,
    title: `Agent ${run.subagentId}`,
    objective: run.instruction,
    trigger: {
      kind: "subagent",
      ...(parentJobId === undefined ? {} : { parentJobId }),
      parentTurnRunId: run.parentTurnId,
    },
    allowedTools: splitCommaList(context.get("tools")),
    allowedCapabilities: splitCommaList(context.get("permissions")) as readonly ToolCapability[],
    riskLevel: run.role === "verify" ? "medium" : "high",
    policyEnvelopeRefs: [`agent-delegate:${run.subagentId}`],
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    createdAtMs: run.createdAtMs || timestamp,
    metadata: {
      source: "agent.delegate",
      subagentId: run.subagentId,
      parentTurnId: run.parentTurnId,
      profileId: run.profileId,
      workerId: run.workerId,
      role: run.role,
      isolatedContext: run.isolatedContext,
      ...(run.taskId === undefined ? {} : { taskId: run.taskId }),
      ...(context.get("requesterSessionKey") === undefined
        ? {}
        : { requesterSessionKey: context.get("requesterSessionKey") }),
      ...(context.get("childSessionKey") === undefined
        ? {}
        : { childSessionKey: context.get("childSessionKey") }),
      ...(run.scheduling === undefined
        ? {}
        : {
            scheduling: {
              parallelBatch: run.scheduling.parallelBatch,
              readyToStart: run.scheduling.readyToStart,
              blockedBy: [...run.scheduling.blockedBy],
              conflictsWith: [...run.scheduling.conflictsWith],
              writeSet: [...run.scheduling.writeSet],
              ...(run.scheduling.parallelGroup === undefined
                ? {}
                : { parallelGroup: run.scheduling.parallelGroup }),
            },
          }),
    },
  });
  return task.record;
}

function transitionBackgroundJobForSubagentRun(
  record: ConversationRuntimeBackgroundJobRecord,
  run: AgentDelegateTaskBackedSubagentRun,
  timestamp: number,
): ConversationRuntimeBackgroundJobRecord {
  if (record.status === mapSubagentStatusToBackgroundJobStatus(run.status)) {
    return maybeRefreshCompletedSummary(record, run);
  }

  switch (run.status) {
    case "queued":
      return record;
    case "running":
      return transitionConversationRuntimeBackgroundJob(record, {
        type: "start",
        occurredAtMs: run.updatedAtMs || timestamp,
        workerId: run.workerId,
      });
    case "completed":
      return transitionConversationRuntimeBackgroundJob(record, {
        type: "complete",
        occurredAtMs: run.completedAtMs ?? run.updatedAtMs ?? timestamp,
        summary: run.parentVisibleResult.summary ?? run.resultSummary ?? "Subagent completed.",
      });
    case "failed":
      return appendSubagentFailedEvent(
        transitionConversationRuntimeBackgroundJob(record, {
          type: "fail",
          occurredAtMs: run.completedAtMs ?? run.updatedAtMs ?? timestamp,
          reason: run.error ?? run.parentVisibleResult.summary ?? "Subagent failed.",
          failureTaxonomy: ["agent_delegate_failed"],
        }),
        run,
        run.completedAtMs ?? run.updatedAtMs ?? timestamp,
      );
    case "cancelled":
      return transitionConversationRuntimeBackgroundJob(record, {
        type: "cancel",
        occurredAtMs: run.completedAtMs ?? run.updatedAtMs ?? timestamp,
        requestedBy: "system",
        reason: run.parentVisibleResult.summary ?? "Subagent cancelled.",
      });
  }
}

function appendSubagentFailedEvent(
  record: ConversationRuntimeBackgroundJobRecord,
  run: AgentDelegateTaskBackedSubagentRun,
  timestamp: number,
): ConversationRuntimeBackgroundJobRecord {
  const eventId = `${record.jobId}:subagent.failed:${timestamp}`;
  if (record.events.some((event) => event.id === eventId)) {
    return record;
  }
  const summary = run.error ?? run.parentVisibleResult.summary ?? "Subagent failed.";
  const subagentFailure = {
    subagentId: run.subagentId,
    parentTurnId: run.parentTurnId,
    profileId: run.profileId,
    workerId: run.workerId,
    role: run.role,
    ...(run.taskId === undefined ? {} : { taskId: run.taskId }),
    ...(run.error === undefined ? {} : { error: run.error }),
  };
  return {
    ...record,
    metadata: {
      ...(record.metadata ?? {}),
      lastSubagentFailure: subagentFailure,
    },
    events: [
      ...record.events,
      {
        id: eventId,
        type: "subagent.failed",
        occurredAtMs: timestamp,
        summary,
        policyEnvelopeRefs: [`agent-delegate:${run.subagentId}`],
        evidenceRefIds: [],
        sourceRefs: [],
        metadata: subagentFailure,
      },
    ],
  };
}

function maybeRefreshCompletedSummary(
  record: ConversationRuntimeBackgroundJobRecord,
  run: AgentDelegateTaskBackedSubagentRun,
): ConversationRuntimeBackgroundJobRecord {
  if (record.status !== "completed" || record.summary !== undefined) {
    return record;
  }
  const summary = run.parentVisibleResult.summary ?? run.resultSummary;
  return summary === undefined ? record : { ...record, summary };
}

function mapSubagentStatusToBackgroundJobStatus(
  status: AgentDelegateTaskBackedSubagentRun["status"],
): ConversationRuntimeBackgroundJobRecord["status"] {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function createAgentDelegateBackgroundJobId(subagentId: string): string {
  return `agent-delegate:${subagentId}`;
}

function parseContextSnapshot(snapshot: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (snapshot === undefined) {
    return result;
  }
  for (const part of snapshot.split(";")) {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey?.trim();
    const value = rawValue.join("=").trim();
    if (key !== undefined && key.length > 0 && value.length > 0) {
      result.set(key, value);
    }
  }
  return result;
}

function splitCommaList(value: string | undefined): readonly string[] {
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

function resolveMaxTurns(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

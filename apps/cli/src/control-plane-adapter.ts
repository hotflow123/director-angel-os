import type { RunDoctorOptions } from "@hotflow/doctor";
import { MemoryCoreManager } from "@hotflow/memory-core";
import type { JsonValue, SessionStore } from "@hotflow/sessions";
import { type SkillRepositoryPort, decodeSkillProposal } from "@hotflow/skills";
import type { ProposalRecord, TaskOperationsState } from "@hotflow/tasks-core";

import {
  createCliControlPlane as createCliControlPlaneRuntime,
  createCliOperatorControlPlane as createCliOperatorControlPlaneRuntime,
} from "./control-plane.js";

export interface CreateCliControlPlaneAdapterOptions {
  readonly approvedSkillRepository?: SkillRepositoryPort;
  readonly memory?: MemoryCoreManager;
  readonly sessionStore: SessionStore;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runDoctor?: (options?: RunDoctorOptions) => Promise<unknown> | unknown;
  readonly recordAuditEvent?: (input: {
    readonly sessionId: string;
    readonly kind: string;
    readonly payload?: JsonValue;
    readonly turnId?: string;
    readonly occurredAtMs?: number;
  }) => void;
}

export function createCliControlPlane(options: CreateCliControlPlaneAdapterOptions) {
  const runtimeControlPlane = createCliControlPlaneRuntime({
    ...(options.approvedSkillRepository === undefined
      ? {}
      : { approvedSkillRepository: options.approvedSkillRepository }),
    sessionStore: options.sessionStore,
    memory: options.memory ?? new MemoryCoreManager(),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.runDoctor === undefined ? {} : { runDoctor: options.runDoctor }),
    telemetry: {
      recordAuditEvent(input) {
        options.recordAuditEvent?.(input);
      },
    },
  });

  return {
    async dispatch(action: Record<string, unknown>) {
      const result = await runtimeControlPlane.dispatch(action as never);
      if (!result.ok) {
        return result;
      }

      return {
        ...result,
        data: projectCliDispatchData(action.type, result.data),
      };
    },
  };
}

export interface CreateCliOperatorControlPlaneAdapterOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runDoctor?: (options?: RunDoctorOptions) => Promise<unknown> | unknown;
  readonly recordAuditEvent?: (input: {
    readonly sessionId: string;
    readonly kind: string;
    readonly payload?: JsonValue;
    readonly turnId?: string;
    readonly occurredAtMs?: number;
  }) => void;
}

export function createCliOperatorControlPlane(
  options: CreateCliOperatorControlPlaneAdapterOptions = {},
) {
  return createCliOperatorControlPlaneRuntime({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.runDoctor === undefined ? {} : { runDoctor: options.runDoctor }),
    telemetry: {
      recordAuditEvent(input) {
        options.recordAuditEvent?.(input);
      },
    },
  });
}

function projectCliDispatchData(actionType: unknown, data: unknown): unknown {
  if (actionType === "proposal-list" && Array.isArray(data)) {
    return data.map((entry) => toCliProposalListEntry(entry));
  }
  if (
    (actionType === "task-status" ||
      actionType === "delegation-enqueue" ||
      actionType === "delegation-status" ||
      actionType === "verification-upsert" ||
      actionType === "proposal-enqueue" ||
      actionType === "proposal-transition" ||
      actionType === "proposal-accept" ||
      actionType === "proposal-reject" ||
      actionType === "proposal-apply") &&
    isTaskOperationsState(data)
  ) {
    return {
      ...data,
      proposalQueue: data.proposalQueue.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        status: entry.status,
        provenance: entry.provenance,
      })),
      proposalOutbox: data.proposalOutbox.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        proposalId: entry.proposalId,
        status: entry.status,
      })),
    };
  }

  return data;
}

function toCliProposalListEntry(entry: unknown): Record<string, unknown> {
  if (!isProposalRecord(entry)) {
    return {};
  }

  const decoded = decodeSkillProposal(entry);
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    provenance: entry.provenance,
    ...(decoded?.riskLevel === undefined ? {} : { riskLevel: decoded.riskLevel }),
    ...(decoded?.confidence === undefined ? {} : { confidence: decoded.confidence }),
  };
}

function isProposalRecord(value: unknown): value is ProposalRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as {
    id?: unknown;
    kind?: unknown;
    payload?: unknown;
    status?: unknown;
    sourceSessionId?: unknown;
    sourceTurnId?: unknown;
    provenance?: unknown;
  };

  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    candidate.payload !== undefined &&
    typeof candidate.payload === "object" &&
    !Array.isArray(candidate.payload) &&
    typeof candidate.status === "string" &&
    typeof candidate.sourceSessionId === "string" &&
    typeof candidate.sourceTurnId === "string" &&
    typeof candidate.provenance === "string"
  );
}

function isTaskOperationsState(value: unknown): value is TaskOperationsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as {
    schemaVersion?: unknown;
    todos?: unknown;
    delegation?: unknown;
    verification?: unknown;
    proposalQueue?: unknown;
    proposalOutbox?: unknown;
  };

  return (
    typeof candidate.schemaVersion === "string" &&
    candidate.todos !== null &&
    typeof candidate.todos === "object" &&
    !Array.isArray(candidate.todos) &&
    Array.isArray(candidate.delegation) &&
    Array.isArray(candidate.verification) &&
    Array.isArray(candidate.proposalQueue) &&
    Array.isArray(candidate.proposalOutbox)
  );
}

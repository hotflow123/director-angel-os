import type {
  AgentOsAgentToolDelegationRequest,
  AgentOsParentVisibleSubagentResult,
  AgentOsSubagentArtifact,
  AgentOsSubagentEnvelope,
  AgentOsSubagentProfile,
  AgentOsSubagentStatus,
} from "./types.js";

export interface CreateAgentToolDelegationEnvelopeInput {
  readonly parent: AgentOsSubagentEnvelope;
  readonly profile: AgentOsSubagentProfile;
  readonly request: AgentOsAgentToolDelegationRequest;
  readonly now: string;
  readonly subagentId?: string;
}

export interface CreateParentVisibleSubagentResultInput {
  readonly envelope: AgentOsSubagentEnvelope;
  readonly status: AgentOsSubagentStatus;
  readonly summary: string;
  readonly artifacts?: readonly AgentOsSubagentArtifact[];
  readonly completedAt: string;
}

export function subagentScopeDoesNotEscalate(
  parent: AgentOsSubagentEnvelope,
  child: AgentOsSubagentEnvelope,
): boolean {
  return (
    isSubset(child.permissions, parent.permissions) &&
    isSubset(child.tools, parent.tools) &&
    isSubset(child.writableRoots, parent.writableRoots) &&
    isSubset(child.memoryLayers, parent.memoryLayers) &&
    child.maxTurns <= parent.maxTurns
  );
}

export function createAgentToolDelegationEnvelope(
  input: CreateAgentToolDelegationEnvelopeInput,
): AgentOsSubagentEnvelope {
  assertRequestedSubset("permissions", input.request.allowedPermissions, input.profile.permissions);
  assertRequestedSubset("tools", input.request.allowedTools, input.profile.tools);
  assertRequestedSubset("writableRoots", input.request.writableRoots, input.profile.writableRoots);
  assertRequestedSubset("memoryLayers", input.request.memoryLayers, input.profile.memoryLayers);

  const child: AgentOsSubagentEnvelope = {
    subagentId: input.subagentId ?? `subagent_${input.request.requestId}`,
    parentTurnId: input.request.parentTurnId,
    profileId: input.profile.profileId,
    permissions: intersectOrRequested(input.profile.permissions, input.request.allowedPermissions),
    tools: intersectOrRequested(input.profile.tools, input.request.allowedTools),
    writableRoots: intersectOrRequested(input.profile.writableRoots, input.request.writableRoots),
    memoryLayers: intersectOrRequested(input.profile.memoryLayers, input.request.memoryLayers),
    maxTurns: Math.min(input.profile.maxTurns, input.request.maxTurns ?? input.profile.maxTurns),
    delegationRequestId: input.request.requestId,
    task: input.request.task,
    expectedOutput: input.request.expectedOutput,
    isolatedContext: true,
    status: "queued",
    createdAt: input.now,
    ...(input.profile.budget === undefined ? {} : { budget: input.profile.budget }),
    ...(input.request.artifactsRequested === undefined
      ? {}
      : { artifactsRequested: [...input.request.artifactsRequested] }),
  };

  if (!subagentScopeDoesNotEscalate(input.parent, child)) {
    throw new Error("Subagent scope escalation blocked");
  }

  return child;
}

export function createParentVisibleSubagentResult(
  input: CreateParentVisibleSubagentResultInput,
): AgentOsParentVisibleSubagentResult {
  return {
    subagentId: input.envelope.subagentId,
    parentTurnId: input.envelope.parentTurnId,
    ...(input.envelope.delegationRequestId === undefined
      ? {}
      : { delegationRequestId: input.envelope.delegationRequestId }),
    profileId: input.envelope.profileId,
    status: input.status,
    summary: input.summary,
    artifacts: (input.artifacts ?? []).filter((artifact) => artifact.parentVisible),
    completedAt: input.completedAt,
  };
}

function assertRequestedSubset<T extends string>(
  label: string,
  requestedValues: readonly T[] | undefined,
  profileValues: readonly T[],
): void {
  if (requestedValues === undefined) {
    return;
  }

  const profileSet = new Set(profileValues);
  const denied = requestedValues.filter((value) => !profileSet.has(value));
  if (denied.length > 0) {
    throw new Error(`Subagent scope escalation blocked: ${label} ${denied.join(", ")}`);
  }
}

function intersectOrRequested<T extends string>(
  profileValues: readonly T[],
  requestedValues: readonly T[] | undefined,
): readonly T[] {
  if (requestedValues === undefined) {
    return [...profileValues];
  }

  const profileSet = new Set(profileValues);
  return requestedValues.filter((value) => profileSet.has(value));
}

function isSubset<T extends string>(candidate: readonly T[], allowed: readonly T[]): boolean {
  const allowedSet = new Set(allowed);
  return candidate.every((entry) => allowedSet.has(entry));
}

import { isObject, isOptional, isString } from "./guards.js";
import { isOneOf } from "./guards.js";
import {
  AGENT_OS_KERNEL_SCHEMA_VERSION,
  AGENT_OS_TURN_KINDS,
  type AgentOsTurnEnvelope,
  type AgentOsTurnKind,
  isAgentOsActorEnvelope,
  isAgentOsBudgetEnvelope,
  isAgentOsChannelEnvelope,
  isAgentOsMemoryScope,
  isAgentOsPermissionContext,
  isAgentOsPolicyVerdict,
  isAgentOsQueueDirective,
  isAgentOsSandboxPreflight,
  isAgentOsTurnState,
  isAgentOsWorkspaceScope,
} from "./types.js";

export type AgentOsTurnEnvelopeInput = Omit<AgentOsTurnEnvelope, "schemaVersion">;

export function createAgentOsTurnEnvelope(input: AgentOsTurnEnvelopeInput): AgentOsTurnEnvelope {
  const envelope: AgentOsTurnEnvelope = {
    schemaVersion: AGENT_OS_KERNEL_SCHEMA_VERSION,
    ...input,
  };

  if (!isAgentOsTurnEnvelope(envelope)) {
    throw new Error("Invalid Agent OS turn envelope.");
  }

  return envelope;
}

export function isAgentOsTurnEnvelope(value: unknown): value is AgentOsTurnEnvelope {
  return (
    isObject(value) &&
    value.schemaVersion === AGENT_OS_KERNEL_SCHEMA_VERSION &&
    isString(value.turnId) &&
    isString(value.sessionKey) &&
    isAgentOsTurnKind(value.turnKind) &&
    isString(value.createdAt) &&
    isAgentOsActorEnvelope(value.actor) &&
    isAgentOsChannelEnvelope(value.channel) &&
    isAgentOsPermissionContext(value.permissionContext) &&
    isAgentOsMemoryScope(value.memoryScope) &&
    isAgentOsWorkspaceScope(value.workspaceScope) &&
    isOptional(value.budget, isAgentOsBudgetEnvelope) &&
    isOptional(value.queueDirective, isAgentOsQueueDirective) &&
    isAgentOsPolicyVerdict(value.policyVerdict) &&
    isAgentOsSandboxPreflight(value.sandboxPreflight) &&
    isOptional(value.parentTurnId, isString)
  );
}

export function isAgentOsTurnKind(value: unknown): value is AgentOsTurnKind {
  return isOneOf(value, AGENT_OS_TURN_KINDS);
}

export { isAgentOsTurnState };

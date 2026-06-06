import { isNumber, isObject, isString } from "./guards.js";
import { AGENT_OS_TURN_STATES, type AgentOsTurnState, isAgentOsTurnState } from "./types.js";

export interface AgentOsTurnStateSnapshot {
  readonly turnId: string;
  readonly state: AgentOsTurnState;
  readonly updatedAt: string;
  readonly transitionCount: number;
}

export const AGENT_OS_TURN_TRANSITIONS: Readonly<
  Record<AgentOsTurnState, readonly AgentOsTurnState[]>
> = {
  received: ["queued", "preflight", "blocked", "failed"],
  queued: ["preflight", "blocked", "failed"],
  preflight: ["context_resolved", "awaiting_approval", "blocked", "failed"],
  context_resolved: ["model_calling", "tool_calling", "finalizing", "blocked", "failed"],
  model_calling: ["tool_calling", "observing", "finalizing", "completed", "blocked", "failed"],
  tool_calling: ["awaiting_approval", "observing", "finalizing", "blocked", "failed"],
  awaiting_approval: ["tool_calling", "observing", "blocked", "failed"],
  observing: ["model_calling", "tool_calling", "delegating", "finalizing", "blocked", "failed"],
  delegating: ["observing", "finalizing", "blocked", "failed"],
  finalizing: ["completed", "blocked", "failed"],
  completed: [],
  blocked: [],
  failed: [],
};

export function canTransitionAgentOsTurnState(
  from: AgentOsTurnState,
  to: AgentOsTurnState,
): boolean {
  return AGENT_OS_TURN_TRANSITIONS[from].includes(to);
}

export function transitionAgentOsTurnState(
  snapshot: AgentOsTurnStateSnapshot,
  to: AgentOsTurnState,
  updatedAt: string,
): AgentOsTurnStateSnapshot {
  if (!canTransitionAgentOsTurnState(snapshot.state, to)) {
    throw new Error(`Illegal Agent OS turn transition: ${snapshot.state} -> ${to}`);
  }

  return {
    turnId: snapshot.turnId,
    state: to,
    updatedAt,
    transitionCount: snapshot.transitionCount + 1,
  };
}

export function isAgentOsTurnStateSnapshot(value: unknown): value is AgentOsTurnStateSnapshot {
  return (
    isObject(value) &&
    isString(value.turnId) &&
    isAgentOsTurnState(value.state) &&
    isString(value.updatedAt) &&
    isNumber(value.transitionCount)
  );
}

export { AGENT_OS_TURN_STATES, isAgentOsTurnState };

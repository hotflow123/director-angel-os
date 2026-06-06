import { isNumber, isObject, isString } from "./guards.js";
import {
  type AgentOsTimelineEventType,
  type AgentOsTurnState,
  isAgentOsTimelineEventType,
  isAgentOsTurnState,
} from "./types.js";

export interface AgentOsTimelineEvent {
  readonly sequence: number;
  readonly turnId: string;
  readonly eventId: string;
  readonly eventType: AgentOsTimelineEventType;
  readonly createdAt: string;
  readonly payload: Record<string, unknown>;
  readonly actorId?: string;
  readonly correlationId?: string;
}

export interface AgentOsTimelineSummary {
  readonly latestState?: AgentOsTurnState;
  readonly approvalEvents: number;
  readonly memoryEvents: number;
  readonly skillEvents: number;
  readonly subagentEvents: number;
  readonly controlPlaneEvents: number;
  readonly toolEvents: number;
  readonly finalDelivered: boolean;
}

export function appendAgentOsTimelineEvent(
  timeline: readonly AgentOsTimelineEvent[],
  event: AgentOsTimelineEvent,
): readonly AgentOsTimelineEvent[] {
  if (!isAgentOsTimelineEvent(event)) {
    throw new Error("Invalid Agent OS timeline event.");
  }

  const latest = timeline.at(-1);
  if (latest && event.sequence <= latest.sequence) {
    throw new Error(
      `Agent OS timeline sequence must increase: ${latest.sequence} -> ${event.sequence}`,
    );
  }

  return [...timeline, event];
}

export function isAgentOsTimelineEvent(value: unknown): value is AgentOsTimelineEvent {
  return (
    isObject(value) &&
    isNumber(value.sequence) &&
    isString(value.turnId) &&
    isString(value.eventId) &&
    isAgentOsTimelineEventType(value.eventType) &&
    isString(value.createdAt) &&
    isObject(value.payload)
  );
}

export function projectAgentOsTimelineSummary(
  timeline: readonly AgentOsTimelineEvent[],
): AgentOsTimelineSummary {
  let latestState: AgentOsTurnState | undefined;
  let approvalEvents = 0;
  let memoryEvents = 0;
  let skillEvents = 0;
  let subagentEvents = 0;
  let controlPlaneEvents = 0;
  let toolEvents = 0;
  let finalDelivered = false;

  for (const event of timeline) {
    if (event.eventType === "state.transition") {
      latestState = readStateTransitionTarget(event.payload) ?? latestState;
    }
    if (event.eventType.startsWith("approval.")) {
      approvalEvents += 1;
    }
    if (event.eventType.startsWith("memory.")) {
      memoryEvents += 1;
    }
    if (event.eventType.startsWith("skill.")) {
      skillEvents += 1;
    }
    if (event.eventType.startsWith("subagent.")) {
      subagentEvents += 1;
    }
    if (event.eventType.startsWith("control.")) {
      controlPlaneEvents += 1;
    }
    if (event.eventType.startsWith("tool.")) {
      toolEvents += 1;
    }
    if (event.eventType === "final.delivered") {
      finalDelivered = true;
    }
  }

  return {
    ...(latestState === undefined ? {} : { latestState }),
    approvalEvents,
    memoryEvents,
    skillEvents,
    subagentEvents,
    controlPlaneEvents,
    toolEvents,
    finalDelivered,
  };
}

function readStateTransitionTarget(payload: Record<string, unknown>): AgentOsTurnState | undefined {
  const to = payload.to;
  return isAgentOsTurnState(to) ? to : undefined;
}

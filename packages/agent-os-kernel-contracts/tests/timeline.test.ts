import { describe, expect, it } from "vitest";

import {
  appendAgentOsTimelineEvent,
  isAgentOsTimelineEvent,
  projectAgentOsTimelineSummary,
} from "../src/index.js";

describe("agent os timeline", () => {
  it("keeps timeline events append-only by sequence", () => {
    const first = {
      sequence: 1,
      turnId: "turn-1",
      eventId: "evt-1",
      eventType: "state.transition",
      createdAt: "2026-05-08T09:00:00.000Z",
      payload: {
        from: "received",
        to: "queued",
      },
    } as const;
    const second = {
      sequence: 2,
      turnId: "turn-1",
      eventId: "evt-2",
      eventType: "approval.requested",
      createdAt: "2026-05-08T09:00:01.000Z",
      payload: {
        approvalId: "approval-1",
        reason: "mutating tool requires confirmation",
      },
    } as const;

    const timeline = appendAgentOsTimelineEvent([], first);
    const nextTimeline = appendAgentOsTimelineEvent(timeline, second);

    expect(timeline).toHaveLength(1);
    expect(nextTimeline).toHaveLength(2);
    expect(isAgentOsTimelineEvent(second)).toBe(true);
    expect(() => appendAgentOsTimelineEvent(nextTimeline, second)).toThrow(
      /sequence must increase/u,
    );
  });

  it("summarizes approval, memory, skill, subagent, and control-plane evidence", () => {
    const timeline = [
      {
        sequence: 1,
        turnId: "turn-1",
        eventId: "evt-state",
        eventType: "state.transition",
        createdAt: "2026-05-08T09:00:00.000Z",
        payload: { from: "queued", to: "preflight" },
      },
      {
        sequence: 2,
        turnId: "turn-1",
        eventId: "evt-memory",
        eventType: "memory.recall",
        createdAt: "2026-05-08T09:00:01.000Z",
        payload: {
          evidenceId: "mem-1",
          layer: "L1",
          citation: "drawer:mempalace/user/openid-1#chunk-4",
        },
      },
      {
        sequence: 3,
        turnId: "turn-1",
        eventId: "evt-skill",
        eventType: "skill.used",
        createdAt: "2026-05-08T09:00:02.000Z",
        payload: { skillId: "research.web-grounding" },
      },
      {
        sequence: 4,
        turnId: "turn-1",
        eventId: "evt-subagent",
        eventType: "subagent.spawned",
        createdAt: "2026-05-08T09:00:03.000Z",
        payload: { subagentId: "agent-reviewer-1" },
      },
      {
        sequence: 5,
        turnId: "turn-1",
        eventId: "evt-control",
        eventType: "control.health",
        createdAt: "2026-05-08T09:00:04.000Z",
        payload: { status: "ready" },
      },
    ] as const;

    expect(projectAgentOsTimelineSummary(timeline)).toEqual({
      latestState: "preflight",
      approvalEvents: 0,
      memoryEvents: 1,
      skillEvents: 1,
      subagentEvents: 1,
      controlPlaneEvents: 1,
      toolEvents: 0,
      finalDelivered: false,
    });
  });
});

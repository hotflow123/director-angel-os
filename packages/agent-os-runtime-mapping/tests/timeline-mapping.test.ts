import { describe, expect, it } from "vitest";

import {
  mapConversationRuntimeResultToAgentOsTimeline,
  mapSessionJournalEntriesToAgentOsTimeline,
} from "../src/index.js";

describe("Agent OS runtime timeline mapping", () => {
  it("maps runtime trace, approval, tool, and final events into append-only timeline events", () => {
    const timeline = mapConversationRuntimeResultToAgentOsTimeline({
      result: {
        turnId: "turn-runtime-1",
        sessionKey: "session-1",
        replySource: "tool-loop",
        events: [
          {
            id: "approval-evt",
            kind: "runtime.approval",
            turnId: "turn-runtime-1",
            sessionKey: "session-1",
            occurredAtMs: 1_778_220_000_100,
            payload: {
              approval: {
                id: "approval-1",
                title: "Run tool",
                status: "pending",
                summary: "Needs approval",
              },
            },
          },
          {
            id: "tool-evt",
            kind: "runtime.tool",
            turnId: "turn-runtime-1",
            sessionKey: "session-1",
            occurredAtMs: 1_778_220_000_200,
            payload: {
              tool: {
                id: "tool-1",
                name: "web.search",
                phase: "completed",
                summary: "Searched web",
              },
            },
          },
          {
            id: "final-evt",
            kind: "runtime.final",
            turnId: "turn-runtime-1",
            sessionKey: "session-1",
            occurredAtMs: 1_778_220_000_300,
            payload: {
              text: "done",
              responsePolicy: "result-first",
              audience: "user",
              replySource: "tool-loop",
            },
          },
        ],
        operatorTrace: {
          items: [
            {
              source: "runtime",
              stage: "turn.orchestrated",
              detail: "classified",
              occurredAtMs: 1_778_220_000_000,
              metadata: {
                intent: "chat",
              },
            },
            {
              source: "capability",
              stage: "capability.resolved",
              detail: "recall hit",
              occurredAtMs: 1_778_220_000_050,
              metadata: {
                status: "hit",
                hitCount: 1,
              },
            },
          ],
        },
        capabilityPacket: {
          status: "hit",
          hits: [
            {
              id: "memory-hit-1",
              source: "memory",
              status: "hit",
              score: 0.88,
              summary: "prefers local-only memory",
              metadata: {
                retrievalEngine: "hybrid",
                matchMode: "semantic",
                citation: "drawer:mempalace/user/openid-1#chunk-1",
                layer: "L1",
              },
            },
          ],
        },
      },
    });

    expect(timeline.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(timeline.map((event) => event.eventType)).toEqual([
      "state.transition",
      "memory.recall",
      "state.transition",
      "approval.requested",
      "tool.result",
      "final.delivered",
    ]);
    expect(timeline.at(-1)?.payload).toMatchObject({
      text: "done",
      replySource: "tool-loop",
    });
  });

  it("maps session step/audit journal entries into Agent OS timeline evidence", () => {
    const timeline = mapSessionJournalEntriesToAgentOsTimeline({
      entries: [
        {
          rowId: 1,
          sessionId: "session-1",
          seq: 10,
          eventType: "step.context_built",
          turnId: "turn-1",
          schemaVersion: "sessions.v1",
          createdAtMs: 1_778_220_000_000,
          payload: {
            stepIndex: 0,
            data: {
              promptFocus: ["user input", "session guidance"],
              usedTokens: 320,
            },
          },
        },
        {
          rowId: 2,
          sessionId: "session-1",
          seq: 11,
          eventType: "step.tool_result",
          turnId: "turn-1",
          schemaVersion: "sessions.v1",
          createdAtMs: 1_778_220_000_100,
          payload: {
            stepIndex: 1,
            data: {
              toolName: "web.search",
              outcome: "executed",
            },
          },
        },
        {
          rowId: 3,
          sessionId: "session-1",
          seq: 12,
          eventType: "audit.event",
          turnId: "turn-1",
          schemaVersion: "sessions.v1",
          createdAtMs: 1_778_220_000_200,
          payload: {
            id: "audit-1",
            kind: "control.action",
            schemaVersion: "sessions.event.v1",
            occurredAtMs: 1_778_220_000_200,
            payload: {
              action: "prompt-inspect",
              ok: true,
            },
          },
        },
      ],
    });

    expect(timeline.map((event) => event.sequence)).toEqual([10, 11, 12]);
    expect(timeline.map((event) => event.eventType)).toEqual([
      "capability.projected",
      "tool.result",
      "control.log",
    ]);
    expect(timeline[2]?.payload).toMatchObject({
      kind: "control.action",
      action: "prompt-inspect",
      ok: true,
    });
  });
});

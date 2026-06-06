import { describe, expect, it } from "vitest";

import { createChannelTransportEnvelope } from "@hotflow/contracts";
import { DIRECTOR_HOST_API_VERSION } from "@hotflow/director-host-contracts";

import {
  DIRECTOR_ENTRY_API_VERSION,
  DIRECTOR_ENTRY_SESSION_SCHEMA_VERSION,
  isDirectorEntryIntakeRequest,
  isDirectorEntryIntakeResponse,
  isDirectorEntryMessageRequest,
  isDirectorEntrySession,
} from "../src/index.js";

describe("director-entry-contracts guards", () => {
  it("validates entry intake requests", () => {
    expect(
      isDirectorEntryIntakeRequest({
        apiVersion: DIRECTOR_ENTRY_API_VERSION,
        entry: {
          hostId: "lark",
          channel: "lark-im",
          routeKind: "direct",
          sessionKey: "agent:director:direct:user_1",
          messageId: "msg-1",
          receivedAt: "2026-04-13T10:00:00.000Z",
        },
        snapshot: createSnapshot(),
        intake: createIntake(),
      }),
    ).toBe(true);
  });

  it("validates raw entry message requests", () => {
    expect(
      isDirectorEntryMessageRequest({
        apiVersion: DIRECTOR_ENTRY_API_VERSION,
        hostId: "lark",
        message: createChannelTransportEnvelope({
          channel: "lark-im",
          agentId: "director",
          peerId: "user_1",
          messageId: "msg-raw-1",
          receivedAtMs: 1_713_000_000_000,
          text: "Create a launch brief.",
          routingHint: {
            agentId: "director",
            channel: "lark-im",
            routeKind: "direct",
            peerId: "user_1",
          },
        }),
      }),
    ).toBe(true);
  });

  it("validates stored entry sessions", () => {
    expect(
      isDirectorEntrySession({
        schemaVersion: DIRECTOR_ENTRY_SESSION_SCHEMA_VERSION,
        entrySessionId: "entry-session-1",
        sessionKey: "agent:director:direct:user_1",
        hostId: "lark",
        channel: "lark-im",
        routeKind: "direct",
        createdAt: "2026-04-13T10:00:00.000Z",
        updatedAt: "2026-04-13T10:01:00.000Z",
        state: "clarification_required",
        nextAction: "clarify",
        latestTurnId: "entry-turn-1",
        latestLineage: {
          sessionKey: "agent:director:direct:user_1",
          entrySessionId: "entry-session-1",
          entryTurnId: "entry-turn-1",
          intakeId: "intake-1",
        },
        turns: [
          {
            entryTurnId: "entry-turn-1",
            messageId: "msg-1",
            receivedAt: "2026-04-13T10:00:00.000Z",
            state: "clarification_required",
            nextAction: "clarify",
            summary: "Need clarification before blueprint.",
            lineage: {
              sessionKey: "agent:director:direct:user_1",
              entrySessionId: "entry-session-1",
              entryTurnId: "entry-turn-1",
              intakeId: "intake-1",
            },
            clarificationPrompts: ["What style should the output follow?"],
          },
        ],
      }),
    ).toBe(true);
  });

  it("validates entry intake responses", () => {
    expect(
      isDirectorEntryIntakeResponse({
        apiVersion: DIRECTOR_ENTRY_API_VERSION,
        directorApiVersion: DIRECTOR_HOST_API_VERSION,
        session: {
          schemaVersion: DIRECTOR_ENTRY_SESSION_SCHEMA_VERSION,
          entrySessionId: "entry-session-1",
          sessionKey: "agent:director:direct:user_1",
          hostId: "lark",
          channel: "lark-im",
          routeKind: "direct",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:01:00.000Z",
          state: "ready_for_blueprint",
          nextAction: "blueprint",
          latestTurnId: "entry-turn-1",
          latestLineage: {
            sessionKey: "agent:director:direct:user_1",
            entrySessionId: "entry-session-1",
            entryTurnId: "entry-turn-1",
            intakeId: "intake-1",
            alignmentLockId: "alignment-lock-1",
          },
          latestBlueprint: {
            blueprintId: "blueprint-1",
            handoffId: "handoff-1",
            recordedAt: "2026-04-13T10:02:00.000Z",
          },
          latestRun: {
            runId: "run-1",
            status: "running",
            updatedAt: "2026-04-13T10:03:00.000Z",
          },
          latestReport: {
            reportId: "report-run-1",
            runId: "run-1",
            recordedAt: "2026-04-13T10:04:00.000Z",
            flags: ["run-in-progress"],
            operatorSummary: "Run is in progress.",
            nextAction: "wait",
            retryable: false,
          },
          agentOsProjection: createAgentOsProjection(),
          turns: [
            {
              entryTurnId: "entry-turn-1",
              messageId: "msg-1",
              receivedAt: "2026-04-13T10:00:00.000Z",
              state: "ready_for_blueprint",
              nextAction: "blueprint",
              summary: "Ready to draft blueprint.",
              lineage: {
                sessionKey: "agent:director:direct:user_1",
                entrySessionId: "entry-session-1",
                entryTurnId: "entry-turn-1",
                intakeId: "intake-1",
                alignmentLockId: "alignment-lock-1",
              },
            },
          ],
        },
        turn: {
          entryTurnId: "entry-turn-1",
          messageId: "msg-1",
          receivedAt: "2026-04-13T10:00:00.000Z",
          state: "ready_for_blueprint",
          nextAction: "blueprint",
          summary: "Ready to draft blueprint.",
          lineage: {
            sessionKey: "agent:director:direct:user_1",
            entrySessionId: "entry-session-1",
            entryTurnId: "entry-turn-1",
            intakeId: "intake-1",
            alignmentLockId: "alignment-lock-1",
          },
        },
        intake: {
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshotId: "snapshot-1",
          runtimeId: "director-host-api",
          intakeId: "intake-1",
          capabilitySnapshot: {
            snapshotId: "capability-snapshot-1",
            runtimeId: "director-host-api",
            capturedAt: "2026-04-13T10:00:00.000Z",
            status: "ready",
            notes: [],
            adapters: [],
          },
          clarification: {
            decision: "ready",
            summary: "All key fields are present.",
            missingFields: [],
            conflictingFields: [],
            questions: [],
          },
          alignmentState: "locked",
          alignmentLock: {
            lockId: "alignment-lock-1",
            sourceIntakeId: "intake-1",
            state: "locked",
            lockedAt: "2026-04-13T10:00:00.000Z",
            objective: "Create a director-ready launch brief.",
            deliverables: ["launch brief"],
            lockedConstraints: [],
            lockedFields: [],
            notes: [],
          },
        },
        agentOsProjection: createAgentOsProjection(),
      }),
    ).toBe(true);
  });

  it("rejects malformed Agent OS entry projections", () => {
    expect(
      isDirectorEntrySession({
        schemaVersion: DIRECTOR_ENTRY_SESSION_SCHEMA_VERSION,
        entrySessionId: "entry-session-1",
        sessionKey: "agent:director:direct:user_1",
        hostId: "lark",
        channel: "lark-im",
        routeKind: "direct",
        createdAt: "2026-04-13T10:00:00.000Z",
        updatedAt: "2026-04-13T10:01:00.000Z",
        state: "ready_for_blueprint",
        nextAction: "blueprint",
        latestTurnId: "entry-turn-1",
        latestLineage: {
          sessionKey: "agent:director:direct:user_1",
          entrySessionId: "entry-session-1",
          entryTurnId: "entry-turn-1",
        },
        agentOsProjection: {
          ...createAgentOsProjection(),
          timelineSummary: {
            ...createAgentOsProjection().timelineSummary,
            totalEvents: "one",
          },
        },
        turns: [],
      }),
    ).toBe(false);
  });
});

function createSnapshot() {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.snapshot.v1",
    snapshotId: "snapshot-1",
    createdAt: "2026-04-13T10:00:00.000Z",
    host: {
      hostId: "lark",
      triggerSource: "api",
      sessionId: "agent:director:direct:user_1",
    },
    project: {
      projectId: "project-1",
      title: "Launch Campaign",
      outline: "Create a director-ready launch brief.",
    },
    group: {
      groupId: "group-1",
      generationType: "new",
      sceneCount: 1,
      anchorIds: [],
    },
    runtime: {
      runtimeId: "director-host-api",
      status: "ready",
      availableBindings: ["scripted"],
      maxPromptChars: 4096,
      supportsVideo: true,
    },
    intent: {
      bindingPolicy: "auto",
    },
  };
}

function createIntake() {
  return {
    intakeId: "intake-1",
    submittedAt: "2026-04-13T10:00:00.000Z",
    objective: "Create a director-ready launch brief.",
    deliverables: ["launch brief"],
  };
}

function createAgentOsProjection() {
  return {
    schemaId: "director.entry.agent-os-projection.v1",
    source: "channel-transport",
    turnId: "entry-turn-1",
    sessionKey: "agent:director:direct:user_1",
    actorTrustLevel: "paired-channel",
    turnKind: "user-message",
    channel: {
      adapterId: "lark-im-adapter",
      channel: "lark-im",
      routeKind: "direct",
      sourceId: "user_1",
      deliveryTargetKind: "channel",
    },
    permission: {
      mode: "ask",
      approvalBoundary: "all-tools",
      remoteUnsafeCommandPolicy: "block",
    },
    sandbox: {
      verdict: "blocked",
      sandboxMode: "disabled",
      reason: "Remote channel execution is fail-closed until a runtime sandbox grants access.",
    },
    memory: {
      lane: "user",
      localOnly: true,
      enabledLayers: ["L0", "L1"],
      evidenceRequired: true,
    },
    queue: {
      lane: "session",
      mode: "enqueue",
      dropPolicy: "summarize",
    },
    timelineSummary: {
      latestState: "received",
      approvalEvents: 0,
      memoryEvents: 0,
      skillEvents: 0,
      subagentEvents: 0,
      controlPlaneEvents: 0,
      toolEvents: 0,
      finalDelivered: false,
      totalEvents: 1,
      latestEventType: "state.transition",
    },
  };
}

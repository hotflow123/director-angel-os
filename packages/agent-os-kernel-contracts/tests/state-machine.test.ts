import { describe, expect, it } from "vitest";

import {
  canTransitionAgentOsTurnState,
  isAgentOsTurnStateSnapshot,
  transitionAgentOsTurnState,
} from "../src/index.js";

describe("agent os turn state machine", () => {
  it("allows the happy-path kernel turn lifecycle", () => {
    const states = [
      "received",
      "queued",
      "preflight",
      "context_resolved",
      "model_calling",
      "tool_calling",
      "observing",
      "finalizing",
      "completed",
    ] as const;

    for (let index = 0; index < states.length - 1; index += 1) {
      expect(canTransitionAgentOsTurnState(states[index], states[index + 1])).toBe(true);
    }
  });

  it("allows approval pauses but rejects terminal-state rewinds", () => {
    expect(canTransitionAgentOsTurnState("tool_calling", "awaiting_approval")).toBe(true);
    expect(canTransitionAgentOsTurnState("awaiting_approval", "tool_calling")).toBe(true);
    expect(canTransitionAgentOsTurnState("completed", "tool_calling")).toBe(false);
    expect(canTransitionAgentOsTurnState("failed", "model_calling")).toBe(false);
  });

  it("creates immutable snapshots for legal transitions", () => {
    const snapshot = transitionAgentOsTurnState(
      {
        turnId: "turn-1",
        state: "preflight",
        updatedAt: "2026-05-08T09:00:00.000Z",
        transitionCount: 2,
      },
      "context_resolved",
      "2026-05-08T09:00:01.000Z",
    );

    expect(snapshot).toEqual({
      turnId: "turn-1",
      state: "context_resolved",
      updatedAt: "2026-05-08T09:00:01.000Z",
      transitionCount: 3,
    });
    expect(isAgentOsTurnStateSnapshot(snapshot)).toBe(true);
  });

  it("throws when a transition skips the legal lifecycle", () => {
    expect(() =>
      transitionAgentOsTurnState(
        {
          turnId: "turn-1",
          state: "received",
          updatedAt: "2026-05-08T09:00:00.000Z",
          transitionCount: 0,
        },
        "completed",
        "2026-05-08T09:00:01.000Z",
      ),
    ).toThrow(/Illegal Agent OS turn transition/u);
  });
});

import { describe, expect, test } from "vitest";

import type { DirectorBlueprintResponse } from "@hotflow/director-host-contracts";
import { ExecutionRunBuilder } from "../src/builder.ts";

describe("ExecutionRunBuilder", () => {
  test("produces a run with dependencies derived from the blueprint action graph", () => {
    const blueprint: DirectorBlueprintResponse = {
      apiVersion: "director-host-api.v1",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      blueprintId: "blueprint-1",
      review: {
        overallDecision: "pass",
        blockingReasons: [],
        requiredFixes: [],
      },
      capabilitySnapshot: {
        snapshotId: "capability-snapshot-1",
        runtimeId: "runtime-1",
        capturedAt: "2026-04-12T00:00:00.000Z",
        status: "ready",
        adapters: [],
        notes: [],
      },
      actionGraph: {
        graphId: "graph-1",
        blueprintId: "blueprint-1",
        goal: "deliver preview",
        nodes: [
          {
            nodeId: "node-1",
            assignmentId: "assignment-1",
            role: "researcher",
            objective: "Inspect the brief",
            inputs: ["snapshot"],
            outputs: ["research brief"],
            deliverable: "prepare outline",
            acceptanceCriteria: ["Goal is explicit."],
            constraints: [
              {
                field: "recalledKnowledge",
                requirement: "Apply continuity pack pack://continuity/v2.",
                priority: "required",
                rationale: "Recalled knowledge should constrain execution.",
              },
              {
                field: "skill",
                requirement: "Use approved skill skill://shot-planning.",
                priority: "preferred",
              },
            ],
            dependsOn: [],
            allowedAdapters: [],
            actionClass: "read",
            approvalMode: "auto_allow",
            escalationToDirector: false,
            status: "ready",
            selectedAdapter: "adapter-1",
          },
          {
            nodeId: "node-2",
            assignmentId: "assignment-2",
            role: "script-planner",
            objective: "Draft the shot plan",
            inputs: ["research brief"],
            outputs: ["shot plan"],
            deliverable: "draft shot plan",
            acceptanceCriteria: ["Plan is deterministic."],
            constraints: [],
            dependsOn: ["assignment-1"],
            allowedAdapters: ["adapter-2"],
            actionClass: "write",
            approvalMode: "operator_approve",
            escalationToDirector: false,
            status: "awaiting_approval",
            selectedAdapter: "adapter-2",
          },
        ],
        edges: [],
        stopConditions: [],
      },
      preview: {
        previewId: "preview-1",
        summary: "preview",
        warnings: [],
        blockedReasons: [],
        requiredApprovals: ["script-planner:assignment-2"],
      },
      handoff: {
        handoffId: "handoff-1",
        blueprintId: "blueprint-1",
        createdAt: "2026-04-12T00:00:00.000Z",
        alignmentLockId: "lock-1",
        actionGraphId: "graph-1",
        previewSummary: "preview",
        capabilityMatches: [],
        mediaRequests: [],
        expectedArtifacts: [],
        chosenAdapters: ["adapter-2"],
        sideEffectsAllowed: false,
        notes: ["preview-only"],
      },
    };

    const builder = new ExecutionRunBuilder({
      idProvider: () => "run-1",
      clock: () => "2026-04-12T00:00:00.000Z",
    });
    const run = builder.buildFromBlueprint(blueprint);

    expect(run.runId).toBe("run-1");
    expect(run.handoffId).toBe("handoff-1");
    expect(run.assignments).toHaveLength(2);
    expect(run.schemaVersion).toBe("director.execution.run.v1");
    const secondAssignment = run.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-2",
    );
    expect(secondAssignment?.dependsOn).toEqual(["assignment-1"]);
    expect(secondAssignment?.status).toBe("pending");
    expect(run.assignments[0].selectedAdapter).toBe("adapter-1");
    expect(run.assignments[0]).toMatchObject({
      inputs: ["snapshot"],
      outputs: ["research brief"],
      acceptanceCriteria: ["Goal is explicit."],
      constraints: [
        {
          field: "recalledKnowledge",
          requirement: "Apply continuity pack pack://continuity/v2.",
          priority: "required",
          rationale: "Recalled knowledge should constrain execution.",
        },
        {
          field: "skill",
          requirement: "Use approved skill skill://shot-planning.",
          priority: "preferred",
        },
      ],
    });
    expect(run.sideEffectsAllowed).toBe(false);
  });

  test("rejects cyclic assignment dependencies", () => {
    const blueprint = {
      apiVersion: "director-host-api.v1",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      blueprintId: "blueprint-1",
      review: {
        overallDecision: "pass",
        blockingReasons: [],
        requiredFixes: [],
      },
      capabilitySnapshot: {
        snapshotId: "capability-snapshot-1",
        runtimeId: "runtime-1",
        capturedAt: "2026-04-12T00:00:00.000Z",
        status: "ready",
        adapters: [],
        notes: [],
      },
      actionGraph: {
        graphId: "graph-1",
        blueprintId: "blueprint-1",
        goal: "deliver preview",
        nodes: [
          {
            nodeId: "node-1",
            assignmentId: "assignment-1",
            role: "researcher",
            objective: "Inspect the brief",
            inputs: [],
            outputs: [],
            deliverable: "brief",
            acceptanceCriteria: [],
            constraints: [],
            dependsOn: ["assignment-2"],
            allowedAdapters: [],
            actionClass: "read",
            approvalMode: "auto_allow",
            escalationToDirector: false,
            status: "ready",
          },
          {
            nodeId: "node-2",
            assignmentId: "assignment-2",
            role: "script-planner",
            objective: "Draft the plan",
            inputs: [],
            outputs: [],
            deliverable: "plan",
            acceptanceCriteria: [],
            constraints: [],
            dependsOn: ["assignment-1"],
            allowedAdapters: [],
            actionClass: "generate",
            approvalMode: "operator_approve",
            escalationToDirector: false,
            status: "awaiting_approval",
          },
        ],
        edges: [],
        stopConditions: [],
      },
      preview: {
        previewId: "preview-1",
        summary: "preview",
        warnings: [],
        blockedReasons: [],
        requiredApprovals: [],
      },
      handoff: {
        handoffId: "handoff-1",
        blueprintId: "blueprint-1",
        createdAt: "2026-04-12T00:00:00.000Z",
        alignmentLockId: "lock-1",
        actionGraphId: "graph-1",
        previewSummary: "preview",
        capabilityMatches: [],
        mediaRequests: [],
        expectedArtifacts: [],
        chosenAdapters: [],
        sideEffectsAllowed: false,
      },
    } satisfies DirectorBlueprintResponse;

    const builder = new ExecutionRunBuilder();

    expect(() => builder.buildFromBlueprint(blueprint)).toThrow(/cyclic dependency/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  assessAlignment,
  buildActionGraph,
  buildCrewDelegationGraph,
  buildDirectorControlResult,
  buildExecutionHandoffEnvelope,
  buildExecutionPlan,
  captureRuntimeCapabilitySnapshot,
  createPlan,
  evaluatePolicySafetyGate,
  lockAlignment,
} from "../src/planner.js";
import { reviewPlan } from "../src/reviewer.js";
import type { DirectorContext, ReviewStatus } from "../src/types.js";

const buildContext = (overrides: Partial<DirectorContext> = {}): DirectorContext => ({
  request: {
    requestId: "req-abc",
    projectId: "proj",
    groupId: "group-1",
    timestamp: "2026-04-11T12:00:00.000Z",
    triggerSource: "cli",
  },
  project: {
    title: "Sample Movie",
    outline: "An epic story",
    genre: ["drama"],
    continuityPriority: "high",
  },
  group: {
    groupId: "group-1",
    generationType: "new",
    sceneCount: 4,
    anchorIds: ["anchor-a"],
  },
  runtime: {
    runtimeId: "runtime-1",
    status: "ready",
    availableBindings: ["binding-a"],
    maxPromptChars: 4000,
    supportsVideo: true,
    deterministicMode: "balanced",
  },
  intent: {
    bindingPolicy: "prefer",
    preferredImageBinding: "binding-a",
    preferredVideoBinding: "binding-v",
  },
  locks: {
    lockedFields: [{ field: "project.title", level: "hard_lock", reason: "user approved" }],
  },
  knowledgeSignals: [
    { id: "sig-1", description: "maintain tone", confidence: 0.78, tags: ["tone"] },
  ],
  ...overrides,
});

describe("Director capability snapshot and alignment", () => {
  it("captures runtime capability inventory before planning", () => {
    const snapshot = captureRuntimeCapabilitySnapshot(buildContext());

    expect(snapshot.runtimeId).toBe("runtime-1");
    expect(snapshot.capabilities).toHaveLength(1);
    expect(snapshot.capabilities[0]?.bindingId).toBe("binding-a");
    expect(snapshot.capabilityTags).toContain("video-capable");
  });

  it("requires clarification when the goal is missing", () => {
    const context = buildContext({
      project: {
        title: undefined,
        outline: undefined,
        genre: ["drama"],
        continuityPriority: "high",
      },
    });
    const snapshot = captureRuntimeCapabilitySnapshot(context);
    const clarification = assessAlignment(context, snapshot);
    const alignmentLock = lockAlignment(context, clarification);

    expect(clarification.alignmentState).toBe("clarification_required");
    expect(clarification.questions.map((question) => question.field)).toContain("goal");
    expect(alignmentLock.status).toBe("pending");
  });
});

describe("Director control planning foundation", () => {
  it("produces a crew delegation graph, action graph, and handoff envelope on the ready path", () => {
    const context = buildContext();
    const snapshot = captureRuntimeCapabilitySnapshot(context);
    const clarification = assessAlignment(context, snapshot);
    const alignmentLock = lockAlignment(context, clarification);
    const plan = createPlan(context, {
      capabilitySnapshot: snapshot,
      clarification,
      alignmentLock,
    });
    const review = reviewPlan(context, plan, {
      capabilitySnapshot: snapshot,
      clarification,
      alignmentLock,
    });
    const blueprint = buildCrewDelegationGraph(
      context,
      plan,
      review,
      snapshot,
      clarification,
      alignmentLock,
    );
    const actionGraph = buildActionGraph(blueprint);
    const safetyGate = evaluatePolicySafetyGate(actionGraph);
    const handoffEnvelope = buildExecutionHandoffEnvelope(
      context,
      plan,
      blueprint,
      actionGraph,
      snapshot,
      alignmentLock,
      safetyGate,
    );

    expect(plan.status).toBe("ready");
    expect(plan.reviewStatus).toBe("pass");
    expect(review.overallDecision).toBe("warn");
    expect(blueprint.assignments.map((assignment) => assignment.role)).toEqual([
      "researcher",
      "script-planner",
      "shot-planner",
      "asset-router",
      "qc-reviewer",
    ]);
    expect(
      blueprint.assignments.every(
        (assignment) =>
          assignment.assignmentId.length > 0 &&
          assignment.deliverable.length > 0 &&
          assignment.acceptanceCriteria.length > 0 &&
          assignment.escalationToDirector.action === "replan",
      ),
    ).toBe(true);
    expect(
      blueprint.handoffs.some(
        (handoff) =>
          handoff.fromAssignmentId.includes("script-planner") &&
          handoff.toAssignmentId.includes("asset-router"),
      ),
    ).toBe(true);
    expect(actionGraph.nodes).toHaveLength(5);
    expect(actionGraph.routeDecisions).toHaveLength(5);
    expect(actionGraph.nodes.filter((node) => node.status === "awaiting_approval")).toHaveLength(3);
    expect(safetyGate.decision).toBe("review_required");
    expect(handoffEnvelope.handoffItems).toHaveLength(5);
    expect(
      handoffEnvelope.operatorPreview.summaryLines.some((line) => line.includes("asset-router")),
    ).toBe(true);
  });

  it("keeps review separate from action and handoff artifacts", () => {
    const controlResult = buildDirectorControlResult(buildContext());

    expect(controlResult.review.gates.length).toBeGreaterThan(0);
    expect(controlResult.blueprint).toBeDefined();
    expect(controlResult.actionGraph).toBeDefined();
    expect(controlResult.handoffEnvelope).toBeDefined();
    expect(controlResult.review).not.toHaveProperty("nodes");
    expect(controlResult.actionGraph).not.toHaveProperty("gates");
    expect(controlResult.handoffEnvelope).not.toHaveProperty("gates");
  });

  it("blocks the control result when runtime is offline", () => {
    const controlResult = buildDirectorControlResult(
      buildContext({
        runtime: {
          ...buildContext().runtime,
          status: "offline",
          availableBindings: [],
          supportsVideo: false,
        },
      }),
    );

    expect(controlResult.status).toBe("blocked");
    expect(controlResult.review.overallDecision).toBe("block");
    expect(controlResult.handoffEnvelope).toBeUndefined();
  });
});

describe("Legacy wrappers remain usable", () => {
  it("creates a legacy execution plan with handoff metadata", () => {
    const context = buildContext();
    const plan = createPlan(context);
    const executionPlan = buildExecutionPlan(context, plan);

    expect(executionPlan.planId).toBe(plan.planId);
    expect(executionPlan.prompt.visible).toBe(
      "Project: Sample Movie | Group: group-1 | Style: immersive | Policy: prefer | Control: ready_for_preview",
    );
    expect(executionPlan.prompt.hidden).toContain("Preview:");
    expect(executionPlan.prompt.sections).toEqual([
      {
        id: "execution.project",
        visibility: "visible",
        content: "Project: Sample Movie",
      },
      {
        id: "execution.group",
        visibility: "visible",
        content: "Group: group-1",
      },
      {
        id: "execution.style",
        visibility: "visible",
        content: "Style: immersive",
      },
      {
        id: "execution.policy",
        visibility: "visible",
        content: "Policy: prefer",
      },
      {
        id: "execution.control",
        visibility: "visible",
        content: "Control: ready_for_preview",
      },
      {
        id: "execution.anchors",
        visibility: "hidden",
        content: "Anchors: anchor-a",
      },
      {
        id: "execution.knowledge",
        visibility: "hidden",
        content: "Knowledge: sig-1:maintain tone",
      },
      {
        id: "execution.preview",
        visibility: "hidden",
        content: expect.stringContaining("Preview:"),
      },
    ]);
    expect(executionPlan.blueprintId).toBeDefined();
    expect(executionPlan.actionGraphId).toBeDefined();
    expect(executionPlan.handoffEnvelopeId).toBeDefined();
  });

  it("reports a valid gate breakdown", () => {
    const context = buildContext({ intent: { ...buildContext().intent, bindingPolicy: "prefer" } });
    const plan = createPlan(context);
    const report = reviewPlan(context, plan);

    expect(["pass", "warn"]).toContain(report.overallDecision as ReviewStatus);
    expect(report.gates.map((gate) => gate.gate)).toContain("alignment");
    expect(report.requiredFixes.length).toBeGreaterThanOrEqual(0);
  });
});

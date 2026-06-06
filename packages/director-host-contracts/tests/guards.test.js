import {
  DIRECTOR_HOST_API_VERSION,
  isDirectorEvaluateRequest,
  isDirectorEvaluateResponse,
  isDirectorHostSnapshotEnvelope,
  isDirectorKnowledgePackCatalogResponse,
  isDirectorRuntimeResponse,
} from "../src/index.js";
const makeSnapshot = () => ({
  apiVersion: DIRECTOR_HOST_API_VERSION,
  schemaId: "director.host.snapshot.v1",
  snapshotId: "snapshot-123",
  createdAt: "2026-04-11T12:00:00.000Z",
  host: {
    hostId: "host-123",
    triggerSource: "cli",
  },
  project: {
    projectId: "project-123",
    title: "Director Alpha",
  },
  group: {
    groupId: "group-123",
    generationType: "new",
    sceneCount: 3,
    anchorIds: ["anchor-a"],
  },
  runtime: {
    runtimeId: "runtime-abc",
    status: "ready",
    availableBindings: ["binding-a"],
    maxPromptChars: 4000,
    supportsVideo: true,
    deterministicMode: "balanced",
  },
  intent: {
    bindingPolicy: "prefer",
    preferredImageBinding: "binding-a",
  },
});
describe("Director host contracts guards", () => {
  it("recognizes a valid host snapshot", () => {
    expect(isDirectorHostSnapshotEnvelope(makeSnapshot())).toBe(true);
    expect(isDirectorHostSnapshotEnvelope({})).toBe(false);
  });
  it("validates evaluate request/response", () => {
    const request = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: makeSnapshot(),
    };
    expect(isDirectorEvaluateRequest(request)).toBe(true);
    expect(isDirectorEvaluateRequest({ snapshot: makeSnapshot() })).toBe(false);
    const response = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshotId: "snapshot-123",
      runtimeId: "runtime-abc",
      decision: "pass",
      summary: "Director preflight is ready.",
      recommendations: [],
      plan: {
        planId: "plan-1",
        status: "ready",
        summary: "Ready to generate.",
        confidence: 0.92,
        selectedGenerationStyle: "immersive",
        selectedImageBinding: "binding-a",
        selectedVideoBinding: null,
        riskFlags: [],
      },
      execution: {
        executionId: "execution-1",
        selectedGenerationType: "new",
        selectedGenerationStyle: "immersive",
        visiblePrompt: "Project: Director Alpha",
      },
      review: {
        overallDecision: "pass",
        blockingReasons: [],
        requiredFixes: [],
      },
    };
    expect(isDirectorEvaluateResponse(response)).toBe(true);
    expect(
      isDirectorEvaluateResponse({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshotId: "snapshot-123",
        runtimeId: "runtime-abc",
        decision: "unknown",
        summary: "fail",
        recommendations: [],
        plan: response.plan,
        execution: response.execution,
        review: response.review,
      }),
    ).toBe(false);
  });
  it("validates runtime and catalog payloads", () => {
    const runtime = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      runtimeId: "runtime-abc",
      status: "ready",
      workspaceRoot: "/workspace",
      dataDir: "/workspace/.hotflow",
      defaultProvider: "scripted",
      defaultModel: "hotflow-phase1",
      availableProviders: ["scripted"],
      knowledgePackCount: 1,
      notes: ["Director runtime ready."],
    };
    expect(isDirectorRuntimeResponse(runtime)).toBe(true);
    const response = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      knowledgePacks: [
        {
          id: "kp-1",
          title: "Sample Pack",
          version: 1,
          stage: "published",
          createdAt: "2026-04-11T12:00:00.000Z",
        },
      ],
    };
    expect(isDirectorKnowledgePackCatalogResponse(response)).toBe(true);
    expect(
      isDirectorKnowledgePackCatalogResponse({
        ...response,
        knowledgePacks: [{ ...response.knowledgePacks[0], version: "bad" }],
      }),
    ).toBe(false);
  });
});
//# sourceMappingURL=guards.test.js.map

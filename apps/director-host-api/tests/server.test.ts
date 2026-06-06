import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createChannelTransportEnvelope,
  createExperienceCandidate,
  createExperiencePromotionRecord,
  createExperienceQualityAssessment,
  createExperienceQuarantineRecord,
  createExperienceReviewDecision,
  createExperienceSourceAdapterDeclaration,
  createExperienceSourceArtifact,
} from "@hotflow/contracts";
import {
  ExternalToolExecutionQueue,
  ExternalToolRegistry,
  createBuiltInAgentOsExtensionExternalToolManifests,
  createExternalToolControlPlane,
  createOpenCliExternalToolRegistration,
} from "@hotflow/conversation-runtime";
import { FileSystemRunStore } from "@hotflow/director-execution";
import {
  DIRECTOR_HOST_API_VERSION,
  isDirectorRuntimePreflightResponse,
} from "@hotflow/director-host-contracts";
import {
  type DirectorKnowledgeSourceProposal,
  FileExperienceStore,
  FileKnowledgeStore,
  materializeDirectorKnowledgeCandidateFromProposal,
  materializeDirectorKnowledgePackFromProposal,
} from "@hotflow/director-knowledge";
import { FileSystemDirectorProposalStore } from "@hotflow/director-proposals";
import {
  type DirectorAdapterManifest,
  DirectorAdapterRegistry,
  createMockExecutionAdapter,
  createMockHostAdapter,
  createMockMediaAdapter,
  resolveDirectorSwitchState,
  updateDirectorApiProviderSetting,
  writeDirectorSwitchDocument,
} from "@hotflow/director-runtime";
import { SessionStore } from "@hotflow/sessions";
import {
  SkillSnapshotFileStore,
  SkillUsageStore,
  resolveApprovedSkillSnapshotPath,
  resolveSkillUsagePath,
} from "@hotflow/skills";
import { SessionStoreTaskPlanePort, readSessionWorkerMailbox } from "@hotflow/tasks-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockBootstrapDirectorHostApi } = vi.hoisted(() => ({
  mockBootstrapDirectorHostApi: vi.fn(),
}));

vi.mock("../src/bootstrap.js", async () => {
  const actual = await vi.importActual<typeof import("../src/bootstrap.js")>("../src/bootstrap.js");
  return {
    ...actual,
    bootstrapDirectorHostApi: mockBootstrapDirectorHostApi,
  };
});

import { createDirectorHostApiApp } from "../src/server.ts";

async function waitForObservations(
  path: string,
  minimumLines: number,
): Promise<Array<{ source: string; outcome?: { status: string } }>> {
  const started = Date.now();

  while (Date.now() - started < 3000) {
    try {
      const entries = readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { source: string; outcome?: { status: string } });
      if (entries.length >= minimumLines) {
        return entries;
      }
    } catch {
      // Wait for the async observation append to land on disk.
    }

    await delay(50);
  }

  throw new Error(`Observation file did not reach ${minimumLines} records in time.`);
}

function createMockRuntime(
  workspaceRoot: string,
  dataDir: string,
  additionalAdapters: readonly DirectorAdapterManifest[] = [],
  features: Parameters<typeof resolveDirectorSwitchState>[0]["features"] = {},
  overrides: Record<string, unknown> = {},
) {
  const switchState = resolveDirectorSwitchState({ features });
  const adapterRegistry = new DirectorAdapterRegistry([
    createMockHostAdapter({
      adapterId: "director-host-api",
      notes: [`Workspace: ${workspaceRoot}`],
    }),
    createMockMediaAdapter({
      adapterId: "scripted",
      bindingId: "binding-a",
      provider: "scripted",
      notes: ["Mock media adapter for scripted."],
    }),
    createMockExecutionAdapter({
      adapterId: "beta1-handoff-preview",
      notes: ["Preview-only execution handoff adapter."],
    }),
    ...additionalAdapters,
  ]);

  return {
    config: {
      workspaceRoot,
      dataDir,
      defaultProvider: "scripted",
      defaultModel: "hotflow-phase1",
    },
    providerIds: ["scripted"],
    apiProviders: [],
    internalPluginIds: [],
    adapterRegistry,
    runtimeCapabilitySnapshot: adapterRegistry.buildRuntimeCapabilitySnapshot({
      runtimeId: "director-host-api",
      capturedAt: "2026-04-12T00:00:00.000Z",
      runtimeStatus: "ready",
      switchState,
      notes: ["Registered 1 mock media adapter(s)."],
    }),
    switchPath: join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
    switchState,
    observationPath: join(workspaceRoot, ".director-angel", "runtime", "observations.ndjson"),
    sessionStore: {
      close: vi.fn(),
    },
    ...overrides,
  };
}

async function writeExecutionRunFixture(workspaceRoot: string) {
  const store = new FileSystemRunStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
  });
  const run = {
    schemaVersion: "director.execution.run.v1",
    runId: "run-review-1",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-1",
    handoffId: "handoff-1",
    actionGraphId: "graph-1",
    goal: "Make a production clip",
    previewSummary: "Bridge failed and needs review.",
    sideEffectsAllowed: false,
    createdAt: "2026-04-25T10:00:00.000Z",
    startedAt: "2026-04-25T10:01:00.000Z",
    updatedAt: "2026-04-25T10:02:00.000Z",
    completedAt: "2026-04-25T10:02:00.000Z",
    status: "failed",
    assignments: [
      {
        runId: "run-review-1",
        assignmentId: "assignment-review-1",
        role: "asset-router",
        objective: "Generate a production clip through an external CLI bridge.",
        deliverable: "A production clip request",
        actionClass: "generate",
        approvalMode: "operator_approve",
        dependsOn: [],
        inputs: [],
        outputs: [],
        acceptanceCriteria: [],
        constraints: [],
        status: "failed",
        selectedAdapter: "external-cli",
        allowedAdapters: ["external-cli", "fallback-cli"],
        blockingReason: "Bridge timeout",
        timeoutMs: 30000,
        createdAt: "2026-04-25T10:00:30.000Z",
        startedAt: "2026-04-25T10:01:00.000Z",
        completedAt: "2026-04-25T10:02:00.000Z",
        result: {
          runId: "run-review-1",
          assignmentId: "assignment-review-1",
          status: "failed",
          recordedAt: "2026-04-25T10:02:00.000Z",
          workerId: "worker-review-1",
          summary: "External CLI bridge timed out.",
          adapterId: "external-cli",
          bridgeExecution: {
            kind: "http-json",
            request: {
              endpointOrigin: "https://api.example.test",
              endpointPath: "/v1/render",
              method: "POST",
              timeoutMs: 30000,
              authMode: "env",
              headerKeys: ["authorization"],
              payloadBytes: 256,
            },
            failure: {
              reason: "network_timeout",
              message: "Timed out while calling external CLI.",
              retryable: true,
              statusCode: 504,
            },
          },
          notes: ["retry after operator review"],
        },
        notes: ["source trace captured"],
      },
    ],
    events: [
      {
        eventId: "event-review-1",
        runId: "run-review-1",
        type: "assignment-status-changed",
        occurredAt: "2026-04-25T10:02:00.000Z",
        message: "Assignment failed after bridge timeout.",
        metadata: {
          assignmentId: "assignment-review-1",
        },
      },
    ],
  } as const;
  await store.saveRun(run);
  await store.saveReport({
    schemaVersion: "director.execution.run.v1",
    reportId: "report-review-1",
    runId: "run-review-1",
    run,
    recordedAt: "2026-04-25T10:03:00.000Z",
    summary: ["Bridge failed and needs review."],
    flags: ["failed", "external-bridge-failed"],
    operatorSurface: {
      directorGoal: "Make a production clip",
      operatorSummary: "Bridge failed and needs review.",
      bridgeVerdict: "failed",
      bridgeFailureReason: "network_timeout",
      retryable: true,
      retryAllowed: true,
      nextAction: "review the failed bridge request before retrying.",
    },
    events: [],
  });
}

async function writeTraceProposalFixture(workspaceRoot: string) {
  const updatedAt = "2026-04-25T10:00:00.000Z";
  const store = new FileSystemDirectorProposalStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "proposals"),
    clock: () => updatedAt,
  });
  await store.writeProposal({
    schemaVersion: "director.proposal.v1",
    proposalId: "proposal-review-1",
    kind: "director.trace_capture",
    status: "pending",
    provenance: "host-api-test",
    recordId: "record-proposal-review-1",
    digestId: "digest-proposal-review-1",
    runId: "run-proposal-review-1",
    reportId: "report-proposal-review-1",
    projectId: "project-1",
    groupId: "group-1",
    title: "Review failed run",
    summary: "Capture reusable failure handling experience.",
    trigger: "failed-run",
    evidenceSummary: "Run failed after bridge timeout.",
    explanation: "Human review should decide whether to retain this lesson.",
    confidence: 0.82,
    riskLevel: "medium",
    dedupeKey: "review-failed-run",
    tags: ["review", "execution"],
    roles: ["qc-reviewer"],
    selectedAdapters: ["external-cli"],
    createdAt: updatedAt,
    updatedAt,
    sourceRecord: {
      schemaVersion: "director.memory.record.v1",
      recordId: "record-proposal-review-1",
      digestId: "digest-proposal-review-1",
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-a"],
      selectedAdapters: ["external-cli"],
      tags: ["review", "execution"],
      status: "failed",
      recordedAt: updatedAt,
      digest: {
        schemaVersion: "director.memory.trace-digest.v1",
        digestId: "digest-proposal-review-1",
        runId: "run-proposal-review-1",
        reportId: "report-proposal-review-1",
        snapshotId: "snapshot-proposal-review-1",
        runtimeId: "runtime-1",
        blueprintId: "blueprint-proposal-review-1",
        handoffId: "handoff-proposal-review-1",
        actionGraphId: "graph-proposal-review-1",
        projectId: "project-1",
        groupId: "group-1",
        goal: "Create a continuity-safe teaser.",
        previewSummary: "Bridge failed and needs review.",
        status: "failed",
        roles: ["qc-reviewer"],
        anchorIds: ["anchor-a"],
        selectedAdapters: ["external-cli"],
        observationRefs: [
          {
            observationId: "observation-evaluation-1",
            source: "evaluation",
            recordedAt: updatedAt,
          },
        ],
        assignmentStats: {
          total: 1,
          completed: 0,
          failed: 1,
          aborted: 0,
          skipped: 0,
          blocked: 0,
        },
        flags: ["failed", "external-bridge-failed"],
        eventTypes: ["assignment-status-changed"],
        createdAt: updatedAt,
        startedAt: updatedAt,
        completedAt: updatedAt,
        recordedAt: updatedAt,
        generationType: "new",
        generationStyle: "immersive",
        knowledgeSignalTags: ["continuity"],
      },
    },
  });
}

function createAcceptedProposalFixture(overrides: {
  readonly proposalId: string;
  readonly dedupeKey: string;
  readonly explanation?: string;
  readonly selectedAdapters?: readonly string[];
  readonly tags?: readonly string[];
}): DirectorKnowledgeSourceProposal {
  const tags = [...(overrides.tags ?? ["director-trace", "continuity"])];

  return {
    proposalId: overrides.proposalId,
    status: "accepted",
    recordId: `record-${overrides.proposalId}`,
    digestId: `digest-${overrides.proposalId}`,
    projectId: "project-1",
    groupId: "group-1",
    title: "Director method: Continuity-safe teaser",
    summary: "completed immersive new run",
    trigger: "When planning a continuity-safe teaser.",
    evidenceSummary: "status=completed | roles=researcher, script-planner",
    explanation:
      overrides.explanation ??
      "Use continuity-safe planning, preserve anchors, and keep the approved visual tone.",
    dedupeKey: overrides.dedupeKey,
    tags,
    roles: ["researcher", "script-planner"],
    selectedAdapters: [...(overrides.selectedAdapters ?? ["scripted"])],
    latestDecision: {
      decidedAt: "2026-04-13T09:55:00.000Z",
      note: "approved_for_publish",
    },
    sourceRecord: {
      anchorIds: ["anchor-a", "anchor-b"],
      tags,
      digest: {
        goal: "Create a continuity-safe teaser.",
        generationType: "new",
        generationStyle: "immersive",
        knowledgeSignalTags: tags,
      },
    },
  };
}

function createMaintenanceExperienceFixture(
  candidateId: string,
  sourceDigest: string,
  score: number,
) {
  const sourceAdapter = createExperienceSourceAdapterDeclaration({
    adapterId: "adapter_maintenance",
    sourceKind: "local-repository",
    sourceRef: "repo://maintenance-fixture",
    privacy: "internal",
    transformations: [
      {
        transformId: "extract-pattern",
        kind: "extract-pattern",
        summary: "Extract reusable maintenance patterns.",
      },
    ],
  });

  return {
    candidateId,
    sourceAdapter,
    title: `Maintenance fixture ${candidateId}`,
    summary: `Maintenance summary for ${candidateId}.`,
    applicability: "When Director Angel prevents learned experience bloat.",
    risks: ["Fixture only."],
    tags: ["maintenance", "learning"],
    evidence: [
      {
        evidenceId: `evidence_${candidateId}`,
        sourceRef: "fixture://maintenance",
        summary: `Evidence for ${candidateId}.`,
      },
    ],
    sourceDigest,
    quality: createExperienceQualityAssessment({
      verdict: score >= 55 ? "usable" : "quarantine",
      score,
      reasons: [`quality score ${score}`],
    }),
    privacy: "internal" as const,
    provenance: "director-host-api-test",
  };
}

describe("director-host-api", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses non-loopback listening without an explicit Host API bearer token", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-non-loopback-auth-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({ env: {} });
    let started = false;

    try {
      await app.start({ host: "0.0.0.0", port: 0 });
      started = true;
      expect(started).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("DIRECTOR_HOST_API_BEARER_TOKEN");
    } finally {
      if (started) {
        await app.close();
      }
    }
  });

  it("requires the configured Host API bearer token on requests", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-request-auth-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: { DIRECTOR_HOST_API_BEARER_TOKEN: "host-token" },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const unauthorized = await fetch(`http://${host}:${port}/v1/capabilities`);
      expect(unauthorized.status).toBe(401);

      const authorized = await fetch(`http://${host}:${port}/v1/capabilities`, {
        headers: { authorization: "Bearer host-token" },
      });
      expect(authorized.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("rejects oversized JSON bodies before parsing route payloads", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-body-limit-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/learning/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify("x".repeat(1_100_000)),
      });

      expect(response.status).toBe(413);
      const payload = (await response.json()) as { code: string };
      expect(payload.code).toBe("PAYLOAD_TOO_LARGE");
    } finally {
      await app.close();
    }
  });

  it("marks legacy entry, runs, and synchronous learning routes as deprecated", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-legacy-deprecation-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      for (const path of [
        "/v1/entry/message",
        "/v1/entry/sessions/session-legacy-1",
        "/v1/entry/sessions/session-legacy-1/blueprint",
        "/v1/runs",
        "/v1/runs/run-legacy-1/report",
        "/v1/learning/text",
        "/v1/learning/directory",
        "/v1/learning/url",
        "/v1/learning/query",
      ]) {
        const response = await fetch(`http://${host}:${port}${path}`, { method: "GET" });

        expect(response.headers.get("deprecation")).toBe("true");
        expect(response.headers.get("sunset")).toBeTruthy();
        expect(response.headers.get("link")).toContain("/v1/capabilities");
      }
    } finally {
      await app.close();
    }
  });

  it("serves runtime, intake, clarify, blueprint, evaluate, outcome, and catalog endpoints", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-1",
        createdAt: "2026-04-11T12:00:00.000Z",
        host: {
          hostId: "host-1",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-1",
          title: "Director Host API",
          outline: "做一个导演预检蓝图。",
        },
        group: {
          groupId: "group-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-a"],
        },
        runtime: {
          runtimeId: "runtime-1",
          status: "ready",
          availableBindings: ["binding-a"],
          maxPromptChars: 4096,
          supportsVideo: true,
        },
        intent: {
          bindingPolicy: "prefer",
          preferredImageBinding: "binding-a",
        },
      };
      const intake = {
        intakeId: "intake-snapshot-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["preview-safe director handoff"],
      };

      const runtimeResponse = await fetch(`http://${host}:${port}/v1/runtime`);
      expect(runtimeResponse.ok).toBe(true);
      const runtimePayload = (await runtimeResponse.json()) as {
        apiVersion: string;
        runtimeId: string;
        availableProviders: string[];
      };
      expect(runtimePayload.apiVersion).toBe(DIRECTOR_HOST_API_VERSION);
      expect(runtimePayload.runtimeId).toBe("director-host-api");
      expect(runtimePayload.availableProviders).toEqual(["scripted"]);

      const runtimeSnapshotResponse = await fetch(`http://${host}:${port}/v1/runtime/snapshot`);
      expect(runtimeSnapshotResponse.ok).toBe(true);
      const runtimeSnapshotPayload = (await runtimeSnapshotResponse.json()) as {
        apiVersion: string;
        runtimeId: string;
        capabilitySnapshot: { runtimeId: string; adapters: unknown[] };
      };
      expect(runtimeSnapshotPayload.apiVersion).toBe(DIRECTOR_HOST_API_VERSION);
      expect(runtimeSnapshotPayload.runtimeId).toBe("director-host-api");
      expect(runtimeSnapshotPayload.capabilitySnapshot.runtimeId).toBe("director-host-api");
      expect(Array.isArray(runtimeSnapshotPayload.capabilitySnapshot.adapters)).toBe(true);
      expect(runtimeSnapshotPayload.capabilitySnapshot.adapters).toHaveLength(3);

      const intakeResponse = await fetch(`http://${host}:${port}/v1/intake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
        }),
      });
      expect(intakeResponse.ok).toBe(true);
      const intakePayload = (await intakeResponse.json()) as {
        intakeId: string;
        clarification: { decision: string };
        alignmentState: string;
        capabilitySnapshot: { adapters: Array<{ adapterId: string }> };
      };
      expect(intakePayload.intakeId).toBe(intake.intakeId);
      expect(intakePayload.clarification.decision).toBe("ready");
      expect(intakePayload.alignmentState).toBe("locked");
      expect(
        intakePayload.capabilitySnapshot.adapters.some(
          (adapter: { adapterId: string }) => adapter.adapterId === "scripted",
        ),
      ).toBe(true);

      const clarifyResponse = await fetch(`http://${host}:${port}/v1/clarify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          answers: [],
        }),
      });
      expect(clarifyResponse.ok).toBe(true);
      const clarifyPayload = (await clarifyResponse.json()) as {
        clarification: { decision: string };
        alignmentState: string;
      };
      expect(clarifyPayload.clarification.decision).toBe("ready");
      expect(clarifyPayload.alignmentState).toBe("locked");

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-intake-snapshot-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...(intake.deliverables ?? [])],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });
      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as {
        blueprintId: string;
        handoff: { handoffId: string; blueprintId: string; sideEffectsAllowed: boolean };
        actionGraph: { nodes: unknown[]; graphId: string };
      };
      expect(blueprintPayload.blueprintId).toContain("blueprint-");
      expect(blueprintPayload.handoff.handoffId).toContain("handoff-");
      expect(blueprintPayload.handoff.blueprintId).toBe(blueprintPayload.blueprintId);
      expect(blueprintPayload.handoff.sideEffectsAllowed).toBe(false);
      expect(Array.isArray(blueprintPayload.actionGraph.nodes)).toBe(true);

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blueprintPayload),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as {
        runId: string;
        blueprintId: string;
        handoffId: string;
        assignments: Array<{ assignmentId: string }>;
      };
      expect(runPayload.blueprintId).toBe(blueprintPayload.blueprintId);
      expect(runPayload.handoffId).toBe(blueprintPayload.handoff.handoffId);
      expect(runPayload.assignments.length).toBeGreaterThan(0);

      const getRunResponse = await fetch(`http://${host}:${port}/v1/runs/${runPayload.runId}`);
      expect(getRunResponse.ok).toBe(true);
      const storedRunPayload = (await getRunResponse.json()) as { runId: string };
      expect(storedRunPayload.runId).toBe(runPayload.runId);

      const evaluateResponse = await fetch(`http://${host}:${port}/v1/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
        }),
      });
      expect(evaluateResponse.ok).toBe(true);
      const evaluatePayload = (await evaluateResponse.json()) as {
        decision: string;
        plan: { planId: string };
      };
      expect(evaluatePayload.decision).toBe("pass");
      expect(evaluatePayload.plan.planId).toContain("plan-");

      const blueprintId = blueprintPayload.blueprintId;
      const outcomeId = `outcome-${Date.now()}`;
      const recordedAt = new Date().toISOString();
      const outcomeResponse = await fetch(`http://${host}:${port}/v1/outcome`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshotId: "snapshot-1",
          blueprintId,
          handoffId: blueprintPayload.handoff.handoffId,
          outcome: {
            outcomeId,
            status: "accepted",
            recordedAt,
            notes: "operator approved preview",
          },
        }),
      });
      expect(outcomeResponse.ok).toBe(true);
      const outcomePayload = (await outcomeResponse.json()) as {
        snapshotId: string;
        blueprintId: string;
        handoffId: string;
        stored: boolean;
        outcome: { status: string; outcomeId: string; recordedAt: string };
      };
      expect(outcomePayload.snapshotId).toBe("snapshot-1");
      expect(outcomePayload.blueprintId).toBe(blueprintId);
      expect(outcomePayload.handoffId).toBe(blueprintPayload.handoff.handoffId);
      expect(outcomePayload.stored).toBe(true);
      expect(outcomePayload.outcome.status).toBe("accepted");
      expect(outcomePayload.outcome.outcomeId).toBe(outcomeId);
      expect(outcomePayload.outcome.recordedAt).toBe(recordedAt);

      const observationPath = join(
        workspaceRoot,
        ".director-angel",
        "runtime",
        "observations.ndjson",
      );
      const observations = await waitForObservations(observationPath, 5);
      expect(observations.length).toBeGreaterThanOrEqual(5);
      expect(observations.some((entry) => entry.source === "evaluation")).toBe(true);
      expect(
        observations.some(
          (entry) => entry.source === "outcome" && entry.outcome?.status === "accepted",
        ),
      ).toBe(true);

      const catalogResponse = await fetch(`http://${host}:${port}/v1/catalog/knowledge-packs`);
      expect(catalogResponse.ok).toBe(true);
      const catalogPayload = (await catalogResponse.json()) as {
        knowledgePacks: unknown[];
      };
      expect(Array.isArray(catalogPayload.knowledgePacks)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("exposes configured API provider status on health without leaking secrets", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-provider-health-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const providersRoot = join(workspaceRoot, ".director-angel", "providers");
    await updateDirectorApiProviderSetting(providersRoot, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "test-key",
      now: "2026-05-12T11:00:00.000Z",
    });
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/health`);
      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        apiProviders?: Array<{
          id: string;
          enabled: boolean;
          apiKeyConfigured: boolean;
          modelCount: number;
          capabilities: string[];
          defaultModels: Record<string, string>;
        }>;
      };

      expect(payload.apiProviders).toEqual([
        expect.objectContaining({
          id: "memefast-api",
          enabled: true,
          apiKeyConfigured: true,
          modelCount: expect.any(Number),
          capabilities: expect.arrayContaining(["text", "image_generation", "video_generation"]),
          defaultModels: expect.objectContaining({
            text: "gemini-2.5-flash",
          }),
        }),
      ]);
      expect(payload.apiProviders?.[0]?.modelCount).toBeGreaterThan(40);
      expect(JSON.stringify(payload)).not.toContain("test-key");
      expect(JSON.stringify(payload)).not.toContain("apiKeyMasked");
    } finally {
      await app.close();
    }
  });

  it("exposes execution runs through the unified client runtime protocol", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-client-runtime-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-client-runtime-1",
        createdAt: "2026-04-11T12:00:00.000Z",
        host: {
          hostId: "host-1",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-1",
          title: "Director Client Runtime",
          outline: "验证统一客户端运行控制面。",
        },
        group: {
          groupId: "group-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-a"],
        },
        runtime: {
          runtimeId: "runtime-1",
          status: "ready",
          availableBindings: ["binding-a"],
          maxPromptChars: 4096,
          supportsVideo: true,
        },
        intent: {
          bindingPolicy: "prefer",
          preferredImageBinding: "binding-a",
        },
      };
      const intake = {
        intakeId: "intake-client-runtime-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["preview-safe director handoff"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-client-runtime-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...(intake.deliverables ?? [])],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });
      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as {
        blueprintId: string;
        handoff: { handoffId: string };
      };

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blueprintPayload),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as {
        runId: string;
        status: string;
      };

      const startResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/start`,
        { method: "POST" },
      );
      expect(startResponse.ok).toBe(true);

      const clientRuntimeResponse = await fetch(
        `http://${host}:${port}/v1/client-runtime?activeOnly=true&clientSurface=weixin`,
      );
      expect(clientRuntimeResponse.ok).toBe(true);
      const clientRuntimePayload = (await clientRuntimeResponse.json()) as {
        schemaId: string;
        clientRuntime: {
          schemaVersion: string;
          clientSurface: string;
          originRuntime: string;
          activeCount: number;
          tasks: Array<{
            id: string;
            originRuntime: string;
            status: string;
            controls: { read: boolean; stop: boolean; steer: boolean; followup: boolean };
            payload: { hostRunId: string };
          }>;
        };
      };
      expect(clientRuntimePayload).toMatchObject({
        schemaId: "director.host.client-runtime.v1",
        clientRuntime: {
          schemaVersion: "director.client-runtime.v1",
          clientSurface: "weixin",
          originRuntime: "host.executionRun",
          activeCount: 1,
          tasks: [
            expect.objectContaining({
              id: runPayload.runId,
              originRuntime: "host.executionRun",
              status: "running",
              controls: {
                read: true,
                stop: true,
                steer: false,
                followup: true,
              },
              payload: expect.objectContaining({ hostRunId: runPayload.runId }),
            }),
          ],
        },
      });

      const clientRuntimeReadResponse = await fetch(
        `http://${host}:${port}/v1/client-runtime/tasks/${encodeURIComponent(runPayload.runId)}?clientSurface=weixin`,
      );
      expect(clientRuntimeReadResponse.ok).toBe(true);
      const clientRuntimeReadPayload = (await clientRuntimeReadResponse.json()) as {
        clientRuntimeTask: { schemaVersion: string; id: string; status: string };
      };
      expect(clientRuntimeReadPayload.clientRuntimeTask).toMatchObject({
        schemaVersion: "director.client-runtime.task.v1",
        id: runPayload.runId,
        status: "running",
        controls: expect.objectContaining({
          steer: false,
          followup: true,
        }),
      });

      const clientRuntimeFollowupResponse = await fetch(
        `http://${host}:${port}/v1/client-runtime/tasks/${encodeURIComponent(runPayload.runId)}/followup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: "operator continued through host client runtime",
            clientSurface: "weixin",
          }),
        },
      );
      expect(clientRuntimeFollowupResponse.ok).toBe(true);
      const clientRuntimeFollowupPayload = (await clientRuntimeFollowupResponse.json()) as {
        clientRuntimeFollowup: {
          schemaVersion: string;
          accepted: boolean;
          continued: number;
          taskIds: string[];
          originRuntime: string;
          approvedAssignmentIds: string[];
        };
        run: { status: string };
      };
      expect(clientRuntimeFollowupPayload.clientRuntimeFollowup).toMatchObject({
        schemaVersion: "director.client-runtime.followup.v1",
        accepted: true,
        continued: 1,
        taskIds: [runPayload.runId],
        originRuntime: "host.executionRun",
      });
      expect(clientRuntimeFollowupPayload.run.status).toBe("running");

      const clientRuntimeSteerResponse = await fetch(
        `http://${host}:${port}/v1/client-runtime/tasks/${encodeURIComponent(runPayload.runId)}/steer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instruction: "中途改成另一个制作目标",
            clientSurface: "weixin",
          }),
        },
      );
      expect(clientRuntimeSteerResponse.ok).toBe(true);
      const clientRuntimeSteerPayload = (await clientRuntimeSteerResponse.json()) as {
        clientRuntimeSteer: {
          schemaVersion: string;
          accepted: boolean;
          status: string;
          reason: string;
          originRuntime: string;
        };
      };
      expect(clientRuntimeSteerPayload.clientRuntimeSteer).toMatchObject({
        schemaVersion: "director.client-runtime.steer.v1",
        accepted: false,
        status: "unsupported",
        originRuntime: "host.executionRun",
      });
      expect(clientRuntimeSteerPayload.clientRuntimeSteer.reason).toContain("不支持中途改指令");

      const clientRuntimeStopResponse = await fetch(
        `http://${host}:${port}/v1/client-runtime/tasks/${encodeURIComponent(runPayload.runId)}/stop`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: "operator stopped through host client runtime",
            clientSurface: "weixin",
          }),
        },
      );
      expect(clientRuntimeStopResponse.ok).toBe(true);
      const clientRuntimeStopPayload = (await clientRuntimeStopResponse.json()) as {
        clientRuntimeStop: {
          schemaVersion: string;
          stopped: number;
          taskIds: string[];
          originRuntime: string;
        };
        run: { status: string };
      };
      expect(clientRuntimeStopPayload.clientRuntimeStop).toMatchObject({
        schemaVersion: "director.client-runtime.stop.v1",
        stopped: 1,
        taskIds: [runPayload.runId],
        originRuntime: "host.executionRun",
      });
      expect(clientRuntimeStopPayload.run.status).toBe("aborted");
    } finally {
      await app.close();
    }
  });

  it("loads compact long-term memory files into blueprint planning constraints", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-long-memory-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const memoryDir = join(workspaceRoot, ".director-angel", "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, "MEMORY.md"),
      [
        "# Project Memory",
        "",
        "- Keep anchor-a visible in the opening shot.",
        "- Avoid comic timing for continuity-safe teasers.",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(memoryDir, "USER.md"),
      [
        "# User Memory",
        "",
        "- Prefers concise production plans.",
        "- Dislikes loose visual drift.",
      ].join("\n"),
      "utf8",
    );
    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(workspaceRoot, dataDir, [], { "memory.enabled": true }),
    );
    writeDirectorSwitchDocument(
      join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
      {
        schemaId: "director.switches.v1",
        features: {
          "memory.enabled": true,
        },
      },
    );
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-long-memory-1",
        createdAt: "2026-04-11T12:00:00.000Z",
        host: {
          hostId: "host-1",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-1",
          title: "Director Host API",
          outline: "Create a continuity-safe teaser.",
        },
        group: {
          groupId: "group-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-a"],
        },
        runtime: {
          runtimeId: "runtime-1",
          status: "ready",
          availableBindings: ["binding-a"],
          maxPromptChars: 4096,
          supportsVideo: true,
        },
        intent: {
          bindingPolicy: "prefer",
          preferredImageBinding: "binding-a",
        },
      };
      const intake = {
        intakeId: "intake-long-memory-1",
        submittedAt: snapshot.createdAt,
        objective: "Create a continuity-safe teaser.",
        desiredOutcome: "A compact teaser storyboard.",
        deliverables: ["storyboard"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-intake-long-memory-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...intake.deliverables],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });

      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as {
        actionGraph: {
          nodes: Array<{ constraints: Array<{ requirement: string }> }>;
          stopConditions: string[];
        };
      };
      const constraintText = blueprintPayload.actionGraph.nodes
        .flatMap((node) => node.constraints.map((constraint) => constraint.requirement))
        .join("\n");
      expect(constraintText).toContain("long-term-memory:memory");
      expect(constraintText).toContain("Keep anchor-a visible");
      expect(constraintText).toContain("long-term-memory:user");
      expect(constraintText).toContain("concise production plans");
      expect(blueprintPayload.actionGraph.stopConditions).toEqual(
        expect.arrayContaining(["long-term-memory=hit"]),
      );
    } finally {
      await app.close();
    }
  });

  it("exposes unified read-only backend catalogs for knowledge, experience, and skills", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-catalog-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const knowledgeDir = join(workspaceRoot, ".director-angel", "knowledge");
    const knowledgeStore = new FileKnowledgeStore({ knowledgeDir });
    const publishedProposal = createAcceptedProposalFixture({
      proposalId: "proposal-published-catalog",
      dedupeKey: "catalog__published__continuity",
    });
    const published = materializeDirectorKnowledgePackFromProposal(publishedProposal, {
      author: "host-api-test",
      note: "seed published catalog",
      now: "2026-04-30T00:00:00.000Z",
    });
    await knowledgeStore.publish(published);
    const currentPublished = await knowledgeStore.getPublished(published.metadata.id);
    const candidate = materializeDirectorKnowledgeCandidateFromProposal(
      createAcceptedProposalFixture({
        proposalId: "proposal-candidate-catalog",
        dedupeKey: "catalog__published__continuity",
        explanation: "Update the continuity method with stronger review notes.",
      }),
      {
        currentPublished,
        author: "host-api-test",
        note: "seed candidate catalog",
        now: "2026-04-30T00:01:00.000Z",
      },
    );
    await knowledgeStore.writeCandidate(candidate);

    const experienceStore = new FileExperienceStore({
      experienceDir: join(knowledgeDir, "experience"),
    });
    const experienceCandidate = createExperienceCandidate({
      candidateId: "experience_catalog_1",
      sourceAdapter: createExperienceSourceAdapterDeclaration({
        adapterId: "adapter_catalog",
        sourceKind: "manual",
        sourceRef: "fixture://host-api/catalog",
        privacy: "internal",
        transformations: [
          {
            transformId: "summarize",
            kind: "summarize",
            summary: "Summarize the catalog fixture.",
          },
        ],
      }),
      title: "Catalog experience fixture",
      summary: "Reusable experience candidate for host API catalog tests.",
      applicability: "When external surfaces need to inspect reviewed learning inputs.",
      risks: ["Fixture only."],
      tags: ["catalog", "fixture"],
      evidence: [
        {
          evidenceId: "evidence_experience_catalog_1",
          sourceRef: "fixture://host-api/catalog",
          summary: "Fixture evidence for unified catalog exposure.",
        },
      ],
      privacy: "internal",
      provenance: "director-host-api-test",
      createdAtMs: 1_776_000_000_000,
    });
    await experienceStore.writeCandidate(experienceCandidate);

    const skillStore = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
      now: () => 1_776_000_000_100,
    });
    skillStore.writeApproved([
      {
        id: "skill.catalog.fixture",
        version: "1.0.0",
        title: "Catalog Fixture Skill",
        content: "Use this fixture skill when testing unified Host API catalogs.",
        tags: ["catalog", "fixture"],
        toolNames: ["read"],
        updatedAtMs: 1_776_000_000_000,
      },
    ]);
    new SkillUsageStore(resolveSkillUsagePath({ dataDir })).recordUse("skill.catalog.fixture", {
      actor: "host-catalog-test",
      reason: "verify catalog usage exposure",
      nowMs: 1_776_000_000_200,
    });

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const knowledgePacksResponse = await fetch(`http://${host}:${port}/v1/knowledge/packs`);
      expect(knowledgePacksResponse.ok).toBe(true);
      const knowledgePacksPayload = (await knowledgePacksResponse.json()) as {
        apiVersion: string;
        knowledgePacks: Array<{ metadata: { id: string }; stage: string }>;
      };
      expect(knowledgePacksPayload.apiVersion).toBe(DIRECTOR_HOST_API_VERSION);
      expect(knowledgePacksPayload.knowledgePacks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({ id: published.metadata.id }),
            stage: "published",
          }),
        ]),
      );

      const knowledgeCandidatesResponse = await fetch(
        `http://${host}:${port}/v1/knowledge/candidates`,
      );
      expect(knowledgeCandidatesResponse.ok).toBe(true);
      const knowledgeCandidatesPayload = (await knowledgeCandidatesResponse.json()) as {
        knowledgeCandidates: Array<{ metadata: { id: string }; stage: string }>;
      };
      expect(knowledgeCandidatesPayload.knowledgeCandidates).toEqual([
        expect.objectContaining({
          metadata: expect.objectContaining({ id: candidate.metadata.id }),
          stage: "candidate",
        }),
      ]);

      const experienceCandidatesResponse = await fetch(
        `http://${host}:${port}/v1/experience/candidates`,
      );
      expect(experienceCandidatesResponse.ok).toBe(true);
      const experienceCandidatesPayload = (await experienceCandidatesResponse.json()) as {
        experienceCandidates: Array<{ candidateId: string; runtimeInjection: string }>;
      };
      expect(experienceCandidatesPayload.experienceCandidates).toEqual([
        expect.objectContaining({
          candidateId: experienceCandidate.candidateId,
          runtimeInjection: "disabled",
        }),
      ]);

      const skillsResponse = await fetch(`http://${host}:${port}/v1/skills`);
      expect(skillsResponse.ok).toBe(true);
      const skillsPayload = (await skillsResponse.json()) as {
        skillUsage?: {
          records?: Record<string, unknown>;
        };
        skills: Array<{ id: string; title: string; usage?: { useCount?: number } | null }>;
      };
      expect(skillsPayload.skills).toEqual([
        expect.objectContaining({
          id: "skill.catalog.fixture",
          title: "Catalog Fixture Skill",
          usage: expect.objectContaining({
            useCount: 1,
            lastUsedAtMs: 1_776_000_000_200,
          }),
        }),
      ]);
      expect(skillsPayload.skillUsage?.records?.["skill.catalog.fixture"]).toMatchObject({
        useCount: 1,
      });

      const indexedSkillsResponse = await fetch(
        `http://${host}:${port}/v1/skills?query=${encodeURIComponent("catalog fixture")}&limit=1`,
      );
      expect(indexedSkillsResponse.ok).toBe(true);
      const indexedSkillsPayload = (await indexedSkillsResponse.json()) as {
        skillIndex?: { skillIds?: string[]; query?: string; limit?: number };
        skills: Array<{ id: string }>;
      };
      expect(indexedSkillsPayload.skillIndex).toMatchObject({
        query: "catalog fixture",
        limit: 1,
        skillIds: ["skill.catalog.fixture"],
      });
      expect(indexedSkillsPayload.skills).toEqual([
        expect.objectContaining({ id: "skill.catalog.fixture" }),
      ]);

      const catalogResponse = await fetch(`http://${host}:${port}/v1/catalog`);
      expect(catalogResponse.ok).toBe(true);
      const catalogPayload = (await catalogResponse.json()) as {
        apiVersion: string;
        schemaId: string;
        knowledgePacks: unknown[];
        knowledgeCandidates: unknown[];
        experienceCandidates: unknown[];
        skillUsage?: {
          records?: Record<string, unknown>;
        };
        skills: Array<{ id?: string; usage?: { useCount?: number } | null }>;
      };
      expect(catalogPayload.apiVersion).toBe(DIRECTOR_HOST_API_VERSION);
      expect(catalogPayload.schemaId).toBe("director.host.catalog.v1");
      expect(catalogPayload.knowledgePacks).toHaveLength(1);
      expect(catalogPayload.knowledgeCandidates).toHaveLength(1);
      expect(catalogPayload.experienceCandidates).toHaveLength(1);
      expect(catalogPayload.skills).toHaveLength(1);
      expect(catalogPayload.skills[0]).toMatchObject({
        id: "skill.catalog.fixture",
        usage: expect.objectContaining({ useCount: 1 }),
      });
      expect(catalogPayload.skillUsage?.records?.["skill.catalog.fixture"]).toMatchObject({
        useCount: 1,
      });

      const methodResponse = await fetch(`http://${host}:${port}/v1/catalog`, {
        method: "POST",
      });
      expect(methodResponse.status).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("exposes OpenClaw-style external tool catalog, effective, and invoke endpoints", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-tools-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register({
      manifest: {
        id: "web_search",
        label: "web_search",
        description: "Search public web sources.",
        source: "built-in",
        kind: "model-tool",
        providerId: "web",
        capabilities: [{ id: "web.search", label: "Search", readOnly: true }],
      },
      check: () => ({ status: "ready", summary: "Web search ready." }),
      invoke: (request) => ({
        ok: true,
        content: `searched ${String(request.args?.query ?? "")}`,
        output: { resultCount: 1 },
      }),
    });
    registry.register({
      manifest: {
        id: "x_search",
        label: "x_search",
        description: "Search X/Twitter.",
        source: "external",
        kind: "model-tool",
        providerId: "x",
        capabilities: [{ id: "x.search", label: "Search", readOnly: true }],
      },
      check: () => ({ status: "needs-auth", summary: "X provider needs an API key." }),
    });

    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(
        workspaceRoot,
        dataDir,
        [],
        {},
        {
          externalToolControlPlane: createExternalToolControlPlane(registry),
        },
      ),
    );
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const capabilitiesResponse = await fetch(`http://${host}:${port}/v1/capabilities`);
      expect(capabilitiesResponse.ok).toBe(true);
      await expect(capabilitiesResponse.json()).resolves.toMatchObject({
        tools: {
          catalog: true,
          effective: true,
          invoke: true,
        },
      });

      const catalogResponse = await fetch(`http://${host}:${port}/v1/tools/catalog`);
      expect(catalogResponse.ok).toBe(true);
      await expect(catalogResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.catalog.v1",
        catalogCount: 2,
        groups: expect.arrayContaining([
          expect.objectContaining({
            id: "web",
            tools: [expect.objectContaining({ id: "web_search" })],
          }),
        ]),
      });

      const effectiveResponse = await fetch(
        `http://${host}:${port}/v1/tools/effective?sessionKey=desktop-main&includeUnavailable=true`,
      );
      expect(effectiveResponse.ok).toBe(true);
      await expect(effectiveResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.effective.v1",
        sessionKey: "desktop-main",
        effectiveCount: 1,
        unavailableCount: 1,
        tools: expect.arrayContaining([
          expect.objectContaining({ id: "web_search", canInvoke: true }),
          expect.objectContaining({ id: "x_search", status: "needs-auth", canInvoke: false }),
        ]),
      });

      const invokeResponse = await fetch(`http://${host}:${port}/v1/tools/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "web_search",
          action: "web.search",
          args: { query: "seedance" },
          sessionKey: "desktop-main",
        }),
      });
      expect(invokeResponse.ok).toBe(true);
      await expect(invokeResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.invoke.v1",
        ok: true,
        toolName: "web_search",
        status: "success",
        output: { resultCount: 1 },
      });
    } finally {
      await app.close();
    }
  });

  it("exposes provider health, caps, approval boundary, and lastKnownGood in effective matrix", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-provider-matrix-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    let xReady = true;
    const registry = new ExternalToolRegistry({
      nowMs: () => 1_776_000_000_000,
      doctorTtlMs: 0,
    });
    registry.register({
      manifest: {
        id: "x_search",
        label: "x_search",
        description: "Search X/Twitter.",
        source: "external",
        kind: "model-tool",
        providerId: "x-twitter",
        capabilities: [{ id: "x.search", label: "Search", readOnly: true }],
        approvalBoundary: {
          mode: "operator-confirm",
          summary: "Read public X posts only after provider boundary is clear.",
          requiresOperator: true,
          riskLevel: "medium",
        },
      },
      check: () =>
        xReady
          ? { status: "ready", summary: "X provider ready." }
          : {
              status: "needs-auth",
              summary: "X provider token expired.",
              nextActions: ["配置 X/Twitter provider token。"],
            },
    });
    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(
        workspaceRoot,
        dataDir,
        [],
        {},
        {
          externalToolControlPlane: createExternalToolControlPlane(registry),
        },
      ),
    );
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const readyResponse = await fetch(
        `http://${host}:${port}/v1/tools/effective?includeUnavailable=true`,
      );
      expect(readyResponse.ok).toBe(true);
      await expect(readyResponse.json()).resolves.toMatchObject({
        providerMatrix: {
          providers: [
            expect.objectContaining({
              providerId: "x-twitter",
              health: expect.objectContaining({ status: "ready" }),
              capabilities: [expect.objectContaining({ id: "x.search" })],
              approvalBoundary: expect.objectContaining({
                mode: "operator-confirm",
                requiresOperator: true,
                riskLevel: "medium",
              }),
            }),
          ],
        },
      });

      xReady = false;
      registry.refresh("x_search");
      const degradedResponse = await fetch(
        `http://${host}:${port}/v1/tools/effective?includeUnavailable=true`,
      );
      expect(degradedResponse.ok).toBe(true);
      await expect(degradedResponse.json()).resolves.toMatchObject({
        providerMatrix: {
          providers: [
            expect.objectContaining({
              providerId: "x-twitter",
              health: expect.objectContaining({ status: "needs-auth" }),
              lastKnownGood: expect.objectContaining({ status: "ready" }),
            }),
          ],
        },
      });
    } finally {
      await app.close();
    }
  });

  it("exposes OpenCLI through the shared Host API tool boundary with model-tool projection metadata", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-opencli-tools-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    const runnerCalls: Array<{ binary: string; args: readonly string[] }> = [];
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "hackernews",
            name: "top",
            description: "Read Hacker News top stories.",
            access: "read",
            args: [{ name: "limit", type: "int", required: false }],
          },
        ],
        runner: async (input) => {
          runnerCalls.push({ binary: input.binary, args: input.args });
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ title: "Host API OpenCLI story" }]),
            stderr: "",
          };
        },
      }),
    );

    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(
        workspaceRoot,
        dataDir,
        [],
        {},
        {
          externalToolControlPlane: createExternalToolControlPlane(registry),
        },
      ),
    );
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const catalogResponse = await fetch(`http://${host}:${port}/v1/tools/catalog`);
      expect(catalogResponse.ok).toBe(true);
      await expect(catalogResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.catalog.v1",
        catalog: expect.arrayContaining([
          expect.objectContaining({
            id: "opencli.local",
            providerId: "opencli",
            metadata: expect.objectContaining({
              modelToolNames: ["director.opencli.list", "director.opencli.invoke"],
            }),
            capabilities: expect.arrayContaining([
              expect.objectContaining({
                id: "opencli.list",
                metadata: expect.objectContaining({
                  modelToolName: "director.opencli.list",
                }),
              }),
              expect.objectContaining({
                id: "opencli.hackernews.top",
                metadata: expect.objectContaining({
                  modelToolName: "director.opencli.invoke",
                  access: "read",
                }),
              }),
            ]),
          }),
        ]),
      });

      const effectiveResponse = await fetch(
        `http://${host}:${port}/v1/tools/effective?sessionKey=weixin%3Abot%3Afriend&profile=weixin&includeUnavailable=true`,
      );
      expect(effectiveResponse.ok).toBe(true);
      await expect(effectiveResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.effective.v1",
        sessionKey: "weixin:bot:friend",
        profile: "weixin",
        tools: expect.arrayContaining([
          expect.objectContaining({
            id: "opencli.local",
            canInvoke: true,
            metadata: expect.objectContaining({
              modelToolNames: ["director.opencli.list", "director.opencli.invoke"],
            }),
          }),
        ]),
      });

      const listResponse = await fetch(`http://${host}:${port}/v1/tools/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId: "opencli.local",
          operationId: "opencli.list",
          args: { site: "hackernews" },
          sessionKey: "weixin:bot:friend",
        }),
      });
      expect(listResponse.ok).toBe(true);
      await expect(listResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.invoke.v1",
        ok: true,
        toolId: "opencli.local",
        operationId: "opencli.list",
        output: {
          entries: [
            expect.objectContaining({
              site: "hackernews",
              name: "top",
              access: "read",
            }),
          ],
        },
      });

      const invokeResponse = await fetch(`http://${host}:${port}/v1/tools/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId: "opencli.local",
          operationId: "opencli.hackernews.top",
          args: { limit: 3 },
          sessionKey: "weixin:bot:friend",
        }),
      });
      expect(invokeResponse.ok).toBe(true);
      await expect(invokeResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.invoke.v1",
        ok: true,
        toolId: "opencli.local",
        operationId: "opencli.hackernews.top",
        content: expect.stringContaining("Host API OpenCLI story"),
        output: {
          json: [{ title: "Host API OpenCLI story" }],
        },
        metadata: expect.objectContaining({
          sourceKind: "opencli",
          sourceRef: "opencli:hackernews/top",
          sourceAccessStatus: "available",
        }),
      });
      expect(runnerCalls.at(-1)).toEqual({
        binary: "opencli",
        args: ["hackernews", "top", "--limit", "3", "--format", "json"],
      });
    } finally {
      await app.close();
    }
  });

  it("passes Agent OS sandbox planning fields through the Host API tools invoke boundary", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-tool-sandbox-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "terminal",
        label: "Terminal",
        description: "Terminal bridge.",
        source: "external",
        kind: "model-tool",
        providerId: "terminal",
        capabilities: [
          {
            id: "shell.exec",
            label: "Shell exec",
            readOnly: false,
            requiresApproval: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Terminal ready." }),
      invoke: () => ({ ok: true, content: "executed" }),
    });
    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(
        workspaceRoot,
        dataDir,
        [],
        {},
        {
          externalToolControlPlane: createExternalToolControlPlane(registry),
        },
      ),
    );
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const invokeResponse = await fetch(`http://${host}:${port}/v1/tools/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId: "terminal",
          operationId: "shell.exec",
          args: { command: "echo ok" },
          command: "echo ok",
          cwd: `${workspaceRoot}/runs/job-1`,
          sessionKey: "desktop-main",
          sandboxPolicy: {
            defaultMutatingSandboxMode: "workspace-write",
            filesystemScope: [workspaceRoot],
            networkAccess: "none",
          },
        }),
      });
      expect(invokeResponse.ok).toBe(true);
      await expect(invokeResponse.json()).resolves.toMatchObject({
        schemaVersion: "director.external-tools.invoke.v1",
        ok: false,
        status: "approval-required",
        approval: expect.objectContaining({
          metadata: expect.objectContaining({
            agentOsSandboxExecutionPlan: expect.objectContaining({
              ok: true,
              backend: "workspace-write",
              cwd: `${workspaceRoot}/runs/job-1`,
              riskSummary: expect.objectContaining({
                toolName: "terminal",
                operationId: "shell.exec",
                command: "echo ok",
                filesystem: expect.objectContaining({
                  writableRoots: [workspaceRoot],
                }),
              }),
            }),
          }),
        }),
      });
    } finally {
      await app.close();
    }
  });

  it("surfaces Agent OS process capability ledger in runtime snapshot responses", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-runtime-ledger-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const registry = new ExternalToolRegistry({
      sandboxBackends: {
        enabledBackends: ["host"],
        adapters: [
          {
            id: "agent-os-sandbox.host",
            mode: "host",
            admit: (plan) => ({
              ok: true,
              status: "admitted",
              backend: "host",
              providerId: "agent-os-sandbox.host",
              cwd: plan.cwd,
              networkPolicy: plan.networkPolicy,
              filesystem: {
                readableRoots: plan.readableRoots,
                writableRoots: plan.writableRoots,
              },
              enforcement: {
                filesystem: "host-explicit",
                network: "network-none",
                process: "host-process",
              },
              backendConfig: {
                commandPattern: {
                  executable: "echo",
                  argv: ["ok"],
                  operationId: "host-ledger-smoke",
                },
              },
              planHash: "host-ledger-plan",
            }),
            execute: () => ({
              ok: true,
              status: "completed",
              backend: "host",
              providerId: "agent-os-sandbox.host",
              exitCode: 0,
              stdout: "ok",
              evidence: {
                backend: "host",
                providerId: "agent-os-sandbox.host",
                planHash: "host-ledger-plan",
                commandHash: "host-ledger-command",
                cwd: workspaceRoot,
                networkPolicy: "none",
                filesystem: {
                  readableRoots: [workspaceRoot],
                  writableRoots: [workspaceRoot],
                },
                enforcement: {
                  filesystem: "host-explicit",
                  network: "network-none",
                  process: "host-process",
                },
                backendConfig: {
                  commandPattern: {
                    executable: "echo",
                    argv: ["ok"],
                    operationId: "host-ledger-smoke",
                  },
                },
                exitCode: 0,
                process: {
                  pid: 4242,
                  ownedProcess: true,
                },
              },
            }),
          },
        ],
      },
    });
    registry.register({
      manifest: {
        id: "host-ledger-smoke",
        label: "Host ledger smoke",
        description: "Host process ledger smoke tool.",
        source: "external",
        kind: "model-tool",
        providerId: "terminal",
        capabilities: [{ id: "host-ledger-smoke", label: "Run", readOnly: false }],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      sandboxCommandExecution: { enabled: true },
    });
    const queue = new ExternalToolExecutionQueue({
      registry,
      nowMs: () => 1_700_000_000_000,
    });

    await queue.enqueue(
      {
        toolId: "host-ledger-smoke",
        operationId: "host-ledger-smoke",
        command: "echo ok",
        cwd: workspaceRoot,
        approval: { status: "approved", operatorId: "operator-1" },
        requestedNetworkPolicy: "none",
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "host",
          checkedAt: "2026-05-08T00:00:00.000Z",
          providerId: "terminal",
        },
        sandboxRuntimePolicy: {
          enabledBackends: ["host"],
          readableRoots: [workspaceRoot],
          writableRoots: [workspaceRoot],
          networkPolicy: "none",
        },
      },
      { executionId: "host-ledger-exec" },
    );

    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(
        workspaceRoot,
        dataDir,
        [],
        {},
        {
          externalToolControlPlane: createExternalToolControlPlane(registry),
          externalToolExecutionQueue: queue,
        },
      ),
    );
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const runtimeSnapshotResponse = await fetch(`http://${host}:${port}/v1/runtime/snapshot`);
      expect(runtimeSnapshotResponse.ok).toBe(true);
      await expect(runtimeSnapshotResponse.json()).resolves.toMatchObject({
        agentOsProcessCapabilityLedger: expect.objectContaining({
          totalEntries: 1,
          riskyHostEntries: 1,
          entries: [
            expect.objectContaining({
              owner: "director-host-api",
              runnerKind: "exec-file",
              backend: "host",
              commandPattern: {
                executable: "echo",
                argv: ["ok"],
                operationId: "host-ledger-smoke",
              },
              process: {
                pid: 4242,
                ownedProcess: true,
              },
            }),
          ],
        }),
      });
    } finally {
      await app.close();
    }
  });

  it("surfaces Agent OS extension matrix in runtime snapshot responses", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-extension-matrix-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const registry = new ExternalToolRegistry();
    for (const manifest of createBuiltInAgentOsExtensionExternalToolManifests()) {
      registry.register({ manifest });
    }

    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(
        workspaceRoot,
        dataDir,
        [],
        {},
        {
          externalToolControlPlane: createExternalToolControlPlane(registry),
        },
      ),
    );
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const runtimeSnapshotResponse = await fetch(`http://${host}:${port}/v1/runtime/snapshot`);
      expect(runtimeSnapshotResponse.ok).toBe(true);
      await expect(runtimeSnapshotResponse.json()).resolves.toMatchObject({
        agentOsExtensionMatrix: expect.objectContaining({
          summary: expect.objectContaining({
            total: 8,
            ready: expect.any(Number),
            needsAuth: expect.any(Number),
            needsSetup: expect.any(Number),
            disabled: 1,
          }),
          entries: expect.arrayContaining([
            expect.objectContaining({
              id: "media-understanding.local",
              toolId: "media-understanding.local",
              providerId: "media-understanding",
              sandbox: expect.objectContaining({
                defaultMode: "readonly",
                networkPolicy: "none",
              }),
            }),
            expect.objectContaining({
              id: "browser.desktop",
              toolId: "browser.desktop",
              providerId: "browser",
            }),
            expect.objectContaining({
              id: "memefast.api",
              toolId: "memefast.api",
              providerId: "memefast-api",
              sandbox: expect.objectContaining({
                defaultMode: "network-limited",
                networkPolicy: "limited",
              }),
            }),
            expect.objectContaining({
              id: "voice.live-audio",
              toolId: "voice.live-audio",
              providerId: "voice-live-audio",
              health: expect.objectContaining({
                status: "disabled",
              }),
              metadata: expect.objectContaining({
                failClosed: true,
                microphoneAccessed: false,
                whisperStarted: false,
                liveRunnerStarted: false,
                providerCredentialsUsed: false,
              }),
              sandbox: expect.objectContaining({
                defaultMode: "host",
                networkPolicy: "none",
                requiresCommandPattern: true,
              }),
            }),
          ]),
          byCapability: expect.objectContaining({
            "model.chat": expect.arrayContaining([expect.objectContaining({ id: "memefast.api" })]),
            "audio.realtime.talk": expect.arrayContaining([
              expect.objectContaining({ id: "voice.live-audio" }),
            ]),
            "media.understand_image": expect.arrayContaining([
              expect.objectContaining({ id: "media-understanding.local" }),
            ]),
          }),
        }),
      });
    } finally {
      await app.close();
    }
  });

  it("surfaces task-backed Agent OS subagent runs in runtime snapshot responses", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-subagent-runs-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    let taskNow = 1_700_000_000_000;
    const workerStore = new SessionStore({
      dbPath: join(dataDir, "sessions", "worker-jobs.sqlite"),
      now: () => {
        taskNow += 1;
        return taskNow;
      },
    });
    try {
      workerStore.createSession({
        sessionId: "run-subagent-snapshot-1",
        metadata: {
          owner: "director-angel",
          purpose: "execution run delegation mailbox",
          runId: "run-subagent-snapshot-1",
        },
      });
      const taskPlane = new SessionStoreTaskPlanePort(workerStore, "run-subagent-snapshot-1", {
        createIfMissing: false,
      });
      await taskPlane.enqueueDelegation({
        id: "delegation-run-subagent-snapshot-1-researcher",
        taskId: "assignment-researcher",
        workerId: "director-researcher",
        instruction: "Inspect source material and summarize risks.",
        contextSnapshot: "parentTurnId=turn-runtime-snapshot;isolatedContext=true",
        specialization: "explore",
        targetAgent: "director-researcher",
        verificationRequest: {
          verificationId: "verification-run-subagent-snapshot-1-researcher",
          verifierId: "director-qc-reviewer",
          requirement: "Confirm the risk summary is grounded.",
        },
      });
      await taskPlane.setDelegationStatus({
        id: "delegation-run-subagent-snapshot-1-researcher",
        status: "completed",
        resultSummary: "Risk summary is grounded.",
      });
      await taskPlane.upsertVerification({
        id: "verification-run-subagent-snapshot-1-researcher",
        taskId: "assignment-researcher",
        verifierId: "director-qc-reviewer",
        requirement: "Confirm the risk summary is grounded.",
        status: "passed",
        verdict: "pass",
        verdictSummary: "Grounded evidence is present.",
      });
      await taskPlane.enqueueDelegation({
        id: "delegation-run-subagent-snapshot-1-shot-planner",
        taskId: "assignment-shot-planner",
        workerId: "director-shot-planner",
        instruction: "Draft shot plan after the research summary.",
        contextSnapshot:
          "parentTurnId=turn-runtime-snapshot;isolatedContext=true;parallelGroup=planning;writeSet=shots/plan.md",
        specialization: "plan",
        targetAgent: "director-shot-planner",
      });
      await taskPlane.enqueueDelegation({
        id: "delegation-run-subagent-snapshot-1-polish",
        taskId: "assignment-polish",
        workerId: "director-polish",
        instruction: "Polish the same shot plan after the planner finishes.",
        contextSnapshot:
          "parentTurnId=turn-runtime-snapshot;isolatedContext=true;parallelGroup=planning;writeSet=shots/plan.md",
        specialization: "plan",
        targetAgent: "director-polish",
      });
    } finally {
      workerStore.close();
    }

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const runtimeSnapshotResponse = await fetch(`http://${host}:${port}/v1/runtime/snapshot`);
      expect(runtimeSnapshotResponse.ok).toBe(true);
      const payload = await runtimeSnapshotResponse.json();
      const subagentProjection = payload.agentOsSubagentRuns;
      expect(subagentProjection).toBeDefined();
      expect(subagentProjection.summary).toMatchObject({
        total: 3,
        queued: 2,
        completed: 1,
        verifiedPass: 1,
      });

      expect(subagentProjection.schedulerRecoveryPlan).toMatchObject({
        schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
        canRecover: true,
        conflictedSubagentIds: expect.arrayContaining([
          "delegation-run-subagent-snapshot-1-polish",
          "delegation-run-subagent-snapshot-1-shot-planner",
        ]),
        recoveryActions: expect.arrayContaining([
          expect.objectContaining({
            actionId: "recover_delegation-run-subagent-snapshot-1-shot-planner_write_set_overlap",
            subagentId: "delegation-run-subagent-snapshot-1-shot-planner",
            actionType: "wait-for-running-subagent",
            severity: "info",
            reason: "write-set-overlap: shots/plan.md",
            relatedSubagentIds: ["delegation-run-subagent-snapshot-1-polish"],
            writeSet: ["shots/plan.md"],
          }),
          expect.objectContaining({
            actionId: "recover_delegation-run-subagent-snapshot-1-polish_write_set_overlap",
            subagentId: "delegation-run-subagent-snapshot-1-polish",
            actionType: "wait-for-running-subagent",
            severity: "info",
            reason: "write-set-overlap: shots/plan.md",
            relatedSubagentIds: ["delegation-run-subagent-snapshot-1-shot-planner"],
            writeSet: ["shots/plan.md"],
          }),
        ]),
        recoveryOrdinal: expect.any(Number),
      });
      expect(subagentProjection.schedulerRecoveryPlan.blockedSubagentIds).toHaveLength(1);
      expect(subagentProjection.schedulerRecoveryPlan.blockedSubagentIds[0]).toEqual(
        expect.stringMatching(/^delegation-run-subagent-snapshot-1-(polish|shot-planner)$/u),
      );
      expect(subagentProjection.schedulerRecoveryPlan.recoveryGroups).toEqual([
        expect.objectContaining({
          groupId: "recovery_group_write_set_overlap_shots_plan_md",
          groupType: "write-set-overlap",
          severity: "info",
          reason: "write-set-overlap: shots/plan.md",
          actionIds: expect.arrayContaining([
            "recover_delegation-run-subagent-snapshot-1-polish_write_set_overlap",
            "recover_delegation-run-subagent-snapshot-1-shot-planner_write_set_overlap",
          ]),
          subagentIds: expect.arrayContaining([
            "delegation-run-subagent-snapshot-1-polish",
            "delegation-run-subagent-snapshot-1-shot-planner",
          ]),
          runningSubagentIds: [],
          blockedSubagentIds: subagentProjection.schedulerRecoveryPlan.blockedSubagentIds,
          completedSubagentIds: [],
          writeSet: ["shots/plan.md"],
        }),
      ]);

      const dispatchIntent = subagentProjection.schedulerTick.dispatchIntents[0];
      expect(subagentProjection.schedulerTick).toMatchObject({
        schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
        sessionId: "run-subagent-snapshot-1",
        latestTurnId: null,
        dispatchIntents: [expect.objectContaining({ command: "run-delegation" })],
        claimDryRun: true,
      });
      expect(dispatchIntent).toMatchObject({
        intentId: `dispatch_${dispatchIntent.delegationId}`,
        parallelBatch: 0,
        writeSet: ["shots/plan.md"],
        writeSetSource: "explicit",
      });
      expect(dispatchIntent.argv).toEqual([
        "run-delegation",
        "--session-id",
        "run-subagent-snapshot-1",
        "--worker-id",
        dispatchIntent.workerId,
        "--delegation-id",
        dispatchIntent.delegationId,
      ]);

      const entriesById = new Map(
        subagentProjection.entries.map((entry: { readonly subagentId: string }) => [
          entry.subagentId,
          entry,
        ]),
      );
      expect(entriesById.get("delegation-run-subagent-snapshot-1-researcher")).toMatchObject({
        subagentId: "delegation-run-subagent-snapshot-1-researcher",
        parentTurnId: "turn-runtime-snapshot",
        profileId: "director-researcher",
        workerId: "director-researcher",
        taskId: "assignment-researcher",
        status: "completed",
        role: "explore",
        targetAgent: "director-researcher",
        isolatedContext: true,
        resultSummary: "Risk summary is grounded.",
        parentVisibleResult: {
          status: "completed",
          summary: "Risk summary is grounded.",
          verificationVerdict: "pass",
        },
        verification: expect.objectContaining({
          verificationId: "verification-run-subagent-snapshot-1-researcher",
          verifierId: "director-qc-reviewer",
          status: "passed",
          verdict: "pass",
          verdictSummary: "Grounded evidence is present.",
        }),
      });
      const shotPlanner = entriesById.get("delegation-run-subagent-snapshot-1-shot-planner");
      const polish = entriesById.get("delegation-run-subagent-snapshot-1-polish");
      expect(shotPlanner).toMatchObject({
        subagentId: "delegation-run-subagent-snapshot-1-shot-planner",
        parentTurnId: "turn-runtime-snapshot",
        profileId: "director-shot-planner",
        workerId: "director-shot-planner",
        taskId: "assignment-shot-planner",
        status: "queued",
        role: "plan",
        scheduling: expect.objectContaining({
          parallelGroup: "planning",
          writeSet: ["shots/plan.md"],
          writeSetSource: "explicit",
          canRunInParallel: false,
          conflictReason: "write-set-overlap: shots/plan.md",
        }),
      });
      expect(polish).toMatchObject({
        subagentId: "delegation-run-subagent-snapshot-1-polish",
        parentTurnId: "turn-runtime-snapshot",
        profileId: "director-polish",
        workerId: "director-polish",
        taskId: "assignment-polish",
        status: "queued",
        role: "plan",
        scheduling: expect.objectContaining({
          parallelGroup: "planning",
          writeSet: ["shots/plan.md"],
          writeSetSource: "explicit",
          canRunInParallel: false,
          conflictReason: "write-set-overlap: shots/plan.md",
        }),
      });
      expect(shotPlanner.scheduling.conflictsWith).toEqual([
        "delegation-run-subagent-snapshot-1-polish",
      ]);
      expect(polish.scheduling.conflictsWith).toEqual([
        "delegation-run-subagent-snapshot-1-shot-planner",
      ]);
      const schedulableEntries = [shotPlanner, polish];
      expect(schedulableEntries.filter((entry) => entry.scheduling.readyToStart)).toHaveLength(1);
      expect(schedulableEntries.filter((entry) => !entry.scheduling.readyToStart)).toHaveLength(1);
      expect(dispatchIntent.delegationId).toBe(
        schedulableEntries.find((entry) => entry.scheduling.readyToStart)?.subagentId,
      );
    } finally {
      await app.close();
    }
  });

  it("fails closed when the Host API tool control plane is not attached", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-tools-missing-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/tools/effective`);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "TOOLS_CONTROL_PLANE_UNAVAILABLE",
      });
    } finally {
      await app.close();
    }
  });

  it("previews published knowledge recall through the Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-recall-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const knowledgeDir = join(workspaceRoot, ".director-angel", "knowledge");
    const knowledgeStore = new FileKnowledgeStore({ knowledgeDir });
    const publishedProposal = createAcceptedProposalFixture({
      proposalId: "proposal-recall-preview",
      dedupeKey: "recall__published__shot_language",
      tags: ["shot-language", "director-shot"],
      selectedAdapters: ["seedance-preview"],
      explanation: "Prefer three concise shots with clear shot size and camera angle anchors.",
    });
    const published = materializeDirectorKnowledgePackFromProposal(publishedProposal, {
      author: "host-api-test",
      note: "seed recall preview",
      now: "2026-04-30T02:00:00.000Z",
    });
    await knowledgeStore.publish(published);

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const recallResponse = await fetch(`http://${host}:${port}/v1/knowledge/recall-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tags: ["shot-language"],
          preferredAdapters: ["seedance-preview"],
          maxHits: 2,
          maxChars: 600,
        }),
      });
      expect(recallResponse.ok).toBe(true);
      const recallPayload = (await recallResponse.json()) as {
        apiVersion: string;
        schemaId: string;
        recall: {
          status: string;
          query: { tags?: string[]; preferredAdapters?: string[]; maxHits: number };
          hits: Array<{ knowledgePackId: string; title: string; reasons: string[] }>;
        };
      };
      expect(recallPayload.apiVersion).toBe(DIRECTOR_HOST_API_VERSION);
      expect(recallPayload.schemaId).toBe("director.host.knowledge-recall-preview.v1");
      expect(recallPayload.recall.status).toBe("hit");
      expect(recallPayload.recall.query).toMatchObject({
        tags: ["shot-language"],
        preferredAdapters: ["seedance-preview"],
        maxHits: 2,
      });
      expect(recallPayload.recall.hits).toEqual([
        expect.objectContaining({
          knowledgePackId: published.metadata.id,
          title: published.metadata.title,
          reasons: expect.arrayContaining([
            "tag match: shot-language",
            "adapter match: seedance-preview",
          ]),
        }),
      ]);

      const invalidResponse = await fetch(`http://${host}:${port}/v1/knowledge/recall-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxHits: 0 }),
      });
      expect(invalidResponse.status).toBe(400);

      const methodResponse = await fetch(`http://${host}:${port}/v1/knowledge/recall-preview`);
      expect(methodResponse.status).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("moves experience candidates through review, promotion, knowledge review, and publish gates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-review-gates-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const knowledgeDir = join(workspaceRoot, ".director-angel", "knowledge");
    const experienceStore = new FileExperienceStore({
      experienceDir: join(knowledgeDir, "experience"),
    });
    const experienceCandidate = createExperienceCandidate({
      candidateId: "experience_review_gate_1",
      sourceAdapter: createExperienceSourceAdapterDeclaration({
        adapterId: "adapter_review_gate",
        sourceKind: "manual",
        sourceRef: "fixture://host-api/review-gate",
        privacy: "internal",
        transformations: [
          {
            transformId: "extract-pattern",
            kind: "extract-pattern",
            summary: "Extract a reusable director workflow.",
          },
        ],
      }),
      title: "Review gate experience fixture",
      summary: "Keep learning outputs behind review gates before runtime recall.",
      applicability: "When promoting learned material into Director production knowledge.",
      risks: ["Unreviewed material must not enter runtime recall."],
      tags: ["review-gate"],
      evidence: [
        {
          evidenceId: "evidence_review_gate_1",
          sourceRef: "fixture://host-api/review-gate",
          summary: "Fixture evidence for review gate workflow.",
        },
      ],
      privacy: "internal",
      provenance: "director-host-api-test",
      createdAtMs: 1_776_000_010_000,
    });
    await experienceStore.writeCandidate(experienceCandidate);

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const acceptExperienceResponse = await fetch(
        `http://${host}:${port}/v1/experience/candidates/${encodeURIComponent(
          experienceCandidate.candidateId,
        )}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "operator-a",
            note: "usable for production recall after promotion",
            now: "2026-04-30T01:00:00.000Z",
          }),
        },
      );
      expect(acceptExperienceResponse.ok).toBe(true);
      const acceptExperiencePayload = (await acceptExperienceResponse.json()) as {
        review: { candidateId: string; decision: string };
      };
      expect(acceptExperiencePayload.review).toMatchObject({
        candidateId: experienceCandidate.candidateId,
        decision: "accepted",
      });

      const promoteExperienceResponse = await fetch(
        `http://${host}:${port}/v1/experience/candidates/${encodeURIComponent(
          experienceCandidate.candidateId,
        )}/promote`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "operator-a",
            note: "promote accepted experience",
            now: "2026-04-30T01:01:00.000Z",
          }),
        },
      );
      expect(promoteExperienceResponse.ok).toBe(true);
      const promoteExperiencePayload = (await promoteExperienceResponse.json()) as {
        knowledgeCandidate: { metadata: { id: string }; stage: string };
        promotion: { candidateId: string; promotedTo: string } | null;
      };
      expect(promoteExperiencePayload.knowledgeCandidate.stage).toBe("candidate");
      expect(promoteExperiencePayload.promotion).toMatchObject({
        candidateId: experienceCandidate.candidateId,
        promotedTo: "director-knowledge-candidate",
      });
      const packId = promoteExperiencePayload.knowledgeCandidate.metadata.id;

      const acceptKnowledgeResponse = await fetch(
        `http://${host}:${port}/v1/knowledge/candidates/${encodeURIComponent(packId)}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "operator-a",
            note: "publishable after human review",
            now: "2026-04-30T01:02:00.000Z",
          }),
        },
      );
      expect(acceptKnowledgeResponse.ok).toBe(true);
      const acceptKnowledgePayload = (await acceptKnowledgeResponse.json()) as {
        review: { packId: string; decision: string };
      };
      expect(acceptKnowledgePayload.review).toMatchObject({
        packId,
        decision: "accepted",
      });

      const publishKnowledgeResponse = await fetch(
        `http://${host}:${port}/v1/knowledge/candidates/${encodeURIComponent(packId)}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "operator-a",
            note: "publish reviewed experience knowledge",
            now: "2026-04-30T01:03:00.000Z",
          }),
        },
      );
      expect(publishKnowledgeResponse.ok).toBe(true);
      const publishKnowledgePayload = (await publishKnowledgeResponse.json()) as {
        published: { metadata: { id: string; version: number }; stage: string };
        previousPublishedVersion: number | null;
      };
      expect(publishKnowledgePayload.published).toMatchObject({
        metadata: expect.objectContaining({ id: packId, version: 1 }),
        stage: "published",
      });
      expect(publishKnowledgePayload.previousPublishedVersion).toBeNull();

      const knowledgePacksResponse = await fetch(`http://${host}:${port}/v1/knowledge/packs`);
      const knowledgePacksPayload = (await knowledgePacksResponse.json()) as {
        knowledgePacks: Array<{ metadata: { id: string } }>;
      };
      expect(knowledgePacksPayload.knowledgePacks.map((pack) => pack.metadata.id)).toContain(
        packId,
      );

      const knowledgeCandidatesResponse = await fetch(
        `http://${host}:${port}/v1/knowledge/candidates`,
      );
      const knowledgeCandidatesPayload = (await knowledgeCandidatesResponse.json()) as {
        knowledgeCandidates: Array<{ metadata: { id: string } }>;
      };
      expect(
        knowledgeCandidatesPayload.knowledgeCandidates.map((entry) => entry.metadata.id),
      ).not.toContain(packId);
    } finally {
      await app.close();
    }
  });

  it("updates an experience candidate through the Host API without bypassing review gates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-experience-update-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const knowledgeDir = join(workspaceRoot, ".director-angel", "knowledge");
    const experienceStore = new FileExperienceStore({
      experienceDir: join(knowledgeDir, "experience"),
    });
    const experienceCandidate = createExperienceCandidate({
      candidateId: "experience_update_1",
      sourceAdapter: createExperienceSourceAdapterDeclaration({
        adapterId: "adapter_update",
        sourceKind: "manual",
        sourceRef: "fixture://host-api/update",
        privacy: "internal",
        transformations: [],
      }),
      title: "Original experience title",
      summary: "Original summary.",
      applicability: "Original applicability.",
      risks: ["Original risk."],
      tags: ["original"],
      evidence: [
        {
          evidenceId: "evidence_update_1",
          sourceRef: "fixture://host-api/update",
          summary: "Fixture evidence for update workflow.",
        },
      ],
      privacy: "internal",
      provenance: "director-host-api-test",
      createdAtMs: 1_776_000_090_000,
    });
    await experienceStore.writeCandidate(experienceCandidate);

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(
        `http://${host}:${port}/v1/experience/candidates/${encodeURIComponent(
          experienceCandidate.candidateId,
        )}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Updated experience title",
            summary: "Updated reusable summary.",
            applicability: "Use before promoting learned material.",
            risks: ["Do not skip review."],
            tags: ["manual-edit", "review-gate"],
            author: "operator-a",
          }),
        },
      );

      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        schemaId: string;
        updated: { candidateId: string; title: string; summary: string; risks: string[] };
        write: { status: string };
      };
      expect(payload).toMatchObject({
        schemaId: "director.host.experience-candidate-update.v1",
        updated: {
          candidateId: experienceCandidate.candidateId,
          title: "Updated experience title",
          summary: "Updated reusable summary.",
          risks: ["Do not skip review."],
        },
        write: { status: "ok" },
      });
      const stored = await experienceStore.getCandidate(experienceCandidate.candidateId);
      expect(stored).toMatchObject({
        title: "Updated experience title",
        summary: "Updated reusable summary.",
        applicability: "Use before promoting learned material.",
        tags: ["manual-edit", "review-gate"],
        status: "candidate",
        runtimeInjection: "disabled",
      });

      const missingResponse = await fetch(
        `http://${host}:${port}/v1/experience/candidates/missing`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ summary: "nope" }),
        },
      );
      expect(missingResponse.status).toBe(404);

      const methodResponse = await fetch(
        `http://${host}:${port}/v1/experience/candidates/${experienceCandidate.candidateId}`,
      );
      expect(methodResponse.status).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("materializes reviewed run output and reflection through Host API review gates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-run-learning-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    await writeExecutionRunFixture(workspaceRoot);

    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(workspaceRoot, dataDir, [], { "learning.enabled": true }),
    );
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const experienceResponse = await fetch(
        `http://${host}:${port}/v1/runs/run-review-1/experience`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intent: "failure-lesson",
            privacy: "confidential",
            now: "2026-04-25T10:04:00.000Z",
          }),
        },
      );

      expect(experienceResponse.ok).toBe(true);
      const experiencePayload = (await experienceResponse.json()) as {
        schemaId: string;
        materialized: {
          status: string;
          candidate?: {
            candidateId: string;
            title: string;
            status: string;
            runtimeInjection: string;
          };
        };
        write: { status: string };
      };
      expect(experiencePayload).toMatchObject({
        schemaId: "director.host.run-experience.v1",
        materialized: {
          status: "candidate",
          candidate: {
            title: "Failure lesson: Make a production clip",
            status: "candidate",
            runtimeInjection: "disabled",
          },
        },
        write: { status: "ok" },
      });

      const reflectionResponse = await fetch(
        `http://${host}:${port}/v1/runs/run-review-1/reflection`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            privacy: "confidential",
            writeExperienceCandidate: true,
            writeSoulCandidate: true,
            now: "2026-04-25T10:05:00.000Z",
          }),
        },
      );

      expect(reflectionResponse.ok).toBe(true);
      const reflectionPayload = (await reflectionResponse.json()) as {
        schemaId: string;
        reflection: { outcome: string; suggestedExperienceIntent: string; status: string };
        experience: {
          recommended: { materialized: { status: string; candidate: { candidateId: string } } };
        };
        experienceWrite: { status: string } | null;
        soulCandidate: { candidateId: string; status: string } | null;
        soulWrite: { status: string } | null;
      };
      expect(reflectionPayload).toMatchObject({
        schemaId: "director.host.run-reflection.v1",
        reflection: {
          outcome: "failure",
          suggestedExperienceIntent: "failure-lesson",
          status: "candidate_generated",
        },
        experience: {
          recommended: {
            materialized: {
              status: "candidate",
              candidate: { candidateId: expect.stringMatching(/^experience_run_/u) },
            },
          },
        },
        experienceWrite: { status: "ok" },
        soulCandidate: {
          candidateId: expect.stringMatching(/^soul_reflection_run-review-1_/u),
          status: "pending",
        },
        soulWrite: { status: "ok" },
      });

      const candidates = await new FileExperienceStore({
        experienceDir: join(workspaceRoot, ".director-angel", "knowledge", "experience"),
      }).listCandidates();
      expect(candidates.map((candidate) => candidate.runtimeInjection)).toEqual(
        expect.arrayContaining(["disabled"]),
      );
    } finally {
      await app.close();
    }
  });

  it("materializes trace proposal output through Host API without bypassing review gates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-trace-experience-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    await writeTraceProposalFixture(workspaceRoot);

    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(workspaceRoot, dataDir, [], { "learning.enabled": true }),
    );
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(
        `http://${host}:${port}/v1/trace-proposals/proposal-review-1/experience`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intent: "failure-lesson",
            privacy: "confidential",
            now: "2026-04-25T10:06:00.000Z",
          }),
        },
      );

      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        schemaId: string;
        proposal: { proposalId: string };
        materialized: {
          status: string;
          candidate?: {
            candidateId: string;
            title: string;
            status: string;
            runtimeInjection: string;
          };
        };
        write: { status: string };
      };
      expect(payload).toMatchObject({
        schemaId: "director.host.trace-proposal-experience.v1",
        proposal: { proposalId: "proposal-review-1" },
        materialized: {
          status: "candidate",
          candidate: {
            title: "Failure lesson: Create a continuity-safe teaser.",
            status: "candidate",
            runtimeInjection: "disabled",
          },
        },
        write: { status: "ok" },
      });

      const stored = await new FileExperienceStore({
        experienceDir: join(workspaceRoot, ".director-angel", "knowledge", "experience"),
      }).listCandidates();
      expect(stored[0]).toMatchObject({
        status: "candidate",
        runtimeInjection: "disabled",
        tags: expect.arrayContaining(["failure-lesson", "negative-experience"]),
      });
    } finally {
      await app.close();
    }
  });

  it("runs heartbeat through Host API without executing unsafe follow-up actions", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-heartbeat-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    await writeExecutionRunFixture(workspaceRoot);

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/heartbeat/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          now: "2026-04-28T06:00:00.000Z",
        }),
      });

      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        schemaId: string;
        text: string;
        latestPath: string;
        eventPaths: string[];
        snapshot: {
          schemaVersion: string;
          eventCount: number;
          events: Array<{
            kind: string;
            severity: string;
            actionRefs: string[];
            evidenceRefs: string[];
          }>;
        };
      };
      expect(payload).toMatchObject({
        schemaId: "director.host.heartbeat-status.v1",
        snapshot: {
          schemaVersion: "director.heartbeat.snapshot.v1",
          eventCount: expect.any(Number),
        },
      });
      expect(payload.text).toContain("Director heartbeat:");
      expect(payload.text).toContain("kind=failed-run");
      expect(payload.text).toContain("kind=reflection-due");
      expect(payload.latestPath).toBe(
        join(workspaceRoot, ".director-angel", "heartbeat", "latest.json"),
      );
      expect(readFileSync(payload.latestPath, "utf8")).toContain("director.heartbeat.snapshot.v1");
      expect(payload.eventPaths.length).toBe(payload.snapshot.eventCount);
      const actionRefs = payload.snapshot.events.flatMap((event) => event.actionRefs);
      expect(actionRefs.join("\n")).not.toMatch(/\b(start|resume|retry|approve)\b/u);

      const methodResponse = await fetch(`http://${host}:${port}/v1/heartbeat/status`);
      expect(methodResponse.status).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("creates a daily self-reflection report through Host API without bypassing review gates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-daily-reflection-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    await writeExecutionRunFixture(workspaceRoot);

    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(workspaceRoot, dataDir, [], {
        "heartbeat.enabled": true,
        "selfReflection.enabled": true,
      }),
    );
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/self-reflection/daily`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: "2026-04-25",
          now: "2026-04-25T23:00:00.000Z",
        }),
      });

      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        schemaId: string;
        text: string;
        reportPath: string;
        markdownPath: string;
        report: {
          schemaVersion: string;
          status: string;
          reviewRequired: boolean;
          runs: { total: number; failed: number; reflectionDue: number };
          guardrails: string[];
        };
      };
      expect(payload).toMatchObject({
        schemaId: "director.host.daily-self-reflection.v1",
        report: {
          schemaVersion: "director.self-reflection.daily-report.v1",
          status: "blocked",
          reviewRequired: true,
          runs: {
            total: 1,
            failed: 1,
            reflectionDue: 1,
          },
        },
      });
      expect(payload.text).toContain("Director daily self-reflection:");
      expect(payload.report.guardrails.join("\n")).toContain("不自动发布知识");
      expect(readFileSync(payload.reportPath, "utf8")).toContain(
        "director.self-reflection.daily-report.v1",
      );
      expect(readFileSync(payload.markdownPath, "utf8")).toContain("Self-Reflection");

      const methodResponse = await fetch(`http://${host}:${port}/v1/self-reflection/daily`);
      expect(methodResponse.status).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("moves accepted experience through Skill proposal review and safe apply gates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-skill-gates-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const knowledgeDir = join(workspaceRoot, ".director-angel", "knowledge");
    const experienceStore = new FileExperienceStore({
      experienceDir: join(knowledgeDir, "experience"),
    });
    const experienceCandidate = createExperienceCandidate({
      candidateId: "experience_skill_gate_1",
      sourceAdapter: createExperienceSourceAdapterDeclaration({
        adapterId: "adapter_skill_gate",
        sourceKind: "manual",
        sourceRef: "fixture://host-api/skill-gate",
        privacy: "internal",
        transformations: [
          {
            transformId: "extract-skill",
            kind: "extract-pattern",
            summary: "Extract a reusable production skill.",
          },
        ],
      }),
      title: "三镜头短剧分镜法",
      summary: "15秒短剧可用中景建立空间、近景推进情绪、特写放大线索。",
      applicability: "When Director Angel plans a compact short-drama storyboard.",
      risks: ["Must not copy the source verbatim."],
      tags: ["storyboard", "short-drama"],
      evidence: [
        {
          evidenceId: "evidence_skill_gate_1",
          sourceRef: "fixture://host-api/skill-gate",
          summary: "Fixture evidence for a reusable storyboard method.",
        },
      ],
      sourceDigest: "digest-skill-gate-1",
      evidencePreview: "中景、近景、特写组成 15 秒短剧分镜。",
      privacy: "internal",
      provenance: "director-host-api-test",
      createdAtMs: 1_776_000_050_000,
    });
    await experienceStore.writeCandidate(experienceCandidate);

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const emptyProposalsResponse = await fetch(`http://${host}:${port}/v1/skills/proposals`);
      expect(emptyProposalsResponse.ok).toBe(true);
      const emptyProposalsPayload = (await emptyProposalsResponse.json()) as {
        proposals: unknown[];
      };
      expect(emptyProposalsPayload.proposals).toEqual([]);

      const acceptExperienceResponse = await fetch(
        `http://${host}:${port}/v1/experience/candidates/${encodeURIComponent(
          experienceCandidate.candidateId,
        )}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "operator-skill",
            note: "usable as a reviewed skill source",
            now: "2026-04-30T02:00:00.000Z",
          }),
        },
      );
      expect(acceptExperienceResponse.ok).toBe(true);

      const createProposalResponse = await fetch(
        `http://${host}:${port}/v1/skills/proposals/from-experience`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            candidateId: experienceCandidate.candidateId,
            author: "operator-skill",
            nowMs: 1_776_000_060_000,
          }),
        },
      );
      expect(createProposalResponse.status).toBe(201);
      const createProposalPayload = (await createProposalResponse.json()) as {
        proposal: {
          id: string;
          status: string;
          skillId: string;
          title: string;
          reviewVerdict: string;
        };
      };
      expect(createProposalPayload.proposal).toMatchObject({
        status: "pending",
        title: "Skill：三镜头短剧分镜法",
        reviewVerdict: "accepted",
      });
      expect(createProposalPayload.proposal.skillId).toMatch(/^skill\.director\./u);
      const proposalId = createProposalPayload.proposal.id;

      const pendingApplyResponse = await fetch(
        `http://${host}:${port}/v1/skills/proposals/${encodeURIComponent(proposalId)}/apply`,
        {
          method: "POST",
        },
      );
      expect(pendingApplyResponse.status).toBe(409);
      const pendingApplyPayload = (await pendingApplyResponse.json()) as { code: string };
      expect(pendingApplyPayload.code).toBe("SKILL_PROPOSAL_STATE_CONFLICT");

      const listResponse = await fetch(`http://${host}:${port}/v1/skills/proposals`);
      expect(listResponse.ok).toBe(true);
      const listPayload = (await listResponse.json()) as {
        proposals: Array<{ id: string; status: string; skillId: string }>;
      };
      expect(listPayload.proposals).toEqual([
        expect.objectContaining({
          id: proposalId,
          status: "pending",
          skillId: createProposalPayload.proposal.skillId,
        }),
      ]);

      const acceptProposalResponse = await fetch(
        `http://${host}:${port}/v1/skills/proposals/${encodeURIComponent(proposalId)}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "operator-skill",
            note: "reviewed and ready to apply",
          }),
        },
      );
      expect(acceptProposalResponse.ok).toBe(true);
      const acceptProposalPayload = (await acceptProposalResponse.json()) as {
        proposal: { id: string; status: string };
      };
      expect(acceptProposalPayload.proposal).toMatchObject({
        id: proposalId,
        status: "accepted",
      });

      const applyProposalResponse = await fetch(
        `http://${host}:${port}/v1/skills/proposals/${encodeURIComponent(proposalId)}/apply`,
        {
          method: "POST",
        },
      );
      expect(applyProposalResponse.ok).toBe(true);
      const applyProposalPayload = (await applyProposalResponse.json()) as {
        apply: { operation: string; skillId: string; approvedSkillCount: number };
        proposal: { id: string; status: string };
        skills: Array<{ id: string; title: string }>;
      };
      expect(applyProposalPayload.apply).toMatchObject({
        operation: "create",
        skillId: createProposalPayload.proposal.skillId,
        approvedSkillCount: 1,
      });
      expect(applyProposalPayload.proposal).toMatchObject({
        id: proposalId,
        status: "applied",
      });
      expect(applyProposalPayload.skills).toEqual([
        expect.objectContaining({
          id: createProposalPayload.proposal.skillId,
          title: "Skill：三镜头短剧分镜法",
        }),
      ]);

      const skillsResponse = await fetch(`http://${host}:${port}/v1/skills`);
      expect(skillsResponse.ok).toBe(true);
      const skillsPayload = (await skillsResponse.json()) as {
        skills: Array<{ id: string; title: string }>;
      };
      expect(skillsPayload.skills).toEqual([
        expect.objectContaining({
          id: createProposalPayload.proposal.skillId,
          title: "Skill：三镜头短剧分镜法",
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it("learns pasted text through the unified Host API and stores review-gated experience", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-text-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const learnResponse = await fetch(`http://${host}:${port}/v1/learning/text`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "storyboard-shot-language",
          privacy: "internal",
          texts: [
            {
              title: "Shot language rule",
              content:
                "景别经验：15秒短剧分镜应先用中景交代人物和空间，再用近景推进情绪，最后用特写放大线索。适合导演 Angel 制作短剧分镜时复用。",
              sourceRef: "manual://shot-language",
              contentType: "text/plain",
            },
          ],
          nowMs: 1_776_000_020_000,
        }),
      });

      expect(learnResponse.status).toBe(201);
      const learnPayload = (await learnResponse.json()) as {
        apiVersion: string;
        schemaId: string;
        result: {
          status: string;
          candidateCount: number;
          artifactCount: number;
        };
        candidates: Array<{ candidateId: string; runtimeInjection: string; title: string }>;
        artifacts: Array<{ artifactId: string }>;
        quarantines: unknown[];
      };
      expect(learnPayload.apiVersion).toBe(DIRECTOR_HOST_API_VERSION);
      expect(learnPayload.schemaId).toBe("director.host.learning-text.v1");
      expect(learnPayload.result.status).toBe("ok");
      expect(learnPayload.result.candidateCount).toBe(1);
      expect(learnPayload.result.artifactCount).toBe(1);
      expect(learnPayload.candidates).toHaveLength(1);
      expect(learnPayload.candidates[0]).toMatchObject({
        runtimeInjection: "disabled",
        title: "Pasted lesson: Shot language rule",
      });
      expect(learnPayload.artifacts).toHaveLength(1);
      expect(learnPayload.quarantines).toHaveLength(0);

      const candidatesResponse = await fetch(`http://${host}:${port}/v1/experience/candidates`);
      const candidatesPayload = (await candidatesResponse.json()) as {
        experienceCandidates: Array<{ candidateId: string }>;
      };
      expect(candidatesPayload.experienceCandidates.map((entry) => entry.candidateId)).toEqual(
        learnPayload.candidates.map((entry) => entry.candidateId),
      );
    } finally {
      await app.close();
    }
  });

  it("admits extracted source snapshots through the unified Host API without leaking old candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-admit-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const oldResponse = await fetch(`http://${host}:${port}/v1/learning/text`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "old-learning-run",
          texts: [
            {
              title: "Old lesson",
              content:
                "旧经验：这条候选只是用来证明 admit 响应不能混入历史库存，不应该出现在本轮结果里。",
            },
          ],
          nowMs: 1_776_000_050_000,
        }),
      });
      expect(oldResponse.status).toBe(201);

      const admitResponse = await fetch(`http://${host}:${port}/v1/learning/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_id: "web-extract-shot-language",
          privacy: "public",
          sources: [
            {
              url: "https://example.test/ai-short-drama-shot-language",
              title: "AI短剧镜头语言",
              body: "短剧镜头经验：15秒短剧分镜先用中景建立人物和环境，再用近景推进情绪，最后用特写放大关键线索。这个规则适合 Director Angel 在制作短剧分镜、脚本审查和镜头规划时复用，但必须保留来源并进入人工审核。",
              content_type: "text/html",
              structured_content: {
                kind: "web_extract",
                readableChars: 87,
              },
            },
          ],
          nowMs: 1_776_000_060_000,
        }),
      });

      expect(admitResponse.status).toBe(201);
      const admitPayload = (await admitResponse.json()) as {
        schemaId: string;
        result: { status: string; candidateCount: number; artifactCount: number };
        candidates: Array<{
          title: string;
          runtimeInjection: string;
          evidence: Array<{ sourceRef: string }>;
        }>;
        artifacts: Array<{ artifactId: string }>;
        quarantines: unknown[];
      };
      expect(admitPayload.schemaId).toBe("director.host.learning-admit.v1");
      expect(admitPayload.result.status).toBe("ok");
      expect(admitPayload.result.candidateCount).toBe(1);
      expect(admitPayload.result.artifactCount).toBe(1);
      expect(admitPayload.candidates).toHaveLength(1);
      expect(admitPayload.candidates[0]).toMatchObject({
        runtimeInjection: "disabled",
        title: "Pasted lesson: AI短剧镜头语言",
        evidence: [
          expect.objectContaining({
            sourceRef: "https://example.test/ai-short-drama-shot-language",
          }),
        ],
      });
      expect(admitPayload.artifacts).toHaveLength(1);
      expect(admitPayload.quarantines).toHaveLength(0);
      expect(JSON.stringify(admitPayload)).not.toContain("Old lesson");
    } finally {
      await app.close();
    }
  });

  it("rejects admit requests that do not include extracted source body content", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-admit-invalid-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const admitResponse = await fetch(`http://${host}:${port}/v1/learning/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_id: "search-only-result",
          sources: [
            {
              url: "https://example.test/search-result-only",
              title: "只有搜索结果，没有正文",
            },
          ],
        }),
      });

      expect(admitResponse.status).toBe(400);
      const errorPayload = (await admitResponse.json()) as { code: string; message: string };
      expect(errorPayload.code).toBe("INVALID_LEARNING_ADMIT_REQUEST");
      expect(errorPayload.message).toContain("sources[0]");
    } finally {
      await app.close();
    }
  });

  it("learns local directories through the unified Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-directory-"));
    tempRoots.push(workspaceRoot);
    const sourceDir = join(workspaceRoot, "learning-source");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, "shot-language.md"),
      [
        "# 短剧镜头经验",
        "",
        "15秒短剧分镜适合三段式：中景建立场景，近景推进情绪，特写放大线索。",
        "这个规则可复用于 Director Angel 的分镜规划和镜头审查。",
      ].join("\n"),
      "utf8",
    );
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const learnResponse = await fetch(`http://${host}:${port}/v1/learning/directory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "local-shot-language",
          directory: sourceDir,
          privacy: "confidential",
          maxDepth: 1,
          maxFiles: 5,
          includeExtensions: [".md"],
          nowMs: 1_776_000_030_000,
        }),
      });

      expect(learnResponse.status).toBe(201);
      const learnPayload = (await learnResponse.json()) as {
        schemaId: string;
        result: { status: string; candidateCount: number; artifactCount: number };
        candidates: Array<{ sourceAdapter: { sourceKind: string }; runtimeInjection: string }>;
        artifacts: Array<{ artifactId: string }>;
      };
      expect(learnPayload.schemaId).toBe("director.host.learning-directory.v1");
      expect(learnPayload.result.status).toBe("ok");
      expect(learnPayload.result.candidateCount).toBe(1);
      expect(learnPayload.result.artifactCount).toBe(1);
      expect(learnPayload.candidates[0]).toMatchObject({
        runtimeInjection: "disabled",
        sourceAdapter: expect.objectContaining({ sourceKind: "local-directory" }),
      });
      expect(learnPayload.artifacts).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("learns URLs through the unified Host API without bypassing review gates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-url-"));
    tempRoots.push(workspaceRoot);
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        [
          "<!doctype html>",
          "<html><head><title>短剧镜头语言</title></head><body>",
          "<h1>短剧镜头语言</h1>",
          "<p>导演经验：15秒短剧先用中景建立空间，再用近景推进情绪，最后用特写强调线索。</p>",
          "<p>这条经验适合 Director Angel 制作短剧分镜时复用，但必须先通过人工审核。</p>",
          "</body></html>",
        ].join(""),
      );
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => {
        upstream.off("error", reject);
        resolve();
      });
    });
    const address = upstream.address();
    if (address === null || typeof address === "string") {
      throw new Error("Upstream learning test server did not expose a TCP address.");
    }
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
      experienceFetchText: async (url) => ({
        url,
        contentType: "text/html",
        body: [
          "<!doctype html>",
          "<html><head><title>短剧镜头语言</title></head><body>",
          "<h1>短剧镜头语言</h1>",
          "<p>导演经验规则：15秒短剧先用中景建立空间，再用近景推进情绪，最后用特写强调线索。</p>",
          "<p>执行步骤包括目标确认、人物动机、镜头调度、景别变化、声音节奏、剪辑节点、风险检查、审核证据和复盘方法。</p>",
          "<p>这个流程适合 Director Angel 制作短剧分镜、广告片脚本、人物出场设计和连续镜头规划时复用。</p>",
          "</body></html>",
        ].join(""),
      }),
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const learnResponse = await fetch(`http://${host}:${port}/v1/learning/url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "web-shot-language",
          urls: ["https://example.test/shot-language"],
          privacy: "public",
          nowMs: 1_776_000_040_000,
        }),
      });

      expect(learnResponse.status).toBe(201);
      const learnPayload = (await learnResponse.json()) as {
        schemaId: string;
        result: { status: string; candidateCount: number; artifactCount: number };
        candidates: Array<{
          sourceAdapter: { sourceKind: string };
          runtimeInjection: string;
          sourceArtifactId?: string;
        }>;
        artifacts: Array<{ artifactId: string; sourceRef: string }>;
        sourceEvidenceRefs: Array<{
          id: string;
          sourceKind: string;
          sourceRef: string;
          sourceSnapshotId?: string;
          sourceAccessStatus: string;
          publishable: boolean;
        }>;
        memoryEvidenceRecords: Array<{
          id: string;
          sourceRef: string;
          sourceSnapshotId?: string;
          sourceAccessStatus: string;
          confidence: string;
          publishable: boolean;
          evidenceRefs: string[];
        }>;
        quarantines: unknown[];
      };
      expect(learnPayload.schemaId).toBe("director.host.learning-url.v1");
      expect(learnPayload.result.status).toBe("ok");
      expect(learnPayload.result.candidateCount).toBe(1);
      expect(learnPayload.result.artifactCount).toBe(1);
      expect(learnPayload.candidates[0]).toMatchObject({
        runtimeInjection: "disabled",
        sourceAdapter: expect.objectContaining({ sourceKind: "web-page" }),
      });
      expect(learnPayload.sourceEvidenceRefs).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^source-evidence-/u),
          sourceKind: "url",
          sourceRef: "https://example.test/shot-language",
          sourceSnapshotId: learnPayload.artifacts[0]?.artifactId,
          sourceAccessStatus: "available",
          publishable: true,
        }),
      ]);
      expect(learnPayload.memoryEvidenceRecords).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^memory-evidence-/u),
          sourceRef: "https://example.test/shot-language",
          sourceSnapshotId: learnPayload.artifacts[0]?.artifactId,
          sourceAccessStatus: "available",
          confidence: "medium",
          publishable: false,
          evidenceRefs: [
            learnPayload.sourceEvidenceRefs[0]?.id,
            learnPayload.artifacts[0]?.artifactId,
            learnPayload.candidates[0]?.candidateId,
          ],
        }),
      ]);
      expect(learnPayload.quarantines).toHaveLength(0);
    } finally {
      await app.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("fails Host URL learning closed when direct extraction only sees WeChat residue", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-url-blocked-"));
    tempRoots.push(workspaceRoot);
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        "<html><head><title>环境异常</title></head><body>当前环境异常，完成验证后即可继续访问。视频 小程序 赞 ，轻点两下取消赞 在看 ，轻点两下取消在看</body></html>",
      );
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => {
        upstream.off("error", reject);
        resolve();
      });
    });
    const address = upstream.address();
    if (address === null || typeof address === "string") {
      throw new Error("Upstream learning test server did not expose a TCP address.");
    }
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({ env: {} });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const learnResponse = await fetch(`http://${host}:${port}/v1/learning/url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "blocked-weixin-residue",
          urls: [`http://127.0.0.1:${address.port}/blocked`],
          privacy: "public",
          nowMs: 1_776_000_040_000,
        }),
      });

      expect(learnResponse.status).toBe(201);
      const payload = (await learnResponse.json()) as {
        result: { candidateCount: number; quarantineCount: number };
        candidates: unknown[];
        quarantines: unknown[];
        urlRead: { status: string; failures: string[]; nextActions: string[] };
      };
      expect(payload.result.candidateCount).toBe(0);
      expect(payload.result.quarantineCount).toBe(1);
      expect(payload.candidates).toHaveLength(0);
      expect(payload.quarantines).toHaveLength(1);
      expect(payload.urlRead.status).toBe("blocked");
      expect(payload.urlRead.failures.join("\n")).toContain("low-quality extracted content");
      expect(payload.urlRead.nextActions.join("\n")).toContain("interactive browser automation");
    } finally {
      await app.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("returns only the current learning run records instead of leaking old experience inventory", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-run-scope-"));
    tempRoots.push(workspaceRoot);
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        [
          "<!doctype html>",
          "<html><head><title>本轮学习资料</title></head><body>",
          "<p>本轮经验：微信学习结果必须只展示本次抓取到的来源、摘要和失败项。</p>",
          "<p>历史经验库可以继续保存，但不能混进模型看到的本轮工具观察。</p>",
          "</body></html>",
        ].join(""),
      );
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => {
        upstream.off("error", reject);
        resolve();
      });
    });
    const address = upstream.address();
    if (address === null || typeof address === "string") {
      throw new Error("Upstream learning run scope test server did not expose a TCP address.");
    }

    const dataDir = join(workspaceRoot, ".hotflow");
    const knowledgeDir = join(workspaceRoot, ".director-angel", "knowledge");
    const experienceStore = new FileExperienceStore({
      experienceDir: join(knowledgeDir, "experience"),
    });
    const oldAdapter = createExperienceSourceAdapterDeclaration({
      adapterId: "old_inventory_adapter",
      sourceKind: "manual",
      sourceRef: "fixture://old-inventory",
      privacy: "internal",
      transformations: [
        {
          transformId: "seed",
          kind: "normalize",
          summary: "Seed old inventory for run scoped learning tests.",
        },
      ],
    });
    await experienceStore.writeCandidate(
      createExperienceCandidate({
        candidateId: "experience_old_inventory",
        sourceAdapter: oldAdapter,
        title: "Old inventory candidate",
        summary: "This old candidate must stay out of the current learning response.",
        applicability: "Fixture only.",
        risks: ["Fixture only."],
        tags: ["fixture", "old-inventory"],
        evidence: [
          {
            evidenceId: "evidence_old_inventory",
            sourceRef: "fixture://old-inventory",
            summary: "Old evidence must not leak into the current response.",
          },
        ],
        privacy: "internal",
        provenance: "director-host-api-test",
        createdAtMs: 1_775_999_000_000,
      }),
    );
    await experienceStore.writeSourceArtifact(
      createExperienceSourceArtifact({
        artifactId: "artifact_old_inventory",
        sourceKind: "manual",
        sourceRef: "fixture://old-inventory-artifact",
        digest: "sha256:old-inventory-artifact",
        bytes: 42,
        textPreview: "Old artifact must not leak into the current response.",
        quality: createExperienceQualityAssessment({
          score: 1,
          verdict: "usable",
          reasons: ["Fixture seed."],
        }),
        privacy: "internal",
        provenance: "director-host-api-test",
        capturedAtMs: 1_775_999_000_000,
      }),
    );
    await experienceStore.writeQuarantineRecord(
      createExperienceQuarantineRecord({
        quarantineId: "quarantine_old_inventory",
        artifact: createExperienceSourceArtifact({
          artifactId: "artifact_old_quarantine",
          sourceKind: "web-page",
          sourceRef: "fixture://old-quarantine",
          digest: "sha256:old-quarantine-artifact",
          bytes: 13,
          textPreview: "Old quarantine must not leak.",
          quality: createExperienceQualityAssessment({
            score: 0,
            verdict: "quarantine",
            reasons: ["Fixture quarantine."],
          }),
          privacy: "public",
          provenance: "director-host-api-test",
          capturedAtMs: 1_775_999_000_001,
        }),
        reason: "Fixture quarantine.",
        notes: ["Old quarantine must stay out of this run response."],
        createdAtMs: 1_775_999_000_001,
      }),
    );

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
      experienceFetchText: async (url) => ({
        url,
        contentType: "text/html",
        body: [
          "<!doctype html>",
          "<html><head><title>本轮学习资料</title></head><body>",
          "<p>本轮经验规则：微信学习结果必须只展示本次抓取到的来源、摘要和失败项。</p>",
          "<p>执行步骤包括来源读取、正文质量判断、候选生成、隔离记录、证据绑定、用户提示和后续审核。</p>",
          "<p>历史经验库可以继续保存，但不能混进模型看到的本轮工具观察；这个方法适合跨端学习入口复用。</p>",
          "</body></html>",
        ].join(""),
      }),
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const learnResponse = await fetch(`http://${host}:${port}/v1/learning/url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "current-run-scope",
          urls: ["https://example.test/current-run"],
          privacy: "public",
          nowMs: 1_776_000_040_000,
        }),
      });

      expect(learnResponse.status).toBe(201);
      const learnPayload = (await learnResponse.json()) as {
        result: { candidateCount: number; artifactCount: number; quarantineCount: number };
        candidates: Array<{ candidateId: string; sourceArtifactId?: string; title: string }>;
        artifacts: Array<{ artifactId: string; sourceRef: string }>;
        quarantines: Array<{ quarantineId: string }>;
      };
      expect(learnPayload.result).toMatchObject({
        candidateCount: 1,
        artifactCount: 1,
        quarantineCount: 0,
      });
      expect(learnPayload.candidates).toHaveLength(1);
      expect(learnPayload.candidates[0]?.candidateId).toContain("current_run_scope");
      expect(learnPayload.candidates.map((candidate) => candidate.candidateId)).not.toContain(
        "experience_old_inventory",
      );
      expect(learnPayload.artifacts).toHaveLength(1);
      expect(learnPayload.artifacts[0]?.sourceRef).toBe("https://example.test/current-run");
      expect(learnPayload.artifacts.map((artifact) => artifact.artifactId)).not.toContain(
        "artifact_old_inventory",
      );
      expect(learnPayload.quarantines).toHaveLength(0);
    } finally {
      await app.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("learns web search queries through the unified Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-query-"));
    tempRoots.push(workspaceRoot);
    const upstream = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/html/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          [
            "<!doctype html>",
            "<html><body>",
            '<a class="result__a" href="/lesson-one">短剧镜头语言</a>',
            '<a class="result__a" href="/lesson-two">导演审查流程</a>',
            "</body></html>",
          ].join(""),
        );
        return;
      }
      if (requestUrl.pathname === "/lesson-two") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          [
            "<html><head><title>导演审查流程</title></head><body>",
            "<p>经验候选必须保留证据、通过人工审查，再晋升为可发布知识。</p>",
            "<p>适用流程：先抓取来源内容，再提炼可复用方法，最后由操作员审核风险、适用场景和证据链。</p>",
            "</body></html>",
          ].join(""),
        );
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        [
          "<html><head><title>短剧镜头语言</title></head><body>",
          "<p>15秒短剧分镜可用中景建立空间、近景推进情绪、特写放大线索。</p>",
          "<p>建议在制作蓝图里记录景别、角度、运镜、角色动作和审查标准，避免每次从零开始。</p>",
          "</body></html>",
        ].join(""),
      );
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => {
        upstream.off("error", reject);
        resolve();
      });
    });
    const address = upstream.address();
    if (address === null || typeof address === "string") {
      throw new Error("Upstream search test server did not expose a TCP address.");
    }
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {
        DIRECTOR_LEARNING_SEARCH_URL: `http://127.0.0.1:${address.port}/html/?q={query}`,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const learnResponse = await fetch(`http://${host}:${port}/v1/learning/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "search-shot-language",
          queries: ["short drama shot language"],
          privacy: "public",
          maxResultsPerQuery: 2,
          nowMs: 1_776_000_045_000,
        }),
      });

      expect(learnResponse.status).toBe(201);
      const learnPayload = (await learnResponse.json()) as {
        schemaId: string;
        result: { status: string; candidateCount: number; artifactCount: number };
        candidates: Array<{
          sourceAdapter: { sourceKind: string };
          runtimeInjection: string;
          tags: string[];
        }>;
        artifacts: Array<{ artifactId: string }>;
      };
      expect(learnPayload.schemaId).toBe("director.host.learning-query.v1");
      expect(learnPayload.result.status).toBe("ok");
      expect(learnPayload.result.candidateCount).toBe(2);
      expect(learnPayload.result.artifactCount).toBe(2);
      expect(learnPayload.candidates).toHaveLength(2);
      expect(learnPayload.candidates[0]).toMatchObject({
        runtimeInjection: "disabled",
        sourceAdapter: expect.objectContaining({ sourceKind: "web-search" }),
      });
      expect(learnPayload.candidates[0]?.tags).toEqual(
        expect.arrayContaining(["source:web-search", "query:short_drama_shot_language"]),
      );
    } finally {
      await app.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("uses an injected learning fetch extractor for Host API URL and search learning", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-fetch-"));
    tempRoots.push(workspaceRoot);
    const upstream = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/html/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          [
            "<!doctype html>",
            "<html><body>",
            '<a class="result__a" href="/browser-only">浏览器态教程</a>',
            "</body></html>",
          ].join(""),
        );
        return;
      }
      response.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><body>plain fetch is blocked</body></html>");
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => {
        upstream.off("error", reject);
        resolve();
      });
    });
    const address = upstream.address();
    if (address === null || typeof address === "string") {
      throw new Error("Upstream learning fetch test server did not expose a TCP address.");
    }
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const fetchedUrls: string[] = [];
    const app = createDirectorHostApiApp({
      env: {
        DIRECTOR_LEARNING_SEARCH_URL: `http://127.0.0.1:${address.port}/html/?q={query}`,
      },
      experienceFetchText: async (url) => {
        fetchedUrls.push(url);
        return {
          url,
          contentType: "text/html",
          structuredContent: {
            kind: "browser-capture",
            blocks: [{ kind: "text", text: "browser extractor was used" }],
          },
          body: [
            "<html><head><title>浏览器态教程</title></head><body>",
            "<p>浏览器抓取经验规则：遇到登录态、脚本壳、验证码或按钮残渣页面时，先用浏览器 extractor 读取正文，再生成待审候选。</p>",
            "<p>执行步骤包括打开原始地址、等待页面稳定、提取可读正文、检查标题和正文质量、保存来源证据、生成候选和进入人工审核。</p>",
            "<p>候选仍然必须保留来源证据、失败原因、质量评分和审核状态，不能直接进入运行时经验库。</p>",
            "</body></html>",
          ].join(""),
        };
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const urlLearnResponse = await fetch(`http://${host}:${port}/v1/learning/url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "browser-fetch-url",
          urls: ["https://example.test/browser-only"],
          privacy: "public",
          nowMs: 1_776_000_050_000,
        }),
      });
      const queryLearnResponse = await fetch(`http://${host}:${port}/v1/learning/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "browser-fetch-query",
          queries: ["browser extractor"],
          privacy: "public",
          maxResultsPerQuery: 1,
          nowMs: 1_776_000_051_000,
        }),
      });

      expect(urlLearnResponse.status).toBe(201);
      expect(queryLearnResponse.status).toBe(201);
      const urlPayload = (await urlLearnResponse.json()) as {
        result: { candidateCount: number; quarantineCount: number };
        artifacts: Array<{ structuredContent?: { kind?: string } }>;
        sourceEvidenceRefs: Array<{ sourceSnapshotId?: string; sourceAccessStatus: string }>;
        memoryEvidenceRecords: Array<{ publishable: boolean; evidenceRefs: string[] }>;
      };
      const queryPayload = (await queryLearnResponse.json()) as {
        result: { candidateCount: number; quarantineCount: number };
        artifacts: Array<{ structuredContent?: { kind?: string } }>;
      };
      expect(urlPayload.result).toMatchObject({ candidateCount: 1, quarantineCount: 0 });
      expect(queryPayload.result).toMatchObject({ candidateCount: 1, quarantineCount: 0 });
      expect(fetchedUrls).toEqual(expect.arrayContaining(["https://example.test/browser-only"]));
      expect(urlPayload.sourceEvidenceRefs[0]).toMatchObject({
        sourceAccessStatus: "available",
      });
      expect(urlPayload.memoryEvidenceRecords[0]).toMatchObject({
        publishable: false,
      });
      expect(urlPayload.memoryEvidenceRecords[0]?.evidenceRefs).toContain(
        urlPayload.sourceEvidenceRefs[0]?.sourceSnapshotId,
      );
      expect(queryPayload.artifacts[0]?.structuredContent).toMatchObject({
        kind: "browser-capture",
      });
      expect(fetchedUrls).toEqual([
        "https://example.test/browser-only",
        `http://127.0.0.1:${address.port}/browser-only`,
      ]);
    } finally {
      await app.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("uses DIRECTOR_LEARNING_FETCH_URL as a browser extraction bridge for Host API learning", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-learning-fetch-url-"));
    tempRoots.push(workspaceRoot);
    const upstream = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/html/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          [
            "<!doctype html>",
            "<html><body>",
            '<a class="result__a" href="/blocked-guide">浏览器桥教程</a>',
            "</body></html>",
          ].join(""),
        );
        return;
      }
      response.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><body>plain fetch is blocked</body></html>");
    });
    const extractorCalls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const extractor = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
      extractorCalls.push({
        url: request.url ?? "",
        method: request.method,
        body,
      });
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          url: body.url,
          contentType: "text/html",
          structuredContent: {
            kind: "browser-capture",
            blocks: [{ kind: "text", text: "HTTP extractor bridge was used" }],
          },
          body: [
            "<html><head><title>浏览器桥教程</title></head><body>",
            "<p>浏览器桥经验：Host API 独立运行时，应该通过本地 browser/web_extract 服务拿正文。</p>",
            "<p>抓取结果仍然只生成待审候选，必须经过人工审核后才能发布为知识。</p>",
            "</body></html>",
          ].join(""),
        }),
      );
    });
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        upstream.once("error", reject);
        upstream.listen(0, "127.0.0.1", () => {
          upstream.off("error", reject);
          resolve();
        });
      }),
      new Promise<void>((resolve, reject) => {
        extractor.once("error", reject);
        extractor.listen(0, "127.0.0.1", () => {
          extractor.off("error", reject);
          resolve();
        });
      }),
    ]);
    const upstreamAddress = upstream.address();
    const extractorAddress = extractor.address();
    if (
      upstreamAddress === null ||
      typeof upstreamAddress === "string" ||
      extractorAddress === null ||
      typeof extractorAddress === "string"
    ) {
      throw new Error("Learning fetch URL test servers did not expose TCP addresses.");
    }
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {
        DIRECTOR_LEARNING_SEARCH_URL: `http://127.0.0.1:${upstreamAddress.port}/html/?q={query}`,
        DIRECTOR_LEARNING_FETCH_URL: `http://127.0.0.1:${extractorAddress.port}/extract`,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const learnResponse = await fetch(`http://${host}:${port}/v1/learning/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: "browser-fetch-url-query",
          queries: ["browser bridge"],
          privacy: "public",
          maxResultsPerQuery: 1,
          nowMs: 1_776_000_052_000,
        }),
      });

      expect(learnResponse.status).toBe(201);
      const payload = (await learnResponse.json()) as {
        result: { candidateCount: number; quarantineCount: number };
        artifacts: Array<{ structuredContent?: { kind?: string } }>;
      };
      expect(payload.result).toMatchObject({ candidateCount: 1, quarantineCount: 0 });
      expect(payload.artifacts[0]?.structuredContent).toMatchObject({
        kind: "browser-capture",
      });
      expect(extractorCalls).toEqual([
        {
          url: "/extract",
          method: "POST",
          body: { url: `http://127.0.0.1:${upstreamAddress.port}/blocked-guide` },
        },
      ]);
    } finally {
      await app.close();
      await Promise.all([
        new Promise<void>((resolve) => upstream.close(() => resolve())),
        new Promise<void>((resolve) => extractor.close(() => resolve())),
      ]);
    }
  });

  it("persists experience taxonomy and Skill taxonomy through the unified Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-taxonomy-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const knowledgeDir = join(workspaceRoot, ".director-angel", "knowledge");
    const experienceStore = new FileExperienceStore({
      experienceDir: join(knowledgeDir, "experience"),
    });
    const experienceCandidate = createExperienceCandidate({
      candidateId: "experience_taxonomy_1",
      sourceAdapter: createExperienceSourceAdapterDeclaration({
        adapterId: "adapter_taxonomy",
        sourceKind: "manual",
        sourceRef: "fixture://host-api/taxonomy",
        privacy: "internal",
        transformations: [],
      }),
      title: "分类测试经验",
      summary: "经验需要能按分类和标签收纳。",
      applicability: "When browsing the Director Angel experience library.",
      risks: ["Classification must not bypass review."],
      tags: ["taxonomy"],
      evidence: [
        {
          evidenceId: "evidence_taxonomy_1",
          sourceRef: "fixture://host-api/taxonomy",
          summary: "Fixture evidence for taxonomy.",
        },
      ],
      privacy: "internal",
      provenance: "director-host-api-test",
      createdAtMs: 1_776_000_070_000,
    });
    await experienceStore.writeCandidate(experienceCandidate);
    mkdirSync(join(dataDir, "skills"), { recursive: true });
    writeFileSync(
      join(dataDir, "skills", "approved-skills.json"),
      `${JSON.stringify(
        {
          schemaVersion: "skills.approved.v2",
          version: 1,
          updatedAtMs: 1_776_000_070_000,
          appliedAtMs: 1_776_000_070_000,
          appliedFromProposalId: null,
          changeKind: "manual",
          previousVersion: null,
          restoredFromVersion: null,
          skills: [
            {
              id: "skill.director.taxonomy",
              version: "1.0.0",
              title: "Skill 分类测试",
              content: "Preserve approved skill taxonomy bindings for recall browsing.",
              tags: ["taxonomy"],
              updatedAtMs: 1_776_000_070_000,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const experienceCategoryResponse = await fetch(
        `http://${host}:${port}/v1/experience/categories`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            categoryId: "director-shot",
            name: "导演镜头",
            description: "镜头语言经验。",
            nowMs: 1_776_000_071_000,
          }),
        },
      );
      expect(experienceCategoryResponse.status).toBe(201);
      const experienceTagResponse = await fetch(`http://${host}:${port}/v1/experience/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tagId: "shot-size",
          name: "景别",
          nowMs: 1_776_000_072_000,
        }),
      });
      expect(experienceTagResponse.status).toBe(201);
      const experienceTaxonomyResponse = await fetch(
        `http://${host}:${port}/v1/experience/candidates/${encodeURIComponent(
          experienceCandidate.candidateId,
        )}/taxonomy`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            categoryId: "director-shot",
            tagIds: ["shot-size"],
            updatedBy: "operator-taxonomy",
            nowMs: 1_776_000_073_000,
          }),
        },
      );
      expect(experienceTaxonomyResponse.ok).toBe(true);
      await expect(experienceTaxonomyResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.experience-taxonomy-update.v1",
        binding: {
          candidateId: experienceCandidate.candidateId,
          categoryId: "director-shot",
          tagIds: ["shot-size"],
          updatedBy: "operator-taxonomy",
        },
      });

      const skillCategoryResponse = await fetch(
        `http://${host}:${port}/v1/skills/taxonomy/categories`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            categoryId: "director-production",
            name: "导演制作",
            nowMs: 1_776_000_074_000,
          }),
        },
      );
      expect(skillCategoryResponse.status).toBe(201);
      const skillTagResponse = await fetch(`http://${host}:${port}/v1/skills/taxonomy/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tagId: "shot-language",
          name: "镜头语言",
          nowMs: 1_776_000_075_000,
        }),
      });
      expect(skillTagResponse.status).toBe(201);
      const skillTaxonomyResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent(
          "skill.director.taxonomy",
        )}/taxonomy`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            categoryId: "director-production",
            tagIds: ["shot-language"],
            updatedBy: "operator-taxonomy",
            nowMs: 1_776_000_076_000,
          }),
        },
      );
      expect(skillTaxonomyResponse.ok).toBe(true);
      await expect(skillTaxonomyResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-taxonomy-update.v1",
        binding: {
          skillId: "skill.director.taxonomy",
          categoryId: "director-production",
          tagIds: ["shot-language"],
          updatedBy: "operator-taxonomy",
        },
      });

      const missingSkillResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.missing")}/taxonomy`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            categoryId: "director-production",
            tagIds: [],
          }),
        },
      );
      expect(missingSkillResponse.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("exposes shared channel commands for external control surfaces", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-commands-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/commands?surface=weixin`);
      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        apiVersion: string;
        schemaId: string;
        surface: string;
        commands: Array<{
          id: string;
          canonicalName: string;
          aliases: string[];
          outputPolicy: string;
          memoryPolicy: string;
          activeSessionPolicy: string;
        }>;
      };
      expect(payload.apiVersion).toBe(DIRECTOR_HOST_API_VERSION);
      expect(payload.schemaId).toBe("director.host.commands.v1");
      expect(payload.surface).toBe("weixin");
      expect(payload.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "production.start",
            canonicalName: "制作",
            outputPolicy: "result-first",
            memoryPolicy: "store-result-only",
          }),
        ]),
      );
      expect(payload.commands.some((command) => command.id === "settings.provider.test")).toBe(
        false,
      );
    } finally {
      await app.close();
    }
  });

  it("manages approved external Skills through enablement, update, and delete routes", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-skill-management-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const skillStore = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
      now: () => 1_776_000_080_000,
    });
    skillStore.writeApproved([
      {
        id: "skill.external-camera",
        version: "1.0.0",
        title: "External Camera Skill",
        description: "Imported camera language skill.",
        content: "Use camera language examples for storyboard production.",
        tags: ["external", "camera"],
        updatedAtMs: 1,
      },
    ]);
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({});
    const { host, port } = await app.start({ port: 0 });

    try {
      const disableResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.external-camera")}/enabled`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: false,
            actor: "operator",
            note: "pause this external skill",
            nowMs: 1_776_000_081_000,
          }),
        },
      );
      expect(disableResponse.ok).toBe(true);
      await expect(disableResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-management.v1",
        skill: {
          id: "skill.external-camera",
          enabled: false,
        },
        management: {
          disabledSkillIds: ["skill.external-camera"],
        },
      });

      const updateResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.external-camera")}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "外部镜头语言 Skill",
            description: "中文简介：用于短剧分镜里的景别、机位和运镜参考。",
            tags: ["external", "camera", "director"],
            actor: "operator",
            nowMs: 1_776_000_082_000,
          }),
        },
      );
      expect(updateResponse.ok).toBe(true);
      await expect(updateResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-update.v1",
        skill: {
          id: "skill.external-camera",
          title: "外部镜头语言 Skill",
          description: "中文简介：用于短剧分镜里的景别、机位和运镜参考。",
          enabled: false,
          tags: ["external", "camera", "director"],
        },
        snapshot: {
          version: 2,
          changeKind: "manual",
        },
      });

      const skillsResponse = await fetch(`http://${host}:${port}/v1/skills`);
      const skillsPayload = (await skillsResponse.json()) as {
        skills: Array<{ id: string; enabled: boolean; title: string }>;
      };
      expect(skillsPayload.skills).toEqual([
        expect.objectContaining({
          id: "skill.external-camera",
          enabled: false,
          title: "外部镜头语言 Skill",
        }),
      ]);

      const deleteResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.external-camera")}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "operator",
            note: "remove obsolete external skill",
          }),
        },
      );
      expect(deleteResponse.ok).toBe(true);
      await expect(deleteResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-delete.v1",
        deletedSkillId: "skill.external-camera",
        management: {
          disabledSkillIds: [],
        },
        snapshot: {
          version: 3,
        },
      });

      const afterDeleteResponse = await fetch(`http://${host}:${port}/v1/skills`);
      const afterDeletePayload = (await afterDeleteResponse.json()) as {
        skills: unknown[];
        management: { disabledSkillIds: string[] };
      };
      expect(afterDeletePayload.skills).toEqual([]);
      expect(afterDeletePayload.management.disabledSkillIds).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("records approved Skill use through the Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-skill-use-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const skillStore = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
      now: () => 1_776_000_090_000,
    });
    skillStore.writeApproved([
      {
        id: "skill.comfyui-workflow",
        version: "1.0.0",
        title: "ComfyUI Workflow Skill",
        description: "Use ComfyUI workflow planning.",
        content: "Plan script, image prompt, and video prompt nodes scene by scene.",
        tags: ["comfyui", "workflow"],
        updatedAtMs: 1,
      },
    ]);
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({});
    const { host, port } = await app.start({ port: 0 });

    try {
      const response = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.comfyui-workflow")}/use`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "weixin-conversation-runtime",
            reason: "用户要求按 ComfyUI Skill 创建工作流。",
            nowMs: 1_776_000_091_000,
          }),
        },
      );

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-use.v1",
        skill: {
          id: "skill.comfyui-workflow",
          enabled: true,
        },
        usage: {
          skillId: "skill.comfyui-workflow",
          useCount: 1,
          lastUsedAtMs: 1_776_000_091_000,
        },
      });
      const viewResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.comfyui-workflow")}`,
      );
      await expect(viewResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-view.v1",
        skill: {
          id: "skill.comfyui-workflow",
          usage: expect.objectContaining({
            useCount: 1,
            lastUsedAtMs: 1_776_000_091_000,
          }),
        },
      });
      expect(
        new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readRecord(
          "skill.comfyui-workflow",
        ),
      ).toMatchObject({
        useCount: 1,
        events: [
          expect.objectContaining({
            action: "use",
            actor: "weixin-conversation-runtime",
            reason: "用户要求按 ComfyUI Skill 创建工作流。",
          }),
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("refuses model invocation disabled Skills through Host API view and use routes", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-skill-model-disabled-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const skillStore = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
      now: () => 1_776_000_094_000,
    });
    skillStore.writeApproved([
      {
        id: "skill.operator-only-browser",
        version: "1.0.0",
        title: "Operator Only Browser Skill",
        description: "Operator-only browser workflow.",
        content: "Privileged browser workflow. Only an operator may run this directly.",
        tags: ["browser", "operator"],
        metadata: {
          disableModelInvocation: true,
        },
        updatedAtMs: 1,
      },
    ]);
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({});
    const { host, port } = await app.start({ port: 0 });

    try {
      const viewResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.operator-only-browser")}/view`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "weixin-conversation-runtime",
            reason: "用户要求读取 operator-only Skill。",
            nowMs: 1_776_000_095_000,
          }),
        },
      );
      expect(viewResponse.ok).toBe(true);
      await expect(viewResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-view.v1",
        status: "model_invocation_disabled",
        skill: {
          id: "skill.operator-only-browser",
          enabled: false,
          configuredEnabled: true,
          modelVisible: false,
          modelInvocable: false,
        },
        usage: null,
      });

      const useResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.operator-only-browser")}/use`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "weixin-conversation-runtime",
            reason: "用户要求应用 operator-only Skill。",
            nowMs: 1_776_000_096_000,
          }),
        },
      );
      await expect(useResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-use.v1",
        status: "model_invocation_disabled",
        skill: {
          id: "skill.operator-only-browser",
          modelVisible: false,
          modelInvocable: false,
        },
        usage: null,
      });
      expect(
        new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readRecord(
          "skill.operator-only-browser",
        ),
      ).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("marks Host API Skills as needs-setup when declared model tools are unavailable", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-skill-needs-setup-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const skillStore = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
      now: () => 1_776_000_097_000,
    });
    skillStore.writeApproved([
      {
        id: "skill.twitter-research",
        version: "1.0.0",
        title: "Twitter Research Skill",
        description: "Research fresh X/Twitter posts before learning.",
        content: "Use x_search before summarizing the latest social posts.",
        tags: ["research", "twitter"],
        toolNames: ["x_search"],
        updatedAtMs: 1,
      },
    ]);
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_097_000 });
    registry.register({
      manifest: {
        id: "x_search",
        label: "x_search",
        description: "Search X/Twitter.",
        source: "external",
        kind: "model-tool",
        providerId: "x",
        capabilities: [{ id: "x.search", label: "Search", readOnly: true }],
      },
      check: () => ({
        status: "needs-auth",
        summary: "X provider needs an API key.",
        nextActions: ["配置 X/Twitter API provider。"],
      }),
    });
    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(
        workspaceRoot,
        dataDir,
        [],
        {},
        {
          externalToolControlPlane: createExternalToolControlPlane(registry),
        },
      ),
    );
    const app = createDirectorHostApiApp({});
    const { host, port } = await app.start({ port: 0 });

    try {
      const skillsResponse = await fetch(`http://${host}:${port}/v1/skills`);
      expect(skillsResponse.ok).toBe(true);
      await expect(skillsResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skills.v1",
        summary: expect.objectContaining({
          total: 1,
          readyCount: 0,
          needsSetupCount: 1,
          blockedCount: 1,
          modelVisibleCount: 0,
          status: "needs-attention",
          missingToolNames: ["x_search"],
          nextActions: expect.arrayContaining([expect.stringContaining("外部工具 provider")]),
        }),
        skills: [
          expect.objectContaining({
            id: "skill.twitter-research",
            enabled: false,
            configuredEnabled: true,
            eligible: false,
            modelVisible: false,
            runtimeStatus: "needs-setup",
            doctorStatus: "needs-setup",
            permissionStatus: "needs-setup",
            missingToolNames: ["x_search"],
            nextActions: ["x_search: 配置 X/Twitter API provider。"],
            explanationSurface: expect.objectContaining({
              schemaId: "skills.explanation-surface.v1",
              status: "needs-setup",
              statusExplanation: expect.stringContaining("x_search"),
              nextActions: expect.arrayContaining(["x_search: 配置 X/Twitter API provider。"]),
            }),
          }),
        ],
      });

      const catalogResponse = await fetch(`http://${host}:${port}/v1/catalog`);
      expect(catalogResponse.ok).toBe(true);
      await expect(catalogResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.catalog.v1",
        skillSummary: expect.objectContaining({
          total: 1,
          needsSetupCount: 1,
          missingToolNames: ["x_search"],
          status: "needs-attention",
        }),
      });

      const viewResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.twitter-research")}/view`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "weixin-conversation-runtime",
            note: "用户要求用 Twitter Skill 学习最新经验。",
            nowMs: 1_776_000_098_000,
          }),
        },
      );
      expect(viewResponse.ok).toBe(true);
      await expect(viewResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-view.v1",
        status: "needs_setup",
        skill: expect.objectContaining({
          id: "skill.twitter-research",
          doctorStatus: "needs-setup",
          modelVisible: false,
          explanationSurface: expect.objectContaining({
            status: "needs-setup",
            statusExplanation: expect.stringContaining("x_search"),
          }),
        }),
        usage: null,
      });

      const useResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.twitter-research")}/use`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "weixin-conversation-runtime",
            note: "用户要求应用 Twitter Skill。",
            nowMs: 1_776_000_099_000,
          }),
        },
      );
      expect(useResponse.ok).toBe(true);
      await expect(useResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-use.v1",
        status: "needs_setup",
        skill: expect.objectContaining({
          id: "skill.twitter-research",
          doctorStatus: "needs-setup",
          modelVisible: false,
          explanationSurface: expect.objectContaining({
            status: "needs-setup",
            statusExplanation: expect.stringContaining("x_search"),
          }),
        }),
        usage: null,
      });
      expect(
        new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readRecord(
          "skill.twitter-research",
        ),
      ).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("returns missing_skill for removed Skill view and use without recording usage", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-skill-missing-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
      now: () => 1_776_000_100_000,
    }).writeApproved([]);
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({});
    const { host, port } = await app.start({ port: 0 });

    try {
      const viewResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.removed-twitter")}/view`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "weixin-conversation-runtime",
            note: "旧上下文要求读取已删除 Skill。",
            nowMs: 1_776_000_101_000,
          }),
        },
      );
      expect(viewResponse.ok).toBe(true);
      await expect(viewResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-view.v1",
        status: "missing_skill",
        skill: {
          id: "skill.removed-twitter",
          enabled: false,
          modelVisible: false,
          runtimeStatus: "missing-skill",
          explanationSurface: expect.objectContaining({
            schemaId: "skills.explanation-surface.v1",
            status: "missing-skill",
            statusExplanation: expect.stringContaining("旧上下文"),
            nextActions: expect.arrayContaining([expect.stringContaining("刷新 Skill 索引")]),
          }),
        },
        usage: null,
      });

      const useResponse = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("skill.removed-twitter")}/use`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "weixin-conversation-runtime",
            note: "旧上下文要求使用已删除 Skill。",
            nowMs: 1_776_000_102_000,
          }),
        },
      );
      expect(useResponse.ok).toBe(true);
      await expect(useResponse.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-use.v1",
        status: "missing_skill",
        skill: {
          id: "skill.removed-twitter",
          enabled: false,
          modelVisible: false,
          runtimeStatus: "missing-skill",
          explanationSurface: expect.objectContaining({
            status: "missing-skill",
            statusExplanation: expect.stringContaining("旧上下文"),
          }),
        },
        usage: null,
      });
      expect(
        new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readRecord("skill.removed-twitter"),
      ).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("keeps Host API Skill curator write checks fail-closed without mutating Skill state", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-skill-curator-guard-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
      now: () => 1_776_000_103_000,
    }).writeApproved([
      {
        id: "skill.failed-curator",
        version: "1.0.0",
        title: "Failed Curator Skill",
        content: "A Skill that should only be patched from local desktop Review/Ops.",
        updatedAtMs: 1_776_000_103_000,
      },
    ]);
    const usageStore = new SkillUsageStore(resolveSkillUsagePath({ dataDir }), {
      now: () => 1_776_000_103_000,
    });
    usageStore.recordFailure("skill.failed-curator", {
      actor: "runtime",
      reason: "fixture failure",
      nowMs: 1_776_000_103_100,
    });
    const usageBefore = usageStore.readRecord("skill.failed-curator");

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({});
    const { host, port } = await app.start({ port: 0 });

    try {
      const guardResponse = await fetch(`http://${host}:${port}/v1/skills/curator/actions/guard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "patch",
          skillId: "skill.failed-curator",
          actor: "weixin-conversation-runtime",
          scopes: ["skills.curator.write"],
          reason: "remote channel tried to patch failed Skill",
          nowMs: 1_776_000_103_200,
        }),
      });
      const guardText = await guardResponse.text();
      expect(guardResponse.ok, guardText).toBe(true);
      expect(JSON.parse(guardText)).toMatchObject({
        schemaId: "director.host.skill-curator-write-guard.v1",
        guard: expect.objectContaining({
          schemaId: "skills.curator-write-guard.v1",
          allowed: false,
          status: "blocked",
          reasonCode: "remote_surface_blocked",
          operatorSurface: "host-api",
          requestedAction: expect.objectContaining({
            kind: "patch",
            skillId: "skill.failed-curator",
          }),
          requiredScopes: ["skills.curator.write"],
          evidenceRefs: expect.arrayContaining([
            "skill-curator://patch/skill.failed-curator",
            "skills.curator-write-guard://remote-surface-blocked",
          ]),
        }),
        status: "blocked",
        applied: false,
      });

      expect(
        new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readRecord("skill.failed-curator"),
      ).toEqual(usageBefore);
      expect(
        new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir })).readApproved(),
      ).toEqual([
        expect.objectContaining({
          id: "skill.failed-curator",
          title: "Failed Curator Skill",
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it("records approved Skill view through the Host API without treating it as use", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-skill-view-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const skillStore = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
      now: () => 1_776_000_092_000,
    });
    skillStore.writeApproved([
      {
        id: "skill.backend-snapshot",
        version: "1.0.0",
        title: "Backend Snapshot Skill",
        description: "Read approved skills before answering.",
        content: "Inspect the full Skill text before applying it.",
        tags: ["backend", "snapshot"],
        updatedAtMs: 1,
      },
    ]);
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({});
    const { host, port } = await app.start({ port: 0 });

    try {
      const response = await fetch(
        `http://${host}:${port}/v1/skills/${encodeURIComponent("Backend Snapshot Skill")}/view`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "desktop-conversation-runtime",
            reason: "需要读取 Skill 全文再回答。",
            nowMs: 1_776_000_093_000,
          }),
        },
      );

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        schemaId: "director.host.skill-view.v1",
        status: "viewed",
        skill: {
          id: "skill.backend-snapshot",
          usage: expect.objectContaining({
            viewCount: 1,
            useCount: 0,
            lastViewedAtMs: 1_776_000_093_000,
          }),
        },
        usage: {
          skillId: "skill.backend-snapshot",
          viewCount: 1,
          useCount: 0,
        },
      });
      expect(
        new SkillUsageStore(resolveSkillUsagePath({ dataDir })).readRecord(
          "skill.backend-snapshot",
        ),
      ).toMatchObject({
        viewCount: 1,
        useCount: 0,
        events: [
          expect.objectContaining({
            action: "view",
            actor: "desktop-conversation-runtime",
          }),
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("previews and applies runtime log and experience maintenance through the Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-maintenance-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const runtimeRoot = join(workspaceRoot, ".director-angel", "runtime");
    const logsDir = join(runtimeRoot, "logs");
    mkdirSync(logsDir, { recursive: true });
    const oldLog = join(logsDir, "weixin-gateway.out.log");
    writeFileSync(oldLog, "old gateway log\n", "utf8");
    const oldLogDate = new Date("2026-04-01T00:00:00.000Z");
    utimesSync(oldLog, oldLogDate, oldLogDate);

    const experienceDir = join(workspaceRoot, ".director-angel", "knowledge", "experience");
    const experienceStore = new FileExperienceStore({ experienceDir });
    const keep = createExperienceCandidate({
      ...createMaintenanceExperienceFixture("keep_recent", "digest:keep", 90),
      createdAtMs: Date.parse("2026-05-02T00:00:00.000Z"),
    });
    const duplicate = createExperienceCandidate({
      ...createMaintenanceExperienceFixture("archive_duplicate", "digest:keep", 60),
      createdAtMs: Date.parse("2026-04-30T00:00:00.000Z"),
    });
    const rejected = createExperienceCandidate({
      ...createMaintenanceExperienceFixture("archive_rejected", "digest:rejected", 70),
      createdAtMs: Date.parse("2026-04-01T00:00:00.000Z"),
    });
    await experienceStore.writeCandidate(keep);
    await experienceStore.writeCandidate(duplicate);
    await experienceStore.writeCandidate(rejected);
    await experienceStore.writeReviewDecision(
      createExperienceReviewDecision({
        decisionId: "review_rejected",
        candidateId: rejected.candidateId,
        gate: "human",
        decision: "rejected",
        decidedAtMs: Date.parse("2026-04-02T00:00:00.000Z"),
      }),
    );
    await experienceStore.writeReviewDecision(
      createExperienceReviewDecision({
        decisionId: "review_keep_accept",
        candidateId: keep.candidateId,
        gate: "human",
        decision: "accepted",
        decidedAtMs: Date.parse("2026-05-02T01:00:00.000Z"),
      }),
    );
    await experienceStore.writePromotion(
      createExperiencePromotionRecord({
        promotionId: "promotion_keep_recent",
        candidateId: keep.candidateId,
        promotedTo: "director-knowledge-candidate",
        promotedRef: "knowledge://candidate/keep_recent",
        promotedAtMs: Date.parse("2026-05-02T02:00:00.000Z"),
      }),
    );

    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const previewResponse = await fetch(
        `http://${host}:${port}/v1/maintenance?nowMs=${Date.parse(
          "2026-05-03T00:00:00.000Z",
        )}&logRetentionDays=7&archiveRejectedExperienceAfterDays=7`,
      );
      expect(previewResponse.ok).toBe(true);
      const previewPayload = (await previewResponse.json()) as {
        schemaId: string;
        mode: string;
        logMaintenance: { actions: Array<{ sourcePath: string; status: string }> };
        experienceMaintenance: {
          actions: Array<{ candidateId: string; reason: string; status: string }>;
        };
      };
      expect(previewPayload.schemaId).toBe("director.host.maintenance.v1");
      expect(previewPayload.mode).toBe("preview");
      expect(previewPayload.logMaintenance.actions).toEqual([
        expect.objectContaining({ sourcePath: oldLog, status: "preview" }),
      ]);
      expect(previewPayload.experienceMaintenance.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidateId: rejected.candidateId,
            reason: "latest-review-rejected",
            status: "preview",
          }),
          expect.objectContaining({
            candidateId: duplicate.candidateId,
            reason: "duplicate-lower-signal",
            status: "preview",
          }),
        ]),
      );
      expect(existsSync(oldLog)).toBe(true);

      const applyResponse = await fetch(`http://${host}:${port}/v1/maintenance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nowMs: Date.parse("2026-05-03T00:00:00.000Z"),
          policy: {
            logRetentionDays: 7,
            archiveRejectedExperienceAfterDays: 7,
          },
        }),
      });
      expect(applyResponse.ok).toBe(true);
      const applyPayload = (await applyResponse.json()) as {
        mode: string;
        auditPath: string;
        logMaintenance: { actions: Array<{ status: string; targetPath: string }> };
      };
      expect(applyPayload.mode).toBe("apply");
      expect(applyPayload.logMaintenance.actions[0]).toMatchObject({ status: "applied" });
      expect(existsSync(oldLog)).toBe(false);
      expect(existsSync(applyPayload.auditPath)).toBe(true);
      expect(
        (await experienceStore.listCandidates()).map((candidate) => candidate.candidateId),
      ).toEqual([keep.candidateId]);
    } finally {
      await app.close();
    }
  });

  it("exposes a compact runtime preflight surface for a ready host runtime", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-preflight-ready-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/runtime/preflight`);
      expect(response.ok).toBe(true);
      const payload = (await response.json()) as unknown;
      expect(isDirectorRuntimePreflightResponse(payload)).toBe(true);

      if (!isDirectorRuntimePreflightResponse(payload)) {
        throw new Error("Runtime preflight payload did not match the contract.");
      }

      expect(payload.status).toBe("pass");
      expect(payload.readiness).toBe("ready");
      expect(payload.recommendedCommand).toBe("hotflow preflight");
      expect(payload.recommendedRoute).toEqual({
        method: "POST",
        path: "/v1/entry/intake",
      });
      expect(payload.surfaces.adapters.counts.media).toBe(1);
      expect(payload.surfaces.adapters.counts.execution).toBe(1);
      expect(payload.summaryText).toContain("ready");
    } finally {
      await app.close();
    }
  });

  it("marks runtime preflight as needs-attention when provider registration is still missing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-preflight-warn-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const runtime = createMockRuntime(workspaceRoot, dataDir);
    mockBootstrapDirectorHostApi.mockReturnValue({
      ...runtime,
      providerIds: [],
      runtimeCapabilitySnapshot: runtime.adapterRegistry.buildRuntimeCapabilitySnapshot({
        runtimeId: "director-host-api",
        capturedAt: "2026-04-15T12:00:00.000Z",
        runtimeStatus: "degraded",
        switchState: runtime.switchState,
        notes: [
          "No external providers are registered yet, but deterministic preflight is still available.",
        ],
      }),
    });
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/runtime/preflight`);
      expect(response.ok).toBe(true);
      const payload = (await response.json()) as unknown;
      expect(isDirectorRuntimePreflightResponse(payload)).toBe(true);

      if (!isDirectorRuntimePreflightResponse(payload)) {
        throw new Error("Runtime preflight payload did not match the contract.");
      }

      expect(payload.status).toBe("warn");
      expect(payload.readiness).toBe("needs-attention");
      expect(payload.recommendedCommand).toBe("hotflow doctor");
      expect(payload.recommendedRoute).toBeUndefined();
      expect(payload.summaryText).toContain("no default provider");
    } finally {
      await app.close();
    }
  });

  it("blocks runtime preflight when no execution adapter is available", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-preflight-blocked-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const switchState = resolveDirectorSwitchState();
    const adapterRegistry = new DirectorAdapterRegistry([
      createMockHostAdapter({
        adapterId: "director-host-api",
      }),
      createMockMediaAdapter({
        adapterId: "scripted",
        bindingId: "binding-a",
        provider: "scripted",
      }),
    ]);
    mockBootstrapDirectorHostApi.mockReturnValue({
      config: {
        workspaceRoot,
        dataDir,
        defaultProvider: "scripted",
        defaultModel: "hotflow-phase1",
      },
      providerIds: ["scripted"],
      apiProviders: [],
      internalPluginIds: [],
      adapterRegistry,
      runtimeCapabilitySnapshot: adapterRegistry.buildRuntimeCapabilitySnapshot({
        runtimeId: "director-host-api",
        capturedAt: "2026-04-15T12:00:00.000Z",
        runtimeStatus: "ready",
        switchState,
      }),
      switchPath: join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
      switchState,
      observationPath: join(workspaceRoot, ".director-angel", "runtime", "observations.ndjson"),
      sessionStore: {
        close: vi.fn(),
      },
    });
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/runtime/preflight`);
      expect(response.ok).toBe(true);
      const payload = (await response.json()) as unknown;
      expect(isDirectorRuntimePreflightResponse(payload)).toBe(true);

      if (!isDirectorRuntimePreflightResponse(payload)) {
        throw new Error("Runtime preflight payload did not match the contract.");
      }

      expect(payload.status).toBe("fail");
      expect(payload.readiness).toBe("blocked");
      expect(payload.recommendedCommand).toBe("hotflow doctor");
      expect(payload.recommendedRoute).toBeUndefined();
      expect(payload.summaryText).toContain("execution adapter");
    } finally {
      await app.close();
    }
  });

  it("controls execution runs through start, pause, resume, retry validation, report, and abort endpoints", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-runs-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-run-1",
        createdAt: "2026-04-11T12:00:00.000Z",
        host: {
          hostId: "host-1",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-1",
          title: "Director Run Control",
          outline: "验证导演执行控制面。",
        },
        group: {
          groupId: "group-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-a"],
        },
        runtime: {
          runtimeId: "runtime-1",
          status: "ready",
          availableBindings: ["binding-a"],
          maxPromptChars: 4096,
          supportsVideo: true,
        },
        intent: {
          bindingPolicy: "prefer",
          preferredImageBinding: "binding-a",
        },
      };
      const intake = {
        intakeId: "intake-snapshot-run-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["preview-safe director handoff"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-run-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...(intake.deliverables ?? [])],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });
      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as {
        blueprintId: string;
        handoff: { handoffId: string };
      };

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blueprintPayload),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as {
        runId: string;
        status: string;
      };
      expect(runPayload.status).toBe("created");

      const workerStore = new SessionStore({
        dbPath: join(dataDir, "sessions", "worker-jobs.sqlite"),
      });
      try {
        const mailbox = readSessionWorkerMailbox(workerStore, runPayload.runId, {
          workerId: "director-researcher",
        });
        expect(mailbox).toMatchObject({
          workerId: "director-researcher",
          mailboxSize: 1,
          coverage: "aligned",
          delegationIds: [
            `delegation_${runPayload.runId.replace(/[^a-z0-9_]+/giu, "_")}_assignment_snapshot_run_1_researcher`,
          ],
        });
        expect(mailbox.items[0]?.instruction).toContain("Role: researcher");
      } finally {
        workerStore.close();
      }

      const delegationResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/delegations`,
      );
      expect(delegationResponse.ok).toBe(true);
      const delegationPayload = (await delegationResponse.json()) as {
        runId: string;
        delegationCount: number;
        pendingDelegationCount: number;
        subagentRunCount: number;
        queuedSubagentRunCount: number;
        workerIds: string[];
        subagentSchedulerTick: { dispatchIntents: unknown[] };
        delegations: Array<{ workerId: string; status: string; instruction: string }>;
      };
      expect(delegationPayload).toMatchObject({
        runId: runPayload.runId,
        delegationCount: 5,
        pendingDelegationCount: 5,
        subagentRunCount: 5,
        queuedSubagentRunCount: 5,
      });
      expect(delegationPayload.workerIds).toContain("director-script-planner");
      expect(delegationPayload.subagentSchedulerTick.dispatchIntents).toHaveLength(5);
      expect(delegationPayload.delegations[0]?.instruction).toContain("Objective:");

      const schedulerExecutorResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/scheduler-executor`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ maxDispatches: 1 }),
        },
      );
      expect(schedulerExecutorResponse.ok).toBe(true);
      const schedulerExecutorPayload = (await schedulerExecutorResponse.json()) as {
        runId: string;
        schemaId: string;
        schedulerExecutor: {
          status: string;
          sessionId: string;
          executorMode: string;
          executedCount: number;
          dispatchReports: Array<{ finalDelegationStatus: string }>;
        };
        runDelegations: {
          completedDelegationCount: number;
          pendingDelegationCount: number;
          completedSubagentRunCount: number;
          subagentSchedulerHeartbeat: { readyCount: number; stoppedReason: string };
        };
      };
      expect(schedulerExecutorPayload).toMatchObject({
        runId: runPayload.runId,
        schemaId: "director.host.run-scheduler-executor.v1",
        schedulerExecutor: {
          status: "ok",
          sessionId: runPayload.runId,
          executorMode: "bounded-local",
          executedCount: 1,
        },
        runDelegations: {
          completedDelegationCount: 1,
          pendingDelegationCount: 4,
          completedSubagentRunCount: 1,
        },
      });
      expect(schedulerExecutorPayload.schedulerExecutor.dispatchReports[0]).toMatchObject({
        finalDelegationStatus: "completed",
      });
      expect(schedulerExecutorPayload.runDelegations.subagentSchedulerHeartbeat.readyCount).toBe(4);

      const schedulerRecoveryResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/scheduler-recovery`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(schedulerRecoveryResponse.ok).toBe(true);
      const schedulerRecoveryPayload = (await schedulerRecoveryResponse.json()) as {
        runId: string;
        schemaId: string;
        schedulerRecovery: {
          status: string;
          sessionId: string;
          workflowMode: string;
          dryRun: boolean;
          safety: { destructiveActionsRequireConfirmation: boolean };
        };
        runDelegations: {
          pendingDelegationCount: number;
          subagentSchedulerRecoveryPlan: { canRecover: boolean };
        };
      };
      expect(schedulerRecoveryPayload).toMatchObject({
        runId: runPayload.runId,
        schemaId: "director.host.run-scheduler-recovery.v1",
        schedulerRecovery: {
          status: "ok",
          sessionId: runPayload.runId,
          workflowMode: "bounded-local-recovery",
          dryRun: true,
          safety: {
            destructiveActionsRequireConfirmation: true,
          },
        },
        runDelegations: {
          pendingDelegationCount: 4,
        },
      });

      const startResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/start`,
        {
          method: "POST",
        },
      );
      expect(startResponse.ok).toBe(true);
      const startedRun = (await startResponse.json()) as { status: string };
      expect(startedRun.status).toBe("running");

      const pauseResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/pause`,
        {
          method: "POST",
        },
      );
      expect(pauseResponse.ok).toBe(true);
      const pausedRun = (await pauseResponse.json()) as { status: string };
      expect(pausedRun.status).toBe("paused");

      const resumeResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/resume`,
        {
          method: "POST",
        },
      );
      expect(resumeResponse.ok).toBe(true);
      const resumedRun = (await resumeResponse.json()) as { status: string };
      expect(resumedRun.status).toBe("running");

      const retryValidationResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(retryValidationResponse.status).toBe(400);

      const approveValidationResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(approveValidationResponse.status).toBe(400);

      const reportResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/report`,
      );
      expect(reportResponse.ok).toBe(true);
      const reportPayload = (await reportResponse.json()) as {
        runId: string;
        run: { runId: string; status: string };
        operatorSurface: {
          directorGoal: string;
          operatorSummary?: string;
          objective?: string;
          deliverable?: string;
        };
      };
      expect(reportPayload.runId).toBe(runPayload.runId);
      expect(reportPayload.run.runId).toBe(runPayload.runId);
      expect(reportPayload.run.status).toBe("running");
      expect(reportPayload.operatorSurface.directorGoal).toBe("验证导演执行控制面。");
      expect(reportPayload.operatorSurface.operatorSummary).toBe(
        "验证导演执行控制面。 is ready for deterministic crew delegation.",
      );
      expect(reportPayload.operatorSurface.objective).toBe(
        "Turn the approved research brief into a deterministic story outline.",
      );
      expect(reportPayload.operatorSurface.deliverable).toBe("Story outline");

      const catalogResponse = await fetch(`http://${host}:${port}/v1/catalog`);
      expect(catalogResponse.ok).toBe(true);
      const catalogPayload = (await catalogResponse.json()) as {
        executionRunCount: number;
        executionReportCount: number;
        latestRun: { runId: string; status: string } | null;
        latestReport: {
          runId: string;
          reportId: string;
          runStatus: string;
          operatorSummary?: string;
          assignments: Array<{ assignmentId: string; status: string }>;
        } | null;
        executionItems: Array<{ runId: string; status: string }>;
        executionReportItems: Array<{ runId: string; reportId: string; runStatus: string }>;
      };
      expect(catalogPayload.executionRunCount).toBe(1);
      expect(catalogPayload.executionReportCount).toBe(1);
      expect(catalogPayload.latestRun).toMatchObject({
        runId: runPayload.runId,
        status: "running",
      });
      expect(catalogPayload.latestReport).toMatchObject({
        runId: runPayload.runId,
        runStatus: "running",
        operatorSummary: "验证导演执行控制面。 is ready for deterministic crew delegation.",
      });
      expect(catalogPayload.latestReport?.assignments[0]).toMatchObject({
        assignmentId: expect.any(String),
        status: expect.any(String),
      });
      expect(catalogPayload.executionItems[0]).toMatchObject({
        runId: runPayload.runId,
        status: "running",
      });
      expect(catalogPayload.executionReportItems[0]).toMatchObject({
        runId: runPayload.runId,
        runStatus: "running",
      });

      const abortResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/abort`,
        {
          method: "POST",
        },
      );
      expect(abortResponse.ok).toBe(true);
      const abortedRun = (await abortResponse.json()) as {
        status: string;
        assignments: Array<{ status: string }>;
      };
      expect(abortedRun.status).toBe("aborted");
      expect(abortedRun.assignments.every((assignment) => assignment.status === "aborted")).toBe(
        true,
      );
    } finally {
      await app.close();
    }
  });

  it("exposes a safe bridge summary in runtime snapshot responses", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-bridge-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const switchState = resolveDirectorSwitchState();
    const adapterRegistry = new DirectorAdapterRegistry([
      createMockHostAdapter({
        adapterId: "director-host-api",
      }),
      {
        adapterId: "seedance-preview",
        adapterKind: "media",
        provider: "seedance",
        bindingId: "seedance-preview",
        enabled: true,
        healthStatus: "ready",
        dryRunSupported: true,
        mockOnly: false,
        supportedActionClasses: ["generate"],
        mediaCapability: {
          adapterId: "seedance-preview",
          adapterKind: "media",
          provider: "seedance",
          supportedModes: ["text_to_video"],
          inputModalities: ["text"],
          outputArtifactTypes: ["video"],
          supportsAsync: false,
          healthStatus: "ready",
        },
        bridge: {
          kind: "http-json",
          baseUrl: "https://bridge.example.test",
          submitPath: "/v1/jobs",
          timeoutMs: 30_000,
          authEnvVar: "SEEDANCE_API_KEY",
          headers: {
            "x-bridge-secret": "header-secret",
          },
        },
      } as never,
      createMockExecutionAdapter({
        adapterId: "beta1-handoff-preview",
      }),
    ]);

    mockBootstrapDirectorHostApi.mockReturnValue({
      config: {
        workspaceRoot,
        dataDir,
        defaultProvider: "seedance",
        defaultModel: "hotflow-phase1",
      },
      providerIds: ["seedance"],
      apiProviders: [],
      internalPluginIds: [],
      adapterRegistry,
      runtimeCapabilitySnapshot: adapterRegistry.buildRuntimeCapabilitySnapshot({
        runtimeId: "director-host-api",
        capturedAt: "2026-04-13T16:00:00.000Z",
        runtimeStatus: "ready",
        switchState,
      }),
      switchPath: join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
      switchState,
      observationPath: join(workspaceRoot, ".director-angel", "runtime", "observations.ndjson"),
      sessionStore: {
        close: vi.fn(),
      },
    });

    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const runtimeSnapshotResponse = await fetch(`http://${host}:${port}/v1/runtime/snapshot`);
      expect(runtimeSnapshotResponse.ok).toBe(true);
      const runtimeSnapshotPayload = (await runtimeSnapshotResponse.json()) as {
        capabilitySnapshot: {
          adapters: Array<{
            adapterId: string;
            bridge?: {
              kind: string;
              endpointOrigin: string;
              endpointPath: string;
              authMode: string;
              timeoutMs: number;
              headerKeys?: string[];
            };
          }>;
        };
      };

      const adapter = runtimeSnapshotPayload.capabilitySnapshot.adapters.find(
        (entry) => entry.adapterId === "seedance-preview",
      );
      expect(adapter?.bridge).toEqual({
        kind: "http-json",
        endpointOrigin: "https://bridge.example.test",
        endpointPath: "/v1/jobs",
        authMode: "env",
        timeoutMs: 30_000,
        headerKeys: ["x-bridge-secret"],
      });
      expect(JSON.stringify(runtimeSnapshotPayload)).not.toContain("SEEDANCE_API_KEY");
      expect(JSON.stringify(runtimeSnapshotPayload)).not.toContain("header-secret");
    } finally {
      await app.close();
    }
  });

  it("submits Director bridge envelopes through the configured API media provider", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-provider-bridge-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const upstreamBodies: unknown[] = [];
    const upstream = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        upstreamBodies.push(JSON.parse(raw) as unknown);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ url: "https://cdn.example.test/shot.png" }] }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => {
        upstream.off("error", reject);
        resolve();
      });
    });
    const upstreamAddress = upstream.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") {
      throw new Error("Upstream test server did not expose a TCP address.");
    }
    await updateDirectorApiProviderSetting(join(workspaceRoot, ".director-angel", "providers"), {
      providerId: "memefast-api",
      key: "apiKey",
      value: "test-key",
      now: "2026-04-13T17:00:00.000Z",
    });
    await updateDirectorApiProviderSetting(join(workspaceRoot, ".director-angel", "providers"), {
      providerId: "memefast-api",
      key: "baseUrl",
      value: `http://127.0.0.1:${upstreamAddress.port}`,
      now: "2026-04-13T17:00:01.000Z",
    });
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));

    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/bridges/api-provider/media-submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaId: "director.execution.http-json-request.v1",
          runId: "run-bridge-1",
          assignmentId: "assignment-asset-1",
          workerId: "worker-1",
          adapterId: "memefast-api",
          provider: "memefast-api",
          role: "asset-router",
          actionClass: "generate",
          approvalMode: "operator_approve",
          objective: "生成一个15秒短剧分镜蓝图",
          deliverable: "首帧概念图",
          inputs: ["locked brief"],
          outputs: ["image prompt"],
          acceptanceCriteria: ["Prompt must preserve recalled continuity."],
          constraints: [
            {
              field: "recalledKnowledge",
              requirement: "Apply continuity pack pack://continuity/v2.",
              priority: "required",
            },
          ],
          dependsOn: [],
        }),
      });
      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        accepted: boolean;
        requestId: string;
        providerId: string;
        mode: string;
      };
      expect(payload).toMatchObject({
        accepted: true,
        providerId: "memefast-api",
        mode: "image_generation",
      });
      expect(payload.requestId).toContain("assignment-asset-1");
      expect(upstreamBodies).toHaveLength(1);
      expect(upstreamBodies[0]).toMatchObject({
        model: expect.any(String),
        prompt: expect.stringContaining("生成一个15秒短剧分镜蓝图"),
      });
    } finally {
      await app.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("selects a real execution adapter in blueprint responses when one is available", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-execution-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(workspaceRoot, dataDir, [
        {
          adapterId: "script-execution-a",
          adapterKind: "execution",
          provider: "script-executor",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: false,
          supportedActionClasses: ["generate"],
          bridge: {
            kind: "http-json",
            baseUrl: "https://bridge.example.test",
            submitPath: "/v1/script-jobs",
            timeoutMs: 10_000,
            authEnvVar: "SCRIPT_EXECUTION_API_KEY",
          },
          notes: ["Real execution handoff target for script-planner."],
        },
      ]),
    );

    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-execution-1",
        createdAt: "2026-04-14T02:00:00.000Z",
        host: {
          hostId: "host-1",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-execution-1",
          title: "Director Host API",
          outline: "把导演蓝图接到真实 script execution handoff。",
        },
        group: {
          groupId: "group-execution-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-a"],
        },
        runtime: {
          runtimeId: "runtime-1",
          status: "ready",
          availableBindings: ["binding-a"],
          maxPromptChars: 4096,
          supportsVideo: true,
        },
        intent: {
          bindingPolicy: "prefer",
          preferredImageBinding: "binding-a",
        },
      };
      const intake = {
        intakeId: "intake-execution-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["real script execution handoff"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-intake-execution-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...(intake.deliverables ?? [])],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });

      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as {
        handoff: {
          sideEffectsAllowed: boolean;
        };
        actionGraph: {
          nodes: Array<{
            role: string;
            selectedAdapter: string | null;
            allowedAdapters: string[];
          }>;
        };
      };

      const scriptPlanner = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "script-planner",
      );
      expect(blueprintPayload.handoff.sideEffectsAllowed).toBe(true);
      expect(scriptPlanner?.allowedAdapters).toEqual(["script-execution-a"]);
      expect(scriptPlanner?.selectedAdapter).toBe("script-execution-a");

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blueprintPayload),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as {
        sideEffectsAllowed: boolean;
        assignments: Array<{
          role: string;
          selectedAdapter: string | null;
        }>;
      };

      expect(runPayload.sideEffectsAllowed).toBe(true);
      expect(
        runPayload.assignments.find((assignment) => assignment.role === "script-planner"),
      ).toMatchObject({
        selectedAdapter: "script-execution-a",
      });
    } finally {
      await app.close();
    }
  });

  it("keeps side effects enabled when the same execution adapter owns both script-planner and shot-planner", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-execution-chain-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(
      createMockRuntime(workspaceRoot, dataDir, [
        {
          adapterId: "script-execution-a",
          adapterKind: "execution",
          provider: "script-executor",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: false,
          supportedActionClasses: ["generate"],
          supportedRoles: ["script-planner", "shot-planner"],
          bridge: {
            kind: "http-json",
            baseUrl: "https://bridge.example.test",
            submitPath: "/v1/script-jobs",
            timeoutMs: 10_000,
            authEnvVar: "SCRIPT_EXECUTION_API_KEY",
          },
          notes: ["Real execution handoff target for script and shot planning."],
        },
      ]),
    );

    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-execution-chain-1",
        createdAt: "2026-04-14T02:30:00.000Z",
        host: {
          hostId: "host-1",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-execution-chain-1",
          title: "Director Host API Execution Chain",
          outline: "把 script 和 shot planning 都交给同一条真实 execution bridge。",
        },
        group: {
          groupId: "group-execution-chain-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-a"],
        },
        runtime: {
          runtimeId: "runtime-1",
          status: "ready",
          availableBindings: ["binding-a"],
          maxPromptChars: 4096,
          supportsVideo: true,
        },
        intent: {
          bindingPolicy: "prefer",
          preferredImageBinding: "binding-a",
        },
      };
      const intake = {
        intakeId: "intake-execution-chain-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["real script and shot execution handoff"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-intake-execution-chain-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...(intake.deliverables ?? [])],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });

      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as {
        handoff: {
          sideEffectsAllowed: boolean;
          chosenAdapters: string[];
        };
        actionGraph: {
          nodes: Array<{
            role: string;
            selectedAdapter: string | null;
            allowedAdapters: string[];
          }>;
        };
      };

      const scriptPlanner = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "script-planner",
      );
      expect(blueprintPayload.handoff.sideEffectsAllowed).toBe(true);
      expect(blueprintPayload.handoff.chosenAdapters).toContain("script-execution-a");
      expect(scriptPlanner?.selectedAdapter).toBe("script-execution-a");
      expect(scriptPlanner?.allowedAdapters).toEqual(["script-execution-a"]);

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blueprintPayload),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as {
        sideEffectsAllowed: boolean;
        assignments: Array<{
          role: string;
          selectedAdapter: string | null;
        }>;
      };

      expect(runPayload.sideEffectsAllowed).toBe(true);
      expect(
        runPayload.assignments.find((assignment) => assignment.role === "script-planner"),
      ).toMatchObject({
        selectedAdapter: "script-execution-a",
      });
    } finally {
      await app.close();
    }
  });

  it("records entry intake lineage and exposes the stored entry session", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-entry-api-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/entry/intake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: "director-entry.v1",
          entry: {
            hostId: "lark",
            channel: "lark-im",
            routeKind: "direct",
            sessionKey: "agent:director:direct:user_1",
            messageId: "msg-entry-1",
            receivedAt: "2026-04-13T10:00:00.000Z",
          },
          snapshot: {
            apiVersion: DIRECTOR_HOST_API_VERSION,
            schemaId: "director.host.snapshot.v1",
            snapshotId: "snapshot-entry-1",
            createdAt: "2026-04-13T10:00:00.000Z",
            host: {
              hostId: "lark",
              triggerSource: "api",
              sessionId: "agent:director:direct:user_1",
            },
            project: {
              projectId: "project-1",
              title: "Director Entry",
              outline: "Create a launch brief.",
            },
            group: {
              groupId: "group-1",
              generationType: "new",
              sceneCount: 1,
              anchorIds: [],
            },
            runtime: {
              runtimeId: "runtime-1",
              status: "ready",
              availableBindings: ["binding-a"],
              maxPromptChars: 4096,
              supportsVideo: true,
            },
            intent: {
              bindingPolicy: "auto",
            },
          },
          intake: {
            intakeId: "intake-entry-1",
            submittedAt: "2026-04-13T10:00:00.000Z",
            objective: "Create a launch brief.",
            deliverables: ["launch brief"],
          },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        session: {
          entrySessionId: string;
          sessionKey: string;
          state: string;
          latestLineage: { intakeId?: string };
        };
        turn: {
          state: string;
          nextAction: string;
          lineage: { intakeId?: string };
        };
        intake: { intakeId: string; alignmentState: string };
      };

      expect(payload.intake.intakeId).toBe("intake-entry-1");
      expect(payload.session.sessionKey).toBe("agent:director:direct:user_1");
      expect(payload.session.latestLineage.intakeId).toBe("intake-entry-1");
      expect(payload.turn.lineage.intakeId).toBe("intake-entry-1");
      expect(payload.session.state).toBe("ready_for_blueprint");
      expect(payload.turn.state).toBe("ready_for_blueprint");
      expect(payload.turn.nextAction).toBe("blueprint");

      const sessionResponse = await fetch(
        `http://${host}:${port}/v1/entry/sessions/${payload.session.entrySessionId}`,
      );
      expect(sessionResponse.ok).toBe(true);
      const sessionPayload = (await sessionResponse.json()) as {
        entrySessionId: string;
        latestLineage: { intakeId?: string };
        turns: Array<{ messageId: string }>;
      };

      expect(sessionPayload.entrySessionId).toBe(payload.session.entrySessionId);
      expect(sessionPayload.latestLineage.intakeId).toBe("intake-entry-1");
      expect(sessionPayload.turns).toHaveLength(1);
      expect(sessionPayload.turns[0]?.messageId).toBe("msg-entry-1");
    } finally {
      await app.close();
    }
  });

  it("archives a v1 session transcript before deleting the live session", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-session-delete-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const createdSessionResponse = await fetch(`http://${host}:${port}/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          peerId: "user-delete",
          sessionId: "session-delete-1",
          title: "Delete with archive",
        }),
      });
      expect(createdSessionResponse.ok).toBe(true);

      for (const [messageId, text, receivedAtMs] of [
        ["message-delete-1", "Create a director-ready launch brief.", 1_713_000_000_000],
        ["message-delete-2", "Tighten the same brief for a release review.", 1_713_000_060_000],
      ] as const) {
        const response = await fetch(
          `http://${host}:${port}/v1/sessions/${encodeURIComponent("session-delete-1")}/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messageId,
              receivedAtMs,
              text,
            }),
          },
        );
        expect(response.ok).toBe(true);
      }

      const deleteResponse = await fetch(
        `http://${host}:${port}/v1/sessions/${encodeURIComponent("session-delete-1")}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteResponse.status).toBe(204);

      const archiveDir = join(
        workspaceRoot,
        ".director-angel",
        "runtime",
        "v1",
        "session-archives",
      );
      const archiveFiles = readdirSync(archiveDir);
      expect(archiveFiles.length).toBe(1);
      expect(archiveFiles[0]).toContain("session-delete-1");
      const archivePath = join(archiveDir, archiveFiles[0] ?? "");
      const archive = JSON.parse(readFileSync(archivePath, "utf8")) as {
        schemaVersion: string;
        reason: string;
        sessionId: string;
        session: { sessionId: string; messageCount: number };
        messages: Array<{ messageId: string; text: string }>;
      };
      expect(archive).toMatchObject({
        schemaVersion: "director.host.v1-session-archive.v1",
        reason: "deleted",
        sessionId: "session-delete-1",
        session: {
          sessionId: "session-delete-1",
          messageCount: 2,
        },
        messages: [
          { messageId: "message-delete-1", text: "Create a director-ready launch brief." },
          {
            messageId: "message-delete-2",
            text: "Tighten the same brief for a release review.",
          },
        ],
      });

      const sessions = JSON.parse(
        readFileSync(
          join(workspaceRoot, ".director-angel", "runtime", "v1", "sessions.json"),
          "utf8",
        ),
      ) as {
        sessions: Array<{ sessionId: string }>;
      };
      expect(sessions.sessions.map((session) => session.sessionId)).not.toContain(
        "session-delete-1",
      );

      const messages = JSON.parse(
        readFileSync(
          join(workspaceRoot, ".director-angel", "runtime", "v1", "session-messages.json"),
          "utf8",
        ),
      ) as { messages: Array<{ sessionId: string }> };
      expect(messages.messages.map((message) => message.sessionId)).not.toContain(
        "session-delete-1",
      );
    } finally {
      await app.close();
    }
  });

  it("keeps complete entry intake sessions on the blueprint path", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-entry-clarify-api-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/entry/intake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: "director-entry.v1",
          entry: {
            hostId: "lark",
            channel: "lark-im",
            routeKind: "direct",
            sessionKey: "agent:director:direct:user_clarify",
            messageId: "msg-entry-clarify-1",
            receivedAt: "2026-04-13T11:00:00.000Z",
          },
          snapshot: {
            apiVersion: DIRECTOR_HOST_API_VERSION,
            schemaId: "director.host.snapshot.v1",
            snapshotId: "snapshot-entry-clarify-1",
            createdAt: "2026-04-13T11:00:00.000Z",
            host: {
              hostId: "lark",
              triggerSource: "api",
              sessionId: "agent:director:direct:user_clarify",
            },
            project: {
              projectId: "project-clarify-1",
            },
            group: {
              groupId: "group-clarify-1",
              generationType: "extend",
              sceneCount: 1,
              anchorIds: [],
            },
            runtime: {
              runtimeId: "runtime-1",
              status: "ready",
              availableBindings: ["binding-a"],
              maxPromptChars: 4096,
              supportsVideo: true,
            },
            intent: {
              bindingPolicy: "auto",
            },
          },
          intake: {
            intakeId: "intake-entry-clarify-1",
            submittedAt: "2026-04-13T11:00:00.000Z",
            objective: "Continue the existing story.",
            desiredOutcome: "Continue the existing story.",
          },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        session: {
          entrySessionId: string;
          state: string;
          nextAction: string;
        };
        turn: {
          clarificationPrompts?: string[];
        };
        intake: {
          alignmentState: string;
          clarification: { decision: string; questions: Array<{ prompt: string }> };
        };
      };

      expect(payload.session.state).toBe("clarification_required");
      expect(payload.session.nextAction).toBe("clarify");
      expect(payload.intake.alignmentState).toBe("pending");
      expect(payload.intake.clarification.decision).toBe("needs_clarification");
      expect(payload.intake.clarification.questions.length).toBeGreaterThan(0);

      const blueprintResponse = await fetch(
        `http://${host}:${port}/v1/entry/sessions/${encodeURIComponent(payload.session.entrySessionId)}/blueprint`,
        {
          method: "POST",
        },
      );
      expect(blueprintResponse.status).toBe(409);
      const blueprintPayload = (await blueprintResponse.json()) as {
        code: string;
      };
      expect(blueprintPayload.code).toBe("ENTRY_SESSION_STATE_CONFLICT");
    } finally {
      await app.close();
    }
  });

  it("rejects low-value entry intake requests before storing sessions", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-entry-intake-low-value-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/entry/intake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: "director-entry.v1",
          entry: {
            hostId: "lark",
            channel: "lark-im",
            routeKind: "direct",
            sessionKey: "agent:director:direct:user_low_value",
            messageId: "msg-entry-low-value-1",
            receivedAt: "2026-04-13T11:30:00.000Z",
          },
          snapshot: {
            apiVersion: DIRECTOR_HOST_API_VERSION,
            schemaId: "director.host.snapshot.v1",
            snapshotId: "snapshot-entry-low-value-1",
            createdAt: "2026-04-13T11:30:00.000Z",
            host: {
              hostId: "lark",
              triggerSource: "api",
              sessionId: "agent:director:direct:user_low_value",
            },
            project: {
              projectId: "project-low-value-1",
              title: "Low value",
              outline: "今天天气不错，随便聊聊",
            },
            group: {
              groupId: "group-low-value-1",
              generationType: "new",
              sceneCount: 1,
              anchorIds: [],
            },
            runtime: {
              runtimeId: "runtime-1",
              status: "ready",
              availableBindings: ["binding-a"],
              maxPromptChars: 4096,
              supportsVideo: true,
            },
            intent: {
              bindingPolicy: "auto",
            },
          },
          intake: {
            intakeId: "intake-entry-low-value-1",
            submittedAt: "2026-04-13T11:30:00.000Z",
            objective: "今天天气不错，随便聊聊",
          },
        }),
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "LOW_VALUE_ENTRY_MESSAGE",
        metadata: {
          action: "ignored",
          memoryPolicy: "never-store",
        },
      });
    } finally {
      await app.close();
    }
  });

  it("accepts raw entry messages, derives the session key, and appends turns on the same session", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-entry-message-api-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const approvedSkillPath = join(dataDir, "skills", "approved-skills.json");
    mkdirSync(join(dataDir, "skills"), { recursive: true });
    writeFileSync(
      approvedSkillPath,
      `${JSON.stringify(
        {
          schemaVersion: "skills.approved.v2",
          version: 1,
          updatedAtMs: 1_713_000_000_000,
          appliedAtMs: 1_713_000_000_000,
          appliedFromProposalId: null,
          changeKind: "manual",
          previousVersion: null,
          restoredFromVersion: null,
          skills: [
            {
              id: "launch-brief-skill",
              version: "1.0.0",
              title: "Launch brief routing",
              content: "Keep launch briefs concise and preserve the incoming channel objective.",
              tags: ["launch", "brief"],
              updatedAtMs: 1_713_000_000_000,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const firstResponse = await fetch(`http://${host}:${port}/v1/entry/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: "director-entry.v1",
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
      });
      expect(firstResponse.ok).toBe(true);
      const firstPayload = (await firstResponse.json()) as {
        session: {
          entrySessionId: string;
          sessionKey: string;
          turns: Array<{ messageId: string }>;
        };
        intake: {
          intakeId: string;
          alignmentLock: { objective: string; notes: string[] } | null;
        };
      };
      expect(firstPayload.session.sessionKey).toBe("agent:director:direct:user_1");
      expect(firstPayload.intake.intakeId).toBe("intake-msg-raw-1");
      expect(firstPayload.intake.alignmentLock?.objective).toBe("Create a launch brief.");
      expect(firstPayload.intake.alignmentLock?.notes).toEqual(
        expect.arrayContaining(["skills=hit", "skill-hit=launch-brief-skill"]),
      );
      expect(firstPayload.session.turns).toHaveLength(1);

      const secondResponse = await fetch(`http://${host}:${port}/v1/entry/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: "director-entry.v1",
          hostId: "lark",
          message: createChannelTransportEnvelope({
            channel: "lark-im",
            agentId: "director",
            peerId: "user_1",
            messageId: "msg-raw-2",
            receivedAtMs: 1_713_000_060_000,
            text: "Tighten the same brief.",
            routingHint: {
              agentId: "director",
              channel: "lark-im",
              routeKind: "direct",
              peerId: "user_1",
            },
          }),
        }),
      });
      expect(secondResponse.ok).toBe(true);
      const secondPayload = (await secondResponse.json()) as {
        session: {
          entrySessionId: string;
          sessionKey: string;
          latestLineage: { intakeId?: string };
          turns: Array<{ messageId: string }>;
        };
        turn: { summary: string };
        intake: { intakeId: string };
      };

      expect(secondPayload.session.entrySessionId).toBe(firstPayload.session.entrySessionId);
      expect(secondPayload.session.sessionKey).toBe("agent:director:direct:user_1");
      expect(secondPayload.intake.intakeId).toBe("intake-msg-raw-2");
      expect(secondPayload.session.latestLineage.intakeId).toBe("intake-msg-raw-2");
      expect(secondPayload.session.turns).toHaveLength(2);
      expect(secondPayload.session.turns.map((turn) => turn.messageId)).toEqual([
        "msg-raw-1",
        "msg-raw-2",
      ]);
      expect(secondPayload.turn.summary.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("rejects low-value entry messages before creating Director intake", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-entry-low-value-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      for (const [index, text] of [
        "我今天学习制作咖啡，挺开心",
        "今天天气不错，随便聊聊",
      ].entries()) {
        const response = await fetch(`http://${host}:${port}/v1/entry/message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            apiVersion: "director-entry.v1",
            hostId: "lark",
            message: createChannelTransportEnvelope({
              channel: "lark-im",
              agentId: "director",
              peerId: "user_1",
              messageId: `msg-low-value-${index + 1}`,
              receivedAtMs: 1_713_000_000_000 + index,
              text,
              routingHint: {
                agentId: "director",
                channel: "lark-im",
                routeKind: "direct",
                peerId: "user_1",
              },
            }),
          }),
        });

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toMatchObject({
          code: "LOW_VALUE_ENTRY_MESSAGE",
          metadata: {
            action: "ignored",
            memoryPolicy: "never-store",
          },
        });
      }
    } finally {
      await app.close();
    }
  });

  it("continues an entry session through blueprint, run, and status surfaces", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-entry-session-flow-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const intakeResponse = await fetch(`http://${host}:${port}/v1/entry/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: "director-entry.v1",
          hostId: "lark",
          message: createChannelTransportEnvelope({
            channel: "lark-im",
            agentId: "director",
            peerId: "user_1",
            messageId: "msg-entry-flow-1",
            receivedAtMs: 1_713_000_000_000,
            text: "Create a director-ready launch brief.",
            routingHint: {
              agentId: "director",
              channel: "lark-im",
              routeKind: "direct",
              peerId: "user_1",
            },
          }),
        }),
      });
      expect(intakeResponse.ok).toBe(true);
      const intakePayload = (await intakeResponse.json()) as {
        agentOsProjection?: {
          schemaId: string;
          source: string;
          turnId: string;
          sessionKey: string;
          actorTrustLevel: string;
          turnKind: string;
          timelineSummary: {
            latestState?: string;
            totalEvents: number;
            latestEventType?: string;
          };
        };
        session: {
          entrySessionId: string;
          state: string;
          nextAction: string;
          agentOsProjection?: {
            schemaId: string;
            source: string;
            turnId: string;
            sessionKey: string;
            actorTrustLevel: string;
            turnKind: string;
            timelineSummary: {
              latestState?: string;
              totalEvents: number;
              latestEventType?: string;
            };
          };
        };
      };
      expect(intakePayload.session.state).toBe("ready_for_blueprint");
      expect(intakePayload.session.nextAction).toBe("blueprint");
      expect(intakePayload.agentOsProjection).toMatchObject({
        schemaId: "director.entry.agent-os-projection.v1",
        source: "channel-transport",
        sessionKey: "agent:director:direct:user_1",
        actorTrustLevel: "untrusted-remote",
        turnKind: "user-message",
        timelineSummary: {
          latestState: "received",
          totalEvents: 1,
          latestEventType: "state.transition",
        },
      });
      expect(intakePayload.session.agentOsProjection).toEqual(intakePayload.agentOsProjection);

      const blueprintResponse = await fetch(
        `http://${host}:${port}/v1/entry/sessions/${encodeURIComponent(intakePayload.session.entrySessionId)}/blueprint`,
        {
          method: "POST",
        },
      );
      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as {
        session: {
          state: string;
          nextAction: string;
          latestLineage: { blueprintId?: string };
          latestBlueprint?: { blueprintId: string; handoffId: string };
        };
        blueprint: {
          blueprintId: string;
          handoff: { handoffId: string };
        };
      };
      expect(blueprintPayload.session.state).toBe("ready_for_run");
      expect(blueprintPayload.session.nextAction).toBe("run");
      expect(blueprintPayload.session.latestLineage.blueprintId).toBe(
        blueprintPayload.blueprint.blueprintId,
      );
      expect(blueprintPayload.session.latestBlueprint?.blueprintId).toBe(
        blueprintPayload.blueprint.blueprintId,
      );
      expect(blueprintPayload.session.latestBlueprint?.handoffId).toBe(
        blueprintPayload.blueprint.handoff.handoffId,
      );

      const runResponse = await fetch(
        `http://${host}:${port}/v1/entry/sessions/${encodeURIComponent(intakePayload.session.entrySessionId)}/runs`,
        {
          method: "POST",
        },
      );
      expect(runResponse.status).toBe(201);
      const runPayload = (await runResponse.json()) as {
        session: {
          state: string;
          nextAction: string;
          latestLineage: { runId?: string };
          latestRun?: { runId: string; status: string };
        };
        run: {
          runId: string;
          status: string;
        };
      };
      expect(runPayload.run.status).toBe("created");
      expect(runPayload.session.state).toBe("ready_for_run");
      expect(runPayload.session.nextAction).toBe("run");
      expect(runPayload.session.latestLineage.runId).toBe(runPayload.run.runId);
      expect(runPayload.session.latestRun?.runId).toBe(runPayload.run.runId);
      expect(runPayload.session.latestRun?.status).toBe("created");

      const startResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.run.runId)}/start`,
        {
          method: "POST",
        },
      );
      expect(startResponse.ok).toBe(true);

      const statusResponse = await fetch(
        `http://${host}:${port}/v1/entry/sessions/${encodeURIComponent(intakePayload.session.entrySessionId)}/status`,
      );
      expect(statusResponse.ok).toBe(true);
      const statusPayload = (await statusResponse.json()) as {
        agentOsProjection?: {
          schemaId: string;
          source: string;
          sessionKey: string;
          latestLineage?: { runId?: string; reportId?: string };
        };
        session: {
          state: string;
          nextAction: string;
          latestLineage: { blueprintId?: string; runId?: string; reportId?: string };
          latestReport?: {
            reportId: string;
            runId: string;
            operatorSummary?: string;
          };
          latestRun?: { runId: string; status: string };
          agentOsProjection?: {
            schemaId: string;
            source: string;
            sessionKey: string;
            latestLineage?: { runId?: string; reportId?: string };
          };
        };
        run: {
          runId: string;
          status: string;
        };
        report: {
          reportId: string;
          runId: string;
          operatorSurface?: { operatorSummary?: string };
        };
      };
      expect(statusPayload.run.runId).toBe(runPayload.run.runId);
      expect(statusPayload.run.status).toBe("running");
      expect(statusPayload.report.runId).toBe(runPayload.run.runId);
      expect(statusPayload.session.state).toBe("run_in_progress");
      expect(statusPayload.session.nextAction).toBe("wait");
      expect(statusPayload.session.latestLineage.blueprintId).toBe(
        blueprintPayload.blueprint.blueprintId,
      );
      expect(statusPayload.session.latestLineage.runId).toBe(runPayload.run.runId);
      expect(statusPayload.session.latestLineage.reportId).toBe(statusPayload.report.reportId);
      expect(statusPayload.session.latestRun?.status).toBe("running");
      expect(statusPayload.session.latestReport?.reportId).toBe(statusPayload.report.reportId);
      expect(statusPayload.session.latestReport?.runId).toBe(runPayload.run.runId);
      expect(statusPayload.session.latestReport?.operatorSummary).toBe(
        statusPayload.report.operatorSurface?.operatorSummary,
      );
      expect(statusPayload.agentOsProjection).toMatchObject({
        schemaId: "director.entry.agent-os-projection.v1",
        source: "entry-session",
        sessionKey: "agent:director:direct:user_1",
        latestLineage: {
          runId: runPayload.run.runId,
          reportId: statusPayload.report.reportId,
        },
      });
      expect(statusPayload.session.agentOsProjection).toEqual(statusPayload.agentOsProjection);
    } finally {
      await app.close();
    }
  });

  it("projects aborted entry runs into status/report surfaces and preserves retry conflicts", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-entry-abort-flow-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    mockBootstrapDirectorHostApi.mockReturnValue(createMockRuntime(workspaceRoot, dataDir));
    const app = createDirectorHostApiApp({
      env: {},
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const intakeResponse = await fetch(`http://${host}:${port}/v1/entry/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: "director-entry.v1",
          hostId: "lark",
          message: createChannelTransportEnvelope({
            channel: "lark-im",
            agentId: "director",
            peerId: "user_abort",
            messageId: "msg-entry-abort-1",
            receivedAtMs: 1_713_000_120_000,
            text: "Create a launch brief and then stop it.",
            routingHint: {
              agentId: "director",
              channel: "lark-im",
              routeKind: "direct",
              peerId: "user_abort",
            },
          }),
        }),
      });
      expect(intakeResponse.ok).toBe(true);
      const intakePayload = (await intakeResponse.json()) as {
        session: { entrySessionId: string };
      };

      const blueprintResponse = await fetch(
        `http://${host}:${port}/v1/entry/sessions/${encodeURIComponent(intakePayload.session.entrySessionId)}/blueprint`,
        {
          method: "POST",
        },
      );
      expect(blueprintResponse.ok).toBe(true);

      const runResponse = await fetch(
        `http://${host}:${port}/v1/entry/sessions/${encodeURIComponent(intakePayload.session.entrySessionId)}/runs`,
        {
          method: "POST",
        },
      );
      expect(runResponse.status).toBe(201);
      const runPayload = (await runResponse.json()) as {
        run: {
          runId: string;
          assignments: Array<{ assignmentId: string }>;
        };
      };
      expect(runPayload.run.assignments.length).toBeGreaterThan(0);

      const startResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.run.runId)}/start`,
        {
          method: "POST",
        },
      );
      expect(startResponse.ok).toBe(true);

      const abortResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.run.runId)}/abort`,
        {
          method: "POST",
        },
      );
      expect(abortResponse.ok).toBe(true);

      const retryResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.run.runId)}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assignmentId: runPayload.run.assignments[0]?.assignmentId,
          }),
        },
      );
      expect(retryResponse.status).toBe(409);
      const retryPayload = (await retryResponse.json()) as {
        code: string;
        message: string;
        metadata?: {
          blockedRoute?: { method: string; path: string };
          nextRoute?: { method: string; path: string };
          recommendedAction?: string;
          preflightRoute?: { method: string; path: string };
          preflight?: {
            status?: string;
            readiness?: string;
            summaryText?: string;
            recommendedAction?: string;
            recommendedCommand?: string;
          };
        };
      };
      expect(retryPayload.code).toBe("RUN_STATE_CONFLICT");
      expect(retryPayload.message).toContain("was aborted and cannot retry assignments");
      expect(retryPayload.metadata).toMatchObject({
        blockedRoute: {
          method: "POST",
          path: `/v1/runs/${encodeURIComponent(runPayload.run.runId)}/retry`,
        },
        nextRoute: {
          method: "GET",
          path: `/v1/runs/${encodeURIComponent(runPayload.run.runId)}/report`,
        },
        recommendedAction:
          "Inspect the run report before retrying, rerouting, or starting a replacement bounded run.",
        preflightRoute: {
          method: "GET",
          path: "/v1/runtime/preflight",
        },
        preflight: {
          status: "pass",
          readiness: "ready",
          recommendedCommand: "hotflow preflight",
        },
      });
      expect(retryPayload.metadata?.preflight?.summaryText).toContain("ready");
      expect(retryPayload.metadata?.preflight?.recommendedAction).toContain("/v1/entry/intake");

      const statusResponse = await fetch(
        `http://${host}:${port}/v1/entry/sessions/${encodeURIComponent(intakePayload.session.entrySessionId)}/status`,
      );
      expect(statusResponse.ok).toBe(true);
      const statusPayload = (await statusResponse.json()) as {
        session: {
          state: string;
          nextAction: string;
          latestRun?: { status: string };
          latestReport?: { flags: string[] };
        };
        run: { status: string };
        report: { flags: string[] };
      };
      expect(statusPayload.run.status).toBe("aborted");
      expect(statusPayload.session.state).toBe("run_failed");
      expect(statusPayload.session.nextAction).toBe("review_report");
      expect(statusPayload.session.latestRun?.status).toBe("aborted");
      expect(statusPayload.report.flags).toContain("has-aborted-assignments");
      expect(statusPayload.session.latestReport?.flags).toContain("has-aborted-assignments");
    } finally {
      await app.close();
    }
  });
});

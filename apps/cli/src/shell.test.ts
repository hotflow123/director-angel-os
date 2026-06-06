import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createContractError,
  createExperienceCandidate,
  createExperienceReviewDecision,
  createExperienceSourceAdapterDeclaration,
} from "@hotflow/contracts";
import {
  ExecutionRunBuilder,
  ExecutionRunService,
  FileSystemRunStore,
} from "@hotflow/director-execution";
import { DIRECTOR_HOST_API_VERSION } from "@hotflow/director-host-contracts";
import type { DirectorBlueprintResponse } from "@hotflow/director-host-contracts";
import { ensureDirectorWorkspace } from "@hotflow/director-workspace";
import { EngineRunFailure } from "@hotflow/engine";
import { ModelProviderError, toModelProviderRuntimeFailureSurface } from "@hotflow/models";
import { afterEach, describe, expect, test, vi } from "vitest";

const { mockBootstrapCli, mockRunCliDoctorViaControlPlane } = vi.hoisted(() => ({
  mockBootstrapCli: vi.fn(),
  mockRunCliDoctorViaControlPlane: vi.fn(),
}));

vi.mock("./bootstrap.js", () => ({
  bootstrapCli: mockBootstrapCli,
}));

vi.mock("./doctor.js", async () => {
  const actual = await vi.importActual<typeof import("./doctor.js")>("./doctor.js");
  return {
    ...actual,
    runCliDoctorViaControlPlane: mockRunCliDoctorViaControlPlane,
  };
});

import { parseDoctorArgs, renderDoctorReport, renderDoctorUsage } from "./doctor.js";
import {
  deriveRuntimeStatus,
  formatToolOutcomeSummary,
  normalizeArgv,
  parseCliInput,
  parseControlArgs,
  parseRunArgs,
  parseStatusArgs,
  parseTaskArgs,
  pickLatestTurnIdFromTailEntries,
  prepareRunUserText,
  renderControlUsage,
  renderDirectorUsage,
  renderHelp,
  renderRunUsage,
  renderStatusUsage,
  renderTaskUsage,
  resolveWorkspacePath,
  setDirectorWorkerModuleLoaderForTests,
  setOnboardModuleLoaderForTests,
  setPreflightModuleLoaderForTests,
  startCli,
  summarizeRunToolOutcomes,
  summarizeStepReplayToolOutcomes,
} from "./shell.js";

function createRuntimeCapabilitySnapshotFixture(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    runtimeId: "runtime-1",
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-1",
      runtimeId: "runtime-1",
      capturedAt: "2026-04-11T12:00:00.000Z",
      status: "ready",
      adapters: [
        {
          adapterId: "binding-a",
          adapterKind: "media",
          provider: "mock-media",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: true,
        },
      ],
      notes: ["preview-safe"],
    },
    ...overrides,
  };
}

function createClarificationFixture(overrides: Record<string, unknown> = {}) {
  return {
    decision: "ready",
    summary: "Enough information is present for the next step.",
    missingFields: [],
    conflictingFields: [],
    questions: [],
    ...overrides,
  };
}

function createActionGraphFixture(overrides: Record<string, unknown> = {}) {
  return {
    graphId: "graph-1",
    blueprintId: "blueprint-plan-1",
    goal: "goal",
    nodes: [],
    edges: [],
    stopConditions: ["runtime offline"],
    ...overrides,
  };
}

function createOperatorPreviewFixture(overrides: Record<string, unknown> = {}) {
  return {
    previewId: "preview-1",
    summary: "ready",
    warnings: [],
    blockedReasons: [],
    requiredApprovals: [],
    ...overrides,
  };
}

function createOperatorOutcomeFixture(overrides: Record<string, unknown> = {}) {
  return {
    outcomeId: "outcome-1",
    status: "accepted",
    recordedAt: "2026-04-11T12:30:00.000Z",
    notes: "operator approved preview",
    ...overrides,
  };
}

function createHandoffEnvelopeFixture(overrides: Record<string, unknown> = {}) {
  const actionGraph = createActionGraphFixture();
  return {
    handoffId: "handoff-execution-1",
    blueprintId: actionGraph.blueprintId,
    createdAt: "2026-04-11T12:10:00.000Z",
    alignmentLockId: "lock-snapshot-1",
    actionGraphId: actionGraph.graphId,
    previewSummary: "preview-only handoff",
    capabilityMatches: [],
    mediaRequests: [],
    expectedArtifacts: [],
    chosenAdapters: ["binding-a"],
    sideEffectsAllowed: false,
    notes: ["preview-only"],
    ...overrides,
  };
}

function createExecutionRunFixture(overrides: Record<string, unknown> = {}) {
  const { assignments, ...runOverrides } = overrides;
  const runId = typeof runOverrides.runId === "string" ? runOverrides.runId : "run-1";
  const defaultAssignment = {
    runId,
    assignmentId: "a1",
    role: "researcher",
    objective: "inspect",
    inputs: ["goal"],
    outputs: ["brief"],
    deliverable: "brief",
    acceptanceCriteria: ["done"],
    constraints: [],
    actionClass: "read",
    approvalMode: "auto_allow",
    dependsOn: [],
    status: "ready",
    selectedAdapter: null,
    allowedAdapters: ["binding-a"],
    createdAt: "2026-04-11T12:20:00.000Z",
    notes: [],
  };

  return {
    schemaVersion: "director.execution.run.v1",
    runId,
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-plan-1",
    handoffId: "handoff-execution-1",
    actionGraphId: "graph-1",
    goal: "goal",
    previewSummary: "ready",
    sideEffectsAllowed: false,
    createdAt: "2026-04-11T12:20:00.000Z",
    updatedAt: "2026-04-11T12:20:00.000Z",
    status: "created",
    assignments: Array.isArray(assignments)
      ? assignments.map((assignment) => ({
          ...defaultAssignment,
          ...(typeof assignment === "object" && assignment !== null ? assignment : {}),
        }))
      : [defaultAssignment],
    events: [
      {
        eventId: "event-1",
        runId,
        type: "run-created",
        occurredAt: "2026-04-11T12:20:00.000Z",
        message: "Execution run was materialized from a reviewed director blueprint.",
        payload: {
          blueprintId: "blueprint-plan-1",
          handoffId: "handoff-execution-1",
          assignmentCount: 1,
        },
      },
    ],
    notes: ["preview-only"],
    ...runOverrides,
  };
}

function createDirectorWorkerBlueprintFixture(): DirectorBlueprintResponse {
  return {
    apiVersion: "director-host-api.v1",
    snapshotId: "snapshot-worker-1",
    runtimeId: "runtime-worker-1",
    blueprintId: "blueprint-worker-1",
    review: {
      overallDecision: "pass",
      blockingReasons: [],
      requiredFixes: [],
    },
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-worker-1",
      runtimeId: "runtime-worker-1",
      capturedAt: "2026-04-14T11:00:00.000Z",
      status: "ready",
      adapters: [],
      notes: [],
    },
    actionGraph: {
      graphId: "graph-worker-1",
      blueprintId: "blueprint-worker-1",
      goal: "deliver preview",
      nodes: [
        {
          nodeId: "node-worker-1",
          assignmentId: "assignment-worker-1",
          role: "researcher",
          objective: "Inspect the brief",
          inputs: ["snapshot"],
          outputs: ["research brief"],
          deliverable: "prepare outline",
          acceptanceCriteria: ["Goal is explicit."],
          constraints: [],
          dependsOn: [],
          allowedAdapters: [],
          actionClass: "read",
          approvalMode: "auto_allow",
          escalationToDirector: false,
          status: "ready",
          selectedAdapter: "mock-execution",
        },
        {
          nodeId: "node-worker-2",
          assignmentId: "assignment-worker-2",
          role: "script-planner",
          objective: "Draft the shot plan",
          inputs: ["research brief"],
          outputs: ["shot plan"],
          deliverable: "draft shot plan",
          acceptanceCriteria: ["Plan is deterministic."],
          constraints: [],
          dependsOn: ["assignment-worker-1"],
          allowedAdapters: ["mock-execution"],
          actionClass: "write",
          approvalMode: "auto_allow",
          escalationToDirector: false,
          status: "ready",
          selectedAdapter: "mock-execution",
        },
      ],
      edges: [],
      stopConditions: [],
    },
    preview: {
      previewId: "preview-worker-1",
      summary: "preview",
      warnings: [],
      blockedReasons: [],
      requiredApprovals: [],
    },
    handoff: {
      handoffId: "handoff-worker-1",
      blueprintId: "blueprint-worker-1",
      createdAt: "2026-04-14T11:00:00.000Z",
      alignmentLockId: "lock-worker-1",
      actionGraphId: "graph-worker-1",
      previewSummary: "preview",
      capabilityMatches: [],
      mediaRequests: [],
      expectedArtifacts: [],
      chosenAdapters: ["mock-execution"],
      sideEffectsAllowed: false,
      notes: ["preview-only"],
    },
  };
}

function writeDirectorSwitchDocument(
  workspaceRoot: string,
  overrides: {
    readonly features?: Record<string, boolean>;
    readonly roleOverrides?: Record<string, boolean>;
    readonly adapterOverrides?: Record<string, boolean>;
  },
): void {
  writeFileSync(
    join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
    JSON.stringify({
      schemaId: "director.switches.v1",
      ...overrides,
    }),
    "utf8",
  );
}

function writeDirectorAcceptanceArtifacts(
  workspaceRoot: string,
  options: { readonly doctorFailed?: boolean } = {},
) {
  const resultsDir = join(workspaceRoot, "benchmarks", "results");
  mkdirSync(resultsDir, { recursive: true });

  writeFileSync(
    join(resultsDir, "director-beta7-wave1-adapter-registry-gate-1776052415066.json"),
    JSON.stringify({
      gateId: "director-beta7-wave1-adapter-registry-gate",
      status: "pass",
      workspaceRoot,
      commandRuns: [{ action: "register", status: 0 }],
      failures: [],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-beta7-wave2-real-adapter-bridge-gate-1776067115883.json"),
    JSON.stringify({
      gateId: "director-beta7-wave2-real-adapter-bridge-gate",
      status: "pass",
      workspaceRoot,
      commandRuns: [{ action: "run-report", status: 0 }],
      failures: [],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-beta8-single-vertical-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-beta8-single-vertical-gate",
      generatedAt: "2026-04-13T10:18:31.567Z",
      summary: {
        total: 2,
        failed: 0,
        passed: 2,
        totalDurationMs: 6523.16,
      },
      caseResults: [
        {
          id: "director_beta8_single_vertical_success",
          status: "passed",
        },
        {
          id: "director_beta8_single_vertical_failure_timeout",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave1-real-execution-adapter-handoff-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave1-real-execution-adapter-handoff-gate",
      generatedAt: "2026-04-14T02:05:00.000Z",
      summary: {
        total: 2,
        failed: 0,
        passed: 2,
        totalDurationMs: 4123.12,
      },
      caseResults: [
        {
          id: "phase_p2_wave1_real_execution_success",
          status: "passed",
        },
        {
          id: "phase_p2_wave1_preview_fallback",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave2-dual-execution-chain-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave2-dual-execution-chain-gate",
      generatedAt: "2026-04-14T03:05:00.000Z",
      summary: {
        total: 2,
        failed: 0,
        passed: 2,
        totalDurationMs: 5231.48,
      },
      caseResults: [
        {
          id: "phase_p2_wave2_dual_execution_success",
          status: "passed",
        },
        {
          id: "phase_p2_wave2_preview_fallback",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave3-retryable-bridge-failure-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave3-retryable-bridge-failure-gate",
      generatedAt: "2026-04-14T04:20:00.000Z",
      summary: {
        total: 1,
        failed: 0,
        passed: 1,
        totalDurationMs: 3312.84,
      },
      caseResults: [
        {
          id: "phase_p2_wave3_shot_planner_retry_closure",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave4-non-retryable-bridge-failure-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave4-non-retryable-bridge-failure-gate",
      generatedAt: "2026-04-14T05:10:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 4120.15,
      },
      caseResults: [
        {
          id: "phase_p2_wave4_invalid_response_non_retryable",
          status: "passed",
        },
        {
          id: "phase_p2_wave4_http_422_non_retryable",
          status: "passed",
        },
        {
          id: "phase_p2_wave4_http_502_retryable_control",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave5-retry-policy-boundary-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave5-retry-policy-boundary-gate",
      generatedAt: "2026-04-14T06:00:00.000Z",
      summary: {
        total: 4,
        failed: 0,
        passed: 4,
        totalDurationMs: 2984.71,
      },
      caseResults: [
        {
          id: "phase_p2_wave5_contract_surface",
          status: "passed",
        },
        {
          id: "phase_p2_wave5_execution_service_retry_budget",
          status: "passed",
        },
        {
          id: "phase_p2_wave5_worker_host_api_retry_budget",
          status: "passed",
        },
        {
          id: "phase_p2_wave5_cli_operator_surface_retry_budget",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave6-failover-boundary-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave6-failover-boundary-gate",
      generatedAt: "2026-04-14T07:05:00.000Z",
      summary: {
        total: 4,
        failed: 0,
        passed: 4,
        totalDurationMs: 3244.18,
      },
      caseResults: [
        {
          id: "phase_p2_wave6_contract_surface",
          status: "passed",
        },
        {
          id: "phase_p2_wave6_execution_service_reroute_boundary",
          status: "passed",
        },
        {
          id: "phase_p2_wave6_worker_host_api_reroute_boundary",
          status: "passed",
        },
        {
          id: "phase_p2_wave6_cli_operator_surface_reroute_boundary",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave7-route-recovery-audit-closure-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave7-route-recovery-audit-closure-gate",
      generatedAt: "2026-04-14T07:50:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 2876.52,
      },
      caseResults: [
        {
          id: "phase_p2_wave7_execution_service_route_recovery_events",
          status: "passed",
        },
        {
          id: "phase_p2_wave7_cli_audit_route_recovery",
          status: "passed",
        },
        {
          id: "phase_p2_wave7_acceptance_surface",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave8-chain-route-health-snapshot-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave8-chain-route-health-snapshot-gate",
      generatedAt: "2026-04-14T09:10:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 3011.44,
      },
      caseResults: [
        {
          id: "phase_p2_wave8_status_chain_route_health_snapshot",
          status: "passed",
        },
        {
          id: "phase_p2_wave8_explain_chain_route_health_snapshot",
          status: "passed",
        },
        {
          id: "phase_p2_wave8_acceptance_surface",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave9-chain-route-doctor-visibility-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave9-chain-route-doctor-visibility-gate",
      generatedAt: "2026-04-14T10:05:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 3188.25,
      },
      caseResults: [
        {
          id: "phase_p2_wave9_director_doctor_chain_route_visibility",
          status: "passed",
        },
        {
          id: "phase_p2_wave9_cli_director_doctor_surface",
          status: "passed",
        },
        {
          id: "phase_p2_wave9_acceptance_surface",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "wave2-recovery-gate-latest.json"),
    JSON.stringify({
      summary: {
        suiteId: "wave2-recovery-gate",
        timestamp: "2026-04-10T22:08:01.478Z",
        iterations: 1,
        totalRuns: 1,
        failedRuns: 0,
      },
      runs: [
        {
          caseId: "interrupted_turn_recovery",
          ok: true,
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave10-worker-once-operator-entry-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave10-worker-once-operator-entry-gate",
      generatedAt: "2026-04-14T11:20:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 3412.67,
      },
      caseResults: [
        {
          id: "phase_p2_wave10_director_worker_local_run_once",
          status: "passed",
        },
        {
          id: "phase_p2_wave10_cli_director_run_once_surface",
          status: "passed",
        },
        {
          id: "phase_p2_wave10_acceptance_surface",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave11-run-once-preflight-guidance-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave11-run-once-preflight-guidance-gate",
      generatedAt: "2026-04-18T14:20:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 2876.41,
      },
      caseResults: [
        {
          id: "phase_p2_wave11_onboarding_run_once_guidance",
          status: "passed",
        },
        {
          id: "phase_p2_wave11_preflight_run_once_guidance",
          status: "passed",
        },
        {
          id: "phase_p2_wave11_acceptance_surface",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave12-run-once-exit-surface-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave12-run-once-exit-surface-gate",
      generatedAt: "2026-04-19T00:20:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 3014.86,
      },
      caseResults: [
        {
          id: "phase_p2_wave12_worker_run_once_contract",
          status: "passed",
        },
        {
          id: "phase_p2_wave12_cli_run_once_exit_surface",
          status: "passed",
        },
        {
          id: "phase_p2_wave12_acceptance_surface",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave13-run-once-holding-state-taxonomy-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave13-run-once-holding-state-taxonomy-gate",
      generatedAt: "2026-04-19T03:10:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 3156.22,
      },
      caseResults: [
        {
          id: "phase_p2_wave13_worker_run_once_contract",
          status: "passed",
        },
        {
          id: "phase_p2_wave13_cli_run_once_holding_state_surface",
          status: "passed",
        },
        {
          id: "phase_p2_wave13_acceptance_surface",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave14-run-state-surface-alignment-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave14-run-state-surface-alignment-gate",
      generatedAt: "2026-04-19T05:20:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 3298.44,
      },
      caseResults: [
        {
          id: "phase_p2_wave14_worker_run_once_contract",
          status: "passed",
        },
        {
          id: "phase_p2_wave14_cli_run_state_surface_alignment",
          status: "passed",
        },
        {
          id: "phase_p2_wave14_acceptance_surface",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  writeFileSync(
    join(resultsDir, "director-phase-p2-wave15-run-state-visibility-closeout-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave15-run-state-visibility-closeout-gate",
      generatedAt: "2026-04-19T06:40:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 3114.27,
      },
      caseResults: [
        {
          id: "phase_p2_wave15_status_holding_state_surface",
          status: "passed",
        },
        {
          id: "phase_p2_wave15_run_audit_holding_state_surface",
          status: "passed",
        },
        {
          id: "phase_p2_wave15_acceptance_surface",
          status: "passed",
        },
      ],
    }),
    "utf8",
  );

  const cycle1PromptRuntimeArtifacts = [
    {
      filename: "wave83-prompt-inspect-static-runtime-summary-surface-gate.json",
      suiteId: "wave83-prompt-inspect-static-runtime-summary-surface-gate",
      generatedAt: "2026-04-20T07:10:00.000Z",
      caseId: "wave83_prompt_inspect_static_runtime_summary_surface",
    },
    {
      filename: "wave84-prompt-inspect-dynamic-runtime-summary-surface-gate.json",
      suiteId: "wave84-prompt-inspect-dynamic-runtime-summary-surface-gate",
      generatedAt: "2026-04-20T07:15:00.000Z",
      caseId: "wave84_prompt_inspect_dynamic_runtime_summary_surface",
    },
    {
      filename: "wave85-prompt-inspect-focus-omission-summary-surface-gate.json",
      suiteId: "wave85-prompt-inspect-focus-omission-summary-surface-gate",
      generatedAt: "2026-04-20T07:20:00.000Z",
      caseId: "wave85_prompt_inspect_focus_omission_summary_surface",
    },
    {
      filename: "wave86-prompt-inspect-change-summary-surface-gate.json",
      suiteId: "wave86-prompt-inspect-change-summary-surface-gate",
      generatedAt: "2026-04-20T07:25:00.000Z",
      caseId: "wave86_prompt_inspect_change_summary_surface",
    },
    {
      filename: "wave87-status-prompt-change-summary-closure-gate.json",
      suiteId: "wave87-status-prompt-change-summary-closure-gate",
      generatedAt: "2026-04-20T07:30:00.000Z",
      caseId: "wave87_status_prompt_change_summary_closure",
    },
    {
      filename: "wave88-prompt-explain-summary-vocabulary-alignment-gate.json",
      suiteId: "wave88-prompt-explain-summary-vocabulary-alignment-gate",
      generatedAt: "2026-04-20T07:35:00.000Z",
      caseId: "wave88_prompt_explain_summary_vocabulary_alignment",
    },
    {
      filename: "wave89-status-first-build-wording-alignment-gate.json",
      suiteId: "wave89-status-first-build-wording-alignment-gate",
      generatedAt: "2026-04-20T07:40:00.000Z",
      caseId: "wave89_status_first_build_wording_alignment",
    },
    {
      filename: "wave90-prompt-inspect-runtime-degradations-none-surface-gate.json",
      suiteId: "wave90-prompt-inspect-runtime-degradations-none-surface-gate",
      generatedAt: "2026-04-20T07:45:00.000Z",
      caseId: "wave90_prompt_inspect_runtime_degradations_none_surface",
    },
    {
      filename: "wave91-prompt-inspect-explain-prompt-degradations-none-surface-gate.json",
      suiteId: "wave91-prompt-inspect-explain-prompt-degradations-none-surface-gate",
      generatedAt: "2026-04-20T07:50:00.000Z",
      caseId: "wave91_prompt_inspect_explain_prompt_degradations_none_surface",
    },
    {
      filename: "wave92-status-prompt-degradations-none-surface-gate.json",
      suiteId: "wave92-status-prompt-degradations-none-surface-gate",
      generatedAt: "2026-04-20T07:55:00.000Z",
      caseId: "wave92_status_prompt_degradations_none_surface",
    },
    {
      filename: "wave93-status-tool-runtime-guidance-precedence-gate.json",
      suiteId: "wave93-status-tool-runtime-guidance-precedence-gate",
      generatedAt: "2026-04-20T08:00:00.000Z",
      caseId: "wave93_status_tool_runtime_guidance_precedence",
    },
  ] as const;

  for (const artifact of cycle1PromptRuntimeArtifacts) {
    writeFileSync(
      join(resultsDir, artifact.filename),
      JSON.stringify({
        suiteId: artifact.suiteId,
        generatedAt: artifact.generatedAt,
        summary: {
          total: 1,
          failed: 0,
          passed: 1,
          totalDurationMs: 1188.42,
        },
        caseResults: [{ id: artifact.caseId, status: "passed" }],
      }),
      "utf8",
    );
  }

  writeFileSync(
    join(resultsDir, "wave8-doctor-gate-latest.json"),
    JSON.stringify({
      summary: {
        suiteId: "wave8-doctor-gate",
        timestamp: "2026-04-13T00:56:32.284Z",
        totalRuns: 2,
        failedRuns: options.doctorFailed ? 1 : 0,
      },
      runs: options.doctorFailed
        ? [
            {
              caseId: "healthy_scripted_default",
              ok: false,
            },
            {
              caseId: "provider_misconfig",
              ok: true,
            },
          ]
        : [
            {
              caseId: "healthy_scripted_default",
              ok: true,
            },
            {
              caseId: "provider_misconfig",
              ok: true,
            },
          ],
    }),
    "utf8",
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  mockBootstrapCli.mockReset();
  mockRunCliDoctorViaControlPlane.mockReset();
  setDirectorWorkerModuleLoaderForTests();
  setOnboardModuleLoaderForTests();
  setPreflightModuleLoaderForTests();
  process.exitCode = undefined;
});

function captureDirectorTestEnv(): {
  HOTFLOW_WORKSPACE_ROOT?: string;
  HOTFLOW_DATA_DIR?: string;
  HOTFLOW_CLI_SESSION_DB_PATH?: string;
  HOTFLOW_SKILLS_SNAPSHOT_PATH?: string;
  HOTFLOW_SKILLS_TAXONOMY_PATH?: string;
} {
  return {
    HOTFLOW_WORKSPACE_ROOT: process.env.HOTFLOW_WORKSPACE_ROOT,
    HOTFLOW_DATA_DIR: process.env.HOTFLOW_DATA_DIR,
    HOTFLOW_CLI_SESSION_DB_PATH: process.env.HOTFLOW_CLI_SESSION_DB_PATH,
    HOTFLOW_SKILLS_SNAPSHOT_PATH: process.env.HOTFLOW_SKILLS_SNAPSHOT_PATH,
    HOTFLOW_SKILLS_TAXONOMY_PATH: process.env.HOTFLOW_SKILLS_TAXONOMY_PATH,
  };
}

function applyDirectorTestEnv(workspaceRoot: string): void {
  const dataDir = join(workspaceRoot, ".hotflow");
  process.env.HOTFLOW_WORKSPACE_ROOT = workspaceRoot;
  process.env.HOTFLOW_DATA_DIR = dataDir;
  process.env.HOTFLOW_CLI_SESSION_DB_PATH = join(dataDir, "sessions", "cli.sqlite");
  Reflect.deleteProperty(process.env, "HOTFLOW_SKILLS_SNAPSHOT_PATH");
  Reflect.deleteProperty(process.env, "HOTFLOW_SKILLS_TAXONOMY_PATH");
}

function restoreDirectorTestEnv(env: ReturnType<typeof captureDirectorTestEnv>): void {
  restoreOptionalEnv("HOTFLOW_WORKSPACE_ROOT", env.HOTFLOW_WORKSPACE_ROOT);
  restoreOptionalEnv("HOTFLOW_DATA_DIR", env.HOTFLOW_DATA_DIR);
  restoreOptionalEnv("HOTFLOW_CLI_SESSION_DB_PATH", env.HOTFLOW_CLI_SESSION_DB_PATH);
  restoreOptionalEnv("HOTFLOW_SKILLS_SNAPSHOT_PATH", env.HOTFLOW_SKILLS_SNAPSHOT_PATH);
  restoreOptionalEnv("HOTFLOW_SKILLS_TAXONOMY_PATH", env.HOTFLOW_SKILLS_TAXONOMY_PATH);
}

function restoreOptionalEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
  } else {
    process.env[key] = value;
  }
}

function seedAcceptedExperienceCandidate(
  workspaceRoot: string,
  input: { readonly candidateId: string; readonly title: string },
): void {
  const experienceDir = join(workspaceRoot, ".director-angel", "knowledge", "experience");
  const candidateDir = join(experienceDir, "candidate");
  const reviewDir = join(experienceDir, "review");
  mkdirSync(candidateDir, { recursive: true });
  mkdirSync(reviewDir, { recursive: true });
  const candidate = createExperienceCandidate({
    candidateId: input.candidateId,
    sourceAdapter: createExperienceSourceAdapterDeclaration({
      adapterId: "test-local-directory",
      sourceKind: "local-directory",
      sourceRef: "file:///tmp/director-lessons",
      privacy: "internal",
      transformations: [
        {
          transformId: "extract-pattern",
          kind: "extract-pattern",
          summary: "Extract reusable production lesson.",
        },
      ],
    }),
    title: input.title,
    summary: "Use camera language as a reusable production constraint.",
    applicability: "Short drama storyboard planning.",
    risks: ["Do not copy source text verbatim."],
    tags: ["shot-size"],
    evidence: [
      {
        evidenceId: "evidence-shot-lesson",
        sourceRef: "file:///tmp/director-lessons/shot.md",
        path: "shot.md",
        summary: "Shot-size guidance for short drama planning.",
      },
    ],
    sourceArtifactId: "artifact-shot-lesson",
    sourceDigest: "digest-shot-lesson",
    evidencePreview: "Shot-size guidance for short drama planning.",
    privacy: "internal",
    provenance: "shell.test",
    createdAtMs: 1,
  });
  const review = createExperienceReviewDecision({
    decisionId: "review-1",
    candidateId: input.candidateId,
    gate: "human",
    decision: "accepted",
    decidedAtMs: 2,
    reviewerId: "operator",
    note: "Accepted for Skill proposal test.",
  });

  writeFileSync(
    join(candidateDir, `${input.candidateId}.json`),
    `${JSON.stringify(candidate, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(reviewDir, `${input.candidateId}__review-1.json`),
    `${JSON.stringify(review, null, 2)}\n`,
    "utf8",
  );
}

describe("shell argument parsing", () => {
  test("strips pnpm separator marker", () => {
    expect(normalizeArgv(["--", "golden-path", "README.md"])).toEqual(["golden-path", "README.md"]);
  });

  test("parses command and args for resume", () => {
    expect(parseCliInput(["resume", "session_123"])).toEqual({
      command: "resume",
      args: ["session_123"],
    });
  });

  test("parses command and args for run", () => {
    expect(parseCliInput(["run", "Summarize", "the", "repo"])).toEqual({
      command: "run",
      args: ["Summarize", "the", "repo"],
    });
  });

  test("parses command and args for control", () => {
    expect(parseCliInput(["control", "memory-clear", "session_123", "--scope", "all"])).toEqual({
      command: "control",
      args: ["memory-clear", "session_123", "--scope", "all"],
    });
  });

  test("parses command and args for status", () => {
    expect(parseCliInput(["status", "session_123", "--turn", "turn_1"])).toEqual({
      command: "status",
      args: ["session_123", "--turn", "turn_1"],
    });
  });

  test("parses command and args for task", () => {
    expect(parseCliInput(["task", "status", "session_123"])).toEqual({
      command: "task",
      args: ["status", "session_123"],
    });
  });

  test("parses command and args for doctor", () => {
    expect(parseCliInput(["doctor", "--json"])).toEqual({
      command: "doctor",
      args: ["--json"],
    });
  });

  test("parses command and args for onboard", () => {
    expect(parseCliInput(["onboard", "--json"])).toEqual({
      command: "onboard",
      args: ["--json"],
    });
  });

  test("parses command and args for preflight", () => {
    expect(parseCliInput(["preflight", "--json"])).toEqual({
      command: "preflight",
      args: ["--json"],
    });
  });

  test("parses command and args for director", () => {
    expect(parseCliInput(["director", "status"])).toEqual({
      command: "director",
      args: ["status"],
    });
  });

  test("falls back to help for unknown commands", () => {
    expect(parseCliInput(["unknown"])).toEqual({
      command: "help",
      args: [],
    });
  });

  test("parses control actions with session and scope", () => {
    expect(parseControlArgs(["memory-inspect", "session_123", "--scope", "episodic"])).toEqual({
      ok: true,
      value: {
        type: "memory-inspect",
        sessionId: "session_123",
        scope: "episodic",
      },
    });
  });

  test("parses rewind control action with checkpoint id", () => {
    expect(parseControlArgs(["rewind", "session_123", "--checkpoint", "7"])).toEqual({
      ok: true,
      value: {
        type: "rewind",
        sessionId: "session_123",
        checkpointId: 7,
      },
    });
  });

  test("parses resume control action with checkpoint id", () => {
    expect(parseControlArgs(["resume", "session_123", "--checkpoint", "7"])).toEqual({
      ok: true,
      value: {
        type: "resume",
        sessionId: "session_123",
        checkpointId: 7,
      },
    });
  });

  test("renders control usage when control action is missing", () => {
    const parsed = parseControlArgs([]);
    expect(parsed).toEqual({
      ok: false,
      error: "Missing control action.",
    });
    expect(renderControlUsage()).toContain("resume");
    expect(renderControlUsage()).toContain("rewind");
    expect(renderControlUsage()).toContain("prompt-explain");
    expect(renderControlUsage()).toContain("memory-clear");
  });
});

describe("help output", () => {
  test("includes golden-path, run, resume, status, and task commands", () => {
    const help = renderHelp();
    expect(help).toContain("golden-path");
    expect(help).toContain("run");
    expect(help).toContain("control");
    expect(help).toContain("resume");
    expect(help).toContain("status");
    expect(help).toContain("task");
    expect(help).toContain("doctor");
    expect(help).toContain("onboard");
    expect(help).toContain("preflight");
  });

  test("includes Beta-1 director commands", () => {
    const usage = renderDirectorUsage();
    expect(usage).toContain("acceptance [--json]");
    expect(usage).toContain("doctor [--host <url>] [--json]");
    expect(usage).toContain("runtime");
    expect(usage).toContain("adapters list");
    expect(usage).toContain("adapters register");
    expect(usage).toContain("adapters enable");
    expect(usage).toContain("adapters disable");
    expect(usage).toContain("adapters explain");
    expect(usage).toContain("switches show");
    expect(usage).toContain("run once --run-id <id> [--worker-id <id>]");
    expect(usage).toContain("run reroute --run-id <id> --assignment-id <id> --adapter-id <id>");
    expect(usage).toContain("run explain --run-id <id>");
    expect(usage).toContain("run audit --run-id <id>");
    expect(usage).toContain("memory status");
    expect(usage).toContain("memory recall-preview");
    expect(usage).toContain("trace-proposal status");
    expect(usage).toContain("trace-proposal list");
    expect(usage).toContain("trace-proposal explain");
    expect(usage).toContain("trace-proposal review");
    expect(usage).toContain("trace-proposal accept");
    expect(usage).toContain("trace-proposal reject");
    expect(usage).toContain("trace-proposal preview");
    expect(usage).toContain("trace-proposal replay");
    expect(usage).toContain("knowledge status");
    expect(usage).toContain("knowledge list");
    expect(usage).toContain("knowledge explain");
    expect(usage).toContain("knowledge publish");
    expect(usage).toContain("--include-global-experience");
    expect(usage).toContain("intake");
    expect(usage).toContain("clarify");
    expect(usage).toContain("evaluate");
    expect(usage).toContain("blueprint");
    expect(usage).toContain("outcome");
  });

  test("includes shared cross-channel slash commands from channels-core", () => {
    const usage = renderDirectorUsage();

    expect(usage).toContain("Shared / commands:");
    expect(usage).toContain("/制作 <制作目标>");
    expect(usage).toContain("/经验列表 [分类|标签|状态]");
    expect(usage).toContain("/模型供应方 [list|add|set|remove]");
    expect(usage).toContain("/测试供应方 <provider|profile>");
  });

  test("dispatches executable shared slash commands through the Director CLI", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-shared-slash-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "/经验列表"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director experience candidates:");
      expect(process.exitCode).toBeUndefined();
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("dispatches shared slash settings commands into real local settings files", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-shared-settings-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "/启动心跳"]);
      await startCli(["director", "/文本模型设置", "memefast-api", "gemini-2.5-flash"]);

      const switchDocument = JSON.parse(
        readFileSync(join(tempRoot, ".director-angel", "runtime", "switches.json"), "utf8"),
      ) as { features: Record<string, boolean> };
      const providerDocument = JSON.parse(
        readFileSync(join(tempRoot, ".director-angel", "providers", "providers.json"), "utf8"),
      ) as { providers: Array<{ id: string; defaultModels?: { text?: string } }> };
      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(switchDocument.features["heartbeat.enabled"]).toBe(true);
      expect(providerDocument.providers[0]?.defaultModels?.text).toBe("gemini-2.5-flash");
      expect(output).toContain("Director switch updated:");
      expect(output).toContain("Director API provider updated:");
      expect(process.exitCode).toBeUndefined();
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("dispatches shared provider test command without saving or leaking the key", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-shared-provider-test-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ data: [{ id: "gemini-2.5-flash" }] }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "/测试供应方", "memefast-api", "secret-key-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      const providerPath = join(tempRoot, ".director-angel", "providers", "providers.json");

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(output).toContain("Director API provider test:");
      expect(output).toContain("status: pass");
      expect(output).not.toContain("secret-key-1");
      expect(() => readFileSync(providerPath, "utf8")).toThrow();
      expect(process.exitCode).toBeUndefined();
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("dispatches Director message commands through the Host Entry message lane", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: String(init?.body ?? "") });
      const pathname = new URL(String(url)).pathname;
      if (pathname === "/v1/entry/message") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              session: {
                entrySessionId: "entry-cli-1",
                state: "ready_for_blueprint",
                nextAction: "blueprint",
              },
              turn: { summary: "/制作 生成一个15秒短剧分镜蓝图" },
              intake: {
                alignmentLock: {
                  objective: "/制作 生成一个15秒短剧分镜蓝图",
                  notes: [],
                },
              },
            }),
        } as Response;
      }
      if (pathname === "/v1/entry/sessions/entry-cli-1/blueprint") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              session: {
                entrySessionId: "entry-cli-1",
                state: "ready_for_run",
                nextAction: "run",
              },
              blueprint: {
                blueprintId: "blueprint-cli-1",
                actionGraph: {
                  goal: "生成一个15秒短剧分镜蓝图",
                  nodes: [
                    {
                      assignmentId: "assignment-cli-script",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            }),
        } as Response;
      }
      if (pathname === "/v1/entry/sessions/entry-cli-1/runs") {
        return {
          ok: true,
          status: 201,
          statusText: "Created",
          text: async () =>
            JSON.stringify({
              session: {
                entrySessionId: "entry-cli-1",
                state: "run_in_progress",
                nextAction: "wait",
              },
              run: {
                runId: "run-cli-1",
                status: "created",
                assignments: [
                  {
                    assignmentId: "assignment-cli-script",
                    status: "pending",
                    approvalMode: "operator_approve",
                  },
                ],
              },
            }),
        } as Response;
      }
      if (pathname === "/v1/runs/run-cli-1/start") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ runId: "run-cli-1", status: "running" }),
        } as Response;
      }
      if (pathname === "/v1/entry/sessions/entry-cli-1/status") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              session: {
                entrySessionId: "entry-cli-1",
                state: "run_in_progress",
                nextAction: "wait",
              },
              run: { runId: "run-cli-1", status: "running" },
              report: {
                reportId: "report-cli-1",
                operatorSurface: {
                  operatorSummary:
                    "制作判断：可以先做15秒三镜头短剧初稿。\n不要输出 Run：run-cli-1 或 蓝图：blueprint-cli-1。",
                },
              },
            }),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => JSON.stringify({ error: "not found" }),
      } as Response;
    });
    const runDirectorWorkerOnce = vi.fn().mockResolvedValue({
      run: createExecutionRunFixture({
        runId: "run-cli-1",
        status: "completed",
      }),
      report: {
        schemaVersion: "director.execution.run.v1",
        reportId: "report-cli-worker-1",
        runId: "run-cli-1",
        run: createExecutionRunFixture({
          runId: "run-cli-1",
          status: "completed",
        }),
        recordedAt: "2026-04-30T02:30:00.000Z",
        summary: ["run status=completed"],
        flags: [],
        operatorSurface: {
          directorGoal: "生成一个15秒短剧分镜蓝图",
          operatorSummary: "三镜头成片草案：1. 建立人物；2. 推进冲突；3. 给出反转。",
        },
        events: [],
      },
      executedAssignments: ["assignment-cli-script"],
    });
    setDirectorWorkerModuleLoaderForTests(async () => ({
      runDirectorWorkerOnce,
      runDirectorWorkerCli: vi.fn(),
    }));
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli([
      "director",
      "message",
      "--text",
      "/制作 生成一个15秒短剧分镜蓝图",
      "--peer-id",
      "cli-peer",
      "--host",
      "http://127.0.0.1:3201",
    ]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/entry/message",
      "/v1/entry/sessions/entry-cli-1/blueprint",
      "/v1/entry/sessions/entry-cli-1/runs",
      "/v1/runs/run-cli-1/start",
      "/v1/entry/sessions/entry-cli-1/status",
    ]);
    expect(calls[0]?.body).toContain('"channel":"cli"');
    expect(calls[0]?.body).toContain('"peerId":"cli-peer"');
    expect(runDirectorWorkerOnce).toHaveBeenCalledWith(
      {
        runId: "run-cli-1",
        workerId: "director-cli-message",
      },
      {
        env: expect.objectContaining({
          HOTFLOW_WORKSPACE_ROOT: expect.any(String),
          HOTFLOW_DATA_DIR: expect.any(String),
        }),
      },
    );
    expect(output).toContain("三镜头成片草案");
    expect(output).not.toContain("Run：");
    expect(output).not.toContain("蓝图：");
    expect(process.exitCode).toBeUndefined();
  });

  test("keeps low-value Director message chatter out of the Host Entry lane", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({}),
    } as Response);
    const runDirectorWorkerOnce = vi.fn();
    setDirectorWorkerModuleLoaderForTests(async () => ({
      runDirectorWorkerOnce,
      runDirectorWorkerCli: vi.fn(),
    }));
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["director", "message", "--text", "我今天学习制作咖啡，挺开心"]);
    await startCli(["director", "message", "--text", "今天天气不错，随便聊聊"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runDirectorWorkerOnce).not.toHaveBeenCalled();
    expect(output).toContain("Director message admission:");
    expect(output).toContain("status: ignored-low-signal");
    expect(output.match(/Director message admission:/gu)).toHaveLength(2);
    expect(process.exitCode).toBeUndefined();
  });

  test("keeps unsafe romanticized production requests out of the Host Entry lane", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({}),
    } as Response);
    const runDirectorWorkerOnce = vi.fn();
    setDirectorWorkerModuleLoaderForTests(async () => ({
      runDirectorWorkerOnce,
      runDirectorWorkerCli: vi.fn(),
    }));
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli([
      "director",
      "message",
      "--text",
      "/制作 生成一个15秒短剧分镜蓝图，主题：山村拐卖婚姻，最终爱情美满",
    ]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runDirectorWorkerOnce).not.toHaveBeenCalled();
    expect(output).toContain("不能按“拐卖后爱情美满”来做");
    expect(output).toContain("批判拐卖");
    expect(output).toContain("施害者承担法律后果");
    expect(process.exitCode).toBeUndefined();
  });

  test("shows content policy details in developer debug mode without bypassing the hard boundary", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-content-policy-debug-"));
    const previousEnv = captureDirectorTestEnv();
    try {
      applyDirectorTestEnv(tempRoot);
      const runtimeRoot = join(tempRoot, ".director-angel", "runtime");
      mkdirSync(runtimeRoot, { recursive: true });
      writeFileSync(
        join(runtimeRoot, "switches.json"),
        JSON.stringify({
          schemaId: "director.switches.v1",
          features: {
            "contentSafety.developerDebug.enabled": true,
          },
        }),
        "utf8",
      );
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({}),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli([
        "director",
        "message",
        "--text",
        "/制作 生成一个15秒短剧分镜蓝图，主题：山村拐卖婚姻，最终爱情美满",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(output).toContain("开发者调试");
      expect(output).toContain("content.humanTrafficking.romanticized");
      expect(output).toContain("floor=hard");
      expect(output).toContain("canOverride=false");
      expect(output).toContain("硬底线");
      expect(output).toContain("批判拐卖");
      expect(process.exitCode).toBeUndefined();
    } finally {
      restoreDirectorTestEnv(previousEnv);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("dispatches shared experience taxonomy commands into the real taxonomy store", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-experience-taxonomy-"));
    const previousEnv = captureDirectorTestEnv();
    try {
      applyDirectorTestEnv(tempRoot);
      seedAcceptedExperienceCandidate(tempRoot, {
        candidateId: "exp-1",
        title: "shot lesson",
      });
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "/经验分类", "exp-1", "director-shot", "shot-size"]);
      await startCli(["director", "/经验打标", "exp-1", "lighting"]);

      const taxonomy = JSON.parse(
        readFileSync(
          join(tempRoot, ".director-angel", "knowledge", "experience", "taxonomy.json"),
          "utf8",
        ),
      ) as { candidates: Array<{ candidateId: string; categoryId?: string; tagIds: string[] }> };
      const binding = taxonomy.candidates.find((entry) => entry.candidateId === "exp-1");
      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(binding).toMatchObject({
        candidateId: "exp-1",
        categoryId: "director-shot",
        tagIds: ["lighting"],
      });
      expect(output).toContain("Director experience classified:");
      expect(output).toContain("Director experience tags updated:");
      expect(process.exitCode).toBeUndefined();
    } finally {
      restoreDirectorTestEnv(previousEnv);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("dispatches shared trace proposal experience command into the real experience store", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-trace-experience-"));
    const previousEnv = captureDirectorTestEnv();
    try {
      applyDirectorTestEnv(tempRoot);
      writeAcceptedProposalFixtureForCli(tempRoot, "proposal-trace-1");
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "/轨迹沉淀经验", "proposal-trace-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director trace experience candidate created:");
      expect(output).toContain("write: Stored experience source artifact");
      expect(process.exitCode).toBeUndefined();
    } finally {
      restoreDirectorTestEnv(previousEnv);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("dispatches shared Skill lifecycle commands through proposal review and safe apply", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-skill-lifecycle-"));
    const previousEnv = captureDirectorTestEnv();
    try {
      applyDirectorTestEnv(tempRoot);
      seedAcceptedExperienceCandidate(tempRoot, {
        candidateId: "exp-1",
        title: "shot lesson",
      });
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "/从经验生成Skill", "exp-1"]);
      const proposedOutput = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      const proposalId = /proposal:\s+(skill-proposal-exp-1-\d+)/u.exec(proposedOutput)?.[1];
      expect(proposalId).toBeDefined();

      await startCli(["director", "/接受Skill", proposalId as string]);
      await startCli(["director", "/调用Skill", proposalId as string]);
      await startCli([
        "director",
        "/Skill分类",
        "skill.director.shot-lesson",
        "workflow",
        "reusable",
      ]);
      await startCli(["director", "/Skill打标", "skill.director.shot-lesson", "review-safe"]);
      await startCli(["director", "/Skill列表"]);

      const approved = JSON.parse(
        readFileSync(join(tempRoot, ".hotflow", "skills", "approved-skills.json"), "utf8"),
      ) as { skills: Array<{ id: string; title: string }> };
      const taxonomy = JSON.parse(
        readFileSync(join(tempRoot, ".hotflow", "skills", "taxonomy.json"), "utf8"),
      ) as { skills: Array<{ skillId: string; categoryId?: string; tagIds: string[] }> };
      const binding = taxonomy.skills.find(
        (entry) => entry.skillId === "skill.director.shot-lesson",
      );
      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(approved.skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "skill.director.shot-lesson",
            title: "Skill：shot lesson",
          }),
        ]),
      );
      expect(binding).toMatchObject({
        skillId: "skill.director.shot-lesson",
        categoryId: "workflow",
        tagIds: ["review-safe"],
      });
      expect(output).toContain("Director Skill proposal created:");
      expect(output).toContain("Director Skill proposal accepted:");
      expect(output).toContain("Director Skill proposal applied:");
      expect(output).toContain("Director Skills:");
      expect(output).toContain("approved: 1");
      expect(process.exitCode).toBeUndefined();
    } finally {
      restoreDirectorTestEnv(previousEnv);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints the latest acceptance checklist summary from benchmark artifacts", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-acceptance-pass-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      writeDirectorAcceptanceArtifacts(tempRoot);

      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "acceptance"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director Acceptance");
      expect(output).toContain("Status: PASS");
      expect(output).toContain("[PASS] Beta-7 Wave 1 adapter registry");
      expect(output).toContain("[PASS] Phase P2 Wave 1 real execution handoff");
      expect(output).toContain("[PASS] Phase P2 Wave 2 dual execution chain");
      expect(output).toContain("[PASS] Phase P2 Wave 3 retryable bridge failure");
      expect(output).toContain("[PASS] Phase P2 Wave 4 non-retryable bridge failure");
      expect(output).toContain("[PASS] Phase P2 Wave 5 retry policy boundary");
      expect(output).toContain("[PASS] Phase P2 Wave 6 failover boundary");
      expect(output).toContain("[PASS] Phase P2 Wave 7 route recovery audit closure");
      expect(output).toContain("[PASS] Phase P2 Wave 8 chain route health snapshot");
      expect(output).toContain("[PASS] Phase P2 Wave 9 chain route doctor visibility");
      expect(output).toContain("[PASS] Phase P2 Wave 10 worker once operator entry");
      expect(output).toContain("[PASS] Phase P2 Wave 11 run once preflight guidance");
      expect(output).toContain("[PASS] Phase P2 Wave 12 run once exit surface");
      expect(output).toContain("[PASS] Phase P2 Wave 13 run once holding-state taxonomy");
      expect(output).toContain("[PASS] Phase P2 Wave 14 run state surface alignment");
      expect(output).toContain("[PASS] Phase P2 Wave 15 run state visibility closeout");
      expect(output).toContain(
        "[PASS] Cycle 1 Wave 83 prompt-inspect static runtime summary surface",
      );
      expect(output).toContain("[PASS] Cycle 1 Wave 93 status tool runtime guidance precedence");
      expect(output).toContain("[PASS] Wave-8 doctor benchmark: runs=2 failed=0");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("sets a failing exit code when acceptance evidence contains a failed gate", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-acceptance-fail-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      writeDirectorAcceptanceArtifacts(tempRoot, { doctorFailed: true });

      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "acceptance"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Status: FAIL");
      expect(output).toContain("failing cases: healthy_scripted_default");
      expect(process.exitCode).toBe(1);
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("runs director doctor and shows chain route health visibility", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-doctor-route-health-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const runtimeDir = join(tempRoot, ".director-angel", "runtime");
      const executionRunDir = join(runtimeDir, "execution", "runs", "run-route-health-1");
      mkdirSync(join(tempRoot, ".director-angel", "knowledge"), { recursive: true });
      mkdirSync(join(tempRoot, ".director-angel", "adapters", "registry"), { recursive: true });
      mkdirSync(join(runtimeDir, "proposals"), { recursive: true });
      mkdirSync(executionRunDir, { recursive: true });
      writeFileSync(
        join(runtimeDir, "switches.json"),
        JSON.stringify({
          schemaId: "director.switches.v1",
          features: {
            "execution.sideEffects.enabled": true,
            "memory.enabled": false,
            "knowledgeRecall.enabled": true,
          },
        }),
        "utf8",
      );

      const run = createExecutionRunFixture({
        runId: "run-route-health-1",
        runtimeId: "director-host-api",
        status: "failed",
        updatedAt: "2026-04-14T09:50:00.000Z",
        assignments: [
          {
            runId: "run-route-health-1",
            assignmentId: "assignment-rerouted-1",
            role: "shot-planner",
            objective: "Draft the shot list",
            deliverable: "shot list",
            actionClass: "generate",
            approvalMode: "auto_allow",
            dependsOn: [],
            status: "ready",
            selectedAdapter: "runway-preview",
            allowedAdapters: ["seedance-preview", "runway-preview"],
            createdAt: "2026-04-14T09:40:00.000Z",
            notes: [
              "external-bridge",
              "bridge:http-json",
              "Retry requested at 2026-04-14T09:45:00.000Z.",
              "Adapter rerouted from seedance-preview to runway-preview at 2026-04-14T09:46:00.000Z.",
            ],
          },
          {
            runId: "run-route-health-1",
            assignmentId: "assignment-exhausted-1",
            role: "shot-planner",
            objective: "Generate the first storyboard frames",
            deliverable: "storyboard frames",
            actionClass: "generate",
            approvalMode: "auto_allow",
            dependsOn: [],
            status: "failed",
            selectedAdapter: "seedance-preview",
            allowedAdapters: ["seedance-preview"],
            createdAt: "2026-04-14T09:41:00.000Z",
            notes: [
              "external-bridge",
              "bridge:http-json",
              "Retry requested at 2026-04-14T09:47:00.000Z.",
            ],
            result: {
              runId: "run-route-health-1",
              assignmentId: "assignment-exhausted-1",
              status: "failed",
              recordedAt: "2026-04-14T09:48:00.000Z",
              workerId: "worker-exhausted-1",
              summary: "Bridge contract failed without a safe fallback route.",
              adapterId: "seedance-preview",
              bridgeExecution: {
                kind: "http-json",
                request: {
                  endpointOrigin: "https://bridge.example.test",
                  endpointPath: "/v1/jobs",
                  method: "POST",
                  timeoutMs: 1500,
                  authMode: "env",
                  headerKeys: ["authorization"],
                  payloadBytes: 512,
                },
                failure: {
                  reason: "invalid_response",
                  retryable: false,
                  message: "Bridge returned malformed payload",
                },
              },
            },
          },
        ],
      });

      writeFileSync(join(executionRunDir, "run.json"), JSON.stringify(run), "utf8");
      writeFileSync(
        join(executionRunDir, "report.json"),
        JSON.stringify({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-route-health-1",
          runId: "run-route-health-1",
          run,
          recordedAt: "2026-04-14T09:51:00.000Z",
          summary: ["run status=failed", "route visibility surfaced"],
          flags: ["external-bridge-failed"],
          operatorSurface: {
            directorGoal: "Generate a storyboard-ready lighthouse reveal sequence.",
            operatorSummary: "One route is rerouted and one route is exhausted.",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "failed",
            bridgeFailureReason: "invalid_response",
            retryable: false,
            retryAllowed: false,
            nextAction: "repair the bridge contract before trying again.",
          },
          events: [],
        }),
        "utf8",
      );

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createRuntimeCapabilitySnapshotFixture({
            runtimeId: "director-host-api",
            capabilitySnapshot: {
              snapshotId: "capability-snapshot-route-health",
              runtimeId: "director-host-api",
              capturedAt: "2026-04-14T09:52:00.000Z",
              status: "ready",
              adapters: [
                {
                  adapterId: "seedance-preview",
                  adapterKind: "media",
                  provider: "seedance",
                  enabled: true,
                  healthStatus: "ready",
                  dryRunSupported: true,
                  mockOnly: false,
                  bridge: {
                    kind: "http-json",
                    endpointOrigin: "https://bridge.example.test",
                    endpointPath: "/v1/jobs",
                    authMode: "env",
                    timeoutMs: 1500,
                    headerKeys: ["x-bridge-id"],
                  },
                  supportedActionClasses: ["generate"],
                },
              ],
              notes: ["single-vertical-ready"],
            },
          }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "doctor"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director Doctor");
      expect(output).toContain("[FAIL] chain-route-health");
      expect(output).toContain("verdict=degraded");
      expect(output).toContain("verdict=exhausted");
      expect(output).toContain("Bridge returned malformed payload");
      expect(process.exitCode).toBe(1);
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("runs director doctor and reports fail status when the runtime snapshot is unavailable", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-doctor-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      mkdirSync(join(tempRoot, ".director-angel", "runtime"), { recursive: true });
      mkdirSync(join(tempRoot, ".director-angel", "knowledge"), { recursive: true });
      mkdirSync(join(tempRoot, ".director-angel", "adapters", "registry"), { recursive: true });

      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 127.0.0.1:8787"),
      );
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "doctor"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director Doctor");
      expect(output).toContain("Status: FAIL");
      expect(output).toContain("[FAIL] runtime");
      expect(output).toContain("[FAIL] bridge");
      expect(process.exitCode).toBe(1);
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("director beta1 commands", () => {
  test("prints the runtime snapshot", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        apiVersion: "director-host-api.v1",
        runtimeId: "director-host-api",
        status: "ready",
        workspaceRoot: "/workspace",
        dataDir: "/workspace/.hotflow",
        defaultProvider: "scripted",
        defaultModel: "hotflow-phase1",
        availableProviders: ["binding-a"],
        knowledgePackCount: 0,
        notes: ["ready"],
        capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
          runtimeId: "director-host-api",
          capabilitySnapshot: {
            snapshotId: "capability-snapshot-runtime",
            runtimeId: "director-host-api",
            capturedAt: "2026-04-11T12:00:00.000Z",
            status: "ready",
            adapters: [
              {
                adapterId: "binding-a",
                adapterKind: "media",
                provider: "mock-media",
                enabled: true,
                healthStatus: "ready",
                dryRunSupported: true,
                mockOnly: true,
              },
            ],
            notes: ["ready"],
          },
        }).capabilitySnapshot,
      }),
    } as Response);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["director", "runtime", "--host", "http://127.0.0.1:3201"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "Director runtime snapshot:",
    );
  });

  test("prints Agent OS process capability ledger summary from the runtime snapshot", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        runtimeId: "director-host-api",
        capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
          runtimeId: "director-host-api",
          capabilitySnapshot: {
            snapshotId: "capability-snapshot-runtime",
            runtimeId: "director-host-api",
            capturedAt: "2026-04-11T12:00:00.000Z",
            status: "ready",
            adapters: [],
            notes: ["ready"],
          },
        }).capabilitySnapshot,
        agentOsProcessCapabilityLedger: {
          generatedAt: "2026-05-08T10:55:00.000Z",
          totalEntries: 1,
          riskyHostEntries: 1,
          entries: [
            {
              owner: "director-host-api",
              runnerKind: "exec-file",
              backend: "host",
              status: "completed",
              providerId: "agent-os-sandbox.host",
              commandPattern: {
                executable: "echo",
                argv: ["ok"],
                operationId: "host-ledger-smoke",
              },
              process: {
                pid: 4242,
                ownedProcess: true,
              },
            },
          ],
        },
      }),
    } as Response);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["director", "runtime", "--host", "http://127.0.0.1:3201"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Agent OS process ledger: total=1 risky-host=1");
    expect(output).toContain(
      "exec-file backend=host status=completed command=echo ok operation=host-ledger-smoke pid=4242",
    );
  });

  test("prints Agent OS extension matrix summary from the runtime snapshot", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        runtimeId: "director-host-api",
        capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
          runtimeId: "director-host-api",
          capabilitySnapshot: {
            snapshotId: "capability-snapshot-runtime",
            runtimeId: "director-host-api",
            capturedAt: "2026-04-11T12:00:00.000Z",
            status: "ready",
            adapters: [],
            notes: ["ready"],
          },
        }).capabilitySnapshot,
        agentOsExtensionMatrix: {
          summary: {
            total: 2,
            ready: 1,
            needsAuth: 1,
            needsSetup: 0,
            disabled: 0,
            problem: 0,
          },
          entries: [
            {
              id: "media-understanding.local",
              kind: "provider",
              displayName: "Media Understanding",
              toolId: "media-understanding.local",
              providerId: "media-understanding",
              capabilityIds: ["media.understand_image"],
              health: { status: "ready", checkFn: "media-understanding.local" },
              sandbox: { defaultMode: "readonly", networkPolicy: "none" },
              sourceTrust: { status: "built-in" },
              uiSurfaces: ["tools", "review"],
            },
            {
              id: "x-twitter",
              kind: "provider",
              displayName: "X/Twitter",
              toolId: "x-twitter",
              providerId: "x-twitter",
              capabilityIds: ["x.search"],
              health: { status: "needs-auth", checkFn: "x-twitter.auth" },
              sandbox: { defaultMode: "network-limited", networkPolicy: "limited" },
              sourceTrust: { status: "user-configured" },
              uiSurfaces: ["settings", "tools", "review"],
            },
          ],
          byCapability: {
            "media.understand_image": [],
            "x.search": [],
          },
        },
      }),
    } as Response);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["director", "runtime", "--host", "http://127.0.0.1:3201"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain(
      "Agent OS extension matrix: total=2 ready=1 needs-auth=1 needs-setup=0 problem=0 disabled=0",
    );
    expect(output).toContain(
      "Media Understanding id=media-understanding.local tool=media-understanding.local provider=media-understanding status=ready sandbox=readonly network=none capabilities=media.understand_image",
    );
    expect(output).toContain(
      "X/Twitter id=x-twitter tool=x-twitter provider=x-twitter status=needs-auth sandbox=network-limited network=limited capabilities=x.search",
    );
  });

  test("prints Agent OS subagent run summary from the runtime snapshot", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        runtimeId: "director-host-api",
        capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
          runtimeId: "director-host-api",
          capabilitySnapshot: {
            snapshotId: "capability-snapshot-runtime",
            runtimeId: "director-host-api",
            capturedAt: "2026-04-11T12:00:00.000Z",
            status: "ready",
            adapters: [],
            notes: ["ready"],
          },
        }).capabilitySnapshot,
        agentOsSubagentRuns: {
          summary: {
            total: 2,
            queued: 0,
            running: 1,
            completed: 1,
            failed: 0,
            cancelled: 0,
            verifiedPass: 1,
            verifiedFail: 0,
            verifiedPartial: 0,
          },
          schedulerHeartbeat: {
            schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1",
            parentTurnId: "turn-1",
            totalSubagentRuns: 2,
            queuedCount: 0,
            runningCount: 1,
            completedCount: 1,
            failedCount: 0,
            cancelledCount: 0,
            schedulerTrackedCount: 1,
            readyCount: 0,
            blockedCount: 0,
            unscheduledQueuedCount: 0,
            nextReadySubagentIds: [],
            blockedSubagentIds: [],
            runningSubagentIds: ["delegation-run-1-shot-planner"],
            canContinue: false,
            stoppedReason: "mailbox-empty",
            heartbeatOrdinal: 1_700_000_003_000,
            latestUpdatedAtMs: 1_700_000_003_000,
          },
          schedulerDispatchPlan: {
            schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
            parentTurnId: "turn-1",
            planOrdinal: 1_700_000_003_000,
            heartbeatOrdinal: 1_700_000_003_000,
            canDispatch: false,
            dispatchReason: "mailbox-empty",
            maxDispatchableCount: 0,
            dispatchableSubagentIds: [],
            dispatchBatches: [],
            blockedSubagentIds: [],
            runningSubagentIds: ["delegation-run-1-shot-planner"],
          },
          schedulerTick: {
            schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
            sessionId: "run-1",
            latestTurnId: "turn-1",
            dispatchIntents: [
              {
                intentId: "dispatch_delegation-run-1-shot-planner",
                delegationId: "delegation-run-1-shot-planner",
                workerId: "director-shot-planner",
                command: "run-delegation",
                argv: [
                  "run-delegation",
                  "--session-id",
                  "run-1",
                  "--worker-id",
                  "director-shot-planner",
                  "--delegation-id",
                  "delegation-run-1-shot-planner",
                ],
                parallelBatch: 0,
                writeSet: ["shots/plan.md"],
                writeSetSource: "explicit",
              },
            ],
            claimDryRun: true,
          },
          schedulerRecoveryPlan: {
            schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
            parentTurnId: "turn-1",
            canRecover: true,
            blockedSubagentIds: [],
            conflictedSubagentIds: ["delegation-run-1-researcher", "delegation-run-1-shot-planner"],
            recoveryActions: [
              {
                actionId: "recover_delegation-run-1-shot-planner_observed_write_set_overlap",
                subagentId: "delegation-run-1-shot-planner",
                actionType: "review-observed-write-set",
                severity: "warning",
                reason: "observed-write-set-overlap: shots/risk.md",
                relatedSubagentIds: ["delegation-run-1-researcher"],
                writeSet: ["shots/plan.md"],
                undeclaredObservedWriteSet: ["shots/risk.md"],
                evidence: {
                  blockedBy: [],
                  conflictsWith: [],
                  observedConflictWith: ["delegation-run-1-researcher"],
                },
                operatorSummary:
                  "Review observed write-set drift for delegation-run-1-shot-planner before dispatching related subagents.",
              },
            ],
            recoveryGroups: [
              {
                groupId: "recovery_group_observed_write_set_overlap_shots_risk_md",
                groupType: "observed-write-set-overlap",
                severity: "warning",
                reason: "observed-write-set-overlap: shots/risk.md",
                actionIds: ["recover_delegation-run-1-shot-planner_observed_write_set_overlap"],
                subagentIds: ["delegation-run-1-shot-planner", "delegation-run-1-researcher"],
                runningSubagentIds: ["delegation-run-1-shot-planner"],
                blockedSubagentIds: [],
                completedSubagentIds: ["delegation-run-1-researcher"],
                writeSet: ["shots/risk.md"],
                undeclaredObservedWriteSet: ["shots/risk.md"],
                operatorSummary:
                  "Review observed-write-set-overlap recovery group for shots/risk.md: 1 running, 0 blocked, 1 completed.",
              },
            ],
            recoveryOrdinal: 1_700_000_003_000,
          },
          entries: [
            {
              subagentId: "delegation-run-1-researcher",
              parentTurnId: "turn-1",
              profileId: "director-researcher",
              workerId: "director-researcher",
              taskId: "assignment-researcher",
              status: "completed",
              role: "explore",
              targetAgent: "director-researcher",
              isolatedContext: true,
              instruction: "Inspect source material.",
              resultSummary: "Risk summary is grounded.",
              observedWriteSet: ["briefs/risk.md"],
              observedWriteSetSource: "artifact",
              createdAtMs: 1_700_000_000_000,
              updatedAtMs: 1_700_000_001_000,
              completedAtMs: 1_700_000_001_000,
              verification: {
                verificationId: "verification-run-1-researcher",
                verifierId: "director-qc-reviewer",
                status: "passed",
                verdict: "pass",
                verdictSummary: "Grounded evidence is present.",
                requirement: "Confirm the summary.",
              },
              parentVisibleResult: {
                status: "completed",
                summary: "Risk summary is grounded.",
                verificationVerdict: "pass",
                observedWriteSet: ["briefs/risk.md"],
                observedWriteSetSource: "artifact",
              },
            },
            {
              subagentId: "delegation-run-1-shot-planner",
              parentTurnId: "turn-1",
              profileId: "director-shot-planner",
              workerId: "director-shot-planner",
              taskId: "assignment-shot-planner",
              status: "running",
              role: "plan",
              isolatedContext: true,
              instruction: "Create shot plan.",
              createdAtMs: 1_700_000_002_000,
              updatedAtMs: 1_700_000_003_000,
              parentVisibleResult: {
                status: "running",
              },
              scheduling: {
                parallelGroup: "planning",
                writeSet: ["shots/plan.md"],
                writeSetSource: "explicit",
                undeclaredObservedWriteSet: ["shots/risk.md"],
                observedConflictWith: ["delegation-run-1-researcher"],
                canRunInParallel: true,
                conflictsWith: [],
                conflictReason: "observed-write-set-overlap: shots/risk.md",
                parallelBatch: 0,
                scheduleOrder: 1,
                readyToStart: true,
                blockedBy: [],
              },
            },
          ],
        },
      }),
    } as Response);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["director", "runtime", "--host", "http://127.0.0.1:3201"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain(
      "Agent OS subagent runs: total=2 queued=0 running=1 completed=1 failed=0 cancelled=0 verified-pass=1 verified-fail=0 verified-partial=0",
    );
    expect(output).toContain(
      "scheduler=ready=0 blocked=0 running=1 unscheduled=0 canContinue=false stopped=mailbox-empty heartbeat=1700000003000",
    );
    expect(output).toContain(
      "dispatch=canDispatch=false reason=mailbox-empty max=0 running=delegation-run-1-shot-planner plan=1700000003000 heartbeat=1700000003000",
    );
    expect(output).toContain(
      "tick=session=run-1 latestTurn=turn-1 intents=1 claimDryRun=true dispatch=delegation-run-1-shot-planner->director-shot-planner batch=0 writeSet=shots/plan.md source=explicit",
    );
    expect(output).toContain(
      "recovery=canRecover=true actions=1 groups=1 conflicted=delegation-run-1-researcher,delegation-run-1-shot-planner group=recovery_group_observed_write_set_overlap_shots_risk_md@type=observed-write-set-overlap@severity=warning@writeSet=shots/risk.md@running=1@blocked=0@completed=1 next=delegation-run-1-shot-planner@type=review-observed-write-set@severity=warning@reason=observed-write-set-overlap: shots/risk.md@related=delegation-run-1-researcher recovery=1700000003000",
    );
    expect(output).toContain(
      "delegation-run-1-researcher status=completed profile=director-researcher worker=director-researcher role=explore parent=turn-1 task=assignment-researcher isolated=true observedWriteSet=briefs/risk.md observedWriteSetSource=artifact verification=pass summary=Risk summary is grounded.",
    );
    expect(output).toContain(
      "delegation-run-1-shot-planner status=running profile=director-shot-planner worker=director-shot-planner role=plan parent=turn-1 task=assignment-shot-planner isolated=true parallel=planning batch=0 order=1 ready=true writeSet=shots/plan.md writeSetSource=explicit undeclaredObservedWriteSet=shots/risk.md observedConflictWith=delegation-run-1-researcher conflictReason=observed-write-set-overlap: shots/risk.md",
    );
  });

  test("prints adapter inventory from the runtime snapshot", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        runtimeId: "director-host-api",
        capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
          runtimeId: "director-host-api",
          capabilitySnapshot: {
            snapshotId: "capability-snapshot-runtime",
            runtimeId: "director-host-api",
            capturedAt: "2026-04-11T12:00:00.000Z",
            status: "ready",
            adapters: [
              {
                adapterId: "director-host-api",
                adapterKind: "host",
                provider: "director-host-api",
                enabled: true,
                healthStatus: "ready",
                dryRunSupported: true,
                mockOnly: true,
                supportedActionClasses: ["read", "write"],
              },
              {
                adapterId: "binding-a",
                adapterKind: "media",
                provider: "mock-media",
                enabled: true,
                healthStatus: "ready",
                dryRunSupported: true,
                mockOnly: true,
                supportedActionClasses: ["generate", "write"],
                mediaCapability: {
                  adapterId: "binding-a",
                  adapterKind: "media",
                  provider: "mock-media",
                  supportedModes: ["text_to_video"],
                  inputModalities: ["text"],
                  outputArtifactTypes: ["video"],
                  supportsAsync: false,
                  healthStatus: "ready",
                },
              },
            ],
            notes: ["preview-safe"],
          },
        }).capabilitySnapshot,
      }),
    } as Response);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["director", "adapters", "list", "--host", "http://127.0.0.1:3201"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(output).toContain("Director adapters:");
    expect(output).toContain("binding-a [media]");
    expect(output).toContain("actions: generate, write");
    expect(output).toContain("media: modes=text_to_video inputs=text outputs=video async=no");
  });

  test("prints switch defaults with runtime hints", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-switches-"));
    const previousEnv = captureDirectorTestEnv();
    applyDirectorTestEnv(tempRoot);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        runtimeId: "director-host-api",
        capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
          runtimeId: "director-host-api",
          capabilitySnapshot: {
            snapshotId: "capability-snapshot-runtime",
            runtimeId: "director-host-api",
            capturedAt: "2026-04-11T12:00:00.000Z",
            status: "ready",
            adapters: [
              {
                adapterId: "beta1-handoff-preview",
                adapterKind: "execution",
                provider: "director-host-api",
                enabled: true,
                healthStatus: "ready",
                dryRunSupported: true,
                mockOnly: true,
                supportedActionClasses: ["write"],
              },
            ],
            notes: ["preview-safe"],
          },
        }).capabilitySnapshot,
      }),
    } as Response);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await startCli(["director", "switches", "show", "--host", "http://127.0.0.1:3201"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(output).toContain("Director switches:");
      expect(output).toContain("source: Beta-1 defaults");
      expect(output).toContain("beta1: on");
      expect(output).toContain("beta2: off");
      expect(output).toContain("beta3: on");
      expect(output).toContain("adapter scope: beta1-handoff-preview (present)");
    } finally {
      restoreDirectorTestEnv(previousEnv);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("registers, disables, and explains a persisted adapter locally", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-adapter-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const manifestPath = join(tempRoot, "seedance.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        adapterId: "seedance-preview",
        adapterKind: "media",
        provider: "seedance",
        bindingId: "seedance-preview",
        healthStatus: "ready",
        dryRunSupported: true,
        mockOnly: true,
        supportedActionClasses: ["generate", "write"],
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
      }),
      "utf8",
    );

    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "adapters", "register", "--manifest", "seedance.json"]);
      await startCli(["director", "adapters", "disable", "--adapter-id", "seedance-preview"]);
      await startCli(["director", "adapters", "explain", "--adapter-id", "seedance-preview"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      const switchDocument = JSON.parse(
        readFileSync(join(tempRoot, ".director-angel", "runtime", "switches.json"), "utf8"),
      ) as { adapterOverrides: Record<string, boolean> };

      expect(output).toContain("Director adapter register:");
      expect(output).toContain("Director adapter disable:");
      expect(output).toContain("Director adapter explain:");
      expect(output).toContain("manifest registered: yes");
      expect(output).toContain("effective enabled: no");
      expect(switchDocument.adapterOverrides["seedance-preview"]).toBe(false);
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("explains bridge visibility without leaking credential details", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-adapter-bridge-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const manifestPath = join(tempRoot, "seedance-bridge.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        adapterId: "seedance-preview",
        adapterKind: "media",
        provider: "seedance",
        bindingId: "seedance-preview",
        healthStatus: "ready",
        dryRunSupported: true,
        mockOnly: false,
        supportedActionClasses: ["generate", "write"],
        riskLevel: "high",
        approvalMode: "operator_approve",
        permissionScopes: ["media.generate", "media.write"],
        dataRetentionPolicy: "vendor-retains-30-days",
        rateLimitPolicy: "10 requests/minute",
        budgetPolicy: "operator-budget-required",
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
          timeoutMs: 30000,
          authEnvVar: "SEEDANCE_API_KEY",
          headers: {
            "x-bridge-secret": "header-secret",
          },
        },
      }),
      "utf8",
    );

    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "adapters", "register", "--manifest", "seedance-bridge.json"]);
      await startCli(["director", "adapters", "explain", "--adapter-id", "seedance-preview"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");

      expect(output).toContain("Director adapter explain:");
      expect(output).toContain("bridge capable: yes");
      expect(output).toContain("bridge kind: http-json");
      expect(output).toContain("bridge endpoint: https://bridge.example.test/v1/jobs");
      expect(output).toContain("bridge auth: env");
      expect(output).toContain("bridge headers: x-bridge-secret");
      expect(output).toContain("risk level: high");
      expect(output).toContain("approval mode: operator_approve");
      expect(output).toContain("permission scopes: media.generate, media.write");
      expect(output).toContain("data retention: vendor-retains-30-days");
      expect(output).toContain("rate limit: 10 requests/minute");
      expect(output).toContain("budget policy: operator-budget-required");
      expect(output).toContain("real execution eligible: no");
      expect(output).not.toContain("SEEDANCE_API_KEY");
      expect(output).not.toContain("header-secret");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints director memory status and recall preview from local memory lane", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-memory-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      mkdirSync(join(tempRoot, ".director-angel", "runtime", "memory", "records"), {
        recursive: true,
      });
      mkdirSync(join(tempRoot, ".director-angel", "runtime", "memory", "ingest"), {
        recursive: true,
      });
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "switches.json"),
        JSON.stringify({
          schemaId: "director.switches.v1",
          features: {
            "memory.enabled": true,
          },
        }),
        "utf8",
      );
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "memory", "index.json"),
        JSON.stringify({
          schemaVersion: "director.memory.index.v1",
          updatedAt: "2026-04-12T18:20:00.000Z",
          entries: [
            {
              recordId: "record-1",
              digestId: "digest-record-1",
              projectId: "project-1",
              groupId: "group-1",
              anchorIds: ["anchor-a"],
              selectedAdapters: ["scripted"],
              tags: ["continuity"],
              status: "completed",
              recordedAt: "2026-04-12T18:19:00.000Z",
            },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "memory", "records", "record-1.json"),
        JSON.stringify({
          schemaVersion: "director.memory.record.v1",
          recordId: "record-1",
          digestId: "digest-record-1",
          projectId: "project-1",
          groupId: "group-1",
          anchorIds: ["anchor-a"],
          selectedAdapters: ["scripted"],
          tags: ["continuity"],
          status: "completed",
          recordedAt: "2026-04-12T18:19:00.000Z",
          digest: {
            schemaVersion: "director.memory.trace-digest.v1",
            digestId: "digest-record-1",
            runId: "run-1",
            reportId: "report-1",
            snapshotId: "snapshot-1",
            runtimeId: "runtime-1",
            blueprintId: "blueprint-1",
            handoffId: "handoff-1",
            actionGraphId: "graph-1",
            projectId: "project-1",
            groupId: "group-1",
            goal: "Create a continuity-safe teaser.",
            previewSummary: "Preview-safe run completed successfully.",
            status: "completed",
            roles: ["asset-router"],
            anchorIds: ["anchor-a"],
            selectedAdapters: ["scripted"],
            observationRefs: [
              {
                observationId: "observation-evaluation-1",
                source: "evaluation",
                recordedAt: "2026-04-12T18:10:00.000Z",
              },
            ],
            assignmentStats: {
              total: 1,
              completed: 1,
              failed: 0,
              aborted: 0,
              skipped: 0,
              blocked: 0,
            },
            flags: ["preview-only"],
            eventTypes: ["run-created"],
            createdAt: "2026-04-12T18:00:00.000Z",
            startedAt: "2026-04-12T18:01:00.000Z",
            completedAt: "2026-04-12T18:19:00.000Z",
            recordedAt: "2026-04-12T18:19:00.000Z",
            generationType: "new",
            generationStyle: "immersive",
            knowledgeSignalTags: ["continuity"],
          },
        }),
        "utf8",
      );
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "memory", "ingest", "run-1.json"),
        JSON.stringify({
          schemaVersion: "director.memory.ingest.audit.v1",
          runId: "run-1",
          reportId: "report-1",
          status: "ok",
          recordedAt: "2026-04-12T18:20:00.000Z",
          observationIds: ["observation-evaluation-1"],
          notes: ["Stored Director memory record record-1."],
          recordId: "record-1",
          digestId: "digest-record-1",
        }),
        "utf8",
      );
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "memory", "status"]);
      await startCli([
        "director",
        "memory",
        "recall-preview",
        "--project-id",
        "project-1",
        "--group-id",
        "group-1",
        "--anchor-id",
        "anchor-a",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director memory:");
      expect(output).toContain("latest ingest: ok");
      expect(output).toContain("Director memory recall preview:");
      expect(output).toContain("why recalled:");
      expect(output).toContain("provenance:");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints director trace proposal status, list, and explain from the local proposal lane", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-proposals-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      mkdirSync(join(tempRoot, ".director-angel", "runtime", "proposals", "records"), {
        recursive: true,
      });
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "proposals", "index.json"),
        JSON.stringify({
          schemaVersion: "director.proposal.index.v1",
          updatedAt: "2026-04-12T20:30:00.000Z",
          entries: [
            {
              proposalId: "proposal-1",
              kind: "director.trace_capture",
              status: "pending",
              projectId: "project-1",
              groupId: "group-1",
              title: "Director method: Continuity-safe teaser",
              riskLevel: "low",
              confidence: 0.88,
              updatedAt: "2026-04-12T20:30:00.000Z",
            },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "proposals", "records", "proposal-1.json"),
        JSON.stringify({
          schemaVersion: "director.proposal.v1",
          proposalId: "proposal-1",
          kind: "director.trace_capture",
          status: "pending",
          provenance: "director-worker/proposal-ingest",
          recordId: "record-1",
          digestId: "digest-1",
          runId: "run-1",
          reportId: "report-1",
          projectId: "project-1",
          groupId: "group-1",
          title: "Director method: Continuity-safe teaser",
          summary: "completed immersive new run",
          trigger: "When planning a continuity-safe teaser.",
          evidenceSummary: "status=completed | roles=researcher, script-planner",
          explanation: "Completed run suggests a reusable director method.",
          confidence: 0.88,
          riskLevel: "low",
          dedupeKey: "project-1__group-1",
          tags: ["director-trace", "continuity"],
          roles: ["researcher", "script-planner"],
          selectedAdapters: ["scripted"],
          createdAt: "2026-04-12T20:30:00.000Z",
          updatedAt: "2026-04-12T20:30:00.000Z",
          sourceRecord: {
            schemaVersion: "director.memory.record.v1",
            recordId: "record-1",
            digestId: "digest-1",
            projectId: "project-1",
            groupId: "group-1",
            anchorIds: ["anchor-a"],
            selectedAdapters: ["scripted"],
            status: "completed",
            recordedAt: "2026-04-12T20:30:00.000Z",
            digest: {
              schemaVersion: "director.memory.trace-digest.v1",
              digestId: "digest-1",
              runId: "run-1",
              reportId: "report-1",
              snapshotId: "snapshot-1",
              runtimeId: "runtime-1",
              blueprintId: "blueprint-1",
              handoffId: "handoff-1",
              actionGraphId: "graph-1",
              projectId: "project-1",
              groupId: "group-1",
              goal: "Create a continuity-safe teaser.",
              previewSummary: "Preview-safe run completed successfully.",
              status: "completed",
              roles: ["researcher", "script-planner"],
              anchorIds: ["anchor-a"],
              selectedAdapters: ["scripted"],
              observationRefs: [
                {
                  observationId: "observation-evaluation-1",
                  source: "evaluation",
                  recordedAt: "2026-04-12T20:30:00.000Z",
                },
              ],
              assignmentStats: {
                total: 2,
                completed: 2,
                failed: 0,
                aborted: 0,
                skipped: 0,
                blocked: 0,
              },
              flags: [],
              eventTypes: ["run-created", "assignment-status-changed"],
              createdAt: "2026-04-12T20:30:00.000Z",
              startedAt: "2026-04-12T20:30:00.000Z",
              completedAt: "2026-04-12T20:30:00.000Z",
              recordedAt: "2026-04-12T20:30:00.000Z",
              generationType: "new",
              generationStyle: "immersive",
              knowledgeSignalTags: ["continuity"],
            },
          },
        }),
        "utf8",
      );
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "trace-proposal", "status"]);
      await startCli(["director", "trace-proposal", "list", "--project-id", "project-1"]);
      await startCli(["director", "trace-proposal", "explain", "--proposal-id", "proposal-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director trace proposals:");
      expect(output).toContain("proposal count: 1");
      expect(output).toContain("Director trace proposal list:");
      expect(output).toContain("proposal-1 status=pending risk=low confidence=0.88");
      expect(output).toContain("Director trace proposal:");
      expect(output).toContain("proposal id: proposal-1");
      expect(output).toContain("provenance: director-worker/proposal-ingest");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints director trace proposal review and decision flows from the local proposal lane", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-proposal-review-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      mkdirSync(join(tempRoot, ".director-angel", "runtime", "proposals", "records"), {
        recursive: true,
      });
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "proposals", "index.json"),
        JSON.stringify({
          schemaVersion: "director.proposal.index.v1",
          updatedAt: "2026-04-12T20:40:00.000Z",
          entries: [
            {
              proposalId: "proposal-1",
              kind: "director.trace_capture",
              status: "pending",
              projectId: "project-1",
              groupId: "group-1",
              title: "Director method: Continuity-safe teaser",
              riskLevel: "low",
              confidence: 0.88,
              updatedAt: "2026-04-12T20:40:00.000Z",
            },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "proposals", "records", "proposal-1.json"),
        JSON.stringify({
          schemaVersion: "director.proposal.v1",
          proposalId: "proposal-1",
          kind: "director.trace_capture",
          status: "pending",
          provenance: "director-worker/proposal-ingest",
          recordId: "record-1",
          digestId: "digest-1",
          runId: "run-1",
          reportId: "report-1",
          projectId: "project-1",
          groupId: "group-1",
          title: "Director method: Continuity-safe teaser",
          summary: "completed immersive new run",
          trigger: "When planning a continuity-safe teaser.",
          evidenceSummary: "status=completed | roles=researcher, script-planner",
          explanation: "Completed run suggests a reusable director method.",
          confidence: 0.88,
          riskLevel: "low",
          dedupeKey: "project-1__group-1",
          tags: ["director-trace", "continuity"],
          roles: ["researcher", "script-planner"],
          selectedAdapters: ["scripted"],
          createdAt: "2026-04-12T20:40:00.000Z",
          updatedAt: "2026-04-12T20:40:00.000Z",
          sourceRecord: {
            schemaVersion: "director.memory.record.v1",
            recordId: "record-1",
            digestId: "digest-1",
            projectId: "project-1",
            groupId: "group-1",
            anchorIds: ["anchor-a"],
            selectedAdapters: ["scripted"],
            status: "completed",
            recordedAt: "2026-04-12T20:40:00.000Z",
            digest: {
              schemaVersion: "director.memory.trace-digest.v1",
              digestId: "digest-1",
              runId: "run-1",
              reportId: "report-1",
              snapshotId: "snapshot-1",
              runtimeId: "runtime-1",
              blueprintId: "blueprint-1",
              handoffId: "handoff-1",
              actionGraphId: "graph-1",
              projectId: "project-1",
              groupId: "group-1",
              goal: "Create a continuity-safe teaser.",
              previewSummary: "Preview-safe run completed successfully.",
              status: "completed",
              roles: ["researcher", "script-planner"],
              anchorIds: ["anchor-a"],
              selectedAdapters: ["scripted"],
              observationRefs: [
                {
                  observationId: "observation-evaluation-1",
                  source: "evaluation",
                  recordedAt: "2026-04-12T20:40:00.000Z",
                },
              ],
              assignmentStats: {
                total: 2,
                completed: 2,
                failed: 0,
                aborted: 0,
                skipped: 0,
                blocked: 0,
              },
              flags: [],
              eventTypes: ["run-created", "assignment-status-changed"],
              createdAt: "2026-04-12T20:40:00.000Z",
              startedAt: "2026-04-12T20:40:00.000Z",
              completedAt: "2026-04-12T20:40:00.000Z",
              recordedAt: "2026-04-12T20:40:00.000Z",
              generationType: "new",
              generationStyle: "immersive",
              knowledgeSignalTags: ["continuity"],
            },
          },
        }),
        "utf8",
      );
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "trace-proposal", "review", "--proposal-id", "proposal-1"]);
      await startCli([
        "director",
        "trace-proposal",
        "accept",
        "--proposal-id",
        "proposal-1",
        "--note",
        "approved_for_reuse",
      ]);
      await startCli(["director", "trace-proposal", "explain", "--proposal-id", "proposal-1"]);
      await startCli(["director", "trace-proposal", "preview", "--proposal-id", "proposal-1"]);
      await startCli(["director", "trace-proposal", "replay", "--proposal-id", "proposal-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director trace proposal review:");
      expect(output).toContain("recommendation: accept");
      expect(output).toContain("Director trace proposal decision:");
      expect(output).toContain("next status: accepted");
      expect(output).toContain("latest decision: accepted");
      expect(output).toContain("latest decision note: approved_for_reuse");
      expect(output).toContain("Director trace proposal preview:");
      expect(output).toContain("Director trace proposal replay:");
      expect(output).toContain("run status: completed");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints director knowledge publish, status, list, and recall preview flows from the local knowledge lane", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-knowledge-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      mkdirSync(join(tempRoot, ".director-angel", "runtime", "proposals", "records"), {
        recursive: true,
      });
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "proposals", "index.json"),
        JSON.stringify({
          schemaVersion: "director.proposal.index.v1",
          updatedAt: "2026-04-12T22:30:00.000Z",
          entries: [
            {
              proposalId: "proposal-knowledge-1",
              kind: "director.trace_capture",
              status: "accepted",
              projectId: "project-knowledge",
              groupId: "group-knowledge",
              title: "Director method: Publishable teaser",
              riskLevel: "low",
              confidence: 0.93,
              updatedAt: "2026-04-12T22:30:00.000Z",
            },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(
          tempRoot,
          ".director-angel",
          "runtime",
          "proposals",
          "records",
          "proposal-knowledge-1.json",
        ),
        JSON.stringify({
          schemaVersion: "director.proposal.v1",
          proposalId: "proposal-knowledge-1",
          kind: "director.trace_capture",
          status: "accepted",
          provenance: "director-worker/proposal-ingest",
          recordId: "record-1",
          digestId: "digest-1",
          runId: "run-1",
          reportId: "report-1",
          projectId: "project-knowledge",
          groupId: "group-knowledge",
          title: "Director method: Publishable teaser",
          summary: "completed immersive new run",
          trigger: "When planning a publishable teaser.",
          evidenceSummary: "status=completed | roles=researcher, script-planner",
          explanation: "Completed run suggests a reusable director method.",
          confidence: 0.93,
          riskLevel: "low",
          dedupeKey: "project-knowledge__group-knowledge__publishable-teaser",
          tags: ["director-trace", "continuity"],
          roles: ["researcher", "script-planner"],
          selectedAdapters: ["scripted"],
          createdAt: "2026-04-12T22:20:00.000Z",
          updatedAt: "2026-04-12T22:30:00.000Z",
          latestDecision: {
            decidedAt: "2026-04-12T22:30:00.000Z",
            decidedStatus: "accepted",
            note: "approved_for_publish",
          },
          sourceRecord: {
            schemaVersion: "director.memory.record.v1",
            recordId: "record-1",
            digestId: "digest-1",
            projectId: "project-knowledge",
            groupId: "group-knowledge",
            anchorIds: ["anchor-a"],
            selectedAdapters: ["scripted"],
            status: "completed",
            recordedAt: "2026-04-12T22:20:00.000Z",
            digest: {
              schemaVersion: "director.memory.trace-digest.v1",
              digestId: "digest-1",
              runId: "run-1",
              reportId: "report-1",
              snapshotId: "snapshot-1",
              runtimeId: "runtime-1",
              blueprintId: "blueprint-1",
              handoffId: "handoff-1",
              actionGraphId: "graph-1",
              projectId: "project-knowledge",
              groupId: "group-knowledge",
              goal: "Create a publishable teaser.",
              previewSummary: "Preview-safe run completed successfully.",
              status: "completed",
              roles: ["researcher", "script-planner"],
              anchorIds: ["anchor-a"],
              selectedAdapters: ["scripted"],
              observationRefs: [
                {
                  observationId: "observation-evaluation-1",
                  source: "evaluation",
                  recordedAt: "2026-04-12T22:20:00.000Z",
                },
              ],
              assignmentStats: {
                total: 2,
                completed: 2,
                failed: 0,
                aborted: 0,
                skipped: 0,
                blocked: 0,
              },
              flags: [],
              eventTypes: ["run-created", "assignment-status-changed"],
              createdAt: "2026-04-12T22:20:00.000Z",
              startedAt: "2026-04-12T22:20:00.000Z",
              completedAt: "2026-04-12T22:25:00.000Z",
              recordedAt: "2026-04-12T22:25:00.000Z",
              generationType: "new",
              generationStyle: "immersive",
              knowledgeSignalTags: ["continuity"],
            },
          },
        }),
        "utf8",
      );
      writeFileSync(
        join(tempRoot, ".director-angel", "runtime", "switches.json"),
        JSON.stringify({
          schemaId: "director.switches.v1",
          features: {
            "knowledgeRecall.enabled": true,
          },
        }),
        "utf8",
      );

      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      const capture = () => stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");

      await startCli([
        "director",
        "knowledge",
        "sync",
        "--proposal-id",
        "proposal-knowledge-1",
        "--author",
        "operator-a",
        "--note",
        "sync_for_review",
      ]);
      await startCli(["director", "knowledge", "candidate-list"]);
      const candidateListOutput = capture();
      const packId = /- (.+?) status=/u.exec(candidateListOutput)?.[1];
      expect(packId).toBeTruthy();
      if (packId === undefined) {
        throw new Error("Expected knowledge candidate pack id.");
      }
      stdoutWrite.mockClear();

      await startCli([
        "director",
        "knowledge",
        "accept",
        "--pack-id",
        packId,
        "--author",
        "operator-a",
        "--note",
        "accept_for_publish",
      ]);
      await startCli([
        "director",
        "knowledge",
        "publish",
        "--pack-id",
        packId,
        "--author",
        "operator-a",
        "--note",
        "publish_for_beta5",
      ]);
      await startCli(["director", "knowledge", "status"]);
      await startCli(["director", "knowledge", "list"]);
      await startCli([
        "director",
        "knowledge",
        "recall-preview",
        "--project-id",
        "project-knowledge",
        "--group-id",
        "group-knowledge",
        "--anchor-id",
        "anchor-a",
        "--adapter-id",
        "scripted",
        "--tag",
        "continuity",
        "--include-global-experience",
      ]);

      const output = capture();
      expect(output).toContain("Director knowledge publish:");
      expect(output).toContain("Director knowledge lane:");
      expect(output).toContain("published packs: 1");
      expect(output).toContain("recall enabled: yes");
      expect(output).toContain("Director knowledge packs:");
      expect(output).toContain("stage=published");
      expect(output).toContain("Director knowledge recall preview:");
      expect(output).toContain("status: hit");
      expect(output).toContain("why recalled:");
      expect(output).toContain("proposal=proposal-knowledge-1");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints director knowledge candidate CLI diff/review/accept/publish/rollback flows", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-knowledge-candidate-cli-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      writeAcceptedProposalFixtureForCli(tempRoot, "proposal-knowledge-cli");

      const capture = () => stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");

      await startCli([
        "director",
        "knowledge",
        "sync",
        "--proposal-id",
        "proposal-knowledge-cli",
        "--author",
        "operator-cli",
        "--note",
        "sync_for_cli",
      ]);
      const syncOutput = capture();
      expect(syncOutput).toContain("Director knowledge candidate sync:");
      stdoutWrite.mockClear();

      await startCli(["director", "knowledge", "candidate-list"]);
      const candidateListOutput = capture();
      stdoutWrite.mockClear();
      const packId = "director-method-project-knowledge-cli-group-knowledge-cli-cli-diff";
      expect(candidateListOutput).toContain("Director knowledge candidates:");
      expect(candidateListOutput).toContain("total: 1");
      expect(candidateListOutput).toContain(packId);

      await startCli(["director", "knowledge", "candidate-explain", "--pack-id", packId]);
      const explainOutput = capture();
      stdoutWrite.mockClear();
      expect(explainOutput).toContain("Director knowledge candidate:");

      await startCli(["director", "knowledge", "diff", "--pack-id", packId]);
      const diffOutput = capture();
      stdoutWrite.mockClear();
      expect(diffOutput).toContain("Director knowledge candidate diff:");
      expect(diffOutput).toContain("base version:");
      expect(diffOutput).toContain("changed fields:");

      await startCli(["director", "knowledge", "review", "--pack-id", packId]);
      const reviewOutput = capture();
      stdoutWrite.mockClear();
      expect(reviewOutput).toContain("Director knowledge candidate review:");

      await startCli([
        "director",
        "knowledge",
        "accept",
        "--pack-id",
        packId,
        "--author",
        "operator-cli",
        "--note",
        "cli_accept",
      ]);
      const acceptOutput = capture();
      stdoutWrite.mockClear();
      expect(acceptOutput).toContain("Director knowledge candidate decision:");
      expect(acceptOutput).toContain("next status: accepted");

      await startCli([
        "director",
        "knowledge",
        "publish",
        "--pack-id",
        packId,
        "--author",
        "operator-cli",
        "--note",
        "cli_publish",
      ]);
      const publishOutput = capture();
      stdoutWrite.mockClear();
      expect(publishOutput).toContain("Director knowledge publish:");

      await startCli([
        "director",
        "knowledge",
        "rollback",
        "--pack-id",
        packId,
        "--version",
        "1",
        "--author",
        "operator-cli",
        "--note",
        "cli_rollback",
      ]);
      const rollbackOutput = capture();
      expect(rollbackOutput).toContain("Director knowledge rollback:");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      stdoutWrite.mockRestore();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints blueprint, run, and outcome results from Beta-1 and Beta-2 routes", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-beta1-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const snapshotPath = join(tempRoot, "snapshot.json");
    const blueprintPath = join(tempRoot, "blueprint.json");
    const outcomePath = join(tempRoot, "outcome.json");
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      writeFileSync(
        snapshotPath,
        JSON.stringify({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.snapshot.v1",
          snapshotId: "snapshot-1",
          createdAt: "2026-04-11T12:00:00.000Z",
          host: {
            hostId: "host-1",
            triggerSource: "cli",
          },
          project: {
            projectId: "project-1",
            title: "Director CLI",
            outline: "做一个预告片蓝图。",
          },
          group: {
            groupId: "group-1",
            generationType: "new",
            generationStyle: "immersive",
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
        }),
      );
      writeFileSync(
        blueprintPath,
        JSON.stringify({
          apiVersion: "director-host-api.v1",
          snapshotId: "snapshot-1",
          runtimeId: "runtime-1",
          blueprintId: "blueprint-plan-1",
          review: {
            overallDecision: "pass",
            blockingReasons: [],
            requiredFixes: [],
          },
          capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
            capabilitySnapshot: {
              snapshotId: "capability-snapshot-1",
              runtimeId: "runtime-1",
              capturedAt: "2026-04-11T12:00:00.000Z",
              status: "ready",
              adapters: [],
              notes: [],
            },
          }).capabilitySnapshot,
          actionGraph: createActionGraphFixture({
            nodes: [
              {
                nodeId: "node-a1",
                assignmentId: "a1",
                role: "researcher",
                objective: "inspect",
                inputs: ["goal"],
                outputs: ["brief"],
                deliverable: "brief",
                acceptanceCriteria: ["done"],
                constraints: [],
                dependsOn: [],
                allowedAdapters: ["binding-a"],
                actionClass: "read",
                approvalMode: "auto_allow",
                escalationToDirector: false,
                status: "ready",
                selectedAdapter: null,
              },
            ],
          }),
          preview: createOperatorPreviewFixture(),
          handoff: createHandoffEnvelopeFixture(),
        }),
      );
      writeFileSync(
        outcomePath,
        JSON.stringify({
          apiVersion: "director-host-api.v1",
          snapshotId: "snapshot-1",
          runtimeId: "runtime-1",
          handoffId: "handoff-execution-1",
          outcome: {
            status: "accepted",
          },
        }),
      );

      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            apiVersion: "director-host-api.v1",
            snapshotId: "snapshot-1",
            runtimeId: "runtime-1",
            blueprintId: "blueprint-plan-1",
            review: {
              overallDecision: "pass",
              blockingReasons: [],
              requiredFixes: [],
            },
            capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
              capabilitySnapshot: {
                snapshotId: "capability-snapshot-1",
                runtimeId: "runtime-1",
                capturedAt: "2026-04-11T12:00:00.000Z",
                status: "ready",
                adapters: [],
                notes: [],
              },
            }).capabilitySnapshot,
            actionGraph: createActionGraphFixture(),
            preview: createOperatorPreviewFixture(),
            handoff: createHandoffEnvelopeFixture(),
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createExecutionRunFixture(),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            createExecutionRunFixture({
              updatedAt: "2026-04-11T12:21:00.000Z",
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            apiVersion: "director-host-api.v1",
            snapshotId: "snapshot-1",
            blueprintId: "blueprint-plan-1",
            handoffId: "handoff-execution-1",
            stored: true,
            outcome: createOperatorOutcomeFixture(),
          }),
        } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "blueprint", "--input", "snapshot.json"]);
      await startCli(["director", "run", "create", "--input", "blueprint.json"]);
      await startCli(["director", "run", "status", "--run-id", "run-1"]);
      await startCli(["director", "outcome", "--input", "outcome.json"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(output).toContain("Director blueprint result:");
      expect(output).toContain("handoff-execution-1");
      expect(output).toContain("Director run:");
      expect(output).toContain("run id: run-1");
      expect(output).toContain("Director outcome recorded:");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints run control and report results from Beta-2 routes", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-control-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            createExecutionRunFixture({
              status: "running",
              updatedAt: "2026-04-11T12:21:00.000Z",
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            createExecutionRunFixture({
              status: "paused",
              updatedAt: "2026-04-11T12:22:00.000Z",
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            createExecutionRunFixture({
              status: "running",
              updatedAt: "2026-04-11T12:23:00.000Z",
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            createExecutionRunFixture({
              status: "running",
              updatedAt: "2026-04-11T12:24:00.000Z",
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            createExecutionRunFixture({
              status: "running",
              updatedAt: "2026-04-11T12:24:30.000Z",
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            createExecutionRunFixture({
              status: "aborted",
              completedAt: "2026-04-11T12:25:00.000Z",
              updatedAt: "2026-04-11T12:25:00.000Z",
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            schemaVersion: "director.execution.run.v1",
            reportId: "report-run-1",
            runId: "run-1",
            run: createExecutionRunFixture({
              status: "aborted",
              completedAt: "2026-04-11T12:25:00.000Z",
              updatedAt: "2026-04-11T12:25:00.000Z",
            }),
            recordedAt: "2026-04-11T12:26:00.000Z",
            summary: ["run status=aborted"],
            flags: ["preview-only"],
            events: createExecutionRunFixture().events,
          }),
        } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "start", "--run-id", "run-1"]);
      await startCli(["director", "run", "pause", "--run-id", "run-1"]);
      await startCli(["director", "run", "resume", "--run-id", "run-1"]);
      await startCli(["director", "run", "retry", "--run-id", "run-1", "--assignment-id", "a1"]);
      await startCli([
        "director",
        "run",
        "reroute",
        "--run-id",
        "run-1",
        "--assignment-id",
        "a1",
        "--adapter-id",
        "runway-preview",
      ]);
      await startCli(["director", "run", "abort", "--run-id", "run-1"]);
      await startCli(["director", "run", "report", "--run-id", "run-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(7);
      expect(output).toContain("Director run:");
      expect(output).toContain("status: aborted");
      expect(output).toContain("Director run report:");
      expect(output).toContain("report id: report-run-1");
      expect(output).toContain("director goal: goal");
      expect(output).toContain("operator summary: ready");
      expect(output).toContain("objective: inspect");
      expect(output).toContain("deliverable: brief");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("routes director run once through the worker module loader", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-once-loader-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const previousDataDir = process.env.HOTFLOW_DATA_DIR;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      process.env.HOTFLOW_DATA_DIR = join(tempRoot, ".hotflow");
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const runDirectorWorkerOnce = vi.fn().mockResolvedValue({
        run: createExecutionRunFixture({
          runId: "run-loader-1",
          blueprintId: "blueprint-loader-1",
          handoffId: "handoff-loader-1",
          status: "completed",
          assignments: [
            {
              ...createExecutionRunFixture().assignments[0],
              assignmentId: "assignment-loader-1",
              status: "completed",
            },
          ],
        }),
        report: {
          schemaVersion: "director.execution.run.v1",
          reportId: "report-loader-1",
          runId: "run-loader-1",
          run: createExecutionRunFixture({
            runId: "run-loader-1",
            blueprintId: "blueprint-loader-1",
            handoffId: "handoff-loader-1",
            status: "completed",
            assignments: [
              {
                ...createExecutionRunFixture().assignments[0],
                assignmentId: "assignment-loader-1",
                status: "completed",
              },
            ],
          }),
          recordedAt: "2026-04-18T15:00:00.000Z",
          summary: ["run status=completed"],
          flags: [],
          events: [],
        },
        executedAssignments: ["assignment-loader-1"],
      });
      setDirectorWorkerModuleLoaderForTests(async () => ({
        runDirectorWorkerOnce,
        runDirectorWorkerCli: vi.fn(),
      }));

      await startCli([
        "director",
        "run",
        "once",
        "--run-id",
        "run-loader-1",
        "--worker-id",
        "worker-loader-1",
      ]);

      expect(stdoutWrite).toHaveBeenCalled();
      expect(runDirectorWorkerOnce).toHaveBeenCalledWith(
        {
          runId: "run-loader-1",
          workerId: "worker-loader-1",
        },
        {
          env: expect.objectContaining({
            HOTFLOW_WORKSPACE_ROOT: tempRoot,
            HOTFLOW_DATA_DIR: join(tempRoot, ".hotflow"),
          }),
        },
      );
      expect(process.exitCode).toBeUndefined();
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousDataDir === undefined) {
        process.env.HOTFLOW_DATA_DIR = undefined;
      } else {
        process.env.HOTFLOW_DATA_DIR = previousDataDir;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints director run once JSON when requested", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-once-json-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const previousDataDir = process.env.HOTFLOW_DATA_DIR;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const run = createExecutionRunFixture({
        runId: "run-json-1",
        status: "completed",
        assignments: [
          {
            ...createExecutionRunFixture().assignments[0],
            assignmentId: "assignment-json-1",
            status: "completed",
          },
        ],
      });
      setDirectorWorkerModuleLoaderForTests(async () => ({
        runDirectorWorkerOnce: vi.fn().mockResolvedValue({
          run,
          report: {
            schemaVersion: "director.execution.run.v1",
            reportId: "report-json-1",
            runId: "run-json-1",
            run,
            recordedAt: "2026-04-18T15:00:00.000Z",
            summary: ["run status=completed"],
            flags: ["preview-only"],
            events: [],
          },
          executedAssignments: ["assignment-json-1"],
        }),
        runDirectorWorkerCli: vi.fn(),
      }));

      await startCli([
        "director",
        "run",
        "once",
        "--run-id",
        "run-json-1",
        "--worker-id",
        "worker-json-1",
        "--json",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      const payload = JSON.parse(output);
      expect(payload).toMatchObject({
        runId: "run-json-1",
        status: "completed",
        workerId: "worker-json-1",
        reportId: "report-json-1",
        executedAssignments: ["assignment-json-1"],
        flags: ["preview-only"],
      });
      expect(payload.assignmentCounts.completed).toBe(1);
      expect(process.exitCode).toBeUndefined();
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousDataDir === undefined) {
        process.env.HOTFLOW_DATA_DIR = undefined;
      } else {
        process.env.HOTFLOW_DATA_DIR = previousDataDir;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("rejects director run once without a run id", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-once-usage-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "once"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Missing --run-id <id>.");
      expect(output).toContain("run once --run-id <id> [--worker-id <id>]");
      expect(process.exitCode).toBe(1);
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("executes a local run once through the main director CLI", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "shell-director-run-once-e2e-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const previousDataDir = process.env.HOTFLOW_DATA_DIR;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = workspaceRoot;
      process.env.HOTFLOW_DATA_DIR = join(workspaceRoot, ".hotflow");
      const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
      const service = new ExecutionRunService({
        store: new FileSystemRunStore({
          rootPath: join(directorWorkspace.runtime, "execution"),
        }),
        builder: new ExecutionRunBuilder({
          idProvider: () => "run-shell-once-1",
          clock: () => "2026-04-14T11:00:00.000Z",
        }),
        eventIdProvider: (() => {
          let counter = 0;
          return () => `event-shell-once-${++counter}`;
        })(),
        clock: (() => {
          const timestamps = [
            "2026-04-14T11:00:01.000Z",
            "2026-04-14T11:00:02.000Z",
            "2026-04-14T11:00:03.000Z",
            "2026-04-14T11:00:04.000Z",
            "2026-04-14T11:00:05.000Z",
          ];
          return () => timestamps.shift() ?? "2026-04-14T11:00:59.000Z";
        })(),
      });
      await service.createRunFromBlueprint(createDirectorWorkerBlueprintFixture());
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli([
        "director",
        "run",
        "once",
        "--run-id",
        "run-shell-once-1",
        "--worker-id",
        "worker-shell-test",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director run once:");
      expect(output).toContain("status: PASS");
      expect(output).toContain("run status: completed");
      expect(output).toContain("executed assignments: 2");
      expect(output).toContain("assignment ids: assignment-worker-1, assignment-worker-2");
      expect(output).toContain(
        "summary: Local worker lane advanced 2 assignment(s) and the run reached completed.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run report --run-id run-shell-once-1",
      );

      const run = await service.getRun("run-shell-once-1");
      const report = await service.getReport("run-shell-once-1");
      expect(run?.status).toBe("completed");
      expect(run?.assignments.map((assignment) => assignment.status)).toEqual([
        "completed",
        "completed",
      ]);
      expect(report?.run.status).toBe("completed");
      expect(process.exitCode).toBeUndefined();
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousDataDir === undefined) {
        process.env.HOTFLOW_DATA_DIR = undefined;
      } else {
        process.env.HOTFLOW_DATA_DIR = previousDataDir;
      }
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("prints operator recovery guidance when run once ends in a blocked execution state", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "shell-director-run-once-blocked-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const previousDataDir = process.env.HOTFLOW_DATA_DIR;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = workspaceRoot;
      process.env.HOTFLOW_DATA_DIR = join(workspaceRoot, ".hotflow");
      const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
      const service = new ExecutionRunService({
        store: new FileSystemRunStore({
          rootPath: join(directorWorkspace.runtime, "execution"),
        }),
        builder: new ExecutionRunBuilder({
          idProvider: () => "run-shell-once-blocked-1",
          clock: () => "2026-04-18T15:10:00.000Z",
        }),
        eventIdProvider: (() => {
          let counter = 0;
          return () => `event-shell-once-blocked-${++counter}`;
        })(),
        clock: (() => {
          const timestamps = [
            "2026-04-18T15:10:01.000Z",
            "2026-04-18T15:10:02.000Z",
            "2026-04-18T15:10:03.000Z",
            "2026-04-18T15:10:04.000Z",
          ];
          return () => timestamps.shift() ?? "2026-04-18T15:10:59.000Z";
        })(),
      });
      await service.createRunFromBlueprint(createDirectorWorkerBlueprintFixture());
      writeDirectorSwitchDocument(workspaceRoot, {
        roleOverrides: {
          researcher: false,
        },
      });
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli([
        "director",
        "run",
        "once",
        "--run-id",
        "run-shell-once-blocked-1",
        "--worker-id",
        "worker-shell-test",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Director run once:");
      expect(output).toContain("status: FAIL");
      expect(output).toContain("run status: failed");
      expect(output).toContain("executed assignments: 0");
      expect(output).toContain(
        "route summary: Execution chain has 1 blocked route assignment(s) that stop safe progress.",
      );
      expect(output).toContain(
        "next action: inspect the blocking reason and repair the route or policy boundary before retrying.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run explain --run-id run-shell-once-blocked-1",
      );

      const run = await service.getRun("run-shell-once-blocked-1");
      const report = await service.getReport("run-shell-once-blocked-1");
      expect(run?.status).toBe("failed");
      expect(report?.run.status).toBe("failed");
      expect(process.exitCode).toBeUndefined();
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousDataDir === undefined) {
        process.env.HOTFLOW_DATA_DIR = undefined;
      } else {
        process.env.HOTFLOW_DATA_DIR = previousDataDir;
      }
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("explains when run once leaves ready work behind a created-state control boundary", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-once-created-ready-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const previousDataDir = process.env.HOTFLOW_DATA_DIR;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const run = createExecutionRunFixture({
        runId: "run-created-ready-1",
        status: "created",
        assignments: [
          {
            ...createExecutionRunFixture().assignments[0],
            assignmentId: "assignment-created-ready-1",
            status: "ready",
            selectedAdapter: "mock-execution",
          },
        ],
      });
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      setDirectorWorkerModuleLoaderForTests(async () => ({
        runDirectorWorkerOnce: vi.fn().mockResolvedValue({
          run,
          report: {
            schemaVersion: "director.execution.run.v1",
            reportId: "report-created-ready-1",
            runId: "run-created-ready-1",
            run,
            recordedAt: "2026-04-19T02:00:00.000Z",
            summary: ["run status=created"],
            flags: ["preview-only"],
            events: run.events,
          },
          executedAssignments: [],
        }),
        runDirectorWorkerCli: vi.fn(),
      }));

      await startCli([
        "director",
        "run",
        "once",
        "--run-id",
        "run-created-ready-1",
        "--worker-id",
        "worker-shell-test",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("status: WARN");
      expect(output).toContain("run status: created");
      expect(output).toContain(
        "summary: Local worker lane did not dispatch 1 ready assignment(s) because an execution control boundary kept the run in created.",
      );
      expect(output).toContain(
        "next action: inspect the execution switch or pause policy, then ask the local worker lane to try again after the boundary is lifted.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run explain --run-id run-created-ready-1 | hotflow director run report --run-id run-created-ready-1",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousDataDir === undefined) {
        process.env.HOTFLOW_DATA_DIR = undefined;
      } else {
        process.env.HOTFLOW_DATA_DIR = previousDataDir;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("explains when run once leaves a created run waiting on dependencies or approval", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-once-created-pending-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const previousDataDir = process.env.HOTFLOW_DATA_DIR;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const run = createExecutionRunFixture({
        runId: "run-created-pending-1",
        status: "created",
        assignments: [
          {
            ...createExecutionRunFixture().assignments[0],
            assignmentId: "assignment-created-pending-1",
            status: "pending",
            selectedAdapter: "mock-execution",
          },
        ],
      });
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      setDirectorWorkerModuleLoaderForTests(async () => ({
        runDirectorWorkerOnce: vi.fn().mockResolvedValue({
          run,
          report: {
            schemaVersion: "director.execution.run.v1",
            reportId: "report-created-pending-1",
            runId: "run-created-pending-1",
            run,
            recordedAt: "2026-04-19T02:05:00.000Z",
            summary: ["run status=created"],
            flags: ["awaiting-approval-or-dependencies"],
            events: run.events,
          },
          executedAssignments: [],
        }),
        runDirectorWorkerCli: vi.fn(),
      }));

      await startCli([
        "director",
        "run",
        "once",
        "--run-id",
        "run-created-pending-1",
        "--worker-id",
        "worker-shell-test",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("status: WARN");
      expect(output).toContain("run status: created");
      expect(output).toContain(
        "summary: Local worker lane did not dispatch work because the run is still waiting on dependencies or approval before any assignment becomes ready.",
      );
      expect(output).toContain(
        "next action: inspect the dependency boundary before asking the local worker lane to try again.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run explain --run-id run-created-pending-1 | hotflow director run report --run-id run-created-pending-1",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousDataDir === undefined) {
        process.env.HOTFLOW_DATA_DIR = undefined;
      } else {
        process.env.HOTFLOW_DATA_DIR = previousDataDir;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("explains when run once pauses after partial progress with ready work still remaining", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-once-paused-ready-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const previousDataDir = process.env.HOTFLOW_DATA_DIR;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const baseAssignment = createExecutionRunFixture().assignments[0];
      const run = createExecutionRunFixture({
        runId: "run-paused-ready-1",
        status: "paused",
        assignments: [
          {
            ...baseAssignment,
            assignmentId: "assignment-paused-completed-1",
            status: "completed",
            selectedAdapter: "mock-execution",
          },
          {
            ...baseAssignment,
            assignmentId: "assignment-paused-ready-1",
            status: "ready",
            selectedAdapter: "mock-execution",
          },
        ],
      });
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      setDirectorWorkerModuleLoaderForTests(async () => ({
        runDirectorWorkerOnce: vi.fn().mockResolvedValue({
          run,
          report: {
            schemaVersion: "director.execution.run.v1",
            reportId: "report-paused-ready-1",
            runId: "run-paused-ready-1",
            run,
            recordedAt: "2026-04-19T02:10:00.000Z",
            summary: ["run status=paused"],
            flags: ["run-paused"],
            events: run.events,
          },
          executedAssignments: ["assignment-paused-completed-1"],
        }),
        runDirectorWorkerCli: vi.fn(),
      }));

      await startCli([
        "director",
        "run",
        "once",
        "--run-id",
        "run-paused-ready-1",
        "--worker-id",
        "worker-shell-test",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("status: WARN");
      expect(output).toContain("run status: paused");
      expect(output).toContain(
        "summary: Local worker lane advanced 1 assignment(s), but the run paused with 1 ready assignment(s) still waiting to be claimed.",
      );
      expect(output).toContain(
        "next action: resume the paused run when safe, then ask the local worker lane for another bounded pass.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run resume --run-id run-paused-ready-1 | hotflow director run once --run-id run-paused-ready-1",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousDataDir === undefined) {
        process.env.HOTFLOW_DATA_DIR = undefined;
      } else {
        process.env.HOTFLOW_DATA_DIR = previousDataDir;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("explains when run once pauses after partial progress and downstream work is still waiting", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-once-paused-pending-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const previousDataDir = process.env.HOTFLOW_DATA_DIR;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      const baseAssignment = createExecutionRunFixture().assignments[0];
      const run = createExecutionRunFixture({
        runId: "run-paused-pending-1",
        status: "paused",
        assignments: [
          {
            ...baseAssignment,
            assignmentId: "assignment-paused-completed-2",
            status: "completed",
            selectedAdapter: "mock-execution",
          },
          {
            ...baseAssignment,
            assignmentId: "assignment-paused-pending-1",
            status: "pending",
            selectedAdapter: "mock-execution",
            dependsOn: ["assignment-paused-completed-2"],
          },
        ],
      });
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      setDirectorWorkerModuleLoaderForTests(async () => ({
        runDirectorWorkerOnce: vi.fn().mockResolvedValue({
          run,
          report: {
            schemaVersion: "director.execution.run.v1",
            reportId: "report-paused-pending-1",
            runId: "run-paused-pending-1",
            run,
            recordedAt: "2026-04-19T02:15:00.000Z",
            summary: ["run status=paused"],
            flags: ["run-paused", "awaiting-approval-or-dependencies"],
            events: run.events,
          },
          executedAssignments: ["assignment-paused-completed-2"],
        }),
        runDirectorWorkerCli: vi.fn(),
      }));

      await startCli([
        "director",
        "run",
        "once",
        "--run-id",
        "run-paused-pending-1",
        "--worker-id",
        "worker-shell-test",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("status: WARN");
      expect(output).toContain("run status: paused");
      expect(output).toContain(
        "summary: Local worker lane advanced 1 assignment(s), and the remaining work is now waiting on dependencies or approval before another dispatch.",
      );
      expect(output).toContain(
        "next action: inspect the updated run report and wait for the dependency boundary to clear before another worker pass.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run report --run-id run-paused-pending-1 | hotflow director run explain --run-id run-paused-pending-1",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      if (previousDataDir === undefined) {
        process.env.HOTFLOW_DATA_DIR = undefined;
      } else {
        process.env.HOTFLOW_DATA_DIR = previousDataDir;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints created-state holding guidance in director run report", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-report-created-ready-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-created-ready-surface-1",
          runId: "run-created-ready-surface-1",
          run: createExecutionRunFixture({
            runId: "run-created-ready-surface-1",
            status: "created",
            assignments: [
              {
                ...createExecutionRunFixture().assignments[0],
                assignmentId: "assignment-created-ready-surface-1",
                status: "ready",
                selectedAdapter: "mock-execution",
              },
            ],
          }),
          recordedAt: "2026-04-19T04:00:00.000Z",
          summary: ["run status=created"],
          flags: [],
          events: createExecutionRunFixture().events,
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "report", "--run-id", "run-created-ready-surface-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain(
        "holding state: Run is created and ready work is being held behind an execution control boundary.",
      );
      expect(output).toContain(
        "next action: inspect the execution switch or pause policy, then ask the local worker lane to try again after the boundary is lifted.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run explain --run-id run-created-ready-surface-1 | hotflow director run report --run-id run-created-ready-surface-1",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints paused-state resume guidance in director run report", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-report-paused-ready-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const baseAssignment = createExecutionRunFixture().assignments[0];
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-paused-ready-surface-1",
          runId: "run-paused-ready-surface-1",
          run: createExecutionRunFixture({
            runId: "run-paused-ready-surface-1",
            status: "paused",
            assignments: [
              {
                ...baseAssignment,
                assignmentId: "assignment-paused-ready-surface-completed-1",
                status: "completed",
                selectedAdapter: "mock-execution",
              },
              {
                ...baseAssignment,
                assignmentId: "assignment-paused-ready-surface-1",
                status: "ready",
                selectedAdapter: "mock-execution",
              },
            ],
          }),
          recordedAt: "2026-04-19T04:05:00.000Z",
          summary: ["run status=paused"],
          flags: ["run-paused"],
          events: createExecutionRunFixture().events,
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "report", "--run-id", "run-paused-ready-surface-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain(
        "holding state: Run is paused with ready work still waiting for operator control.",
      );
      expect(output).toContain(
        "next action: resume the paused run when safe, then ask the local worker lane for another bounded pass.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run resume --run-id run-paused-ready-surface-1 | hotflow director run once --run-id run-paused-ready-surface-1",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints approval-wait holding guidance in director run explain", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-explain-created-pending-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-created-pending-surface-1",
          runId: "run-created-pending-surface-1",
          run: createExecutionRunFixture({
            runId: "run-created-pending-surface-1",
            status: "created",
            assignments: [
              {
                ...createExecutionRunFixture().assignments[0],
                assignmentId: "assignment-created-pending-surface-1",
                status: "pending",
                approvalMode: "operator_approve",
                selectedAdapter: "mock-execution",
              },
            ],
          }),
          recordedAt: "2026-04-19T04:10:00.000Z",
          summary: ["run status=created"],
          flags: ["awaiting-approval-or-dependencies"],
          events: createExecutionRunFixture().events,
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "explain", "--run-id", "run-created-pending-surface-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain(
        "operator verdict: Run is created and still waiting on approval before any assignment becomes ready.",
      );
      expect(output).toContain(
        "holding summary: Run is still created because 1 assignment(s) are waiting on operator approval before the next dispatch can begin.",
      );
      expect(output).toContain(
        "next action: review the approval-gated assignments before asking the local worker lane to try again.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run explain --run-id run-created-pending-surface-1 | hotflow director run report --run-id run-created-pending-surface-1",
      );
      expect(output).toContain("approval holds: 1");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints dependency-wait holding guidance in director run explain", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-explain-paused-pending-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const baseAssignment = createExecutionRunFixture().assignments[0];
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-paused-pending-surface-1",
          runId: "run-paused-pending-surface-1",
          run: createExecutionRunFixture({
            runId: "run-paused-pending-surface-1",
            status: "paused",
            assignments: [
              {
                ...baseAssignment,
                assignmentId: "assignment-paused-pending-surface-completed-1",
                status: "completed",
                selectedAdapter: "mock-execution",
              },
              {
                ...baseAssignment,
                assignmentId: "assignment-paused-pending-surface-1",
                status: "pending",
                approvalMode: "auto_allow",
                selectedAdapter: "mock-execution",
                dependsOn: ["assignment-paused-pending-surface-completed-1", "assignment-missing"],
              },
            ],
          }),
          recordedAt: "2026-04-19T04:15:00.000Z",
          summary: ["run status=paused"],
          flags: ["run-paused", "awaiting-approval-or-dependencies"],
          events: createExecutionRunFixture().events,
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "explain", "--run-id", "run-paused-pending-surface-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain(
        "operator verdict: Run is paused and the remaining work is waiting on dependencies.",
      );
      expect(output).toContain(
        "holding summary: Run is paused, and the remaining work is waiting on dependencies before another dispatch can begin.",
      );
      expect(output).toContain(
        "next action: inspect the updated run report and wait for the dependency boundary to clear before another worker pass.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run report --run-id run-paused-pending-surface-1 | hotflow director run explain --run-id run-paused-pending-surface-1",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints operator-readable success details for a real bridge run report", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-report-bridge-success-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-bridge-1",
          runId: "run-bridge-1",
          run: createExecutionRunFixture({
            runId: "run-bridge-1",
            status: "completed",
            goal: "Generate a single-shot lighthouse reveal video.",
            previewSummary: "Single-shot video brief is ready for remote submission.",
            assignments: [
              {
                runId: "run-bridge-1",
                assignmentId: "assignment-bridge-1",
                role: "asset-router",
                objective: "Submit a media generation request",
                deliverable: "send a bounded adapter request",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "completed",
                selectedAdapter: "seedance-preview",
                allowedAdapters: ["seedance-preview"],
                createdAt: "2026-04-13T07:58:34.984Z",
                startedAt: "2026-04-13T07:58:35.836Z",
                completedAt: "2026-04-13T07:58:35.838Z",
                notes: ["external-bridge", "bridge:http-json"],
                result: {
                  runId: "run-bridge-1",
                  assignmentId: "assignment-bridge-1",
                  status: "completed",
                  recordedAt: "2026-04-13T07:58:35.838Z",
                  workerId: "worker-bridge-1",
                  summary: "Bridge executed asset-router assignment via seedance-preview.",
                  adapterId: "seedance-preview",
                  bridgeExecution: {
                    kind: "http-json",
                    request: {
                      endpointOrigin: "http://127.0.0.1:59944",
                      endpointPath: "/v1/jobs",
                      method: "POST",
                      timeoutMs: 500,
                      authMode: "env",
                      headerKeys: ["x-bridge-id"],
                      payloadBytes: 414,
                    },
                    response: {
                      statusCode: 202,
                      accepted: true,
                      requestId: "req-beta8-1",
                      bodyBytes: 17,
                    },
                  },
                  notes: ["external-bridge", "bridge:http-json"],
                },
              },
            ],
          }),
          recordedAt: "2026-04-13T07:58:36.000Z",
          summary: ["run status=completed", "bridge attempts=1 succeeded=1 failed=0"],
          flags: ["external-bridge-attempted", "external-bridge-succeeded"],
          operatorSurface: {
            directorGoal: "Generate a single-shot lighthouse reveal video.",
            operatorSummary: "Single-shot video brief is ready for remote submission.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "accepted",
            requestAccepted: true,
            bridgeStatus: 202,
            requestId: "req-beta8-1",
            nextAction:
              "track the remote request by request id and wait for the downstream result.",
            bridgeAttempts: {
              attempts: 1,
              successes: 1,
              failures: 0,
            },
          },
          bridgeMetrics: {
            attempts: 1,
            successes: 1,
            failures: 0,
            failedAssignments: [],
          },
          events: createExecutionRunFixture().events,
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "report", "--run-id", "run-bridge-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain("director goal: Generate a single-shot lighthouse reveal video.");
      expect(output).toContain(
        "operator summary: Single-shot video brief is ready for remote submission.",
      );
      expect(output).toContain("objective: Submit a media generation request");
      expect(output).toContain("deliverable: send a bounded adapter request");
      expect(output).toContain("adapter route: seedance-preview");
      expect(output).toContain("bridge verdict: accepted");
      expect(output).toContain("request accepted: yes");
      expect(output).toContain("request id: req-beta8-1");
      expect(output).toContain("next action: track the remote request by request id");
      expect(output).toContain("bridge attempts: 1 (successes: 1, failures: 0)");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints operator-facing success diagnosis for a real bridge run", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-explain-bridge-success-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-bridge-explain-1",
          runId: "run-bridge-explain-1",
          run: createExecutionRunFixture({
            runId: "run-bridge-explain-1",
            status: "completed",
            goal: "Generate a single-shot lighthouse reveal video.",
            previewSummary: "Single-shot video brief is ready for remote submission.",
            assignments: [
              {
                runId: "run-bridge-explain-1",
                assignmentId: "assignment-bridge-1",
                role: "asset-router",
                objective: "Submit a media generation request",
                deliverable: "send a bounded adapter request",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "completed",
                selectedAdapter: "seedance-preview",
                allowedAdapters: ["seedance-preview"],
                createdAt: "2026-04-13T07:58:34.984Z",
                startedAt: "2026-04-13T07:58:35.836Z",
                completedAt: "2026-04-13T07:58:35.838Z",
                notes: ["external-bridge", "bridge:http-json"],
                result: {
                  runId: "run-bridge-explain-1",
                  assignmentId: "assignment-bridge-1",
                  status: "completed",
                  recordedAt: "2026-04-13T07:58:35.838Z",
                  workerId: "worker-bridge-1",
                  summary: "Bridge executed asset-router assignment via seedance-preview.",
                  adapterId: "seedance-preview",
                  bridgeExecution: {
                    kind: "http-json",
                    request: {
                      endpointOrigin: "http://127.0.0.1:59944",
                      endpointPath: "/v1/jobs",
                      method: "POST",
                      timeoutMs: 500,
                      authMode: "env",
                      headerKeys: ["x-bridge-id"],
                      payloadBytes: 414,
                    },
                    response: {
                      statusCode: 202,
                      accepted: true,
                      requestId: "req-beta9-explain-success",
                      bodyBytes: 17,
                    },
                  },
                  notes: ["external-bridge", "bridge:http-json"],
                },
              },
            ],
            events: [
              ...createExecutionRunFixture().events,
              {
                eventId: "event-2",
                runId: "run-bridge-explain-1",
                type: "assignment-status-changed",
                occurredAt: "2026-04-13T07:58:35.838Z",
                message: "Assignment assignment-bridge-1 finished with status completed.",
              },
            ],
          }),
          recordedAt: "2026-04-13T07:58:36.000Z",
          summary: ["run status=completed", "bridge attempts=1 succeeded=1 failed=0"],
          flags: ["external-bridge-attempted", "external-bridge-succeeded"],
          operatorSurface: {
            directorGoal: "Generate a single-shot lighthouse reveal video.",
            operatorSummary: "Single-shot video brief is ready for remote submission.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "accepted",
            requestAccepted: true,
            bridgeStatus: 202,
            requestId: "req-beta9-explain-success",
            nextAction:
              "track the remote request by request id and wait for the downstream result.",
          },
          events: [
            ...createExecutionRunFixture().events,
            {
              eventId: "event-2",
              runId: "run-bridge-explain-1",
              type: "assignment-status-changed",
              occurredAt: "2026-04-13T07:58:35.838Z",
              message: "Assignment assignment-bridge-1 finished with status completed.",
            },
          ],
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "explain", "--run-id", "run-bridge-explain-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain("Director run explain:");
      expect(output).toContain(
        "operator verdict: Remote request was accepted; local execution is complete and downstream follow-up remains.",
      );
      expect(output).toContain("request id: req-beta9-explain-success");
      expect(output).toContain("retry candidates: 0");
      expect(output).toContain("approval holds: 0");
      expect(output).toContain("recent events:");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints operator-readable failure details for a real bridge run report", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-report-bridge-failure-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-bridge-failure-1",
          runId: "run-bridge-failure-1",
          run: createExecutionRunFixture({
            runId: "run-bridge-failure-1",
            status: "failed",
            goal: "Generate a single-shot storm corridor video.",
            previewSummary:
              "Single-shot video brief reached the remote bridge but needs operator follow-up.",
            assignments: [
              {
                runId: "run-bridge-failure-1",
                assignmentId: "assignment-bridge-1",
                role: "asset-router",
                objective: "Submit a media generation request",
                deliverable: "send a bounded adapter request",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "failed",
                selectedAdapter: "seedance-preview",
                allowedAdapters: ["seedance-preview", "runway-preview"],
                createdAt: "2026-04-13T08:05:34.984Z",
                startedAt: "2026-04-13T08:05:35.836Z",
                completedAt: "2026-04-13T08:05:35.838Z",
                notes: ["external-bridge", "bridge:http-json"],
                result: {
                  runId: "run-bridge-failure-1",
                  assignmentId: "assignment-bridge-1",
                  status: "failed",
                  recordedAt: "2026-04-13T08:05:35.838Z",
                  workerId: "worker-bridge-1",
                  summary: "Bridge failed for asset-router assignment via seedance-preview.",
                  adapterId: "seedance-preview",
                  bridgeExecution: {
                    kind: "http-json",
                    request: {
                      endpointOrigin: "http://127.0.0.1:59944",
                      endpointPath: "/v1/jobs",
                      method: "POST",
                      timeoutMs: 500,
                      authMode: "env",
                      headerKeys: ["x-bridge-id"],
                      payloadBytes: 414,
                    },
                    failure: {
                      reason: "network_timeout",
                      message: "request timed out",
                      retryable: true,
                      statusCode: 504,
                    },
                  },
                  notes: ["external-bridge", "bridge:http-json"],
                },
              },
            ],
          }),
          recordedAt: "2026-04-13T08:05:36.000Z",
          summary: ["run status=failed", "bridge attempts=1 succeeded=0 failed=1"],
          flags: ["has-failures", "external-bridge-attempted", "external-bridge-failed"],
          operatorSurface: {
            directorGoal: "Generate a single-shot storm corridor video.",
            operatorSummary:
              "Single-shot video brief reached the remote bridge but needs operator follow-up.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "failed",
            bridgeFailureReason: "network_timeout",
            retryable: true,
            retryAllowed: true,
            bridgeStatus: 504,
            nextAction: "review the failure and retry when the side-effect boundary is safe.",
            bridgeAttempts: {
              attempts: 1,
              successes: 0,
              failures: 1,
            },
          },
          bridgeMetrics: {
            attempts: 1,
            successes: 0,
            failures: 1,
            failedAssignments: [
              {
                assignmentId: "assignment-bridge-1",
                reason: "network_timeout",
                retryable: true,
                statusCode: 504,
              },
            ],
          },
          events: createExecutionRunFixture().events,
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "report", "--run-id", "run-bridge-failure-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain("director goal: Generate a single-shot storm corridor video.");
      expect(output).toContain(
        "operator summary: Single-shot video brief reached the remote bridge but needs operator follow-up.",
      );
      expect(output).toContain("adapter route: seedance-preview");
      expect(output).toContain("bridge verdict: failed (network_timeout)");
      expect(output).toContain("retryable: yes");
      expect(output).toContain("retry allowed: yes");
      expect(output).toContain("bridge status: 504");
      expect(output).toContain(
        "next action: review the failure and retry when the side-effect boundary is safe.",
      );
      expect(output).toContain("bridge attempts: 1 (successes: 0, failures: 1)");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints chain route health snapshot for a multi-assignment execution run", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-explain-route-health-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-route-health-explain-1",
          runId: "run-route-health-explain-1",
          run: createExecutionRunFixture({
            runId: "run-route-health-explain-1",
            status: "running",
            goal: "Generate a lighthouse reveal sequence.",
            previewSummary:
              "Script is accepted and the shot list is rerouted for the next attempt.",
            assignments: [
              {
                runId: "run-route-health-explain-1",
                assignmentId: "assignment-script-1",
                role: "script-planner",
                objective: "Draft the script outline",
                deliverable: "draft script outline",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "completed",
                selectedAdapter: "script-execution-a",
                allowedAdapters: ["script-execution-a"],
                createdAt: "2026-04-14T08:45:00.000Z",
                completedAt: "2026-04-14T08:47:00.000Z",
                notes: ["external-bridge", "bridge:http-json"],
                result: {
                  runId: "run-route-health-explain-1",
                  assignmentId: "assignment-script-1",
                  status: "completed",
                  recordedAt: "2026-04-14T08:47:00.000Z",
                  workerId: "worker-script-1",
                  summary: "Script bridge request accepted.",
                  adapterId: "script-execution-a",
                  bridgeExecution: {
                    kind: "http-json",
                    request: {
                      endpointOrigin: "https://bridge.example.test",
                      endpointPath: "/v1/jobs",
                      method: "POST",
                      timeoutMs: 1_000,
                      authMode: "env",
                      headerKeys: ["authorization"],
                      payloadBytes: 256,
                    },
                    response: {
                      statusCode: 202,
                      accepted: true,
                      requestId: "req-script-1",
                      bodyBytes: 32,
                    },
                  },
                },
              },
              {
                runId: "run-route-health-explain-1",
                assignmentId: "assignment-shot-1",
                role: "shot-planner",
                objective: "Draft the shot list",
                deliverable: "draft shot list",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: ["assignment-script-1"],
                status: "ready",
                selectedAdapter: "runway-preview",
                allowedAdapters: ["seedance-preview", "runway-preview"],
                createdAt: "2026-04-14T08:45:00.000Z",
                notes: [
                  "external-bridge",
                  "bridge:http-json",
                  "Retry requested at 2026-04-14T08:48:00.000Z.",
                  "Adapter rerouted from seedance-preview to runway-preview at 2026-04-14T08:49:00.000Z.",
                ],
              },
            ],
            events: [
              ...createExecutionRunFixture().events,
              {
                eventId: "event-2",
                runId: "run-route-health-explain-1",
                type: "assignment-status-changed",
                occurredAt: "2026-04-14T08:47:00.000Z",
                message: "Assignment assignment-script-1 finished with status completed.",
              },
              {
                eventId: "event-3",
                runId: "run-route-health-explain-1",
                type: "log",
                occurredAt: "2026-04-14T08:49:00.000Z",
                message:
                  "Assignment assignment-shot-1 rerouted from seedance-preview to runway-preview.",
              },
            ],
          }),
          recordedAt: "2026-04-14T08:50:00.000Z",
          summary: ["run status=running", "bridge attempts=1 succeeded=1 failed=0"],
          flags: ["run-in-progress", "external-bridge-attempted", "external-bridge-succeeded"],
          operatorSurface: {
            directorGoal: "Generate a lighthouse reveal sequence.",
            operatorSummary:
              "Script is accepted and the shot list is rerouted for the next attempt.",
            nextAction: "wait for the rerouted shot-planner assignment to be claimed.",
          },
          events: [
            ...createExecutionRunFixture().events,
            {
              eventId: "event-2",
              runId: "run-route-health-explain-1",
              type: "assignment-status-changed",
              occurredAt: "2026-04-14T08:47:00.000Z",
              message: "Assignment assignment-script-1 finished with status completed.",
            },
            {
              eventId: "event-3",
              runId: "run-route-health-explain-1",
              type: "log",
              occurredAt: "2026-04-14T08:49:00.000Z",
              message:
                "Assignment assignment-shot-1 rerouted from seedance-preview to runway-preview.",
            },
          ],
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "explain", "--run-id", "run-route-health-explain-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain("route health snapshot: 2");
      expect(output).toContain(
        "- assignment-script-1 role=script-planner status=completed route=script-execution-a bridge=accepted status=202",
      );
      expect(output).toContain(
        "- assignment-shot-1 role=shot-planner status=ready route=runway-preview last-bridge=seedance-preview",
      );
      expect(output).toContain("recent events:");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints operator-facing retry guidance for a failed bridge run", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-explain-bridge-failure-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-bridge-explain-failure-1",
          runId: "run-bridge-explain-failure-1",
          run: createExecutionRunFixture({
            runId: "run-bridge-explain-failure-1",
            status: "failed",
            goal: "Generate a single-shot storm corridor video.",
            previewSummary:
              "Single-shot video brief reached the remote bridge but needs operator follow-up.",
            assignments: [
              {
                runId: "run-bridge-explain-failure-1",
                assignmentId: "assignment-bridge-1",
                role: "asset-router",
                objective: "Submit a media generation request",
                deliverable: "send a bounded adapter request",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "failed",
                selectedAdapter: "seedance-preview",
                allowedAdapters: ["seedance-preview", "runway-preview"],
                createdAt: "2026-04-13T08:05:34.984Z",
                startedAt: "2026-04-13T08:05:35.836Z",
                completedAt: "2026-04-13T08:05:35.838Z",
                notes: ["external-bridge", "bridge:http-json"],
                result: {
                  runId: "run-bridge-explain-failure-1",
                  assignmentId: "assignment-bridge-1",
                  status: "failed",
                  recordedAt: "2026-04-13T08:05:35.838Z",
                  workerId: "worker-bridge-1",
                  summary: "Bridge failed for asset-router assignment via seedance-preview.",
                  adapterId: "seedance-preview",
                  bridgeExecution: {
                    kind: "http-json",
                    request: {
                      endpointOrigin: "http://127.0.0.1:59944",
                      endpointPath: "/v1/jobs",
                      method: "POST",
                      timeoutMs: 500,
                      authMode: "env",
                      headerKeys: ["x-bridge-id"],
                      payloadBytes: 414,
                    },
                    failure: {
                      reason: "network_timeout",
                      message: "request timed out",
                      retryable: true,
                      statusCode: 504,
                    },
                  },
                  notes: ["external-bridge", "bridge:http-json"],
                },
              },
            ],
            events: [
              ...createExecutionRunFixture().events,
              {
                eventId: "event-2",
                runId: "run-bridge-explain-failure-1",
                type: "assignment-status-changed",
                occurredAt: "2026-04-13T08:05:35.838Z",
                message: "Assignment assignment-bridge-1 finished with status failed.",
              },
            ],
          }),
          recordedAt: "2026-04-13T08:05:36.000Z",
          summary: ["run status=failed", "bridge attempts=1 succeeded=0 failed=1"],
          flags: ["has-failures", "external-bridge-attempted", "external-bridge-failed"],
          operatorSurface: {
            directorGoal: "Generate a single-shot storm corridor video.",
            operatorSummary:
              "Single-shot video brief reached the remote bridge but needs operator follow-up.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "failed",
            bridgeFailureReason: "network_timeout",
            retryable: true,
            bridgeStatus: 504,
            nextAction: "review the failure and retry when the side-effect boundary is safe.",
          },
          events: [
            ...createExecutionRunFixture().events,
            {
              eventId: "event-2",
              runId: "run-bridge-explain-failure-1",
              type: "assignment-status-changed",
              occurredAt: "2026-04-13T08:05:35.838Z",
              message: "Assignment assignment-bridge-1 finished with status failed.",
            },
          ],
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "explain", "--run-id", "run-bridge-explain-failure-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain(
        "operator verdict: Run failed, but at least one assignment has a safe retry path.",
      );
      expect(output).toContain("bridge verdict: failed (network_timeout)");
      expect(output).toContain("retry candidates: 1");
      expect(output).toContain(
        "suggested command: hotflow director run retry --run-id run-bridge-explain-failure-1 --assignment-id assignment-bridge-1",
      );
      expect(output).toContain(
        "next action: review the failure and retry when the side-effect boundary is safe.",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints non-retryable bridge guidance for a failed run report", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-report-bridge-nonretryable-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-bridge-http-422-1",
          runId: "run-bridge-http-422-1",
          run: createExecutionRunFixture({
            runId: "run-bridge-http-422-1",
            status: "failed",
            goal: "Generate a single-shot storm corridor video.",
            previewSummary:
              "Single-shot video brief reached the remote bridge but needs operator repair.",
            assignments: [
              {
                runId: "run-bridge-http-422-1",
                assignmentId: "assignment-bridge-1",
                role: "asset-router",
                objective: "Submit a media generation request",
                deliverable: "send a bounded adapter request",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "failed",
                selectedAdapter: "seedance-preview",
                allowedAdapters: ["seedance-preview", "runway-preview"],
                createdAt: "2026-04-13T08:05:34.984Z",
                startedAt: "2026-04-13T08:05:35.836Z",
                completedAt: "2026-04-13T08:05:35.838Z",
                notes: ["external-bridge", "bridge:http-json"],
                result: {
                  runId: "run-bridge-http-422-1",
                  assignmentId: "assignment-bridge-1",
                  status: "failed",
                  recordedAt: "2026-04-13T08:05:35.838Z",
                  workerId: "worker-bridge-1",
                  summary: "Bridge rejected the payload for asset-router assignment.",
                  adapterId: "seedance-preview",
                  bridgeExecution: {
                    kind: "http-json",
                    request: {
                      endpointOrigin: "http://127.0.0.1:59944",
                      endpointPath: "/v1/jobs",
                      method: "POST",
                      timeoutMs: 500,
                      authMode: "env",
                      headerKeys: ["x-bridge-id"],
                      payloadBytes: 414,
                    },
                    response: {
                      statusCode: 422,
                      accepted: false,
                      requestId: "req-http-422",
                      bodyBytes: 128,
                    },
                    failure: {
                      reason: "http_error",
                      message: "Bridge request returned HTTP 422.",
                      retryable: false,
                      statusCode: 422,
                    },
                  },
                  notes: ["external-bridge", "bridge:http-json"],
                },
              },
            ],
          }),
          recordedAt: "2026-04-13T08:05:36.000Z",
          summary: ["run status=failed", "bridge attempts=1 succeeded=0 failed=1"],
          flags: ["has-failures", "external-bridge-attempted", "external-bridge-failed"],
          operatorSurface: {
            directorGoal: "Generate a single-shot storm corridor video.",
            operatorSummary:
              "Single-shot video brief reached the remote bridge but needs operator repair.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "failed",
            bridgeFailureReason: "http_error",
            retryable: false,
            retryAllowed: false,
            bridgeStatus: 422,
            nextAction:
              "inspect the remote bridge request and payload before re-running the assignment.",
            bridgeAttempts: {
              attempts: 1,
              successes: 0,
              failures: 1,
            },
          },
          bridgeMetrics: {
            attempts: 1,
            successes: 0,
            failures: 1,
            failedAssignments: [
              {
                assignmentId: "assignment-bridge-1",
                reason: "http_error",
                retryable: false,
                statusCode: 422,
              },
            ],
          },
          events: createExecutionRunFixture().events,
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "report", "--run-id", "run-bridge-http-422-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain("bridge verdict: failed (http_error)");
      expect(output).toContain("retryable: no");
      expect(output).toContain("retry allowed: no");
      expect(output).toContain("bridge status: 422");
      expect(output).toContain(
        "next action: inspect the remote bridge request and payload before re-running the assignment.",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints non-retryable bridge guidance without suggesting retry commands", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-explain-bridge-nonretryable-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-bridge-explain-http-422-1",
          runId: "run-bridge-explain-http-422-1",
          run: createExecutionRunFixture({
            runId: "run-bridge-explain-http-422-1",
            status: "failed",
            goal: "Generate a single-shot storm corridor video.",
            previewSummary:
              "Single-shot video brief reached the remote bridge but needs operator repair.",
            assignments: [
              {
                runId: "run-bridge-explain-http-422-1",
                assignmentId: "assignment-bridge-1",
                role: "asset-router",
                objective: "Submit a media generation request",
                deliverable: "send a bounded adapter request",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "failed",
                selectedAdapter: "seedance-preview",
                allowedAdapters: ["seedance-preview"],
                createdAt: "2026-04-13T08:05:34.984Z",
                startedAt: "2026-04-13T08:05:35.836Z",
                completedAt: "2026-04-13T08:05:35.838Z",
                notes: ["external-bridge", "bridge:http-json"],
                result: {
                  runId: "run-bridge-explain-http-422-1",
                  assignmentId: "assignment-bridge-1",
                  status: "failed",
                  recordedAt: "2026-04-13T08:05:35.838Z",
                  workerId: "worker-bridge-1",
                  summary: "Bridge rejected the payload for asset-router assignment.",
                  adapterId: "seedance-preview",
                  bridgeExecution: {
                    kind: "http-json",
                    request: {
                      endpointOrigin: "http://127.0.0.1:59944",
                      endpointPath: "/v1/jobs",
                      method: "POST",
                      timeoutMs: 500,
                      authMode: "env",
                      headerKeys: ["x-bridge-id"],
                      payloadBytes: 414,
                    },
                    response: {
                      statusCode: 422,
                      accepted: false,
                      requestId: "req-http-422",
                      bodyBytes: 128,
                    },
                    failure: {
                      reason: "http_error",
                      message: "Bridge request returned HTTP 422.",
                      retryable: false,
                      statusCode: 422,
                    },
                  },
                  notes: ["external-bridge", "bridge:http-json"],
                },
              },
            ],
            events: [
              ...createExecutionRunFixture().events,
              {
                eventId: "event-2",
                runId: "run-bridge-explain-http-422-1",
                type: "assignment-status-changed",
                occurredAt: "2026-04-13T08:05:35.838Z",
                message: "Assignment assignment-bridge-1 finished with status failed.",
              },
            ],
          }),
          recordedAt: "2026-04-13T08:05:36.000Z",
          summary: ["run status=failed", "bridge attempts=1 succeeded=0 failed=1"],
          flags: ["has-failures", "external-bridge-attempted", "external-bridge-failed"],
          operatorSurface: {
            directorGoal: "Generate a single-shot storm corridor video.",
            operatorSummary:
              "Single-shot video brief reached the remote bridge but needs operator repair.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "failed",
            bridgeFailureReason: "http_error",
            retryable: false,
            retryAllowed: false,
            bridgeStatus: 422,
            nextAction:
              "inspect the remote bridge request and payload before re-running the assignment.",
          },
          events: [
            ...createExecutionRunFixture().events,
            {
              eventId: "event-2",
              runId: "run-bridge-explain-http-422-1",
              type: "assignment-status-changed",
              occurredAt: "2026-04-13T08:05:35.838Z",
              message: "Assignment assignment-bridge-1 finished with status failed.",
            },
          ],
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "explain", "--run-id", "run-bridge-explain-http-422-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain(
        "operator verdict: Run failed and the current bridge failure must be fixed before it can be retried.",
      );
      expect(output).toContain("bridge verdict: failed (http_error)");
      expect(output).toContain("retry candidates: 1");
      expect(output).toContain(
        "- assignment-bridge-1 role=asset-router reason=http_error retryable=no retry-allowed=no status=422",
      );
      expect(output).toContain(
        "next action: inspect the remote bridge request and payload before re-running the assignment.",
      );
      expect(output).not.toContain("suggested command: hotflow director run retry");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints retry budget exhaustion guidance without suggesting another retry command", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-explain-bridge-budget-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-bridge-explain-http-502-budget-1",
          runId: "run-bridge-explain-http-502-budget-1",
          run: createExecutionRunFixture({
            runId: "run-bridge-explain-http-502-budget-1",
            status: "failed",
            goal: "Generate a single-shot storm corridor video.",
            previewSummary:
              "Single-shot video brief reached the remote bridge twice and now needs route repair.",
            assignments: [
              {
                runId: "run-bridge-explain-http-502-budget-1",
                assignmentId: "assignment-bridge-1",
                role: "asset-router",
                objective: "Submit a media generation request",
                deliverable: "send a bounded adapter request",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "failed",
                selectedAdapter: "seedance-preview",
                allowedAdapters: ["seedance-preview", "runway-preview"],
                createdAt: "2026-04-13T08:05:34.984Z",
                startedAt: "2026-04-13T08:05:35.836Z",
                completedAt: "2026-04-13T08:05:39.838Z",
                notes: [
                  "external-bridge",
                  "bridge:http-json",
                  "Retry requested at 2026-04-13T08:05:37.000Z.",
                ],
                result: {
                  runId: "run-bridge-explain-http-502-budget-1",
                  assignmentId: "assignment-bridge-1",
                  status: "failed",
                  recordedAt: "2026-04-13T08:05:39.838Z",
                  workerId: "worker-bridge-1",
                  summary: "Bridge returned HTTP 502 again.",
                  adapterId: "seedance-preview",
                  bridgeExecution: {
                    kind: "http-json",
                    request: {
                      endpointOrigin: "http://127.0.0.1:59944",
                      endpointPath: "/v1/jobs",
                      method: "POST",
                      timeoutMs: 500,
                      authMode: "env",
                      headerKeys: ["x-bridge-id"],
                      payloadBytes: 414,
                    },
                    response: {
                      statusCode: 502,
                      accepted: false,
                      requestId: "req-http-502-budget",
                      bodyBytes: 128,
                    },
                    failure: {
                      reason: "http_error",
                      message: "Bridge request returned HTTP 502.",
                      retryable: true,
                      statusCode: 502,
                    },
                  },
                  notes: ["external-bridge", "bridge:http-json"],
                },
              },
            ],
          }),
          recordedAt: "2026-04-13T08:05:40.000Z",
          summary: ["run status=failed", "bridge attempts=2 succeeded=0 failed=2"],
          flags: ["has-failures", "external-bridge-attempted", "external-bridge-failed"],
          operatorSurface: {
            directorGoal: "Generate a single-shot storm corridor video.",
            operatorSummary:
              "Single-shot video brief reached the remote bridge twice and now needs route repair.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "failed",
            bridgeFailureReason: "http_error",
            retryable: true,
            retryAllowed: false,
            rerouteCandidates: ["runway-preview"],
            bridgeStatus: 502,
            nextAction:
              "retry budget is exhausted; repair the route, reroute the adapter, or choose a failover path before re-running the assignment.",
          },
          events: [
            ...createExecutionRunFixture().events,
            {
              eventId: "event-2",
              runId: "run-bridge-explain-http-502-budget-1",
              type: "assignment-status-changed",
              occurredAt: "2026-04-13T08:05:39.838Z",
              message: "Assignment assignment-bridge-1 finished with status failed.",
            },
          ],
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli([
        "director",
        "run",
        "explain",
        "--run-id",
        "run-bridge-explain-http-502-budget-1",
      ]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain(
        "operator verdict: Run failed and the retry budget is exhausted on the current route; reroute to another approved adapter before retrying again.",
      );
      expect(output).toContain("bridge verdict: failed (http_error)");
      expect(output).toContain("reroute candidates: runway-preview");
      expect(output).toContain("retry candidates: 1");
      expect(output).toContain(
        "- assignment-bridge-1 role=asset-router reason=http_error retryable=yes retry-allowed=no retry-budget=1/1 status=502",
      );
      expect(output).toContain(
        "suggested command: hotflow director run reroute --run-id run-bridge-explain-http-502-budget-1 --assignment-id assignment-bridge-1 --adapter-id runway-preview",
      );
      expect(output).toContain(
        "next action: retry budget is exhausted; repair the route, reroute the adapter, or choose a failover path before re-running the assignment.",
      );
      expect(output).not.toContain("suggested command: hotflow director run retry");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints the full operator-facing audit trail for a failed bridge run", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-audit-bridge-failure-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-bridge-audit-failure-1",
          runId: "run-bridge-audit-failure-1",
          run: createExecutionRunFixture({
            runId: "run-bridge-audit-failure-1",
            status: "failed",
            goal: "Generate a single-shot storm corridor video.",
            assignments: [
              {
                runId: "run-bridge-audit-failure-1",
                assignmentId: "assignment-bridge-1",
                role: "asset-router",
                objective: "Submit a media generation request",
                deliverable: "send a bounded adapter request",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "failed",
                selectedAdapter: "seedance-preview",
                allowedAdapters: ["seedance-preview"],
                createdAt: "2026-04-13T08:05:34.984Z",
                startedAt: "2026-04-13T08:05:35.836Z",
                completedAt: "2026-04-13T08:05:35.838Z",
                notes: ["external-bridge", "bridge:http-json"],
                result: {
                  runId: "run-bridge-audit-failure-1",
                  assignmentId: "assignment-bridge-1",
                  status: "failed",
                  recordedAt: "2026-04-13T08:05:35.838Z",
                  workerId: "worker-bridge-1",
                  summary: "Bridge failed for asset-router assignment via seedance-preview.",
                  adapterId: "seedance-preview",
                  bridgeExecution: {
                    kind: "http-json",
                    request: {
                      endpointOrigin: "http://127.0.0.1:59944",
                      endpointPath: "/v1/jobs",
                      method: "POST",
                      timeoutMs: 500,
                      authMode: "env",
                      headerKeys: ["x-bridge-id"],
                      payloadBytes: 414,
                    },
                    failure: {
                      reason: "network_timeout",
                      message: "request timed out",
                      retryable: true,
                      statusCode: 504,
                    },
                  },
                  notes: ["external-bridge", "bridge:http-json"],
                },
              },
            ],
            events: [
              ...createExecutionRunFixture().events,
              {
                eventId: "event-2",
                runId: "run-bridge-audit-failure-1",
                type: "assignment-status-changed",
                occurredAt: "2026-04-13T08:05:35.838Z",
                message: "Assignment assignment-bridge-1 finished with status failed.",
                payload: {
                  assignmentId: "assignment-bridge-1",
                  previousStatus: "running",
                  nextStatus: "failed",
                  adapterId: "seedance-preview",
                  summary: "Bridge request timed out for assignment assignment-bridge-1.",
                },
              },
            ],
          }),
          recordedAt: "2026-04-13T08:05:36.000Z",
          summary: ["run status=failed", "bridge attempts=1 succeeded=0 failed=1"],
          flags: ["has-failures", "external-bridge-attempted", "external-bridge-failed"],
          operatorSurface: {
            directorGoal: "Generate a single-shot storm corridor video.",
            operatorSummary:
              "Single-shot video brief reached the remote bridge but needs operator follow-up.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "failed",
            bridgeFailureReason: "network_timeout",
            retryable: true,
            bridgeStatus: 504,
            nextAction: "review the failure and retry when the side-effect boundary is safe.",
          },
          events: [
            ...createExecutionRunFixture().events,
            {
              eventId: "event-2",
              runId: "run-bridge-audit-failure-1",
              type: "assignment-status-changed",
              occurredAt: "2026-04-13T08:05:35.838Z",
              message: "Assignment assignment-bridge-1 finished with status failed.",
              payload: {
                assignmentId: "assignment-bridge-1",
                previousStatus: "running",
                nextStatus: "failed",
                adapterId: "seedance-preview",
                summary: "Bridge request timed out for assignment assignment-bridge-1.",
              },
            },
          ],
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "audit", "--run-id", "run-bridge-audit-failure-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain("Director run audit:");
      expect(output).toContain(
        "assignment counts: total=1 ready=0 pending=0 running=0 completed=0 failed=1 blocked=0 aborted=0 skipped=0",
      );
      expect(output).toContain(
        "assignment-bridge-1 role=asset-router status=failed adapter=seedance-preview",
      );
      expect(output).toContain("bridge failure: network_timeout retryable=yes status=504");
      expect(output).toContain("event timeline:");
      expect(output).toContain(
        "assignmentId=assignment-bridge-1 previousStatus=running nextStatus=failed adapterId=seedance-preview",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("falls back to holding-state guidance in director run audit when operator next action is absent", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-audit-holding-state-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-run-audit-holding-state-1",
          runId: "run-audit-holding-state-1",
          run: createExecutionRunFixture({
            runId: "run-audit-holding-state-1",
            status: "paused",
            assignments: [
              {
                ...createExecutionRunFixture().assignments[0],
                assignmentId: "assignment-audit-holding-state-completed-1",
                status: "completed",
                selectedAdapter: "mock-execution",
              },
              {
                ...createExecutionRunFixture().assignments[0],
                assignmentId: "assignment-audit-holding-state-1",
                status: "pending",
                approvalMode: "operator_approve",
                selectedAdapter: "mock-execution",
              },
            ],
          }),
          recordedAt: "2026-04-19T06:30:00.000Z",
          summary: ["run status=paused"],
          flags: ["run-paused", "awaiting-approval-or-dependencies"],
          operatorSurface: {
            directorGoal: "Generate a controlled lighthouse approval pass.",
            operatorSummary: "The run is paused and waiting for approval before dispatch resumes.",
          },
          events: createExecutionRunFixture().events,
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "audit", "--run-id", "run-audit-holding-state-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain(
        "holding state: Run is paused and the remaining work is waiting on approval.",
      );
      expect(output).toContain(
        "next action: review the approval-gated assignments, then resume only when the next bounded pass is safe.",
      );
      expect(output).toContain(
        "suggested commands: hotflow director run report --run-id run-audit-holding-state-1 | hotflow director run explain --run-id run-audit-holding-state-1",
      );
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints structured route recovery evidence in the operator-facing audit trail", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-audit-route-recovery-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: "director.execution.run.v1",
          reportId: "report-bridge-audit-route-recovery-1",
          runId: "run-bridge-audit-route-recovery-1",
          run: createExecutionRunFixture({
            runId: "run-bridge-audit-route-recovery-1",
            status: "running",
            goal: "Recover a single-shot storm corridor video route.",
            assignments: [
              {
                runId: "run-bridge-audit-route-recovery-1",
                assignmentId: "assignment-bridge-1",
                role: "asset-router",
                objective: "Submit a media generation request",
                deliverable: "send a bounded adapter request",
                actionClass: "generate",
                approvalMode: "auto_allow",
                dependsOn: [],
                status: "ready",
                selectedAdapter: "runway-preview",
                allowedAdapters: ["seedance-preview", "runway-preview"],
                createdAt: "2026-04-13T08:05:34.984Z",
                notes: [
                  "external-bridge",
                  "bridge:http-json",
                  "Retry requested at 2026-04-13T08:05:36.000Z.",
                  "Adapter rerouted from seedance-preview to runway-preview at 2026-04-13T08:05:37.000Z.",
                  "Retry requested at 2026-04-13T08:05:38.000Z.",
                ],
              },
            ],
            events: [
              ...createExecutionRunFixture().events,
              {
                eventId: "event-2",
                runId: "run-bridge-audit-route-recovery-1",
                type: "assignment-status-changed",
                occurredAt: "2026-04-13T08:05:35.838Z",
                message: "Assignment assignment-bridge-1 finished with status failed.",
                payload: {
                  assignmentId: "assignment-bridge-1",
                  previousStatus: "running",
                  nextStatus: "failed",
                  summary: "Bridge request returned HTTP 502.",
                  adapterId: "seedance-preview",
                  bridgeKind: "http-json",
                  bridgeVerdict: "failed",
                  bridgeFailureReason: "http_error",
                  bridgeRetryable: true,
                  bridgeStatus: 502,
                },
              },
              {
                eventId: "event-3",
                runId: "run-bridge-audit-route-recovery-1",
                type: "log",
                occurredAt: "2026-04-13T08:05:37.000Z",
                message:
                  "Assignment assignment-bridge-1 rerouted from seedance-preview to runway-preview.",
                payload: {
                  assignmentId: "assignment-bridge-1",
                  previousAdapterId: "seedance-preview",
                  nextAdapterId: "runway-preview",
                },
              },
              {
                eventId: "event-4",
                runId: "run-bridge-audit-route-recovery-1",
                type: "assignment-status-changed",
                occurredAt: "2026-04-13T08:05:38.000Z",
                message: "Assignment assignment-bridge-1 was reset for retry.",
                payload: {
                  assignmentId: "assignment-bridge-1",
                  previousStatus: "failed",
                  nextStatus: "ready",
                  adapterId: "runway-preview",
                  retryCount: 1,
                  retryLimit: 1,
                },
              },
            ],
          }),
          recordedAt: "2026-04-13T08:05:39.000Z",
          summary: ["run status=running", "bridge attempts=2 succeeded=0 failed=2"],
          flags: ["run-in-progress", "external-bridge-attempted", "external-bridge-failed"],
          operatorSurface: {
            directorGoal: "Recover a single-shot storm corridor video route.",
            operatorSummary:
              "The first route failed and the assignment has been rerouted for another attempt.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "runway-preview",
            nextAction: "wait for the rerouted assignment to be claimed and executed.",
          },
          events: [
            ...createExecutionRunFixture().events,
            {
              eventId: "event-2",
              runId: "run-bridge-audit-route-recovery-1",
              type: "assignment-status-changed",
              occurredAt: "2026-04-13T08:05:35.838Z",
              message: "Assignment assignment-bridge-1 finished with status failed.",
              payload: {
                assignmentId: "assignment-bridge-1",
                previousStatus: "running",
                nextStatus: "failed",
                summary: "Bridge request returned HTTP 502.",
                adapterId: "seedance-preview",
                bridgeKind: "http-json",
                bridgeVerdict: "failed",
                bridgeFailureReason: "http_error",
                bridgeRetryable: true,
                bridgeStatus: 502,
              },
            },
            {
              eventId: "event-3",
              runId: "run-bridge-audit-route-recovery-1",
              type: "log",
              occurredAt: "2026-04-13T08:05:37.000Z",
              message:
                "Assignment assignment-bridge-1 rerouted from seedance-preview to runway-preview.",
              payload: {
                assignmentId: "assignment-bridge-1",
                previousAdapterId: "seedance-preview",
                nextAdapterId: "runway-preview",
              },
            },
            {
              eventId: "event-4",
              runId: "run-bridge-audit-route-recovery-1",
              type: "assignment-status-changed",
              occurredAt: "2026-04-13T08:05:38.000Z",
              message: "Assignment assignment-bridge-1 was reset for retry.",
              payload: {
                assignmentId: "assignment-bridge-1",
                previousStatus: "failed",
                nextStatus: "ready",
                adapterId: "runway-preview",
                retryCount: 1,
                retryLimit: 1,
              },
            },
          ],
        }),
      } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "audit", "--run-id", "run-bridge-audit-route-recovery-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain(
        "assignment-bridge-1 role=asset-router status=ready adapter=runway-preview",
      );
      expect(output).toContain("current route: runway-preview");
      expect(output).toContain("last bridge route: seedance-preview");
      expect(output).toContain(
        "bridgeFailureReason=http_error bridgeRetryable=true bridgeStatus=502",
      );
      expect(output).toContain("previousAdapterId=seedance-preview nextAdapterId=runway-preview");
      expect(output).toContain("adapterId=runway-preview retryCount=1 retryLimit=1");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints audit fetch failures for the director run audit command", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-run-audit-error-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;

      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValueOnce(new Error("audit unavailable"));
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "run", "audit", "--run-id", "run-audit-error-1"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output).toContain("Director run audit failed: Error: audit unavailable");
      expect(process.exitCode).toBe(1);
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prints intake, clarify, and evaluate results from Beta-1 routes", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "shell-director-intake-"));
    const previousWorkspaceRoot = process.env.HOTFLOW_WORKSPACE_ROOT;
    const snapshotPath = join(tempRoot, "snapshot.json");
    try {
      process.env.HOTFLOW_WORKSPACE_ROOT = tempRoot;
      writeFileSync(
        snapshotPath,
        JSON.stringify({
          apiVersion: "director-host-api.v1",
          schemaId: "director.host.snapshot.v1",
          snapshotId: "snapshot-2",
          createdAt: "2026-04-11T12:00:00.000Z",
          host: {
            hostId: "host-1",
            triggerSource: "cli",
          },
          project: {
            projectId: "project-2",
            title: "Director CLI",
            outline: "做一个需要先澄清的导演预检。",
          },
          group: {
            groupId: "group-2",
            generationType: "extend",
            generationStyle: "immersive",
            sceneCount: 2,
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
            bindingPolicy: "prefer",
            preferredImageBinding: "binding-a",
          },
        }),
      );

      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            apiVersion: "director-host-api.v1",
            snapshotId: "snapshot-2",
            runtimeId: "runtime-1",
            intakeId: "intake-snapshot-2",
            capabilitySnapshot: createRuntimeCapabilitySnapshotFixture().capabilitySnapshot,
            clarification: createClarificationFixture({
              decision: "needs_clarification",
              summary: "需要先补一个 continuity anchor。",
              missingFields: ["group.anchorIds"],
              questions: [
                {
                  questionId: "missing-continuity-anchor",
                  prompt: "请先补一个 continuity anchor。",
                  affectsFields: ["group.anchorIds"],
                  required: true,
                  answerKind: "text",
                },
              ],
            }),
            alignmentState: "pending",
            alignmentLock: null,
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            apiVersion: "director-host-api.v1",
            snapshotId: "snapshot-2",
            runtimeId: "runtime-1",
            intakeId: "intake-snapshot-2",
            clarification: createClarificationFixture({
              decision: "needs_clarification",
              summary: "继续等用户补 anchor。",
              missingFields: ["group.anchorIds"],
              questions: [
                {
                  questionId: "missing-continuity-anchor",
                  prompt: "请先补一个 continuity anchor。",
                  affectsFields: ["group.anchorIds"],
                  required: true,
                  answerKind: "text",
                },
              ],
            }),
            alignmentState: "pending",
            alignmentLock: null,
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            apiVersion: "director-host-api.v1",
            snapshotId: "snapshot-2",
            runtimeId: "runtime-1",
            decision: "warn",
            summary: "需要先澄清再继续。",
            recommendations: ["补充 continuity anchor"],
            plan: {
              planId: "plan-2",
              status: "review_required",
              summary: "需要 operator review",
              confidence: 0.7,
              selectedGenerationStyle: "immersive",
              selectedImageBinding: "binding-a",
              selectedVideoBinding: null,
              riskFlags: ["missing-anchor"],
            },
            execution: {
              executionId: "execution-2",
              selectedGenerationType: "extend",
              selectedGenerationStyle: "immersive",
              visiblePrompt: "Project: Director CLI",
            },
            review: {
              overallDecision: "warn",
              blockingReasons: ["缺少 continuity anchor"],
              requiredFixes: ["补充 continuity anchor"],
            },
          }),
        } as Response);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await startCli(["director", "intake", "--input", "snapshot.json"]);
      await startCli(["director", "clarify", "--input", "snapshot.json"]);
      await startCli(["director", "evaluate", "--input", "snapshot.json"]);

      const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(output).toContain("Director intake result:");
      expect(output).toContain("Director clarify result:");
      expect(output).toContain("Director evaluation result:");
      expect(output).toContain("needs_clarification");
      expect(output).toContain("review decision: warn");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("startCli onboard", () => {
  test("routes onboard through runtime control-plane and keeps exit code 0 on pass", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      action: "onboarding",
      data: {
        status: "pass",
        summary: "ready",
      },
    });
    const close = vi.fn();
    const createSession = vi.fn(() => ({ sessionId: "session_onboard" }));
    const getSession = vi.fn(() => null);
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted"],
      engine: { runTurn: vi.fn() },
      sessionStore: { close, createSession, getSession },
      telemetry: { recordAuditEvent: vi.fn() },
      controlPlane: { dispatch },
    });
    setOnboardModuleLoaderForTests(async () => ({
      parseOnboardArgs: () => ({ ok: true, value: { format: "text", help: false } }),
      renderOnboardUsage: () => "Usage: hotflow onboard [--json]",
      renderOnboardingReport: () => "Onboarding status: PASS\n",
      renderOnboardingFailure: (error) => `Onboarding failed: ${String(error)}`,
    }));
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["onboard"]);

    expect(dispatch).toHaveBeenCalledWith({
      type: "onboarding",
      sessionId: "session_onboard",
    });
    expect(mockRunCliDoctorViaControlPlane).not.toHaveBeenCalled();
    expect(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "Onboarding status: PASS",
    );
    expect(process.exitCode).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("sets exit code to 1 when onboarding report status is fail", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      action: "onboarding",
      data: {
        status: "fail",
      },
    });
    const close = vi.fn();
    const createSession = vi.fn(() => ({ sessionId: "session_onboard_fail" }));
    const getSession = vi.fn(() => null);
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted"],
      engine: { runTurn: vi.fn() },
      sessionStore: { close, createSession, getSession },
      telemetry: { recordAuditEvent: vi.fn() },
      controlPlane: { dispatch },
    });
    setOnboardModuleLoaderForTests(async () => ({
      parseOnboardArgs: () => ({ ok: true, value: { format: "text", help: false } }),
      renderOnboardUsage: () => "Usage: hotflow onboard [--json]",
      renderOnboardingReport: () => "Onboarding status: FAIL\n",
      renderOnboardingFailure: (error) => `Onboarding failed: ${String(error)}`,
    }));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["onboard"]);

    expect(dispatch).toHaveBeenCalledWith({
      type: "onboarding",
      sessionId: "session_onboard_fail",
    });
    expect(process.exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("startCli preflight", () => {
  test("runs preflight without bootstrapping the main runtime", async () => {
    const runCliPreflightViaControlPlane = vi.fn(async () => ({
      sessionId: "operator",
      status: "warn",
      readiness: "needs-attention",
      summaryText: "bounded attention is still required",
      commands: ["hotflow doctor"],
      environment: {
        profile: "development",
        workspaceRoot: "/workspace",
        workspaceExists: true,
        dataDir: "/workspace/.hotflow",
        dataDirExists: false,
        sessionDir: "/workspace/.hotflow/sessions",
        sessionDirExists: false,
        sessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
        effectiveSessionDbPath: "/tmp/hotflow.sqlite",
        defaultProvider: "scripted",
        defaultModel: "hotflow-phase1",
        permissionMode: "ask",
        outputStyle: "normal",
      },
      runtime: {
        providerIds: ["scripted"],
        defaultProviderAvailable: true,
        internalPlugins: [],
        approvedSkillSnapshotPath: "/workspace/.hotflow/skills/approved.json",
        approvedSkillCount: 0,
      },
      directorExecution: {
        status: "pass",
        summaryText: "no persisted director report yet",
        suggestedCommands: [],
        routeCounts: {
          healthy: 0,
          degraded: 0,
          reroutable: 0,
          exhausted: 0,
          blocked: 0,
          total: 0,
        },
      },
      guidance: [],
      nextSteps: [],
      doctor: {
        status: "pass",
        counts: {
          pass: 1,
          warn: 0,
          fail: 0,
          total: 1,
        },
        checks: [],
      },
      surfaces: {
        environment: {
          status: "warn",
          summaryText: "state dirs will be created on first run",
        },
        doctor: {
          status: "pass",
          summaryText: "1 checks (1 pass, 0 warn, 0 fail).",
          counts: {
            pass: 1,
            warn: 0,
            fail: 0,
            total: 1,
          },
        },
        directorExecution: {
          status: "pass",
          summaryText: "no persisted director report yet",
          routeCounts: {
            healthy: 0,
            degraded: 0,
            reroutable: 0,
            exhausted: 0,
            blocked: 0,
            total: 0,
          },
        },
      },
    }));

    setPreflightModuleLoaderForTests(async () => ({
      parsePreflightArgs: () => ({ ok: true, value: { format: "text", help: false } }),
      renderPreflightUsage: () => "Usage: hotflow preflight [--json]",
      renderPreflightReport: () => "Hotflow Preflight\n\nReadiness: NEEDS-ATTENTION\n",
      renderPreflightFailure: (error) => `Preflight failed: ${String(error)}`,
      runCliPreflightViaControlPlane,
    }));

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["preflight"]);

    expect(mockBootstrapCli).not.toHaveBeenCalled();
    expect(runCliPreflightViaControlPlane).toHaveBeenCalledOnce();
    expect(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "Hotflow Preflight",
    );
    expect(process.exitCode).toBeUndefined();
  });

  test("sets exit code to 1 when preflight report status is fail", async () => {
    const runCliPreflightViaControlPlane = vi.fn(async () => ({
      status: "fail",
    }));

    setPreflightModuleLoaderForTests(async () => ({
      parsePreflightArgs: () => ({ ok: true, value: { format: "text", help: false } }),
      renderPreflightUsage: () => "Usage: hotflow preflight [--json]",
      renderPreflightReport: () => "Hotflow Preflight\n\nReadiness: BLOCKED\n",
      renderPreflightFailure: (error) => `Preflight failed: ${String(error)}`,
      runCliPreflightViaControlPlane,
    }));

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["preflight"]);

    expect(mockBootstrapCli).not.toHaveBeenCalled();
    expect(runCliPreflightViaControlPlane).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  test("renders preflight failure and sets exit code when control-plane execution fails", async () => {
    const runCliPreflightViaControlPlane = vi.fn(async () => {
      throw new Error("preflight boom");
    });

    setPreflightModuleLoaderForTests(async () => ({
      parsePreflightArgs: () => ({ ok: true, value: { format: "text", help: false } }),
      renderPreflightUsage: () => "Usage: hotflow preflight [--json]",
      renderPreflightReport: () => "unreachable",
      renderPreflightFailure: () =>
        "Hotflow Preflight\n\nStatus: FAIL\nSummary: Preflight command failed.\n",
      runCliPreflightViaControlPlane,
    }));

    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["preflight"]);

    expect(mockBootstrapCli).not.toHaveBeenCalled();
    expect(runCliPreflightViaControlPlane).toHaveBeenCalledOnce();
    expect(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "Status: FAIL",
    );
    expect(process.exitCode).toBe(1);
  });
});

describe("doctor argument parsing", () => {
  test("parses doctor json format", () => {
    expect(parseDoctorArgs(["--json"])).toEqual({
      ok: true,
      value: {
        format: "json",
        help: false,
      },
    });
  });

  test("parses doctor help flag", () => {
    expect(parseDoctorArgs(["--help"])).toEqual({
      ok: true,
      value: {
        format: "text",
        help: true,
      },
    });
  });

  test("rejects unknown doctor options", () => {
    expect(parseDoctorArgs(["--bad"])).toEqual({
      ok: false,
      error: "Unknown doctor option: --bad",
    });
  });
});

describe("doctor output", () => {
  test("includes doctor usage signature", () => {
    expect(renderDoctorUsage()).toContain("hotflow doctor");
  });

  test("renders a readable doctor report", () => {
    expect(
      renderDoctorReport({
        ok: false,
        status: "fail",
        startedAtMs: 1,
        completedAtMs: 2,
        durationMs: 1,
        effective: {
          defaultProvider: "openai-compatible",
          providerIds: ["scripted"],
        },
        checks: [
          {
            id: "config.load",
            status: "pass",
            summary: "Configuration loaded successfully.",
            startedAtMs: 1,
            completedAtMs: 1,
            durationMs: 0,
          },
          {
            id: "provider.default",
            status: "fail",
            summary: "Default provider is not registered.",
            startedAtMs: 1,
            completedAtMs: 2,
            durationMs: 1,
            error: {
              code: "DEFAULT_PROVIDER_UNAVAILABLE",
              message: "Default provider is not registered.",
            },
          },
        ],
      }),
    ).toContain("[FAIL] provider.default");
  });
});

describe("startCli doctor path", () => {
  test("runs doctor without bootstrapping the main runtime", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-cli-doctor-"));
    const dataDir = join(workspaceRoot, ".hotflow");
    const sessionDbPath = join(dataDir, "sessions", "doctor.sqlite");
    const previousEnv = {
      HOTFLOW_WORKSPACE_ROOT: process.env.HOTFLOW_WORKSPACE_ROOT,
      HOTFLOW_DATA_DIR: process.env.HOTFLOW_DATA_DIR,
      HOTFLOW_CLI_SESSION_DB_PATH: process.env.HOTFLOW_CLI_SESSION_DB_PATH,
    };
    process.env.HOTFLOW_WORKSPACE_ROOT = workspaceRoot;
    process.env.HOTFLOW_DATA_DIR = dataDir;
    process.env.HOTFLOW_CLI_SESSION_DB_PATH = sessionDbPath;
    mockRunCliDoctorViaControlPlane.mockResolvedValue({
      ok: true,
      status: "pass",
      startedAtMs: 1,
      completedAtMs: 2,
      durationMs: 1,
      checks: [],
    });

    const stdout: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    try {
      await startCli(["doctor"]);
      expect(mockBootstrapCli).not.toHaveBeenCalled();
      expect(mockRunCliDoctorViaControlPlane).toHaveBeenCalledOnce();
      expect(stdout.join("")).toContain("Hotflow Doctor");
    } finally {
      writeSpy.mockRestore();
      if (previousEnv.HOTFLOW_WORKSPACE_ROOT === undefined) {
        process.env.HOTFLOW_WORKSPACE_ROOT = undefined;
      } else {
        process.env.HOTFLOW_WORKSPACE_ROOT = previousEnv.HOTFLOW_WORKSPACE_ROOT;
      }
      if (previousEnv.HOTFLOW_DATA_DIR === undefined) {
        process.env.HOTFLOW_DATA_DIR = undefined;
      } else {
        process.env.HOTFLOW_DATA_DIR = previousEnv.HOTFLOW_DATA_DIR;
      }
      if (previousEnv.HOTFLOW_CLI_SESSION_DB_PATH === undefined) {
        process.env.HOTFLOW_CLI_SESSION_DB_PATH = undefined;
      } else {
        process.env.HOTFLOW_CLI_SESSION_DB_PATH = previousEnv.HOTFLOW_CLI_SESSION_DB_PATH;
      }
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("startCli doctor", () => {
  test("renders doctor output without bootstrapping runtime", async () => {
    mockRunCliDoctorViaControlPlane.mockResolvedValue({
      status: "warn",
      counts: {
        pass: 1,
        warn: 1,
        fail: 0,
        total: 2,
      },
      checks: [
        {
          id: "config.load",
          status: "pass",
          summary: "Configuration loaded successfully.",
          detailLines: [],
        },
        {
          id: "provider.registry",
          status: "warn",
          summary: "OpenAI-compatible provider is not configured.",
          detailLines: ["providerIds: scripted"],
        },
      ],
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["doctor"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(mockRunCliDoctorViaControlPlane).toHaveBeenCalledTimes(1);
    expect(mockBootstrapCli).not.toHaveBeenCalled();
    expect(output).toContain("Hotflow Doctor");
    expect(output).toContain("Status: WARN");
    expect(output).toContain("[WARN] provider.registry");
    expect(process.exitCode).toBeUndefined();
  });

  test("renders doctor failure and sets exit code when core fails", async () => {
    mockRunCliDoctorViaControlPlane.mockRejectedValue(
      new Error("Cannot find module '@hotflow/doctor'"),
    );
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["doctor"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(mockRunCliDoctorViaControlPlane).toHaveBeenCalledTimes(1);
    expect(mockBootstrapCli).not.toHaveBeenCalled();
    expect(output).toContain("Status: FAIL");
    expect(output).toContain("Doctor command failed.");
    expect(output).toContain("Cannot find module '@hotflow/doctor'");
    expect(process.exitCode).toBe(1);
  });
});

describe("run argument parsing", () => {
  test("parses prompt and option overrides", () => {
    expect(
      parseRunArgs([
        "Summarize",
        "README.md",
        "--provider",
        "openai-compatible",
        "--model",
        "gpt-5-mini",
        "--session",
        "session_1",
        "--max-steps",
        "3",
        "--token-budget",
        "1200",
      ]),
    ).toEqual({
      ok: true,
      value: {
        userText: "Summarize README.md",
        providerId: "openai-compatible",
        model: "gpt-5-mini",
        sessionId: "session_1",
        maxSteps: 3,
        tokenBudget: 1200,
      },
    });
  });

  test("supports using -- to separate prompt from options-like text", () => {
    expect(parseRunArgs(["--", "--this", "is", "prompt", "text"])).toEqual({
      ok: true,
      value: {
        userText: "--this is prompt text",
      },
    });
  });

  test("rejects unknown options", () => {
    expect(parseRunArgs(["do", "work", "--unknown"])).toEqual({
      ok: false,
      error: "Unknown run option: --unknown",
    });
  });

  test("rejects missing prompt text", () => {
    expect(parseRunArgs(["--provider", "scripted"])).toEqual({
      ok: false,
      error: "Missing run prompt text.",
    });
  });

  test("rejects non-numeric max steps", () => {
    expect(parseRunArgs(["do", "work", "--max-steps", "abc"])).toEqual({
      ok: false,
      error: "--max-steps expects a positive integer.",
    });
  });
});

describe("run usage output", () => {
  test("includes run command signature", () => {
    expect(renderRunUsage()).toContain("hotflow run <prompt>");
  });
});

describe("status argument parsing", () => {
  test("parses session id, turn id, and limit", () => {
    expect(parseStatusArgs(["session_1", "--turn", "turn_2", "--limit", "25"])).toEqual({
      ok: true,
      value: {
        sessionId: "session_1",
        turnId: "turn_2",
        limit: 25,
      },
    });
  });

  test("requires session id", () => {
    expect(parseStatusArgs([])).toEqual({
      ok: false,
      error: "Missing session id.",
    });
  });

  test("rejects unknown status options", () => {
    expect(parseStatusArgs(["session_1", "--unknown"])).toEqual({
      ok: false,
      error: "Unknown status option: --unknown",
    });
  });
});

describe("status usage output", () => {
  test("includes status command signature", () => {
    expect(renderStatusUsage()).toContain("hotflow status <sessionId>");
  });
});

describe("task argument parsing", () => {
  test("parses task status action", () => {
    expect(parseTaskArgs(["status", "session_1"])).toEqual({
      ok: true,
      value: {
        type: "task-status",
        sessionId: "session_1",
      },
    });
  });

  test("parses task mailbox action", () => {
    expect(parseTaskArgs(["mailbox", "session_1", "--worker", "worker_a"])).toEqual({
      ok: true,
      value: {
        type: "task-worker-mailbox",
        sessionId: "session_1",
        workerId: "worker_a",
      },
    });
  });

  test("parses task verifier mailbox action", () => {
    expect(parseTaskArgs(["verifier-mailbox", "session_1", "--verifier", "verify_a"])).toEqual({
      ok: true,
      value: {
        type: "task-verifier-mailbox",
        sessionId: "session_1",
        verifierId: "verify_a",
      },
    });
  });

  test("parses delegation enqueue action", () => {
    expect(
      parseTaskArgs([
        "delegation-enqueue",
        "session_1",
        "--id",
        "d1",
        "--worker",
        "worker_1",
        "--specialization",
        "plan",
        "--target-agent",
        "plan_agent",
        "--instruction",
        "Summarize docs",
      ]),
    ).toEqual({
      ok: true,
      value: {
        type: "delegation-enqueue",
        sessionId: "session_1",
        delegation: {
          id: "d1",
          workerId: "worker_1",
          specialization: "plan",
          targetAgent: "plan_agent",
          instruction: "Summarize docs",
        },
      },
    });
  });

  test("parses delegation enqueue action with verification handoff contract", () => {
    expect(
      parseTaskArgs([
        "delegation-enqueue",
        "session_1",
        "--id",
        "d1",
        "--worker",
        "worker_1",
        "--instruction",
        "Summarize docs",
        "--verifier",
        "verify_1",
        "--verification",
        "v1",
        "--requirement",
        "Summary must cite sources",
      ]),
    ).toEqual({
      ok: true,
      value: {
        type: "delegation-enqueue",
        sessionId: "session_1",
        delegation: {
          id: "d1",
          workerId: "worker_1",
          instruction: "Summarize docs",
          verificationRequest: {
            verifierId: "verify_1",
            verificationId: "v1",
            requirement: "Summary must cite sources",
          },
        },
      },
    });
  });

  test("rejects delegation target agent without specialization", () => {
    expect(
      parseTaskArgs([
        "delegation-enqueue",
        "session_1",
        "--id",
        "d1",
        "--worker",
        "worker_1",
        "--target-agent",
        "plan_agent",
        "--instruction",
        "Summarize docs",
      ]),
    ).toEqual({
      ok: false,
      error: "Delegation enqueue requires --specialization when --target-agent is set.",
    });
  });

  test("parses proposal get action", () => {
    expect(parseTaskArgs(["proposal-get", "session_1", "--proposal-id", "p1"])).toEqual({
      ok: true,
      value: {
        type: "proposal-get",
        sessionId: "session_1",
        proposalId: "p1",
      },
    });
  });

  test("parses proposal apply action", () => {
    expect(parseTaskArgs(["proposal-apply", "session_1", "--proposal-id", "p1"])).toEqual({
      ok: true,
      value: {
        type: "proposal-apply",
        sessionId: "session_1",
        proposalId: "p1",
      },
    });
  });

  test("parses proposal preview and rollback actions", () => {
    expect(parseTaskArgs(["proposal-preview", "session_1", "--proposal-id", "p1"])).toEqual({
      ok: true,
      value: {
        type: "proposal-preview",
        sessionId: "session_1",
        proposalId: "p1",
      },
    });
    expect(parseTaskArgs(["proposal-rollback", "session_1", "--version", "2"])).toEqual({
      ok: true,
      value: {
        type: "proposal-rollback",
        sessionId: "session_1",
        version: 2,
      },
    });
  });

  test("rejects direct proposal-transition to applied from cli parsing", () => {
    expect(
      parseTaskArgs([
        "proposal-transition",
        "session_1",
        "--proposal-id",
        "p1",
        "--status",
        "applied",
      ]),
    ).toEqual({
      ok: false,
      error: "Invalid proposal status: applied",
    });
  });

  test("rejects invalid proposal payload json", () => {
    expect(
      parseTaskArgs([
        "proposal-enqueue",
        "session_1",
        "--id",
        "p1",
        "--kind",
        "skill",
        "--payload",
        "{bad",
        "--source-session",
        "session_1",
        "--source-turn",
        "turn_1",
        "--provenance",
        "worker-jobs",
      ]),
    ).toEqual({
      ok: false,
      error: "--payload must be valid JSON.",
    });
  });

  test("parses proposal list action", () => {
    expect(
      parseTaskArgs(["proposal-list", "session_1", "--status", "pending", "--limit", "5"]),
    ).toEqual({
      ok: true,
      value: {
        type: "proposal-list",
        sessionId: "session_1",
        status: "pending",
        limit: 5,
      },
    });
  });

  test("parses proposal review, accept, reject, and explain actions", () => {
    expect(parseTaskArgs(["proposal-review", "session_1", "--proposal-id", "p1"])).toEqual({
      ok: true,
      value: {
        type: "proposal-review",
        sessionId: "session_1",
        proposalId: "p1",
      },
    });
    expect(
      parseTaskArgs([
        "proposal-accept",
        "session_1",
        "--proposal-id",
        "p1",
        "--decision-note",
        "Ship it.",
      ]),
    ).toEqual({
      ok: true,
      value: {
        type: "proposal-accept",
        sessionId: "session_1",
        proposalId: "p1",
        decisionNote: "Ship it.",
      },
    });
    expect(
      parseTaskArgs([
        "proposal-reject",
        "session_1",
        "--proposal-id",
        "p1",
        "--decision-note",
        "Needs more evidence.",
      ]),
    ).toEqual({
      ok: true,
      value: {
        type: "proposal-reject",
        sessionId: "session_1",
        proposalId: "p1",
        decisionNote: "Needs more evidence.",
      },
    });
    expect(parseTaskArgs(["proposal-explain", "session_1", "--proposal-id", "p1"])).toEqual({
      ok: true,
      value: {
        type: "proposal-explain",
        sessionId: "session_1",
        proposalId: "p1",
      },
    });
  });
});

describe("task usage output", () => {
  test("includes task command signature", () => {
    expect(renderTaskUsage()).toContain("hotflow task <action> <sessionId>");
    expect(renderTaskUsage()).toContain("proposal-list");
    expect(renderTaskUsage()).toContain("proposal-review");
    expect(renderTaskUsage()).toContain("proposal-accept");
    expect(renderTaskUsage()).toContain("proposal-reject");
    expect(renderTaskUsage()).toContain("proposal-explain");
    expect(renderTaskUsage()).toContain("proposal-preview");
    expect(renderTaskUsage()).toContain("proposal-get");
    expect(renderTaskUsage()).toContain("proposal-apply");
    expect(renderTaskUsage()).toContain("proposal-rollback");
  });
});

describe("turn id selection", () => {
  test("picks latest non-null turn id from journal tail entries", () => {
    expect(
      pickLatestTurnIdFromTailEntries([
        { turnId: null },
        { turnId: "turn_1" },
        { turnId: null },
        { turnId: "turn_2" },
      ]),
    ).toBe("turn_2");
  });

  test("returns undefined when no turn id exists", () => {
    expect(pickLatestTurnIdFromTailEntries([{ turnId: null }, { turnId: null }])).toBeUndefined();
  });
});

describe("tool outcome summaries", () => {
  test("summarizes run tool outcomes with explicit resolutions", () => {
    const summary = summarizeRunToolOutcomes([
      { resolution: "executed", ok: true },
      { resolution: "denied", ok: false },
      { resolution: "approval_required", ok: false },
      { resolution: "degraded", ok: false, degradation: { reason: "policy-restricted" } },
      { resolution: "failed", ok: false },
      { resolution: "missing", ok: false },
    ]);

    expect(summary).toEqual({
      total: 6,
      executed: 1,
      denied: 1,
      approvalRequired: 1,
      degraded: 1,
      failed: 1,
      missing: 1,
      unknown: 0,
    });
    expect(formatToolOutcomeSummary(summary)).toContain("approval_required=1");
  });

  test("derives runtime status from summarized outcomes", () => {
    expect(
      deriveRuntimeStatus({
        total: 1,
        executed: 1,
        denied: 0,
        approvalRequired: 0,
        degraded: 0,
        failed: 0,
        missing: 0,
        unknown: 0,
      }),
    ).toBe("healthy");
    expect(
      deriveRuntimeStatus({
        total: 1,
        executed: 0,
        denied: 0,
        approvalRequired: 0,
        degraded: 1,
        failed: 0,
        missing: 0,
        unknown: 0,
      }),
    ).toBe("degraded");
    expect(
      deriveRuntimeStatus({
        total: 1,
        executed: 0,
        denied: 1,
        approvalRequired: 0,
        degraded: 0,
        failed: 0,
        missing: 0,
        unknown: 0,
      }),
    ).toBe("blocked");
    expect(
      deriveRuntimeStatus({
        total: 1,
        executed: 0,
        denied: 0,
        approvalRequired: 0,
        degraded: 0,
        failed: 1,
        missing: 0,
        unknown: 0,
      }),
    ).toBe("failed");
  });

  test("summarizes step replay payload tool resolutions", () => {
    const summary = summarizeStepReplayToolOutcomes([
      {
        payload: {
          results: [
            { resolution: "executed", ok: true },
            { resolution: "denied", ok: false },
            { resolution: "approval_required", ok: false },
            { resolution: "degraded", ok: false, degradation: { reason: "fallback" } },
          ],
        },
      },
      {
        payload: {
          results: [{ ok: false }],
        },
      },
    ]);

    expect(summary).toEqual({
      total: 5,
      executed: 1,
      denied: 1,
      approvalRequired: 1,
      degraded: 1,
      failed: 1,
      missing: 0,
      unknown: 0,
    });
  });
});

describe("scripted run prompt preparation", () => {
  test("resolves relative target paths against workspace root", () => {
    expect(resolveWorkspacePath("/workspace", "README.md")).toBe("/workspace/README.md");
  });

  test("keeps absolute target paths unchanged", () => {
    expect(resolveWorkspacePath("/workspace", "/tmp/README.md")).toBe("/tmp/README.md");
  });

  test("keeps explicit path prompts unchanged", () => {
    expect(
      prepareRunUserText("scripted", "Read /tmp/README.md and summarize it.", "/workspace"),
    ).toBe("Read /tmp/README.md and summarize it.");
  });

  test("adds default absolute path hint for scripted prompts", () => {
    expect(prepareRunUserText("scripted", "Summarize this repository.", "/workspace")).toContain(
      "Read /workspace/README.md before responding.",
    );
  });

  test("does not modify non-scripted provider prompts", () => {
    expect(
      prepareRunUserText("openai-compatible", "Summarize this repository.", "/workspace"),
    ).toBe("Summarize this repository.");
  });
});

describe("startCli golden-path", () => {
  test("resolves relative target paths against workspace root before dispatch", async () => {
    const runTurn = vi.fn().mockResolvedValue({
      sessionId: "session_1",
      output: "summary",
      taskState: {
        items: [{ content: "todo 1" }],
      },
    });
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["golden-path", "README.md"]);

    expect(runTurn).toHaveBeenCalledWith({
      userText: "Read /workspace/README.md, summarize the project, and write 3 todo steps.",
      providerId: "scripted",
      model: "fake-model",
      estimatedComplexity: "medium",
      requiresTools: true,
    });
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.golden_path.completed",
      payload: {
        providerId: "scripted",
        model: "fake-model",
        todoCount: 1,
        targetPath: "/workspace/README.md",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(stdoutWrite).toHaveBeenCalled();
  });
});

describe("startCli run", () => {
  test("runs with explicit real provider and model and records completion audit", async () => {
    const runTurn = vi.fn().mockResolvedValue({
      sessionId: "session_live",
      output: "live summary",
      taskState: {
        items: [{ content: "todo 1" }],
      },
      toolResults: [{ resolution: "executed", ok: true }],
    });
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const createSession = vi.fn(() => ({ sessionId: "session_live" }));
    const getSession = vi.fn(() => null);
    const recordRuntimeEvidence = vi.fn();
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted", "openai-live"],
      engine: { runTurn },
      sessionStore: { close, createSession, getSession, recordRuntimeEvidence },
      telemetry: { recordAuditEvent },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli([
      "run",
      "Summarize",
      "this",
      "repository",
      "--provider",
      "openai-live",
      "--model",
      "gpt-5-mini",
    ]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_live",
        turnId: expect.any(String),
        userText: "Summarize this repository",
        providerId: "openai-live",
        model: "gpt-5-mini",
        estimatedComplexity: "medium",
        requiresTools: true,
      }),
    );
    expect(output).toContain("Session: session_live");
    expect(output).toContain("Provider: openai-live");
    expect(output).toContain("Model: gpt-5-mini");
    expect(output).toContain("Output: live summary");
    expect(output).toContain("Tool outcomes: executed=1");
    expect(output).toContain("Runtime status: healthy");
    expect(recordRuntimeEvidence).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_live",
      turnId: expect.any(String),
      kind: "cli.run.completed",
      payload: {
        providerId: "openai-live",
        model: "gpt-5-mini",
        todoCount: 1,
        maxSteps: null,
        tokenBudget: null,
        toolOutcomes: {
          total: 1,
          executed: 1,
          denied: 0,
          approvalRequired: 0,
          degraded: 0,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        runtimeStatus: "healthy",
      },
    });
    expect(process.exitCode).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("fails fast when explicit provider is not registered", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted"],
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["run", "Do", "work", "--provider", "openai-live"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(runTurn).not.toHaveBeenCalled();
    expect(output).toContain('Provider "openai-live" is not registered.');
    expect(output).toContain("Available providers: scripted");
    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("fails fast when default real provider is configured but not registered", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "openai-compatible",
        defaultModel: "hotflow-phase1",
      },
      providerIds: ["scripted"],
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["run", "Use", "the", "default", "provider"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(runTurn).not.toHaveBeenCalled();
    expect(output).toContain('Provider "openai-compatible" is not registered.');
    expect(output).toContain("HOTFLOW_OPENAI_BASE_URL");
    expect(process.exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("renders structured transient provider failures and records audit", async () => {
    const runTurn = vi.fn().mockRejectedValue(
      new ModelProviderError({
        providerId: "openai-live",
        stage: "generate",
        code: "HTTP_429",
        message: "rate limited",
        statusCode: 429,
        retryable: true,
      }),
    );
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const createSession = vi.fn(() => ({ sessionId: "session_retry" }));
    const getSession = vi.fn(() => null);
    const recordRuntimeEvidence = vi.fn();
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted", "openai-live"],
      engine: { runTurn },
      sessionStore: { close, createSession, getSession, recordRuntimeEvidence },
      telemetry: { recordAuditEvent },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["run", "Call", "the", "provider", "--provider", "openai-live"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Session: session_retry");
    expect(output).toContain("Provider: openai-live");
    expect(output).toContain("Failure class: transient");
    expect(output).toContain("Failure code: HTTP_429");
    expect(output).toContain("Recommended action: failover");
    expect(output).toContain("Retryable: yes");
    expect(recordRuntimeEvidence).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_retry",
      turnId: expect.any(String),
      kind: "cli.run.failed",
      payload: {
        providerId: "openai-live",
        model: "fake-model",
        failureClass: "transient",
        kind: "provider-transient",
        action: "failover",
        code: "HTTP_429",
        message: "rate limited",
        retryable: true,
        statusCode: 429,
      },
    });
    expect(process.exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("renders structured fatal provider failures and records audit", async () => {
    const runTurn = vi.fn().mockRejectedValue(
      new ModelProviderError({
        providerId: "openai-live",
        stage: "generate",
        code: "HTTP_4XX",
        message: "unauthorized",
        statusCode: 401,
        retryable: false,
      }),
    );
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const createSession = vi.fn(() => ({ sessionId: "session_fatal" }));
    const getSession = vi.fn(() => null);
    const recordRuntimeEvidence = vi.fn();
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted", "openai-live"],
      engine: { runTurn },
      sessionStore: { close, createSession, getSession, recordRuntimeEvidence },
      telemetry: { recordAuditEvent },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["run", "Call", "the", "provider", "--provider", "openai-live"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Session: session_fatal");
    expect(output).toContain("Provider: openai-live");
    expect(output).toContain("Failure class: fatal");
    expect(output).toContain("Failure code: HTTP_4XX");
    expect(output).toContain("Recommended action: abort");
    expect(output).toContain("Retryable: no");
    expect(recordRuntimeEvidence).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_fatal",
      turnId: expect.any(String),
      kind: "cli.run.failed",
      payload: {
        providerId: "openai-live",
        model: "fake-model",
        failureClass: "fatal",
        kind: "provider-fatal",
        action: "abort",
        code: "HTTP_4XX",
        message: "unauthorized",
        retryable: false,
        statusCode: 401,
      },
    });
    expect(process.exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("renders engine-wrapped contract failures with structured metadata", async () => {
    const runTurn = vi.fn().mockRejectedValue(
      createContractError({
        code: "PROVIDER_TRANSIENT_ERROR",
        message: "rate limited",
        retryable: true,
        kind: "provider-transient",
        defaultAction: "failover",
        metadata: {
          kind: "provider-transient",
          action: "failover",
          providerId: "openai-live",
          providerStage: "generate",
          providerCode: "HTTP_429",
          retryable: true,
          statusCode: 429,
          operatorVisible: false,
        },
      }),
    );
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const createSession = vi.fn(() => ({ sessionId: "session_wrapped" }));
    const getSession = vi.fn(() => null);
    const recordRuntimeEvidence = vi.fn();
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted", "openai-live"],
      engine: { runTurn },
      sessionStore: { close, createSession, getSession, recordRuntimeEvidence },
      telemetry: { recordAuditEvent },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["run", "Call", "the", "provider", "--provider", "openai-live"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Session: session_wrapped");
    expect(output).toContain("Provider: openai-live");
    expect(output).toContain("Failure class: transient");
    expect(output).toContain("Failure code: HTTP_429");
    expect(output).toContain("Recommended action: failover");
    expect(output).toContain("Retryable: yes");
    expect(recordRuntimeEvidence).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_wrapped",
      turnId: expect.any(String),
      kind: "cli.run.failed",
      payload: {
        providerId: "openai-live",
        model: "fake-model",
        failureClass: "transient",
        kind: "provider-transient",
        action: "failover",
        code: "HTTP_429",
        message: "rate limited",
        retryable: true,
        statusCode: 429,
      },
    });
    expect(process.exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("renders engine run failures through the same structured CLI path", async () => {
    const runTurn = vi.fn().mockRejectedValue(
      new EngineRunFailure({
        sessionId: "session_engine",
        turnId: "turn_engine",
        model: "fake-model",
        selectedProviderId: "openai-live",
        failure: toModelProviderRuntimeFailureSurface(
          new ModelProviderError({
            providerId: "openai-live",
            stage: "generate",
            code: "HTTP_429",
            message: "rate limited",
            statusCode: 429,
            retryable: true,
          }),
        ),
      }),
    );
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const createSession = vi.fn(() => ({ sessionId: "session_engine" }));
    const getSession = vi.fn(() => null);
    const recordRuntimeEvidence = vi.fn();
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted", "openai-live"],
      engine: { runTurn },
      sessionStore: { close, createSession, getSession, recordRuntimeEvidence },
      telemetry: { recordAuditEvent },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["run", "Call", "the", "provider", "--provider", "openai-live"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Session: session_engine");
    expect(output).toContain("Provider: openai-live");
    expect(output).toContain("Failure class: transient");
    expect(output).toContain("Failure code: HTTP_429");
    expect(output).toContain("Recommended action: failover");
    expect(output).toContain("Retryable: yes");
    expect(recordRuntimeEvidence).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_engine",
      turnId: expect.any(String),
      kind: "cli.run.failed",
      payload: {
        providerId: "openai-live",
        model: "fake-model",
        failureClass: "transient",
        kind: "provider-transient",
        action: "failover",
        code: "HTTP_429",
        message: "rate limited",
        retryable: true,
        statusCode: 429,
      },
    });
    expect(process.exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("startCli control command", () => {
  test("dispatches compact through control-plane and renders summary", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_1",
        compacted: true,
        strategy: "soft",
        beforeTokens: 48,
        afterTokens: 16,
        reducedTokens: 32,
        beforeEntryCount: 4,
        afterEntryCount: 2,
        removedEntryIds: ["l0_2", "l0_3"],
        summaryEntryIds: ["l0_99"],
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["control", "compact", "session_1", "--strategy", "soft"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "compact",
      sessionId: "session_1",
      strategy: "soft",
    });
    expect(output).toContain("Control action: compact");
    expect(output).toContain("Compacted: yes");
    expect(output).toContain("Memory tokens: 48 -> 16");
    expect(output).toContain("Reduced tokens: 32");
    expect(output).toContain("Summary memory ids: l0_99");
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.control.completed",
      payload: {
        action: "compact",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches resume through control-plane and renders recovery guidance", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_1",
        requestedCheckpointId: 3,
        checkpointId: 3,
        checkpointUptoSeq: 8,
        firstTodo: "draft intro",
        lastAppliedSeq: 12,
        journalEvents: 6,
        auditEvents: 2,
        streamEvents: 1,
        latestTurnId: "turn_resume",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        recoveryProviderId: "openai-live",
        recoveryModel: "gpt-5-mini",
        recoverySelectionSource: "persisted-runtime",
        recoveryReasoningStrategy: "react",
        recoveryReasoningSource: "stream-evidence",
        resumable: true,
        guidance: "Start step 2 and reuse the recovered tool results instead of replaying them.",
        resumeAction: "start-next-step",
        nextStepIndex: 2,
        runtimeStatus: "healthy",
        toolOutcomes: {
          total: 1,
          executed: 1,
          denied: 0,
          approvalRequired: 0,
          degraded: 0,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        replayWindow: {
          fromSeqExclusive: 8,
          toSeqInclusive: 12,
        },
        lastStepEventType: "step.tool_result",
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["control", "resume", "session_1", "--checkpoint", "3"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "resume",
      sessionId: "session_1",
      checkpointId: 3,
    });
    expect(output).toContain("Control action: resume");
    expect(output).toContain("Requested checkpoint: 3");
    expect(output).toContain("Checkpoint: 3 (seq 8)");
    expect(output).toContain("Recovery provider: openai-live");
    expect(output).toContain("Recovery model: gpt-5-mini");
    expect(output).toContain("Recovery selection source: persisted-runtime");
    expect(output).toContain("Recovery reasoning source: stream-evidence");
    expect(output).toContain("Recovery reasoning strategy: react");
    expect(output).toContain("Resumable: yes");
    expect(output).toContain("Resume action: start-next-step");
    expect(output).toContain(
      "Guidance: Start step 2 and reuse the recovered tool results instead of replaying them.",
    );
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.control.completed",
      payload: {
        action: "resume",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches rewind through control-plane and renders checkpoint summary", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_1",
        requestedCheckpointId: 3,
        selection: "explicit",
        targetCheckpointId: 3,
        targetUptoSeq: 8,
        currentCheckpointId: 5,
        currentUptoSeq: 11,
        latestTurnId: null,
        clearedLatestTurn: true,
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["control", "rewind", "session_1", "--checkpoint", "3"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "rewind",
      sessionId: "session_1",
      checkpointId: 3,
    });
    expect(output).toContain("Control action: rewind");
    expect(output).toContain("Selection: explicit");
    expect(output).toContain("Target checkpoint: 3 (seq 8)");
    expect(output).toContain("Current checkpoint: 5 (seq 11)");
    expect(output).toContain("Latest turn after rewind: (none)");
    expect(output).toContain("Cleared latest-turn guidance: yes");
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.control.completed",
      payload: {
        action: "rewind",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches prompt-inspect through control-plane and renders prompt evidence", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_1",
        turnId: "turn_prompt",
        stepIndex: 0,
        availableStepIndices: [0, 1],
        usedTokens: 512,
        remainingTokens: 1536,
        runtimeShellSectionIds: ["system.runtime"],
        runtimeShellSectionSummaries: ["runtime shell"],
        staticGuidanceSectionIds: [
          "system.output-style",
          "system.permission-mode",
          "system.response-language",
        ],
        staticGuidanceSectionSummaries: [
          "default output style guidance",
          "default permission mode guidance",
          "default response language guidance",
        ],
        focusSectionIds: [
          "user-input",
          "session.guidance",
          "runtime.tool-status",
          "runtime.turn-resume",
          "session.latest-turn",
        ],
        focusSectionSummaries: [
          "user input",
          "session guidance",
          "tool runtime guidance",
          "turn resume guidance",
          "latest turn guidance",
        ],
        omittedSectionIds: ["working-memory.recall-1"],
        omittedSectionSummaries: ["working memory recall 1"],
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
        },
        effectiveGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "follow-user",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "session-override",
          responseLanguage: "runtime-default",
        },
        toolRuntimeGuidance: {
          status: "degraded",
          impactedTools: 2,
          previewedTools: 2,
          toolPreview: "filesystem.read_text:degraded|tools.exec:missing",
        },
        turnResumeGuidance: {
          resumeAction: "continue-current-step",
          nextStepIndex: 1,
          recoveredToolResults: 1,
        },
        latestTurnGuidance: {
          turnId: "turn_previous",
          runtimeStatus: "blocked",
          turnBranch: "approval-required",
          reasoning: {
            strategy: "plan-execute",
            confidence: 0.9,
            rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
            suggestedAction: "tool",
          },
        },
        runtimeDegradationSummaries: ["budget trim [warn]"],
        staticSections: [
          {
            id: "system.identity",
            cacheBucket: "static",
            owner: "runtime",
          },
          {
            id: "system.runtime",
            cacheBucket: "static",
            owner: "runtime",
          },
          {
            id: "system.output-style",
            cacheBucket: "static",
            owner: "runtime",
          },
          {
            id: "system.permission-mode",
            cacheBucket: "static",
            owner: "runtime",
          },
          {
            id: "system.response-language",
            cacheBucket: "static",
            owner: "runtime",
          },
        ],
        dynamicSections: [
          {
            id: "user-input",
            cacheBucket: "dynamic",
            owner: "turn",
            priority: 100,
          },
          {
            id: "session.guidance",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["outputStyle", "permissionMode"],
            metadataPreview: {
              outputStyle: "concise",
              permissionMode: "deny",
            },
          },
        ],
        omittedSections: [
          {
            id: "working-memory.recall-1",
            cacheBucket: "dynamic",
            owner: "memory",
          },
        ],
        runtimeDegradations: [
          {
            stage: "runtime",
            category: "runtime",
            severity: "minor",
            reason: "context-pressure",
            message:
              'Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget.',
            metadataPreview: {
              toolName: "filesystem.read_text",
              toolCallId: "call-1",
              replayChars: 512,
              originalChars: 4096,
            },
          },
        ],
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli([
      "control",
      "prompt-inspect",
      "session_1",
      "--turn",
      "turn_prompt",
      "--step",
      "0",
    ]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "prompt-inspect",
      sessionId: "session_1",
      turnId: "turn_prompt",
      stepIndex: 0,
    });
    expect(output).toContain("Control action: prompt-inspect");
    expect(output).toContain("Turn: turn_prompt");
    expect(output).toContain("Step index: 0");
    expect(output).toContain("Available prompt steps: 0, 1");
    expect(output).toContain("Prompt tokens: used=512 remaining=1536");
    expect(output).toContain(
      "Prompt focus: user input, session guidance, tool runtime guidance, turn resume guidance, latest turn guidance",
    );
    expect(output).toContain("Prompt omissions: working memory recall 1");
    expect(output).toContain("Runtime shell: runtime shell");
    expect(output).toContain(
      "Static guidance: default output style guidance, default permission mode guidance, default response language guidance",
    );
    expect(output).toContain("Tool runtime guidance: degraded (2 impacted tools)");
    expect(output).toContain(
      "Tool runtime details: filesystem.read_text: degraded, tools.exec: missing",
    );
    expect(output).toContain(
      "Turn resume guidance: continue current step -> step 1 1 recovered tool result",
    );
    expect(output).toContain(
      "Latest turn guidance: prior turn turn_previous blocked (approval required) using plan-execute (confidence=0.9; suggested action=tool)",
    );
    expect(output).toContain(
      "Latest turn reasoning rationale: tool-heavy work benefits from an explicit plan/execute turn strategy",
    );
    expect(output).toContain("Prompt degradations: budget trim [warn]");
    expect(output).toContain("Static sections: 5");
    expect(output).toContain(
      "Effective guidance: output-style=concise permission-mode=deny response-language=follow-user",
    );
    expect(output).toContain(
      "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
    );
    expect(output).toContain("Session guidance: output-style=concise permission-mode=deny");
    expect(output).toContain("Dynamic sections: 2");
    expect(output).toContain("Omitted sections: 1");
    expect(output).toContain("user-input cache=dynamic owner=turn priority=100");
    expect(output).toContain(
      "session.guidance cache=dynamic owner=runtime metadata=outputStyle=concise,permissionMode=deny",
    );
    expect(output).toContain("Runtime degradations: 1");
    expect(output).toContain(
      'stage=runtime category=runtime severity=minor reason=context-pressure message=Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget. metadata=toolName=filesystem.read_text,toolCallId=call-1,replayChars=512,originalChars=4096',
    );
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.control.completed",
      payload: {
        action: "prompt-inspect",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("renders named session guidance source metadata in prompt-inspect output", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_1",
        turnId: "turn_prompt_named_source",
        stepIndex: 0,
        availableStepIndices: [0],
        usedTokens: 500,
        remainingTokens: 1500,
        staticSections: [
          {
            id: "system.identity",
            cacheBucket: "static",
            owner: "runtime",
          },
        ],
        dynamicSections: [
          {
            id: "session.output-style",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 95,
            metadataKeys: ["outputStyle", "source"],
            metadataPreview: {
              outputStyle: "concise",
              source: "session-override",
            },
          },
          {
            id: "session.permission-mode",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 94,
            metadataKeys: ["permissionMode", "source"],
            metadataPreview: {
              permissionMode: "deny",
              source: "session-override",
            },
          },
          {
            id: "session.response-language",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 93,
            metadataKeys: ["responseLanguage", "source"],
            metadataPreview: {
              responseLanguage: "zh-CN",
              source: "session-override",
            },
          },
        ],
        omittedSections: [],
        runtimeDegradations: [],
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli([
      "control",
      "prompt-inspect",
      "session_1",
      "--turn",
      "turn_prompt_named_source",
    ]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain(
      "session.output-style cache=dynamic owner=runtime priority=95 metadata=outputStyle=concise,source=session-override",
    );
    expect(output).toContain(
      "session.permission-mode cache=dynamic owner=runtime priority=94 metadata=permissionMode=deny,source=session-override",
    );
    expect(output).toContain(
      "session.response-language cache=dynamic owner=runtime priority=93 metadata=responseLanguage=zh-CN,source=session-override",
    );
    expect(output).toContain("Prompt degradations: (none)");
    expect(output).toContain("Runtime degradations: (none)");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("renders prompt-inspect change summaries when a previous prompt build exists", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_1",
        turnId: "turn_prompt",
        stepIndex: 1,
        previousStepIndex: 0,
        availableStepIndices: [0, 1],
        usedTokens: 620,
        remainingTokens: 1380,
        focusSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
        focusSectionSummaries: ["tool results", "session guidance", "tool runtime guidance"],
        omittedSectionIds: ["runtime.degradations"],
        omittedSectionSummaries: ["runtime degradations"],
        addedDynamicSectionIds: ["tool-results", "runtime.tool-status"],
        addedDynamicSectionSummaries: ["tool results", "tool runtime guidance"],
        removedDynamicSectionIds: ["user-input"],
        removedDynamicSectionSummaries: ["user input"],
        newlyOmittedSectionIds: ["runtime.degradations"],
        newlyOmittedSectionSummaries: ["runtime degradations"],
        restoredOmittedSectionIds: ["working-memory.recall-1"],
        restoredOmittedSectionSummaries: ["working memory recall 1"],
        staticSections: [
          {
            id: "system.identity",
            cacheBucket: "static",
            owner: "runtime",
          },
        ],
        dynamicSections: [
          {
            id: "tool-results",
            cacheBucket: "dynamic",
            owner: "turn",
            priority: 80,
          },
          {
            id: "session.guidance",
            cacheBucket: "dynamic",
            owner: "runtime",
          },
          {
            id: "runtime.tool-status",
            cacheBucket: "dynamic",
            owner: "runtime",
          },
        ],
        omittedSections: [
          {
            id: "runtime.degradations",
            cacheBucket: "dynamic",
            owner: "runtime",
          },
        ],
        runtimeDegradations: [],
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["control", "prompt-inspect", "session_1", "--turn", "turn_prompt"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Control action: prompt-inspect");
    expect(output).toContain("Step index: 1");
    expect(output).toContain("Previous prompt step: 0");
    expect(output).toContain("Prompt focus: tool results, session guidance, tool runtime guidance");
    expect(output).toContain("Prompt omissions: runtime degradations");
    expect(output).toContain("Added dynamic sections: tool results, tool runtime guidance");
    expect(output).toContain("Removed dynamic sections: user input");
    expect(output).toContain("Newly omitted sections: runtime degradations");
    expect(output).toContain("Restored omitted sections: working memory recall 1");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches prompt-explain through control-plane and renders prompt change summary", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_1",
        turnId: "turn_prompt",
        stepIndex: 1,
        previousStepIndex: 0,
        availableStepIndices: [0, 1],
        usedTokens: 620,
        remainingTokens: 1380,
        focusSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
        focusSectionSummaries: ["tool results", "session guidance", "tool runtime guidance"],
        omittedSectionIds: ["runtime.degradations"],
        omittedSectionSummaries: ["runtime degradations"],
        runtimeDegradations: [
          {
            stage: "runtime",
            category: "runtime",
            severity: "minor",
            reason: "context-pressure",
            message:
              'Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget.',
            metadataPreview: {
              toolName: "filesystem.read_text",
              toolCallId: "call-1",
              replayChars: 512,
              originalChars: 4096,
            },
          },
        ],
        addedDynamicSectionIds: ["tool-results", "runtime.tool-status"],
        addedDynamicSectionSummaries: ["tool results", "tool runtime guidance"],
        removedDynamicSectionIds: ["user-input"],
        removedDynamicSectionSummaries: ["user input"],
        newlyOmittedSectionIds: ["runtime.degradations"],
        newlyOmittedSectionSummaries: ["runtime degradations"],
        restoredOmittedSectionIds: ["working-memory.recall-1"],
        restoredOmittedSectionSummaries: ["working memory recall 1"],
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
        },
        toolRuntimeGuidance: {
          impactedTools: 4,
          status: "degraded",
          previewedTools: 3,
          previewTruncated: true,
          toolPreview:
            "filesystem.read_text:degraded|tasks.todo_write:approval_required|tools.exec:missing",
          metaImpactedTools: 3,
          metaPreviewedTools: 2,
          metaPreviewTruncated: true,
          toolMetaPreview:
            "filesystem.read_text[availability=missing-env,env=HOTFLOW_TOKEN]|tasks.todo_write[approval=pending]",
        },
        turnResumeGuidance: {
          resumeAction: "continue-current-step",
          nextStepIndex: 1,
          recoveredToolResults: 1,
        },
        latestTurnGuidance: {
          turnId: "turn_previous",
          runtimeStatus: "blocked",
          turnBranch: "approval-required",
          reasoning: {
            strategy: "plan-execute",
            confidence: 0.9,
            rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
            suggestedAction: "tool",
          },
        },
        runtimeDegradationSummaries: ["tool replay trim (filesystem.read_text) [minor]"],
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["control", "prompt-explain", "session_1", "--turn", "turn_prompt"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "prompt-explain",
      sessionId: "session_1",
      turnId: "turn_prompt",
    });
    expect(output).toContain("Control action: prompt-explain");
    expect(output).toContain("Turn: turn_prompt");
    expect(output).toContain("Step index: 1");
    expect(output).toContain("Prompt tokens: used=620 remaining=1380");
    expect(output).toContain("Previous prompt step: 0");
    expect(output).toContain("Prompt focus: tool results, session guidance, tool runtime guidance");
    expect(output).toContain("Prompt omissions: runtime degradations");
    expect(output).toContain(
      "Effective guidance: output-style=concise permission-mode=deny response-language=follow-user",
    );
    expect(output).toContain(
      "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
    );
    expect(output).toContain("Session guidance: output-style=concise permission-mode=deny");
    expect(output).toContain("Tool runtime guidance: degraded (4 impacted tools)");
    expect(output).toContain(
      "Tool runtime details: filesystem.read_text: degraded, tasks.todo_write: approval required, tools.exec: missing (+1 more)",
    );
    expect(output).toContain(
      "Tool runtime metadata: filesystem.read_text [availability=missing-env,env=HOTFLOW_TOKEN], tasks.todo_write [approval=pending] (+1 more)",
    );
    expect(output).toContain(
      "Turn resume guidance: continue current step -> step 1 1 recovered tool result",
    );
    expect(output).toContain(
      "Latest turn guidance: prior turn turn_previous blocked (approval required) using plan-execute (confidence=0.9; suggested action=tool)",
    );
    expect(output).toContain(
      "Latest turn reasoning rationale: tool-heavy work benefits from an explicit plan/execute turn strategy",
    );
    expect(output).toContain(
      "Prompt degradations: tool replay trim (filesystem.read_text) [minor]",
    );
    expect(output).toContain("Added dynamic sections: tool results, tool runtime guidance");
    expect(output).toContain("Removed dynamic sections: user input");
    expect(output).toContain("Newly omitted sections: runtime degradations");
    expect(output).toContain("Restored omitted sections: working memory recall 1");
    expect(output).toContain("Runtime degradations: 1");
    expect(output).toContain(
      "metadata=toolName=filesystem.read_text,toolCallId=call-1,replayChars=512,originalChars=4096",
    );
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.control.completed",
      payload: {
        action: "prompt-explain",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("renders named session guidance section labels in prompt-explain output", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_1",
        turnId: "turn_prompt_named_sections",
        stepIndex: 1,
        previousStepIndex: 0,
        availableStepIndices: [0, 1],
        usedTokens: 650,
        remainingTokens: 1350,
        runtimeShellSectionIds: ["system.runtime"],
        runtimeShellSectionSummaries: ["runtime shell"],
        staticGuidanceSectionIds: [
          "system.output-style",
          "system.permission-mode",
          "system.response-language",
        ],
        staticGuidanceSectionSummaries: [
          "default output style guidance",
          "default permission mode guidance",
          "default response language guidance",
        ],
        focusSectionIds: [
          "tool-results",
          "session.output-style",
          "session.permission-mode",
          "session.response-language",
          "runtime.tool-status",
        ],
        focusSectionSummaries: [
          "tool results",
          "output style guidance",
          "permission mode guidance",
          "response language guidance",
          "tool runtime guidance",
        ],
        omittedSectionIds: [],
        omittedSectionSummaries: [],
        runtimeDegradations: [],
        addedDynamicSectionIds: ["tool-results", "session.permission-mode", "runtime.tool-status"],
        addedDynamicSectionSummaries: [
          "tool results",
          "permission mode guidance",
          "tool runtime guidance",
        ],
        removedDynamicSectionIds: ["user-input"],
        removedDynamicSectionSummaries: ["user input"],
        newlyOmittedSectionIds: [],
        newlyOmittedSectionSummaries: [],
        restoredOmittedSectionIds: [],
        restoredOmittedSectionSummaries: [],
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "zh-CN",
        },
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli([
      "control",
      "prompt-explain",
      "session_1",
      "--turn",
      "turn_prompt_named_sections",
    ]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Runtime shell: runtime shell");
    expect(output).toContain(
      "Static guidance: default output style guidance, default permission mode guidance, default response language guidance",
    );
    expect(output).toContain("Prompt tokens: used=650 remaining=1350");
    expect(output).toContain(
      "Prompt focus: tool results, output style guidance, permission mode guidance, response language guidance, tool runtime guidance",
    );
    expect(output).toContain("Prompt omissions: (none)");
    expect(output).toContain(
      "Effective guidance: output-style=concise permission-mode=deny response-language=zh-CN",
    );
    expect(output).toContain(
      "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=session-override",
    );
    expect(output).toContain(
      "Session guidance: output-style=concise permission-mode=deny response-language=zh-CN",
    );
    expect(output).toContain("Prompt degradations: (none)");
    expect(output).toContain(
      "Added dynamic sections: tool results, permission mode guidance, tool runtime guidance",
    );
    expect(output).toContain("Removed dynamic sections: user input");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches output-style and permissions through control-plane", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          sessionId: "session_1",
          previousStyle: "normal",
          style: "concise",
          effectiveGuidance: {
            outputStyle: "concise",
            permissionMode: "ask",
            responseLanguage: "en",
          },
          effectiveGuidanceSources: {
            outputStyle: "session-override",
            permissionMode: "session-override",
            responseLanguage: "session-override",
          },
          sessionGuidance: {
            outputStyle: "concise",
            permissionMode: "ask",
            responseLanguage: "en",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          sessionId: "session_1",
          previousMode: "ask",
          mode: "deny",
          effectiveGuidance: {
            outputStyle: "concise",
            permissionMode: "deny",
            responseLanguage: "en",
          },
          effectiveGuidanceSources: {
            outputStyle: "session-override",
            permissionMode: "session-override",
            responseLanguage: "session-override",
          },
          sessionGuidance: {
            outputStyle: "concise",
            permissionMode: "deny",
            responseLanguage: "en",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          sessionId: "session_1",
          previousLanguage: "en",
          language: "zh-CN",
          effectiveGuidance: {
            outputStyle: "concise",
            permissionMode: "deny",
            responseLanguage: "zh-CN",
          },
          effectiveGuidanceSources: {
            outputStyle: "session-override",
            permissionMode: "session-override",
            responseLanguage: "session-override",
          },
          sessionGuidance: {
            outputStyle: "concise",
            permissionMode: "deny",
            responseLanguage: "zh-CN",
          },
        },
      });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["control", "output-style", "session_1", "concise"]);
    await startCli(["control", "permissions", "session_1", "deny"]);
    await startCli(["control", "language", "session_1", "zh-CN"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "output-style",
      sessionId: "session_1",
      style: "concise",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "permissions",
      sessionId: "session_1",
      mode: "deny",
    });
    expect(dispatch).toHaveBeenNthCalledWith(3, {
      type: "language",
      sessionId: "session_1",
      language: "zh-CN",
    });
    expect(output).toContain("Control action: output-style");
    expect(output).toContain("Previous output style: normal");
    expect(output).toContain("Output style: concise");
    expect(output).toContain(
      "Effective guidance: output-style=concise permission-mode=ask response-language=en",
    );
    expect(output).toContain(
      "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=session-override",
    );
    expect(output).toContain(
      "Session guidance: output-style=concise permission-mode=ask response-language=en",
    );
    expect(output).toContain("Control action: permissions");
    expect(output).toContain("Previous permission mode: ask");
    expect(output).toContain("Permission mode: deny");
    expect(output).toContain(
      "Effective guidance: output-style=concise permission-mode=deny response-language=en",
    );
    expect(output).toContain(
      "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=session-override",
    );
    expect(output).toContain(
      "Session guidance: output-style=concise permission-mode=deny response-language=en",
    );
    expect(output).toContain("Control action: language");
    expect(output).toContain("Previous response language: en");
    expect(output).toContain("Response language: zh-CN");
    expect(output).toContain(
      "Effective guidance: output-style=concise permission-mode=deny response-language=zh-CN",
    );
    expect(output).toContain(
      "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=session-override",
    );
    expect(output).toContain(
      "Session guidance: output-style=concise permission-mode=deny response-language=zh-CN",
    );
    expect(close).toHaveBeenCalledTimes(3);
  });

  test("dispatches memory-inspect and memory-clear through control-plane", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          sessionId: "session_1",
          scope: "all",
          layer0Count: 2,
          layer1Count: 1,
          layer0Ids: ["w1", "w2"],
          layer1Ids: ["e1"],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          sessionId: "session_1",
          scope: "working",
          beforeLayer0Count: 2,
          beforeLayer1Count: 1,
          layer0Cleared: 2,
          layer1Cleared: 0,
          afterLayer0Count: 0,
          afterLayer1Count: 1,
          layer0Ids: ["w1", "w2"],
          layer1Ids: [],
        },
      });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["control", "memory-inspect", "session_1", "--scope", "all"]);
    await startCli(["control", "memory-clear", "session_1", "--scope", "working"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "memory-inspect",
      sessionId: "session_1",
      scope: "all",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "memory-clear",
      sessionId: "session_1",
      scope: "working",
    });
    expect(output).toContain("Control action: memory-inspect");
    expect(output).toContain("Working memory entries: 2");
    expect(output).toContain("Episodic memory ids: e1");
    expect(output).toContain("Control action: memory-clear");
    expect(output).toContain("Working memory entries: 2 -> 0");
    expect(output).toContain("Episodic memory entries: 1 -> 1");
    expect(output).toContain("Working memory cleared: 2");
    expect(output).toContain("Working memory ids: w1, w2");
    expect(close).toHaveBeenCalledTimes(2);
  });
});

describe("startCli resume command", () => {
  test("reuses the recovered turn and original user input when the session is resumable", async () => {
    const runTurn = vi.fn().mockResolvedValue({
      sessionId: "session_resume",
      output: "completed after resume",
      taskState: {
        items: [{ id: "todo_1", content: "Ship the outline", status: "todo" }],
      },
      toolResults: [
        {
          resolution: "executed",
          ok: true,
        },
      ],
    });
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_resume",
        requestedCheckpointId: null,
        checkpointId: 4,
        checkpointUptoSeq: 9,
        firstTodo: "draft intro",
        lastAppliedSeq: 12,
        journalEvents: 6,
        auditEvents: 2,
        streamEvents: 1,
        latestTurnId: "turn_resume",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        recoveryProviderId: "openai-live",
        recoveryModel: "gpt-5-mini",
        recoverySelectionSource: "persisted-runtime",
        recoveryReasoningStrategy: "react",
        recoveryReasoningSource: "stream-evidence",
        resumable: true,
        guidance: "Continue step 1 before branching into new work.",
        resumeAction: "continue-current-step",
        nextStepIndex: 1,
        runtimeStatus: "degraded",
        toolOutcomes: {
          total: 1,
          executed: 0,
          denied: 0,
          approvalRequired: 0,
          degraded: 1,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        replayWindow: {
          fromSeqExclusive: 9,
          toSeqInclusive: 12,
        },
        lastStepEventType: "step.tools_planned",
      },
    });
    const recover = vi.fn(() => ({
      journal: [
        {
          turnId: "turn_resume",
          eventType: "user.input",
          payload: {
            text: "Resume the interrupted outline run.",
          },
        },
      ],
    }));
    const listStreamEvents = vi.fn(() => [
      {
        event: {
          kind: "stream.reasoning",
          payload: {
            decision: {
              strategy: "react",
            },
          },
        },
      },
    ]);
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted", "openai-live"],
      engine: { runTurn },
      sessionStore: { close, recover, listStreamEvents },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["resume", "session_resume"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "resume",
      sessionId: "session_resume",
    });
    expect(recover).toHaveBeenCalledWith("session_resume");
    expect(runTurn).toHaveBeenCalledWith({
      sessionId: "session_resume",
      turnId: "turn_resume",
      userText: "Resume the interrupted outline run.",
      providerId: "openai-live",
      model: "gpt-5-mini",
      reasoningStrategy: "react",
      estimatedComplexity: "medium",
      requiresTools: true,
    });
    expect(output).toContain("Session: session_resume");
    expect(output).toContain("Checkpoint: 4 (seq 9)");
    expect(output).toContain("Recovery turn: turn_resume");
    expect(output).toContain("Recovery provider: openai-live");
    expect(output).toContain("Recovery model: gpt-5-mini");
    expect(output).toContain("Recovery selection source: persisted-runtime");
    expect(output).toContain("Recovery reasoning source: stream-evidence");
    expect(output).toContain("Recovery reasoning strategy: react");
    expect(output).toContain("Resumable: yes");
    expect(output).toContain("Resume action: continue-current-step");
    expect(output).toContain("Runtime status: degraded");
    expect(output).toContain("Guidance: Continue step 1 before branching into new work.");
    expect(output).toContain("Provider: openai-live");
    expect(output).toContain("Model: gpt-5-mini");
    expect(output).toContain("Output: completed after resume");
    expect(output).toContain("Tool outcomes: executed=1");
    expect(output).toContain("Runtime status: healthy");
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_resume",
      kind: "cli.resume.completed",
      payload: {
        firstStep: "draft intro",
        checkpointId: 4,
        checkpointUptoSeq: 9,
        lastAppliedSeq: 12,
        journalEvents: 6,
        auditEvents: 2,
        streamEvents: 1,
        latestTurnId: "turn_resume",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        recoveryProviderId: "openai-live",
        recoveryModel: "gpt-5-mini",
        recoverySelectionSource: "persisted-runtime",
        recoveryReasoningStrategy: "react",
        recoveryReasoningSource: "stream-evidence",
        resumable: true,
        guidance: "Continue step 1 before branching into new work.",
        resumeAction: "continue-current-step",
        replayWindow: {
          fromSeqExclusive: 9,
          toSeqInclusive: 12,
        },
        nextStepIndex: 1,
        lastStepEventType: "step.tools_planned",
        toolOutcomes: {
          total: 1,
          executed: 0,
          denied: 0,
          approvalRequired: 0,
          degraded: 1,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        runtimeStatus: "degraded",
        resumeExecuted: true,
        resumeExecutionReason: "executed",
        resumedProviderId: "openai-live",
        resumedModel: "gpt-5-mini",
        resumedTodoCount: 1,
        resumedToolOutcomes: {
          total: 1,
          executed: 1,
          denied: 0,
          approvalRequired: 0,
          degraded: 0,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        resumedRuntimeStatus: "healthy",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("does not call the engine when the recovery snapshot is not resumable", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_resume",
        requestedCheckpointId: null,
        checkpointId: 4,
        checkpointUptoSeq: 9,
        firstTodo: "draft intro",
        lastAppliedSeq: 12,
        journalEvents: 6,
        auditEvents: 2,
        streamEvents: 1,
        latestTurnId: "turn_resume",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        recoveryProviderId: "openai-live",
        recoveryModel: "gpt-5-mini",
        recoverySelectionSource: "persisted-runtime",
        resumable: false,
        guidance: "Turn already completed; start a new run for follow-up work.",
        resumeAction: "turn-complete",
        nextStepIndex: 2,
        runtimeStatus: "healthy",
        toolOutcomes: {
          total: 1,
          executed: 1,
          denied: 0,
          approvalRequired: 0,
          degraded: 0,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        replayWindow: {
          fromSeqExclusive: 9,
          toSeqInclusive: 12,
        },
        lastStepEventType: "step.final_output",
      },
    });
    const recover = vi.fn();
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close, recover },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["resume", "session_resume"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(runTurn).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(output).toContain("Resumable: no");
    expect(output).toContain("Recovery provider: openai-live");
    expect(output).toContain("Recovery model: gpt-5-mini");
    expect(output).toContain("Recovery selection source: persisted-runtime");
    expect(output).toContain("Recovery reasoning source: surface-default");
    expect(output).toContain(
      "Guidance: Turn already completed; start a new run for follow-up work.",
    );
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_resume",
      kind: "cli.resume.completed",
      payload: {
        firstStep: "draft intro",
        checkpointId: 4,
        checkpointUptoSeq: 9,
        lastAppliedSeq: 12,
        journalEvents: 6,
        auditEvents: 2,
        streamEvents: 1,
        latestTurnId: "turn_resume",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        recoveryProviderId: "openai-live",
        recoveryModel: "gpt-5-mini",
        recoverySelectionSource: "persisted-runtime",
        recoveryReasoningStrategy: null,
        recoveryReasoningSource: "surface-default",
        resumable: false,
        guidance: "Turn already completed; start a new run for follow-up work.",
        resumeAction: "turn-complete",
        replayWindow: {
          fromSeqExclusive: 9,
          toSeqInclusive: 12,
        },
        nextStepIndex: 2,
        lastStepEventType: "step.final_output",
        toolOutcomes: {
          total: 1,
          executed: 1,
          denied: 0,
          approvalRequired: 0,
          degraded: 0,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        runtimeStatus: "healthy",
        resumeExecuted: false,
        resumeExecutionReason: "not_resumable",
        resumedProviderId: null,
        resumedModel: null,
        resumedTodoCount: null,
        resumedToolOutcomes: null,
        resumedRuntimeStatus: null,
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("falls back to the current defaults when persisted runtime selection is unavailable", async () => {
    const runTurn = vi.fn().mockResolvedValue({
      sessionId: "session_resume",
      output: "completed after resume",
      taskState: {
        items: [],
      },
      toolResults: [],
    });
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_resume",
        requestedCheckpointId: null,
        checkpointId: 4,
        checkpointUptoSeq: 9,
        firstTodo: "draft intro",
        lastAppliedSeq: 12,
        journalEvents: 6,
        auditEvents: 2,
        streamEvents: 1,
        latestTurnId: "turn_resume",
        latestTurnProviderId: null,
        latestTurnModel: null,
        recoveryProviderId: "scripted",
        recoveryModel: "fake-model",
        recoverySelectionSource: "default-fallback",
        resumable: true,
        guidance: "Continue step 1 before branching into new work.",
        resumeAction: "continue-current-step",
        nextStepIndex: 1,
        runtimeStatus: "degraded",
        toolOutcomes: {
          total: 1,
          executed: 0,
          denied: 0,
          approvalRequired: 0,
          degraded: 1,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
      },
    });
    const recover = vi.fn(() => ({
      journal: [
        {
          turnId: "turn_resume",
          eventType: "user.input",
          payload: {
            text: "Resume the interrupted outline run.",
          },
        },
      ],
    }));
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted"],
      engine: { runTurn },
      sessionStore: { close, recover },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["resume", "session_resume"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(runTurn).toHaveBeenCalledWith({
      sessionId: "session_resume",
      turnId: "turn_resume",
      userText: "Resume the interrupted outline run.",
      providerId: "scripted",
      model: "fake-model",
      estimatedComplexity: "medium",
      requiresTools: true,
    });
    expect(output).toContain("Recovery provider: scripted");
    expect(output).toContain("Recovery model: fake-model");
    expect(output).toContain("Recovery selection source: default-fallback");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_resume",
        kind: "cli.resume.completed",
        payload: expect.objectContaining({
          latestTurnProviderId: null,
          latestTurnModel: null,
          recoveryProviderId: "scripted",
          recoveryModel: "fake-model",
          recoverySelectionSource: "default-fallback",
          resumeExecuted: true,
          resumedProviderId: "scripted",
          resumedModel: "fake-model",
        }),
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("skips resume execution when the original user input cannot be recovered", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_resume",
        requestedCheckpointId: null,
        checkpointId: 4,
        checkpointUptoSeq: 9,
        firstTodo: "draft intro",
        lastAppliedSeq: 12,
        journalEvents: 6,
        auditEvents: 2,
        streamEvents: 1,
        latestTurnId: "turn_resume",
        latestTurnProviderId: null,
        latestTurnModel: null,
        recoveryProviderId: "scripted",
        recoveryModel: "fake-model",
        recoverySelectionSource: "default-fallback",
        resumable: true,
        guidance: "Continue step 1 before branching into new work.",
        resumeAction: "continue-current-step",
        nextStepIndex: 1,
        runtimeStatus: "degraded",
        toolOutcomes: {
          total: 1,
          executed: 0,
          denied: 0,
          approvalRequired: 0,
          degraded: 1,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        replayWindow: {
          fromSeqExclusive: 9,
          toSeqInclusive: 12,
        },
        lastStepEventType: "step.tools_planned",
      },
    });
    const recover = vi.fn(() => ({
      journal: [
        {
          turnId: "turn_resume",
          eventType: "tasks.todo_write",
          payload: {
            items: [],
          },
        },
      ],
    }));
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close, recover },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["resume", "session_resume"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(recover).toHaveBeenCalledWith("session_resume");
    expect(runTurn).not.toHaveBeenCalled();
    expect(output).toContain(
      "Resume execution skipped: could not recover original user input for turn turn_resume.",
    );
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_resume",
      kind: "cli.resume.completed",
      payload: {
        firstStep: "draft intro",
        checkpointId: 4,
        checkpointUptoSeq: 9,
        lastAppliedSeq: 12,
        journalEvents: 6,
        auditEvents: 2,
        streamEvents: 1,
        latestTurnId: "turn_resume",
        latestTurnProviderId: null,
        latestTurnModel: null,
        recoveryProviderId: "scripted",
        recoveryModel: "fake-model",
        recoverySelectionSource: "default-fallback",
        recoveryReasoningStrategy: null,
        recoveryReasoningSource: "surface-default",
        resumable: true,
        guidance: "Continue step 1 before branching into new work.",
        resumeAction: "continue-current-step",
        replayWindow: {
          fromSeqExclusive: 9,
          toSeqInclusive: 12,
        },
        nextStepIndex: 1,
        lastStepEventType: "step.tools_planned",
        toolOutcomes: {
          total: 1,
          executed: 0,
          denied: 0,
          approvalRequired: 0,
          degraded: 1,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        runtimeStatus: "degraded",
        resumeExecuted: false,
        resumeExecutionReason: "missing-user-input",
        resumedProviderId: null,
        resumedModel: null,
        resumedTodoCount: null,
        resumedToolOutcomes: null,
        resumedRuntimeStatus: null,
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("falls back to persisted latest-turn reasoning when stream reasoning is unavailable", async () => {
    const runTurn = vi.fn().mockResolvedValue({
      sessionId: "session_resume_latest_turn",
      output: "completed after resume",
      taskState: {
        items: [{ id: "todo_1", content: "Ship the outline", status: "todo" }],
      },
      toolResults: [],
    });
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessionId: "session_resume_latest_turn",
        requestedCheckpointId: null,
        checkpointId: 4,
        checkpointUptoSeq: 9,
        firstTodo: "draft intro",
        lastAppliedSeq: 12,
        journalEvents: 6,
        auditEvents: 2,
        streamEvents: 0,
        latestTurnId: "turn_resume_latest_turn",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        recoveryProviderId: "openai-live",
        recoveryModel: "gpt-5-mini",
        recoverySelectionSource: "persisted-runtime",
        recoveryReasoningStrategy: "plan-execute",
        recoveryReasoningSource: "latest-turn-fallback",
        resumable: true,
        guidance: "Continue step 1 before branching into new work.",
        resumeAction: "continue-current-step",
        nextStepIndex: 1,
        runtimeStatus: "healthy",
        toolOutcomes: {
          total: 0,
          executed: 0,
          denied: 0,
          approvalRequired: 0,
          degraded: 0,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
      },
    });
    const recover = vi.fn(() => ({
      journal: [
        {
          turnId: "turn_resume_latest_turn",
          eventType: "user.input",
          payload: {
            text: "Resume the interrupted outline run.",
          },
        },
      ],
    }));
    const listStreamEvents = vi.fn(() => []);
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      providerIds: ["scripted", "openai-live"],
      engine: { runTurn },
      sessionStore: { close, recover, listStreamEvents },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["resume", "session_resume_latest_turn"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(runTurn).toHaveBeenCalledWith({
      sessionId: "session_resume_latest_turn",
      turnId: "turn_resume_latest_turn",
      userText: "Resume the interrupted outline run.",
      providerId: "openai-live",
      model: "gpt-5-mini",
      reasoningStrategy: "plan-execute",
      estimatedComplexity: "medium",
      requiresTools: true,
    });
    expect(output).toContain("Recovery reasoning source: latest-turn-fallback");
    expect(output).toContain("Recovery reasoning strategy: plan-execute");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("startCli task and status control-plane paths", () => {
  test("dispatches task status through control-plane and renders summary", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        schemaVersion: "0.1.0",
        todos: {
          items: [{ id: "t1", content: "First task", status: "todo" }],
        },
        delegation: [
          {
            id: "d1",
            taskId: "t1",
            workerId: "worker-a",
            status: "completed",
            specialization: "plan",
            targetAgent: "plan-agent",
            verificationRequest: {
              verifierId: "verify-a",
              verificationId: "v1",
              requirement: "First task passes verification",
            },
          },
        ],
        verification: [{ id: "v1", taskId: "t1", verifierId: "verify-a", status: "passed" }],
        proposalQueue: [],
        proposalOutbox: [],
        notifications: [
          {
            id: "n1",
            kind: "delegation_assigned",
            recipientKind: "worker",
            recipientId: "worker-a",
            status: "acknowledged",
            summary: "Delegation d1 is queued for worker worker-a.",
            taskId: "t1",
            delegationId: "d1",
          },
        ],
        lifecycle: [
          {
            taskId: "t1",
            title: "First task",
            status: "verified",
            todoStatus: "todo",
            assignedAgent: "plan-agent",
            verificationVerdict: "pass",
            latestDelegationId: "d1",
            latestVerificationId: "v1",
          },
        ],
        subagentRuns: [
          {
            subagentId: "d1",
            parentTurnId: "turn-parent",
            profileId: "plan-agent",
            workerId: "worker-a",
            taskId: "t1",
            status: "completed",
            role: "plan",
            targetAgent: "plan-agent",
            isolatedContext: true,
            instruction: "First subagent task",
            resultSummary: "Child task finished.",
            verification: {
              verificationId: "v1",
              verifierId: "verify-a",
              status: "passed",
              verdict: "pass",
              requirement: "First task passes verification",
            },
            parentVisibleResult: {
              status: "completed",
              summary: "Child task finished.",
              verificationVerdict: "pass",
            },
          },
        ],
        subagentSchedulerHeartbeat: {
          schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1",
          parentTurnId: "turn-parent",
          totalSubagentRuns: 1,
          queuedCount: 0,
          runningCount: 0,
          completedCount: 1,
          failedCount: 0,
          cancelledCount: 0,
          schedulerTrackedCount: 0,
          readyCount: 0,
          blockedCount: 0,
          unscheduledQueuedCount: 0,
          nextReadySubagentIds: [],
          blockedSubagentIds: [],
          runningSubagentIds: [],
          canContinue: false,
          stoppedReason: "mailbox-empty",
          heartbeatOrdinal: 1_700_000_001_000,
          latestUpdatedAtMs: 1_700_000_001_000,
        },
        subagentSchedulerDispatchPlan: {
          schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
          parentTurnId: "turn-parent",
          planOrdinal: 1_700_000_001_000,
          heartbeatOrdinal: 1_700_000_001_000,
          canDispatch: false,
          dispatchReason: "mailbox-empty",
          maxDispatchableCount: 0,
          dispatchableSubagentIds: [],
          dispatchBatches: [],
          blockedSubagentIds: [],
          runningSubagentIds: [],
        },
        subagentSchedulerTick: {
          schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
          sessionId: "session_1",
          latestTurnId: "turn-parent",
          dispatchIntents: [],
          claimDryRun: true,
        },
        subagentSchedulerRecoveryPlan: {
          schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
          parentTurnId: "turn-parent",
          canRecover: true,
          blockedSubagentIds: ["d2"],
          conflictedSubagentIds: ["d1", "d2"],
          recoveryActions: [
            {
              actionId: "recover_d2_write_set_overlap",
              subagentId: "d2",
              actionType: "wait-for-running-subagent",
              severity: "info",
              reason: "write-set-overlap: src/task.ts",
              relatedSubagentIds: ["d1"],
              writeSet: ["src/task.ts"],
              evidence: {
                blockedBy: ["d1"],
                conflictsWith: ["d1"],
              },
              operatorSummary: "Wait for running subagent d1 before unblocking d2.",
            },
          ],
          recoveryGroups: [
            {
              groupId: "recovery_group_write_set_overlap_src_task_ts",
              groupType: "write-set-overlap",
              severity: "info",
              reason: "write-set-overlap: src/task.ts",
              actionIds: ["recover_d2_write_set_overlap"],
              subagentIds: ["d2", "d1"],
              runningSubagentIds: ["d1"],
              blockedSubagentIds: ["d2"],
              completedSubagentIds: [],
              writeSet: ["src/task.ts"],
              operatorSummary:
                "Review write-set-overlap recovery group for src/task.ts: 1 running, 1 blocked, 0 completed.",
            },
          ],
          recoveryOrdinal: 1_700_000_001_000,
        },
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["task", "status", "session_1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "task-status",
      sessionId: "session_1",
    });
    expect(output).toContain("Task action: task-status");
    expect(output).toContain("Todos: 1");
    expect(output).toContain("Notifications: 1");
    expect(output).toContain("Notification summary: acknowledged/worker=1");
    expect(output).toContain(
      "n1 kind=delegation_assigned status=acknowledged recipient=worker:worker-a task=t1",
    );
    expect(output).toContain("Lifecycle: 1");
    expect(output).toContain("Lifecycle summary: verified=1");
    expect(output).toContain(
      "d1 worker=worker-a status=completed specialization=plan target=plan-agent task=t1 verify=verify-a verification=v1",
    );
    expect(output).toContain("Subagent runs: 1");
    expect(output).toContain("Subagent summary: completed=1");
    expect(output).toContain(
      "Subagent scheduler: ready=0 blocked=0 running=0 unscheduled=0 canContinue=false stopped=mailbox-empty heartbeat=1700000001000",
    );
    expect(output).toContain(
      "Subagent dispatch plan: canDispatch=false reason=mailbox-empty max=0 plan=1700000001000 heartbeat=1700000001000",
    );
    expect(output).toContain("Subagent scheduler tick: intents=0 claimDryRun=true");
    expect(output).toContain(
      "Subagent recovery plan: canRecover=true actions=1 groups=1 blocked=d2 conflicted=d1,d2 group=recovery_group_write_set_overlap_src_task_ts@type=write-set-overlap@severity=info@writeSet=src/task.ts@running=1@blocked=1@completed=0 next=d2@type=wait-for-running-subagent@severity=info@reason=write-set-overlap: src/task.ts@related=d1 recovery=1700000001000",
    );
    expect(output).toContain(
      "d1 parent=turn-parent profile=plan-agent worker=worker-a status=completed role=plan target=plan-agent isolated=true task=t1 verification=pass summary=Child task finished.",
    );
    expect(output).toContain("t1 status=verified title=First task todo=todo assigned=plan-agent");
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.task.completed",
      payload: {
        action: "task-status",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches task mailbox through control-plane and renders worker mailbox snapshot", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        workerId: "worker-a",
        mailboxSize: 1,
        notificationCount: 1,
        coverage: "aligned",
        delegationIds: ["d1"],
        notificationIds: ["notification_delegation_d1"],
        unnotifiedDelegationIds: [],
        orphanNotificationIds: [],
        items: [
          {
            id: "d1",
            workerId: "worker-a",
            instruction: "Implement mailbox surface",
            status: "queued",
            taskId: "t1",
            specialization: "plan",
            targetAgent: "plan-agent",
            verificationRequest: {
              verifierId: "verify-a",
              verificationId: "v1",
              requirement: "Mailbox surface passes",
            },
            notificationId: "notification_delegation_d1",
            notificationStatus: "pending",
            notificationSummary: "Delegation d1 is queued for worker worker-a.",
          },
        ],
        notifications: [
          {
            id: "notification_delegation_d1",
            kind: "delegation_assigned",
            recipientKind: "worker",
            recipientId: "worker-a",
            status: "pending",
            summary: "Delegation d1 is queued for worker worker-a.",
            taskId: "t1",
            delegationId: "d1",
          },
        ],
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["task", "mailbox", "session_1", "--worker", "worker-a"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "task-worker-mailbox",
      sessionId: "session_1",
      workerId: "worker-a",
    });
    expect(output).toContain("Task action: task-worker-mailbox");
    expect(output).toContain("Worker mailbox: worker-a");
    expect(output).toContain("Mailbox size: 1");
    expect(output).toContain("Notification count: 1");
    expect(output).toContain("Coverage: aligned");
    expect(output).toContain("Delegations: d1");
    expect(output).toContain("Notifications: notification_delegation_d1");
    expect(output).toContain(
      "d1 worker=worker-a status=queued specialization=plan target=plan-agent task=t1 verify=verify-a verification=v1 notification=notification_delegation_d1 notificationStatus=pending requirement=Mailbox surface passes instruction=Implement mailbox surface",
    );
    expect(output).toContain(
      "notification_delegation_d1 kind=delegation_assigned status=pending recipient=worker:worker-a task=t1 delegation=d1",
    );
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.task.completed",
      payload: {
        action: "task-worker-mailbox",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches verifier mailbox through control-plane and renders verifier mailbox snapshot", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        verifierId: "verify-a",
        mailboxSize: 1,
        notificationCount: 1,
        coverage: "aligned",
        verificationIds: ["v1"],
        notificationIds: ["notification_verification_v1"],
        unnotifiedVerificationIds: [],
        orphanNotificationIds: [],
        items: [
          {
            id: "v1",
            verifierId: "verify-a",
            requirement: "Verifier mailbox surface passes",
            status: "pending",
            taskId: "t1",
            notificationId: "notification_verification_v1",
            notificationStatus: "pending",
            notificationSummary: "Verification v1 is pending for verifier verify-a.",
          },
        ],
        notifications: [
          {
            id: "notification_verification_v1",
            kind: "verification_requested",
            recipientKind: "verifier",
            recipientId: "verify-a",
            status: "pending",
            summary: "Verification v1 is pending for verifier verify-a.",
            taskId: "t1",
            verificationId: "v1",
          },
        ],
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["task", "verifier-mailbox", "session_1", "--verifier", "verify-a"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "task-verifier-mailbox",
      sessionId: "session_1",
      verifierId: "verify-a",
    });
    expect(output).toContain("Task action: task-verifier-mailbox");
    expect(output).toContain("Verifier mailbox: verify-a");
    expect(output).toContain("Mailbox size: 1");
    expect(output).toContain("Notification count: 1");
    expect(output).toContain("Coverage: aligned");
    expect(output).toContain("Verifications: v1");
    expect(output).toContain("Notifications: notification_verification_v1");
    expect(output).toContain(
      "v1 verifier=verify-a status=pending task=t1 notification=notification_verification_v1 notificationStatus=pending requirement=Verifier mailbox surface passes",
    );
    expect(output).toContain(
      "notification_verification_v1 kind=verification_requested status=pending recipient=verifier:verify-a task=t1 verification=v1",
    );
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.task.completed",
      payload: {
        action: "task-verifier-mailbox",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches proposal-get through control-plane and renders proposal json", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        id: "p1",
        kind: "tasks.todo_write",
        status: "accepted",
        payload: {
          items: [{ id: "todo_1", content: "Proposal todo", status: "todo" }],
        },
        sourceSessionId: "session_1",
        sourceTurnId: "turn_1",
        provenance: "worker-jobs/reconcile",
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["task", "proposal-get", "session_1", "--proposal-id", "p1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "proposal-get",
      sessionId: "session_1",
      proposalId: "p1",
    });
    expect(output).toContain("Task action: proposal-get");
    expect(output).toContain('"kind": "tasks.todo_write"');
    expect(output).toContain('"status": "accepted"');
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.task.completed",
      payload: {
        action: "proposal-get",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches proposal-apply through control-plane and renders updated task state", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        schemaVersion: "0.1.0",
        todos: {
          items: [{ id: "t1", content: "Applied todo", status: "todo" }],
        },
        delegation: [],
        verification: [],
        proposalQueue: [
          {
            id: "p1",
            kind: "tasks.todo_write",
            status: "applied",
            provenance: "worker-jobs/reconcile",
          },
        ],
        proposalOutbox: [],
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["task", "proposal-apply", "session_1", "--proposal-id", "p1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "proposal-apply",
      sessionId: "session_1",
      proposalId: "p1",
    });
    expect(output).toContain("Task action: proposal-apply");
    expect(output).toContain("Todos: 1");
    expect(output).toContain("status=applied");
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.task.completed",
      payload: {
        action: "proposal-apply",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches proposal-list through control-plane and renders proposal summaries", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        {
          id: "p1",
          kind: "skills.snapshot_upsert",
          status: "pending",
          provenance: "worker-jobs/trajectory-summary",
          riskLevel: "medium",
          confidence: 0.62,
        },
        {
          id: "p2",
          kind: "skills.snapshot_upsert",
          status: "accepted",
          provenance: "worker-jobs/trajectory-summary",
          riskLevel: "low",
          confidence: 0.91,
        },
      ],
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["task", "proposal-list", "session_1", "--status", "pending", "--limit", "2"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "proposal-list",
      sessionId: "session_1",
      status: "pending",
      limit: 2,
    });
    expect(output).toContain("Task action: proposal-list");
    expect(output).toContain("Proposal items: 2");
    expect(output).toContain("p1 kind=skills.snapshot_upsert status=pending");
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.task.completed",
      payload: {
        action: "proposal-list",
      },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("dispatches proposal-review and proposal-explain through control-plane", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          proposalId: "p1",
          verdict: "accepted",
          decisionNote: "Accepted after structured review.",
          summary: {
            fatal: 0,
            risky: 1,
            warning: 1,
            info: 0,
          },
          issues: [
            {
              code: "high_risk_level",
              field: "riskLevel",
              message: "High risk proposals require manual attention.",
              severity: "risky",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          proposalId: "p1",
          kind: "skills.snapshot_upsert",
          status: "pending",
          provenance: "worker-jobs/trajectory-summary",
          trigger: "Summarize the repository.",
          evidenceSummary: "Opened README and summarized the repo structure.",
          riskLevel: "medium",
          confidence: 0.62,
          explanation: "Matches a repeated README summarization workflow.",
        },
      });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["task", "proposal-review", "session_1", "--proposal-id", "p1"]);
    await startCli(["task", "proposal-explain", "session_1", "--proposal-id", "p1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "proposal-review",
      sessionId: "session_1",
      proposalId: "p1",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "proposal-explain",
      sessionId: "session_1",
      proposalId: "p1",
    });
    expect(output).toContain("Task action: proposal-review");
    expect(output).toContain("Review summary:");
    expect(output).toContain("risky=1");
    expect(output).toContain("Task action: proposal-explain");
    expect(output).toContain("Evidence: Opened README and summarized the repo structure.");
    expect(output).toContain("Risk: medium");
    expect(close).toHaveBeenCalledTimes(2);
  });

  test("dispatches proposal-preview and proposal-rollback through control-plane", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          proposalId: "p1",
          proposalStatus: "accepted",
          skillId: "skill.readme-summary",
          operation: "update",
          currentHeadVersion: 1,
          nextHeadVersion: 2,
          changedFields: [{ field: "content" }, { field: "updatedAtMs" }],
          summary: "update skill.readme-summary with 2 changed field(s): content, updatedAtMs",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          currentVersionBefore: 2,
          restoredFromVersion: 1,
          currentVersionAfter: 3,
          previousSnapshotVersion: 2,
          approvedSkillCount: 1,
          restoredSkillIds: ["skill.readme-summary"],
        },
      });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: { close },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["task", "proposal-preview", "session_1", "--proposal-id", "p1"]);
    await startCli(["task", "proposal-rollback", "session_1", "--version", "1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "proposal-preview",
      sessionId: "session_1",
      proposalId: "p1",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "proposal-rollback",
      sessionId: "session_1",
      version: 1,
    });
    expect(output).toContain("Task action: proposal-preview");
    expect(output).toContain("Proposal preview:");
    expect(output).toContain("Head version: 1 -> 2");
    expect(output).toContain("Task action: proposal-rollback");
    expect(output).toContain("Proposal rollback:");
    expect(output).toContain("Restored from version: 1");
    expect(close).toHaveBeenCalledTimes(2);
  });

  test("prefers control-plane status snapshot when available", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        firstTodo: "From control plane",
        lastAppliedSeq: 7,
        journalEvents: 2,
        agentOsTimelineSummary: {
          totalEvents: 4,
          firstSequence: 3,
          lastSequence: 6,
          latestEventType: "final.delivered",
          approvalEvents: 0,
          memoryEvents: 0,
          skillEvents: 0,
          subagentEvents: 0,
          toolEvents: 1,
          controlPlaneEvents: 1,
          finalDelivered: true,
        },
        latestTurnId: "turn_cp",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        auditEvents: 3,
        streamEvents: 1,
        step: {
          turnId: "turn_cp",
          resumeAction: "turn-complete",
          replayWindow: {
            fromSeqExclusive: 2,
            toSeqInclusive: 6,
          },
          nextStepIndex: 2,
          stepJournalEvents: 4,
          modelOutputEvents: 1,
          plannedToolEvents: 1,
          toolResultEvents: 1,
          finalOutputEvents: 1,
          toolOutcomes: {
            total: 1,
            executed: 1,
            denied: 0,
            approvalRequired: 0,
            degraded: 0,
            failed: 0,
            missing: 0,
            unknown: 0,
          },
          runtimeStatus: "healthy",
          promptSummary: {
            stepIndex: 1,
            previousStepIndex: 0,
            usedTokens: 620,
            remainingTokens: 1380,
            runtimeShellSectionIds: ["system.runtime"],
            runtimeShellSectionSummaries: ["runtime shell"],
            staticGuidanceSectionIds: [
              "system.output-style",
              "system.permission-mode",
              "system.response-language",
            ],
            staticGuidanceSectionSummaries: [
              "default output style guidance",
              "default permission mode guidance",
              "default response language guidance",
            ],
            focusSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
            focusSectionSummaries: ["tool results", "session guidance", "tool runtime guidance"],
            omittedSectionIds: ["runtime.degradations"],
            omittedSectionSummaries: ["runtime degradations"],
            runtimeDegradations: [
              {
                stage: "context",
                category: "budget",
                severity: "warn",
                reason: "token_budget_low",
                message: "Prompt recall sections were trimmed by budget.",
              },
            ],
            addedDynamicSectionIds: ["tool-results", "runtime.tool-status"],
            addedDynamicSectionSummaries: ["tool results", "tool runtime guidance"],
            removedDynamicSectionIds: ["user-input"],
            removedDynamicSectionSummaries: ["user input"],
            newlyOmittedSectionIds: ["runtime.degradations"],
            newlyOmittedSectionSummaries: ["runtime degradations"],
            restoredOmittedSectionIds: ["working-memory.recall-1"],
            restoredOmittedSectionSummaries: ["working memory recall 1"],
            sessionGuidance: {
              outputStyle: "verbose",
              permissionMode: "ask",
            },
            effectiveGuidanceSources: {
              outputStyle: "session-override",
              permissionMode: "session-override",
              responseLanguage: "runtime-default",
            },
            toolRuntimeGuidance: {
              impactedTools: 4,
              status: "degraded",
              previewedTools: 3,
              previewTruncated: true,
              toolPreview:
                "filesystem.read_text:degraded|tasks.todo_write:approval_required|tools.exec:missing",
              metaImpactedTools: 3,
              metaPreviewedTools: 2,
              metaPreviewTruncated: true,
              toolMetaPreview:
                "filesystem.read_text[availability=missing-env,env=HOTFLOW_TOKEN]|tasks.todo_write[approval=pending]",
            },
            turnResumeGuidance: {
              resumeAction: "continue-current-step",
              nextStepIndex: 1,
              recoveredToolResults: 1,
            },
            latestTurnGuidance: {
              turnId: "turn_previous",
              runtimeStatus: "blocked",
              turnBranch: "approval-required",
              reasoning: {
                strategy: "plan-execute",
                confidence: 0.9,
                rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
                suggestedAction: "tool",
              },
            },
            runtimeDegradationSummaries: ["budget trim [warn]"],
          },
        },
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: {
        close,
        recover: vi.fn(() => {
          throw new Error("should not call local recover when control-plane snapshot is valid");
        }),
      },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["status", "session_1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "status",
      sessionId: "session_1",
      observe: {
        includeRecovery: true,
        includeAudit: true,
        includeStream: true,
        includeToolOutcomes: true,
        includeRuntimeStatus: true,
      },
    });
    expect(output).toContain("First step: From control plane");
    expect(output).toContain(
      "Agent OS timeline: events=4 seq=3..6 latest=final.delivered tools=1 control=1 final=yes",
    );
    expect(output).toContain("Latest turn: turn_cp");
    expect(output).toContain("Latest turn provider: openai-live");
    expect(output).toContain("Latest turn model: gpt-5-mini");
    expect(output).toContain("Latest prompt step: 1 (prev 0)");
    expect(output).toContain(
      "Effective guidance: output-style=verbose permission-mode=ask response-language=follow-user",
    );
    expect(output).toContain(
      "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
    );
    expect(output).toContain("Prompt focus: tool results, session guidance, tool runtime guidance");
    expect(output).toContain("Prompt omissions: runtime degradations");
    expect(output).toContain("Prompt runtime shell: runtime shell");
    expect(output).toContain(
      "Prompt static guidance: default output style guidance, default permission mode guidance, default response language guidance",
    );
    expect(output).toContain(
      "Prompt guidance: output-style=verbose permission-mode=ask response-language=follow-user",
    );
    expect(output).toContain(
      "Prompt guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
    );
    expect(output).toContain("Tool runtime guidance: degraded (4 impacted tools)");
    expect(output).toContain(
      "Tool runtime details: filesystem.read_text: degraded, tasks.todo_write: approval required, tools.exec: missing (+1 more)",
    );
    expect(output).toContain(
      "Tool runtime metadata: filesystem.read_text [availability=missing-env,env=HOTFLOW_TOKEN], tasks.todo_write [approval=pending] (+1 more)",
    );
    expect(output).toContain(
      "Turn resume guidance: continue current step -> step 1 1 recovered tool result",
    );
    expect(output).toContain(
      "Latest turn guidance: prior turn turn_previous blocked (approval required) using plan-execute (confidence=0.9; suggested action=tool)",
    );
    expect(output).toContain(
      "Latest turn reasoning rationale: tool-heavy work benefits from an explicit plan/execute turn strategy",
    );
    expect(output).toContain("Prompt degradations: budget trim [warn]");
    expect(output).toContain(
      "Prompt changes: +tool results +tool runtime guidance -user input omit:+runtime degradations restore:working memory recall 1",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("renders first-build wording consistently in status prompt summary", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        firstTodo: "First build from control plane",
        lastAppliedSeq: 3,
        journalEvents: 1,
        latestTurnId: "turn_first_build",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        latestTurnRuntimeDegradationSummaries: ["budget trim [warn]"],
        auditEvents: 1,
        streamEvents: 0,
        step: {
          turnId: "turn_first_build",
          resumeAction: "continue-current-step",
          replayWindow: {
            fromSeqExclusive: 0,
            toSeqInclusive: 3,
          },
          nextStepIndex: 1,
          stepJournalEvents: 1,
          modelOutputEvents: 0,
          plannedToolEvents: 0,
          toolResultEvents: 0,
          finalOutputEvents: 0,
          toolOutcomes: {
            total: 0,
            executed: 0,
            denied: 0,
            approvalRequired: 0,
            degraded: 0,
            failed: 0,
            missing: 0,
            unknown: 0,
          },
          runtimeStatus: "healthy",
          promptSummary: {
            stepIndex: 0,
            usedTokens: 480,
            remainingTokens: 1520,
            focusSectionIds: ["user-input", "session.guidance"],
            focusSectionSummaries: ["user input", "session guidance"],
            omittedSectionIds: ["working-memory.recall-1"],
            omittedSectionSummaries: ["working memory recall 1"],
            runtimeDegradations: [],
            addedDynamicSectionIds: ["user-input", "session.guidance"],
            addedDynamicSectionSummaries: ["user input", "session guidance"],
            removedDynamicSectionIds: [],
            newlyOmittedSectionIds: ["working-memory.recall-1"],
            newlyOmittedSectionSummaries: ["working memory recall 1"],
            restoredOmittedSectionIds: [],
          },
        },
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: {
        close,
        recover: vi.fn(() => {
          throw new Error("should not call local recover when control-plane snapshot is valid");
        }),
      },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["status", "session_1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Latest prompt step: 0 (first prompt build in the turn)");
    expect(output).toContain("Prompt focus: user input, session guidance");
    expect(output).toContain("Prompt omissions: working memory recall 1");
    expect(output).toContain("Prompt degradations: (none)");
    expect(output).toContain("Prompt changes: first prompt build in the turn");
    expect(output).not.toContain("Latest turn prompt degradations:");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("does not render latest turn tool runtime guidance fallback when status prompt summary exists without tool runtime guidance", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        firstTodo: "Prompt summary should win",
        lastAppliedSeq: 3,
        journalEvents: 1,
        latestTurnId: "turn_status_prompt_summary_without_tool_runtime_guidance",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        latestTurnToolRuntimeGuidance: {
          status: "blocked",
          impactedTools: 2,
          previewedTools: 2,
          toolPreview: "filesystem.read_text:missing|tasks.todo_write:approval_required",
          metaImpactedTools: 2,
          metaPreviewedTools: 2,
          toolMetaPreview:
            "filesystem.read_text[availability=missing-env,env=OPENAI_API_KEY]|tasks.todo_write[approval=pending]",
        },
        auditEvents: 0,
        streamEvents: 0,
        step: {
          turnId: "turn_status_prompt_summary_without_tool_runtime_guidance",
          resumeAction: "continue-current-step",
          replayWindow: {
            fromSeqExclusive: 0,
            toSeqInclusive: 3,
          },
          nextStepIndex: 0,
          lastStepEventType: "step.context_built",
          stepJournalEvents: 1,
          modelOutputEvents: 0,
          plannedToolEvents: 0,
          toolResultEvents: 0,
          finalOutputEvents: 0,
          toolOutcomes: {
            total: 0,
            executed: 0,
            denied: 0,
            approvalRequired: 0,
            degraded: 0,
            failed: 0,
            missing: 0,
            unknown: 0,
          },
          runtimeStatus: "healthy",
          promptSummary: {
            stepIndex: 0,
            usedTokens: 500,
            remainingTokens: 1500,
            focusSectionIds: ["user-input", "session.guidance"],
            focusSectionSummaries: ["user input", "session guidance"],
            omittedSectionIds: [],
            runtimeDegradations: [],
            addedDynamicSectionIds: ["user-input", "session.guidance"],
            addedDynamicSectionSummaries: ["user input", "session guidance"],
            removedDynamicSectionIds: [],
            newlyOmittedSectionIds: [],
            restoredOmittedSectionIds: [],
          },
        },
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: {
        close,
        recover: vi.fn(() => {
          throw new Error("should not call local recover when control-plane snapshot is valid");
        }),
      },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["status", "session_1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain(
      "Latest turn: turn_status_prompt_summary_without_tool_runtime_guidance",
    );
    expect(output).toContain("Latest prompt step: 0 (first prompt build in the turn)");
    expect(output).toContain("Prompt focus: user input, session guidance");
    expect(output).toContain("Prompt degradations: (none)");
    expect(output).not.toContain("Latest turn tool runtime guidance:");
    expect(output).not.toContain("Latest turn tool runtime details:");
    expect(output).not.toContain("Latest turn tool runtime metadata:");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("renders persisted latest turn tool runtime guidance when status has no step replay", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        firstTodo: "From control plane",
        lastAppliedSeq: 3,
        journalEvents: 1,
        workingMemoryEntries: 2,
        episodicMemoryEntries: 1,
        latestMemoryControl: {
          action: "clear",
          scope: "working",
          journalSeq: 8,
          occurredAtMs: Date.parse("2026-04-18T09:00:00.000Z"),
          beforeWorkingMemoryEntries: 3,
          beforeEpisodicMemoryEntries: 1,
          afterWorkingMemoryEntries: 2,
          afterEpisodicMemoryEntries: 1,
        },
        latestGuidanceControl: {
          action: "response-language",
          value: "zh-CN",
          previousValue: "follow-user",
          journalSeq: 9,
          occurredAtMs: Date.parse("2026-04-18T09:05:00.000Z"),
        },
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
        },
        latestTurnId: "turn_latest_turn_fallback",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        latestTurnRuntimeStatus: "blocked",
        latestTurnTurnBranch: "approval-required",
        latestTurnFinishReason: "length",
        latestTurnCompletedSteps: 4,
        latestTurnResumeAction: "continue-current-step",
        latestTurnNextStepIndex: 1,
        latestTurnLastStepEventType: "step.tools_planned",
        latestTurnToolCount: 3,
        latestTurnToolOutcomes: {
          total: 3,
          executed: 1,
          denied: 0,
          approvalRequired: 1,
          degraded: 1,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        latestTurnReasoning: {
          strategy: "plan-execute",
          confidence: 0.9,
          rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
          suggestedAction: "tool",
        },
        latestTurnToolRuntimeGuidance: {
          status: "blocked",
          impactedTools: 2,
          previewedTools: 2,
          toolPreview: "filesystem.read_text:missing|tasks.todo_write:approval_required",
          metaImpactedTools: 2,
          metaPreviewedTools: 2,
          toolMetaPreview:
            "filesystem.read_text[availability=missing-env,env=OPENAI_API_KEY]|tasks.todo_write[approval=pending]",
        },
        latestTurnRuntimeDegradationSummaries: [
          "budget trim [warn]",
          "tool replay trim (filesystem.read_text) [warn]",
        ],
        auditEvents: 0,
        streamEvents: 0,
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: {
        close,
        recover: vi.fn(() => {
          throw new Error("should not call local recover when control-plane snapshot is valid");
        }),
      },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["status", "session_1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Working memory entries: 2");
    expect(output).toContain("Episodic memory entries: 1");
    expect(output).toContain("Latest memory control: clear (scope=working)");
    expect(output).toContain("Latest memory control detail: working 3 -> 2; episodic 1 -> 1");
    expect(output).toContain("Latest memory control journal: seq 8 at 2026-04-18T09:00:00.000Z");
    expect(output).toContain("Latest guidance control: response-language=zh-CN");
    expect(output).toContain("Latest guidance control detail: follow-user -> zh-CN");
    expect(output).toContain("Latest guidance control journal: seq 9 at 2026-04-18T09:05:00.000Z");
    expect(output).toContain(
      "Effective guidance: output-style=concise permission-mode=deny response-language=follow-user",
    );
    expect(output).toContain("Session guidance: output-style=concise permission-mode=deny");
    expect(output).toContain("Latest turn: turn_latest_turn_fallback");
    expect(output).toContain("Latest turn provider: openai-live");
    expect(output).toContain("Latest turn model: gpt-5-mini");
    expect(output).toContain(
      "Latest turn reasoning: using plan-execute (confidence=0.9; suggested action=tool)",
    );
    expect(output).toContain(
      "Latest turn reasoning rationale: tool-heavy work benefits from an explicit plan/execute turn strategy",
    );
    expect(output).toContain("Latest turn tool runtime guidance: blocked (2 impacted tools)");
    expect(output).toContain(
      "Latest turn tool runtime details: filesystem.read_text: missing, tasks.todo_write: approval required",
    );
    expect(output).toContain(
      "Latest turn tool runtime metadata: filesystem.read_text [availability=missing-env,env=OPENAI_API_KEY], tasks.todo_write [approval=pending]",
    );
    expect(output).toContain(
      "Latest turn prompt degradations: budget trim [warn]; tool replay trim (filesystem.read_text) [warn]",
    );
    expect(output).toContain("Latest turn state: blocked (approval required)");
    expect(output).toContain("Latest turn finish: length (4 completed steps)");
    expect(output).toContain("Latest turn tool count: 3");
    expect(output).toContain(
      "Latest turn tool outcomes: executed=1, denied=0, approval_required=1, degraded=1, failed=0, missing=0, unknown=0",
    );
    expect(output).toContain("Latest turn resume action: continue-current-step");
    expect(output).toContain("Latest turn next step index: 1");
    expect(output).toContain("Latest turn last step event: step.tools_planned");
    expect(output).not.toContain("Step recovery:");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("prefers persisted latest turn continuity when status only has a checkpoint shell", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        firstTodo: "From control plane",
        lastAppliedSeq: 3,
        journalEvents: 1,
        workingMemoryEntries: 2,
        episodicMemoryEntries: 1,
        latestMemoryControl: {
          action: "clear",
          scope: "working",
          journalSeq: 8,
          occurredAtMs: Date.parse("2026-04-18T09:00:00.000Z"),
          beforeWorkingMemoryEntries: 3,
          beforeEpisodicMemoryEntries: 1,
          afterWorkingMemoryEntries: 2,
          afterEpisodicMemoryEntries: 1,
        },
        latestGuidanceControl: {
          action: "response-language",
          value: "zh-CN",
          previousValue: "follow-user",
          journalSeq: 9,
          occurredAtMs: Date.parse("2026-04-18T09:05:00.000Z"),
        },
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
        },
        latestTurnId: "turn_latest_turn_checkpoint_shell",
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        latestTurnRuntimeStatus: "blocked",
        latestTurnTurnBranch: "approval-required",
        latestTurnFinishReason: "length",
        latestTurnCompletedSteps: 4,
        latestTurnResumeAction: "continue-current-step",
        latestTurnNextStepIndex: 1,
        latestTurnLastStepEventType: "step.tools_planned",
        latestTurnToolCount: 3,
        latestTurnToolOutcomes: {
          total: 3,
          executed: 1,
          denied: 0,
          approvalRequired: 1,
          degraded: 1,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        auditEvents: 0,
        streamEvents: 0,
        step: {
          turnId: "turn_latest_turn_checkpoint_shell",
          resumeAction: "continue-current-step",
          replayWindow: {
            fromSeqExclusive: 1,
            toSeqInclusive: 1,
          },
          nextStepIndex: 0,
          stepJournalEvents: 0,
          modelOutputEvents: 0,
          plannedToolEvents: 0,
          toolResultEvents: 0,
          finalOutputEvents: 0,
          toolOutcomes: {
            total: 0,
            executed: 0,
            denied: 0,
            approvalRequired: 0,
            degraded: 0,
            failed: 0,
            missing: 0,
            unknown: 0,
          },
          runtimeStatus: "healthy",
        },
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: {
        close,
        recover: vi.fn(() => {
          throw new Error("should not call local recover when control-plane snapshot is valid");
        }),
      },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["status", "session_1"]);

    const output = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Working memory entries: 2");
    expect(output).toContain("Episodic memory entries: 1");
    expect(output).toContain("Latest memory control: clear (scope=working)");
    expect(output).toContain("Latest memory control detail: working 3 -> 2; episodic 1 -> 1");
    expect(output).toContain("Latest memory control journal: seq 8 at 2026-04-18T09:00:00.000Z");
    expect(output).toContain("Latest guidance control: response-language=zh-CN");
    expect(output).toContain("Latest guidance control detail: follow-user -> zh-CN");
    expect(output).toContain("Latest guidance control journal: seq 9 at 2026-04-18T09:05:00.000Z");
    expect(output).toContain(
      "Effective guidance: output-style=concise permission-mode=deny response-language=follow-user",
    );
    expect(output).toContain(
      "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
    );
    expect(output).toContain("Latest turn state: blocked (approval required)");
    expect(output).toContain("Latest turn finish: length (4 completed steps)");
    expect(output).toContain("Latest turn tool count: 3");
    expect(output).toContain(
      "Latest turn tool outcomes: executed=1, denied=0, approval_required=1, degraded=1, failed=0, missing=0, unknown=0",
    );
    expect(output).toContain("Step recovery:");
    expect(output).toContain("  Resume action: continue-current-step");
    expect(output).toContain("  Next step index: 1");
    expect(output).toContain("  Last step event: step.tools_planned");
    expect(output).toContain("  Runtime status: blocked");
    expect(recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "session_1",
      kind: "cli.status.completed",
      payload: expect.objectContaining({
        workingMemoryEntries: 2,
        episodicMemoryEntries: 1,
        latestMemoryControl: {
          action: "clear",
          scope: "working",
          journalSeq: 8,
          occurredAtMs: Date.parse("2026-04-18T09:00:00.000Z"),
          beforeWorkingMemoryEntries: 3,
          beforeEpisodicMemoryEntries: 1,
          afterWorkingMemoryEntries: 2,
          afterEpisodicMemoryEntries: 1,
        },
        latestGuidanceControl: {
          action: "response-language",
          value: "zh-CN",
          previousValue: "follow-user",
          journalSeq: 9,
          occurredAtMs: Date.parse("2026-04-18T09:05:00.000Z"),
        },
        sessionOutputStyle: "concise",
        sessionPermissionMode: "deny",
        effectiveGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "follow-user",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "session-override",
          responseLanguage: "runtime-default",
        },
        latestTurnId: "turn_latest_turn_checkpoint_shell",
        latestTurnRuntimeStatus: "blocked",
        latestTurnTurnBranch: "approval-required",
        latestTurnFinishReason: "length",
        latestTurnCompletedSteps: 4,
        latestTurnToolCount: 3,
        latestTurnToolOutcomes: {
          total: 3,
          executed: 1,
          denied: 0,
          approvalRequired: 1,
          degraded: 1,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        finishReason: "length",
        completedSteps: 4,
        resumeAction: "continue-current-step",
        nextStepIndex: 1,
        lastStepEventType: "step.tools_planned",
        toolCount: 3,
        toolOutcomes: {
          total: 3,
          executed: 1,
          denied: 0,
          approvalRequired: 1,
          degraded: 1,
          failed: 0,
          missing: 0,
          unknown: 0,
        },
        runtimeStatus: "blocked",
        turnBranch: "approval-required",
      }),
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("does not let empty healthy tool replay mask a persisted runtime failure in status", async () => {
    const runTurn = vi.fn();
    const recordAuditEvent = vi.fn();
    const close = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        firstTodo: "From control plane",
        lastAppliedSeq: 7,
        journalEvents: 5,
        latestTurnId: "turn_failed",
        latestTurnRuntimeStatus: "failed",
        auditEvents: 0,
        streamEvents: 0,
        step: {
          turnId: "turn_failed",
          resumeAction: "start-next-step",
          replayWindow: {
            fromSeqExclusive: 4,
            toSeqInclusive: 7,
          },
          nextStepIndex: 1,
          stepJournalEvents: 1,
          modelOutputEvents: 0,
          plannedToolEvents: 0,
          toolResultEvents: 0,
          finalOutputEvents: 0,
          toolOutcomes: {
            total: 0,
            executed: 0,
            denied: 0,
            approvalRequired: 0,
            degraded: 0,
            failed: 0,
            missing: 0,
            unknown: 0,
          },
          runtimeStatus: "failed",
        },
      },
    });
    mockBootstrapCli.mockReturnValue({
      config: {
        workspaceRoot: "/workspace",
        defaultProvider: "scripted",
        defaultModel: "fake-model",
      },
      engine: { runTurn },
      sessionStore: {
        close,
        recover: vi.fn(() => {
          throw new Error("should not call local recover when control-plane snapshot is valid");
        }),
      },
      telemetry: { recordAuditEvent },
      controlPlane: { dispatch },
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await startCli(["status", "session_failed"]);

    const lines = stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk))
      .join("")
      .split("\n");
    expect(lines).toContain("Runtime status: failed");
    expect(lines).not.toContain("Runtime status: healthy");
    expect(lines).toContain("  Runtime status: failed");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

function writeAcceptedProposalFixtureForCli(workspaceRoot: string, proposalId: string): void {
  const rootPath = join(workspaceRoot, ".director-angel", "runtime", "proposals");
  rmSync(rootPath, { recursive: true, force: true });
  mkdirSync(join(rootPath, "records"), { recursive: true });
  writeFileSync(
    join(rootPath, "index.json"),
    JSON.stringify({
      schemaVersion: "director.proposal.index.v1",
      updatedAt: "2026-04-13T16:20:00.000Z",
      entries: [
        {
          proposalId,
          kind: "director.trace_capture",
          status: "accepted",
          projectId: "project-knowledge-cli",
          groupId: "group-knowledge-cli",
          title: "Director method: CLI diff flow",
          riskLevel: "low",
          confidence: 0.95,
          updatedAt: "2026-04-13T16:20:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    join(rootPath, "records", `${proposalId}.json`),
    JSON.stringify({
      schemaVersion: "director.proposal.v1",
      proposalId,
      kind: "director.trace_capture",
      status: "accepted",
      provenance: "director-worker/proposal-ingest",
      recordId: `record-${proposalId}`,
      digestId: `digest-${proposalId}`,
      runId: `run-${proposalId}`,
      reportId: `report-${proposalId}`,
      projectId: "project-knowledge-cli",
      groupId: "group-knowledge-cli",
      title: "Director method: CLI diff flow",
      summary: "completed immersive run for CLI diff",
      trigger: "When validating knowledge candidate CLI commands.",
      evidenceSummary: "status=completed | roles=researcher, script-planner",
      explanation: "Completed run suggests a candidate method update.",
      confidence: 0.95,
      riskLevel: "low",
      dedupeKey: "project-knowledge-cli__group-knowledge-cli__cli-diff",
      tags: ["director-trace", "cli"],
      roles: ["researcher", "script-planner"],
      selectedAdapters: ["scripted"],
      createdAt: "2026-04-13T16:10:00.000Z",
      updatedAt: "2026-04-13T16:20:00.000Z",
      latestDecision: {
        decidedAt: "2026-04-13T16:20:00.000Z",
        decidedStatus: "accepted",
        note: "approved_for_cli",
      },
      sourceRecord: {
        schemaVersion: "director.memory.record.v1",
        recordId: `record-${proposalId}`,
        digestId: `digest-${proposalId}`,
        projectId: "project-knowledge-cli",
        groupId: "group-knowledge-cli",
        anchorIds: ["anchor-cli"],
        selectedAdapters: ["scripted"],
        tags: ["cli"],
        status: "completed",
        recordedAt: "2026-04-13T16:10:00.000Z",
        digest: {
          schemaVersion: "director.memory.trace-digest.v1",
          digestId: `digest-${proposalId}`,
          runId: `run-${proposalId}`,
          reportId: `report-${proposalId}`,
          snapshotId: `snapshot-${proposalId}`,
          runtimeId: "runtime-cli",
          blueprintId: `blueprint-${proposalId}`,
          handoffId: `handoff-${proposalId}`,
          actionGraphId: `graph-${proposalId}`,
          projectId: "project-knowledge-cli",
          groupId: "group-knowledge-cli",
          goal: "Build CLI diff coverage.",
          previewSummary: "Preview safe run finished.",
          status: "completed",
          roles: ["researcher", "script-planner"],
          anchorIds: ["anchor-cli"],
          selectedAdapters: ["scripted"],
          observationRefs: [],
          assignmentStats: {
            total: 2,
            completed: 2,
            failed: 0,
            aborted: 0,
            skipped: 0,
            blocked: 0,
          },
          flags: [],
          eventTypes: ["run-created", "assignment-status-changed"],
          createdAt: "2026-04-13T16:10:00.000Z",
          startedAt: "2026-04-13T16:10:00.000Z",
          completedAt: "2026-04-13T16:15:00.000Z",
          recordedAt: "2026-04-13T16:15:00.000Z",
          generationType: "new",
          generationStyle: "immersive",
          knowledgeSignalTags: ["cli"],
        },
      },
    }),
    "utf8",
  );
}

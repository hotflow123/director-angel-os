import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  parseDirectorAcceptanceArgs,
  renderDirectorAcceptanceReport,
  runDirectorAcceptance,
} from "./director-acceptance.js";

function writeDirectorAcceptanceArtifacts(
  workspaceRoot: string,
  options: { readonly doctorFailed?: boolean } = {},
): void {
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
    join(resultsDir, "director-phase-p2-wave6-failover-boundary-gate-latest.json"),
    JSON.stringify({
      suiteId: "director-phase-p2-wave6-failover-boundary-gate",
      generatedAt: "2026-04-14T06:40:00.000Z",
      summary: {
        total: 4,
        failed: 0,
        passed: 4,
        totalDurationMs: 3218.44,
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
      generatedAt: "2026-04-14T12:30:00.000Z",
      summary: {
        total: 3,
        failed: 0,
        passed: 3,
        totalDurationMs: 2891.53,
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

describe("director acceptance", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("parses json/help options", () => {
    expect(parseDirectorAcceptanceArgs(["--json"])).toEqual({
      ok: true,
      value: {
        format: "json",
        help: false,
      },
    });
    expect(parseDirectorAcceptanceArgs(["--help"])).toEqual({
      ok: true,
      value: {
        format: "text",
        help: true,
      },
    });
  });

  test("reports pass when all required benchmark artifacts are present and passing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-acceptance-pass-"));
    tempRoots.push(workspaceRoot);
    writeDirectorAcceptanceArtifacts(workspaceRoot);

    const report = await runDirectorAcceptance(workspaceRoot, {
      now: () => "2026-04-13T19:20:00.000Z",
    });

    expect(report.status).toBe("pass");
    expect(report.counts.pass).toBe(31);
    expect(report.counts.fail).toBe(0);

    const output = renderDirectorAcceptanceReport(report);
    expect(output).toContain("Director Acceptance");
    expect(output).toContain("Status: PASS");
    expect(output).toContain("[PASS] Beta-8 single vertical: cases=2 passed=2 failed=0");
    expect(output).toContain(
      "[PASS] Phase P2 Wave 1 real execution handoff: cases=2 passed=2 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 2 dual execution chain: cases=2 passed=2 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 3 retryable bridge failure: cases=1 passed=1 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 4 non-retryable bridge failure: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 5 retry policy boundary: cases=4 passed=4 failed=0",
    );
    expect(output).toContain("[PASS] Phase P2 Wave 6 failover boundary: cases=4 passed=4 failed=0");
    expect(output).toContain(
      "[PASS] Phase P2 Wave 7 route recovery audit closure: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 8 chain route health snapshot: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 9 chain route doctor visibility: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 10 worker once operator entry: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 11 run once preflight guidance: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 12 run once exit surface: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 13 run once holding-state taxonomy: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 14 run state surface alignment: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Phase P2 Wave 15 run state visibility closeout: cases=3 passed=3 failed=0",
    );
    expect(output).toContain(
      "[PASS] Cycle 1 Wave 83 prompt-inspect static runtime summary surface: cases=1 passed=1 failed=0",
    );
    expect(output).toContain(
      "[PASS] Cycle 1 Wave 93 status tool runtime guidance precedence: cases=1 passed=1 failed=0",
    );
    expect(output).toContain("[PASS] Wave-2 recovery benchmark: runs=1 failed=0");
  });

  test("reports fail when one benchmark gate is failing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-acceptance-fail-"));
    tempRoots.push(workspaceRoot);
    writeDirectorAcceptanceArtifacts(workspaceRoot, { doctorFailed: true });

    const report = await runDirectorAcceptance(workspaceRoot, {
      now: () => "2026-04-13T19:30:00.000Z",
    });

    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "doctor")?.status).toBe("fail");

    const output = renderDirectorAcceptanceReport(report);
    expect(output).toContain("Status: FAIL");
    expect(output).toContain("[FAIL] Wave-8 doctor benchmark: runs=2 failed=1");
    expect(output).toContain("failing cases: healthy_scripted_default");
    expect(output).toContain(
      "Next action: rerun or repair the failing gates before boundary review.",
    );
  });

  test("recognizes top-level passed/failures gate artifacts", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-acceptance-top-level-passed-"));
    tempRoots.push(workspaceRoot);
    writeDirectorAcceptanceArtifacts(workspaceRoot);

    const resultsDir = join(workspaceRoot, "benchmarks", "results");
    writeFileSync(
      join(resultsDir, "wave83-prompt-inspect-static-runtime-summary-surface-gate.json"),
      JSON.stringify({
        gate: "wave83-prompt-inspect-static-runtime-summary-surface-gate",
        promptInspectRun: {
          status: 0,
          durationMs: 410.42,
        },
        passed: true,
        failures: [],
      }),
      "utf8",
    );

    const report = await runDirectorAcceptance(workspaceRoot, {
      now: () => "2026-04-13T19:40:00.000Z",
    });
    const check = report.checks.find((item) => item.id === "cycle1-wave83");

    expect(check?.status).toBe("pass");
    expect(check?.summary).toBe(
      "wave83-prompt-inspect-static-runtime-summary-surface-gate passed=true failures=0",
    );
    expect(renderDirectorAcceptanceReport(report)).toContain(
      "[PASS] Cycle 1 Wave 83 prompt-inspect static runtime summary surface: wave83-prompt-inspect-static-runtime-summary-surface-gate passed=true failures=0",
    );
  });
});

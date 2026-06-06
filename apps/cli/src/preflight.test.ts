import { describe, expect, test, vi } from "vitest";

import {
  normalizePreflightReport,
  renderPreflightFailure,
  renderPreflightReport,
  runCliPreflightViaControlPlane,
} from "./preflight.js";

describe("runCliPreflightViaControlPlane", () => {
  test("dispatches onboarding through operator control-plane and normalizes a compact preflight view", async () => {
    const dispatch = vi.fn(async () => ({
      ok: true,
      data: {
        sessionId: "operator_preflight",
        status: "warn",
        summaryText: "bounded attention is still required",
        environment: {
          profile: "development",
          workspaceRoot: "/workspace",
          workspaceExists: true,
          dataDir: "/workspace/.hotflow",
          dataDirExists: false,
          sessionDir: "/workspace/.hotflow/sessions",
          sessionDirExists: false,
          sessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
          effectiveSessionDbPath: "/tmp/hotflow-preflight.sqlite",
          defaultProvider: "scripted",
          defaultModel: "hotflow-phase1",
          permissionMode: "ask",
          outputStyle: "normal",
          responseLanguage: "follow-user",
        },
        runtime: {
          providerIds: ["scripted"],
          defaultProviderAvailable: true,
          internalPlugins: [],
          approvedSkillSnapshotPath: "/workspace/.hotflow/skills/approved.json",
          approvedSkillCount: 0,
        },
        directorExecution: {
          status: "warn",
          summaryText: "latest director execution is recoverable",
          routeSummary: "1 chain is degraded but can still recover by reroute.",
          nextAction: "reroute the failed assignment to the approved alternate adapter.",
          suggestedCommands: [
            "hotflow director run reroute --run-id run-warn-1 --assignment-id assignment-failed-1 --adapter-id runway-preview",
          ],
          routeCounts: {
            healthy: 0,
            degraded: 1,
            reroutable: 1,
            exhausted: 0,
            blocked: 0,
            total: 2,
          },
        },
        nextSteps: [
          {
            title: "Run doctor / 运行 doctor",
            command: "hotflow doctor",
            detail: "recheck doctor",
          },
        ],
        guidance: [],
        doctor: {
          status: "pass",
          counts: {
            pass: 3,
            warn: 0,
            fail: 0,
            total: 3,
          },
          checks: [],
        },
      },
    }));

    const report = await runCliPreflightViaControlPlane({
      sessionId: "operator_preflight",
      createControlPlane() {
        return { dispatch };
      },
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "onboarding-status",
      sessionId: "operator_preflight",
    });
    expect(report.status).toBe("warn");
    expect(report.readiness).toBe("needs-attention");
    expect(report.recommendedCommand).toBe(
      "hotflow director run reroute --run-id run-warn-1 --assignment-id assignment-failed-1 --adapter-id runway-preview",
    );
    expect(report.commands).toEqual([
      "hotflow director run reroute --run-id run-warn-1 --assignment-id assignment-failed-1 --adapter-id runway-preview",
      "hotflow doctor",
    ]);
    expect(report.surfaces.environment.status).toBe("warn");
    expect(report.surfaces.directorExecution.routeCounts.reroutable).toBe(1);
  });

  test("surfaces structured control-plane failures", async () => {
    await expect(
      runCliPreflightViaControlPlane({
        createControlPlane() {
          return {
            async dispatch() {
              return {
                ok: false,
                error: "preflight control-plane failure",
              };
            },
          };
        },
      }),
    ).rejects.toThrow("Preflight control-plane execution failed.");
  });
});

describe("normalizePreflightReport", () => {
  test("prefers director run once when healthy execution already has ready work", () => {
    const report = normalizePreflightReport({
      status: "pass",
      summaryText: "runtime looks ready",
      environment: {
        profile: "development",
        workspaceRoot: "/workspace",
        workspaceExists: true,
        dataDir: "/workspace/.hotflow",
        dataDirExists: true,
        sessionDir: "/workspace/.hotflow/sessions",
        sessionDirExists: true,
        sessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
        effectiveSessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
        defaultProvider: "scripted",
        defaultModel: "hotflow-phase1",
        permissionMode: "ask",
        outputStyle: "normal",
        responseLanguage: "follow-user",
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
        summaryText: "healthy chain with ready work",
        runId: "run-ready-1",
        nextAction: "run the ready assignments through the local worker lane once.",
        suggestedCommands: ["hotflow director run once --run-id run-ready-1"],
        routeCounts: {
          healthy: 2,
          degraded: 0,
          reroutable: 0,
          exhausted: 0,
          blocked: 0,
          total: 2,
        },
      },
      nextSteps: [
        {
          title: "Run ready director assignments / 运行就绪导演任务",
          command: "hotflow director run once --run-id run-ready-1",
          detail: "advance the ready worker lane once",
        },
      ],
      guidance: [],
      doctor: {
        status: "pass",
        counts: {
          pass: 2,
          warn: 0,
          fail: 0,
          total: 2,
        },
        checks: [],
      },
    });

    expect(report.readiness).toBe("ready");
    expect(report.recommendedCommand).toBe("hotflow director run once --run-id run-ready-1");
    expect(report.commands).toEqual(["hotflow director run once --run-id run-ready-1"]);
  });

  test("derives recommended command from next steps when no director recovery command exists", () => {
    const report = normalizePreflightReport({
      status: "fail",
      summaryText: "provider is misconfigured",
      environment: {
        profile: "development",
        workspaceRoot: "/workspace",
        workspaceExists: true,
        dataDir: "/workspace/.hotflow",
        dataDirExists: true,
        sessionDir: "/workspace/.hotflow/sessions",
        sessionDirExists: true,
        sessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
        effectiveSessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
        defaultProvider: "openai-compatible",
        defaultModel: "gpt-5-mini",
        permissionMode: "ask",
        outputStyle: "normal",
        responseLanguage: "zh-CN",
      },
      runtime: {
        providerIds: ["scripted"],
        defaultProviderAvailable: false,
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
      nextSteps: [
        {
          title: "Configure provider / 配置 Provider",
          command: "export HOTFLOW_OPENAI_BASE_URL=<https://your-endpoint/v1>",
          detail: "set provider env first",
        },
      ],
      guidance: [],
      doctor: {
        status: "fail",
        counts: {
          pass: 1,
          warn: 0,
          fail: 1,
          total: 2,
        },
        checks: [],
      },
    });

    expect(report.readiness).toBe("blocked");
    expect(report.recommendedCommand).toBe(
      "export HOTFLOW_OPENAI_BASE_URL=<https://your-endpoint/v1>",
    );
    expect(report.surfaces.doctor.status).toBe("fail");
  });
});

describe("renderPreflightReport", () => {
  test("renders readable text and json failures", () => {
    const report = normalizePreflightReport({
      status: "pass",
      summaryText: "runtime looks ready",
      environment: {
        profile: "development",
        workspaceRoot: "/workspace",
        workspaceExists: true,
        dataDir: "/workspace/.hotflow",
        dataDirExists: true,
        sessionDir: "/workspace/.hotflow/sessions",
        sessionDirExists: true,
        sessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
        effectiveSessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
        defaultProvider: "scripted",
        defaultModel: "hotflow-phase1",
        permissionMode: "ask",
        outputStyle: "normal",
        responseLanguage: "zh-CN",
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
      nextSteps: [],
      guidance: [],
      doctor: {
        status: "pass",
        counts: {
          pass: 2,
          warn: 0,
          fail: 0,
          total: 2,
        },
        checks: [],
      },
    });

    expect(renderPreflightReport(report)).toContain("Hotflow Preflight");
    expect(renderPreflightReport(report)).toContain("Readiness: READY");
    expect(renderPreflightReport(report)).toContain("Response language: zh-CN");
    expect(JSON.parse(renderPreflightReport(report, "json"))).toMatchObject({
      status: "pass",
      readiness: "ready",
      environment: {
        responseLanguage: "zh-CN",
      },
    });

    expect(renderPreflightFailure(new Error("boom"))).toContain("Status: FAIL");
    expect(JSON.parse(renderPreflightFailure(new Error("boom"), "json"))).toEqual({
      status: "fail",
      error: {
        code: "preflight_run_failed",
        message: "Preflight command failed.",
        details: ["boom"],
      },
    });
  });
});

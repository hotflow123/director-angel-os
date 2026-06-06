import { describe, expect, test, vi } from "vitest";

import {
  renderDoctorFailure,
  renderDoctorReport,
  runCliDoctor,
  runCliDoctorViaControlPlane,
} from "./doctor.js";

describe("runCliDoctor", () => {
  test("normalizes a doctor core report and renders readable text", async () => {
    const report = await runCliDoctor({
      loadModule: async () => ({
        runDoctor: async () => ({
          overall: "warn",
          summary: {
            total: 2,
            pass: 1,
            warn: 1,
            fail: 0,
          },
          checks: [
            {
              id: "config.load",
              status: "pass",
              summary: "Configuration loaded successfully.",
            },
            {
              id: "provider.registry",
              status: "warning",
              message: "OpenAI-compatible provider is not configured.",
              context: {
                providerIds: "scripted",
              },
            },
          ],
        }),
      }),
    });

    expect(report.status).toBe("warn");
    expect(report.counts).toEqual({
      total: 2,
      pass: 1,
      warn: 1,
      fail: 0,
    });
    expect(renderDoctorReport(report)).toContain("[WARN] provider.registry");
    expect(renderDoctorReport(report)).toContain("providerIds: scripted");
    expect(JSON.parse(renderDoctorReport(report, "json"))).toMatchObject({
      status: "warn",
      counts: {
        total: 2,
      },
    });
  });

  test("fails when the doctor package does not export runDoctor", async () => {
    await expect(
      runCliDoctor({
        loadModule: async () => ({}),
      }),
    ).rejects.toThrow("@hotflow/doctor does not export runDoctor().");
  });

  test("surfaces module initialization failures", async () => {
    await expect(
      runCliDoctor({
        loadModule: async () => {
          throw new Error("Cannot find module '@hotflow/doctor'");
        },
      }),
    ).rejects.toThrow("Unable to initialize doctor core.");
  });

  test("passes CLI session path resolution into the doctor core", async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    const env = {
      HOTFLOW_CLI_SESSION_DB_PATH: "/tmp/hotflow-doctor.sqlite",
    } as NodeJS.ProcessEnv;

    await runCliDoctor({
      cwd: "/workspace/hotflow",
      env,
      loadModule: async () => ({
        runDoctor: async (input?: unknown) => {
          receivedOptions = input as Record<string, unknown>;
          return {
            status: "pass",
            checks: [],
          };
        },
      }),
    });

    expect(receivedOptions?.cwd).toBe("/workspace/hotflow");
    expect(receivedOptions?.env).toBe(env);
    expect(receivedOptions?.probeMempalace).toBeTypeOf("function");
    expect(receivedOptions?.resolveSessionDbPath).toBeTypeOf("function");
    const resolvedPath = (
      receivedOptions?.resolveSessionDbPath as (input: {
        config: {
          dataDir: string;
          sessionDbPath: string;
        };
      }) => string
    )({
      config: {
        dataDir: "/workspace/hotflow/.hotflow",
        sessionDbPath: "/workspace/hotflow/.hotflow/sessions/sessions.sqlite",
      },
    });
    expect(resolvedPath).toBe("/tmp/hotflow-doctor.sqlite");
  });
});

describe("runCliDoctorViaControlPlane", () => {
  test("dispatches doctor through control-plane and normalizes the report", async () => {
    const dispatch = vi.fn(async () => ({
      ok: true,
      data: {
        overall: "warn",
        checks: [
          {
            id: "memory.mempalace",
            status: "warning",
            summary: "Optional mempalace integration is unavailable.",
          },
        ],
      },
    }));

    const report = await runCliDoctorViaControlPlane({
      sessionId: "operator_doctor_test",
      createControlPlane() {
        return { dispatch };
      },
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "doctor",
      sessionId: "operator_doctor_test",
    });
    expect(report.status).toBe("warn");
    expect(report.checks[0]?.id).toBe("memory.mempalace");
  });

  test("surfaces structured control-plane failures", async () => {
    await expect(
      runCliDoctorViaControlPlane({
        createControlPlane() {
          return {
            async dispatch() {
              return {
                ok: false,
                error: "doctor control-plane failure",
              };
            },
          };
        },
      }),
    ).rejects.toThrow("Doctor control-plane execution failed.");
  });
});

describe("renderDoctorFailure", () => {
  test("renders readable text and json failures", () => {
    const text = renderDoctorFailure(new Error("Cannot find module '@hotflow/doctor'"));
    expect(text).toContain("Status: FAIL");
    expect(text).toContain("Doctor command failed.");
    expect(text).toContain("Cannot find module '@hotflow/doctor'");

    expect(JSON.parse(renderDoctorFailure(new Error("boom"), "json"))).toEqual({
      status: "fail",
      error: {
        code: "doctor_run_failed",
        message: "Doctor command failed.",
        details: ["boom"],
      },
    });
  });
});

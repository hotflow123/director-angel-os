import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ExternalToolRegistry,
  createFileConversationRuntimeApprovalLedger,
  createFileConversationRuntimeExternalArtifactStore,
  createMoyinProviderRegistration,
  createMoyinWorkflowRunApprovalPacket,
  orchestrateMoyinWorkflowRunAdvance,
  orchestrateMoyinWorkflowRunCancel,
  orchestrateMoyinWorkflowRunContinueApproved,
  orchestrateMoyinWorkflowRunContinueApprovedFromArtifact,
  orchestrateMoyinWorkflowRunExecuteAndPackage,
  orchestrateMoyinWorkflowRunResumeAndPackage,
  orchestrateMoyinWorkflowRunUntilNextGate,
  planMoyinWorkflowRunNextAction,
} from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const executePackageSmokeScript = join(
  repoRoot,
  "scripts/smoke-moyin-workflow-execute-package.mjs",
);
const advanceSmokeScript = join(repoRoot, "scripts/smoke-moyin-workflow-advance.mjs");
const nextActionSmokeScript = join(repoRoot, "scripts/smoke-moyin-workflow-next-action.mjs");
const resumePackageSmokeScript = join(repoRoot, "scripts/smoke-moyin-workflow-resume-package.mjs");
const untilNextGateSmokeScript = join(repoRoot, "scripts/smoke-moyin-workflow-until-next-gate.mjs");
const approvalPacketSmokeScript = join(
  repoRoot,
  "scripts/smoke-moyin-workflow-approval-packet.mjs",
);
const continueApprovedSmokeScript = join(
  repoRoot,
  "scripts/smoke-moyin-workflow-continue-approved.mjs",
);
const productionReadinessSmokeScript = join(
  repoRoot,
  "scripts/smoke-moyin-production-readiness.mjs",
);
const farFutureSealedRequestExpiresAt = "2099-01-01T00:00:00.000Z";

function createMoyinSealedGetRunnerOutput(args: readonly string[]):
  | {
      readonly exitCode: 0;
      readonly stdout: string;
      readonly stderr: "";
    }
  | undefined {
  if (args[0] !== "sealed" || args[1] !== "get" || args[3] !== "--json") {
    return undefined;
  }
  const sealedRequestId = args[2];
  if (sealedRequestId === undefined) {
    return undefined;
  }
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      sealedRequest: {
        sealedRequestId,
        status: "sealed",
        expiresAt: farFutureSealedRequestExpiresAt,
      },
    }),
    stderr: "",
  };
}

describe("Moyin workflow-run orchestrator", () => {
  it("plans the next approval-gated workflow-run action without advancing or submitting", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  { stepId: "script-1", status: "completed" },
                  {
                    stepId: "scene-image-1",
                    status: "approval_required",
                    sealedRequestId: "sealed-image-1",
                    requiresApproval: true,
                  },
                  { stepId: "scene-video-1", status: "pending" },
                ],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const plan = await planMoyinWorkflowRunNextAction({
      registry,
      projectId: "project-1",
      runId: "run-1",
    });

    expect(plan).toMatchObject({
      ok: true,
      status: "approval-required",
      projectId: "project-1",
      runId: "run-1",
      nextAction: {
        kind: "execute",
        operationId: "workflow-run.advance",
        advanceAction: "execute",
        stepId: "scene-image-1",
        requiresApproval: true,
        sealedRequestId: "sealed-image-1",
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        stepCount: 3,
      },
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
    expect(calls.flat()).not.toContain("advance");
    expect(calls.flat()).not.toContain("submit");
  });

  it("plans resumable watch/package recovery for running workflow-run steps", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "scene-video-1",
                    status: "running",
                    sealedRequestId: "sealed-video-1",
                    taskId: "task-video-1",
                  },
                ],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const plan = await planMoyinWorkflowRunNextAction({
      registry,
      projectId: "project-1",
      runId: "run-1",
    });

    expect(plan).toMatchObject({
      ok: true,
      status: "resumable",
      nextAction: {
        kind: "resume_watch",
        operationId: "task.watch",
        stepId: "scene-video-1",
        requiresApproval: false,
        taskId: "task-video-1",
        sealedRequestId: "sealed-video-1",
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
      },
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
  });

  it("preserves Moyin step approval metadata when planning non-gated ready steps", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "script-generate-from-idea",
                    status: "ready",
                    requiresApproval: false,
                  },
                  { stepId: "scene-image-1", status: "pending", requiresApproval: true },
                ],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const plan = await planMoyinWorkflowRunNextAction({
      registry,
      projectId: "project-1",
      runId: "run-1",
    });

    expect(plan).toMatchObject({
      ok: true,
      status: "ready-to-advance",
      steps: expect.arrayContaining([
        expect.objectContaining({
          stepId: "script-generate-from-idea",
          status: "ready",
          requiresApproval: false,
        }),
      ]),
      nextAction: {
        kind: "execute",
        operationId: "workflow-run.advance",
        advanceAction: "execute",
        stepId: "script-generate-from-idea",
        requiresApproval: true,
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        stepCount: 2,
      },
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
    expect(calls.flat()).not.toContain("advance");
    expect(calls.flat()).not.toContain("submit");
  });

  it("keeps workflow-run cancellation approval-gated before touching Moyin task or run state", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          const command = args.join(" ");
          if (command === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (command === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "scene-video-1",
                    status: "running",
                    taskId: "task-video-1",
                    sealedRequestId: "sealed-video-1",
                  },
                ],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${command}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunCancel({
      registry,
      projectId: "project-1",
      runId: "run-1",
      turnId: "turn-cancel-1",
      sessionKey: "desktop:workbench",
      reason: "operator requested stop",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "approval-required",
      projectId: "project-1",
      runId: "run-1",
      stepId: "scene-video-1",
      taskId: "task-video-1",
      taskCancel: {
        ok: false,
        status: "approval-required",
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        taskCancelAttempted: false,
        workflowRunCancelAttempted: false,
      },
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
    expect(calls.flat()).not.toContain("cancel");
  });

  it("cancels a running workflow-run through task.cancel then workflow-run.cancel after approval", async () => {
    const calls: string[][] = [];
    const events: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          const command = args.join(" ");
          if (command === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (command === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "scene-video-1",
                    status: "running",
                    taskId: "task-video-1",
                    sealedRequestId: "sealed-video-1",
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (command === "task cancel task-video-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                taskId: "task-video-1",
                projectId: "project-1",
                status: "cancelled",
                reason: "operator requested stop",
              }),
              stderr: "",
            };
          }
          if (command === "workflow-run cancel run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                projectId: "project-1",
                status: "cancelled",
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${command}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunCancel({
      registry,
      projectId: "project-1",
      runId: "run-1",
      turnId: "turn-cancel-2",
      sessionKey: "desktop:workbench",
      reason: "operator requested stop",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-28T00:00:00.000Z",
        providerId: "moyin",
        reason: "trusted local Moyin cancellation",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
      onEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({
      ok: true,
      status: "cancelled",
      projectId: "project-1",
      runId: "run-1",
      stepId: "scene-video-1",
      taskId: "task-video-1",
      taskCancel: {
        ok: true,
        status: "success",
      },
      workflowRunCancel: {
        ok: true,
        status: "success",
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        taskCancelAttempted: true,
        workflowRunCancelAttempted: true,
      },
    });
    expect(events).toEqual([
      expect.objectContaining({ kind: "moyin.workflow_run.cancel.started" }),
      expect.objectContaining({
        kind: "moyin.workflow_run.task_cancel.completed",
        taskId: "task-video-1",
      }),
      expect.objectContaining({ kind: "moyin.workflow_run.cancel.completed" }),
    ]);
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["task", "cancel", "task-video-1", "--project", "project-1", "--json"],
      ["workflow-run", "cancel", "run-1", "--project", "project-1", "--json"],
    ]);
    expect(calls.flat()).not.toContain("submit");
    expect(calls.flat()).not.toContain("advance");
  });

  it("runs a completed workflow-run to package collection without advancing or submitting", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-moyin-until-gate-handoff-"));
    const handoffManifestDirectory = join(root, "handoff");
    const artifactStore = createFileConversationRuntimeExternalArtifactStore({
      rootPath: join(root, "artifact-store"),
      nowMs: () => 1_779_000_000_000,
    });
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          const command = args.join(" ");
          if (command === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (command === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ stepId: "step-1", status: "completed", taskId: "task-1" }],
              }),
              stderr: "",
            };
          }
          if (command === "workflow-run get run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                projectId: "project-1",
                status: "completed",
              }),
              stderr: "",
            };
          }
          if (command === "workflow-run artifacts run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-1",
                    type: "image",
                    localPath: "/tmp/out.png",
                    taskId: "task-1",
                    stepId: "step-1",
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (command === "workflow-run export run-1 --project project-1 --target json --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ runId: "run-1", target: "json" }),
              stderr: "",
            };
          }
          if (
            command ===
            "workflow-run export run-1 --project project-1 --target comfyui-draft --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ runId: "run-1", target: "comfyui-draft" }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${command}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunUntilNextGate({
      registry,
      projectId: "project-1",
      runId: "run-1",
      turnId: "turn-until-gate-1",
      sessionKey: "desktop:workbench",
      artifactStore,
      handoffManifestDirectory,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "packaged",
      plan: {
        status: "completed",
        nextAction: { kind: "collect_package", requiresApproval: false },
      },
      package: {
        status: "packaged",
        handoffManifestArtifact: {
          id: "moyin-handoff:project-1:run-1",
          kind: "json",
          path: join(handoffManifestDirectory, "project-1", "run-1.handoff.json"),
        },
        handoffManifestArtifactPersistence: {
          status: "ok",
          artifactIds: ["moyin-handoff:project-1:run-1"],
        },
        artifacts: [{ id: "artifact-1" }],
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        packageAttempted: true,
        resumeAttempted: false,
      },
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "get", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "artifacts", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "export", "run-1", "--project", "project-1", "--target", "json", "--json"],
      [
        "workflow-run",
        "export",
        "run-1",
        "--project",
        "project-1",
        "--target",
        "comfyui-draft",
        "--json",
      ],
    ]);
    expect(calls.flat()).not.toContain("advance");
    expect(calls.flat()).not.toContain("submit");
    expect(artifactStore.listArtifacts({ providerId: "moyin", runId: "run-1" })).toEqual([
      expect.objectContaining({
        artifactId: "moyin-handoff:project-1:run-1",
        operationId: "workflow-run.production-package",
        turnId: "turn-until-gate-1",
        sessionKey: "desktop:workbench",
      }),
    ]);
    expect(
      JSON.parse(
        readFileSync(join(handoffManifestDirectory, "project-1", "run-1.handoff.json"), "utf8"),
      ),
    ).toMatchObject({
      schemaVersion: "director.moyin.production-handoff-manifest.v1",
      projectId: "project-1",
      runId: "run-1",
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("stops at the next approval gate for ready workflow-run steps", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunUntilNextGate({
      registry,
      projectId: "project-1",
      runId: "run-1",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "approval-required",
      plan: {
        status: "ready-to-advance",
        nextAction: {
          kind: "build_sealed_request",
          operationId: "workflow-run.advance",
          stepId: "step-1",
          requiresApproval: true,
        },
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        packageAttempted: false,
        resumeAttempted: false,
      },
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
  });

  it("blocks until-next-gate approval packet creation when an execute sealed request is expired", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: "approval_required",
                    sealedRequestId: "sealed-expired",
                    requiresApproval: true,
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "sealed get sealed-expired --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                sealedRequest: {
                  sealedRequestId: "sealed-expired",
                  status: "sealed",
                  expiresAt: "2000-01-01T00:00:00.000Z",
                },
              }),
              stderr: "",
            };
          }
          if (args[0] === "workflow-run" && args[1] === "advance") {
            return { exitCode: 9, stdout: "", stderr: "until-next-gate must not advance" };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunUntilNextGate({
      registry,
      projectId: "project-1",
      runId: "run-1",
      createApprovalPacket: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      plan: {
        nextAction: {
          kind: "execute",
          advanceAction: "execute",
          sealedRequestId: "sealed-expired",
        },
      },
      effectiveNextAction: {
        kind: "execute",
        advanceAction: "execute",
        sealedRequestId: "sealed-expired",
      },
      approvalPacket: {
        status: "blocked",
        executePreflight: {
          status: "blocked",
          error: {
            code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_EXPIRED",
            stopReason: "sealed-request-expired",
          },
        },
        error: {
          code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_REBUILD_UNSUPPORTED",
          stopReason: "approval-required-sealed-request-rebuild-unsupported",
        },
        plan: {
          nextAction: {
            kind: "execute",
            advanceAction: "execute",
            requiresApproval: true,
          },
        },
      },
      error: {
        code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_REBUILD_UNSUPPORTED",
        stopReason: "approval-required-sealed-request-rebuild-unsupported",
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        packageAttempted: false,
        resumeAttempted: false,
      },
    });
    expect(calls).toContainEqual(["sealed", "get", "sealed-expired", "--json"]);
    expect(calls.filter((call) => call[0] === "workflow-run" && call[1] === "advance")).toEqual([]);
    expect(calls.flat()).not.toContain("submit");
  });

  it("creates an approval packet for the next gated workflow-run action without mutating the run", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
              }),
              stderr: "",
            };
          }
          if (args.join(" ").includes("workflow-run advance")) {
            return {
              exitCode: 9,
              stdout: "",
              stderr: "approval packet must not mutate a workflow-run",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const packet = await createMoyinWorkflowRunApprovalPacket({
      registry,
      projectId: "project-1",
      runId: "run-1",
      turnId: "turn-approval-packet",
      sessionKey: "session-approval-packet",
    });

    expect(packet).toMatchObject({
      ok: true,
      status: "approval-required",
      projectId: "project-1",
      runId: "run-1",
      approvalPacket: {
        schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
        type: "approval_request",
        providerId: "moyin",
        operationId: "workflow-run.advance",
        advanceAction: "build_sealed_request",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        approvalExpiresAtMs: 1_779_000_300_000,
        requiresApproval: true,
        riskLevel: "high",
        resumeToken: "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
        nextInvocation: {
          packageScript: "moyin:smoke:continue-approved",
          env: {
            MOYIN_SMOKE_PROJECT_ID: "project-1",
            MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
            MOYIN_SMOKE_STEP_ID: "step-1",
            MOYIN_SMOKE_ADVANCE_ACTION: "build_sealed_request",
            MOYIN_SMOKE_ALLOW_CONTINUE: "1",
            MOYIN_SMOKE_APPROVAL: "APPROVED",
            MOYIN_SMOKE_APPROVAL_TURN_ID: "turn-approval-packet",
            MOYIN_SMOKE_APPROVAL_SESSION_KEY: "session-approval-packet",
            MOYIN_SMOKE_RESUME_TOKEN:
              "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
            MOYIN_SMOKE_APPROVAL_EXPIRES_AT_MS: "1779000300000",
          },
        },
        mutation: {
          advanceAttempted: false,
          submitAttempted: false,
          executeAttempted: false,
        },
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
      },
    });
    expect(packet.approvalPacket?.approvalId).toBe(
      "external-tool:turn-approval-packet:moyin.provider:workflow-run.advance:invoke",
    );
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
    expect(calls.flat()).not.toContain("advance");
    expect(calls.flat()).not.toContain("submit");
  });

  it("persists workflow-run approval packets as resumable external artifacts", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-approval-packet-artifact-"));
    try {
      const calls: string[][] = [];
      const artifactStore = createFileConversationRuntimeExternalArtifactStore({
        rootPath: join(root, "artifact-store"),
        nowMs: () => 1_779_000_000_000,
        defaultRetention: "user_controlled",
        defaultSensitivity: "internal",
      });
      const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ args }) => {
            calls.push([...args]);
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
                }),
                stderr: "",
              };
            }
            if (args.join(" ").includes("workflow-run advance")) {
              return {
                exitCode: 9,
                stdout: "",
                stderr: "approval packet persistence must not mutate a workflow-run",
              };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const packet = await createMoyinWorkflowRunApprovalPacket({
        registry,
        projectId: "project-1",
        runId: "run-1",
        turnId: "turn-approval-packet",
        sessionKey: "session-approval-packet",
        artifactStore,
        approvalPacketDirectory: join(root, "approval-packets"),
      });

      expect(packet.approvalPacketArtifact).toMatchObject({
        id: "moyin-approval-packet:project-1:run-1:step-1:build_sealed_request",
        kind: "json",
        metadata: {
          provider: "moyin",
          role: "workflow-run-approval-packet",
          projectId: "project-1",
          runId: "run-1",
          stepId: "step-1",
          advanceAction: "build_sealed_request",
          resumeToken: "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
        },
      });
      expect(packet.approvalPacketArtifactPersistence).toMatchObject({
        status: "ok",
        artifactIds: ["moyin-approval-packet:project-1:run-1:step-1:build_sealed_request"],
      });
      const artifactPath = packet.approvalPacketArtifact?.path;
      expect(artifactPath).toBe(
        join(
          root,
          "approval-packets",
          "project-1",
          "run-1",
          "step-1-build_sealed_request.approval-packet.json",
        ),
      );
      const storedPacket = JSON.parse(readFileSync(artifactPath ?? "", "utf8"));
      expect(storedPacket).toMatchObject({
        schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
        operationId: "workflow-run.advance",
        advanceAction: "build_sealed_request",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        resumeToken: "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
        mutation: {
          advanceAttempted: false,
          submitAttempted: false,
          executeAttempted: false,
        },
      });
      expect(
        artifactStore.listArtifacts({
          providerId: "moyin",
          operationId: "workflow-run.approval-packet",
          projectId: "project-1",
          runId: "run-1",
          stepId: "step-1",
        }),
      ).toHaveLength(1);
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("continues an approved workflow-run from a persisted approval packet artifact", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-approval-artifact-resume-"));
    try {
      const calls: string[][] = [];
      const artifactStore = createFileConversationRuntimeExternalArtifactStore({
        rootPath: join(root, "artifact-store"),
        nowMs: () => 1_779_000_000_000,
        defaultRetention: "user_controlled",
        defaultSensitivity: "internal",
      });
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_779_000_000_000,
        artifactStore,
      });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ args }) => {
            calls.push([...args]);
            const sealed = calls.some(
              (call) =>
                call.join(" ") ===
                "workflow-run advance run-1 --project project-1 --step step-1 --action build_sealed_request --json",
            );
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [
                    {
                      stepId: "step-1",
                      status: sealed ? "approval_required" : "ready",
                      sealedRequestId: sealed ? "sealed-1" : undefined,
                      requiresApproval: true,
                    },
                  ],
                }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run advance run-1 --project project-1 --step step-1 --action build_sealed_request --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  runId: "run-1",
                  stepId: "step-1",
                  action: "build_sealed_request",
                  status: "advanced",
                  sealedRequestId: "sealed-1",
                  step: {
                    stepId: "step-1",
                    status: "approval_required",
                    sealedRequestId: "sealed-1",
                  },
                }),
                stderr: "",
              };
            }
            const sealedGet = createMoyinSealedGetRunnerOutput(args);
            if (sealedGet !== undefined) {
              return sealedGet;
            }
            if (args.includes("execute") || args.includes("submit")) {
              return {
                exitCode: 9,
                stdout: "",
                stderr: "artifact resume must not execute or submit",
              };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const packet = await createMoyinWorkflowRunApprovalPacket({
        registry,
        projectId: "project-1",
        runId: "run-1",
        turnId: "turn-artifact-resume",
        sessionKey: "session-artifact-resume",
        artifactStore,
        approvalPacketDirectory: join(root, "approval-packets"),
      });
      const artifactId = packet.approvalPacketArtifact?.id;
      if (artifactId === undefined) {
        throw new Error("Expected persisted approval packet artifact.");
      }

      const result = await orchestrateMoyinWorkflowRunContinueApprovedFromArtifact({
        registry,
        artifactStore,
        approvalPacketArtifactId: artifactId,
        approval: { status: "approved", operatorId: "operator-1" },
        nowMs: () => 1_779_000_000_000,
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-28T00:00:00.000Z",
          providerId: "moyin",
          reason: "approved Moyin workflow-run build sealed request from artifact",
        },
        sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
      });

      expect(result).toMatchObject({
        ok: true,
        status: "approval-required",
        packetRead: {
          ok: true,
          status: "found",
          artifactId,
        },
        continuation: {
          ok: true,
          status: "approval-required",
          projectId: "project-1",
          runId: "run-1",
          stepId: "step-1",
          action: "build_sealed_request",
          advance: {
            ok: true,
            status: "advanced",
          },
          nextApprovalPacket: {
            status: "approval-required",
            approvalPacket: {
              advanceAction: "execute",
              stepId: "step-1",
              sealedRequestId: "sealed-1",
            },
          },
        },
        metadata: {
          schemaVersion: "director.moyin.workflow-run.approved-continuation-from-artifact.v1",
          submitAttempted: false,
          advanceAttempted: true,
          executeAttempted: false,
        },
      });
      expect(calls.filter((call) => call[0] === "workflow-run" && call[1] === "advance")).toEqual([
        [
          "workflow-run",
          "advance",
          "run-1",
          "--project",
          "project-1",
          "--step",
          "step-1",
          "--action",
          "build_sealed_request",
          "--json",
        ],
      ]);
      expect(calls.flat()).not.toContain("submit");
      expect(calls.filter((call) => call.includes("execute"))).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the next-action smoke read-only and never advances or submits paid work", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-next-action-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const approvalLedgerRoot = join(root, "approval-ledger");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [
      { stepId: "script-1", status: "completed" },
      {
        stepId: "scene-image-1",
        status: "approval_required",
        sealedRequestId: "sealed-image-1",
        requiresApproval: true,
      },
    ],
  }));
  process.exit(0);
}
if (command.includes("workflow-run advance") || command.includes("sealed submit")) {
  console.error("next-action smoke must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [nextActionSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.workflow-next-action-smoke.v1",
        status: "approval-required",
        projectId: "project-1",
        runId: "run-1",
        read: {
          attempted: true,
          ok: true,
          operationId: "workflow-run.steps",
        },
        nextAction: {
          kind: "execute",
          operationId: "workflow-run.advance",
          advanceAction: "execute",
          stepId: "scene-image-1",
          requiresApproval: true,
          sealedRequestId: "sealed-image-1",
        },
        submit: {
          attempted: false,
        },
        advance: {
          attempted: false,
        },
      });
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports execute guidance for non-gated ready steps without sealed or build_request wording", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-next-action-execute-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const approvalLedgerRoot = join(root, "approval-ledger");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [
      { stepId: "script-generate-from-idea", status: "ready", requiresApproval: false },
      { stepId: "scene-image-1", status: "pending", requiresApproval: true },
    ],
  }));
  process.exit(0);
}
if (command.includes("workflow-run advance") || command.includes("sealed submit")) {
  console.error("next-action smoke must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [nextActionSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
        },
      });
      const parsed = JSON.parse(output);

      expect(parsed).toMatchObject({
        status: "ready-to-advance",
        nextAction: {
          kind: "execute",
          advanceAction: "execute",
          stepId: "script-generate-from-idea",
        },
      });
      expect(parsed.nextActions.join("\n")).toContain("execute");
      expect(parsed.nextActions.join("\n")).not.toContain("build_request");
      expect(parsed.nextActions.join("\n")).not.toContain("sealed");
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the until-next-gate smoke at the approval gate before mutating a run", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-until-next-gate-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const approvalLedgerRoot = join(root, "approval-ledger");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
  }));
  process.exit(0);
}
if (command.includes("workflow-run advance") || command.includes("sealed submit")) {
  console.error("until-next-gate smoke must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [untilNextGateSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_APPROVAL_LEDGER_ROOT: approvalLedgerRoot,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
        },
      });
      const parsed = JSON.parse(output);
      const approvalId = parsed.approvalPacket.approvalId;

      expect(parsed).toMatchObject({
        schemaVersion: "director.moyin.workflow-until-next-gate-smoke.v1",
        status: "approval-required",
        projectId: "project-1",
        runId: "run-1",
        plan: {
          status: "ready-to-advance",
          nextAction: {
            kind: "build_sealed_request",
            operationId: "workflow-run.advance",
            stepId: "step-1",
            requiresApproval: true,
          },
        },
        approvalPacket: {
          status: "approval-required",
          advanceAction: "build_sealed_request",
          stepId: "step-1",
          preflightAttempted: true,
        },
        submit: {
          attempted: false,
        },
        advance: {
          attempted: false,
        },
        resume: {
          attempted: false,
        },
        package: {
          attempted: false,
        },
      });
      const ledger = createFileConversationRuntimeApprovalLedger({
        rootPath: approvalLedgerRoot,
        nowMs: () => 1_779_000_000_000,
      });
      expect(ledger.listApprovals()).toEqual([
        expect.objectContaining({
          approvalId,
          status: "pending",
          operationId: "workflow-run.advance",
          turnId: "moyin-smoke-until-next-gate:project-1:run-1",
          sessionKey: "moyin:smoke:workflow-until-next-gate",
          toolCallId: "moyin.provider:workflow-run.advance",
        }),
      ]);
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ]);
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints a workflow-run approval packet smoke with the exact approved resume command", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-approval-packet-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
  }));
  process.exit(0);
}
if (command.includes("workflow-run advance") || command.includes("sealed submit")) {
  console.error("approval packet smoke must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [approvalPacketSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.workflow-approval-packet-smoke.v1",
        status: "approval-required",
        projectId: "project-1",
        runId: "run-1",
        approvalPacket: {
          schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
          operationId: "workflow-run.advance",
          advanceAction: "build_sealed_request",
          stepId: "step-1",
          requiresApproval: true,
          nextInvocation: {
            packageScript: "moyin:smoke:continue-approved",
            env: {
              MOYIN_SMOKE_PROJECT_ID: "project-1",
              MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
              MOYIN_SMOKE_STEP_ID: "step-1",
              MOYIN_SMOKE_ADVANCE_ACTION: "build_sealed_request",
              MOYIN_SMOKE_ALLOW_CONTINUE: "1",
              MOYIN_SMOKE_APPROVAL: "APPROVED",
              MOYIN_SMOKE_APPROVAL_TURN_ID:
                "moyin-smoke-advance:project-1:run-1:step-1:build_sealed_request",
              MOYIN_SMOKE_APPROVAL_SESSION_KEY: "moyin:smoke:workflow-approval-packet",
              MOYIN_SMOKE_RESUME_TOKEN:
                "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
              MOYIN_SMOKE_APPROVAL_EXPIRES_AT_MS: expect.any(String),
            },
            shellCommand: expect.stringContaining("MOYIN_SMOKE_APPROVAL_EXPIRES_AT_MS="),
          },
          mutation: {
            advanceAttempted: false,
            submitAttempted: false,
            executeAttempted: false,
          },
        },
        submit: {
          attempted: false,
        },
        advance: {
          attempted: false,
        },
      });
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ]);
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists production readiness approval packets into the shared approval ledger", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-production-readiness-ledger-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const approvalLedgerRoot = join(root, "approval-ledger");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "project list --json") {
  console.log(JSON.stringify({ items: [{ projectId: "project-1" }] }));
  process.exit(0);
}
if (command === "project get project-1 --json") {
  console.log(JSON.stringify({
    projectId: "project-1",
    name: "Project 1",
    active: true,
    stores: [
      { key: "_p/project-1/script", storeName: "script", sizeBytes: 4096 },
      { key: "_p/project-1/sclass", storeName: "sclass", sizeBytes: 8192 },
    ],
  }));
  process.exit(0);
}
if (command === "project store get --project project-1 --store script --json") {
  console.log(JSON.stringify({
    projectId: "project-1",
    key: "_p/project-1/script",
    storeName: "script",
    source: "storage-bridge",
    state: {
      activeProjectId: "project-1",
      projectData: {
        parseStatus: "ready",
        episodeRawScripts: [{ episodeIndex: 1, content: "第一集剧本" }],
        scriptData: { scenes: [{ id: "scene-1" }] },
        shots: [{ id: "shot-1" }],
      },
    },
  }));
  process.exit(0);
}
if (command === "project store get --project project-1 --store sclass --json") {
  console.log(JSON.stringify({
    projectId: "project-1",
    key: "_p/project-1/sclass",
    storeName: "sclass",
    source: "storage-bridge",
    state: {
      activeProjectId: "project-1",
      projectData: {
        splitScenes: [{ id: 1 }],
        shotGroups: [{ id: "group-1", sceneIds: [1] }],
        sceneAnchors: [{ id: "anchor-1" }],
        lastAdaptationSummary: {
          profileSnapshot: {
            rhythmEngine: { enabled: true, preferredStrategy: "auto" },
          },
        },
      },
    },
  }));
  process.exit(0);
}
if (command === "config providers --json") {
  console.log(JSON.stringify({ providers: [{ id: "provider-1", hasApiKey: true }] }));
  process.exit(0);
}
if (command === "config models --json") {
  console.log(JSON.stringify({ items: [{ model: "video-model-1" }] }));
  process.exit(0);
}
if (command === "task template list --json") {
  console.log(JSON.stringify({ items: [{ templateId: "script.generate-from-idea" }] }));
  process.exit(0);
}
if (command === "workflow list --project project-1 --json") {
  console.log(JSON.stringify({ items: [] }));
  process.exit(0);
}
if (command === "task list --project project-1 --json") {
  console.log(JSON.stringify({ items: [] }));
  process.exit(0);
}
if (command === "workflow-run list --project project-1 --json") {
  console.log(JSON.stringify({ items: [{ runId: "run-1" }] }));
  process.exit(0);
}
if (command === "artifact list --project project-1 --json") {
  console.log(JSON.stringify({ items: [] }));
  process.exit(0);
}
if (command === "prompt list --project project-1 --json") {
  console.log(JSON.stringify({ items: [] }));
  process.exit(0);
}
if (command === "memory get --project project-1 --json") {
  console.log(JSON.stringify({ memory: {} }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
  }));
  process.exit(0);
}
if (command.includes("workflow-run advance") || command.includes("sealed submit")) {
  console.error("production readiness must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [productionReadinessSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
          MOYIN_SMOKE_APPROVAL_LEDGER_ROOT: approvalLedgerRoot,
        },
      });
      const parsed = JSON.parse(output);
      const approvalId = parsed.readiness.approvalPacket.approvalId;

      expect(parsed).toMatchObject({
        schemaVersion: "director.moyin.production-readiness-smoke.v1",
        status: "waiting_for_approval",
        mutation: {
          advanceAttempted: false,
          executeAttempted: false,
          submitAttempted: false,
        },
        readiness: {
          approvalPacket: {
            status: "approval-required",
            advanceAction: "build_sealed_request",
            stepId: "step-1",
            approvalId: expect.any(String),
          },
        },
      });
      const ledger = createFileConversationRuntimeApprovalLedger({
        rootPath: approvalLedgerRoot,
        nowMs: () => 1_779_000_000_000,
      });
      expect(ledger.listApprovals()).toEqual([
        expect.objectContaining({
          approvalId,
          status: "pending",
          operationId: "workflow-run.advance",
          turnId: "moyin-smoke-production-readiness:project-1:run-1",
          sessionKey: "moyin:smoke:production-readiness",
          toolCallId: "moyin.provider:workflow-run.advance",
        }),
      ]);
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls.map((call) => call.join(" "))).toEqual(
        expect.arrayContaining([
          "project store get --project project-1 --store script --json",
          "project store get --project project-1 --store sclass --json",
        ]),
      );
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("continues an approved build_sealed_request packet and returns the next execute approval gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-continue-build-sealed-"));
    try {
      const calls: string[][] = [];
      const approvalLedger = createFileConversationRuntimeApprovalLedger({
        rootPath: join(root, "approval-ledger"),
        nowMs: () => 1_779_000_000_000,
      });
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_779_000_000_000,
        approvalLedger,
      });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ args }) => {
            calls.push([...args]);
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
              const sealed = calls.some(
                (call) => call[0] === "workflow-run" && call[1] === "advance",
              );
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [
                    {
                      stepId: "step-1",
                      status: sealed ? "approval_required" : "ready",
                      sealedRequestId: sealed ? "sealed-1" : undefined,
                      requiresApproval: true,
                    },
                  ],
                }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run advance run-1 --project project-1 --step step-1 --action build_sealed_request --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  runId: "run-1",
                  stepId: "step-1",
                  action: "build_sealed_request",
                  status: "advanced",
                  sealedRequestId: "sealed-1",
                  step: {
                    stepId: "step-1",
                    status: "approval_required",
                    sealedRequestId: "sealed-1",
                  },
                }),
                stderr: "",
              };
            }
            const sealedGet = createMoyinSealedGetRunnerOutput(args);
            if (sealedGet !== undefined) {
              return sealedGet;
            }
            if (args.includes("execute") || args.includes("submit")) {
              return {
                exitCode: 9,
                stdout: "",
                stderr: "continue build_sealed_request must not execute or submit",
              };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const packet = await createMoyinWorkflowRunApprovalPacket({
        registry,
        projectId: "project-1",
        runId: "run-1",
      });
      expect(packet.status).toBe("approval-required");
      expect(packet.approvalPacket?.advanceAction).toBe("build_sealed_request");
      const approvalPacket = packet.approvalPacket;
      if (approvalPacket === undefined) {
        throw new Error("Expected build_sealed_request approval packet.");
      }

      const result = await orchestrateMoyinWorkflowRunContinueApproved({
        registry,
        approvalPacket,
        approval: { status: "approved", operatorId: "operator-1" },
        nowMs: () => 1_779_000_000_000,
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-28T00:00:00.000Z",
          providerId: "moyin",
          reason: "approved Moyin workflow-run build sealed request",
        },
        sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
      });

      expect(result).toMatchObject({
        ok: true,
        status: "approval-required",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        action: "build_sealed_request",
        approvalId: packet.approvalPacket?.approvalId,
        advance: {
          ok: true,
          status: "advanced",
          postAdvanceStep: {
            stepId: "step-1",
            status: "approval_required",
            sealedRequestId: "sealed-1",
          },
        },
        nextGate: {
          status: "approval-required",
          plan: {
            nextAction: {
              kind: "execute",
              advanceAction: "execute",
              stepId: "step-1",
              sealedRequestId: "sealed-1",
            },
          },
        },
        nextApprovalPacket: {
          status: "approval-required",
          approvalPacket: {
            advanceAction: "execute",
            stepId: "step-1",
            sealedRequestId: "sealed-1",
            mutation: {
              advanceAttempted: false,
              submitAttempted: false,
              executeAttempted: false,
            },
          },
        },
        metadata: expect.objectContaining({
          schemaVersion: "director.moyin.workflow-run.approved-continuation.v1",
          submitAttempted: false,
          advanceAttempted: true,
          executeAttempted: false,
          nextGateAttempted: true,
          nextApprovalPacketCreated: true,
        }),
      });
      expect(calls.filter((call) => call[0] === "workflow-run" && call[1] === "advance")).toEqual([
        [
          "workflow-run",
          "advance",
          "run-1",
          "--project",
          "project-1",
          "--step",
          "step-1",
          "--action",
          "build_sealed_request",
          "--json",
        ],
      ]);
      expect(calls.flat()).not.toContain("submit");
      expect(calls.filter((call) => call.includes("execute"))).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("continues an approved execute packet through task watch and package artifact persistence", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-continue-execute-package-"));
    try {
      const handoffManifestDirectory = join(root, "handoff");
      const artifactStore = createFileConversationRuntimeExternalArtifactStore({
        rootPath: join(root, "artifact-store"),
        nowMs: () => 1_779_000_000_000,
      });
      const calls: string[][] = [];
      const approvalLedger = createFileConversationRuntimeApprovalLedger({
        rootPath: join(root, "approval-ledger"),
        nowMs: () => 1_779_000_000_000,
      });
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_779_000_000_000,
        approvalLedger,
        artifactStore,
      });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ args }) => {
            calls.push([...args]);
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
              const executed = calls.some(
                (call) => call[0] === "workflow-run" && call[1] === "advance",
              );
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [
                    {
                      stepId: "step-1",
                      status: executed ? "completed" : "approval_required",
                      sealedRequestId: "sealed-1",
                      taskId: executed ? "task-1" : undefined,
                      requiresApproval: true,
                    },
                  ],
                }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run advance run-1 --project project-1 --step step-1 --action execute --confirm SUBMIT --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  runId: "run-1",
                  stepId: "step-1",
                  action: "execute",
                  status: "advanced",
                  sealedRequestId: "sealed-1",
                  taskId: "task-1",
                  step: {
                    stepId: "step-1",
                    status: "running",
                    sealedRequestId: "sealed-1",
                    taskId: "task-1",
                  },
                }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run artifacts run-1 --project project-1 --step step-1 --json"
            ) {
              return { exitCode: 0, stdout: JSON.stringify({ items: [], total: 0 }), stderr: "" };
            }
            if (args.join(" ") === "artifact backfill --project project-1 --task task-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [
                    {
                      artifactId: "artifact-step-1",
                      type: "image",
                      localPath: "/tmp/moyin/step-1.png",
                      runId: "run-1",
                      stepId: "step-1",
                      taskId: "task-1",
                    },
                  ],
                  total: 1,
                }),
                stderr: "",
              };
            }
            if (args.join(" ") === "task watch task-1 --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ taskId: "task-1", status: "completed", progress: 100 }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run get run-1 --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  runId: "run-1",
                  projectId: "project-1",
                  status: "completed",
                }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run artifacts run-1 --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [
                    {
                      artifactId: "artifact-step-1",
                      type: "image",
                      localPath: "/tmp/moyin/step-1.png",
                      runId: "run-1",
                      stepId: "step-1",
                      taskId: "task-1",
                    },
                  ],
                  total: 1,
                }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run export run-1 --project project-1 --target json --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ id: "run-1-json", runId: "run-1", target: "json" }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run export run-1 --project project-1 --target comfyui-draft --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  id: "run-1-comfyui",
                  runId: "run-1",
                  target: "comfyui-draft",
                  conversion: { executable: false, lossiness: "lossy" },
                }),
                stderr: "",
              };
            }
            const sealedGet = createMoyinSealedGetRunnerOutput(args);
            if (sealedGet !== undefined) {
              return sealedGet;
            }
            if (args.includes("submit")) {
              return { exitCode: 9, stdout: "", stderr: "execute continuation must not submit" };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const packet = await createMoyinWorkflowRunApprovalPacket({
        registry,
        projectId: "project-1",
        runId: "run-1",
      });
      expect(packet.approvalPacket?.advanceAction).toBe("execute");
      const approvalPacket = packet.approvalPacket;
      if (approvalPacket === undefined) {
        throw new Error("Expected execute approval packet.");
      }

      const result = await orchestrateMoyinWorkflowRunContinueApproved({
        registry,
        approvalPacket,
        approval: { status: "approved", operatorId: "operator-1" },
        nowMs: () => 1_779_000_000_000,
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-28T00:00:00.000Z",
          providerId: "moyin",
          reason: "approved Moyin workflow-run execute",
        },
        sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
        artifactStore,
        handoffManifestDirectory,
      });

      expect(result).toMatchObject({
        ok: true,
        status: "packaged",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        action: "execute",
        execute: {
          ok: true,
          status: "packaged",
          sealedRequestId: "sealed-1",
          taskId: "task-1",
          package: {
            status: "packaged",
            handoffManifestArtifactPersistence: {
              status: "ok",
              artifactIds: ["moyin-handoff:project-1:run-1"],
            },
          },
        },
        metadata: expect.objectContaining({
          schemaVersion: "director.moyin.workflow-run.approved-continuation.v1",
          submitAttempted: false,
          advanceAttempted: true,
          executeAttempted: true,
          packageAttempted: true,
        }),
      });
      expect(artifactStore.listArtifacts({ providerId: "moyin", runId: "run-1" })).toContainEqual(
        expect.objectContaining({
          artifactId: "moyin-handoff:project-1:run-1",
          operationId: "workflow-run.production-package",
        }),
      );
      expect(calls.filter((call) => call[0] === "workflow-run" && call[1] === "advance")).toEqual([
        [
          "workflow-run",
          "advance",
          "run-1",
          "--project",
          "project-1",
          "--step",
          "step-1",
          "--action",
          "execute",
          "--confirm",
          "SUBMIT",
          "--json",
        ],
      ]);
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns to the next approval gate after executing one workflow-run step", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-execute-next-gate-"));
    try {
      const artifactStore = createFileConversationRuntimeExternalArtifactStore({
        rootPath: join(root, "artifact-store"),
        nowMs: () => 1_779_000_000_000,
      });
      const calls: string[][] = [];
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_779_000_000_000,
        artifactStore,
      });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ args }) => {
            calls.push([...args]);
            const executed = calls.some(
              (call) =>
                call.join(" ") ===
                "workflow-run advance run-1 --project project-1 --step scene-image --action execute --confirm SUBMIT --json",
            );
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: executed
                    ? [
                        {
                          stepId: "scene-image",
                          status: "completed",
                          sealedRequestId: "sealed-image",
                          taskId: "task-image",
                          requiresApproval: true,
                        },
                        {
                          stepId: "scene-video",
                          status: "ready",
                          requiresApproval: true,
                        },
                      ]
                    : [
                        {
                          stepId: "scene-image",
                          status: "approval_required",
                          sealedRequestId: "sealed-image",
                          requiresApproval: true,
                        },
                        {
                          stepId: "scene-video",
                          status: "pending",
                          requiresApproval: true,
                        },
                      ],
                }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run advance run-1 --project project-1 --step scene-image --action execute --confirm SUBMIT --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  runId: "run-1",
                  stepId: "scene-image",
                  action: "execute",
                  status: "advanced",
                  sealedRequestId: "sealed-image",
                  taskId: "task-image",
                  step: {
                    stepId: "scene-image",
                    status: "running",
                    sealedRequestId: "sealed-image",
                    taskId: "task-image",
                  },
                }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run artifacts run-1 --project project-1 --step scene-image --json"
            ) {
              return { exitCode: 0, stdout: JSON.stringify({ items: [], total: 0 }), stderr: "" };
            }
            if (
              args.join(" ") === "artifact backfill --project project-1 --task task-image --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [
                    {
                      artifactId: "artifact-image",
                      type: "image",
                      localPath: "/tmp/moyin/image.png",
                      runId: "run-1",
                      stepId: "scene-image",
                      taskId: "task-image",
                    },
                  ],
                  total: 1,
                }),
                stderr: "",
              };
            }
            if (args.join(" ") === "task watch task-image --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  taskId: "task-image",
                  status: "completed",
                  progress: 100,
                }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run get run-1 --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  runId: "run-1",
                  projectId: "project-1",
                  status: "running",
                }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run artifacts run-1 --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [
                    {
                      artifactId: "artifact-image",
                      type: "image",
                      localPath: "/tmp/moyin/image.png",
                      runId: "run-1",
                      stepId: "scene-image",
                      taskId: "task-image",
                    },
                  ],
                  total: 1,
                }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run export run-1 --project project-1 --target json --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ id: "run-1-json", runId: "run-1", target: "json" }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "workflow-run export run-1 --project project-1 --target comfyui-draft --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  id: "run-1-comfyui",
                  runId: "run-1",
                  target: "comfyui-draft",
                  conversion: { executable: false, lossiness: "lossy" },
                }),
                stderr: "",
              };
            }
            const sealedGet = createMoyinSealedGetRunnerOutput(args);
            if (sealedGet !== undefined) {
              return sealedGet;
            }
            if (
              args.join(" ") ===
              "workflow-run advance run-1 --project project-1 --step scene-video --action build_sealed_request --json"
            ) {
              return {
                exitCode: 9,
                stdout: "",
                stderr: "next gate must not build the video sealed request without a new approval",
              };
            }
            if (args.includes("submit")) {
              return { exitCode: 9, stdout: "", stderr: "execute next gate must not submit" };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const packet = await createMoyinWorkflowRunApprovalPacket({
        registry,
        projectId: "project-1",
        runId: "run-1",
      });
      expect(packet.approvalPacket?.advanceAction).toBe("execute");
      const approvalPacket = packet.approvalPacket;
      if (approvalPacket === undefined) {
        throw new Error("Expected execute approval packet.");
      }

      const result = await orchestrateMoyinWorkflowRunContinueApproved({
        registry,
        approvalPacket,
        approval: { status: "approved", operatorId: "operator-1" },
        nowMs: () => 1_779_000_000_000,
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-28T00:00:00.000Z",
          providerId: "moyin",
          reason: "approved Moyin workflow-run execute",
        },
        sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
        artifactStore,
        handoffManifestDirectory: join(root, "handoff"),
        approvalPacketDirectory: join(root, "approval-packets"),
      });

      expect(result).toMatchObject({
        ok: true,
        status: "approval-required",
        execute: {
          ok: true,
          status: "partial",
          sealedRequestId: "sealed-image",
          taskId: "task-image",
        },
        nextGate: {
          status: "approval-required",
          plan: {
            nextAction: {
              kind: "build_sealed_request",
              advanceAction: "build_sealed_request",
              stepId: "scene-video",
            },
          },
        },
        nextApprovalPacket: {
          status: "approval-required",
          approvalPacket: {
            advanceAction: "build_sealed_request",
            stepId: "scene-video",
            mutation: {
              advanceAttempted: false,
              submitAttempted: false,
              executeAttempted: false,
            },
          },
        },
        metadata: expect.objectContaining({
          submitAttempted: false,
          advanceAttempted: true,
          executeAttempted: true,
          nextGateAttempted: true,
          nextApprovalPacketCreated: true,
          packageAttempted: true,
        }),
      });
      expect(calls.filter((call) => call[0] === "workflow-run" && call[1] === "advance")).toEqual([
        [
          "workflow-run",
          "advance",
          "run-1",
          "--project",
          "project-1",
          "--step",
          "scene-image",
          "--action",
          "execute",
          "--confirm",
          "SUBMIT",
          "--json",
        ],
      ]);
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed before touching Moyin when an approval packet is missing approved consent", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          return { exitCode: 9, stdout: "", stderr: "Moyin must not be called" };
        },
      }),
    );
    const approvalPacket = {
      schemaVersion: "director.moyin.workflow-run.approval-packet.v1" as const,
      type: "approval_request" as const,
      providerId: "moyin" as const,
      operationId: "workflow-run.advance" as const,
      advanceAction: "build_sealed_request",
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      approvalId: "approval-1",
      approvalExpiresAtMs: 1_779_000_060_000,
      requiresApproval: true as const,
      riskLevel: "high" as const,
      resumeToken: "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
      nextInvocation: {
        packageScript: "moyin:smoke:advance" as const,
        env: {},
        shellCommand: "pnpm -s moyin:smoke:advance",
      },
      mutation: {
        advanceAttempted: false as const,
        submitAttempted: false as const,
        executeAttempted: false as const,
      },
    };

    await expect(
      orchestrateMoyinWorkflowRunContinueApproved({
        registry,
        approvalPacket,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_MISSING",
      },
      metadata: expect.objectContaining({
        advanceAttempted: false,
        executeAttempted: false,
      }),
    });
    await expect(
      orchestrateMoyinWorkflowRunContinueApproved({
        registry,
        approvalPacket,
        approval: { status: "rejected", operatorId: "operator-1", reason: "stop" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_REJECTED",
      },
      metadata: expect.objectContaining({
        advanceAttempted: false,
        executeAttempted: false,
      }),
    });
    await expect(
      orchestrateMoyinWorkflowRunContinueApproved({
        registry,
        approvalPacket: { ...approvalPacket, approvalExpiresAtMs: 1_778_999_999_999 },
        approval: { status: "approved", operatorId: "operator-1" },
        nowMs: () => 1_779_000_000_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_EXPIRED",
      },
      metadata: expect.objectContaining({
        advanceAttempted: false,
        executeAttempted: false,
      }),
    });
    expect(calls).toEqual([]);
  });

  it("can reissue a fresh approval packet after the previous workflow-run approval expired", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
              }),
              stderr: "",
            };
          }
          if (args.join(" ").includes("workflow-run advance")) {
            return {
              exitCode: 9,
              stdout: "",
              stderr: "expired approval reissue must not mutate a workflow-run",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );
    const approvalPacket = {
      schemaVersion: "director.moyin.workflow-run.approval-packet.v1" as const,
      type: "approval_request" as const,
      providerId: "moyin" as const,
      operationId: "workflow-run.advance" as const,
      advanceAction: "build_sealed_request",
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      approvalId: "approval-expired",
      approvalExpiresAtMs: 1_778_999_999_999,
      requiresApproval: true as const,
      riskLevel: "high" as const,
      resumeToken: "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
      nextInvocation: {
        packageScript: "moyin:smoke:continue-approved" as const,
        env: {},
        shellCommand: "pnpm -s moyin:smoke:continue-approved",
      },
      mutation: {
        advanceAttempted: false as const,
        submitAttempted: false as const,
        executeAttempted: false as const,
      },
    };

    const result = await orchestrateMoyinWorkflowRunContinueApproved({
      registry,
      approvalPacket,
      approval: { status: "approved", operatorId: "operator-1" },
      nowMs: () => 1_779_000_000_000,
      reissueExpiredApprovalPacket: true,
      turnId: "turn-reissue",
      sessionKey: "session-reissue",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "approval-required",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_EXPIRED",
      },
      nextApprovalPacket: {
        ok: true,
        status: "approval-required",
        approvalPacket: {
          advanceAction: "build_sealed_request",
          stepId: "step-1",
          approvalBinding: {
            turnId: "turn-reissue",
            sessionKey: "session-reissue",
          },
          mutation: {
            advanceAttempted: false,
            submitAttempted: false,
            executeAttempted: false,
          },
        },
      },
      metadata: expect.objectContaining({
        advanceAttempted: false,
        executeAttempted: false,
        nextGateAttempted: false,
        nextApprovalPacketCreated: true,
      }),
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
    expect(calls.flat()).not.toContain("advance");
    expect(calls.flat()).not.toContain("submit");
  });

  it("can reissue a fresh approval packet when the approval ledger record expired", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-ledger-expired-reissue-"));
    try {
      const calls: string[][] = [];
      const approvalLedger = createFileConversationRuntimeApprovalLedger({
        rootPath: join(root, "approval-ledger"),
        nowMs: () => 1_779_000_000_000,
      });
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_779_000_000_000,
        approvalLedger,
      });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ args }) => {
            calls.push([...args]);
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              };
            }
            if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
                }),
                stderr: "",
              };
            }
            if (args.join(" ").includes("workflow-run advance")) {
              return {
                exitCode: 9,
                stdout: "",
                stderr: "expired approval reissue must not mutate a workflow-run",
              };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );
      const approvalPacket = {
        schemaVersion: "director.moyin.workflow-run.approval-packet.v1" as const,
        type: "approval_request" as const,
        providerId: "moyin" as const,
        operationId: "workflow-run.advance" as const,
        advanceAction: "build_sealed_request",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        approvalId:
          "external-tool:moyin-smoke-advance:project-1:run-1:step-1:build_sealed_request:moyin.provider:workflow-run.advance:invoke",
        approvalBinding: {
          turnId: "moyin-smoke-advance:project-1:run-1:step-1:build_sealed_request",
          sessionKey: "moyin:workflow-run:approval-packet",
        },
        approvalExpiresAtMs: 1_779_000_060_000,
        requiresApproval: true as const,
        riskLevel: "high" as const,
        resumeToken: "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
        nextInvocation: {
          packageScript: "moyin:smoke:continue-approved" as const,
          env: {},
          shellCommand: "pnpm -s moyin:smoke:continue-approved",
        },
        mutation: {
          advanceAttempted: false as const,
          submitAttempted: false as const,
          executeAttempted: false as const,
        },
      };
      approvalLedger.upsertApproval({
        approval: {
          schemaVersion: "conversation-runtime.approval-ledger-record.v1",
          approvalId: approvalPacket.approvalId,
          status: "pending",
          scope: "single_operation",
          toolId: "moyin.provider",
          operationId: "workflow-run.advance",
          turnId: approvalPacket.approvalBinding.turnId,
          sessionKey: approvalPacket.approvalBinding.sessionKey,
          toolCallId: "moyin.provider:workflow-run.advance",
          argsHash: "693ab28f1d07a24b3d5c23cafaf1d14a6b0f0d7df73dfdfb55805b2674d374da",
          redactedPayloadHash: "ca8f16aafba3420cf3f598dbca03416f5fe39217a05f83212b6c29dad338d054",
          requestedByChannel: "runtime",
          requestedAtMs: 1_778_999_000_000,
          expiresAtMs: 1_778_999_999_999,
        },
      });

      const result = await orchestrateMoyinWorkflowRunContinueApproved({
        registry,
        approvalPacket,
        approval: { status: "approved", operatorId: "operator-1" },
        nowMs: () => 1_779_000_000_000,
        reissueExpiredApprovalPacket: true,
      });

      expect(result).toMatchObject({
        ok: true,
        status: "approval-required",
        error: {
          code: "external-tool-approval-ledger-expired",
        },
        nextApprovalPacket: {
          ok: true,
          status: "approval-required",
          approvalPacket: {
            advanceAction: "build_sealed_request",
            stepId: "step-1",
            mutation: {
              advanceAttempted: false,
              submitAttempted: false,
              executeAttempted: false,
            },
          },
        },
        metadata: expect.objectContaining({
          advanceAttempted: false,
          executeAttempted: false,
          nextGateAttempted: false,
          nextApprovalPacketCreated: true,
        }),
      });
      expect(calls).toEqual([
        ["status", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ]);
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("can reissue a fresh approval packet when the approval ledger record is missing", async () => {
    const calls: string[][] = [];
    const approvalLedger = createFileConversationRuntimeApprovalLedger({
      rootPath: mkdtempSync(join(tmpdir(), "moyin-ledger-missing-reissue-")),
      nowMs: () => 1_779_000_000_000,
    });
    const registry = new ExternalToolRegistry({
      nowMs: () => 1_779_000_000_000,
      approvalLedger,
    });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
              }),
              stderr: "",
            };
          }
          if (args.join(" ").includes("workflow-run advance")) {
            return {
              exitCode: 9,
              stdout: "",
              stderr: "missing approval reissue must not mutate a workflow-run",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunContinueApproved({
      registry,
      approvalPacket: {
        schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
        type: "approval_request",
        providerId: "moyin",
        operationId: "workflow-run.advance",
        advanceAction: "build_sealed_request",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        approvalId:
          "external-tool:moyin-smoke-until-next-gate:project-1:run-1:moyin.provider:workflow-run.advance:invoke",
        approvalBinding: {
          turnId: "moyin-smoke-until-next-gate:project-1:run-1",
          sessionKey: "moyin:smoke:workflow-until-next-gate",
        },
        approvalExpiresAtMs: 1_779_000_060_000,
        requiresApproval: true,
        riskLevel: "high",
        resumeToken: "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
        nextInvocation: {
          packageScript: "moyin:smoke:continue-approved",
          env: {},
          shellCommand: "pnpm -s moyin:smoke:continue-approved",
        },
        mutation: {
          advanceAttempted: false,
          submitAttempted: false,
          executeAttempted: false,
        },
      },
      approval: { status: "approved", operatorId: "operator-1" },
      nowMs: () => 1_779_000_000_000,
      reissueExpiredApprovalPacket: true,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "approval-required",
      error: {
        code: "external-tool-approval-ledger-approval-not-found",
      },
      nextApprovalPacket: {
        ok: true,
        status: "approval-required",
        approvalPacket: {
          stepId: "step-1",
          advanceAction: "build_sealed_request",
          mutation: {
            advanceAttempted: false,
            submitAttempted: false,
            executeAttempted: false,
          },
        },
      },
      metadata: expect.objectContaining({
        advanceAttempted: false,
        executeAttempted: false,
        nextGateAttempted: false,
        nextApprovalPacketCreated: true,
      }),
    });
    expect(calls.flat()).not.toContain("advance");
    expect(calls.flat()).not.toContain("submit");
  });

  it("defaults the continue-approved smoke to reissue a fresh approval packet when the approval ledger record is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-continue-missing-ledger-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const approvalRoot = join(root, "approval-ledger");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
  }));
  process.exit(0);
}
if (command.includes("workflow-run advance") || command.includes("sealed submit")) {
  console.error("missing approval ledger reissue must not mutate a workflow-run");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [continueApprovedSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_APPROVAL_LEDGER_ROOT: approvalRoot,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
          MOYIN_SMOKE_STEP_ID: "step-1",
          MOYIN_SMOKE_ADVANCE_ACTION: "build_sealed_request",
          MOYIN_SMOKE_ALLOW_CONTINUE: "1",
          MOYIN_SMOKE_APPROVAL: "APPROVED",
          MOYIN_SMOKE_APPROVAL_TURN_ID: "moyin-smoke-until-next-gate:project-1:run-1",
          MOYIN_SMOKE_APPROVAL_SESSION_KEY: "moyin:smoke:workflow-until-next-gate",
          MOYIN_SMOKE_RESUME_TOKEN:
            "moyin-workflow-run:project-1:run-1:step-1:build_sealed_request",
          MOYIN_SMOKE_APPROVAL_ID:
            "external-tool:moyin-smoke-until-next-gate:project-1:run-1:moyin.provider:workflow-run.advance:invoke",
          MOYIN_SMOKE_APPROVAL_EXPIRES_AT_MS: "4102444800000",
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.workflow-continue-approved-smoke.v1",
        status: "approval-required",
        continue: {
          attempted: false,
          reissueExpiredApprovalPacket: true,
        },
        advance: {
          attempted: false,
          ok: false,
          status: "failed",
        },
        nextApprovalPacket: {
          status: "approval-required",
          advanceAction: "build_sealed_request",
          stepId: "step-1",
        },
        error: {
          code: "external-tool-approval-ledger-approval-not-found",
        },
      });
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ]);
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the workflow-run advance smoke approval-gated before mutating a run", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-advance-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const approvalRoot = join(root, "approval-ledger");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [{ stepId: "step-1", status: "ready", requiresApproval: true }],
  }));
  process.exit(0);
}
if (command.includes("workflow-run advance") || command.includes("sealed submit")) {
  console.error("advance smoke must not mutate without explicit approval");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [advanceSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_APPROVAL_LEDGER_ROOT: approvalRoot,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
          MOYIN_SMOKE_STEP_ID: "step-1",
          MOYIN_SMOKE_ADVANCE_ACTION: "build_sealed_request",
          MOYIN_SMOKE_ALLOW_ADVANCE: "",
          MOYIN_SMOKE_APPROVAL: "",
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.workflow-advance-smoke.v1",
        status: "approval-required",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        action: "build_sealed_request",
        advance: {
          attempted: false,
          reason: "explicit-advance-approval-required",
        },
        submit: {
          attempted: false,
        },
      });
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows the workflow-run advance smoke to build a sealed request only after explicit approval", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-advance-approved-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const approvalRoot = join(root, "approval-ledger");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
const calls = existsSync(process.env.MOYIN_FAKE_CALL_LOG)
  ? readFileSync(process.env.MOYIN_FAKE_CALL_LOG, "utf8")
      .trim()
      .split("\\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];
const advanceAlreadyCalled = calls.some((call) => call[0] === "workflow-run" && call[1] === "advance");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [{
      stepId: "step-1",
      status: advanceAlreadyCalled ? "approval_required" : "ready",
      sealedRequestId: advanceAlreadyCalled ? "sealed-1" : undefined,
      requiresApproval: true,
    }],
  }));
  process.exit(0);
}
if (command === "workflow-run advance run-1 --project project-1 --step step-1 --action build_sealed_request --json") {
  console.log(JSON.stringify({
    runId: "run-1",
    stepId: "step-1",
    action: "build_sealed_request",
    status: "advanced",
    sealedRequestId: "sealed-1",
    step: { stepId: "step-1", status: "approval_required", sealedRequestId: "sealed-1" },
  }));
  process.exit(0);
}
if (command.includes("sealed submit")) {
  console.error("advance smoke must never submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [advanceSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_APPROVAL_LEDGER_ROOT: approvalRoot,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
          MOYIN_SMOKE_STEP_ID: "step-1",
          MOYIN_SMOKE_ADVANCE_ACTION: "build_sealed_request",
          MOYIN_SMOKE_ALLOW_ADVANCE: "1",
          MOYIN_SMOKE_APPROVAL: "ADVANCE",
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.workflow-advance-smoke.v1",
        status: "advanced",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        action: "build_sealed_request",
        sealedRequestId: "sealed-1",
        postAdvanceStep: {
          stepId: "step-1",
          status: "approval_required",
          sealedRequestId: "sealed-1",
        },
        advance: {
          attempted: true,
          reason: "explicit-advance-approved",
          ok: true,
          status: "success",
          operationId: "workflow-run.advance",
        },
        submit: {
          attempted: false,
        },
      });
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        [
          "workflow-run",
          "advance",
          "run-1",
          "--project",
          "project-1",
          "--step",
          "step-1",
          "--action",
          "build_sealed_request",
          "--json",
        ],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ]);
      expect(calls.some((call) => call.includes("submit"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the resume/package smoke read-only and never advances or submits paid work", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-resume-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "task watch task-1 --project project-1 --json") {
  console.log(JSON.stringify({ taskId: "task-1", status: "completed", progress: 1 }));
  process.exit(0);
}
if (command === "workflow-run get run-1 --project project-1 --json") {
  console.log(JSON.stringify({ runId: "run-1", projectId: "project-1", status: "completed" }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [{ stepId: "step-1", status: "completed", taskId: "task-1" }],
  }));
  process.exit(0);
}
if (command === "workflow-run artifacts run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [{ artifactId: "artifact-1", type: "image", localPath: "/tmp/out.png", taskId: "task-1" }],
  }));
  process.exit(0);
}
if (command === "workflow-run export run-1 --project project-1 --target json --json") {
  console.log(JSON.stringify({ runId: "run-1", target: "json" }));
  process.exit(0);
}
if (command === "workflow-run export run-1 --project project-1 --target comfyui-draft --json") {
  console.log(JSON.stringify({ runId: "run-1", target: "comfyui-draft" }));
  process.exit(0);
}
if (command.includes("workflow-run advance") || command.includes("sealed submit")) {
  console.error("resume smoke must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [resumePackageSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
          MOYIN_SMOKE_STEP_ID: "step-1",
          MOYIN_SMOKE_TASK_ID: "task-1",
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.workflow-resume-package-smoke.v1",
        status: "packaged",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        taskId: "task-1",
        resume: {
          attempted: true,
          reason: "resume-existing-task",
        },
        execute: {
          attempted: false,
        },
        package: {
          attempted: true,
          status: "packaged",
          artifactCount: 1,
        },
      });
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["task", "watch", "task-1", "--project", "project-1", "--json"],
        ["workflow-run", "get", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "artifacts", "run-1", "--project", "project-1", "--json"],
        ["workflow-run", "export", "run-1", "--project", "project-1", "--target", "json", "--json"],
        [
          "workflow-run",
          "export",
          "run-1",
          "--project",
          "project-1",
          "--target",
          "comfyui-draft",
          "--json",
        ],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the execute/package smoke at approval-required without running advance when approval env is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-execute-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOYIN_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [{ stepId: "step-1", status: "approval_required", sealedRequestId: "sealed-1" }],
  }));
  process.exit(0);
}
if (command === "sealed get sealed-1 --json") {
  console.log(JSON.stringify({
    sealedRequest: {
      sealedRequestId: "sealed-1",
      status: "sealed",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  }));
  process.exit(0);
}
if (command.includes("workflow-run advance")) {
  console.error("advance should not run without explicit smoke approval");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [executePackageSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
          MOYIN_SMOKE_STEP_ID: "step-1",
          MOYIN_SMOKE_ALLOW_EXECUTE: "",
          MOYIN_SMOKE_APPROVAL: "",
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.workflow-execute-package-smoke.v1",
        status: "approval-required",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        sealedRequestId: "sealed-1",
        submit: {
          attempted: false,
          reason: "explicit-execute-approval-required",
        },
      });
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
        ["sealed", "get", "sealed-1", "--json"],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads steps before advance and reads steps again after an approved advance", async () => {
    const mutableCalls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          mutableCalls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            const stepStatus = mutableCalls.some((call) => call.includes("advance"))
              ? "approval_required"
              : "ready";
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: stepStatus,
                    sealedRequestId: stepStatus === "approval_required" ? "sealed-1" : undefined,
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run advance run-1 --project project-1 --step step-1 --action build_sealed_request --file /tmp/values.json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                stepId: "step-1",
                action: "build_sealed_request",
                status: "advanced",
                step: {
                  stepId: "step-1",
                  status: "approval_required",
                  sealedRequestId: "sealed-1",
                },
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunAdvance({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      action: "build_sealed_request",
      file: "/tmp/values.json",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin workflow advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "advanced",
      preAdvanceStep: { stepId: "step-1", status: "ready" },
      postAdvanceStep: {
        stepId: "step-1",
        status: "approval_required",
        sealedRequestId: "sealed-1",
      },
      metadata: expect.objectContaining({
        rereadStepsAfterAdvance: true,
      }),
    });
    expect(mutableCalls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      [
        "workflow-run",
        "advance",
        "run-1",
        "--project",
        "project-1",
        "--step",
        "step-1",
        "--action",
        "build_sealed_request",
        "--file",
        "/tmp/values.json",
        "--json",
      ],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
  });

  it("blocks execute before build_sealed_request has produced approval_required state", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ stepId: "step-1", status: "ready" }],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "advance should not run" };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunAdvance({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      action: "execute",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin workflow advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: {
        code: "MOYIN_WORKFLOW_RUN_EXECUTE_NOT_READY",
      },
      preAdvanceStep: { stepId: "step-1", status: "ready" },
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
  });

  it("blocks execute before mutating Moyin when the sealed request has expired", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: "approval_required",
                    sealedRequestId: "sealed-expired",
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "sealed get sealed-expired --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                sealedRequest: {
                  sealedRequestId: "sealed-expired",
                  status: "sealed",
                  expiresAt: "2000-01-01T00:00:00.000Z",
                },
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunAdvance({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      action: "execute",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin workflow advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      preAdvanceStep: {
        stepId: "step-1",
        status: "approval_required",
        sealedRequestId: "sealed-expired",
      },
      error: {
        code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_EXPIRED",
        stopReason: "sealed-request-expired",
      },
      metadata: expect.objectContaining({
        sealedRequestId: "sealed-expired",
        sealedRequestExpiresAt: "2000-01-01T00:00:00.000Z",
      }),
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["sealed", "get", "sealed-expired", "--json"],
    ]);
  });

  it("blocks approval_required sealed request rebuild when the sealed request is missing", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: "approval_required",
                    sealedRequestId: "sealed-missing",
                    requiresApproval: true,
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "sealed get sealed-missing --json") {
            return {
              exitCode: 1,
              stdout: "",
              stderr: "Sealed task request sealed-missing was not found.",
            };
          }
          if (args[0] === "workflow-run" && args[1] === "advance") {
            return { exitCode: 9, stdout: "", stderr: "approval packet must not advance" };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const packet = await createMoyinWorkflowRunApprovalPacket({
      registry,
      projectId: "project-1",
      runId: "run-1",
    });

    expect(packet).toMatchObject({
      ok: false,
      status: "blocked",
      executePreflight: {
        status: "blocked",
        error: {
          stopReason: "sealed-request-read-failed",
        },
      },
      error: {
        code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_REBUILD_UNSUPPORTED",
        stopReason: "approval-required-sealed-request-rebuild-unsupported",
      },
      plan: {
        nextAction: {
          kind: "execute",
          advanceAction: "execute",
          requiresApproval: true,
        },
      },
    });
    expect(packet.approvalPacket).toBeUndefined();
    expect(packet.advancePreflight).toBeUndefined();
    expect(calls).toContainEqual(["sealed", "get", "sealed-missing", "--json"]);
    expect(calls.filter((call) => call[0] === "workflow-run" && call[1] === "advance")).toEqual([]);
  });

  it("blocks approval_required sealed request rebuild when the sealed request is expired", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: "approval_required",
                    sealedRequestId: "sealed-expired",
                    requiresApproval: true,
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "sealed get sealed-expired --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                sealedRequest: {
                  sealedRequestId: "sealed-expired",
                  status: "sealed",
                  expiresAt: "2000-01-01T00:00:00.000Z",
                },
              }),
              stderr: "",
            };
          }
          if (args[0] === "workflow-run" && args[1] === "advance") {
            return { exitCode: 9, stdout: "", stderr: "approval packet must not advance" };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const packet = await createMoyinWorkflowRunApprovalPacket({
      registry,
      projectId: "project-1",
      runId: "run-1",
    });

    expect(packet).toMatchObject({
      ok: false,
      status: "blocked",
      executePreflight: {
        status: "blocked",
        error: {
          code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_EXPIRED",
          stopReason: "sealed-request-expired",
        },
      },
      error: {
        code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_REBUILD_UNSUPPORTED",
        stopReason: "approval-required-sealed-request-rebuild-unsupported",
      },
      plan: {
        nextAction: {
          kind: "execute",
          advanceAction: "execute",
          requiresApproval: true,
        },
      },
    });
    expect(packet.approvalPacket).toBeUndefined();
    expect(packet.advancePreflight).toBeUndefined();
    expect(calls).toContainEqual(["sealed", "get", "sealed-expired", "--json"]);
    expect(calls.filter((call) => call[0] === "workflow-run" && call[1] === "advance")).toEqual([]);
  });

  it("allows execute only from approval_required state and still returns refreshed steps", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            const status = calls.some((call) => call.includes("advance"))
              ? "running"
              : "approval_required";
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status,
                    sealedRequestId: "sealed-1",
                    taskId: status === "running" ? "task-1" : undefined,
                  },
                ],
              }),
              stderr: "",
            };
          }
          const sealedGet = createMoyinSealedGetRunnerOutput(args);
          if (sealedGet !== undefined) {
            return sealedGet;
          }
          if (
            args.join(" ") ===
            "workflow-run advance run-1 --project project-1 --step step-1 --action execute --confirm SUBMIT --execution /tmp/execution.json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                stepId: "step-1",
                action: "execute",
                status: "advanced",
                step: {
                  stepId: "step-1",
                  status: "running",
                  sealedRequestId: "sealed-1",
                  taskId: "task-1",
                },
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunAdvance({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      action: "execute",
      execution: "/tmp/execution.json",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin workflow advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "advanced",
      preAdvanceStep: {
        stepId: "step-1",
        status: "approval_required",
        sealedRequestId: "sealed-1",
      },
      postAdvanceStep: {
        stepId: "step-1",
        status: "running",
        taskId: "task-1",
      },
    });
    expect(calls.at(-2)).toEqual([
      "workflow-run",
      "advance",
      "run-1",
      "--project",
      "project-1",
      "--step",
      "step-1",
      "--action",
      "execute",
      "--confirm",
      "SUBMIT",
      "--execution",
      "/tmp/execution.json",
      "--json",
    ]);
    expect(calls.at(-1)).toEqual([
      "workflow-run",
      "steps",
      "run-1",
      "--project",
      "project-1",
      "--json",
    ]);
  });

  it("blocks an approved build_sealed_request packet from mutating an approval_required step", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            const rebuilt = calls.some(
              (call) => call[0] === "workflow-run" && call[1] === "advance",
            );
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: "approval_required",
                    sealedRequestId: rebuilt ? "sealed-new" : "sealed-old",
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (args[0] === "workflow-run" && args[1] === "advance") {
            return { exitCode: 9, stdout: "", stderr: "build_sealed_request must not run" };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunAdvance({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      action: "build_sealed_request",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin sealed request rebuild",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      preAdvanceStep: {
        stepId: "step-1",
        status: "approval_required",
        sealedRequestId: "sealed-old",
      },
      error: {
        code: "MOYIN_WORKFLOW_RUN_BUILD_SEALED_REQUEST_NOT_READY",
        stopReason: "build-sealed-request-before-ready",
      },
    });
    expect(result.advance).toBeUndefined();
    expect(calls.filter((call) => call[0] === "workflow-run" && call[1] === "advance")).toEqual([]);
  });

  it("blocks retry unless the target step is failed", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ stepId: "step-1", status: "ready" }],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "retry should not run" };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunAdvance({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      action: "retry",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin workflow advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: {
        code: "MOYIN_WORKFLOW_RUN_RETRY_NOT_FAILED",
      },
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
  });

  it("blocks unrecoverable failed steps instead of issuing another retry approval packet", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: "failed",
                    retryable: true,
                    attempt: 2,
                    maxAttempts: 2,
                    error: {
                      code: "WORKFLOW_RUN_STEP_NOT_READY",
                      message: "WORKFLOW_RUN_STEP_NOT_READY: step step-1 cannot be retried.",
                      recoverable: true,
                    },
                  },
                ],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunUntilNextGate({
      registry,
      projectId: "project-1",
      runId: "run-1",
      createApprovalPacket: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      plan: {
        ok: false,
        status: "blocked",
        nextAction: {
          kind: "none",
          requiresApproval: false,
          stepId: "step-1",
        },
        error: {
          code: "MOYIN_WORKFLOW_RUN_STEP_UNRECOVERABLE",
          stopReason: "failed-step-not-retryable",
        },
      },
    });
    expect(result.approvalPacket).toBeUndefined();
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
  });

  it("stops repeated no-progress advance loops for the same step, action, and error", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ stepId: "step-1", status: "failed" }],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "advance should not run" };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunAdvance({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      action: "retry",
      noProgressThreshold: 2,
      history: [
        {
          runId: "run-1",
          stepId: "step-1",
          action: "retry",
          result: "failed",
          errorCode: "PROVIDER_QUOTA_EXCEEDED",
        },
        {
          runId: "run-1",
          stepId: "step-1",
          action: "retry",
          result: "failed",
          errorCode: "PROVIDER_QUOTA_EXCEEDED",
        },
      ],
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin workflow advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: {
        code: "MOYIN_WORKFLOW_RUN_NO_PROGRESS",
        stopReason: "same-step-action-error-threshold",
      },
      metadata: expect.objectContaining({
        noProgressThreshold: 2,
        noProgressMatches: 2,
      }),
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
  });

  it("lists workflow-run artifacts after an advance refresh reports a completed step", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            const status = calls.some((call) => call.includes("advance")) ? "completed" : "ready";
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ stepId: "step-1", status }],
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run advance run-1 --project project-1 --step step-1 --action build_request --file /tmp/values.json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                stepId: "step-1",
                action: "build_request",
                status: "advanced",
                step: { stepId: "step-1", status: "completed" },
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run artifacts run-1 --project project-1 --step step-1 --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-1",
                    type: "video",
                    localPath: "/tmp/moyin/video.mp4",
                    stepId: "step-1",
                  },
                ],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunAdvance({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      action: "build_request",
      file: "/tmp/values.json",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin workflow advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "advanced",
      postAdvanceStep: { stepId: "step-1", status: "completed" },
      artifacts: {
        ok: true,
        status: "success",
        artifacts: [
          {
            id: "artifact-1",
            kind: "video",
            path: "/tmp/moyin/video.mp4",
          },
        ],
      },
      metadata: expect.objectContaining({
        artifactsReadAfterCompleted: true,
      }),
    });
    expect(calls.at(-1)).toEqual([
      "workflow-run",
      "artifacts",
      "run-1",
      "--project",
      "project-1",
      "--step",
      "step-1",
      "--json",
    ]);
  });

  it("backfills artifacts when a completed workflow-run step has a taskId but no attached artifacts yet", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            const status = calls.some((call) => call.includes("advance")) ? "completed" : "ready";
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status,
                    taskId: status === "completed" ? "task-1" : undefined,
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run advance run-1 --project project-1 --step step-1 --action build_request --file /tmp/values.json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                stepId: "step-1",
                action: "build_request",
                status: "advanced",
                step: { stepId: "step-1", status: "completed", taskId: "task-1" },
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run artifacts run-1 --project project-1 --step step-1 --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [], total: 0 }),
              stderr: "",
            };
          }
          if (args.join(" ") === "artifact backfill --project project-1 --task task-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-backfilled-1",
                    type: "image",
                    localPath: "/tmp/moyin/image.png",
                    runId: "run-1",
                    stepId: "step-1",
                    taskId: "task-1",
                    source: "task-summary-auto-backfill:run-1:step-1",
                  },
                ],
                total: 1,
                taskCount: 1,
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunAdvance({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      action: "build_request",
      file: "/tmp/values.json",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin workflow advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "advanced",
      postAdvanceStep: { stepId: "step-1", status: "completed", taskId: "task-1" },
      artifacts: {
        ok: true,
        operationId: "artifact.backfill",
        artifacts: [
          {
            id: "artifact-backfilled-1",
            kind: "image",
            path: "/tmp/moyin/image.png",
            metadata: expect.objectContaining({
              runId: "run-1",
              stepId: "step-1",
              taskId: "task-1",
            }),
          },
        ],
      },
      metadata: expect.objectContaining({
        artifactsReadAfterCompleted: true,
        artifactBackfillAttemptedAfterCompleted: true,
        artifactsBackfilledAfterCompleted: true,
        initialArtifactCountAfterCompleted: 0,
        recoveredArtifactCountAfterCompleted: 1,
      }),
    });
    expect(calls.at(-2)).toEqual([
      "workflow-run",
      "artifacts",
      "run-1",
      "--project",
      "project-1",
      "--step",
      "step-1",
      "--json",
    ]);
    expect(calls.at(-1)).toEqual([
      "artifact",
      "backfill",
      "--project",
      "project-1",
      "--task",
      "task-1",
      "--json",
    ]);
  });

  it("executes a non-sealed script import step from ready state and watches the task", async () => {
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          const command = args.join(" ");
          if (command === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (command === "workflow-run steps run-1 --project project-1 --json") {
            const advanced = calls.some(
              (call) =>
                call.join(" ") ===
                "workflow-run advance run-1 --project project-1 --step script-import-full-workflow --action execute --confirm SUBMIT --json",
            );
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "script-import-full-workflow",
                    status: advanced ? "completed" : "ready",
                    requiresApproval: false,
                    taskId: advanced ? "task-script-import-1" : undefined,
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (
            command ===
            "workflow-run advance run-1 --project project-1 --step script-import-full-workflow --action execute --confirm SUBMIT --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                stepId: "script-import-full-workflow",
                action: "execute",
                status: "advanced",
                step: {
                  stepId: "script-import-full-workflow",
                  status: "running",
                  requiresApproval: false,
                  taskId: "task-script-import-1",
                },
              }),
              stderr: "",
            };
          }
          if (command === "task watch task-script-import-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                taskId: "task-script-import-1",
                status: "completed",
                progress: 100,
              }),
              stderr: "",
            };
          }
          if (
            command ===
            "workflow-run artifacts run-1 --project project-1 --step script-import-full-workflow --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [], total: 0 }),
              stderr: "",
            };
          }
          if (
            command === "artifact backfill --project project-1 --task task-script-import-1 --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [], total: 0 }),
              stderr: "",
            };
          }
          if (command.includes("build_request") || command.includes("sealed")) {
            return {
              exitCode: 9,
              stdout: "",
              stderr: "script import execute must not use build_request or sealed flow",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${command}` };
        },
      }),
    );

    const result = await orchestrateMoyinWorkflowRunExecuteAndPackage({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "script-import-full-workflow",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-28T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved local script import workflow-run execute",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
      collectPackage: false,
      turnId: "turn-script-import-execute",
      sessionKey: "desktop:workbench",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "executed",
      projectId: "project-1",
      runId: "run-1",
      stepId: "script-import-full-workflow",
      taskId: "task-script-import-1",
      advance: {
        ok: true,
        status: "advanced",
        preAdvanceStep: {
          status: "ready",
          requiresApproval: false,
        },
      },
      watch: {
        ok: true,
        operationId: "task.watch",
      },
      metadata: expect.objectContaining({
        taskWatchCompleted: true,
        packageCollected: false,
        packageSkipped: true,
      }),
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      [
        "workflow-run",
        "advance",
        "run-1",
        "--project",
        "project-1",
        "--step",
        "script-import-full-workflow",
        "--action",
        "execute",
        "--confirm",
        "SUBMIT",
        "--json",
      ],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      [
        "workflow-run",
        "artifacts",
        "run-1",
        "--project",
        "project-1",
        "--step",
        "script-import-full-workflow",
        "--json",
      ],
      [
        "artifact",
        "backfill",
        "--project",
        "project-1",
        "--task",
        "task-script-import-1",
        "--json",
      ],
      ["task", "watch", "task-script-import-1", "--project", "project-1", "--json"],
    ]);
    expect(calls.flat()).not.toContain("build_request");
    expect(calls.flat()).not.toContain("sealed");
  });

  it("executes an approved step, watches its task, then packages the workflow-run outputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-moyin-execute-package-handoff-"));
    const handoffManifestDirectory = join(root, "handoff");
    const artifactStore = createFileConversationRuntimeExternalArtifactStore({
      rootPath: join(root, "artifact-store"),
      nowMs: () => 1_778_000_000_000,
    });
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            const advanced = calls.some((call) => call.includes("advance"));
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: advanced ? "completed" : "approval_required",
                    sealedRequestId: "sealed-1",
                    taskId: advanced ? "task-1" : undefined,
                  },
                ],
              }),
              stderr: "",
            };
          }
          const sealedGet = createMoyinSealedGetRunnerOutput(args);
          if (sealedGet !== undefined) {
            return sealedGet;
          }
          if (
            args.join(" ") ===
            "workflow-run advance run-1 --project project-1 --step step-1 --action execute --confirm SUBMIT --execution /tmp/execution.json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                stepId: "step-1",
                action: "execute",
                status: "advanced",
                step: {
                  stepId: "step-1",
                  status: "running",
                  sealedRequestId: "sealed-1",
                  taskId: "task-1",
                },
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run artifacts run-1 --project project-1 --step step-1 --json"
          ) {
            return { exitCode: 0, stdout: JSON.stringify({ items: [], total: 0 }), stderr: "" };
          }
          if (args.join(" ") === "artifact backfill --project project-1 --task task-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-step-1",
                    type: "image",
                    localPath: "/tmp/moyin/step-1.png",
                    runId: "run-1",
                    stepId: "step-1",
                    taskId: "task-1",
                  },
                ],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task watch task-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                taskId: "task-1",
                status: "completed",
                progress: 100,
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run get run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                projectId: "project-1",
                status: "completed",
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run artifacts run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-step-1",
                    type: "image",
                    localPath: "/tmp/moyin/step-1.png",
                    runId: "run-1",
                    stepId: "step-1",
                    taskId: "task-1",
                  },
                ],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") === "workflow-run export run-1 --project project-1 --target json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                id: "run-1-json",
                runId: "run-1",
                target: "json",
                packagePath: "/tmp/moyin/run-1.json",
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run export run-1 --project project-1 --target comfyui-draft --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                id: "run-1-comfyui",
                runId: "run-1",
                target: "comfyui-draft",
                conversion: { executable: false, lossiness: "lossy" },
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const events: string[] = [];
    const result = await orchestrateMoyinWorkflowRunExecuteAndPackage({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      execution: "/tmp/execution.json",
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-28T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin workflow execute",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
      turnId: "turn-execute-1",
      sessionKey: "desktop:workbench",
      artifactStore,
      handoffManifestDirectory,
      onEvent: (event) => events.push(event.kind),
    });

    expect(result).toMatchObject({
      ok: true,
      status: "packaged",
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      sealedRequestId: "sealed-1",
      taskId: "task-1",
      advance: {
        ok: true,
        status: "advanced",
      },
      watch: {
        ok: true,
        operationId: "task.watch",
      },
      package: {
        ok: true,
        status: "packaged",
        handoffManifestArtifact: {
          id: "moyin-handoff:project-1:run-1",
          kind: "json",
          path: join(handoffManifestDirectory, "project-1", "run-1.handoff.json"),
        },
        handoffManifestArtifactPersistence: {
          status: "ok",
          artifactIds: ["moyin-handoff:project-1:run-1"],
        },
        artifacts: [
          {
            id: "artifact-step-1",
            kind: "image",
            path: "/tmp/moyin/step-1.png",
          },
        ],
      },
      metadata: expect.objectContaining({
        schemaVersion: "director.moyin.workflow-run.execute-package.v1",
        taskWatchCompleted: true,
        packageCollected: true,
      }),
    });
    expect(events).toEqual([
      "moyin.workflow_run.execute.started",
      "moyin.workflow_run.task_watch.started",
      "moyin.workflow_run.task_watch.completed",
      "moyin.workflow_run.package.started",
      "moyin.workflow_run.package.completed",
    ]);
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["sealed", "get", "sealed-1", "--json"],
      [
        "workflow-run",
        "advance",
        "run-1",
        "--project",
        "project-1",
        "--step",
        "step-1",
        "--action",
        "execute",
        "--confirm",
        "SUBMIT",
        "--execution",
        "/tmp/execution.json",
        "--json",
      ],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      [
        "workflow-run",
        "artifacts",
        "run-1",
        "--project",
        "project-1",
        "--step",
        "step-1",
        "--json",
      ],
      ["artifact", "backfill", "--project", "project-1", "--task", "task-1", "--json"],
      ["task", "watch", "task-1", "--project", "project-1", "--json"],
      ["workflow-run", "get", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "artifacts", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "export", "run-1", "--project", "project-1", "--target", "json", "--json"],
      [
        "workflow-run",
        "export",
        "run-1",
        "--project",
        "project-1",
        "--target",
        "comfyui-draft",
        "--json",
      ],
    ]);
    expect(artifactStore.listArtifacts({ providerId: "moyin", runId: "run-1" })).toEqual([
      expect.objectContaining({
        artifactId: "moyin-handoff:project-1:run-1",
        operationId: "workflow-run.production-package",
        turnId: "turn-execute-1",
        sessionKey: "desktop:workbench",
      }),
    ]);
    expect(
      JSON.parse(
        readFileSync(join(handoffManifestDirectory, "project-1", "run-1.handoff.json"), "utf8"),
      ),
    ).toMatchObject({
      schemaVersion: "director.moyin.production-handoff-manifest.v1",
      projectId: "project-1",
      runId: "run-1",
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("resumes a known workflow-run task without advancing or resubmitting paid work", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-moyin-resume-handoff-"));
    const handoffManifestDirectory = join(root, "handoff");
    const artifactStore = createFileConversationRuntimeExternalArtifactStore({
      rootPath: join(root, "artifact-store"),
      nowMs: () => 1_778_000_000_000,
    });
    const calls: string[][] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task watch task-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                taskId: "task-1",
                status: "completed",
                progress: 100,
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run get run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                projectId: "project-1",
                status: "completed",
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: "completed",
                    sealedRequestId: "sealed-1",
                    taskId: "task-1",
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run artifacts run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-resumed-1",
                    type: "video",
                    localPath: "/tmp/moyin/resumed.mp4",
                    runId: "run-1",
                    stepId: "step-1",
                    taskId: "task-1",
                  },
                ],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") === "workflow-run export run-1 --project project-1 --target json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                id: "run-1-json",
                runId: "run-1",
                target: "json",
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run export run-1 --project project-1 --target comfyui-draft --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                id: "run-1-comfyui",
                runId: "run-1",
                target: "comfyui-draft",
                conversion: { executable: false, lossiness: "lossy" },
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const events: string[] = [];
    const result = await orchestrateMoyinWorkflowRunResumeAndPackage({
      registry,
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      taskId: "task-1",
      sealedRequestId: "sealed-1",
      resumeToken: "moyin-watch:project-1:run-1:step-1:task-1",
      turnId: "turn-resume-1",
      sessionKey: "desktop:workbench",
      artifactStore,
      handoffManifestDirectory,
      onEvent: (event) => events.push(event.kind),
    });

    expect(result).toMatchObject({
      ok: true,
      status: "packaged",
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-1",
      sealedRequestId: "sealed-1",
      taskId: "task-1",
      watch: {
        ok: true,
        operationId: "task.watch",
      },
      package: {
        ok: true,
        status: "packaged",
        handoffManifestArtifact: {
          id: "moyin-handoff:project-1:run-1",
          kind: "json",
          path: join(handoffManifestDirectory, "project-1", "run-1.handoff.json"),
        },
        handoffManifestArtifactPersistence: {
          status: "ok",
          artifactIds: ["moyin-handoff:project-1:run-1"],
        },
        artifacts: [
          {
            id: "artifact-resumed-1",
            kind: "video",
            path: "/tmp/moyin/resumed.mp4",
          },
        ],
      },
      metadata: expect.objectContaining({
        schemaVersion: "director.moyin.workflow-run.resume-package.v1",
        resumed: true,
        taskWatchCompleted: true,
        packageCollected: true,
      }),
    });
    expect(events).toEqual([
      "moyin.workflow_run.resume.started",
      "moyin.workflow_run.task_watch.started",
      "moyin.workflow_run.task_watch.completed",
      "moyin.workflow_run.package.started",
      "moyin.workflow_run.package.completed",
    ]);
    expect(calls).toEqual([
      ["status", "--json"],
      ["task", "watch", "task-1", "--project", "project-1", "--json"],
      ["workflow-run", "get", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "artifacts", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "export", "run-1", "--project", "project-1", "--target", "json", "--json"],
      [
        "workflow-run",
        "export",
        "run-1",
        "--project",
        "project-1",
        "--target",
        "comfyui-draft",
        "--json",
      ],
    ]);
    expect(calls.flat()).not.toContain("advance");
    expect(calls.flat()).not.toContain("submit");
    expect(artifactStore.listArtifacts({ providerId: "moyin", runId: "run-1" })).toEqual([
      expect.objectContaining({
        artifactId: "moyin-handoff:project-1:run-1",
        operationId: "workflow-run.production-package",
        turnId: "turn-resume-1",
        sessionKey: "desktop:workbench",
      }),
    ]);
    expect(
      JSON.parse(
        readFileSync(join(handoffManifestDirectory, "project-1", "run-1.handoff.json"), "utf8"),
      ),
    ).toMatchObject({
      schemaVersion: "director.moyin.production-handoff-manifest.v1",
      projectId: "project-1",
      runId: "run-1",
    });
    rmSync(root, { recursive: true, force: true });
  });
});

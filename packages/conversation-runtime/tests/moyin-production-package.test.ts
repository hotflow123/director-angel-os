import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ExternalToolRegistry,
  collectMoyinWorkflowRunProductionPackage,
  createFileConversationRuntimeExternalArtifactStore,
  createMoyinProviderRegistration,
} from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const productionPackageSmokeScript = join(repoRoot, "scripts/smoke-moyin-production-package.mjs");

describe("Moyin workflow-run production package collector", () => {
  it("blocks the production package smoke before touching Moyin when project or run id is missing", () => {
    const output = execFileSync(process.execPath, [productionPackageSmokeScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        MOYIN_BINARY: "/definitely/not-needed-for-preflight",
        MOYIN_SMOKE_PROJECT_ID: "",
        MOYIN_SMOKE_RUN_ID: "",
        MOYIN_SMOKE_WORKFLOW_RUN_ID: "",
      },
    });

    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: "director.moyin.production-package-smoke.v1",
      status: "blocked",
      submit: {
        attempted: false,
        reason: "project-or-run-id-not-provided",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID and MOYIN_SMOKE_WORKFLOW_RUN_ID to collect a read-only workflow-run package.",
      ],
    });
  });

  it("collects a completed workflow-run package through provider reads and exports", async () => {
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
                  { stepId: "scene-image", status: "completed", taskId: "task-image" },
                  { stepId: "scene-video", status: "completed", taskId: "task-video" },
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
                    artifactId: "artifact-image",
                    type: "image",
                    localPath: "/tmp/moyin/image.png",
                    runId: "run-1",
                    stepId: "scene-image",
                    taskId: "task-image",
                  },
                  {
                    artifactId: "artifact-video",
                    type: "video",
                    localPath: "/tmp/moyin/video.mp4",
                    runId: "run-1",
                    stepId: "scene-video",
                    taskId: "task-video",
                  },
                ],
                total: 2,
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
                id: "package-json",
                runId: "run-1",
                target: "json",
                packagePath: "/tmp/moyin/run-1.json",
                artifacts: [{ artifactId: "artifact-image", type: "image" }],
                conversion: { executable: true, lossiness: "lossless" },
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
                id: "package-comfyui",
                runId: "run-1",
                target: "comfyui-draft",
                packagePath: "/tmp/moyin/run-1-comfyui.json",
                conversion: {
                  executable: false,
                  lossiness: "lossy",
                  unmappedFields: ["scene-video.runtime"],
                  missingDependencies: ["comfyui-video-node"],
                },
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await collectMoyinWorkflowRunProductionPackage({
      registry,
      projectId: "project-1",
      runId: "run-1",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "packaged",
      projectId: "project-1",
      runId: "run-1",
      artifacts: [
        {
          id: "artifact-image",
          kind: "image",
          path: "/tmp/moyin/image.png",
        },
        {
          id: "artifact-video",
          kind: "video",
          path: "/tmp/moyin/video.mp4",
        },
      ],
      exports: {
        json: {
          ok: true,
          operationId: "workflow.export",
        },
        comfyuiDraft: {
          ok: true,
          operationId: "workflow.export",
        },
      },
      metadata: expect.objectContaining({
        schemaVersion: "director.moyin.production-package.v1",
        artifactCount: 2,
        backfillAttemptedCount: 0,
        completedStepCount: 2,
      }),
      handoffManifest: {
        schemaVersion: "director.moyin.production-handoff-manifest.v1",
        provider: "moyin",
        projectId: "project-1",
        runId: "run-1",
        status: "packaged",
        steps: [
          {
            stepId: "scene-image",
            status: "completed",
            taskId: "task-image",
            artifactIds: ["artifact-image"],
            missingArtifact: false,
          },
          {
            stepId: "scene-video",
            status: "completed",
            taskId: "task-video",
            artifactIds: ["artifact-video"],
            missingArtifact: false,
          },
        ],
        artifacts: [
          {
            artifactId: "artifact-image",
            kind: "image",
            path: "/tmp/moyin/image.png",
            taskId: "task-image",
            stepId: "scene-image",
          },
          {
            artifactId: "artifact-video",
            kind: "video",
            path: "/tmp/moyin/video.mp4",
            taskId: "task-video",
            stepId: "scene-video",
          },
        ],
        exports: {
          json: {
            ok: true,
            target: "json",
            packagePath: "/tmp/moyin/run-1.json",
            conversion: {
              executable: true,
              lossiness: "lossless",
            },
          },
          comfyuiDraft: {
            ok: true,
            target: "comfyui-draft",
            packagePath: "/tmp/moyin/run-1-comfyui.json",
            conversion: {
              executable: false,
              lossiness: "lossy",
              unmappedFields: ["scene-video.runtime"],
              missingDependencies: ["comfyui-video-node"],
            },
          },
        },
        readiness: {
          packageStatus: "packaged",
          readyForThirdPartyHandoff: true,
          readyForComfyUi: false,
          blockers: [
            "comfyui-draft-not-executable",
            "comfyui-draft-lossy",
            "comfyui-draft-missing-dependencies",
          ],
        },
        mutation: {
          submitAttempted: false,
          advanceAttempted: false,
          cancelAttempted: false,
          deleteAttempted: false,
        },
      },
    });
    expect(calls).toEqual([
      ["status", "--json"],
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
  });

  it("writes the handoff manifest as a traceable external artifact when a package store is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-moyin-handoff-artifact-"));
    try {
      const handoffManifestDirectory = join(root, "handoff");
      const artifactStore = createFileConversationRuntimeExternalArtifactStore({
        rootPath: join(root, "artifact-store"),
        nowMs: () => 1_778_000_000_000,
        defaultTtlMs: 86_400_000,
      });
      const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ args }) => {
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
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
                  items: [{ stepId: "scene-image", status: "completed", taskId: "task-image" }],
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
                stdout: JSON.stringify({
                  id: "package-json",
                  runId: "run-1",
                  target: "json",
                  packagePath: "/tmp/moyin/run-1.json",
                  conversion: { executable: true, lossiness: "lossless" },
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
                  id: "package-comfyui",
                  runId: "run-1",
                  target: "comfyui-draft",
                  packagePath: "/tmp/moyin/run-1-comfyui.json",
                  conversion: { executable: true, lossiness: "lossless" },
                }),
                stderr: "",
              };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const result = await collectMoyinWorkflowRunProductionPackage({
        registry,
        projectId: "project-1",
        runId: "run-1",
        turnId: "turn-1",
        sessionKey: "desktop:workbench",
        artifactStore,
        handoffManifestDirectory,
      });

      const manifestPath = join(handoffManifestDirectory, "project-1", "run-1.handoff.json");
      expect(result.handoffManifestArtifact).toMatchObject({
        id: "moyin-handoff:project-1:run-1",
        kind: "json",
        path: manifestPath,
        metadata: expect.objectContaining({
          provider: "moyin",
          projectId: "project-1",
          runId: "run-1",
          role: "production-handoff-manifest",
          schemaVersion: "director.moyin.production-handoff-manifest.v1",
          retention: "user_controlled",
        }),
      });
      expect(result.handoffManifestArtifactPersistence).toMatchObject({
        status: "ok",
        artifactIds: ["moyin-handoff:project-1:run-1"],
      });
      expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toMatchObject({
        schemaVersion: "director.moyin.production-handoff-manifest.v1",
        provider: "moyin",
        projectId: "project-1",
        runId: "run-1",
        readiness: {
          readyForThirdPartyHandoff: true,
          readyForComfyUi: true,
        },
      });
      expect(artifactStore.listArtifacts({ providerId: "moyin", runId: "run-1" })).toEqual([
        expect.objectContaining({
          artifactId: "moyin-handoff:project-1:run-1",
          kind: "json",
          providerId: "moyin",
          toolId: "moyin.provider",
          operationId: "workflow-run.production-package",
          turnId: "turn-1",
          sessionKey: "desktop:workbench",
          projectId: "project-1",
          runId: "run-1",
          localPath: manifestPath,
          retention: "user_controlled",
          sensitivity: "internal",
          cleanupPolicyRef: "artifactPolicy.moyin.handoff-manifest.user-controlled",
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a completed workflow-run partial when completed task artifacts are still missing", async () => {
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
                items: [{ stepId: "scene-video", status: "completed", taskId: "task-video" }],
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run artifacts run-1 --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [], total: 0 }), stderr: "" };
          }
          if (args.join(" ") === "artifact backfill --project project-1 --task task-video --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [], total: 0 }), stderr: "" };
          }
          if (
            args.join(" ") === "workflow-run export run-1 --project project-1 --target json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ id: "package-json", runId: "run-1", target: "json" }),
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
                id: "package-comfyui",
                runId: "run-1",
                target: "comfyui-draft",
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await collectMoyinWorkflowRunProductionPackage({
      registry,
      projectId: "project-1",
      runId: "run-1",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "partial",
      artifacts: [],
      metadata: expect.objectContaining({
        artifactCount: 0,
        backfillAttemptedCount: 1,
        backfillRecoveredCount: 0,
        completedStepCount: 1,
        missingArtifactStepCount: 1,
      }),
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "get", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "artifacts", "run-1", "--project", "project-1", "--json"],
      ["artifact", "backfill", "--project", "project-1", "--task", "task-video", "--json"],
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
  });

  it("backfills completed step artifacts before exporting when the registry is empty", async () => {
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
                  { stepId: "scene-image", status: "completed", taskId: "task-image" },
                  { stepId: "scene-video", status: "running", taskId: "task-video" },
                ],
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run artifacts run-1 --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [], total: 0 }), stderr: "" };
          }
          if (args.join(" ") === "artifact backfill --project project-1 --task task-image --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-backfilled-image",
                    type: "image",
                    localPath: "/tmp/moyin/backfilled.png",
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
            args.join(" ") === "workflow-run export run-1 --project project-1 --target json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ id: "package-json", runId: "run-1", target: "json" }),
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
                id: "package-comfyui",
                runId: "run-1",
                target: "comfyui-draft",
                conversion: {
                  executable: false,
                  lossiness: "lossy",
                  unmappedFields: [],
                  missingDependencies: [],
                },
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await collectMoyinWorkflowRunProductionPackage({
      registry,
      projectId: "project-1",
      runId: "run-1",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "partial",
      artifacts: [
        {
          id: "artifact-backfilled-image",
          kind: "image",
          path: "/tmp/moyin/backfilled.png",
          metadata: expect.objectContaining({
            taskId: "task-image",
            stepId: "scene-image",
          }),
        },
      ],
      metadata: expect.objectContaining({
        artifactCount: 1,
        initialArtifactCount: 0,
        backfillAttemptedCount: 1,
        backfillRecoveredCount: 1,
        completedStepCount: 1,
      }),
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "get", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "artifacts", "run-1", "--project", "project-1", "--json"],
      ["artifact", "backfill", "--project", "project-1", "--task", "task-image", "--json"],
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
  });
});

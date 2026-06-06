import { describe, expect, it } from "vitest";

import {
  ExternalToolRegistry,
  createMoyinProviderRegistration,
  orchestrateMoyinSealedTask,
} from "../src/index.js";

const APPROVAL = { status: "approved", operatorId: "operator-1" } as const;
const SANDBOX_PREFLIGHT = {
  verdict: "allow",
  sandboxMode: "workspace-write",
  checkedAt: "2026-05-28T00:00:00.000Z",
  providerId: "moyin",
  reason: "approved Moyin sealed submit",
} as const;
const SANDBOX_RUNTIME_POLICY = { enabledBackends: ["workspace-write"] } as const;

describe("Moyin sealed task orchestrator", () => {
  it("creates a sealed image preview without submitting by default", async () => {
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
          if (args[0] === "sealed" && args[1] === "image") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                projectId: "project-1",
                executable: true,
                sealedRequestId: "sealed-image-1",
                sealedRequest: { expiresAt: "2026-05-28T00:05:00.000Z" },
                preview: { prompt: "redacted" },
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinSealedTask({
      registry,
      mediaKind: "image",
      projectId: "project-1",
      requestJson: { templateId: "director.scene-image", prompt: "scene" },
      scratchDir: "/tmp",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "previewed",
      sealedRequestId: "sealed-image-1",
      preview: {
        ok: true,
        content: "Moyin sealed image preview created.",
      },
      metadata: expect.objectContaining({
        submitted: false,
        watched: false,
        artifactsRead: false,
      }),
    });
    expect(calls.flat()).not.toContain("submit");
    expect(calls.flat()).not.toContain("watch");
  });

  it("submits after approval, watches the Moyin task, and reads artifacts", async () => {
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
          if (args[0] === "sealed" && args[1] === "video") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                projectId: "project-1",
                executable: true,
                sealedRequestId: "sealed-video-1",
                sealedRequest: { expiresAt: "2026-05-28T00:05:00.000Z" },
                preview: { prompt: "redacted video" },
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "sealed submit sealed-video-1 --confirm SUBMIT --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                sealedRequest: { sealedRequestId: "sealed-video-1" },
                task: { id: "task-video-1", projectId: "project-1", status: "running" },
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task watch task-video-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                taskId: "task-video-1",
                projectId: "project-1",
                status: "completed",
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "artifact list --project project-1 --type video --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-video-1",
                    type: "video",
                    localPath: "/tmp/moyin/video.mp4",
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

    const result = await orchestrateMoyinSealedTask({
      registry,
      mediaKind: "video",
      projectId: "project-1",
      requestJson: { templateId: "director.scene-video", prompt: "video" },
      scratchDir: "/tmp",
      submit: true,
      watch: true,
      readArtifacts: true,
      approval: APPROVAL,
      sandboxPreflight: SANDBOX_PREFLIGHT,
      sandboxRuntimePolicy: SANDBOX_RUNTIME_POLICY,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      sealedRequestId: "sealed-video-1",
      taskId: "task-video-1",
      submit: {
        ok: true,
        content: "Moyin sealed request submitted.",
      },
      watch: {
        ok: true,
        content: "Moyin task watch completed.",
      },
      artifacts: {
        ok: true,
        artifacts: [
          {
            id: "artifact-video-1",
            kind: "video",
            path: "/tmp/moyin/video.mp4",
          },
        ],
      },
      metadata: expect.objectContaining({
        submitted: true,
        watched: true,
        artifactsRead: true,
      }),
    });
    expect(calls).toEqual([
      ["status", "--json"],
      expect.arrayContaining(["sealed", "video"]),
      ["sealed", "submit", "sealed-video-1", "--confirm", "SUBMIT", "--json"],
      ["task", "watch", "task-video-1", "--project", "project-1", "--json"],
      ["artifact", "list", "--project", "project-1", "--type", "video", "--json"],
    ]);
  });

  it("backfills Moyin artifacts when a completed standalone task only stored output in task summary", async () => {
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
          if (args[0] === "sealed" && args[1] === "image") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                projectId: "project-1",
                executable: true,
                sealedRequestId: "sealed-image-1",
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "sealed submit sealed-image-1 --confirm SUBMIT --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                task: { id: "task-image-1", projectId: "project-1", status: "running" },
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task watch task-image-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                taskId: "task-image-1",
                projectId: "project-1",
                status: "completed",
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "artifact list --project project-1 --type image --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [], total: 0 }),
              stderr: "",
            };
          }
          if (
            args.join(" ") === "artifact backfill --project project-1 --task task-image-1 --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-image-backfilled-1",
                    type: "image",
                    localPath: "/tmp/moyin/image.png",
                    taskId: "task-image-1",
                    source: "task-summary-auto-backfill",
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

    const result = await orchestrateMoyinSealedTask({
      registry,
      mediaKind: "image",
      projectId: "project-1",
      requestJson: { templateId: "director.scene-image", prompt: "scene" },
      scratchDir: "/tmp",
      submit: true,
      watch: true,
      readArtifacts: true,
      approval: APPROVAL,
      sandboxPreflight: SANDBOX_PREFLIGHT,
      sandboxRuntimePolicy: SANDBOX_RUNTIME_POLICY,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      taskId: "task-image-1",
      artifacts: {
        ok: true,
        operationId: "artifact.backfill",
        artifacts: [
          {
            id: "artifact-image-backfilled-1",
            kind: "image",
            path: "/tmp/moyin/image.png",
            metadata: expect.objectContaining({
              taskId: "task-image-1",
              source: "task-summary-auto-backfill",
            }),
          },
        ],
      },
      metadata: expect.objectContaining({
        artifactsRead: true,
        artifactBackfillAttempted: true,
        artifactsBackfilled: true,
        initialArtifactCount: 0,
        recoveredArtifactCount: 1,
      }),
    });
    expect(calls).toEqual([
      ["status", "--json"],
      expect.arrayContaining(["sealed", "image"]),
      ["sealed", "submit", "sealed-image-1", "--confirm", "SUBMIT", "--json"],
      ["task", "watch", "task-image-1", "--project", "project-1", "--json"],
      ["artifact", "list", "--project", "project-1", "--type", "image", "--json"],
      ["artifact", "backfill", "--project", "project-1", "--task", "task-image-1", "--json"],
    ]);
  });

  it("does not submit when the sealed preview is not executable", async () => {
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
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              executable: false,
              missing: ["apiKey"],
              blockers: ["missing_provider_binding"],
            }),
            stderr: "",
          };
        },
      }),
    );

    const result = await orchestrateMoyinSealedTask({
      registry,
      mediaKind: "image",
      projectId: "project-1",
      requestJson: { templateId: "director.scene-image", prompt: "scene" },
      scratchDir: "/tmp",
      submit: true,
      approval: APPROVAL,
      sandboxPreflight: SANDBOX_PREFLIGHT,
      sandboxRuntimePolicy: SANDBOX_RUNTIME_POLICY,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "preview-failed",
      error: {
        code: "MOYIN_SEALED_PREVIEW_NOT_EXECUTABLE",
      },
    });
    expect(calls.flat()).not.toContain("submit");
  });

  it("times out long Moyin task watch with heartbeat events and a resume token", async () => {
    const calls: string[][] = [];
    const events: Readonly<Record<string, unknown>>[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: async ({ args }) => {
          calls.push([...args]);
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args[0] === "sealed" && args[1] === "video") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                projectId: "project-1",
                executable: true,
                sealedRequestId: "sealed-video-1",
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "sealed submit sealed-video-1 --confirm SUBMIT --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                task: { id: "task-video-1", projectId: "project-1", status: "running" },
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task watch task-video-1 --project project-1 --json") {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                taskId: "task-video-1",
                projectId: "project-1",
                status: "completed",
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinSealedTask({
      registry,
      mediaKind: "video",
      projectId: "project-1",
      requestJson: { templateId: "director.scene-video", prompt: "video" },
      scratchDir: "/tmp",
      submit: true,
      watch: true,
      readArtifacts: true,
      watchTimeoutMs: 12,
      heartbeatIntervalMs: 5,
      resumeToken: "moyin-watch:project-1:task-video-1",
      onEvent: (event) => events.push(event),
      approval: APPROVAL,
      sandboxPreflight: SANDBOX_PREFLIGHT,
      sandboxRuntimePolicy: SANDBOX_RUNTIME_POLICY,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "watch-failed",
      taskId: "task-video-1",
      error: {
        code: "MOYIN_TASK_WATCH_TIMEOUT",
        recoverable: true,
      },
      metadata: expect.objectContaining({
        submitted: true,
        watched: false,
        watchTimeoutMs: 12,
        heartbeatIntervalMs: 5,
        resumeToken: "moyin-watch:project-1:task-video-1",
      }),
    });
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "moyin.task.watch.started",
        "moyin.task.watch.heartbeat",
        "moyin.task.watch.timeout",
      ]),
    );
    expect(calls).not.toContainEqual([
      "artifact",
      "list",
      "--project",
      "project-1",
      "--type",
      "video",
      "--json",
    ]);
  });
});

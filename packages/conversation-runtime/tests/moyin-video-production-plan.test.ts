import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ExternalToolRegistry,
  createFileConversationRuntimeExternalArtifactStore,
  createMoyinProviderRegistration,
  createMoyinWorkflowRunDraftFromVideoProductionPlan,
  createMoyinWorkflowRunFromVideoProductionPlan,
  orchestrateMoyinVideoProductionDryRunUntilNextGate,
  orchestrateMoyinVideoProductionDryRunWorkflow,
  orchestrateMoyinVideoProductionLoop,
  resolveMoyinVideoProductionPlanExecutionDrafts,
} from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const videoPlanDryRunSmokeScript = join(repoRoot, "scripts/smoke-moyin-video-plan-dry-run.mjs");
const videoProductionLoopSmokeScript = join(
  repoRoot,
  "scripts/smoke-moyin-video-production-loop.mjs",
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

describe("Moyin video production plan mapper", () => {
  it("blocks the video plan dry-run smoke before touching Moyin when project id is missing", () => {
    const output = execFileSync(process.execPath, [videoPlanDryRunSmokeScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        MOYIN_BINARY: "/definitely/not-needed-for-preflight",
        MOYIN_SMOKE_PROJECT_ID: "",
      },
    });

    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: "director.moyin.video-plan-dry-run-smoke.v1",
      status: "blocked",
      create: {
        attempted: false,
        reason: "project-id-not-provided",
      },
      submit: {
        attempted: false,
      },
      advance: {
        attempted: false,
      },
    });
  });

  it("runs the video plan dry-run smoke through workflow-run.create without submitting work", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-plan-dry-run-smoke-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const planFile = join(root, "plan.json");
      writeFileSync(
        planFile,
        JSON.stringify({
          goal: "Create a safe dry-run story beat.",
          idea: "A single clean scene for a no-submit dry run.",
          target: "director",
          scriptExecution: { providerId: "text-provider", model: "story-model" },
          scenes: [
            {
              sceneId: 1,
              name: "Dry run scene",
              imagePrompt: "A clean dry run frame.",
              videoPrompt: "A clean dry run motion.",
              imageExecution: { providerId: "image-provider", model: "image-model" },
              videoExecution: { providerId: "video-provider", model: "video-model" },
            },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (args[0] === "workflow-run" && args[1] === "create" && args[2] === "--project" && args[3] === "project-1" && args[4] === "--file" && args[6] === "--json") {
  const request = JSON.parse(readFileSync(args[5], "utf8"));
  if (request.mode !== "dry_run" || request.approvalPolicy?.requireBeforeSubmit !== true) {
    console.error("unsafe request");
    process.exit(3);
  }
  console.log(JSON.stringify({ runId: "run-1", projectId: "project-1", status: "planned", steps: request.steps }));
  process.exit(0);
}
if (command.includes("advance") || command.includes("submit")) {
  console.error("dry-run smoke must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [videoPlanDryRunSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_PLAN_FILE: planFile,
          MOYIN_SMOKE_SCRATCH_ROOT: root,
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.video-plan-dry-run-smoke.v1",
        status: "created",
        projectId: "project-1",
        runId: "run-1",
        draft: {
          blockerCount: 0,
          stepCount: 3,
          paidStepCount: 2,
        },
        create: {
          attempted: true,
          ok: true,
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
        [
          "workflow-run",
          "create",
          "--project",
          "project-1",
          "--file",
          expect.any(String),
          "--json",
        ],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds adapter execution drafts through the provider before creating the dry-run smoke", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-plan-provider-drafts-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const planFile = join(root, "plan.json");
      writeFileSync(
        planFile,
        JSON.stringify({
          projectId: "project-1",
          goal: "Create a production loop smoke package from an already completed image step.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "Smoke package scene",
              imagePrompt: "A completed frame.",
              imageExecution: { providerId: "image-provider", model: "image-model" },
            },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "script-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    executionDraft: {
      providerId: "moyin-api",
      model: "story-model",
      workflowTarget: request.workflowTarget,
      sceneCount: request.sceneCount,
    },
  }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "image-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2i",
    executionDraft: { providerId: "moyin-api", model: "moyin-selected-image-model", prompt: request.prompt },
  }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "video-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2v",
    executionDraft: { providerId: "moyin-api", model: "moyin-selected-video-model", prompt: request.prompt },
  }));
  process.exit(0);
}
if (args[0] === "workflow-run" && args[1] === "create" && args[2] === "--project" && args[3] === "project-1" && args[4] === "--file" && args[6] === "--json") {
  const request = JSON.parse(readFileSync(args[5], "utf8"));
  if (request.steps.length !== 4 || request.steps.some((step) => !step.payload?.execution)) {
    console.error("execution drafts were not threaded into workflow-run steps");
    process.exit(3);
  }
  console.log(JSON.stringify({ runId: "run-1", projectId: "project-1", status: "planned", steps: request.steps }));
  process.exit(0);
}
if (command.includes("advance") || command.includes("submit")) {
  console.error("dry-run smoke must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [videoPlanDryRunSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_FAKE_CALL_LOG: callLog,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_GOAL: "Create a provider-built dry-run scene.",
          MOYIN_SMOKE_AUTO_ADAPTER_DRAFTS: "1",
          MOYIN_SMOKE_SCRATCH_ROOT: root,
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.video-plan-dry-run-smoke.v1",
        status: "created",
        runId: "run-1",
        draft: {
          blockerCount: 0,
          stepCount: 4,
          paidStepCount: 3,
          nonExecutableStepCount: 0,
        },
        adapterDrafts: {
          attempted: true,
          scriptBuiltCount: 1,
          imageBuiltCount: 2,
          videoBuiltCount: 1,
          failureCount: 0,
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
        ["adapter", "script-execution", "--file", expect.any(String), "--json"],
        ["adapter", "image-execution", "--file", expect.any(String), "--json"],
        ["adapter", "image-execution", "--file", expect.any(String), "--json"],
        ["adapter", "video-execution", "--file", expect.any(String), "--json"],
        [
          "workflow-run",
          "create",
          "--project",
          "project-1",
          "--file",
          expect.any(String),
          "--json",
        ],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves missing image and video execution drafts through the shared runtime provider", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-plan-shared-drafts-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "image-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2i",
    executionDraft: { providerId: "moyin-api", model: "moyin-selected-image-model", prompt: request.prompt },
  }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "video-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2v",
    executionDraft: { providerId: "moyin-api", model: "moyin-selected-video-model", prompt: request.prompt },
  }));
  process.exit(0);
}
if (command.includes("workflow-run create") || command.includes("advance") || command.includes("submit")) {
  console.error("shared draft resolver must not create, advance, or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);
      const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
      registry.register(createMoyinProviderRegistration({ binary: fakeMoyin }));

      const result = await resolveMoyinVideoProductionPlanExecutionDrafts({
        registry,
        projectId: "project-1",
        scratchRoot: root,
        plan: {
          projectId: "project-1",
          goal: "Create a shared-runtime draft.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "Shared resolver scene",
              imagePrompt: "A clean shared image draft.",
              videoPrompt: "A clean shared video draft.",
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        summary: {
          attempted: true,
          imageBuiltCount: 1,
          videoBuiltCount: 1,
          failureCount: 0,
        },
        plan: {
          scenes: [
            {
              imageExecution: {
                providerId: "moyin-api",
                model: "moyin-selected-image-model",
              },
              videoExecution: {
                providerId: "moyin-api",
                model: "moyin-selected-video-model",
              },
            },
          ],
        },
      });
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["adapter", "image-execution", "--file", expect.any(String), "--json"],
        ["adapter", "video-execution", "--file", expect.any(String), "--json"],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks adapter execution drafts that do not carry the Moyin-selected model", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-user-model-required-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "image-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2i",
    executionDraft: { providerId: "moyin-api", prompt: request.prompt },
  }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "video-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2v",
    executionDraft: { providerId: "moyin-api", prompt: request.prompt },
  }));
  process.exit(0);
}
if (command.includes("workflow-run create") || command.includes("advance") || command.includes("submit")) {
  console.error("must not create, advance, or submit without Moyin-selected models");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);
      const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
      registry.register(createMoyinProviderRegistration({ binary: fakeMoyin }));

      const result = await resolveMoyinVideoProductionPlanExecutionDrafts({
        registry,
        projectId: "project-1",
        scratchRoot: root,
        plan: {
          projectId: "project-1",
          goal: "Create a user-selected model contract draft.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "Model contract scene",
              imagePrompt: "A clean image draft.",
              videoPrompt: "A clean video draft.",
            },
          ],
        },
      });

      expect(result.ok).toBe(false);
      expect(result.summary).toMatchObject({
        attempted: true,
        imageBuiltCount: 0,
        videoBuiltCount: 0,
        failureCount: 2,
      });
      expect(result.summary.failures).toEqual([
        expect.objectContaining({
          kind: "image",
          path: "scenes.0.imageExecution",
          error: "MOYIN_USER_SELECTED_MODEL_REQUIRED",
        }),
        expect.objectContaining({
          kind: "video",
          path: "scenes.0.videoExecution",
          error: "MOYIN_USER_SELECTED_MODEL_REQUIRED",
        }),
      ]);
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["adapter", "image-execution", "--file", expect.any(String), "--json"],
        ["adapter", "video-execution", "--file", expect.any(String), "--json"],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves script, character, image, and video execution drafts through one shared runtime pass", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-full-execution-drafts-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
if (args[0] === "status") {
  console.log(JSON.stringify({ session: { service: "moyin-control-plane", protocolVersion: "0.13.0", appVersion: "0.2.7" }, health: { ok: true } }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "script-execution") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executionDraft: {
      apiKey: "__configured_key_1__",
      provider: "openai",
      baseUrl: "https://example.invalid",
      model: "story-model",
      providerId: "text-provider",
      providerName: "Text Provider",
      providerPlatform: "openai",
      language: "zh",
      targetDuration: "60s",
      styleId: "",
      workflowTarget: request.workflowTarget,
      sceneCount: request.sceneCount,
      promptLanguage: "zh",
      calibrationStrictness: "normal"
    },
    executable: true,
    missing: [],
    warnings: []
  }));
  process.exit(0);
}
if (args[0] === "adapter" && (args[1] === "image-execution" || args[1] === "video-execution")) {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executionDraft: {
      providerId: args[1] === "image-execution" ? "image-provider" : "video-provider",
      model: args[1] === "image-execution" ? "image-model" : "video-model",
      prompt: request.prompt,
      panel: request.panel,
      operation: request.operation
    },
    executable: true,
    missing: [],
    warnings: []
  }));
  process.exit(0);
}
console.error("unexpected " + args.join(" "));
process.exit(1);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);
      const registry = new ExternalToolRegistry({ nowMs: () => Date.now() });
      registry.register(createMoyinProviderRegistration({ binary: fakeMoyin }));

      const result = await resolveMoyinVideoProductionPlanExecutionDrafts({
        registry,
        scratchRoot: root,
        projectId: "project-1",
        plan: {
          projectId: "project-1",
          goal: "Create a complete short AI video from a user idea.",
          idea: "A young inventor reveals a tiny glowing robot.",
          target: "director",
          characters: [
            {
              characterId: "inventor",
              characterName: "Inventor",
              prompt: "A curious young inventor with practical workshop clothes.",
            },
          ],
          scenes: [
            {
              sceneId: 1,
              name: "Workshop reveal",
              imagePrompt: "A safe cinematic workshop reveal frame.",
              videoPrompt: "A gentle camera push toward the glowing robot.",
            },
          ],
        },
      });

      expect(result.ok).toBe(true);
      expect(result.summary).toMatchObject({
        attempted: true,
        scriptBuiltCount: 1,
        imageBuiltCount: 2,
        videoBuiltCount: 1,
        failureCount: 0,
      });
      expect(result.plan.scriptExecution).toEqual(
        expect.objectContaining({
          providerId: "text-provider",
          model: "story-model",
          workflowTarget: "director",
          sceneCount: 1,
        }),
      );
      expect(result.plan.characters?.[0]?.imageExecution).toEqual(
        expect.objectContaining({ providerId: "image-provider" }),
      );
      expect(result.plan.scenes?.[0]?.imageExecution).toEqual(
        expect.objectContaining({ providerId: "image-provider" }),
      );
      expect(result.plan.scenes?.[0]?.videoExecution).toEqual(
        expect.objectContaining({ providerId: "video-provider" }),
      );
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(calls.map((call) => call.slice(0, 2).join(" "))).toEqual([
        "status --json",
        "adapter script-execution",
        "adapter image-execution",
        "adapter image-execution",
        "adapter video-execution",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("orchestrates adapter draft resolution and dry-run workflow creation through one runtime entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-plan-shared-orchestrator-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "image-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2i",
    executionDraft: { providerId: "moyin-api", model: "moyin-selected-image-model", prompt: request.prompt },
  }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "video-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2v",
    executionDraft: { providerId: "moyin-api", model: "moyin-selected-video-model", prompt: request.prompt },
  }));
  process.exit(0);
}
if (args[0] === "workflow-run" && args[1] === "create" && args[2] === "--project" && args[3] === "project-1" && args[4] === "--file" && args[6] === "--json") {
  const request = JSON.parse(readFileSync(args[5], "utf8"));
  if (request.mode !== "dry_run" || request.approvalPolicy?.requireBeforeSubmit !== true) {
    console.error("unsafe request");
    process.exit(3);
  }
  if (request.steps.length !== 2 || request.steps.some((step) => !step.payload?.execution)) {
    console.error("execution drafts were not threaded into workflow-run steps");
    process.exit(4);
  }
  console.log(JSON.stringify({ runId: "run-1", projectId: "project-1", status: "planned", steps: request.steps }));
  process.exit(0);
}
if (command.includes("advance") || command.includes("submit")) {
  console.error("dry-run orchestrator must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);
      const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
      registry.register(createMoyinProviderRegistration({ binary: fakeMoyin }));

      const result = await orchestrateMoyinVideoProductionDryRunWorkflow({
        registry,
        projectId: "project-1",
        scratchRoot: root,
        resolveExecutionDrafts: true,
        plan: {
          projectId: "project-1",
          goal: "Create a shared runtime dry-run workflow.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "Shared dry-run scene",
              imagePrompt: "A clean image draft.",
              videoPrompt: "A clean video draft.",
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        status: "created",
        metadata: {
          submitAttempted: false,
          advanceAttempted: false,
        },
        adapterDrafts: {
          attempted: true,
          imageBuiltCount: 1,
          videoBuiltCount: 1,
          failureCount: 0,
        },
        create: {
          ok: true,
          status: "created",
        },
        draft: {
          diagnostics: {
            blockerCount: 0,
            paidStepIds: ["director-scene-1-image-first", "director-scene-1-video"],
          },
          request: {
            mode: "dry_run",
            approvalPolicy: {
              requireBeforeSubmit: true,
            },
          },
        },
      });
      expect(readInvokeResultString(result.create.createResult, "runId")).toBe("run-1");
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toEqual([
        ["status", "--json"],
        ["adapter", "image-execution", "--file", expect.any(String), "--json"],
        ["adapter", "video-execution", "--file", expect.any(String), "--json"],
        [
          "workflow-run",
          "create",
          "--project",
          "project-1",
          "--file",
          expect.any(String),
          "--json",
        ],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a dry-run workflow and stops at the next approval packet through one runtime entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-plan-next-gate-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "image-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2i",
    executionDraft: { providerId: "moyin-api", model: "moyin-selected-image-model", prompt: request.prompt },
  }));
  process.exit(0);
}
if (args[0] === "adapter" && args[1] === "video-execution" && args[2] === "--file" && args[4] === "--json") {
  const request = JSON.parse(readFileSync(args[3], "utf8"));
  console.log(JSON.stringify({
    executable: false,
    missing: [],
    blockers: [],
    operation: "t2v",
    executionDraft: { providerId: "moyin-api", model: "moyin-selected-video-model", prompt: request.prompt },
  }));
  process.exit(0);
}
if (args[0] === "workflow-run" && args[1] === "create" && args[2] === "--project" && args[3] === "project-1" && args[4] === "--file" && args[6] === "--json") {
  const request = JSON.parse(readFileSync(args[5], "utf8"));
  console.log(JSON.stringify({
    runId: "run-1",
    projectId: "project-1",
    status: "planned",
    steps: request.steps,
  }));
  process.exit(0);
}
if (command === "workflow-run steps run-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [
      {
        stepId: "director-scene-1-image-first",
        status: "ready",
        requiresApproval: true,
      },
      {
        stepId: "director-scene-1-video",
        status: "pending",
        requiresApproval: true,
      },
    ],
  }));
  process.exit(0);
}
if (command.includes("advance") || command.includes("submit")) {
  console.error("video production next-gate orchestrator must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);
      const artifactStore = createFileConversationRuntimeExternalArtifactStore({
        rootPath: join(root, "artifact-store"),
        nowMs: () => 1_779_000_000_000,
        defaultRetention: "user_controlled",
        defaultSensitivity: "internal",
      });
      const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
      registry.register(createMoyinProviderRegistration({ binary: fakeMoyin }));

      const result = await orchestrateMoyinVideoProductionDryRunUntilNextGate({
        registry,
        projectId: "project-1",
        scratchRoot: root,
        resolveExecutionDrafts: true,
        turnId: "turn-video-next-gate",
        sessionKey: "desktop:workbench",
        artifactStore,
        approvalPacketDirectory: join(root, "approval-packets"),
        plan: {
          projectId: "project-1",
          goal: "Create a safe dry-run workflow and prepare the next approval.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "Approval scene",
              imagePrompt: "A clean approval frame.",
              videoPrompt: "A clean approval motion.",
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        status: "approval-required",
        runId: "run-1",
        dryRun: {
          ok: true,
          status: "created",
          metadata: {
            submitAttempted: false,
            advanceAttempted: false,
          },
        },
        nextGate: {
          status: "approval-required",
          metadata: {
            submitAttempted: false,
            advanceAttempted: false,
            resumeAttempted: false,
            packageAttempted: false,
          },
        },
        approvalPacket: {
          status: "approval-required",
          approvalPacketArtifact: {
            id: "moyin-approval-packet:project-1:run-1:director-scene-1-image-first:build_sealed_request",
            kind: "json",
            metadata: {
              role: "workflow-run-approval-packet",
              resumeToken:
                "moyin-workflow-run:project-1:run-1:director-scene-1-image-first:build_sealed_request",
            },
          },
          approvalPacketArtifactPersistence: {
            status: "ok",
          },
          approvalPacket: {
            operationId: "workflow-run.advance",
            advanceAction: "build_sealed_request",
            stepId: "director-scene-1-image-first",
            requiresApproval: true,
            nextInvocation: {
              packageScript: "moyin:smoke:continue-approved",
              env: {
                MOYIN_SMOKE_PROJECT_ID: "project-1",
                MOYIN_SMOKE_WORKFLOW_RUN_ID: "run-1",
                MOYIN_SMOKE_STEP_ID: "director-scene-1-image-first",
                MOYIN_SMOKE_ADVANCE_ACTION: "build_sealed_request",
                MOYIN_SMOKE_ALLOW_CONTINUE: "1",
                MOYIN_SMOKE_APPROVAL: "APPROVED",
              },
            },
          },
        },
        metadata: {
          submitAttempted: false,
          advanceAttempted: false,
          runCreated: true,
          approvalPacketCreated: true,
        },
      });
      expect(
        artifactStore.listArtifacts({
          providerId: "moyin",
          operationId: "workflow-run.approval-packet",
          projectId: "project-1",
          runId: "run-1",
          stepId: "director-scene-1-image-first",
        }),
      ).toHaveLength(1);
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs a user production goal through one shared production loop entry to the first approval gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-production-loop-start-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (args[0] === "workflow-run" && args[1] === "create" && args[2] === "--project" && args[3] === "project-1" && args[4] === "--file" && args[6] === "--json") {
  const request = JSON.parse(readFileSync(args[5], "utf8"));
  if (request.mode !== "dry_run" || request.approvalPolicy?.requireBeforeSubmit !== true) {
    console.error("unsafe production loop create request");
    process.exit(3);
  }
  console.log(JSON.stringify({
    runId: "run-loop-1",
    projectId: "project-1",
    status: "planned",
    steps: request.steps,
  }));
  process.exit(0);
}
if (command === "workflow-run steps run-loop-1 --project project-1 --json") {
  console.log(JSON.stringify({
    items: [
      { stepId: "director-scene-1-image-first", status: "ready", requiresApproval: true },
      { stepId: "director-scene-1-video", status: "pending", requiresApproval: true },
    ],
  }));
  process.exit(0);
}
if (command.includes("advance") || command.includes("submit")) {
  console.error("production loop start must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);
      const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
      registry.register(createMoyinProviderRegistration({ binary: fakeMoyin }));
      const events: string[] = [];

      const result = await orchestrateMoyinVideoProductionLoop({
        mode: "start",
        registry,
        projectId: "project-1",
        scratchRoot: root,
        turnId: "turn-production-loop",
        sessionKey: "desktop:workbench",
        onEvent: (event) => events.push(`${event.kind}:${event.stepId}`),
        plan: {
          projectId: "project-1",
          goal: "Create a compact AI video production loop.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "Loop scene",
              imagePrompt: "A clean loop frame.",
              videoPrompt: "A clean loop motion.",
              imageExecution: { providerId: "image-provider", model: "image-model" },
              videoExecution: { providerId: "video-provider", model: "video-model" },
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        mode: "start",
        status: "approval-required",
        projectId: "project-1",
        runId: "run-loop-1",
        operationSequence: [
          "video-production.plan",
          "workflow-run.create",
          "workflow-run.until-next-gate",
          "workflow-run.approval-packet",
        ],
        approvalPacket: {
          status: "approval-required",
          approvalPacket: {
            advanceAction: "build_sealed_request",
            stepId: "director-scene-1-image-first",
          },
        },
        metadata: {
          submitAttempted: false,
          advanceAttempted: false,
          executeAttempted: false,
          packageAttempted: false,
        },
      });
      expect(events).toEqual([
        "moyin.video_production.plan.started:video-production.plan",
        "moyin.video_production.plan.completed:video-production.plan",
        "moyin.workflow_run.create.started:workflow-run.create",
        "moyin.workflow_run.create.completed:workflow-run.create",
        "moyin.workflow_run.next_gate.started:workflow-run.until-next-gate",
        "moyin.workflow_run.next_gate.completed:director-scene-1-image-first",
        "moyin.workflow_run.approval_packet.created:director-scene-1-image-first",
      ]);
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps desktop and Weixin production goals on the same runtime operation sequence", async () => {
    const calls: string[][] = [];
    let createCount = 0;
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
          if (
            args[0] === "workflow-run" &&
            args[1] === "create" &&
            args[2] === "--project" &&
            args[3] === "project-1" &&
            args[4] === "--file" &&
            args[6] === "--json"
          ) {
            createCount += 1;
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: `run-shared-${createCount}`,
                projectId: "project-1",
                status: "planned",
              }),
              stderr: "",
            };
          }
          if (command === "workflow-run steps run-shared-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "director-scene-1-image-first",
                    status: "ready",
                    requiresApproval: true,
                  },
                  { stepId: "director-scene-1-video", status: "pending", requiresApproval: true },
                ],
              }),
              stderr: "",
            };
          }
          if (command === "workflow-run steps run-shared-2 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "director-scene-1-image-first",
                    status: "ready",
                    requiresApproval: true,
                  },
                  { stepId: "director-scene-1-video", status: "pending", requiresApproval: true },
                ],
              }),
              stderr: "",
            };
          }
          if (command.includes("advance") || command.includes("submit")) {
            return {
              exitCode: 9,
              stdout: "",
              stderr: "shared runtime entry must not advance or submit without approval",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${command}` };
        },
      }),
    );
    const plan = {
      projectId: "project-1",
      goal: "Create the same compact AI video production loop from any chat client.",
      target: "director" as const,
      scenes: [
        {
          sceneId: 1,
          name: "Shared runtime scene",
          imagePrompt: "A clean shared runtime frame.",
          videoPrompt: "A clean shared runtime motion.",
          imageExecution: { providerId: "image-provider", model: "image-model" },
          videoExecution: { providerId: "video-provider", model: "video-model" },
        },
      ],
    };

    const desktopEvents: string[] = [];
    const weixinEvents: string[] = [];
    const desktop = await orchestrateMoyinVideoProductionLoop({
      mode: "start",
      registry,
      projectId: "project-1",
      turnId: "turn-desktop",
      sessionKey: "desktop:workbench",
      plan,
      onEvent: (event) => desktopEvents.push(`${event.kind}:${event.stepId}`),
    });
    const weixin = await orchestrateMoyinVideoProductionLoop({
      mode: "start",
      registry,
      projectId: "project-1",
      turnId: "turn-weixin",
      sessionKey: "weixin:account:user-1",
      plan,
      onEvent: (event) => weixinEvents.push(`${event.kind}:${event.stepId}`),
    });

    expect(desktop).toMatchObject({
      ok: true,
      status: "approval-required",
      operationSequence: [
        "video-production.plan",
        "workflow-run.create",
        "workflow-run.until-next-gate",
        "workflow-run.approval-packet",
      ],
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        executeAttempted: false,
      },
    });
    expect(weixin).toMatchObject({
      ok: true,
      status: "approval-required",
      operationSequence: desktop.operationSequence,
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        executeAttempted: false,
      },
    });
    expect(desktopEvents).toEqual(weixinEvents);
    expect(desktop.approvalPacket?.approvalPacket?.approvalBinding).toMatchObject({
      turnId: "turn-desktop",
      sessionKey: "desktop:workbench",
    });
    expect(weixin.approvalPacket?.approvalPacket?.approvalBinding).toMatchObject({
      turnId: "turn-weixin",
      sessionKey: "weixin:account:user-1",
    });
    expect(calls.flat()).not.toContain("advance");
    expect(calls.flat()).not.toContain("submit");
  });

  it("forwards package lifecycle events from the shared production loop start entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-production-loop-events-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (args[0] === "workflow-run" && args[1] === "create" && args[2] === "--project" && args[3] === "project-1" && args[4] === "--file" && args[6] === "--json") {
  const request = JSON.parse(readFileSync(args[5], "utf8"));
  if (request.mode !== "dry_run" || request.approvalPolicy?.requireBeforeSubmit !== true) {
    console.error("unsafe production loop event create request");
    process.exit(3);
  }
  console.log(JSON.stringify({ runId: "run-loop-packaged", projectId: "project-1", status: "completed" }));
  process.exit(0);
}
if (command === "workflow-run steps run-loop-packaged --project project-1 --json") {
  console.log(JSON.stringify({
    items: [
      {
        stepId: "director-scene-1-image-first",
        status: "completed",
        sealedRequestId: "sealed-1",
        taskId: "task-1",
        requiresApproval: true,
      },
    ],
  }));
  process.exit(0);
}
if (command === "workflow-run get run-loop-packaged --project project-1 --json") {
  console.log(JSON.stringify({ runId: "run-loop-packaged", projectId: "project-1", status: "completed" }));
  process.exit(0);
}
if (command === "workflow-run artifacts run-loop-packaged --project project-1 --json") {
  console.log(JSON.stringify({
    items: [
      {
        artifactId: "artifact-1",
        type: "image",
        localPath: "/tmp/moyin/artifact-1.png",
        runId: "run-loop-packaged",
        stepId: "director-scene-1-image-first",
        taskId: "task-1",
      },
    ],
    total: 1,
  }));
  process.exit(0);
}
if (command === "workflow-run export run-loop-packaged --project project-1 --target json --json") {
  console.log(JSON.stringify({ id: "run-loop-packaged-json", runId: "run-loop-packaged", target: "json" }));
  process.exit(0);
}
if (command === "workflow-run export run-loop-packaged --project project-1 --target comfyui-draft --json") {
  console.log(JSON.stringify({
    id: "run-loop-packaged-comfyui",
    runId: "run-loop-packaged",
    target: "comfyui-draft",
    conversion: { executable: true, lossiness: "lossless", missingDependencies: [] },
  }));
  process.exit(0);
}
if (command.includes("advance") || command.includes("submit")) {
  console.error("production loop package events must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);
      const registry = new ExternalToolRegistry({ nowMs: () => 1_779_000_000_000 });
      registry.register(createMoyinProviderRegistration({ binary: fakeMoyin }));
      const events: string[] = [];

      const result = await orchestrateMoyinVideoProductionLoop({
        mode: "start",
        registry,
        projectId: "project-1",
        scratchRoot: root,
        handoffManifestDirectory: join(root, "handoff"),
        onEvent: (event) => events.push(`${event.kind}:${event.stepId}`),
        plan: {
          projectId: "project-1",
          goal: "Create a production loop that is already completed for package projection.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "Packaged loop scene",
              imagePrompt: "A completed frame.",
              imageExecution: { providerId: "image-provider", model: "image-model" },
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        mode: "start",
        status: "packaged",
        operationSequence: [
          "video-production.plan",
          "workflow-run.create",
          "workflow-run.until-next-gate",
        ],
        metadata: {
          submitAttempted: false,
          advanceAttempted: false,
          executeAttempted: false,
          packageAttempted: true,
        },
      });
      expect(events).toEqual([
        "moyin.video_production.plan.started:video-production.plan",
        "moyin.video_production.plan.completed:video-production.plan",
        "moyin.workflow_run.create.started:workflow-run.create",
        "moyin.workflow_run.create.completed:workflow-run.create",
        "moyin.workflow_run.next_gate.started:workflow-run.until-next-gate",
        "moyin.workflow_run.package.started:workflow-run.package",
        "moyin.workflow_run.package.completed:workflow-run.package",
        "moyin.workflow_run.next_gate.completed:workflow-run.until-next-gate",
      ]);
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints production loop smoke event summaries for run-center projection", () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-production-loop-smoke-events-"));
    try {
      const fakeMoyin = join(root, "fake-moyin.mjs");
      const callLog = join(root, "calls.jsonl");
      const planFile = join(root, "plan.json");
      writeFileSync(
        planFile,
        JSON.stringify({
          projectId: "project-1",
          goal: "Create a production loop smoke package from an already completed image step.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "Smoke package scene",
              imagePrompt: "A completed frame.",
              imageExecution: { providerId: "image-provider", model: "image-model" },
            },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        fakeMoyin,
        `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + "\\n");
const command = args.join(" ");
if (command === "status --json") {
  console.log(JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }));
  process.exit(0);
}
if (args[0] === "workflow-run" && args[1] === "create" && args[2] === "--project" && args[3] === "project-1" && args[4] === "--file" && args[6] === "--json") {
  const request = JSON.parse(readFileSync(args[5], "utf8"));
  if (request.mode !== "dry_run" || request.approvalPolicy?.requireBeforeSubmit !== true) {
    console.error("unsafe production loop smoke event create request");
    process.exit(3);
  }
  console.log(JSON.stringify({ runId: "run-smoke-packaged", projectId: "project-1", status: "completed" }));
  process.exit(0);
}
if (command === "workflow-run steps run-smoke-packaged --project project-1 --json") {
  console.log(JSON.stringify({
    items: [
      {
        stepId: "director-scene-1-image-first",
        status: "completed",
        sealedRequestId: "sealed-1",
        taskId: "task-1",
        requiresApproval: true,
      },
    ],
  }));
  process.exit(0);
}
if (command === "workflow-run get run-smoke-packaged --project project-1 --json") {
  console.log(JSON.stringify({ runId: "run-smoke-packaged", projectId: "project-1", status: "completed" }));
  process.exit(0);
}
if (command === "workflow-run artifacts run-smoke-packaged --project project-1 --json") {
  console.log(JSON.stringify({
    items: [
      {
        artifactId: "artifact-1",
        type: "image",
        localPath: "/tmp/moyin/artifact-1.png",
        runId: "run-smoke-packaged",
        stepId: "director-scene-1-image-first",
        taskId: "task-1",
      },
    ],
    total: 1,
  }));
  process.exit(0);
}
if (command === "workflow-run export run-smoke-packaged --project project-1 --target json --json") {
  console.log(JSON.stringify({ id: "run-smoke-packaged-json", runId: "run-smoke-packaged", target: "json" }));
  process.exit(0);
}
if (command === "workflow-run export run-smoke-packaged --project project-1 --target comfyui-draft --json") {
  console.log(JSON.stringify({
    id: "run-smoke-packaged-comfyui",
    runId: "run-smoke-packaged",
    target: "comfyui-draft",
    conversion: { executable: true, lossiness: "lossless", missingDependencies: [] },
  }));
  process.exit(0);
}
if (command.includes("advance") || command.includes("submit")) {
  console.error("production loop smoke event test must not advance or submit");
  process.exit(9);
}
console.error("unexpected " + command);
process.exit(2);
`,
        "utf8",
      );
      chmodSync(fakeMoyin, 0o755);

      const output = execFileSync(process.execPath, [videoProductionLoopSmokeScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          MOYIN_BINARY: fakeMoyin,
          MOYIN_SMOKE_PROJECT_ID: "project-1",
          MOYIN_SMOKE_PLAN_FILE: planFile,
          MOYIN_SMOKE_SCRATCH_ROOT: root,
          MOYIN_SMOKE_HANDOFF_MANIFEST_DIR: join(root, "handoff"),
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        schemaVersion: "director.moyin.video-production-loop-smoke.v1",
        status: "packaged",
        events: {
          count: 8,
          items: [
            {
              kind: "moyin.video_production.plan.started",
              stepId: "video-production.plan",
            },
            {
              kind: "moyin.video_production.plan.completed",
              stepId: "video-production.plan",
            },
            {
              kind: "moyin.workflow_run.create.started",
              stepId: "workflow-run.create",
            },
            {
              kind: "moyin.workflow_run.create.completed",
              stepId: "workflow-run.create",
              runId: "run-smoke-packaged",
            },
            {
              kind: "moyin.workflow_run.next_gate.started",
              stepId: "workflow-run.until-next-gate",
              runId: "run-smoke-packaged",
            },
            {
              kind: "moyin.workflow_run.package.started",
              stepId: "workflow-run.package",
              runId: "run-smoke-packaged",
            },
            {
              kind: "moyin.workflow_run.package.completed",
              stepId: "workflow-run.package",
              runId: "run-smoke-packaged",
              metadata: {
                status: "packaged",
                artifactCount: 1,
              },
            },
            {
              kind: "moyin.workflow_run.next_gate.completed",
              stepId: "workflow-run.until-next-gate",
              runId: "run-smoke-packaged",
            },
          ],
        },
      });
      const calls = readFileSync(callLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls.flat()).not.toContain("advance");
      expect(calls.flat()).not.toContain("submit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("continues an approved approval packet through the same production loop entry", async () => {
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
            const advanced = calls.some(
              (call) => call[0] === "workflow-run" && call[1] === "advance",
            );
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: advanced ? "approval_required" : "ready",
                    sealedRequestId: advanced ? "sealed-1" : undefined,
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
            return { exitCode: 9, stdout: "", stderr: "production loop must stop before execute" };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinVideoProductionLoop({
      mode: "continue-approved",
      registry,
      approval: { status: "approved", operatorId: "operator-1" },
      nowMs: () => 1_779_000_000_000,
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-28T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved production loop continuation",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
      approvalPacket: {
        schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
        type: "approval_request",
        providerId: "moyin",
        operationId: "workflow-run.advance",
        advanceAction: "build_sealed_request",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        approvalExpiresAtMs: 1_779_000_060_000,
        approvalBinding: {
          turnId: "turn-loop-continue",
          sessionKey: "desktop:workbench",
        },
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
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "continue-approved",
      status: "approval-required",
      projectId: "project-1",
      runId: "run-1",
      operationSequence: [
        "workflow-run.continue-approved",
        "workflow-run.advance",
        "workflow-run.until-next-gate",
        "workflow-run.approval-packet",
      ],
      continuation: {
        status: "approval-required",
        advance: {
          ok: true,
          status: "advanced",
        },
      },
      approvalPacket: {
        status: "approval-required",
        approvalPacket: {
          advanceAction: "execute",
          stepId: "step-1",
          sealedRequestId: "sealed-1",
        },
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: true,
        executeAttempted: false,
        packageAttempted: false,
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
  });

  it("reissues an expired approval packet through the same production loop entry without mutating Moyin", async () => {
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
          if (args[0] === "workflow-run" && args[1] === "advance") {
            return { exitCode: 9, stdout: "", stderr: "expired reissue must not advance" };
          }
          if (args.includes("submit")) {
            return { exitCode: 9, stdout: "", stderr: "expired reissue must not submit" };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    const result = await orchestrateMoyinVideoProductionLoop({
      mode: "continue-approved",
      registry,
      approval: { status: "approved", operatorId: "operator-1" },
      nowMs: () => 1_779_000_000_000,
      reissueExpiredApprovalPacket: true,
      approvalPacket: {
        schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
        type: "approval_request",
        providerId: "moyin",
        operationId: "workflow-run.advance",
        advanceAction: "build_sealed_request",
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        approvalId: "approval-old",
        approvalExpiresAtMs: 1_778_999_999_999,
        approvalBinding: {
          turnId: "turn-loop-reissue",
          sessionKey: "desktop:workbench",
        },
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
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "continue-approved",
      status: "approval-required",
      projectId: "project-1",
      runId: "run-1",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_EXPIRED",
      },
      operationSequence: ["workflow-run.continue-approved", "workflow-run.approval-packet"],
      continuation: {
        status: "approval-required",
        nextApprovalPacket: {
          status: "approval-required",
          approvalPacket: {
            advanceAction: "build_sealed_request",
            stepId: "step-1",
            approvalBinding: {
              turnId: "turn-loop-reissue",
              sessionKey: "desktop:workbench",
            },
            mutation: {
              advanceAttempted: false,
              executeAttempted: false,
              submitAttempted: false,
            },
          },
        },
      },
      approvalPacket: {
        status: "approval-required",
        approvalPacket: {
          advanceAction: "build_sealed_request",
          stepId: "step-1",
        },
      },
      metadata: {
        submitAttempted: false,
        advanceAttempted: false,
        executeAttempted: false,
        packageAttempted: false,
        approvalPacketCreated: true,
      },
    });
    expect(calls).toEqual([
      ["status", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
    ]);
    expect(calls.flat()).not.toContain("advance");
    expect(calls.flat()).not.toContain("submit");
  });

  it("maps a Director Angel scene plan into a dry-run Moyin workflow-run draft", () => {
    const draft = createMoyinWorkflowRunDraftFromVideoProductionPlan({
      projectId: "project-1",
      goal: "Create a 15 second product teaser from two planned scenes.",
      idea: "A calm morning product reveal followed by an energetic close.",
      target: "director",
      aspectRatio: "16:9",
      defaultDurationSeconds: 5,
      scriptExecution: { providerId: "text-provider", model: "story-model" },
      scenes: [
        {
          sceneId: 1,
          name: "Morning reveal",
          imagePrompt: "Wide shot of the product on a clean desk at sunrise.",
          videoPrompt: "Camera pushes in slowly while light crosses the desk.",
          imageExecution: { providerId: "image-provider", model: "image-model" },
          videoExecution: { providerId: "video-provider", model: "video-model" },
        },
        {
          sceneId: 2,
          name: "Energetic close",
          imagePrompt: "Close shot with bold rim light and crisp texture.",
          videoPrompt: "Fast product turntable with confident motion.",
          imageExecution: { providerId: "image-provider", model: "image-model" },
          videoExecution: { providerId: "video-provider", model: "video-model" },
        },
      ],
    });

    expect(draft).toMatchObject({
      schemaVersion: "director.moyin.video-production-plan.v1",
      diagnostics: {
        blockerCount: 0,
        paidStepIds: [
          "director-scene-1-image-first",
          "director-scene-1-video",
          "director-scene-2-image-first",
          "director-scene-2-video",
        ],
        referencePatterns: [
          "hermes.tool-executor",
          "hermes.approval-queue",
          "openclaw.provider-contract",
          "openclaw.event-stream",
        ],
      },
      request: {
        projectId: "project-1",
        actor: "angel",
        mode: "dry_run",
        complexity: "simple_dag",
        memoryPolicy: {
          readProjectMemory: true,
          writeBack: "none",
        },
        approvalPolicy: {
          requireBeforeSubmit: true,
        },
        concurrencyPolicy: {
          maxParallelSteps: 1,
          respectDependencies: true,
        },
      },
    });
    expect(draft.request.steps).toEqual([
      expect.objectContaining({
        stepId: "script-generate-from-idea",
        command: "task.template.build",
        templateId: "script.generate-from-idea",
        requiresApproval: false,
        payload: expect.objectContaining({
          execution: { providerId: "text-provider", model: "story-model" },
          values: {
            projectId: "project-1",
            idea: "A calm morning product reveal followed by an energetic close.",
            execution: { providerId: "text-provider", model: "story-model" },
          },
        }),
      }),
      expect.objectContaining({
        stepId: "director-scene-1-image-first",
        templateId: "director.scene-image",
        dependencies: ["script-generate-from-idea"],
        requiresApproval: true,
        payload: expect.objectContaining({
          execution: { providerId: "image-provider", model: "image-model" },
          values: expect.objectContaining({
            sceneId: 1,
            sceneName: "Morning reveal",
            frameType: "first",
            execution: { providerId: "image-provider", model: "image-model" },
          }),
        }),
      }),
      expect.objectContaining({
        stepId: "director-scene-1-video",
        templateId: "director.scene-video",
        dependencies: ["director-scene-1-image-first"],
        requiresApproval: true,
      }),
      expect.objectContaining({
        stepId: "director-scene-2-image-first",
        templateId: "director.scene-image",
        dependencies: ["script-generate-from-idea"],
        requiresApproval: true,
      }),
      expect.objectContaining({
        stepId: "director-scene-2-video",
        templateId: "director.scene-video",
        dependencies: ["director-scene-2-image-first"],
        requiresApproval: true,
      }),
    ]);
    expect(JSON.stringify(draft.request)).not.toContain("moyin-project-store");
    expect(JSON.stringify(draft.request)).not.toContain("_p/");
  });

  it("keeps incomplete paid media steps as dry-run blockers instead of pretending executable", () => {
    const draft = createMoyinWorkflowRunDraftFromVideoProductionPlan({
      projectId: "project-1",
      goal: "Create a quick concept video.",
      target: "director",
      scenes: [
        {
          sceneId: 7,
          name: "Concept",
          imagePrompt: "A compact concept frame.",
          videoPrompt: "A compact concept motion.",
        },
      ],
    });

    expect(draft.request.mode).toBe("dry_run");
    expect(draft.diagnostics.blockers).toEqual([
      expect.objectContaining({
        code: "MOYIN_IMAGE_EXECUTION_REQUIRED",
        stepId: "director-scene-1-image-first",
      }),
      expect.objectContaining({
        code: "MOYIN_VIDEO_EXECUTION_REQUIRED",
        stepId: "director-scene-1-video",
      }),
    ]);
    expect(draft.request.steps).toEqual([
      expect.objectContaining({
        stepId: "director-scene-1-image-first",
        requiresApproval: true,
        payload: expect.not.objectContaining({ execution: expect.anything() }),
      }),
      expect.objectContaining({
        stepId: "director-scene-1-video",
        requiresApproval: true,
        payload: expect.not.objectContaining({ execution: expect.anything() }),
      }),
    ]);
  });

  it("fails closed when video operations are missing required media inputs", () => {
    const draft = createMoyinWorkflowRunDraftFromVideoProductionPlan({
      projectId: "project-1",
      goal: "Create video operation guard cases.",
      target: "director",
      scenes: [
        {
          sceneId: 1,
          name: "Missing first frame",
          videoPrompt: "Animate from a first frame.",
          operation: "i2v",
          videoExecution: { providerId: "video-provider", selectedOperation: "image_to_video" },
        },
        {
          sceneId: 2,
          name: "Missing last frame",
          videoPrompt: "Animate between two fixed frames.",
          operation: "first_last_frame",
          firstFrameImage: "https://example.com/first.png",
          videoExecution: {
            providerId: "video-provider",
            selectedOperation: "first_last_frame_video",
            imageWithRoles: [{ role: "first_frame", url: "https://example.com/first.png" }],
          },
        },
        {
          sceneId: 3,
          name: "Missing references",
          videoPrompt: "Animate from references.",
          operation: "r2v",
          videoExecution: {
            providerId: "video-provider",
            selectedOperation: "reference_to_video",
          },
        },
      ],
    });

    expect(draft.diagnostics.blockers).toEqual([
      expect.objectContaining({
        code: "MOYIN_VIDEO_I2V_FIRST_FRAME_REQUIRED",
        stepId: "director-scene-1-video",
        path: "scenes.0.firstFrameImage",
      }),
      expect.objectContaining({
        code: "MOYIN_VIDEO_FIRST_LAST_FRAME_REQUIRED",
        stepId: "director-scene-2-video",
        path: "scenes.1.lastFrameImage",
      }),
      expect.objectContaining({
        code: "MOYIN_VIDEO_R2V_REFERENCE_IMAGES_REQUIRED",
        stepId: "director-scene-3-video",
        path: "scenes.2.referenceImages",
      }),
    ]);
    expect(draft.diagnostics.nonExecutableStepIds).toEqual([
      "director-scene-1-video",
      "director-scene-2-video",
      "director-scene-3-video",
    ]);
  });

  it("passes operation-specific video media inputs into Moyin adapter execution drafts", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyin-video-operation-guards-"));
    try {
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
            if (args[0] === "adapter" && args[1] === "video-execution") {
              const request = JSON.parse(readFileSync(args[3], "utf8"));
              const hasFirstFrame = request.imageWithRoles?.some(
                (item: { role?: string; url?: string }) =>
                  item.role === "first_frame" && item.url === "https://example.com/first.png",
              );
              if (request.operation !== "i2v" || !hasFirstFrame) {
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({
                    executable: false,
                    missing: ["imageWithRoles.first_frame"],
                    blockers: ["i2v requires first frame"],
                  }),
                  stderr: "",
                };
              }
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  executable: false,
                  missing: [],
                  blockers: [],
                  operation: "i2v",
                  executionDraft: {
                    providerId: "moyin-api",
                    model: "moyin-selected-video-model",
                    selectedOperation: "image_to_video",
                    imageWithRoles: request.imageWithRoles,
                  },
                }),
                stderr: "",
              };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const result = await resolveMoyinVideoProductionPlanExecutionDrafts({
        registry,
        projectId: "project-1",
        scratchRoot: root,
        plan: {
          projectId: "project-1",
          goal: "Build an i2v execution draft from a prepared first frame.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "I2V scene",
              videoPrompt: "Animate from this first frame.",
              operation: "i2v",
              firstFrameImage: "https://example.com/first.png",
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        summary: {
          videoBuiltCount: 1,
          failureCount: 0,
        },
        plan: {
          scenes: [
            expect.objectContaining({
              videoExecution: expect.objectContaining({
                selectedOperation: "image_to_video",
                imageWithRoles: [{ role: "first_frame", url: "https://example.com/first.png" }],
              }),
            }),
          ],
        },
      });
      expect(
        calls.filter((call) => call[0] === "adapter" && call[1] === "video-execution"),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("maps S-Class groups after scene reference inputs without client-specific logic", () => {
    const draft = createMoyinWorkflowRunDraftFromVideoProductionPlan({
      projectId: "project-1",
      goal: "Create a storyboard-driven S-Class video.",
      target: "sclass",
      scenes: [
        {
          sceneId: 1,
          name: "Beat one",
          imagePrompt: "Reference image for beat one.",
          imageExecution: { providerId: "image-provider", model: "image-model" },
        },
        {
          sceneId: 2,
          name: "Beat two",
          imagePrompt: "Reference image for beat two.",
          imageExecution: { providerId: "image-provider", model: "image-model" },
        },
      ],
      sclassGroups: [
        {
          groupId: "group-a",
          groupName: "Opening board",
          sceneIds: [1, 2],
          videoPrompt: "Animate the two beat board as one coherent group.",
          videoExecution: { providerId: "video-provider", model: "video-model" },
        },
      ],
    });

    expect(draft.request.steps).toEqual([
      expect.objectContaining({
        stepId: "scene-reference-1-image",
        command: "task.template.build",
        templateId: "scene.reference-image",
        requiresApproval: true,
      }),
      expect.objectContaining({
        stepId: "scene-reference-2-image",
        command: "task.template.build",
        templateId: "scene.reference-image",
        requiresApproval: true,
      }),
      expect.objectContaining({
        stepId: "sclass-group-1-video",
        command: "task.template.build",
        templateId: "sclass.group-video",
        requiresApproval: true,
        dependencies: ["scene-reference-1-image", "scene-reference-2-image"],
        payload: expect.objectContaining({
          execution: { providerId: "video-provider", model: "video-model" },
          values: expect.objectContaining({
            groupId: "group-a",
            groupName: "Opening board",
            sceneIds: [1, 2],
          }),
        }),
      }),
    ]);
    expect(draft.diagnostics.blockerCount).toBe(0);
  });

  it("creates the Moyin workflow-run through the provider boundary without submitting work", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-moyin-plan-"));
    try {
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
            if (
              args[0] === "workflow-run" &&
              args[1] === "create" &&
              args[2] === "--project" &&
              args[3] === "project-1" &&
              args[4] === "--file" &&
              args[6] === "--json"
            ) {
              const draftFile = String(args[5]);
              const request = JSON.parse(readFileSync(draftFile, "utf8")) as Record<
                string,
                unknown
              >;
              expect(request).toMatchObject({
                projectId: "project-1",
                actor: "angel",
                mode: "dry_run",
                steps: [
                  expect.objectContaining({
                    stepId: "director-scene-1-image-first",
                    templateId: "director.scene-image",
                  }),
                  expect.objectContaining({
                    stepId: "director-scene-1-video",
                    templateId: "director.scene-video",
                  }),
                ],
              });
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  runId: "run-1",
                  projectId: "project-1",
                  status: "planned",
                  steps: request.steps,
                }),
                stderr: "",
              };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const result = await createMoyinWorkflowRunFromVideoProductionPlan({
        registry,
        scratchRoot: root,
        plan: {
          projectId: "project-1",
          goal: "Create a short verified Moyin run.",
          target: "director",
          scenes: [
            {
              sceneId: 1,
              name: "Verified scene",
              imagePrompt: "One clean verified frame.",
              videoPrompt: "A short verified motion.",
              imageExecution: { providerId: "image-provider", model: "image-model" },
              videoExecution: { providerId: "video-provider", model: "video-model" },
            },
          ],
        },
      });

      expect(result).toMatchObject({
        ok: true,
        status: "created",
        draft: {
          diagnostics: {
            blockerCount: 0,
          },
        },
        createResult: {
          ok: true,
          status: "success",
          content: "Moyin workflow run created.",
        },
      });
      expect(calls).toHaveLength(2);
      expect(calls[1]?.slice(0, 5)).toEqual([
        "workflow-run",
        "create",
        "--project",
        "project-1",
        "--file",
      ]);
      expect(calls.flat()).not.toContain("submit");
      expect(calls.flat()).not.toContain("advance");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function readInvokeResultString(value: unknown, key: string): string | undefined {
  const record = readRecord(value);
  const output = readRecord(record?.output);
  const nestedOutput = readRecord(output?.output);
  const payload = readRecord(output?.payload) ?? readRecord(nestedOutput?.payload);
  const direct = recordString(record, key);
  const fromOutput = recordString(output, key);
  const fromNestedOutput = recordString(nestedOutput, key);
  const fromPayload = recordString(payload, key);
  return direct ?? fromOutput ?? fromNestedOutput ?? fromPayload;
}

function recordString(value: unknown, key: string): string | undefined {
  const record = readRecord(value);
  const nested = record?.[key];
  return typeof nested === "string" && nested.trim().length > 0 ? nested.trim() : undefined;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getBenchmarksPaths, runWorkspaceBuild } from "./cli-command.mjs";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function buildWorkspace(target, env) {
  const result = runWorkspaceBuild(target, env);
  if (result.status !== 0) {
    fail(`${target} build failed for wave65 director runtime prompt registry gate.`, result.stderr);
  }
}

async function runGate() {
  const { repoRoot, resultsDir } = getBenchmarksPaths();
  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: repoRoot,
  };

  buildWorkspace("@hotflow/context", env);
  buildWorkspace("@hotflow/runtime-bootstrap", env);

  const runtimeBootstrapPath = resolve(repoRoot, "apps", "runtime-bootstrap", "dist", "index.js");
  const runtimeBootstrap = await import(pathToFileURL(runtimeBootstrapPath).href);
  const {
    DEFAULT_RUNTIME_PROMPT_SECTION_IDS,
    createDefaultRuntimeContextAssembler,
    createDefaultRuntimePromptRegistry,
    createDefaultRuntimePromptSections,
  } = runtimeBootstrap;

  const config = {
    defaultProvider: "scripted",
    defaultModel: "hotflow-phase1",
    outputStyle: "balanced",
    permissionMode: "ask",
    responseLanguage: "follow-user",
    workspaceRoot: "/workspace/director-angel",
  };
  const expectedIds = [
    "system.identity",
    "system.director-role",
    "system.execution-boundary",
    "system.tools",
    "system.runtime",
    "system.permission-mode",
    "system.response-language",
    "system.output-style",
  ];

  const sections = createDefaultRuntimePromptSections(config);
  const registry = createDefaultRuntimePromptRegistry(config);
  const assembled = createDefaultRuntimeContextAssembler(config).build({ tokenBudget: 4_000 });
  const failures = [];

  if (JSON.stringify(DEFAULT_RUNTIME_PROMPT_SECTION_IDS) !== JSON.stringify(expectedIds)) {
    failures.push(
      `Expected DEFAULT_RUNTIME_PROMPT_SECTION_IDS=${JSON.stringify(expectedIds)} but received ${JSON.stringify(DEFAULT_RUNTIME_PROMPT_SECTION_IDS)}.`,
    );
  }

  const sectionIds = sections.map((section) => section.id);
  if (JSON.stringify(sectionIds) !== JSON.stringify(expectedIds)) {
    failures.push(
      `Expected runtime prompt section ids=${JSON.stringify(expectedIds)} but received ${JSON.stringify(sectionIds)}.`,
    );
  }

  if (
    !sections
      .find((section) => section.id === "system.identity")
      ?.content.includes("Director Angel")
  ) {
    failures.push("Expected system.identity to anchor the runtime identity to Director Angel.");
  }
  if (
    !sections
      .find((section) => section.id === "system.director-role")
      ?.content.includes("Act like a director")
  ) {
    failures.push("Expected system.director-role to describe the director posture.");
  }
  if (
    !sections
      .find((section) => section.id === "system.execution-boundary")
      ?.content.includes("worker-only path")
  ) {
    failures.push("Expected system.execution-boundary to encode the worker-only boundary.");
  }

  const staticSectionIds = assembled.cacheBoundary.staticSections.map((section) => section.id);
  if (JSON.stringify(staticSectionIds) !== JSON.stringify(expectedIds)) {
    failures.push(
      `Expected assembled static section ids=${JSON.stringify(expectedIds)} but received ${JSON.stringify(staticSectionIds)}.`,
    );
  }
  if (!assembled.cacheBoundary.staticPrompt.includes("Director Angel")) {
    failures.push(
      "Expected assembled static prompt to include the Director Angel runtime identity.",
    );
  }
  if (!assembled.cacheBoundary.staticPrompt.includes("worker-only path")) {
    failures.push(
      "Expected assembled static prompt to include the worker-only execution boundary.",
    );
  }

  let protectedOverwriteError;
  try {
    registry.upsert({
      id: "system.execution-boundary",
      cacheBucket: "static",
      owner: "system",
      content: "override",
    });
  } catch (error) {
    protectedOverwriteError = String(error);
  }

  if (
    protectedOverwriteError !==
    "Error: Protected static section cannot be overwritten: system.execution-boundary"
  ) {
    failures.push(
      `Expected protected overwrite error for system.execution-boundary, received ${JSON.stringify(protectedOverwriteError)}.`,
    );
  }

  if (failures.length > 0) {
    fail("wave65 director runtime prompt registry gate failed.", failures.join("\n"));
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    resolve(resultsDir, "wave65-director-runtime-prompt-registry-gate.json"),
    JSON.stringify(
      {
        gate: "wave65-director-runtime-prompt-registry-gate",
        sectionIds,
        staticSectionIds,
        identityPreview: sections.find((section) => section.id === "system.identity")?.content,
        directorRolePreview: sections.find((section) => section.id === "system.director-role")
          ?.content,
        executionBoundaryPreview: sections.find(
          (section) => section.id === "system.execution-boundary",
        )?.content,
        staticPrompt: assembled.cacheBoundary.staticPrompt,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write("wave65 director runtime prompt registry gate passed.\n");
}

await runGate();

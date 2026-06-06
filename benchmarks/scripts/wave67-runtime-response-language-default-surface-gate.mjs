import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getBenchmarksPaths, runHotflowCliCommand, runWorkspaceBuild } from "./cli-command.mjs";

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
    fail(
      `${target} build failed for wave67 runtime response language default surface gate.`,
      result.stderr,
    );
  }
}

function coerceJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    const jsonStart = output.indexOf("{");
    const jsonEnd = output.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      return null;
    }

    try {
      return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
    } catch {
      return null;
    }
  }
}

function verifyRun(run, expectedNeedles) {
  const failures = [];
  if (run.status !== 0) {
    failures.push(`Expected CLI exit status 0 but received ${run.status}.`);
  }
  for (const needle of expectedNeedles) {
    if (!run.stdout.includes(needle)) {
      failures.push(`Expected CLI stdout to include: ${needle}`);
    }
  }
  return failures;
}

async function runGate() {
  const { repoRoot, resultsDir } = getBenchmarksPaths();
  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: repoRoot,
    HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
  };

  buildWorkspace("@hotflow/config", env);
  buildWorkspace("@hotflow/context", env);
  buildWorkspace("@hotflow/runtime-bootstrap", env);
  buildWorkspace("@hotflow/cli", env);

  const runtimeBootstrapPath = resolve(repoRoot, "apps", "runtime-bootstrap", "dist", "index.js");
  const runtimeBootstrap = await import(pathToFileURL(runtimeBootstrapPath).href);
  const { createDefaultRuntimeContextAssembler, createDefaultRuntimePromptSections } =
    runtimeBootstrap;

  const config = {
    defaultProvider: "scripted",
    defaultModel: "hotflow-phase1",
    outputStyle: "balanced",
    permissionMode: "ask",
    responseLanguage: "zh-CN",
    workspaceRoot: repoRoot,
  };

  const sections = createDefaultRuntimePromptSections(config);
  const assembled = createDefaultRuntimeContextAssembler(config).build({ tokenBudget: 4_000 });
  const runtimeSection = sections.find((section) => section.id === "system.runtime");
  const responseLanguageSection = sections.find(
    (section) => section.id === "system.response-language",
  );
  const failures = [];

  if (!runtimeSection?.content.includes("Runtime shell:")) {
    failures.push("Expected system.runtime to remain as the runtime shell section.");
  }
  if (runtimeSection?.content.includes("- Response language: zh-CN")) {
    failures.push("Expected system.runtime to stop duplicating the default response language.");
  }
  if (!responseLanguageSection?.content.includes("Default response language: zh-CN")) {
    failures.push("Expected system.response-language to surface the default response language.");
  }
  if (
    !responseLanguageSection?.content.includes(
      "Default response language policy: answer in zh-CN unless session guidance overrides this turn.",
    )
  ) {
    failures.push(
      "Expected system.response-language to encode the response language policy guidance.",
    );
  }
  if (!assembled.cacheBoundary.staticPrompt.includes("Default response language: zh-CN")) {
    failures.push(
      "Expected assembled static prompt to include the named response language section.",
    );
  }
  if (
    !assembled.cacheBoundary.staticPrompt.includes(
      "Default response language policy: answer in zh-CN unless session guidance overrides this turn.",
    )
  ) {
    failures.push(
      "Expected assembled static prompt to include the response language policy guidance.",
    );
  }
  if (assembled.cacheBoundary.staticPrompt.includes("- Response language: zh-CN")) {
    failures.push(
      "Expected assembled static prompt to drop duplicated runtime response language lines.",
    );
  }

  const onboardRun = runHotflowCliCommand(["onboard"], env);
  const onboardJsonRun = runHotflowCliCommand(["onboard", "--json"], env);
  const preflightRun = runHotflowCliCommand(["preflight"], env);
  const preflightJsonRun = runHotflowCliCommand(["preflight", "--json"], env);

  failures.push(
    ...verifyRun(onboardRun, ["Response language: zh-CN"]),
    ...verifyRun(preflightRun, ["Response language: zh-CN"]),
  );

  const onboardJson = coerceJson(onboardJsonRun.stdout);
  const preflightJson = coerceJson(preflightJsonRun.stdout);

  if (onboardJson?.environment?.responseLanguage !== "zh-CN") {
    failures.push("Expected onboard --json to surface environment.responseLanguage=zh-CN.");
  }
  if (preflightJson?.environment?.responseLanguage !== "zh-CN") {
    failures.push("Expected preflight --json to surface environment.responseLanguage=zh-CN.");
  }

  if (failures.length > 0) {
    fail("wave67 runtime response language default surface gate failed.", failures.join("\n"));
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    resolve(resultsDir, "wave67-runtime-response-language-default-surface-gate.json"),
    JSON.stringify(
      {
        gate: "wave67-runtime-response-language-default-surface-gate",
        runtimeSection: runtimeSection?.content,
        responseLanguageSection: responseLanguageSection?.content,
        staticPrompt: assembled.cacheBoundary.staticPrompt,
        onboardStdout: onboardRun.stdout,
        onboardJson,
        preflightStdout: preflightRun.stdout,
        preflightJson,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write("wave67 runtime response language default surface gate passed.\n");
}

await runGate();
